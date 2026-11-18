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
  flowReferenceResource,
  resolveFlowReferenceFetcher,
} from "../../platforms/flow/referenceResource";
import {
  flowAsbTokenFromImageUrl,
  flowExpectedMediaIdentityKeys,
  flowMediaIdentitiesMatchExpected,
} from "../../platforms/flow/mediaIdentity";
import {
  FlowVideoExistingChipDiagnosticSchema,
  FlowVideoPickerDiagnosticSchema,
  FlowVideoQueueRecordSchema,
  isFlowVideoPickerPreAddReason,
  isFlowVideoPreIntentReferenceReason,
  type FlowVideoExistingChipDiagnostic,
  type FlowVideoPickerDiagnostic,
} from "../../domain/jobs/videoQueue";

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

function isAsbUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    let pathname = url.pathname;
    const acctMatch = /^\/u\/\d+(\/.*)$/.exec(pathname);
    if (acctMatch) pathname = acctMatch[1]!;
    return url.protocol === "https:" && url.hostname === "flow.google.com" && /^\/asb(?:\/|$)/.test(pathname);
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

/**
 * Resolve exactly one visible gallery tile by the pinned provider media ID.
 * Flow virtualizes its project gallery, so a tile can be absent from the DOM
 * at the current scroll position. Search the already-rendered DOM first, then
 * perform bounded scroll checks per visible project gallery
 * viewport. The matching tile is left rendered for the follow-up detail/action
 * steps; a failed search restores every inspected scroll position.
 */
