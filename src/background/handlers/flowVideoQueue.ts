import type { FlowVideoQueueItem, FlowVideoQueueRecord } from "../../domain/jobs/videoQueue";
import type { ReferenceByteComparisonDiagnostic } from "../../domain/media/references";
import {
  nextVideoDispatchAt,
  nextVideoReadinessDeadline,
  VIDEO_QUEUE_DISPATCH_GAP_MS,
} from "../../domain/jobs/videoQueue";
import type { ExtensionRepositories } from "../../storage/repositories";
import { PreparedVideoBatchRecordSchema } from "../../shared/schemas";
import type { PreparedVideoBatchRecord } from "../../domain/batches/types";
import type { FlowVideoAttachmentOperation } from "../../storage/db";
import { ReferenceAssignmentRecordSchema, sha256Bytes } from "../../domain/media/references";
import { createQueueAlarmRuntime } from "../scheduler";
import { FlowVideoStartupReconciliationError } from "../flowVideoAlarmLifecycle";

export const FLOW_VIDEO_QUEUE_ALARM_PREFIX = "automat-flow-video-queue:";
const HISTORIC_SHOT_ONE_BATCH = "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179";
const HISTORIC_SHOT_ONE_ITEM = "import:default:video:item:0";
const HISTORIC_SHOT_TWO_BATCH = "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179";
const HISTORIC_SHOT_TWO_ITEM = "import:default:video:item:1";
const HISTORIC_SHOT_TWO_REFERENCE = "e8c9315f-f79a-45c6-8184-4fddfce541ce";
const HISTORIC_SHOT_TWO_UPDATED_AT = 1793616678655;

export type FlowVideoQueueView = FlowVideoQueueRecord;

