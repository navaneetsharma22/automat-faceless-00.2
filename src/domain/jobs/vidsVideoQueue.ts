import { z } from "zod";

export const VIDS_VIDEO_DISPATCH_GAP_MS = 50_000 as const;
export const VIDS_VIDEO_READINESS_TIMEOUT_MS = 60_000 as const;
export const VIDS_VIDEO_QUEUE_STATES = ["ready", "cooldown", "preparing", "checking_generate", "paused", "stopped", "blocked", "all_sent"] as const;
export const VIDS_VIDEO_QUEUE_ITEM_STATES = ["pending", "transitioning", "attaching", "entering_prompt", "checking_generate", "sending", "sent", "blocked", "uncertain"] as const;
export const VidsVideoTransitionCheckpointSchema = z.object({
  stage: z.enum(["ownership_verified", "image_removed", "prompt_cleared"]),
  previousItemId: z.string().min(1).max(256), previousAttemptId: z.string().min(1).max(128),
  previousReferenceId: z.string().uuid(), previousReferenceSha256: z.string().regex(/^[0-9a-f]{64}$/), previousPromptHash: z.string().regex(/^[0-9a-f]{64}$/),
  nextItemId: z.string().min(1).max(256), nextReferenceId: z.string().uuid(), nextReferenceSha256: z.string().regex(/^[0-9a-f]{64}$/), nextPromptHash: z.string().regex(/^[0-9a-f]{64}$/),
  tabId: z.number().int().nonnegative(), canonicalTarget: z.string().min(1).max(2048), documentId: z.string().min(1).max(256), verifiedAt: z.number().finite().nonnegative(),
}).strict();
export type VidsVideoTransitionCheckpoint = z.infer<typeof VidsVideoTransitionCheckpointSchema>;
export const VidsCleanupDiagnosticsSchema = z.object({
  stage: z.enum(["ownership", "reference_remove", "prompt_clear", "settlement", "complete", "binding"]),
  editorRebound: z.boolean().optional(), panelRebound: z.boolean().optional(),
  previewCount: z.number().int().min(0).max(1000).optional(), fileInputCount: z.number().int().min(0).max(1000).optional(),
  expectedPromptSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(), currentPromptSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  expectedPromptLength: z.number().int().min(0).max(10_000_000).optional(), currentPromptLength: z.number().int().min(0).max(10_000_000).optional(),
  clearAvailable: z.enum(["unique", "missing", "ambiguous", "not_checked"]).optional(), settledEmpty: z.boolean().optional(),
}).strict();
export type VidsCleanupDiagnostics = z.infer<typeof VidsCleanupDiagnosticsSchema>;
export type VidsVideoQueueItem = {
  itemId: string; order: number; shotId: string; referenceId: string; referenceSha256: string; promptHash: string;
  state: typeof VIDS_VIDEO_QUEUE_ITEM_STATES[number]; reason?: string; attemptId?: string;
  transitionCheckpoint?: VidsVideoTransitionCheckpoint;
  cleanupDiagnostics?: VidsCleanupDiagnostics;
  dispatchReceipt?: { attemptId: string; storedAt: number };
};
export type VidsVideoQueueRecord = {
  queueId: string; preparedBatchId: string; state: typeof VIDS_VIDEO_QUEUE_STATES[number]; items: VidsVideoQueueItem[];
  revision: number; createdAt: number; updatedAt: number; lastDispatchAt: number | null;
  cooldownDeadlineAt: number | null; readinessDeadlineAt: number | null; readinessStartedAt: number | null;
  nextActionAt: number | null; pauseReason?: string; runId: string;
};
const itemSchema = z.object({ itemId: z.string().min(1).max(256), order: z.number().int().nonnegative(), shotId: z.string().regex(/^[1-9][0-9]*$/), referenceId: z.string().uuid(), referenceSha256: z.string().regex(/^[0-9a-f]{64}$/), promptHash: z.string().regex(/^[0-9a-f]{64}$/), state: z.enum(VIDS_VIDEO_QUEUE_ITEM_STATES), reason: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(), attemptId: z.string().min(1).max(128).optional(), transitionCheckpoint: VidsVideoTransitionCheckpointSchema.optional(), cleanupDiagnostics: VidsCleanupDiagnosticsSchema.optional(), dispatchReceipt: z.object({ attemptId: z.string().min(1).max(128), storedAt: z.number().finite().nonnegative() }).strict().optional() }).strict();
export const VidsVideoQueueRecordSchema = z.object({ queueId: z.string().min(1).max(512), preparedBatchId: z.string().min(1).max(512), state: z.enum(VIDS_VIDEO_QUEUE_STATES), items: z.array(itemSchema).nonempty().max(100), revision: z.number().int().nonnegative(), createdAt: z.number().finite().nonnegative(), updatedAt: z.number().finite().nonnegative(), lastDispatchAt: z.number().finite().nonnegative().nullable(), cooldownDeadlineAt: z.number().finite().nonnegative().nullable(), readinessDeadlineAt: z.number().finite().nonnegative().nullable(), readinessStartedAt: z.number().finite().nonnegative().nullable(), nextActionAt: z.number().finite().nonnegative().nullable(), pauseReason: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(), runId: z.string().min(1).max(128) }).strict().refine((queue) => queue.items.every((item, index) => item.order === index));
