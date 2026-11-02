import { describe, expect, it } from "vitest";
import {
  ExtensionRepositories,
  sha256Hex,
} from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import { validateAndPairVideoShots } from "../../src/domain/batches/pairShots";
import type { ReferenceAssignmentRecord } from "../../src/domain/media/references";
import { referenceAssignmentId } from "../../src/domain/media/references";

function makeReferenceRecord(
  shotId: string,
  overrides: Partial<ReferenceAssignmentRecord> = {},
): ReferenceAssignmentRecord {
  const suffix = shotId.padStart(12, "0");
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const blob = new Blob([bytes], { type: "image/png" });
  const batchSourceHash = overrides.batchSourceHash ?? "a".repeat(64);

  return {
    assignmentId: referenceAssignmentId("default", "import:default:image", shotId, batchSourceHash),
    referenceId: `00000000-0000-4000-8000-${suffix}`,
    captureOperationId: `10000000-0000-4000-8000-${suffix}`,
    workspaceId: "default",
    batchId: "import:default:image",
    batchSourceHash,
    shotId,
    promptHash: "b".repeat(64),
    selectionVersion: `20000000-0000-4000-8000-${suffix}`,
    assignmentVersion: 1,
    flowProjectId: "project-1",
    tabId: 101,
    canonicalTarget: "https://flow.google.com/project/project-1",
    documentId: "document-1",
    providerAssetId: `media-asset-${shotId}`,
    observedSourceSha256: "c".repeat(64),
    bytes: blob,
    mimeType: "image/png",
    byteSize: 8,
    sha256: "d".repeat(64),
    width: 256,
    height: 256,
    capturedAt: 10_000,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch",
    qualityProvenance: "observed_resource_original_bytes_no_upscale",
    ...overrides,
  };
}

