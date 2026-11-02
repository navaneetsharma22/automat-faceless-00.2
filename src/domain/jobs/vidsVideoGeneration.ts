import { z } from "zod";

export const VidsVideoGenerationOperationSchema = z.object({
  id: z.string().min(1).max(768),
  preparedBatchId: z.string().min(1).max(512),
  workspaceId: z.string().min(1).max(128),
  itemId: z.string().min(1).max(256),
  canonicalShotId: z.string().regex(/^[1-9][0-9]*$/),
  promptHash: z.string().regex(/^[0-9a-f]{64}$/),
  referenceId: z.string().uuid(),
  referenceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  tabId: z.number().int().nonnegative(),
  canonicalTarget: z.string().min(1).max(2048),
  documentId: z.string().min(1).max(256),
  attemptId: z.string().uuid(),
  status: z.enum(["dispatch_intent", "dispatched", "uncertain", "blocked"]),
  failureStage: z.enum(["preflight", "prompt_entry", "generate_preflight", "activation", "persistence"]).optional(),
  reason: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
  promptReadback: z.object({
    serialization: z.literal("innerText"),
    expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
    actualSha256: z.string().regex(/^[0-9a-f]{64}$/),
    immediateMatch: z.literal(true),
    settledMatch: z.literal(true),
    stableReads: z.number().int().min(3).max(10),
    verifiedAt: z.number().finite().nonnegative(),
  }).strict(),
  activationAttempted: z.boolean(),
  activationCount: z.number().int().min(0).max(1),
  dispatchedAt: z.number().finite().nonnegative().optional(),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
}).strict();

export type VidsVideoGenerationOperation = z.infer<typeof VidsVideoGenerationOperationSchema>;

