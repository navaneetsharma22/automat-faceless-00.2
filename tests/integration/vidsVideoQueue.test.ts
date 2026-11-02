import { describe, expect, it, vi } from "vitest";
import { createVidsVideoQueueHandler, VIDS_VIDEO_QUEUE_ALARM_PREFIX } from "../../src/background/handlers/vidsVideoQueue";
import { VIDS_VIDEO_DISPATCH_GAP_MS, VIDS_VIDEO_READINESS_TIMEOUT_MS } from "../../src/domain/jobs/vidsVideoQueue";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import { ExtensionRepositories } from "../../src/storage/repositories";
import type { PreparedVideoBatchRecord } from "../../src/domain/batches/types";
import type { VidsVideoGenerationOperation } from "../../src/domain/jobs/vidsVideoGeneration";
import type { VidsVideoAttachmentOperation } from "../../src/domain/jobs/vidsVideoAttachment";
import type { VidsVideoQueueRecord } from "../../src/domain/jobs/vidsVideoQueue";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import { makeRequest } from "../../src/shared/messages";
import { ChromePreferenceRepository } from "../../src/storage/repositories";

const batchId = "prepared:vids:two-shots";
const refs = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const prompts = ["{\n  \"shot_id\": \"1\",\n  \"prompt_type\": \"video\",\n  \"description\": \"first\"\n}", "{\n  \"shot_id\": \"2\",\n  \"prompt_type\": \"video\",\n  \"description\": \"second\",\n  \"long\": \"" + "x".repeat(3000) + "\"\n}"];

async function setup(options: { disabledAttempts?: number; uncertain?: boolean; blocked?: boolean } = {}) {
  const db = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(db);
  const hashes = await Promise.all(prompts.map(sha256Hex));
  const videoSourceText = prompts.map((body, index) => `${index + 1}: ${body}`).join("\n\n");
  const videoSourceHash = await sha256Hex(videoSourceText);
  const batch: PreparedVideoBatchRecord = {
    id: batchId, requestId: "33333333-3333-4333-8333-333333333333", workspaceId: "workspace", preparedAt: 1,
    videoBatchId: "video", videoSourceHash, videoSourceText, imageSourceBatchId: "images", imageSourceBatchHash: "b".repeat(64), destination: "Vids",
    target: { provider: "Vids", tabId: 9, canonicalTarget: "https://docs.google.com/videos/d/project/edit", projectId: "project", documentId: "doc", verification: "verified", verifiedAt: 1 },
    manualSettingsDeclaration: { confirmationId: "confirmation", confirmedAt: 1, destination: "Vids", declaredDurationSeconds: 8, tabId: 9, canonicalTarget: "https://docs.google.com/videos/d/project/edit", projectId: "project", documentId: "doc" },
    status: "prepared", itemCount: 2,
    items: prompts.map((rawJsonBody, order) => ({ itemId: `item-${order + 1}`, order, shotId: String(order + 1), canonicalShotId: String(order + 1), rawJsonBody, contentHash: hashes[order]!, sourceSpan: { start: 0, end: rawJsonBody.length }, reference: { referenceId: refs[order]!, assignmentVersion: 1, sha256: String(order + 1).repeat(64), mimeType: "image/png", byteSize: 4, width: 1, height: 1, capturedAt: 1 } })), createdAt: 1, updatedAt: 1,
  };
  await db.preparedVideoBatches.put(batch);
  let at = 1_000;
  const attach = vi.fn(async () => ({ status: "attached" }));
  const getAttachment = vi.fn(async () => ({ status: "not_started" }));
  let generationCalls = 0;
  const operations = new Map<string, VidsVideoGenerationOperation>();
  const getGeneration = vi.fn(async (_batch: string, itemId: string) => { const op = operations.get(itemId); return op ? { status: op.status, operation: op } : { status: "not_started" }; });
  const generate = vi.fn(async (_batch: string, itemId: string) => {
    generationCalls += 1;
    if (generationCalls <= (options.disabledAttempts ?? 0)) return { status: "blocked", reason: "generate_disabled" };
    if (options.blocked) return { status: "blocked", reason: "exact_prompt_readback_failed" };
    const item = batch.items.find((candidate) => candidate.itemId === itemId)!;
    const op: VidsVideoGenerationOperation = { id: `gen:${itemId}`, preparedBatchId: batch.id, workspaceId: batch.workspaceId, itemId, canonicalShotId: item.canonicalShotId, promptHash: item.contentHash, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, preIntentReferenceProofSource: "preview_blob_sha256", activationReferenceProofSource: "preview_blob_sha256", tabId: 9, canonicalTarget: batch.target.canonicalTarget, documentId: "doc", attemptId: crypto.randomUUID(), status: options.uncertain ? "uncertain" : "dispatched", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: item.contentHash, actualSha256: item.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: at }, activationAttempted: true, activationCount: 1, ...(!options.uncertain ? { dispatchedAt: at } : {}), createdAt: at, updatedAt: at };
    operations.set(itemId, op);
    return { status: options.uncertain ? "uncertain" : "dispatched", operation: op };
  });
  const alarms = { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) };
  const transitionFromPrevious = vi.fn(async () => ({ status: "ready" as const }));
  const handler = createVidsVideoQueueHandler({ repositories, alarms, attach, getAttachment, generate, getGeneration, transitionFromPrevious, now: () => at, makeRunId: () => "run-1" });
  const flush = async () => new Promise((resolve) => setTimeout(resolve, 0));
  const waitForQueue = async (queueId: string, predicate: (queue: VidsVideoQueueRecord | undefined) => boolean) => {
    let queue = await repositories.getVidsVideoQueue(queueId);
    for (let attempt = 0; attempt < 30 && !predicate(queue); attempt += 1) {
      await flush();
      queue = await repositories.getVidsVideoQueue(queueId);
    }
    return queue;
  };
  return { db, batch, repositories, handler, attach, generate, getGeneration, alarms, transitionFromPrevious, now: () => at, advance: (ms: number) => { at += ms; }, flush, waitForQueue, operations };
}

