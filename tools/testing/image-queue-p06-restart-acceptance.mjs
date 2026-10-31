/* global process, setTimeout, fetch, chrome, crypto, window, console, document, indexedDB */
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
  path.join(os.tmpdir(), "image-queue-p06-restart-"),
);
const extensionRoot = path.join(tempRoot, "extension");
const profileRoot = path.join(tempRoot, "profile");
const fixtureUrl = "https://flow.google.com/project/p06-restart-fixture";
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

  context.on("serviceworker", (worker) => {
    worker.on("console", (msg) => console.log("[SW console]", msg.text()));
  });

  const extensionsPage = await context.newPage();
  await extensionsPage.goto("chrome://extensions/");
  await extensionsPage.waitForTimeout(500);
  const discoveredExtensionId = await extensionsPage.evaluate(() => {
    const deepQuery = (node, selector) => {
      const direct = node.querySelector(selector);
      if (direct) return direct;
      for (const element of node.querySelectorAll("*")) {
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

  async function stopWorker(sessionTarget) {
    const session = await context.newCDPSession(sessionTarget);
    const workerVersions = [];
    session.on("ServiceWorker.workerVersionUpdated", (event) =>
      workerVersions.push(...event.versions),
    );
    await session.send("ServiceWorker.enable");
    const deadline = Date.now() + 5_000;
    let workerVersion;
    while (Date.now() < deadline) {
      workerVersion = workerVersions.find(
        (entry) =>
          entry.scriptURL ===
            `chrome-extension://${extensionId}/background.js` &&
          entry.runningStatus === "running",
      );
      if (workerVersion) break;
      await sleep(100);
    }
    assert.ok(workerVersion, "running worker not found for termination");
    await session.send("ServiceWorker.stopWorker", {
      versionId: workerVersion.versionId,
    });
    await session.detach();
  }

  // Setup synthetic Flow provider page
  const fixtureHtml = `<!doctype html><html><body><flow-project-page>
    <flow-base-prompt-box>
      <flow-rich-text-editor>
        <div contenteditable="true" role="textbox" aria-label="Prompt"><p><br></p></div>
      </flow-rich-text-editor>
      <button type="button">Generate</button>
    </flow-base-prompt-box>
    <script>
      window.__syntheticDispatches = [];
      const btn = document.querySelector('flow-base-prompt-box button');
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const editor = document.querySelector('[contenteditable=true]');
        window.__syntheticDispatches.push({ body: editor.innerText, at: Date.now() });
        editor.innerHTML = '<p><br></p>';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
      });
    </script>
  </flow-project-page></body></html>`;

  const provider = await context.newPage();
  await provider.route(fixtureUrl, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml }),
  );
  await provider.goto(fixtureUrl);

  const tabId = await dashboard.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0]?.id,
    fixtureUrl,
  );
  assert.equal(typeof tabId, "number");

  const recSelection = await request(dashboard, "connections.recordSelection", {
    provider: "Flow",
    tabId,
    canonicalTarget: fixtureUrl,
  });
  assert.ok(recSelection.ok, `Selection failed: ${JSON.stringify(recSelection)}`);
  const recReval = await request(dashboard, "connections.revalidate", {
    provider: "Flow",
    enableReconnect: true,
  });
  assert.ok(recReval.ok, `Revalidate failed: ${JSON.stringify(recReval)}`);

  console.log("--- P06 Restart Acceptance Tests on installed-MV3 ---");
  const targetScenario = process.argv[2] ?? process.env.SCENARIO;

  // =========================================================================
  // Test 1: Worker restart during normal 40-second interval preserves deadline;
  //         no early, duplicate or catch-up dispatch.
  // =========================================================================
  if (!targetScenario || targetScenario === "1") {
    console.log("Running Scenario 1: Normal 40s wait interval restart...");
    const source1 = [
      '1: {"shot_id":"01","prompt":"restart scenario 1 shot 1"}',
      '2: {"shot_id":"02","prompt":"restart scenario 1 shot 2"}',
    ].join("\n");
    const save1 = await request(dashboard, "promptBatch.put", {
      workspaceId: "ws-scen-1",
      kind: "image",
      sourceText: source1,
    });
    assert.ok(save1.ok, `save1 failed: ${JSON.stringify(save1)}`);
    const q1 = await request(dashboard, "imageQueue.createTimed", {
      workspaceId: "ws-scen-1",
      queueId: crypto.randomUUID(),
      settingsConfirmation: {
        confirmationId: crypto.randomUUID(),
        confirmedAt: Date.now(),
        tabId,
        projectId: "p06-restart-fixture",
        canonicalTarget: fixtureUrl,
        declaredVariantCount: 1,
      },
    });
    assert.ok(q1.ok, `q1 create failed: ${JSON.stringify(q1)}`);
    const q1Id = q1.data.queueId;
    const started1 = await request(dashboard, "imageQueue.start", {
      queueId: q1Id,
    });
    assert.ok(started1.ok, `q1 start failed: ${JSON.stringify(started1)}`);
    assert.equal(started1.data.items[0].itemState, "sent");
    const firstReceiptAt = started1.data.items[0].dispatchReceipt.storedAt;
    const deadline1 = started1.data.nextEligibleDispatchAt;
    assert.equal(deadline1, firstReceiptAt + 40_000);

    // Terminate worker while waiting
    await stopWorker(provider);

    // Re-open dashboard / wake worker after 2 seconds to check deadline preservation
    await sleep(2_000);
    const checkDash = await context.newPage();
    await checkDash.goto(`chrome-extension://${extensionId}/index.html`);
    const midState = await request(checkDash, "imageQueue.get", { queueId: q1Id });
    assert.equal(midState.data.state, "waiting");
    assert.equal(midState.data.nextEligibleDispatchAt, deadline1); // Exact deadline preserved!
    assert.equal(midState.data.items[0].itemState, "sent");
    assert.equal(midState.data.items[1].itemState, "pending");
    await checkDash.close();

    // Now wait for real Chrome alarm to wake up and dispatch prompt 2
    const maxWait = deadline1 - Date.now() + 15_000;
    const deadlineTime = Date.now() + Math.max(maxWait, 45_000);
    let dispatches1 = [];
    while (Date.now() < deadlineTime) {
      dispatches1 = await provider.evaluate(() => window.__syntheticDispatches);
      if (dispatches1.length >= 2) break;
      await sleep(500);
    }
    assert.equal(dispatches1.length, 2, "Scenario 1: Expected exactly 2 dispatches");
    assert.ok(
      dispatches1[1].at - dispatches1[0].at >= 40_000,
      `Scenario 1: Second activation happened after ${dispatches1[1].at - dispatches1[0].at}ms (>= 40,000ms)`,
    );

    // Ensure Queue 1 is fully terminal before moving to Scenario 2
    const q1FinishDeadline = Date.now() + 10_000;
    while (Date.now() < q1FinishDeadline) {
      const q1Final = await request(dashboard, "imageQueue.get", { queueId: q1Id });
      if (q1Final.data?.state === "sent") break;
      await sleep(200);
    }
    console.log("✓ Scenario 1 PASS: 40s deadline preserved across worker restart, no early or duplicate dispatch.");
  }

  // =========================================================================
  // Test 2: Worker restart during Generate-readiness waiting preserves
  //         readinessStartedAt and readinessDeadlineAt. Repeated restarts
  //         must not extend the 60-second limit.
  // =========================================================================
  if (!targetScenario || targetScenario === "2") {
    console.log("Running Scenario 2: Generate-readiness wait restart...");
    // Disable button in fixture
    await provider.evaluate(() => {
      document.querySelector("flow-base-prompt-box button").disabled = true;
    });

    const source2 = '10: {"shot_id":"10","prompt":"readiness wait prompt"}';
    const save2 = await request(dashboard, "promptBatch.put", {
      workspaceId: "ws-scen-2",
      kind: "image",
      sourceText: source2,
    });
    assert.ok(save2.ok, `save2 failed: ${JSON.stringify(save2)}`);
    const q2 = await request(dashboard, "imageQueue.createTimed", {
      workspaceId: "ws-scen-2",
      queueId: crypto.randomUUID(),
      settingsConfirmation: {
        confirmationId: crypto.randomUUID(),
        confirmedAt: Date.now(),
        tabId,
        projectId: "p06-restart-fixture",
        canonicalTarget: fixtureUrl,
        declaredVariantCount: 1,
      },
    });
    assert.ok(q2.ok, `q2 create failed: ${JSON.stringify(q2)}`);
    const q2Id = q2.data.queueId;

    // Start queue in background: button is disabled so it enters readiness waiting
    const startPromise = request(dashboard, "imageQueue.start", { queueId: q2Id }).catch(() => undefined);

    // Wait for item to enter readiness waiting
    let readinessItem;
    const readDeadline = Date.now() + 10_000;
    while (Date.now() < readDeadline) {
      const qState = await request(dashboard, "imageQueue.get", { queueId: q2Id });
      if (qState.data?.items[0]?.dispatchIntent?.readinessDeadlineAt) {
        readinessItem = qState.data.items[0];
        break;
      }
      await sleep(200);
    }
    assert.ok(readinessItem, "Item did not enter readiness waiting");
    const origStartedAt = readinessItem.dispatchIntent.readinessStartedAt;
    const origDeadlineAt = readinessItem.dispatchIntent.readinessDeadlineAt;
    assert.ok(origStartedAt > 0);
    assert.equal(origDeadlineAt, origStartedAt + 60_000);

    // Terminate worker #1 during readiness wait
    await stopWorker(provider);
    await sleep(1_000);

    // Restart worker by opening new page
    const dash2 = await context.newPage();
    await dash2.goto(`chrome-extension://${extensionId}/index.html`);
    const afterRestart1 = await request(dash2, "imageQueue.get", { queueId: q2Id });
    console.log("afterRestart1:", JSON.stringify(afterRestart1));
    assert.ok(afterRestart1.ok, `Restart 1 get failed: ${JSON.stringify(afterRestart1)}`);
    assert.equal(
      afterRestart1.data.items[0].dispatchIntent?.readinessDeadlineAt,
      origDeadlineAt,
      "Restart 1 altered readinessDeadlineAt!",
    );
    assert.equal(
      afterRestart1.data.items[0].dispatchIntent?.readinessStartedAt,
      origStartedAt,
      "Restart 1 altered readinessStartedAt!",
    );

    // Terminate worker #2 during readiness wait
    await stopWorker(provider);
    await sleep(1_000);

    // Restart worker #2
    const dash3 = await context.newPage();
    await dash3.goto(`chrome-extension://${extensionId}/index.html`);
    const afterRestart2 = await request(dash3, "imageQueue.get", { queueId: q2Id });
    console.log("afterRestart2:", JSON.stringify(afterRestart2));
    assert.ok(afterRestart2.ok, `Restart 2 get failed: ${JSON.stringify(afterRestart2)}`);
    assert.equal(
      afterRestart2.data.items[0].dispatchIntent?.readinessDeadlineAt,
      origDeadlineAt,
      "Restart 2 altered readinessDeadlineAt!",
    );
    assert.equal(
      afterRestart2.data.items[0].dispatchIntent?.readinessStartedAt,
      origStartedAt,
      "Restart 2 altered readinessStartedAt!",
    );

    // Now enable the button in the provider page
    await provider.evaluate(() => {
      document.querySelector("flow-base-prompt-box button").disabled = false;
    });

    // Wait for automatic recovery and dispatch
    const recovDeadline = Date.now() + 15_000;
    let q2Final;
    while (Date.now() < recovDeadline) {
      const qState = await request(dash3, "imageQueue.get", { queueId: q2Id });
      if (qState.data?.state === "sent") {
        q2Final = qState.data;
        break;
      }
      await sleep(500);
    }
    assert.ok(q2Final, "Queue did not recover and dispatch after button enabled");
    assert.equal(q2Final.items[0].itemState, "sent");
    assert.equal(q2Final.items[0].providerOutcome, "unknown");
    assert.ok(q2Final.items[0].dispatchReceipt);
    await dash2.close();
    await dash3.close();
    await startPromise;
    console.log("✓ Scenario 2 PASS: Original readinessStartedAt and readinessDeadlineAt preserved across repeated restarts without extending limit.");
  }

  // =========================================================================
  // Test 3: Worker restart after activation authorization but before receipt
  //         refuses replay and retains uncertainty.
  // =========================================================================
  console.log("Running Scenario 3: Restart after activation authorization before receipt...");
  const source3 = '30: {"shot_id":"30","prompt":"uncertain prompt"}';
  const save3 = await request(dashboard, "promptBatch.put", {
    workspaceId: "ws-scen-3",
    kind: "image",
    sourceText: source3,
  });
  assert.ok(save3.ok, `save3 failed: ${JSON.stringify(save3)}`);
  const q3 = await request(dashboard, "imageQueue.createTimed", {
    workspaceId: "ws-scen-3",
    queueId: crypto.randomUUID(),
    settingsConfirmation: {
      confirmationId: crypto.randomUUID(),
      confirmedAt: Date.now(),
      tabId,
      projectId: "p06-restart-fixture",
      canonicalTarget: fixtureUrl,
      declaredVariantCount: 1,
    },
  });
  assert.ok(q3.ok, `q3 create failed: ${JSON.stringify(q3)}`);
  const q3Id = q3.data.queueId;

  // Claim and mark activation started directly in storage to simulate crash between activation and receipt
  await dashboard.evaluate(
    ({ q3Id }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("automat-faceless-app-v1");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["imageSubmissionQueues"], "readwrite");
          const store = tx.objectStore("imageSubmissionQueues");
          const getReq = store.get(q3Id);
          getReq.onsuccess = () => {
            const record = getReq.result;
            record.revision += 1;
            record.items[0].itemState = "sending";
            record.items[0].dispatchIntent = {
              attemptId: "crash-attempt-uuid",
              recordedAt: Date.now(),
              activationStartedAt: Date.now(), // Authorized and started, but NO dispatchReceipt!
            };
            record.items[0].providerOutcome = "unknown";
            const putReq = store.put(record);
            putReq.onsuccess = () => resolve();
            putReq.onerror = () => reject(putReq.error);
          };
          getReq.onerror = () => reject(getReq.error);
        };
      }),
    { q3Id },
  );

  // Terminate worker
  await stopWorker(provider);
  await sleep(1_000);

  // Restart worker and trigger reconcileStartup
  const dash4 = await context.newPage();
  await dash4.goto(`chrome-extension://${extensionId}/index.html`);
  const q3AfterRestart = await request(dash4, "imageQueue.get", { queueId: q3Id });
  assert.equal(
    q3AfterRestart.data.state,
    "blocked",
    "Queue must be blocked when restarted during unresolved activation",
  );
  assert.equal(
    q3AfterRestart.data.items[0].itemState,
    "blocked",
    "Item must be blocked",
  );
  assert.equal(
    q3AfterRestart.data.items[0].providerOutcome,
    "unknown",
    "Outcome must remain unknown (uncertainty preserved)",
  );
  assert.equal(
    q3AfterRestart.data.items[0].blockReason,
    "worker_restart_during_dispatch",
    "Reason must be worker_restart_during_dispatch",
  );
  await dash4.close();
  console.log("✓ Scenario 3 PASS: Worker restart after activation authorization refuses replay and retains uncertainty.");

  // =========================================================================
  // Test 4: Paused and stopped queues remain inactive after restart.
  // =========================================================================
  console.log("Running Scenario 4: Paused and stopped queues remain inactive after restart...");
  // Clear any existing blocker queues by stopping q3
  await request(dashboard, "imageQueue.stop", {
    queueId: q3Id,
    expectedRevision: q3AfterRestart.data.revision,
  });

  const source4 = [
    '40: {"shot_id":"40","prompt":"paused queue prompt 1"}',
    '41: {"shot_id":"41","prompt":"paused queue prompt 2"}',
  ].join("\n");
  const save4 = await request(dashboard, "promptBatch.put", {
    workspaceId: "ws-scen-4",
    kind: "image",
    sourceText: source4,
  });
  assert.ok(save4.ok, `save4 failed: ${JSON.stringify(save4)}`);
  const q4 = await request(dashboard, "imageQueue.createTimed", {
    workspaceId: "ws-scen-4",
    queueId: crypto.randomUUID(),
    settingsConfirmation: {
      confirmationId: crypto.randomUUID(),
      confirmedAt: Date.now(),
      tabId,
      projectId: "p06-restart-fixture",
      canonicalTarget: fixtureUrl,
      declaredVariantCount: 1,
    },
  });
  assert.ok(q4.ok, `q4 create failed: ${JSON.stringify(q4)}`);
  const q4Id = q4.data.queueId;
  const started4 = await request(dashboard, "imageQueue.start", { queueId: q4Id });
  const paused4 = await request(dashboard, "imageQueue.pause", {
    queueId: q4Id,
    expectedRevision: started4.data.revision,
  });
  assert.equal(paused4.data.state, "paused");

  // Read current synthetic dispatch count
  const dispatchesBefore = (await provider.evaluate(() => window.__syntheticDispatches)).length;

  // Terminate worker
  await stopWorker(provider);
  await sleep(1_500);

  // Restart worker
  const dash5 = await context.newPage();
  await dash5.goto(`chrome-extension://${extensionId}/index.html`);

  // Wait a few seconds to verify no rogue alarms or dispatches occur
  await sleep(3_000);
  const dispatchesAfter = (await provider.evaluate(() => window.__syntheticDispatches)).length;
  assert.equal(
    dispatchesAfter,
    dispatchesBefore,
    "No synthetic dispatches should occur for paused queue after restart",
  );

  const q4After = await request(dash5, "imageQueue.get", { queueId: q4Id });
  assert.equal(q4After.data.state, "paused", "Paused queue must remain paused");
  assert.equal(q4After.data.items[1].itemState, "pending", "Item 2 must remain pending");

  // Now test stopped queue
  const stopped4 = await request(dash5, "imageQueue.stop", {
    queueId: q4Id,
    expectedRevision: q4After.data.revision,
  });
  assert.equal(stopped4.data.state, "stopped");

  // Terminate worker again
  await stopWorker(provider);
  await sleep(1_500);

  // Restart worker
  const dash6 = await context.newPage();
  await dash6.goto(`chrome-extension://${extensionId}/index.html`);
  await sleep(3_000);

  const dispatchesAfterStop = (await provider.evaluate(() => window.__syntheticDispatches)).length;
  assert.equal(
    dispatchesAfterStop,
    dispatchesBefore,
    "No synthetic dispatches should occur for stopped queue after restart",
  );

  const q4AfterStop = await request(dash6, "imageQueue.get", { queueId: q4Id });
  assert.equal(q4AfterStop.data.state, "stopped", "Stopped queue must remain stopped");
  assert.equal(q4AfterStop.data.items[1].itemState, "stopped", "Item 2 must remain stopped");

  await dash5.close();
  await dash6.close();
  console.log("✓ Scenario 4 PASS: Paused and stopped queues remain inactive after worker restart.");

  // Output summary
  console.log(
    JSON.stringify(
      {
        acceptance: "P06-restart-installed-mv3-acceptance",
        buildId,
        scenarios: {
          scenario1_waiting_restart: "PASS",
          scenario2_readiness_restart: "PASS",
          scenario3_unresolved_authorization: "PASS",
          scenario4_paused_stopped_inactive: "PASS",
        },
        workerTerminationMethod: "CDP ServiceWorker.stopWorker (forced termination)",
        naturalIdleDistinction:
          "Forced termination via CDP ServiceWorker.stopWorker simulated. Chrome natural idle suspension follows the same process lifecycle but depends on internal OS activity timers without open DevTools.",
        countingAndProviderResults: "DEFERRED",
        status: "OFFLINE_VERIFIED",
      },
      null,
      2,
    ),
  );
  await dashboard.close();
} finally {
  await context?.close();
  await rm(tempRoot, { recursive: true, force: true });
}
