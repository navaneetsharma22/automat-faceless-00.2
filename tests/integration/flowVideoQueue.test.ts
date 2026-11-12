import { describe, expect, it, vi } from "vitest";
import { createFlowVideoQueueHandler, FLOW_VIDEO_QUEUE_ALARM_PREFIX } from "../../src/background/handlers/flowVideoQueue";
import { VIDEO_QUEUE_DISPATCH_GAP_MS, VIDEO_QUEUE_READINESS_TIMEOUT_MS } from "../../src/domain/jobs/videoQueue";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { ExtensionRepositories } from "../../src/storage/repositories";
import type { FlowVideoQueueRecord } from "../../src/domain/jobs/videoQueue";
import type { PreparedVideoBatchRecord } from "../../src/domain/batches/types";
import type { FlowVideoAttachmentOperation } from "../../src/storage/db";
import type { ReferenceByteComparisonDiagnostic } from "../../src/domain/media/references";
import { sha256Bytes } from "../../src/domain/media/references";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";

const batchId = "prepared-video-two-shots";
const ref1 = "11111111-1111-4111-8111-111111111111";
const ref2 = "22222222-2222-4222-8222-222222222222";
const prompts = [
  JSON.stringify({ shot_id: "1", prompt_type: "video", scene_title: "One" }),
  JSON.stringify({ shot_id: "2", prompt_type: "video", scene_title: "Two" }),
];

async function setup(options: {
  disabledAttempts?: number;
  attachStatus?: string;
  attachDiagnostic?: ReferenceByteComparisonDiagnostic;
  attachFailOnce?: boolean;
  recheckMatches?: boolean;
  operationAppearsDuringInspection?: boolean;
  operationChangesBeforeAtomicCommit?: boolean;
  generateStatus?: string;
  responseLost?: boolean;
  existingFirstGeneration?: FlowVideoAttachmentOperation["videoGeneration"];
} = {}) {
  const db = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(db);
  const hashes = await Promise.all(prompts.map((prompt) => sha256Hex(prompt)));
  const batch: PreparedVideoBatchRecord = {
    id: batchId, requestId: "33333333-3333-4333-8333-333333333333", workspaceId: "default", preparedAt: 10,
    videoBatchId: "video-source", videoSourceHash: "a".repeat(64), videoSourceText: JSON.stringify(prompts.map((body) => JSON.parse(body))),
    imageSourceBatchId: "image-source", imageSourceBatchHash: "b".repeat(64), destination: "Flow",
    target: { provider: "Flow", tabId: 7, canonicalTarget: "https://flow.google.com/project/p", projectId: "p", documentId: "doc", verification: "verified", verifiedAt: 1 },
    manualSettingsDeclaration: { confirmationId: "confirm", confirmedAt: 1, destination: "Flow", declaredDurationSeconds: 6, tabId: 7, canonicalTarget: "https://flow.google.com/project/p", projectId: "p", documentId: "doc" },
    status: "prepared", itemCount: 2,
    items: prompts.map((rawJsonBody, order) => ({
      itemId: `item-${order + 1}`, order, shotId: String(order + 1), canonicalShotId: String(order + 1), rawJsonBody,
      contentHash: hashes[order]!, sourceSpan: { start: order, end: order + rawJsonBody.length },
      reference: { referenceId: order === 0 ? ref1 : ref2, assignmentVersion: 1, sha256: "c".repeat(64), mimeType: "image/png", byteSize: 4, width: 1, height: 1, capturedAt: 1 },
    })), createdAt: 1, updatedAt: 1,
  };
  await db.preparedVideoBatches.put(batch);
  let at = 100_000;
  const create = vi.fn(async () => undefined);
  const clear = vi.fn(async () => true);
  let attachCalls = 0;
  const attach = vi.fn(async (id: string, itemId: string) => {
    attachCalls += 1;
    if (options.attachStatus && options.attachStatus !== "attached" && !(options.attachFailOnce && attachCalls > 1)) return { status: options.attachStatus, reason: options.attachDiagnostic ? "candidate_bytes_mismatch" : "synthetic_attach_failure", ...(options.attachDiagnostic ? { diagnostic: options.attachDiagnostic } : {}) };
    const item = batch.items.find((candidate) => candidate.itemId === itemId)!;
    await repositories.putFlowVideoAttachmentOperation({
      id: `${id}:${itemId}`, preparedBatchId: id, itemId, referenceId: item.reference.referenceId, status: "attached", updatedAt: at,
      verifiedAttachment: { documentId: "doc", mediaId: `media-${itemId}`, verifiedAt: at },
      ...(itemId === "item-1" && options.existingFirstGeneration ? { videoGeneration: options.existingFirstGeneration } : {}),
    });
    return { status: "attached" };
  });
  if (options.existingFirstGeneration) {
    const item = batch.items[0]!;
    await repositories.putFlowVideoAttachmentOperation({
      id: `${batchId}:${item.itemId}`, preparedBatchId: batchId, itemId: item.itemId,
      referenceId: item.reference.referenceId, status: "attached", updatedAt: at, videoGeneration: options.existingFirstGeneration,
    });
  }
  let attempt = 0;
  const generate = vi.fn(async (id: string, itemId: string) => {
    if (attempt++ < (options.disabledAttempts ?? 0)) return { status: "blocked", reason: "generate_disabled" };
    const item = batch.items.find((candidate) => candidate.itemId === itemId)!;
    const attemptId = `attempt-${attempt}`;
    if (options.generateStatus && options.generateStatus !== "dispatched") return { status: options.generateStatus, reason: "synthetic_generation_failure", attemptId };
    await repositories.putFlowVideoAttachmentOperation({
      id: `${id}:${itemId}`, preparedBatchId: id, itemId, referenceId: item.reference.referenceId, status: "attached", updatedAt: at,
      videoGeneration: { attemptId, preparedBatchId: id, itemId, canonicalShotId: item.canonicalShotId, promptHash: item.contentHash, referenceId: item.reference.referenceId, tabId: 7, projectId: "p", canonicalTarget: "https://flow.google.com/project/p", documentId: "doc", state: "dispatched", createdAt: at, updatedAt: at },
    });
    return options.responseLost ? { status: "uncertain", reason: "generation_response_lost", attemptId } : { status: "dispatched", attemptId };
  });
  const inspectReferenceBytes = vi.fn(async () => {
    if (options.operationAppearsDuringInspection) {
      const item = batch.items[1]!;
      await repositories.putFlowVideoAttachmentOperation({
        id: `${batchId}:${item.itemId}`, preparedBatchId: batchId, itemId: item.itemId,
        referenceId: item.reference.referenceId, status: "action_intent", updatedAt: at,
      });
    }
    return {
      status: "inspected",
      matches: options.recheckMatches ?? true,
      diagnostic: {
        stage: "read_only_reference_inspection" as const,
        acquisitionRoute: "verified_detail_original_extension_fetch" as const,
        preparedSha256: "c".repeat(64), metadataSha256: "c".repeat(64), savedBytesSha256: "c".repeat(64),
        candidateBytesSha256: options.recheckMatches === false ? "d".repeat(64) : "c".repeat(64),
        candidateMediaId: "66c14f25-59b9-42ea-a6f7-8eeb627dcf87", mimeType: "image/jpeg",
        preparedByteSize: 4, savedByteSize: 4, candidateByteSize: 4, preparedWidth: 1376, preparedHeight: 768,
      },
    };
  });
  let revalidationCalls = 0;
  const revalidate = vi.fn(async () => {
    revalidationCalls += 1;
    if (options.operationChangesBeforeAtomicCommit && revalidationCalls === 3) {
      const item = batch.items[0]!;
      await repositories.putFlowVideoAttachmentOperation({ id: `${batchId}:${item.itemId}`, preparedBatchId: batchId, itemId: item.itemId, referenceId: item.reference.referenceId, status: "action_intent", updatedAt: at });
    }
    return undefined as string | undefined;
  });
  const handler = createFlowVideoQueueHandler({ repositories, alarms: { create, clear } as never, attachReference: attach, generateOnce: generate, inspectReferenceBytes, revalidate, now: () => at });
  return { batch, db, repositories, handler, attach, generate, inspectReferenceBytes, revalidate, create, clear, now: () => at, advance: (ms: number) => { at += ms; }, getQueue: () => repositories.getFlowVideoQueue(`flow-video:${batchId}`) };
}

