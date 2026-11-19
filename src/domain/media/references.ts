import { z } from "zod";

export const MAX_REFERENCE_CAPTURE_BYTES = 12 * 1024 * 1024;
export const MAX_REFERENCE_CAPTURE_PIXELS = 40_000_000;

export const FlowObservedRepresentationSchema = z
  .object({
    sourceKind: z.enum([
      "observed_detail_image",
      "observed_gallery_tile",
      "observed_srcset",
      "observed_detail_link",
      "synthesized_fallback",
    ]),
    suffixCategory: z.enum(["s0", "s1600_rw", "s1600", "s320", "none", "other"]),
    representationKind: z
      .enum(["thumbnail", "full_resolution", "dynamic_derivative", "synthesized", "other"])
      .optional(),
    identityVerified: z.boolean().optional(),
    hasAccountPrefix: z.boolean(),
    matchingAsbToken: z.boolean(),
    matchingMediaUuid: z.boolean(),
    fetchSucceeded: z.boolean(),
    httpStatus: z.number().int().nonnegative().optional(),
    failureReason: z.string().min(1).max(64).optional(),
    mimeType: z.string().min(1).max(64).optional(),
    byteLength: z.number().int().nonnegative().max(MAX_REFERENCE_CAPTURE_BYTES).optional(),
    width: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS).optional(),
    height: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS).optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    sha256Matches: z.boolean().optional(),
  })
  .strict();
export type FlowObservedRepresentation = z.infer<typeof FlowObservedRepresentationSchema>;

export const FlowFallbackDiagnosticSchema = z
  .object({
    attemptedRepresentation: z.enum(["asb_webp_s1600_rw", "gallery_tile", "observed_dom_candidate"]),
    sourceProvenance: z.enum(["observed_dom", "synthesized"]).optional(),
    fetchSucceeded: z.boolean(),
    failureReason: z.string().min(1).max(64).optional(),
    httpStatus: z.number().int().nonnegative().optional(),
    mimeType: z.string().min(1).max(64).optional(),
    byteLength: z.number().int().nonnegative().max(MAX_REFERENCE_CAPTURE_BYTES).optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    sha256Matches: z.boolean().optional(),
    width: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS).optional(),
    height: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS).optional(),
    redirectOriginValid: z.boolean().optional(),
    observedRepresentations: z.array(FlowObservedRepresentationSchema).max(10).optional(),
  })
  .strict();
export type FlowFallbackDiagnostic = z.infer<typeof FlowFallbackDiagnosticSchema>;

/** Safe bounded evidence for an original-byte mismatch; contains no resource URL. */
export const ReferenceByteComparisonDiagnosticSchema = z.object({
  stage: z.enum(["candidate_byte_verification", "read_only_reference_inspection"]),
  acquisitionRoute: z.enum(["verified_document_same_origin", "scoped_extension_fetch", "verified_detail_original_extension_fetch"]),
  preparedSha256: z.string().regex(/^[0-9a-f]{64}$/),
  metadataSha256: z.string().regex(/^[0-9a-f]{64}$/),
  savedBytesSha256: z.string().regex(/^[0-9a-f]{64}$/),
  candidateBytesSha256: z.string().regex(/^[0-9a-f]{64}$/),
  candidateMediaId: z.string().uuid(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]),
  preparedByteSize: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_BYTES),
  savedByteSize: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_BYTES),
  candidateByteSize: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_BYTES),
  preparedWidth: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS),
  preparedHeight: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS),
  candidateWidth: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS).optional(),
  candidateHeight: z.number().int().positive().max(MAX_REFERENCE_CAPTURE_PIXELS).optional(),
  attemptedRepresentation: z.enum(["detail_original", "asb_webp_s1600_rw", "gallery_tile", "observed_dom_candidate"]).optional(),
  representationFailureReason: z.string().min(1).max(64).optional(),
  fallbackDiagnostic: FlowFallbackDiagnosticSchema.optional(),
}).strict();
export type ReferenceByteComparisonDiagnostic = z.infer<typeof ReferenceByteComparisonDiagnosticSchema>;

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
    acquisitionProvenance: z.enum([
      "verified_flow_document_same_origin_fetch",
      "verified_flow_document_extension_fetch",
    ]),
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
  batchSourceHash?: string,
): string {
  // The prompt batch row is mutable per workspace/kind. Include its exact source
  // hash so reimports with reused Shot IDs cannot address another source's row.
  return batchSourceHash
    ? `${workspaceId}:${batchId}:${batchSourceHash}:${shotId}`
    : `${workspaceId}:${batchId}:${shotId}`;
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
