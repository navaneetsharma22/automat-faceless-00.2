import { describe, expect, it } from "vitest";
import {
  validateAndPairVideoShots,
  type ReferenceAssignmentInput,
} from "../../src/domain/batches/pairShots";
import type { PromptBatchSnapshot } from "../../src/storage/repositories";
import type { PromptItemRecord, BatchRecord } from "../../src/storage/db";

function makeReference(
  shotId: string,
  overrides: Partial<ReferenceAssignmentInput> = {},
): ReferenceAssignmentInput {
  const suffix = shotId.padStart(12, "0");
  return {
    assignmentId: `default:import:default:image:${shotId}`,
    referenceId: `00000000-0000-4000-8000-${suffix}`,
    captureOperationId: `10000000-0000-4000-8000-${suffix}`,
    workspaceId: "default",
    batchId: "import:default:image",
    batchSourceHash: "a".repeat(64),
    shotId,
    promptHash: "b".repeat(64),
    selectionVersion: `20000000-0000-4000-8000-${suffix}`,
    assignmentVersion: 1,
    flowProjectId: "project-1",
    tabId: 101,
    canonicalTarget: "https://flow.google.com/project/project-1",
    documentId: "document-1",
    observedSourceSha256: "c".repeat(64),
    mimeType: "image/png",
    byteSize: 1024,
    sha256: "d".repeat(64),
    width: 512,
    height: 512,
    capturedAt: 1000,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch",
    qualityProvenance: "observed_resource_original_bytes_no_upscale",
    ...overrides,
  };
}

function makeVideoBatch(
  items: Array<{ order: number; shotId?: string; rawJsonBody?: string }>,
  workspaceId = "default",
  batchId = "import:default:video",
): PromptBatchSnapshot {
  const itemRecords: PromptItemRecord[] = items.map((it, idx) => ({
    id: `${batchId}:item:${it.order}`,
    batchId,
    workspaceId,
    kind: "video",
    order: it.order,
    shotId: it.shotId,
    rawJsonBody:
      it.rawJsonBody ??
      JSON.stringify({ scene: `Scene ${it.shotId ?? idx + 1}`, duration: 5 }),
    sourceSpan: { start: 0, end: 100 },
    measurement: { stringCodeUnits: 100, utf8Bytes: 100 },
    contentHash: `hash-${it.order}-${it.shotId ?? "none"}`,
    createdAt: 1000,
  }));

  const batchRecord: BatchRecord = {
    id: batchId,
    workflowId: workspaceId,
    workspaceId,
    kind: "video",
    status: "draft",
    sourceText: "synthetic-source-text",
    sourceMode: "numbered_json_blocks",
    orderedItemIds: itemRecords.map((i) => i.id),
    total: { stringCodeUnits: 300, utf8Bytes: 300 },
    updatedAt: 1000,
  };

  return {
    batch: batchRecord,
    items: itemRecords,
  };
}

