import { PreparedVideoBatchRecordSchema, VideoSettingsConfirmationSchema } from "../../shared/schemas";
import { VidsVideoGenerationOperationSchema } from "../../domain/jobs/vidsVideoGeneration";
import { VidsVideoAttachmentOperationSchema } from "../../domain/jobs/vidsVideoAttachment";
import { VidsVideoQueueRecordSchema, VidsVideoTransitionCheckpointSchema, VIDS_VIDEO_DISPATCH_GAP_MS, VIDS_VIDEO_READINESS_TIMEOUT_MS, type VidsCleanupDiagnostics, type VidsVideoQueueRecord } from "../../domain/jobs/vidsVideoQueue";
import { importPromptBatch } from "../../domain/batches/importBatch";
import { canonicalizeShotId } from "../../domain/batches/inputPolicy";
import { sha256Hex } from "../../domain/batches/hashPrompt";
import type { ExtensionRepositories } from "../../storage/repositories";
import { createQueueAlarmRuntime, CHROME_MIN_ALARM_DELAY_MS } from "../scheduler";
import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import { CONNECTION_CAPABILITY, CONNECTOR_PROTOCOL_VERSION } from "../../platforms/shared/contracts";

export const VIDS_VIDEO_QUEUE_ALARM_PREFIX = "automat-vids-video-queue:";

