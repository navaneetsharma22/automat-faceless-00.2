import { z } from "zod";

export const TIMED_IMAGE_SUBMISSION_INTERVAL_MS = 40_000 as const;

export const IMAGE_QUEUE_ITEM_STATES = [
  "pending",
  "sending",
  "sent",
  "blocked",
  "stopped",
] as const;
export type ImageQueueItemState = (typeof IMAGE_QUEUE_ITEM_STATES)[number];

export const IMAGE_QUEUE_STATES = [
  "ready",
  "waiting",
  "paused",
  "blocked",
  "stopped",
] as const;
export type ImageQueueState = (typeof IMAGE_QUEUE_STATES)[number];

export type ImageQueueManualSettingsDeclaration = {
  confirmationId: string;
  confirmedAt: number;
  tabId: number;
  projectId: string;
  canonicalTarget: string;
  declaredVariantCount: number;
  userAttested: true;
};

export type ImageQueueItem = {
  queueItemId: string;
  sourceItemId: string;
  order: number;
  shotId?: string;
  rawJsonBody: string;
  promptHash: string;
  sourceSpan: { start: number; end: number };
  itemState: ImageQueueItemState;
  providerOutcome: "not_started" | "unknown";
  dispatchReceipt?: {
    attemptId: string;
    storedAt: number;
    evidence: "activation_pair_sent_or_uncertain";
  };
};

export type ImageSubmissionQueueRecord = {
  queueId: string;
  workspaceId: string;
  kind: "image";
  mode: "timed_submission";
  intervalMs: typeof TIMED_IMAGE_SUBMISSION_INTERVAL_MS;
  state: ImageQueueState;
  sourceText: string;
  sourceHash: string;
  sourceMode: "single_json_value" | "numbered_json_blocks" | "versioned_envelope";
  selectedProject: {
    provider: "Flow";
    tabId: number;
    projectId: string;
    canonicalTarget: string;
    selectionRevision: number | null;
  };
  manualSettingsDeclaration: ImageQueueManualSettingsDeclaration;
  items: ImageQueueItem[];
  lastDispatchReceiptStoredAt: number | null;
  nextEligibleDispatchAt: number | null;
  createdAt: number;
  updatedAt: number;
};

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const itemSchema = z.object({
  queueItemId: z.string().min(1).max(512),
  sourceItemId: z.string().min(1).max(256),
  order: z.number().int().nonnegative(),
  shotId: z.string().regex(/^[1-9][0-9]*$/).optional(),
  rawJsonBody: z.string().min(2),
  promptHash: hashSchema,
  sourceSpan: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict(),
  itemState: z.enum(IMAGE_QUEUE_ITEM_STATES),
  providerOutcome: z.enum(["not_started", "unknown"]),
  dispatchReceipt: z.object({
    attemptId: z.string().min(1).max(128),
    storedAt: z.number().finite().nonnegative(),
    evidence: z.literal("activation_pair_sent_or_uncertain"),
  }).strict().optional(),
}).strict().refine((item) => item.sourceSpan.end >= item.sourceSpan.start)
  .refine((item) => (item.itemState === "sent") === Boolean(item.dispatchReceipt))
  .refine((item) => item.providerOutcome === (item.dispatchReceipt ? "unknown" : "not_started"));

export const ImageSubmissionQueueRecordSchema = z.object({
  queueId: z.string().uuid(),
  workspaceId: z.string().min(1).max(128),
  kind: z.literal("image"),
  mode: z.literal("timed_submission"),
  intervalMs: z.literal(TIMED_IMAGE_SUBMISSION_INTERVAL_MS),
  state: z.enum(IMAGE_QUEUE_STATES),
  sourceText: z.string().min(1),
  sourceHash: hashSchema,
  sourceMode: z.enum(["single_json_value", "numbered_json_blocks", "versioned_envelope"]),
  selectedProject: z.object({
    provider: z.literal("Flow"),
    tabId: z.number().int().nonnegative(),
    projectId: z.string().min(1).max(256),
    canonicalTarget: z.string().min(1).max(2048),
    selectionRevision: z.number().int().nonnegative().nullable(),
  }).strict(),
  manualSettingsDeclaration: z.object({
    confirmationId: z.string().uuid(),
    confirmedAt: z.number().finite().nonnegative(),
    tabId: z.number().int().nonnegative(),
    projectId: z.string().min(1).max(256),
    canonicalTarget: z.string().min(1).max(2048),
    declaredVariantCount: z.number().int().positive(),
    userAttested: z.literal(true),
  }).strict(),
  items: z.array(itemSchema).min(1).max(100),
  lastDispatchReceiptStoredAt: z.number().finite().nonnegative().nullable(),
  nextEligibleDispatchAt: z.number().finite().nonnegative().nullable(),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
}).strict().refine((record) => record.items.every((item, index) => item.order === index))
  .refine((record) => record.selectedProject.tabId === record.manualSettingsDeclaration.tabId && record.selectedProject.projectId === record.manualSettingsDeclaration.projectId && record.selectedProject.canonicalTarget === record.manualSettingsDeclaration.canonicalTarget)
  .refine((record) => {
    const sent = record.items.filter((item) => item.dispatchReceipt);
    return sent.length === 0
      ? record.lastDispatchReceiptStoredAt === null && record.nextEligibleDispatchAt === null
      : record.lastDispatchReceiptStoredAt === sent.at(-1)?.dispatchReceipt?.storedAt &&
          record.nextEligibleDispatchAt !== null &&
          record.nextEligibleDispatchAt >= record.lastDispatchReceiptStoredAt + TIMED_IMAGE_SUBMISSION_INTERVAL_MS;
  });

export function canTransitionImageQueue(
  from: ImageQueueState,
  to: ImageQueueState,
): boolean {
  const allowed: Record<ImageQueueState, readonly ImageQueueState[]> = {
    ready: ["waiting", "paused", "blocked", "stopped"],
    waiting: ["paused", "blocked", "stopped"],
    paused: ["ready", "stopped"],
    blocked: ["stopped"],
    stopped: [],
  };
  return allowed[from].includes(to);
}

export function canTransitionImageQueueItem(
  from: ImageQueueItemState,
  to: ImageQueueItemState,
): boolean {
  const allowed: Record<ImageQueueItemState, readonly ImageQueueItemState[]> = {
    pending: ["sending", "blocked", "stopped"],
    sending: ["sent", "blocked"],
    sent: [],
    blocked: [],
    stopped: [],
  };
  return allowed[from].includes(to);
}

/** P06.2 must call this only after the preceding dispatch receipt is durable. */
export function nextTimedDispatchDeadline(
  receiptDurablyStoredAt: number,
  schedulerObservedAt: number,
): number {
  if (!Number.isFinite(receiptDurablyStoredAt) || !Number.isFinite(schedulerObservedAt)) {
    throw new RangeError("Dispatch deadline inputs must be finite timestamps.");
  }
  return Math.max(receiptDurablyStoredAt, schedulerObservedAt) + TIMED_IMAGE_SUBMISSION_INTERVAL_MS;
}
