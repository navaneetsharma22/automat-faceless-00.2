import type { PreparedVideoBatchItem } from "../../domain/batches/types";
import type { ReferenceAssignmentRecord } from "../../domain/media/references";
import {
  ReferenceAssignmentRecordSchema,
  sha256Bytes,
} from "../../domain/media/references";

export type FlowVideoFailure =
  | "wrong_frame"
  | "composer_missing"
  | "composer_ambiguous"
  | "composer_unsupported"
  | "reference_binding_mismatch"
  | "reference_bytes_corrupt"
  | "candidate_missing_or_virtualized"
  | "candidate_ambiguous"
  | "candidate_bytes_mismatch"
  | "target_changed"
  | "attachment_uncertain"
  | "attachment_unverified";

export type FlowVideoAttachmentResult =
  | {
      ok: true;
      alreadyAttached: boolean;
      referenceId: string;
      byteVerified: true;
      identityVerified: true;
    }
  | { ok: false; reason: FlowVideoFailure };

type Composer = {
  root: Element;
  editor: HTMLElement;
  openPicker: HTMLButtonElement;
};
type Picker = {
  scope: Element;
  list: Element;
  preview: HTMLImageElement;
  action: HTMLButtonElement;
};
type GalleryCandidate = { url: string; mediaId: string };

/** Reads only the observed Flow chip identity path; signed query values are ignored. */
export function flowVideoChipMediaIdFromImageUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "flow-content.google" ||
      url.username ||
      url.password ||
      url.port
    ) return undefined;
    return /^\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(url.pathname)?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

const operationByDocument = new WeakMap<
  Document,
  Map<
    string,
    { promise?: Promise<FlowVideoAttachmentResult>; uncertain: boolean }
  >
>();

