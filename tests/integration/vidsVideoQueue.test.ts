import { describe, expect, it, vi } from "vitest";
import { createVidsVideoQueueHandler, VIDS_VIDEO_QUEUE_ALARM_PREFIX } from "../../src/background/handlers/vidsVideoQueue";
import { VIDS_VIDEO_DISPATCH_GAP_MS, VIDS_VIDEO_READINESS_TIMEOUT_MS, type VidsCleanupDiagnostics } from "../../src/domain/jobs/vidsVideoQueue";
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
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { CONNECTION_CAPABILITY, CONNECTOR_PROTOCOL_VERSION } from "../../src/platforms/shared/contracts";
import type { SelectedTargetRecord } from "../../src/storage/db";
import { createConnectionLifecycleService } from "../../src/background/connectionLifecycle";
import { createVidsVideoGenerateHandler } from "../../src/background/handlers/vidsVideo";
import { providerTabFromUrl } from "../../src/platforms/shared/connection";
import type { ConnectionPort } from "../../src/platforms/shared/contracts";

const batchId = "prepared:vids:two-shots";
const fiveShotBatchId = "prepared:vids:prior-build-five-shots";
const refs = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const prompts = ["{\n  \"shot_id\": \"1\",\n  \"prompt_type\": \"video\",\n  \"description\": \"first\"\n}", "{\n  \"shot_id\": \"2\",\n  \"prompt_type\": \"video\",\n  \"description\": \"second\",\n  \"long\": \"" + "x".repeat(3000) + "\"\n}"];
type TestTraceContext = { triggerSource?: "automatic_start" | "automatic_alarm" | "manual_resume" | "visibility_wakeup" | "unknown"; elapsedSinceReceiptToFirstReadMs?: number; readinessDeadlineAt?: number; priorTrace?: VidsCleanupDiagnostics["handoffTrace"] };

async function setup(options: { disabledAttempts?: number; uncertain?: boolean; blocked?: boolean; shotCount?: number; tabId?: number; revalidate?: () => Promise<unknown> } = {}) {
  const db = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(db);
  const preparedId = options.shotCount ? fiveShotBatchId : batchId;
  const shotPrompts = options.shotCount ? Array.from({ length: options.shotCount }, (_, index) => JSON.stringify({ shot_id: String(index + 1), prompt_type: "video", description: `saved shot ${index + 1}`, lines: [`exact ${index + 1}`, "second line"] }, null, 2)) : prompts;
  const shotRefs = options.shotCount ? Array.from({ length: options.shotCount }, (_, index) => `${String(index + 1).padStart(8, "0")}-1111-4111-8111-${String(index + 1).padStart(12, "0")}`) : refs;
  const hashes = await Promise.all(shotPrompts.map(sha256Hex));
  const videoSourceText = shotPrompts.map((body, index) => `${index + 1}: ${body}`).join("\n\n");
  const videoSourceHash = await sha256Hex(videoSourceText);
  const batch: PreparedVideoBatchRecord = {
    id: preparedId, requestId: "33333333-3333-4333-8333-333333333333", workspaceId: "workspace", preparedAt: 1,
    videoBatchId: "video", videoSourceHash, videoSourceText, imageSourceBatchId: "images", imageSourceBatchHash: "b".repeat(64), destination: "Vids",
    target: { provider: "Vids", tabId: options.tabId ?? 9, canonicalTarget: "https://docs.google.com/videos/d/project/edit", projectId: "project", documentId: "doc", verification: "verified", verifiedAt: 1 },
    manualSettingsDeclaration: { confirmationId: "confirmation", confirmedAt: 1, destination: "Vids", declaredDurationSeconds: 8, tabId: options.tabId ?? 9, canonicalTarget: "https://docs.google.com/videos/d/project/edit", projectId: "project", documentId: "doc" },
    status: "prepared", itemCount: 2,
    items: shotPrompts.map((rawJsonBody, order) => ({ itemId: `item-${order + 1}`, order, shotId: String(order + 1), canonicalShotId: String(order + 1), rawJsonBody, contentHash: hashes[order]!, sourceSpan: { start: 0, end: rawJsonBody.length }, reference: { referenceId: shotRefs[order]!, assignmentVersion: 1, sha256: String(order + 1).repeat(64), mimeType: "image/png", byteSize: 4, width: 1, height: 1, capturedAt: 1 } })), createdAt: 1, updatedAt: 1,
  };
  await db.preparedVideoBatches.put(batch);
  let at = 1_000;
  const attach = vi.fn(async (preparedBatchId: string, _itemId: string, fromQueue?: true) => {
    if (fromQueue) {
      const activeQueue = await repositories.getVidsVideoQueue(`vids-video:${preparedBatchId}`);
      const selectedTarget = await repositories.getSelectedTarget("Vids");
      const binding = selectedTarget?.verificationBinding;
      const rebind = activeQueue?.executionDocumentRebind;
      if (rebind && (!selectedTarget || selectedTarget.tabId !== (rebind.toTabId ?? batch.target.tabId) || selectedTarget.canonicalTarget !== rebind.canonicalTarget || binding?.tabId !== (rebind.toTabId ?? batch.target.tabId) || binding.documentId !== rebind.toDocumentId)) return { status: "blocked", reason: "vids_target_or_confirmation_mismatch" };
    }
    return { status: "attached" };
  });
  const getAttachment = vi.fn(async () => ({ status: "not_started" }));
  let generationCalls = 0;
  const operations = new Map<string, VidsVideoGenerationOperation>();
  const getGeneration = vi.fn(async (_batch: string, itemId: string) => { const op = operations.get(itemId); return op ? { status: op.status, operation: op } : { status: "not_started" }; });
  const generate = vi.fn(async (_batch: string, itemId: string) => {
    generationCalls += 1;
    if (generationCalls <= (options.disabledAttempts ?? 0)) return { status: "blocked", reason: "generate_disabled" };
    if (options.blocked) return { status: "blocked", reason: "exact_prompt_readback_failed" };
    const item = batch.items.find((candidate) => candidate.itemId === itemId)!;
    const activeQueue = await repositories.getVidsVideoQueue(`vids-video:${batch.id}`);
    const op: VidsVideoGenerationOperation = { id: `gen:${itemId}`, preparedBatchId: batch.id, workspaceId: batch.workspaceId, itemId, canonicalShotId: item.canonicalShotId, promptHash: item.contentHash, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, preIntentReferenceProofSource: "preview_blob_sha256", activationReferenceProofSource: "preview_blob_sha256", tabId: activeQueue?.executionDocumentRebind?.toTabId ?? batch.target.tabId, canonicalTarget: batch.target.canonicalTarget, documentId: activeQueue?.executionDocumentRebind?.toDocumentId ?? "doc", attemptId: crypto.randomUUID(), status: options.uncertain ? "uncertain" : "dispatched", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: item.contentHash, actualSha256: item.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: at }, activationAttempted: true, activationCount: 1, ...(!options.uncertain ? { dispatchedAt: at } : {}), createdAt: at, updatedAt: at };
    operations.set(itemId, op);
    return { status: options.uncertain ? "uncertain" : "dispatched", operation: op };
  });
  const alarms = { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) };
  const transitionFromPrevious = vi.fn(async (...args: [string, string, boolean?, string?, boolean?, string?, TestTraceContext?]) => { void args; return { status: "ready" as const }; });
  const handler = createVidsVideoQueueHandler({ repositories, alarms, attach, getAttachment, generate, getGeneration, transitionFromPrevious, revalidate: options.revalidate, now: () => at, makeRunId: () => "run-1" });
  const flush = async () => new Promise((resolve) => setTimeout(resolve, 0));
  const waitForQueue = async (queueId: string, predicate: (queue: VidsVideoQueueRecord | undefined) => boolean) => {
    let queue = await repositories.getVidsVideoQueue(queueId);
    for (let attempt = 0; attempt < 30 && !predicate(queue); attempt += 1) {
      await flush();
      queue = await repositories.getVidsVideoQueue(queueId);
    }
    return queue;
  };
  return { db, batch, repositories, handler, attach, generate, getGeneration, getAttachment, alarms, transitionFromPrevious, now: () => at, advance: (ms: number) => { at += ms; }, flush, waitForQueue, operations };
}

function verifiedVidsTarget(documentId: string, canonicalTarget = "https://docs.google.com/videos/d/project/edit", tabId = 9): SelectedTargetRecord {
  return { provider: "Vids", tabId, canonicalTarget, verification: "verified", connectionState: "verified", updatedAt: 10,
    verificationBinding: { provider: "Vids", tabId, canonicalTarget, projectId: "project", frameId: 0, documentId, documentToken: `token-${documentId}`, extensionBuildId: BUILD_ID, extensionProtocolVersion: PROTOCOL_VERSION, connectorBuildId: BUILD_ID, connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION, capability: CONNECTION_CAPABILITY, verifiedAt: 100 } };
}

async function invokeQueueResume(f: Awaited<ReturnType<typeof setup>>, preparedId: string, revision: number, confirmSameAccount?: boolean, revalidateConnection?: (provider: "Flow" | "Vids", enableReconnect?: boolean) => Promise<unknown>) {
  const preferences = new ChromePreferenceRepository({ get: async () => ({}), set: async () => undefined });
  const listener = createConnectionMessageListener("vids-resume-test", { repositories: f.repositories, preferences,
    vidsVideoQueue: f.handler,
    revalidateConnection,
    flowVideoQueue: { get: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), recheckAndResume: vi.fn(), reconcilePreAddFailure: vi.fn() },
  });
  const request = makeRequest("vids.videoQueue.resume", { preparedBatchId: preparedId, expectedRevision: revision, ...(confirmSameAccount === undefined ? {} : { confirmSameAccount }) }, "resume-prior-build");
  return await new Promise<Record<string, unknown>>((resolve) => listener(JSON.parse(JSON.stringify(request)), { id: "vids-resume-test", url: "chrome-extension://vids-resume-test/index.html" }, (response) => resolve(response as unknown as Record<string, unknown>)));
}

async function invokeConnectionsRevalidate(f: Awaited<ReturnType<typeof setup>>, revalidateConnection: (provider: "Flow" | "Vids", enableReconnect?: boolean) => Promise<unknown>) {
  const preferences = new ChromePreferenceRepository({ get: async () => ({}), set: async () => undefined });
  const listener = createConnectionMessageListener("vids-resume-test", { repositories: f.repositories, preferences, revalidateConnection,
    vidsVideoQueue: f.handler,
    flowVideoQueue: { get: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), recheckAndResume: vi.fn(), reconcilePreAddFailure: vi.fn() },
  });
  const request = makeRequest("connections.revalidate", { provider: "Vids", enableReconnect: true }, "connect-vids");
  return await new Promise<Record<string, unknown>>((resolve) => listener(JSON.parse(JSON.stringify(request)), { id: "vids-resume-test", url: "chrome-extension://vids-resume-test/index.html" }, (response) => resolve(response as unknown as Record<string, unknown>)));
}

async function invokeConnectionsRecordSelection(f: Awaited<ReturnType<typeof setup>>, tabId: number, canonicalTarget: string) {
  const preferences = new ChromePreferenceRepository({ get: async () => ({}), set: async () => undefined });
  const listener = createConnectionMessageListener("vids-resume-test", { repositories: f.repositories, preferences,
    vidsVideoQueue: f.handler,
    flowVideoQueue: { get: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), recheckAndResume: vi.fn(), reconcilePreAddFailure: vi.fn() },
  });
  const request = makeRequest("connections.recordSelection", { provider: "Vids", tabId, canonicalTarget }, "select-new-vids-tab");
  return await new Promise<Record<string, unknown>>((resolve) => listener(JSON.parse(JSON.stringify(request)), { id: "vids-resume-test", url: "chrome-extension://vids-resume-test/index.html" }, (response) => resolve(response as unknown as Record<string, unknown>)));
}

