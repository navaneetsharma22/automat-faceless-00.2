import { z } from "zod";
import { ReferenceByteComparisonDiagnosticSchema, type ReferenceByteComparisonDiagnostic } from "../media/references";

export const VIDEO_QUEUE_DISPATCH_GAP_MS = 30_000 as const;
export const VIDEO_QUEUE_READINESS_TIMEOUT_MS = 60_000 as const;

export const VIDEO_QUEUE_STATES = [
  "ready",
  "waiting",
  "sent",
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
  "waiting_for_generate",
  "sent",
  // Retained for validating persisted records created by the earlier P09.3 build.
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
  readinessStartedAt?: number;
  readinessDeadlineAt?: number;
  dispatchReceipt?: { attemptId: string; storedAt: number };
  // Legacy P09.3 fields are retained for safe reads and evidence preservation.
  resultIdentity?: string;
  nextCheckAt?: number;
  completedAt?: number;
  reason?: string;
  priorReason?: string;
  byteMismatchDiagnostic?: ReferenceByteComparisonDiagnostic;
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
  readinessStartedAt: z.number().finite().nonnegative().optional(),
  readinessDeadlineAt: z.number().finite().nonnegative().optional(),
  dispatchReceipt: z.object({ attemptId: z.string().min(1).max(128), storedAt: z.number().finite().nonnegative() }).strict().optional(),
  resultIdentity: z.string().min(1).max(512).optional(),
  nextCheckAt: z.number().finite().nonnegative().optional(),
  completedAt: z.number().finite().nonnegative().optional(),
  reason: z.string().min(1).max(64).optional(),
  priorReason: z.string().min(1).max(64).optional(),
  byteMismatchDiagnostic: ReferenceByteComparisonDiagnosticSchema.optional(),
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

export function nextVideoReadinessDeadline(at: number): number {
  if (!Number.isFinite(at) || at < 0) throw new RangeError("Invalid video queue time.");
  return at + VIDEO_QUEUE_READINESS_TIMEOUT_MS;
}

export function nextVideoDispatchAt(
  lastDispatchAt: number | null,
  now: number,
): number {
  if (!Number.isFinite(now) || now < 0) throw new RangeError("Invalid video queue time.");
  return Math.max(now, lastDispatchAt === null ? now : lastDispatchAt + VIDEO_QUEUE_DISPATCH_GAP_MS);
}
