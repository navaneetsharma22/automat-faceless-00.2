import {
  ExtensionRepositories,
  createDexieRepositoryDatabase,
  sha256Hex,
} from "../../src/storage/repositories";
import { AutomatDatabase } from "../../src/storage/db";
import {
  createTimedImageQueueScheduler,
  IMAGE_QUEUE_ALARM_PREFIX,
} from "../../src/background/scheduler";
import {
  createFlowTimedQueueDispatcher,
  inspectFlowEditorAgainstQueueItem,
} from "../../src/background/generationQueue";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueueCard } from "../../src/app/features/image-batch/Progress";
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
    const firstBody = JSON.stringify({
      shot_id: "10",
      scene_title: "First prompt",
      prompt: "First synthetic prompt body.",
    });
    const secondBody = JSON.stringify({
      shot_id: "11",
      scene_title: "Long second prompt",
      prompt: Array.from(
        { length: 420 },
        (_, index) => `Second prompt segment ${index} stays exact.`,
      ).join(" "),
    });
    const expectedBodies = [firstBody, secondBody];
    const source = `10: ${firstBody}\n11: ${secondBody}`;
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
    const evidenceFor = async (body: string) => {
      const parsed = JSON.parse(body) as { shot_id?: string };
      return {
        shotId: parsed.shot_id,
        codeUnits: body.length,
        utf8Bytes: new TextEncoder().encode(body).byteLength,
        sha256: await sha256Hex(body),
      };
    };
    const inputEvidence = await Promise.all(syntheticClickLog.map(evidenceFor));
    const expectedEvidence = await Promise.all(expectedBodies.map(evidenceFor));
    const comparisonEvidence = await Promise.all(
      expectedBodies.map(async (expected, index) => {
        const actual = syntheticClickLog[index] ?? "";
        const commonLength = Math.min(expected.length, actual.length);
        let firstDifferenceOffset = 0;
        while (
          firstDifferenceOffset < commonLength &&
          expected[firstDifferenceOffset] === actual[firstDifferenceOffset]
        )
          firstDifferenceOffset += 1;
        const contextStart = Math.max(0, firstDifferenceOffset - 16);
        const contextEnd = firstDifferenceOffset + 16;
        return {
          equal: expected === actual,
          firstDifferenceOffset:
            expected === actual ? undefined : firstDifferenceOffset,
          mismatchCategory:
            expected === actual
              ? undefined
              : expected.length === actual.length
                ? "code-unit"
                : firstDifferenceOffset === commonLength
                  ? "length"
                  : "representation",
          expectedCodeUnits: expected.length,
          actualCodeUnits: actual.length,
          expectedUtf8Bytes: new TextEncoder().encode(expected).byteLength,
          actualUtf8Bytes: new TextEncoder().encode(actual).byteLength,
          expectedSha256: await sha256Hex(expected),
          actualSha256: await sha256Hex(actual),
          expectedContext: JSON.stringify(
            expected.slice(contextStart, contextEnd),
          ),
          actualContext: JSON.stringify(actual.slice(contextStart, contextEnd)),
        };
      }),
    );
    const persistedItems = queue.items.map((item) => ({
      shotId: item.shotId,
      order: item.order,
      codeUnits: item.rawJsonBody.length,
      utf8Bytes: new TextEncoder().encode(item.rawJsonBody).byteLength,
      sha256: item.promptHash,
      sourceSpan: item.sourceSpan,
    }));
    const expectedItems = await Promise.all(
      expectedBodies.map(async (body, order) => {
        const start = order === 0 ? source.indexOf(body) : source.indexOf(body);
        return {
          shotId: (JSON.parse(body) as { shot_id: string }).shot_id,
          order,
          codeUnits: body.length,
          utf8Bytes: new TextEncoder().encode(body).byteLength,
          sha256: await sha256Hex(body),
          sourceSpan: { start, end: start + body.length },
        };
      }),
    );
    const report = {
      orderedInputsMatch:
        syntheticClickLog.length === expectedBodies.length &&
        syntheticClickLog.every(
          (body, index) => body === expectedBodies[index],
        ),
      inputEvidence,
      expectedEvidence,
      comparisonEvidence,
      persistedItems,
      expectedItems,
      richComposerResetObserved:
        (window as unknown as { __timedComposerResetCount?: number })
          .__timedComposerResetCount === 2,
      composerResetCount: (
        window as unknown as { __timedComposerResetCount?: number }
      ).__timedComposerResetCount,
      earlyCount,
      dispatchCount: syntheticClickLog.length,
      activationCounts: syntheticClickLog.map(
        (body) => syntheticClickLog.filter((entry) => entry === body).length,
      ),
      receiptDurableBeforeSecond,
      receiptTimes: final?.items.map((item) => item.dispatchReceipt?.storedAt),
      outcomes: final?.items.map((item) => item.providerOutcome),
      finalState: final?.state,
      finalItems: final?.items.map((item) => ({
        shotId: item.shotId,
        itemState: item.itemState,
        providerOutcome: item.providerOutcome,
        receiptStored: Boolean(item.dispatchReceipt),
        intentStored: Boolean(item.dispatchIntent),
        activationStarted:
          item.dispatchIntent?.activationStartedAt !== undefined,
        blockReason: item.blockReason,
        readbackDiagnostic: item.readbackDiagnostic,
      })),
      readOnlyInspectionResult:
        final?.state === "blocked"
          ? await inspectFlowEditorAgainstQueueItem({
              repositories,
              queueId: initial.queueId,
              order: 1,
              environment: {
                pagePort,
                getTab: async () => ({ id: 27 }),
                getDocument: async () => ({
                  documentId: "fixture-doc",
                  frameId: 0,
                }),
              },
            })
          : undefined,
      deadlines: final?.nextEligibleDispatchAt,
      alarmCount: alarms.size,
      initialStatus: initial.items[0]?.itemState,
      blockedReason: final?.items.find((item) => item.itemState === "blocked")
        ?.blockReason,
      queueId: initial.queueId,
    };

    if (final?.state === "blocked") {
      activeDb = db;
      const inspectCalls: Array<{ queueId: string; order: number }> = [];
      (
        window as unknown as {
          __inspectCalls: Array<{ queueId: string; order: number }>;
        }
      ).__inspectCalls = inspectCalls;
      let container = document.getElementById("test-queue-card-root");
      if (!container) {
        container = document.createElement("div");
        container.id = "test-queue-card-root";
        document.body.appendChild(container);
      }
      const root = createRoot(container);
      root.render(
        createElement(QueueCard, {
          queue: final,
          starting: false,
          busy: false,
          onStart: () => undefined,
          onCommand: () => undefined,
          onInspectReadback: async (payload) => {
            inspectCalls.push(payload);
            return await inspectFlowEditorAgainstQueueItem({
              repositories,
              queueId: payload.queueId,
              order: payload.order,
              environment: {
                pagePort,
                getTab: async () => ({ id: 27 }),
                getDocument: async () => ({
                  documentId: "fixture-doc",
                  frameId: 0,
                }),
              },
            });
          },
        }),
      );
    }
    return report;
  } finally {
    if (!activeDb) {
      db.close();
      await db.delete();
    }
  }
}

let activeDb: AutomatDatabase | undefined;

export async function cleanupFixture() {
  const container = document.getElementById("test-queue-card-root");
  if (container) {
    container.remove();
  }
  if (activeDb) {
    activeDb.close();
    await activeDb.delete();
    activeDb = undefined;
  }
}

declare global {
  interface Window {
    __timedComposerResetCount?: number;
    __inspectCalls?: Array<{ queueId: string; order: number }>;
    __TimedQueueSequenceFixture: {
      runDexieTimedQueueSequence: typeof runDexieTimedQueueSequence;
      cleanup?: typeof cleanupFixture;
    };
  }
}
window.__TimedQueueSequenceFixture = {
  runDexieTimedQueueSequence,
  cleanup: cleanupFixture,
};
