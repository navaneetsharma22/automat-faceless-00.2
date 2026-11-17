import { z } from "zod";
import { ReferenceByteComparisonDiagnosticSchema, type ReferenceByteComparisonDiagnostic } from "../media/references";

export const VIDEO_QUEUE_DISPATCH_GAP_MS = 15_000 as const;
export const VIDEO_QUEUE_READINESS_TIMEOUT_MS = 60_000 as const;

const FLOW_MEDIA_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FLOW_ASB_TOKEN = /^[A-Za-z0-9_-]{1,2048}$/;
const FLOW_ASB_SUFFIX = /^=s\d+(-rw)?$/;

/**
 * URL-free snapshot of the visible composer ingredients at the moment the
 * pre-Add chip gate refused. It records only bounded identity fragments
 * (media UUIDs, `/asb` tokens, size suffixes) so a stale or different chip
 * can be diagnosed without persisting image URLs or request signatures.
 */
export const FlowVideoExistingChipDiagnosticSchema = z
  .object({
    producer: z.literal("existing_composer_chip_check_before_picker"),
    chipCount: z.number().int().nonnegative().max(32),
    visibleChipCount: z.number().int().nonnegative().max(32),
    candidateCount: z.number().int().nonnegative().max(32),
    chips: z
      .array(
        z
          .object({
            visible: z.boolean(),
            busy: z.string().max(32).nullable(),
            imageCount: z.number().int().nonnegative().max(16),
            mediaIds: z.array(z.string().regex(FLOW_MEDIA_UUID)).max(4),
            asbTokens: z.array(z.string().regex(FLOW_ASB_TOKEN)).max(4),
            asbSuffixes: z.array(z.string().regex(FLOW_ASB_SUFFIX)).max(4),
            expectedKeyMatches: z.number().int().nonnegative().max(32),
            unexpectedKeyCount: z.number().int().nonnegative().max(32),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export type FlowVideoExistingChipDiagnostic = z.infer<
  typeof FlowVideoExistingChipDiagnosticSchema
>;

/**
 * Picker failures are returned by the in-page action before its sole Add
 * activation. The set is deliberately closed: a reason outside it never
 * authorizes retrying an attachment that may already have clicked Add.
 */
export const FLOW_VIDEO_PICKER_PRE_ADD_REASONS = [
  "picker_missing",
  "picker_not_open",
  "picker_exact_row_missing",
  "picker_exact_row_ambiguous",
  "picker_selected_preview_mismatch",
  "picker_add_not_ready",
] as const;
export type FlowVideoPickerPreAddReason =
  (typeof FLOW_VIDEO_PICKER_PRE_ADD_REASONS)[number];

export function isFlowVideoPickerPreAddReason(
  reason: string | undefined,
): reason is FlowVideoPickerPreAddReason {
  return (
    reason !== undefined &&
    (FLOW_VIDEO_PICKER_PRE_ADD_REASONS as readonly string[]).includes(reason)
  );
}

/**
 * The existing-composer chip gate runs before the picker opens and before the
 * sole Add click. A conflict there is therefore replayable as a fresh
 * attachment attempt once the user removes the offending chip: no Add, no
 * picker selection, and no Generate has occurred for the item.
 */
export const FLOW_VIDEO_PRE_ADD_RETRY_REASONS = [
  ...FLOW_VIDEO_PICKER_PRE_ADD_REASONS,
  "existing_chip_conflict",
] as const;
export type FlowVideoPreAddRetryReason =
  (typeof FLOW_VIDEO_PRE_ADD_RETRY_REASONS)[number];

export function isFlowVideoPreAddRetryReason(
  reason: string | undefined,
): reason is FlowVideoPreAddRetryReason {
  return (
    reason !== undefined &&
    (FLOW_VIDEO_PRE_ADD_RETRY_REASONS as readonly string[]).includes(reason)
  );
}

/**
 * Unresolved chip outcomes after Add, or an unreadable existing composer chip
 * detected before Add. Recovery never replays Add: it performs read-only chip
 * verification and continues only when the exact pinned media ID is settled.
 */
export const FLOW_VIDEO_POST_ADD_ATTACHMENT_REASONS = [
  "existing_chip_identity_unreadable",
  "existing_chip_not_ready",
  "chip_identity_unreadable_after_add",
  "attachment_uncertain",
  "attachment_unverified",
] as const;
export type FlowVideoPostAddAttachmentReason =
  (typeof FLOW_VIDEO_POST_ADD_ATTACHMENT_REASONS)[number];

export function isFlowVideoPostAddAttachmentReason(
  reason: string | undefined,
): reason is FlowVideoPostAddAttachmentReason {
  return (
    reason !== undefined &&
    (FLOW_VIDEO_POST_ADD_ATTACHMENT_REASONS as readonly string[]).includes(
      reason,
    )
  );
}

/**
 * Queue-item reasons that may follow a post-Add attachment outcome. The
 * verification_* values are produced by the read-only verifyAttachedReference
 * action after a failed recovery attempt; they remain recoverable because the
 * next attempt still never clicks Add.
 */
export const FLOW_VIDEO_POST_ADD_RECOVERY_REASONS = [
  ...FLOW_VIDEO_POST_ADD_ATTACHMENT_REASONS,
  "verification_chip_not_exact_ready",
  "verification_document_mismatch",
  "verification_target_changed",
  "operation_changed",
] as const;
export type FlowVideoPostAddRecoveryReason =
  (typeof FLOW_VIDEO_POST_ADD_RECOVERY_REASONS)[number];

export function isFlowVideoPostAddRecoveryReason(
  reason: string | undefined,
): reason is FlowVideoPostAddRecoveryReason {
  return (
    reason !== undefined &&
    (FLOW_VIDEO_POST_ADD_RECOVERY_REASONS as readonly string[]).includes(reason)
  );
}

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
  existingChipDiagnostic?: FlowVideoExistingChipDiagnostic;
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
  existingChipDiagnostic: FlowVideoExistingChipDiagnosticSchema.optional(),
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
