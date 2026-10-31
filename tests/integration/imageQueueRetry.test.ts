/**
 * @file imageQueueRetry.test.ts
 *
 * REGRESSION SUITE: imageQueue.retryBlocked (guarded continuation)
 *
 * Checks that an explicit guarded continuation safely retries ONLY
 * the pre-activation-blocked Shot 11:
 * - Requires durable proof of no activation authorization
 * - Requires durable proof of no receipt or uncertain dispatch
 * - Requires unchanged source, project binding, and document ID
 * - Requires a fresh exact check against the active editor
 * - Refuses incompatible states (receipt exists, activation started, hash mismatch, changed target)
 * - Strictly preserves Shot 10's receipt and historical diagnostic evidence
 * - Does not skip Shot 11, clear locks, automatically resume, or perform live Generate
 * - Keeps the 40-second scheduler interval unchanged
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExtensionRepositories,
  ChromePreferenceRepository,
  sha256Hex,
} from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import { createFoundationClient } from "../../src/shared/messageClient";
import {
  ImageQueueInspectionError,
  inspectFlowEditorAgainstQueueItem,
} from "../../src/background/generationQueue";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";

describe("imageQueue.retryBlocked (explicit guarded continuation)", () => {
  const extensionId = "test-extension-retry";
  const tabId = 42;
  const canonicalTarget = "https://flow.google.com/project/test-project-retry";
  const projectId = "test-project-retry";
  const queueId = "4cad6e62-e5bc-4892-8de6-d909772b7530";

  let attachedTargets: Set<number>;
  let sendCommandMock: ReturnType<typeof vi.fn>;
  let attachMock: ReturnType<typeof vi.fn>;
  let detachMock: ReturnType<typeof vi.fn>;
  let editorTextInBrowser: string;

  beforeEach(() => {
    attachedTargets = new Set();
    editorTextInBrowser = "";

    attachMock = vi.fn(async ({ tabId: targetTabId }: { tabId: number }) => {
      attachedTargets.add(targetTabId);
    });

    detachMock = vi.fn(async ({ tabId: targetTabId }: { tabId: number }) => {
      attachedTargets.delete(targetTabId);
    });

    sendCommandMock = vi.fn(
      async ({ tabId: targetTabId }: { tabId: number }, method: string) => {
        if (!attachedTargets.has(targetTabId)) {
          throw new Error("Debugger is not attached to that target");
        }
        if (method === "Page.enable") {
          return {};
        }
        if (method === "Runtime.evaluate") {
          return {
            result: {
              value: {
                found: true,
                text: editorTextInBrowser,
              },
            },
          };
        }
        return {};
      },
    );

    const mockChrome = {
      runtime: { id: extensionId },
      tabs: {
        get: vi.fn(async (id: number) => {
          if (id === tabId) {
            return {
              id: tabId,
              title: "Flow retry project",
              url: canonicalTarget,
            };
          }
          throw new Error("tab_not_found");
        }),
      },
      permissions: {
        contains: vi.fn(async () => true),
      },
      debugger: {
        attach: attachMock,
        detach: detachMock,
        sendCommand: sendCommandMock,
        getTargets: vi.fn(async () =>
          Array.from(attachedTargets).map((t) => ({
            tabId: t,
            attached: true,
          })),
        ),
      },
    };

    vi.stubGlobal("chrome", mockChrome);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function createBlockedFixture() {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 1_000);
    const preferences = new ChromePreferenceRepository({
      get: async () => ({}),
      set: async () => undefined,
    });

    // Immutable prompt sources: Shot 10 and Shot 11
    const prompt10 = JSON.stringify({
      shot_id: "10",
      prompt: "first shot sent",
    });
    const prompt11 = JSON.stringify({
      shot_id: "11",
      prompt: "second shot blocked",
    });
    const sourceText = `10: ${prompt10}\n11: ${prompt11}`;

    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText,
    });

    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId,
      canonicalTarget,
    });

    const selected = await repositories.getSelectedTarget("Flow");
    await database.selectedTargets.put({
      ...selected!,
      verification: "verified",
      connectionState: "verified",
      verificationBinding: {
        provider: "Flow",
        tabId,
        canonicalTarget,
        projectId,
        frameId: 0,
        documentId: "doc-retry-1",
        documentToken: "tok-retry-1",
        extensionBuildId: BUILD_ID,
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: BUILD_ID,
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: 1_000,
      },
    });

    const queue = await repositories.createTimedImageSubmissionQueue({
      workspaceId: "default",
      queueId,
      settingsConfirmation: {
        confirmationId: "conf-retry-1",
        confirmedAt: 1_000,
        tabId,
        projectId,
        canonicalTarget,
        declaredVariantCount: 1,
      },
    });

    // Step 1: Shot 10 claimed and receipt stored at 1_000
    const claimed0 = await repositories.claimTimedImageQueueItem({
      queueId,
      expectedRevision: queue.revision,
      order: 0,
      attemptId: "attempt-10",
      at: 1_000,
    });
    const receipt0 = await repositories.recordTimedImageQueueReceipt({
      queueId,
      expectedRevision: claimed0.revision,
      order: 0,
      attemptId: "attempt-10",
      recordedAt: 1_000,
    });

    // Step 2: Shot 11 claimed at 41_000 (after 40s deadline) and blocked at 41_100
    const claimed1 = await repositories.claimTimedImageQueueItem({
      queueId,
      expectedRevision: receipt0.revision,
      order: 1,
      attemptId: "attempt-11",
      at: 41_000,
    });
    const blockedQueue = await repositories.blockTimedImageQueue({
      queueId,
      expectedRevision: claimed1.revision,
      order: 1,
      at: 41_100,
      uncertain: false,
      reason: "editor_exact_readback_mismatch",
      diagnostic: {
        queueId,
        queueItemId: claimed1.items[1]!.queueItemId,
        order: 1,
        shotId: "11",
        stage: "pre_activation_inspection",
        recordedAt: 41_100,
        expectedCodeUnits: prompt11.length,
        actualCodeUnits: prompt11.length + 1,
        expectedUtf8Bytes: prompt11.length,
        actualUtf8Bytes: prompt11.length + 1,
        expectedSha256: claimed1.items[1]!.promptHash,
        actualSha256: "c".repeat(64),
        firstDifferenceOffset: prompt11.length,
        mismatchCategory: "length",
      },
    });

    // Message handler wiring with fresh exact check and retry
    const listener = createConnectionMessageListener(extensionId, {
      repositories,
      preferences,
      inspectTimedQueueItemReadback: (qId, order) =>
        inspectFlowEditorAgainstQueueItem({
          repositories,
          queueId: qId,
          order,
        }),
      retryBlockedImageQueueItem: async (qId, expectedRevision, order) => {
        const inspection = await inspectFlowEditorAgainstQueueItem({
          repositories,
          queueId: qId,
          order,
        });
        if (!inspection.equal || !inspection.actualSha256) {
          throw new ImageQueueInspectionError(
            "editor_readback",
            "fresh_exact_check_failed",
            "The live Flow editor does not exactly match the saved prompt.",
            "invalid_request",
          );
        }
        return await repositories.retryBlockedTimedImageQueueItem({
          queueId: qId,
          expectedRevision,
          order,
          at: 42_000,
          freshExactSha256: inspection.actualSha256,
        });
      },
    });

    const client = createFoundationClient({
      sendMessage: (request) =>
        new Promise((resolve) =>
          listener(
            request,
            {
              id: extensionId,
              url: `chrome-extension://${extensionId}/index.html`,
            },
            resolve,
          ),
        ),
    });

    return {
      database,
      repositories,
      queue: blockedQueue!,
      prompt10,
      prompt11,
      client,
    };
  }

  it("refuses guarded retry when live editor text does not match Shot 11 prompt", async () => {
    const { queue, client } = await createBlockedFixture();

    // Editor in browser has different text
    editorTextInBrowser = '{"shot_id":"11","prompt":"different text"}';

    await expect(
      client.request("imageQueue.retryBlocked", {
        queueId: queue.queueId,
        expectedRevision: queue.revision,
        order: 1,
      }),
    ).rejects.toThrow(
      "The live Flow editor does not exactly match the saved prompt.",
    );
  });

  it("refuses guarded retry when activation was previously authorized (uncertain replay prohibited)", async () => {
    const { database, queue, prompt11, repositories } =
      await createBlockedFixture();

    // Corrupt item state to simulate uncertain activation authorization
    const corruptedQueue = {
      ...queue,
      items: queue.items.map((item, idx) =>
        idx === 1
          ? {
              ...item,
              providerOutcome: "unknown" as const,
              dispatchIntent: {
                attemptId: "attempt-11",
                recordedAt: 41_000,
                activationStartedAt: 41_050,
              },
            }
          : item,
      ),
    };
    await database.imageSubmissionQueues.put(corruptedQueue);

    const hash = await sha256Hex(prompt11);
    await expect(
      repositories.retryBlockedTimedImageQueueItem({
        queueId: queue.queueId,
        expectedRevision: corruptedQueue.revision,
        order: 1,
        at: 42_000,
        freshExactSha256: hash,
      }),
    ).rejects.toMatchObject({ code: "incompatible_activation_state" });
  });

  it("refuses guarded retry when Shot 11 already has a receipt or is already sent", async () => {
    const { database, queue, prompt11, repositories } =
      await createBlockedFixture();

    const alreadySentQueue = {
      ...queue,
      state: "blocked" as const,
      lastDispatchReceiptStoredAt: 41_100,
      nextEligibleDispatchAt: null,
      items: queue.items.map((item, idx) =>
        idx === 1
          ? {
              ...item,
              itemState: "sent" as const,
              providerOutcome: "unknown" as const,
              dispatchReceipt: {
                attemptId: "attempt-11",
                storedAt: 41_100,
                evidence: "activation_pair_sent_or_uncertain" as const,
              },
            }
          : item,
      ),
    };
    await database.imageSubmissionQueues.put(alreadySentQueue);

    const hash = await sha256Hex(prompt11);
    await expect(
      repositories.retryBlockedTimedImageQueueItem({
        queueId: queue.queueId,
        expectedRevision: alreadySentQueue.revision,
        order: 1,
        at: 42_000,
        freshExactSha256: hash,
      }),
    ).rejects.toMatchObject({ code: "item_not_blocked" });
  });

  it("refuses guarded retry when selected target or document changed", async () => {
    const { database, queue, prompt11, repositories } =
      await createBlockedFixture();

    // Invalidate target verification
    const selected = await repositories.getSelectedTarget("Flow");
    await database.selectedTargets.put({
      ...selected!,
      verification: "unverified",
      connectionState: "disconnected",
    });

    const hash = await sha256Hex(prompt11);
    await expect(
      repositories.retryBlockedTimedImageQueueItem({
        queueId: queue.queueId,
        expectedRevision: queue.revision,
        order: 1,
        at: 42_000,
        freshExactSha256: hash,
      }),
    ).rejects.toMatchObject({ code: "selected_project_or_document_changed" });
  });

  it("refuses guarded retry when revision does not match", async () => {
    const { queue, prompt11, repositories } = await createBlockedFixture();
    const hash = await sha256Hex(prompt11);

    await expect(
      repositories.retryBlockedTimedImageQueueItem({
        queueId: queue.queueId,
        expectedRevision: queue.revision + 99,
        order: 1,
        at: 42_000,
        freshExactSha256: hash,
      }),
    ).rejects.toMatchObject({ code: "queue_revision_changed" });
  });

  it("safely retries ONLY Shot 11 when live inspection confirms exact match", async () => {
    const { queue, prompt11, client, repositories } =
      await createBlockedFixture();

    // Set browser editor text to exactly match immutable saved prompt for Shot 11
    editorTextInBrowser = prompt11;

    // Execute guarded retry via message client
    const updated = (await client.request("imageQueue.retryBlocked", {
      queueId: queue.queueId,
      expectedRevision: queue.revision,
      order: 1,
    })) as typeof queue;

    // 1. Queue is unblocked into paused state (does NOT automatically resume or run Generate)
    expect(updated.state).toBe("paused");
    expect(updated.pauseReason).toBe("guarded_retry_ready");
    expect(updated.revision).toBe(queue.revision + 1);

    // 2. Shot 10 receipt is strictly preserved
    const shot10 = updated.items[0]!;
    expect(shot10.itemState).toBe("sent");
    expect(shot10.providerOutcome).toBe("unknown");
    expect(shot10.dispatchReceipt).toEqual({
      attemptId: "attempt-10",
      storedAt: 1_000,
      evidence: "activation_pair_sent_or_uncertain",
    });

    // 3. Shot 11 is restored to pending with no activation authorization or intent
    const shot11 = updated.items[1]!;
    expect(shot11.itemState).toBe("pending");
    expect(shot11.providerOutcome).toBe("not_started");
    expect(shot11.blockReason).toBeUndefined();
    expect(shot11.dispatchIntent).toBeUndefined();
    expect(shot11.dispatchReceipt).toBeUndefined();

    // 4. Historical diagnostic evidence from original block is preserved on Shot 11
    expect(shot11.readbackDiagnostic).toBeDefined();
    expect(shot11.readbackDiagnostic?.stage).toBe("pre_activation_inspection");
    expect(shot11.readbackDiagnostic?.mismatchCategory).toBe("length");

    // 5. 40-second scheduler interval from Shot 10's receipt is preserved
    expect(updated.lastDispatchReceiptStoredAt).toBe(1_000);
    expect(updated.nextEligibleDispatchAt).toBe(1_000 + 40_000); // 41_000

    // 6. Durable readback verification in database
    const readback = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(readback).toEqual(updated);
  });
});