async function seedPausedTargetChangedQueue(
  f: Awaited<ReturnType<typeof setup>>,
  reason: "target_changed" | "candidate_missing" = "target_changed",
) {
  await f.repositories.createFlowVideoQueue({
    queueId: `flow-video:${batchId}`,
    preparedBatchId: batchId,
    state: "paused",
    pauseReason: reason,
    items: f.batch.items.map((item, order) => ({
      itemId: item.itemId,
      order,
      shotId: item.canonicalShotId,
      referenceId: item.reference.referenceId,
      promptHash: item.contentHash,
      state: order === 0 ? ("failed" as const) : ("pending" as const),
      ...(order === 0 ? { reason } : {}),
    })),
    lastDispatchAt: null,
    nextActionAt: null,
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
  });
}

async function seedPausedPickerQueue(
  f: Awaited<ReturnType<typeof setup>>,
  options: { reason?: string; verifiedAttachment?: boolean } = {},
) {
  const reason = options.reason ?? "picker_exact_row_missing";
  const item = f.batch.items[0]!;
  await f.repositories.putFlowVideoAttachmentOperation({
    id: `${batchId}:${item.itemId}`,
    preparedBatchId: batchId,
    itemId: item.itemId,
    referenceId: item.reference.referenceId,
    status: "uncertain",
    reason,
    updatedAt: 1,
    ...(options.verifiedAttachment
      ? {
          verifiedAttachment: {
            documentId: "doc",
            mediaId: "media-item-1",
            verifiedAt: 1,
          },
        }
      : {}),
  });
  await f.repositories.createFlowVideoQueue({
    queueId: `flow-video:${batchId}`,
    preparedBatchId: batchId,
    state: "paused",
    pauseReason: reason,
    items: f.batch.items.map((entry, order) => ({
      itemId: entry.itemId,
      order,
      shotId: entry.canonicalShotId,
      referenceId: entry.reference.referenceId,
      promptHash: entry.contentHash,
      state: order === 0 ? ("uncertain" as const) : ("pending" as const),
      ...(order === 0 ? { reason } : {}),
    })),
    lastDispatchAt: null,
    nextActionAt: null,
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
  });
}

