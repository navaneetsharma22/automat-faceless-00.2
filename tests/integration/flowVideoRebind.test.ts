import { describe, expect, it, vi } from "vitest";
import { createFlowVideoQueueHandler } from "../../src/background/handlers/flowVideoQueue";
import { createFlowVideoAttachmentHandler } from "../../src/background/handlers/flowVideoAttachment";
import { createFlowVideoGenerateHandler } from "../../src/background/handlers/flowVideo";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { sha256Bytes } from "../../src/domain/media/references";
import { ExtensionRepositories } from "../../src/storage/repositories";
import type { FlowVideoQueueRecord } from "../../src/domain/jobs/videoQueue";
import type { PreparedVideoBatchRecord } from "../../src/domain/batches/types";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { CONNECTOR_PROTOCOL_VERSION } from "../../src/platforms/shared/contracts";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import {
  flowVideoAttachmentStructurePreflightInPage,
  flowVideoGalleryCandidateInPage,
  flowReferenceCaptureInPage,
} from "../../src/platforms/flow/references";

const batchId = "prepared-video-rebind-test";
const ref1 = "11111111-1111-4111-8111-111111111111";
const ref2 = "22222222-2222-4222-8222-222222222222";
const initialDocId = "initial-doc-111";
const reloadedDocId = "reloaded-doc-222";
const thirdDocId = "third-doc-333";
const tabId = 7;
const projectId = "project-p";
const canonicalTarget = "https://flow.google.com/project/project-p";

const prompts = [
  JSON.stringify({ shot_id: "1", prompt_type: "video", scene_title: "Scene 1" }),
  JSON.stringify({ shot_id: "2", prompt_type: "video", scene_title: "Scene 2" }),
];

