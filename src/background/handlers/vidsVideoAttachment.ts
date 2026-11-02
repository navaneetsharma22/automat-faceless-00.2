import { sha256Hex } from "../../domain/batches/hashPrompt";
import { MAX_REFERENCE_CAPTURE_BYTES, MAX_REFERENCE_CAPTURE_PIXELS, ReferenceAssignmentRecordSchema, sha256Bytes } from "../../domain/media/references";
import type { VidsVideoAttachmentOperation } from "../../domain/jobs/vidsVideoAttachment";
import { PreparedVideoBatchRecordSchema, VideoSettingsConfirmationSchema } from "../../shared/schemas";
import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import { CONNECTOR_PROTOCOL_VERSION } from "../../platforms/shared/contracts";
import { parseProviderRoute } from "../../platforms/shared/providerRoute";
import { inspectVidsAiComposerInPage } from "../../platforms/vids/composer";
import { uploadVidsReferenceInPage } from "../../platforms/vids/references";
import type { ExtensionRepositories } from "../../storage/repositories";

type Injection = { documentId?: string; frameId?: number; result?: unknown };
type VidsScriptPort = {
  executeScript(input: {
    target: { tabId: number; documentIds: string[] };
    world: "MAIN";
    func: (...args: never[]) => unknown;
    args?: unknown[];
  }): Promise<Injection[]>;
};
type BoundedFailure = { status: "not_started" | "blocked" | "uncertain" | "attached"; stage?: string; reason?: string; operation?: VidsVideoAttachmentOperation };