describe("P08.2 validateAndPairVideoShots", () => {
  it("reversed reference order still produces correct Shot pairs in original video order", () => {
    const videoBatch = makeVideoBatch([
      { order: 0, shotId: "1", rawJsonBody: '{"shot":1,"scene":"first"}' },
      { order: 1, shotId: "2", rawJsonBody: '{"shot":2,"scene":"second"}' },
      { order: 2, shotId: "3", rawJsonBody: '{"shot":3,"scene":"third"}' },
    ]);

    // References ordered 3, 2, 1
    const references = [
      makeReference("3", { byteSize: 300 }),
      makeReference("2", { byteSize: 200 }),
      makeReference("1", { byteSize: 100 }),
    ];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: "a".repeat(64),
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(true);
    expect(result.totalVideoShots).toBe(3);
    expect(result.matchedPairCount).toBe(3);
    expect(result.invalidPairCount).toBe(0);
    expect(result.unusedReferenceCount).toBe(0);

    // Verify order is preserved: item 0 -> Shot 1, item 1 -> Shot 2, item 2 -> Shot 3
    expect(result.pairs[0]?.canonicalShotId).toBe("1");
    expect(result.pairs[0]?.reference?.byteSize).toBe(100);
    expect(result.pairs[0]?.rawJsonBody).toBe('{"shot":1,"scene":"first"}');

    expect(result.pairs[1]?.canonicalShotId).toBe("2");
    expect(result.pairs[1]?.reference?.byteSize).toBe(200);
    expect(result.pairs[1]?.rawJsonBody).toBe('{"shot":2,"scene":"second"}');

    expect(result.pairs[2]?.canonicalShotId).toBe("3");
    expect(result.pairs[2]?.reference?.byteSize).toBe(300);
    expect(result.pairs[2]?.rawJsonBody).toBe('{"shot":3,"scene":"third"}');
  });

  it("3 video Shots with 10 references produce exactly 3 intended pairs with 7 unused references", () => {
    const videoBatch = makeVideoBatch([
      { order: 0, shotId: "2" },
      { order: 1, shotId: "5" },
      { order: 2, shotId: "8" },
    ]);

    // 10 references: Shot 1 through Shot 10
    const references = Array.from({ length: 10 }, (_, i) =>
      makeReference(String(i + 1)),
    );

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: "a".repeat(64),
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(true);
    expect(result.totalVideoShots).toBe(3);
    expect(result.matchedPairCount).toBe(3);
    expect(result.invalidPairCount).toBe(0);
    expect(result.unusedReferenceCount).toBe(7);

    // Extra references remain unchanged and nonblocking
    expect(result.unusedReferences.map((r) => r.canonicalShotId)).toEqual([
      "1",
      "3",
      "4",
      "6",
      "7",
      "9",
      "10",
    ]);

    // Pairs match exactly the 3 video shots in their original execution order
    expect(result.pairs.map((p) => p.canonicalShotId)).toEqual(["2", "5", "8"]);
    expect(result.pairs.every((p) => p.status === "valid")).toBe(true);
  });

  it("handles canonical ID behavior correctly including 01 versus 1", () => {
    // Video has "01" and "007"
    const videoBatch = makeVideoBatch([
      { order: 0, shotId: "01" },
      { order: 1, shotId: "007" },
    ]);

    // References have "1" and "7"
    const references = [makeReference("1"), makeReference("7")];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: "a".repeat(64),
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(true);
    expect(result.pairs[0]?.canonicalShotId).toBe("1");
    expect(result.pairs[0]?.declaredShotId).toBe("01");
    expect(result.pairs[0]?.status).toBe("valid");

    expect(result.pairs[1]?.canonicalShotId).toBe("7");
    expect(result.pairs[1]?.declaredShotId).toBe("007");
    expect(result.pairs[1]?.status).toBe("valid");
  });

  it("reference with leading zeroes matches video with stripped ID", () => {
    const videoBatch = makeVideoBatch([{ order: 0, shotId: "1" }]);
    const references = [makeReference("01" as unknown as string)];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: "a".repeat(64),
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(true);
    expect(result.pairs[0]?.canonicalShotId).toBe("1");
    expect(result.pairs[0]?.status).toBe("valid");
  });

  it("reports missing_video_shot_id when a video prompt lacks a shotId", () => {
    const videoBatch = makeVideoBatch([
      { order: 0, shotId: "1" },
      { order: 1, shotId: undefined },
    ]);
    const references = [makeReference("1")];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(false);
    expect(result.invalidPairCount).toBe(1);
    expect(result.matchedPairCount).toBe(1);
    expect(result.pairs[1]?.status).toBe("invalid");
    expect(result.pairs[1]?.issue).toEqual({
      code: "missing_video_shot_id",
      message: "Video prompt is missing an explicit Shot ID.",
    });
  });

  it("reports duplicate_video_shot_id when batch contains duplicate canonical shot IDs", () => {
    // Collision between "1" and "01"
    const videoBatch = makeVideoBatch([
      { order: 0, shotId: "1" },
      { order: 1, shotId: "01" },
    ]);
    const references = [makeReference("1")];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(false);
    expect(result.invalidPairCount).toBe(2);
    expect(result.pairs[0]?.issue?.code).toBe("duplicate_video_shot_id");
    expect(result.pairs[1]?.issue?.code).toBe("duplicate_video_shot_id");
  });

  it("reports missing_saved_reference when no assignment exists for a video Shot", () => {
    const videoBatch = makeVideoBatch([{ order: 0, shotId: "42" }]);
    const references = [makeReference("1")];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(false);
    expect(result.pairs[0]?.status).toBe("invalid");
    expect(result.pairs[0]?.issue).toEqual({
      code: "missing_saved_reference",
      message: 'No saved reference assignment found for Shot ID "42".',
    });
  });

  it("rejects reference with same Shot ID from another workspace", () => {
    const videoBatch = makeVideoBatch([{ order: 0, shotId: "1" }]);
    const references = [makeReference("1", { workspaceId: "other-workspace" })];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(false);
    expect(result.pairs[0]?.status).toBe("invalid");
    expect(result.pairs[0]?.issue?.code).toBe("wrong_workspace_binding");
  });

  it("rejects reference with same Shot ID from another image source batch", () => {
    const videoBatch = makeVideoBatch([{ order: 0, shotId: "1" }]);
    const references = [
      makeReference("1", { batchId: "import:default:different-image-batch" }),
    ];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(false);
    expect(result.pairs[0]?.status).toBe("invalid");
    expect(result.pairs[0]?.issue?.code).toBe("wrong_source_binding");
  });

  it("reports duplicate_conflicting_reference when multiple assignments exist for the same Shot", () => {
    const videoBatch = makeVideoBatch([{ order: 0, shotId: "1" }]);
    const references = [
      makeReference("1", {
        referenceId: "11111111-1111-4111-8111-111111111111",
      }),
      makeReference("1", {
        referenceId: "22222222-2222-4222-8222-222222222222",
      }),
    ];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(false);
    expect(result.pairs[0]?.status).toBe("invalid");
    expect(result.pairs[0]?.issue?.code).toBe(
      "duplicate_conflicting_reference",
    );
  });

  it("reports stale_assignment when reference batchSourceHash does not match imageSourceBatchHash", () => {
    const videoBatch = makeVideoBatch([{ order: 0, shotId: "1" }]);
    const references = [
      makeReference("1", { batchSourceHash: "f".repeat(64) }),
    ];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: "a".repeat(64), // Mismatch
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(false);
    expect(result.pairs[0]?.status).toBe("invalid");
    expect(result.pairs[0]?.issue?.code).toBe("stale_assignment");
  });

  it("reports invalid_media_metadata when reference has corrupt or out-of-bounds media metadata", () => {
    const videoBatch = makeVideoBatch([{ order: 0, shotId: "1" }]);

    // Invalid byteSize (<= 0)
    const badByteSize = [makeReference("1", { byteSize: 0 })];
    let result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      referenceAssignments: badByteSize,
    });
    expect(result.pairs[0]?.issue?.code).toBe("invalid_media_metadata");

    // Invalid dimensions exceeding MAX_REFERENCE_CAPTURE_PIXELS
    const badDimensions = [
      makeReference("1", { width: 50_000_000, height: 1 }),
    ];
    result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      referenceAssignments: badDimensions,
    });
    expect(result.pairs[0]?.issue?.code).toBe("invalid_media_metadata");

    // Invalid sha256 (not 64 hex characters)
    const badHash = [makeReference("1", { sha256: "not-a-hash" })];
    result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      referenceAssignments: badHash,
    });
    expect(result.pairs[0]?.issue?.code).toBe("invalid_media_metadata");

    // Invalid MIME type
    const badMime = [
      makeReference("1", {
        mimeType:
          "application/pdf" as unknown as ReferenceAssignmentInput["mimeType"],
      }),
    ];
    result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      referenceAssignments: badMime,
    });
    expect(result.pairs[0]?.issue?.code).toBe("invalid_media_metadata");
  });

  it("preserves exact rawJsonBody and prompt hash without copying full image bytes into pairs", () => {
    const rawJson =
      '{\n  "scene": "Preserve exact spaces and newlines",\n  "shot_id": 1\n}';
    const contentHash =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    const videoBatch = makeVideoBatch([
      { order: 0, shotId: "1", rawJsonBody: rawJson },
    ]);
    videoBatch.items[0]!.contentHash = contentHash;

    const references = [makeReference("1")];

    const result = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: "a".repeat(64),
      referenceAssignments: references,
    });

    expect(result.batchValid).toBe(true);
    const pair = result.pairs[0]!;
    expect(pair.rawJsonBody).toBe(rawJson);
    expect(pair.contentHash).toBe(contentHash);
    expect(pair.status).toBe("valid");

    // Carries reference metadata but NOT full Blob bytes
    expect(pair.reference).toBeDefined();
    expect(pair.reference?.referenceId).toBe(references[0]!.referenceId);
    expect(pair.reference?.sha256).toBe(references[0]!.sha256);
    expect((pair as Record<string, unknown>).bytes).toBeUndefined();
    expect(
      (pair.reference as unknown as Record<string, unknown>).bytes,
    ).toBeUndefined();
  });
});