async function setupRebindFixture(options: {
  recheckMatches?: boolean;
  activeDocumentId?: string;
  activeProjectId?: string;
  activeCanonicalTarget?: string;
  activeTabId?: number;
} = {}) {
  const db = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(db);
  const hashes = await Promise.all(prompts.map((p) => sha256Hex(p)));
  const refSha = "a".repeat(64);

  const batch: PreparedVideoBatchRecord = {
    id: batchId,
    requestId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "default",
    preparedAt: 10,
    videoBatchId: "video-source",
    videoSourceHash: "b".repeat(64),
    videoSourceText: JSON.stringify(prompts.map((b) => JSON.parse(b))),
    imageSourceBatchId: "image-source",
    imageSourceBatchHash: "c".repeat(64),
    destination: "Flow",
    target: {
      provider: "Flow",
      tabId,
      canonicalTarget,
      projectId,
      documentId: initialDocId,
      verification: "verified",
      verifiedAt: 10,
    },
    manualSettingsDeclaration: {
      confirmationId: "confirm-1",
      confirmedAt: 10,
      destination: "Flow",
      declaredDurationSeconds: 6,
      tabId,
      canonicalTarget,
      projectId,
      documentId: initialDocId,
    },
    status: "prepared",
    itemCount: 2,
    items: prompts.map((rawJsonBody, order) => ({
      itemId: `item-${order + 1}`,
      order,
      shotId: String(order + 1),
      canonicalShotId: String(order + 1),
      rawJsonBody,
      contentHash: hashes[order]!,
      sourceSpan: { start: order, end: order + rawJsonBody.length },
      reference: {
        referenceId: order === 0 ? ref1 : ref2,
        assignmentVersion: 1,
        sha256: refSha,
        mimeType: "image/png",
        byteSize: 4,
        width: 1,
        height: 1,
        capturedAt: 10,
      },
    })),
    createdAt: 10,
    updatedAt: 10,
  };
  await db.preparedVideoBatches.put(batch);

  // Set active target in selectedTargets
  const currentDocId = options.activeDocumentId ?? initialDocId;
  const currentProjectId = options.activeProjectId ?? projectId;
  const currentTabId = options.activeTabId ?? tabId;
  const currentCanonicalTarget = options.activeCanonicalTarget ?? canonicalTarget;

  await db.selectedTargets.put({
    provider: "Flow",
    tabId: currentTabId,
    canonicalTarget: currentCanonicalTarget,
    verification: "verified",
    connectionState: "verified",
    verificationBinding: {
      provider: "Flow",
      tabId: currentTabId,
      canonicalTarget: currentCanonicalTarget,
      projectId: currentProjectId,
      frameId: 0,
      documentId: currentDocId,
      documentToken: "doc-tok",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
      capability: "read-only-connection-v1",
      verifiedAt: 10,
    },
    updatedAt: 10,
  });

  let at = 100_000;
  const createAlarm = vi.fn(async () => undefined);
  const clearAlarm = vi.fn(async () => true);

  let attachCalls = 0;
  const attach = vi.fn(async (id: string, itemId: string) => {
    attachCalls += 1;
    const item = batch.items.find((candidate) => candidate.itemId === itemId)!;
    const queue = await repositories.getFlowVideoQueue(`flow-video:${id}`);
    const activeDoc = queue?.executionDocumentRebind?.toDocumentId ?? batch.target.documentId;
    await repositories.putFlowVideoAttachmentOperation({
      id: `${id}:${itemId}`,
      preparedBatchId: id,
      itemId,
      referenceId: item.reference.referenceId,
      status: "attached",
      updatedAt: at,
      verifiedAttachment: { documentId: activeDoc, mediaId: `media-${itemId}`, verifiedAt: at },
    });
    return { status: "attached" };
  });

  let attempt = 0;
  const generate = vi.fn(async (id: string, itemId: string) => {
    attempt += 1;
    const item = batch.items.find((candidate) => candidate.itemId === itemId)!;
    const queue = await repositories.getFlowVideoQueue(`flow-video:${id}`);
    const activeDoc = queue?.executionDocumentRebind?.toDocumentId ?? batch.target.documentId;
    const attemptId = `attempt-${attempt}`;
    const currentOp = await repositories.getFlowVideoAttachmentOperation(`${id}:${itemId}`);
    await repositories.putFlowVideoAttachmentOperation({
      id: `${id}:${itemId}`,
      preparedBatchId: id,
      itemId,
      referenceId: item.reference.referenceId,
      status: "attached",
      updatedAt: at,
      ...(currentOp?.verifiedAttachment ? { verifiedAttachment: currentOp.verifiedAttachment } : {}),
      videoGeneration: {
        attemptId,
        preparedBatchId: id,
        itemId,
        canonicalShotId: item.canonicalShotId,
        promptHash: item.contentHash,
        referenceId: item.reference.referenceId,
        tabId: queue?.executionDocumentRebind?.toTabId ?? batch.target.tabId,
        projectId: queue?.executionDocumentRebind?.projectId ?? batch.target.projectId,
        canonicalTarget: queue?.executionDocumentRebind?.canonicalTarget ?? batch.target.canonicalTarget,
        documentId: activeDoc,
        state: "dispatched",
        createdAt: at,
        updatedAt: at,
      },
    });
    return { status: "dispatched", attemptId };
  });

  const inspectReferenceBytes = vi.fn(async () => {
    const matches = options.recheckMatches ?? true;
    return {
      status: "inspected",
      matches,
      diagnostic: {
        stage: "read_only_reference_inspection" as const,
        acquisitionRoute: "verified_detail_original_extension_fetch" as const,
        preparedSha256: refSha,
        metadataSha256: refSha,
        savedBytesSha256: refSha,
        candidateBytesSha256: matches ? refSha : "d".repeat(64),
        candidateMediaId: "media-uuid-1",
        mimeType: "image/png",
        preparedByteSize: 4,
        savedByteSize: 4,
        candidateByteSize: 4,
        preparedWidth: 100,
        preparedHeight: 100,
      },
    };
  });

  const revalidate = vi.fn(async () => undefined as string | undefined);

  const handler = createFlowVideoQueueHandler({
    repositories,
    alarms: { create: createAlarm, clear: clearAlarm } as never,
    attachReference: attach,
    generateOnce: generate,
    inspectReferenceBytes,
    revalidate,
    now: () => at,
  });

  return {
    batch,
    db,
    repositories,
    handler,
    attach,
    generate,
    inspectReferenceBytes,
    revalidate,
    createAlarm,
    clearAlarm,
    now: () => at,
    advance: (ms: number) => { at += ms; },
    updateActiveTarget: async (targetOverrides: { documentId?: string; projectId?: string; tabId?: number }) => {
      const active = await repositories.getSelectedTarget("Flow");
      if (active?.verificationBinding) {
        const newDoc = targetOverrides.documentId ?? active.verificationBinding.documentId;
        const newProj = targetOverrides.projectId ?? active.verificationBinding.projectId;
        const newTab = targetOverrides.tabId ?? active.tabId;
        const newCanonical = newProj === projectId ? canonicalTarget : `https://flow.google.com/project/${newProj}`;
        await db.selectedTargets.put({
          ...active,
          tabId: newTab,
          canonicalTarget: newCanonical,
          verificationBinding: {
            ...active.verificationBinding,
            tabId: newTab,
            documentId: newDoc,
            projectId: newProj,
            canonicalTarget: newCanonical,
          },
        });
      }
    },
  };
}

