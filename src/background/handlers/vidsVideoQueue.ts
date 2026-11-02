import { PreparedVideoBatchRecordSchema, VideoSettingsConfirmationSchema } from "../../shared/schemas";
import { VidsVideoGenerationOperationSchema } from "../../domain/jobs/vidsVideoGeneration";
import { VidsVideoQueueRecordSchema, VIDS_VIDEO_DISPATCH_GAP_MS, VIDS_VIDEO_READINESS_TIMEOUT_MS, type VidsVideoQueueRecord } from "../../domain/jobs/vidsVideoQueue";
import { importPromptBatch } from "../../domain/batches/importBatch";
import { canonicalizeShotId } from "../../domain/batches/inputPolicy";
import { sha256Hex } from "../../domain/batches/hashPrompt";
import type { ExtensionRepositories } from "../../storage/repositories";
import { createQueueAlarmRuntime, CHROME_MIN_ALARM_DELAY_MS } from "../scheduler";

export const VIDS_VIDEO_QUEUE_ALARM_PREFIX = "automat-vids-video-queue:";

/** Vids-only timed submission. The existing P10.1/P10.2 handlers retain all byte, prompt, intent and one-shot checks. */
export function createVidsVideoQueueHandler(input: {
  repositories: ExtensionRepositories;
  alarms: Pick<typeof chrome.alarms, "create" | "clear">;
  attach: (batchId: string, itemId: string, fromQueue: true) => Promise<{ status: string; reason?: string }>;
  getAttachment: (batchId: string, itemId: string) => Promise<{ status: string; reason?: string }>;
  generate: (batchId: string, itemId: string, fromQueue: true) => Promise<{ status: string; reason?: string; operation?: unknown }>;
  getGeneration: (batchId: string, itemId: string) => Promise<{ status: string; reason?: string; operation?: unknown }>;
  transitionFromPrevious: (batchId: string, previousItemId: string, inspectOnly?: boolean) => Promise<{ status: "ready" | "blocked"; reason?: string; diagnostics?: unknown }>;
  now?: () => number;
  makeRunId?: () => string;
}) {
  const now = input.now ?? Date.now;
  const runtime = createQueueAlarmRuntime({ alarms: input.alarms, prefix: VIDS_VIDEO_QUEUE_ALARM_PREFIX, now });
  const queueIdFor = (batchId: string) => `vids-video:${batchId}`;

  const save = async (queue: VidsVideoQueueRecord, patch: Partial<VidsVideoQueueRecord>) => {
    const next = { ...queue, ...patch, revision: queue.revision + 1, updatedAt: now() };
    if (!VidsVideoQueueRecordSchema.safeParse(next).success) throw new Error("vids_video_queue_transition_invalid");
    const saved = await input.repositories.updateVidsVideoQueue({ expectedRevision: queue.revision, next });
    if (!saved) throw new Error("vids_video_queue_revision_changed");
    return saved;
  };
  const schedule = async (queue: VidsVideoQueueRecord) => runtime.schedule(queue.queueId, queue.nextActionAt);

  async function adoptExisting(batchId: string): Promise<VidsVideoQueueRecord> {
    const batch = PreparedVideoBatchRecordSchema.parse(await input.repositories.getPreparedVideoBatchById(batchId));
    const confirmation = VideoSettingsConfirmationSchema.safeParse(batch.manualSettingsDeclaration);
    if (batch.destination !== "Vids" || !confirmation.success || confirmation.data.destination !== "Vids" || confirmation.data.tabId !== batch.target.tabId || confirmation.data.canonicalTarget !== batch.target.canonicalTarget || confirmation.data.projectId !== batch.target.projectId || confirmation.data.documentId !== batch.target.documentId) throw new Error("prepared_vids_batch_invalid");
    const imported = importPromptBatch(batch.videoSourceText, "video");
    if (await sha256Hex(batch.videoSourceText) !== batch.videoSourceHash || !imported.ok || imported.items.length !== batch.items.length) throw new Error("prepared_video_source_invalid");
    for (const item of batch.items) {
      const source = imported.items[item.order];
      if (!source || source.rawBody !== item.rawJsonBody || source.shotId !== (item.shotId ?? item.canonicalShotId) || canonicalizeShotId(source.shotId) !== item.canonicalShotId || await sha256Hex(item.rawJsonBody) !== item.contentHash) throw new Error("prepared_item_pairing_or_hash_mismatch");
    }
    const items: VidsVideoQueueRecord["items"] = [];
    let lastDispatchAt: number | null = null;
    for (const item of batch.items) {
      const generation = await input.getGeneration(batchId, item.itemId);
      const op = VidsVideoGenerationOperationSchema.safeParse(generation.operation);
      if (generation.status === "dispatched" || generation.status === "already_dispatched") {
        if (!op.success || op.data.status !== "dispatched" || op.data.preparedBatchId !== batch.id || op.data.workspaceId !== batch.workspaceId || op.data.itemId !== item.itemId || op.data.canonicalShotId !== item.canonicalShotId || op.data.promptHash !== item.contentHash || op.data.referenceId !== item.reference.referenceId || op.data.referenceSha256 !== item.reference.sha256 || op.data.tabId !== batch.target.tabId || op.data.canonicalTarget !== batch.target.canonicalTarget || op.data.documentId !== batch.target.documentId || op.data.activationAttempted !== true || op.data.activationCount !== 1 || op.data.dispatchedAt === undefined)
          throw new Error("vids_existing_dispatch_binding_unverified");
        const storedAt = op.data.dispatchedAt;
        items.push({ itemId: item.itemId, order: item.order, shotId: item.canonicalShotId, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, promptHash: item.contentHash, state: "sent", attemptId: op.data.attemptId, dispatchReceipt: { attemptId: op.data.attemptId, storedAt } });
        lastDispatchAt = Math.max(lastDispatchAt ?? 0, storedAt);
      } else if (generation.status !== "not_started") {
        throw new Error(generation.status === "uncertain" || generation.status === "dispatch_intent" ? "vids_existing_generation_uncertain" : "vids_existing_generation_requires_review");
      } else {
        const attachment = await input.getAttachment(batchId, item.itemId);
        if (attachment.status === "uncertain" || attachment.status === "action_intent") throw new Error("vids_existing_attachment_uncertain");
        items.push({ itemId: item.itemId, order: item.order, shotId: item.canonicalShotId, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, promptHash: item.contentHash, state: "pending" });
      }
    }
    const timestamp = now();
    const queue: VidsVideoQueueRecord = { queueId: queueIdFor(batchId), preparedBatchId: batchId, state: items.every((item) => item.state === "sent") ? "all_sent" : "ready", items, revision: 0, createdAt: timestamp, updatedAt: timestamp, lastDispatchAt, cooldownDeadlineAt: lastDispatchAt === null ? null : lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS, readinessDeadlineAt: null, readinessStartedAt: null, nextActionAt: null, runId: input.makeRunId?.() ?? crypto.randomUUID() };
    return input.repositories.createVidsVideoQueue(queue);
  }

  async function run(queueId: string): Promise<VidsVideoQueueRecord | undefined> {
    return runtime.serialize(queueId, async () => {
      let queue = await input.repositories.getVidsVideoQueue(queueId);
      if (!queue || ["paused", "stopped", "blocked", "all_sent"].includes(queue.state)) return queue;
      const prepared = PreparedVideoBatchRecordSchema.safeParse(await input.repositories.getPreparedVideoBatchById(queue.preparedBatchId));
      const sourceItems = prepared.success ? importPromptBatch(prepared.data.videoSourceText, "video") : undefined;
      let sourceHashValid = false;
      if (prepared.success) sourceHashValid = await sha256Hex(prepared.data.videoSourceText) === prepared.data.videoSourceHash;
      let pairBindingInvalid = false;
      if (prepared.success && sourceItems?.ok && prepared.data.items.length === queue.items.length) {
        for (const item of prepared.data.items) {
          const saved = queue.items[item.order];
          const source = sourceItems.items[item.order];
          const itemHashValid = await sha256Hex(item.rawJsonBody) === item.contentHash;
          if (!saved || !source || !itemHashValid || source.rawBody !== item.rawJsonBody || source.shotId !== (item.shotId ?? item.canonicalShotId) || canonicalizeShotId(source.shotId) !== item.canonicalShotId || saved.itemId !== item.itemId || saved.shotId !== item.canonicalShotId || saved.referenceId !== item.reference.referenceId || saved.referenceSha256 !== item.reference.sha256 || saved.promptHash !== item.contentHash) {
            pairBindingInvalid = true;
            break;
          }
        }
      }
      if (!prepared.success || prepared.data.destination !== "Vids" || !sourceItems?.ok || !sourceHashValid || prepared.data.items.length !== queue.items.length || pairBindingInvalid) {
        const blocked = await save(queue, { state: "blocked", pauseReason: "prepared_pair_binding_changed", nextActionAt: null });
        await schedule(blocked); return blocked;
      }
      const next = queue.items.find((item) => item.state === "pending" || item.state === "checking_generate" || item.state === "attaching" || item.state === "entering_prompt");
      if (!next) {
        queue = await save(queue, { state: "all_sent", nextActionAt: null, readinessStartedAt: null, readinessDeadlineAt: null, pauseReason: undefined });
        await schedule(queue); return queue;
      }
      const nowAt = now();
      if (queue.lastDispatchAt !== null && nowAt < queue.lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS) {
        queue = await save(queue, { state: "cooldown", cooldownDeadlineAt: queue.lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS, nextActionAt: queue.lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS, readinessDeadlineAt: null, readinessStartedAt: null });
        await schedule(queue); return queue;
      }
      if (next.order > 0 && queue.items[next.order - 1]?.state === "sent" && next.state === "pending") {
        const previous = queue.items[next.order - 1]!;
        const transitioning = queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: "transitioning" as const } : item);
        queue = await save(queue, { state: "preparing", items: transitioning, nextActionAt: null });
        const transitioned = await input.transitionFromPrevious(queue.preparedBatchId, previous.itemId);
        if (transitioned.status !== "ready") {
          const blockedItems = queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: "blocked" as const, reason: transitioned.reason ?? "vids_composer_transition_failed" } : item);
          queue = await save(queue, { state: "paused", items: blockedItems, pauseReason: transitioned.reason ?? "vids_composer_transition_failed", nextActionAt: null });
          await schedule(queue); return queue;
        }
        queue = await input.repositories.getVidsVideoQueue(queueId) ?? queue;
        if (queue.state === "paused" || queue.state === "stopped") return queue;
      }
      if (next.state === "pending" || next.state === "attaching" || next.state === "transitioning") {
        const items = queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: "attaching" as const } : item);
        queue = await save(queue, { state: "preparing", items, nextActionAt: null });
        const attachment = await input.attach(queue.preparedBatchId, next.itemId, true);
        if (attachment.status !== "attached") {
          const uncertain = attachment.status === "uncertain" || attachment.status === "action_intent";
          const items = queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: uncertain ? "uncertain" as const : "blocked" as const, reason: attachment.reason ?? "vids_attachment_failed" } : item);
          queue = await save(queue, { state: uncertain ? "blocked" : "paused", items, pauseReason: attachment.reason ?? "vids_attachment_failed", nextActionAt: null });
          await schedule(queue); return queue;
        }
      }
      queue = await input.repositories.getVidsVideoQueue(queueId) ?? queue;
      if (queue.state === "paused" || queue.state === "stopped") return queue;
      const currentItem = queue.items.find((item) => item.itemId === next.itemId)!;
      const readinessStartedAt = currentItem.state === "checking_generate" ? queue.readinessStartedAt ?? now() : now();
      const readinessDeadlineAt = currentItem.state === "checking_generate" ? queue.readinessDeadlineAt ?? readinessStartedAt + VIDS_VIDEO_READINESS_TIMEOUT_MS : readinessStartedAt + VIDS_VIDEO_READINESS_TIMEOUT_MS;
      const items = queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: "checking_generate" as const } : item);
      queue = await save(queue, { state: "checking_generate", items, readinessStartedAt, readinessDeadlineAt, nextActionAt: Math.min(now() + CHROME_MIN_ALARM_DELAY_MS, readinessDeadlineAt) });
      if (now() >= readinessDeadlineAt) {
        const blockedItems = queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: "blocked" as const, reason: "generate_readiness_timeout" } : item);
        queue = await save(queue, { state: "paused", items: blockedItems, pauseReason: "generate_readiness_timeout", nextActionAt: null });
        await schedule(queue); return queue;
      }
      queue = await save(queue, { items: queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: "sending" as const } : item) });
      const result = await input.generate(queue.preparedBatchId, next.itemId, true);
      const operation = VidsVideoGenerationOperationSchema.safeParse(result.operation);
      if ((result.status === "dispatched" || result.status === "already_dispatched") && operation.success && operation.data.status === "dispatched" && operation.data.preparedBatchId === queue.preparedBatchId && operation.data.workspaceId === prepared.data.workspaceId && operation.data.itemId === next.itemId && operation.data.canonicalShotId === currentItem.shotId && operation.data.promptHash === currentItem.promptHash && operation.data.referenceId === currentItem.referenceId && operation.data.referenceSha256 === currentItem.referenceSha256 && operation.data.tabId === prepared.data.target.tabId && operation.data.canonicalTarget === prepared.data.target.canonicalTarget && operation.data.documentId === prepared.data.target.documentId && operation.data.activationAttempted === true && operation.data.activationCount === 1 && operation.data.dispatchedAt !== undefined) {
        const storedAt = operation.data.dispatchedAt;
        const sentItems = queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: "sent" as const, attemptId: operation.data!.attemptId, dispatchReceipt: { attemptId: operation.data!.attemptId, storedAt } } : item);
        const allSent = sentItems.every((item) => item.state === "sent");
        queue = await save(queue, { items: sentItems, state: allSent ? "all_sent" : "cooldown", lastDispatchAt: storedAt, cooldownDeadlineAt: storedAt + VIDS_VIDEO_DISPATCH_GAP_MS, readinessStartedAt: null, readinessDeadlineAt: null, nextActionAt: allSent ? null : storedAt + VIDS_VIDEO_DISPATCH_GAP_MS, pauseReason: undefined });
        await schedule(queue); return queue;
      }
      if (result.reason === "generate_disabled" && !result.operation && now() < readinessDeadlineAt) {
        queue = await save(queue, { state: "checking_generate", items: queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: "checking_generate" as const } : item), nextActionAt: Math.min(now() + CHROME_MIN_ALARM_DELAY_MS, readinessDeadlineAt) });
        await schedule(queue); return queue;
      }
      const uncertain = result.status === "uncertain" || result.status === "dispatch_intent" || result.status === "already_dispatched";
      const failedItems = queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: uncertain ? "uncertain" as const : "blocked" as const, reason: result.reason ?? "vids_generation_blocked", ...(operation.success ? { attemptId: operation.data.attemptId } : {}) } : item);
      queue = await save(queue, { state: uncertain ? "blocked" : "paused", items: failedItems, pauseReason: result.reason ?? "vids_generation_blocked", nextActionAt: null });
      await schedule(queue); return queue;
    });
  }

  return {
    get: async (preparedBatchId: string) => input.repositories.getVidsVideoQueue(queueIdFor(preparedBatchId)),
    inspectTransition: async (preparedBatchId: string, itemId: string) => {
      const queue = await input.repositories.getVidsVideoQueue(queueIdFor(preparedBatchId));
      const current = queue?.items.find((item) => item.itemId === itemId);
      if (!queue || queue.state !== "paused" || queue.pauseReason !== "vids_previous_composer_content_conflict" || !current || current.state !== "blocked" || current.reason !== "vids_previous_composer_content_conflict" || current.order < 1)
        return { status: "blocked", reason: "vids_transition_inspection_not_applicable" };
      const previous = queue.items[current.order - 1];
      if (!previous || previous.state !== "sent" || !previous.dispatchReceipt || previous.dispatchReceipt.attemptId !== previous.attemptId)
        return { status: "blocked", reason: "vids_previous_item_dispatch_binding_unverified" };
      const previousGeneration = await input.getGeneration(preparedBatchId, previous.itemId);
      const previousOperation = VidsVideoGenerationOperationSchema.safeParse(previousGeneration.operation);
      if (!previousOperation.success || previousGeneration.status !== "dispatched" || previousOperation.data.attemptId !== previous.dispatchReceipt.attemptId || previousOperation.data.dispatchedAt !== previous.dispatchReceipt.storedAt || previousOperation.data.activationAttempted !== true || previousOperation.data.activationCount !== 1)
        return { status: "blocked", reason: "vids_previous_item_dispatch_binding_unverified" };
      const generation = await input.getGeneration(preparedBatchId, itemId);
      if (generation.status !== "not_started") return { status: "blocked", reason: "vids_generation_attempt_requires_review" };
      const attachment = await input.getAttachment(preparedBatchId, itemId);
      if (attachment.status !== "not_started") return { status: "blocked", reason: "vids_attachment_attempt_requires_review" };
      return input.transitionFromPrevious(preparedBatchId, previous.itemId, true);
    },
    start: async (preparedBatchId: string) => {
      const id = queueIdFor(preparedBatchId);
      let queue = await input.repositories.getVidsVideoQueue(id);
      if (!queue) queue = await adoptExisting(preparedBatchId);
      if (queue.state === "ready" || queue.state === "cooldown" || queue.state === "checking_generate") void run(id).catch(() => undefined);
      return queue;
    },
    pause: async (preparedBatchId: string, expectedRevision: number) => {
      const queue = await input.repositories.getVidsVideoQueue(queueIdFor(preparedBatchId));
      if (!queue || queue.revision !== expectedRevision) throw new Error("vids_video_queue_revision_changed");
      const paused = await save(queue, { state: "paused", nextActionAt: null, pauseReason: "paused_by_user" });
      await runtime.clear(paused.queueId); return paused;
    },
    stop: async (preparedBatchId: string, expectedRevision: number) => {
      const queue = await input.repositories.getVidsVideoQueue(queueIdFor(preparedBatchId));
      if (!queue || queue.revision !== expectedRevision) throw new Error("vids_video_queue_revision_changed");
      const stopped = await save(queue, { state: "stopped", nextActionAt: null, pauseReason: "stopped_by_user" });
      await runtime.clear(stopped.queueId); return stopped;
    },
    resume: async (preparedBatchId: string, expectedRevision: number) => {
      const queue = await input.repositories.getVidsVideoQueue(queueIdFor(preparedBatchId));
      if (!queue || queue.revision !== expectedRevision || queue.state !== "paused") throw new Error("vids_video_queue_revision_changed");
      const retryablePreIntentReasons = new Set(["generate_readiness_timeout", "vids_composer_collapsed_or_changed", "vids_previous_composer_content_conflict", "vids_previous_reference_identity_mismatch", "vids_previous_prompt_hash_mismatch"]);
      if (queue.items.some((item) => item.state === "uncertain" || (item.state === "blocked" && !retryablePreIntentReasons.has(item.reason ?? "")))) throw new Error("vids_video_queue_requires_review");
      for (const item of queue.items.filter((candidate) => candidate.state === "blocked" && candidate.reason === "vids_previous_composer_content_conflict")) {
        if ((await input.getGeneration(preparedBatchId, item.itemId)).status !== "not_started") throw new Error("vids_generation_attempt_requires_review");
        if ((await input.getAttachment(preparedBatchId, item.itemId)).status !== "not_started") throw new Error("vids_attachment_attempt_requires_review");
      }
      const resumedItems = queue.items.map((item) => item.state === "blocked" && retryablePreIntentReasons.has(item.reason ?? "") ? { ...item, state: "pending" as const, reason: undefined } : item);
      const stillChecking = queue.items.some((item) => item.state === "checking_generate");
      const resumed = await save(queue, { state: stillChecking ? "checking_generate" : queue.lastDispatchAt !== null && now() < queue.lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS ? "cooldown" : "ready", items: resumedItems, nextActionAt: stillChecking ? Math.min(now() + CHROME_MIN_ALARM_DELAY_MS, queue.readinessDeadlineAt ?? now()) : queue.lastDispatchAt !== null ? Math.max(now(), queue.lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS) : now(), pauseReason: undefined, readinessStartedAt: stillChecking ? queue.readinessStartedAt : null, readinessDeadlineAt: stillChecking ? queue.readinessDeadlineAt : null, runId: input.makeRunId?.() ?? crypto.randomUUID() });
      void run(resumed.queueId).catch(() => undefined); return resumed;
    },
    onAlarm: (name: string) => { const id = runtime.queueIdFromAlarm(name); return id ? run(id) : Promise.resolve(undefined); },
    reconcileStartup: async () => {
      const queues = await input.repositories.listVidsVideoQueues();
      for (const queue of queues) {
        if (queue.state === "preparing" || queue.state === "checking_generate") {
          const item = queue.items.find((candidate) => candidate.state === "attaching" || candidate.state === "transitioning" || candidate.state === "entering_prompt" || candidate.state === "checking_generate" || candidate.state === "sending");
          if (!item) continue;
          const generation = await input.getGeneration(queue.preparedBatchId, item.itemId);
          if (generation.status === "dispatched") {
            const op = VidsVideoGenerationOperationSchema.safeParse(generation.operation);
            if (op.success && op.data.activationAttempted && op.data.activationCount === 1 && op.data.dispatchedAt) {
              const updatedItems = queue.items.map((value) => value.itemId === item.itemId ? { ...value, state: "sent" as const, attemptId: op.data.attemptId, dispatchReceipt: { attemptId: op.data.attemptId, storedAt: op.data.dispatchedAt! } } : value);
              const allSent = updatedItems.every((value) => value.state === "sent");
              const updated = await save(queue, { items: updatedItems, state: allSent ? "all_sent" : "cooldown", lastDispatchAt: op.data.dispatchedAt, cooldownDeadlineAt: op.data.dispatchedAt + VIDS_VIDEO_DISPATCH_GAP_MS, readinessStartedAt: null, readinessDeadlineAt: null, nextActionAt: allSent ? null : op.data.dispatchedAt + VIDS_VIDEO_DISPATCH_GAP_MS });
              if (updated.state !== "all_sent") await schedule(updated);
              continue;
            }
          }
          const uncertain = ["uncertain", "dispatch_intent", "blocked"].includes(generation.status);
          const transitionUncertain = item.state === "transitioning" || item.state === "attaching" || item.state === "entering_prompt";
          const stoppedItems = queue.items.map((value) => value.itemId === item.itemId ? { ...value, state: uncertain || transitionUncertain ? "uncertain" as const : "pending" as const, ...((uncertain || transitionUncertain) ? { reason: transitionUncertain ? "worker_restart_during_composer_transition" : "worker_restart_generation_uncertain" } : {}) } : value);
          const recovered = await save(queue, { state: uncertain || transitionUncertain ? "blocked" : "paused", items: stoppedItems, pauseReason: uncertain ? "worker_restart_generation_uncertain" : transitionUncertain ? "worker_restart_during_composer_transition" : "worker_restart_review_required", nextActionAt: null });
          await schedule(recovered); continue;
        }
        if (queue.state === "cooldown") await schedule(queue);
      }
    },
  };
}