describe("P08.2 video pairing integration with production repositories", () => {
  it("persists video batch and reference assignments, retaining exact associations on reload", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 10_000);

    const videoSource = [
      '1: { "scene": "Opening drone shot over mountains", "duration": 4 }',
      '2: { "scene": "Close-up of protagonist eyes", "duration": 2 }',
      '3: { "scene": "Wide tracking shot through forest", "duration": 6 }',
    ].join("\n\n");

    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSource,
    });

    const imageSourceHash = "a".repeat(64);
    const ref1 = makeReferenceRecord("1", { batchSourceHash: imageSourceHash });
    const ref2 = makeReferenceRecord("2", { batchSourceHash: imageSourceHash });
    const ref3 = makeReferenceRecord("3", { batchSourceHash: imageSourceHash });

    await database.referenceAssignments.put(ref1);
    await database.referenceAssignments.put(ref2);
    await database.referenceAssignments.put(ref3);

    // Reload from repository fresh
    const reloadedVideoBatch = await repositories.getPromptBatch(
      "default",
      "video",
    );
    expect(reloadedVideoBatch).toBeDefined();

    const storedRefs = await repositories.listReferenceAssignments(
      "default",
      "import:default:image",
    );
    expect(storedRefs).toHaveLength(3);

    const pairing = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch: reloadedVideoBatch!,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: imageSourceHash,
      referenceAssignments: storedRefs,
    });

    expect(pairing.batchValid).toBe(true);
    expect(pairing.totalVideoShots).toBe(3);
    expect(pairing.matchedPairCount).toBe(3);
    expect(pairing.invalidPairCount).toBe(0);

    // Exact raw body preservation
    expect(pairing.pairs[0]?.rawJsonBody).toBe(
      '{ "scene": "Opening drone shot over mountains", "duration": 4 }',
    );
    expect(pairing.pairs[0]?.contentHash).toBe(
      await sha256Hex(pairing.pairs[0]!.rawJsonBody),
    );
    expect(pairing.pairs[0]?.reference?.referenceId).toBe(ref1.referenceId);

    expect(pairing.pairs[1]?.rawJsonBody).toBe(
      '{ "scene": "Close-up of protagonist eyes", "duration": 2 }',
    );
    expect(pairing.pairs[1]?.reference?.referenceId).toBe(ref2.referenceId);

    expect(pairing.pairs[2]?.rawJsonBody).toBe(
      '{ "scene": "Wide tracking shot through forest", "duration": 6 }',
    );
    expect(pairing.pairs[2]?.reference?.referenceId).toBe(ref3.referenceId);
  });

  it("reference replacement updates only the appropriate review row and preserves other rows", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 10_000);

    const videoSource = [
      '1: { "scene": "Shot one" }',
      '2: { "scene": "Shot two" }',
      '3: { "scene": "Shot three" }',
    ].join("\n\n");

    const savedVideoBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSource,
    });

    const imageSourceHash = "a".repeat(64);
    const ref1 = makeReferenceRecord("1", {
      batchSourceHash: imageSourceHash,
      referenceId: "11111111-0000-4000-8000-000000000001",
    });
    const ref2 = makeReferenceRecord("2", {
      batchSourceHash: imageSourceHash,
      referenceId: "22222222-0000-4000-8000-000000000002",
      assignmentVersion: 1,
    });
    const ref3 = makeReferenceRecord("3", {
      batchSourceHash: imageSourceHash,
      referenceId: "33333333-0000-4000-8000-000000000003",
    });

    await database.referenceAssignments.put(ref1);
    await database.referenceAssignments.put(ref2);
    await database.referenceAssignments.put(ref3);

    // Initial pairing check
    let storedRefs = await repositories.listReferenceAssignments(
      "default",
      "import:default:image",
    );
    let pairing = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch: savedVideoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: imageSourceHash,
      referenceAssignments: storedRefs,
    });
    expect(pairing.pairs[1]?.reference?.referenceId).toBe(ref2.referenceId);
    expect(pairing.pairs[1]?.reference?.assignmentVersion).toBe(1);

    // User replaces reference for Shot 2 on References page:
    const replacedRef2 = makeReferenceRecord("2", {
      batchSourceHash: imageSourceHash,
      referenceId: "99999999-9999-4999-8999-999999999999",
      assignmentVersion: 2,
      sha256: "e".repeat(64),
      byteSize: 16,
      bytes: new Blob([new Uint8Array(16)], { type: "image/png" }),
    });
    await database.referenceAssignments.put(replacedRef2);

    // Re-query and recompute pairing
    storedRefs = await repositories.listReferenceAssignments(
      "default",
      "import:default:image",
    );
    pairing = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch: savedVideoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: imageSourceHash,
      referenceAssignments: storedRefs,
    });

    // Row 1 and Row 3 remain completely unchanged
    expect(pairing.pairs[0]?.canonicalShotId).toBe("1");
    expect(pairing.pairs[0]?.reference?.referenceId).toBe(ref1.referenceId);

    expect(pairing.pairs[2]?.canonicalShotId).toBe("3");
    expect(pairing.pairs[2]?.reference?.referenceId).toBe(ref3.referenceId);

    // Only Row 2 updated
    expect(pairing.pairs[1]?.canonicalShotId).toBe("2");
    expect(pairing.pairs[1]?.reference?.referenceId).toBe(
      "99999999-9999-4999-8999-999999999999",
    );
    expect(pairing.pairs[1]?.reference?.assignmentVersion).toBe(2);
    expect(pairing.pairs[1]?.reference?.sha256).toBe("e".repeat(64));
    expect(pairing.pairs[1]?.reference?.byteSize).toBe(16);
  });

  it("transient selection candidate does not affect saved reference pairing", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 10_000);

    const videoSource = '1: { "scene": "Hero entrance" }';
    const savedVideoBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSource,
    });

    const imageSourceHash = "a".repeat(64);
    const savedRef1 = makeReferenceRecord("1", {
      batchSourceHash: imageSourceHash,
      referenceId: "11111111-0000-4000-8000-000000000001",
    });
    await database.referenceAssignments.put(savedRef1);

    // A transient candidate is present in session storage or stateData.candidates, but NOT saved
    const transientCandidates = {
      "1": {
        candidateId: "candidate-transient-1",
        sourceUrl: "https://example.test/transient.png",
      },
    };

    // The saved references loaded from database are passed to pairing
    const storedRefs = await repositories.listReferenceAssignments(
      "default",
      "import:default:image",
    );

    const pairing = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch: savedVideoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: imageSourceHash,
      referenceAssignments: storedRefs,
    });

    expect(pairing.batchValid).toBe(true);
    expect(pairing.pairs[0]?.reference?.referenceId).toBe(
      savedRef1.referenceId,
    );
    expect(
      (pairing.pairs[0]?.reference as unknown as Record<string, unknown>)
        .candidateId,
    ).toBeUndefined();

    // Clearing transient candidate in UI has zero impact on saved pairing
    delete transientCandidates["1"];
    const pairingAfterClear = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch: savedVideoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: imageSourceHash,
      referenceAssignments: storedRefs,
    });
    expect(pairingAfterClear.pairs[0]?.reference?.referenceId).toBe(
      savedRef1.referenceId,
    );
  });

  it("detects stale reference assignments when image source text changes", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 10_000);

    const videoSource = '1: { "scene": "Sunrise" }';
    const videoBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSource,
    });

    const oldHash = "1".repeat(64);
    const newHash = "2".repeat(64);

    const ref = makeReferenceRecord("1", { batchSourceHash: oldHash });
    await database.referenceAssignments.put(ref);

    const storedRefs = await repositories.listReferenceAssignments(
      "default",
      "import:default:image",
    );

    // When pairing against the new source hash, the old assignment is flagged as stale
    const pairing = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: newHash,
      referenceAssignments: storedRefs,
    });

    expect(pairing.batchValid).toBe(false);
    expect(pairing.pairs[0]?.status).toBe("invalid");
    expect(pairing.pairs[0]?.issue?.code).toBe("stale_assignment");
  });

  it("handles reversed database ordering and extra saved references seamlessly", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 10_000);

    // 2 video shots: 10 and 20
    const videoSource = [
      '10: { "scene": "Shot ten" }',
      '20: { "scene": "Shot twenty" }',
    ].join("\n\n");
    const videoBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSource,
    });

    const hash = "a".repeat(64);

    // 5 references inserted in random/reverse order: 30, 20, 10, 5, 1
    const refs = [
      makeReferenceRecord("30", { batchSourceHash: hash }),
      makeReferenceRecord("20", { batchSourceHash: hash }),
      makeReferenceRecord("10", { batchSourceHash: hash }),
      makeReferenceRecord("5", { batchSourceHash: hash }),
      makeReferenceRecord("1", { batchSourceHash: hash }),
    ];
    for (const r of refs) {
      await database.referenceAssignments.put(r);
    }

    const storedRefs = await repositories.listReferenceAssignments(
      "default",
      "import:default:image",
    );

    const pairing = validateAndPairVideoShots({
      workspaceId: "default",
      videoBatch,
      imageSourceBatchId: "import:default:image",
      imageSourceBatchHash: hash,
      referenceAssignments: storedRefs,
    });

    expect(pairing.batchValid).toBe(true);
    expect(pairing.totalVideoShots).toBe(2);
    expect(pairing.matchedPairCount).toBe(2);
    expect(pairing.unusedReferenceCount).toBe(3);

    // Execution order preserved: Shot 10 first, then Shot 20
    expect(pairing.pairs[0]?.canonicalShotId).toBe("10");
    expect(pairing.pairs[1]?.canonicalShotId).toBe("20");

    // Unused sorted numerically
    expect(pairing.unusedReferences.map((u) => u.canonicalShotId)).toEqual([
      "1",
      "5",
      "30",
    ]);
  });
});