function visible(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    element.isConnected &&
    style.display !== "none" &&
    !["hidden", "collapse"].includes(style.visibility) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function checkedLabels(doc: Document): string[] {
  const inputs = [
    ...doc.querySelectorAll<HTMLInputElement>("input[type=radio]:checked"),
  ].map((el) =>
    (el.closest("label")?.textContent ?? el.getAttribute("aria-label") ?? "")
      .trim()
      .toLowerCase(),
  );
  const roles = [
    ...doc.querySelectorAll<HTMLElement>("[role=radio][aria-checked=true]"),
  ].map((el) =>
    (el.getAttribute("aria-label") ?? el.textContent ?? "")
      .trim()
      .toLowerCase(),
  );
  return [...inputs, ...roles];
}

export function resolveFlowVideoIngredientsComposer(doc: Document):
  | { ok: true; composer: Composer }
  | {
      ok: false;
      reason:
        | "wrong_frame"
        | "composer_missing"
        | "composer_ambiguous"
        | "composer_unsupported";
    } {
  if (doc.defaultView?.top !== doc.defaultView)
    return { ok: false, reason: "wrong_frame" };
  const roots = [...doc.querySelectorAll("flow-base-prompt-box")].filter(
    visible,
  );
  const editors = [
    ...doc.querySelectorAll<HTMLElement>(
      "flow-base-prompt-box flow-rich-text-editor [contenteditable='true'][role='textbox'][aria-multiline='true'][aria-label='What do you want to create?']",
    ),
  ].filter(visible);
  if (!roots.length || !editors.length)
    return { ok: false, reason: "composer_missing" };
  if (
    roots.length !== 1 ||
    editors.length !== 1 ||
    editors[0]!.closest("flow-base-prompt-box") !== roots[0]
  )
    return { ok: false, reason: "composer_ambiguous" };
  const labels = checkedLabels(doc);
  if (
    labels.filter((x) => x === "video").length !== 1 ||
    labels.filter((x) => x === "ingredients").length !== 1 ||
    labels.some((x) => x === "image" || x === "frames")
  )
    return { ok: false, reason: "composer_unsupported" };
  const open = [
    ...roots[0]!.querySelectorAll<HTMLButtonElement>(
      "button[aria-label='Add ingredients to the prompt box']",
    ),
  ].filter(visible);
  if (open.length !== 1 || open[0]!.disabled)
    return { ok: false, reason: "composer_unsupported" };
  return {
    ok: true,
    composer: { root: roots[0]!, editor: editors[0]!, openPicker: open[0]! },
  };
}

/** Resolves the unique currently rendered gallery image and its picker row by exact observed URL. */
export function resolveFlowPickerCandidate(
  doc: Document,
  galleryUrl: string,
):
  | {
      ok: true;
      candidate: { row: HTMLButtonElement; url: string; mediaId: string };
    }
  | {
      ok: false;
      reason: "candidate_missing_or_virtualized" | "candidate_ambiguous";
    } {
  const gallery = [
    ...doc.querySelectorAll<HTMLImageElement>(
      "flow-image-tile img[data-media-id]",
    ),
  ].filter(
    (img) =>
      visible(img) &&
      (img.currentSrc || img.src) === galleryUrl &&
      Boolean(img.dataset.mediaId),
  );
  if (gallery.length !== 1)
    return {
      ok: false,
      reason: gallery.length
        ? "candidate_ambiguous"
        : "candidate_missing_or_virtualized",
    };
  const rows = [
    ...doc.querySelectorAll<HTMLButtonElement>(
      "[role=listbox][aria-label='Asset list'] button[role=option].asset-item",
    ),
  ];
  const matching = rows.filter((row) =>
    [
      ...row.querySelectorAll<HTMLImageElement>("img.asset-thumbnail-image"),
    ].some((img) => visible(img) && (img.currentSrc || img.src) === galleryUrl),
  );
  if (matching.length !== 1)
    return {
      ok: false,
      reason: matching.length
        ? "candidate_ambiguous"
        : "candidate_missing_or_virtualized",
    };
  return {
    ok: true,
    candidate: {
      row: matching[0]!,
      url: galleryUrl,
      mediaId: gallery[0]!.dataset.mediaId!,
    },
  };
}

function resolvePicker(doc: Document): Picker | undefined {
  const lists = [
    ...doc.querySelectorAll("[role=listbox][aria-label='Asset list']"),
  ].filter(visible);
  const previews = [
    ...doc.querySelectorAll<HTMLImageElement>(
      "img.detail-preview-image[alt^='Preview of']",
    ),
  ].filter(visible);
  if (lists.length !== 1 || previews.length !== 1) return undefined;
  const preview = previews[0]!;
  let scope: Element | null = preview.parentElement;
  while (scope && scope !== doc.body && !scope.contains(lists[0]!))
    scope = scope.parentElement;
  if (!scope || scope === doc.body || scope === doc.documentElement)
    return undefined;
  const actions = [
    ...scope.querySelectorAll<HTMLButtonElement>("button"),
  ].filter(
    (button) =>
      visible(button) &&
      button.textContent?.trim().toLowerCase() === "add to prompt",
  );
  if (actions.length !== 1) return undefined;
  return { scope, list: lists[0]!, preview, action: actions[0]! };
}

function chipState(
  root: Element,
  mediaId: string,
  readChipMediaId: (chip: HTMLButtonElement) => string | undefined,
): "attached" | "busy" | "conflict" | "absent" | "unsupported" {
  const chips = [
    ...root.querySelectorAll<HTMLButtonElement>(
      "button[aria-label='Ingredient']",
    ),
  ];
  const ids = chips.map(readChipMediaId);
  if (ids.some((id) => !id)) return "unsupported";
  const identified = chips.filter((_, index) => ids[index] === mediaId);
  if (identified.length > 1) return "conflict";
  if (ids.includes(mediaId) && identified.length !== 1) return "conflict";
  if (identified.length === 1) {
    if (chips.length !== 1) return "conflict";
    const chip = identified[0]!;
    const image = chip.querySelector<HTMLImageElement>(
      "img[alt='Ingredient image']",
    );
    if (!image || !(image.currentSrc || image.src)) return "unsupported";
    if (chip.getAttribute("aria-busy") === "true") return "busy";
    if (chip.getAttribute("aria-busy") !== "false") return "unsupported";
    return "attached";
  }
  if (chips.some((chip) => chip.getAttribute("aria-busy") === "true"))
    return "busy";
  return "absent";
}

export type FlowVideoAttachmentPorts = {
  target: {
    tabId: number;
    projectId: string;
    canonicalTarget: string;
    documentId: string;
  };
  revalidateBinding: (
    target: FlowVideoAttachmentPorts["target"],
  ) => Promise<boolean>;
  captureCandidate: (url: string) => Promise<Uint8Array | undefined>;
  loadPinnedReference: (
    referenceId: string,
  ) => Promise<ReferenceAssignmentRecord | undefined>;
  /** Only a provider-verified identity mapping may return a Flow media ID. */
  readChipMediaId: (chip: HTMLButtonElement) => string | undefined;
  wait?: (milliseconds: number) => Promise<void>;
  maxWaitMs?: number;
};

export function attachPinnedFlowVideoReference(
  item: PreparedVideoBatchItem,
  doc: Document,
  ports: FlowVideoAttachmentPorts,
): Promise<FlowVideoAttachmentResult> {
  const key = `${ports.target.tabId}:${ports.target.documentId}:${item.reference.referenceId}`;
  const operations =
    operationByDocument.get(doc) ??
    new Map<
      string,
      { promise?: Promise<FlowVideoAttachmentResult>; uncertain: boolean }
    >();
  operationByDocument.set(doc, operations);
  const previous = operations.get(key);
  if (previous?.promise) return previous.promise;
  if (previous?.uncertain) {
    const inspection = inspectUncertainAttachment(item, doc, ports).then(
      (result) => {
        if (result.ok) previous.uncertain = false;
        return result;
      },
    );
    previous.promise = inspection;
    return inspection.finally(() => {
      previous.promise = undefined;
    });
  }
  const state = previous ?? { uncertain: false };
  operations.set(key, state);
  const promise = attachOnce(item, doc, ports, state).finally(() => {
    state.promise = undefined;
  });
  state.promise = promise;
  return promise;
}

async function inspectUncertainAttachment(
  item: PreparedVideoBatchItem,
  doc: Document,
  ports: FlowVideoAttachmentPorts,
): Promise<FlowVideoAttachmentResult> {
  const pinned = await ports.loadPinnedReference(item.reference.referenceId);
  if (!pinned || !ReferenceAssignmentRecordSchema.safeParse(pinned).success)
    return { ok: false, reason: "attachment_uncertain" };
  const ref = item.reference;
  if (
    pinned.referenceId !== ref.referenceId ||
    pinned.assignmentVersion !== ref.assignmentVersion ||
    pinned.sha256 !== ref.sha256 ||
    pinned.flowProjectId !== ports.target.projectId ||
    pinned.tabId !== ports.target.tabId ||
    pinned.canonicalTarget !== ports.target.canonicalTarget ||
    pinned.documentId !== ports.target.documentId
  )
    return { ok: false, reason: "attachment_uncertain" };
  const bytes = new Uint8Array(await pinned.bytes.arrayBuffer());
  if (
    bytes.byteLength !== ref.byteSize ||
    (await sha256Bytes(bytes)) !== ref.sha256 ||
    !(await ports.revalidateBinding(ports.target))
  )
    return { ok: false, reason: "attachment_uncertain" };
  const composer = resolveFlowVideoIngredientsComposer(doc);
  if (!composer.ok) return { ok: false, reason: "attachment_uncertain" };
  const gallery = await resolvePinnedGallery(
    doc,
    pinned.providerAssetId,
    ref.sha256,
    ports.captureCandidate,
  );
  if (!gallery.ok) return { ok: false, reason: "attachment_uncertain" };
  const candidateBytes = await ports.captureCandidate(gallery.candidate.url);
  if (
    !candidateBytes ||
    (await sha256Bytes(candidateBytes)) !== ref.sha256 ||
    !(await ports.revalidateBinding(ports.target))
  )
    return { ok: false, reason: "attachment_uncertain" };
  const currentComposer = resolveFlowVideoIngredientsComposer(doc);
  if (!currentComposer.ok) return { ok: false, reason: "attachment_uncertain" };
  const currentGallery = resolvePinnedGallerySync(
    doc,
    pinned.providerAssetId,
    gallery.candidate.mediaId,
    gallery.candidate.url,
  );
  if (!currentGallery.ok) return { ok: false, reason: "attachment_uncertain" };
  const state = chipState(
    currentComposer.composer.root,
    gallery.candidate.mediaId,
    ports.readChipMediaId,
  );
  if (state === "attached")
    return {
      ok: true,
      alreadyAttached: true,
      referenceId: ref.referenceId,
      byteVerified: true,
      identityVerified: true,
    };
  return {
    ok: false,
    reason:
      state === "unsupported" || state === "conflict"
        ? "attachment_unverified"
        : "attachment_uncertain",
  };
}

async function attachOnce(
  item: PreparedVideoBatchItem,
  doc: Document,
  ports: FlowVideoAttachmentPorts,
  guard: { uncertain: boolean },
): Promise<FlowVideoAttachmentResult> {
  const fail = (reason: FlowVideoFailure): FlowVideoAttachmentResult => ({
    ok: false,
    reason,
  });
  const pinned = await ports.loadPinnedReference(item.reference.referenceId);
  if (!pinned || !ReferenceAssignmentRecordSchema.safeParse(pinned).success)
    return fail("reference_binding_mismatch");
  const ref = item.reference;
  if (
    pinned.referenceId !== ref.referenceId ||
    pinned.assignmentVersion !== ref.assignmentVersion ||
    pinned.sha256 !== ref.sha256 ||
    pinned.mimeType !== ref.mimeType ||
    pinned.byteSize !== ref.byteSize ||
    pinned.width !== ref.width ||
    pinned.height !== ref.height ||
    pinned.flowProjectId !== ports.target.projectId ||
    pinned.tabId !== ports.target.tabId ||
    pinned.canonicalTarget !== ports.target.canonicalTarget ||
    pinned.documentId !== ports.target.documentId
  )
    return fail("reference_binding_mismatch");
  const saved = new Uint8Array(await pinned.bytes.arrayBuffer());
  if (
    saved.byteLength !== ref.byteSize ||
    (await sha256Bytes(saved)) !== ref.sha256
  )
    return fail("reference_bytes_corrupt");
  if (!(await ports.revalidateBinding(ports.target)))
    return fail("target_changed");
  let discovered = resolveFlowVideoIngredientsComposer(doc);
  if (!discovered.ok) return discovered;
  let gallery = await resolvePinnedGallery(
    doc,
    pinned.providerAssetId,
    ref.sha256,
    ports.captureCandidate,
  );
  if (!gallery.ok) return gallery;
  let chips = chipState(
    discovered.composer.root,
    gallery.candidate.mediaId,
    ports.readChipMediaId,
  );
  if (chips === "attached")
    return {
      ok: true,
      alreadyAttached: true,
      referenceId: ref.referenceId,
      byteVerified: true,
      identityVerified: true,
    };
  if (chips !== "absent")
    return fail(
      chips === "busy" ? "attachment_uncertain" : "attachment_unverified",
    );
  const candidateBytes = await ports.captureCandidate(gallery.candidate.url);
  if (!candidateBytes || (await sha256Bytes(candidateBytes)) !== ref.sha256)
    return fail("candidate_bytes_mismatch");
  // Re-resolve every mutable object after asynchronous byte capture.
  if (!(await ports.revalidateBinding(ports.target)))
    return fail("target_changed");
  discovered = resolveFlowVideoIngredientsComposer(doc);
  if (!discovered.ok) return discovered;
  gallery = resolvePinnedGallerySync(
    doc,
    pinned.providerAssetId,
    gallery.candidate.mediaId,
    gallery.candidate.url,
  );
  if (!gallery.ok) return gallery;
  chips = chipState(
    discovered.composer.root,
    gallery.candidate.mediaId,
    ports.readChipMediaId,
  );
  if (chips === "attached")
    return {
      ok: true,
      alreadyAttached: true,
      referenceId: ref.referenceId,
      byteVerified: true,
      identityVerified: true,
    };
  if (chips !== "absent")
    return fail(
      chips === "busy" ? "attachment_uncertain" : "attachment_unverified",
    );
  // Picker opening is safe and read back. Do not use stale composer elements afterward.
  let picker = resolvePicker(doc);
  if (!picker) {
    discovered.composer.openPicker.click();
    picker = await waitForPicker(doc, ports);
  }
  if (!picker) return fail("candidate_missing_or_virtualized");
  let row = resolveFlowPickerCandidate(doc, gallery.candidate.url);
  if (!row.ok) return row;
  if (
    (picker.preview.currentSrc || picker.preview.src) !== gallery.candidate.url
  ) {
    row.candidate.row.click();
    picker = await waitForPreview(doc, gallery.candidate.url, ports);
  }
  if (!picker) return fail("attachment_uncertain");
  // Fresh binding, mode, gallery/picker relation, detail action and chips immediately before action.
  if (!(await ports.revalidateBinding(ports.target)))
    return fail("target_changed");
  discovered = resolveFlowVideoIngredientsComposer(doc);
  if (!discovered.ok) return discovered;
  gallery = resolvePinnedGallerySync(
    doc,
    pinned.providerAssetId,
    gallery.candidate.mediaId,
    gallery.candidate.url,
  );
  if (!gallery.ok) return gallery;
  picker = resolvePicker(doc)!;
  if (
    !picker ||
    (picker.preview.currentSrc || picker.preview.src) !== gallery.candidate.url
  )
    return fail("attachment_unverified");
  row = resolveFlowPickerCandidate(doc, gallery.candidate.url);
  if (!row.ok) return row;
  const before = chipState(
    discovered.composer.root,
    gallery.candidate.mediaId,
    ports.readChipMediaId,
  );
  if (before === "attached")
    return {
      ok: true,
      alreadyAttached: true,
      referenceId: ref.referenceId,
      byteVerified: true,
      identityVerified: true,
    };
  if (before !== "absent")
    return fail(
      before === "busy" ? "attachment_uncertain" : "attachment_unverified",
    );
  guard.uncertain = true;
  try {
    picker.action.click();
  } catch {
    return fail("attachment_uncertain");
  }
  return await waitForChip(doc, ports, item, gallery.candidate.mediaId, guard);
}

async function resolvePinnedGallery(
  doc: Document,
  assetId: string | undefined,
  sha: string,
  capture: FlowVideoAttachmentPorts["captureCandidate"],
): Promise<
  | { ok: true; candidate: GalleryCandidate }
  | {
      ok: false;
      reason:
        | "candidate_missing_or_virtualized"
        | "candidate_ambiguous"
        | "candidate_bytes_mismatch";
    }
> {
  const images = [
    ...doc.querySelectorAll<HTMLImageElement>(
      "flow-image-tile img[data-media-id]",
    ),
  ].filter(visible);
  const candidates = assetId
    ? images.filter((image) => image.dataset.mediaId === assetId)
    : images;
  if (!candidates.length)
    return { ok: false, reason: "candidate_missing_or_virtualized" };
  if (candidates.length > 32)
    return { ok: false, reason: "candidate_ambiguous" };
  const matches: GalleryCandidate[] = [];
  for (const image of candidates) {
    const url = image.currentSrc || image.src;
    if (!url) continue;
    if (
      assetId ||
      (await capture(url).then(async (bytes) =>
        Boolean(bytes && (await sha256Bytes(bytes)) === sha),
      ))
    )
      matches.push({ url, mediaId: image.dataset.mediaId! });
  }
  if (matches.length !== 1)
    return {
      ok: false,
      reason: matches.length
        ? "candidate_ambiguous"
        : assetId
          ? "candidate_missing_or_virtualized"
          : "candidate_bytes_mismatch",
    };
  return { ok: true, candidate: matches[0]! };
}

function resolvePinnedGallerySync(
  doc: Document,
  assetId: string | undefined,
  mediaId: string,
  url: string,
):
  | { ok: true; candidate: GalleryCandidate }
  | {
      ok: false;
      reason: "candidate_missing_or_virtualized" | "candidate_ambiguous";
    } {
  const images = [
    ...doc.querySelectorAll<HTMLImageElement>(
      "flow-image-tile img[data-media-id]",
    ),
  ].filter(
    (image) =>
      visible(image) &&
      image.dataset.mediaId === mediaId &&
      (!assetId || image.dataset.mediaId === assetId) &&
      (image.currentSrc || image.src) === url,
  );
  if (images.length !== 1)
    return {
      ok: false,
      reason: images.length
        ? "candidate_ambiguous"
        : "candidate_missing_or_virtualized",
    };
  return { ok: true, candidate: { url, mediaId } };
}

async function waitForPicker(
  doc: Document,
  ports: FlowVideoAttachmentPorts,
): Promise<Picker | undefined> {
  const wait =
    ports.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (ports.maxWaitMs ?? 1500);
  while (Date.now() < deadline) {
    if (
      !(await ports.revalidateBinding(ports.target)) ||
      !resolveFlowVideoIngredientsComposer(doc).ok
    )
      return undefined;
    const picker = resolvePicker(doc);
    if (picker) return picker;
    await wait(50);
  }
  return undefined;
}

async function waitForPreview(
  doc: Document,
  url: string,
  ports: FlowVideoAttachmentPorts,
): Promise<Picker | undefined> {
  const wait =
    ports.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (ports.maxWaitMs ?? 1500);
  while (Date.now() < deadline) {
    if (
      !(await ports.revalidateBinding(ports.target)) ||
      !resolveFlowVideoIngredientsComposer(doc).ok
    )
      return undefined;
    const picker = resolvePicker(doc);
    if (picker && (picker.preview.currentSrc || picker.preview.src) === url)
      return picker;
    await wait(50);
  }
  return undefined;
}

async function waitForChip(
  doc: Document,
  ports: FlowVideoAttachmentPorts,
  item: PreparedVideoBatchItem,
  mediaId: string,
  guard: { uncertain: boolean },
): Promise<FlowVideoAttachmentResult> {
  const wait =
    ports.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (ports.maxWaitMs ?? 1500);
  while (Date.now() < deadline) {
    if (!(await ports.revalidateBinding(ports.target)))
      return { ok: false, reason: "attachment_uncertain" };
    const composer = resolveFlowVideoIngredientsComposer(doc);
    if (!composer.ok) return { ok: false, reason: "attachment_uncertain" };
    const state = chipState(
      composer.composer.root,
      mediaId,
      ports.readChipMediaId,
    );
    if (state === "attached") {
      guard.uncertain = false;
      return {
        ok: true,
        alreadyAttached: false,
        referenceId: item.reference.referenceId,
        byteVerified: true,
        identityVerified: true,
      };
    }
    if (state === "conflict" || state === "unsupported")
      return { ok: false, reason: "attachment_unverified" };
    await wait(50);
  }
  return { ok: false, reason: "attachment_uncertain" };
}
