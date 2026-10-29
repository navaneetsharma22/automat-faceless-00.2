import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const diagnosticPath = resolve(
  process.cwd(),
  "tools/diagnostics/flow-observation-readonly.js",
);

test("dashboard inspection exports the durable arm receipt and structural evidence read-only", async ({
  page,
}) => {
  const attemptId = "fixture-attempt-id";
  const sessionId = "d7a5ea61-9721-4a65-8485-798f2f4e0c11";
  const candidateId = "a".repeat(64);
  const record = {
    attemptId,
    state: "dispatched",
    workspaceId: "default",
    batchId: "import:default:image",
    itemId: "fixture-item",
    shotId: "02",
    promptHash: "b".repeat(64),
    sourceSnapshotId: `flow-image-source:fixture-item:${"b".repeat(64)}`,
    promptCodeUnits: 100,
    projectId: "fixture-private-project",
    tabId: 41,
    frameId: "frame-fixture",
    loaderId: "fixture-private-loader",
    documentId: "fixture-private-document",
    senderFrameId: 0,
    buildId: "automat-faceless-0.1.0-fixture",
    protocolVersion: 4,
    settingsConfirmation: {
      confirmationId: "fixture-confirmation",
      projectId: "fixture-private-project",
      tabId: 41,
      declaredVariantCount: 2,
    },
    observationSession: {
      sessionId,
      status: "active",
      profileSupport: "production_observation_only",
      startedAt: 100,
      deadlineAt: 200,
      maxEvents: 64,
      lastSequence: 1,
      reconciliationCount: 0,
      armReceipt: {
        capturedAt: 101,
        sourceBaselineFingerprint: "b".repeat(64),
        captureFingerprint: "c".repeat(64),
        listenerRootCount: 1,
        baseline: {
          completeForRenderedScope: true,
          virtualized: true,
          tileCount: 0,
          mediaCandidateCount: 0,
          identityCandidateCount: 0,
          unidentifiedImageCount: 0,
          lifecycleSignalCount: 0,
          resourceEventCount: 0,
          captureGaps: [],
        },
      },
    },
    events: [
      { stage: "observer", at: 101, method: "none", code: "observer_armed" },
    ],
    observationReceipts: [
      {
        observationId: "00000000-0000-4000-8000-000000000001",
        sequence: 1,
        fingerprint: "d".repeat(64),
        receivedAt: 102,
      },
    ],
    structuralObservations: [
      {
        kind: "structural_snapshot",
        attemptId,
        sessionId,
        observationId: "00000000-0000-4000-8000-000000000001",
        sequence: 1,
        observedAt: 102,
        sourceBaselineFingerprint: "e".repeat(64),
        captureFingerprint: "f".repeat(64),
        snapshot: {
          completeForRenderedScope: true,
          virtualized: true,
          unidentifiedImageCount: 0,
          identityCandidatesTruncated: false,
          captureGaps: [],
          tiles: [
            { tileToken: "tile-1", tag: "flow-image-tile", visible: true },
          ],
          mediaCandidates: [
            {
              candidateId,
              mediaToken: "media-1",
              tileToken: "tile-1",
              visible: true,
              complete: true,
              naturalWidth: 1376,
              naturalHeight: 768,
            },
          ],
          identityCandidates: [
            {
              carrierToken: "media-1",
              carrierTag: "img",
              carrierRelation: "descendant",
              attributeName: "data-media-id",
              category: "provider_asset_identity_candidate_unverified",
              candidateId,
            },
          ],
          lifecycleSignals: [
            {
              markerToken: "marker-1",
              markerTag: "div",
              markerKind: "loading",
              scope: "tile",
              tileToken: "tile-1",
              visible: true,
              evidence: [{ attributeName: "data-state", signal: "loading" }],
            },
          ],
          resourceEvents: [
            {
              mediaToken: "media-1",
              tileToken: "tile-1",
              type: "load",
              complete: true,
              naturalWidth: 1376,
              naturalHeight: 768,
            },
          ],
        },
      },
    ],
    resultLinks: [],
    resultOutcome: {
      status: "unknown",
      reason: "ownership_ambiguous",
      observedSucceededCount: 0,
      observedFailedCount: 0,
      updatedAt: 102,
    },
    rawJsonBody: "private prompt body must never be exported",
  };
  await page.route("https://dashboard.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html></html>",
    }),
  );
  await page.goto("https://dashboard.test/");
  await page.evaluate(async (attempt) => {
    const request = indexedDB.open("automat-faceless-app-v1", 5);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore("flowImageAttempts", {
          keyPath: "attemptId",
        });
        request.result.createObjectStore("promptItems", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        ["flowImageAttempts", "promptItems"],
        "readwrite",
      );
      transaction.objectStore("flowImageAttempts").put(attempt);
      transaction.objectStore("promptItems").put({
        id: "fixture-item",
        rawJsonBody: "private prompt body must never be exported",
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, record);
  const script = (await readFile(diagnosticPath, "utf8")).replace(
    'const attemptId = "PASTE_ATTEMPT_ID_HERE";',
    `const attemptId = "${attemptId}";`,
  );
  await page.evaluate((source) => (0, eval)(source), script);
  await page.waitForFunction(
    () =>
      (
        window as Window & {
          __FLOW_P053_OBSERVATION_INSPECTION__?: { status?: string };
        }
      ).__FLOW_P053_OBSERVATION_INSPECTION__?.status === "complete",
  );
  const exported = await page.evaluate(
    () =>
      (window as Window & { __FLOW_P053_OBSERVATION_INSPECTION__?: unknown })
        .__FLOW_P053_OBSERVATION_INSPECTION__,
  );
  const json = JSON.stringify(exported);
  expect(json).toContain('"transactionMode":"readonly"');
  expect(json).toContain('"captureFingerprint":"cccccccc');
  expect(json).toContain('"attributeName":"data-state"');
  expect(json).toContain(`"candidateHash":"${candidateId}"`);
  expect(json).toContain('"status":"unknown"');
  expect(json).not.toContain("private prompt body");
  expect(json).not.toContain("fixture-private-project");
  expect(json).not.toContain("fixture-private-document");
  expect(json).not.toContain("fixture-private-loader");
  const readonly = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("automat-faceless-app-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(["flowImageAttempts"], "readonly");
    const value = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const request = tx.objectStore("flowImageAttempts").get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    db.close();
    return value.resultOutcome;
  }, attemptId);
  expect(readonly).toMatchObject({
    status: "unknown",
    reason: "ownership_ambiguous",
  });
});
