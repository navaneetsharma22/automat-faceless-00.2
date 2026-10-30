import { describe, expect, it } from "vitest";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import {
  createTimedImageQueueScheduler,
  IMAGE_QUEUE_ALARM_PREFIX,
} from "../../src/background/scheduler";

const target = {
  provider: "Flow" as const,
  tabId: 29,
  canonicalTarget: "https://flow.google.com/project/timed-project",
};
const confirmation = {
  confirmationId: "timed-confirmation",
  confirmedAt: 800,
  tabId: 29,
  projectId: "timed-project",
  canonicalTarget: target.canonicalTarget,
  declaredVariantCount: 3,
};

async function fixture() {
  const database = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(database, () => 1_000);
  const source =
    '1: {"shot_id":"01","text":"exact first  "}\n2: {"shot_id":"02","text":"exact second"}';
  await repositories.savePromptBatch({
    workspaceId: "timed-ws",
    kind: "image",
    sourceText: source,
  });
  await repositories.recordSelectedTarget(target);
  const selected = await repositories.getSelectedTarget("Flow");
  await database.selectedTargets.put({
    ...selected!,
    verification: "verified",
    connectionState: "verified",
    verificationBinding: {
      provider: "Flow",
      tabId: 29,
      canonicalTarget: target.canonicalTarget,
      projectId: "timed-project",
      frameId: 0,
      documentId: "doc-1",
      documentToken: "token-1",
      extensionBuildId: "build",
      extensionProtocolVersion: 1,
      connectorBuildId: "build",
      connectorProtocolVersion: 1,
      capability: "read-only-connection-v1",
      verifiedAt: 900,
    },
  });
  const queue = await repositories.createTimedImageSubmissionQueue({
    workspaceId: "timed-ws",
    queueId: "e290648b-b104-4e63-aa60-08df28ac4a0f",
    settingsConfirmation: confirmation,
  });
  return { repositories, queue };
}

describe("production timed queue scheduler boundary", () => {
  it("dispatches ordered exact sources once, only after the durable 40,000ms deadline", async () => {
    const { repositories, queue } = await fixture();
    let clock = 1_000;
    const alarms = new Map<string, number>();
    const dispatches: string[] = [];
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      now: () => clock,
      alarms: {
        create: (name, info) => {
          alarms.set(name, info.when!);
        },
        clear: async (name) => {
          alarms.delete(name);
          return alarms.has(name);
        },
      } as never,
      dispatch: async ({ queue: claimed, order, attemptId }) => {
        expect(claimed.items[order]?.dispatchIntent?.attemptId).toBe(attemptId);
        if (order === 1) {
          const prior = await repositories.getTimedImageSubmissionQueue(
            queue.queueId,
          );
          expect(prior?.items[0]?.itemState).toBe("sent");
          expect(prior?.items[0]?.dispatchReceipt?.storedAt).toBe(1_000);
        }
        dispatches.push(claimed.items[order]!.rawJsonBody);
        return { status: "activated", at: clock };
      },
    });
    await scheduler.start(queue.queueId);
    expect(dispatches).toEqual(['{"shot_id":"01","text":"exact first  "}']);
    expect(alarms.get(`${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`)).toBe(
      41_000,
    );
    clock = 40_999;
    await scheduler.onAlarm(`${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`);
    expect(dispatches).toHaveLength(1);
    clock = 41_000;
    await Promise.all([
      scheduler.onAlarm(`${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`),
      scheduler.onAlarm(`${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`),
    ]);
    expect(dispatches).toEqual([
      '{"shot_id":"01","text":"exact first  "}',
      '{"shot_id":"02","text":"exact second"}',
    ]);
    clock = 100_000;
    await scheduler.onAlarm(`${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`);
    const final = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(final?.state).toBe("sent");
    expect(final?.items.map((item) => item.itemState)).toEqual([
      "sent",
      "sent",
    ]);
    expect(final?.items.map((item) => item.providerOutcome)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(final?.items.map((item) => item.dispatchReceipt?.storedAt)).toEqual([
      1_000, 41_000,
    ]);
    expect(dispatches).toHaveLength(2);
  });

  it("blocks an uncertain activation and preserves unknown outcome without retry", async () => {
    const { repositories, queue } = await fixture();
    let clock = 1_000;
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      now: () => clock,
      alarms: { create: () => undefined, clear: async () => true } as never,
      dispatch: async ({ markActivationStarted }) => {
        await markActivationStarted();
        return {
          status: "blocked",
          reason: "activation_evidence_uncertain",
          uncertain: true,
        };
      },
    });
    const result = await scheduler.start(queue.queueId);
    expect(result.state).toBe("blocked");
    expect(result.items[0]?.itemState).toBe("blocked");
    expect(result.items[0]?.providerOutcome).toBe("unknown");
    clock += 100_000;
    await scheduler.onAlarm(`${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`);
    expect(result.items[0]?.dispatchIntent).toBeDefined();
    expect(
      (await repositories.getTimedImageSubmissionQueue(queue.queueId))?.items[0]
        ?.itemState,
    ).toBe("blocked");
  });

  it("blocks a changed-binding refusal before advancing to the next prompt", async () => {
    const { repositories, queue } = await fixture();
    let dispatchCalls = 0;
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      now: () => 1_000,
      alarms: { create: () => undefined, clear: async () => true } as never,
      dispatch: async () => {
        dispatchCalls += 1;
        return {
          status: "blocked",
          reason: "selected_document_changed",
          uncertain: false,
        };
      },
    });
    const blocked = await scheduler.start(queue.queueId);
    expect(blocked.state).toBe("blocked");
    expect(blocked.items[0]).toMatchObject({
      itemState: "blocked",
      blockReason: "selected_document_changed",
      providerOutcome: "not_started",
    });
    await scheduler.onAlarm(`${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`);
    expect(dispatchCalls).toBe(1);
    expect(
      (await repositories.getTimedImageSubmissionQueue(queue.queueId))?.items[1]
        ?.itemState,
    ).toBe("pending");
  });

  it("blocks after receipt persistence failure and leaves activation outcome unknown", async () => {
    const { repositories, queue } = await fixture();
    const originalReceipt =
      repositories.recordTimedImageQueueReceipt.bind(repositories);
    repositories.recordTimedImageQueueReceipt = async () => {
      throw new Error("synthetic_storage_failure");
    };
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      now: () => 1_000,
      alarms: { create: () => undefined, clear: async () => true } as never,
      dispatch: async ({ markActivationStarted }) => {
        await markActivationStarted();
        return { status: "activated", at: 1_000 };
      },
    });
    await expect(scheduler.start(queue.queueId)).rejects.toThrow(
      "image_queue_receipt_persistence_failed",
    );
    repositories.recordTimedImageQueueReceipt = originalReceipt;
    const blocked = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(blocked?.state).toBe("blocked");
    expect(blocked?.items[0]).toMatchObject({
      itemState: "blocked",
      providerOutcome: "unknown",
      blockReason: "receipt_persistence_failed",
    });
    expect(blocked?.items[1]?.itemState).toBe("pending");
  });
});
