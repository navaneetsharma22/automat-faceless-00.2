import { AutomatDatabase } from "../../src/storage/db";
import {
  createDexieRepositoryDatabase,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import {
  referenceAssignmentId,
  sha256Bytes,
  type ReferenceAssignmentRecord,
  type ReferenceCaptureOperationRecord,
} from "../../src/domain/media/references";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { flowReferenceCaptureInPage } from "../../src/platforms/flow/references";

export async function verifyDecodedImageCapture() {
  const result = await flowReferenceCaptureInPage({
    action: "fetch",
    captureOperationId: crypto.randomUUID(),
    sourceUrl: `${location.origin}/reference-capture-fixture.png`,
    expectedOrigin: location.origin,
  });
  if (
    !result.ok ||
    typeof result.data !== "string" ||
    typeof result.byteLength !== "number"
  )
    return { ok: false, code: result.code };
  const binary = atob(result.data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return {
    ok: true,
    byteLength: result.byteLength,
    byteHash: await sha256Bytes(bytes),
    width: result.width,
    height: result.height,
    mimeType: result.mimeType,
  };
}

export async function verifyDurableReferenceCaptureStorage() {
  const name = `reference-capture-regression-${crypto.randomUUID()}`;
  const database = new AutomatDatabase(name);
  await database.open();
  const repositories = new ExtensionRepositories(
    createDexieRepositoryDatabase(database),
    () => 1_000,
  );
  const sourceText = '{"shot_id":"1","text":"fixture prompt"}';
  const batchSourceHash = await sha256Hex(sourceText);
  const batch = await repositories.savePromptBatch({
    workspaceId: "workspace-fixture",
    kind: "image",
    sourceText,
  });
  const selected = await repositories.recordSelectedTarget({
    provider: "Flow",
    tabId: 41,
    canonicalTarget: "https://flow.google.com/project/reference-fixture",
  });
  await database.selectedTargets.put({
    ...selected,
    verification: "verified",
    connectionState: "verified",
    verificationBinding: {
      provider: "Flow",
      tabId: 41,
      canonicalTarget: selected.canonicalTarget,
      projectId: "reference-fixture",
      frameId: 0,
      documentId: "fixture-document",
      documentToken: "fixture-token",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: 1,
      capability: "read-only-connection-v1",
      verifiedAt: 900,
    },
  });
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const captureOperationId = crypto.randomUUID();
  const operation: ReferenceCaptureOperationRecord = {
    captureOperationId,
    workspaceId: "workspace-fixture",
    batchId: batch.batch.id,
    batchSourceHash,
    shotId: "1",
    promptHash: batch.items[0]!.contentHash,
    selectionVersion: crypto.randomUUID(),
    expectedAssignmentVersion: 0,
    flowProjectId: "reference-fixture",
    tabId: 41,
    canonicalTarget: selected.canonicalTarget,
    documentId: "fixture-document",
    observedSourceSha256: await sha256Hex("observed-source-identity"),
    status: "acquiring",
    startedAt: 950,
  };
  await repositories.beginReferenceCapture(operation);
  const concurrentOperation = {
    ...operation,
    captureOperationId: crypto.randomUUID(),
    selectionVersion: crypto.randomUUID(),
  };
  let duplicateConcurrentOperationRejected = false;
  try {
    await repositories.beginReferenceCapture(concurrentOperation);
  } catch {
    duplicateConcurrentOperationRejected = true;
  }
  const assignment: ReferenceAssignmentRecord = {
    assignmentId: referenceAssignmentId(
      "workspace-fixture",
      batch.batch.id,
      "1",
      operation.batchSourceHash,
    ),
    referenceId: crypto.randomUUID(),
    captureOperationId,
    workspaceId: "workspace-fixture",
    batchId: batch.batch.id,
    batchSourceHash: operation.batchSourceHash,
    shotId: "1",
    promptHash: batch.items[0]!.contentHash,
    selectionVersion: operation.selectionVersion,
    assignmentVersion: 1,
    flowProjectId: operation.flowProjectId,
    tabId: operation.tabId,
    canonicalTarget: operation.canonicalTarget,
    documentId: operation.documentId,
    observedSourceSha256: operation.observedSourceSha256,
    bytes: new Blob([bytes], { type: "image/png" }),
    mimeType: "image/png",
    byteSize: bytes.byteLength,
    sha256: await sha256Bytes(bytes),
    width: 1,
    height: 1,
    capturedAt: 1_000,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch",
    qualityProvenance: "observed_resource_original_bytes_no_upscale",
  };
  await repositories.commitReferenceCapture({
    assignment,
    expectedSourceText: sourceText,
    expectedPromptBody: batch.items[0]!.rawJsonBody,
  });
  database.close();

  const reopened = new AutomatDatabase(name);
  await reopened.open();
  const reopenedRepositories = new ExtensionRepositories(
    createDexieRepositoryDatabase(reopened),
  );
  const saved = await reopenedRepositories.getReferenceAssignment(
    "workspace-fixture",
    batch.batch.id,
    "1",
    operation.batchSourceHash,
  );
  const savedOperation =
    await reopenedRepositories.getReferenceCaptureOperation(captureOperationId);
  const storedBytes = saved
    ? new Uint8Array(await saved.bytes.arrayBuffer())
    : new Uint8Array();

  const secondOperation: ReferenceCaptureOperationRecord = {
    ...operation,
    captureOperationId: crypto.randomUUID(),
    expectedAssignmentVersion: 1,
    selectionVersion: crypto.randomUUID(),
  };
  await reopenedRepositories.beginReferenceCapture(secondOperation);
  let rejectedReplacement = false;
  try {
    await reopenedRepositories.commitReferenceCapture({
      assignment: {
        ...assignment,
        captureOperationId: secondOperation.captureOperationId,
        referenceId: crypto.randomUUID(),
        selectionVersion: secondOperation.selectionVersion,
        assignmentVersion: 2,
      },
      expectedSourceText: sourceText,
      expectedPromptBody: "changed prompt",
    });
  } catch {
    rejectedReplacement = true;
  }
  const preserved = await reopenedRepositories.getReferenceAssignment(
    "workspace-fixture",
    batch.batch.id,
    "1",
    operation.batchSourceHash,
  );
  const failedOperation =
    await reopenedRepositories.getReferenceCaptureOperation(
      secondOperation.captureOperationId,
    );
  await reopenedRepositories.updateReferenceCaptureOperation(
    secondOperation.captureOperationId,
    "failed",
    "fixture_replacement_refused",
    1_050,
  );
  const rejectsMismatch = async (
    mismatch: "source" | "shot" | "project" | "document" | "cancelled",
  ) => {
    const nextOperation: ReferenceCaptureOperationRecord = {
      ...operation,
      captureOperationId: crypto.randomUUID(),
      expectedAssignmentVersion: 1,
      selectionVersion: crypto.randomUUID(),
    };
    await reopenedRepositories.beginReferenceCapture(nextOperation);
    if (mismatch === "cancelled")
      await reopenedRepositories.cancelReferenceCapturesForShot(
        nextOperation.workspaceId,
        nextOperation.batchId,
        nextOperation.shotId,
        1_100,
      );
    const originalTarget = await reopened.selectedTargets.get("Flow");
    if (mismatch === "project" || mismatch === "document")
      await reopened.selectedTargets.put({
        ...originalTarget!,
        verificationBinding: {
          ...originalTarget!.verificationBinding!,
          ...(mismatch === "project"
            ? { projectId: "other-project" }
            : { documentId: "other-document" }),
        },
      });
    const attemptedAssignment: ReferenceAssignmentRecord = {
      ...assignment,
      referenceId: crypto.randomUUID(),
      captureOperationId: nextOperation.captureOperationId,
      selectionVersion: nextOperation.selectionVersion,
      assignmentVersion: 2,
      ...(mismatch === "shot" ? { shotId: "2" } : {}),
    };
    let rejected = false;
    try {
      await reopenedRepositories.commitReferenceCapture({
        assignment: attemptedAssignment,
        expectedSourceText:
          mismatch === "source" ? `${sourceText} ` : sourceText,
        expectedPromptBody: batch.items[0]!.rawJsonBody,
      });
    } catch {
      rejected = true;
    }
    if (mismatch === "project" || mismatch === "document")
      await reopened.selectedTargets.put(originalTarget!);
    if (mismatch !== "cancelled")
      await reopenedRepositories.updateReferenceCaptureOperation(
        nextOperation.captureOperationId,
        "failed",
        "fixture_binding_refused",
        1_150,
      );
    return rejected;
  };
  const sourceMismatchRejected = await rejectsMismatch("source");
  const shotMismatchRejected = await rejectsMismatch("shot");
  const projectMismatchRejected = await rejectsMismatch("project");
  const documentMismatchRejected = await rejectsMismatch("document");
  const cancelledCommitRejected = await rejectsMismatch("cancelled");
  reopened.close();
  await new AutomatDatabase(name).delete();

  return {
    savedAfterReopen: Boolean(saved),
    operationSaved: savedOperation?.status === "saved",
    blobBytesMatch: storedBytes.every((byte, index) => byte === bytes[index]),
    duplicateOperationReadback:
      saved?.captureOperationId === captureOperationId,
    duplicateConcurrentOperationRejected,
    mismatchedReplacementRejected: rejectedReplacement,
    oldAssignmentPreserved: preserved?.referenceId === assignment.referenceId,
    rejectedOperationStillAcquiring: failedOperation?.status === "acquiring",
    sourceMismatchRejected,
    shotMismatchRejected,
    projectMismatchRejected,
    documentMismatchRejected,
    cancelledCommitRejected,
  };
}

export async function verifyReferenceAssignmentReorder() {
  const name = `reference-assignment-reorder-${crypto.randomUUID()}`;
  const database = new AutomatDatabase(name);
  await database.open();
  let repositories = new ExtensionRepositories(
    createDexieRepositoryDatabase(database),
    () => 2_000,
  );
  const shotIds = ["34", "35", "36"];
  const sourceText = JSON.stringify({
    schemaVersion: 1,
    kind: "image",
    items: shotIds.map((shotId) => ({
      shotId,
      prompt: { shot_id: shotId, text: `synthetic prompt ${shotId}` },
    })),
  });
  const batch = await repositories.savePromptBatch({
    workspaceId: "workspace-reorder-fixture",
    kind: "image",
    sourceText,
  });
  const batchSourceHash = await sha256Hex(sourceText);
  const selected = await repositories.recordSelectedTarget({
    provider: "Flow",
    tabId: 42,
    canonicalTarget: "https://flow.google.com/project/reorder-fixture",
  });
  await database.selectedTargets.put({
    ...selected,
    verification: "verified",
    connectionState: "verified",
    verificationBinding: {
      provider: "Flow",
      tabId: 42,
      canonicalTarget: selected.canonicalTarget,
      projectId: "reorder-fixture",
      frameId: 0,
      documentId: "reorder-fixture-document",
      documentToken: "reorder-fixture-token",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: 1,
      capability: "read-only-connection-v1",
      verifiedAt: 1_900,
    },
  });
  const images = new Map<
    string,
    { bytes: Uint8Array; width: number; height: number }
  >();
  for (const [index, shotId] of shotIds.entries()) {
    const canvas = document.createElement("canvas");
    canvas.width = index + 2;
    canvas.height = 2;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("fixture_canvas_unavailable");
    context.fillStyle = ["#176b35", "#da9a21", "#293eae"][index]!;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("fixture_png_encode_failed")),
        "image/png",
      ),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const decoded = await createImageBitmap(blob);
    images.set(shotId, { bytes, width: decoded.width, height: decoded.height });
    decoded.close();
  }
  const promptFor = (shotId: string) => {
    const matches = batch.items.filter((item) => item.shotId === shotId);
    if (matches.length !== 1) throw new Error("fixture_shot_binding_invalid");
    return matches[0]!;
  };
  const save = async (
    shotId: string,
    providerAssetId: string,
    expectedAssignmentVersion: number,
  ) => {
    const prompt = promptFor(shotId);
    const image = images.get(shotId)!;
    const captureOperationId = crypto.randomUUID();
    const selectionVersion = crypto.randomUUID();
    const observedSourceSha256 = await sha256Hex(`observed:${providerAssetId}`);
    const operation: ReferenceCaptureOperationRecord = {
      captureOperationId,
      workspaceId: "workspace-reorder-fixture",
      batchId: batch.batch.id,
      batchSourceHash,
      shotId,
      promptHash: prompt.contentHash,
      selectionVersion,
      expectedAssignmentVersion,
      flowProjectId: "reorder-fixture",
      tabId: 42,
      canonicalTarget: selected.canonicalTarget,
      documentId: "reorder-fixture-document",
      observedSourceSha256,
      status: "acquiring",
      startedAt: 2_000,
    };
    await repositories.beginReferenceCapture(operation);
    const assignment: ReferenceAssignmentRecord = {
      assignmentId: referenceAssignmentId(
        operation.workspaceId,
        operation.batchId,
        shotId,
        operation.batchSourceHash,
      ),
      referenceId: crypto.randomUUID(),
      captureOperationId,
      workspaceId: operation.workspaceId,
      batchId: operation.batchId,
      batchSourceHash: operation.batchSourceHash,
      shotId,
      promptHash: operation.promptHash,
      selectionVersion,
      assignmentVersion: expectedAssignmentVersion + 1,
      flowProjectId: operation.flowProjectId,
      tabId: operation.tabId,
      canonicalTarget: operation.canonicalTarget,
      documentId: operation.documentId,
      providerAssetId,
      observedSourceSha256,
      bytes: new Blob([image.bytes], { type: "image/png" }),
      mimeType: "image/png",
      byteSize: image.bytes.byteLength,
      sha256: await sha256Bytes(image.bytes),
      width: image.width,
      height: image.height,
      capturedAt: 2_000 + expectedAssignmentVersion,
      acquisitionProvenance: "verified_flow_document_same_origin_fetch",
      qualityProvenance: "observed_resource_original_bytes_no_upscale",
    };
    return repositories.commitReferenceCapture({
      assignment,
      expectedSourceText: sourceText,
      expectedPromptBody: prompt.rawJsonBody,
    });
  };
  const readByShot = async () => {
    const records = new Map<string, ReferenceAssignmentRecord>();
    for (const shotId of shotIds) {
      const assignment = await repositories.getReferenceAssignment(
        "workspace-reorder-fixture",
        batch.batch.id,
        shotId,
        batchSourceHash,
      );
      if (!assignment) throw new Error("fixture_assignment_missing");
      records.set(shotId, assignment);
    }
    return records;
  };
  for (const shotId of shotIds)
    await save(shotId, `fixture-media-shot-${shotId}`, 0);
  const firstRecords = await readByShot();
  const firstView = await viewAssignments(firstRecords, shotIds);
  database.close();

  const reopened = new AutomatDatabase(name);
  await reopened.open();
  repositories = new ExtensionRepositories(
    createDexieRepositoryDatabase(reopened),
    () => 2_100,
  );
  const beforeReplacement = await readAssignments(repositories, batch.batch.id, batchSourceHash);
  const replacementCanvas = document.createElement("canvas");
  replacementCanvas.width = 7;
  replacementCanvas.height = 3;
  const replacementContext = replacementCanvas.getContext("2d");
  if (!replacementContext) throw new Error("fixture_canvas_unavailable");
  replacementContext.fillStyle = "#8a2075";
  replacementContext.fillRect(
    0,
    0,
    replacementCanvas.width,
    replacementCanvas.height,
  );
  const replacementBlob = await new Promise<Blob>((resolve, reject) =>
    replacementCanvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("fixture_png_encode_failed")),
      "image/png",
    ),
  );
  const replacementBytes = new Uint8Array(await replacementBlob.arrayBuffer());
  const replacementDecoded = await createImageBitmap(replacementBlob);
  images.set("35", {
    bytes: replacementBytes,
    width: replacementDecoded.width,
    height: replacementDecoded.height,
  });
  replacementDecoded.close();
  const replacementMediaId = "fixture-media-shot-35-jaguar-replacement";
  await save("35", replacementMediaId, 1);
  const afterReplacement = await readAssignments(repositories, batch.batch.id, batchSourceHash);
  const unchanged34 = sameAssignment(
    beforeReplacement.get("34")!,
    afterReplacement.get("34")!,
  );
  const unchanged36 = sameAssignment(
    beforeReplacement.get("36")!,
    afterReplacement.get("36")!,
  );
  const replaced35 =
    afterReplacement.get("35")?.providerAssetId === replacementMediaId &&
    afterReplacement.get("35")?.assignmentVersion === 2 &&
    afterReplacement.get("35")?.sha256 !== beforeReplacement.get("35")?.sha256;
  reopened.close();

  const reopenedAgain = new AutomatDatabase(name);
  await reopenedAgain.open();
  repositories = new ExtensionRepositories(
    createDexieRepositoryDatabase(reopenedAgain),
  );
  const finalRecords = await readAssignments(repositories, batch.batch.id, batchSourceHash);
  const secondOrder = ["36", "34", "35"];
  const secondView = await viewAssignments(finalRecords, secondOrder);
  const persistedSourceUnchanged =
    (await repositories.getBatch(batch.batch.id))?.sourceText === sourceText;
  reopenedAgain.close();
  await new AutomatDatabase(name).delete();
  return {
    batchSourceHash,
    firstOrder: shotIds,
    firstView,
    replacementMediaId,
    unchanged34,
    unchanged36,
    replaced35,
    secondOrder,
    secondView,
    persistedSourceUnchanged,
  };
}

