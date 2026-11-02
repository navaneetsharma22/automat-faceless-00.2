import { z } from "zod";

export const VIDEO_QUEUE_DISPATCH_GAP_MS = 30_000 as const;
export const VIDEO_QUEUE_COMPLETION_CHECK_MS = 60_000 as const;

export const VIDEO_QUEUE_STATES = [
  "ready",
  "waiting",
  "paused",
  "blocked",
  "stopped",
  "completed",
] as const;
export type VideoQueueState = (typeof VIDEO_QUEUE_STATES)[number];

export const VIDEO_QUEUE_ITEM_STATES = [
  "pending",
  "attaching",
  "dispatching",
  "awaiting_completion",
  "awaiting_verification",
  "completed",
  "failed",
  "uncertain",
  "skipped",
] as const;
export type VideoQueueItemState = (typeof VIDEO_QUEUE_ITEM_STATES)[number];

export type FlowVideoQueueItem = {
  itemId: string;
  order: number;
  shotId: string;
  referenceId: string;
  promptHash: string;
  state: VideoQueueItemState;
  attemptId?: string;
  resultIdentity?: string;
  nextCheckAt?: number;
  completedAt?: number;
  reason?: string;
};

export type FlowVideoQueueRecord = {
  queueId: string;
  preparedBatchId: string;
  state: VideoQueueState;
  pauseReason?: string;
  items: FlowVideoQueueItem[];
  lastDispatchAt: number | null;
  nextActionAt: number | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

const itemSchema = z.object({
  itemId: z.string().min(1).max(256),
  order: z.number().int().nonnegative(),
  shotId: z.string().regex(/^[1-9][0-9]*$/),
  referenceId: z.string().uuid(),
  promptHash: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.enum(VIDEO_QUEUE_ITEM_STATES),
  attemptId: z.string().min(1).max(128).optional(),
  resultIdentity: z.string().min(1).max(512).optional(),
  nextCheckAt: z.number().finite().nonnegative().optional(),
  completedAt: z.number().finite().nonnegative().optional(),
  reason: z.string().min(1).max(64).optional(),
}).strict();

export const FlowVideoQueueRecordSchema = z.object({
  queueId: z.string().min(1).max(512),
  preparedBatchId: z.string().min(1).max(512),
  state: z.enum(VIDEO_QUEUE_STATES),
  pauseReason: z.string().min(1).max(64).optional(),
  items: z.array(itemSchema).nonempty().max(100),
  lastDispatchAt: z.number().finite().nonnegative().nullable(),
  nextActionAt: z.number().finite().nonnegative().nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
}).strict().refine((record) => record.items.every((item, index) => item.order === index));

export function nextVideoCompletionCheck(at: number): number {
  if (!Number.isFinite(at) || at < 0) throw new RangeError("Invalid video queue time.");
  return at + VIDEO_QUEUE_COMPLETION_CHECK_MS;
}

export function nextVideoDispatchAt(
  lastDispatchAt: number | null,
  now: number,
): number {
  if (!Number.isFinite(now) || now < 0) throw new RangeError("Invalid video queue time.");
  return Math.max(now, lastDispatchAt === null ? now : lastDispatchAt + VIDEO_QUEUE_DISPATCH_GAP_MS);
}