async function seedPriorBuildPausedFiveShotQueue(f: Awaited<ReturnType<typeof setup>>, checkpoint: "absent" | "stale" = "absent", fourthGeneration?: VidsVideoGenerationOperation, fourthReason = "vids_previous_prompt_clear_failed") {
  const sent = f.batch.items.slice(0, 3);
  const receipts = sent.map((item, index) => {
    const at = 500 + index * VIDS_VIDEO_DISPATCH_GAP_MS;
    const operation: VidsVideoGenerationOperation = { id: `prior-${item.itemId}`, preparedBatchId: fiveShotBatchId, workspaceId: f.batch.workspaceId, itemId: item.itemId, canonicalShotId: item.canonicalShotId, promptHash: item.contentHash, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, preIntentReferenceProofSource: "preview_blob_sha256", activationReferenceProofSource: "preview_blob_sha256", tabId: f.batch.target.tabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: "doc", attemptId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, status: "dispatched", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: item.contentHash, actualSha256: item.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: at }, activationAttempted: true, activationCount: 1, dispatchedAt: at, createdAt: at - 1, updatedAt: at };
    f.operations.set(item.itemId, operation);
    return { operation, receipt: { attemptId: operation.attemptId, storedAt: at } };
  });
  for (const { operation } of receipts) await f.db.vidsVideoGenerationOperations.put(operation);
  if (fourthGeneration) { f.operations.set("item-4", fourthGeneration); await f.db.vidsVideoGenerationOperations.put(fourthGeneration); }
  const queueItems: VidsVideoQueueRecord["items"] = f.batch.items.map((item, order) => {
    const base = { itemId: item.itemId, order, shotId: item.canonicalShotId, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, promptHash: item.contentHash };
    if (order < 3) return { ...base, state: "sent" as const, attemptId: receipts[order]!.receipt.attemptId, dispatchReceipt: receipts[order]!.receipt };
    if (order > 3) return { ...base, state: "pending" as const };
    const staleCheckpoint = checkpoint === "stale" ? { stage: "image_removed" as const, previousItemId: "item-3", previousAttemptId: receipts[2]!.receipt.attemptId, previousReferenceId: f.batch.items[2]!.reference.referenceId, previousReferenceSha256: f.batch.items[2]!.reference.sha256, previousPromptHash: f.batch.items[2]!.contentHash, nextItemId: "item-4", nextReferenceId: item.reference.referenceId, nextReferenceSha256: item.reference.sha256, nextPromptHash: item.contentHash, tabId: f.batch.target.tabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: "old-refresh-doc", verifiedAt: 77 } : undefined;
    return { ...base, state: "blocked" as const, reason: fourthReason, ...(staleCheckpoint ? { transitionCheckpoint: staleCheckpoint } : {}) };
  });
  const queue: VidsVideoQueueRecord = { queueId: `vids-video:${fiveShotBatchId}`, preparedBatchId: fiveShotBatchId, state: "paused", items: queueItems, revision: 12, createdAt: 1, updatedAt: 900, lastDispatchAt: 500 + 2 * VIDS_VIDEO_DISPATCH_GAP_MS, cooldownDeadlineAt: 500 + 3 * VIDS_VIDEO_DISPATCH_GAP_MS, readinessDeadlineAt: null, readinessStartedAt: null, nextActionAt: null, pauseReason: "vids_previous_prompt_clear_failed", runId: "prior-build-run" };
  await f.repositories.createVidsVideoQueue(queue);
  return { queue, receipts };
}

