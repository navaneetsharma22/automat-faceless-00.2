/* global process, URL, fetch, chrome, location, crypto, console, TextEncoder, indexedDB, window */
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
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "flow-health-mv3-"));
const extensionRoot = path.join(tempRoot, "extension");
const profileRoot = path.join(tempRoot, "profile");
let context;
let attached = false;
let tabId;

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
  assert.ok(extensionId, "MV3 service worker did not expose its extension ID");

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/index.html`);
  const packageSource = await extensionPage.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL("background.js"));
    return response.text();
  });
  const buildIds = [
    ...new Set(
      packageSource.match(/automat-faceless-0\.1\.0-[a-z0-9-]+/g) ?? [],
    ),
  ];
  assert.equal(buildIds.length, 1, "packaged bundle build ID is ambiguous");

  const providerTab = await context.newPage();
  await providerTab.route(
    "https://flow.google.com/project/fixture-health",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Local intercepted Flow fixture</title><main>synthetic fixture</main>",
      }),
  );
  await providerTab.goto("https://flow.google.com/project/fixture-health");
  tabId = await extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({
      url: "https://flow.google.com/project/fixture-health",
    });
    return tabs[0]?.id;
  });
  assert.equal(
    typeof tabId,
    "number",
    "extension tabs API did not find fixture",
  );

  await extensionPage.evaluate(
    (targetId) => chrome.debugger.attach({ tabId: targetId }, "1.3"),
    tabId,
  );
  attached = true;
  const result = await extensionPage.evaluate(
    async ({ tabId }) => {
      const url = "https://flow.google.com/project/fixture-health";
      const frameTree = await chrome.debugger.sendCommand(
        { tabId },
        "Page.getFrameTree",
      );
      const scriptResults = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: () => location.href,
      });
      const tab = await chrome.tabs.get(tabId);
      return {
        tabMatches: tab.id === tabId && tab.url === url,
        frameId: frameTree.frameTree?.frame?.id,
        loaderId: frameTree.frameTree?.frame?.loaderId,
        loaderIdPresent: Boolean(frameTree.frameTree?.frame?.loaderId),
        documentId: scriptResults[0]?.documentId,
        documentIdPresent: Boolean(scriptResults[0]?.documentId),
        scriptedFrameId: scriptResults[0]?.frameId,
        scriptedUrl: scriptResults[0]?.result,
      };
    },
    { tabId },
  );
  const ping = await extensionPage.evaluate(
    async ({ buildId }) =>
      chrome.runtime.sendMessage({
        type: "foundation.ping",
        protocolVersion: 4,
        buildId,
        requestId: crypto.randomUUID(),
        payload: {},
      }),
    { buildId: buildIds[0] },
  );
  assert.equal(result.tabMatches, true);
  assert.equal(typeof result.frameId, "string");
  assert.equal(result.loaderIdPresent, true);
  assert.equal(result.documentIdPresent, true);
  assert.equal(result.scriptedFrameId, 0);
  assert.equal(
    result.scriptedUrl,
    "https://flow.google.com/project/fixture-health",
  );
  assert.equal(ping.ok, true);
  assert.equal(ping.buildId, buildIds[0]);
  await extensionPage.evaluate(
    (targetId) => chrome.debugger.detach({ tabId: targetId }),
    tabId,
  );
  attached = false;

  const promptBody = '{"health_fixture":true}';
  const promptHash = await extensionPage.evaluate(async (body) => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(body),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }, promptBody);
  const attemptId = "86e721b7-7cc9-4c1d-a476-f2fc2d30f9ec";
  await extensionPage.evaluate(
    async ({
      attemptId,
      tabId,
      frameId,
      loaderId,
      documentId,
      buildId,
      promptBody,
      promptHash,
    }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("automat-faceless-app-v1");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const snapshotId = "health-fixture-snapshot";
      const canonicalTarget = "https://flow.google.com/project/fixture-health";
      const promptCodeUnits = promptBody.length;
      const promptUtf8Bytes = new TextEncoder().encode(promptBody).byteLength;
      const tx = database.transaction(
        ["selectedTargets", "flowImageAttempts", "flowImagePromptSnapshots"],
        "readwrite",
      );
      tx.objectStore("selectedTargets").put({
        provider: "Flow",
        tabId,
        canonicalTarget,
        verification: "verified",
        connectionState: "verified",
        revision: 1,
        verificationBinding: {
          provider: "Flow",
          tabId,
          canonicalTarget,
          projectId: "fixture-health",
          documentId,
          extensionBuildId: buildId,
          connectorBuildId: buildId,
        },
      });
      tx.objectStore("flowImagePromptSnapshots").put({
        snapshotId,
        workspaceId: "health-fixture",
        batchId: "health-fixture-batch",
        itemId: "health-fixture-item",
        promptHash,
        promptCodeUnits,
        promptUtf8Bytes,
        rawJsonBody: promptBody,
        createdAt: Date.now(),
      });
      tx.objectStore("flowImageAttempts").put({
        attemptId,
        confirmationKey: "health-fixture-confirmation",
        workspaceId: "health-fixture",
        batchId: "health-fixture-batch",
        itemId: "health-fixture-item",
        promptHash,
        sourceSnapshotId: snapshotId,
        promptCodeUnits,
        promptUtf8Bytes,
        provider: "Flow",
        projectId: "fixture-health",
        tabId,
        frameId,
        loaderId,
        documentId,
        senderFrameId: 0,
        buildId,
        protocolVersion: 4,
        settingsConfirmation: {
          confirmationId: "health-fixture-confirmation",
          confirmedAt: Date.now(),
          userAttested: true,
          tabId,
          projectId: "fixture-health",
          canonicalTarget,
          declaredVariantCount: 2,
        },
        state: "uncertain",
        observationSession: {
          sessionId: crypto.randomUUID(),
          documentId,
          senderFrameId: 0,
          startedAt: Date.now() - 60_000,
          deadlineAt: Date.now() + 60_000,
          maxEvents: 8,
          profileSupport: "production_observation_only",
          status: "lost",
          lastSequence: 1,
          reconciliationCount: 0,
        },
        events: [],
        createdAt: Date.now() - 60_000,
        updatedAt: Date.now(),
      });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      database.close();
    },
    {
      attemptId,
      tabId,
      frameId: result.frameId,
      loaderId: result.loaderId,
      documentId: result.documentId,
      buildId: buildIds[0],
      promptBody,
      promptHash,
    },
  );

  const diagnosticSource = await readFile(
    path.join(root, "tools/diagnostics/flow-binding-health-readonly.js"),
    "utf8",
  );
  const extensionCdp = await context.newCDPSession(extensionPage);
  await extensionCdp.send("Runtime.evaluate", {
    expression: diagnosticSource,
    awaitPromise: true,
  });
  await extensionPage.waitForFunction(
    () => window.__FLOW_BINDING_HEALTH_READONLY_REPORT__?.status !== "running",
    undefined,
    { timeout: 60_000 },
  );
  const health = await extensionPage.evaluate(
    () => window.__FLOW_BINDING_HEALTH_READONLY_REPORT__,
  );
  if (health.status !== "complete") {
    console.log(
      JSON.stringify(
        {
          status: health.status,
          stopCode: health.stopCode ?? null,
          elapsedMs: health.elapsedMs,
          samples: health.samples.map((sample) => ({
            index: sample.index,
            operations: sample.operations,
            bindings: sample.bindings ?? null,
            liveTab: sample.liveTab ?? null,
            cdpFrame: sample.cdpFrame ?? null,
            browserDocument: sample.browserDocument ?? null,
          })),
          target: health.selectedTargetBinding,
          attempt: health.attemptBinding,
          sourceValidation: health.sourceValidation,
        },
        null,
        2,
      ),
    );
  }
  assert.equal(health.status, "complete");
  assert.ok(health.elapsedMs >= 45_000 && health.elapsedMs <= 60_000);
  assert.ok(health.samples.length >= 30);
  assert.equal(health.sourceValidation.initialStatus, "match");
  assert.equal(health.attemptBinding.extensionBuildMatchesAttempt, true);
  assert.equal(health.continuity.browserDocumentStable, true);
  assert.equal(health.continuity.loaderStable, true);
  const healthFrameTreeSampled = health.samples.some((sample) =>
    sample.operations.some(
      (operation) =>
        operation.operation === "debugger_page_get_frame_tree" &&
        operation.status === "ok",
    ),
  );
  const safelySkippedExistingDebugger = health.samples.some((sample) =>
    sample.operations.some(
      (operation) =>
        operation.operation === "debugger_page_get_frame_tree" &&
        operation.status === "skipped" &&
        [
          "debugger_owned_elsewhere",
          "active_producer_owns_tab",
          "debugger_not_owned_by_diagnostic",
        ].includes(operation.code),
    ),
  );
  assert.ok(healthFrameTreeSampled || safelySkippedExistingDebugger);
  console.log(
    JSON.stringify(
      {
        status: "passed",
        test: "packaged_mv3_binding_health_local_synthetic_flow",
        extensionIdMasked: `extension-${extensionId.slice(0, 8)}`,
        buildId: buildIds[0],
        tabInspection: result.tabMatches,
        frameTree: "received",
        scriptingDocumentId: "received",
        runtimePing: ping.ok ? "ready" : "failed",
        healthDurationMs: health.elapsedMs,
        healthSamples: health.samples.length,
        healthFinalStatus: health.status,
        sourceHashValidation: health.sourceValidation.initialStatus,
        documentContinuity: health.continuity.browserDocumentStable,
        loaderContinuity: health.continuity.loaderStable,
        healthDebuggerMode: healthFrameTreeSampled
          ? "sampled"
          : "skipped_existing_debugger_owner",
        fixtureDataWrittenOnlyToTemporaryExtensionProfile: true,
        providerWasInterceptedLocally: true,
        providerInputSent: false,
        packagedExtensionOrUserProfileChanged: false,
      },
      null,
      2,
    ),
  );
} finally {
  if (attached && context && tabId !== undefined) {
    for (const page of context.pages()) {
      try {
        await page.evaluate(async (targetId) => {
          await chrome.debugger.detach({ tabId: targetId });
        }, tabId);
        break;
      } catch {
        // The extension page may already be closing; no other session is detached.
      }
    }
  }
  await context?.close();
  await rm(tempRoot, { recursive: true, force: true });
}
