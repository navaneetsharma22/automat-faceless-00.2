import { z } from "zod";

export const MAX_REFERENCE_CAPTURE_BYTES = 12 * 1024 * 1024;
export const MAX_REFERENCE_CAPTURE_PIXELS = 40_000_000;

export const ReferenceAssignmentRecordSchema = z
  .object({
    assignmentId: z.string().min(1).max(512),
    referenceId: z.string().uuid(),
    captureOperationId: z.string().uuid(),
    workspaceId: z.string().min(1).max(128),
    batchId: z.string().min(1).max(256),
    batchSourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    shotId: z.string().regex(/^[1-9][0-9]*$/),
    promptHash: z.string().regex(/^[0-9a-f]{64}$/),
    selectionVersion: z.string().uuid(),
    assignmentVersion: z.number().int().positive(),
    flowProjectId: z.string().min(1).max(512),
    tabId: z.number().int().nonnegative(),
    canonicalTarget: z.string().min(1).max(2048),
    documentId: z.string().min(1).max(256),
    providerAssetId: z.string().min(1).max(256).optional(),
    observedSourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.instanceof(Blob),
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
      "image/gif",
    ]),
    byteSize: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS),
    height: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS),
    capturedAt: z.number().finite().nonnegative(),
    acquisitionProvenance: z.literal(
      "verified_flow_document_same_origin_fetch",
    ),
    qualityProvenance: z.literal("observed_resource_original_bytes_no_upscale"),
  })
  .strict()
  .refine(
    (record) =>
      record.bytes.size === record.byteSize &&
      record.width * record.height <= MAX_REFERENCE_CAPTURE_PIXELS,
  );
export type ReferenceAssignmentRecord = z.infer<
  typeof ReferenceAssignmentRecordSchema
>;

export const ReferenceCaptureOperationRecordSchema = z
  .object({
    captureOperationId: z.string().uuid(),
    workspaceId: z.string().min(1).max(128),
    batchId: z.string().min(1).max(256),
    batchSourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    shotId: z.string().regex(/^[1-9][0-9]*$/),
    promptHash: z.string().regex(/^[0-9a-f]{64}$/),
    selectionVersion: z.string().uuid(),
    expectedAssignmentVersion: z.number().int().nonnegative(),
    flowProjectId: z.string().min(1).max(512),
    tabId: z.number().int().nonnegative(),
    canonicalTarget: z.string().min(1).max(2048),
    documentId: z.string().min(1).max(256),
    observedSourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.enum(["acquiring", "saved", "cancelled", "failed"]),
    reason: z.string().min(1).max(64).optional(),
    startedAt: z.number().finite().nonnegative(),
    completedAt: z.number().finite().nonnegative().optional(),
    referenceId: z.string().uuid().optional(),
  })
  .strict();
export type ReferenceCaptureOperationRecord = z.infer<
  typeof ReferenceCaptureOperationRecordSchema
>;

export function referenceAssignmentId(
  workspaceId: string,
  batchId: string,
  shotId: string,
): string {
  return `${workspaceId}:${batchId}:${shotId}`;
}

export async function sha256Bytes(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data.slice().buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