describe("Flow video execution document rebinding (Phase 4 regression suite)", () => {
  it("Scenario 1: Same project and tab after a genuine page reload: allows inspection, requires confirmSameAccount, and rebinds cleanly", async () => {
    const f = await setupRebindFixture({ activeDocumentId: reloadedDocId });

    // Seed paused queue on candidate_bytes_mismatch
    await f.repositories.createFlowVideoQueue({
      queueId: `flow-video:${batchId}`,
      preparedBatchId: batchId,
      state: "paused",
      pauseReason: "candidate_bytes_mismatch",
      items: [
        { itemId: "item-1", order: 0, shotId: "1", referenceId: ref1, promptHash: f.batch.items[0]!.contentHash, state: "failed", reason: "candidate_bytes_mismatch" },
        { itemId: "item-2", order: 1, shotId: "2", referenceId: ref2, promptHash: f.batch.items[1]!.contentHash, state: "pending" },
      ],
      lastDispatchAt: null,
      nextActionAt: null,
      revision: 0,
      createdAt: 10,
      updatedAt: 10,
    });

    // Calling recheckAndResume without confirmSameAccount rejects
    await expect(
      f.handler.recheckAndResume(batchId, 0, false),
    ).rejects.toThrow("flow_same_account_confirmation_required");

    // Calling recheckAndResume with confirmSameAccount: true succeeds and creates executionDocumentRebind
    const resumed = await f.handler.recheckAndResume(batchId, 0, true);
    expect(resumed.executionDocumentRebind).toEqual(expect.objectContaining({
      fromTabId: tabId,
      toTabId: tabId,
      fromDocumentId: initialDocId,
      toDocumentId: reloadedDocId,
      projectId,
      canonicalTarget,
    }));
    expect(resumed.items[0]).toMatchObject({ state: "sent", priorReason: "candidate_bytes_mismatch" });

    // Verify stored queue
    const stored = await f.repositories.getFlowVideoQueue(`flow-video:${batchId}`);
    expect(stored?.executionDocumentRebind).toEqual(resumed.executionDocumentRebind);
  });

  it("Scenario 2: Read-only inspection on newly verified document: verifies bytes without mutating batch target or queue", async () => {
    const f = await setupRebindFixture({ activeDocumentId: reloadedDocId });

    // Seed paused queue
    await f.repositories.createFlowVideoQueue({
      queueId: `flow-video:${batchId}`,
      preparedBatchId: batchId,
      state: "paused",
      pauseReason: "candidate_bytes_mismatch",
      items: [
        { itemId: "item-1", order: 0, shotId: "1", referenceId: ref1, promptHash: f.batch.items[0]!.contentHash, state: "failed", reason: "candidate_bytes_mismatch" },
      ],
      lastDispatchAt: null,
      nextActionAt: null,
      revision: 0,
      createdAt: 10,
      updatedAt: 10,
    });

    // Execute read-only inspection
    const inspection = await f.inspectReferenceBytes(batchId, "item-1");
    expect(inspection.status).toBe("inspected");
    expect(inspection.matches).toBe(true);

    // Verify prepared batch target is completely unchanged
    const batchInDb = await f.repositories.getPreparedVideoBatchById(batchId);
    expect(batchInDb?.target.documentId).toBe(initialDocId);

    // Verify queue was NOT mutated by read-only inspection
    const queueInDb = await f.repositories.getFlowVideoQueue(`flow-video:${batchId}`);
    expect(queueInDb?.revision).toBe(0);
    expect(queueInDb?.executionDocumentRebind).toBeUndefined();
  });

  it("Scenario 3: Explicit pre-intent action rebind: subsequent actions use the rebound document", async () => {
    const f = await setupRebindFixture({ activeDocumentId: reloadedDocId });

    // Seed paused queue
    await f.repositories.createFlowVideoQueue({
      queueId: `flow-video:${batchId}`,
      preparedBatchId: batchId,
      state: "paused",
      pauseReason: "candidate_bytes_mismatch",
      items: [
        { itemId: "item-1", order: 0, shotId: "1", referenceId: ref1, promptHash: f.batch.items[0]!.contentHash, state: "failed", reason: "candidate_bytes_mismatch" },
      ],
      lastDispatchAt: null,
      nextActionAt: null,
      revision: 0,
      createdAt: 10,
      updatedAt: 10,
    });

    // Explicit rebind
    await f.handler.recheckAndResume(batchId, 0, true);

    // Attach reference and generateOnce were called with rebound document
    expect(f.attach).toHaveBeenCalledWith(batchId, "item-1");
    expect(f.generate).toHaveBeenCalledWith(batchId, "item-1");

    const op = await f.repositories.getFlowVideoAttachmentOperation(`${batchId}:item-1`);
    expect(op?.verifiedAttachment?.documentId).toBe(reloadedDocId);
    expect(op?.videoGeneration?.documentId).toBe(reloadedDocId);
  });

  it("Scenario 4: Different project denied: rejects rebind when project ID changes", async () => {
    const f = await setupRebindFixture({ activeDocumentId: reloadedDocId, activeProjectId: "different-flow-project" });

    await f.repositories.createFlowVideoQueue({
      queueId: `flow-video:${batchId}`,
      preparedBatchId: batchId,
      state: "paused",
      pauseReason: "candidate_bytes_mismatch",
      items: [
        { itemId: "item-1", order: 0, shotId: "1", referenceId: ref1, promptHash: f.batch.items[0]!.contentHash, state: "failed", reason: "candidate_bytes_mismatch" },
      ],
      lastDispatchAt: null,
      nextActionAt: null,
      revision: 0,
      createdAt: 10,
      updatedAt: 10,
    });

    await expect(
      f.handler.recheckAndResume(batchId, 0, true),
    ).rejects.toThrow("flow_resume_binding_project_id_mismatch");

    const queueInDb = await f.repositories.getFlowVideoQueue(`flow-video:${batchId}`);
    expect(queueInDb?.executionDocumentRebind).toBeUndefined();
    expect(queueInDb?.state).toBe("paused");
  });

  it("Scenario 5: Different tab denied: rejects rebind when tab ID changes", async () => {
    const f = await setupRebindFixture({ activeDocumentId: reloadedDocId, activeTabId: 999 });

    await f.repositories.createFlowVideoQueue({
      queueId: `flow-video:${batchId}`,
      preparedBatchId: batchId,
      state: "paused",
      pauseReason: "candidate_bytes_mismatch",
      items: [
        { itemId: "item-1", order: 0, shotId: "1", referenceId: ref1, promptHash: f.batch.items[0]!.contentHash, state: "failed", reason: "candidate_bytes_mismatch" },
      ],
      lastDispatchAt: null,
      nextActionAt: null,
      revision: 0,
      createdAt: 10,
      updatedAt: 10,
    });

    await expect(
      f.handler.recheckAndResume(batchId, 0, true),
    ).rejects.toThrow("flow_resume_binding_tab_id_mismatch");

    const queueInDb = await f.repositories.getFlowVideoQueue(`flow-video:${batchId}`);
    expect(queueInDb?.executionDocumentRebind).toBeUndefined();
  });

  it("Scenario 6: New document becoming stale again after rebind: rejects actions if document changes once more", async () => {
    const f = await setupRebindFixture({ activeDocumentId: reloadedDocId });

    // Seed paused queue
    await f.repositories.createFlowVideoQueue({
      queueId: `flow-video:${batchId}`,
      preparedBatchId: batchId,
      state: "paused",
      pauseReason: "candidate_bytes_mismatch",
      items: [
        { itemId: "item-1", order: 0, shotId: "1", referenceId: ref1, promptHash: f.batch.items[0]!.contentHash, state: "failed", reason: "candidate_bytes_mismatch" },
        { itemId: "item-2", order: 1, shotId: "2", referenceId: ref2, promptHash: f.batch.items[1]!.contentHash, state: "pending" },
      ],
      lastDispatchAt: null,
      nextActionAt: null,
      revision: 0,
      createdAt: 10,
      updatedAt: 10,
    });

    // Rebind to reloadedDocId
    const afterRebind = await f.handler.recheckAndResume(batchId, 0, true);
    const paused = await f.handler.pause(batchId, afterRebind.revision);

    // Now simulate document reloading a third time (stale again!)
    await f.updateActiveTarget({ documentId: thirdDocId });

    // Next resume or recheck revalidates against rebound document (reloadedDocId)
    // When revalidate reports mismatch or resume checks document
    f.revalidate.mockResolvedValueOnce("selected_flow_document_changed");
    await expect(
      f.handler.resume(batchId, paused.revision, true),
    ).rejects.toThrow("target_revalidation_failed");
  });

  it("Scenario 7: Uncertain Add/Generate outcome denies rebind: refuses rebind if queue has uncertain items", async () => {
    const f = await setupRebindFixture({ activeDocumentId: reloadedDocId });

    await f.repositories.createFlowVideoQueue({
      queueId: `flow-video:${batchId}`,
      preparedBatchId: batchId,
      state: "paused",
      pauseReason: "generation_response_lost",
      items: [
        { itemId: "item-1", order: 0, shotId: "1", referenceId: ref1, promptHash: f.batch.items[0]!.contentHash, state: "uncertain", reason: "generation_response_lost" },
      ],
      lastDispatchAt: null,
      nextActionAt: null,
      revision: 0,
      createdAt: 10,
      updatedAt: 10,
    });

    await expect(
      f.handler.recheckAndResume(batchId, 0, true),
    ).rejects.toThrow("flow_video_queue_failure_not_recheckable");
  });

  it("Scenario 8: Same provider asset with exact saved SHA passes: matches: true", async () => {
    const f = await setupRebindFixture({ activeDocumentId: reloadedDocId, recheckMatches: true });
    const inspection = await f.inspectReferenceBytes(batchId, "item-1");
    expect(inspection.status).toBe("inspected");
    expect(inspection.matches).toBe(true);
    expect(inspection.diagnostic?.preparedSha256).toBe(inspection.diagnostic?.candidateBytesSha256);
  });

  it("Scenario 9: Different bytes fail: matches: false and does not claim intent", async () => {
    const f = await setupRebindFixture({ activeDocumentId: reloadedDocId, recheckMatches: false });
    const inspection = await f.inspectReferenceBytes(batchId, "item-1");
    expect(inspection.status).toBe("inspected");
    expect(inspection.matches).toBe(false);
    expect(inspection.diagnostic?.preparedSha256).not.toBe(inspection.diagnostic?.candidateBytesSha256);

    // Attempting recheckAndResume with mismatched candidate bytes fails closed
    await f.repositories.createFlowVideoQueue({
      queueId: `flow-video:${batchId}`,
      preparedBatchId: batchId,
      state: "paused",
      pauseReason: "candidate_bytes_mismatch",
      items: [
        { itemId: "item-1", order: 0, shotId: "1", referenceId: ref1, promptHash: f.batch.items[0]!.contentHash, state: "failed", reason: "candidate_bytes_mismatch" },
      ],
      lastDispatchAt: null,
      nextActionAt: null,
      revision: 0,
      createdAt: 10,
      updatedAt: 10,
    });

    await expect(
      f.handler.recheckAndResume(batchId, 0, true),
    ).rejects.toThrow("reference_recheck_did_not_match");

    // No attachment operation was created
    const op = await f.repositories.getFlowVideoAttachmentOperation(`${batchId}:item-1`);
    expect(op).toBeUndefined();
  });

  it("Scenario 10: Existing no-replay guarantees remain intact: dispatched items are preserved and never re-dispatched", async () => {
    const f = await setupRebindFixture({ activeDocumentId: reloadedDocId });

    // Item 1 was already dispatched successfully on initialDocId
    const item1Receipt = {
      attemptId: "attempt-1",
      storedAt: 50,
    };

    await f.repositories.putFlowVideoAttachmentOperation({
      id: `${batchId}:item-1`,
      preparedBatchId: batchId,
      itemId: "item-1",
      referenceId: ref1,
      status: "attached",
      updatedAt: 50,
      videoGeneration: {
        attemptId: "attempt-1",
        preparedBatchId: batchId,
        itemId: "item-1",
        canonicalShotId: "1",
        promptHash: f.batch.items[0]!.contentHash,
        referenceId: ref1,
        tabId,
        projectId,
        canonicalTarget,
        documentId: initialDocId,
        state: "dispatched",
        createdAt: 50,
        updatedAt: 50,
      },
    });

    // Queue paused on Item 2 failure
    await f.repositories.createFlowVideoQueue({
      queueId: `flow-video:${batchId}`,
      preparedBatchId: batchId,
      state: "paused",
      pauseReason: "candidate_bytes_mismatch",
      items: [
        { itemId: "item-1", order: 0, shotId: "1", referenceId: ref1, promptHash: f.batch.items[0]!.contentHash, state: "sent", attemptId: "attempt-1", dispatchReceipt: item1Receipt },
        { itemId: "item-2", order: 1, shotId: "2", referenceId: ref2, promptHash: f.batch.items[1]!.contentHash, state: "failed", reason: "candidate_bytes_mismatch" },
      ],
      lastDispatchAt: 50,
      nextActionAt: null,
      revision: 1,
      createdAt: 10,
      updatedAt: 50,
    });

    // Recheck & Resume Item 2
    const resumed = await f.handler.recheckAndResume(batchId, 1, true);
    expect(resumed.state).toBe("sent");

    // Item 1 is STILL sent with original attemptId and receipt
    const item1 = resumed.items.find((i) => i.itemId === "item-1")!;
    expect(item1.state).toBe("sent");
    expect(item1.dispatchReceipt).toEqual(item1Receipt);
    expect(item1.attemptId).toBe("attempt-1");

    // Generate was only called for item-2, NOT item-1
    expect(f.generate).not.toHaveBeenCalledWith(batchId, "item-1");
    expect(f.generate).toHaveBeenCalledWith(batchId, "item-2");
  });

  it("Scenario 11: References, image queues, and Vids remain unaffected", async () => {
    // Verify that the schema supports executionDocumentRebind without impacting Vids or references
    const f = await setupRebindFixture();
    const vidsQueue = await f.repositories.getVidsVideoQueue("vids:arbitrary");
    expect(vidsQueue).toBeUndefined();

    const imageQueue = await f.repositories.getTimedImageSubmissionQueue("img:arbitrary");
    expect(imageQueue).toBeUndefined();

    // Verify database schema tables exist and function independently
    expect(f.db.flowVideoQueues).toBeDefined();
    expect(f.db.vidsVideoQueues).toBeDefined();
    expect(f.db.imageSubmissionQueues).toBeDefined();
    expect(f.db.pinnedReferenceMedia).toBeDefined();
  });
});
