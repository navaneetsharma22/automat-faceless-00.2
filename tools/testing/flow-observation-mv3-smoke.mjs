/* global process, URL, chrome, location, crypto, console, TextEncoder, indexedDB */
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const packagedExtension = path.join(root, "dist");
const chromiumRoot = path.join(
  process.env.LOCALAPPDATA ?? "",
  "ms-playwright",
  "chromium-1234",
  "chrome-win64",
  "chrome.exe",
);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "flow-observation-mv3-"));
const extensionRoot = path.join(tempRoot, "extension");
const profileRoot = path.join(tempRoot, "profile");
const fixtureUrl = "https://flow.google.com/project/fixture-observation";
const rawJsonBody = '{"shot_id":"05","scene":"synthetic fixture"}';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let context;

try {
  await cp(packagedExtension, extensionRoot, { recursive: true });
  const manifestPath = path.join(extensionRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.permissions = [
    ...new Set([...manifest.permissions, "tabs", "scripting"]),
  ].sort();
  manifest.host_permissions = ["https://flow.google.com/*"];
  delete manifest.optional_permissions;
  delete manifest.optional_host_permissions;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  context = await chromium.launchPersistentContext(profileRoot, {
    executablePath: chromiumRoot,
    headless: true,
    args: [
      "--headless=new",
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  const extensionId = new URL(worker.url()).hostname;
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

  const fixture = `<!doctype html><html><head><style>
    flow-project-page,flow-base-prompt-box,flow-rich-text-editor,flow-tile-container,flow-image-tile{display:block;min-height:80px}
    flow-project-page,flow-image-tile{padding:8px} img{width:24px;height:24px}
    [contenteditable=true]{min-height:32px}
  </style></head><body><flow-project-page>
    <flow-base-prompt-box><flow-rich-text-editor>
      <div contenteditable="true" role="textbox" aria-label="Prompt"><p><br></p></div>
    </flow-rich-text-editor><button type="button">Generate</button></flow-base-prompt-box>
    <flow-tile-container>${[1, 2, 3, 4]
      .map(
        (n) =>
          `<flow-image-tile><img data-media-id="existing-${n}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect width='24' height='24' fill='blue'/%3E%3C/svg%3E"></flow-image-tile>`,
      )
      .join("")}</flow-tile-container>
    <script>
      window.__syntheticActivationCount = 0;
      document.querySelector('flow-base-prompt-box button').addEventListener('click', () => {
        window.__syntheticActivationCount++;
        const composer = document.querySelector('flow-base-prompt-box');
        const editor = composer.querySelector('[contenteditable=true]');
        editor.innerHTML = '<p><br></p>';
        editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'deleteContent'}));
        const container = document.querySelector('flow-tile-container');
        for (let index=1; index<=2; index++) {
          const tile = document.createElement('flow-image-tile');
          tile.dataset.syntheticOutput = String(index);
          const pending = document.createElement('div');
          pending.setAttribute('role','progressbar'); pending.dataset.loading='true';
          tile.append(pending); container.append(tile);
        }
        window.setTimeout(() => {
          for (const tile of container.querySelectorAll('flow-image-tile[data-synthetic-output]')) {
            const image = document.createElement('img');
            image.dataset.mediaId = 'new-output-' + tile.dataset.syntheticOutput;
            image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect width='24' height='24' fill='green'/%3E%3C/svg%3E";
            tile.replaceChildren(image);
          }
        }, 40000);
      });
    </script>
  </flow-project-page></body></html>`;
  const provider = await context.newPage();
  await provider.route(fixtureUrl, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  await provider.goto(fixtureUrl);
  const tabId = await dashboard.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url });
    return tabs[0]?.id;
  }, fixtureUrl);
  assert.equal(typeof tabId, "number");

  const request = (type, payload) =>
    dashboard.evaluate(
      async ({ type, payload, buildId }) =>
        await chrome.runtime.sendMessage({
          type,
          protocolVersion: 4,
          buildId,
          requestId: crypto.randomUUID(),
          payload,
        }),
      { type, payload, buildId },
    );
  const selected = await request("connections.recordSelection", {
    provider: "Flow",
    tabId,
    canonicalTarget: fixtureUrl,
  });
  assert.equal(selected.ok, true, "worker selection message failed");
  const connection = await request("connections.revalidate", {
    provider: "Flow",
    enableReconnect: true,
  });
  assert.equal(connection.ok, true, "strict connector handshake failed");
  assert.equal(connection.data?.state, "verified");
  const saved = await request("promptBatch.put", {
    workspaceId: "default",
    kind: "image",
    sourceText: rawJsonBody,
  });
  assert.equal(
    saved.ok,
    true,
    `saved source request failed: ${JSON.stringify(saved)}`,
  );
  const promptHash = saved.data?.items?.[0]?.contentHash;
  assert.match(promptHash ?? "", /^[0-9a-f]{64}$/);
  const countSessionId = crypto.randomUUID();
  const countMode = {
    mode: "existing_project",
    countSessionId,
    startingImageCount: 4,
    userConfirmed: true,
  };
  const readiness = await request("flow.image.checkReadiness", { countMode });
  assert.equal(readiness.ok, true, "production readiness handler failed");
  assert.equal(readiness.data?.status, "ready", JSON.stringify(readiness));
  assert.equal(readiness.data?.countModeEligibility?.startingImageCount, 4);
  assert.equal(
    readiness.data?.qualifyingCandidateCount,
    4,
    JSON.stringify(readiness),
  );

  const generation = await request("flow.image.generateOnce", {
    workspaceId: "default",
    promptHash,
    settingsConfirmation: {
      confirmationId: crypto.randomUUID(),
      confirmedAt: Date.now(),
      tabId,
      projectId: "fixture-observation",
      canonicalTarget: fixtureUrl,
      declaredVariantCount: 2,
    },
    countMode,
  });
  assert.equal(generation.ok, true, "production GenerateOnce handler failed");
  assert.equal(
    generation.data?.state,
    "dispatched",
    JSON.stringify(generation),
  );
  const attemptId = generation.data?.attemptId;
  assert.ok(attemptId);

  const preDelay = await request("flow.image.getCountDecision", { attemptId });
  assert.equal(preDelay.ok, true);
  assert.equal(preDelay.data?.countDecision?.status, "observing");
  const activationCount = await provider.evaluate(
    () => window.__syntheticActivationCount,
  );
  assert.equal(
    activationCount,
    1,
    "production activation did not click local synthetic control once",
  );
  const postHandlerDebuggerState = await dashboard.evaluate(
    async (targetId) => {
      const targets = await chrome.debugger.getTargets();
      return targets.some(
        (target) => target.tabId === targetId && target.attached,
      );
    },
    tabId,
  );

  // Candidate readiness is delayed beyond GenerateOnce's handler lifetime and
  // debugger cleanup. The production injected observer sends the later event.
  await sleep(40_700);
  const final = await request("flow.image.getCountDecision", { attemptId });
  assert.equal(
    final.data?.countDecision?.status,
    "count_matched",
    JSON.stringify(final),
  );
  const stored = await dashboard.evaluate(async (id) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open("automat-faceless-app-v1");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const transaction = database.transaction("flowImageAttempts", "readonly");
    const row = await new Promise((resolve, reject) => {
      const get = transaction.objectStore("flowImageAttempts").get(id);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return {
      state: row?.state,
      sessionStatus: row?.observationSession?.status,
      lastSequence: row?.observationSession?.lastSequence,
      observationCount: row?.structuralObservations?.length ?? 0,
      acceptedSequences: (row?.observationReceipts ?? []).map(
        (receipt) => receipt.sequence,
      ),
      eventCodes: (row?.events ?? [])
        .map((event) => event.code)
        .filter(Boolean),
      countDecision: row?.countDecision,
    };
  }, attemptId);
  assert.equal(final.ok, true);
  assert.equal(stored.state, "dispatched");
  assert.equal(stored.lastSequence >= 2, true, JSON.stringify(stored));
  assert.equal(stored.sessionStatus, "active");
  assert.equal(stored.countDecision?.status, "count_matched");

  // Prove ownership isolation separately. An attachment made outside the
  // adapter must block the production observation check and remain attached.
  await dashboard.evaluate(
    (targetId) => chrome.debugger.attach({ tabId: targetId }, "1.3"),
    tabId,
  );
  await provider.evaluate(() => {
    const tile = document.querySelector(
      "flow-image-tile[data-synthetic-output='1']",
    );
    const marker = document.createElement("div");
    marker.setAttribute("role", "status");
    marker.dataset.fixture = "external-owner-check";
    tile?.append(marker);
  });
  await sleep(500);
  const externalOwnerPreserved = await dashboard.evaluate(async (targetId) => {
    const targets = await chrome.debugger.getTargets();
    return targets.some(
      (target) => target.tabId === targetId && target.attached,
    );
  }, tabId);
  assert.equal(
    externalOwnerPreserved,
    true,
    "observation check disturbed an external debugger owner",
  );
  const refused = await request("flow.image.getCountDecision", { attemptId });
  const refusedStored = await dashboard.evaluate(async (id) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open("automat-faceless-app-v1");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const transaction = database.transaction("flowImageAttempts", "readonly");
    const row = await new Promise((resolve, reject) => {
      const get = transaction.objectStore("flowImageAttempts").get(id);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return {
      sessionStatus: row?.observationSession?.status,
      outcome: row?.resultOutcome,
      eventCodes: (row?.events ?? [])
        .map((event) => event.code)
        .filter(Boolean),
    };
  }, attemptId);
  assert.equal(
    refusedStored.sessionStatus,
    "lost",
    JSON.stringify({ refused, refusedStored }),
  );
  assert.equal(refusedStored.outcome?.status, "unknown");
  assert.ok(
    refusedStored.eventCodes.includes(
      "binding_check_exception_frame_inspection_debugger_attach_error",
    ),
  );
  await dashboard.evaluate(
    (targetId) => chrome.debugger.detach({ tabId: targetId }),
    tabId,
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        test: "packaged_mv3_production_observer_after_generateonce_cleanup",
        buildId,
        workerMessageTransport: "chrome.runtime.sendMessage",
        selectedTabIsLocalIntercept: true,
        strictConnection: connection.data?.state,
        readiness: readiness.data?.status,
        generation: generation.data?.state,
        syntheticActivationCount: activationCount,
        delayedCandidateReadyMs: 40_000,
        finalCountDecisionBeforeExternalOwner:
          final.data?.countDecision?.status,
        durableSessionStatusBeforeExternalOwner: stored.sessionStatus,
        durableAcceptedSequences: stored.acceptedSequences,
        durableObservationCount: stored.observationCount,
        postGenerateOnceDebuggerAttached: postHandlerDebuggerState,
        externalOwnerRefusal: refusedStored.eventCodes.at(-1),
        externalOwnerPreservedUntilTestCleanup: externalOwnerPreserved,
        failClosedOutcome: refusedStored.outcome?.status,
        providerNavigationOrReloadRequested: false,
        userProfileOrHistoricalDataTouched: false,
      },
      null,
      2,
    ),
  );
} finally {
  await context?.close();
  await rm(tempRoot, { recursive: true, force: true });
}
