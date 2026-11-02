import type { ExtensionRepositories } from "../../storage/repositories";
import {
  ReferenceAssignmentRecordSchema,
  ReferenceByteComparisonDiagnosticSchema,
  sha256Bytes,
} from "../../domain/media/references";
import {
  PreparedVideoBatchRecordSchema,
  VideoSettingsConfirmationSchema,
} from "../../shared/schemas";
import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import { CONNECTOR_PROTOCOL_VERSION } from "../../platforms/shared/contracts";
import { flowTabFromUrl } from "../../platforms/flow/connection";
import {
  flowReferenceCaptureInPage,
  flowResolveOriginalImageUrlInPage,
  flowRestoreGalleryAfterOriginalResolutionInPage,
} from "../../platforms/flow/references";
import {
  fetchFlowReferenceBytes,
  FLOW_CONTENT_MEDIA_HOST,
  flowReferenceResource,
  resolveFlowReferenceFetcher,
} from "../../platforms/flow/referenceResource";
import { flowVideoChipMediaIdFromImageUrl } from "../../platforms/flow/video";
import { FlowVideoQueueRecordSchema } from "../../domain/jobs/videoQueue";

type Script = {
  executeScript: (
    input: unknown,
  ) => Promise<Array<{ documentId?: string; result?: unknown }>>;
};
const operationId = (batch: string, item: string) => `${batch}:${item}`;
const PRECLICK_FAILURE_RECORD = {
  preparedBatchId: "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179",
  itemId: "import:default:video:item:0",
  referenceId: "014ebcff-06e3-4ac2-b980-568f0755febf",
  updatedAt: 1793605485721,
} as const;
const ACQUISITION_REASONS = new Set([
  "reference_source_invalid",
  "reference_origin_unsupported",
  "reference_media_id_missing_or_path_invalid",
  "reference_media_id_mismatch",
  "reference_permission_inspection_failed",
  "reference_media_permission_needed",
  "reference_capture_cancelled",
  "reference_resource_timeout",
  "reference_resource_transport_failed",
  "reference_redirect_unsupported",
  "reference_resource_expired",
  "reference_resource_http_failed",
  "reference_format_unsupported",
  "reference_resource_oversized",
  "reference_resource_empty",
  "reference_signature_invalid",
  "reference_dimensions_invalid",
  "reference_resource_failed",
]);