function encoded(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function resultError(reason: string): BoundedFailure {
  return { status: "not_started", stage: "preflight", reason: /^[a-z0-9_]{1,64}$/.test(reason) ? reason : "vids_attachment_preflight_failed" };
}

/** P10.1 exact prepared-byte attachment. No prompt, settings, or Generate operation exists here. */
export function createVidsVideoAttachmentHandler(deps: {
  repositories: ExtensionRepositories;
  scripting: VidsScriptPort;
  getTab: (tabId: number) => Promise<{ id?: number; url?: string }>;
  revalidate: () => Promise<unknown>;
  now?: () => number;
  makeUploadOperationId?: () => string;
}) {
  const now = deps.now ?? Date.now;
  const operationId = async (batchId: string, itemId: string) => `vids:${await sha256Hex(`${batchId}\u0000${itemId}`)}`;

  async function validateTarget(batch: { target: { tabId: number; canonicalTarget: string; projectId?: string; documentId?: string }; manualSettingsDeclaration: unknown }) {
    try {
      await deps.revalidate();
    } catch {
      return { reason: "vids_connection_revalidation_failed" } as const;
    }
    const selected = await deps.repositories.getSelectedTarget("Vids");
    const binding = selected?.verificationBinding;
    const confirmation = VideoSettingsConfirmationSchema.safeParse(batch.manualSettingsDeclaration);
    if (!selected || selected.provider !== "Vids" || selected.verification !== "verified" || selected.connectionState !== "verified" || !binding ||
        !confirmation.success || confirmation.data.destination !== "Vids" ||
        selected.tabId !== batch.target.tabId || selected.canonicalTarget !== batch.target.canonicalTarget ||
        confirmation.data.tabId !== selected.tabId || confirmation.data.canonicalTarget !== selected.canonicalTarget ||
        confirmation.data.projectId !== batch.target.projectId || confirmation.data.documentId !== batch.target.documentId ||
        binding.provider !== "Vids" || binding.tabId !== selected.tabId || binding.canonicalTarget !== selected.canonicalTarget ||
        binding.projectId !== batch.target.projectId || binding.documentId !== batch.target.documentId ||
        binding.frameId !== 0 || binding.extensionBuildId !== BUILD_ID || binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
        binding.connectorBuildId !== BUILD_ID || binding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION)
      return { reason: "vids_target_or_confirmation_mismatch" } as const;
    let tab: { id?: number; url?: string };
    try { tab = await deps.getTab(selected.tabId); } catch { return { reason: "vids_selected_tab_unavailable" } as const; }
    const tabRoute = tab.id === selected.tabId ? parseProviderRoute(tab.url ?? "") : undefined;
    if (!tabRoute || tabRoute.provider !== "Vids" || tabRoute.projectId !== binding.projectId || tabRoute.canonicalTarget !== selected.canonicalTarget)
      return { reason: "vids_target_changed" } as const;
    return { selected, binding } as const;
  }

  async function inspectTarget(selected: { tabId: number; canonicalTarget: string; verificationBinding?: { projectId: string } }, documentId: string) {
    try {
      const [response] = await deps.scripting.executeScript({
        target: { tabId: selected.tabId, documentIds: [documentId] },
        world: "MAIN",
        func: inspectVidsAiComposerInPage,
      });
      if (response?.documentId !== documentId) return { reason: "vids_document_changed" } as const;
      const inspection = response.result as ReturnType<typeof inspectVidsAiComposerInPage> | undefined;
      const route = parseProviderRoute(inspection?.href ?? "");
      if (!route || route.provider !== "Vids" || route.projectId !== selected.verificationBinding?.projectId || route.canonicalTarget !== selected.canonicalTarget) return { reason: "vids_target_changed" } as const;
      return { inspection, href: inspection?.href } as const;
    } catch {
      return { reason: "vids_document_unavailable" } as const;
    }
  }

  async function get(preparedBatchId: string, itemId: string): Promise<BoundedFailure> {
    const id = await operationId(preparedBatchId, itemId);
    const operation = await deps.repositories.getVidsVideoAttachmentOperation(id);
    if (!operation) return { status: "not_started" };
    return { status: operation.status === "action_intent" ? "uncertain" : operation.status, stage: operation.failureStage, reason: operation.reason, operation };
  }

  async function attach(preparedBatchId: string, itemId: string): Promise<BoundedFailure> {
    const id = await operationId(preparedBatchId, itemId);
    const existing = await deps.repositories.getVidsVideoAttachmentOperation(id);
    if (existing) return { status: existing.status === "action_intent" ? "uncertain" : existing.status, stage: existing.failureStage, reason: existing.reason ?? "operation_already_exists", operation: existing };

    const parsedBatch = PreparedVideoBatchRecordSchema.safeParse(await deps.repositories.getPreparedVideoBatchById(preparedBatchId));
    if (!parsedBatch.success || parsedBatch.data.destination !== "Vids") return resultError("prepared_vids_batch_required");
    const batch = parsedBatch.data;
    const item = batch.items.find((candidate) => candidate.itemId === itemId);
    if (!item || !/^[1-9][0-9]*$/.test(item.canonicalShotId)) return resultError("prepared_vids_item_missing");
    const pinned = await deps.repositories.getReferenceById(item.reference.referenceId);
    if (!pinned || !ReferenceAssignmentRecordSchema.safeParse(pinned).success ||
        pinned.referenceId !== item.reference.referenceId || pinned.assignmentVersion !== item.reference.assignmentVersion ||
        pinned.workspaceId !== batch.workspaceId || pinned.batchId !== batch.imageSourceBatchId ||
        pinned.batchSourceHash !== batch.imageSourceBatchHash || pinned.shotId !== item.canonicalShotId ||
        pinned.sha256 !== item.reference.sha256 || pinned.mimeType !== item.reference.mimeType ||
        pinned.byteSize !== item.reference.byteSize || pinned.width !== item.reference.width || pinned.height !== item.reference.height)
      return resultError("prepared_reference_binding_mismatch");
    if (!(["image/png", "image/jpeg"] as string[]).includes(pinned.mimeType) || pinned.byteSize > MAX_REFERENCE_CAPTURE_BYTES || pinned.width * pinned.height > MAX_REFERENCE_CAPTURE_PIXELS)
      return resultError("reference_format_or_limits_unsupported");
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await pinned.bytes.arrayBuffer()); } catch { return resultError("reference_bytes_unavailable"); }
    if (bytes.byteLength !== pinned.byteSize || bytes.byteLength !== item.reference.byteSize || await sha256Bytes(bytes) !== item.reference.sha256)
      return resultError("reference_bytes_integrity_failed");

    const before = await validateTarget(batch);
    if ("reason" in before) return resultError(before.reason ?? "vids_target_validation_failed");
    const documentId = before.binding.documentId;
    if (!documentId) return resultError("vids_document_binding_missing");
    const initialInspection = await inspectTarget(before.selected, documentId);
    if ("reason" in initialInspection) return resultError(initialInspection.reason ?? "vids_composer_inspection_failed");
    if (initialInspection.inspection?.state !== "ready") return resultError(initialInspection.inspection?.reason ?? "vids_composer_unavailable");
    const current = await validateTarget(batch);
    if ("reason" in current) return resultError(current.reason ?? "vids_target_validation_failed");
    if (current.binding.documentId !== documentId || current.selected.tabId !== before.selected.tabId || current.selected.canonicalTarget !== before.selected.canonicalTarget)
      return resultError("vids_target_changed_before_upload");

    const timestamp = now();
    const operation: VidsVideoAttachmentOperation = {
      id, preparedBatchId, workspaceId: batch.workspaceId, itemId, shotId: item.canonicalShotId,
      referenceId: pinned.referenceId, assignmentVersion: pinned.assignmentVersion, referenceSha256: pinned.sha256,
      mimeType: pinned.mimeType as "image/png" | "image/jpeg", byteSize: pinned.byteSize, width: pinned.width, height: pinned.height,
      tabId: current.selected.tabId, canonicalTarget: current.selected.canonicalTarget, documentId,
      status: "action_intent", createdAt: timestamp, updatedAt: timestamp,
    };
    if (!await deps.repositories.claimVidsVideoAttachmentOperation(operation)) {
      const raced = await deps.repositories.getVidsVideoAttachmentOperation(id);
      return { status: "uncertain", reason: "attachment_operation_already_claimed", operation: raced };
    }

    const uncertain = async (stage: "upload" | "target_revalidation" | "persistence", reason: string): Promise<BoundedFailure> => {
      const next: VidsVideoAttachmentOperation = { ...operation, status: "uncertain", failureStage: stage, reason, updatedAt: now() };
      await deps.repositories.updateVidsVideoAttachmentOperation({ expected: operation, next }).catch(() => false);
      const saved = await deps.repositories.getVidsVideoAttachmentOperation(id);
      return { status: "uncertain", stage, reason, operation: saved ?? next };
    };

    const immediatelyBefore = await validateTarget(batch);
    if ("reason" in immediatelyBefore || immediatelyBefore.binding.documentId !== operation.documentId)
      return uncertain("target_revalidation", "vids_target_changed_before_upload");
    let upload: { ok: boolean; submitted?: boolean; reason?: string; href: string; previewLoaded?: boolean; previewWidth?: number; previewHeight?: number; removalControlPresent?: boolean } | undefined;
    try {
      const responses = await deps.scripting.executeScript({
        target: { tabId: operation.tabId, documentIds: [operation.documentId] },
        world: "MAIN",
        func: uploadVidsReferenceInPage,
        args: [{ base64: encoded(bytes), mimeType: operation.mimeType, byteSize: operation.byteSize, width: operation.width, height: operation.height, sha256: operation.referenceSha256, timeoutMs: 20_000 }],
      });
      if (responses[0]?.documentId !== operation.documentId) return uncertain("upload", "vids_document_changed_during_upload");
      upload = responses[0]?.result as typeof upload;
    } catch {
      return uncertain("upload", "vids_upload_delivery_uncertain");
    }
    if (!upload?.ok || !upload.submitted || !upload.previewLoaded || !upload.removalControlPresent || !upload.previewWidth || !upload.previewHeight)
      return uncertain("upload", upload?.reason && /^[a-z0-9_]{1,64}$/.test(upload.reason) ? upload.reason : "vids_upload_result_unconfirmed");
    const after = await validateTarget(batch);
    if ("reason" in after || after.binding.documentId !== operation.documentId || after.selected.tabId !== operation.tabId || after.selected.canonicalTarget !== operation.canonicalTarget)
      return uncertain("target_revalidation", "vids_target_changed_after_upload");
    const readback = await inspectTarget(after.selected, operation.documentId);
    if ("reason" in readback || readback.inspection?.state !== "existing_preview_unbound" || readback.inspection.previewCount !== 1 || readback.inspection.removalControlCount !== 1 || !readback.inspection.previewLoaded || readback.inspection.previewWidth !== upload.previewWidth || readback.inspection.previewHeight !== upload.previewHeight)
      return uncertain("upload", "vids_uploaded_preview_readback_failed");
    const beforePersistence = await validateTarget(batch);
    if ("reason" in beforePersistence || beforePersistence.binding.documentId !== operation.documentId || beforePersistence.selected.tabId !== operation.tabId || beforePersistence.selected.canonicalTarget !== operation.canonicalTarget)
      return uncertain("target_revalidation", "vids_target_changed_before_persistence");

    const completedAt = now();
    const next: VidsVideoAttachmentOperation = {
      ...operation, status: "attached", updatedAt: completedAt,
      uploadEvidence: {
        mechanism: "verified_document_file_input", exactBytesSha256: operation.referenceSha256, byteSize: operation.byteSize,
        mimeType: operation.mimeType, fileInputCount: 1, inputChangeDispatched: true, previewLoaded: true,
        previewWidth: upload.previewWidth, previewHeight: upload.previewHeight, removalControlPresent: true,
        uploadOperationId: deps.makeUploadOperationId?.() ?? crypto.randomUUID(), uploadedAt: completedAt,
      },
    };
    try {
      if (!await deps.repositories.updateVidsVideoAttachmentOperation({ expected: operation, next }))
        return uncertain("persistence", "vids_attachment_operation_changed");
      const saved = await deps.repositories.getVidsVideoAttachmentOperation(id);
      if (!saved || JSON.stringify(saved) !== JSON.stringify(next)) return uncertain("persistence", "vids_attachment_persistence_failed");
      return { status: "attached", operation: saved };
    } catch {
      return uncertain("persistence", "vids_attachment_persistence_failed");
    }
  }

  return { attach, get };
}