async function readAssignments(
  repositories: ExtensionRepositories,
  batchId: string,
  batchSourceHash: string,
) {
  const result = new Map<string, ReferenceAssignmentRecord>();
  for (const shotId of ["34", "35", "36"]) {
    const assignment = await repositories.getReferenceAssignment(
      "workspace-reorder-fixture",
      batchId,
      shotId,
      batchSourceHash,
    );
    if (!assignment) throw new Error("fixture_assignment_missing_after_reopen");
    result.set(shotId, assignment);
  }
  return result;
}

async function viewAssignments(
  records: Map<string, ReferenceAssignmentRecord>,
  order: string[],
) {
  return Promise.all(
    order.map(async (shotId) => {
      const assignment = records.get(shotId)!;
      const bytes = new Uint8Array(await assignment.bytes.arrayBuffer());
      return {
        shotId,
        referenceId: assignment.referenceId,
        providerAssetId: assignment.providerAssetId,
        sha256: assignment.sha256,
        bytesHashVerified: (await sha256Bytes(bytes)) === assignment.sha256,
        byteLength: bytes.byteLength,
        thumbnailAssociation: assignment.assignmentId,
        assignmentVersion: assignment.assignmentVersion,
      };
    }),
  );
}

function sameAssignment(
  left: ReferenceAssignmentRecord,
  right: ReferenceAssignmentRecord,
) {
  return (
    left.referenceId === right.referenceId &&
    left.providerAssetId === right.providerAssetId &&
    left.sha256 === right.sha256 &&
    left.assignmentVersion === right.assignmentVersion
  );
}

declare global {
  interface Window {
    __ReferenceCaptureStorageFixture?: {
      verifyDurableReferenceCaptureStorage: typeof verifyDurableReferenceCaptureStorage;
      verifyDecodedImageCapture: typeof verifyDecodedImageCapture;
      verifyReferenceAssignmentReorder: typeof verifyReferenceAssignmentReorder;
    };
  }
}

if (typeof window !== "undefined")
  window.__ReferenceCaptureStorageFixture = {
    verifyDurableReferenceCaptureStorage,
    verifyDecodedImageCapture,
    verifyReferenceAssignmentReorder,
  };