describe("P09.3 Flow video timed submission", () => {
  it("advances after a durable receipt and the 30-second interval without completion evidence", async () => {
    const f = await setup();
    let queue = await f.handler.start(batchId);
    expect(queue.items[0]).toMatchObject({ state: "sent", attemptId: "attempt-1", dispatchReceipt: { attemptId: "attempt-1", storedAt: f.now() } });
    expect(queue.items[1]?.state).toBe("pending");
    expect(queue.nextActionAt).toBe(f.now() + VIDEO_QUEUE_DISPATCH_GAP_MS);
    f.advance(VIDEO_QUEUE_DISPATCH_GAP_MS);
    queue = await f.handler.onAlarm(`${FLOW_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`) as FlowVideoQueueRecord;
    expect(queue.items[1]).toMatchObject({ state: "sent", attemptId: "attempt-2" });
    expect(queue.state).toBe("sent");
    expect(f.generate).toHaveBeenCalledTimes(2);
  });

  it("waits for Generate readiness and pauses visibly when it stays disabled for 60 seconds", async () => {
    const f = await setup({ disabledAttempts: 5 });
    let queue = await f.handler.start(batchId);
    expect(queue.items[0]).toMatchObject({ state: "waiting_for_generate", reason: "generate_disabled" });
    expect(queue.nextActionAt).toBe(f.now() + 30_000);
    f.advance(30_000);
    queue = await f.handler.onAlarm(`${FLOW_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`) as FlowVideoQueueRecord;
    expect(queue.state).toBe("waiting");
    f.advance(30_000);
    queue = await f.handler.onAlarm(`${FLOW_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`) as FlowVideoQueueRecord;
    expect(queue).toMatchObject({ state: "paused", pauseReason: "flow_generate_readiness_timeout", nextActionAt: null });
    expect(queue.items[0]?.state).toBe("waiting_for_generate");
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect((await f.repositories.getFlowVideoAttachmentOperation(`${batchId}:item-1`))?.videoGeneration).toBeUndefined();
  });

  it("serializes duplicate Start requests so each pair dispatches once", async () => {
    const f = await setup();
    const [left, right] = await Promise.all([f.handler.start(batchId), f.handler.start(batchId)]);
    expect(left.queueId).toBe(right.queueId);
    expect(f.attach).toHaveBeenCalledTimes(1);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("preserves the existing Shot 1 dispatch and continues only with the remaining pair", async () => {
    const f = await setup({ existingFirstGeneration: {
      attemptId: "existing-shot-one-attempt", preparedBatchId: batchId, itemId: "item-1", canonicalShotId: "1", promptHash: await sha256Hex(prompts[0]!), referenceId: ref1,
      tabId: 7, projectId: "p", canonicalTarget: "https://flow.google.com/project/p", documentId: "doc", state: "dispatched", createdAt: 10, updatedAt: 20,
    } });
    const queue = await f.handler.start(batchId);
    expect(queue.items[0]).toMatchObject({ state: "sent", attemptId: "existing-shot-one-attempt" });
    expect(queue.items[1]).toMatchObject({ state: "sent", attemptId: "attempt-1" });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.attach).toHaveBeenCalledTimes(1);
    expect(f.attach).toHaveBeenCalledWith(batchId, "item-2");
  });

  it("blocks an existing dispatch whose prompt/reference binding does not match the prepared pair", async () => {
    const f = await setup();
    const item = f.batch.items[0]!;
    await f.repositories.putFlowVideoAttachmentOperation({
      id: `${batchId}:${item.itemId}`, preparedBatchId: batchId, itemId: item.itemId,
      referenceId: ref2, status: "attached", updatedAt: f.now(),
      videoGeneration: { attemptId: "wrong-binding-attempt", preparedBatchId: batchId, itemId: item.itemId,
        canonicalShotId: item.canonicalShotId, promptHash: item.contentHash, referenceId: ref2, tabId: 7,
        projectId: "p", canonicalTarget: "https://flow.google.com/project/p", documentId: "doc",
        state: "dispatched", createdAt: f.now(), updatedAt: f.now() },
    });
    const queue = await f.handler.start(batchId);
    expect(queue).toMatchObject({ state: "paused" });
    expect(queue.items[0]).toMatchObject({ state: "uncertain", reason: "existing_generation_binding_mismatch" });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.attach).not.toHaveBeenCalled();
  });

  it("persists bounded byte-comparison diagnostics on candidate mismatch without activation", async () => {
    const diagnostic: ReferenceByteComparisonDiagnostic = {
      stage: "candidate_byte_verification", acquisitionRoute: "verified_document_same_origin", preparedSha256: "a".repeat(64), metadataSha256: "a".repeat(64),
      savedBytesSha256: "a".repeat(64), candidateBytesSha256: "b".repeat(64), candidateMediaId: "66c14f25-59b9-42ea-a6f7-8eeb627dcf87",
      mimeType: "image/png", preparedByteSize: 4, savedByteSize: 4, candidateByteSize: 3,
      preparedWidth: 1376, preparedHeight: 768, candidateWidth: 1376, candidateHeight: 768,
    };
    const f = await setup({ attachStatus: "blocked", attachDiagnostic: diagnostic });
    const queue = await f.handler.start(batchId);
    expect(queue.items[0]).toMatchObject({ state: "failed", reason: "candidate_bytes_mismatch", byteMismatchDiagnostic: diagnostic });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.attach).toHaveBeenCalledTimes(1);
  });

  it("explicitly rechecks a proven pre-intent mismatch, preserves its evidence, skips Sent Shot 1, and continues with Shot 2", async () => {
    const shotOne: NonNullable<FlowVideoAttachmentOperation["videoGeneration"]> = {
      attemptId: "shot-one-original-attempt", preparedBatchId: batchId, itemId: "item-1", canonicalShotId: "1",
      promptHash: await sha256Hex(prompts[0]!), referenceId: ref1, tabId: 7, projectId: "p",
      canonicalTarget: "https://flow.google.com/project/p", documentId: "doc", state: "dispatched", createdAt: 20, updatedAt: 20,
    };
    const f = await setup({ existingFirstGeneration: shotOne, attachStatus: "blocked", attachFailOnce: true, attachDiagnostic: {
      stage: "candidate_byte_verification", acquisitionRoute: "verified_detail_original_extension_fetch",
      preparedSha256: "c".repeat(64), metadataSha256: "c".repeat(64), savedBytesSha256: "c".repeat(64), candidateBytesSha256: "d".repeat(64),
      candidateMediaId: "66c14f25-59b9-42ea-a6f7-8eeb627dcf87", mimeType: "image/webp",
      preparedByteSize: 4, savedByteSize: 4, candidateByteSize: 3, preparedWidth: 1376, preparedHeight: 768, candidateWidth: 1376, candidateHeight: 768,
    } });
    const blocked = await f.handler.start(batchId);
    const originalDiagnostic = blocked.items[1]?.byteMismatchDiagnostic;
    expect(blocked).toMatchObject({ state: "paused", items: [{ state: "sent", attemptId: shotOne.attemptId }, { state: "failed", reason: "candidate_bytes_mismatch" }] });
    expect(f.generate).not.toHaveBeenCalled();

    f.revalidate.mockClear();
    const resumed = await f.handler.recheckAndResume(batchId, blocked.revision);
    expect(f.inspectReferenceBytes).toHaveBeenCalledWith(batchId, "item-2");
    expect(f.revalidate).toHaveBeenCalledTimes(3);
    expect(resumed.items[0]).toMatchObject({ state: "sent", attemptId: shotOne.attemptId, dispatchReceipt: { attemptId: shotOne.attemptId } });
    expect(resumed.items[1]).toMatchObject({ state: "sent", priorReason: "candidate_bytes_mismatch", byteMismatchDiagnostic: originalDiagnostic });
    expect(f.attach.mock.calls.map(([, item]) => item)).toEqual(["item-2", "item-2"]);
    expect(f.generate.mock.calls.map(([, item]) => item)).toEqual(["item-2"]);
    expect((await f.repositories.getFlowVideoAttachmentOperation(`${batchId}:item-1`))?.videoGeneration?.attemptId).toBe(shotOne.attemptId);
  });

  it("does not resume when the recheck still mismatches or target validation fails", async () => {
    for (const options of [{ recheckMatches: false }, { targetChangesDuringRecheck: true }]) {
      const f = await setup({ attachStatus: "blocked", attachDiagnostic: {
        stage: "candidate_byte_verification", acquisitionRoute: "verified_detail_original_extension_fetch",
        preparedSha256: "c".repeat(64), metadataSha256: "c".repeat(64), savedBytesSha256: "c".repeat(64), candidateBytesSha256: "d".repeat(64),
        candidateMediaId: "66c14f25-59b9-42ea-a6f7-8eeb627dcf87", mimeType: "image/webp", preparedByteSize: 4, savedByteSize: 4, candidateByteSize: 3, preparedWidth: 1376, preparedHeight: 768,
      }, ...options });
      const before = await f.handler.start(batchId);
      if ("targetChangesDuringRecheck" in options) f.revalidate.mockResolvedValueOnce("selected_flow_target_changed");
      await expect(f.handler.recheckAndResume(batchId, before.revision)).rejects.toThrow();
      expect(await f.getQueue()).toEqual(before);
      expect(f.generate).not.toHaveBeenCalled();
    }
  });

  it("rejects unresolved attachment or generation intent and rechecks an operation that appears concurrently", async () => {
    for (const status of ["action_intent", "uncertain"] as const) {
      const f = await setup({ attachStatus: "blocked", attachDiagnostic: {
        stage: "candidate_byte_verification", acquisitionRoute: "verified_detail_original_extension_fetch",
        preparedSha256: "c".repeat(64), metadataSha256: "c".repeat(64), savedBytesSha256: "c".repeat(64), candidateBytesSha256: "d".repeat(64),
        candidateMediaId: "66c14f25-59b9-42ea-a6f7-8eeb627dcf87", mimeType: "image/webp", preparedByteSize: 4, savedByteSize: 4, candidateByteSize: 3, preparedWidth: 1376, preparedHeight: 768,
      } });
      const blocked = await f.handler.start(batchId);
      const failedEntry = blocked.items.find((entry) => entry.state === "failed")!;
      const item = f.batch.items.find((entry) => entry.itemId === failedEntry.itemId)!;
      await f.repositories.putFlowVideoAttachmentOperation({ id: `${batchId}:${item.itemId}`, preparedBatchId: batchId, itemId: item.itemId, referenceId: item.reference.referenceId, status, updatedAt: f.now() });
      await expect(f.handler.recheckAndResume(batchId, blocked.revision)).rejects.toThrow("failed_item_has_existing_operation");
      expect(f.inspectReferenceBytes).not.toHaveBeenCalled();
      expect(f.generate).not.toHaveBeenCalled();
    }

    const generationIntent = await setup({ attachStatus: "blocked", attachDiagnostic: {
      stage: "candidate_byte_verification", acquisitionRoute: "verified_detail_original_extension_fetch",
      preparedSha256: "c".repeat(64), metadataSha256: "c".repeat(64), savedBytesSha256: "c".repeat(64), candidateBytesSha256: "d".repeat(64),
      candidateMediaId: "66c14f25-59b9-42ea-a6f7-8eeb627dcf87", mimeType: "image/webp", preparedByteSize: 4, savedByteSize: 4, candidateByteSize: 3, preparedWidth: 1376, preparedHeight: 768,
    } });
    const generationBlocked = await generationIntent.handler.start(batchId);
    const failedItem = generationBlocked.items.find((entry) => entry.state === "failed")!;
    const preparedItem = generationIntent.batch.items.find((entry) => entry.itemId === failedItem.itemId)!;
    await generationIntent.repositories.putFlowVideoAttachmentOperation({
      id: `${batchId}:${failedItem.itemId}`, preparedBatchId: batchId, itemId: failedItem.itemId,
      referenceId: preparedItem.reference.referenceId, status: "attached", updatedAt: generationIntent.now(),
      videoGeneration: {
        attemptId: "unresolved-generation-intent", preparedBatchId: batchId, itemId: failedItem.itemId,
        canonicalShotId: preparedItem.canonicalShotId, promptHash: preparedItem.contentHash,
        referenceId: preparedItem.reference.referenceId, tabId: 7, projectId: "p",
        canonicalTarget: "https://flow.google.com/project/p", documentId: "doc",
        state: "dispatch_intent", createdAt: generationIntent.now(), updatedAt: generationIntent.now(),
      },
    });
    await expect(generationIntent.handler.recheckAndResume(batchId, generationBlocked.revision)).rejects.toThrow("failed_item_has_existing_operation");
    expect(generationIntent.inspectReferenceBytes).not.toHaveBeenCalled();
    expect(generationIntent.generate).not.toHaveBeenCalled();

    const concurrent = await setup({ attachStatus: "blocked", attachDiagnostic: {
      stage: "candidate_byte_verification", acquisitionRoute: "verified_detail_original_extension_fetch",
      preparedSha256: "c".repeat(64), metadataSha256: "c".repeat(64), savedBytesSha256: "c".repeat(64), candidateBytesSha256: "d".repeat(64),
      candidateMediaId: "66c14f25-59b9-42ea-a6f7-8eeb627dcf87", mimeType: "image/webp", preparedByteSize: 4, savedByteSize: 4, candidateByteSize: 3, preparedWidth: 1376, preparedHeight: 768,
    }, operationAppearsDuringInspection: true });
    const blocked = await concurrent.handler.start(batchId);
    await expect(concurrent.handler.recheckAndResume(batchId, blocked.revision)).rejects.toThrow("flow_video_operation_changed_during_recheck");
    expect(await concurrent.getQueue()).toEqual(blocked);
    expect(await concurrent.repositories.getFlowVideoAttachmentOperation(`${batchId}:item-2`)).toMatchObject({ status: "action_intent" });
    expect(concurrent.generate).not.toHaveBeenCalled();

    const atomicRace = await setup({ attachStatus: "blocked", attachDiagnostic: {
      stage: "candidate_byte_verification", acquisitionRoute: "verified_detail_original_extension_fetch",
      preparedSha256: "c".repeat(64), metadataSha256: "c".repeat(64), savedBytesSha256: "c".repeat(64), candidateBytesSha256: "d".repeat(64),
      candidateMediaId: "66c14f25-59b9-42ea-a6f7-8eeb627dcf87", mimeType: "image/webp", preparedByteSize: 4, savedByteSize: 4, candidateByteSize: 3, preparedWidth: 1376, preparedHeight: 768,
    }, operationChangesBeforeAtomicCommit: true });
    const atomicBlocked = await atomicRace.handler.start(batchId);
    await expect(atomicRace.handler.recheckAndResume(batchId, atomicBlocked.revision)).rejects.toThrow("flow_video_queue_or_operation_changed");
    expect(await atomicRace.getQueue()).toEqual(atomicBlocked);
    expect(await atomicRace.repositories.getFlowVideoAttachmentOperation(`${batchId}:item-1`)).toMatchObject({ status: "action_intent" });
    expect(atomicRace.generate).not.toHaveBeenCalled();
  });

  it("migrates an old completion-wait record from its durable dispatched operation on restart", async () => {
    const f = await setup({ existingFirstGeneration: {
      attemptId: "existing-shot-one-attempt", preparedBatchId: batchId, itemId: "item-1", canonicalShotId: "1", promptHash: await sha256Hex(prompts[0]!), referenceId: ref1,
      tabId: 7, projectId: "p", canonicalTarget: "https://flow.google.com/project/p", documentId: "doc", state: "dispatched", createdAt: 10, updatedAt: 20,
    } });
    const old: FlowVideoQueueRecord = {
      queueId: `flow-video:${batchId}`, preparedBatchId: batchId, state: "paused", pauseReason: "video_result_attribution_unavailable",
      items: [{ itemId: "item-1", order: 0, shotId: "1", referenceId: ref1, promptHash: await sha256Hex(prompts[0]!), state: "awaiting_verification", attemptId: "existing-shot-one-attempt", reason: "video_result_attribution_unavailable" },
        { itemId: "item-2", order: 1, shotId: "2", referenceId: ref2, promptHash: await sha256Hex(prompts[1]!), state: "pending" }],
      lastDispatchAt: 20, nextActionAt: null, revision: 0, createdAt: 1, updatedAt: 20,
    };
    await f.repositories.createFlowVideoQueue(old);
    await f.handler.reconcileStartup();
    expect(await f.getQueue()).toMatchObject({ state: "waiting", lastDispatchAt: 20, items: [{ state: "sent", attemptId: "existing-shot-one-attempt" }, { state: "pending" }] });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.create).toHaveBeenCalled();
  });

  it("never replays a lost/uncertain activation and retains a proven durable receipt", async () => {
    const f = await setup({ responseLost: true });
    const queue = await f.handler.start(batchId);
    expect(queue.items[0]).toMatchObject({ state: "sent", dispatchReceipt: { attemptId: "attempt-1" } });
    expect(queue.state).toBe("waiting");
    expect(f.generate).toHaveBeenCalledTimes(1);
    const uncertain = await setup({ generateStatus: "uncertain" });
    let blocked = await uncertain.handler.start(batchId);
    expect(blocked.items[0]?.state).toBe("uncertain");
    blocked = await uncertain.handler.resume(batchId, blocked.revision);
    expect(blocked.state).toBe("blocked");
    expect(uncertain.generate).toHaveBeenCalledTimes(1);
  });

  it("recovers one pre-intent target_changed failure on explicit Resume after revalidating the target", async () => {
    const f = await setup();
    await seedPausedTargetChangedQueue(f);
    const resumed = await f.handler.resume(batchId, 0);
    expect(resumed).toMatchObject({
      state: "waiting",
      items: [
        { state: "sent", priorReason: "target_changed" },
        { state: "pending" },
      ],
    });
    expect(resumed.pauseReason).toBeUndefined();
    expect(f.revalidate).toHaveBeenCalled();
    expect(f.attach).toHaveBeenCalledTimes(1);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("refuses target_changed recovery when attachment intent exists or target revalidation fails", async () => {
    const existing = await setup();
    await seedPausedTargetChangedQueue(existing);
    await existing.repositories.putFlowVideoAttachmentOperation({
      id: `${batchId}:item-1`,
      preparedBatchId: batchId,
      itemId: "item-1",
      referenceId: ref1,
      status: "blocked",
      reason: "target_changed_before_action",
      updatedAt: 1,
    });
    const blocked = await existing.handler.resume(batchId, 0);
    expect(blocked).toMatchObject({
      state: "blocked",
      pauseReason: "target_changed",
    });
    expect(existing.attach).not.toHaveBeenCalled();
    expect(existing.generate).not.toHaveBeenCalled();

    const targetChanged = await setup();
    await seedPausedTargetChangedQueue(targetChanged);
    targetChanged.revalidate.mockResolvedValueOnce(
      "selected_flow_target_changed",
    );
    const result = await targetChanged.handler.resume(batchId, 0);
    expect(result).toMatchObject({
      state: "blocked",
      pauseReason: "target_changed",
    });
    expect(targetChanged.attach).not.toHaveBeenCalled();
    expect(targetChanged.generate).not.toHaveBeenCalled();
  });

  it("recovers one pre-intent candidate_missing failure on explicit Resume after revalidating the target", async () => {
    const f = await setup();
    await seedPausedTargetChangedQueue(f, "candidate_missing");
    const resumed = await f.handler.resume(batchId, 0);
    expect(resumed).toMatchObject({
      state: "waiting",
      items: [
        { state: "sent", priorReason: "candidate_missing" },
        { state: "pending" },
      ],
    });
    expect(resumed.pauseReason).toBeUndefined();
    expect(f.revalidate).toHaveBeenCalled();
    expect(f.attach).toHaveBeenCalledTimes(1);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("refuses candidate_missing recovery when attachment intent exists or target revalidation fails", async () => {
    const existing = await setup();
    await seedPausedTargetChangedQueue(existing, "candidate_missing");
    await existing.repositories.putFlowVideoAttachmentOperation({
      id: `${batchId}:item-1`,
      preparedBatchId: batchId,
      itemId: "item-1",
      referenceId: ref1,
      status: "blocked",
      reason: "candidate_missing_before_action",
      updatedAt: 1,
    });
    const blocked = await existing.handler.resume(batchId, 0);
    expect(blocked).toMatchObject({
      state: "blocked",
      pauseReason: "candidate_missing",
    });
    expect(existing.attach).not.toHaveBeenCalled();
    expect(existing.generate).not.toHaveBeenCalled();

    const targetChanged = await setup();
    await seedPausedTargetChangedQueue(targetChanged, "candidate_missing");
    targetChanged.revalidate.mockResolvedValueOnce(
      "selected_flow_target_changed",
    );
    const result = await targetChanged.handler.resume(batchId, 0);
    expect(result).toMatchObject({
      state: "blocked",
      pauseReason: "candidate_missing",
    });
    expect(targetChanged.attach).not.toHaveBeenCalled();
    expect(targetChanged.generate).not.toHaveBeenCalled();
  });

  it("retries one proven pre-Add picker failure and dispatches only after the new attachment", async () => {
    const f = await setup();
    await seedPausedPickerQueue(f);
    const retried = await f.handler.retryPreAddPickerFailure(batchId, 0);
    expect(retried).toMatchObject({
      state: "waiting",
      items: [
        {
          state: "sent",
          priorReason: "picker_exact_row_missing",
          attemptId: "attempt-1",
        },
        { state: "pending" },
      ],
    });
    expect(retried.pauseReason).toBeUndefined();
    expect(f.revalidate).toHaveBeenCalled();
    expect(f.attach).toHaveBeenCalledTimes(1);
    expect(f.generate).toHaveBeenCalledTimes(1);
    const operation = await f.repositories.getFlowVideoAttachmentOperation(
      `${batchId}:item-1`,
    );
    expect(operation?.videoGeneration?.state).toBe("dispatched");
  });

  it("refuses picker retry for a verified/post-click operation or a changed target", async () => {
    const attached = await setup();
    await seedPausedPickerQueue(attached, { verifiedAttachment: true });
    await expect(
      attached.handler.retryPreAddPickerFailure(batchId, 0),
    ).rejects.toThrow("flow_video_queue_picker_not_recoverable");
    expect(attached.attach).not.toHaveBeenCalled();
    expect(attached.generate).not.toHaveBeenCalled();

    const postClick = await setup();
    await seedPausedPickerQueue(postClick, {
      reason: "attachment_uncertain",
    });
    await expect(
      postClick.handler.retryPreAddPickerFailure(batchId, 0),
    ).rejects.toThrow("flow_video_queue_picker_not_recoverable");
    expect(postClick.attach).not.toHaveBeenCalled();
    expect(postClick.generate).not.toHaveBeenCalled();

    const changedTarget = await setup();
    await seedPausedPickerQueue(changedTarget);
    changedTarget.revalidate.mockResolvedValueOnce(
      "selected_flow_target_changed",
    );
    await expect(
      changedTarget.handler.retryPreAddPickerFailure(batchId, 0),
    ).rejects.toThrow("flow_video_queue_picker_not_recoverable");
    expect(changedTarget.attach).not.toHaveBeenCalled();
    expect(changedTarget.generate).not.toHaveBeenCalled();
  });

  it("Pause, Stop, Resume, and restart preserve sent receipts and do not resend sent items", async () => {
    const f = await setup();
    let queue = await f.handler.start(batchId);
    queue = await f.handler.pause(batchId, queue.revision);
    expect(queue.state).toBe("paused");
    queue = await f.handler.resume(batchId, queue.revision);
    expect(queue.items[0]?.state).toBe("sent");
    expect(f.generate).toHaveBeenCalledTimes(1);
    queue = await f.handler.stop(batchId, queue.revision);
    expect(queue.state).toBe("stopped");
    expect(queue.items[0]?.state).toBe("sent");
    expect(queue.items[1]?.state).toBe("skipped");
    await f.handler.reconcileStartup();
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("reconciles valid Flow queues while skipping an unrelated invalid saved row", async () => {
    const f = await setup();
    const started = await f.handler.start(batchId);
    expect(started).toMatchObject({ state: "waiting", items: [{ state: "sent" }, { state: "pending" }] });
    const invalidRecord = {
      ...started,
      queueId: "flow-video:prepared:unknown-invalid-row",
      preparedBatchId: "prepared:unknown-invalid-row",
      unlistedField: true,
    };
    await f.db.flowVideoQueues.add(invalidRecord as unknown as FlowVideoQueueRecord);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(f.handler.reconcileStartup()).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(
      "[flow_video_queue_startup_invalid_rows_skipped]",
      expect.objectContaining({
        invalidCount: 1,
        invalid: [expect.objectContaining({ fieldPath: "unknown_fields", validationRule: "strict_record_fields_only" })],
      }),
    );
    expect(f.create).toHaveBeenCalledWith(
      `${FLOW_VIDEO_QUEUE_ALARM_PREFIX}flow-video:${batchId}`,
      expect.objectContaining({ when: expect.any(Number) }),
    );
    await expect(f.getQueue()).resolves.toMatchObject({ state: "waiting", items: [{ state: "sent" }, { state: "pending" }] });
    await expect(f.repositories.listFlowVideoQueues()).rejects.toThrow("flow_video_queue_invalid");
    warning.mockRestore();
  });

  it("classifies a Flow startup listing failure without dispatching or attaching", async () => {
    const f = await setup();
    vi.spyOn(f.repositories, "listFlowVideoQueuesForStartup").mockRejectedValueOnce(new Error("storage_read_failed"));
    await expect(f.handler.reconcileStartup()).rejects.toMatchObject({
      name: "FlowVideoStartupReconciliationError",
      step: "queue_list",
      errorCode: "storage_read_failed",
    });
    expect(f.attach).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("retires a blocked Flow queue while preserving uncertain evidence and clearing its alarm", async () => {
    const f = await setup({ generateStatus: "uncertain" });
    let queue = await f.handler.start(batchId);
    queue = await f.handler.resume(batchId, queue.revision);
    expect(queue.state).toBe("blocked");
    expect(queue.items[0]?.state).toBe("uncertain");

    queue = await f.handler.stop(batchId, queue.revision);
    expect(queue).toMatchObject({
      state: "stopped",
      items: [
        { state: "uncertain", reason: "synthetic_generation_failure" },
        { state: "skipped" },
      ],
    });
    expect(f.clear).toHaveBeenCalledWith(`${FLOW_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`);
    await expect(f.handler.start(batchId)).resolves.toEqual(queue);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("uses a 60-second readiness timeout and 30-second submission floor", () => {
    expect(VIDEO_QUEUE_DISPATCH_GAP_MS).toBe(30_000);
    expect(VIDEO_QUEUE_READINESS_TIMEOUT_MS).toBe(60_000);
  });

  it("reconciles only the exact historical pre-Add Shot 2 snapshot and leaves Resume separate", async () => {
    const historicBatchId = "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179";
    const shotOneId = "import:default:video:item:0";
    const shotTwoId = "import:default:video:item:1";
    const shotOneRef = "014ebcff-06e3-4ac2-b980-568f0755febf";
    const shotTwoRef = "e8c9315f-f79a-45c6-8184-4fddfce541ce";
    const shotTwoUpdatedAt = 1793616678655;
    const byteData = new Uint8Array([1, 2, 3, 4, 5]);
    const referenceSha = await sha256Bytes(byteData);
    const bodies = [JSON.stringify({ shot_id: "1" }), JSON.stringify({ shot_id: "2" })];
    const hashes = await Promise.all(bodies.map((body) => sha256Hex(body)));
    const reference = (referenceId: string) => ({ referenceId, assignmentVersion: 1, sha256: referenceSha, mimeType: "image/png", byteSize: byteData.length, width: 1, height: 1, capturedAt: 1 });
    const batch: PreparedVideoBatchRecord = {
      id: historicBatchId, requestId: "33333333-3333-4333-8333-333333333333", workspaceId: "default", preparedAt: 1, videoBatchId: "video-source", videoSourceHash: "a".repeat(64), videoSourceText: "[]",
      imageSourceBatchId: "image-source", imageSourceBatchHash: "b".repeat(64), destination: "Flow",
      target: { provider: "Flow", tabId: 7, canonicalTarget: "https://flow.google.com/project/p", projectId: "p", documentId: "doc", verification: "verified", verifiedAt: 1 },
      manualSettingsDeclaration: { confirmationId: "confirm", confirmedAt: 1, destination: "Flow", declaredDurationSeconds: 6, tabId: 7, canonicalTarget: "https://flow.google.com/project/p", projectId: "p", documentId: "doc" },
      status: "prepared", itemCount: 2, items: [
        { itemId: shotOneId, order: 0, shotId: "1", canonicalShotId: "1", rawJsonBody: bodies[0]!, contentHash: hashes[0]!, sourceSpan: { start: 0, end: bodies[0]!.length }, reference: reference(shotOneRef) },
        { itemId: shotTwoId, order: 1, shotId: "2", canonicalShotId: "2", rawJsonBody: bodies[1]!, contentHash: hashes[1]!, sourceSpan: { start: 0, end: bodies[1]!.length }, reference: reference(shotTwoRef) },
      ], createdAt: 1, updatedAt: 1,
    };
    const db = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(db);
    await db.preparedVideoBatches.put(batch);
    await db.referenceAssignments.put({
      assignmentId: "default:image-source:2", referenceId: shotTwoRef, captureOperationId: "33333333-3333-4333-8333-333333333333", workspaceId: "default", batchId: "image-source", batchSourceHash: "b".repeat(64), shotId: "2", promptHash: "c".repeat(64),
      selectionVersion: "44444444-4444-4444-8444-444444444444", assignmentVersion: 1, flowProjectId: "p", tabId: 7, canonicalTarget: batch.target.canonicalTarget, documentId: "doc", providerAssetId: "media-shot-2", observedSourceSha256: referenceSha,
      bytes: new Blob([byteData], { type: "image/png" }), mimeType: "image/png", byteSize: byteData.length, sha256: referenceSha, width: 1, height: 1, capturedAt: 1,
      acquisitionProvenance: "verified_flow_document_extension_fetch", qualityProvenance: "observed_resource_original_bytes_no_upscale",
    });
    const firstGeneration: NonNullable<FlowVideoAttachmentOperation["videoGeneration"]> = {
      attemptId: "shot-one-dispatch", preparedBatchId: historicBatchId, itemId: shotOneId, canonicalShotId: "1", promptHash: hashes[0]!, referenceId: shotOneRef,
      tabId: 7, projectId: "p", canonicalTarget: batch.target.canonicalTarget, documentId: "doc", state: "dispatched", createdAt: 1793616600000, updatedAt: 1793616600000,
    };
    const shotOneOperation: FlowVideoAttachmentOperation = { id: `${historicBatchId}:${shotOneId}`, preparedBatchId: historicBatchId, itemId: shotOneId, referenceId: shotOneRef, status: "attached", updatedAt: 1793616600000, videoGeneration: firstGeneration };
    const shotTwoOperation: FlowVideoAttachmentOperation = { id: `${historicBatchId}:${shotTwoId}`, preparedBatchId: historicBatchId, itemId: shotTwoId, referenceId: shotTwoRef, status: "uncertain", reason: "candidate_missing_or_virtualized", updatedAt: shotTwoUpdatedAt };
    await repositories.putFlowVideoAttachmentOperation(shotOneOperation);
    await repositories.putFlowVideoAttachmentOperation(shotTwoOperation);
    const queue: FlowVideoQueueRecord = {
      queueId: `flow-video:${historicBatchId}`, preparedBatchId: historicBatchId, state: "paused", pauseReason: "candidate_missing_or_virtualized",
      items: [
        { itemId: shotOneId, order: 0, shotId: "1", referenceId: shotOneRef, promptHash: hashes[0]!, state: "sent", attemptId: firstGeneration.attemptId, dispatchReceipt: { attemptId: firstGeneration.attemptId, storedAt: firstGeneration.updatedAt } },
        { itemId: shotTwoId, order: 1, shotId: "2", referenceId: shotTwoRef, promptHash: hashes[1]!, state: "uncertain", reason: "candidate_missing_or_virtualized" },
      ], lastDispatchAt: firstGeneration.updatedAt, nextActionAt: null, revision: 9, createdAt: 1, updatedAt: shotTwoUpdatedAt,
    };
    await repositories.createFlowVideoQueue(queue);
    const create = vi.fn(async () => undefined);
    const clear = vi.fn(async () => true);
    const revalidate = vi.fn(async () => undefined);
    const attach = vi.fn(async () => ({ status: "attached" }));
    const generate = vi.fn(async () => ({ status: "dispatched" }));
    const handler = createFlowVideoQueueHandler({ repositories, alarms: { create, clear } as never, attachReference: attach, generateOnce: generate, revalidate, now: () => 1793616700000 });

    const reconciled = await handler.reconcilePreAddFailure(historicBatchId, queue.revision);
    expect(reconciled).toMatchObject({ state: "paused", revision: 10, pauseReason: "pre_add_failure_reconciled", items: [{ state: "sent", attemptId: firstGeneration.attemptId }, { state: "pending", priorReason: "candidate_missing_or_virtualized" }] });
    expect(await repositories.getFlowVideoAttachmentOperation(shotTwoOperation.id)).toMatchObject({
      id: shotTwoOperation.id, status: "blocked", reason: "pre_add_failure_reconciled", updatedAt: 1793616700000,
      preAddReconciliationEvidence: { priorStatus: "uncertain", priorReason: "candidate_missing_or_virtualized", priorUpdatedAt: shotTwoUpdatedAt, producer: "historical_candidate_missing_before_add_activation", addClickAttempted: false, reconciledAt: 1793616700000 },
    });
    expect(await repositories.getFlowVideoAttachmentOperation(shotOneOperation.id)).toEqual(shotOneOperation);
    expect(attach).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();

    const changedCurrent = { ...shotTwoOperation, reason: "concurrent_change" };
    await repositories.putFlowVideoAttachmentOperation(changedCurrent);
    const expectedOperations = await Promise.all(reconciled.items.map(async (entry) => ({ id: `${historicBatchId}:${entry.itemId}`, operation: await repositories.getFlowVideoAttachmentOperation(`${historicBatchId}:${entry.itemId}`) })));
    expect(await repositories.reconcileFlowVideoPreAddFailure({
      expectedRevision: reconciled.revision, expectedOperations, expectedOperation: shotTwoOperation,
      nextOperation: { ...changedCurrent, status: "blocked", reason: "should_not_write" }, nextQueue: { ...reconciled, revision: reconciled.revision + 1 },
    })).toBeUndefined();
    expect(await repositories.getFlowVideoAttachmentOperation(shotTwoOperation.id)).toEqual(changedCurrent);

    const intent = { ...shotTwoOperation, videoGeneration: {
      attemptId: "unexpected-intent", preparedBatchId: historicBatchId, itemId: shotTwoId, canonicalShotId: "2", promptHash: hashes[1]!, referenceId: shotTwoRef,
      tabId: 7, projectId: "p", canonicalTarget: batch.target.canonicalTarget, documentId: "doc", state: "dispatch_intent" as const, createdAt: 1, updatedAt: 1,
    } };
    await repositories.putFlowVideoAttachmentOperation(intent);
    const uncertainQueue = await repositories.updateFlowVideoQueue({ expectedRevision: reconciled.revision, next: {
      ...reconciled, state: "paused", pauseReason: "candidate_missing_or_virtualized", revision: reconciled.revision + 1, updatedAt: 1793616700001,
      items: reconciled.items.map((entry) => entry.itemId === shotTwoId ? { ...entry, state: "uncertain", reason: "candidate_missing_or_virtualized" } : entry),
    } });
    await expect(handler.reconcilePreAddFailure(historicBatchId, uncertainQueue!.revision)).rejects.toThrow("flow_video_pre_add_operation_snapshot_mismatch");
    expect(attach).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();

    const unrelatedUncertain = await repositories.updateFlowVideoQueue({ expectedRevision: uncertainQueue!.revision, next: {
      ...uncertainQueue!, revision: uncertainQueue!.revision + 1, updatedAt: 1793616700002,
      items: [...uncertainQueue!.items, { itemId: "unrelated", order: 2, shotId: "3", referenceId: shotOneRef, promptHash: hashes[0]!, state: "uncertain", reason: "unrelated_uncertainty" }],
    } });
    await expect(handler.reconcilePreAddFailure(historicBatchId, unrelatedUncertain!.revision)).rejects.toThrow("flow_video_queue_has_unrelated_uncertainty");
    expect(attach).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
