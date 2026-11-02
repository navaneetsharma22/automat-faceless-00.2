import type { FlowVideoQueueRecord } from "../../domain/jobs/videoQueue";
import {
  nextVideoCompletionCheck,
  nextVideoDispatchAt,
  VIDEO_QUEUE_COMPLETION_CHECK_MS,
  VIDEO_QUEUE_DISPATCH_GAP_MS,
} from "../../domain/jobs/videoQueue";
import type { ExtensionRepositories } from "../../storage/repositories";
import { PreparedVideoBatchRecordSchema } from "../../shared/schemas";
import { createQueueAlarmRuntime } from "../scheduler";

export const FLOW_VIDEO_QUEUE_ALARM_PREFIX = "automat-flow-video-queue:";
const HISTORIC_SHOT_ONE_BATCH = "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179";
const HISTORIC_SHOT_ONE_ITEM = "import:default:video:item:0";

export type AttributableVideoResult = {
  status: "processing" | "completed" | "failed" | "unknown";
  attemptId: string;
  resultIdentity?: string;
  reason?: string;
  attributable?: true;
};

export type FlowVideoQueueView = FlowVideoQueueRecord;

export function createFlowVideoQueueHandler(input: {
  repositories: ExtensionRepositories;
  alarms: Pick<typeof chrome.alarms, "create" | "clear">;
  attachReference: (preparedBatchId: string, itemId: string) => Promise<{ status: string; reason?: string }>;
  generateOnce: (preparedBatchId: string, itemId: string) => Promise<{ status: string; reason?: string; attemptId?: string }>;
  inspectCompletion?: (input: { preparedBatchId: string; itemId: string; attemptId: string }) => Promise<AttributableVideoResult>;
  revalidate?: (preparedBatchId: string) => Promise<string | undefined>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const alarms = createQueueAlarmRuntime({
    alarms: input.alarms,
    prefix: FLOW_VIDEO_QUEUE_ALARM_PREFIX,
    now,
  });
  const queueIdFor = (batchId: string) => `flow-video:${batchId}`;

  async function makeQueue(preparedBatchId: string): Promise<FlowVideoQueueRecord> {
    const old = await input.repositories.getFlowVideoQueue(queueIdFor(preparedBatchId));
    if (old) return old;
    const batch = PreparedVideoBatchRecordSchema.safeParse(
      await input.repositories.getPreparedVideoBatchById(preparedBatchId),
    );
    if (!batch.success || batch.data.id !== preparedBatchId || batch.data.destination !== "Flow")
      throw new Error("prepared_flow_batch_invalid");
    const at = now();
    const items = [];
    for (const [order, item] of batch.data.items.entries()) {
      const historicShotOne = batch.data.id === HISTORIC_SHOT_ONE_BATCH && item.itemId === HISTORIC_SHOT_ONE_ITEM;
      const existing = historicShotOne
        ? await input.repositories.getFlowVideoAttachmentOperation(`${preparedBatchId}:${item.itemId}`)
        : undefined;
      items.push({
        itemId: item.itemId,
        order,
        shotId: item.canonicalShotId,
        referenceId: item.reference.referenceId,
        promptHash: item.contentHash,
        state: historicShotOne && !existing?.videoGeneration ? "uncertain" as const : "pending" as const,
        ...(historicShotOne && !existing?.videoGeneration ? { reason: "historical_shot_one_requires_operation_verification" } : {}),
      });
    }
    return input.repositories.createFlowVideoQueue({
      queueId: queueIdFor(preparedBatchId),
      preparedBatchId,
      state: "ready",
      items,
      lastDispatchAt: null,
      nextActionAt: null,
      revision: 0,
      createdAt: at,
      updatedAt: at,
    });
  }

  async function save(queue: FlowVideoQueueRecord, patch: Partial<FlowVideoQueueRecord>) {
    const next: FlowVideoQueueRecord = {
      ...queue,
      ...patch,
      revision: queue.revision + 1,
      updatedAt: now(),
    };
    const saved = await input.repositories.updateFlowVideoQueue({
      expectedRevision: queue.revision,
      next,
    });
    if (!saved) throw new Error("flow_video_queue_revision_changed");
    return saved;
  }

  const schedule = (queue: FlowVideoQueueRecord) =>
    alarms.schedule(queue.queueId, ["paused", "blocked", "stopped", "completed"].includes(queue.state) ? null : queue.nextActionAt);

  async function process(queueId: string): Promise<FlowVideoQueueRecord> {
    let queue = await input.repositories.getFlowVideoQueue(queueId);
    if (!queue) throw new Error("flow_video_queue_not_found");
    if (["paused", "blocked", "stopped", "completed"].includes(queue.state)) return queue;
    if (input.revalidate) {
      const invalid = await input.revalidate(queue.preparedBatchId).catch(() => "target_revalidation_failed");
      if (invalid) {
        queue = await save(queue, { state: "paused", pauseReason: invalid, nextActionAt: null });
        await schedule(queue);
        return queue;
      }
    }

    const active = queue.items.find((item) =>
      item.state === "awaiting_completion" || item.state === "awaiting_verification",
    );
    if (active) {
      if (!input.inspectCompletion) {
        queue = await save(queue, {
          items: queue.items.map((item) => item.itemId === active.itemId
            ? { ...item, state: "awaiting_verification" as const, reason: "video_result_attribution_unavailable", nextCheckAt: undefined }
            : item),
          state: "paused",
          pauseReason: "video_result_attribution_unavailable",
          nextActionAt: null,
        });
        await schedule(queue);
        return queue;
      }
      if (active.nextCheckAt !== undefined && now() < active.nextCheckAt) {
        await schedule(queue);
        return queue;
      }
      if (!active.attemptId) {
        queue = await save(queue, { state: "paused", pauseReason: "attempt_identity_missing", nextActionAt: null });
        await schedule(queue);
        return queue;
      }
      const inspected = input.inspectCompletion
        ? await input.inspectCompletion({ preparedBatchId: queue.preparedBatchId, itemId: active.itemId, attemptId: active.attemptId }).catch(() => ({ status: "unknown" as const, attemptId: active.attemptId, reason: "result_inspection_failed" }))
        : { status: "unknown" as const, attemptId: active.attemptId, reason: "video_result_attribution_unavailable" };
      if (inspected.attemptId !== active.attemptId) {
        queue = await save(queue, { state: "paused", pauseReason: "completion_attempt_mismatch", nextActionAt: null });
        await schedule(queue);
        return queue;
      }
      if (inspected.status === "completed" && inspected.attributable === true && inspected.resultIdentity) {
        const items = queue.items.map((item) => item.itemId === active.itemId
          ? { ...item, state: "completed" as const, resultIdentity: inspected.resultIdentity, completedAt: now(), reason: undefined, nextCheckAt: undefined }
          : item);
        const next = items.find((item) => item.state === "pending");
        const nextAt = next ? nextVideoDispatchAt(queue.lastDispatchAt, now()) : null;
        queue = await save(queue, {
          items,
          state: next ? "waiting" : "completed",
          pauseReason: undefined,
          nextActionAt: nextAt,
        });
        await schedule(queue);
        return nextAt !== null && nextAt <= now() ? process(queueId) : queue;
      }
      if (inspected.status === "failed" && inspected.attributable === true && inspected.resultIdentity) {
        const items = queue.items.map((item) => item.itemId === active.itemId
          ? { ...item, state: "failed" as const, resultIdentity: inspected.resultIdentity, reason: "provider_failed_attributable" }
          : item);
        queue = await save(queue, { items, state: "paused", pauseReason: "provider_failed_attributable", nextActionAt: null });
        await schedule(queue);
        return queue;
      }
      const reason = inspected.reason ?? (inspected.status === "processing" ? "provider_still_processing" : "completion_unverified");
      const itemState = inspected.status === "processing" ? "awaiting_completion" as const : "awaiting_verification" as const;
      const nextCheckAt = nextVideoCompletionCheck(now());
      queue = await save(queue, {
        items: queue.items.map((item) => item.itemId === active.itemId ? { ...item, state: itemState, reason, nextCheckAt } : item),
        state: "waiting",
        pauseReason: undefined,
        nextActionAt: nextCheckAt,
      });
      await schedule(queue);
      return queue;
    }

    const unresolved = queue.items.find((item) => item.state === "uncertain" || item.state === "failed");
    if (unresolved) {
      queue = await save(queue, {
        state: "paused",
        pauseReason: unresolved.reason ?? "item_requires_review",
        nextActionAt: null,
      });
      await schedule(queue);
      return queue;
    }

    const pending = queue.items.find((item) => item.state === "pending");
    if (!pending) {
      queue = await save(queue, { state: "completed", nextActionAt: null, pauseReason: undefined });
      await schedule(queue);
      return queue;
    }
    if (queue.nextActionAt !== null && now() < queue.nextActionAt) {
      await schedule(queue);
      return queue;
    }

    const operation = await input.repositories.getFlowVideoAttachmentOperation(`${queue.preparedBatchId}:${pending.itemId}`);
    if (operation?.videoGeneration) {
      const gen = operation.videoGeneration;
      if (gen.state === "dispatched") {
        if (!input.inspectCompletion) {
          queue = await save(queue, {
            items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state: "awaiting_verification", attemptId: gen.attemptId, reason: "video_result_attribution_unavailable", nextCheckAt: undefined } : item),
            state: "paused",
            pauseReason: "video_result_attribution_unavailable",
            nextActionAt: null,
          });
          await schedule(queue);
          return queue;
        }
        const nextCheckAt = nextVideoCompletionCheck(now());
        queue = await save(queue, {
          items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state: "awaiting_verification", attemptId: gen.attemptId, reason: "existing_generation_requires_attribution", nextCheckAt } : item),
          state: "waiting",
          nextActionAt: nextCheckAt,
        });
        await schedule(queue);
        return queue;
      }
      queue = await save(queue, {
        items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state: "uncertain", attemptId: gen.attemptId, reason: gen.reason ?? `generation_${gen.state}` } : item),
        state: "paused",
        pauseReason: gen.reason ?? `generation_${gen.state}`,
        nextActionAt: null,
      });
      await schedule(queue);
      return queue;
    }

    if (queue.lastDispatchAt !== null && now() < queue.lastDispatchAt + VIDEO_QUEUE_DISPATCH_GAP_MS) {
      queue = await save(queue, { state: "waiting", nextActionAt: queue.lastDispatchAt + VIDEO_QUEUE_DISPATCH_GAP_MS });
      await schedule(queue);
      return queue;
    }
    queue = await save(queue, {
      items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state: "attaching", reason: undefined } : item),
      state: "waiting",
      nextActionAt: null,
    });
    const attachment = await input.attachReference(queue.preparedBatchId, pending.itemId).catch(() => ({ status: "uncertain", reason: "attachment_response_lost" }));
    if (attachment.status !== "attached" && attachment.status !== "already_attached") {
      const uncertain = attachment.status === "uncertain";
      queue = await save(queue, {
        items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state: uncertain ? "uncertain" : "failed", reason: attachment.reason ?? (uncertain ? "attachment_uncertain" : "attachment_blocked") } : item),
        state: "paused",
        pauseReason: attachment.reason ?? (uncertain ? "attachment_uncertain" : "attachment_blocked"),
        nextActionAt: null,
      });
      await schedule(queue);
      return queue;
    }
    const beforeGenerate = await input.repositories.getFlowVideoAttachmentOperation(`${queue.preparedBatchId}:${pending.itemId}`);
    if (beforeGenerate?.videoGeneration) {
      queue = await save(queue, { items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state: "uncertain", attemptId: beforeGenerate.videoGeneration!.attemptId, reason: "existing_generation_no_replay" } : item), state: "paused", pauseReason: "existing_generation_no_replay", nextActionAt: null });
      await schedule(queue);
      return queue;
    }
    queue = await save(queue, { items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state: "dispatching" } : item) });
    const dispatchGate = await input.repositories.getFlowVideoQueue(queue.queueId);
    if (!dispatchGate || dispatchGate.state === "paused" || dispatchGate.state === "stopped") {
      if (dispatchGate) {
        const gateSaved = await save(dispatchGate, {
          items: dispatchGate.items.map((item) => item.itemId === pending.itemId
            ? { ...item, state: dispatchGate.state === "stopped" ? "skipped" as const : "pending" as const }
            : item),
        });
        await schedule(gateSaved);
        return gateSaved;
      }
      return queue;
    }
    const generated = await input.generateOnce(queue.preparedBatchId, pending.itemId).catch(() => ({ status: "uncertain", reason: "generation_response_lost" }));
    const latest = await input.repositories.getFlowVideoAttachmentOperation(`${queue.preparedBatchId}:${pending.itemId}`);
    const generation = latest?.videoGeneration;
    if (generation?.state === "dispatched") {
      const dispatchedAt = generation.updatedAt;
      if (!input.inspectCompletion) {
        queue = await save(queue, {
          items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state: "awaiting_verification", attemptId: generation.attemptId, reason: "video_result_attribution_unavailable" } : item),
          lastDispatchAt: dispatchedAt,
          state: "paused",
          pauseReason: "video_result_attribution_unavailable",
          nextActionAt: null,
        });
        await schedule(queue);
        return queue;
      }
      const nextCheckAt = nextVideoCompletionCheck(dispatchedAt);
      queue = await save(queue, {
        items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state: "awaiting_completion", attemptId: generation.attemptId, reason: undefined, nextCheckAt } : item),
        lastDispatchAt: dispatchedAt,
        state: "waiting",
        nextActionAt: nextCheckAt,
      });
      await schedule(queue);
      return queue;
    }
    const state = generated.status === "uncertain" || generated.status === "already_dispatched" ? "uncertain" as const : "failed" as const;
    queue = await save(queue, {
      items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state, attemptId: generation?.attemptId, reason: generated.reason ?? "generation_not_confirmed" } : item),
      state: "paused",
      pauseReason: generated.reason ?? "generation_not_confirmed",
      nextActionAt: null,
    });
    await schedule(queue);
    return queue;
  }

  async function run(queueId: string) {
    return alarms.serialize(queueId, () => process(queueId));
  }

  return {
    get: async (preparedBatchId: string) => {
      const queue = await input.repositories.getFlowVideoQueue(queueIdFor(preparedBatchId));
      return queue ?? null;
    },
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
      const next = await save(queue, { state: "waiting", pauseReason: undefined, nextActionAt: queue.nextActionAt ?? now() });
      return run(next.queueId);
    },
    onAlarm: (name: string) => {
      const queueId = alarms.queueIdFromAlarm(name);
      return queueId ? run(queueId) : Promise.resolve(undefined);
    },
    reconcileStartup: async () => {
      for (const queue of await input.repositories.listFlowVideoQueues()) {
        if (queue.state === "waiting" && queue.nextActionAt !== null) await schedule(queue);
        if (queue.items.some((item) => item.state === "dispatching" || item.state === "attaching")) {
          const pending = queue.items.find((item) => item.state === "dispatching" || item.state === "attaching")!;
          const op = await input.repositories.getFlowVideoAttachmentOperation(`${queue.preparedBatchId}:${pending.itemId}`);
          if (pending.state === "dispatching" && op?.videoGeneration?.state === "dispatched") {
            const nextCheckAt = now() + VIDEO_QUEUE_COMPLETION_CHECK_MS;
            const resumed = {
              ...queue,
              state: "waiting" as const,
              pauseReason: undefined,
              items: queue.items.map((item) => item.itemId === pending.itemId ? {
                ...item,
                state: "awaiting_verification" as const,
                attemptId: op.videoGeneration!.attemptId,
                reason: "worker_restart_after_dispatch",
                nextCheckAt,
              } : item),
              nextActionAt: nextCheckAt,
              revision: queue.revision + 1,
              updatedAt: now(),
            };
            const saved = await input.repositories.updateFlowVideoQueue({ expectedRevision: queue.revision, next: resumed });
            if (!saved) throw new Error("flow_video_queue_revision_changed");
            await schedule(saved);
            continue;
          }
          const next = {
            ...queue,
            state: "paused" as const,
            pauseReason: pending.state === "dispatching" ? "worker_restart_during_generation" : "worker_restart_during_attachment",
            items: queue.items.map((item) => item.itemId === pending.itemId ? { ...item, state: "uncertain" as const, attemptId: op?.videoGeneration?.attemptId, reason: pending.state === "dispatching" ? "worker_restart_during_generation" : "worker_restart_during_attachment" } : item),
            nextActionAt: null,
            revision: queue.revision + 1,
            updatedAt: now(),
          };
          const saved = await input.repositories.updateFlowVideoQueue({ expectedRevision: queue.revision, next });
          if (!saved) throw new Error("flow_video_queue_revision_changed");
          await schedule(saved);
        }
      }
    },
  };

  async function command(preparedBatchId: string, expectedRevision: number, state: "paused" | "stopped", reason: string) {
    const queue = await input.repositories.getFlowVideoQueue(queueIdFor(preparedBatchId));
    if (!queue || queue.revision !== expectedRevision || !["ready", "waiting", "paused"].includes(queue.state)) throw new Error("flow_video_queue_command_invalid");
    const items = queue.items.map((item) => {
      if (state === "stopped" && item.state === "pending") return { ...item, state: "skipped" as const };
      if (item.state === "attaching" || item.state === "dispatching")
        return { ...item, state: "uncertain" as const, reason: item.state === "dispatching" ? "pause_during_generation_delivery" : "pause_during_attachment_delivery" };
      return item;
    });
    const next = await save(queue, { state, pauseReason: reason, nextActionAt: null, items });
    await schedule(next);
    return next;
  }
}
