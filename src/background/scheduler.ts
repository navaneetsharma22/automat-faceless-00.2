import type {
  ImageSubmissionQueueRecord,
  PromptReadbackDiagnostic,
} from "../domain/jobs/queue";
import {
  ExtensionRepositories,
  ImageQueueEligibilityError,
} from "../storage/repositories";

export const IMAGE_QUEUE_ALARM_PREFIX = "automat-image-queue:";

export type TimedQueueDispatchResult =
  | { status: "activated"; at: number }
  | { status: "paused"; reason: string }
  | {
      status: "blocked";
      reason: string;
      uncertain: boolean;
      diagnostic?: PromptReadbackDiagnostic;
    };

export type TimedQueueDispatcher = (input: {
  queue: ImageSubmissionQueueRecord;
  order: number;
  attemptId: string;
  authorizeActivation: () => Promise<void>;
}) => Promise<TimedQueueDispatchResult>;

export function createTimedImageQueueScheduler(input: {
  repositories: ExtensionRepositories;
  dispatch: TimedQueueDispatcher;
  alarms: Pick<typeof chrome.alarms, "create" | "clear">;
  now?: () => number;
  verifyTargetForContinuation?: (
    queue: ImageSubmissionQueueRecord,
  ) => Promise<string | undefined>;
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
    if (
      queue.nextEligibleDispatchAt === null ||
      ["paused", "stopped", "blocked", "sent"].includes(queue.state)
    ) {
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
      if (queue.state === "paused") return queue;
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
          authorizeActivation: async () => {
            const currentQueue =
              await input.repositories.getTimedImageSubmissionQueue(queueId);
            const freshRevision = currentQueue?.revision ?? currentRevision;
            queue =
              await input.repositories.markTimedImageQueueActivationStarted({
                queueId,
                expectedRevision: freshRevision,
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
      if (result.status === "paused") {
        const current =
          await input.repositories.getTimedImageSubmissionQueue(queueId);
        if (!current) throw new Error("image_queue_not_found");
        if (current.state === "paused" || current.state === "stopped") {
          void input.alarms.clear(`${IMAGE_QUEUE_ALARM_PREFIX}${queueId}`);
          return current;
        }
        const paused = await input.repositories.pauseTimedImageQueue({
          queueId,
          expectedRevision: current.revision,
          at: now(),
          reason: result.reason,
        });
        void input.alarms.clear(`${IMAGE_QUEUE_ALARM_PREFIX}${queueId}`);
        return paused;
      }
      if (result.status === "blocked") {
        const current =
          await input.repositories.getTimedImageSubmissionQueue(queueId);
        if (!current) throw new Error("image_queue_not_found");
        if (current.state === "paused" || current.state === "stopped") {
          return current;
        }
        const blocked = await input.repositories.blockTimedImageQueue({
          queueId,
          expectedRevision: current.revision,
          order,
          at: now(),
          uncertain: result.uncertain,
          reason: result.reason,
          diagnostic: result.diagnostic,
        });
        if (!blocked) {
          const fresh =
            await input.repositories.getTimedImageSubmissionQueue(queueId);
          if (fresh?.state === "paused" || fresh?.state === "stopped")
            return fresh;
          throw new Error("timed_queue_block_lost_race");
        }
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
    pause: async (queueId: string, expectedRevision: number) => {
      const queue = await input.repositories.pauseTimedImageQueue({
        queueId,
        expectedRevision,
        at: now(),
      });
      void input.alarms.clear(`${IMAGE_QUEUE_ALARM_PREFIX}${queueId}`);
      return queue;
    },
    stop: async (queueId: string, expectedRevision: number) => {
      const queue = await input.repositories.stopTimedImageQueue({
        queueId,
        expectedRevision,
        at: now(),
      });
      void input.alarms.clear(`${IMAGE_QUEUE_ALARM_PREFIX}${queueId}`);
      return queue;
    },
    resume: async (queueId: string, expectedRevision: number) => {
      const current =
        await input.repositories.getTimedImageSubmissionQueue(queueId);
      if (!current) throw new Error("image_queue_not_found");
      if (current.revision !== expectedRevision)
        throw new Error("queue_revision_changed");
      let invalid: string | undefined;
      try {
        invalid = await input.verifyTargetForContinuation?.(current);
      } catch {
        invalid = "target_revalidation_failed";
      }
      if (invalid) {
        const paused = await input.repositories.pauseTimedImageQueue({
          queueId,
          expectedRevision,
          at: now(),
          reason: invalid,
        });
        if (paused.state === "paused") return paused;
        throw new Error(invalid);
      }
      let resumed: ImageSubmissionQueueRecord;
      try {
        resumed = await input.repositories.resumeTimedImageQueue({
          queueId,
          expectedRevision,
          at: now(),
        });
      } catch (error) {
        if (error instanceof ImageQueueEligibilityError) throw error;
        throw new ImageQueueEligibilityError("queue_resume_persistence_failed");
      }
      if (resumed.state === "ready" || resumed.state === "waiting") {
        if (
          resumed.nextEligibleDispatchAt !== null &&
          now() < resumed.nextEligibleDispatchAt
        )
          schedule(resumed);
        else return run(queueId);
      }
      return resumed;
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
        const unresolved = queue.items.find(
          (item) =>
            item.itemState === "sending" ||
            (item.dispatchIntent &&
              item.itemState !== "sent" &&
              item.itemState !== "blocked"),
        );
        if (unresolved) {
          if (unresolved.dispatchIntent?.activationStartedAt !== undefined) {
            await input.repositories.blockTimedImageQueue({
              queueId: queue.queueId,
              expectedRevision: queue.revision,
              order: unresolved.order,
              at: now(),
              uncertain: true,
              reason: "worker_restart_during_dispatch",
            });
            continue;
          }
          const readinessDeadline =
            unresolved.dispatchIntent?.readinessDeadlineAt;
          if (readinessDeadline !== undefined) {
            if (now() >= readinessDeadline) {
              await input.repositories.pauseTimedImageQueue({
                queueId: queue.queueId,
                expectedRevision: queue.revision,
                at: now(),
                reason: "flow_generate_readiness_timeout",
              });
              continue;
            }
            const invalid = await input.verifyTargetForContinuation?.(queue);
            if (invalid) {
              await input.repositories.pauseTimedImageQueue({
                queueId: queue.queueId,
                expectedRevision: queue.revision,
                at: now(),
                reason: invalid,
              });
              continue;
            }
            const reverted =
              await input.repositories.revertSendingItemToPendingForReadiness({
                queueId: queue.queueId,
                expectedRevision: queue.revision,
                order: unresolved.order,
                at: now(),
              });
            if (
              reverted.nextEligibleDispatchAt !== null &&
              now() < reverted.nextEligibleDispatchAt
            ) {
              schedule(reverted);
            } else {
              await run(queue.queueId);
            }
            continue;
          }
          await input.repositories.blockTimedImageQueue({
            queueId: queue.queueId,
            expectedRevision: queue.revision,
            order: unresolved.order,
            at: now(),
            uncertain: false,
            reason: "worker_restart_during_dispatch",
          });
          continue;
        }
        if (queue.state !== "waiting" || queue.nextEligibleDispatchAt === null)
          continue;
        const invalid = await input.verifyTargetForContinuation?.(queue);
        if (invalid) {
          await input.repositories.pauseTimedImageQueue({
            queueId: queue.queueId,
            expectedRevision: queue.revision,
            at: now(),
            reason: invalid,
          });
          continue;
        }
        schedule(queue);
      }
    },
  };
}
