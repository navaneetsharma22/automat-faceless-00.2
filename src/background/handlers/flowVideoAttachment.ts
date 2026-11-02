import type { ExtensionRepositories } from "../../storage/repositories";
import { ReferenceAssignmentRecordSchema, sha256Bytes } from "../../domain/media/references";
import { PreparedVideoBatchRecordSchema } from "../../shared/schemas";
import { flowTabFromUrl } from "../../platforms/flow/connection";
import { flowReferenceCaptureInPage } from "../../platforms/flow/references";
import { flowVideoChipMediaIdFromImageUrl } from "../../platforms/flow/video";

type Script = { executeScript: (input: unknown) => Promise<Array<{ documentId?: string; result?: unknown }>> };
const operationId = (batch: string, item: string) => `${batch}:${item}`;

/** Worker-owned attachment caller. The page DOM is accessed only through exact document-targeted script injections. */
export function createFlowVideoAttachmentHandler(deps: {
  repositories: ExtensionRepositories;
  scripting: Script;
  getTab: (tabId: number) => Promise<{ id?: number; url?: string }>;
  revalidate: () => Promise<unknown>;
}) {
  async function status(preparedBatchId: string, itemId: string) {
    const op = await deps.repositories.getFlowVideoAttachmentOperation(operationId(preparedBatchId, itemId));
    return op ? { status: op.status === "action_intent" ? "uncertain" : op.status, reason: op.reason } : { status: "not_started" };
  }
  async function attach(preparedBatchId: string, itemId: string) {
    const oid = operationId(preparedBatchId, itemId);
    let op = await deps.repositories.getFlowVideoAttachmentOperation(oid);
    const inspectOnly = Boolean(op && op.status !== "blocked");
    const batchRaw = await deps.repositories.getPreparedVideoBatchById(preparedBatchId);
    const parsed = PreparedVideoBatchRecordSchema.safeParse(batchRaw);
    if (!parsed.success || parsed.data.destination !== "Flow") return { status: "blocked", reason: "prepared_flow_item_required" };
    const batch = parsed.data;
    const item = batch.items.find((candidate) => candidate.itemId === itemId);
    if (!item) return { status: "blocked", reason: "prepared_item_missing" };
    const pinned = await deps.repositories.getReferenceById(item.reference.referenceId);
    if (!pinned || !ReferenceAssignmentRecordSchema.safeParse(pinned).success || pinned.referenceId !== item.reference.referenceId || pinned.assignmentVersion !== item.reference.assignmentVersion || pinned.sha256 !== item.reference.sha256 || pinned.mimeType !== item.reference.mimeType || pinned.byteSize !== item.reference.byteSize || pinned.width !== item.reference.width || pinned.height !== item.reference.height) return { status: "blocked", reason: "pinned_reference_mismatch" };
    const saved = new Uint8Array(await pinned.bytes.arrayBuffer());
    if (saved.byteLength !== item.reference.byteSize || await sha256Bytes(saved) !== item.reference.sha256) return { status: "blocked", reason: "reference_bytes_corrupt" };
    await deps.revalidate();
    const selected = await deps.repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (!selected || selected.verification !== "verified" || !binding || selected.tabId !== batch.target.tabId || selected.canonicalTarget !== batch.target.canonicalTarget || binding.projectId !== batch.target.projectId || binding.documentId !== batch.target.documentId || (batch.target.documentId && batch.target.documentId !== binding.documentId) || binding.extensionBuildId !== (await import("../../shared/buildInfo")).BUILD_ID || binding.extensionProtocolVersion !== (await import("../../shared/buildInfo")).PROTOCOL_VERSION || binding.connectorBuildId !== (await import("../../shared/buildInfo")).BUILD_ID || binding.connectorProtocolVersion !== (await import("../../shared/buildInfo")).PROTOCOL_VERSION || pinned.tabId !== selected.tabId || pinned.flowProjectId !== binding.projectId || pinned.documentId !== binding.documentId) return { status: "blocked", reason: "target_changed" };
    const tab = await deps.getTab(selected.tabId);
    const route = flowTabFromUrl(selected.tabId, "Flow", tab.url);
    if (!route || route.projectId !== binding.projectId || route.canonicalTarget !== selected.canonicalTarget) return { status: "blocked", reason: "target_changed" };
    const target = { tabId: selected.tabId, documentIds: [binding.documentId] };
    if (inspectOnly) {
      const check = await deps.scripting.executeScript({ target, world: "ISOLATED", func: () => {
        const root = document.querySelector("flow-base-prompt-box");
        const chips = [...(root?.querySelectorAll<HTMLButtonElement>("button[aria-label='Ingredient']") ?? [])];
        return chips.map((chip) => ({ busy: chip.getAttribute("aria-busy"), url: chip.querySelector<HTMLImageElement>("img[alt='Ingredient image']")?.src }));
      } });
      const chips = check[0]?.result as Array<{ busy?: string | null; url?: string }>|undefined;
      const exact = chips?.length === 1 && chips[0]?.busy === "false" && flowVideoChipMediaIdFromImageUrl(chips[0]?.url ?? "") === pinned.providerAssetId;
      if (exact && op) {
        await deps.repositories.putFlowVideoAttachmentOperation({ ...op, status: "attached", reason: undefined, updatedAt: Date.now() });
        return { status: "already_attached" };
      }
      return { status: "uncertain", reason: "prior_activation_unresolved" };
    }
    const inspect = await deps.scripting.executeScript({ target, world: "ISOLATED", func: () => ({ href: location.href, candidates: [...document.querySelectorAll<HTMLImageElement>("flow-image-tile img[data-media-id]")].map((img) => ({ id: img.dataset.mediaId, url: img.currentSrc || img.src })) }) });
    const state = inspect[0]?.result as { href?: string; candidates?: Array<{ id?: string; url?: string }> } | undefined;
    if (!state || inspect[0]?.documentId !== binding.documentId || flowTabFromUrl(selected.tabId, "Flow", state.href)?.projectId !== binding.projectId) return { status: "blocked", reason: "target_changed" };
    const candidates = (state.candidates ?? []).filter((candidate) => candidate.id === pinned.providerAssetId && candidate.url);
    if (candidates.length !== 1) return { status: "blocked", reason: candidates.length ? "candidate_ambiguous" : "candidate_missing" };
    const candidate = candidates[0]!;
    const captured = await deps.scripting.executeScript({ target, world: "MAIN", func: flowReferenceCaptureInPage, args: [{ action: "fetch", captureOperationId: crypto.randomUUID(), sourceUrl: candidate.url, expectedOrigin: new URL(candidate.url!).origin }] });
    const payload = captured[0]?.result as { ok?: boolean; data?: string } | undefined;
    if (!payload?.ok || !payload.data) return { status: "blocked", reason: "candidate_capture_failed" };
    const binary = atob(payload.data);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (await sha256Bytes(bytes) !== item.reference.sha256) return { status: "blocked", reason: "candidate_bytes_mismatch" };
    await deps.revalidate();
    const fresh = await deps.repositories.getSelectedTarget("Flow");
    const freshTab = await deps.getTab(selected.tabId);
    if (!fresh || fresh.verification !== "verified" || fresh.tabId !== selected.tabId || fresh.canonicalTarget !== selected.canonicalTarget || fresh.verificationBinding?.documentId !== binding.documentId || fresh.verificationBinding.projectId !== binding.projectId || flowTabFromUrl(selected.tabId, "Flow", freshTab.url)?.projectId !== binding.projectId) return { status: "blocked", reason: "target_changed" };
    // Persist before the sole page activation. Any worker restart/lost response becomes readback-only.
    op = { id: oid, preparedBatchId, itemId, referenceId: item.reference.referenceId, status: "action_intent", updatedAt: Date.now() };
    if (!(await deps.repositories.claimFlowVideoAttachmentOperation(op))) return { status: "uncertain", reason: "concurrent_or_prior_activation" };
    await deps.revalidate();
    const immediatelyBeforeAction = await deps.repositories.getSelectedTarget("Flow");
    const actionTab = await deps.getTab(selected.tabId);
    if (!immediatelyBeforeAction || immediatelyBeforeAction.verification !== "verified" || immediatelyBeforeAction.tabId !== selected.tabId || immediatelyBeforeAction.canonicalTarget !== selected.canonicalTarget || immediatelyBeforeAction.verificationBinding?.documentId !== binding.documentId || immediatelyBeforeAction.verificationBinding.projectId !== binding.projectId || flowTabFromUrl(selected.tabId, "Flow", actionTab.url)?.projectId !== binding.projectId) {
      await deps.repositories.putFlowVideoAttachmentOperation({ ...op, status: "blocked", reason: "target_changed_before_action", updatedAt: Date.now() });
      return { status: "blocked", reason: "target_changed" };
    }
    const action = await deps.scripting.executeScript({ target, world: "ISOLATED", func: async (expectedId: string, expectedUrl: string) => {
      const visible = (el: Element) => { const r = el.getBoundingClientRect(); return el.isConnected && r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
      const roots = [...document.querySelectorAll("flow-base-prompt-box")].filter(visible);
      const labels = [...document.querySelectorAll<HTMLElement>("[role=radio][aria-checked=true]")].map((el) => (el.getAttribute("aria-label") ?? "").toLowerCase());
      const chips = () => roots[0] ? [...roots[0].querySelectorAll<HTMLButtonElement>("button[aria-label='Ingredient']")] : [];
      const idFromChip = (chip: HTMLButtonElement) => { try { const u = new URL(chip.querySelector("img[alt='Ingredient image']")?.getAttribute("src") ?? ""); return u.protocol === "https:" && u.hostname === "flow-content.google" ? /^\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(u.pathname)?.[1]?.toLowerCase() : undefined; } catch { return undefined; } };
      const read = () => { const list = document.querySelector("[role=listbox][aria-label='Asset list']"); const preview = document.querySelector<HTMLImageElement>("img.detail-preview-image[alt^='Preview of']"); const panel = preview?.parentElement?.closest("section,[data-picker-detail-scope]") ?? preview?.parentElement?.parentElement; const row = [...(list?.querySelectorAll<HTMLButtonElement>("button[role=option].asset-item") ?? [])].find((r) => [...r.querySelectorAll<HTMLImageElement>("img.asset-thumbnail-image")].some((img) => (img.currentSrc || img.src) === expectedUrl)); const action = [...(panel?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => b.textContent?.trim().toLowerCase() === "add to prompt" && visible(b)); return { list, preview, panel, row, action }; };
      if (roots.length !== 1 || labels.filter((x) => x === "video").length !== 1 || labels.filter((x) => x === "ingredients").length !== 1 || labels.some((x) => x === "frames" || x === "image")) return { ok: false, reason: "composer_unsupported" };
      let existing = chips();
      if (existing.some((chip) => !idFromChip(chip)) || existing.filter((chip) => idFromChip(chip) === expectedId).length > 1) return { ok: false, reason: "attachment_unverified" };
      if (existing.length === 1 && idFromChip(existing[0]!) === expectedId && existing[0]!.getAttribute("aria-busy") === "false") return { ok: true, already: true };
      if (!document.querySelector("[role=listbox][aria-label='Asset list']")) {
        const open = roots[0]!.querySelector<HTMLButtonElement>("button[aria-label='Add ingredients to the prompt box']");
        if (!open || !visible(open)) return { ok: false, reason: "picker_missing" };
        open.click();
      }
      for (let i = 0; i < 40; i++) { const p = read(); if (p.row && p.preview && p.action.length === 1) { p.row.click(); break; } await new Promise((r) => setTimeout(r, 50)); }
      const p = read();
      if (!p.row || !p.preview || (p.preview.currentSrc || p.preview.src) !== expectedUrl || p.action.length !== 1) return { ok: false, reason: "candidate_missing_or_virtualized" };
      existing = chips();
      if (existing.length) return { ok: false, reason: "attachment_unverified" };
      p.action[0]!.click();
      for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 100)); existing = chips(); if (existing.some((chip) => !idFromChip(chip))) return { ok: false, reason: "attachment_unverified" }; if (existing.length === 1 && idFromChip(existing[0]!) === expectedId && existing[0]!.getAttribute("aria-busy") === "false") return { ok: true, already: false }; }
      return { ok: false, reason: "attachment_uncertain" };
    }, args: [pinned.providerAssetId ?? "", candidate.url] });
    const outcome = action[0]?.result as { ok?: boolean; already?: boolean; reason?: string } | undefined;
    if (action[0]?.documentId !== binding.documentId) {
      await deps.repositories.putFlowVideoAttachmentOperation({ ...op, status: "uncertain", reason: "document_changed_after_activation", updatedAt: Date.now() });
      return { status: "uncertain", reason: "document_changed_after_activation" };
    }
    if (outcome?.ok) {
      await deps.repositories.putFlowVideoAttachmentOperation({ ...op, status: "attached", updatedAt: Date.now() });
      return { status: outcome.already ? "already_attached" : "attached" };
    }
    await deps.repositories.putFlowVideoAttachmentOperation({ ...op, status: "uncertain", reason: outcome?.reason ?? "attachment_uncertain", updatedAt: Date.now() });
    return { status: "uncertain", reason: outcome?.reason ?? "attachment_uncertain" };
  }
  return { attach, status };
}
