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
  "sent",
  "paused",
  "blocked",
  "stopped",
] as const;
export type ImageQueueState = (typeof IMAGE_QUEUE_STATES)[number];

export type ImageQueueManualSettingsDeclaration = {
  readonly confirmationId: string;
  readonly confirmedAt: number;
  readonly tabId: number;
  readonly projectId: string;
  readonly canonicalTarget: string;
  readonly declaredVariantCount: number;
  readonly userAttested: true;
};

export type ImageQueueItem = {
  readonly queueItemId: string;
  readonly sourceItemId: string;
  readonly order: number;
  readonly shotId?: string;
  readonly rawJsonBody: string;
  readonly promptHash: string;
  readonly sourceSpan: { readonly start: number; readonly end: number };
  itemState: ImageQueueItemState;
  providerOutcome: "not_started" | "unknown";
  dispatchIntent?: {
    attemptId: string;
    recordedAt: number;
    activationStartedAt?: number;
  };
  blockReason?: string;
  dispatchReceipt?: {
    attemptId: string;
    storedAt: number;
    evidence: "activation_pair_sent_or_uncertain";
  };
};

export type ImageSubmissionQueueRecord = {
  readonly queueId: string;
  readonly workspaceId: string;
  readonly kind: "image";
  readonly mode: "timed_submission";
  readonly intervalMs: typeof TIMED_IMAGE_SUBMISSION_INTERVAL_MS;
  state: ImageQueueState;
  readonly sourceText: string;
  readonly sourceHash: string;
  readonly sourceMode:
    "single_json_value" | "numbered_json_blocks" | "versioned_envelope";
  readonly selectedProject: {
    readonly provider: "Flow";
    readonly tabId: number;
    readonly projectId: string;
    readonly canonicalTarget: string;
    readonly selectionRevision: number | null;
  };
  readonly manualSettingsDeclaration: ImageQueueManualSettingsDeclaration;
  readonly items: readonly ImageQueueItem[];
  lastDispatchReceiptStoredAt: number | null;
  nextEligibleDispatchAt: number | null;
  readonly createdAt: number;
  updatedAt: number;
  revision: number;
};

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const itemSchema = z
  .object({
    queueItemId: z.string().min(1).max(512),
    sourceItemId: z.string().min(1).max(256),
    order: z.number().int().nonnegative(),
    shotId: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    rawJsonBody: z.string().min(2),
    promptHash: hashSchema,
    sourceSpan: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict(),
    itemState: z.enum(IMAGE_QUEUE_ITEM_STATES),
    providerOutcome: z.enum(["not_started", "unknown"]),
    dispatchIntent: z
      .object({
        attemptId: z.string().min(1).max(128),
        recordedAt: z.number().finite().nonnegative(),
        activationStartedAt: z.number().finite().nonnegative().optional(),
      })
      .strict()
      .optional(),
    blockReason: z.string().min(1).max(64).optional(),
    dispatchReceipt: z
      .object({
        attemptId: z.string().min(1).max(128),
        storedAt: z.number().finite().nonnegative(),
        evidence: z.literal("activation_pair_sent_or_uncertain"),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((item) => item.sourceSpan.end >= item.sourceSpan.start)
  .refine(
    (item) => (item.itemState === "sent") === Boolean(item.dispatchReceipt),
  )
  .refine(
    (item) =>
      item.providerOutcome ===
      (item.dispatchReceipt ||
      item.dispatchIntent?.activationStartedAt !== undefined
        ? "unknown"
        : "not_started"),
  );

export const ImageSubmissionQueueRecordSchema = z
  .object({
    queueId: z.string().uuid(),
    workspaceId: z.string().min(1).max(128),
    kind: z.literal("image"),
    mode: z.literal("timed_submission"),
    intervalMs: z.literal(TIMED_IMAGE_SUBMISSION_INTERVAL_MS),
    state: z.enum(IMAGE_QUEUE_STATES),
    sourceText: z.string().min(1),
    sourceHash: hashSchema,
    sourceMode: z.enum([
      "single_json_value",
      "numbered_json_blocks",
      "versioned_envelope",
    ]),
    selectedProject: z
      .object({
        provider: z.literal("Flow"),
        tabId: z.number().int().nonnegative(),
        projectId: z.string().min(1).max(256),
        canonicalTarget: z.string().min(1).max(2048),
        selectionRevision: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    manualSettingsDeclaration: z
      .object({
        confirmationId: z.string().min(1).max(128),
        confirmedAt: z.number().finite().nonnegative(),
        tabId: z.number().int().nonnegative(),
        projectId: z.string().min(1).max(256),
        canonicalTarget: z.string().min(1).max(2048),
        declaredVariantCount: z.number().int().positive(),
        userAttested: z.literal(true),
      })
      .strict(),
    items: z.array(itemSchema).min(1).max(100),
    lastDispatchReceiptStoredAt: z.number().finite().nonnegative().nullable(),
    nextEligibleDispatchAt: z.number().finite().nonnegative().nullable(),
    createdAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .refine((record) => record.items.every((item, index) => item.order === index))
  .refine(
    (record) =>
      record.selectedProject.tabId === record.manualSettingsDeclaration.tabId &&
      record.selectedProject.projectId ===
        record.manualSettingsDeclaration.projectId &&
      record.selectedProject.canonicalTarget ===
        record.manualSettingsDeclaration.canonicalTarget,
  )
  .refine((record) => {
    const sent = record.items.filter((item) => item.dispatchReceipt);
    return sent.length === 0
      ? record.lastDispatchReceiptStoredAt === null &&
          record.nextEligibleDispatchAt === null &&
          record.state !== "waiting"
      : record.state !== "ready" &&
          record.lastDispatchReceiptStoredAt ===
            sent.at(-1)?.dispatchReceipt?.storedAt &&
          (record.nextEligibleDispatchAt === null
            ? record.items.every((item) => item.itemState === "sent")
            : record.nextEligibleDispatchAt >=
              record.lastDispatchReceiptStoredAt +
                TIMED_IMAGE_SUBMISSION_INTERVAL_MS);
  });

export function canTransitionImageQueue(
  from: ImageQueueState,
  to: ImageQueueState,
): boolean {
  const allowed: Record<ImageQueueState, readonly ImageQueueState[]> = {
    ready: ["waiting", "paused", "blocked", "stopped"],
    waiting: ["sent", "paused", "blocked", "stopped"],
    paused: ["ready", "stopped"],
    blocked: ["stopped"],
    sent: [],
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
): number {
  if (!Number.isFinite(receiptDurablyStoredAt) || receiptDurablyStoredAt < 0) {
    throw new RangeError("Dispatch deadline inputs must be finite timestamps.");
  }
  return receiptDurablyStoredAt + TIMED_IMAGE_SUBMISSION_INTERVAL_MS;
}
