import { canonicalizeShotId } from "./inputPolicy";
import type { PromptItemRecord } from "../../storage/db";
import type { PromptBatchSnapshot } from "../../storage/repositories";
import {
  type ReferenceAssignmentRecord,
  MAX_REFERENCE_CAPTURE_BYTES,
  MAX_REFERENCE_CAPTURE_PIXELS,
} from "../media/references";

export type PairingIssueCode =
  | "missing_video_shot_id"
  | "duplicate_video_shot_id"
  | "missing_saved_reference"
  | "duplicate_conflicting_reference"
  | "wrong_workspace_binding"
  | "wrong_source_binding"
  | "invalid_media_metadata"
  | "stale_assignment";

export type VideoPairValidationIssue = {
  code: PairingIssueCode;
  message: string;
};

export type MatchedReferenceMetadata = {
  referenceId: string;
  assignmentVersion: number;
  sha256: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  capturedAt: number;
};

export type VideoShotPair = {
  itemId: string;
  order: number;
  canonicalShotId?: string;
  declaredShotId?: string;
  rawJsonBody: string;
  contentHash: string;
  status: "valid" | "invalid";
  issue?: VideoPairValidationIssue;
  reference?: MatchedReferenceMetadata;
};

export type UnusedSavedReference = {
  canonicalShotId: string;
  referenceId: string;
  assignmentVersion: number;
  sha256: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
};

export type BatchPairingResult = {
  workspaceId: string;
  videoBatchId: string;
  imageSourceBatchId: string;
  batchValid: boolean;
  totalVideoShots: number;
  matchedPairCount: number;
  invalidPairCount: number;
  unusedReferenceCount: number;
  pairs: VideoShotPair[];
  unusedReferences: UnusedSavedReference[];
};

export type ReferenceAssignmentInput =
  ReferenceAssignmentRecord | Omit<ReferenceAssignmentRecord, "bytes">;

export type PairShotsInput = {
  workspaceId: string;
  videoBatch: PromptBatchSnapshot;
  imageSourceBatchId: string;
  imageSourceBatchHash?: string;
  referenceAssignments: readonly ReferenceAssignmentInput[];
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_REGEX = /^[0-9a-f]{64}$/i;
const VALID_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
]);

export function isValidMediaMetadata(
  record: ReferenceAssignmentInput,
): boolean {
  if (
    !record.referenceId ||
    typeof record.referenceId !== "string" ||
    !UUID_REGEX.test(record.referenceId)
  ) {
    return false;
  }
  if (
    !record.sha256 ||
    typeof record.sha256 !== "string" ||
    !SHA256_REGEX.test(record.sha256)
  ) {
    return false;
  }
  if (!VALID_MIME_TYPES.has(record.mimeType)) {
    return false;
  }
  if (
    typeof record.byteSize !== "number" ||
    !Number.isInteger(record.byteSize) ||
    record.byteSize <= 0 ||
    record.byteSize > MAX_REFERENCE_CAPTURE_BYTES
  ) {
    return false;
  }
  if (
    typeof record.width !== "number" ||
    !Number.isInteger(record.width) ||
    record.width <= 0 ||
    record.width > MAX_REFERENCE_CAPTURE_PIXELS
  ) {
    return false;
  }
  if (
    typeof record.height !== "number" ||
    !Number.isInteger(record.height) ||
    record.height <= 0 ||
    record.height > MAX_REFERENCE_CAPTURE_PIXELS
  ) {
    return false;
  }
  if (record.width * record.height > MAX_REFERENCE_CAPTURE_PIXELS) {
    return false;
  }
  if (
    typeof record.assignmentVersion !== "number" ||
    !Number.isInteger(record.assignmentVersion) ||
    record.assignmentVersion < 1
  ) {
    return false;
  }
  if (
    typeof record.capturedAt !== "number" ||
    !Number.isFinite(record.capturedAt) ||
    record.capturedAt < 0
  ) {
    return false;
  }
  if (
    "bytes" in record &&
    record.bytes instanceof Blob &&
    record.bytes.size !== record.byteSize
  ) {
    return false;
  }
  return true;
}

/**
 * Pure, deterministic pairing validator joining imported video shots
 * to verified saved reference assignments by (workspaceId, selectedImageSourceBatchId, canonicalShotId).
 */
