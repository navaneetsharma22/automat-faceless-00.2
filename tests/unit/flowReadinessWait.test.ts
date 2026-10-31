import { describe, expect, it } from "vitest";
import {
  createFlowTimedQueueDispatcher,
  type FlowTimedDispatchEnvironment,
} from "../../src/background/generationQueue";
import {
  createTimedImageQueueScheduler,
  IMAGE_QUEUE_ALARM_PREFIX,
} from "../../src/background/scheduler";
import {
  ExtensionRepositories,
  sha256Hex,
} from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import type { FlowImageGenerateOncePort } from "../../src/platforms/flow/images";
import type { FlowPromptEntryPort } from "../../src/platforms/flow/promptEntry";

const promptShot14 = JSON.stringify({
  shot_id: "14",
  scene_title: "Shot 14 Production Scene",
  prompt: "B".repeat(3840),
});

describe("bounded pre-activation readiness waiting", () => {
  async function createTestQueueFixture() {
    const database = createMemoryRepositoryDatabase();
    let clock = 10_000;
    const repositories = new ExtensionRepositories(database, () => clock);
    const promptHash = await sha256Hex(promptShot14);

    await repositories.savePromptBatch({
      workspaceId: "test-ws",
      kind: "image",
      sourceText: `14: ${promptShot14}`,
    });

    const target = {
      provider: "Flow" as const,
      tabId: 42,
      canonicalTarget: "https://flow.google.com/project/shot-14-test",
    };
    await repositories.recordSelectedTarget(target);
    const selected = await repositories.getSelectedTarget("Flow");
    await database.selectedTargets.put({
      ...selected!,
      verification: "verified",
      connectionState: "verified",
      reconnectEnabled: true,
      verificationBinding: {
        provider: "Flow",
        tabId: 42,
        canonicalTarget: target.canonicalTarget,
        projectId: "shot-14-test",
        frameId: 0,
        documentId: "doc-shot-14",
        documentToken: "token-shot-14",
        extensionBuildId: BUILD_ID,
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: BUILD_ID,
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: 900,
      },
    });

    const queue = await repositories.createTimedImageSubmissionQueue({
      workspaceId: "test-ws",
      queueId: "4cad6e62-e5bc-4892-8de6-d909772b7530",
      settingsConfirmation: {
        confirmationId: "conf-14",
        confirmedAt: 900,
        tabId: 42,
        projectId: "shot-14-test",
        canonicalTarget: target.canonicalTarget,
        declaredVariantCount: 1,
      },
    });

    return {
      database,
      repositories,
      queue,
      clock: (val?: number) => (val !== undefined ? (clock = val) : clock),
      promptHash,
    };
  }

  function createMockEnvironment(options: {
    initialGenerateState: "identified" | "disabled";
    enableAfterChecks?: number;
    buttonOwnershipFailsOnEnable?: boolean;
    frameChangesOnCheck?: number;
    textChangesOnCheck?: number;
  }): {
    environment: FlowTimedDispatchEnvironment;
    mouseEventsSent: Array<{ type: string; x: number; y: number }>;
    checkCount: () => number;
  } {
    const mouseEventsSent: Array<{ type: string; x: number; y: number }> = [];
    let inspectCheckCount = 0;
    let editorCurrentText = "";

    const promptPort: FlowPromptEntryPort = {
      getSelection: async () => ({
        tabId: 42,
        canonicalTarget: "https://flow.google.com/project/shot-14-test",
      }),
      getTab: async () => ({
        id: 42,
        title: "Flow Shot 14",
        url: "https://flow.google.com/project/shot-14-test",
      }),
      hasRequiredApis: () => true,
      hasDebuggerPermission: async () => true,
      attach: async () => undefined,
      detach: async () => undefined,
      sendCommand: async () => ({}),
    };

    const pagePort: FlowImageGenerateOncePort = {
      ...promptPort,
      acquireDebuggerLease: async (tabId: number) => ({
        tabId,
        token: Symbol("lease-shot-14"),
      }),
      releaseDebuggerLease: async () => undefined,
      readFrame: async () => {
        if (
          options.frameChangesOnCheck &&
          inspectCheckCount >= options.frameChangesOnCheck
        ) {
          return {
            frameId: "top-frame",
            loaderId: "loader-14",
            url: "https://flow.google.com/project/changed-project",
            documentId: "doc-changed",
            senderFrameId: 0,
          };
        }
        return {
          frameId: "top-frame",
          loaderId: "loader-14",
          url: "https://flow.google.com/project/shot-14-test",
          documentId: "doc-shot-14",
          senderFrameId: 0,
        };
      },
      captureFrame: async () => {
        throw new Error("not_used");
      },
      inspectGenerate: async () => {
        throw new Error("not_used");
      },
      recheckGenerate: async () => false,
      buttonPosition: async () => undefined,
      activate: async () => ({
        complete: false,
        pressAttempted: false,
        releaseAttempted: false,
      }),
      startObservation: async () => {
        throw new Error("not_used");
      },
      stopObservation: async () => undefined,
      activateObservation: async () => {
        throw new Error("not_used");
      },
      resumeObservation: async () => {
        throw new Error("not_used");
      },
      sendCommand: async (_tabId, method, params) => {
        if (method === "Page.enable" || method === "Runtime.enable") {
          return {};
        }
        if (method === "Page.getFrameTree") {
          return {
            frameTree: {
              frame: {
                id: "top-frame",
                loaderId: "loader-14",
                url: "https://flow.google.com/project/shot-14-test",
              },
            },
          };
        }
        if (method === "Input.insertText") {
          editorCurrentText = (params as { text: string }).text;
          return {};
        }
        if (method === "Runtime.evaluate") {
          const p = params as {
            expression?: string;
            returnByValue?: boolean;
          };
          if (p.expression?.includes("found: true")) {
            return {
              result: {
                value: {
                  found: true,
                  text: editorCurrentText,
                },
              },
            };
          }
          if (p.expression?.includes("flowComposerRuntime")) {
            if (p.returnByValue === false) {
              return {
                result: { objectId: "editor-node-14", subtype: "node" },
              };
            }
            return {
              result: {
                value: {
                  state: "empty",
                  candidateCount: 1,
                  editorKind: "contenteditable",
                  methodCompatible: true,
                },
              },
            };
          }
          return {
            result: {
              objectId: "wrapper-obj-readiness",
              type: "object",
            },
          };
        }
        if (method === "Runtime.callFunctionOn") {
          const p = params as {
            objectId?: string;
            functionDeclaration?: string;
          };
          if (p.functionDeclaration?.includes("this.focus()")) {
            return { result: { value: true } };
          }
          if (
            p.functionDeclaration?.includes("this.isConnected") &&
            p.objectId === "editor-node-14"
          ) {
            return {
              result: {
                value: {
                  connected: true,
                  text: editorCurrentText,
                },
              },
            };
          }
          // Reading button position via revalidateAndInspectButtonRuntime
          if (
            p.functionDeclaration?.includes("revalidateAndInspectButtonRuntime")
          ) {
            if (options.buttonOwnershipFailsOnEnable) {
              return { result: { value: null } };
            }
            return { result: { value: { x: 500, y: 300 } } };
          }
          // Reading payload from inspectTimedFlowGenerate
          if (
            p.functionDeclaration?.includes("hasButton:Boolean(this.button)")
          ) {
            inspectCheckCount++;
            if (
              options.textChangesOnCheck &&
              inspectCheckCount >= options.textChangesOnCheck
            ) {
              editorCurrentText = "Altered prompt text";
            }
            const isEnabled =
              options.initialGenerateState === "identified" ||
              (options.enableAfterChecks !== undefined &&
                inspectCheckCount >= options.enableAfterChecks);

            const isExact = editorCurrentText === promptShot14;
            return {
              result: {
                value: {
                  composer: "identified",
                  exactPrompt: isExact,
                  generate: isExact
                    ? isEnabled
                      ? "identified"
                      : "disabled"
                    : "disabled",
                  actualText: editorCurrentText,
                  hasButton: isExact && isEnabled,
                },
              },
            };
          }
          if (p.functionDeclaration?.includes("return this.button")) {
            return {
              result: {
                objectId: `button-handle-${inspectCheckCount}`,
                subtype: "node",
              },
            };
          }
          return {};
        }
        if (method === "Runtime.releaseObject") {
          return {};
        }
        if (method === "Input.dispatchMouseEvent") {
          const p = params as { type: string; x: number; y: number };
          mouseEventsSent.push({ type: p.type, x: p.x, y: p.y });
          return {};
        }
        return {};
      },
    };

    return {
      environment: {
        promptPort,
        pagePort,
        getTab: async () => ({
          id: 42,
          title: "Flow Shot 14",
          url: "https://flow.google.com/project/shot-14-test",
        }),
        getDocument: async () => ({
          frameId: 0,
          documentId: "doc-shot-14",
          result: "https://flow.google.com/project/shot-14-test",
        }),
        readinessTimeoutMs: 100,
        readinessInitialBackoffMs: 10,
        readinessMaxBackoffMs: 25,
        sleep: async () => {},
      },
      mouseEventsSent,
      checkCount: () => inspectCheckCount,
    };
  }

  function mockAlarms() {
    const entries = new Map<string, number>();
    return {
      entries,
      api: {
        create: (name: string, info: { when?: number }) => {
          entries.set(name, info.when ?? 0);
        },
        clear: async (name: string) => entries.delete(name),
      } as never,
    };
  }

  it("Delayed enablement: disabled button transitions to enabled, acquires fresh handle, and activates exactly once", async () => {
    const { repositories, queue, clock } = await createTestQueueFixture();
    const claimed = await repositories.claimTimedImageQueueItem({
      queueId: queue.queueId,
      expectedRevision: queue.revision,
      order: 0,
      attemptId: "attempt-delayed",
      at: clock(),
    });

    const { environment, mouseEventsSent, checkCount } = createMockEnvironment({
      initialGenerateState: "disabled",
      enableAfterChecks: 2, // Becomes enabled on check 2
    });

    let authorized = false;
    let currentRevision = claimed.revision;
    const dispatcher = createFlowTimedQueueDispatcher(
      repositories,
      () => clock(),
      environment,
    );

    const result = await dispatcher({
      queue: claimed,
      order: 0,
      attemptId: "attempt-delayed",
      authorizeActivation: async () => {
        authorized = true;
        const currentQueue = await repositories.getTimedImageSubmissionQueue(
          queue.queueId,
        );
        currentRevision = currentQueue!.revision;
        await repositories.markTimedImageQueueActivationStarted({
          queueId: queue.queueId,
          expectedRevision: currentRevision,
          order: 0,
          attemptId: "attempt-delayed",
          at: clock(),
        });
      },
    });

    expect(result.status).toBe("activated");
    expect(authorized).toBe(true);
    expect(mouseEventsSent).toHaveLength(2); // mousePressed + mouseReleased
    expect(checkCount()).toBeGreaterThanOrEqual(2);

    // Verify readiness state was persisted to Dexie before activation
    const finalQueue = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(
      finalQueue?.items[0]?.dispatchIntent?.readinessDeadlineAt,
    ).toBeDefined();
    expect(
      finalQueue?.items[0]?.dispatchIntent?.readinessStartedAt,
    ).toBeDefined();
  });

  it("Permanent disablement: persistently disabled button pauses queue with flow_generate_readiness_timeout after bounded deadline", async () => {
    const { repositories, queue, clock } = await createTestQueueFixture();
    const alarms = mockAlarms();

    const { environment, mouseEventsSent } = createMockEnvironment({
      initialGenerateState: "disabled",
      // Never enables
    });

    const scheduler = createTimedImageQueueScheduler({
      repositories,
      alarms: alarms.api,
      now: () => clock(),
      dispatch: createFlowTimedQueueDispatcher(
        repositories,
        () => clock(),
        environment,
      ),
    });

    const result = await scheduler.start(queue.queueId);

    expect(result.state).toBe("paused");
    expect(result.pauseReason).toBe("flow_generate_readiness_timeout");
    expect(mouseEventsSent).toHaveLength(0);
    expect(result.items[0]?.itemState).toBe("pending");
    expect(result.items[0]?.providerOutcome).toBe("not_started");
    expect(result.items[0]?.dispatchIntent).toBeUndefined();
    expect(alarms.entries.size).toBe(0);
  });

  it("Pause or Stop winning during readiness wait prevents subsequent activation authorization", async () => {
    const { repositories, queue, clock } = await createTestQueueFixture();
    const claimed = await repositories.claimTimedImageQueueItem({
      queueId: queue.queueId,
      expectedRevision: queue.revision,
      order: 0,
      attemptId: "attempt-pause-during-wait",
      at: clock(),
    });

    let pauseCalled = false;
    const { environment, mouseEventsSent } = createMockEnvironment({
      initialGenerateState: "disabled",
    });

    // Custom sleep that pauses the queue in the middle of readiness waiting
    environment.sleep = async () => {
      if (!pauseCalled) {
        pauseCalled = true;
        const current = await repositories.getTimedImageSubmissionQueue(
          queue.queueId,
        );
        await repositories.pauseTimedImageQueue({
          queueId: queue.queueId,
          expectedRevision: current!.revision,
          at: clock(),
          reason: "user_pause_during_readiness",
        });
      }
    };

    const dispatcher = createFlowTimedQueueDispatcher(
      repositories,
      () => clock(),
      environment,
    );

    const result = await dispatcher({
      queue: claimed,
      order: 0,
      attemptId: "attempt-pause-during-wait",
      authorizeActivation: async () => {
        throw new Error("Activation must never be authorized after pause");
      },
    });

    expect(result.status).toBe("paused");
    expect(result.reason).toBe("user_pause_during_readiness");
    expect(mouseEventsSent).toHaveLength(0);

    const readback = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(readback?.state).toBe("paused");
  });

  it("Worker restart during waiting: expired deadline pauses with timeout; unexpired deadline safely reverts to pending and reschedules without duplicate dispatch", async () => {
    const { repositories, queue, clock } = await createTestQueueFixture();
    const alarms = mockAlarms();

    // Setup an item in sending state with a readiness deadline
    const claimed = await repositories.claimTimedImageQueueItem({
      queueId: queue.queueId,
      expectedRevision: queue.revision,
      order: 0,
      attemptId: "attempt-restart",
      at: clock(),
    });

    await repositories.markTimedImageQueueWaitingForReadiness({
      queueId: queue.queueId,
      expectedRevision: claimed.revision,
      order: 0,
      attemptId: "attempt-restart",
      deadlineAt: 15_000,
      startedAt: 10_000,
    });

    // Scenario A: Worker restarts AFTER the readiness deadline has expired (clock = 20_000)
    clock(20_000);
    const schedulerA = createTimedImageQueueScheduler({
      repositories,
      alarms: alarms.api,
      now: () => clock(),
      dispatch: async () => ({ status: "activated", at: clock() }),
    });

    await schedulerA.reconcileStartup();
    const queueAfterTimeoutRestart =
      await repositories.getTimedImageSubmissionQueue(queue.queueId);
    expect(queueAfterTimeoutRestart?.state).toBe("paused");
    expect(queueAfterTimeoutRestart?.pauseReason).toBe(
      "flow_generate_readiness_timeout",
    );
    expect(queueAfterTimeoutRestart?.items[0]?.itemState).toBe("pending");

    // Scenario B: Worker restarts BEFORE the readiness deadline has expired (clock = 12_000)
    const resumedQueue = await repositories.resumeTimedImageQueue({
      queueId: queue.queueId,
      expectedRevision: queueAfterTimeoutRestart!.revision,
      at: clock(),
    });

    const claimedB = await repositories.claimTimedImageQueueItem({
      queueId: queue.queueId,
      expectedRevision: resumedQueue.revision,
      order: 0,
      attemptId: "attempt-restart-unexpired",
      at: clock(),
    });

    await repositories.markTimedImageQueueWaitingForReadiness({
      queueId: queue.queueId,
      expectedRevision: claimedB.revision,
      order: 0,
      attemptId: "attempt-restart-unexpired",
      deadlineAt: 30_000,
      startedAt: clock(),
    });

    clock(14_000); // 14_000 < 30_000
    let dispatchesB = 0;
    const schedulerB = createTimedImageQueueScheduler({
      repositories,
      alarms: alarms.api,
      now: () => clock(),
      dispatch: async ({ authorizeActivation }) => {
        dispatchesB++;
        await authorizeActivation();
        return { status: "activated", at: clock() };
      },
    });

    await schedulerB.reconcileStartup();
    expect(dispatchesB).toBe(1); // Safely resumed and dispatched once

    const finalQueueB = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(finalQueueB?.items[0]?.itemState).toBe("sent");
    expect(finalQueueB?.items[0]?.dispatchReceipt).toBeDefined();
  });

  it("Changed text, project, or button ownership safely refuses without activating", async () => {
    // 1. Changed text during readiness wait
    const fixture1 = await createTestQueueFixture();
    const claimed1 = await fixture1.repositories.claimTimedImageQueueItem({
      queueId: fixture1.queue.queueId,
      expectedRevision: fixture1.queue.revision,
      order: 0,
      attemptId: "attempt-changed-text",
      at: fixture1.clock(),
    });

    const envText = createMockEnvironment({
      initialGenerateState: "disabled",
      textChangesOnCheck: 2, // Text changes on check 2
    });

    const dispatcherText = createFlowTimedQueueDispatcher(
      fixture1.repositories,
      () => fixture1.clock(),
      envText.environment,
    );

    const resultText = await dispatcherText({
      queue: claimed1,
      order: 0,
      attemptId: "attempt-changed-text",
      authorizeActivation: async () => {},
    });

    expect(resultText.status).toBe("blocked");
    expect(resultText.reason).toBe("editor_exact_readback_mismatch");
    expect(envText.mouseEventsSent).toHaveLength(0);

    // 2. Changed project / frame binding during readiness wait
    const fixture2 = await createTestQueueFixture();
    const claimed2 = await fixture2.repositories.claimTimedImageQueueItem({
      queueId: fixture2.queue.queueId,
      expectedRevision: fixture2.queue.revision,
      order: 0,
      attemptId: "attempt-changed-frame",
      at: fixture2.clock(),
    });

    const envFrame = createMockEnvironment({
      initialGenerateState: "disabled",
      frameChangesOnCheck: 2, // Frame URL/doc changes on check 2
    });

    const dispatcherFrame = createFlowTimedQueueDispatcher(
      fixture2.repositories,
      () => fixture2.clock(),
      envFrame.environment,
    );

    const resultFrame = await dispatcherFrame({
      queue: claimed2,
      order: 0,
      attemptId: "attempt-changed-frame",
      authorizeActivation: async () => {},
    });

    expect(resultFrame.status).toBe("blocked");
    expect(resultFrame.reason).toBe("frame_binding_changed");
    expect(envFrame.mouseEventsSent).toHaveLength(0);

    // 3. Button ownership fails upon enablement
    const fixture3 = await createTestQueueFixture();
    const claimed3 = await fixture3.repositories.claimTimedImageQueueItem({
      queueId: fixture3.queue.queueId,
      expectedRevision: fixture3.queue.revision,
      order: 0,
      attemptId: "attempt-ownership-fail",
      at: fixture3.clock(),
    });

    const envOwnership = createMockEnvironment({
      initialGenerateState: "disabled",
      enableAfterChecks: 2,
      buttonOwnershipFailsOnEnable: true, // inspectFlowImageButton returns null
    });

    const dispatcherOwnership = createFlowTimedQueueDispatcher(
      fixture3.repositories,
      () => fixture3.clock(),
      envOwnership.environment,
    );

    const resultOwnership = await dispatcherOwnership({
      queue: claimed3,
      order: 0,
      attemptId: "attempt-ownership-fail",
      authorizeActivation: async () => {},
    });

    expect(resultOwnership.status).toBe("blocked");
    expect(resultOwnership.reason).toBe("generate_control_not_enabled");
    expect(envOwnership.mouseEventsSent).toHaveLength(0);
  });

  it("Guarded recovery path for existing blocked Shot 14 unblocks to pending without automatic migration", async () => {
    const { repositories, queue, clock, promptHash } =
      await createTestQueueFixture();
    const claimed = await repositories.claimTimedImageQueueItem({
      queueId: queue.queueId,
      expectedRevision: queue.revision,
      order: 0,
      attemptId: "attempt-shot-14-historic",
      at: clock(),
    });

    const blocked = await repositories.blockTimedImageQueue({
      queueId: queue.queueId,
      expectedRevision: claimed.revision,
      order: 0,
      at: clock(),
      uncertain: false,
      reason: "generate_disabled",
    });

    expect(blocked?.state).toBe("blocked");
    expect(blocked?.items[0]?.itemState).toBe("blocked");
    expect(blocked?.items[0]?.blockReason).toBe("generate_disabled");

    // The guarded recovery path: user runs inspectReadback, verifies matching prompt, then triggers retryBlockedTimedImageQueueItem
    const unblocked = await repositories.retryBlockedTimedImageQueueItem({
      queueId: queue.queueId,
      expectedRevision: blocked!.revision,
      order: 0,
      at: clock(),
      freshExactSha256: promptHash,
    });

    expect(unblocked.state).toBe("paused");
    expect(unblocked.pauseReason).toBe("guarded_retry_ready");
    expect(unblocked.items[0]?.itemState).toBe("pending");
    expect(unblocked.items[0]?.providerOutcome).toBe("not_started");
    expect(unblocked.items[0]?.dispatchIntent).toBeUndefined();
  });

  it("Duplicate wakeups: concurrent onAlarm triggers execute sequentially via serialized queue lock without duplicate dispatch", async () => {
    const { repositories, queue, clock } = await createTestQueueFixture();
    const alarms = mockAlarms();
    let dispatchCallCount = 0;

    const scheduler = createTimedImageQueueScheduler({
      repositories,
      alarms: alarms.api,
      now: () => clock(),
      dispatch: async ({ authorizeActivation }) => {
        dispatchCallCount++;
        await authorizeActivation();
        return { status: "activated", at: clock() };
      },
    });

    const alarmName = `${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`;

    // Fire duplicate wakeups concurrently
    await Promise.all([
      scheduler.onAlarm(alarmName),
      scheduler.onAlarm(alarmName),
    ]);

    expect(dispatchCallCount).toBe(1);
    const finalQueue = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(finalQueue?.items[0]?.itemState).toBe("sent");
    expect(finalQueue?.state).toBe("sent");
  });
});
