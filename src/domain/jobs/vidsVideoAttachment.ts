import { z } from "zod";
import { MAX_REFERENCE_CAPTURE_BYTES, MAX_REFERENCE_CAPTURE_PIXELS } from "../media/references";

export const VidsVideoAttachmentOperationSchema = z.object({
  id: z.string().min(1).max(768),
  preparedBatchId: z.string().min(1).max(512),
  workspaceId: z.string().min(1).max(128),
  itemId: z.string().min(1).max(256),
  shotId: z.string().regex(/^[1-9][0-9]*$/),
  referenceId: z.string().uuid(),
  assignmentVersion: z.number().int().positive(),
  referenceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  mimeType: z.enum(["image/png", "image/jpeg"]),
  byteSize: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_BYTES),
  width: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS),
  height: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS),
  tabId: z.number().int().nonnegative(),
  canonicalTarget: z.string().min(1).max(2048),
  documentId: z.string().min(1).max(256),
  status: z.enum(["action_intent", "attached", "uncertain"]),
  failureStage: z.enum(["preflight", "upload", "target_revalidation", "persistence"]).optional(),
  reason: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
  uploadEvidence: z.object({
    mechanism: z.literal("verified_document_file_input"),
    exactBytesSha256: z.string().regex(/^[0-9a-f]{64}$/),
    byteSize: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_BYTES),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    fileInputCount: z.literal(1),
    inputChangeDispatched: z.literal(true),
    previewLoaded: z.literal(true),
    previewWidth: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS),
    previewHeight: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS),
    removalControlPresent: z.literal(true),
    uploadOperationId: z.string().uuid(),
    uploadedAt: z.number().finite().nonnegative(),
  }).strict().optional(),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
}).strict();

export type VidsVideoAttachmentOperation = z.infer<typeof VidsVideoAttachmentOperationSchema>;