export function validateAndPairVideoShots(
  input: PairShotsInput,
): BatchPairingResult {
  const {
    workspaceId,
    videoBatch,
    imageSourceBatchId,
    imageSourceBatchHash,
    referenceAssignments,
  } = input;

  const items = videoBatch.items ?? [];
  const videoBatchId = videoBatch.batch?.id ?? `import:${workspaceId}:video`;

  // 1. Canonicalize each video shot ID and count frequencies to detect duplicates
  const videoShotCounts = new Map<string, number>();
  const normalizedItems = items.map((item: PromptItemRecord) => {
    const declaredShotId = item.shotId;
    const canonicalShotId = canonicalizeShotId(declaredShotId);
    if (canonicalShotId) {
      videoShotCounts.set(
        canonicalShotId,
        (videoShotCounts.get(canonicalShotId) ?? 0) + 1,
      );
    }
    return {
      item,
      declaredShotId,
      canonicalShotId,
    };
  });

  // 2. Index reference assignments by canonical Shot ID
  // Match strictly on (workspaceId, imageSourceBatchId)
  const matchedAssignments = new Map<string, ReferenceAssignmentInput[]>();
  const otherAssignments = new Map<string, ReferenceAssignmentInput[]>();

  for (const ref of referenceAssignments) {
    const canonical = canonicalizeShotId(ref.shotId);
    if (!canonical) continue;

    if (ref.workspaceId === workspaceId && ref.batchId === imageSourceBatchId) {
      const existing = matchedAssignments.get(canonical) ?? [];
      existing.push(ref);
      matchedAssignments.set(canonical, existing);
    } else {
      const existing = otherAssignments.get(canonical) ?? [];
      existing.push(ref);
      otherAssignments.set(canonical, existing);
    }
  }

  // Set of canonical video shot IDs to track which references are used
  const usedCanonicalShotIds = new Set<string>();

  // 3. Process video shots in their original execution order
  const pairs: VideoShotPair[] = normalizedItems.map(
    ({ item, declaredShotId, canonicalShotId }) => {
      // Missing video shot identity
      if (!canonicalShotId) {
        return {
          itemId: item.id,
          order: item.order,
          declaredShotId,
          rawJsonBody: item.rawJsonBody,
          contentHash: item.contentHash,
          status: "invalid",
          issue: {
            code: "missing_video_shot_id",
            message: "Video prompt is missing an explicit Shot ID.",
          },
        };
      }

      // Duplicate canonical video shot identity
      if ((videoShotCounts.get(canonicalShotId) ?? 0) > 1) {
        return {
          itemId: item.id,
          order: item.order,
          canonicalShotId,
          declaredShotId,
          rawJsonBody: item.rawJsonBody,
          contentHash: item.contentHash,
          status: "invalid",
          issue: {
            code: "duplicate_video_shot_id",
            message: `Duplicate video Shot ID "${canonicalShotId}" in batch.`,
          },
        };
      }

      usedCanonicalShotIds.add(canonicalShotId);

      const applicable = matchedAssignments.get(canonicalShotId) ?? [];

      // No assignment for this workspace and image source
      if (applicable.length === 0) {
        const others = otherAssignments.get(canonicalShotId) ?? [];
        if (others.length > 0) {
          const wrongWorkspace = others.find(
            (o) => o.workspaceId !== workspaceId,
          );
          if (wrongWorkspace) {
            return {
              itemId: item.id,
              order: item.order,
              canonicalShotId,
              declaredShotId,
              rawJsonBody: item.rawJsonBody,
              contentHash: item.contentHash,
              status: "invalid",
              issue: {
                code: "wrong_workspace_binding",
                message: `Reference assignment belongs to a different workspace ("${wrongWorkspace.workspaceId}" vs "${workspaceId}").`,
              },
            };
          }
          const wrongSource = others.find(
            (o) => o.batchId !== imageSourceBatchId,
          );
          if (wrongSource) {
            return {
              itemId: item.id,
              order: item.order,
              canonicalShotId,
              declaredShotId,
              rawJsonBody: item.rawJsonBody,
              contentHash: item.contentHash,
              status: "invalid",
              issue: {
                code: "wrong_source_binding",
                message: `Reference assignment belongs to a different image source ("${wrongSource.batchId}" vs "${imageSourceBatchId}").`,
              },
            };
          }
        }

        return {
          itemId: item.id,
          order: item.order,
          canonicalShotId,
          declaredShotId,
          rawJsonBody: item.rawJsonBody,
          contentHash: item.contentHash,
          status: "invalid",
          issue: {
            code: "missing_saved_reference",
            message: `No saved reference assignment found for Shot ID "${canonicalShotId}".`,
          },
        };
      }

      // Conflicting/multiple assignments for the same shot ID
      if (applicable.length > 1) {
        return {
          itemId: item.id,
          order: item.order,
          canonicalShotId,
          declaredShotId,
          rawJsonBody: item.rawJsonBody,
          contentHash: item.contentHash,
          status: "invalid",
          issue: {
            code: "duplicate_conflicting_reference",
            message: `Conflicting reference assignments found for Shot ID "${canonicalShotId}".`,
          },
        };
      }

      const assignment = applicable[0]!;

      // Stale saved-source / assignment state
      if (
        imageSourceBatchHash &&
        assignment.batchSourceHash &&
        assignment.batchSourceHash !== imageSourceBatchHash
      ) {
        return {
          itemId: item.id,
          order: item.order,
          canonicalShotId,
          declaredShotId,
          rawJsonBody: item.rawJsonBody,
          contentHash: item.contentHash,
          status: "invalid",
          issue: {
            code: "stale_assignment",
            message:
              "Reference assignment belongs to an older version of the image batch source.",
          },
        };
      }

      // Invalid media metadata
      if (!isValidMediaMetadata(assignment)) {
        return {
          itemId: item.id,
          order: item.order,
          canonicalShotId,
          declaredShotId,
          rawJsonBody: item.rawJsonBody,
          contentHash: item.contentHash,
          status: "invalid",
          issue: {
            code: "invalid_media_metadata",
            message:
              "Reference assignment media metadata is missing or invalid.",
          },
        };
      }

      // Valid pair
      const matchedRef: MatchedReferenceMetadata = {
        referenceId: assignment.referenceId,
        assignmentVersion: assignment.assignmentVersion,
        sha256: assignment.sha256,
        mimeType: assignment.mimeType,
        byteSize: assignment.byteSize,
        width: assignment.width,
        height: assignment.height,
        capturedAt: assignment.capturedAt,
      };

      return {
        itemId: item.id,
        order: item.order,
        canonicalShotId,
        declaredShotId,
        rawJsonBody: item.rawJsonBody,
        contentHash: item.contentHash,
        status: "valid",
        reference: matchedRef,
      };
    },
  );

  // 4. Collect unused references (belonging to this workspace and image source)
  const unusedReferences: UnusedSavedReference[] = [];
  for (const [canonical, refs] of matchedAssignments.entries()) {
    if (!usedCanonicalShotIds.has(canonical)) {
      for (const ref of refs) {
        if (isValidMediaMetadata(ref)) {
          unusedReferences.push({
            canonicalShotId: canonical,
            referenceId: ref.referenceId,
            assignmentVersion: ref.assignmentVersion,
            sha256: ref.sha256,
            mimeType: ref.mimeType,
            byteSize: ref.byteSize,
            width: ref.width,
            height: ref.height,
          });
        }
      }
    }
  }

  // Sort unused references numerically by canonical Shot ID
  unusedReferences.sort((a, b) => {
    const na = BigInt(a.canonicalShotId);
    const nb = BigInt(b.canonicalShotId);
    return na < nb ? -1 : na > nb ? 1 : 0;
  });

  const matchedPairCount = pairs.filter((p) => p.status === "valid").length;
  const invalidPairCount = pairs.filter((p) => p.status === "invalid").length;
  const totalVideoShots = pairs.length;
  const batchValid = totalVideoShots > 0 && invalidPairCount === 0;

  return {
    workspaceId,
    videoBatchId,
    imageSourceBatchId,
    batchValid,
    totalVideoShots,
    matchedPairCount,
    invalidPairCount,
    unusedReferenceCount: unusedReferences.length,
    pairs,
    unusedReferences,
  };
}
