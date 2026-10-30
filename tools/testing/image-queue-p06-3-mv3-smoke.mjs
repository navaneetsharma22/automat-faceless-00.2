/* global process, setTimeout, fetch, chrome, crypto, window, console, document */
import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const cache = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const chromiumVersion = (await readdir(cache, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))[0];
assert.ok(chromiumVersion, "Playwright-installed Chromium is required");
const chromeExecutable = path.join(
  cache,
  chromiumVersion,
  "chrome-win64",
  "chrome.exe",
);
const tempRoot = await mkdtemp(
  path.join(os.tmpdir(), "image-queue-p06-3-mv3-"),
);
const extensionRoot = path.join(tempRoot, "extension");
const profileRoot = path.join(tempRoot, "profile");
const fixtureUrl = "https://flow.google.com/project/p063-local-fixture";
const sources = [
  '{"shot_id":"01","prompt":"synthetic prompt one"}',
  '{"shot_id":"02","prompt":"synthetic prompt two"}',
];
const sourceText = sources
  .map((body, index) => `${index + 1}: ${body}`)
  .join("\n");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let context;

try {
  await cp(path.join(root, "dist"), extensionRoot, { recursive: true });
  const manifestPath = path.join(extensionRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.permissions = [
    ...new Set([...manifest.permissions, "tabs", "scripting"]),
  ];
  manifest.host_permissions = ["https://flow.google.com/*"];
  delete manifest.optional_permissions;
  delete manifest.optional_host_permissions;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  context = await chromium.launchPersistentContext(profileRoot, {
    executablePath: chromeExecutable,
    headless: true,
    args: [
      "--headless=new",
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const extensionsPage = await context.newPage();
  await extensionsPage.goto("chrome://extensions/");
  await extensionsPage.waitForTimeout(500);
  const discoveredExtensionId = await extensionsPage.evaluate(() => {
    const deepQuery = (root, selector) => {
      const direct = root.querySelector(selector);
      if (direct) return direct;
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) {
          const nested = deepQuery(element.shadowRoot, selector);
          if (nested) return nested;
        }
      }
      return undefined;
    };
    const item = deepQuery(document, "extensions-item");
    return item?.id;
  });
  assert.ok(
    discoveredExtensionId,
    "loaded extension ID is unavailable from chrome://extensions",
  );
  const extensionId = discoveredExtensionId;
  await extensionsPage.close();
  const dashboard = await context.newPage();
  await dashboard.goto(`chrome-extension://${extensionId}/index.html`);
  const buildId = await dashboard.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL("background.js"));
    const ids = [
      ...new Set(
        (await response.text()).match(/automat-faceless-0\.1\.0-[a-z0-9-]+/g) ??
          [],
      ),
    ];
    return ids.length === 1 ? ids[0] : null;
  });
  assert.ok(buildId, "packaged build ID is ambiguous");
  const request = (page, type, payload) =>
    page.evaluate(
      ({ type, payload, buildId }) =>
        chrome.runtime.sendMessage({
          type,
          protocolVersion: 4,
          buildId,
          requestId: crypto.randomUUID(),
          payload,
        }),
      { type, payload, buildId },
    );

  const fixture = `<!doctype html><html><body><flow-project-page>
    <flow-base-prompt-box><flow-rich-text-editor><div contenteditable="true" role="textbox" aria-label="Prompt"><p><br></p></div></flow-rich-text-editor><button type="button">Generate</button></flow-base-prompt-box>
    <script>
      window.__syntheticDispatches = [];
      document.querySelector('flow-base-prompt-box button').addEventListener('click', () => {
        const editor = document.querySelector('[contenteditable=true]');
        window.__syntheticDispatches.push({ body: editor.innerText, at: Date.now() });
        editor.innerHTML = '<p><br></p>';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
      });
    </script></flow-project-page></body></html>`;
  const provider = await context.newPage();
  await provider.route(fixtureUrl, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  await provider.goto(fixtureUrl);
  const tabId = await dashboard.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0]?.id,
    fixtureUrl,
  );
  assert.equal(typeof tabId, "number");

  const selected = await request(dashboard, "connections.recordSelection", {
    provider: "Flow",
    tabId,
    canonicalTarget: fixtureUrl,
  });
  assert.equal(
    selected.ok,
    true,
    `selection failed: ${JSON.stringify(selected)}`,
  );
  const connection = await request(dashboard, "connections.revalidate", {
    provider: "Flow",
    enableReconnect: true,
  });
  assert.equal(
    connection.ok,
    true,
    `synthetic Flow read-only connection validation failed: ${JSON.stringify(connection)}`,
  );
  const saved = await request(dashboard, "promptBatch.put", {
    workspaceId: "p063-smoke",
    kind: "image",
    sourceText,
  });
  assert.equal(saved.ok, true, `source save failed: ${JSON.stringify(saved)}`);
  const created = await request(dashboard, "imageQueue.createTimed", {
    workspaceId: "p063-smoke",
    queueId: crypto.randomUUID(),
    settingsConfirmation: {
      confirmationId: crypto.randomUUID(),
      confirmedAt: Date.now(),
      tabId,
      projectId: "p063-local-fixture",
      canonicalTarget: fixtureUrl,
      declaredVariantCount: 2,
    },
  });
  assert.equal(
    created.ok,
    true,
    `queue creation failed: ${JSON.stringify(created)}`,
  );
  const queueId = created.data.queueId;
  const started = await request(dashboard, "imageQueue.start", { queueId });
  assert.equal(
    started.ok,
    true,
    `queue start failed: ${JSON.stringify(started)}`,
  );
  assert.equal(started.data.items[0].itemState, "sent");
  assert.equal(started.data.items[0].providerOutcome, "unknown");
  const firstReceiptAt = started.data.items[0].dispatchReceipt.storedAt;
  assert.equal(started.data.nextEligibleDispatchAt, firstReceiptAt + 40_000);
  const paused = await request(dashboard, "imageQueue.pause", {
    queueId,
    expectedRevision: started.data.revision,
  });
  assert.equal(paused.ok, true, `pause failed: ${JSON.stringify(paused)}`);
  assert.equal(paused.data.state, "paused");
  await dashboard.close();

  // Resume with the same saved deadline. No worker DevTools is attached: the
  // only worker handle above was used to read the extension ID and is idle now.
  await sleep(2_000);
  const dashboard2 = await context.newPage();
  await dashboard2.goto(`chrome-extension://${extensionId}/index.html`);
  const resumed = await request(dashboard2, "imageQueue.resume", {
    queueId,
    expectedRevision: paused.data.revision,
  });
  assert.equal(resumed.ok, true, `resume failed: ${JSON.stringify(resumed)}`);
  assert.equal(resumed.data.nextEligibleDispatchAt, firstReceiptAt + 40_000);
  await dashboard2.close();

  const lifecycleSession = await context.newCDPSession(provider);
  const workerVersions = [];
  lifecycleSession.on("ServiceWorker.workerVersionUpdated", (event) =>
    workerVersions.push(...event.versions),
  );
  await lifecycleSession.send("ServiceWorker.enable");
  const workerDeadline = Date.now() + 5_000;
  let workerVersion;
  while (Date.now() < workerDeadline) {
    workerVersion = workerVersions.find(
      (entry) =>
        entry.scriptURL === `chrome-extension://${extensionId}/background.js` &&
        entry.runningStatus === "running",
    );
    if (workerVersion) break;
    await sleep(100);
  }
  assert.ok(
    workerVersion,
    "running packaged MV3 service worker was not visible to Chrome ServiceWorker protocol",
  );
  await lifecycleSession.send("ServiceWorker.stopWorker", {
    versionId: workerVersion.versionId,
  });
  await lifecycleSession.detach();
  const workerStopped = true;

  const dispatchDeadline = Date.now() + 50_000;
  let dispatches = [];
  while (Date.now() < dispatchDeadline) {
    dispatches = await provider.evaluate(() => window.__syntheticDispatches);
    if (dispatches.length >= 2) break;
    await sleep(250);
  }
  assert.equal(
    dispatches.length,
    2,
    `expected exactly two synthetic activations, got ${dispatches.length}`,
  );
  assert.deepEqual(
    dispatches.map((entry) => entry.body),
    sources,
  );
  assert.ok(
    dispatches[1].at - dispatches[0].at >= 40_000,
    "second activation occurred before 40 seconds",
  );

  const dashboard3 = await context.newPage();
  await dashboard3.goto(`chrome-extension://${extensionId}/index.html`);
  const persisted = await request(dashboard3, "imageQueue.get", { queueId });
  assert.equal(persisted.ok, true);
  assert.equal(persisted.data.state, "sent");
  assert.deepEqual(
    persisted.data.items.map((item) => item.itemState),
    ["sent", "sent"],
  );
  assert.ok(
    persisted.data.items.every((item) => item.providerOutcome === "unknown"),
  );
  assert.ok(persisted.data.items.every((item) => item.dispatchReceipt));
  assert.ok(
    persisted.data.items[1].dispatchReceipt.storedAt -
      persisted.data.items[0].dispatchReceipt.storedAt >=
      40_000,
  );
  assert.equal(
    (await provider.evaluate(() => window.__syntheticDispatches)).length,
    2,
  );
  console.log(
    JSON.stringify(
      {
        smoke: "p06.3-installed-mv3-local-synthetic-flow",
        buildId,
        workerTerminatedBeforeAlarm: workerStopped,
        activationCount: dispatches.length,
        intervalMs:
          persisted.data.items[1].dispatchReceipt.storedAt -
          persisted.data.items[0].dispatchReceipt.storedAt,
        outcomes: persisted.data.items.map((item) => item.providerOutcome),
        liveFlowAcceptance: "NOT_RUN",
      },
      null,
      2,
    ),
  );
  await dashboard3.close();
} finally {
  await context?.close();
  await rm(tempRoot, { recursive: true, force: true });
}
