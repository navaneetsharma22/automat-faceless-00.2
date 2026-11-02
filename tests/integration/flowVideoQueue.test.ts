import { describe, expect, it, vi } from "vitest";
import { createFlowVideoQueueHandler, FLOW_VIDEO_QUEUE_ALARM_PREFIX } from "../../src/background/handlers/flowVideoQueue";
import { VIDEO_QUEUE_DISPATCH_GAP_MS, VIDEO_QUEUE_READINESS_TIMEOUT_MS } from "../../src/domain/jobs/videoQueue";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { ExtensionRepositories } from "../../src/storage/repositories";
import type { FlowVideoQueueRecord } from "../../src/domain/jobs/videoQueue";
import type { PreparedVideoBatchRecord } from "../../src/domain/batches/types";
import type { FlowVideoAttachmentOperation } from "../../src/storage/db";
import type { ReferenceByteComparisonDiagnostic } from "../../src/domain/media/references";
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

  it("uses a 60-second readiness timeout and 30-second submission floor", () => {
    expect(VIDEO_QUEUE_DISPATCH_GAP_MS).toBe(30_000);
    expect(VIDEO_QUEUE_READINESS_TIMEOUT_MS).toBe(60_000);
  });
});
