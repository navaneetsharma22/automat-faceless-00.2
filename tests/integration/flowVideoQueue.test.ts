import { describe, expect, it, vi } from "vitest";
import { createFlowVideoQueueHandler, FLOW_VIDEO_QUEUE_ALARM_PREFIX } from "../../src/background/handlers/flowVideoQueue";
import { VIDEO_QUEUE_COMPLETION_CHECK_MS, VIDEO_QUEUE_DISPATCH_GAP_MS, nextVideoDispatchAt } from "../../src/domain/jobs/videoQueue";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { ExtensionRepositories } from "../../src/storage/repositories";
import type { FlowVideoQueueRecord } from "../../src/domain/jobs/videoQueue";
import type { PreparedVideoBatchRecord } from "../../src/domain/batches/types";
import type { FlowVideoAttachmentOperation } from "../../src/storage/db";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";

const batchId = "prepared-video-two-shots";
const ref1 = "11111111-1111-4111-8111-111111111111";
const ref2 = "22222222-2222-4222-8222-222222222222";
const prompts = [
  JSON.stringify({ shot_id: "1", prompt_type: "video", scene_title: "One" }),
  JSON.stringify({ shot_id: "2", prompt_type: "video", scene_title: "Two" }),
];

async function setup(options: {
  completion?: (attemptId: string) => Promise<{ status: "processing" | "completed" | "failed" | "unknown"; attemptId: string; resultIdentity?: string; reason?: string; attributable?: true }>;
  attachStatus?: string;
  generateStatus?: string;
    generateResponseLost?: boolean;
  existingFirstGeneration?: FlowVideoAttachmentOperation["videoGeneration"];
} = {}) {
  const db = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(db);
  const hashes = await Promise.all(prompts.map((prompt) => sha256Hex(prompt)));
  const batch: PreparedVideoBatchRecord = {
    id: batchId,
    requestId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "default",
    preparedAt: 10,
    videoBatchId: "video-source",
    videoSourceHash: "a".repeat(64),
    videoSourceText: JSON.stringify(prompts.map((body) => JSON.parse(body))),
    imageSourceBatchId: "image-source",
    imageSourceBatchHash: "b".repeat(64),
    destination: "Flow",
    target: { provider: "Flow", tabId: 7, canonicalTarget: "https://flow.google.com/project/p", projectId: "p", documentId: "doc", verification: "verified", verifiedAt: 1 },
    manualSettingsDeclaration: { confirmationId: "confirm", confirmedAt: 1, destination: "Flow", declaredDurationSeconds: 6, tabId: 7, canonicalTarget: "https://flow.google.com/project/p", projectId: "p", documentId: "doc" },
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
      reference: { referenceId: order === 0 ? ref1 : ref2, assignmentVersion: 1, sha256: "c".repeat(64), mimeType: "image/png", byteSize: 4, width: 1, height: 1, capturedAt: 1 },
    })),
    createdAt: 1,
    updatedAt: 1,
  };
  await db.preparedVideoBatches.put(batch);
  let at = 100_000;
  const create = vi.fn(async () => undefined);
  const clear = vi.fn(async () => true);
  const attach = vi.fn(async (id: string, itemId: string) => {
    if (options.attachStatus && options.attachStatus !== "attached") return { status: options.attachStatus, reason: "synthetic_attach_failure" };
    const item = batch.items.find((candidate) => candidate.itemId === itemId)!;
    const operation: FlowVideoAttachmentOperation = {
      id: `${id}:${itemId}`, preparedBatchId: id, itemId,
      referenceId: item.reference.referenceId, status: "attached", updatedAt: at,
      verifiedAttachment: { documentId: "doc", mediaId: `media-${itemId}`, verifiedAt: at },
      ...(itemId === "item-1" && options.existingFirstGeneration
        ? { videoGeneration: options.existingFirstGeneration }
        : {}),
    };
    await repositories.putFlowVideoAttachmentOperation(operation);
    return { status: "attached" };
  });
  if (options.existingFirstGeneration) {
    const item = batch.items[0]!;
    await repositories.putFlowVideoAttachmentOperation({
      id: `${batchId}:${item.itemId}`, preparedBatchId: batchId, itemId: item.itemId,
      referenceId: item.reference.referenceId, status: "attached", updatedAt: at,
      videoGeneration: options.existingFirstGeneration,
    });
  }
  let attempt = 0;
  const generate = vi.fn(async (id: string, itemId: string) => {
    const item = batch.items.find((candidate) => candidate.itemId === itemId)!;
    const attemptId = `attempt-${++attempt}`;
    if (options.generateStatus && options.generateStatus !== "dispatched") return { status: options.generateStatus, reason: "synthetic_generation_failure", attemptId };
    await repositories.putFlowVideoAttachmentOperation({
      id: `${id}:${itemId}`, preparedBatchId: id, itemId, referenceId: item.reference.referenceId,
      status: "attached", updatedAt: at,
      videoGeneration: { attemptId, preparedBatchId: id, itemId, canonicalShotId: item.canonicalShotId, promptHash: item.contentHash, referenceId: item.reference.referenceId, tabId: 7, projectId: "p", canonicalTarget: "https://flow.google.com/project/p", documentId: "doc", state: "dispatched", createdAt: at, updatedAt: at },
    });
    return options.generateResponseLost
      ? { status: "uncertain", reason: "generation_response_lost", attemptId }
      : { status: "dispatched", attemptId };
  });
  const handler = createFlowVideoQueueHandler({
    repositories,
    alarms: { create, clear } as never,
    attachReference: attach,
    generateOnce: generate,
    ...(options.completion ? { inspectCompletion: ({ attemptId }) => options.completion!(attemptId) } : {}),
    now: () => at,
  });
  return {
    batch,
    db,
    repositories,
    handler,
    attach,
    generate,
    create,
    clear,
    now: () => at,
    advance: (ms: number) => { at += ms; },
    getQueue: () => repositories.getFlowVideoQueue(`flow-video:${batchId}`),
  };
}

