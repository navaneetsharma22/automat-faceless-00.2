import { importPromptBatch } from "../../domain/batches/importBatch";
import { canonicalizeShotId } from "../../domain/batches/inputPolicy";
import { sha256Hex } from "../../domain/batches/hashPrompt";
import { ReferenceAssignmentRecordSchema, sha256Bytes } from "../../domain/media/references";
import { VidsVideoGenerationOperationSchema, type VidsVideoGenerationOperation } from "../../domain/jobs/vidsVideoGeneration";
import { VidsVideoAttachmentOperationSchema } from "../../domain/jobs/vidsVideoAttachment";
import { PreparedVideoBatchRecordSchema, VideoSettingsConfirmationSchema } from "../../shared/schemas";
import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import { CONNECTOR_PROTOCOL_VERSION } from "../../platforms/shared/contracts";
import { parseProviderRoute } from "../../platforms/shared/providerRoute";
import { enterVidsPromptInPage, activateVidsGenerateInPage, transitionVidsComposerFromPreviousInPage } from "../../platforms/vids/video";
import type { ExtensionRepositories } from "../../storage/repositories";

type Injection = { documentId?: string; result?: unknown };
type VidsScriptPort = {
  executeScript(input: {
    target: { tabId: number; documentIds: string[] };
    world: "MAIN";
    func: (...args: never[]) => unknown;
    args?: unknown[];
  }): Promise<Injection[]>;
};

export type VidsVideoGenerateResult = {
  status: "not_started" | "dispatch_intent" | "dispatched" | "uncertain" | "blocked" | "retry_ready" | "already_dispatched";
  stage?: string;
  reason?: string;
  operation?: VidsVideoGenerationOperation;
};

function safeReason(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : fallback;
}