function boundedCleanupDiagnostics(rawValue: unknown, checkpointRead: VidsCleanupDiagnostics["checkpointRead"], checkpointWrite: VidsCleanupDiagnostics["checkpointWrite"], triggerSource?: NonNullable<VidsCleanupDiagnostics["handoffTrace"]>["triggerSource"], elapsedSinceReceiptToFirstReadMs?: number): VidsCleanupDiagnostics {
  const raw = rawValue && typeof rawValue === "object" ? rawValue as Record<string, unknown> : {};
  const rawTrace = raw.handoffTrace && typeof raw.handoffTrace === "object" ? raw.handoffTrace as Record<string, unknown> : {};
  const safeState = (value: unknown): NonNullable<VidsCleanupDiagnostics["handoffTrace"]>["visibilityStart"] => value === "visible" || value === "hidden" || value === "prerender" || value === "unloaded" || value === "unknown" ? value : undefined;
  const safePanel = (value: unknown): NonNullable<VidsCleanupDiagnostics["handoffTrace"]>["initialAnimateState"] => value === "collapsed" || value === "expanded" || value === "missing" || value === "ambiguous" || value === "unknown" ? value : undefined;
  const safeToggleLabel = (value: unknown): NonNullable<VidsCleanupDiagnostics["handoffTrace"]>["composerToggleLabelBefore"] => value === "Expand" || value === "Collapse" || value === "missing" || value === "ambiguous" || value === "unknown" ? value : undefined;
  const safeToggleOutcome = (value: unknown): NonNullable<VidsCleanupDiagnostics["handoffTrace"]>["composerToggleOutcome"] => value === "already_expanded" || value === "expanded" || value === "missing" || value === "ambiguous" || value === "disabled" || value === "label_unrecognized" || value === "settlement_failed" ? value : undefined;
  const safeToggleScope = (value: unknown): NonNullable<VidsCleanupDiagnostics["handoffTrace"]>["composerToggleScope"] => value === "panel" || value === "tabpanel_sibling" || value === "composer_container" || value === "missing" || value === "ambiguous" || value === "unknown" ? value : undefined;
  const safeReadinessOutcome = (value: unknown): NonNullable<VidsCleanupDiagnostics["handoffTrace"]>["composerReadinessOutcome"] => value === "ready" || value === "timeout_hidden" || value === "timeout_visible" ? value : undefined;
  const traceArray = <T extends Record<string, unknown>>(value: unknown, parse: (item: unknown, index: number) => T | undefined): T[] | undefined => Array.isArray(value) ? value.slice(0, 8).flatMap((item, index) => { const parsed = parse(item, index); return parsed ? [parsed] : []; }) : undefined;
  const visibilityChanges = traceArray(rawTrace.visibilityChanges, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const entry = item as Record<string, unknown>, state = safeState(entry.state);
    return state && typeof entry.atMs === "number" && Number.isFinite(entry.atMs) ? { inspection: Math.min(20, Math.max(0, Math.trunc(Number(entry.inspection) || 0))), atMs: Math.min(10_000_000, Math.max(0, Math.trunc(entry.atMs))), state } : undefined;
  });
  const previewObservations = traceArray(rawTrace.previewObservations, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const entry = item as Record<string, unknown>;
    return typeof entry.atMs === "number" && Number.isFinite(entry.atMs) ? { inspection: Math.min(20, Math.max(0, Math.trunc(Number(entry.inspection) || 0))), atMs: Math.min(10_000_000, Math.max(0, Math.trunc(entry.atMs))), selectorMatches: Math.min(10, Math.max(0, Math.trunc(Number(entry.selectorMatches) || 0))), visibleMatches: Math.min(10, Math.max(0, Math.trunc(Number(entry.visibleMatches) || 0))), loadedMatches: Math.min(10, Math.max(0, Math.trunc(Number(entry.loadedMatches) || 0))), ...(safeToggleLabel(entry.composerToggleLabel) ? { composerToggleLabel: safeToggleLabel(entry.composerToggleLabel) } : {}) } : undefined;
  });
  const composerToggleObservations = traceArray(rawTrace.composerToggleObservations, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const entry = item as Record<string, unknown>, label = safeToggleLabel(entry.label), scope = safeToggleScope(entry.scope), state = safeState(entry.visibility);
    return typeof entry.atMs === "number" && Number.isFinite(entry.atMs) && label && scope && state ? { atMs: Math.min(30_000, Math.max(0, Math.trunc(entry.atMs))), label, scope, candidateCount: Math.min(10, Math.max(0, Math.trunc(Number(entry.candidateCount) || 0))), panelCount: Math.min(10, Math.max(0, Math.trunc(Number(entry.panelCount) || 0))), editorCount: Math.min(10, Math.max(0, Math.trunc(Number(entry.editorCount) || 0))), visibility: state } : undefined;
  });
  const selectedTriggerSource = triggerSource ?? (rawTrace.triggerSource === "automatic_start" || rawTrace.triggerSource === "automatic_alarm" || rawTrace.triggerSource === "manual_resume" || rawTrace.triggerSource === "visibility_wakeup" || rawTrace.triggerSource === "unknown" ? rawTrace.triggerSource : undefined);
  const trace = {
    ...(selectedTriggerSource ? { triggerSource: selectedTriggerSource } : {}),
    ...(typeof rawTrace.elapsedSinceReceiptToFirstReadMs === "number" ? { elapsedSinceReceiptToFirstReadMs: Math.min(10_000_000, Math.max(0, Math.trunc(rawTrace.elapsedSinceReceiptToFirstReadMs))) } : elapsedSinceReceiptToFirstReadMs !== undefined ? { elapsedSinceReceiptToFirstReadMs: Math.min(10_000_000, Math.max(0, Math.trunc(elapsedSinceReceiptToFirstReadMs))) } : {}),
    ...(safeState(rawTrace.visibilityStart) ? { visibilityStart: safeState(rawTrace.visibilityStart) } : {}), ...(safeState(rawTrace.visibilityEnd) ? { visibilityEnd: safeState(rawTrace.visibilityEnd) } : {}),
    ...(visibilityChanges ? { visibilityChanges } : {}),
    ...(safePanel(rawTrace.initialAnimateState) ? { initialAnimateState: safePanel(rawTrace.initialAnimateState) } : {}), ...(safePanel(rawTrace.finalAnimateState) ? { finalAnimateState: safePanel(rawTrace.finalAnimateState) } : {}),
    ...(safeToggleLabel(rawTrace.composerToggleLabelBefore) ? { composerToggleLabelBefore: safeToggleLabel(rawTrace.composerToggleLabelBefore) } : {}), ...(safeToggleLabel(rawTrace.composerToggleLabelAfter) ? { composerToggleLabelAfter: safeToggleLabel(rawTrace.composerToggleLabelAfter) } : {}),
    ...(typeof rawTrace.composerToggleClickAttempted === "boolean" ? { composerToggleClickAttempted: rawTrace.composerToggleClickAttempted } : {}),
    ...(safeToggleOutcome(rawTrace.composerToggleOutcome) ? { composerToggleOutcome: safeToggleOutcome(rawTrace.composerToggleOutcome) } : {}),
    ...(typeof rawTrace.composerReadinessWaitMs === "number" ? { composerReadinessWaitMs: Math.min(30_000, Math.max(0, Math.trunc(rawTrace.composerReadinessWaitMs))) } : {}),
    ...(safeReadinessOutcome(rawTrace.composerReadinessOutcome) ? { composerReadinessOutcome: safeReadinessOutcome(rawTrace.composerReadinessOutcome) } : {}),
    ...(typeof rawTrace.composerEditorReady === "boolean" ? { composerEditorReady: rawTrace.composerEditorReady } : {}),
    ...(safeToggleScope(rawTrace.composerToggleScope) ? { composerToggleScope: safeToggleScope(rawTrace.composerToggleScope) } : {}),
    ...(composerToggleObservations ? { composerToggleObservations } : {}),
    ...(typeof rawTrace.expansionAttempted === "boolean" ? { expansionAttempted: rawTrace.expansionAttempted } : {}), ...(typeof rawTrace.panelReplaced === "boolean" ? { panelReplaced: rawTrace.panelReplaced } : {}), ...(typeof rawTrace.editorReplaced === "boolean" ? { editorReplaced: rawTrace.editorReplaced } : {}),
    ...(previewObservations ? { previewObservations } : {}),
  };
  const stage = raw.stage === "readiness" ? "readiness" : raw.stage === "reference_remove" ? "reference_remove" : raw.stage === "prompt_clear" || raw.stage === "mutation" ? "prompt_clear" : raw.stage === "settlement" ? "settlement" : raw.stage === "binding" ? "binding" : raw.stage === "complete" ? "complete" : "ownership";
  const clearAvailable = raw.clearAvailable === "unique" || raw.clearAvailable === "ambiguous" || raw.clearAvailable === "missing" ? raw.clearAvailable : "not_checked";
  const enumValue = <T extends string>(value: unknown, allowed: readonly T[]) => typeof value === "string" && allowed.includes(value as T) ? value as T : undefined;
  return {
    stage,
    editorRebound: raw.editorRebound === true,
    panelRebound: raw.panelRebound === true,
    panelStateBeforeExpansion: enumValue(raw.panelStateBeforeExpansion, ["collapsed", "expanded", "unknown"]),
    panelStateAfterExpansion: enumValue(raw.panelStateAfterExpansion, ["settled", "missing", "unstable", "not_attempted"]),
    freshPreviewDetection: enumValue(raw.freshPreviewDetection, ["present", "absent_after_settle", "delayed_then_present", "unknown"]),
    checkpointRead, checkpointWrite,
    previewCount: typeof raw.previewCount === "number" ? Math.min(1000, Math.max(0, Math.trunc(raw.previewCount))) : undefined,
    fileInputCount: typeof raw.fileInputCount === "number" ? Math.min(1000, Math.max(0, Math.trunc(raw.fileInputCount))) : undefined,
    expectedPromptSha256: typeof raw.promptExpectedSha256 === "string" && /^[0-9a-f]{64}$/.test(raw.promptExpectedSha256) ? raw.promptExpectedSha256 : undefined,
    currentPromptSha256: typeof raw.promptActualSha256 === "string" && /^[0-9a-f]{64}$/.test(raw.promptActualSha256) ? raw.promptActualSha256 : undefined,
    expectedPromptLength: typeof raw.expectedPromptLength === "number" ? Math.min(10_000_000, Math.max(0, Math.trunc(raw.expectedPromptLength))) : undefined,
    currentPromptLength: typeof raw.actualPromptLength === "number" ? Math.min(10_000_000, Math.max(0, Math.trunc(raw.actualPromptLength))) : undefined,
    clearAvailable,
    settledEmpty: raw.settledPromptEmpty === true,
    handoffTrace: Object.keys(trace).length ? trace : undefined,
  };
}