describe("P09.3 Flow video queue", () => {
  it("starts once, checks at 60 seconds, and dispatches the next Shot only after attributable completion", async () => {
    let complete = false;
    const f = await setup({ completion: async (attemptId) => complete
      ? { status: "completed", attemptId, attributable: true, resultIdentity: "flow-result-1" }
      : { status: "processing", attemptId } });
    let queue = await f.handler.start(batchId);
    expect(queue.items[0]).toMatchObject({ state: "awaiting_completion", attemptId: "attempt-1" });
    expect(queue.items[1]?.state).toBe("pending");
    expect(queue.nextActionAt).toBe(f.now() + VIDEO_QUEUE_COMPLETION_CHECK_MS);
    await f.handler.start(batchId);
    expect(f.generate).toHaveBeenCalledTimes(1);
    f.advance(VIDEO_QUEUE_COMPLETION_CHECK_MS);
    complete = true;
    queue = await f.handler.onAlarm(`${FLOW_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`) as FlowVideoQueueRecord;
    expect(queue.items[0]).toMatchObject({ state: "completed", resultIdentity: "flow-result-1" });
    expect(queue.items[1]).toMatchObject({ state: "awaiting_completion", attemptId: "attempt-2" });
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.attach).toHaveBeenCalledTimes(2);
  });

  it("serializes duplicate Start requests so a prepared item is attached and dispatched once", async () => {
    const f = await setup();
    const [left, right] = await Promise.all([
      f.handler.start(batchId),
      f.handler.start(batchId),
    ]);
    expect(left.queueId).toBe(right.queueId);
    expect(f.attach).toHaveBeenCalledTimes(1);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("preserves an existing Shot 1 generation intent and leaves it awaiting attribution", async () => {
    const f = await setup({ existingFirstGeneration: {
      attemptId: "existing-shot-one-attempt", preparedBatchId: batchId, itemId: "item-1", canonicalShotId: "1", promptHash: "d".repeat(64), referenceId: ref1, tabId: 7, projectId: "p", canonicalTarget: "https://flow.google.com/project/p", documentId: "doc", state: "dispatched", createdAt: 10, updatedAt: 20,
    } });
    const queue = await f.handler.start(batchId);
    expect(queue.items[0]).toMatchObject({ state: "awaiting_verification", attemptId: "existing-shot-one-attempt" });
    expect(queue.items[1]?.state).toBe("pending");
    expect(queue).toMatchObject({ state: "paused", pauseReason: "video_result_attribution_unavailable" });
    expect(f.generate).not.toHaveBeenCalled();
    expect((await f.repositories.getFlowVideoAttachmentOperation(`${batchId}:item-1`))?.videoGeneration?.attemptId).toBe("existing-shot-one-attempt");
  });

  it("does not submit the known historical Shot 1 if its durable intent cannot be read back", async () => {
    const f = await setup();
    const historicalBatch = { ...f.batch, id: "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179", items: f.batch.items.map((item, index) => ({ ...item, itemId: index === 0 ? "import:default:video:item:0" : item.itemId })) };
    await f.db.preparedVideoBatches.put(historicalBatch);
    const queue = await f.handler.start(historicalBatch.id);
    expect(queue).toMatchObject({ state: "paused", pauseReason: "historical_shot_one_requires_operation_verification" });
    expect(queue.items[0]).toMatchObject({ state: "uncertain", shotId: "1" });
    expect(f.attach).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("does not infer completion from elapsed time or an unattributed finished result", async () => {
    const f = await setup({ completion: async (attemptId) => ({ status: "completed", attemptId, resultIdentity: "tile-finished" }) });
    let queue = await f.handler.start(batchId);
    f.advance(VIDEO_QUEUE_COMPLETION_CHECK_MS);
    queue = await f.handler.onAlarm(`${FLOW_VIDEO_QUEUE_ALARM_PREFIX}${queue.queueId}`) as FlowVideoQueueRecord;
    expect(queue.items[0]).toMatchObject({ state: "awaiting_verification", reason: "completion_unverified" });
    expect(queue.items[1]?.state).toBe("pending");
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("leaves dispatched items awaiting verification when no production video attribution reader exists", async () => {
    const f = await setup();
    const queue = await f.handler.start(batchId);
    expect(queue).toMatchObject({ state: "paused", pauseReason: "video_result_attribution_unavailable", nextActionAt: null });
    expect(queue.items[0]).toMatchObject({ state: "awaiting_verification", reason: "video_result_attribution_unavailable" });
    expect(queue.items[1]?.state).toBe("pending");
    expect(f.create).not.toHaveBeenCalled();
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("pauses on a lost/uncertain dispatch and Resume never replays it", async () => {
    const f = await setup({ generateStatus: "uncertain" });
    let queue = await f.handler.start(batchId);
    expect(queue).toMatchObject({ state: "paused", pauseReason: "synthetic_generation_failure" });
    queue = await f.handler.resume(batchId, queue.revision);
    expect(queue.state).toBe("paused");
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("retains a durable dispatched attempt when the queue reply is lost", async () => {
    const f = await setup({ generateResponseLost: true });
    const queue = await f.handler.start(batchId);
    expect(queue).toMatchObject({ state: "paused", pauseReason: "video_result_attribution_unavailable" });
    expect(queue.items[0]).toMatchObject({ state: "awaiting_verification", attemptId: "attempt-1" });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect((await f.repositories.getFlowVideoAttachmentOperation(`${batchId}:item-1`))?.videoGeneration?.state).toBe("dispatched");
  });

  it("Pause and Stop persist control state without erasing dispatched attempts", async () => {
    const f = await setup();
    let queue = await f.handler.start(batchId);
    queue = await f.handler.pause(batchId, queue.revision);
    expect(queue.state).toBe("paused");
    const generation = (await f.repositories.getFlowVideoAttachmentOperation(`${batchId}:item-1`))?.videoGeneration;
    expect(generation?.state).toBe("dispatched");
    queue = await f.handler.stop(batchId, queue.revision);
    expect(queue.state).toBe("stopped");
    expect(queue.items[1]?.state).toBe("skipped");
    expect((await f.repositories.getFlowVideoAttachmentOperation(`${batchId}:item-1`))?.videoGeneration?.attemptId).toBe(generation?.attemptId);
  });

  it("restores a persisted check after worker restart without Generate replay", async () => {
    const f = await setup({ completion: async (attemptId) => ({ status: "processing", attemptId }) });
    const queue = await f.handler.start(batchId);
    await f.handler.reconcileStartup();
    expect(f.create).toHaveBeenCalled();
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(await f.getQueue()).toMatchObject({ state: "waiting", nextActionAt: queue.nextActionAt });
  });

  it("enforces the 30-second dispatch floor independently of provider duration", () => {
    expect(VIDEO_QUEUE_DISPATCH_GAP_MS).toBe(30_000);
    expect(VIDEO_QUEUE_COMPLETION_CHECK_MS).toBe(60_000);
    expect(nextVideoDispatchAt(100_000, 120_000)).toBe(130_000);
    expect(nextVideoDispatchAt(100_000, 140_000)).toBe(140_000);
  });
});
