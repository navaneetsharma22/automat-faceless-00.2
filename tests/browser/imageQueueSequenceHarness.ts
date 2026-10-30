import {
  ExtensionRepositories,
  createDexieRepositoryDatabase,
} from "../../src/storage/repositories";
import { AutomatDatabase } from "../../src/storage/db";
import {
  createTimedImageQueueScheduler,
  IMAGE_QUEUE_ALARM_PREFIX,
} from "../../src/background/scheduler";
import { createFlowTimedQueueDispatcher } from "../../src/background/generationQueue";
import type { FlowImageGenerateOncePort } from "../../src/background/handlers/flow";
import type { FlowPromptEntryPort } from "../../src/platforms/flow/promptEntry";

export async function runDexieTimedQueueSequence() {
  let clock = 1000;
  const db = new AutomatDatabase(`timed-sequence-${crypto.randomUUID()}`);
  await db.open();
  try {
    const repositories = new ExtensionRepositories(
      createDexieRepositoryDatabase(db),
      () => clock,
    );
    const target = {
      provider: "Flow" as const,
      tabId: 27,
      canonicalTarget: "https://flow.google.com/project/timed-sequence",
    };
    const source =
      '1: {"shot_id":"01","prompt":" exact one "}\n2: {"shot_id":"02","prompt":"exact two"}';
    await repositories.savePromptBatch({
      workspaceId: "timed-sequence",
      kind: "image",
      sourceText: source,
    });
    await repositories.recordSelectedTarget(target);
    const selected = await repositories.getSelectedTarget("Flow");
    await db.selectedTargets.put({
      ...selected!,
      reconnectEnabled: true,
      verification: "verified",
      connectionState: "verified",
      verificationBinding: {
        provider: "Flow",
        tabId: 27,
        canonicalTarget: target.canonicalTarget,
        projectId: "timed-sequence",
        frameId: 0,
        documentId: "fixture-doc",
        documentToken: "fixture-token",
        extensionBuildId: "fixture-build",
        extensionProtocolVersion: 4,
        connectorBuildId: "fixture-build",
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: 900,
      },
    });
    const sendCommand = (
      window as unknown as {
        __timedCdpSend: (method: string, params?: object) => Promise<unknown>;
      }
    ).__timedCdpSend;
    const promptPort: FlowPromptEntryPort = {
      getSelection: async () => ({
        tabId: 27,
        canonicalTarget: target.canonicalTarget,
      }),
      getTab: async () => ({
        id: 27,
        title: "Synthetic Flow",
        url: location.href,
        provider: "Flow",
        projectId: "timed-sequence",
        canonicalTarget: target.canonicalTarget,
      }),
      hasRequiredApis: () => true,
      hasDebuggerPermission: async () => true,
      attach: async () => undefined,
      detach: async () => undefined,
      sendCommand: (_tabId, method, params) => sendCommand(method, params),
    };
    const pagePort = {
      ...promptPort,
      acquireDebuggerLease: async (tabId: number, ownerId?: string) => ({
        tabId,
        token: Symbol("fixture-lease"),
        ...(ownerId ? { ownerId } : {}),
      }),
      releaseDebuggerLease: async () => undefined,
      readFrame: async (tabId: number) => {
        if (tabId !== 27) return undefined;
        const tree = (await sendCommand("Page.getFrameTree")) as {
          frameTree?: {
            frame?: { id?: string; loaderId?: string; url?: string };
          };
        };
        const frame = tree.frameTree?.frame;
        if (!frame?.id || !frame.loaderId || !frame.url) return undefined;
        return {
          frameId: frame.id,
          loaderId: frame.loaderId,
          url: frame.url,
          documentId: "fixture-doc",
          senderFrameId: 0,
        };
      },
      captureFrame: async () => {
        throw new Error("captureFrame_not_used");
      },
      inspectGenerate: async () => {
        throw new Error("count_inspector_must_not_run");
      },
      recheckGenerate: async () => false,
      buttonPosition: async () => undefined,
      activate: async () => ({
        complete: false,
        pressAttempted: false,
        releaseAttempted: false,
      }),
      startObservation: async () => {
        throw new Error("observer_must_not_run");
      },
      stopObservation: async () => undefined,
      activateObservation: async () => {
        throw new Error("observer_must_not_run");
      },
      resumeObservation: async () => {
        throw new Error("observer_must_not_run");
      },
      sendCommand: (_tabId: number, method: string, params?: object) =>
        sendCommand(method, params),
    } as unknown as FlowImageGenerateOncePort;
    const environment = {
      promptPort,
      pagePort,
      getTab: async (tabId: number) => ({
        id: tabId,
        title: "Synthetic Flow",
        url: location.href,
      }),
      getDocument: async () => ({
        documentId: "fixture-doc",
        frameId: 0,
        result: location.href,
      }),
    };
    let queue;
    try {
      queue = await repositories.createTimedImageSubmissionQueue({
        workspaceId: "timed-sequence",
        queueId: crypto.randomUUID(),
        settingsConfirmation: {
          confirmationId: "fixture-settings",
          confirmedAt: 900,
          tabId: 27,
          projectId: "timed-sequence",
          canonicalTarget: target.canonicalTarget,
          declaredVariantCount: 3,
        },
      });
    } catch (error) {
      throw new Error(
        `queue_create_failed:${(error as { code?: string }).code ?? "unknown"}`,
        { cause: error },
      );
    }
    const alarms = new Map<string, number>();
    let receiptDurableBeforeSecond = false;
    const timedDispatcher = createFlowTimedQueueDispatcher(
      repositories,
      () => clock,
      environment,
    );
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      now: () => clock,
      alarms: {
        create: (name, info) => {
          alarms.set(name, info.when!);
        },
        clear: async (name) => {
          const had = alarms.has(name);
          alarms.delete(name);
          return had;
        },
      } as never,
      dispatch: async (input) => {
        if (input.order === 1) {
          const prior = await repositories.getTimedImageSubmissionQueue(
            queue.queueId,
          );
          receiptDurableBeforeSecond =
            prior?.items[0]?.itemState === "sent" &&
            prior.items[0].dispatchReceipt !== undefined;
        }
        return timedDispatcher(input);
      },
    });
    const syntheticClickLog = (
      window as unknown as { __timedClickLog: string[] }
    ).__timedClickLog;
    const originalDispatch = scheduler.start;
    let initial;
    let startError;
    try {
      initial = await originalDispatch(queue.queueId);
    } catch (error) {
      startError = `${(error as Error).name}:${(error as Error).message}:${(error as { code?: string }).code ?? "no-code"}`;
    }
    if (startError)
      return {
        startError,
        queue: await repositories.getTimedImageSubmissionQueue(queue.queueId),
      };
    const name = `${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`;
    clock = 40_999;
    await scheduler.onAlarm(name);
    const earlyCount = syntheticClickLog.length;
    clock = 41_000;
    await Promise.all([scheduler.onAlarm(name), scheduler.onAlarm(name)]);
    clock = 100_000;
    await scheduler.onAlarm(name);
    const final = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    return {
      orderedProviderInputs: syntheticClickLog,
      expectedBodies: [
        '{"shot_id":"01","prompt":" exact one "}',
        '{"shot_id":"02","prompt":"exact two"}',
      ],
      earlyCount,
      dispatchCount: syntheticClickLog.length,
      activationCounts: syntheticClickLog.map(
        (body) => syntheticClickLog.filter((entry) => entry === body).length,
      ),
      receiptDurableBeforeSecond,
      receiptTimes: final?.items.map((item) => item.dispatchReceipt?.storedAt),
      outcomes: final?.items.map((item) => item.providerOutcome),
      finalState: final?.state,
      deadlines: final?.nextEligibleDispatchAt,
      alarmCount: alarms.size,
      initialStatus: initial.items[0]?.itemState,
      blockedReason: initial.items.find((item) => item.itemState === "blocked")
        ?.blockReason,
    };
  } finally {
    db.close();
    await db.delete();
  }
}

declare global {
  interface Window {
    __TimedQueueSequenceFixture: {
      runDexieTimedQueueSequence: typeof runDexieTimedQueueSequence;
    };
  }
}
window.__TimedQueueSequenceFixture = { runDexieTimedQueueSequence };
