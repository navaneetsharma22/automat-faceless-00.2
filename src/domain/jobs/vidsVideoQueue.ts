import { z } from "zod";

export const VIDS_VIDEO_DISPATCH_GAP_MS = 50_000 as const;
export const VIDS_VIDEO_READINESS_TIMEOUT_MS = 60_000 as const;
export const VIDS_VIDEO_QUEUE_STATES = ["ready", "cooldown", "preparing", "checking_generate", "paused", "stopped", "blocked", "all_sent"] as const;
export const VIDS_VIDEO_QUEUE_ITEM_STATES = ["pending", "transitioning", "attaching", "entering_prompt", "checking_generate", "sending", "sent", "blocked", "uncertain"] as const;
export const VidsVideoTransitionCheckpointSchema = z.object({
  // Optional only to read pre-mw01wgpj queue rows. A checkpoint without a
  // stage is stale and must be re-inspected before any cleanup mutation.
  stage: z.enum(["ownership_verified", "image_removed", "prompt_cleared"]).optional(),
  previousItemId: z.string().min(1).max(256), previousAttemptId: z.string().min(1).max(128),
  previousReferenceId: z.string().uuid(), previousReferenceSha256: z.string().regex(/^[0-9a-f]{64}$/), previousPromptHash: z.string().regex(/^[0-9a-f]{64}$/),
  nextItemId: z.string().min(1).max(256), nextReferenceId: z.string().uuid(), nextReferenceSha256: z.string().regex(/^[0-9a-f]{64}$/), nextPromptHash: z.string().regex(/^[0-9a-f]{64}$/),
  tabId: z.number().int().nonnegative(), canonicalTarget: z.string().min(1).max(2048), documentId: z.string().min(1).max(256), verifiedAt: z.number().finite().nonnegative(),
}).strict();
export type VidsVideoTransitionCheckpoint = z.infer<typeof VidsVideoTransitionCheckpointSchema>;
export const VidsVideoExecutionRebindSchema = z.object({
  // Optional on read for queues persisted before cross-tab recovery existed.
  fromTabId: z.number().int().nonnegative().optional(), toTabId: z.number().int().nonnegative().optional(),
  fromDocumentId: z.string().min(1).max(256), toDocumentId: z.string().min(1).max(256),
  projectId: z.string().min(1).max(256), canonicalTarget: z.string().min(1).max(2048),
  verifiedAt: z.number().finite().nonnegative(), sameAccountConfirmedAt: z.number().finite().nonnegative(),
}).strict();
export type VidsVideoExecutionRebind = z.infer<typeof VidsVideoExecutionRebindSchema>;
export const VidsCleanComposerRecoverySchema = z.object({
  tabId: z.number().int().nonnegative(), documentId: z.string().min(1).max(256), canonicalTarget: z.string().min(1).max(2048),
  referenceId: z.string().uuid(), referenceSha256: z.string().regex(/^[0-9a-f]{64}$/), promptHash: z.string().regex(/^[0-9a-f]{64}$/),
  verifiedAt: z.number().finite().nonnegative(),
}).strict();
export const VidsCleanupDiagnosticsSchema = z.object({
  stage: z.enum(["ownership", "reference_remove", "prompt_clear", "settlement", "complete", "binding"]),
  editorRebound: z.boolean().optional(), panelRebound: z.boolean().optional(),
  panelStateBeforeExpansion: z.enum(["collapsed", "expanded", "unknown"]).optional(),
  panelStateAfterExpansion: z.enum(["settled", "missing", "unstable", "not_attempted"]).optional(),
  freshPreviewDetection: z.enum(["present", "absent_after_settle", "delayed_then_present", "unknown"]).optional(),
  checkpointRead: z.enum(["absent", "valid", "stale", "not_checked"]).optional(),
  checkpointWrite: z.enum(["not_attempted", "persisted", "failed"]).optional(),
  previewCount: z.number().int().min(0).max(1000).optional(), fileInputCount: z.number().int().min(0).max(1000).optional(),
  expectedPromptSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(), currentPromptSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  expectedPromptLength: z.number().int().min(0).max(10_000_000).optional(), currentPromptLength: z.number().int().min(0).max(10_000_000).optional(),
  clearAvailable: z.enum(["unique", "missing", "ambiguous", "not_checked"]).optional(), settledEmpty: z.boolean().optional(),
}).strict();
export type VidsCleanupDiagnostics = z.infer<typeof VidsCleanupDiagnosticsSchema>;
export const VidsResumeRecoveryEvidenceSchema = z.object({
  priorReason: z.string().regex(/^[a-z0-9_]{1,64}$/), verifiedAt: z.number().finite().nonnegative(),
}).strict();
export type VidsVideoQueueItem = {
  itemId: string; order: number; shotId: string; referenceId: string; referenceSha256: string; promptHash: string;
  state: typeof VIDS_VIDEO_QUEUE_ITEM_STATES[number]; reason?: string; attemptId?: string;
  transitionCheckpoint?: VidsVideoTransitionCheckpoint;
  cleanupDiagnostics?: VidsCleanupDiagnostics;
  resumeRecoveryEvidence?: z.infer<typeof VidsResumeRecoveryEvidenceSchema>;
  cleanComposerRecovery?: z.infer<typeof VidsCleanComposerRecoverySchema>;
  dispatchReceipt?: { attemptId: string; storedAt: number };
};
export type VidsVideoQueueRecord = {
  queueId: string; preparedBatchId: string; state: typeof VIDS_VIDEO_QUEUE_STATES[number]; items: VidsVideoQueueItem[];
  revision: number; createdAt: number; updatedAt: number; lastDispatchAt: number | null;
  cooldownDeadlineAt: number | null; readinessDeadlineAt: number | null; readinessStartedAt: number | null;
  nextActionAt: number | null; pauseReason?: string; runId: string;
  executionDocumentRebind?: VidsVideoExecutionRebind;
};
const itemSchema = z.object({ itemId: z.string().min(1).max(256), order: z.number().int().nonnegative(), shotId: z.string().regex(/^[1-9][0-9]*$/), referenceId: z.string().uuid(), referenceSha256: z.string().regex(/^[0-9a-f]{64}$/), promptHash: z.string().regex(/^[0-9a-f]{64}$/), state: z.enum(VIDS_VIDEO_QUEUE_ITEM_STATES), reason: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(), attemptId: z.string().min(1).max(128).optional(), transitionCheckpoint: VidsVideoTransitionCheckpointSchema.optional(), cleanComposerRecovery: VidsCleanComposerRecoverySchema.optional(), cleanupDiagnostics: VidsCleanupDiagnosticsSchema.optional(), resumeRecoveryEvidence: VidsResumeRecoveryEvidenceSchema.optional(), dispatchReceipt: z.object({ attemptId: z.string().min(1).max(128), storedAt: z.number().finite().nonnegative() }).strict().optional() }).strict();
export const VidsVideoQueueRecordSchema = z.object({ queueId: z.string().min(1).max(512), preparedBatchId: z.string().min(1).max(512), state: z.enum(VIDS_VIDEO_QUEUE_STATES), items: z.array(itemSchema).nonempty().max(100), revision: z.number().int().nonnegative(), createdAt: z.number().finite().nonnegative(), updatedAt: z.number().finite().nonnegative(), lastDispatchAt: z.number().finite().nonnegative().nullable(), cooldownDeadlineAt: z.number().finite().nonnegative().nullable(), readinessDeadlineAt: z.number().finite().nonnegative().nullable(), readinessStartedAt: z.number().finite().nonnegative().nullable(), nextActionAt: z.number().finite().nonnegative().nullable(), pauseReason: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(), runId: z.string().min(1).max(128), executionDocumentRebind: VidsVideoExecutionRebindSchema.optional() }).strict().refine((queue) => queue.items.every((item, index) => item.order === index));