describe("P10.3 isolated Vids timed queue", () => {
  it("adopts only the exact durable Shot 1 receipt, observes the 50-second gap, then dispatches Shot 2 once", async () => {
    const f = await setup();
    const first = f.batch.items[0]!;
    const op: VidsVideoGenerationOperation = { id: "existing-shot-1", preparedBatchId: batchId, workspaceId: "workspace", itemId: first.itemId, canonicalShotId: first.canonicalShotId, promptHash: first.contentHash, referenceId: first.reference.referenceId, referenceSha256: first.reference.sha256, preIntentReferenceProofSource: "preview_blob_sha256", activationReferenceProofSource: "preview_blob_sha256", tabId: 9, canonicalTarget: f.batch.target.canonicalTarget, documentId: "doc", attemptId: "66666666-6666-4666-8666-666666666666", status: "dispatched", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: first.contentHash, actualSha256: first.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: 500 }, activationAttempted: true, activationCount: 1, dispatchedAt: 500, createdAt: 400, updatedAt: 500 };
    f.operations.set(first.itemId, op);
    const queue = await f.handler.start(batchId);
    expect(queue.items[0]).toMatchObject({ state: "sent", dispatchReceipt: { attemptId: op.attemptId, storedAt: 500 } });
    await f.waitForQueue(queue.queueId, (value) => value?.state === "cooldown");
    expect(f.generate).not.toHaveBeenCalled();
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS - (f.now() - 500));
    const after = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`);
    expect(after?.items.map((item) => item.state)).toEqual(["sent", "sent"]);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.generate.mock.calls[0]?.[1]).toBe("item-2");
    expect(f.transitionFromPrevious).toHaveBeenCalledWith(batchId, "item-1");
    expect(after?.state).toBe("all_sent");
  });

  it("keeps a separate bounded Generate readiness deadline and pauses at 60 seconds", async () => {
    const f = await setup({ disabledAttempts: 5 });
    const queue = await f.handler.start(batchId);
    const waiting = await f.waitForQueue(queue.queueId, (value) => value?.state === "checking_generate");
    expect(waiting).toMatchObject({ state: "checking_generate", readinessStartedAt: f.now(), readinessDeadlineAt: f.now() + VIDS_VIDEO_READINESS_TIMEOUT_MS });
    f.advance(30_000); await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`);
    f.advance(30_000); const timedOut = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`);
    expect(timedOut).toMatchObject({ state: "paused", pauseReason: "generate_readiness_timeout" });
    expect(timedOut?.items[0]).toMatchObject({ state: "blocked", reason: "generate_readiness_timeout" });
    expect(f.generate).toHaveBeenCalledTimes(2);
  });

  it("keeps uncertain activation blocked and does not replay on Resume or worker startup", async () => {
    const f = await setup({ uncertain: true });
    const queue = await f.handler.start(batchId);
    const blocked = await f.waitForQueue(queue.queueId, (value) => value?.state === "blocked");
    expect(blocked?.state).toBe("blocked");
    expect(f.generate).toHaveBeenCalledTimes(1);
    await f.handler.reconcileStartup();
    expect(f.generate).toHaveBeenCalledTimes(1);
    await expect(f.handler.resume(batchId, blocked!.revision)).rejects.toThrow("vids_video_queue_revision_changed");
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("preserves the 50-second dispatch floor across Pause, Resume, duplicate Start and worker restart", async () => {
    const f = await setup();
    const queue = await f.handler.start(batchId);
    const current = await f.waitForQueue(queue.queueId, (value) => value?.state === "cooldown");
    const paused = await f.handler.pause(batchId, current!.revision);
    expect(paused.state).toBe("paused");
    const resumed = await f.handler.resume(batchId, paused.revision);
    expect(resumed.state).toBe("cooldown");
    expect(resumed.cooldownDeadlineAt).toBe(paused.lastDispatchAt! + VIDS_VIDEO_DISPATCH_GAP_MS);
    await f.handler.start(batchId);
    await f.handler.reconcileStartup();
    expect(f.generate).toHaveBeenCalledTimes(1);
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const sent = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`);
    expect(sent?.items.filter((item) => item.state === "sent")).toHaveLength(2);
    expect(f.generate).toHaveBeenCalledTimes(2);
  });

  it("preserves the existing readiness deadline across Pause and Resume", async () => {
    const f = await setup({ disabledAttempts: 1 });
    const queue = await f.handler.start(batchId);
    const checking = await f.waitForQueue(queue.queueId, (value) => value?.state === "checking_generate");
    const paused = await f.handler.pause(batchId, checking!.revision);
    const resumed = await f.handler.resume(batchId, paused.revision);
    expect(resumed.state).toBe("checking_generate");
    expect(resumed.readinessDeadlineAt).toBe(checking!.readinessDeadlineAt);
    f.advance(30_000);
    const sent = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`);
    expect(sent?.items[0]?.state).toBe("sent");
    expect(sent?.items[0]?.dispatchReceipt?.attemptId).toBeTruthy();
    expect(f.generate).toHaveBeenCalledTimes(2);
  });

  it("pauses on an exact prompt preflight failure and does not auto-retry or advance", async () => {
    const f = await setup({ blocked: true });
    const queue = await f.handler.start(batchId);
    const blocked = await f.waitForQueue(queue.queueId, (value) => value?.state === "paused");
    expect(blocked).toMatchObject({ state: "paused", pauseReason: "exact_prompt_readback_failed" });
    expect(blocked?.items[0]).toMatchObject({ state: "blocked", reason: "exact_prompt_readback_failed" });
    expect(blocked?.items[1]?.state).toBe("pending");
    await f.handler.reconcileStartup();
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("routes Vids queue requests only to Vids queue handlers", async () => {
    const db = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(db);
    const vidsGet = vi.fn(async () => ({ state: "ready" }));
    const flowGet = vi.fn(async () => ({ state: "sent" }));
    const preferences = new ChromePreferenceRepository({ get: async () => ({}), set: async () => undefined });
    const listener = createConnectionMessageListener("vids-queue-isolation", { repositories, preferences,
      vidsVideoQueue: { get: vidsGet, start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), inspectTransition: vi.fn() },
      flowVideoQueue: { get: flowGet, start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), recheckAndResume: vi.fn(), reconcilePreAddFailure: vi.fn() },
    });
    const request = makeRequest("vids.videoQueue.get", { preparedBatchId: batchId }, "vids-queue-get");
    const response = await new Promise<unknown>((resolve) => listener(JSON.parse(JSON.stringify(request)), { id: "vids-queue-isolation", url: "chrome-extension://vids-queue-isolation/index.html" }, resolve));
    expect(response).toMatchObject({ ok: true });
    expect(vidsGet).toHaveBeenCalledWith(batchId);
    expect(flowGet).not.toHaveBeenCalled();
    expect(await db.flowVideoQueues.toArray()).toEqual([]);
    expect(await db.flowVideoAttachmentOperations.toArray()).toEqual([]);
  });

  it("inspects a previous-item transition read-only and rejects attempted current items", async () => {
    const f = await setup();
    const previous = f.batch.items[0]!;
    const operation: VidsVideoGenerationOperation = { id: "previous-sent", preparedBatchId: batchId, workspaceId: "workspace", itemId: previous.itemId, canonicalShotId: previous.canonicalShotId, promptHash: previous.contentHash, referenceId: previous.reference.referenceId, referenceSha256: previous.reference.sha256, preIntentReferenceProofSource: "preview_blob_sha256", activationReferenceProofSource: "preview_blob_sha256", tabId: 9, canonicalTarget: f.batch.target.canonicalTarget, documentId: "doc", attemptId: "66666666-6666-4666-8666-666666666666", status: "dispatched", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: previous.contentHash, actualSha256: previous.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: 500 }, activationAttempted: true, activationCount: 1, dispatchedAt: 500, createdAt: 400, updatedAt: 500 };
    f.operations.set(previous.itemId, operation);
    const queue: VidsVideoQueueRecord = { queueId: `vids-video:${batchId}`, preparedBatchId: batchId, state: "paused", items: f.batch.items.map((item, order) => ({ itemId: item.itemId, order, shotId: item.canonicalShotId, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, promptHash: item.contentHash, state: order === 0 ? "sent" : "blocked", ...(order === 0 ? { attemptId: operation.attemptId, dispatchReceipt: { attemptId: operation.attemptId, storedAt: operation.dispatchedAt! } } : { reason: "vids_previous_composer_content_conflict" }) })), revision: 7, createdAt: 1, updatedAt: 500, lastDispatchAt: 500, cooldownDeadlineAt: 50_500, readinessDeadlineAt: null, readinessStartedAt: null, nextActionAt: null, pauseReason: "vids_previous_composer_content_conflict", runId: "run" };
    await f.repositories.createVidsVideoQueue(queue);
    const result = await f.handler.inspectTransition(batchId, "item-2");
    expect(result.status).toBe("ready");
    expect(f.transitionFromPrevious).toHaveBeenCalledWith(batchId, "item-1", true);
    expect(await f.repositories.getVidsVideoQueue(queue.queueId)).toEqual(queue);
    expect(f.attach).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect(await f.handler.inspectTransition(batchId, "item-1")).toMatchObject({ status: "blocked" });
    const attempted: VidsVideoGenerationOperation = { ...operation, id: "shot-2-uncertain", itemId: "item-2", canonicalShotId: "2", referenceId: f.batch.items[1]!.reference.referenceId, referenceSha256: f.batch.items[1]!.reference.sha256, promptHash: f.batch.items[1]!.contentHash, status: "uncertain", activationAttempted: true, activationCount: 1, dispatchedAt: undefined };
    f.operations.set("item-2", attempted);
    expect(await f.handler.inspectTransition(batchId, "item-2")).toMatchObject({ status: "blocked", reason: "vids_generation_attempt_requires_review" });
    await expect(f.handler.resume(batchId, queue.revision)).rejects.toThrow("vids_generation_attempt_requires_review");
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("atomically rejects per-shot intent claims while the Vids queue owns the item", async () => {
    const f = await setup(); const repositories = f.repositories;
    const item = f.batch.items[0]!;
    const queue: VidsVideoQueueRecord = { queueId: `vids-video:${batchId}`, preparedBatchId: batchId, state: "preparing", items: f.batch.items.map((value, order) => ({ itemId: value.itemId, order, shotId: value.canonicalShotId, referenceId: value.reference.referenceId, referenceSha256: value.reference.sha256, promptHash: value.contentHash, state: "pending" })), revision: 0, createdAt: 1, updatedAt: 1, lastDispatchAt: null, cooldownDeadlineAt: null, readinessDeadlineAt: null, readinessStartedAt: null, nextActionAt: null, runId: "run" };
    await repositories.createVidsVideoQueue(queue);
    const attachment: VidsVideoAttachmentOperation = { id: "attachment-claim", preparedBatchId: batchId, workspaceId: "workspace", itemId: item.itemId, shotId: item.canonicalShotId, referenceId: item.reference.referenceId, assignmentVersion: 1, referenceSha256: item.reference.sha256, mimeType: "image/png", byteSize: 4, width: 1, height: 1, tabId: 9, canonicalTarget: f.batch.target.canonicalTarget, documentId: "doc", status: "action_intent", createdAt: 2, updatedAt: 2 };
    expect(await repositories.claimVidsVideoAttachmentOperation(attachment)).toBe(false);
    expect(await repositories.claimVidsVideoAttachmentOperation(attachment, true)).toBe(true);
    const checkingQueue = { ...queue, state: "checking_generate" as const, revision: 1, items: queue.items.map((value) => value.itemId === item.itemId ? { ...value, state: "checking_generate" as const } : value) };
    await repositories.updateVidsVideoQueue({ expectedRevision: 0, next: checkingQueue });
    const attached = { ...attachment, status: "attached" as const, uploadEvidence: { mechanism: "verified_document_file_input" as const, exactBytesSha256: item.reference.sha256, byteSize: 4, mimeType: "image/png" as const, fileInputCount: 1 as const, inputChangeDispatched: true as const, previewLoaded: true as const, previewWidth: 1, previewHeight: 1, removalControlPresent: true as const, uploadOperationId: "44444444-4444-4444-8444-444444444444", uploadedAt: 3 } };
    await f.db.vidsVideoAttachmentOperations.put(attached);
    const intent: VidsVideoGenerationOperation = { id: "generation-claim", preparedBatchId: batchId, workspaceId: "workspace", itemId: item.itemId, canonicalShotId: item.canonicalShotId, promptHash: item.contentHash, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, tabId: 9, canonicalTarget: f.batch.target.canonicalTarget, documentId: "doc", attemptId: "55555555-5555-4555-8555-555555555555", status: "dispatch_intent", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: item.contentHash, actualSha256: item.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: 4 }, activationAttempted: false, activationCount: 0, createdAt: 4, updatedAt: 4 };
    expect(await repositories.claimVidsVideoGenerationOperation(intent, attached)).toBe(false);
    expect(await repositories.claimVidsVideoGenerationOperation(intent, attached, true)).toBe(true);
  });
});
