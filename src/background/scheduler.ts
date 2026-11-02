import type {
  ImageSubmissionQueueRecord,
  PromptReadbackDiagnostic,
} from "../domain/jobs/queue";
import {
  ExtensionRepositories,
  ImageQueueEligibilityError,
} from "../storage/repositories";

export const IMAGE_QUEUE_ALARM_PREFIX = "automat-image-queue:";
// Chrome 120+ enforces a 30 second minimum for alarms. Readiness polling must
// use a persisted supported wake time rather than short in-worker timers.
export const CHROME_MIN_ALARM_DELAY_MS = 30_000;

/** Shared serialized alarm helpers for additive queue kinds. The existing
 * timed image queue keeps its own persisted timing and state transitions. */
export function createQueueAlarmRuntime(input: {
  alarms: Pick<typeof chrome.alarms, "create" | "clear">;
  prefix: string;
  now?: () => number;
  minimumAlarmDelayMs?: number | null;
}) {
  const now = input.now ?? Date.now;
  const minimumAlarmDelayMs = input.minimumAlarmDelayMs === undefined
    ? CHROME_MIN_ALARM_DELAY_MS
    : input.minimumAlarmDelayMs;
  const tails = new Map<string, Promise<unknown>>();
  return {
    name: (queueId: string) => `${input.prefix}${queueId}`,
    serialize<T>(queueId: string, operation: () => Promise<T>): Promise<T> {
      const previous = tails.get(queueId) ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(operation);
      tails.set(queueId, current);
      void current.finally(() => {
        if (tails.get(queueId) === current) tails.delete(queueId);
      }).catch(() => undefined);
      return current;
    },
    async schedule(queueId: string, at: number | null) {
      const name = `${input.prefix}${queueId}`;
      if (at === null) await input.alarms.clear(name);
      else await input.alarms.create(name, { when: minimumAlarmDelayMs === null ? at : Math.max(at, now() + minimumAlarmDelayMs) });
    },
    clear(queueId: string) {
      return input.alarms.clear(`${input.prefix}${queueId}`);
    },
    queueIdFromAlarm(name: string): string | undefined {
      return name.startsWith(input.prefix) ? name.slice(input.prefix.length) : undefined;
    },
  };
}

export type TimedQueueDispatchResult =
  | { status: "activated"; at: number }
  | { status: "waiting" }
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
  // Keep image queue deadlines exactly as stored; Flow video shares this
  // serialized alarm runtime but uses its own persisted result-check times.
  const queueRuntime = createQueueAlarmRuntime({
    alarms: input.alarms,
    prefix: IMAGE_QUEUE_ALARM_PREFIX,
    now,
    minimumAlarmDelayMs: null,
  });
  const schedule = async (queue: ImageSubmissionQueueRecord) => {
    if (
      ["paused", "stopped", "blocked", "sent"].includes(queue.state)
    ) {
      await queueRuntime.clear(queue.queueId);
      return;
    }
    const readinessItem = queue.items.find(
      (item) =>
        item.dispatchIntent?.readinessDeadlineAt !== undefined &&
        (item.itemState === "pending" || item.itemState === "sending"),
    );
    const when = readinessItem
      ? (readinessItem.dispatchIntent?.readinessCheckAt ??
        readinessItem.dispatchIntent?.readinessDeadlineAt ??
        null)
      : queue.nextEligibleDispatchAt;
    if (when === null) {
      await queueRuntime.clear(queue.queueId);
      return;
    }
    await queueRuntime.schedule(queue.queueId, when);
  };

  const run = (
    queueId: string,
    starting = false,
  ): Promise<ImageSubmissionQueueRecord> =>
    queueRuntime.serialize("single-dispatch-operation", async () => {
      let queue =
        await input.repositories.getTimedImageSubmissionQueue(queueId);
      if (!queue) throw new Error("image_queue_not_found");
      if (
        queue.items.some(
          (item) =>
            item.itemState === "sending" ||
            (item.dispatchIntent &&
              item.dispatchIntent.readinessDeadlineAt === undefined &&
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
      const readinessIntent = queue.items[order]?.dispatchIntent;
      if (readinessIntent?.readinessDeadlineAt !== undefined) {
        if (now() >= readinessIntent.readinessDeadlineAt) {
          const paused = await input.repositories.pauseTimedImageQueue({
            queueId,
            expectedRevision: queue.revision,
            at: now(),
            reason: "flow_generate_readiness_timeout",
          });
          void input.alarms.clear(`${IMAGE_QUEUE_ALARM_PREFIX}${queueId}`);
          return paused;
        }
        if (
          readinessIntent.readinessCheckAt !== undefined &&
          now() < readinessIntent.readinessCheckAt
        ) {
          await schedule(queue);
          return queue;
        }
      }
      if (
        queue.nextEligibleDispatchAt !== null &&
        now() < queue.nextEligibleDispatchAt
      ) {
        await schedule(queue);
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
      if (result.status === "waiting") {
        const current =
          await input.repositories.getTimedImageSubmissionQueue(queueId);
        if (!current) throw new Error("image_queue_not_found");
        if (current.state === "paused" || current.state === "stopped") {
          void input.alarms.clear(`${IMAGE_QUEUE_ALARM_PREFIX}${queueId}`);
          return current;
        }
        const pending =
          await input.repositories.revertSendingItemToPendingForReadiness({
            queueId,
            expectedRevision: current.revision,
            order,
            at: now(),
          });
        await schedule(pending);
        return pending;
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
      await schedule(queue);
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
          await schedule(resumed);
        else return run(queueId);
      }
      return resumed;
    },
    onAlarm: (name: string) => {
      const queueId = queueRuntime.queueIdFromAlarm(name);
      return queueId ? run(queueId) : Promise.resolve(undefined);
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
            const reverted =
              unresolved.itemState === "sending"
                ? await input.repositories.revertSendingItemToPendingForReadiness({
                    queueId: queue.queueId,
                    expectedRevision: queue.revision,
                    order: unresolved.order,
                    at: now(),
                  })
                : queue;
            await schedule(reverted);
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
        if (queue.state === "waiting" || queue.state === "ready")
          await schedule(queue);
      }
    },
  };
}