export async function flowVideoGalleryCandidateInPage(
  providerAssetId: string,
): Promise<{
  ok: boolean;
  href: string;
  candidate?: { id: string; url: string };
  reason?: string;
}> {
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
  const matchingImages = () =>
    [
      ...document.querySelectorAll<HTMLImageElement>(
        "flow-image-tile img[data-media-id]",
      ),
    ].filter(
      (image) => image.dataset.mediaId === providerAssetId && visible(image),
    );
  const read = ():
    | { candidate?: { id: string; url: string }; reason?: string } => {
    const matches = matchingImages();
    if (matches.length > 1) return { reason: "candidate_ambiguous" };
    const image = matches[0];
    if (!image) return {};
    const url = image.currentSrc || image.src;
    return url ? { candidate: { id: providerAssetId, url } } : {};
  };
  const direct = read();
  if (direct.reason)
    return { ok: false, href: location.href, reason: direct.reason };
  if (direct.candidate)
    return { ok: true, href: location.href, candidate: direct.candidate };

  const scrollers = [
    ...document.querySelectorAll<HTMLElement>(
      "cdk-virtual-scroll-viewport",
    ),
  ].filter(
    (scroller) =>
      visible(scroller) &&
      !scroller.closest("flow-base-prompt-box") &&
      !scroller.closest("[role=listbox][aria-label='Asset list']"),
  );
  const maxChecksPerScroller = 256;
  for (const scroller of scrollers) {
    const originalTop = scroller.scrollTop;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (maxTop === 0) continue;
    const step = Math.max(1, Math.floor(scroller.clientHeight * 0.75));
    const steps = Math.max(1, Math.ceil(maxTop / step) + 1);
    if (steps > maxChecksPerScroller) {
      scroller.scrollTop = originalTop;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { ok: false, href: location.href, reason: "candidate_search_incomplete" };
    }
    for (let index = 0; index < steps; index++) {
      scroller.scrollTop = Math.min(maxTop, index * step);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const state = read();
      if (state.reason)
        return { ok: false, href: location.href, reason: state.reason };
      if (state.candidate)
        return { ok: true, href: location.href, candidate: state.candidate };
    }
    scroller.scrollTop = originalTop;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { ok: false, href: location.href, reason: "candidate_missing" };
}

/** In-page picker action. The gallery URL is identity evidence, not the acquisition URL. */
export async function flowVideoAttachmentActionInPage(
  expectedId: string,
  expectedGalleryUrl: string,
): Promise<{
  ok: boolean;
  already?: boolean;
  reason?: string;
  diagnostic?: FlowVideoExistingChipDiagnostic | FlowVideoPickerDiagnostic;
}> {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return el.isConnected && r.width > 0 && r.height > 0 &&
      style.display !== "none" && style.visibility !== "hidden";
  };
  const roots = () => [...document.querySelectorAll("flow-base-prompt-box")].filter(visible);
  // Flow renders ingredients as flow-*-ingredient-chip custom elements in
  // flow-ingredient-bar. The ingredient bar or prompt box also hosts frame
  // slots under div.frame-trigger; those are not prompt ingredients and must
  // never be counted as an existing chip (or as a duplicate) here.
  const isFrameTriggerDescendant = (el: Element): boolean =>
    Boolean(el.closest(".frame-trigger, div.frame-trigger, [class*='frame-trigger']"));
  const ingredientBar = (root: Element): Element =>
    root.querySelector("flow-ingredient-bar") ?? root;
  const chipComponents = (root: Element): HTMLElement[] => {
    const scope = ingredientBar(root);
    return [...scope.querySelectorAll<HTMLElement>(
      "flow-character-ingredient-chip, flow-video-ingredient-chip, flow-image-ingredient-chip",
    )].filter((component) => !isFrameTriggerDescendant(component));
  };
  const chipButtons = (root: Element): HTMLElement[] => {
    const scope = ingredientBar(root);
    const components = chipComponents(scope);
    const buttons = components
      .map((component) =>
        component.querySelector<HTMLElement>("button.chip-container, button[aria-label='Ingredient'], button"),
      )
      .filter((button): button is HTMLElement => Boolean(button))
      .filter((button) => !isFrameTriggerDescendant(button));
    if (buttons.length > 0) return buttons;
    // Older composer markup renders the chip button without the custom
    // element wrapper; keep reading it, still excluding frame slots.
    return [...scope.querySelectorAll<HTMLElement>("button.chip-container, button[aria-label='Ingredient']")]
      .filter((button) => !isFrameTriggerDescendant(button));
  };
  const frameChipCount = (root: Element): number =>
    [...root.querySelectorAll<HTMLElement>(
      ".frame-trigger, div.frame-trigger, [class*='frame-trigger']",
    )].reduce((count, trigger) => {
      const frameChips = trigger.querySelectorAll(
        "flow-character-ingredient-chip, flow-video-ingredient-chip, flow-image-ingredient-chip, button.chip-container, button[aria-label='Ingredient']",
      );
      return count + (frameChips.length > 0 ? frameChips.length : 1);
    }, 0);
  const chips = (root?: Element): HTMLElement[] => {
    const liveRoot = root ?? roots()[0];
    return liveRoot?.isConnected ? chipButtons(liveRoot) : [];
  };
  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  const asbParts = (raw: string | undefined): { token: string; suffix?: string } | undefined => {
    if (!raw || raw.length > 4096) return undefined;
    try {
      const u = new URL(raw, location.href);
      if (
        u.protocol !== "https:" ||
        u.hostname !== "flow.google.com" ||
        u.username ||
        u.password ||
        (u.port && u.port !== "443")
      )
        return undefined;
      let pathname = u.pathname;
      const acctMatch = /^\/u\/\d+(\/.*)$/.exec(pathname);
      if (acctMatch) pathname = acctMatch[1]!;
      if (!pathname.startsWith("/asb/")) return undefined;
      const rest = pathname.slice("/asb/".length);
      if (!rest || rest.includes("/")) return undefined;
      const eq = rest.indexOf("=");
      const token = eq === -1 ? rest : rest.slice(0, eq);
      const suffix = eq === -1 ? "" : rest.slice(eq);
      if (!token || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token))
        return undefined;
      if (suffix && !/^=s\d+(-rw)?$/.test(suffix)) return undefined;
      return suffix ? { token, suffix } : { token };
    } catch {
      return undefined;
    }
  };
  const asbToken = (raw: string | undefined): string | undefined =>
    asbParts(raw)?.token;

  const mediaIdFromImageUrl = (raw: string | undefined): string | undefined => {
    if (!raw || raw.length > 4096) return undefined;
    try {
      const u = new URL(raw, location.href);
      if (
        u.protocol !== "https:" ||
        u.hostname !== "flow-content.google" ||
        u.port ||
        u.username ||
        u.password
      )
        return undefined;
      return /^\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
        .exec(u.pathname)?.[1]
        ?.toLowerCase();
    } catch {
      return undefined;
    }
  };

  const expectedMediaId = expectedId.toLowerCase();
  const expectedAsbToken = asbToken(expectedGalleryUrl);
  const expectedKeys = new Set<string>();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedMediaId)) {
    expectedKeys.add("media:" + expectedMediaId);
  }
  if (expectedAsbToken) {
    expectedKeys.add("asb:" + expectedAsbToken);
  }

  const imageUrls = (root: Element): string[] =>
    [...root.querySelectorAll<HTMLImageElement>("img")]
      .map((image) => image.currentSrc || image.src || image.getAttribute("src") || "")
      .filter(Boolean);

  const keysFor = (element: Element): Set<string> => {
    const keys = new Set<string>();
    for (const url of imageUrls(element)) {
      const mid = mediaIdFromImageUrl(url);
      if (mid) keys.add("media:" + mid);
      const tok = asbToken(url);
      if (tok) keys.add("asb:" + tok);
    }
    return keys;
  };

  const matchesExpected = (keys: Set<string>): boolean =>
    keys.size > 0 && Array.from(keys).every((key) => expectedKeys.has(key));

  const describeChip = (chip: Element) => {
    const urls = imageUrls(chip);
    const mediaIds = new Set<string>();
    const asbTokens = new Set<string>();
    const asbSuffixes = new Set<string>();
    const identityKinds: Array<"uuid" | "asb"> = [];
    for (const url of urls) {
      const mid = mediaIdFromImageUrl(url);
      if (mid) {
        mediaIds.add(mid);
        identityKinds.push("uuid");
      }
      const parts = asbParts(url);
      if (parts) {
        asbTokens.add(parts.token);
        identityKinds.push("asb");
        if (parts.suffix) asbSuffixes.add(parts.suffix);
      }
    }
    const keys = keysFor(chip);
    let unexpected = 0;
    for (const key of keys) if (!expectedKeys.has(key)) unexpected++;
    const isVis = visible(chip);
    const busyVal = chip.getAttribute("aria-busy");
    const matches = keys.size > 0 && unexpected === 0;
    return {
      visible: isVis,
      busy: busyVal,
      imageCount: Math.min(urls.length, 16),
      mediaIds: [...mediaIds].slice(0, 4),
      asbTokens: [...asbTokens].slice(0, 4),
      asbSuffixes: [...asbSuffixes].slice(0, 4),
      expectedKeyMatches: keys.size - unexpected,
      unexpectedKeyCount: unexpected,
      identityKinds: identityKinds.slice(0, 8),
      hasSizeSuffix: asbSuffixes.size > 0,
      hasExtraIdentities: unexpected > 0,
      matchesExpected: matches,
      chipReadiness: busyVal === "false" ? "ready" : busyVal === "true" ? "busy" : "unset",
    };
  };

  /** Bounded, URL-free evidence describing why the existing-chip gate refused. */
  const chipDiagnostic = (root?: Element): FlowVideoExistingChipDiagnostic | undefined => {
    const liveRoot = root ?? roots()[0];
    if (!liveRoot?.isConnected) return undefined;
    const buttons = chipButtons(liveRoot);
    const components = chipComponents(liveRoot);
    const visibleCount = buttons.filter(visible).length;
    const hiddenCount = buttons.length - visibleCount;
    const describedChips = buttons.slice(0, 8).map(describeChip);
    const recognizedCount = describedChips.reduce(
      (sum, c) => sum + c.mediaIds.length + c.asbTokens.length,
      0,
    );
    return {
      producer: "existing_composer_chip_check_before_picker",
      chipCount: Math.min(buttons.length, 32),
      visibleChipCount: Math.min(visibleCount, 32),
      candidateCount: Math.min(components.length, 32),
      totalRealChipCount: Math.min(buttons.length, 32),
      frameChipCount: Math.min(frameChipCount(liveRoot), 32),
      hiddenChipCount: Math.min(hiddenCount, 32),
      recognizedIdentityCount: Math.min(recognizedCount, 32),
      documentTargetValidation: "verified_bound_document",
      chips: describedChips,
    };
  };

  const sameAssetUrl = (raw: string | undefined): boolean => {
    if (!raw) return false;
    if (raw === expectedGalleryUrl) return true;
    const mid = mediaIdFromImageUrl(raw);
    if (mid && expectedKeys.has("media:" + mid)) return true;
    const tok = asbToken(raw);
    if (tok && expectedKeys.has("asb:" + tok)) return true;
    return false;
  };

  const extractRowMediaId = (el: HTMLElement): string | undefined => {
    const attrs = [
      "data-media-id",
      "data-asset-id",
      "data-id",
      "data-row-id",
      "data-item-id",
    ];
    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (val) {
        const match =
          /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
            val,
          );
        if (match) return match[1].toLowerCase();
      }
    }
    for (const attr of attrs) {
      const target = el.querySelector(`[${attr}]`);
      const val = target?.getAttribute(attr);
      if (val) {
        const match =
          /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
            val,
          );
        if (match) return match[1].toLowerCase();
      }
    }
    const idMatch =
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
        el.id || "",
      );
    if (idMatch) return idMatch[1].toLowerCase();
    const childWithId = el.querySelector("[id*='-']");
    if (childWithId) {
      const childIdMatch =
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
          childWithId.id,
        );
      if (childIdMatch) return childIdMatch[1].toLowerCase();
    }
    return undefined;
  };

  const associateRowAsbTokens = (row: HTMLElement) => {
    for (const url of imageUrls(row)) {
      const tok = asbToken(url);
      if (tok) expectedKeys.add("asb:" + tok);
    }
  };

  const rowMatches = (row: HTMLElement): boolean => {
    const rowMediaId = extractRowMediaId(row);
    if (rowMediaId && rowMediaId !== expectedMediaId) return false;
    const keys = keysFor(row);
    if (rowMediaId === expectedMediaId) {
      if (expectedAsbToken) {
        for (const k of keys) {
          if (!expectedKeys.has(k)) return false;
        }
      }
      return true;
    }
    if (keys.size === 0) return false;
    return matchesExpected(keys);
  };

  const selectRow = (row: HTMLElement) => {
    try {
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {}
    const target =
      row.querySelector<HTMLElement>(
        "button, [role=button], .asset-item, flow-image-tile",
      ) ?? row;
    const opts = { bubbles: true, cancelable: true, view: window };
    try {
      target.dispatchEvent(new PointerEvent("pointerdown", opts));
    } catch {}
    try {
      target.dispatchEvent(new MouseEvent("mousedown", opts));
    } catch {}
    try {
      target.dispatchEvent(new PointerEvent("pointerup", opts));
    } catch {}
    try {
      target.dispatchEvent(new MouseEvent("mouseup", opts));
    } catch {}
    try {
      target.click();
    } catch {}
  };

  const anyListbox = () =>
    document.querySelector<HTMLElement>("[role=listbox][aria-label='Asset list']");
  const visibleListbox = () =>
    [...document.querySelectorAll<HTMLElement>("[role=listbox][aria-label='Asset list']")]
      .filter(visible)[0];
  const read = () => {
    const list = visibleListbox();
    // A hidden, stale detail panel may remain mounted after picker transitions.
    // Never treat the first global preview as the selected visible preview.
    const previews = [...document.querySelectorAll<HTMLImageElement>("img.detail-preview-image[alt^='Preview of']")];
    const visiblePreviews = previews.filter(visible);
    const preview = visiblePreviews.length === 1 ? visiblePreviews[0] : undefined;
    const panel = preview?.parentElement?.closest("section,[data-picker-detail-scope]") ?? preview?.parentElement?.parentElement;
    const rows = [...(list?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
    const matches = rows.filter(rowMatches);
    if (matches.length === 1) {
      associateRowAsbTokens(matches[0]!);
    }
    const action = [...(panel?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .filter((b) => b.textContent?.trim().toLowerCase() === "add to prompt" && visible(b));
    return {
      list,
      preview,
      previews,
      visiblePreviews,
      rows,
      matches,
      row: matches.length === 1 ? matches[0] : undefined,
      ambiguous: matches.length > 1,
      action,
    };
  };
  const pickerDiagnostic = (
    state: ReturnType<typeof read>,
    matchingRow?: HTMLElement,
  ): FlowVideoPickerDiagnostic => {
    const isActive = (row: Element): boolean =>
      row.getAttribute("aria-selected") === "true" ||
      row.getAttribute("aria-current") === "true" ||
      row.getAttribute("data-selected") === "true" ||
      row.classList.contains("asset-item-active") ||
      row.classList.contains("selected") ||
      Boolean(row.querySelector(".asset-item-active, [aria-selected='true'], .selected"));
    const row =
      state.row ??
      (matchingRow && rowMatches(matchingRow) ? matchingRow : undefined);
    const rowKeys = row ? keysFor(row) : new Set<string>();
    const rowMediaId = row && extractRowMediaId(row);
    // For a stale/multiple visible preview, report the first candidate's
    // properties but never grant an Add from it.
    const preview = state.preview ?? state.visiblePreviews[0] ?? state.previews[0];
    const previewUrl = preview?.currentSrc || preview?.src || undefined;
    // querySelectorAll("img") excludes the root when it is already <img>.
    // Derive preview keys from the preview URL directly.
    const previewKeys = new Set<string>();
    const previewMediaId = mediaIdFromImageUrl(previewUrl);
    const previewAsbToken = asbToken(previewUrl);
    if (previewMediaId) previewKeys.add("media:" + previewMediaId);
    if (previewAsbToken) previewKeys.add("asb:" + previewAsbToken);
    const keyCounts = (keys: Set<string>) => ({
      expected: Math.min(16, [...keys].filter((key) => expectedKeys.has(key)).length),
      unexpected: Math.min(16, [...keys].filter((key) => !expectedKeys.has(key)).length),
    });
    const rowCounts = keyCounts(rowKeys);
    const previewCounts = keyCounts(previewKeys);
    return {
      producer: "picker_selected_preview_check_before_add",
      expectedHasMediaUuid: expectedKeys.has("media:" + expectedMediaId),
      expectedHasAsbToken: Boolean(expectedAsbToken),
      rowCount: Math.min(128, state.rows.length),
      matchingRowCount: Math.min(128, state.matches.length),
      activeRowCount: Math.min(128, state.rows.filter(isActive).length),
      matchingRowActive: Boolean(row && isActive(row)),
      matchingRowMediaId: !rowMediaId ? "missing" : rowMediaId.trim().toLowerCase() === expectedMediaId ? "expected" : "different",
      matchingRowExpectedKeys: rowCounts.expected,
      matchingRowUnexpectedKeys: rowCounts.unexpected,
      previewCandidateCount: Math.min(32, state.previews.length),
      visiblePreviewCount: Math.min(32, state.visiblePreviews.length),
      previewPresent: Boolean(preview),
      previewVisible: Boolean(preview && visible(preview)),
      previewComplete: Boolean(preview?.complete),
      previewNaturalWidth: Math.min(100000, Math.max(0, preview?.naturalWidth || 0)),
      previewIdentityKind: !previewUrl ? "missing" : asbToken(previewUrl) ? "asb" : mediaIdFromImageUrl(previewUrl) ? "media" : "unrecognized",
      previewHasSizeSuffix: Boolean(asbParts(previewUrl)?.suffix),
      previewExpectedKeys: previewCounts.expected,
      previewUnexpectedKeys: previewCounts.unexpected,
      previewMatchesExpected: Boolean(state.preview && sameAssetUrl(previewUrl)),
      addButtonCount: Math.min(16, state.action.length),
    };
  };
  const scrolls = (element: Element | null | undefined): boolean => {
    if (!element || !(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return /(auto|scroll)/.test(style.overflowY) &&
      element.scrollHeight > element.clientHeight + 1;
  };
  const findScroller = (list: HTMLElement): HTMLElement | undefined => {
    const viewports = [
      list.closest<HTMLElement>("cdk-virtual-scroll-viewport, .cdk-virtual-scrollable"),
      ...list.querySelectorAll<HTMLElement>("cdk-virtual-scroll-viewport, .cdk-virtual-scrollable"),
    ];
    for (const viewport of viewports) {
      if (viewport && scrolls(viewport)) return viewport;
    }
    if (scrolls(list)) return list;
    const nested = [...list.querySelectorAll<HTMLElement>("*")].find((element) => scrolls(element));
    if (nested) return nested;
    let parent = list.parentElement;
    for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
      if (scrolls(parent)) return parent;
    }
    return undefined;
  };

  const findExactRow = async (): Promise<{ row?: HTMLElement; ambiguous?: boolean }> => {
    let state = read();
    if (state.ambiguous) return { ambiguous: true };
    if (state.row) return { row: state.row };
    const list = state.list;
    if (!list) return {};
    for (let attempt = 0; attempt < 10; attempt++) {
      await wait(50);
      state = read();
      if (state.ambiguous) return { ambiguous: true };
      if (state.row) return { row: state.row };
    }
    const scroller = findScroller(list);
    if (!scroller) return {};
    const originalTop = scroller.scrollTop;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const step = Math.max(1, Math.floor(scroller.clientHeight * 0.8));
    const steps = Math.min(12, Math.max(2, Math.ceil(maxTop / step)));
    let ambiguous = false;
    for (let index = 0; index < steps; index++) {
      scroller.scrollTop = Math.round((index * maxTop) / (steps - 1));
      try {
        scroller.dispatchEvent(new Event("scroll"));
      } catch {}
      await wait(120);
      state = read();
      if (state.ambiguous) {
        ambiguous = true;
        break;
      }
      if (state.row) return { row: state.row };
    }
    scroller.scrollTop = originalTop;
    await wait(80);
    state = read();
    return ambiguous || state.ambiguous ? { ambiguous: true } : state.row ? { row: state.row } : {};
  };

  const PICKER_ASSET_TAB_LABELS = ["All", "Images", "Uploads"] as const;
  const normalizedLabel = (element: Element) =>
    (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const pickerTabs = (): HTMLElement[] => {
    const list = read().list;
    if (!list) return [];
    const tablist = document.querySelector<HTMLElement>("[role='tablist']");
    if (tablist) {
      const clickables = [...tablist.querySelectorAll<HTMLElement>("button, [role='tab'], [role='button']")]
        .filter((element) => visible(element) &&
          !(element as HTMLButtonElement).disabled &&
          element.getAttribute("aria-disabled") !== "true");
      const labels = new Set(clickables.map(normalizedLabel));
      if (PICKER_ASSET_TAB_LABELS.some((label) => labels.has(label.toLowerCase()))) {
        return clickables.filter((element) =>
          PICKER_ASSET_TAB_LABELS.some((label) => normalizedLabel(element) === label.toLowerCase()));
      }
    }
    let scope: Element | null = list;
    for (let depth = 0; depth < 8 && scope && scope !== document.body; depth++, scope = scope.parentElement) {
      const clickables = [...scope.querySelectorAll<HTMLElement>("button, [role='tab'], [role='button']")]
        .filter((element) => visible(element) &&
          !(element as HTMLButtonElement).disabled &&
          element.getAttribute("aria-disabled") !== "true");
      const labels = new Set(clickables.map(normalizedLabel));
      if (PICKER_ASSET_TAB_LABELS.filter((label) => labels.has(label.toLowerCase())).length >= 2) {
        return clickables.filter((element) =>
          PICKER_ASSET_TAB_LABELS.some((label) => normalizedLabel(element) === label.toLowerCase()));
      }
    }
    return [];
  };
  const activeTabLabel = (): string | undefined => {
    const active = pickerTabs().find((element) =>
      element.getAttribute("aria-selected") === "true" ||
      element.getAttribute("aria-current") === "true" ||
      element.getAttribute("aria-pressed") === "true" ||
      /(^|[-_ ])(active|selected)([-_ ]|$)/i.test(element.className));
    return active ? normalizedLabel(active) : undefined;
  };
  const selectTab = async (label: string): Promise<boolean> => {
    const target = pickerTabs().find((element) => normalizedLabel(element) === label.toLowerCase());
    if (!target) return false;
    if (activeTabLabel() === label.toLowerCase()) return true;
    const opts = { bubbles: true, cancelable: true, view: window };
    try { target.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch {}
    try { target.dispatchEvent(new MouseEvent("mousedown", opts)); } catch {}
    try { target.dispatchEvent(new PointerEvent("pointerup", opts)); } catch {}
    try { target.dispatchEvent(new MouseEvent("mouseup", opts)); } catch {}
    try { target.click(); } catch {}
    for (let attempt = 0; attempt < 30; attempt++) {
      await wait(50);
      if (read().list && attempt >= 4) return true;
    }
    return Boolean(read().list);
  };
  const findExactRowAcrossTabs = async (): Promise<{ row?: HTMLElement; ambiguous?: boolean }> => {
    const first = await findExactRow();
    if (first.row || first.ambiguous) return first;
    const original = activeTabLabel();
    let ambiguous = false;
    for (const label of ["Uploads", "Images", "All"]) {
      if (label.toLowerCase() === original) continue;
      if (!pickerTabs().some((element) => normalizedLabel(element) === label.toLowerCase())) continue;
      if (!(await selectTab(label))) continue;
      const found = await findExactRow();
      if (found.ambiguous) {
        ambiguous = true;
        break;
      }
      if (found.row) return found;
    }
    if (original) await selectTab(original);
    return ambiguous ? { ambiguous: true } : {};
  };

  if (roots().length !== 1) return { ok: false, reason: "composer_unavailable_after_preflight" };
  const liveRoot = roots()[0]!;
  const attachmentControls = [...liveRoot.querySelectorAll<HTMLButtonElement>("button[aria-label='Add ingredients to the prompt box']")].filter(visible);
  if (attachmentControls.length !== 1 || attachmentControls[0]!.disabled || attachmentControls[0]!.getAttribute("aria-disabled") === "true")
    return { ok: false, reason: "attachment_control_unavailable" };
  let existing: HTMLElement[];
  const existingIdentity = () => {
    const liveRoots = roots();
    if (liveRoots.length !== 1) return "composer_settling" as const;
    const currentRoot = liveRoots[0]!;
    const liveChips = chips(currentRoot);
    if (!currentRoot.isConnected || roots()[0] !== currentRoot) return "composer_settling" as const;
    if (!liveChips.length) {
      // A chip host without a recognized chip button still occupies the
      // ingredient bar; treating it as absent could create a duplicate.
      return chipComponents(currentRoot).length ? "unreadable" as const : "none" as const;
    }
    const visibleChips = liveChips.filter(visible);
    // Hidden stale or frame-derived nodes must not masquerade as a second
    // ingredient, but they also must not authorize Add while no chip is
    // visible. Only the visible ingredient chips participate in identity.
    if (!visibleChips.length) return "busy" as const;
    if (visibleChips.length !== 1) return "conflict" as const;
    const singleChip = visibleChips[0]!;
    const chipKeys = keysFor(singleChip);
    if (chipKeys.size === 0) return "unreadable" as const;
    if (!matchesExpected(chipKeys)) return "conflict" as const;
    if (singleChip.getAttribute("aria-busy") !== "false") return "busy" as const;
    return "matching" as const;
  };
  let existingState = existingIdentity();
  for (let attempt = 0; attempt < 50 && (existingState === "unreadable" || existingState === "busy" || existingState === "composer_settling"); attempt++) {
    await wait(100);
    existingState = existingIdentity();
  }
  if (existingState === "matching") return { ok: true, already: true };
  if (existingState === "unreadable") return { ok: false, reason: "existing_chip_identity_unreadable" };
  if (existingState === "busy") return { ok: false, reason: "existing_chip_not_ready" };
  if (existingState === "composer_settling") return { ok: false, reason: "composer_unavailable_after_preflight" };
  if (existingState === "conflict") {
    const diagnostic = chipDiagnostic();
    return {
      ok: false,
      reason: "existing_chip_conflict",
      ...(diagnostic ? { diagnostic } : {}),
    };
  }

  if (!read().list) {
    for (let attempt = 0; attempt < 10 && !read().list && anyListbox(); attempt++)
      await wait(50);
  }
  if (!read().list) {
    const currentRoot = roots()[0];
    const open = currentRoot?.querySelector<HTMLButtonElement>("button[aria-label='Add ingredients to the prompt box']");
    if (!open || !visible(open)) return { ok: false, reason: "picker_missing" };
    open.click();
    for (let attempt = 0; attempt < 40 && !read().list; attempt++) await wait(50);
  }
  if (!read().list) return { ok: false, reason: "picker_not_open" };

  const found = await findExactRowAcrossTabs();
  if (found.ambiguous) return { ok: false, reason: "picker_exact_row_ambiguous" };
  if (!found.row) return { ok: false, reason: "picker_exact_row_missing" };

  // Explicit selection action on found.row (scrolling into view, pointer/mouse events, inner clickable)
  selectRow(found.row);
  associateRowAsbTokens(found.row);

  let selected = read();
  for (let i = 0; i < 40; i++) {
    selected = read();
    if (selected.row) associateRowAsbTokens(selected.row);
    if (
      (selected.row || rowMatches(found.row)) &&
      selected.preview &&
      sameAssetUrl(selected.preview.currentSrc || selected.preview.src || undefined) &&
      selected.action.length === 1 &&
      !selected.action[0]!.disabled &&
      selected.action[0]!.getAttribute("aria-disabled") !== "true"
    ) {
      break;
    }
    await wait(50);
  }

  if (
    !selected.preview ||
    !sameAssetUrl(selected.preview.currentSrc || selected.preview.src || undefined)
  )
    return { ok: false, reason: "picker_selected_preview_mismatch", diagnostic: pickerDiagnostic(selected, found.row) };
  if (
    selected.action.length !== 1 ||
    selected.action[0]!.disabled ||
    selected.action[0]!.getAttribute("aria-disabled") === "true"
  )
    return { ok: false, reason: "picker_add_not_ready" };
  if (!selected.row && !rowMatches(found.row)) return { ok: false, reason: "picker_exact_row_missing" };
  existing = chips();
  if (existing.length) return { ok: false, reason: "chip_conflict_before_add" };
  selected.action[0]!.click();

  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    existing = chips();
    if (existing.length === 1 && existing[0]!.getAttribute("aria-busy") === "false") {
      const chipKeys = keysFor(existing[0]!);
      if (matchesExpected(chipKeys)) return { ok: true, already: false };
    }
  }
  existing = chips();
  const unreadable = existing.some((chip) => keysFor(chip).size === 0);
  return { ok: false, reason: unreadable ? "chip_identity_unreadable_after_add" : "attachment_uncertain" };
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
    attemptedRepresentation?: "detail_original" | "asb_webp_s1600_rw" | "gallery_tile";
    representationFailureReason?: string;
  };
  async function acquireCandidateBytes(input: {
    tabId: number;
    documentId: string;
    projectId: string;
    documentHref: string;
    galleryUrl: string;
    mediaId: string;
    expectedSha256: string;
  }): Promise<CandidateAcquisition> {
    const target = { tabId: input.tabId, documentIds: [input.documentId] };
    const documentOrigin = new URL(input.documentHref).origin;
    const observed = new URL(input.galleryUrl);
    let observedPathname = observed.pathname;
    const acctMatch = /^\/u\/\d+(\/.*)$/.exec(observedPathname);
    if (acctMatch) observedPathname = acctMatch[1]!;
    const isAsbRepresentation = observed.protocol === "https:" && observed.hostname === "flow.google.com" && /^\/asb(?:\/|$)/.test(observedPathname);
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
    const captureSameOrigin = async (url: string): Promise<CandidateAcquisition> => {
      const captured = await deps.scripting.executeScript({
        target, world: "MAIN", func: flowReferenceCaptureInPage,
        args: [{ action: "fetch", captureOperationId: crypto.randomUUID(), sourceUrl: url, expectedOrigin: documentOrigin }],
      });
      if (captured[0]?.documentId !== input.documentId) throw new Error("target_changed");
      const payload = captured[0]?.result as { ok?: boolean; data?: string; code?: string; mimeType?: string; width?: number; height?: number } | undefined;
      if (!payload?.ok || !payload.data || !payload.mimeType) throw new Error(payload?.code ?? "candidate_capture_failed");
      const binary = atob(payload.data);
      return {
        bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
        mimeType: payload.mimeType,
        width: payload.width, height: payload.height,
        route: "verified_document_same_origin",
      };
    };

    if (isAsbRepresentation) {
      let resolution: { ok?: boolean; opened?: boolean; url?: string; href?: string; code?: string } | undefined;
      let acquired: CandidateAcquisition | undefined;
      let failure: string | undefined;
      let verifiedAsbToken: string | undefined;
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
        const isResolutionAsb = isAsbUrl(resolution.url);
        if (isResolutionAsb) {
          const asbToken = flowAsbTokenFromImageUrl(resolution.url);
          const expectedToken = flowAsbTokenFromImageUrl(input.galleryUrl);
          if (!expectedToken || !asbToken) throw new Error("reference_asb_token_missing");
          if (asbToken !== expectedToken) throw new Error("reference_asb_token_mismatch");
          if (documentOrigin !== "https://flow.google.com") throw new Error("reference_origin_unsupported");
          verifiedAsbToken = asbToken;
          const captured = await deps.scripting.executeScript({
            target,
            world: "MAIN",
            func: flowReferenceCaptureInPage,
            args: [{
              action: "fetch",
              captureOperationId: crypto.randomUUID(),
              sourceUrl: resolution.url,
              expectedOrigin: documentOrigin,
            }],
          });
          if (captured[0]?.documentId !== input.documentId) throw new Error("target_changed");
          const payload = captured[0]?.result as {
            ok?: boolean;
            data?: string;
            code?: string;
            mimeType?: string;
            width?: number;
            height?: number;
          } | undefined;
          if (!payload?.ok || !payload.data || !payload.mimeType) {
            const code = payload?.code;
            throw new Error(code && /^[a-z0-9_]{1,64}$/.test(code) ? code : "candidate_capture_failed");
          }
          const binary = atob(payload.data);
          acquired = {
            bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)),
            mimeType: payload.mimeType,
            width: payload.width,
            height: payload.height,
            route: "verified_document_same_origin",
            attemptedRepresentation: "detail_original",
          };
        } else {
          const original = flowReferenceResource(resolution.url, input.mediaId);
          acquired = await extensionFetch(original.fetchUrl, "verified_detail_original_extension_fetch");
          acquired.attemptedRepresentation = "detail_original";
        }
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
      // When the detail original bytes differ (e.g. dynamic JPEG without -rw vs saved WebP with -rw),
      // attempt the evidenced =s1600-rw WebP representation for the verified same-origin ASB token
      // before attempting the gallery URL. The hash gate is strictly enforced; only an exact match is accepted.
      if (!failure && acquired && (await sha256Bytes(acquired.bytes)) !== input.expectedSha256) {
        let fallbackFailureReason: string | undefined;
        let webpUrl: string | undefined;
        if (verifiedAsbToken && documentOrigin === "https://flow.google.com") {
          try {
            const acctPrefix = /^\/u\/\d+/.exec(new URL(input.galleryUrl).pathname)?.[0] ?? "";
            webpUrl = `${documentOrigin}${acctPrefix}/asb/${verifiedAsbToken}=s1600-rw`;
            const tokenCheck = flowAsbTokenFromImageUrl(webpUrl);
            if (tokenCheck === verifiedAsbToken) {
              const webpCandidate = await captureSameOrigin(webpUrl);
              const webpSha = await sha256Bytes(webpCandidate.bytes);
              if (webpSha === input.expectedSha256) {
                acquired = {
                  ...webpCandidate,
                  attemptedRepresentation: "asb_webp_s1600_rw",
                };
              } else {
                fallbackFailureReason = "webp_sha256_mismatch";
              }
            } else {
              fallbackFailureReason = "candidate_url_token_invalid";
            }
          } catch (error) {
            if (error instanceof Error && error.message === "target_changed") throw error;
            fallbackFailureReason =
              error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
                ? error.message
                : "webp_fetch_failed";
          }
        }
        if ((await sha256Bytes(acquired.bytes)) !== input.expectedSha256) {
          if (input.galleryUrl !== webpUrl) {
            try {
              const gallery = await captureSameOrigin(input.galleryUrl);
              if ((await sha256Bytes(gallery.bytes)) === input.expectedSha256) {
                acquired = {
                  ...gallery,
                  attemptedRepresentation: "gallery_tile",
                };
              } else if (!fallbackFailureReason) {
                fallbackFailureReason = "gallery_sha256_mismatch";
              }
            } catch (error) {
              if (error instanceof Error && error.message === "target_changed") throw error;
              if (!fallbackFailureReason) {
                fallbackFailureReason =
                  error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
                    ? error.message
                    : "gallery_fetch_failed";
              }
            }
          }
        }
        if ((await sha256Bytes(acquired.bytes)) !== input.expectedSha256 && fallbackFailureReason) {
          acquired.representationFailureReason = fallbackFailureReason;
        }
      }
      if (!acquired) throw new Error("reference_resource_failed");
      return acquired;
    }

    if (observed.origin === documentOrigin) return await captureSameOrigin(input.galleryUrl);
    return extensionFetch(input.galleryUrl, "scoped_extension_fetch");
  }
  async function resolveGalleryCandidate(input: {
    tabId: number;
    documentId: string;
    projectId: string;
    mediaId: string;
  }) {
    const result = await deps.scripting.executeScript({
      target: { tabId: input.tabId, documentIds: [input.documentId] },
      world: "ISOLATED",
      func: flowVideoGalleryCandidateInPage,
      args: [input.mediaId],
    });
    const value = result[0]?.result as
      | {
          ok?: boolean;
          href?: string;
          candidate?: { id?: string; url?: string };
          reason?: string;
        }
      | undefined;
    if (
      result[0]?.documentId !== input.documentId ||
      !value?.href ||
      flowTabFromUrl(input.tabId, "Flow", value.href)?.projectId !==
        input.projectId
    )
      throw new Error("target_changed");
    if (
      !value.ok ||
      value.candidate?.id !== input.mediaId ||
      !value.candidate.url
    ) {
      const reason = value.reason;
      throw new Error(
        reason && /^[a-z0-9_]{1,64}$/.test(reason)
          ? reason
          : "candidate_missing",
      );
    }
    return {
      candidate: { id: input.mediaId, url: value.candidate.url },
      href: value.href,
    };
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
            preAddReconciliationEvidence: op.preAddReconciliationEvidence,
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
    // The pin may predate a Flow reload. Tab, project, canonical target, and
    // exact media identity remain bound; the current document is checked below.
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
      pinned.canonicalTarget !== batch.target.canonicalTarget ||
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
    const queueRecord = await deps.repositories.getFlowVideoQueue(`flow-video:${batch.id}`);
    const rebound = queueRecord?.executionDocumentRebind;
    const expectedTabId = rebound?.toTabId ?? batch.target.tabId;
    const expectedDocumentId = rebound?.toDocumentId ?? batch.target.documentId;
    if (
      rebound &&
      (rebound.fromDocumentId !== batch.target.documentId ||
        rebound.projectId !== batch.target.projectId ||
        rebound.canonicalTarget !== batch.target.canonicalTarget)
    )
      return { status: "blocked", reason: "target_changed" };
    const selected = await deps.repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (
      !selected || selected.verification !== "verified" || !binding ||
      selected.tabId !== expectedTabId ||
      selected.canonicalTarget !== batch.target.canonicalTarget ||
      binding.provider !== "Flow" ||
      binding.tabId !== selected.tabId ||
      binding.canonicalTarget !== selected.canonicalTarget ||
      binding.projectId !== batch.target.projectId ||
      binding.documentId !== expectedDocumentId ||
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
    type VerificationChip = {
      busy?: string | null;
      urls?: string[];
      url?: string;
    };
    let state:
      | { ok?: boolean; href?: string; count?: number; chips?: VerificationChip[] }
      | undefined;
    let chipSettled = false;

    const expectedKeys = flowExpectedMediaIdentityKeys({
      mediaId: pinned.providerAssetId,
      asbToken: op.observedAsbToken,
    });
    for (let attempt = 0; attempt < 20; attempt++) {
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
          const root = roots[0]!;
          const bar = root.querySelector("flow-ingredient-bar") ?? root;
          const isFrameTrigger = (el: Element) =>
            Boolean(el.closest(".frame-trigger, div.frame-trigger, [class*='frame-trigger']"));
          const components = [...bar.querySelectorAll<HTMLElement>(
            "flow-character-ingredient-chip, flow-video-ingredient-chip, flow-image-ingredient-chip",
          )].filter((component) => !isFrameTrigger(component));
          const chipButtons = components
            .map((component) =>
              component.querySelector<HTMLElement>("button.chip-container, button[aria-label='Ingredient'], button"),
            )
            .filter((button): button is HTMLElement => Boolean(button))
            .filter((button) => !isFrameTrigger(button));
          const recognized = chipButtons.length > 0
            ? chipButtons
            : [...bar.querySelectorAll<HTMLElement>("button.chip-container, button[aria-label='Ingredient']")]
              .filter((button) => !isFrameTrigger(button));
          const chips = recognized.filter(visible);
          const images = chips.map((chip) => ({
            busy: chip.getAttribute("aria-busy"),
            urls: [...chip.querySelectorAll<HTMLImageElement>("img")]
              .map((image) =>
                image.currentSrc || image.src || image.getAttribute("src") || "",
              )
              .filter(Boolean),
          }));
          return { ok: true, href: location.href, count: chips.length, chips: images };
        },
      });
      state = check[0]?.result as typeof state;
      if (
        check[0]?.documentId !== binding.documentId ||
        !state?.href ||
        flowTabFromUrl(selected.tabId, "Flow", state.href)?.projectId !== binding.projectId
      )
        return { status: "uncertain", reason: "verification_document_mismatch" };
      const chip = state.chips?.[0];
      const match = chip
        ? flowMediaIdentitiesMatchExpected(
            chip.urls ?? (chip.url ? [chip.url] : []),
            expectedKeys,
          )
        : { ok: false };
      if (
        state.ok &&
        state.count === 1 &&
        state.chips?.length === 1 &&
        chip?.busy === "false" &&
        match.ok
      ) {
        chipSettled = true;
        break;
      }
      if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const chip = state?.chips?.[0];
    const match = chip
      ? flowMediaIdentitiesMatchExpected(
          chip.urls ?? (chip.url ? [chip.url] : []),
          expectedKeys,
        )
      : { ok: false };
    if (
      !chipSettled ||
      !state?.ok ||
      state.count !== 1 ||
      state.chips?.length !== 1 ||
      chip?.busy !== "false" ||
      !match.ok
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
      mediaId: pinned.providerAssetId,
      ...(op.observedAsbToken ? { asbToken: op.observedAsbToken } : {}),
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
      !queueItem || queueItem.state !== "failed" || !isFlowVideoPreIntentReferenceReason(queueItem.reason)
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
    // A saved reference may predate a Flow reload: tab, project, canonical
    // target, and the exact media identity stay bound, while the live document
    // is proven by the current binding and route below. This mirrors the
    // attachment path, which deliberately ignores the pin's original document.
    // Each gate returns a distinct read-only code so the dashboard reports the
    // exact binding that changed instead of the old umbrella `target_changed`.
    if (!selected || selected.verification !== "verified" || !binding || !binding.documentId)
      return { status: "blocked", reason: "inspection_target_unverified" };
    if (
      selected.tabId !== batch.target.tabId ||
      selected.canonicalTarget !== batch.target.canonicalTarget ||
      binding.provider !== "Flow" ||
      binding.tabId !== selected.tabId ||
      binding.canonicalTarget !== selected.canonicalTarget
    ) return { status: "blocked", reason: "inspection_selection_changed" };
    if (binding.projectId !== batch.target.projectId)
      return { status: "blocked", reason: "inspection_project_changed" };
    if (binding.extensionBuildId !== BUILD_ID || binding.extensionProtocolVersion !== PROTOCOL_VERSION)
      return { status: "blocked", reason: "inspection_extension_build_changed" };
    if (binding.connectorBuildId !== BUILD_ID || binding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION)
      return { status: "blocked", reason: "inspection_connector_build_changed" };
    if (pinned.tabId !== selected.tabId || pinned.flowProjectId !== binding.projectId)
      return { status: "blocked", reason: "inspection_pin_binding_changed" };
    const tab = await deps.getTab(selected.tabId);
    const route = flowTabFromUrl(selected.tabId, "Flow", tab.url);
    if (!route || route.projectId !== binding.projectId || route.canonicalTarget !== selected.canonicalTarget)
      return { status: "blocked", reason: "inspection_route_changed" };
    const resolveCandidate = () =>
      resolveGalleryCandidate({
        tabId: selected.tabId,
        documentId: binding.documentId,
        projectId: binding.projectId,
        mediaId: pinned.providerAssetId!,
      });

    let resolved: Awaited<ReturnType<typeof resolveCandidate>>;
    try { resolved = await resolveCandidate(); }
    catch (error) {
      const raw = error instanceof Error ? error.message : "";
      return { status: "blocked", reason: raw === "target_changed" ? "inspection_candidate_document_changed" : /^[a-z0-9_]{1,64}$/.test(raw) ? raw : "candidate_resolution_failed" };
    }
    let acquired: CandidateAcquisition;
    try {
      acquired = await acquireCandidateBytes({
        tabId: selected.tabId, documentId: binding.documentId, projectId: binding.projectId,
        documentHref: resolved.href, galleryUrl: resolved.candidate.url!, mediaId: pinned.providerAssetId!,
        expectedSha256: item.reference.sha256,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const reason = raw === "target_changed" ? "inspection_reference_document_changed"
        : ACQUISITION_REASONS.has(raw) ? raw
        : /^[a-z0-9_]{1,64}$/.test(raw) ? raw : "reference_resource_failed";
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
      latestItem.state !== "failed" || !isFlowVideoPreIntentReferenceReason(latestItem.reason) ||
      latestItem.referenceId !== item.reference.referenceId || latestItem.promptHash !== item.contentHash ||
      latestTarget?.verification !== "verified" || latestTarget.tabId !== selected.tabId ||
      latestTarget.canonicalTarget !== selected.canonicalTarget || !latestBinding || latestBinding.provider !== "Flow" ||
      latestBinding.tabId !== selected.tabId || latestBinding.canonicalTarget !== selected.canonicalTarget ||
      latestBinding.projectId !== binding.projectId ||
      latestBinding.extensionBuildId !== BUILD_ID || latestBinding.connectorBuildId !== BUILD_ID ||
      latestBinding.extensionProtocolVersion !== PROTOCOL_VERSION || latestBinding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION ||
      !latestRoute || latestRoute.projectId !== binding.projectId || latestRoute.canonicalTarget !== selected.canonicalTarget
    ) return { status: "blocked", reason: "inspection_binding_changed" };
    if (latestBinding.documentId !== binding.documentId)
      return { status: "blocked", reason: "inspection_document_changed" };
    const diagnostic = ReferenceByteComparisonDiagnosticSchema.safeParse({
      stage: "read_only_reference_inspection", acquisitionRoute: acquired.route,
      preparedSha256: item.reference.sha256, metadataSha256: pinned.sha256, savedBytesSha256,
      candidateBytesSha256: actualSha256, candidateMediaId: resolved.candidate.id,
      mimeType, preparedByteSize: item.reference.byteSize, savedByteSize: savedBytes.byteLength,
      candidateByteSize: bytes.byteLength, preparedWidth: item.reference.width, preparedHeight: item.reference.height,
      ...(width ? { candidateWidth: width } : {}), ...(height ? { candidateHeight: height } : {}),
      ...(acquired.attemptedRepresentation ? { attemptedRepresentation: acquired.attemptedRepresentation } : {}),
      ...(acquired.representationFailureReason ? { representationFailureReason: acquired.representationFailureReason } : {}),
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
    const queueRecord = await deps.repositories.getFlowVideoQueue(`flow-video:${batch.id}`);
    const rebound = queueRecord?.executionDocumentRebind;
    const expectedTabId = rebound?.toTabId ?? batch.target.tabId;
    const expectedDocumentId = rebound?.toDocumentId ?? batch.target.documentId;
    if (
      rebound &&
      (rebound.fromDocumentId !== batch.target.documentId ||
        rebound.projectId !== batch.target.projectId ||
        rebound.canonicalTarget !== batch.target.canonicalTarget)
    )
      return { status: "blocked", reason: "target_changed" };

    const declarationDocId = rebound ? rebound.fromDocumentId : batch.target.documentId;
    if (
      confirmation.data.destination !== "Flow" ||
      confirmation.data.tabId !== batch.target.tabId ||
      confirmation.data.canonicalTarget !== batch.target.canonicalTarget ||
      confirmation.data.projectId !== batch.target.projectId ||
      confirmation.data.documentId !== declarationDocId
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
    // A Flow reload replaces documentId without changing the tab/project or
    // the pinned media identity. The current document, asset ID, and bytes
    // below still have to match exactly.
    if (
      !selected ||
      selected.verification !== "verified" ||
      !binding ||
      selected.tabId !== expectedTabId ||
      selected.canonicalTarget !== batch.target.canonicalTarget ||
      binding.provider !== "Flow" ||
      binding.tabId !== selected.tabId ||
      binding.canonicalTarget !== selected.canonicalTarget ||
      binding.projectId !== batch.target.projectId ||
      binding.documentId !== expectedDocumentId ||
      binding.extensionBuildId !== BUILD_ID ||
      binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
      binding.connectorBuildId !== BUILD_ID ||
      binding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION ||
      pinned.tabId !== selected.tabId ||
      pinned.flowProjectId !== binding.projectId ||
      pinned.canonicalTarget !== selected.canonicalTarget
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
    let resolved: Awaited<ReturnType<typeof resolveGalleryCandidate>>;
    try {
      resolved = await resolveGalleryCandidate({
        tabId: selected.tabId,
        documentId: binding.documentId,
        projectId: binding.projectId,
        mediaId: pinned.providerAssetId!,
      });
    } catch (error) {
      return {
        status: "blocked",
        reason:
          error instanceof Error &&
          /^[a-z0-9_]{1,64}$/.test(error.message)
            ? error.message
            : "candidate_resolution_failed",
      };
    }
    const candidate = resolved.candidate;
    let acquired: CandidateAcquisition;
    try {
      acquired = await acquireCandidateBytes({
        tabId: selected.tabId, documentId: binding.documentId, projectId: binding.projectId,
        documentHref: resolved.href, galleryUrl: candidate.url, mediaId: pinned.providerAssetId!,
        expectedSha256: item.reference.sha256,
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
        ...(acquired.attemptedRepresentation ? { attemptedRepresentation: acquired.attemptedRepresentation } : {}),
        ...(acquired.representationFailureReason ? { representationFailureReason: acquired.representationFailureReason } : {}),
      });
      return {
        status: "blocked",
        stage: "candidate_byte_verification",
        reason: "candidate_bytes_mismatch",
        ...(diagnostic.success ? { diagnostic: diagnostic.data } : {}),
      };
    }
    try {
      await resolveGalleryCandidate({
        tabId: selected.tabId,
        documentId: binding.documentId,
        projectId: binding.projectId,
        mediaId: pinned.providerAssetId!,
      });
    } catch {
      return {
        status: "blocked",
        stage: "candidate_revalidation",
        reason: "candidate_changed",
      };
    }
    const target = { tabId: selected.tabId, documentIds: [binding.documentId] };
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
    let candidateAsbToken: string | undefined;
    if (isAsbUrl(candidate.url)) {
      candidateAsbToken = flowAsbTokenFromImageUrl(candidate.url);
      if (!candidateAsbToken) {
        return { status: "blocked", reason: "reference_asb_token_missing" };
      }
    }
    // Persist before the sole page activation. Any worker restart/lost response becomes readback-only.
    op = {
      id: oid,
      preparedBatchId,
      itemId,
      referenceId: item.reference.referenceId,
      status: "action_intent",
      updatedAt: Date.now(),
      ...(candidateAsbToken ? { observedAsbToken: candidateAsbToken } : {}),
      ...(op?.preActivationEvidence
        ? { preActivationEvidence: op.preActivationEvidence }
        : {}),
      ...(op?.preAddReconciliationEvidence
        ? { preAddReconciliationEvidence: op.preAddReconciliationEvidence }
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
      | {
          ok?: boolean;
          already?: boolean;
          reason?: string;
          diagnostic?: unknown;
          pickerDiagnostic?: unknown;
        }
      | undefined;
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
      const outcomeAsbToken =
        typeof (outcome as { asbToken?: unknown })?.asbToken === "string"
          ? (outcome as { asbToken?: string }).asbToken
          : undefined;
      const finalAsbToken = candidateAsbToken ?? outcomeAsbToken;
      await deps.repositories.putFlowVideoAttachmentOperation({
        ...op,
        status: "attached",
        ...(finalAsbToken ? { observedAsbToken: finalAsbToken } : {}),
        verifiedAttachment: {
          documentId: binding.documentId,
          mediaId: pinned.providerAssetId!,
          ...(finalAsbToken ? { asbToken: finalAsbToken } : {}),
          verifiedAt: Date.now(),
        },
        updatedAt: Date.now(),
      });
      return { status: outcome.already ? "already_attached" : "attached" };
    }
    const failureReason = outcome?.reason ?? "attachment_uncertain";
    const failedAt = Date.now();
    const parsedDiagnostic =
      outcome?.diagnostic === undefined
        ? undefined
        : FlowVideoExistingChipDiagnosticSchema.safeParse(outcome.diagnostic);
    const existingChipDiagnostic =
      parsedDiagnostic?.success &&
      (failureReason === "existing_chip_identity_unreadable" ||
        failureReason === "existing_chip_not_ready" ||
        failureReason === "existing_chip_conflict")
        ? parsedDiagnostic.data
        : undefined;
    const rawPickerDiag = outcome?.diagnostic ?? outcome?.pickerDiagnostic;
    const parsedPickerDiagnostic =
      rawPickerDiag === undefined
        ? undefined
        : FlowVideoPickerDiagnosticSchema.safeParse(rawPickerDiag);
    const pickerDiagnostic =
      failureReason === "picker_selected_preview_mismatch" && parsedPickerDiagnostic?.success
        ? parsedPickerDiagnostic.data
        : undefined;
    await deps.repositories.putFlowVideoAttachmentOperation({
      ...op,
      status: "uncertain",
      reason: failureReason,
      updatedAt: failedAt,
      // The in-page action returns these reasons only before its sole Add
      // click. Persisting that fact lets the queue offer a guarded retry
      // without ever treating a post-click outcome as replayable.
      ...(isFlowVideoPickerPreAddReason(failureReason)
        ? {
            pickerPreAddEvidence: {
              reason: failureReason,
              updatedAt: failedAt,
              producer: "picker_failure_before_add_activation" as const,
              addClickAttempted: false as const,
              ...(pickerDiagnostic ? { diagnostic: pickerDiagnostic } : {}),
            },
          }
        : {}),
      ...(failureReason === "existing_chip_identity_unreadable" ||
      failureReason === "existing_chip_not_ready" ||
      failureReason === "existing_chip_conflict"
        ? {
            existingChipPreAddEvidence: {
              reason: failureReason,
              updatedAt: failedAt,
              producer: "existing_composer_chip_check_before_picker" as const,
              addClickAttempted: false as const,
              ...(existingChipDiagnostic ? { diagnostic: existingChipDiagnostic } : {}),
            },
          }
        : {}),
    });
    return {
      status: "uncertain",
      reason: failureReason,
      ...(existingChipDiagnostic ? { existingChipDiagnostic } : {}),
      ...(pickerDiagnostic ? { pickerDiagnostic } : {}),
    };
  }
  return { attach, inspectReferenceBytes, status, verifyAttachedReference, reconcilePreClickFailure };
}