describe("P10.3 isolated Vids timed queue", () => {
  it("starts one five-Shot queue, automatically expands/rechecks each collapsed composer, and enforces four 50-second handoffs", async () => {
    const f = await setup({ shotCount: 5 });
    let ownershipInspections = 0;
    f.transitionFromPrevious.mockImplementation(async (_batch, _previous, inspectOnly, _next, _checkpointed, phase) => {
      if (inspectOnly && phase === "inspect") {
        ownershipInspections += 1;
        if (ownershipInspections % 2 === 1) return { status: "blocked" as const, reason: "vids_composer_expanded_revalidate", diagnostics: { stage: "animate", panelStateBeforeExpansion: "collapsed", panelStateAfterExpansion: "settled", freshPreviewDetection: "delayed_then_present", previewCount: 1 } };
      }
      return { status: "ready" as const };
    });
    const started = await f.handler.start(f.batch.id);
    let current = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const receipts = [current!.items[0]!.dispatchReceipt!];
    for (let order = 1; order < 5; order += 1) {
      f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
      current = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
      expect(current?.items.slice(0, order + 1).every((item) => item.state === "sent")).toBe(true);
      expect(current?.items.slice(order + 1).every((item) => item.state === "pending")).toBe(true);
      receipts.push(current!.items[order]!.dispatchReceipt!);
    }
    expect(current?.state).toBe("all_sent");
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2", "item-3", "item-4", "item-5"]);
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2", "item-3", "item-4", "item-5"]);
    expect(receipts.slice(1).map((receipt, index) => receipt.storedAt - receipts[index]!.storedAt)).toEqual(Array(4).fill(VIDS_VIDEO_DISPATCH_GAP_MS));
    for (const item of f.batch.items) expect(f.operations.get(item.itemId)).toMatchObject({ promptHash: item.contentHash, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, activationAttempted: true, activationCount: 1 });
    expect(ownershipInspections).toBe(8);
    expect(f.transitionFromPrevious.mock.calls.map((call) => call[5]).filter((phase) => phase === "remove_reference" || phase === "clear_prompt")).toHaveLength(8);
  });

  it("persists the first automatic cleanup read when the exact prior prompt remains but no preview is observed", async () => {
    const f = await setup({ shotCount: 2 });
    const started = await f.handler.start(f.batch.id);
    let queue = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const firstReceiptAt = queue!.items[0]!.dispatchReceipt!.storedAt;
    f.transitionFromPrevious.mockImplementation(async (_batch, _previous, inspectOnly, _next, _checkpointed, phase, traceContext) => {
      if (inspectOnly && (phase === "inspect" || phase === "inspect_clean")) return { status: "blocked" as const, reason: "vids_cleanup_checkpoint_required", diagnostics: {
        stage: "ownership", previewCount: 0, fileInputCount: 0, promptExpectedSha256: f.batch.items[0]!.contentHash, promptActualSha256: f.batch.items[0]!.contentHash,
        expectedPromptLength: f.batch.items[0]!.rawJsonBody.length, actualPromptLength: f.batch.items[0]!.rawJsonBody.length, promptMatches: true, settledPromptEmpty: false,
        handoffTrace: { triggerSource: traceContext?.triggerSource, elapsedSinceReceiptToFirstReadMs: traceContext?.elapsedSinceReceiptToFirstReadMs, visibilityStart: "visible", visibilityEnd: "visible", visibilityChanges: [], initialAnimateState: "expanded", finalAnimateState: "expanded", expansionAttempted: false, panelReplaced: false, editorReplaced: false,
          previewObservations: [{ inspection: 0, atMs: 0, selectorMatches: 0, visibleMatches: 0, loadedMatches: 0 }, { inspection: 0, atMs: 2500, selectorMatches: 0, visibleMatches: 0, loadedMatches: 0 }] },
      } };
      return { status: "ready" as const };
    });
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    queue = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    expect(queue).toMatchObject({ state: "paused", items: [{ state: "sent" }, { state: "blocked", reason: "vids_cleanup_checkpoint_required", cleanupDiagnostics: {
      stage: "ownership", checkpointRead: "absent", checkpointWrite: "not_attempted", expectedPromptLength: f.batch.items[0]!.rawJsonBody.length, currentPromptLength: f.batch.items[0]!.rawJsonBody.length,
      handoffTrace: { triggerSource: "automatic_alarm", elapsedSinceReceiptToFirstReadMs: VIDS_VIDEO_DISPATCH_GAP_MS, visibilityStart: "visible", visibilityEnd: "visible", initialAnimateState: "expanded", expansionAttempted: false,
        previewObservations: [{ inspection: 0, atMs: 0, selectorMatches: 0, visibleMatches: 0, loadedMatches: 0 }, { inspection: 0, atMs: 2500, selectorMatches: 0, visibleMatches: 0, loadedMatches: 0 }] },
    } }] });
    expect(queue!.items[0]!.dispatchReceipt!.storedAt).toBe(firstReceiptAt);
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
  });

  it("uses the inner composer toggle on the alarm handoff, preserves its trace, cleans up, and sends Shot 2 once", async () => {
    const f = await setup({ shotCount: 2 });
    const started = await f.handler.start(f.batch.id);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const shot1Receipt = sent!.items[0]!.dispatchReceipt;
    let expandClicks = 0;
    let inspections = 0;
    f.transitionFromPrevious.mockImplementation(async (_batch, _previous, inspectOnly, _next, _checkpointed, phase, traceContext) => {
      if (inspectOnly && phase === "inspect") {
        inspections += 1;
        if (inspections === 1) {
          expandClicks += 1;
          return { status: "blocked" as const, reason: "vids_composer_expanded_revalidate", diagnostics: { stage: "animate", handoffTrace: {
            triggerSource: traceContext?.triggerSource, elapsedSinceReceiptToFirstReadMs: traceContext?.elapsedSinceReceiptToFirstReadMs, initialAnimateState: "collapsed", finalAnimateState: "expanded",
            composerToggleLabelBefore: "Expand", composerToggleLabelAfter: "Collapse", composerToggleClickAttempted: true, composerToggleOutcome: "expanded", panelReplaced: true, editorReplaced: true,
            previewObservations: [{ inspection: 0, atMs: 0, selectorMatches: 0, visibleMatches: 0, loadedMatches: 0, composerToggleLabel: "Expand" }, { inspection: 0, atMs: 500, selectorMatches: 1, visibleMatches: 1, loadedMatches: 1, composerToggleLabel: "Collapse" }],
          } } };
        }
        expect(traceContext?.priorTrace?.composerToggleLabelBefore).toBe("Expand");
        expect(traceContext?.priorTrace?.composerToggleLabelAfter).toBe("Collapse");
        expect(traceContext?.priorTrace?.previewObservations).toHaveLength(2);
        return { status: "ready" as const, diagnostics: { stage: "complete", promptMatches: true, referenceResult: "matched", handoffTrace: traceContext?.priorTrace } };
      }
      return { status: "ready" as const };
    });
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const handedOff = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    expect(handedOff?.state).toBe("all_sent");
    expect(handedOff?.items.map((item) => item.state)).toEqual(["sent", "sent"]);
    expect(handedOff?.items[0]?.dispatchReceipt).toEqual(shot1Receipt);
    expect(expandClicks).toBe(1);
    expect(inspections).toBe(2);
    expect(f.transitionFromPrevious.mock.calls.map((call) => call[5])).toEqual(["inspect", "inspect", "remove_reference", "clear_prompt"]);
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
    expect(f.operations.get("item-2")).toMatchObject({ promptHash: f.batch.items[1]!.contentHash, referenceId: f.batch.items[1]!.reference.referenceId, referenceSha256: f.batch.items[1]!.reference.sha256, activationAttempted: true, activationCount: 1 });
  });

  it("blocks visible readiness timeouts or ambiguous toggles on alarm without preparing Shot 2", async () => {
    for (const [reason, label] of [["vids_composer_readiness_timeout", "missing"], ["vids_composer_toggle_ambiguous", "ambiguous"]] as const) {
      const f = await setup({ shotCount: 2 });
      const started = await f.handler.start(f.batch.id);
      const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
      const receipt = sent!.items[0]!.dispatchReceipt;
      f.transitionFromPrevious.mockImplementation(async (_batch, _previous, inspectOnly, _next, _checkpointed, phase, traceContext) => inspectOnly && phase === "inspect"
        ? { status: "blocked" as const, reason, diagnostics: { stage: "readiness", handoffTrace: { triggerSource: traceContext?.triggerSource, elapsedSinceReceiptToFirstReadMs: traceContext?.elapsedSinceReceiptToFirstReadMs, composerReadinessOutcome: "timeout_visible", composerReadinessWaitMs: 30_000, composerEditorReady: false, composerToggleLabelBefore: label === "missing" ? "missing" : "ambiguous", composerToggleLabelAfter: label === "missing" ? "missing" : "ambiguous", composerToggleClickAttempted: false, composerToggleOutcome: label, previewObservations: [{ inspection: 0, atMs: 0, selectorMatches: 0, visibleMatches: 0, loadedMatches: 0, composerToggleLabel: label }] } } }
        : { status: "ready" as const });
      f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
      const blocked = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
      expect(blocked).toMatchObject({ state: "paused", items: [{ state: "sent", dispatchReceipt: receipt }, { state: "blocked", reason, cleanupDiagnostics: { handoffTrace: { composerToggleClickAttempted: false } } }] });
      expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
      expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
    }
  });

  it("shows Waiting for Vids tab after hidden composer timeout and resumes only when the bound target tab is activated", async () => {
    const f = await setup({ shotCount: 2 });
    const started = await f.handler.start(f.batch.id);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const receipt = sent!.items[0]!.dispatchReceipt;
    let reads = 0;
    f.transitionFromPrevious.mockImplementation(async (_batch, _previous, inspectOnly, _next, _checkpointed, phase, traceContext) => {
      if (inspectOnly && phase === "inspect" && reads++ === 0) return { status: "blocked" as const, reason: "vids_composer_waiting_for_tab", diagnostics: { stage: "readiness", handoffTrace: { triggerSource: traceContext?.triggerSource, elapsedSinceReceiptToFirstReadMs: traceContext?.elapsedSinceReceiptToFirstReadMs, composerReadinessWaitMs: 30_000, composerReadinessOutcome: "timeout_hidden", composerEditorReady: false, composerToggleLabelBefore: "missing", composerToggleLabelAfter: "missing", composerToggleClickAttempted: false, composerToggleOutcome: "missing", composerToggleObservations: [{ atMs: 30_000, label: "missing", scope: "missing", panelCount: 1, editorCount: 0, visibility: "hidden" }] } } };
      return { status: "ready" as const };
    });
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const waiting = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    expect(waiting).toMatchObject({ state: "waiting_for_tab", pauseReason: "vids_waiting_for_tab", items: [{ state: "sent", dispatchReceipt: receipt }, { state: "transitioning", cleanupDiagnostics: { stage: "readiness", handoffTrace: { composerReadinessOutcome: "timeout_hidden", composerReadinessWaitMs: 30_000 } } }] });
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
    await f.handler.onTargetVisible(99);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads).toBe(1);
    await f.handler.onTargetVisible(9);
    const recovered = await f.waitForQueue(started.queueId, (value) => value?.state === "all_sent");
    expect(recovered?.items).toMatchObject([{ state: "sent", dispatchReceipt: receipt }, { state: "sent" }]);
    expect(reads).toBeGreaterThan(1);
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
  });

  it("gives visibility_wakeup a fresh 30-second composer window after the alarm wait", async () => {
    const f = await setup({ shotCount: 2 });
    const started = await f.handler.start(f.batch.id);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const receipt = sent!.items[0]!.dispatchReceipt;
    f.transitionFromPrevious.mockImplementation(async (_batch, _previous, _inspectOnly, _next, _checkpointed, _phase, traceContext) => {
      if (traceContext?.triggerSource === "automatic_alarm") return { status: "blocked" as const, reason: "vids_composer_waiting_for_tab", diagnostics: { stage: "readiness", handoffTrace: { triggerSource: traceContext.triggerSource, composerReadinessWaitMs: 30_000, composerReadinessOutcome: "timeout_hidden", composerEditorReady: false } } };
      return { status: "ready" as const };
    });
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const waiting = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    expect(waiting?.state).toBe("waiting_for_tab");
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1"]);

    // Simulate the browser waiting through the hidden deadline and the late
    // 2.5-second toggle appearance that previously hit the injection fallback.
    f.advance(30_000 + 2_510);
    await f.handler.onTargetVisible(9);
    const completed = await f.waitForQueue(started.queueId, (value) => value?.state === "all_sent");
    const wakeCall = f.transitionFromPrevious.mock.calls.find((call) => call[6]?.triggerSource === "visibility_wakeup");
    expect(wakeCall?.[6]).toMatchObject({ triggerSource: "visibility_wakeup", readinessDeadlineAt: f.now() + 30_000 });
    expect((wakeCall?.[6]?.readinessDeadlineAt ?? 0) - f.now()).toBe(30_000);
    expect((wakeCall?.[6]?.readinessDeadlineAt ?? 0) - f.now()).not.toBe(VIDS_VIDEO_READINESS_TIMEOUT_MS);
    expect(completed?.items[0]?.dispatchReceipt).toEqual(receipt);
    expect(completed?.items[1]?.state).toBe("sent");
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
  });

  it("records the alarm entry and dispatch trigger separately from Pause then Resume", async () => {
    const alarmRun = await setup();
    const alarmQueue = await alarmRun.handler.start(batchId);
    const firstSent = await alarmRun.waitForQueue(alarmQueue.queueId, (queue) => queue?.state === "cooldown");
    const alarmDeadline = firstSent!.nextActionAt!;
    alarmRun.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const alarmResult = await alarmRun.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${alarmQueue.queueId}`, alarmDeadline);
    expect(alarmResult?.lastRunDiagnostic).toMatchObject({ trigger: "automatic_alarm", scheduledAt: alarmDeadline, alarmScheduledAt: alarmDeadline, stage: "sent_receipt", claim: "claimed", dispatchTrigger: "automatic_alarm", outcome: "sent" });
    expect(alarmResult?.lastDispatchTrigger).toBe("automatic_alarm");

    const resumedRun = await setup();
    const resumedQueue = await resumedRun.handler.start(batchId);
    const resumedFirstSent = await resumedRun.waitForQueue(resumedQueue.queueId, (queue) => queue?.state === "cooldown");
    resumedRun.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const paused = await resumedRun.handler.pause(batchId, resumedFirstSent!.revision);
    const resumed = await resumedRun.handler.resume(batchId, paused.revision);
    const resumeResult = await resumedRun.waitForQueue(resumedQueue.queueId, (queue) => queue?.state === "all_sent");
    expect(resumeResult?.lastRunDiagnostic).toMatchObject({ trigger: "manual_resume", alarmScheduledAt: null, stage: "sent_receipt", claim: "claimed", dispatchTrigger: "manual_resume", outcome: "sent" });
    expect(resumeResult?.lastDispatchTrigger).toBe("manual_resume");
    expect(resumeResult?.items[0]?.dispatchReceipt).toEqual(resumed.items[0]?.dispatchReceipt);
  });

  it("persists an explicit review state when an alarm handoff throws and ignores duplicate wakeups", async () => {
    const f = await setup({ shotCount: 2 });
    const started = await f.handler.start(f.batch.id);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const firstReceipt = sent!.items[0]!.dispatchReceipt;
    expect(sent!.nextActionAt).toBe(firstReceipt!.storedAt + VIDS_VIDEO_DISPATCH_GAP_MS);
    expect(f.alarms.create).toHaveBeenCalledWith(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`, { when: sent!.nextActionAt });
    f.transitionFromPrevious.mockRejectedValueOnce(new Error("synthetic page injection failure"));
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);

    const failed = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    expect(failed).toMatchObject({ state: "paused", pauseReason: "vids_queue_worker_run_failed", nextActionAt: null, items: [{ state: "sent", dispatchReceipt: firstReceipt }, { state: "blocked", reason: "vids_queue_worker_run_failed" }] });
    expect((await f.getGeneration(f.batch.id, "item-2")).status).toBe("not_started");
    expect((await f.getAttachment(f.batch.id, "item-2")).status).toBe("not_started");

    await Promise.all([
      f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`),
      f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`),
    ]);
    expect(f.transitionFromPrevious).toHaveBeenCalledTimes(1);
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
    expect((await f.repositories.getVidsVideoQueue(started.queueId))?.items[0]?.dispatchReceipt).toEqual(firstReceipt);
  });

  it("serializes overlapping due alarms so only one run claims and generates Shot 2", async () => {
    const f = await setup({ shotCount: 2 });
    const started = await f.handler.start(f.batch.id);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const firstReceipt = sent!.items[0]!.dispatchReceipt;
    let releaseInspection!: () => void;
    const inspectionGate = new Promise<void>((resolve) => { releaseInspection = resolve; });
    let inspectionEntered!: () => void;
    const inspectionStarted = new Promise<void>((resolve) => { inspectionEntered = resolve; });
    f.transitionFromPrevious.mockImplementation(async (_batch, _previous, inspectOnly, _next, _checkpointed, phase) => {
      if (inspectOnly && phase === "inspect") { inspectionEntered(); await inspectionGate; }
      return { status: "ready" as const };
    });
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const firstWake = f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    await inspectionStarted;
    const duplicateWake = f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    releaseInspection();
    const [firstResult, duplicateResult] = await Promise.all([firstWake, duplicateWake]);
    expect(firstResult?.items[0]?.dispatchReceipt).toEqual(firstReceipt);
    expect(duplicateResult?.items[0]?.dispatchReceipt).toEqual(firstReceipt);
    expect((await f.repositories.getVidsVideoQueue(started.queueId))?.state).toBe("all_sent");
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
  });

  it("resumes a visible composer-readiness timeout only when Shot 2 has no attachment or generation record", async () => {
    const f = await setup({ shotCount: 2 });
    const started = await f.handler.start(f.batch.id);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const receipt = sent!.items[0]!.dispatchReceipt!;
    const paused = { ...sent!, state: "paused" as const, revision: sent!.revision + 1, pauseReason: "vids_composer_readiness_timeout", items: sent!.items.map((item) => item.itemId === "item-2" ? { ...item, state: "blocked" as const, reason: "vids_composer_readiness_timeout" } : item) };
    await f.repositories.updateVidsVideoQueue({ expectedRevision: sent!.revision, next: paused });
    expect((await f.getGeneration(f.batch.id, "item-2")).status).toBe("not_started");
    expect((await f.getAttachment(f.batch.id, "item-2")).status).toBe("not_started");
    const itemKey = `${f.batch.id}\u0000item-2`;
    expect(await f.db.vidsVideoGenerationOperations.get(`vids-generation:${await sha256Hex(itemKey)}`)).toBeUndefined();
    expect(await f.db.vidsVideoAttachmentOperations.get(`vids:${await sha256Hex(itemKey)}`)).toBeUndefined();
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const response = await invokeQueueResume(f, f.batch.id, paused.revision);
    expect(response).toMatchObject({ ok: true });
    const completed = await f.waitForQueue(started.queueId, (value) => value?.state === "all_sent");
    expect(completed?.items[0]).toMatchObject({ state: "sent", dispatchReceipt: receipt });
    expect(completed?.items[1]).toMatchObject({ state: "sent", resumeRecoveryEvidence: { priorReason: "vids_composer_readiness_timeout" } });
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);

    const uncertain = await setup({ shotCount: 2 });
    const uncertainStarted = await uncertain.handler.start(uncertain.batch.id);
    const uncertainSent = await uncertain.waitForQueue(uncertainStarted.queueId, (value) => value?.state === "cooldown");
    const uncertainOp = { ...uncertain.operations.get("item-1")!, id: "uncertain-shot-2", itemId: "item-2", canonicalShotId: "2", promptHash: uncertain.batch.items[1]!.contentHash, referenceId: uncertain.batch.items[1]!.reference.referenceId, referenceSha256: uncertain.batch.items[1]!.reference.sha256, status: "uncertain" as const, activationAttempted: true, activationCount: 1, dispatchedAt: undefined };
    uncertain.operations.set("item-2", uncertainOp);
    const uncertainQueue = { ...uncertainSent!, state: "paused" as const, revision: uncertainSent!.revision + 1, pauseReason: "vids_composer_readiness_timeout", items: uncertainSent!.items.map((item) => item.itemId === "item-2" ? { ...item, state: "blocked" as const, reason: "vids_composer_readiness_timeout" } : item) };
    await uncertain.repositories.updateVidsVideoQueue({ expectedRevision: uncertainSent!.revision, next: uncertainQueue });
    const rejected = await invokeQueueResume(uncertain, uncertain.batch.id, uncertainQueue.revision);
    expect(rejected).toMatchObject({ ok: false, error: { code: "vids_generation_attempt_requires_review", stage: "resume_validation" } });
    expect(uncertain.generate.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
    expect(uncertainSent?.items[0]?.dispatchReceipt).toBe(uncertainQueue.items[0]?.dispatchReceipt);
  });

  it.each(["pause", "stop"] as const)("honors %s while waiting for the Vids tab without replaying Shot 1", async (action) => {
    const f = await setup({ shotCount: 2 });
    const started = await f.handler.start(f.batch.id);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const receipt = sent!.items[0]!.dispatchReceipt;
    let finishWait!: (result: { status: "blocked"; reason: string; diagnostics: unknown }) => void;
    const waitResult = new Promise<{ status: "blocked"; reason: string; diagnostics: unknown }>((resolve) => { finishWait = resolve; });
    f.transitionFromPrevious.mockImplementation(async (_batch, _previous, inspectOnly, _next, _checkpointed, phase) => inspectOnly && phase === "inspect" ? waitResult : { status: "ready" as const });
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const alarm = f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    for (let attempt = 0; attempt < 10 && f.transitionFromPrevious.mock.calls.length === 0; attempt += 1) await f.flush();
    const duringWait = await f.repositories.getVidsVideoQueue(started.queueId);
    expect(duringWait).toMatchObject({ state: "preparing", items: [{ state: "sent" }, { state: "transitioning" }] });
    const changed = await f.handler[action](f.batch.id, duringWait!.revision);
    finishWait({ status: "blocked", reason: "vids_composer_waiting_for_tab", diagnostics: { stage: "readiness", handoffTrace: { composerReadinessOutcome: "timeout_hidden", composerReadinessWaitMs: 30_000 } } });
    const completedRun = await alarm;
    await f.handler.onTargetVisible(9);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changed.state).toBe(action === "pause" ? "paused" : "stopped");
    expect(completedRun?.state).toBe(action === "pause" ? "paused" : "stopped");
    expect(f.transitionFromPrevious).toHaveBeenCalledTimes(1);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1"]);
    const final = await f.repositories.getVidsVideoQueue(started.queueId);
    expect(final?.items[0]).toMatchObject({ state: "sent", dispatchReceipt: receipt });
    expect(final?.items[1]?.state).toBe("transitioning");
  });

  it("recovers the persisted 3/5 checkpoint blocker at Shot 4 and preserves the first three receipts", async () => {
    const f = await setup({ shotCount: 5, revalidate: async () => ({ ok: true }) });
    const { queue: prior, receipts } = await seedPriorBuildPausedFiveShotQueue(f, "absent", undefined, "vids_cleanup_checkpoint_required");
    await f.db.selectedTargets.put(verifiedVidsTarget("doc"));
    let expanded = false;
    f.transitionFromPrevious.mockImplementation(async (_batch, _previous, inspectOnly, _next, _checkpointed, phase) => {
      if (inspectOnly && phase === "inspect" && !expanded) { expanded = true; return { status: "blocked" as const, reason: "vids_composer_expanded_revalidate", diagnostics: { stage: "animate", panelStateBeforeExpansion: "collapsed", panelStateAfterExpansion: "settled", freshPreviewDetection: "delayed_then_present", previewCount: 1 } }; }
      if (inspectOnly && phase === "inspect") return { status: "ready" as const, diagnostics: { stage: "complete", previewCount: 1, promptMatches: true, referenceResult: "matched" } };
      return { status: "ready" as const };
    });
    f.advance(3 * VIDS_VIDEO_DISPATCH_GAP_MS);
    const resumed = await invokeQueueResume(f, fiveShotBatchId, prior.revision);
    expect(resumed).toMatchObject({ ok: true });
    const sent = await f.waitForQueue(prior.queueId, (value) => value?.items[3]?.state === "sent");
    expect(sent?.items.map((item) => item.state)).toEqual(["sent", "sent", "sent", "sent", "pending"]);
    expect(sent?.items.slice(0, 3).map((item) => item.dispatchReceipt)).toEqual(receipts.map((entry) => entry.receipt));
    expect(sent?.items[3]?.resumeRecoveryEvidence).toMatchObject({ priorReason: "vids_cleanup_checkpoint_required" });
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-4"]);
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-4"]);
    expect(f.transitionFromPrevious.mock.calls.map((call) => call[5])).toEqual(["inspect", "inspect", "remove_reference", "clear_prompt"]);
  });

  it("recovers the persisted Shot 5 handoff blocker only after verifying Shot 4 and proving Shot 5 was untouched", async () => {
    const oldTabId = 1957329050, newTabId = 1957329423;
    const f = await setup({ shotCount: 5, tabId: oldTabId, revalidate: async () => ({ ok: true }) });
    const { queue: prior, receipts } = await seedPriorBuildPausedFiveShotQueue(f, "absent");
    const shot4 = f.batch.items[3]!;
    const shot5 = f.batch.items[4]!;
    const reboundDoc = "shot4-rebound-doc";
    const dispatchAt = 500 + 3 * VIDS_VIDEO_DISPATCH_GAP_MS;
    const shot4Attempt = "00000000-0000-4000-8000-000000000044";
    const shot4Operation: VidsVideoGenerationOperation = {
      id: `vids-generation:${await sha256Hex(`${fiveShotBatchId}\u0000item-4`)}`, preparedBatchId: fiveShotBatchId, workspaceId: "workspace", itemId: "item-4", canonicalShotId: "4", promptHash: shot4.contentHash, referenceId: shot4.reference.referenceId, referenceSha256: shot4.reference.sha256,
      preIntentReferenceProofSource: "preview_blob_sha256", activationReferenceProofSource: "preview_blob_sha256", tabId: newTabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: reboundDoc, attemptId: shot4Attempt, status: "dispatched",
      promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: shot4.contentHash, actualSha256: shot4.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: dispatchAt }, activationAttempted: true, activationCount: 1, dispatchedAt: dispatchAt, createdAt: dispatchAt - 1, updatedAt: dispatchAt,
    };
    const pairHash = await sha256Hex(`${fiveShotBatchId}\u0000item-4`);
    const shot4Attachment: VidsVideoAttachmentOperation = {
      id: `vids:${pairHash}`, preparedBatchId: fiveShotBatchId, workspaceId: "workspace", itemId: "item-4", shotId: "4", referenceId: shot4.reference.referenceId, assignmentVersion: shot4.reference.assignmentVersion, referenceSha256: shot4.reference.sha256, mimeType: "image/png", byteSize: 4, width: 1, height: 1,
      tabId: newTabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: reboundDoc, status: "attached", uploadEvidence: { mechanism: "verified_document_file_input", exactBytesSha256: shot4.reference.sha256, byteSize: 4, mimeType: "image/png", fileInputCount: 1, inputChangeDispatched: true, previewLoaded: true, previewWidth: 1, previewHeight: 1, removalControlPresent: true, uploadOperationId: "44444444-4444-4444-8444-444444444444", uploadedAt: dispatchAt }, createdAt: dispatchAt - 1, updatedAt: dispatchAt,
    };
    f.operations.set("item-4", shot4Operation);
    await f.db.vidsVideoGenerationOperations.put(shot4Operation);
    await f.db.vidsVideoAttachmentOperations.put(shot4Attachment);
    const shot4Receipt = { attemptId: shot4Attempt, storedAt: dispatchAt };
    const priorExecutionBinding = { fromTabId: oldTabId, toTabId: newTabId, fromDocumentId: "doc", toDocumentId: reboundDoc, projectId: "project", canonicalTarget: f.batch.target.canonicalTarget, verifiedAt: dispatchAt, sameAccountConfirmedAt: dispatchAt };
    const exactState: VidsVideoQueueRecord = {
      ...prior, revision: prior.revision + 1, state: "paused", lastDispatchAt: dispatchAt, cooldownDeadlineAt: dispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS,
      executionDocumentRebind: priorExecutionBinding,
      items: prior.items.map((item, index) => index < 3 ? item : index === 3
        ? { ...item, state: "sent" as const, reason: undefined, attemptId: shot4Attempt, dispatchReceipt: shot4Receipt }
        : { ...item, state: "blocked" as const, reason: "vids_previous_item_dispatch_binding_unverified" }),
    };
    await f.repositories.updateVidsVideoQueue({ expectedRevision: prior.revision, next: exactState });
    await f.db.selectedTargets.put(verifiedVidsTarget(reboundDoc, f.batch.target.canonicalTarget, newTabId));
    f.transitionFromPrevious.mockImplementation(async (_batchId, _previousId, inspectOnly, _nextItemId, _checkpointed, phase) => phase === "inspect_clean" && inspectOnly
      ? { status: "blocked" as const, reason: "vids_refreshed_composer_not_clean" }
      : ["inspect", "remove_reference", "clear_prompt"].includes(phase ?? "")
        ? { status: "ready" as const, diagnostics: { stage: "complete", settledPromptEmpty: true } }
        : { status: "blocked" as const, reason: "unexpected_transition_phase" });
    f.advance(dispatchAt - f.now());

    const response = await invokeQueueResume(f, fiveShotBatchId, exactState.revision, true);
    expect(response).toMatchObject({ ok: true });
    const resumed = await f.waitForQueue(exactState.queueId, (value) => value?.state === "cooldown");
    expect(resumed?.items.map((item) => item.state)).toEqual(["sent", "sent", "sent", "sent", "pending"]);
    expect(resumed?.items[4]?.resumeRecoveryEvidence).toMatchObject({ priorReason: "vids_previous_item_dispatch_binding_unverified" });
    expect(resumed?.items.slice(0, 3).map((item) => item.dispatchReceipt)).toEqual(receipts.map((entry) => entry.receipt));
    expect(resumed?.items[3]?.dispatchReceipt).toEqual(shot4Receipt);
    expect(f.attach).toHaveBeenCalledTimes(0);
    expect(f.generate).not.toHaveBeenCalled();

    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const sent = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${exactState.queueId}`);
    expect(sent?.items.map((item) => item.state)).toEqual(["sent", "sent", "sent", "sent", "sent"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-5"]);
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-5"]);
    expect(f.transitionFromPrevious.mock.calls.map((call) => call[5])).toEqual(["inspect_clean", "inspect", "inspect", "remove_reference", "clear_prompt"]);
    expect(sent?.items.slice(0, 4).map((item) => item.dispatchReceipt)).toEqual([...receipts.map((entry) => entry.receipt), shot4Receipt]);
    expect(sent?.items[4]?.resumeRecoveryEvidence).toMatchObject({ priorReason: "vids_previous_item_dispatch_binding_unverified" });
    expect(f.operations.get("item-5")).toMatchObject({ promptHash: shot5.contentHash, referenceId: shot5.reference.referenceId, referenceSha256: shot5.reference.sha256, tabId: newTabId, documentId: reboundDoc });
  });

  it.each(["wrong_generation_binding", "wrong_attachment_binding", "shot5_generation_uncertain"] as const)("rejects handoff recovery with %s and no Generate", async (corruption) => {
    const f = await setup({ shotCount: 5, tabId: 1957329050, revalidate: async () => ({ ok: true }) });
    const { queue: prior } = await seedPriorBuildPausedFiveShotQueue(f, "absent");
    const previous = f.batch.items[3]!;
    const pairHash = await sha256Hex(`${fiveShotBatchId}\u0000item-4`);
    const binding = verifiedVidsTarget("rebound-doc", f.batch.target.canonicalTarget, 1957329423);
    const attemptId = "00000000-0000-4000-8000-000000000044";
    const dispatchedAt = 500 + 3 * VIDS_VIDEO_DISPATCH_GAP_MS;
    const op: VidsVideoGenerationOperation = { id: `vids-generation:${pairHash}`, preparedBatchId: fiveShotBatchId, workspaceId: "workspace", itemId: "item-4", canonicalShotId: "4", promptHash: previous.contentHash, referenceId: previous.reference.referenceId, referenceSha256: previous.reference.sha256, tabId: corruption === "wrong_generation_binding" ? 9 : binding.tabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: corruption === "wrong_generation_binding" ? "old-doc" : "rebound-doc", attemptId, status: "dispatched", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: previous.contentHash, actualSha256: previous.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: dispatchedAt }, activationAttempted: true, activationCount: 1, dispatchedAt, createdAt: dispatchedAt - 1, updatedAt: dispatchedAt };
    const attachment: VidsVideoAttachmentOperation = { id: `vids:${pairHash}`, preparedBatchId: fiveShotBatchId, workspaceId: "workspace", itemId: "item-4", shotId: "4", referenceId: previous.reference.referenceId, assignmentVersion: previous.reference.assignmentVersion, referenceSha256: previous.reference.sha256, mimeType: "image/png", byteSize: 4, width: 1, height: 1, tabId: corruption === "wrong_attachment_binding" ? 9 : binding.tabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: corruption === "wrong_attachment_binding" ? "old-doc" : "rebound-doc", status: "attached", uploadEvidence: { mechanism: "verified_document_file_input", exactBytesSha256: previous.reference.sha256, byteSize: 4, mimeType: "image/png", fileInputCount: 1, inputChangeDispatched: true, previewLoaded: true, previewWidth: 1, previewHeight: 1, removalControlPresent: true, uploadOperationId: "44444444-4444-4444-8444-444444444444", uploadedAt: dispatchedAt }, createdAt: dispatchedAt - 1, updatedAt: dispatchedAt };
    await f.db.vidsVideoGenerationOperations.put(op);
    await f.db.vidsVideoAttachmentOperations.put(attachment);
    if (corruption === "shot5_generation_uncertain") {
      const next = f.batch.items[4]!;
      const uncertain: VidsVideoGenerationOperation = { id: `vids-generation:${await sha256Hex(`${fiveShotBatchId}\u0000item-5`)}`, preparedBatchId: fiveShotBatchId, workspaceId: "workspace", itemId: "item-5", canonicalShotId: "5", promptHash: next.contentHash, referenceId: next.reference.referenceId, referenceSha256: next.reference.sha256, tabId: binding.tabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: "rebound-doc", attemptId: "00000000-0000-4000-8000-000000000055", status: "uncertain", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: next.contentHash, actualSha256: next.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: dispatchedAt }, activationAttempted: true, activationCount: 1, createdAt: dispatchedAt - 1, updatedAt: dispatchedAt };
      f.operations.set("item-5", uncertain);
      await f.db.vidsVideoGenerationOperations.put(uncertain);
    }
    const badQueue: VidsVideoQueueRecord = { ...prior, revision: prior.revision + 1, items: prior.items.map((item, index) => index === 3 ? { ...item, state: "sent" as const, attemptId, dispatchReceipt: { attemptId, storedAt: dispatchedAt } } : index === 4 ? { ...item, state: "blocked" as const, reason: "vids_previous_item_dispatch_binding_unverified" } : item) };
    await f.repositories.updateVidsVideoQueue({ expectedRevision: prior.revision, next: badQueue });
    await f.db.selectedTargets.put(binding);
    const rejected = await invokeQueueResume(f, fiveShotBatchId, badQueue.revision, true);
    expect(rejected).toMatchObject({ ok: false, error: { code: corruption === "shot5_generation_uncertain" ? "vids_generation_attempt_requires_review" : "vids_previous_item_dispatch_binding_unverified", stage: "resume_validation" } });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.attach).not.toHaveBeenCalled();
  });

  it("revalidates a Connected-session/stale-storage mismatch through Connections, then resumes the same queue on the new document", async () => {
    const oldTabId = 1957329050, newTabId = 1957329423;
    let performRevalidation: () => Promise<unknown> = async () => ({ ok: true });
    const f = await setup({ shotCount: 5, tabId: oldTabId, revalidate: () => performRevalidation() });
    const { queue: prior, receipts } = await seedPriorBuildPausedFiveShotQueue(f, "absent");
    const canonicalTarget = f.batch.target.canonicalTarget;
    const url = canonicalTarget;
    const selectedTab = providerTabFromUrl(newTabId, "vids test", url)!;
    const port: ConnectionPort = {
      getMissingAccess: async () => ({}),
      getTab: vi.fn(async (tabId) => tabId === newTabId ? selectedTab : undefined),
      pingTopFrame: async (_tabId, request) => ({ ok: true, provider: "Vids", canonicalTarget, projectId: "project", protocolVersion: CONNECTOR_PROTOCOL_VERSION, buildId: BUILD_ID, attemptId: request.attemptId, documentToken: "new-token", capabilities: [CONNECTION_CAPABILITY] }),
      identifyDocument: async () => ({ documentId: "refreshed-doc", frameId: 0, url }),
      injectConnector: async () => ({ documentId: "refreshed-doc", frameId: 0, url }),
      probeTopFrame: async (_tabId, _documentId, request) => ({ ok: true, provider: "Vids", canonicalTarget, projectId: "project", protocolVersion: CONNECTOR_PROTOCOL_VERSION, buildId: BUILD_ID, attemptId: request.attemptId, documentToken: "new-token", capabilities: [CONNECTION_CAPABILITY] }),
      releaseConnector: async () => undefined,
      makeAttemptId: () => "reconnect-attempt",
    };
    const lifecycle = createConnectionLifecycleService(f.repositories, () => port);
    performRevalidation = () => lifecycle.revalidate("Vids", false);
    await f.db.selectedTargets.put({ ...verifiedVidsTarget("old-document", canonicalTarget, oldTabId), reconnectEnabled: true });
    expect(await invokeConnectionsRecordSelection(f, newTabId, canonicalTarget)).toMatchObject({ ok: true, data: { tabId: newTabId, verification: "unverified" } });
    await f.repositories.markTargetsUnverified(); // worker restart can invalidate storage while the dashboard still has a Connected session snapshot
    const reconnected = await invokeConnectionsRevalidate(f, (provider, allowReconnect) => lifecycle.revalidate(provider, allowReconnect));
    expect(reconnected).toMatchObject({ ok: true, data: { ok: true, state: "verified", documentId: "refreshed-doc" } });
    expect(await f.repositories.getSelectedTarget("Vids")).toMatchObject({ tabId: newTabId, verification: "verified", connectionState: "verified", verificationBinding: { tabId: newTabId, canonicalTarget, projectId: "project", documentId: "refreshed-doc" } });
    expect(port.getTab).toHaveBeenCalledWith(newTabId);
    expect(port.getTab).not.toHaveBeenCalledWith(oldTabId);

    f.advance(3 * VIDS_VIDEO_DISPATCH_GAP_MS);
    f.transitionFromPrevious.mockImplementation(async (_batchId, _previousId, inspectOnly, nextItemId, _checkpointed, phase) => phase === "inspect_clean" && inspectOnly && nextItemId === "item-4" ? { status: "ready" as const, diagnostics: { stage: "complete", settledEmpty: true } } : { status: "blocked" as const, reason: "unexpected_transition_phase" });
    const resumed = await invokeQueueResume(f, fiveShotBatchId, prior.revision, true, (provider, allowReconnect) => lifecycle.revalidate(provider, allowReconnect));
    expect(resumed).toMatchObject({ ok: true });
    const continued = await f.waitForQueue(prior.queueId, (value) => value?.items[3]?.state === "sent");
    expect(continued?.items.map((item) => item.state)).toEqual(["sent", "sent", "sent", "sent", "pending"]);
    expect(continued?.items.slice(0, 3).map((item) => item.dispatchReceipt)).toEqual(receipts.map((entry) => entry.receipt));
    expect(continued?.executionDocumentRebind).toMatchObject({ fromTabId: oldTabId, toTabId: newTabId, fromDocumentId: "doc", toDocumentId: "refreshed-doc", canonicalTarget });
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-4"]);
    expect(f.operations.get("item-4")).toMatchObject({ tabId: newTabId, documentId: "refreshed-doc", referenceId: f.batch.items[3]!.reference.referenceId, promptHash: f.batch.items[3]!.contentHash });
  });

  it("runs the cleanup worker on the rebound tab/document while historical Shot 3 stays on its original binding", async () => {
    const oldTabId = 1957329050, newTabId = 1957329423;
    const f = await setup({ shotCount: 5, tabId: oldTabId });
    const { queue: prior, receipts } = await seedPriorBuildPausedFiveShotQueue(f, "absent");
    const reboundQueue: VidsVideoQueueRecord = { ...prior, state: "preparing", revision: prior.revision + 1, executionDocumentRebind: { fromTabId: oldTabId, toTabId: newTabId, fromDocumentId: "doc", toDocumentId: "new-document", projectId: "project", canonicalTarget: f.batch.target.canonicalTarget, verifiedAt: 100, sameAccountConfirmedAt: 101 }, items: prior.items.map((item) => item.order === 3 ? { ...item, state: "transitioning" as const } : item) };
    await f.repositories.updateVidsVideoQueue({ expectedRevision: prior.revision, next: reboundQueue });
    const previous = f.batch.items[2]!;
    const priorOperationId = `vids-generation:${await sha256Hex(`${fiveShotBatchId}\u0000${previous.itemId}`)}`;
    const generation: VidsVideoGenerationOperation = { id: priorOperationId, preparedBatchId: fiveShotBatchId, workspaceId: f.batch.workspaceId, itemId: previous.itemId, canonicalShotId: previous.canonicalShotId, promptHash: previous.contentHash, referenceId: previous.reference.referenceId, referenceSha256: previous.reference.sha256, tabId: oldTabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: "doc", attemptId: receipts[2]!.receipt.attemptId, status: "dispatched", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: previous.contentHash, actualSha256: previous.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: 100 }, activationAttempted: true, activationCount: 1, dispatchedAt: receipts[2]!.receipt.storedAt, createdAt: 99, updatedAt: 100 };
    await f.db.vidsVideoGenerationOperations.put(generation);
    const attachmentId = `vids:${await sha256Hex(`${fiveShotBatchId}\u0000${previous.itemId}`)}`;
    const attachment: VidsVideoAttachmentOperation = { id: attachmentId, preparedBatchId: fiveShotBatchId, workspaceId: f.batch.workspaceId, itemId: previous.itemId, shotId: previous.canonicalShotId, referenceId: previous.reference.referenceId, assignmentVersion: previous.reference.assignmentVersion, referenceSha256: previous.reference.sha256, mimeType: "image/png", byteSize: 4, width: 1, height: 1, tabId: oldTabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: "doc", status: "attached", uploadEvidence: { mechanism: "verified_document_file_input", exactBytesSha256: previous.reference.sha256, byteSize: 4, mimeType: "image/png", fileInputCount: 1, inputChangeDispatched: true, previewLoaded: true, previewWidth: 1, previewHeight: 1, removalControlPresent: true, uploadOperationId: "44444444-4444-4444-8444-444444444444", uploadedAt: 100 }, createdAt: 99, updatedAt: 100 };
    await f.db.vidsVideoAttachmentOperations.put(attachment);
    await f.db.selectedTargets.put(verifiedVidsTarget("new-document", f.batch.target.canonicalTarget, newTabId));
    const script = vi.fn(async () => [{ documentId: "new-document", result: { href: f.batch.target.canonicalTarget, ok: true, changed: false, diagnostics: { stage: "complete", settledPromptEmpty: true } } }]);
    const worker = createVidsVideoGenerateHandler({ repositories: f.repositories, scripting: { executeScript: script }, getTab: async (tabId) => tabId === newTabId ? { id: newTabId, url: f.batch.target.canonicalTarget } : undefined, revalidate: async () => undefined });
    const result = await worker.transitionFromPrevious(fiveShotBatchId, previous.itemId, true, "item-4", false, "inspect_clean");
    expect(result.status).toBe("ready");
    expect(script).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: newTabId, documentIds: ["new-document"] } }));
    expect(generation).toMatchObject({ tabId: oldTabId, documentId: "doc" });
    expect(attachment).toMatchObject({ tabId: oldTabId, documentId: "doc" });
    await f.db.selectedTargets.put(verifiedVidsTarget("new-document", f.batch.target.canonicalTarget, newTabId));
    script.mockImplementationOnce(async () => {
      await f.db.selectedTargets.put(verifiedVidsTarget("switched-document", f.batch.target.canonicalTarget, 1957329555));
      return [{ documentId: "new-document", result: { href: f.batch.target.canonicalTarget, ok: true, changed: false, diagnostics: { stage: "complete", settledPromptEmpty: true } } }];
    });
    const switched = await worker.transitionFromPrevious(fiveShotBatchId, previous.itemId, true, "item-4", false, "inspect_clean");
    expect(switched).toMatchObject({ status: "blocked", reason: "vids_target_changed_after_composer_transition" });
  });

  it("proves Shot 4 receipt, generation, attachment, and active binding agree after refreshed-tab Resume", async () => {
    const oldTabId = 1957329050, newTabId = 1957329423;
    const f = await setup({ shotCount: 5, tabId: oldTabId });
    const { queue: prior, receipts } = await seedPriorBuildPausedFiveShotQueue(f);
    const shot4 = f.batch.items[3]!, shot5 = f.batch.items[4]!;
    const shot4Receipt = { attemptId: "44444444-4444-4444-8444-444444444444", storedAt: 500 + 3 * VIDS_VIDEO_DISPATCH_GAP_MS };
    const rebound = { fromTabId: oldTabId, toTabId: newTabId, fromDocumentId: "old-doc", toDocumentId: "refreshed-doc", projectId: "project", canonicalTarget: f.batch.target.canonicalTarget, verifiedAt: 600, sameAccountConfirmedAt: 601 };
    const shot4SentQueue: VidsVideoQueueRecord = { ...prior, state: "preparing", revision: prior.revision + 1, executionDocumentRebind: rebound, lastDispatchAt: shot4Receipt.storedAt, cooldownDeadlineAt: shot4Receipt.storedAt + VIDS_VIDEO_DISPATCH_GAP_MS, items: prior.items.map((item) => item.itemId === shot4.itemId ? { ...item, state: "sent" as const, attemptId: shot4Receipt.attemptId, dispatchReceipt: shot4Receipt } : item.itemId === shot5.itemId ? { ...item, state: "transitioning" as const } : item) };
    await f.repositories.updateVidsVideoQueue({ expectedRevision: prior.revision, next: shot4SentQueue });
    const shot4OperationId = `vids-generation:${await sha256Hex(`${fiveShotBatchId}\u0000${shot4.itemId}`)}`;
    await f.db.vidsVideoGenerationOperations.put({ id: shot4OperationId, preparedBatchId: fiveShotBatchId, workspaceId: f.batch.workspaceId, itemId: shot4.itemId, canonicalShotId: shot4.canonicalShotId, promptHash: shot4.contentHash, referenceId: shot4.reference.referenceId, referenceSha256: shot4.reference.sha256, tabId: newTabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: "refreshed-doc", attemptId: shot4Receipt.attemptId, status: "dispatched", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: shot4.contentHash, actualSha256: shot4.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: shot4Receipt.storedAt }, activationAttempted: true, activationCount: 1, dispatchedAt: shot4Receipt.storedAt, createdAt: shot4Receipt.storedAt - 1, updatedAt: shot4Receipt.storedAt });
    const attachmentId = `vids:${await sha256Hex(`${fiveShotBatchId}\u0000${shot4.itemId}`)}`;
    await f.db.vidsVideoAttachmentOperations.put({ id: attachmentId, preparedBatchId: fiveShotBatchId, workspaceId: f.batch.workspaceId, itemId: shot4.itemId, shotId: shot4.canonicalShotId, referenceId: shot4.reference.referenceId, assignmentVersion: shot4.reference.assignmentVersion, referenceSha256: shot4.reference.sha256, mimeType: "image/png", byteSize: shot4.reference.byteSize, width: shot4.reference.width, height: shot4.reference.height, tabId: newTabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: "refreshed-doc", status: "attached", uploadEvidence: { mechanism: "verified_document_file_input", exactBytesSha256: shot4.reference.sha256, byteSize: shot4.reference.byteSize, mimeType: "image/png", fileInputCount: 1, inputChangeDispatched: true, previewLoaded: true, previewWidth: shot4.reference.width, previewHeight: shot4.reference.height, removalControlPresent: true, uploadOperationId: "44444444-4444-4444-8444-444444444445", uploadedAt: shot4Receipt.storedAt - 2 }, createdAt: shot4Receipt.storedAt - 2, updatedAt: shot4Receipt.storedAt - 2 });
    await f.db.selectedTargets.put(verifiedVidsTarget("refreshed-doc", f.batch.target.canonicalTarget, newTabId));
    const script = vi.fn(async () => [{ documentId: "refreshed-doc", result: { href: f.batch.target.canonicalTarget, ok: true, changed: false, diagnostics: { stage: "complete", settledPromptEmpty: true } } }]);
    const worker = createVidsVideoGenerateHandler({ repositories: f.repositories, scripting: { executeScript: script }, getTab: async (tabId) => tabId === newTabId ? { id: newTabId, url: f.batch.target.canonicalTarget } : undefined, revalidate: async () => undefined });
    const result = await worker.transitionFromPrevious(fiveShotBatchId, shot4.itemId, true, shot5.itemId, false, "inspect_clean");
    expect(result).toMatchObject({ status: "ready", diagnostics: { operationBound: true, attachmentBound: true, targetBound: true, documentBound: true } });
    expect(script).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: newTabId, documentIds: ["refreshed-doc"] }, args: [expect.objectContaining({ prompt: shot4.rawJsonBody, promptSha256: shot4.contentHash })] }));
    expect(await f.repositories.getVidsVideoQueue(prior.queueId)).toMatchObject({ executionDocumentRebind: rebound, items: expect.arrayContaining([expect.objectContaining({ itemId: shot4.itemId, state: "sent", dispatchReceipt: shot4Receipt })]) });
    for (let index = 0; index < 3; index += 1) expect(await f.repositories.getVidsVideoGenerationOperation(`prior-${f.batch.items[index]!.itemId}`)).toMatchObject({ tabId: oldTabId, documentId: "doc", attemptId: receipts[index]!.receipt.attemptId });
  });

  it("blocks pending dispatch when the selected Vids tab or document changes after Resume verification", async () => {
    const f = await setup({ shotCount: 5, tabId: 1957329050, revalidate: async () => ({ ok: true }) });
    const { queue } = await seedPriorBuildPausedFiveShotQueue(f, "absent");
    await f.db.selectedTargets.put(verifiedVidsTarget("verified-doc", f.batch.target.canonicalTarget, 1957329423));
    f.advance(3 * VIDS_VIDEO_DISPATCH_GAP_MS);
    f.transitionFromPrevious.mockImplementation(async (_batchId, _previousId, inspectOnly, nextItemId, _checkpointed, phase) => {
      if (phase === "inspect_clean" && inspectOnly && nextItemId === "item-4") {
        await f.db.selectedTargets.put(verifiedVidsTarget("switched-doc", f.batch.target.canonicalTarget, 1957329555));
        return { status: "ready" as const, diagnostics: { stage: "complete", settledEmpty: true } };
      }
      return { status: "blocked" as const, reason: "unexpected_transition_phase" };
    });
    const response = await invokeQueueResume(f, fiveShotBatchId, queue.revision, true);
    expect(response).toMatchObject({ ok: true });
    const stopped = await f.waitForQueue(queue.queueId, (value) => value?.state === "paused" && value.items[3]?.reason === "vids_target_or_confirmation_mismatch");
    expect(stopped?.items[3]).toMatchObject({ state: "blocked", reason: "vids_target_or_confirmation_mismatch" });
    expect(f.attach).toHaveBeenCalledTimes(1);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it.each(["absent", "stale"] as const)("resumes a prior-build five-shot queue on a refreshed empty composer with a %s cleanup checkpoint", async (checkpointKind) => {
    const f = await setup({ shotCount: 5 });
    const { queue: prior, receipts } = await seedPriorBuildPausedFiveShotQueue(f, checkpointKind);
    await f.db.selectedTargets.put(verifiedVidsTarget("refreshed-doc"));
    f.advance(3 * VIDS_VIDEO_DISPATCH_GAP_MS);
    f.transitionFromPrevious.mockImplementation(async (_batchId, _previousId, inspectOnly, nextItemId, _checkpointed, phase) => {
      if (phase === "inspect_clean" && inspectOnly && nextItemId === "item-4") return { status: "ready" as const, diagnostics: { stage: "complete", settledEmpty: true } };
      return { status: "blocked" as const, reason: "unexpected_transition_phase" };
    });
    const response = await invokeQueueResume(f, fiveShotBatchId, prior.revision, true);
    expect(response).toMatchObject({ ok: true });
    const resumed = await f.waitForQueue(prior.queueId, (value) => value?.items[3]?.state === "sent");
    expect(resumed?.queueId).toBe(prior.queueId);
    expect(resumed?.items.map((item) => item.state)).toEqual(["sent", "sent", "sent", "sent", "pending"]);
    expect(resumed?.items.slice(0, 3).map((item) => item.dispatchReceipt)).toEqual(receipts.map((item) => item.receipt));
    for (const item of f.batch.items.slice(0, 3)) expect(f.operations.get(item.itemId)?.documentId).toBe("doc");
    expect(resumed?.executionDocumentRebind).toMatchObject({ fromDocumentId: "doc", toDocumentId: "refreshed-doc", canonicalTarget: f.batch.target.canonicalTarget });
    expect(f.transitionFromPrevious).toHaveBeenCalledWith(fiveShotBatchId, "item-3", true, "item-4", false, "inspect_clean", expect.objectContaining({ triggerSource: "manual_resume" }));
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-4"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-4"]);
    const shot4 = f.batch.items[3]!;
    expect(f.operations.get("item-4")).toMatchObject({ documentId: "refreshed-doc", referenceId: shot4.reference.referenceId, referenceSha256: shot4.reference.sha256, promptHash: shot4.contentHash, status: "dispatched" });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.attach).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong target", "wrong_target", false, "vids_resume_canonical_target_mismatch"],
    ["missing same-account attestation", "same_target", false, "vids_same_account_confirmation_required"],
  ] as const)("rejects refreshed Resume for %s with a specific code and no Generate", async (_label, targetKind, attest, expectedCode) => {
    const f = await setup({ shotCount: 5 });
    const { queue } = await seedPriorBuildPausedFiveShotQueue(f);
    await f.db.selectedTargets.put(verifiedVidsTarget("refreshed-doc", targetKind === "wrong_target" ? "https://docs.google.com/videos/d/other/edit" : f.batch.target.canonicalTarget));
    const response = await invokeQueueResume(f, fiveShotBatchId, queue.revision, attest);
    expect(response).toMatchObject({ ok: false, error: { code: expectedCode, stage: "resume_validation" } });
    expect(f.generate).not.toHaveBeenCalled();
    expect(await f.repositories.getVidsVideoQueue(queue.queueId)).toEqual(queue);
  });

  it("preserves conflicting composer content and rejects uncertain Shot 4 activation without Generate", async () => {
    const f = await setup({ shotCount: 5 });
    const { queue } = await seedPriorBuildPausedFiveShotQueue(f);
    await f.db.selectedTargets.put(verifiedVidsTarget("refreshed-doc"));
    f.transitionFromPrevious.mockImplementation(async (_batchId, _previousId, inspectOnly, _nextItemId, _checkpointed, phase) => ({ status: "blocked" as const, reason: phase === "inspect_clean" ? "vids_refreshed_composer_not_clean" : "vids_previous_composer_content_conflict" }));
    f.advance(3 * VIDS_VIDEO_DISPATCH_GAP_MS);
    await invokeQueueResume(f, fiveShotBatchId, queue.revision, true);
    const paused = await f.waitForQueue(queue.queueId, (value) => value?.state === "paused" && value.items[3]?.reason === "vids_previous_composer_content_conflict");
    expect(paused?.items[3]).toMatchObject({ state: "blocked", reason: "vids_previous_composer_content_conflict" });
    expect(f.generate).not.toHaveBeenCalled();

    const uncertain = await setup({ shotCount: 5 });
    const { queue: uncertainQueue } = await seedPriorBuildPausedFiveShotQueue(uncertain, "absent", { id: "uncertain-shot-4", preparedBatchId: fiveShotBatchId, workspaceId: "workspace", itemId: "item-4", canonicalShotId: "4", promptHash: uncertain.batch.items[3]!.contentHash, referenceId: uncertain.batch.items[3]!.reference.referenceId, referenceSha256: uncertain.batch.items[3]!.reference.sha256, tabId: 9, canonicalTarget: uncertain.batch.target.canonicalTarget, documentId: "prior-doc", attemptId: "shot4-uncertain", status: "uncertain", promptReadback: { serialization: "contenteditable_blocks_v1", expectedSha256: uncertain.batch.items[3]!.contentHash, actualSha256: uncertain.batch.items[3]!.contentHash, immediateMatch: true, settledMatch: true, stableReads: 3, verifiedAt: 10 }, activationAttempted: true, activationCount: 1, createdAt: 9, updatedAt: 10 });
    await uncertain.db.selectedTargets.put(verifiedVidsTarget("refreshed-doc"));
    const rejected = await invokeQueueResume(uncertain, fiveShotBatchId, uncertainQueue.revision, true);
    expect(rejected).toMatchObject({ ok: false, error: { code: "vids_generation_attempt_requires_review", stage: "resume_validation" } });
    expect(uncertain.generate).not.toHaveBeenCalled();
    expect(uncertain.attach).not.toHaveBeenCalled();
  });

  it("recovers the exact pre-transition target-change failure after clean-composer revalidation and keeps the original error evidence", async () => {
    const oldTabId = 1957329050, newTabId = 1957329423;
    const f = await setup({ shotCount: 5, tabId: oldTabId, revalidate: async () => ({ ok: true }) });
    const { queue: prior, receipts } = await seedPriorBuildPausedFiveShotQueue(f, "absent", undefined, "vids_target_changed_before_composer_transition");
    await f.db.selectedTargets.put(verifiedVidsTarget("rebound-doc", f.batch.target.canonicalTarget, newTabId));
    f.advance(3 * VIDS_VIDEO_DISPATCH_GAP_MS);
    f.transitionFromPrevious.mockImplementation(async (_batchId, _previousItemId, _inspectOnly, _nextItemId, _checkpointed, phase) => {
      if (phase === "inspect_clean") return { status: "blocked" as const, reason: "vids_refreshed_composer_not_clean" };
      if (phase === "inspect" || phase === "remove_reference" || phase === "clear_prompt") return { status: "ready" as const, diagnostics: { stage: "complete", settledPromptEmpty: true } };
      return { status: "blocked" as const, reason: "unexpected_transition_phase" };
    });
    const response = await invokeQueueResume(f, fiveShotBatchId, prior.revision, true);
    expect(response).toMatchObject({ ok: true });
    const shot4Sent = await f.waitForQueue(prior.queueId, (value) => value?.items[3]?.state === "sent");
    const shot4Receipt = shot4Sent?.items[3]?.dispatchReceipt;
    expect(shot4Sent?.items.map((item) => item.state)).toEqual(["sent", "sent", "sent", "sent", "pending"]);
    expect(shot4Sent?.items.slice(0, 3).map((item) => item.dispatchReceipt)).toEqual(receipts.map((entry) => entry.receipt));
    expect(shot4Sent?.items[3]?.resumeRecoveryEvidence).toMatchObject({ priorReason: "vids_target_changed_before_composer_transition" });
    expect(shot4Sent?.executionDocumentRebind).toMatchObject({ fromTabId: oldTabId, toTabId: newTabId, toDocumentId: "rebound-doc" });
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-4"]);
    expect(f.attach.mock.calls.map((call) => call[1])).toEqual(["item-4"]);
    expect(f.operations.get("item-4")).toMatchObject({ tabId: newTabId, documentId: "rebound-doc", promptHash: f.batch.items[3]!.contentHash, referenceId: f.batch.items[3]!.reference.referenceId });

    const dispatchAt = f.operations.get("item-4")!.dispatchedAt!;
    const waitingShot5 = await f.waitForQueue(prior.queueId, (value) => value?.state === "cooldown");
    expect(waitingShot5?.nextActionAt).toBe(dispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-4"]);
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS - 1);
    await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${prior.queueId}`);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-4"]);
    f.advance(1);
    const shot5Sent = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${prior.queueId}`);
    expect(shot5Sent?.items.map((item) => item.state)).toEqual(["sent", "sent", "sent", "sent", "sent"]);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-4", "item-5"]);
    expect(shot5Sent?.items.slice(0, 4).map((item) => item.dispatchReceipt)).toEqual([...receipts.map((entry) => entry.receipt), shot4Receipt]);
    expect(f.transitionFromPrevious.mock.calls.map((call) => call[5]).filter((phase) => phase === "remove_reference" || phase === "clear_prompt")).toEqual(["remove_reference", "clear_prompt", "remove_reference", "clear_prompt"]);
    expect(f.operations.get("item-5")!.dispatchedAt).toBe(dispatchAt + VIDS_VIDEO_DISPATCH_GAP_MS);
  });

  it("keeps attachment-attempted Shot 4 at review when recovering the historical transition error", async () => {
    const f = await setup({ shotCount: 5 });
    const { queue } = await seedPriorBuildPausedFiveShotQueue(f, "absent", undefined, "vids_target_changed_before_composer_transition");
    await f.db.selectedTargets.put(verifiedVidsTarget("rebound-doc"));
    f.getAttachment.mockResolvedValue({ status: "action_intent", reason: "upload_intent" });
    const response = await invokeQueueResume(f, fiveShotBatchId, queue.revision, true);
    expect(response).toMatchObject({ ok: false, error: { code: "vids_attachment_attempt_requires_review", stage: "resume_validation" } });
    expect(f.attach).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect((await f.repositories.getVidsVideoQueue(queue.queueId))?.items[3]).toMatchObject({ state: "blocked", reason: "vids_target_changed_before_composer_transition" });
  });

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
    expect(f.transitionFromPrevious).toHaveBeenNthCalledWith(1, batchId, "item-1", true, "item-2", false, "inspect", expect.objectContaining({ triggerSource: "automatic_alarm" }));
    expect(f.transitionFromPrevious).toHaveBeenNthCalledWith(2, batchId, "item-1", false, "item-2", true, "remove_reference", expect.objectContaining({ triggerSource: "automatic_alarm" }));
    expect(f.transitionFromPrevious).toHaveBeenNthCalledWith(3, batchId, "item-1", false, "item-2", true, "clear_prompt", expect.objectContaining({ triggerSource: "automatic_alarm" }));
    expect(after?.items[1]?.transitionCheckpoint).toMatchObject({ stage: "prompt_cleared", previousItemId: "item-1", nextItemId: "item-2", documentId: "doc" });
    expect(after?.state).toBe("all_sent");
  });

  it("resumes the prior 1/5 cleanup-checkpoint block, expands and verifies the intact pair, then dispatches Shot 2 once", async () => {
    const f = await setup();
    const started = await f.handler.start(batchId);
    const cooldown = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const receipt = cooldown!.items[0]!.dispatchReceipt!;
    const paused: VidsVideoQueueRecord = { ...cooldown!, state: "paused", revision: cooldown!.revision + 1, pauseReason: "vids_cleanup_checkpoint_required", nextActionAt: null,
      items: cooldown!.items.map((item) => item.itemId === "item-2" ? { ...item, state: "blocked" as const, reason: "vids_cleanup_checkpoint_required" } : item) };
    await f.repositories.updateVidsVideoQueue({ expectedRevision: cooldown!.revision, next: paused });
    await f.db.selectedTargets.put(verifiedVidsTarget("doc"));
    let expanded = false;
    f.transitionFromPrevious.mockImplementation(async (_batch, _previous, inspectOnly, _next, _checkpointed, phase) => {
      if (inspectOnly && phase === "inspect" && !expanded) { expanded = true; return { status: "blocked" as const, reason: "vids_composer_expanded_revalidate" }; }
      return { status: "ready" as const };
    });

    const response = await invokeQueueResume(f, batchId, paused.revision);
    expect(response).toMatchObject({ ok: true });
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "all_sent");
    expect(sent?.items.map((item) => item.state)).toEqual(["sent", "sent"]);
    expect(sent?.items[0]?.dispatchReceipt).toEqual(receipt);
    expect(sent?.items[1]?.resumeRecoveryEvidence).toMatchObject({ priorReason: "vids_cleanup_checkpoint_required" });
    expect(sent?.items[1]?.transitionCheckpoint).toMatchObject({ stage: "prompt_cleared", previousItemId: "item-1", nextItemId: "item-2" });
    expect(f.transitionFromPrevious.mock.calls.map((call) => call[5])).toEqual(["inspect", "inspect", "remove_reference", "clear_prompt"]);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
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

  it.each(["pause", "stop"] as const)("rechecks %s after read-only ownership proof and never runs cleanup afterward", async (action) => {
    const f = await setup();
    const first = await f.handler.start(batchId);
    const cooldown = await f.waitForQueue(first.queueId, (value) => value?.state === "cooldown");
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    f.transitionFromPrevious.mockImplementation(async (_id, _previous, inspectOnly) => {
      if (inspectOnly) {
        const current = await f.repositories.getVidsVideoQueue(first.queueId);
        await f.handler[action](batchId, current!.revision);
      }
      return { status: "ready" as const };
    });
    const paused = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${first.queueId}`);
    expect(paused?.state).toBe(action === "pause" ? "paused" : "stopped");
    expect(paused?.items[0]?.state).toBe("sent");
    expect(paused?.items[1]?.state).toBe("transitioning");
    expect(f.transitionFromPrevious).toHaveBeenCalledTimes(1);
    expect(f.transitionFromPrevious).toHaveBeenCalledWith(batchId, "item-1", true, "item-2", false, "inspect", expect.objectContaining({ triggerSource: "automatic_alarm" }));
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.attach).toHaveBeenCalledTimes(1);
    expect(cooldown?.items[0]?.dispatchReceipt).toEqual(paused?.items[0]?.dispatchReceipt);
  });

  it.each(["pause", "stop"] as const)("persists ownership before removal and does not clear after %s at the removal boundary", async (action) => {
    const f = await setup();
    const started = await f.handler.start(batchId);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    let interrupted = false;
    f.transitionFromPrevious.mockImplementation(async (_id, _previous, inspectOnly, _nextId, _checkpointed, phase) => {
      if (inspectOnly) return { status: "ready" as const, diagnostics: { stage: "complete" } };
      if (phase === "remove_reference" && !interrupted) {
        interrupted = true;
        const current = await f.repositories.getVidsVideoQueue(started.queueId);
        await f.handler[action](batchId, current!.revision);
      }
      return { status: "ready" as const };
    });
    const boundary = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    expect(boundary?.state).toBe(action === "pause" ? "paused" : "stopped");
    expect(boundary?.items[0]?.dispatchReceipt).toEqual(sent?.items[0]?.dispatchReceipt);
    expect(boundary?.items[1]?.transitionCheckpoint).toMatchObject({ stage: "ownership_verified", nextItemId: "item-2", previousAttemptId: sent?.items[0]?.dispatchReceipt?.attemptId });
    expect(f.transitionFromPrevious.mock.calls.some((call) => call[5] === "clear_prompt")).toBe(false);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.attach).toHaveBeenCalledTimes(1);
  });

  it("resumes an interrupted pre-Generate composer transition from the same state without replaying Sent", async () => {
    const f = await setup();
    const started = await f.handler.start(batchId);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const interrupted = { ...sent!, state: "preparing" as const, revision: sent!.revision + 1, items: sent!.items.map((item) => item.itemId === "item-2" ? { ...item, state: "transitioning" as const } : item) };
    await f.repositories.updateVidsVideoQueue({ expectedRevision: sent!.revision, next: interrupted });
    await f.handler.reconcileStartup();
    const paused = await f.repositories.getVidsVideoQueue(started.queueId);
    expect(paused).toMatchObject({ state: "paused", pauseReason: "worker_restart_before_generate" });
    expect(paused?.items[0]).toMatchObject({ state: "sent", dispatchReceipt: sent!.items[0]!.dispatchReceipt });
    expect(paused?.items[1]).toMatchObject({ state: "transitioning", reason: "worker_restart_before_generate" });
    await f.handler.resume(batchId, paused!.revision);
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const resumed = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    expect(resumed?.items.map((item) => item.state)).toEqual(["sent", "sent"]);
    expect(f.transitionFromPrevious).toHaveBeenCalledWith(batchId, "item-1", true, "item-2", false, "inspect", expect.objectContaining({ triggerSource: "manual_resume" }));
    expect(f.transitionFromPrevious).toHaveBeenCalledWith(batchId, "item-1", false, "item-2", true, "remove_reference", expect.objectContaining({ triggerSource: "manual_resume" }));
    expect(f.transitionFromPrevious).toHaveBeenCalledWith(batchId, "item-1", false, "item-2", true, "clear_prompt", expect.objectContaining({ triggerSource: "manual_resume" }));
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
  });

  it("resumes from the durable image-removed checkpoint without reproving removed bytes or replaying Sent", async () => {
    const f = await setup();
    const started = await f.handler.start(batchId);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const previous = sent!.items[0]!, next = sent!.items[1]!;
    const checkpoint = { stage: "image_removed" as const, previousItemId: previous.itemId, previousAttemptId: previous.dispatchReceipt!.attemptId, previousReferenceId: previous.referenceId, previousReferenceSha256: previous.referenceSha256, previousPromptHash: previous.promptHash, nextItemId: next.itemId, nextReferenceId: next.referenceId, nextReferenceSha256: next.referenceSha256, nextPromptHash: next.promptHash, tabId: f.batch.target.tabId, canonicalTarget: f.batch.target.canonicalTarget, documentId: f.batch.target.documentId!, verifiedAt: f.now() };
    const pausedRecord = { ...sent!, state: "paused" as const, pauseReason: "vids_previous_prompt_clear_failed", revision: sent!.revision + 1, nextActionAt: null, items: sent!.items.map((item) => item.itemId === next.itemId ? { ...item, state: "blocked" as const, reason: "vids_previous_prompt_clear_failed", transitionCheckpoint: checkpoint } : item) };
    await f.repositories.updateVidsVideoQueue({ expectedRevision: sent!.revision, next: pausedRecord });
    const resumed = await f.handler.resume(batchId, pausedRecord.revision);
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const after = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    expect(after?.items.map((item) => item.state)).toEqual(["sent", "sent"]);
    expect(after?.items[0]?.dispatchReceipt).toEqual(sent!.items[0]?.dispatchReceipt);
    expect(f.transitionFromPrevious.mock.calls.some((call) => call[5] === "inspect" || call[5] === "remove_reference")).toBe(false);
    expect(f.transitionFromPrevious).toHaveBeenCalledWith(batchId, previous.itemId, false, next.itemId, true, "clear_prompt", expect.objectContaining({ triggerSource: "manual_resume" }));
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
    expect(resumed.items[1]?.transitionCheckpoint).toEqual(checkpoint);
  });

  it.each(["pause", "stop"] as const)("does not advance from image_removed after a %s arrives during prompt clearing", async (action) => {
    const f = await setup();
    const started = await f.handler.start(batchId);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    let interrupted = false;
    f.transitionFromPrevious.mockImplementation(async (_id, _previous, inspectOnly, _nextId, _checkpointed, phase) => {
      if (inspectOnly) return { status: "ready" as const };
      if (phase === "clear_prompt" && !interrupted) {
        interrupted = true;
        const current = await f.repositories.getVidsVideoQueue(started.queueId);
        await f.handler[action](batchId, current!.revision);
      }
      return { status: "ready" as const };
    });
    const boundary = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    expect(boundary?.state).toBe(action === "pause" ? "paused" : "stopped");
    expect(boundary?.items[1]?.transitionCheckpoint).toMatchObject({ stage: "image_removed", previousItemId: "item-1", nextItemId: "item-2" });
    expect(boundary?.items[0]?.dispatchReceipt).toEqual(sent?.items[0]?.dispatchReceipt);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.attach).toHaveBeenCalledTimes(1);
  });

  it("resumes an attached, pre-intent prompt stage through P10.2 without reupload or replaying Sent", async () => {
    const f = await setup();
    f.getAttachment.mockImplementation(async (_id, itemId) => ({ status: itemId === "item-2" ? "attached" : "not_started" }));
    const started = await f.handler.start(batchId);
    const sent = await f.waitForQueue(started.queueId, (value) => value?.state === "cooldown");
    const interrupted = { ...sent!, state: "preparing" as const, revision: sent!.revision + 1, items: sent!.items.map((item) => item.itemId === "item-2" ? { ...item, state: "sending" as const } : item) };
    await f.repositories.updateVidsVideoQueue({ expectedRevision: sent!.revision, next: interrupted });
    await f.handler.reconcileStartup();
    const paused = await f.repositories.getVidsVideoQueue(started.queueId);
    expect(paused).toMatchObject({ state: "paused", pauseReason: "worker_restart_before_generate" });
    expect(paused?.items[1]).toMatchObject({ state: "sending", reason: "worker_restart_before_generate" });
    await f.handler.resume(batchId, paused!.revision);
    f.advance(VIDS_VIDEO_DISPATCH_GAP_MS);
    const resumed = await f.handler.onAlarm(`${VIDS_VIDEO_QUEUE_ALARM_PREFIX}${started.queueId}`);
    expect(resumed?.items.map((item) => item.state)).toEqual(["sent", "sent"]);
    expect(f.attach).toHaveBeenCalledTimes(1);
    expect(f.generate.mock.calls.map((call) => call[1])).toEqual(["item-1", "item-2"]);
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
    const queue: VidsVideoQueueRecord = { queueId: `vids-video:${batchId}`, preparedBatchId: batchId, state: "paused", items: f.batch.items.map((item, order) => ({ itemId: item.itemId, order, shotId: item.canonicalShotId, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, promptHash: item.contentHash, state: order === 0 ? "sent" : "blocked", ...(order === 0 ? { attemptId: operation.attemptId, dispatchReceipt: { attemptId: operation.attemptId, storedAt: operation.dispatchedAt! } } : { reason: "vids_previous_reference_identity_mismatch" }) })), revision: 7, createdAt: 1, updatedAt: 500, lastDispatchAt: 500, cooldownDeadlineAt: 50_500, readinessDeadlineAt: null, readinessStartedAt: null, nextActionAt: null, pauseReason: "vids_previous_reference_identity_mismatch", runId: "run" };
    await f.repositories.createVidsVideoQueue(queue);
    const result = await f.handler.inspectTransition(batchId, "item-2");
    expect(result.status).toBe("ready");
    expect(f.transitionFromPrevious).toHaveBeenCalledWith(batchId, "item-1", true, "item-2", false, "inspect");
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