/** P10.2 only: exact prepared Vids prompt entry and one-shot Generate. */
export function createVidsVideoGenerateHandler(deps: {
  repositories: ExtensionRepositories;
  scripting: VidsScriptPort;
  getTab: (tabId: number) => Promise<{ id?: number; url?: string }>;
  revalidate: () => Promise<unknown>;
  now?: () => number;
  createAttemptId?: () => string;
  queueCanContinue?: (preparedBatchId: string) => Promise<boolean>;
}) {
  const now = deps.now ?? Date.now;
  const makeId = async (batchId: string, itemId: string) => `vids-generation:${await sha256Hex(`${batchId}\u0000${itemId}`)}`;

  async function validateTarget(batch: ReturnType<typeof PreparedVideoBatchRecordSchema.parse>) {
    try { await deps.revalidate(); } catch { return { reason: "vids_connection_revalidation_failed" } as const; }
    const selected = await deps.repositories.getSelectedTarget("Vids");
    const binding = selected?.verificationBinding;
    const confirmation = VideoSettingsConfirmationSchema.safeParse(batch.manualSettingsDeclaration);
    if (!selected || selected.provider !== "Vids" || selected.verification !== "verified" || selected.connectionState !== "verified" || !binding ||
      !confirmation.success || confirmation.data.destination !== "Vids" ||
      selected.tabId !== batch.target.tabId || selected.canonicalTarget !== batch.target.canonicalTarget ||
      confirmation.data.tabId !== selected.tabId || confirmation.data.canonicalTarget !== selected.canonicalTarget ||
      confirmation.data.projectId !== batch.target.projectId || confirmation.data.documentId !== batch.target.documentId ||
      binding.provider !== "Vids" || binding.tabId !== selected.tabId || binding.canonicalTarget !== selected.canonicalTarget ||
      binding.projectId !== batch.target.projectId || binding.documentId !== batch.target.documentId || binding.frameId !== 0 ||
      binding.extensionBuildId !== BUILD_ID || binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
      binding.connectorBuildId !== BUILD_ID || binding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION)
      return { reason: "vids_target_or_confirmation_mismatch" } as const;
    let tab: { id?: number; url?: string };
    try { tab = await deps.getTab(selected.tabId); } catch { return { reason: "vids_selected_tab_unavailable" } as const; }
    const route = tab.id === selected.tabId ? parseProviderRoute(tab.url ?? "") : undefined;
    if (!route || route.provider !== "Vids" || route.projectId !== binding.projectId || route.canonicalTarget !== selected.canonicalTarget)
      return { reason: "vids_target_changed" } as const;
    return { selected, binding } as const;
  }

  async function inspectAndEnter(batch: ReturnType<typeof PreparedVideoBatchRecordSchema.parse>, item: ReturnType<typeof PreparedVideoBatchRecordSchema.parse>["items"][number], documentId: string) {
    const target = await validateTarget(batch);
    if ("reason" in target) return { reason: target.reason } as const;
    if (target.binding.documentId !== documentId) return { reason: "vids_document_changed" } as const;
    let response: Injection | undefined;
    try {
      [response] = await deps.scripting.executeScript({
        target: { tabId: target.selected.tabId, documentIds: [documentId] }, world: "MAIN", func: enterVidsPromptInPage,
        args: [{ prompt: item.rawJsonBody, expectedSha256: item.contentHash, referenceSha256: item.reference.sha256, referenceMimeType: item.reference.mimeType as "image/png" | "image/jpeg", referenceByteSize: item.reference.byteSize, referenceWidth: item.reference.width, referenceHeight: item.reference.height, timeoutMs: 2500 }],
      });
    } catch { return { reason: "vids_prompt_injection_failed" } as const; }
    if (response?.documentId !== documentId) return { reason: "vids_document_changed" } as const;
    const result = response.result as Awaited<ReturnType<typeof enterVidsPromptInPage>> | undefined;
    const route = parseProviderRoute(result?.href ?? "");
    if (!route || route.provider !== "Vids" || route.projectId !== target.binding.projectId || route.canonicalTarget !== target.selected.canonicalTarget)
      return { reason: "vids_target_changed" } as const;
    if (!result?.ok) return { reason: safeReason(result?.reason, "vids_prompt_entry_failed"), result } as const;
    if (result.expectedSha256 !== item.contentHash || result.actualSha256 !== item.contentHash || !result.immediateMatch || !result.settledMatch || (result.stableReads ?? 0) < 3)
      return { reason: "vids_exact_prompt_readback_failed", result } as const;
    if (result.referenceSha256 !== item.reference.sha256 || result.referenceByteSize !== item.reference.byteSize || !["selected_file_sha256", "preview_blob_sha256"].includes(result.referenceProofSource ?? ""))
      return { reason: "vids_reference_identity_mismatch", result } as const;
    if (result.generateCount !== 1) return { reason: result.generateCount ? "vids_generate_control_ambiguous" : "vids_generate_control_missing", result } as const;
    if (result.generateDisabled) return { reason: "generate_disabled", result } as const;
    return { selected: target.selected, binding: target.binding, result } as const;
  }

  async function get(preparedBatchId: string, itemId: string): Promise<VidsVideoGenerateResult> {
    const id = await makeId(preparedBatchId, itemId);
    const operation = await deps.repositories.getVidsVideoGenerationOperation(id);
    if (!operation) return { status: "not_started" };
    const status = operation.status === "dispatch_intent" ? "uncertain" : operation.status;
    return { status, stage: operation.failureStage, reason: operation.reason, operation };
  }

  async function generateOnce(preparedBatchId: string, itemId: string, fromQueue = false): Promise<VidsVideoGenerateResult> {
    const existingQueue = await deps.repositories.getVidsVideoQueue(`vids-video:${preparedBatchId}`);
    if (existingQueue && !fromQueue) return { status: "blocked", stage: "queue_ownership", reason: "vids_queue_owns_prepared_batch" };
    if (fromQueue && !(await deps.queueCanContinue?.(preparedBatchId))) return { status: "blocked", stage: "queue_ownership", reason: "vids_queue_paused_before_generation_intent" };
    const id = await makeId(preparedBatchId, itemId);
    const existing = await deps.repositories.getVidsVideoGenerationOperation(id);
    const retrySource = existing?.status === "retry_ready" && existing.preActivationRecovery ? existing : undefined;
    if (existing && !retrySource) return { status: existing.status === "dispatched" ? "already_dispatched" : existing.status === "dispatch_intent" ? "uncertain" : existing.status, stage: existing.failureStage, reason: existing.reason ?? "generation_already_attempted", operation: existing };

    const parsed = PreparedVideoBatchRecordSchema.safeParse(await deps.repositories.getPreparedVideoBatchById(preparedBatchId));
    if (!parsed.success || parsed.data.id !== preparedBatchId || parsed.data.destination !== "Vids") return { status: "blocked", stage: "preflight", reason: "prepared_vids_batch_invalid" };
    let batch = parsed.data;
    if (fromQueue) {
      const rebound = (await deps.repositories.getVidsVideoQueue(`vids-video:${preparedBatchId}`))?.executionDocumentRebind;
      if (rebound) batch = { ...batch, target: { ...batch.target, documentId: rebound.toDocumentId }, manualSettingsDeclaration: { ...batch.manualSettingsDeclaration, documentId: rebound.toDocumentId } };
    }
    const confirmation = VideoSettingsConfirmationSchema.safeParse(batch.manualSettingsDeclaration);
    if (!confirmation.success || confirmation.data.destination !== "Vids" || confirmation.data.tabId !== batch.target.tabId || confirmation.data.canonicalTarget !== batch.target.canonicalTarget || confirmation.data.projectId !== batch.target.projectId || confirmation.data.documentId !== batch.target.documentId)
      return { status: "blocked", stage: "preflight", reason: "manual_settings_confirmation_binding_mismatch" };
    if (await sha256Hex(batch.videoSourceText) !== batch.videoSourceHash) return { status: "blocked", stage: "preflight", reason: "prepared_video_source_hash_mismatch" };
    const imported = importPromptBatch(batch.videoSourceText, "video");
    const item = batch.items.find((candidate) => candidate.itemId === itemId);
    if (!item || !imported.ok || imported.items[item.order]?.rawBody !== item.rawJsonBody || imported.items[item.order]?.shotId !== (item.shotId ?? item.canonicalShotId) || canonicalizeShotId(imported.items[item.order]?.shotId) !== item.canonicalShotId || await sha256Hex(item.rawJsonBody) !== item.contentHash)
      return { status: "blocked", stage: "preflight", reason: "prepared_item_pairing_or_hash_mismatch" };

    const attachment = await deps.repositories.getVidsVideoAttachmentOperation(`vids:${await sha256Hex(`${batch.id}\u0000${item.itemId}`)}`);
    const parsedAttachment = VidsVideoAttachmentOperationSchema.safeParse(attachment);
    const pinned = await deps.repositories.getReferenceById(item.reference.referenceId);
    if (!parsedAttachment.success || parsedAttachment.data.status !== "attached" || parsedAttachment.data.preparedBatchId !== batch.id || parsedAttachment.data.itemId !== item.itemId || parsedAttachment.data.shotId !== item.canonicalShotId || parsedAttachment.data.referenceId !== item.reference.referenceId || parsedAttachment.data.assignmentVersion !== item.reference.assignmentVersion || parsedAttachment.data.referenceSha256 !== item.reference.sha256 || parsedAttachment.data.documentId !== batch.target.documentId || parsedAttachment.data.canonicalTarget !== batch.target.canonicalTarget || parsedAttachment.data.uploadEvidence?.exactBytesSha256 !== item.reference.sha256 || parsedAttachment.data.uploadEvidence.byteSize !== item.reference.byteSize || parsedAttachment.data.uploadEvidence.mimeType !== item.reference.mimeType || parsedAttachment.data.uploadEvidence.previewWidth !== item.reference.width || parsedAttachment.data.uploadEvidence.previewHeight !== item.reference.height)
      return { status: "blocked", stage: "preflight", reason: "vids_reference_not_attached_or_binding_mismatch" };
    if (!pinned || !ReferenceAssignmentRecordSchema.safeParse(pinned).success || pinned.referenceId !== item.reference.referenceId || pinned.assignmentVersion !== item.reference.assignmentVersion || pinned.workspaceId !== batch.workspaceId || pinned.batchId !== batch.imageSourceBatchId || pinned.batchSourceHash !== batch.imageSourceBatchHash || pinned.shotId !== item.canonicalShotId || pinned.sha256 !== item.reference.sha256 || pinned.mimeType !== item.reference.mimeType || pinned.byteSize !== item.reference.byteSize || pinned.width !== item.reference.width || pinned.height !== item.reference.height)
      return { status: "blocked", stage: "preflight", reason: "prepared_reference_binding_mismatch" };
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await pinned.bytes.arrayBuffer()); } catch { return { status: "blocked", stage: "preflight", reason: "reference_bytes_unavailable" }; }
    if (bytes.byteLength !== item.reference.byteSize || await sha256Bytes(bytes) !== item.reference.sha256)
      return { status: "blocked", stage: "preflight", reason: "reference_bytes_integrity_failed" };

    const before = await validateTarget(batch);
    if ("reason" in before) return { status: "blocked", stage: "preflight", reason: before.reason };
    if (before.binding.documentId !== parsedAttachment.data.documentId) return { status: "blocked", stage: "preflight", reason: "vids_document_changed" };
    const prepared = await inspectAndEnter(batch, item, before.binding.documentId);
    if ("reason" in prepared) return { status: "blocked", stage: prepared.reason?.startsWith("reference_") ? "reference_proof" : prepared.result?.promptState ? "prompt_entry" : "generate_preflight", reason: prepared.reason };

    const beforeIntent = await validateTarget(batch);
    if ("reason" in beforeIntent || beforeIntent.binding.documentId !== before.binding.documentId || beforeIntent.selected.tabId !== before.selected.tabId || beforeIntent.selected.canonicalTarget !== before.selected.canonicalTarget)
      return { status: "blocked", stage: "generate_preflight", reason: "vids_target_changed_before_intent" };
    // Re-read prompt/reference immediately before creating the one-shot intent.
    const exactAgain = await inspectAndEnter(batch, item, before.binding.documentId);
    if ("reason" in exactAgain) return { status: "blocked", stage: "generate_preflight", reason: exactAgain.reason };
    const finalPreIntentTarget = await validateTarget(batch);
    if ("reason" in finalPreIntentTarget || finalPreIntentTarget.binding.documentId !== before.binding.documentId || finalPreIntentTarget.selected.tabId !== before.selected.tabId || finalPreIntentTarget.selected.canonicalTarget !== before.selected.canonicalTarget)
      return { status: "blocked", stage: "generate_preflight", reason: "vids_target_changed_before_intent" };

    const timestamp = now();
    const attemptId = deps.createAttemptId?.() ?? crypto.randomUUID();
    const intent: VidsVideoGenerationOperation = {
      id, preparedBatchId: batch.id, workspaceId: batch.workspaceId, itemId: item.itemId, canonicalShotId: item.canonicalShotId,
      promptHash: item.contentHash, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256,
      preIntentReferenceProofSource: exactAgain.result.referenceProofSource,
      ...(retrySource?.preActivationRecovery ? { preActivationRecovery: retrySource.preActivationRecovery } : {}),
      tabId: before.selected.tabId, canonicalTarget: before.selected.canonicalTarget, documentId: before.binding.documentId,
      attemptId, status: "dispatch_intent", promptReadback: {
        serialization: "contenteditable_blocks_v1", expectedSha256: item.contentHash, actualSha256: exactAgain.result.actualSha256!,
        immediateMatch: true, settledMatch: true, stableReads: exactAgain.result.stableReads!, verifiedAt: timestamp,
      }, activationAttempted: false, activationCount: 0, createdAt: timestamp, updatedAt: timestamp,
    };
    if (fromQueue && !(await deps.queueCanContinue?.(preparedBatchId))) return { status: "blocked", stage: "queue_ownership", reason: "vids_queue_paused_before_generation_intent" };
    try {
      const claimed = retrySource
        ? await deps.repositories.claimVidsVideoGenerationRetry(intent, retrySource, attachment!)
        : await deps.repositories.claimVidsVideoGenerationOperation(intent, attachment!, fromQueue);
      if (!claimed) {
        const raced = await deps.repositories.getVidsVideoGenerationOperation(id);
        return { status: raced?.status === "dispatched" ? "already_dispatched" : raced?.status ?? "blocked", reason: "generation_operation_already_claimed", operation: raced };
      }
    } catch { return { status: "blocked", stage: "persistence", reason: "generation_intent_persistence_failed" }; }

    const saveOutcome = async (status: VidsVideoGenerationOperation["status"], stage: VidsVideoGenerationOperation["failureStage"], reason: string | undefined, activationAttempted: boolean, activationCount: 0 | 1, activationReferenceProofSource?: VidsVideoGenerationOperation["activationReferenceProofSource"]) => {
      const updatedAt = now();
      const next: VidsVideoGenerationOperation = {
        ...intent, status, ...(stage ? { failureStage: stage } : {}), ...(reason ? { reason: safeReason(reason, "vids_generation_failed") } : {}),
        activationAttempted, activationCount, ...(activationReferenceProofSource ? { activationReferenceProofSource } : {}), ...(status === "dispatched" ? { dispatchedAt: updatedAt } : {}), updatedAt,
      };
      try { await deps.repositories.updateVidsVideoGenerationOperation({ expected: intent, next }); } catch { /* intent remains durable and blocks replay */ }
      return await deps.repositories.getVidsVideoGenerationOperation(id) ?? next;
    };

    const finalTarget = await validateTarget(batch);
    if ("reason" in finalTarget || finalTarget.binding.documentId !== intent.documentId || finalTarget.selected.tabId !== intent.tabId || finalTarget.selected.canonicalTarget !== intent.canonicalTarget) {
      const operation = await saveOutcome("blocked", "generate_preflight", "vids_target_changed_before_activation", false, 0);
      return { status: "blocked", stage: "generate_preflight", reason: operation.reason, operation };
    }
    if (fromQueue && !(await deps.queueCanContinue?.(preparedBatchId))) {
      const operation = await saveOutcome("blocked", "generate_preflight", "vids_queue_paused_before_activation", false, 0);
      return { status: "blocked", stage: "generate_preflight", reason: operation.reason, operation };
    }
    let response: Injection | undefined;
    try {
      [response] = await deps.scripting.executeScript({
        target: { tabId: intent.tabId, documentIds: [intent.documentId] }, world: "MAIN", func: activateVidsGenerateInPage,
        args: [{ prompt: item.rawJsonBody, promptSha256: item.contentHash, referenceSha256: item.reference.sha256, referenceMimeType: item.reference.mimeType as "image/png" | "image/jpeg", referenceByteSize: item.reference.byteSize, referenceWidth: item.reference.width, referenceHeight: item.reference.height }],
      });
    } catch {
      const operation = await saveOutcome("uncertain", "activation", "vids_generate_delivery_uncertain", true, 1);
      return { status: "uncertain", stage: "activation", reason: operation.reason, operation };
    }
    if (response?.documentId !== intent.documentId) {
      const operation = await saveOutcome("uncertain", "activation", "vids_generate_reply_or_document_uncertain", true, 1);
      return { status: "uncertain", stage: "activation", reason: operation.reason, operation };
    }
    const activation = response.result as Awaited<ReturnType<typeof activateVidsGenerateInPage>> | undefined;
    const route = parseProviderRoute(activation?.href ?? "");
    if (!route || route.provider !== "Vids" || route.projectId !== batch.target.projectId || route.canonicalTarget !== batch.target.canonicalTarget) {
      const operation = await saveOutcome("uncertain", "activation", "vids_target_changed_during_activation", true, 1);
      return { status: "uncertain", stage: "activation", reason: operation.reason, operation };
    }
    if (!activation?.ok) {
      const attempted = activation?.activationAttempted === true;
      const reason = safeReason(activation?.reason, attempted ? "vids_generate_delivery_uncertain" : "vids_generate_preflight_changed");
      const stage = attempted ? "activation" : reason.startsWith("reference_") ? "reference_proof" : "generate_preflight";
      const operation = await saveOutcome(attempted ? "uncertain" : "blocked", stage, reason, attempted, attempted ? 1 : 0);
      return { status: operation.status, stage: operation.failureStage, reason: operation.reason, operation };
    }
    if (!activation.activationAttempted || activation.activationCount !== 1) {
      const operation = await saveOutcome("uncertain", "activation", "vids_generate_activation_unconfirmed", activation.activationAttempted, activation.activationCount);
      return { status: "uncertain", stage: "activation", reason: operation.reason, operation };
    }
      const operation = await saveOutcome("dispatched", undefined, undefined, true, 1, activation.referenceProofSource);
    return operation.status === "dispatched"
      ? { status: "dispatched", operation }
      : { status: "uncertain", stage: operation.failureStage ?? "persistence", reason: operation.reason ?? "vids_dispatch_receipt_persistence_uncertain", operation };
  }

  async function recoverPreActivationFailure(expectedInput: unknown): Promise<VidsVideoGenerateResult> {
    const parsed = VidsVideoGenerationOperationSchema.safeParse(expectedInput);
    if (!parsed.success) return { status: "blocked", stage: "preflight", reason: "generation_snapshot_invalid" };
    const expected = parsed.data;
    const id = await makeId(expected.preparedBatchId, expected.itemId);
    if (expected.id !== id || expected.status !== "blocked" || expected.failureStage !== "generate_preflight" ||
        expected.reason !== "ai_sidebar_missing" || expected.activationAttempted !== false || expected.activationCount !== 0 ||
        expected.preActivationRecovery || !expected.promptReadback.immediateMatch || !expected.promptReadback.settledMatch ||
        expected.promptReadback.expectedSha256 !== expected.promptHash || expected.promptReadback.actualSha256 !== expected.promptHash ||
        expected.promptReadback.stableReads < 3)
      return { status: "blocked", stage: "preflight", reason: "generation_failure_not_proven_pre_activation" };
    const parsedBatch = PreparedVideoBatchRecordSchema.safeParse(await deps.repositories.getPreparedVideoBatchById(expected.preparedBatchId));
    if (!parsedBatch.success || parsedBatch.data.destination !== "Vids") return { status: "blocked", stage: "preflight", reason: "prepared_vids_batch_invalid" };
    const batch = parsedBatch.data;
    const item = batch.items.find((candidate) => candidate.itemId === expected.itemId);
    if (!item || expected.workspaceId !== batch.workspaceId || expected.canonicalShotId !== item.canonicalShotId ||
        expected.promptHash !== item.contentHash || expected.referenceId !== item.reference.referenceId ||
        expected.referenceSha256 !== item.reference.sha256 || expected.tabId !== batch.target.tabId ||
        expected.canonicalTarget !== batch.target.canonicalTarget || expected.documentId !== batch.target.documentId)
      return { status: "blocked", stage: "preflight", reason: "generation_snapshot_binding_mismatch" };
    const target = await validateTarget(batch);
    if ("reason" in target || target.selected.tabId !== expected.tabId || target.selected.canonicalTarget !== expected.canonicalTarget || target.binding.documentId !== expected.documentId)
      return { status: "blocked", stage: "preflight", reason: "vids_target_changed" };
    const attachmentId = `vids:${await sha256Hex(`${batch.id}\u0000${item.itemId}`)}`;
    const attachment = VidsVideoAttachmentOperationSchema.safeParse(await deps.repositories.getVidsVideoAttachmentOperation(attachmentId));
    if (!attachment.success || attachment.data.status !== "attached" || attachment.data.preparedBatchId !== batch.id ||
        attachment.data.itemId !== item.itemId || attachment.data.referenceId !== item.reference.referenceId ||
        attachment.data.referenceSha256 !== item.reference.sha256 || attachment.data.documentId !== expected.documentId ||
        attachment.data.canonicalTarget !== expected.canonicalTarget)
      return { status: "blocked", stage: "preflight", reason: "vids_reference_not_attached_or_binding_mismatch" };
    const recoveredAt = now();
    const next: VidsVideoGenerationOperation = {
      ...expected, status: "retry_ready", updatedAt: recoveredAt,
      preActivationRecovery: {
        producer: "ai_sidebar_missing_before_generate_click", priorAttemptId: expected.attemptId,
        priorStatus: "blocked", priorFailureStage: "generate_preflight", priorReason: "ai_sidebar_missing",
        priorPromptReadback: expected.promptReadback,
        ...(expected.preIntentReferenceProofSource ? { priorPreIntentReferenceProofSource: expected.preIntentReferenceProofSource } : {}),
        priorCreatedAt: expected.createdAt, priorUpdatedAt: expected.updatedAt, recoveredAt,
      },
    };
    const committed = await deps.repositories.reconcileVidsVideoGenerationPreActivationFailure({ expected, next, expectedAttachment: attachment.data });
    if (!committed) return { status: "blocked", stage: "persistence", reason: "generation_operation_changed" };
    return { status: "retry_ready", operation: await deps.repositories.getVidsVideoGenerationOperation(id) ?? next };
  }

  async function transitionFromPrevious(preparedBatchId: string, previousItemId: string, inspectOnly = false, nextItemId?: string, checkpointedOwnership = false, phase: "inspect" | "inspect_clean" | "remove_reference" | "clear_prompt" | "verify_empty" = "inspect"): Promise<{ status: "ready" | "blocked"; reason?: string; diagnostics?: unknown }> {
    const parsed = PreparedVideoBatchRecordSchema.safeParse(await deps.repositories.getPreparedVideoBatchById(preparedBatchId));
    if (!parsed.success || parsed.data.destination !== "Vids") return { status: "blocked", reason: "prepared_vids_batch_invalid" };
    const batch = parsed.data;
    const item = batch.items.find((candidate) => candidate.itemId === previousItemId);
    if (!item) return { status: "blocked", reason: "prepared_vids_previous_item_missing" };
    const nextItem = nextItemId ? batch.items.find((candidate) => candidate.itemId === nextItemId) : undefined;
    if (nextItemId && !nextItem) return { status: "blocked", reason: "prepared_vids_next_item_missing" };
    const generation = await deps.repositories.getVidsVideoGenerationOperation(await makeId(batch.id, item.itemId));
    const attachmentId = `vids:${await sha256Hex(`${batch.id}\u0000${item.itemId}`)}`;
    const attachment = await deps.repositories.getVidsVideoAttachmentOperation(attachmentId);
    const operationBound = Boolean(generation && generation.status === "dispatched" && generation.activationAttempted === true && generation.activationCount === 1 && generation.dispatchedAt !== undefined && generation.preparedBatchId === batch.id && generation.workspaceId === batch.workspaceId && generation.itemId === item.itemId && generation.canonicalShotId === item.canonicalShotId && generation.promptHash === item.contentHash && generation.referenceId === item.reference.referenceId && generation.referenceSha256 === item.reference.sha256 && generation.tabId === batch.target.tabId && generation.canonicalTarget === batch.target.canonicalTarget && generation.documentId === batch.target.documentId);
    const attachmentBound = Boolean(attachment && attachment.status === "attached" && attachment.preparedBatchId === batch.id && attachment.itemId === item.itemId && attachment.tabId === batch.target.tabId && attachment.canonicalTarget === batch.target.canonicalTarget && attachment.documentId === batch.target.documentId && attachment.documentId === generation?.documentId && attachment.referenceId === item.reference.referenceId && attachment.referenceSha256 === item.reference.sha256);
    if (!generation || !attachment || !operationBound || !attachmentBound)
      return { status: "blocked", reason: "vids_previous_item_dispatch_binding_unverified", diagnostics: { stage: "binding", operationBound, attachmentBound, targetBound: false, documentBound: false, expectedPromptSha256: item.contentHash, expectedReferenceSha256: item.reference.sha256 } };
    const currentQueue = await deps.repositories.getVidsVideoQueue(`vids-video:${batch.id}`);
    const currentDocumentId = currentQueue?.executionDocumentRebind?.toDocumentId ?? batch.target.documentId;
    const targetBatch = currentDocumentId === batch.target.documentId ? batch : { ...batch, target: { ...batch.target, documentId: currentDocumentId }, manualSettingsDeclaration: { ...batch.manualSettingsDeclaration, documentId: currentDocumentId } };
    const target = await validateTarget(targetBatch);
    if ("reason" in target || target.binding.documentId !== currentDocumentId || target.selected.tabId !== generation.tabId || target.selected.canonicalTarget !== generation.canonicalTarget)
      return { status: "blocked", reason: phase === "inspect_clean" ? "vids_reconnect_required" : "vids_target_changed_before_composer_transition", diagnostics: { stage: "binding", operationBound, attachmentBound, targetBound: false, documentBound: target.binding?.documentId === currentDocumentId, expectedPromptSha256: item.contentHash, expectedReferenceSha256: item.reference.sha256 } };
    let checkpointBound = false;
    if (checkpointedOwnership && nextItem) {
      const queue = await deps.repositories.getVidsVideoQueue(`vids-video:${batch.id}`);
      const current = queue?.items.find((candidate) => candidate.itemId === nextItemId);
      const cp = current?.transitionCheckpoint;
      const expectedStage = phase === "clear_prompt" ? "image_removed" : phase === "verify_empty" ? "prompt_cleared" : "ownership_verified";
      checkpointBound = Boolean(queue && queue.state === "preparing" && current?.state === "transitioning" && cp && cp.previousItemId === item.itemId && cp.previousAttemptId === generation.attemptId && cp.previousReferenceId === item.reference.referenceId && cp.previousReferenceSha256 === item.reference.sha256 && cp.previousPromptHash === item.contentHash && cp.nextItemId === nextItem.itemId && cp.nextReferenceId === nextItem.reference.referenceId && cp.nextReferenceSha256 === nextItem.reference.sha256 && cp.nextPromptHash === nextItem.contentHash && cp.tabId === batch.target.tabId && cp.canonicalTarget === batch.target.canonicalTarget && cp.documentId === currentDocumentId && cp.stage === expectedStage);
      if (!checkpointBound) return { status: "blocked", reason: "vids_cleanup_checkpoint_binding_changed", diagnostics: { stage: "binding", operationBound, attachmentBound, targetBound: true, documentBound: true } };
    }
    let pageResult: Awaited<ReturnType<typeof transitionVidsComposerFromPreviousInPage>> | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Injection | undefined;
      try {
        [response] = await deps.scripting.executeScript({ target: { tabId: generation.tabId, documentIds: [currentDocumentId!] }, world: "MAIN", func: transitionVidsComposerFromPreviousInPage,
          args: [{ prompt: item.rawJsonBody, promptSha256: item.contentHash, referenceId: item.reference.referenceId, referenceCandidates: batch.items.map((candidate) => ({ referenceId: candidate.reference.referenceId, sha256: candidate.reference.sha256, mimeType: candidate.reference.mimeType as "image/png" | "image/jpeg", byteSize: candidate.reference.byteSize, width: candidate.reference.width, height: candidate.reference.height })), referenceSha256: item.reference.sha256, referenceMimeType: item.reference.mimeType as "image/png" | "image/jpeg", referenceByteSize: item.reference.byteSize, referenceWidth: item.reference.width, referenceHeight: item.reference.height, timeoutMs: 2500, inspectOnly, phase, checkpointedOwnership: checkpointBound }] });
      } catch { return { status: "blocked", reason: "vids_composer_transition_reply_uncertain", diagnostics: { stage: "injection", operationBound, attachmentBound, targetBound: true, documentBound: true, expectedPromptSha256: item.contentHash, expectedReferenceSha256: item.reference.sha256 } }; }
      if (response?.documentId !== currentDocumentId) return { status: "blocked", reason: "vids_document_changed_during_composer_transition", diagnostics: { stage: "binding", operationBound, attachmentBound, targetBound: true, documentBound: false, expectedPromptSha256: item.contentHash, expectedReferenceSha256: item.reference.sha256 } };
      pageResult = response.result as Awaited<ReturnType<typeof transitionVidsComposerFromPreviousInPage>> | undefined;
      const route = parseProviderRoute(pageResult?.href ?? "");
      if (!route || route.provider !== "Vids" || route.projectId !== batch.target.projectId || route.canonicalTarget !== batch.target.canonicalTarget) return { status: "blocked", reason: "vids_target_changed_during_composer_transition", diagnostics: { stage: "binding", operationBound, attachmentBound, targetBound: false, documentBound: true, expectedPromptSha256: item.contentHash, expectedReferenceSha256: item.reference.sha256 } };
      if (pageResult?.reason !== "vids_composer_expanded_revalidate") break;
      if (inspectOnly || attempt !== 0) return { status: "blocked", reason: "vids_composer_collapsed_or_changed", diagnostics: { ...pageResult.diagnostics, operationBound, attachmentBound, targetBound: true, documentBound: true } };
      const afterExpand = await validateTarget(targetBatch);
      if ("reason" in afterExpand || afterExpand.binding.documentId !== currentDocumentId || afterExpand.selected.tabId !== generation.tabId || afterExpand.selected.canonicalTarget !== generation.canonicalTarget)
        return { status: "blocked", reason: "vids_target_changed_after_composer_expand", diagnostics: { ...pageResult.diagnostics, operationBound, attachmentBound, targetBound: false, documentBound: afterExpand.binding?.documentId === currentDocumentId } };
    }
    const diagnostics = pageResult?.diagnostics ? { ...pageResult.diagnostics, operationBound, attachmentBound, targetBound: true, documentBound: true } : { stage: "injection", operationBound, attachmentBound, targetBound: true, documentBound: true, expectedPromptSha256: item.contentHash, expectedReferenceSha256: item.reference.sha256 };
    if (!pageResult?.ok) return { status: "blocked", reason: safeReason(pageResult?.reason, "vids_composer_transition_failed"), diagnostics };
    const after = await validateTarget(targetBatch);
    if ("reason" in after || after.binding.documentId !== currentDocumentId || after.selected.tabId !== generation.tabId || after.selected.canonicalTarget !== generation.canonicalTarget)
      return { status: "blocked", reason: "vids_target_changed_after_composer_transition", diagnostics: { ...diagnostics, stage: "binding", targetBound: false, documentBound: after.binding?.documentId === currentDocumentId } };
    return { status: "ready", diagnostics };
  }

  return { generateOnce, get, recoverPreActivationFailure, transitionFromPrevious };
}

