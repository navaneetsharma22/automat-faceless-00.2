/**
 * @file imageQueueInspection.test.ts
 *
 * REGRESSION SUITE: imageQueue.inspectReadback with production adapter
 *
 * DISTINCTION OF TEST ENVIRONMENTS:
 * 1. Mocked test boundary (this file):
 *    Runs in Vitest / Node.js with mocked Chrome APIs (chrome.debugger, chrome.tabs, chrome.runtime).
 *    Verifies the real message handler (createConnectionMessageListener), the production port adapter
 *    (createChromeFlowImageGenerateOncePort), standalone debugger lease acquisition and release,
 *    and bounded error stage/classification mapping.
 *
 * 2. Installed-MV3 verification boundary:
 *    Requires manual or end-to-end verification in a real Chrome browser instance with the packaged extension,
 *    live tabs, active Chrome DevTools Protocol attachment, and the extension service worker lifecycle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import {
  createFoundationClient,
  FoundationClientError,
} from "../../src/shared/messageClient";
import { createChromeFlowImageGenerateOncePort } from "../../src/background/handlers/flow";
import { inspectFlowEditorAgainstQueueItem } from "../../src/background/generationQueue";
import { ChromePreferenceRepository } from "../../src/storage/repositories";

describe("imageQueue.inspectReadback with real message handler and production adapter", () => {
  const extensionId = "test-extension-inspection";
  const tabId = 42;
  const canonicalTarget =
    "https://flow.google.com/project/test-project-inspection";
  const projectId = "test-project-inspection";
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
              title: "Flow inspection project",
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

  async function createFixture() {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 1_000);
    const preferences = new ChromePreferenceRepository({
      get: async () => ({}),
      set: async () => undefined,
    });

    // Prompt source with Shot 10 and Shot 11
    const prompt10 = JSON.stringify({ shot_id: "10", prompt: "first shot" });
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
        documentId: "doc-inspection-1",
        documentToken: "tok-inspection-1",
        extensionBuildId: "build-test",
        extensionProtocolVersion: 1,
        connectorBuildId: "build-test",
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: 1_000,
      },
    });

    const queue = await repositories.createTimedImageSubmissionQueue({
      workspaceId: "default",
      queueId,
      settingsConfirmation: {
        confirmationId: "conf-1",
        confirmedAt: 1_000,
        tabId,
        projectId,
        canonicalTarget,
        declaredVariantCount: 1,
      },
    });

    // Mark Shot 10 as sent
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

    // Mark Shot 11 as blocked (order 1) after 40,000ms deadline
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
    });

    // Real message handler with production adapter wiring
    const listener = createConnectionMessageListener(extensionId, {
      repositories,
      preferences,
      inspectTimedQueueItemReadback: (qId, order) =>
        inspectFlowEditorAgainstQueueItem({
          repositories,
          queueId: qId,
          order,
        }),
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

    return { repositories, queue: blockedQueue!, prompt10, prompt11, client };
  }

  it("acquires and releases its own debugger lease when no prior dispatch lease is active", async () => {
    const { repositories, queue, prompt11, client } = await createFixture();

    // 1. Simulate prior dispatch cleanup:
    // A dispatch operation previously acquired a lease, and in its finally block released it.
    const productionPort = createChromeFlowImageGenerateOncePort(repositories);
    const dispatchLease = await productionPort.acquireDebuggerLease(
      tabId,
      `timed-image-queue:${queue.queueId}:1`,
    );
    expect(attachedTargets.has(tabId)).toBe(true);
    await productionPort.releaseDebuggerLease(dispatchLease);

    // Verify dispatch cleanup left no debugger lease active
    expect(attachedTargets.has(tabId)).toBe(false);
    expect(
      productionPort.getDebuggerLeaseForOwner(
        tabId,
        `timed-image-queue:${queue.queueId}:1`,
      ),
    ).toBeUndefined();

    // Set editor text in Flow composer to prompt 11 with an extra trailing space
    editorTextInBrowser = `${prompt11} `;

    // 2. Execute read-only inspection through real message handler
    const result = (await client.request("imageQueue.inspectReadback", {
      queueId: queue.queueId,
      order: 1,
    })) as import("../../src/domain/jobs/queue").FlowEditorReadbackInspectionResult;

    // 3. Verify inspection results
    expect(result.queueId).toBe(queue.queueId);
    expect(result.order).toBe(1);
    expect(result.shotId).toBe("11");
    expect(result.stage).toBe("read_only_editor_inspection");
    expect(result.equal).toBe(false);
    expect(result.expectedCodeUnits).toBe(prompt11.length);
    expect(result.actualCodeUnits).toBe(editorTextInBrowser.length);
    expect(result.mismatchCategory).toBe("length");

    // 4. Verify standalone lease lifecycle:
    // - attach was called for standalone inspection
    // - detach was called in finally
    expect(attachMock).toHaveBeenCalledTimes(2); // 1 for prior dispatch, 1 for inspect
    expect(detachMock).toHaveBeenCalledTimes(2); // 1 for dispatch cleanup, 1 for inspect cleanup
    expect(attachedTargets.has(tabId)).toBe(false);
  });

  it("returns bounded failure stage and error classification when debugger lease cannot be acquired", async () => {
    const { queue, client } = await createFixture();

    // Make chrome.debugger.attach fail (e.g. another debugger is attached or user cancelled)
    attachMock.mockRejectedValueOnce(
      new Error("Another debugger is already attached"),
    );

    let errorCaught: unknown;
    try {
      await client.request("imageQueue.inspectReadback", {
        queueId: queue.queueId,
        order: 1,
      });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeInstanceOf(FoundationClientError);
    const clientErr = errorCaught as FoundationClientError;
    // Bounded failure stage: "debugger_lease"
    expect(clientErr.stage).toBe("debugger_lease");
    // Error classification: "debugger_lease_acquisition_failed"
    expect(clientErr.code).toBe("debugger_lease_acquisition_failed");
    // Category: "worker_error"
    expect(clientErr.category).toBe("worker_error");
    // Message does not expose raw internal error message or stack trace
    expect(clientErr.message).not.toContain("Another debugger");
    expect(clientErr.message).toBe(
      "Debugger lease could not be acquired for read-only inspection.",
    );
  });

  it("returns bounded failure stage and error classification when target project verification fails", async () => {
    const { repositories, queue, client } = await createFixture();

    // Simulate target project mismatch (user navigated or changed project)
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId,
      canonicalTarget: "https://flow.google.com/project/different-project",
    });

    let errorCaught: unknown;
    try {
      await client.request("imageQueue.inspectReadback", {
        queueId: queue.queueId,
        order: 1,
      });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeInstanceOf(FoundationClientError);
    const clientErr = errorCaught as FoundationClientError;
    // Bounded failure stage: "target_verification"
    expect(clientErr.stage).toBe("target_verification");
    // Error classification: "selected_project_or_connection_changed"
    expect(clientErr.code).toBe("selected_project_or_connection_changed");
    expect(clientErr.category).toBe("invalid_request");
    expect(clientErr.message).not.toContain("different-project");
  });

  it("returns bounded failure stage and error classification when target tab is closed", async () => {
    const { queue, client } = await createFixture();

    // Make chrome.tabs.get reject (tab closed)
    const mockTabs = (
      globalThis as unknown as {
        chrome: { tabs: { get: ReturnType<typeof vi.fn> } };
      }
    ).chrome.tabs;
    mockTabs.get.mockRejectedValueOnce(new Error("No tab with id: 42"));

    let errorCaught: unknown;
    try {
      await client.request("imageQueue.inspectReadback", {
        queueId: queue.queueId,
        order: 1,
      });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeInstanceOf(FoundationClientError);
    const clientErr = errorCaught as FoundationClientError;
    expect(clientErr.stage).toBe("target_verification");
    expect(clientErr.code).toBe("selected_target_unavailable");
    expect(clientErr.category).toBe("invalid_request");
    expect(clientErr.message).toBe(
      "The target browser tab is closed or unavailable.",
    );
  });

  it("does not mutate queue state, insert text, or activate Generate during read-only inspection", async () => {
    const { repositories, queue, prompt11, client } = await createFixture();

    editorTextInBrowser = prompt11;

    const revisionBefore = queue.revision;
    const itemBefore = queue.items[1]!;

    await client.request("imageQueue.inspectReadback", {
      queueId: queue.queueId,
      order: 1,
    });

    const queueAfter = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(queueAfter?.revision).toBe(revisionBefore);
    expect(queueAfter?.state).toBe("blocked");
    expect(queueAfter?.items[1]?.itemState).toBe("blocked");
    expect(queueAfter?.items[1]?.blockReason).toBe(itemBefore.blockReason);
    expect(queueAfter?.items[1]?.dispatchReceipt).toBeUndefined();

    // Ensure no CDP Input commands were sent
    const methodCalls = sendCommandMock.mock.calls.map((c) => c[1]);
    expect(methodCalls).not.toContain("Input.dispatchMouseEvent");
    expect(methodCalls).not.toContain("Input.insertText");
  });
});
