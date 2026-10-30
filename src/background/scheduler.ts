import type { ImageSubmissionQueueRecord } from "../domain/jobs/queue";
import { ExtensionRepositories } from "../storage/repositories";

export const IMAGE_QUEUE_ALARM_PREFIX = "automat-image-queue:";

export type TimedQueueDispatchResult =
  | { status: "activated"; at: number }
  | { status: "blocked"; reason: string; uncertain: boolean };

export type TimedQueueDispatcher = (input: {
  queue: ImageSubmissionQueueRecord;
  order: number;
  attemptId: string;
  markActivationStarted: () => Promise<void>;
}) => Promise<TimedQueueDispatchResult>;

export function createTimedImageQueueScheduler(input: {
  repositories: ExtensionRepositories;
  dispatch: TimedQueueDispatcher;
  alarms: Pick<typeof chrome.alarms, "create" | "clear">;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const tails = new Map<string, Promise<unknown>>();
  const serialized = <T>(
    queueId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previous = tails.get(queueId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    tails.set(queueId, current);
    void current
      .finally(() => {
        if (tails.get(queueId) === current) tails.delete(queueId);
      })
      .catch(() => undefined);
    return current;
  };
  const schedule = (queue: ImageSubmissionQueueRecord) => {
    const name = `${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`;
    if (queue.nextEligibleDispatchAt === null) {
      void input.alarms.clear(name);
      return;
    }
    input.alarms.create(name, { when: queue.nextEligibleDispatchAt });
  };

  const run = (
    queueId: string,
    starting = false,
  ): Promise<ImageSubmissionQueueRecord> =>
    serialized("single-dispatch-operation", async () => {
      let queue =
        await input.repositories.getTimedImageSubmissionQueue(queueId);
      if (!queue) throw new Error("image_queue_not_found");
      if (
        queue.items.some(
          (item) =>
            item.itemState === "sending" ||
            (item.dispatchIntent &&
              item.itemState !== "sent" &&
              item.itemState !== "blocked"),
        )
      )
        throw new Error("image_queue_unresolved_dispatch_intent");
      if (
        queue.state === "blocked" ||
        queue.state === "stopped" ||
        queue.state === "sent"
      )
        return queue;
      const order = queue.items.findIndex(
        (item) => item.itemState === "pending",
      );
      if (order < 0) return queue;
      if (
        queue.nextEligibleDispatchAt !== null &&
        now() < queue.nextEligibleDispatchAt
      ) {
        schedule(queue);
        return queue;
      }
      if (
        !starting &&
        queue.nextEligibleDispatchAt === null &&
        queue.items[order]?.itemState === "pending" &&
        queue.items.slice(0, order).some((item) => item.itemState !== "sent")
      )
        return queue;
      const attemptId = crypto.randomUUID();
      queue = await input.repositories.claimTimedImageQueueItem({
        queueId,
        expectedRevision: queue.revision,
        order,
        attemptId,
        at: now(),
      });
      const intent = queue.items[order]?.dispatchIntent;
      if (!intent || intent.attemptId !== attemptId)
        throw new Error("image_queue_intent_readback_failed");
      let result: TimedQueueDispatchResult;
      let currentRevision = queue.revision;
      try {
        result = await input.dispatch({
          queue,
          order,
          attemptId,
          markActivationStarted: async () => {
            queue =
              await input.repositories.markTimedImageQueueActivationStarted({
                queueId,
                expectedRevision: currentRevision,
                order,
                attemptId,
                at: now(),
              });
            currentRevision = queue.revision;
          },
        });
      } catch {
        result = {
          status: "blocked",
          reason: "dispatch_exception",
          uncertain: true,
        };
      }
      if (result.status === "blocked") {
        const blocked = await input.repositories.blockTimedImageQueue({
          queueId,
          expectedRevision: queue.revision,
          order,
          at: now(),
          uncertain: result.uncertain,
          reason: result.reason,
        });
        if (!blocked) throw new Error("image_queue_block_revision_changed");
        void input.alarms.clear(`${IMAGE_QUEUE_ALARM_PREFIX}${queueId}`);
        return blocked;
      }
      try {
        queue = await input.repositories.recordTimedImageQueueReceipt({
          queueId,
          expectedRevision: currentRevision,
          order,
          attemptId,
          recordedAt: Math.max(result.at, now()),
        });
      } catch {
        await input.repositories
          .blockTimedImageQueue({
            queueId,
            expectedRevision: queue.revision,
            order,
            at: now(),
            uncertain: true,
            reason: "receipt_persistence_failed",
          })
          .catch(() => undefined);
        throw new Error("image_queue_receipt_persistence_failed");
      }
      if (
        queue.items[order]?.itemState !== "sent" ||
        queue.items[order]?.providerOutcome !== "unknown"
      )
        throw new Error("image_queue_receipt_readback_failed");
      schedule(queue);
      return queue;
    });

  return {
    start: async (queueId: string) => {
      await input.repositories.validateTimedImageQueueStart(queueId);
      return run(queueId, true);
    },
    onAlarm: (name: string) => {
      if (!name.startsWith(IMAGE_QUEUE_ALARM_PREFIX))
        return Promise.resolve(undefined);
      return run(name.slice(IMAGE_QUEUE_ALARM_PREFIX.length));
    },
    reconcileStartup: async () => {
      const queues =
        await input.repositories.listAllTimedImageSubmissionQueues();
      for (const queue of queues) {
        if (
          queue.items.some(
            (item) =>
              item.itemState === "sending" ||
              (item.dispatchIntent &&
                item.itemState !== "sent" &&
                item.itemState !== "blocked"),
          )
        )
          continue;
        if (queue.state === "waiting" && queue.nextEligibleDispatchAt !== null)
          schedule(queue);
      }
    },
  };
}