/** The read-only detail overlay uses a project-scoped /edit/<opaque-id> route. */
function isBoundFlowProjectUrl(rawUrl: string | undefined, projectId: string): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname !== "flow.google.com" || url.username || url.password) return false;
    const escapedProjectId = projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^/(?:u/[0-9]+/)?project/${escapedProjectId}(?:/edit/[A-Za-z0-9_-]+)?/?$`).test(url.pathname);
  } catch {
    return false;
  }
}

/** Read only the attachment structure; provider settings are owned by the user. */
export function flowVideoAttachmentStructurePreflightInPage(): {
  ok: boolean;
  reason?: string;
  href: string;
} {
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      element.isConnected &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };
  const href = location.href;
  const roots = [
    ...document.querySelectorAll<HTMLElement>("flow-base-prompt-box"),
  ].filter(visible);
  if (roots.length !== 1)
    return { ok: false, reason: "composer_unavailable", href };
  const attachmentControls = [
    ...roots[0]!.querySelectorAll<HTMLButtonElement>(
      "button[aria-label='Add ingredients to the prompt box']",
    ),
  ].filter(visible);
  if (
    attachmentControls.length !== 1 ||
    attachmentControls[0]!.disabled ||
    attachmentControls[0]!.getAttribute("aria-disabled") === "true"
  )
    return { ok: false, reason: "attachment_control_unavailable", href };
  return { ok: true, href };
}

/** In-page picker action. The gallery URL is identity evidence, not the acquisition URL. */
export async function flowVideoAttachmentActionInPage(
  expectedId: string,
  expectedGalleryUrl: string,
): Promise<{ ok: boolean; already?: boolean; reason?: string }> {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return el.isConnected && r.width > 0 && r.height > 0 &&
      getComputedStyle(el).visibility !== "hidden";
  };
  const roots = [...document.querySelectorAll("flow-base-prompt-box")].filter(visible);
  const chips = () => roots[0]
    ? [...roots[0].querySelectorAll<HTMLButtonElement>("button[aria-label='Ingredient']")]
    : [];
  const idFromChip = (chip: HTMLButtonElement) => {
    try {
      const u = new URL(chip.querySelector("img[alt='Ingredient image']")?.getAttribute("src") ?? "");
      return u.protocol === "https:" && u.hostname === "flow-content.google"
        ? /^\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(u.pathname)?.[1]?.toLowerCase()
        : undefined;
    } catch { return undefined; }
  };
  const read = () => {
    const list = document.querySelector("[role=listbox][aria-label='Asset list']");
    const preview = document.querySelector<HTMLImageElement>("img.detail-preview-image[alt^='Preview of']");
    const panel = preview?.parentElement?.closest("section,[data-picker-detail-scope]") ?? preview?.parentElement?.parentElement;
    const row = [...(list?.querySelectorAll<HTMLButtonElement>("button[role=option].asset-item") ?? [])]
      .find((r) => [...r.querySelectorAll<HTMLImageElement>("img.asset-thumbnail-image")]
        .some((img) => (img.currentSrc || img.src) === expectedGalleryUrl));
    const action = [...(panel?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .filter((b) => b.textContent?.trim().toLowerCase() === "add to prompt" && visible(b));
    return { list, preview, row, action };
  };

  if (roots.length !== 1) return { ok: false, reason: "composer_unavailable_after_preflight" };
  const attachmentControls = [...roots[0]!.querySelectorAll<HTMLButtonElement>("button[aria-label='Add ingredients to the prompt box']")].filter(visible);
  if (attachmentControls.length !== 1 || attachmentControls[0]!.disabled || attachmentControls[0]!.getAttribute("aria-disabled") === "true")
    return { ok: false, reason: "attachment_control_unavailable" };
  let existing = chips();
  if (existing.some((chip) => !idFromChip(chip))) return { ok: false, reason: "existing_chip_identity_unreadable" };
  if (existing.filter((chip) => idFromChip(chip) === expectedId).length > 1) return { ok: false, reason: "duplicate_matching_chips" };
  if (existing.length && !(existing.length === 1 && idFromChip(existing[0]!) === expectedId && existing[0]!.getAttribute("aria-busy") === "false"))
    return { ok: false, reason: "existing_chip_conflict" };
  if (existing.length === 1) return { ok: true, already: true };

  if (!document.querySelector("[role=listbox][aria-label='Asset list']")) {
    const open = roots[0]!.querySelector<HTMLButtonElement>("button[aria-label='Add ingredients to the prompt box']");
    if (!open || !visible(open)) return { ok: false, reason: "picker_missing" };
    open.click();
  }

  // First resolve only the exact thumbnail identity. Detail preview and Add
  // are expected to appear after selecting the row, so they are not gates here.
  let rowSelected = false;
  for (let i = 0; i < 40; i++) {
    const p = read();
    if (p.row) {
      p.row.click();
      rowSelected = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!rowSelected) return { ok: false, reason: "candidate_missing_or_virtualized" };

  // Wait for the selected gallery thumbnail's detail preview and its unique
  // Add control to settle before any activation.
  let selected = read();
  for (let i = 0; i < 40; i++) {
    selected = read();
    if (selected.row && selected.preview &&
        (selected.preview.currentSrc || selected.preview.src) === expectedGalleryUrl &&
        selected.action.length === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!selected.row || !selected.preview ||
      (selected.preview.currentSrc || selected.preview.src) !== expectedGalleryUrl ||
      selected.action.length !== 1)
    return { ok: false, reason: "candidate_missing_or_virtualized" };
  existing = chips();
  if (existing.length) return { ok: false, reason: "chip_conflict_before_add" };
  selected.action[0]!.click();
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    existing = chips();
    if (existing.some((chip) => !idFromChip(chip))) return { ok: false, reason: "chip_identity_unreadable_after_add" };
    if (existing.length === 1 && idFromChip(existing[0]!) === expectedId && existing[0]!.getAttribute("aria-busy") === "false")
      return { ok: true, already: false };
  }
  return { ok: false, reason: "attachment_uncertain" };
}

/** Worker-owned attachment caller. The page DOM is accessed only through exact document-targeted script injections. */
export function createFlowVideoAttachmentHandler(deps: {
  repositories: ExtensionRepositories;
  scripting: Script;
  getTab: (tabId: number) => Promise<{ id?: number; url?: string }>;
  revalidate: () => Promise<unknown>;
  hasMediaHostPermission?: (permission: string) => Promise<boolean>;
  fetchResource?: typeof fetch;
}) {
  const fetcher = resolveFlowReferenceFetcher(deps.fetchResource);
  type CandidateAcquisition = {
    bytes: Uint8Array;
    mimeType: string;
    width?: number;
    height?: number;
    route: "verified_document_same_origin" | "scoped_extension_fetch" | "verified_detail_original_extension_fetch";
  };
  async function acquireCandidateBytes(input: {
    tabId: number;
    documentId: string;
    projectId: string;
    documentHref: string;
    galleryUrl: string;
    mediaId: string;
  }): Promise<CandidateAcquisition> {
    const target = { tabId: input.tabId, documentIds: [input.documentId] };
    const documentOrigin = new URL(input.documentHref).origin;
    const observed = new URL(input.galleryUrl);
    const isAsbRepresentation = observed.protocol === "https:" && observed.hostname === "flow.google.com" && /^\/asb(?:\/|$)/.test(observed.pathname);
    const extensionFetch = async (url: string, route: CandidateAcquisition["route"]): Promise<CandidateAcquisition> => {
      const fetched = await fetchFlowReferenceBytes({
        url, mediaId: input.mediaId, signal: new AbortController().signal,
        hasPermission: deps.hasMediaHostPermission ?? (async (permission) => {
          if (typeof chrome === "undefined" || !chrome.permissions?.contains) throw new Error("permission_api_unavailable");
          return chrome.permissions.contains({ origins: [permission] });
        }),
        fetcher,
      });
      return { bytes: fetched.bytes, mimeType: fetched.mimeType, route };
    };

    if (isAsbRepresentation) {
      let resolution: { ok?: boolean; opened?: boolean; url?: string; href?: string; code?: string } | undefined;
      let acquired: CandidateAcquisition | undefined;
      let failure: string | undefined;
      try {
        const result = await deps.scripting.executeScript({
          target, world: "MAIN", func: flowResolveOriginalImageUrlInPage,
          args: [{ mediaId: input.mediaId, galleryUrl: input.galleryUrl }],
        });
        if (result[0]?.documentId !== input.documentId) throw new Error("target_changed");
        resolution = result[0]?.result as typeof resolution;
        if (!resolution?.ok || !resolution.url || !resolution.href)
          throw new Error(resolution?.code && /^[a-z0-9_]{1,64}$/.test(resolution.code) ? resolution.code : "reference_detail_unavailable");
        if (!isBoundFlowProjectUrl(resolution.href, input.projectId))
          throw new Error("target_changed");
        const original = flowReferenceResource(resolution.url, input.mediaId);
        if (new URL(resolution.url).hostname !== FLOW_CONTENT_MEDIA_HOST)
          throw new Error("reference_origin_unsupported");
        acquired = await extensionFetch(original.fetchUrl, "verified_detail_original_extension_fetch");
      } catch (error) {
        failure = error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : "reference_resource_failed";
      } finally {
        if (resolution?.opened) {
          try {
            const restored = await deps.scripting.executeScript({
              target, world: "MAIN", func: flowRestoreGalleryAfterOriginalResolutionInPage,
              args: [{ mediaId: input.mediaId }],
            });
            const result = restored[0]?.result as { ok?: boolean; href?: string; code?: string } | undefined;
            if (restored[0]?.documentId !== input.documentId || !result?.ok ||
                !isBoundFlowProjectUrl(result.href, input.projectId))
              failure = result?.code ?? "reference_gallery_restore_failed";
          } catch {
            failure = "reference_gallery_restore_failed";
          }
        }
      }
      if (failure) throw new Error(failure);
      if (!acquired) throw new Error("reference_resource_failed");
      return acquired;
    }

    if (observed.origin === documentOrigin) {
      const captured = await deps.scripting.executeScript({
        target, world: "MAIN", func: flowReferenceCaptureInPage,
        args: [{ action: "fetch", captureOperationId: crypto.randomUUID(), sourceUrl: input.galleryUrl, expectedOrigin: documentOrigin }],
      });
      if (captured[0]?.documentId !== input.documentId) throw new Error("target_changed");
      const payload = captured[0]?.result as { ok?: boolean; data?: string; code?: string; mimeType?: string; width?: number; height?: number } | undefined;
      if (!payload?.ok || !payload.data || !payload.mimeType) throw new Error(payload?.code ?? "candidate_capture_failed");
      const binary = atob(payload.data);
      return {
        bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)), mimeType: payload.mimeType,
        width: payload.width, height: payload.height, route: "verified_document_same_origin",
      };
    }
    return extensionFetch(input.galleryUrl, "scoped_extension_fetch");
  }
  async function status(preparedBatchId: string, itemId: string) {
    const op = await deps.repositories.getFlowVideoAttachmentOperation(
      operationId(preparedBatchId, itemId),
    );
    return op
      ? {
          status: op.status === "action_intent" ? "uncertain" : op.status,
          reason: op.reason,
          operation: {
            id: op.id,
            preparedBatchId: op.preparedBatchId,
            itemId: op.itemId,
            referenceId: op.referenceId,
            status: op.status,
            reason: op.reason,
            updatedAt: op.updatedAt,
            preActivationEvidence: op.preActivationEvidence,
            verifiedAttachment: op.verifiedAttachment,
            videoGeneration: op.videoGeneration,
          },
        }
      : { status: "not_started" };
  }
  async function verifyAttachedReference(preparedBatchId: string, itemId: string) {
    const id = operationId(preparedBatchId, itemId);
    const op = await deps.repositories.getFlowVideoAttachmentOperation(id);
    if (!op || (op.status !== "uncertain" && op.status !== "action_intent"))
      return { status: "blocked", reason: "verification_operation_not_uncertain" };
    const raw = await deps.repositories.getPreparedVideoBatchById(preparedBatchId);
    const parsed = PreparedVideoBatchRecordSchema.safeParse(raw);
    if (!parsed.success || parsed.data.destination !== "Flow")
      return { status: "blocked", reason: "prepared_flow_item_required" };
    const batch = parsed.data;
    const item = batch.items.find((candidate) => candidate.itemId === itemId);
    if (
      !item ||
      op.preparedBatchId !== preparedBatchId ||
      op.itemId !== itemId ||
      op.referenceId !== item.reference.referenceId
    )
      return { status: "blocked", reason: "prepared_reference_binding_mismatch" };
    const confirmation = VideoSettingsConfirmationSchema.safeParse(
      (raw as { manualSettingsDeclaration?: unknown }).manualSettingsDeclaration,
    );
    if (
      !confirmation.success ||
      confirmation.data.destination !== "Flow" ||
      confirmation.data.tabId !== batch.target.tabId ||
      confirmation.data.canonicalTarget !== batch.target.canonicalTarget ||
      confirmation.data.projectId !== batch.target.projectId ||
      confirmation.data.documentId !== batch.target.documentId
    )
      return { status: "blocked", reason: "manual_settings_confirmation_binding_mismatch" };
    const pinned = await deps.repositories.getReferenceById(item.reference.referenceId);
    if (
      !pinned ||
      !ReferenceAssignmentRecordSchema.safeParse(pinned).success ||
      pinned.referenceId !== item.reference.referenceId ||
      pinned.assignmentVersion !== item.reference.assignmentVersion ||
      pinned.sha256 !== item.reference.sha256 ||
      pinned.byteSize !== item.reference.byteSize ||
      pinned.mimeType !== item.reference.mimeType ||
      pinned.width !== item.reference.width ||
      pinned.height !== item.reference.height ||
      pinned.tabId !== batch.target.tabId ||
      pinned.flowProjectId !== batch.target.projectId ||
      pinned.documentId !== batch.target.documentId ||
      !pinned.providerAssetId
    )
      return { status: "blocked", reason: "pinned_reference_mismatch" };
    const bytes = new Uint8Array(await pinned.bytes.arrayBuffer());
    if (
      bytes.byteLength !== item.reference.byteSize ||
      (await sha256Bytes(bytes)) !== item.reference.sha256
    )
      return { status: "blocked", reason: "reference_bytes_corrupt" };

    await deps.revalidate();
    const selected = await deps.repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (
      !selected || selected.verification !== "verified" || !binding ||
      selected.tabId !== batch.target.tabId ||
      selected.canonicalTarget !== batch.target.canonicalTarget ||
      binding.provider !== "Flow" ||
      binding.tabId !== selected.tabId ||
      binding.canonicalTarget !== selected.canonicalTarget ||
      binding.projectId !== batch.target.projectId ||
      binding.documentId !== batch.target.documentId ||
      binding.extensionBuildId !== BUILD_ID ||
      binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
      binding.connectorBuildId !== BUILD_ID ||
      binding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION
    )
      return { status: "blocked", reason: "target_changed" };
    const target = { tabId: selected.tabId, documentIds: [binding.documentId] };
    const tab = await deps.getTab(selected.tabId);
    const route = flowTabFromUrl(selected.tabId, "Flow", tab.url);
    if (!route || route.projectId !== binding.projectId || route.canonicalTarget !== selected.canonicalTarget)
      return { status: "blocked", reason: "target_changed" };
    const check = await deps.scripting.executeScript({
      target,
      world: "ISOLATED",
      func: () => {
        const visible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return element.isConnected && rect.width > 0 && rect.height > 0 &&
            style.display !== "none" && style.visibility !== "hidden";
        };
        const roots = [...document.querySelectorAll<HTMLElement>("flow-base-prompt-box")].filter(visible);
        if (roots.length !== 1) return { ok: false, reason: "composer_unavailable" };
        const chips = [...roots[0]!.querySelectorAll<HTMLButtonElement>("button[aria-label='Ingredient']")].filter(visible);
        const images = chips.map((chip) => {
          const image = chip.querySelector<HTMLImageElement>("img[alt='Ingredient image']");
          return { busy: chip.getAttribute("aria-busy"), url: image?.currentSrc || image?.src || image?.getAttribute("src") };
        });
        return { ok: true, href: location.href, count: chips.length, chips: images };
      },
    });
    const state = check[0]?.result as { ok?: boolean; href?: string; count?: number; chips?: Array<{ busy?: string | null; url?: string }> } | undefined;
    if (
      check[0]?.documentId !== binding.documentId ||
      !state?.href ||
      flowTabFromUrl(selected.tabId, "Flow", state.href)?.projectId !== binding.projectId
    )
      return { status: "uncertain", reason: "verification_document_mismatch" };
    const chip = state.chips?.[0];
    const mediaId = flowVideoChipMediaIdFromImageUrl(chip?.url ?? "");
    if (
      !state.ok || state.count !== 1 || state.chips?.length !== 1 ||
      chip?.busy !== "false" || mediaId !== pinned.providerAssetId
    )
      return { status: "uncertain", reason: "verification_chip_not_exact_ready" };

    await deps.revalidate();
    const latest = await deps.repositories.getSelectedTarget("Flow");
    const latestTab = await deps.getTab(selected.tabId);
    const latestRoute = flowTabFromUrl(selected.tabId, "Flow", latestTab.url);
    if (
      latest?.verification !== "verified" || latest.tabId !== selected.tabId ||
      latest.canonicalTarget !== selected.canonicalTarget ||
      latest.verificationBinding?.provider !== "Flow" ||
      latest.verificationBinding?.tabId !== selected.tabId ||
      latest.verificationBinding?.canonicalTarget !== selected.canonicalTarget ||
      latest.verificationBinding?.documentId !== binding.documentId ||
      latest.verificationBinding?.projectId !== binding.projectId ||
      latest.verificationBinding?.extensionBuildId !== BUILD_ID ||
      latest.verificationBinding?.extensionProtocolVersion !== PROTOCOL_VERSION ||
      latest.verificationBinding?.connectorBuildId !== BUILD_ID ||
      latest.verificationBinding?.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION ||
      !latestRoute || latestRoute.projectId !== binding.projectId ||
      latestRoute.canonicalTarget !== selected.canonicalTarget
    )
      return { status: "uncertain", reason: "verification_target_changed" };
    const verifiedAt = Date.now();
    const updated = await deps.repositories.markFlowVideoAttachmentVerified({
      expected: op,
      documentId: binding.documentId,
      mediaId,
      verifiedAt,
    });
    if (!updated) return { status: "uncertain", reason: "operation_changed" };
    return {
      status: "attached",
      reason: op.reason,
      operation: await deps.repositories.getFlowVideoAttachmentOperation(id),
    };
  }
  async function reconcilePreClickFailure(input: {
    preparedBatchId: string;
    itemId: string;
    expectedStatus: "uncertain";
    expectedReason: "composer_unsupported";
    expectedReferenceId: string;
    expectedUpdatedAt: number;
  }) {
    if (
      input.preparedBatchId !== PRECLICK_FAILURE_RECORD.preparedBatchId ||
      input.itemId !== PRECLICK_FAILURE_RECORD.itemId ||
      input.expectedReferenceId !== PRECLICK_FAILURE_RECORD.referenceId ||
      input.expectedStatus !== "uncertain" ||
      input.expectedReason !== "composer_unsupported" ||
      input.expectedUpdatedAt !== PRECLICK_FAILURE_RECORD.updatedAt
    )
      return { status: "blocked", reason: "reconciliation_not_applicable" };
    const prepared = await deps.repositories.getPreparedVideoBatchById(
      input.preparedBatchId,
    );
    const preparedBatch = PreparedVideoBatchRecordSchema.safeParse(prepared);
    const preparedItem = preparedBatch.success
      ? preparedBatch.data.items.find((item) => item.itemId === input.itemId)
      : undefined;
    if (
      !preparedBatch.success ||
      preparedBatch.data.destination !== "Flow" ||
      !preparedItem ||
      preparedItem.reference.referenceId !== input.expectedReferenceId
    )
      return {
        status: "blocked",
        reason: "prepared_reference_binding_mismatch",
      };
    const reconciled =
      await deps.repositories.reconcileFlowVideoAttachmentPreClickFailure({
        expected: {
          id: operationId(input.preparedBatchId, input.itemId),
          preparedBatchId: input.preparedBatchId,
          itemId: input.itemId,
          referenceId: input.expectedReferenceId,
          status: input.expectedStatus,
          reason: input.expectedReason,
          updatedAt: input.expectedUpdatedAt,
        },
        reconciledAt: Date.now(),
      });
    if (!reconciled)
      return { status: "uncertain", reason: "operation_changed" };
    return {
      status: "reconciled",
      reason: "pre_activation_failure_reconciled",
      operation: await deps.repositories.getFlowVideoAttachmentOperation(
        operationId(input.preparedBatchId, input.itemId),
      ),
    };
  }

  async function inspectReferenceBytes(preparedBatchId: string, itemId: string) {
    const queueRaw = await deps.repositories.getFlowVideoQueue(`flow-video:${preparedBatchId}`);
    const queue = FlowVideoQueueRecordSchema.safeParse(queueRaw);
    const queueItem = queue.success ? queue.data.items.find((entry) => entry.itemId === itemId) : undefined;
    if (
      !queue.success || queue.data.preparedBatchId !== preparedBatchId ||
      !queueItem || queueItem.state !== "failed" || queueItem.reason !== "candidate_bytes_mismatch"
    ) return { status: "blocked", reason: "candidate_mismatch_queue_item_required" };

    const batchResult = PreparedVideoBatchRecordSchema.safeParse(
      await deps.repositories.getPreparedVideoBatchById(preparedBatchId),
    );
    if (!batchResult.success || batchResult.data.id !== preparedBatchId || batchResult.data.destination !== "Flow")
      return { status: "blocked", reason: "prepared_flow_item_required" };
    const batch = batchResult.data;
    const item = batch.items.find((entry) => entry.itemId === itemId);
    if (!item || item.reference.referenceId !== queueItem.referenceId || item.contentHash !== queueItem.promptHash)
      return { status: "blocked", reason: "prepared_reference_binding_mismatch" };
    const operation = await deps.repositories.getFlowVideoAttachmentOperation(operationId(preparedBatchId, itemId));
    if (operation && (operation.referenceId !== item.reference.referenceId || operation.videoGeneration))
      return { status: "blocked", reason: "attachment_operation_binding_mismatch" };

    const pinned = await deps.repositories.getReferenceById(item.reference.referenceId);
    if (
      !pinned || !ReferenceAssignmentRecordSchema.safeParse(pinned).success ||
      pinned.referenceId !== item.reference.referenceId || pinned.assignmentVersion !== item.reference.assignmentVersion ||
      pinned.sha256 !== item.reference.sha256 || pinned.mimeType !== item.reference.mimeType ||
      pinned.byteSize !== item.reference.byteSize || pinned.width !== item.reference.width ||
      pinned.height !== item.reference.height ||
      (queueItem.byteMismatchDiagnostic !== undefined && pinned.providerAssetId !== queueItem.byteMismatchDiagnostic.candidateMediaId)
    ) return { status: "blocked", reason: "pinned_reference_mismatch" };
    const savedBytes = new Uint8Array(await pinned.bytes.arrayBuffer());
    const savedBytesSha256 = await sha256Bytes(savedBytes);
    if (savedBytes.byteLength !== item.reference.byteSize || savedBytesSha256 !== item.reference.sha256)
      return { status: "blocked", reason: "reference_bytes_corrupt" };

    await deps.revalidate();
    const selected = await deps.repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (
      !selected || selected.verification !== "verified" || !binding || selected.tabId !== batch.target.tabId ||
      selected.canonicalTarget !== batch.target.canonicalTarget || binding.provider !== "Flow" ||
      binding.tabId !== selected.tabId || binding.canonicalTarget !== selected.canonicalTarget ||
      binding.projectId !== batch.target.projectId || binding.documentId !== batch.target.documentId ||
      binding.extensionBuildId !== BUILD_ID || binding.connectorBuildId !== BUILD_ID ||
      binding.extensionProtocolVersion !== PROTOCOL_VERSION || binding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION ||
      pinned.tabId !== selected.tabId || pinned.flowProjectId !== binding.projectId || pinned.documentId !== binding.documentId
    ) return { status: "blocked", reason: "target_changed" };
    const tab = await deps.getTab(selected.tabId);
    const route = flowTabFromUrl(selected.tabId, "Flow", tab.url);
    if (!route || route.projectId !== binding.projectId || route.canonicalTarget !== selected.canonicalTarget)
      return { status: "blocked", reason: "target_changed" };
    const target = { tabId: selected.tabId, documentIds: [binding.documentId] };
    const resolveCandidate = async () => {
      const result = await deps.scripting.executeScript({
        target, world: "ISOLATED",
        func: () => ({
          href: location.href,
          candidates: [...document.querySelectorAll<HTMLImageElement>("flow-image-tile img[data-media-id]")]
            .map((image) => ({ id: image.dataset.mediaId, url: image.currentSrc || image.src })),
        }),
      });
      const value = result[0]?.result as { href?: string; candidates?: Array<{ id?: string; url?: string }> } | undefined;
      if (result[0]?.documentId !== binding.documentId || flowTabFromUrl(selected.tabId, "Flow", value?.href)?.projectId !== binding.projectId)
        throw new Error("target_changed");
      const matches = (value?.candidates ?? []).filter((candidate) => candidate.id === pinned.providerAssetId && candidate.url);
      if (matches.length !== 1) throw new Error(matches.length ? "candidate_ambiguous" : "candidate_missing");
      return { candidate: matches[0]!, href: value!.href! };
    };

    let resolved: Awaited<ReturnType<typeof resolveCandidate>>;
    try { resolved = await resolveCandidate(); }
    catch (error) { return { status: "blocked", reason: error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : "candidate_resolution_failed" }; }
    let acquired: CandidateAcquisition;
    try {
      acquired = await acquireCandidateBytes({
        tabId: selected.tabId, documentId: binding.documentId, projectId: binding.projectId,
        documentHref: resolved.href, galleryUrl: resolved.candidate.url!, mediaId: pinned.providerAssetId!,
      });
    } catch (error) {
      const reason = error instanceof Error && ACQUISITION_REASONS.has(error.message)
        ? error.message
        : error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : "reference_resource_failed";
      return { status: "blocked", reason };
    }
    const bytes = acquired.bytes;
    const mimeType = acquired.mimeType;
    const width = acquired.width;
    const height = acquired.height;
    if (!/^(image\/(jpeg|png|webp|avif|gif))$/.test(mimeType))
      return { status: "blocked", reason: "reference_format_unsupported" };
    const actualSha256 = await sha256Bytes(bytes);
    try { await resolveCandidate(); }
    catch (error) { return { status: "blocked", reason: error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : "candidate_revalidation_failed" }; }
    await deps.revalidate();
    const latestQueue = FlowVideoQueueRecordSchema.safeParse(await deps.repositories.getFlowVideoQueue(`flow-video:${preparedBatchId}`));
    const latestItem = latestQueue.success ? latestQueue.data.items.find((entry) => entry.itemId === itemId) : undefined;
    const latestTarget = await deps.repositories.getSelectedTarget("Flow");
    const latestBinding = latestTarget?.verificationBinding;
    const latestTab = await deps.getTab(selected.tabId);
    const latestRoute = flowTabFromUrl(selected.tabId, "Flow", latestTab.url);
    if (
      !latestQueue.success || latestQueue.data.revision !== queue.data.revision || !latestItem ||
      latestItem.state !== "failed" || latestItem.reason !== "candidate_bytes_mismatch" ||
      latestItem.referenceId !== item.reference.referenceId || latestItem.promptHash !== item.contentHash ||
      latestTarget?.verification !== "verified" || latestTarget.tabId !== selected.tabId ||
      latestTarget.canonicalTarget !== selected.canonicalTarget || !latestBinding || latestBinding.provider !== "Flow" ||
      latestBinding.tabId !== selected.tabId || latestBinding.canonicalTarget !== selected.canonicalTarget ||
      latestBinding.projectId !== binding.projectId || latestBinding.documentId !== binding.documentId ||
      latestBinding.extensionBuildId !== BUILD_ID || latestBinding.connectorBuildId !== BUILD_ID ||
      latestBinding.extensionProtocolVersion !== PROTOCOL_VERSION || latestBinding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION ||
      !latestRoute || latestRoute.projectId !== binding.projectId || latestRoute.canonicalTarget !== selected.canonicalTarget
    ) return { status: "blocked", reason: "inspection_binding_changed" };
    const diagnostic = ReferenceByteComparisonDiagnosticSchema.safeParse({
      stage: "read_only_reference_inspection", acquisitionRoute: acquired.route,
      preparedSha256: item.reference.sha256, metadataSha256: pinned.sha256, savedBytesSha256,
      candidateBytesSha256: actualSha256, candidateMediaId: resolved.candidate.id,
      mimeType, preparedByteSize: item.reference.byteSize, savedByteSize: savedBytes.byteLength,
      candidateByteSize: bytes.byteLength, preparedWidth: item.reference.width, preparedHeight: item.reference.height,
      ...(width ? { candidateWidth: width } : {}), ...(height ? { candidateHeight: height } : {}),
    });
    if (!diagnostic.success) return { status: "blocked", reason: "inspection_diagnostic_invalid" };
    return { status: "inspected", matches: item.reference.sha256 === actualSha256, diagnostic: diagnostic.data };
  }

  async function attach(preparedBatchId: string, itemId: string) {
    const oid = operationId(preparedBatchId, itemId);
    let op = await deps.repositories.getFlowVideoAttachmentOperation(oid);
    if (op?.status === "attached") return { status: "already_attached" };
    if (op && (op.status === "uncertain" || op.status === "action_intent"))
      return await verifyAttachedReference(preparedBatchId, itemId);
    const batchRaw =
      await deps.repositories.getPreparedVideoBatchById(preparedBatchId);
    if (!batchRaw)
      return { status: "blocked", reason: "prepared_flow_item_required" };
    const rawConfirmation =
      batchRaw && typeof batchRaw === "object"
        ? (batchRaw as { manualSettingsDeclaration?: unknown })
            .manualSettingsDeclaration
        : undefined;
    const confirmation =
      VideoSettingsConfirmationSchema.safeParse(rawConfirmation);
    if (!confirmation.success)
      return {
        status: "blocked",
        reason: "manual_settings_confirmation_required",
      };
    const parsed = PreparedVideoBatchRecordSchema.safeParse(batchRaw);
    if (!parsed.success || parsed.data.destination !== "Flow")
      return { status: "blocked", reason: "prepared_flow_item_required" };
    const batch = parsed.data;
    if (
      confirmation.data.destination !== "Flow" ||
      confirmation.data.tabId !== batch.target.tabId ||
      confirmation.data.canonicalTarget !== batch.target.canonicalTarget ||
      confirmation.data.projectId !== batch.target.projectId ||
      confirmation.data.documentId !== batch.target.documentId
    )
      return {
        status: "blocked",
        reason: "manual_settings_confirmation_binding_mismatch",
      };
    const item = batch.items.find((candidate) => candidate.itemId === itemId);
    if (!item) return { status: "blocked", reason: "prepared_item_missing" };
    const pinned = await deps.repositories.getReferenceById(
      item.reference.referenceId,
    );
    if (
      !pinned ||
      !ReferenceAssignmentRecordSchema.safeParse(pinned).success ||
      pinned.referenceId !== item.reference.referenceId ||
      pinned.assignmentVersion !== item.reference.assignmentVersion ||
      pinned.sha256 !== item.reference.sha256 ||
      pinned.mimeType !== item.reference.mimeType ||
      pinned.byteSize !== item.reference.byteSize ||
      pinned.width !== item.reference.width ||
      pinned.height !== item.reference.height
    )
      return { status: "blocked", reason: "pinned_reference_mismatch" };
    const saved = new Uint8Array(await pinned.bytes.arrayBuffer());
    const savedBytesSha256 = await sha256Bytes(saved);
    if (
      saved.byteLength !== item.reference.byteSize ||
      savedBytesSha256 !== item.reference.sha256
    )
      return { status: "blocked", reason: "reference_bytes_corrupt" };
    await deps.revalidate();
    const selected = await deps.repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (
      !selected ||
      selected.verification !== "verified" ||
      !binding ||
      selected.tabId !== batch.target.tabId ||
      selected.canonicalTarget !== batch.target.canonicalTarget ||
      binding.projectId !== batch.target.projectId ||
      binding.documentId !== batch.target.documentId ||
      (batch.target.documentId &&
        batch.target.documentId !== binding.documentId) ||
      binding.extensionBuildId !== BUILD_ID ||
      binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
      binding.connectorBuildId !== BUILD_ID ||
      binding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION ||
      pinned.tabId !== selected.tabId ||
      pinned.flowProjectId !== binding.projectId ||
      pinned.documentId !== binding.documentId
    )
      return { status: "blocked", reason: "target_changed" };
    const tab = await deps.getTab(selected.tabId);
    const route = flowTabFromUrl(selected.tabId, "Flow", tab.url);
    if (
      !route ||
      route.projectId !== binding.projectId ||
      route.canonicalTarget !== selected.canonicalTarget
    )
      return { status: "blocked", reason: "target_changed" };
    const target = { tabId: selected.tabId, documentIds: [binding.documentId] };
    const inspect = await deps.scripting.executeScript({
      target,
      world: "ISOLATED",
      func: () => ({
        href: location.href,
        candidates: [
          ...document.querySelectorAll<HTMLImageElement>(
            "flow-image-tile img[data-media-id]",
          ),
        ].map((img) => ({
          id: img.dataset.mediaId,
          url: img.currentSrc || img.src,
        })),
      }),
    });
    const state = inspect[0]?.result as
      | { href?: string; candidates?: Array<{ id?: string; url?: string }> }
      | undefined;
    if (
      !state ||
      inspect[0]?.documentId !== binding.documentId ||
      flowTabFromUrl(selected.tabId, "Flow", state.href)?.projectId !==
        binding.projectId
    )
      return { status: "blocked", reason: "target_changed" };
    const candidates = (state.candidates ?? []).filter(
      (candidate) => candidate.id === pinned.providerAssetId && candidate.url,
    );
    if (candidates.length !== 1)
      return {
        status: "blocked",
        reason: candidates.length ? "candidate_ambiguous" : "candidate_missing",
      };
    const candidate = candidates[0]!;
    let acquired: CandidateAcquisition;
    try {
      acquired = await acquireCandidateBytes({
        tabId: selected.tabId, documentId: binding.documentId, projectId: binding.projectId,
        documentHref: state.href!, galleryUrl: candidate.url!, mediaId: pinned.providerAssetId!,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "reference_resource_failed";
      const reason = ACQUISITION_REASONS.has(raw) || /^[a-z0-9_]{1,64}$/.test(raw) ? raw : "reference_resource_failed";
      return { status: "blocked", stage: "reference_byte_acquisition", reason };
    }
    const bytes = acquired.bytes;
    const candidateBytesSha256 = await sha256Bytes(bytes);
    if (candidateBytesSha256 !== item.reference.sha256) {
      const diagnostic = ReferenceByteComparisonDiagnosticSchema.safeParse({
        stage: "candidate_byte_verification",
        acquisitionRoute: acquired.route,
        preparedSha256: item.reference.sha256,
        metadataSha256: pinned.sha256,
        savedBytesSha256,
        candidateBytesSha256,
        candidateMediaId: candidate.id,
        mimeType: acquired.mimeType,
        preparedByteSize: item.reference.byteSize,
        savedByteSize: saved.byteLength,
        candidateByteSize: bytes.byteLength,
        preparedWidth: item.reference.width,
        preparedHeight: item.reference.height,
        ...(acquired.width ? { candidateWidth: acquired.width } : {}),
        ...(acquired.height ? { candidateHeight: acquired.height } : {}),
      });
      return {
        status: "blocked",
        stage: "candidate_byte_verification",
        reason: "candidate_bytes_mismatch",
        ...(diagnostic.success ? { diagnostic: diagnostic.data } : {}),
      };
    }
    const reResolved = await deps.scripting.executeScript({
      target,
      world: "ISOLATED",
      func: () => ({
        href: location.href,
        candidates: [
          ...document.querySelectorAll<HTMLImageElement>(
            "flow-image-tile img[data-media-id]",
          ),
        ].map((img) => ({
          id: img.dataset.mediaId,
          url: img.currentSrc || img.src,
        })),
      }),
    });
    const reResolvedState = reResolved[0]?.result as
      | { href?: string; candidates?: Array<{ id?: string; url?: string }> }
      | undefined;
    const reResolvedMatches = (reResolvedState?.candidates ?? []).filter(
      (entry) => entry.id === pinned.providerAssetId && entry.url,
    );
    if (
      reResolved[0]?.documentId !== binding.documentId ||
      !isBoundFlowProjectUrl(reResolvedState?.href, binding.projectId) ||
      reResolvedMatches.length !== 1
    )
      return {
        status: "blocked",
        stage: "candidate_revalidation",
        reason: "candidate_changed",
      };
    const composerCheck = await deps.scripting.executeScript({
      target,
      world: "ISOLATED",
      func: flowVideoAttachmentStructurePreflightInPage,
    });
    const composerState = composerCheck[0]?.result as
      { ok?: boolean; reason?: string; href?: string } | undefined;
    if (
      composerCheck[0]?.documentId !== binding.documentId ||
      !isBoundFlowProjectUrl(composerState?.href, binding.projectId)
    )
      return {
        status: "blocked",
        stage: "attachment_structure_preflight",
        reason: "target_changed",
      };
    if (!composerState?.ok)
      return {
        status: "blocked",
        stage: "attachment_structure_preflight",
        reason:
          composerState?.reason === "attachment_control_unavailable"
            ? "attachment_control_unavailable"
            : "composer_unavailable",
      };
    await deps.revalidate();
    const fresh = await deps.repositories.getSelectedTarget("Flow");
    const freshTab = await deps.getTab(selected.tabId);
    if (
      !fresh ||
      fresh.verification !== "verified" ||
      fresh.tabId !== selected.tabId ||
      fresh.canonicalTarget !== selected.canonicalTarget ||
      fresh.verificationBinding?.documentId !== binding.documentId ||
      fresh.verificationBinding.projectId !== binding.projectId ||
      !isBoundFlowProjectUrl(freshTab.url, binding.projectId)
    )
      return { status: "blocked", reason: "target_changed" };
    // Persist before the sole page activation. Any worker restart/lost response becomes readback-only.
    op = {
      id: oid,
      preparedBatchId,
      itemId,
      referenceId: item.reference.referenceId,
      status: "action_intent",
      updatedAt: Date.now(),
      ...(op?.preActivationEvidence
        ? { preActivationEvidence: op.preActivationEvidence }
        : {}),
    };
    if (!(await deps.repositories.claimFlowVideoAttachmentOperation(op)))
      return { status: "uncertain", reason: "concurrent_or_prior_activation" };
    await deps.revalidate();
    const immediatelyBeforeAction =
      await deps.repositories.getSelectedTarget("Flow");
    const actionTab = await deps.getTab(selected.tabId);
    if (
      !immediatelyBeforeAction ||
      immediatelyBeforeAction.verification !== "verified" ||
      immediatelyBeforeAction.tabId !== selected.tabId ||
      immediatelyBeforeAction.canonicalTarget !== selected.canonicalTarget ||
      immediatelyBeforeAction.verificationBinding?.documentId !==
        binding.documentId ||
      immediatelyBeforeAction.verificationBinding.projectId !==
        binding.projectId ||
      !isBoundFlowProjectUrl(actionTab.url, binding.projectId)
    ) {
      await deps.repositories.putFlowVideoAttachmentOperation({
        ...op,
        status: "blocked",
        reason: "target_changed_before_action",
        updatedAt: Date.now(),
      });
      return { status: "blocked", reason: "target_changed" };
    }
    const action = await deps.scripting.executeScript({
      target,
      world: "ISOLATED",
      func: flowVideoAttachmentActionInPage,
      args: [pinned.providerAssetId ?? "", candidate.url],
    });
    const outcome = action[0]?.result as
      { ok?: boolean; already?: boolean; reason?: string } | undefined;
    if (action[0]?.documentId !== binding.documentId) {
      await deps.repositories.putFlowVideoAttachmentOperation({
        ...op,
        status: "uncertain",
        reason: "document_changed_after_activation",
        updatedAt: Date.now(),
      });
      return {
        status: "uncertain",
        reason: "document_changed_after_activation",
      };
    }
    if (outcome?.ok) {
      await deps.repositories.putFlowVideoAttachmentOperation({
        ...op,
        status: "attached",
        updatedAt: Date.now(),
      });
      return { status: outcome.already ? "already_attached" : "attached" };
    }
    await deps.repositories.putFlowVideoAttachmentOperation({
      ...op,
      status: "uncertain",
      reason: outcome?.reason ?? "attachment_uncertain",
      updatedAt: Date.now(),
    });
    return {
      status: "uncertain",
      reason: outcome?.reason ?? "attachment_uncertain",
    };
  }
  return { attach, inspectReferenceBytes, status, verifyAttachedReference, reconcilePreClickFailure };
}