export function createFlowVideoQueueHandler(input: {
  repositories: ExtensionRepositories;
  alarms: Pick<typeof chrome.alarms, "create" | "clear">;
  attachReference: (preparedBatchId: string, itemId: string) => Promise<{ status: string; reason?: string; diagnostic?: ReferenceByteComparisonDiagnostic }>;
  generateOnce: (preparedBatchId: string, itemId: string) => Promise<{ status: string; reason?: string; attemptId?: string }>;
  revalidate?: (preparedBatchId: string) => Promise<string | undefined>;
  inspectReferenceBytes?: (preparedBatchId: string, itemId: string) => Promise<{
    status: string; reason?: string; matches?: boolean;
    diagnostic?: ReferenceByteComparisonDiagnostic;
  }>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const alarms = createQueueAlarmRuntime({ alarms: input.alarms, prefix: FLOW_VIDEO_QUEUE_ALARM_PREFIX, now });
  const queueIdFor = (batchId: string) => `flow-video:${batchId}`;
  const generationMatches = (
    batch: PreparedVideoBatchRecord,
    item: PreparedVideoBatchRecord["items"][number],
    generation: NonNullable<FlowVideoAttachmentOperation["videoGeneration"]>,
  ) => generation.preparedBatchId === batch.id && generation.itemId === item.itemId &&
    generation.canonicalShotId === item.canonicalShotId && generation.promptHash === item.contentHash &&
    generation.referenceId === item.reference.referenceId && generation.tabId === batch.target.tabId &&
    generation.projectId === batch.target.projectId && generation.canonicalTarget === batch.target.canonicalTarget &&
    generation.documentId === batch.target.documentId;

  async function makeQueue(preparedBatchId: string): Promise<FlowVideoQueueRecord> {
    const old = await input.repositories.getFlowVideoQueue(queueIdFor(preparedBatchId));
    if (old) return old;
    const batch = PreparedVideoBatchRecordSchema.safeParse(await input.repositories.getPreparedVideoBatchById(preparedBatchId));
    if (!batch.success || batch.data.id !== preparedBatchId || batch.data.destination !== "Flow") throw new Error("prepared_flow_batch_invalid");
    const at = now();
    const items: FlowVideoQueueItem[] = [];
    for (const [order, item] of batch.data.items.entries()) {
      const historicalShotOne = batch.data.id === HISTORIC_SHOT_ONE_BATCH && item.itemId === HISTORIC_SHOT_ONE_ITEM;
      const operation = await input.repositories.getFlowVideoAttachmentOperation(`${preparedBatchId}:${item.itemId}`);
      const generation = operation?.videoGeneration;
      const generationBound = Boolean(generation && generationMatches(batch.data, item, generation));
      const dispatched = generation?.state === "dispatched" && generationBound ? generation : undefined;
      const priorIntent = generation && (generation.state !== "dispatched" || !generationBound) ? generation : undefined;
      items.push({
        itemId: item.itemId, order, shotId: item.canonicalShotId, referenceId: item.reference.referenceId, promptHash: item.contentHash,
        state: dispatched ? "sent" : priorIntent ? "uncertain" : historicalShotOne ? "uncertain" : "pending",
        ...(dispatched ? { attemptId: dispatched.attemptId, dispatchReceipt: { attemptId: dispatched.attemptId, storedAt: dispatched.updatedAt } } : {}),
        ...(priorIntent ? { attemptId: priorIntent.attemptId, reason: !generationBound ? "existing_generation_binding_mismatch" : priorIntent.reason ?? "existing_generation_no_replay" } : {}),
        ...(historicalShotOne && !dispatched && !priorIntent ? { reason: "historical_shot_one_requires_operation_verification" } : {}),
      });
    }
    const lastDispatchAt = items.reduce<number | null>((latest, item) => item.dispatchReceipt ? Math.max(latest ?? 0, item.dispatchReceipt.storedAt) : latest, null);
    return input.repositories.createFlowVideoQueue({
      queueId: queueIdFor(preparedBatchId), preparedBatchId, state: items.every((item) => item.state === "sent") ? "sent" : "ready",
      items, lastDispatchAt, nextActionAt: null, revision: 0, createdAt: at, updatedAt: at,
    });
  }

  async function save(queue: FlowVideoQueueRecord, patch: Partial<FlowVideoQueueRecord>) {
    const next = { ...queue, ...patch, revision: queue.revision + 1, updatedAt: now() };
    const saved = await input.repositories.updateFlowVideoQueue({ expectedRevision: queue.revision, next });
    if (!saved) throw new Error("flow_video_queue_revision_changed");
    return saved;
  }

  const schedule = (queue: FlowVideoQueueRecord) => alarms.schedule(queue.queueId,
    ["paused", "blocked", "stopped", "sent"].includes(queue.state) ? null : queue.nextActionAt);

  async function fail(queue: FlowVideoQueueRecord, item: FlowVideoQueueItem, reason: string, uncertain: boolean, byteMismatchDiagnostic?: ReferenceByteComparisonDiagnostic) {
    const latest = await input.repositories.getFlowVideoQueue(queue.queueId) ?? queue;
    const preserveControl = latest.state === "paused" || latest.state === "stopped";
    const saved = await save(latest, {
      items: latest.items.map((entry) => entry.itemId === item.itemId ? { ...entry, state: uncertain ? "uncertain" as const : "failed" as const, reason, ...(byteMismatchDiagnostic ? { byteMismatchDiagnostic } : {}) } : entry),
      state: preserveControl ? latest.state : "paused",
      pauseReason: preserveControl ? latest.pauseReason : reason,
      nextActionAt: null,
    });
    await schedule(saved);
    return saved;
  }

  async function persistReceipt(queue: FlowVideoQueueRecord, item: FlowVideoQueueItem, attemptId: string, storedAt: number) {
    const latest = await input.repositories.getFlowVideoQueue(queue.queueId);
    if (!latest) throw new Error("flow_video_queue_not_found");
    // A Pause/Stop received during activation is preserved while the durable receipt is still recorded.
    const sentItems = latest.items.map((entry) => entry.itemId === item.itemId
      ? { ...entry, state: "sent" as const, attemptId, dispatchReceipt: { attemptId, storedAt }, reason: undefined, readinessStartedAt: undefined, readinessDeadlineAt: undefined }
      : entry);
    const nextPending = sentItems.find((entry) => entry.state === "pending" || entry.state === "waiting_for_generate");
    const timedAt = nextPending ? nextVideoDispatchAt(storedAt, now()) : null;
    const preserveControl = latest.state === "paused" || latest.state === "stopped";
    const saved = await save(latest, {
      items: sentItems,
      lastDispatchAt: Math.max(latest.lastDispatchAt ?? 0, storedAt),
      state: preserveControl ? latest.state : nextPending ? "waiting" : "sent",
      pauseReason: preserveControl ? latest.pauseReason : undefined,
      nextActionAt: preserveControl ? null : timedAt,
    });
    await schedule(saved);
    return saved;
  }

  async function recoverPreIntentTargetChanged(
    queue: FlowVideoQueueRecord,
    expectedRevision: number,
  ): Promise<FlowVideoQueueRecord | undefined> {
    const unresolved = queue.items.filter(
      (entry) => entry.state === "failed" || entry.state === "uncertain",
    );
    if (unresolved.length !== 1) return undefined;
    const failed = unresolved[0]!;
    if (failed.state !== "failed" || failed.reason !== "target_changed")
      return undefined;
    if (!input.revalidate) return undefined;

    const batchResult = PreparedVideoBatchRecordSchema.safeParse(
      await input.repositories.getPreparedVideoBatchById(queue.preparedBatchId),
    );
    if (
      !batchResult.success ||
      batchResult.data.id !== queue.preparedBatchId ||
      batchResult.data.destination !== "Flow"
    )
      return undefined;
    const batch = batchResult.data;
    const preparedItem = batch.items.find(
      (entry) => entry.itemId === failed.itemId,
    );
    if (
      !preparedItem ||
      preparedItem.reference.referenceId !== failed.referenceId ||
      preparedItem.contentHash !== failed.promptHash
    )
      return undefined;

    const readOperations = async () =>
      Promise.all(
        queue.items.map(async (entry) => ({
          id: `${queue.preparedBatchId}:${entry.itemId}`,
          operation:
            await input.repositories.getFlowVideoAttachmentOperation(
              `${queue.preparedBatchId}:${entry.itemId}`,
            ),
        })),
      );
    const operationsBefore = await readOperations();
    for (const { id, operation } of operationsBefore) {
      const entry = queue.items.find(
        (candidate) => `${queue.preparedBatchId}:${candidate.itemId}` === id,
      )!;
      if (entry.itemId === failed.itemId) {
        // The failure was produced before the sole attachment action intent.
        // Any operation or generation means replay is not authorized.
        if (operation !== undefined) return undefined;
        continue;
      }
      if (entry.state === "sent") {
        const sentItem = batch.items.find(
          (candidate) => candidate.itemId === entry.itemId,
        );
        const generation = operation?.videoGeneration;
        if (
          !sentItem ||
          generation?.state !== "dispatched" ||
          !generationMatches(batch, sentItem, generation) ||
          entry.dispatchReceipt?.attemptId !== generation.attemptId
        )
          return undefined;
        continue;
      }
      if (entry.state !== "pending" || operation !== undefined) return undefined;
    }

    const targetBefore = await input
      .revalidate(queue.preparedBatchId)
      .catch(() => "target_revalidation_failed");
    if (targetBefore) return undefined;

    const latestQueue = await input.repositories.getFlowVideoQueue(
      queue.queueId,
    );
    if (
      !latestQueue ||
      latestQueue.revision !== expectedRevision ||
      latestQueue.state !== queue.state
    )
      return undefined;
    const latestFailed = latestQueue.items.find(
      (entry) => entry.itemId === failed.itemId,
    );
    if (
      !latestFailed ||
      latestFailed.state !== "failed" ||
      latestFailed.reason !== "target_changed" ||
      latestFailed.referenceId !== failed.referenceId ||
      latestFailed.promptHash !== failed.promptHash
    )
      return undefined;
    const operationsAfter = await readOperations();
    if (JSON.stringify(operationsBefore) !== JSON.stringify(operationsAfter))
      return undefined;

    const updatedItems = latestQueue.items.map((entry) =>
      entry.itemId === failed.itemId
        ? {
            ...entry,
            state: "pending" as const,
            priorReason: entry.priorReason ?? entry.reason,
            reason: undefined,
          }
        : entry,
    );
    const nextRecord: FlowVideoQueueRecord = {
      ...latestQueue,
      items: updatedItems,
      state: "waiting",
      pauseReason: undefined,
      nextActionAt: nextVideoDispatchAt(latestQueue.lastDispatchAt, now()),
      revision: latestQueue.revision + 1,
      updatedAt: now(),
    };
    const next =
      await input.repositories.updateFlowVideoQueueIfOperationsUnchanged({
        expectedRevision: latestQueue.revision,
        expectedOperations: operationsBefore,
        next: nextRecord,
      });
    if (!next) throw new Error("flow_video_queue_or_operation_changed");
    await schedule(next);
    return next;
  }

  async function process(queueId: string): Promise<FlowVideoQueueRecord> {
    let queue = await input.repositories.getFlowVideoQueue(queueId);
    if (!queue) throw new Error("flow_video_queue_not_found");
    if (["paused", "blocked", "stopped", "sent"].includes(queue.state)) return queue;
    if (input.revalidate) {
      const invalid = await input.revalidate(queue.preparedBatchId).catch(() => "target_revalidation_failed");
      if (invalid) { queue = await save(queue, { state: "paused", pauseReason: invalid, nextActionAt: null }); await schedule(queue); return queue; }
    }
    const unresolved = queue.items.find((entry) => entry.state === "uncertain" || entry.state === "failed");
    if (unresolved) {
      queue = await save(queue, { state: "paused", pauseReason: unresolved.reason ?? "item_requires_review", nextActionAt: null });
      await schedule(queue); return queue;
    }
    const item = queue.items.find((entry) => entry.state === "pending" || entry.state === "waiting_for_generate");
    if (!item) {
      const uncertain = queue.items.find((entry) => entry.state === "dispatching" || entry.state === "attaching");
      if (uncertain) { queue = await save(queue, { state: "paused", pauseReason: uncertain.reason ?? "item_requires_review", nextActionAt: null }); await schedule(queue); return queue; }
      queue = await save(queue, { state: "sent", pauseReason: undefined, nextActionAt: null }); await schedule(queue); return queue;
    }
    if (item.state === "waiting_for_generate" && item.readinessDeadlineAt !== undefined && now() >= item.readinessDeadlineAt) {
      queue = await save(queue, { state: "paused", pauseReason: "flow_generate_readiness_timeout", nextActionAt: null });
      await schedule(queue); return queue;
    }
    if (queue.nextActionAt !== null && now() < queue.nextActionAt) { await schedule(queue); return queue; }
    if (queue.lastDispatchAt !== null && now() < queue.lastDispatchAt + VIDEO_QUEUE_DISPATCH_GAP_MS) {
      queue = await save(queue, { state: "waiting", nextActionAt: queue.lastDispatchAt + VIDEO_QUEUE_DISPATCH_GAP_MS }); await schedule(queue); return queue;
    }

    if (item.state === "pending") {
      queue = await save(queue, { state: "waiting", nextActionAt: null, items: queue.items.map((entry) => entry.itemId === item.itemId ? { ...entry, state: "attaching" as const, reason: undefined } : entry) });
      const attachment = await input.attachReference(queue.preparedBatchId, item.itemId).catch((): Awaited<ReturnType<typeof input.attachReference>> => ({ status: "uncertain", reason: "attachment_response_lost" }));
      if (attachment.status !== "attached" && attachment.status !== "already_attached") return fail(queue, item, attachment.reason ?? "attachment_blocked", attachment.status === "uncertain", attachment.diagnostic);
      const operation = await input.repositories.getFlowVideoAttachmentOperation(`${queue.preparedBatchId}:${item.itemId}`);
      if (operation?.videoGeneration) {
        if (operation.videoGeneration.state === "dispatched") return persistReceipt(queue, item, operation.videoGeneration.attemptId, operation.videoGeneration.updatedAt);
        return fail(queue, item, operation.videoGeneration.reason ?? "existing_generation_no_replay", true);
      }
      queue = await save(await input.repositories.getFlowVideoQueue(queueId) ?? queue, { items: (await input.repositories.getFlowVideoQueue(queueId) ?? queue).items.map((entry) => entry.itemId === item.itemId ? { ...entry, state: "dispatching" as const } : entry) });
    } else {
      queue = await save(queue, { state: "waiting", items: queue.items.map((entry) => entry.itemId === item.itemId ? { ...entry, state: "dispatching" as const } : entry) });
    }

    const dispatchGate = await input.repositories.getFlowVideoQueue(queueId);
    if (!dispatchGate || dispatchGate.state === "paused" || dispatchGate.state === "stopped") return dispatchGate ?? queue;
    const generated = await input.generateOnce(queue.preparedBatchId, item.itemId).catch(() => ({ status: "uncertain", reason: "generation_response_lost" }));
    const operation = await input.repositories.getFlowVideoAttachmentOperation(`${queue.preparedBatchId}:${item.itemId}`);
    const generation = operation?.videoGeneration;
    if (generation?.state === "dispatched") {
      const batch = PreparedVideoBatchRecordSchema.safeParse(await input.repositories.getPreparedVideoBatchById(queue.preparedBatchId));
      const preparedItem = batch.success ? batch.data.items.find((entry) => entry.itemId === item.itemId) : undefined;
      if (!batch.success || !preparedItem || !generationMatches(batch.data, preparedItem, generation))
        return fail(queue, item, "dispatched_generation_binding_mismatch", true);
      return persistReceipt(queue, item, generation.attemptId, generation.updatedAt);
    }
    if (generated.reason === "generate_disabled" && !generation) {
      const current = await input.repositories.getFlowVideoQueue(queueId) ?? queue;
      if (current.state === "paused" || current.state === "stopped") return current;
      const startedAt = item.readinessStartedAt ?? now();
      const deadlineAt = item.readinessDeadlineAt ?? nextVideoReadinessDeadline(startedAt);
      const checkAt = Math.min(deadlineAt, now() + 30_000);
      const waiting = await save(current, {
        state: "waiting", pauseReason: undefined, nextActionAt: checkAt,
        items: current.items.map((entry) => entry.itemId === item.itemId ? { ...entry, state: "waiting_for_generate" as const, readinessStartedAt: startedAt, readinessDeadlineAt: deadlineAt, reason: "generate_disabled" } : entry),
      });
      await schedule(waiting); return waiting;
    }
    return fail(queue, item, generated.reason ?? "generation_not_confirmed", generated.status === "uncertain" || generation?.state === "dispatch_intent");
  }

  async function run(queueId: string) { return alarms.serialize(queueId, () => process(queueId)); }
  return {
    get: async (preparedBatchId: string) => input.repositories.getFlowVideoQueue(queueIdFor(preparedBatchId)) ?? null,
    start: async (preparedBatchId: string) => {
      const queue = await makeQueue(preparedBatchId);
      if (queue.state === "ready") return run(queue.queueId);
      if (queue.state === "waiting") return queue;
      return queue;
    },
    pause: async (preparedBatchId: string, expectedRevision: number) => command(preparedBatchId, expectedRevision, "paused", "user_paused"),
    stop: async (preparedBatchId: string, expectedRevision: number) => command(preparedBatchId, expectedRevision, "stopped", "user_stopped"),
    resume: async (preparedBatchId: string, expectedRevision: number) => {
      const queue = await input.repositories.getFlowVideoQueue(queueIdFor(preparedBatchId));
      if (!queue || queue.revision !== expectedRevision || queue.state !== "paused") throw new Error("flow_video_queue_resume_invalid");
      const unresolved = queue.items.filter((entry) => entry.state === "uncertain" || entry.state === "failed");
      if (unresolved.length > 0) {
        const recovered = await recoverPreIntentTargetChanged(queue, expectedRevision);
        if (recovered) return run(recovered.queueId);
        const blocked = unresolved[0]!;
        const saved = await save(queue, { state: "blocked", pauseReason: blocked.reason ?? "item_requires_review", nextActionAt: null }); await schedule(saved); return saved;
      }
      const items = queue.items.map((entry) => entry.state === "waiting_for_generate" ? { ...entry, readinessStartedAt: now(), readinessDeadlineAt: nextVideoReadinessDeadline(now()) } : entry);
      const next = await save(queue, { state: "waiting", pauseReason: undefined, items, nextActionAt: queue.nextActionAt && queue.nextActionAt > now() ? queue.nextActionAt : now() });
      return run(next.queueId);
    },
    recheckAndResume: async (preparedBatchId: string, expectedRevision: number) => {
      const queueId = queueIdFor(preparedBatchId);
      const queue = await input.repositories.getFlowVideoQueue(queueId);
      if (!queue || queue.revision !== expectedRevision || !["paused", "blocked"].includes(queue.state))
        throw new Error("flow_video_queue_recheck_invalid");
      const failedItems = queue.items.filter((entry) => entry.state === "failed" || entry.state === "uncertain");
      if (failedItems.length !== 1 || failedItems[0]?.state !== "failed" || failedItems[0]?.reason !== "candidate_bytes_mismatch")
        throw new Error("flow_video_queue_failure_not_recheckable");
      if (!input.inspectReferenceBytes || !input.revalidate)
        throw new Error("flow_video_queue_recheck_unavailable");

      const batchResult = PreparedVideoBatchRecordSchema.safeParse(await input.repositories.getPreparedVideoBatchById(preparedBatchId));
      if (!batchResult.success || batchResult.data.id !== preparedBatchId || batchResult.data.destination !== "Flow")
        throw new Error("prepared_flow_batch_invalid");
      const batch = batchResult.data;
      const failedItem = failedItems[0];
      const preparedItem = batch.items.find((entry) => entry.itemId === failedItem.itemId);
      if (!preparedItem || preparedItem.reference.referenceId !== failedItem.referenceId || preparedItem.contentHash !== failedItem.promptHash)
        throw new Error("flow_video_queue_pairing_changed");

      const readOperations = async () => Promise.all(queue.items.map(async (entry) => ({
        itemId: entry.itemId,
        operation: await input.repositories.getFlowVideoAttachmentOperation(`${preparedBatchId}:${entry.itemId}`),
      })));
      const operationsBefore = await readOperations();
      for (const { itemId, operation } of operationsBefore) {
        const entry = queue.items.find((candidate) => candidate.itemId === itemId)!;
        if (entry.state === "sent") {
          const sentPreparedItem = batch.items.find((candidate) => candidate.itemId === itemId);
          const generation = operation?.videoGeneration;
          if (!sentPreparedItem || generation?.state !== "dispatched" || !generationMatches(batch, sentPreparedItem, generation) || entry.dispatchReceipt?.attemptId !== generation.attemptId)
            throw new Error("sent_item_operation_changed");
          continue;
        }
        if (itemId === failedItem.itemId) {
          // candidate_bytes_mismatch is recorded before attachment action_intent.
          if (operation !== undefined) throw new Error("failed_item_has_existing_operation");
          continue;
        }
        if (["failed", "uncertain", "attaching", "dispatching"].includes(entry.state) ||
          operation?.status === "action_intent" || operation?.status === "uncertain" ||
          (operation?.videoGeneration && operation.videoGeneration.state !== "dispatched"))
          throw new Error("flow_video_queue_has_unresolved_intent");
      }

      const targetBefore = await input.revalidate(preparedBatchId).catch(() => "target_revalidation_failed");
      if (targetBefore) throw new Error("target_revalidation_failed");
      const inspection = await input.inspectReferenceBytes(preparedBatchId, failedItem.itemId);
      if (inspection.status !== "inspected" || inspection.matches !== true ||
        inspection.diagnostic?.preparedSha256 !== preparedItem.reference.sha256 ||
        inspection.diagnostic.candidateBytesSha256 !== preparedItem.reference.sha256)
        throw new Error(inspection.reason ?? "reference_recheck_did_not_match");

      const latestQueue = await input.repositories.getFlowVideoQueue(queueId);
      if (!latestQueue || latestQueue.revision !== expectedRevision || latestQueue.state !== queue.state)
        throw new Error("flow_video_queue_changed_during_recheck");
      const latestFailed = latestQueue.items.find((entry) => entry.itemId === failedItem.itemId);
      if (!latestFailed || latestFailed.state !== "failed" || latestFailed.reason !== "candidate_bytes_mismatch" ||
        latestFailed.referenceId !== failedItem.referenceId || latestFailed.promptHash !== failedItem.promptHash)
        throw new Error("flow_video_queue_failure_changed");
      const operationsAfter = await readOperations();
      if (JSON.stringify(operationsBefore) !== JSON.stringify(operationsAfter))
        throw new Error("flow_video_operation_changed_during_recheck");
      const targetAfter = await input.revalidate(preparedBatchId).catch(() => "target_revalidation_failed");
      if (targetAfter) throw new Error("target_revalidation_failed");

      const updatedItems = latestQueue.items.map((entry) => entry.itemId === failedItem.itemId
        ? { ...entry, state: "pending" as const, priorReason: entry.priorReason ?? entry.reason, reason: undefined }
        : entry);
      const nextRecord: FlowVideoQueueRecord = {
        ...latestQueue,
        items: updatedItems,
        state: "waiting",
        pauseReason: undefined,
        nextActionAt: nextVideoDispatchAt(latestQueue.lastDispatchAt, now()),
        revision: latestQueue.revision + 1,
        updatedAt: now(),
      };
      const next = await input.repositories.updateFlowVideoQueueIfOperationsUnchanged({
        expectedRevision: latestQueue.revision,
        expectedOperations: operationsBefore.map(({ itemId, operation }) => ({ id: `${preparedBatchId}:${itemId}`, operation })),
        next: nextRecord,
      });
      if (!next) throw new Error("flow_video_queue_or_operation_changed");
      await schedule(next);
      return run(next.queueId);
    },
    reconcilePreAddFailure: async (preparedBatchId: string, expectedRevision: number) => {
      if (preparedBatchId !== HISTORIC_SHOT_TWO_BATCH) throw new Error("flow_video_pre_add_snapshot_mismatch");
      const queueId = queueIdFor(preparedBatchId);
      const queue = await input.repositories.getFlowVideoQueue(queueId);
      if (!queue || queue.revision !== expectedRevision || !["paused", "blocked"].includes(queue.state))
        throw new Error("flow_video_queue_reconcile_invalid");
      const target = queue.items.filter((entry) => entry.itemId === HISTORIC_SHOT_TWO_ITEM);
      if (target.length !== 1 || target[0]?.state !== "uncertain" || target[0].reason !== "candidate_missing_or_virtualized" || target[0].referenceId !== HISTORIC_SHOT_TWO_REFERENCE)
        throw new Error("flow_video_pre_add_snapshot_mismatch");
      if (queue.items.some((entry) => entry.itemId !== HISTORIC_SHOT_TWO_ITEM && ["uncertain", "failed", "attaching", "dispatching"].includes(entry.state)))
        throw new Error("flow_video_queue_has_unrelated_uncertainty");
      if (!input.revalidate) throw new Error("target_revalidation_unavailable");

      const batchResult = PreparedVideoBatchRecordSchema.safeParse(await input.repositories.getPreparedVideoBatchById(preparedBatchId));
      if (!batchResult.success || batchResult.data.id !== HISTORIC_SHOT_TWO_BATCH || batchResult.data.destination !== "Flow") throw new Error("prepared_flow_batch_invalid");
      const batch = batchResult.data;
      const item = batch.items.find((entry) => entry.itemId === HISTORIC_SHOT_TWO_ITEM);
      const queueItem = target[0]!;
      if (!item || item.reference.referenceId !== HISTORIC_SHOT_TWO_REFERENCE || item.reference.referenceId !== queueItem.referenceId || item.contentHash !== queueItem.promptHash)
        throw new Error("flow_video_queue_pairing_changed");

      const operations = await Promise.all(queue.items.map(async (entry) => ({ id: `${preparedBatchId}:${entry.itemId}`, operation: await input.repositories.getFlowVideoAttachmentOperation(`${preparedBatchId}:${entry.itemId}`) })));
      let targetOperation: FlowVideoAttachmentOperation | undefined;
      for (const snapshot of operations) {
        const entry = queue.items.find((candidate) => `${preparedBatchId}:${candidate.itemId}` === snapshot.id)!;
        const operation = snapshot.operation;
        if (entry.itemId === HISTORIC_SHOT_TWO_ITEM) {
          if (!operation || operation.id !== `${preparedBatchId}:${HISTORIC_SHOT_TWO_ITEM}` || operation.preparedBatchId !== preparedBatchId || operation.itemId !== HISTORIC_SHOT_TWO_ITEM || operation.referenceId !== HISTORIC_SHOT_TWO_REFERENCE || operation.status !== "uncertain" || operation.reason !== "candidate_missing_or_virtualized" || operation.updatedAt !== HISTORIC_SHOT_TWO_UPDATED_AT || operation.videoGeneration || operation.verifiedAttachment || operation.preActivationEvidence || operation.preAddReconciliationEvidence)
            throw new Error("flow_video_pre_add_operation_snapshot_mismatch");
          targetOperation = operation;
          continue;
        }
        if (entry.state === "sent") {
          const sentItem = batch.items.find((candidate) => candidate.itemId === entry.itemId);
          const generation = operation?.videoGeneration;
          if (!sentItem || generation?.state !== "dispatched" || !generationMatches(batch, sentItem, generation) || entry.dispatchReceipt?.attemptId !== generation.attemptId)
            throw new Error("sent_item_operation_changed");
          continue;
        }
        if (operation?.status === "action_intent" || operation?.status === "uncertain" || operation?.videoGeneration)
          throw new Error("flow_video_queue_has_unresolved_intent");
      }
      if (!targetOperation) throw new Error("flow_video_pre_add_operation_missing");

      const targetBefore = await input.revalidate(preparedBatchId).catch(() => "target_revalidation_failed");
      if (targetBefore) throw new Error("target_revalidation_failed");
      const savedReference = await input.repositories.getReferenceById(HISTORIC_SHOT_TWO_REFERENCE);
      if (!savedReference || !ReferenceAssignmentRecordSchema.safeParse(savedReference).success ||
        savedReference.assignmentVersion !== item.reference.assignmentVersion || savedReference.sha256 !== item.reference.sha256 || savedReference.byteSize !== item.reference.byteSize ||
        savedReference.mimeType !== item.reference.mimeType || savedReference.width !== item.reference.width || savedReference.height !== item.reference.height ||
        savedReference.workspaceId !== batch.workspaceId || savedReference.batchId !== batch.imageSourceBatchId || savedReference.batchSourceHash !== batch.imageSourceBatchHash ||
        savedReference.shotId !== item.canonicalShotId || savedReference.tabId !== batch.target.tabId || savedReference.flowProjectId !== batch.target.projectId ||
        savedReference.canonicalTarget !== batch.target.canonicalTarget || savedReference.documentId !== batch.target.documentId || !savedReference.providerAssetId)
        throw new Error("prepared_reference_binding_changed");
      const savedBytes = new Uint8Array(await savedReference.bytes.arrayBuffer());
      if (savedBytes.byteLength !== item.reference.byteSize || await sha256Bytes(savedBytes) !== item.reference.sha256 || savedReference.sha256 !== item.reference.sha256)
        throw new Error("prepared_reference_bytes_mismatch");
      const currentReference = await input.repositories.getReferenceById(HISTORIC_SHOT_TWO_REFERENCE);
      if (!currentReference || currentReference.assignmentVersion !== savedReference.assignmentVersion || currentReference.sha256 !== savedReference.sha256 ||
        currentReference.batchId !== savedReference.batchId || currentReference.batchSourceHash !== savedReference.batchSourceHash || currentReference.shotId !== savedReference.shotId ||
        currentReference.tabId !== savedReference.tabId || currentReference.flowProjectId !== savedReference.flowProjectId || currentReference.documentId !== savedReference.documentId ||
        currentReference.bytes.size !== item.reference.byteSize || await sha256Bytes(new Uint8Array(await currentReference.bytes.arrayBuffer())) !== item.reference.sha256)
        throw new Error("prepared_reference_changed_during_reconcile");
      const targetAfter = await input.revalidate(preparedBatchId).catch(() => "target_revalidation_failed");
      if (targetAfter) throw new Error("target_revalidation_failed");

      const latestQueue = await input.repositories.getFlowVideoQueue(queueId);
      if (!latestQueue || latestQueue.revision !== expectedRevision || JSON.stringify(latestQueue) !== JSON.stringify(queue)) throw new Error("flow_video_queue_changed_during_reconcile");
      const latestOperations = await Promise.all(queue.items.map(async (entry) => ({ id: `${preparedBatchId}:${entry.itemId}`, operation: await input.repositories.getFlowVideoAttachmentOperation(`${preparedBatchId}:${entry.itemId}`) })));
      if (JSON.stringify(latestOperations) !== JSON.stringify(operations)) throw new Error("flow_video_operation_changed_during_reconcile");
      const reconciledAt = now();
      const nextOperation: FlowVideoAttachmentOperation = {
        ...targetOperation, status: "blocked", reason: "pre_add_failure_reconciled", updatedAt: reconciledAt,
        preAddReconciliationEvidence: { priorStatus: "uncertain", priorReason: "candidate_missing_or_virtualized", priorUpdatedAt: HISTORIC_SHOT_TWO_UPDATED_AT, producer: "historical_candidate_missing_before_add_activation", addClickAttempted: false, reconciledAt },
      };
      const nextQueue: FlowVideoQueueRecord = {
        ...queue, state: "paused", pauseReason: "pre_add_failure_reconciled", nextActionAt: null,
        items: queue.items.map((entry) => entry.itemId === HISTORIC_SHOT_TWO_ITEM ? { ...entry, state: "pending", priorReason: entry.reason, reason: undefined } : entry),
        revision: queue.revision + 1, updatedAt: reconciledAt,
      };
      const saved = await input.repositories.reconcileFlowVideoPreAddFailure({ expectedRevision, expectedOperations: operations, expectedOperation: targetOperation, nextOperation, nextQueue });
      if (!saved) throw new Error("flow_video_queue_or_operation_changed");
      await schedule(saved);
      return saved;
    },
    onAlarm: (name: string) => { const queueId = alarms.queueIdFromAlarm(name); return queueId ? run(queueId) : Promise.resolve(undefined); },
    reconcileStartup: async () => {
      let listing: Awaited<ReturnType<ExtensionRepositories["listFlowVideoQueuesForStartup"]>>;
      try {
        listing = await input.repositories.listFlowVideoQueuesForStartup();
      } catch (error) {
        throw new FlowVideoStartupReconciliationError("queue_list", error);
      }
      if (listing.invalidCount > 0) {
        console.warn("[flow_video_queue_startup_invalid_rows_skipped]", {
          at: now(),
          invalidCount: listing.invalidCount,
          invalid: listing.invalid,
        });
      }
      for (let queue of listing.queues) {
        // Migrate old completion-wait records only when their durable item operation proves Generate was dispatched.
        let changed = false;
        const items = [...queue.items];
        for (const [index, entry] of items.entries()) {
          if (!["awaiting_completion", "awaiting_verification"].includes(entry.state)) continue;
          const operation = await input.repositories.getFlowVideoAttachmentOperation(`${queue.preparedBatchId}:${entry.itemId}`);
          const generation = operation?.videoGeneration;
          const batch = PreparedVideoBatchRecordSchema.safeParse(await input.repositories.getPreparedVideoBatchById(queue.preparedBatchId));
          const preparedItem = batch.success ? batch.data.items.find((item) => item.itemId === entry.itemId) : undefined;
          if (generation?.state !== "dispatched" || !batch.success || !preparedItem || !generationMatches(batch.data, preparedItem, generation)) continue;
          items[index] = { ...entry, state: "sent", attemptId: generation.attemptId, dispatchReceipt: { attemptId: generation.attemptId, storedAt: generation.updatedAt }, priorReason: entry.reason, reason: undefined };
          changed = true;
        }
        if (changed) {
          const lastDispatchAt = items.reduce<number | null>((latest, entry) => entry.dispatchReceipt ? Math.max(latest ?? 0, entry.dispatchReceipt.storedAt) : latest, null);
          const pending = items.some((entry) => entry.state === "pending" || entry.state === "waiting_for_generate");
          const legacyAttributionPause = queue.state === "paused" && queue.pauseReason === "video_result_attribution_unavailable";
          const preservePause = queue.state === "paused" && !legacyAttributionPause;
          queue = await save(queue, {
            items, lastDispatchAt,
            state: preservePause ? "paused" : pending ? "waiting" : "sent",
            pauseReason: preservePause ? queue.pauseReason : undefined,
            nextActionAt: preservePause ? null : pending ? nextVideoDispatchAt(lastDispatchAt, now()) : null,
          });
        }
        if (queue.state === "waiting" && queue.nextActionAt !== null) await schedule(queue);
        if (queue.items.some((entry) => entry.state === "dispatching" || entry.state === "attaching")) {
          const inFlight = queue.items.find((entry) => entry.state === "dispatching" || entry.state === "attaching")!;
          const operation = await input.repositories.getFlowVideoAttachmentOperation(`${queue.preparedBatchId}:${inFlight.itemId}`);
          const generation = operation?.videoGeneration;
          const batch = PreparedVideoBatchRecordSchema.safeParse(await input.repositories.getPreparedVideoBatchById(queue.preparedBatchId));
          const preparedItem = batch.success ? batch.data.items.find((item) => item.itemId === inFlight.itemId) : undefined;
          if (generation?.state === "dispatched" && batch.success && preparedItem && generationMatches(batch.data, preparedItem, generation)) {
            const saved = await persistReceipt(queue, inFlight, generation.attemptId, generation.updatedAt);
            if (saved.state === "waiting") await schedule(saved);
          } else {
            const reason = inFlight.state === "dispatching" ? "worker_restart_during_generation" : "worker_restart_during_attachment";
            const saved = await save(queue, { state: "paused", pauseReason: reason, items: queue.items.map((entry) => entry.itemId === inFlight.itemId ? { ...entry, state: "uncertain" as const, attemptId: generation?.attemptId, reason } : entry), nextActionAt: null });
            await schedule(saved);
          }
        }
      }
    },
  };

  async function command(preparedBatchId: string, expectedRevision: number, state: "paused" | "stopped", reason: string) {
    const queue = await input.repositories.getFlowVideoQueue(queueIdFor(preparedBatchId));
    if (!queue || queue.revision !== expectedRevision || !["ready", "waiting", "paused"].includes(queue.state) && !(state === "stopped" && queue.state === "blocked")) throw new Error("flow_video_queue_command_invalid");
    const items = queue.items.map((entry) => {
      if (state === "stopped" && entry.state === "pending") return { ...entry, state: "skipped" as const };
      if (entry.state === "attaching" || entry.state === "dispatching") return { ...entry, state: "uncertain" as const, reason: entry.state === "dispatching" ? "pause_during_generation_delivery" : "pause_during_attachment_delivery" };
      return entry;
    });
    const saved = await save(queue, { state, pauseReason: reason, nextActionAt: null, items });
    await schedule(saved); return saved;
  }
}
