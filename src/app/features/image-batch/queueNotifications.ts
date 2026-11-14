import type { ToastRequest } from "../../components/toastManager";
import type { ImageSubmissionQueueRecord } from "../../../domain/jobs/queue";

type ItemSnapshot = { sent: boolean };
type QueueSnapshot = {
  revision: number;
  items: Map<string, ItemSnapshot>;
  allSent: boolean;
};

/** Keeps queue-transition notification history for this page lifetime only. */
export class ImageQueueNotificationTracker {
  private readonly snapshots = new Map<string, QueueSnapshot>();
  private readonly notifiedItems = new Set<string>();
  private readonly notifiedBatches = new Set<string>();

  observe(records: readonly ImageSubmissionQueueRecord[]): ToastRequest[] {
    const notices: ToastRequest[] = [];
    for (const queue of records) {
      const previous = this.snapshots.get(queue.queueId);
      if (!previous) {
        this.snapshots.set(queue.queueId, snapshot(queue));
        continue;
      }
      if (queue.revision <= previous.revision) continue;

      for (const item of queue.items) {
        const receipt = item.dispatchReceipt;
        if (item.itemState !== "sent" || !receipt) continue;
        const prior = previous.items.get(item.queueItemId);
        const attemptId = receipt.attemptId;
        const key = `${queue.queueId}\u0000${item.queueItemId}\u0000${attemptId}`;
        if (prior?.sent || this.notifiedItems.has(key)) continue;
        this.notifiedItems.add(key);
        notices.push({
          kind: "info",
          message: `Image prompt ${item.shotId ?? `Prompt ${item.order + 1}`} sent`,
          dedupeKey: `image-sent:${key}`,
        });
      }

      const current = snapshot(queue);
      const batchAttemptKey = queue.items
        .map(
          (item) =>
            `${item.queueItemId}:${item.dispatchReceipt?.attemptId ?? "pending"}`,
        )
        .join(",");
      const batchKey = `${queue.queueId}\u0000${batchAttemptKey}`;
      if (
        !previous.allSent &&
        current.allSent &&
        !this.notifiedBatches.has(batchKey)
      ) {
        this.notifiedBatches.add(batchKey);
        notices.push({
          kind: "info",
          message: `All ${queue.items.length} image prompts sent`,
          dedupeKey: `image-batch-sent:${batchKey}`,
        });
      }
      this.snapshots.set(queue.queueId, current);
    }
    return notices;
  }
}

function isSent(item: ImageSubmissionQueueRecord["items"][number]): boolean {
  return item.itemState === "sent" && Boolean(item.dispatchReceipt);
}

function snapshot(queue: ImageSubmissionQueueRecord): QueueSnapshot {
  const items = new Map<string, ItemSnapshot>();
  for (const item of queue.items) {
    items.set(item.queueItemId, {
      sent: isSent(item),
    });
  }
  return {
    revision: queue.revision,
    items,
    allSent: queue.items.length > 0 && queue.items.every(isSent),
  };
}

export const imageQueueNotificationTracker =
  new ImageQueueNotificationTracker();
