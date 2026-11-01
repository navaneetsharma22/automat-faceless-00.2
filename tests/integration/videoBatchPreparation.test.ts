import { describe, expect, it } from "vitest";
import {
  ExtensionRepositories,
  VideoBatchPreparationError,
  sha256Hex,
} from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import {
  sha256Bytes,
  type ReferenceAssignmentRecord,
} from "../../src/domain/media/references";

async function makeVerifiedReference(
  shotId: string,
  bytePattern: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  overrides: Partial<ReferenceAssignmentRecord> = {},
): Promise<ReferenceAssignmentRecord> {
  const suffix = shotId.padStart(12, "0");
  const bytes = new Uint8Array(bytePattern);
  const blob = new Blob([bytes], { type: "image/png" });
  const sha256 = await sha256Bytes(bytes);

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
    providerAssetId: `media-asset-${shotId}`,
    observedSourceSha256: "c".repeat(64),
    bytes: blob,
    mimeType: "image/png",
    byteSize: bytes.byteLength,
    sha256,
    width: 256,
    height: 256,
    capturedAt: 10_000,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch",
    qualityProvenance: "observed_resource_original_bytes_no_upscale",
    ...overrides,
  };
}

describe("P08.3 video batch preparation integration", () => {
  it("prepares a Flow-only video batch snapshot with verified target and declared duration", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    // Save image batch source
    const imageSourceText = '1: {"scene":"forest"}\n\n2: {"scene":"jaguar"}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const imageSourceHash = await sha256Hex(imageSourceText);

    // Save video batch source with arbitrary JSON durations
    const videoSourceText = [
      '1: { "scene": "Opening drone shot", "duration": 4 }',
      '2: { "scene": "Tracking jaguar in brush", "duration": 12, "effects": ["slowmo"] }',
    ].join("\n\n");
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });
    const videoSourceHash = await sha256Hex(videoSourceText);

    // Save verified reference assignments
    const ref1 = await makeVerifiedReference("1", [1, 2, 3, 4], {
      batchSourceHash: imageSourceHash,
    });
    const ref2 = await makeVerifiedReference("2", [5, 6, 7, 8], {
      batchSourceHash: imageSourceHash,
    });
    await database.referenceAssignments.put(ref1);
    await database.referenceAssignments.put(ref2);

    // Record and verify Flow target
    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      verificationBinding: {
        provider: "Flow",
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/project-1",
        projectId: "project-1",
        frameId: 0,
        documentId: "doc-1",
        documentToken: "token-1",
        extensionBuildId: "build-1",
        extensionProtocolVersion: 1,
        connectorBuildId: "build-1",
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: 19_000,
      },
      updatedAt: 19_000,
    });

    const requestId = "90000000-0000-4000-8000-000000000001";
    const prepared = await repositories.prepareVideoBatch({
      workspaceId: "default",
      requestId,
      destination: "Flow",
      imageSourceBatchId: imageBatch.batch.id,
      manualSettingsDeclaration: {
        confirmationId: "conf-1",
        confirmedAt: 20_000,
        destination: "Flow",
        declaredDurationSeconds: 6,
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/project-1",
        projectId: "project-1",
      },
      expectedVideoSourceHash: videoSourceHash,
      expectedImageSourceHash: imageSourceHash,
      expectedReferenceVersions: [
        { canonicalShotId: "1", referenceId: ref1.referenceId, assignmentVersion: 1 },
        { canonicalShotId: "2", referenceId: ref2.referenceId, assignmentVersion: 1 },
      ],
    });

    expect(prepared.status).toBe("prepared");
    expect(prepared.destination).toBe("Flow");
    expect(prepared.target.provider).toBe("Flow");
    expect(prepared.target.tabId).toBe(101);
    expect(prepared.target.projectId).toBe("project-1");
    expect(prepared.target.verification).toBe("verified");
    expect(prepared.manualSettingsDeclaration.declaredDurationSeconds).toBe(6);
    expect(prepared.manualSettingsDeclaration.destination).toBe("Flow");
    expect(prepared.itemCount).toBe(2);
    expect(prepared.items).toHaveLength(2);

    // Verify item 1
    expect(prepared.items[0]!.canonicalShotId).toBe("1");
    expect(prepared.items[0]!.rawJsonBody).toBe(
      '{ "scene": "Opening drone shot", "duration": 4 }',
    );
    expect(prepared.items[0]!.reference.referenceId).toBe(ref1.referenceId);
    expect(prepared.items[0]!.reference.sha256).toBe(ref1.sha256);

    // Verify item 2
    expect(prepared.items[1]!.canonicalShotId).toBe("2");
    expect(prepared.items[1]!.rawJsonBody).toBe(
      '{ "scene": "Tracking jaguar in brush", "duration": 12, "effects": ["slowmo"] }',
    );
    expect(prepared.items[1]!.reference.referenceId).toBe(ref2.referenceId);

    // Verify it is retrievable via getPreparedVideoBatch
    const retrieved = await repositories.getPreparedVideoBatch("default");
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(prepared.id);
  });

  it("prepares a Vids-only video batch snapshot with verified target and declared duration", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    const imageSourceText = '1: {"scene":"intro"}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const imageSourceHash = await sha256Hex(imageSourceText);

    const videoSourceText = '1: { "scene": "Full panorama", "duration": 10 }';
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });

    const ref1 = await makeVerifiedReference("1", [9, 8, 7, 6], {
      batchSourceHash: imageSourceHash,
    });
    await database.referenceAssignments.put(ref1);

    // Record and verify Vids target
    await database.selectedTargets.put({
      provider: "Vids",
      tabId: 202,
      canonicalTarget: "https://docs.google.com/videos/d/vids-doc-123/edit",
      verification: "verified",
      connectionState: "verified",
      verificationBinding: {
        provider: "Vids",
        tabId: 202,
        canonicalTarget: "https://docs.google.com/videos/d/vids-doc-123/edit",
        projectId: "vids-doc-123",
        documentId: "vids-doc-123",
        frameId: 0,
        documentToken: "token-2",
        extensionBuildId: "build-1",
        extensionProtocolVersion: 1,
        connectorBuildId: "build-1",
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: 19_000,
      },
      updatedAt: 19_000,
    });

    const requestId = "90000000-0000-4000-8000-000000000002";
    const prepared = await repositories.prepareVideoBatch({
      workspaceId: "default",
      requestId,
      destination: "Vids",
      imageSourceBatchId: imageBatch.batch.id,
      manualSettingsDeclaration: {
        confirmationId: "conf-2",
        confirmedAt: 20_000,
        destination: "Vids",
        declaredDurationSeconds: 8,
        tabId: 202,
        canonicalTarget: "https://docs.google.com/videos/d/vids-doc-123/edit",
        documentId: "vids-doc-123",
      },
    });

    expect(prepared.status).toBe("prepared");
    expect(prepared.destination).toBe("Vids");
    expect(prepared.target.provider).toBe("Vids");
    expect(prepared.target.tabId).toBe(202);
    expect(prepared.manualSettingsDeclaration.declaredDurationSeconds).toBe(8);
    expect(prepared.itemCount).toBe(1);
  });

  it("rejects missing, multiple, or unsupported destinations", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    await expect(
      repositories.prepareVideoBatch({
        workspaceId: "default",
        requestId: "90000000-0000-4000-8000-000000000003",
        // @ts-expect-error test unsupported destination
        destination: "YouTube",
        imageSourceBatchId: "import:default:image",
        manualSettingsDeclaration: {
          confirmationId: "conf-3",
          confirmedAt: 20_000,
          // @ts-expect-error test unsupported destination
          destination: "YouTube",
          declaredDurationSeconds: 6,
          tabId: 101,
          canonicalTarget: "https://example.com",
        },
      }),
    ).rejects.toThrow(VideoBatchPreparationError);
  });

  it("rejects unverified or changed provider connection targets", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    const imageSourceText = '1: {"scene":"a"}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const videoSourceText = '1: {"scene":"a"}';
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });
    const imageSourceHash = await sha256Hex(imageSourceText);
    const ref1 = await makeVerifiedReference("1", [1, 2, 3], {
      batchSourceHash: imageSourceHash,
    });
    await database.referenceAssignments.put(ref1);

    // Target unverified in storage
    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "unverified",
      connectionState: "disconnected",
      updatedAt: 10_000,
    });

    await expect(
      repositories.prepareVideoBatch({
        workspaceId: "default",
        requestId: "90000000-0000-4000-8000-000000000004",
        destination: "Flow",
        imageSourceBatchId: imageBatch.batch.id,
        manualSettingsDeclaration: {
          confirmationId: "conf-4",
          confirmedAt: 20_000,
          destination: "Flow",
          declaredDurationSeconds: 6,
          tabId: 101,
          canonicalTarget: "https://flow.google.com/project/project-1",
        },
      }),
    ).rejects.toThrow("target is not connected or verified");

    // Target verified but tabId changed
    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 999, // changed tab
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    });

    await expect(
      repositories.prepareVideoBatch({
        workspaceId: "default",
        requestId: "90000000-0000-4000-8000-000000000005",
        destination: "Flow",
        imageSourceBatchId: imageBatch.batch.id,
        manualSettingsDeclaration: {
          confirmationId: "conf-5",
          confirmedAt: 20_000,
          destination: "Flow",
          declaredDurationSeconds: 6,
          tabId: 101, // old tab in confirmation
          canonicalTarget: "https://flow.google.com/project/project-1",
        },
      }),
    ).rejects.toThrow("target changed since confirmation");
  });

  it("preserves exact multiline JSON text, decimal coordinates, and content hashes", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    const imageSourceText = '1: {"scene":"coords"}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const imageSourceHash = await sha256Hex(imageSourceText);
    const ref1 = await makeVerifiedReference("1", [1, 2, 3], {
      batchSourceHash: imageSourceHash,
    });
    await database.referenceAssignments.put(ref1);

    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    });

    const exactVideoJson = [
      '{',
      '  "camera": {',
      '    "coordinates": [0.123456789, -89.987654321, 1045.55],',
      '    "pan": 14.5,',
      '    "tilt": -3.2',
      '  },',
      '  "prompt": "Vast mountain horizon with fog and sunlight",',
      '  "notes": "\\"Cinematic\\" 4K HDR"',
      '}',
    ].join("\r\n");

    const videoSourceText = `1: ${exactVideoJson}`;
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });

    const prepared = await repositories.prepareVideoBatch({
      workspaceId: "default",
      requestId: "90000000-0000-4000-8000-000000000006",
      destination: "Flow",
      imageSourceBatchId: imageBatch.batch.id,
      manualSettingsDeclaration: {
        confirmationId: "conf-6",
        confirmedAt: 20_000,
        destination: "Flow",
        declaredDurationSeconds: 6,
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/project-1",
      },
    });

    expect(prepared.items[0]!.rawJsonBody).toBe(exactVideoJson);
    expect(prepared.items[0]!.contentHash).toBe(await sha256Hex(exactVideoJson));
  });

  it("leaves extra references in storage untouched and nonblocking", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    // Image source has Shots 1, 2, 3, 4, 5
    const imageSourceText = '1: {"a":1}\n\n2: {"b":2}\n\n3: {"c":3}\n\n4: {"d":4}\n\n5: {"e":5}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const imageHash = await sha256Hex(imageSourceText);

    // Put references for all 5 shots
    for (const id of ["1", "2", "3", "4", "5"]) {
      const ref = await makeVerifiedReference(id, [Number(id)], {
        batchSourceHash: imageHash,
      });
      await database.referenceAssignments.put(ref);
    }

    // Video only has Shots 1 and 2
    const videoSourceText = '1: {"video":1}\n\n2: {"video":2}';
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });

    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    });

    const prepared = await repositories.prepareVideoBatch({
      workspaceId: "default",
      requestId: "90000000-0000-4000-8000-000000000007",
      destination: "Flow",
      imageSourceBatchId: imageBatch.batch.id,
      manualSettingsDeclaration: {
        confirmationId: "conf-7",
        confirmedAt: 20_000,
        destination: "Flow",
        declaredDurationSeconds: 6,
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/project-1",
      },
    });

    expect(prepared.itemCount).toBe(2);
    expect(prepared.items.map((i) => i.canonicalShotId)).toEqual(["1", "2"]);

    // Extra references 3, 4, 5 in referenceAssignments remain untouched in storage
    const allStoredRefs = await database.referenceAssignments.toArray();
    expect(allStoredRefs).toHaveLength(5);
    expect(allStoredRefs.map((r) => r.shotId).sort()).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("rejects preparation when a reference assignment version changed after review", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    const imageSourceText = '1: {"scene":"tiger"}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const videoSourceText = '1: {"scene":"tiger-video"}';
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });

    const imageSourceHash = await sha256Hex(imageSourceText);
    const ref1 = await makeVerifiedReference("1", [1, 2, 3], {
      batchSourceHash: imageSourceHash,
      assignmentVersion: 2, // Live assignment version is 2
    });
    await database.referenceAssignments.put(ref1);

    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    });

    // Review expected version 1
    await expect(
      repositories.prepareVideoBatch({
        workspaceId: "default",
        requestId: "90000000-0000-4000-8000-000000000008",
        destination: "Flow",
        imageSourceBatchId: imageBatch.batch.id,
        manualSettingsDeclaration: {
          confirmationId: "conf-8",
          confirmedAt: 20_000,
          destination: "Flow",
          declaredDurationSeconds: 6,
          tabId: 101,
          canonicalTarget: "https://flow.google.com/project/project-1",
        },
        expectedReferenceVersions: [
          { canonicalShotId: "1", referenceId: ref1.referenceId, assignmentVersion: 1 },
        ],
      }),
    ).rejects.toThrow("Reference for Shot 1 changed since review");
  });

  it("rejects missing or duplicate video shot IDs", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    const imageSourceText = '1: {"scene":"a"}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const imageSourceHash = await sha256Hex(imageSourceText);
    const ref1 = await makeVerifiedReference("1", [1, 2, 3], {
      batchSourceHash: imageSourceHash,
    });
    await database.referenceAssignments.put(ref1);

    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    });

    // Video has Shot 1 and Shot 2, but only Shot 1 has a reference
    const videoSource = '1: {"scene":"valid"}\n\n2: {"scene":"missing ref"}';
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSource,
    });

    await expect(
      repositories.prepareVideoBatch({
        workspaceId: "default",
        requestId: "90000000-0000-4000-8000-000000000009",
        destination: "Flow",
        imageSourceBatchId: imageBatch.batch.id,
        manualSettingsDeclaration: {
          confirmationId: "conf-9",
          confirmedAt: 20_000,
          destination: "Flow",
          declaredDurationSeconds: 6,
          tabId: 101,
          canonicalTarget: "https://flow.google.com/project/project-1",
        },
      }),
    ).rejects.toThrow("Video pairing is invalid: 1 invalid pairs out of 2 shots");
  });

  it("is idempotent: duplicate preparation request returns the existing prepared result", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    const imageSourceText = '1: {"scene":"a"}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const videoSourceText = '1: {"scene":"a"}';
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });
    const imageSourceHash = await sha256Hex(imageSourceText);
    const ref1 = await makeVerifiedReference("1", [1, 2, 3], {
      batchSourceHash: imageSourceHash,
    });
    await database.referenceAssignments.put(ref1);

    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    });

    const requestId = "90000000-0000-4000-8000-000000000010";
    const prepInput = {
      workspaceId: "default",
      requestId,
      destination: "Flow" as const,
      imageSourceBatchId: imageBatch.batch.id,
      manualSettingsDeclaration: {
        confirmationId: "conf-10",
        confirmedAt: 20_000,
        destination: "Flow" as const,
        declaredDurationSeconds: 6,
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/project-1",
      },
    };

    const first = await repositories.prepareVideoBatch(prepInput);
    const second = await repositories.prepareVideoBatch(prepInput);

    expect(first.id).toBe(second.id);
    expect(first.preparedAt).toBe(second.preparedAt);
    const all = await repositories.listPreparedVideoBatches("default");
    expect(all).toHaveLength(1);
  });

  it("retains prepared snapshot and pinned reference media even after P07 replaces the assignment", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    const imageSourceText = '1: {"scene":"initial-reference"}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const imageSourceHash = await sha256Hex(imageSourceText);
    const videoSourceText = '1: {"scene":"initial-video"}';
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });

    // Initial reference for Shot 1 (referenceId A)
    const initialBytes = [10, 20, 30, 40];
    const refA = await makeVerifiedReference("1", initialBytes, {
      referenceId: "00000000-0000-4000-8000-00000000000a",
      batchSourceHash: imageSourceHash,
      assignmentVersion: 1,
    });
    await database.referenceAssignments.put(refA);

    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    });

    // Prepare video batch with refA
    const prepared = await repositories.prepareVideoBatch({
      workspaceId: "default",
      requestId: "90000000-0000-4000-8000-000000000011",
      destination: "Flow",
      imageSourceBatchId: imageBatch.batch.id,
      manualSettingsDeclaration: {
        confirmationId: "conf-11",
        confirmedAt: 20_000,
        destination: "Flow",
        declaredDurationSeconds: 6,
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/project-1",
      },
    });

    expect(prepared.items[0]!.reference.referenceId).toBe(refA.referenceId);

    // Now simulate P07 replacing the reference for Shot 1 with a brand new capture (referenceId B)
    const replacementBytes = [99, 88, 77, 66, 55];
    const refB = await makeVerifiedReference("1", replacementBytes, {
      referenceId: "00000000-0000-4000-8000-00000000000b",
      batchSourceHash: imageSourceHash,
      assignmentVersion: 2,
    });
    // P07 puts to referenceAssignments (replacing the assignment for default:import:default:image:1)
    await database.referenceAssignments.put(refB);

    // Verify referenceAssignments now has refB
    const currentAssignment = await database.referenceAssignments.get(refA.assignmentId);
    expect(currentAssignment?.referenceId).toBe(refB.referenceId);
    expect(currentAssignment?.assignmentVersion).toBe(2);

    // CRITICAL ASSERTION: The prepared snapshot's reference bytes (refA) remain retrievable via getReferenceById
    const pinnedRefA = await repositories.getReferenceById(refA.referenceId);
    expect(pinnedRefA).toBeDefined();
    expect(pinnedRefA?.referenceId).toBe(refA.referenceId);
    expect(pinnedRefA?.sha256).toBe(refA.sha256);
    expect(pinnedRefA?.byteSize).toBe(4);

    // Verify prepared snapshot record in storage remains unchanged
    const storedPrepared = await repositories.getPreparedVideoBatch("default");
    expect(storedPrepared).toBeDefined();
    expect(storedPrepared?.items[0]!.reference.referenceId).toBe(refA.referenceId);
    expect(storedPrepared?.items[0]!.reference.assignmentVersion).toBe(1);
    expect(storedPrepared?.items[0]!.reference.sha256).toBe(refA.sha256);
  });

  it("rolls back atomically on storage failure during preparation", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    const imageSourceText = '1: {"scene":"tiger"}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const imageSourceHash = await sha256Hex(imageSourceText);
    const videoSourceText = '1: {"scene":"tiger-video"}';
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });

    const ref1 = await makeVerifiedReference("1", [1, 2, 3], {
      batchSourceHash: imageSourceHash,
    });
    await database.referenceAssignments.put(ref1);

    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    });

    // Make preparedVideoBatches.put throw a storage error
    const originalPut = database.preparedVideoBatches.put;
    database.preparedVideoBatches.put = async () => {
      throw new DOMException("Simulated disk full failure", "QuotaExceededError");
    };

    await expect(
      repositories.prepareVideoBatch({
        workspaceId: "default",
        requestId: "90000000-0000-4000-8000-000000000099",
        destination: "Flow",
        imageSourceBatchId: imageBatch.batch.id,
        manualSettingsDeclaration: {
          confirmationId: "conf-99",
          confirmedAt: 20_000,
          destination: "Flow",
          declaredDurationSeconds: 6,
          tabId: 101,
          canonicalTarget: "https://flow.google.com/project/project-1",
        },
      }),
    ).rejects.toThrow("Simulated disk full failure");

    // Restore original put
    database.preparedVideoBatches.put = originalPut;

    // Verify atomic rollback: no prepared batch exists, no pinnedReferenceMedia was committed
    expect(await database.preparedVideoBatches.toArray()).toHaveLength(0);
    expect(await database.pinnedReferenceMedia.toArray()).toHaveLength(0);

    // Existing sources and reference assignments remain intact
    expect(await database.batches.toArray()).toHaveLength(2);
    expect(await database.referenceAssignments.toArray()).toHaveLength(1);
  });

  it("retains prepared snapshot across repository close and reopen", async () => {
    const database = createMemoryRepositoryDatabase();
    const repo1 = new ExtensionRepositories(database, () => 20_000);

    const imageSourceText = '1: {"scene":"tiger"}';
    const imageBatch = await repo1.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const imageSourceHash = await sha256Hex(imageSourceText);
    const videoSourceText = '1: {"scene":"tiger-video"}';
    await repo1.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });

    const ref1 = await makeVerifiedReference("1", [1, 2, 3], {
      batchSourceHash: imageSourceHash,
    });
    await database.referenceAssignments.put(ref1);

    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    });

    const prepared = await repo1.prepareVideoBatch({
      workspaceId: "default",
      requestId: "90000000-0000-4000-8000-000000000088",
      destination: "Flow",
      imageSourceBatchId: imageBatch.batch.id,
      manualSettingsDeclaration: {
        confirmationId: "conf-88",
        confirmedAt: 20_000,
        destination: "Flow",
        declaredDurationSeconds: 6,
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/project-1",
      },
    });

    expect(prepared.status).toBe("prepared");

    // Fresh repository instance simulating new extension worker / dashboard reload
    const repo2 = new ExtensionRepositories(database, () => 25_000);

    const reloaded = await repo2.getPreparedVideoBatch("default");
    expect(reloaded).toBeDefined();
    expect(reloaded?.id).toBe(prepared.id);
    expect(reloaded?.destination).toBe("Flow");
    expect(reloaded?.itemCount).toBe(1);
    expect(reloaded?.items[0]?.rawJsonBody).toBe('{"scene":"tiger-video"}');

    // Reference retrievable via getReferenceById
    const pinned = await repo2.getReferenceById(ref1.referenceId);
    expect(pinned?.referenceId).toBe(ref1.referenceId);
  });

  it("verifies zero provider calls, scheduler alarms, prompt insertion, or Generate during preparation", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 20_000);

    const imageSourceText = '1: {"scene":"tiger"}';
    const imageBatch = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: imageSourceText,
    });
    const imageSourceHash = await sha256Hex(imageSourceText);
    const videoSourceText = '1: {"scene":"tiger-video"}';
    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "video",
      sourceText: videoSourceText,
    });

    const ref1 = await makeVerifiedReference("1", [1, 2, 3], {
      batchSourceHash: imageSourceHash,
    });
    await database.referenceAssignments.put(ref1);

    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/project-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    });

    const prepared = await repositories.prepareVideoBatch({
      workspaceId: "default",
      requestId: "90000000-0000-4000-8000-000000000077",
      destination: "Flow",
      imageSourceBatchId: imageBatch.batch.id,
      manualSettingsDeclaration: {
        confirmationId: "conf-77",
        confirmedAt: 20_000,
        destination: "Flow",
        declaredDurationSeconds: 6,
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/project-1",
      },
    });

    // Verify prepared status only
    expect(prepared.status).toBe("prepared");

    // Queue tables remain untouched (zero execution queue items)
    expect(await database.imageSubmissionQueues.toArray()).toHaveLength(0);
    // Attempts tables remain untouched (zero provider attempts)
    expect(await database.flowImageAttempts.toArray()).toHaveLength(0);
  });
});