/** Vids-only timed submission. The existing P10.1/P10.2 handlers retain all byte, prompt, intent and one-shot checks. */
export function createVidsVideoQueueHandler(input: {
  repositories: ExtensionRepositories;
  alarms: Pick<typeof chrome.alarms, "create" | "clear">;
  attach: (batchId: string, itemId: string, fromQueue: true) => Promise<{ status: string; reason?: string }>;
  getAttachment: (batchId: string, itemId: string) => Promise<{ status: string; reason?: string }>;
  generate: (batchId: string, itemId: string, fromQueue: true) => Promise<{ status: string; reason?: string; operation?: unknown }>;
  getGeneration: (batchId: string, itemId: string) => Promise<{ status: string; reason?: string; operation?: unknown }>;
  transitionFromPrevious: (batchId: string, previousItemId: string, inspectOnly?: boolean, nextItemId?: string, checkpointedOwnership?: boolean, phase?: "inspect" | "inspect_clean" | "remove_reference" | "clear_prompt" | "verify_empty", traceContext?: { triggerSource: "automatic_start" | "automatic_alarm" | "manual_resume" | "visibility_wakeup" | "unknown"; elapsedSinceReceiptToFirstReadMs: number; readinessDeadlineAt?: number; priorTrace?: VidsCleanupDiagnostics["handoffTrace"] }) => Promise<{ status: "ready" | "blocked"; reason?: string; diagnostics?: unknown }>;
  revalidate?: () => Promise<unknown>;
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

  const settleRunFailure = async (queueId: string, triggerSource: NonNullable<VidsCleanupDiagnostics["handoffTrace"]>["triggerSource"], scheduledAt: number | null, stage: string, startedAt: number) => {
    let outcome = "queue_unavailable";
    try {
      const queue = await input.repositories.getVidsVideoQueue(queueId);
      if (!queue || ["paused", "stopped", "blocked", "all_sent"].includes(queue.state)) {
        outcome = queue?.state ?? "queue_unavailable";
        return queue;
      }
      const active = queue.items.find((item) => ["transitioning", "attaching", "entering_prompt", "checking_generate", "sending"].includes(item.state));
      if (!active) {
        const paused = await save(queue, { state: "paused", pauseReason: "vids_queue_worker_run_failed", nextActionAt: null });
        await schedule(paused);
        outcome = "paused_review";
        return paused;
      }
      const generation = await input.getGeneration(queue.preparedBatchId, active.itemId);
      const operation = VidsVideoGenerationOperationSchema.safeParse(generation.operation);
      const prepared = PreparedVideoBatchRecordSchema.safeParse(await input.repositories.getPreparedVideoBatchById(queue.preparedBatchId));
      const preparedItem = prepared.success ? prepared.data.items[active.order] : undefined;
      const executionTabId = queue.executionDocumentRebind?.toTabId ?? prepared.data?.target.tabId;
      const executionDocumentId = queue.executionDocumentRebind?.toDocumentId ?? prepared.data?.target.documentId;
      const exactDispatch = generation.status === "dispatched" && operation.success && prepared.success && preparedItem && operation.data.preparedBatchId === queue.preparedBatchId && operation.data.workspaceId === prepared.data.workspaceId && operation.data.itemId === active.itemId && operation.data.canonicalShotId === active.shotId && operation.data.promptHash === active.promptHash && operation.data.referenceId === active.referenceId && operation.data.referenceSha256 === active.referenceSha256 && operation.data.tabId === executionTabId && operation.data.canonicalTarget === prepared.data.target.canonicalTarget && operation.data.documentId === executionDocumentId && operation.data.activationAttempted === true && operation.data.activationCount === 1 && operation.data.dispatchedAt !== undefined;
      if (exactDispatch && operation.success) {
        const storedAt = operation.data.dispatchedAt!;
        const items = queue.items.map((item) => item.itemId === active.itemId ? { ...item, state: "sent" as const, attemptId: operation.data.attemptId, dispatchReceipt: { attemptId: operation.data.attemptId, storedAt } } : item);
        const allSent = items.every((item) => item.state === "sent");
        const recovered = await save(queue, { items, state: allSent ? "all_sent" : "cooldown", lastDispatchAt: storedAt, cooldownDeadlineAt: allSent ? null : storedAt + VIDS_VIDEO_DISPATCH_GAP_MS, readinessStartedAt: null, readinessDeadlineAt: null, nextActionAt: allSent ? null : storedAt + VIDS_VIDEO_DISPATCH_GAP_MS, pauseReason: undefined });
        await schedule(recovered);
        outcome = "dispatch_receipt_preserved";
        return recovered;
      }
      const attachment = await input.getAttachment(queue.preparedBatchId, active.itemId);
      const uncertain = ["uncertain", "dispatch_intent", "dispatched", "already_dispatched"].includes(generation.status) || ["uncertain", "action_intent"].includes(attachment.status);
      const reason = uncertain ? "vids_queue_worker_outcome_uncertain" : "vids_queue_worker_run_failed";
      const failed = await save(queue, { state: uncertain ? "blocked" : "paused", items: queue.items.map((item) => item.itemId === active.itemId ? { ...item, state: uncertain ? "uncertain" as const : "blocked" as const, reason } : item), pauseReason: reason, nextActionAt: null });
      await schedule(failed);
      outcome = uncertain ? "blocked_uncertain" : "paused_review";
      return failed;
    } catch {
      outcome = "persist_failed";
      return undefined;
    } finally {
      console.warn("[vids-video-queue] run-failure", { trigger: triggerSource ?? "unknown", scheduledAt, stage: /^[a-z_]{1,32}$/.test(stage) ? stage : "unknown", elapsedMs: Math.min(60_000, Math.max(0, now() - startedAt)), persistedOutcome: outcome });
    }
  };

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

  async function run(queueId: string, triggerSource: NonNullable<VidsCleanupDiagnostics["handoffTrace"]>["triggerSource"] = "unknown"): Promise<VidsVideoQueueRecord | undefined> {
    const startedAt = now();
    let stage = "queue_read";
    let scheduledAt: number | null = null;
    return runtime.serialize(queueId, async () => {
      let queue = await input.repositories.getVidsVideoQueue(queueId);
      if (!queue || ["paused", "stopped", "blocked", "all_sent"].includes(queue.state)) return queue;
      scheduledAt = queue.nextActionAt;
      stage = "prepared_validation";
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
      const next = queue.items.find((item) => item.state === "pending" || item.state === "transitioning" || item.state === "checking_generate" || item.state === "attaching" || item.state === "entering_prompt" || item.state === "sending");
      if (!next) {
        queue = await save(queue, { state: "all_sent", nextActionAt: null, readinessStartedAt: null, readinessDeadlineAt: null, pauseReason: undefined });
        await schedule(queue); return queue;
      }
      const nowAt = now();
      stage = "cooldown_check";
      if (queue.lastDispatchAt !== null && nowAt < queue.lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS) {
        queue = await save(queue, { state: "cooldown", cooldownDeadlineAt: queue.lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS, nextActionAt: queue.lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS, readinessDeadlineAt: null, readinessStartedAt: null });
        await schedule(queue); return queue;
      }
      let cleanComposerVerified = false;
      const waitForVidsTab = async (result: { diagnostics?: unknown }, elapsedMs: number, checkpointRead: VidsCleanupDiagnostics["checkpointRead"] = "absent", checkpointWrite: VidsCleanupDiagnostics["checkpointWrite"] = "not_attempted") => {
        const latest = await input.repositories.getVidsVideoQueue(queueId) ?? queue!;
        if (latest.state === "paused" || latest.state === "stopped" || latest.runId !== queue!.runId) return latest;
        const diagnostics = boundedCleanupDiagnostics(result.diagnostics, checkpointRead, checkpointWrite, triggerSource, elapsedMs);
        const items = latest.items.map((item) => item.itemId === next.itemId ? { ...item, cleanupDiagnostics: diagnostics } : item);
        const waiting = await save(latest, { state: "waiting_for_tab", items, pauseReason: "vids_waiting_for_tab", nextActionAt: null });
        await schedule(waiting);
        return waiting;
      };
      if (queue.executionDocumentRebind && next.order > 0 && queue.items[next.order - 1]?.state === "sent" && (next.state === "pending" || next.state === "transitioning")) {
        stage = "composer_readiness";
        const previous = queue.items[next.order - 1]!;
        const elapsedSinceReceiptToFirstReadMs = previous.dispatchReceipt ? Math.max(0, now() - previous.dispatchReceipt.storedAt) : 0;
        let priorHandoffTrace: VidsCleanupDiagnostics["handoffTrace"];
        let composerReadinessDeadlineAt: number | undefined;
        const transition = async (inspectOnly: boolean, checkpointedOwnership: boolean, phase: "inspect" | "inspect_clean" | "remove_reference" | "clear_prompt" | "verify_empty") => {
          const result = await input.transitionFromPrevious(queue!.preparedBatchId, previous.itemId, inspectOnly, next.itemId, checkpointedOwnership, phase, { triggerSource, elapsedSinceReceiptToFirstReadMs, readinessDeadlineAt: composerReadinessDeadlineAt ??= now() + 30_000, ...(priorHandoffTrace ? { priorTrace: priorHandoffTrace } : {}) });
          const raw = result.diagnostics && typeof result.diagnostics === "object" ? result.diagnostics as Record<string, unknown> : undefined;
          const trace = raw?.handoffTrace;
          if (trace && typeof trace === "object") priorHandoffTrace = trace as VidsCleanupDiagnostics["handoffTrace"];
          return result;
        };
        const generation = await input.getGeneration(queue.preparedBatchId, next.itemId);
        const attachment = await input.getAttachment(queue.preparedBatchId, next.itemId);
        if (generation.status !== "not_started") throw new Error("vids_generation_attempt_requires_review");
        if (attachment.status !== "not_started") throw new Error("vids_attachment_attempt_requires_review");
        let clean = await transition(true, false, "inspect_clean");
        const settledEmptyComposer = clean.status === "ready";
        if (clean.status !== "ready" && clean.reason === "vids_refreshed_composer_not_clean") {
          // Populated composers may still be the exact prior pair. Establish fresh
          // ownership on the rebound document before allowing cleanup below.
          clean = await transition(true, false, "inspect");
          if (clean.status === "ready") {
            const latest = await input.repositories.getVidsVideoQueue(queueId) ?? queue;
            const updated = latest.items.map((item) => item.itemId === next.itemId ? { ...item, transitionCheckpoint: undefined, cleanComposerRecovery: undefined } : item);
            queue = await save(latest, { items: updated });
          }
        }
        if (clean.status !== "ready") {
          if (clean.reason === "vids_composer_waiting_for_tab") return waitForVidsTab(clean, elapsedSinceReceiptToFirstReadMs, next.transitionCheckpoint ? "valid" : "absent", "not_attempted");
          const latest = await input.repositories.getVidsVideoQueue(queueId) ?? queue;
          const reason = clean.reason ?? "vids_refreshed_composer_not_clean";
          const diagnostics = boundedCleanupDiagnostics(clean.diagnostics, next.transitionCheckpoint ? "valid" : "absent", "not_attempted", triggerSource, elapsedSinceReceiptToFirstReadMs);
          const items = latest.items.map((item) => item.itemId === next.itemId ? { ...item, state: "blocked" as const, reason, cleanupDiagnostics: diagnostics } : item);
          const failed = await save(latest, { state: "paused", items, pauseReason: reason, nextActionAt: null }); await schedule(failed); return failed;
        }
        if (settledEmptyComposer) {
          const currentQueue = queue!;
          const latest = await input.repositories.getVidsVideoQueue(queueId) ?? currentQueue;
          if (latest.state === "paused" || latest.state === "stopped" || latest.runId !== currentQueue.runId) return latest;
          const rebound = currentQueue.executionDocumentRebind!;
          const updated = latest.items.map((item) => item.itemId === next.itemId ? { ...item, cleanComposerRecovery: { tabId: rebound.toTabId ?? prepared.data.target.tabId, documentId: rebound.toDocumentId, canonicalTarget: rebound.canonicalTarget, referenceId: item.referenceId, referenceSha256: item.referenceSha256, promptHash: item.promptHash, verifiedAt: now() }, transitionCheckpoint: undefined } : item);
          queue = await save(latest, { items: updated });
          cleanComposerVerified = true;
        }
      }
      if (!cleanComposerVerified && next.order > 0 && queue.items[next.order - 1]?.state === "sent" && (next.state === "pending" || next.state === "transitioning")) {
        const previous = queue.items[next.order - 1]!;
        const elapsedSinceReceiptToFirstReadMs = previous.dispatchReceipt ? Math.max(0, now() - previous.dispatchReceipt.storedAt) : 0;
        let priorHandoffTrace: VidsCleanupDiagnostics["handoffTrace"];
        let composerReadinessDeadlineAt: number | undefined;
        const transition = async (inspectOnly: boolean, checkpointedOwnership: boolean, phase: "inspect" | "inspect_clean" | "remove_reference" | "clear_prompt" | "verify_empty") => {
          const result = await input.transitionFromPrevious(queue!.preparedBatchId, previous.itemId, inspectOnly, next.itemId, checkpointedOwnership, phase, { triggerSource, elapsedSinceReceiptToFirstReadMs, readinessDeadlineAt: composerReadinessDeadlineAt ??= now() + 30_000, ...(priorHandoffTrace ? { priorTrace: priorHandoffTrace } : {}) });
          const raw = result.diagnostics && typeof result.diagnostics === "object" ? result.diagnostics as Record<string, unknown> : undefined;
          if (raw?.handoffTrace && typeof raw.handoffTrace === "object") priorHandoffTrace = raw.handoffTrace as VidsCleanupDiagnostics["handoffTrace"];
          return result;
        };
        const currentAttachment = next.state === "transitioning" ? await input.getAttachment(queue.preparedBatchId, next.itemId) : undefined;
        const cleanupAlreadyPassed = next.state === "transitioning" && currentAttachment?.status === "attached";
        if (next.state === "pending") {
          const transitioning = queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: "transitioning" as const } : item);
          queue = await save(queue, { state: "preparing", items: transitioning, nextActionAt: null });
        }
        const transitionRunId = queue.runId;
        const executionTabId = queue.executionDocumentRebind?.toTabId ?? prepared.data.target.tabId;
        const executionDocumentId = queue.executionDocumentRebind?.toDocumentId ?? prepared.data.target.documentId;
        const isBoundCheckpoint = (candidate: unknown) => {
          const parsed = VidsVideoTransitionCheckpointSchema.safeParse(candidate);
          return parsed.success && parsed.data.stage !== undefined && parsed.data.previousItemId === previous.itemId && parsed.data.previousAttemptId === previous.dispatchReceipt?.attemptId && parsed.data.previousReferenceId === previous.referenceId && parsed.data.previousReferenceSha256 === previous.referenceSha256 && parsed.data.previousPromptHash === previous.promptHash && parsed.data.nextItemId === next.itemId && parsed.data.nextReferenceId === next.referenceId && parsed.data.nextReferenceSha256 === next.referenceSha256 && parsed.data.nextPromptHash === next.promptHash && parsed.data.tabId === executionTabId && parsed.data.canonicalTarget === prepared.data.target.canonicalTarget && parsed.data.documentId === executionDocumentId;
        };
        const itemNow = queue.items.find((item) => item.itemId === next.itemId)!;
        let checkpoint = itemNow.transitionCheckpoint;
        let checkpointRead: VidsCleanupDiagnostics["checkpointRead"] = checkpoint ? "valid" : "absent";
        let checkpointWrite: VidsCleanupDiagnostics["checkpointWrite"] = checkpoint ? "persisted" : "not_attempted";
        if (checkpoint && !isBoundCheckpoint(checkpoint)) {
          const reason = "vids_cleanup_checkpoint_binding_changed";
          checkpointRead = "stale";
          const diagnostics = boundedCleanupDiagnostics({ stage: "binding" }, checkpointRead, checkpointWrite);
          const items = queue.items.map((item) => item.itemId === next.itemId ? { ...item, state: "blocked" as const, reason, cleanupDiagnostics: diagnostics } : item);
          queue = await save(queue, { state: "paused", items, pauseReason: reason, nextActionAt: null }); await schedule(queue); return queue;
        }
        if (!checkpoint && !cleanupAlreadyPassed) {
          let inspected = await transition(true, false, "inspect");
          // Expand is allowed only through the unique scoped control. Its result
          // requests a fresh read; it never authorizes cleanup by itself.
          if (inspected.reason === "vids_composer_expanded_revalidate") {
            inspected = await transition(true, false, "inspect");
          }
          let alreadyClean = false;
          if (inspected.reason === "vids_cleanup_checkpoint_required") {
            const clean = await transition(true, false, "inspect_clean");
            if (clean.status === "ready") { inspected = clean; alreadyClean = true; }
          }
          if (inspected.reason === "vids_composer_waiting_for_tab") return waitForVidsTab(inspected, elapsedSinceReceiptToFirstReadMs, checkpointRead, checkpointWrite);
          let latest = await input.repositories.getVidsVideoQueue(queueId) ?? queue;
          if (latest.state === "paused" || latest.state === "stopped" || latest.runId !== transitionRunId || latest.items.find((item) => item.itemId === next.itemId)?.state !== "transitioning") return latest;
          if (inspected.status !== "ready") {
            const reason = inspected.reason ?? "vids_composer_transition_failed";
            const diagnostics = boundedCleanupDiagnostics(inspected.diagnostics, checkpointRead, checkpointWrite, triggerSource, elapsedSinceReceiptToFirstReadMs);
            const items = latest.items.map((item) => item.itemId === next.itemId ? { ...item, state: "blocked" as const, reason, cleanupDiagnostics: diagnostics } : item);
            latest = await save(latest, { state: "paused", items, pauseReason: reason, nextActionAt: null }); await schedule(latest); return latest;
          }
          const generation = await input.getGeneration(queue.preparedBatchId, previous.itemId);
          const operation = VidsVideoGenerationOperationSchema.safeParse(generation.operation);
          const matchesActiveBinding = operation.success && operation.data.tabId === executionTabId && operation.data.documentId === executionDocumentId;
          const matchesHistoricalBinding = operation.success && queue.executionDocumentRebind !== undefined && operation.data.tabId === (queue.executionDocumentRebind.fromTabId ?? prepared.data.target.tabId) && operation.data.documentId === queue.executionDocumentRebind.fromDocumentId;
          if (!operation.success || !previous.dispatchReceipt || operation.data.preparedBatchId !== queue.preparedBatchId || operation.data.workspaceId !== prepared.data.workspaceId || operation.data.itemId !== previous.itemId || operation.data.canonicalShotId !== previous.shotId || operation.data.promptHash !== previous.promptHash || operation.data.referenceId !== previous.referenceId || operation.data.referenceSha256 !== previous.referenceSha256 || operation.data.attemptId !== previous.dispatchReceipt.attemptId || operation.data.dispatchedAt !== previous.dispatchReceipt.storedAt || operation.data.activationAttempted !== true || operation.data.activationCount !== 1 || (!matchesActiveBinding && !matchesHistoricalBinding) || operation.data.canonicalTarget !== prepared.data.target.canonicalTarget) return latest;
          checkpoint = { stage: cleanupAlreadyPassed || alreadyClean ? "prompt_cleared" : "ownership_verified", previousItemId: previous.itemId, previousAttemptId: previous.dispatchReceipt!.attemptId, previousReferenceId: previous.referenceId, previousReferenceSha256: previous.referenceSha256, previousPromptHash: previous.promptHash, nextItemId: next.itemId, nextReferenceId: next.referenceId, nextReferenceSha256: next.referenceSha256, nextPromptHash: next.promptHash, tabId: executionTabId, canonicalTarget: prepared.data.target.canonicalTarget, documentId: executionDocumentId!, verifiedAt: now() };
          const items = latest.items.map((item) => item.itemId === next.itemId ? { ...item, transitionCheckpoint: checkpoint } : item);
          queue = await save(latest, { state: "preparing", items, nextActionAt: null });
          checkpointWrite = "persisted";
        }
        const failCleanup = async (result: { reason?: string; diagnostics?: unknown }) => {
          if (result.reason === "vids_composer_waiting_for_tab") return waitForVidsTab(result, elapsedSinceReceiptToFirstReadMs, checkpointRead, checkpointWrite);
          const fallbackQueue: VidsVideoQueueRecord = queue!;
          const latest = await input.repositories.getVidsVideoQueue(queueId) ?? fallbackQueue;
          if (latest.state === "paused" || latest.state === "stopped" || latest.runId !== transitionRunId) return latest;
          const reason = result.reason ?? "vids_composer_transition_failed";
          const bounded = boundedCleanupDiagnostics(result.diagnostics, checkpointRead, checkpointWrite, triggerSource, elapsedSinceReceiptToFirstReadMs);
          const items = latest.items.map((item) => item.itemId === next.itemId ? { ...item, state: "blocked" as const, reason, cleanupDiagnostics: bounded } : item);
          const failed = await save(latest, { state: "paused", items, pauseReason: reason, nextActionAt: null }); await schedule(failed); return failed;
        };
        // Persist the ownership proof before the first provider mutation.
        if (checkpoint!.stage === "ownership_verified") {
          const before = await input.repositories.getVidsVideoQueue(queueId) ?? queue;
          if (before.state === "paused" || before.state === "stopped" || before.runId !== transitionRunId || before.items.find((item) => item.itemId === next.itemId)?.state !== "transitioning") return before;
          const removed = await transition(false, true, "remove_reference");
          if (removed.status !== "ready") return failCleanup(removed);
          const latest = await input.repositories.getVidsVideoQueue(queueId) ?? queue;
          if (latest.state === "paused" || latest.state === "stopped" || latest.runId !== transitionRunId) return latest;
          checkpoint = { ...checkpoint!, stage: "image_removed" };
          queue = await save(latest, { items: latest.items.map((item) => item.itemId === next.itemId ? { ...item, transitionCheckpoint: checkpoint } : item) });
          checkpointWrite = "persisted";
        }
        if (checkpoint!.stage === "image_removed") {
          const before = await input.repositories.getVidsVideoQueue(queueId) ?? queue;
          if (before.state === "paused" || before.state === "stopped" || before.runId !== transitionRunId || before.items.find((item) => item.itemId === next.itemId)?.state !== "transitioning") return before;
          const cleared = await transition(false, true, "clear_prompt");
          if (cleared.status !== "ready") return failCleanup(cleared);
          const latest = await input.repositories.getVidsVideoQueue(queueId) ?? queue;
          if (latest.state === "paused" || latest.state === "stopped" || latest.runId !== transitionRunId) return latest;
          checkpoint = { ...checkpoint!, stage: "prompt_cleared" };
          queue = await save(latest, { items: latest.items.map((item) => item.itemId === next.itemId ? { ...item, transitionCheckpoint: checkpoint, cleanupDiagnostics: undefined } : item) });
          checkpointWrite = "persisted";
        } else if (checkpoint!.stage === "prompt_cleared") {
          const verified = await transition(false, true, "verify_empty");
          if (verified.status !== "ready") return failCleanup(verified);
        }
        queue = await input.repositories.getVidsVideoQueue(queueId) ?? queue;
        if (queue.state === "paused" || queue.state === "stopped") return queue;
      }
      if (next.state === "pending" || next.state === "attaching" || next.state === "transitioning") {
        stage = "attachment";
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
      stage = "generate_result_persist";
      const operation = VidsVideoGenerationOperationSchema.safeParse(result.operation);
      if ((result.status === "dispatched" || result.status === "already_dispatched") && operation.success && operation.data.status === "dispatched" && operation.data.preparedBatchId === queue.preparedBatchId && operation.data.workspaceId === prepared.data.workspaceId && operation.data.itemId === next.itemId && operation.data.canonicalShotId === currentItem.shotId && operation.data.promptHash === currentItem.promptHash && operation.data.referenceId === currentItem.referenceId && operation.data.referenceSha256 === currentItem.referenceSha256 && operation.data.tabId === (queue.executionDocumentRebind?.toTabId ?? prepared.data.target.tabId) && operation.data.canonicalTarget === prepared.data.target.canonicalTarget && operation.data.documentId === (queue.executionDocumentRebind?.toDocumentId ?? prepared.data.target.documentId) && operation.data.activationAttempted === true && operation.data.activationCount === 1 && operation.data.dispatchedAt !== undefined) {
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
    }).catch(() => settleRunFailure(queueId, triggerSource, scheduledAt, stage, startedAt));
  }

  return {
    get: async (preparedBatchId: string) => input.repositories.getVidsVideoQueue(queueIdFor(preparedBatchId)),
    inspectTransition: async (preparedBatchId: string, itemId: string) => {
      const queue = await input.repositories.getVidsVideoQueue(queueIdFor(preparedBatchId));
      const current = queue?.items.find((item) => item.itemId === itemId);
      const inspectableReasons = new Set(["vids_previous_composer_content_conflict", "vids_previous_reference_identity_mismatch", "vids_previous_prompt_hash_mismatch"]);
      if (!queue || queue.state !== "paused" || !current || current.state !== "blocked" || !inspectableReasons.has(current.reason ?? "") || current.order < 1)
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
      return input.transitionFromPrevious(preparedBatchId, previous.itemId, true, itemId, false, "inspect");
    },
    start: async (preparedBatchId: string) => {
      const id = queueIdFor(preparedBatchId);
      let queue = await input.repositories.getVidsVideoQueue(id);
      if (!queue) queue = await adoptExisting(preparedBatchId);
      if (queue.state === "ready" || queue.state === "cooldown" || queue.state === "checking_generate") void run(id, "automatic_start").catch(() => undefined);
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
    resume: async (preparedBatchId: string, expectedRevision: number, confirmSameAccount = false) => {
      const queue = await input.repositories.getVidsVideoQueue(queueIdFor(preparedBatchId));
      if (!queue || queue.revision !== expectedRevision || queue.state !== "paused") throw new Error("vids_video_queue_revision_changed");
      const prepared = PreparedVideoBatchRecordSchema.safeParse(await input.repositories.getPreparedVideoBatchById(preparedBatchId));
      if (!prepared.success || prepared.data.destination !== "Vids") throw new Error("prepared_vids_batch_invalid");
      if (input.revalidate) {
        let verification: unknown;
        try { verification = await input.revalidate(); } catch { throw new Error("vids_resume_revalidation_unavailable"); }
        if (verification && typeof verification === "object" && "ok" in verification && verification.ok === false) {
          const reason = "reason" in verification && typeof verification.reason === "string" && /^[a-z0-9_]{1,48}$/.test(verification.reason) ? verification.reason : "failed";
          throw new Error(`vids_resume_revalidation_${reason}`);
        }
      }
      const selected = await input.repositories.getSelectedTarget("Vids");
      const binding = selected?.verificationBinding;
      const priorTabId = queue.executionDocumentRebind?.toTabId ?? prepared.data.target.tabId;
      const priorDocumentId = queue.executionDocumentRebind?.toDocumentId ?? prepared.data.target.documentId;
      if (!selected && priorDocumentId === prepared.data.target.documentId && !input.revalidate) {
        // Legacy same-document queue fixtures and records may not yet have a live
        // selected-target snapshot. They remain bound to their original document.
      } else {
        if (!selected) throw new Error("vids_resume_selected_target_missing");
        if (selected.provider !== "Vids") throw new Error("vids_resume_provider_mismatch");
        if (selected.canonicalTarget !== prepared.data.target.canonicalTarget) throw new Error("vids_resume_canonical_target_mismatch");
        if (selected.verification !== "verified") throw new Error("vids_resume_verification_not_verified");
        if (selected.connectionState !== "verified") throw new Error("vids_resume_connection_state_not_verified");
        if (!binding) throw new Error("vids_resume_verification_binding_missing");
        if (binding.provider !== "Vids") throw new Error("vids_resume_binding_provider_mismatch");
        if (binding.tabId !== selected.tabId) throw new Error("vids_resume_binding_tab_id_mismatch");
        if (binding.canonicalTarget !== selected.canonicalTarget) throw new Error("vids_resume_binding_canonical_target_mismatch");
        if (binding.projectId !== prepared.data.target.projectId) throw new Error("vids_resume_binding_project_id_mismatch");
        if (!binding.documentId) throw new Error("vids_resume_binding_document_id_missing");
        if (binding.frameId !== 0) throw new Error("vids_resume_binding_not_top_frame");
        if (binding.extensionBuildId !== BUILD_ID || binding.connectorBuildId !== BUILD_ID) throw new Error("vids_resume_binding_build_mismatch");
        if (binding.extensionProtocolVersion !== PROTOCOL_VERSION || binding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION) throw new Error("vids_resume_binding_protocol_mismatch");
        if (binding.capability !== CONNECTION_CAPABILITY || !binding.documentToken) throw new Error("vids_resume_binding_capability_or_token_invalid");
      }
      const rebind = Boolean(binding && (binding.tabId !== priorTabId || binding.documentId !== priorDocumentId));
      if (rebind && !confirmSameAccount) throw new Error("vids_same_account_confirmation_required");
      const retryablePreIntentReasons = new Set(["generate_readiness_timeout", "vids_composer_readiness_timeout", "vids_composer_collapsed_or_changed", "vids_cleanup_checkpoint_required", "vids_previous_composer_content_conflict", "vids_previous_reference_identity_mismatch", "vids_previous_prompt_hash_mismatch", "vids_previous_prompt_clear_failed", "vids_previous_prompt_clear_unconfirmed", "vids_prompt_editor_rebind_failed", "vids_cleanup_completion_changed", "vids_empty_composer_controls_not_ready", "vids_target_changed_before_composer_transition", "vids_previous_item_dispatch_binding_unverified", "worker_restart_during_composer_transition", "worker_restart_before_generate"]);
      if (queue.items.some((item) => item.state === "uncertain" || (item.state === "blocked" && !retryablePreIntentReasons.has(item.reason ?? "")))) throw new Error("vids_video_queue_requires_review");
      const handoffRecoveryItems = queue.items.filter((candidate) => candidate.state === "blocked" && candidate.reason === "vids_previous_item_dispatch_binding_unverified");
      for (const item of handoffRecoveryItems) {
        const previous = queue.items[item.order - 1];
        const previousPrepared = prepared.data.items[item.order - 1];
        if (!previous || !previousPrepared || previous.state !== "sent" || !previous.dispatchReceipt || previous.attemptId !== previous.dispatchReceipt.attemptId || !binding || selected?.verification !== "verified" || selected.connectionState !== "verified")
          throw new Error("vids_previous_item_dispatch_binding_unverified");
        const pairKey = `${preparedBatchId}\u0000${previous.itemId}`;
        const generationId = `vids-generation:${await sha256Hex(pairKey)}`;
        const attachmentId = `vids:${await sha256Hex(pairKey)}`;
        const generation = VidsVideoGenerationOperationSchema.safeParse(await input.repositories.getVidsVideoGenerationOperation(generationId));
        const attachment = VidsVideoAttachmentOperationSchema.safeParse(await input.repositories.getVidsVideoAttachmentOperation(attachmentId));
        if (!generation.success || generation.data.status !== "dispatched" || generation.data.preparedBatchId !== preparedBatchId || generation.data.workspaceId !== prepared.data.workspaceId || generation.data.itemId !== previous.itemId || generation.data.canonicalShotId !== previousPrepared.canonicalShotId || generation.data.promptHash !== previous.promptHash || generation.data.referenceId !== previous.referenceId || generation.data.referenceSha256 !== previous.referenceSha256 || generation.data.attemptId !== previous.dispatchReceipt.attemptId || generation.data.dispatchedAt !== previous.dispatchReceipt.storedAt || generation.data.activationAttempted !== true || generation.data.activationCount !== 1 || generation.data.tabId !== binding.tabId || generation.data.documentId !== binding.documentId || generation.data.canonicalTarget !== prepared.data.target.canonicalTarget ||
          !attachment.success || attachment.data.status !== "attached" || attachment.data.preparedBatchId !== preparedBatchId || attachment.data.workspaceId !== prepared.data.workspaceId || attachment.data.itemId !== previous.itemId || attachment.data.shotId !== previousPrepared.canonicalShotId || attachment.data.referenceId !== previousPrepared.reference.referenceId || attachment.data.assignmentVersion !== previousPrepared.reference.assignmentVersion || attachment.data.referenceSha256 !== previousPrepared.reference.sha256 || attachment.data.tabId !== binding.tabId || attachment.data.documentId !== binding.documentId || attachment.data.canonicalTarget !== prepared.data.target.canonicalTarget || attachment.data.tabId !== generation.data.tabId || attachment.data.documentId !== generation.data.documentId || attachment.data.uploadEvidence?.exactBytesSha256 !== previousPrepared.reference.sha256 || attachment.data.uploadEvidence.byteSize !== previousPrepared.reference.byteSize || attachment.data.uploadEvidence.mimeType !== previousPrepared.reference.mimeType || attachment.data.uploadEvidence.previewWidth !== previousPrepared.reference.width || attachment.data.uploadEvidence.previewHeight !== previousPrepared.reference.height)
          throw new Error("vids_previous_item_dispatch_binding_unverified");
      }
      for (const item of queue.items.filter((candidate) => candidate.state === "blocked" && (candidate.reason === "vids_target_changed_before_composer_transition" || candidate.reason === "vids_previous_item_dispatch_binding_unverified" || ["vids_composer_readiness_timeout", "vids_cleanup_checkpoint_required", "vids_previous_composer_content_conflict", "vids_previous_reference_identity_mismatch", "vids_previous_prompt_hash_mismatch", "vids_previous_prompt_clear_failed", "vids_previous_prompt_clear_unconfirmed", "vids_prompt_editor_rebind_failed", "vids_cleanup_completion_changed", "vids_empty_composer_controls_not_ready", "worker_restart_during_composer_transition", "worker_restart_before_generate"].includes(candidate.reason ?? "")))) {
        const generation = await input.getGeneration(preparedBatchId, item.itemId);
        const itemKey = `${preparedBatchId}\u0000${item.itemId}`;
        const generationRecord = await input.repositories.getVidsVideoGenerationOperation(`vids-generation:${await sha256Hex(itemKey)}`);
        if (generation.status !== "not_started" || generationRecord) throw new Error("vids_generation_attempt_requires_review");
        const attachment = await input.getAttachment(preparedBatchId, item.itemId);
        const attachmentRecord = await input.repositories.getVidsVideoAttachmentOperation(`vids:${await sha256Hex(itemKey)}`);
        if (attachment.status !== "not_started" || attachmentRecord) throw new Error("vids_attachment_attempt_requires_review");
      }
      const resumedItems = queue.items.map((item) => item.state === "blocked" && retryablePreIntentReasons.has(item.reason ?? "") ? { ...item, state: "pending" as const, ...(["vids_composer_readiness_timeout", "vids_cleanup_checkpoint_required", "vids_target_changed_before_composer_transition", "vids_previous_item_dispatch_binding_unverified"].includes(item.reason ?? "") ? { resumeRecoveryEvidence: { priorReason: item.reason!, verifiedAt: now() } } : {}), reason: undefined } : item.reason === "worker_restart_before_generate" ? { ...item, reason: undefined } : item);
      const stillChecking = queue.items.some((item) => item.state === "checking_generate");
      const resumed = await save(queue, { ...(rebind ? { executionDocumentRebind: { fromTabId: queue.executionDocumentRebind?.fromTabId ?? prepared.data.target.tabId, toTabId: binding!.tabId, fromDocumentId: queue.executionDocumentRebind?.fromDocumentId ?? prepared.data.target.documentId!, toDocumentId: binding!.documentId, projectId: binding!.projectId, canonicalTarget: binding!.canonicalTarget, verifiedAt: binding!.verifiedAt, sameAccountConfirmedAt: now() } } : {}), state: stillChecking ? "checking_generate" : queue.lastDispatchAt !== null && now() < queue.lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS ? "cooldown" : "ready", items: resumedItems, nextActionAt: stillChecking ? Math.min(now() + CHROME_MIN_ALARM_DELAY_MS, queue.readinessDeadlineAt ?? now()) : queue.lastDispatchAt !== null ? Math.max(now(), queue.lastDispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS) : now(), pauseReason: undefined, readinessStartedAt: stillChecking ? queue.readinessStartedAt : null, readinessDeadlineAt: stillChecking ? queue.readinessDeadlineAt : null, runId: input.makeRunId?.() ?? crypto.randomUUID() });
      void run(resumed.queueId, "manual_resume").catch(() => undefined); return resumed;
    },
    onAlarm: (name: string) => { const id = runtime.queueIdFromAlarm(name); return id ? run(id, "automatic_alarm") : Promise.resolve(undefined); },
    onTargetVisible: async (tabId: number) => {
      const queues = await input.repositories.listVidsVideoQueues();
      for (const candidate of queues) {
        if (candidate.state !== "waiting_for_tab") continue;
        const prepared = PreparedVideoBatchRecordSchema.safeParse(await input.repositories.getPreparedVideoBatchById(candidate.preparedBatchId));
        if (!prepared.success) continue;
        const expectedTabId = candidate.executionDocumentRebind?.toTabId ?? prepared.data.target.tabId;
        if (expectedTabId === tabId) void run(candidate.queueId, "visibility_wakeup").catch(() => undefined);
      }
    },
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
          const generationUncertain = ["uncertain", "dispatch_intent", "blocked"].includes(generation.status);
          const attachment = await input.getAttachment(queue.preparedBatchId, item.itemId);
          const attachmentUncertain = ["uncertain", "action_intent"].includes(attachment.status);
          const safePreGenerate = generation.status === "not_started" && !attachmentUncertain && (item.state === "transitioning" && attachment.status === "not_started" || ["attaching", "entering_prompt", "checking_generate", "sending"].includes(item.state) && attachment.status === "attached");
          const uncertain = generationUncertain || attachmentUncertain;
          const uncertainReason = generationUncertain ? "worker_restart_generation_uncertain" : "worker_restart_attachment_uncertain";
          const recoveryReason = safePreGenerate ? "worker_restart_before_generate" : "worker_restart_review_required";
          const recoveredItems = queue.items.map((value) => value.itemId === item.itemId ? safePreGenerate ? { ...value, reason: recoveryReason } : { ...value, state: uncertain ? "uncertain" as const : "blocked" as const, reason: uncertain ? uncertainReason : recoveryReason } : value);
          const recovered = await save(queue, { items: recoveredItems, state: uncertain ? "blocked" : "paused", pauseReason: uncertain ? uncertainReason : recoveryReason, nextActionAt: null });
          await schedule(recovered); continue;
        }
        if (queue.state === "cooldown") await schedule(queue);
      }
    },
  };
}
