// @vitest-environment jsdom
// Offline DOM/resource fixtures shaped from user-supplied Flow observations.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachPinnedFlowVideoReference,
  flowVideoChipMediaIdFromImageUrl,
  resolveFlowPickerCandidate,
} from "../../src/platforms/flow/video";
import {
  flowResolveOriginalImageUrlInPage,
  flowRestoreGalleryAfterOriginalResolutionInPage,
} from "../../src/platforms/flow/references";
import { flowVideoAttachmentActionInPage } from "../../src/background/handlers/flowVideoAttachment";
import type { PreparedVideoBatchItem } from "../../src/domain/batches/types";
import type { ReferenceAssignmentRecord } from "../../src/domain/media/references";

const MEDIA_ID = "asset-pinned";
const PINNED_URL = "https://flow.google.com/asb/pinned-opaque";
const DECOY_URL = "https://flow.google.com/asb/decoy-opaque";
const CHIP_URL =
  "https://flow-content.google/image/2f205c4a-8c9f-4a58-abc2-sample?sig=fixture";
let nextDocumentId = 1;

function install(html: string): Document {
  document.body.innerHTML = html;
  sizeElements(document);
  return document;
}

function sizeElements(doc: Document) {
  for (const element of doc.querySelectorAll<HTMLElement>("*")) {
    element.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      top: 0,
      right: 20,
      bottom: 20,
      left: 0,
      toJSON: () => ({}),
    });
  }
}

function composer(mode = "Video", type = "Ingredients") {
  return `<flow-base-prompt-box><flow-rich-text-editor><div contenteditable="true" role="textbox" aria-multiline="true" aria-label="What do you want to create?"></div></flow-rich-text-editor><button aria-label="Add ingredients to the prompt box">Open picker</button><button aria-label="Settings trigger">Settings</button><button aria-label="Start generation">Generate</button></flow-base-prompt-box><button role="radio" aria-checked="true" aria-label="${mode}"></button><button role="radio" aria-checked="true" aria-label="${type}"></button><button role="radio" aria-checked="false" aria-label="Frames"></button>`;
}

function gallery(id = MEDIA_ID, url = PINNED_URL) {
  return `<flow-image-tile><img data-media-id="${id}" src="${url}"></flow-image-tile>`;
}

function picker(
  rows: Array<{ id: string; url: string; title?: string }>,
  initialPreview = DECOY_URL,
) {
  const rowMarkup = rows
    .map(
      (row) =>
        `<button role="option" class="asset-item" data-row-id="${row.id}"><span>${row.title ?? "same title"}</span><img class="asset-thumbnail-image" src="${row.url}"></button>`,
    )
    .join("");
  return `<section data-picker-detail-scope><div role="listbox" aria-label="Asset list">${rowMarkup}</div><aside><img class="detail-preview-image" alt="Preview of selected asset" src="${initialPreview}"><button>Add to prompt</button></aside></section>`;
}

function fixture() {
  const bytes = new Uint8Array([1, 2, 3]);
  const hash =
    "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
  const referenceId = "11111111-1111-4111-8111-111111111111";
  const pinned = {
    assignmentId: "workspace-1:batch-1:1",
    referenceId,
    captureOperationId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "workspace-1",
    batchId: "batch-1",
    batchSourceHash: "a".repeat(64),
    shotId: "1",
    promptHash: "b".repeat(64),
    selectionVersion: "33333333-3333-4333-8333-333333333333",
    assignmentVersion: 1,
    flowProjectId: "project-1",
    tabId: 5,
    canonicalTarget: "flow:project-1",
    documentId: "document-1",
    providerAssetId: MEDIA_ID,
    observedSourceSha256: "c".repeat(64),
    sha256: hash,
    mimeType: "image/png",
    byteSize: bytes.length,
    width: 1,
    height: 1,
    capturedAt: 1,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch",
    qualityProvenance: "observed_resource_original_bytes_no_upscale",
    bytes: new Blob([bytes]),
  } as ReferenceAssignmentRecord;
  const item = {
    reference: {
      referenceId,
      assignmentVersion: 1,
      sha256: hash,
      mimeType: "image/png",
      byteSize: 3,
      width: 1,
      height: 1,
    },
  } as PreparedVideoBatchItem;
  return { bytes, hash, pinned, item };
}

function makePorts(
  pinned: ReferenceAssignmentRecord,
  bytes: Uint8Array,
  overrides: Partial<Parameters<typeof attachPinnedFlowVideoReference>[2]> = {},
) {
  const documentId = `document-${nextDocumentId++}`;
  const targetPinned = { ...pinned, documentId } as ReferenceAssignmentRecord;
  return {
    target: {
      tabId: 5,
      projectId: "project-1",
      canonicalTarget: "flow:project-1",
      documentId,
    },
    revalidateBinding: vi.fn(async () => true),
    captureCandidate: vi.fn(async (url: string) =>
      url === PINNED_URL ? bytes : new Uint8Array([9]),
    ),
    loadPinnedReference: vi.fn(async (id: string) =>
      id === pinned.referenceId ? targetPinned : undefined,
    ),
    readChipMediaId: (chip: HTMLButtonElement) =>
      chip.dataset.testProviderAssetId,
    wait: async (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
    maxWaitMs: 250,
    ...overrides,
  };
}

function setPreviewOnRowClick(doc: Document) {
  const preview = doc.querySelector<HTMLImageElement>(
    "img.detail-preview-image",
  )!;
  for (const row of doc.querySelectorAll<HTMLButtonElement>(
    "button[role=option].asset-item",
  )) {
    row.addEventListener("click", () => {
      preview.src = row.querySelector<HTMLImageElement>(
        "img.asset-thumbnail-image",
      )!.src;
    });
  }
}

function addChip(
  doc: Document,
  mediaId: string,
  { busy = false, ready = true, duplicate = false } = {},
) {
  const root = doc.querySelector("flow-base-prompt-box")!;
  const chip = doc.createElement("button");
  chip.setAttribute("aria-label", "Ingredient");
  chip.dataset.testProviderAssetId = mediaId;
  chip.innerHTML = `<img alt="Ingredient image" src="${CHIP_URL}">`;
  if (busy) chip.setAttribute("aria-busy", "true");
  else if (ready) chip.setAttribute("aria-busy", "false");
  root.append(chip);
  if (duplicate) root.append(chip.cloneNode(true));
  sizeElements(doc);
}

afterEach(() => vi.restoreAllMocks());

describe("Flow original reference source resolution", () => {
  it("opens only the uniquely pinned gallery tile and returns its observed detail URL without constructing it", async () => {
    const id = "66c14f25-59b9-42ea-a6f7-8eeb627dcf87";
    const observedOriginal = `https://flow-content.google/image/${id}?sig=fresh-signed-value`;
    const doc = install(`<flow-image-tile><img data-media-id="${id}" src="https://flow.google.com/asb/representation.webp"></flow-image-tile>`);
    const tile = doc.querySelector("flow-image-tile")!;
    tile.addEventListener("click", () => {
      const image = doc.createElement("img");
      image.alt = "Read-only image view";
      image.src = observedOriginal;
      Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1376 }, naturalHeight: { value: 768 } });
      doc.body.append(image);
      sizeElements(doc);
    });
    const result = await flowResolveOriginalImageUrlInPage({ mediaId: id, galleryUrl: "https://flow.google.com/asb/representation.webp" });
    expect(result).toMatchObject({ ok: true, opened: true, url: observedOriginal });
    expect(result.url).toBe(observedOriginal);
  });

  it("restores the gallery with Escape and refuses an ambiguous pinned tile", async () => {
    const id = "66c14f25-59b9-42ea-a6f7-8eeb627dcf87";
    const doc = install(`<flow-image-tile><img data-media-id="${id}" src="https://flow.google.com/asb/a"></flow-image-tile>`);
    const detail = doc.createElement("img");
    detail.alt = "Read-only image view";
    doc.body.append(detail);
    sizeElements(doc);
    const escape = (event: Event) => { if ((event as KeyboardEvent).key === "Escape") detail.remove(); };
    doc.addEventListener("keydown", escape);
    expect(await flowRestoreGalleryAfterOriginalResolutionInPage({ mediaId: id })).toMatchObject({ ok: true });
    doc.removeEventListener("keydown", escape);
    const duplicate = doc.createElement("flow-image-tile");
    duplicate.innerHTML = `<img data-media-id="${id}" src="https://flow.google.com/asb/b">`;
    doc.body.append(duplicate);
    sizeElements(doc);
    expect(await flowResolveOriginalImageUrlInPage({ mediaId: id, galleryUrl: "https://flow.google.com/asb/a" })).toMatchObject({ ok: false, code: "candidate_ambiguous" });
  });
});

describe("production Flow video attachment picker action", () => {
  it("selects the exact gallery thumbnail before waiting for its delayed detail preview and Add control", async () => {
    const id = "66c14f25-59b9-42ea-a6f7-8eeb627dcf87";
    const galleryUrl = "https://flow.google.com/asb/shot-two-gallery-representation";
    const events: string[] = [];
    const doc = install(`<flow-base-prompt-box><button aria-label="Add ingredients to the prompt box">Open picker</button></flow-base-prompt-box>`);
    const pickerOpen = doc.querySelector<HTMLButtonElement>("button[aria-label='Add ingredients to the prompt box']")!;
    pickerOpen.addEventListener("click", () => {
      events.push("picker-open");
      const section = doc.createElement("section");
      section.dataset.pickerDetailScope = "";
      section.innerHTML = `<div role="listbox" aria-label="Asset list"><button role="option" class="asset-item" data-name="decoy"><img class="asset-thumbnail-image" src="https://flow.google.com/asb/decoy"></button><button role="option" class="asset-item" data-name="pinned"><img class="asset-thumbnail-image" src="${galleryUrl}"></button></div><aside></aside>`;
      doc.body.append(section);
      sizeElements(doc);
      const row = section.querySelector<HTMLButtonElement>("[data-name=pinned]")!;
      row.addEventListener("click", () => {
        events.push("row-click");
        expect(section.querySelector("img.detail-preview-image")).toBeNull();
        expect(section.querySelector("button.add-to-prompt")).toBeNull();
        setTimeout(() => {
          const preview = doc.createElement("img");
          preview.className = "detail-preview-image";
          preview.alt = "Preview of selected asset";
          preview.src = galleryUrl;
          section.querySelector("aside")!.append(preview);
          sizeElements(doc);
          events.push("preview-settled");
          setTimeout(() => {
            const add = doc.createElement("button");
            add.className = "add-to-prompt";
            add.textContent = "Add to prompt";
            add.addEventListener("click", () => {
              events.push("add-click");
              const chip = doc.createElement("button");
              chip.setAttribute("aria-label", "Ingredient");
              chip.setAttribute("aria-busy", "false");
              chip.innerHTML = `<img alt="Ingredient image" src="https://flow-content.google/image/${id}?signed=ephemeral">`;
              doc.querySelector("flow-base-prompt-box")!.append(chip);
              sizeElements(doc);
            });
            section.querySelector("aside")!.append(add);
            sizeElements(doc);
          }, 30);
        }, 30);
      });
    });
    sizeElements(doc);

    const result = await flowVideoAttachmentActionInPage(id, galleryUrl);
    expect(result).toEqual({ ok: true, already: false });
    expect(events).toEqual(["picker-open", "row-click", "preview-settled", "add-click"]);
    expect(doc.querySelectorAll("flow-base-prompt-box button[aria-label='Ingredient']")).toHaveLength(1);
  });

  it("reports exact-row absence separately and never activates Add", async () => {
    const id = "66c14f25-59b9-42ea-a6f7-8eeb627dcf87";
    const galleryUrl = "https://flow.google.com/asb/shot-two-gallery-representation";
    const doc = install(`<flow-base-prompt-box><button aria-label="Add ingredients to the prompt box">Open picker</button></flow-base-prompt-box>`);
    doc.querySelector("button[aria-label='Add ingredients to the prompt box']")!.addEventListener("click", () => {
      const section = doc.createElement("section");
      section.innerHTML = `<div role="listbox" aria-label="Asset list"><button role="option" class="asset-item"><img class="asset-thumbnail-image" src="https://flow.google.com/asb/other"></button></div><aside></aside>`;
      doc.body.append(section);
      sizeElements(doc);
    });
    const result = await flowVideoAttachmentActionInPage(id, galleryUrl);
    expect(result).toEqual({ ok: false, reason: "picker_exact_row_missing" });
    expect(doc.querySelector("button.add-to-prompt")).toBeNull();
  });

  it("distinguishes a mismatched selected preview and an Add control that is not ready", async () => {
    const id = "66c14f25-59b9-42ea-a6f7-8eeb627dcf87";
    const galleryUrl = "https://flow.google.com/asb/shot-two-gallery-representation";
    const build = (previewUrl: string, disabled: boolean) => {
      const doc = install(`<flow-base-prompt-box><button aria-label="Add ingredients to the prompt box">Open picker</button></flow-base-prompt-box>`);
      doc.querySelector("button[aria-label='Add ingredients to the prompt box']")!.addEventListener("click", () => {
        const section = doc.createElement("section");
        section.innerHTML = `<div role="listbox" aria-label="Asset list"><button role="option" class="asset-item"><img class="asset-thumbnail-image" src="${galleryUrl}"></button></div><aside><img class="detail-preview-image" alt="Preview of selected asset" src="${previewUrl}"><button class="add-to-prompt" ${disabled ? "disabled" : ""}>Add to prompt</button></aside>`;
        doc.body.append(section);
        sizeElements(doc);
      });
      return doc;
    };
    build("https://flow.google.com/asb/wrong", false);
    expect(await flowVideoAttachmentActionInPage(id, galleryUrl)).toMatchObject({ ok: false, reason: "picker_selected_preview_mismatch" });
    build(galleryUrl, true);
    expect(await flowVideoAttachmentActionInPage(id, galleryUrl)).toMatchObject({ ok: false, reason: "picker_add_not_ready" });
  });
});

describe("Flow pinned video reference attachment (offline fixtures)", () => {
  it("reads only the supported Flow chip image UUID path and ignores signed query changes", () => {
    const id = "67b8fc4f-e688-4a9b-8cc1-472ff37738d8";
    expect(flowVideoChipMediaIdFromImageUrl(`https://flow-content.google/image/${id}?sig=first`)).toBe(id);
    expect(flowVideoChipMediaIdFromImageUrl(`https://flow-content.google/image/${id}?sig=rotated`)).toBe(id);
    expect(flowVideoChipMediaIdFromImageUrl(`http://flow-content.google/image/${id}`)).toBeUndefined();
    expect(flowVideoChipMediaIdFromImageUrl(`https://other.google/image/${id}`)).toBeUndefined();
    expect(flowVideoChipMediaIdFromImageUrl(`https://flow-content.google/image/not-a-uuid`)).toBeUndefined();
    expect(flowVideoChipMediaIdFromImageUrl(`https://flow-content.google/image/11111111-1111-4111-8111-111111111111/extra`)).toBeUndefined();
  });
  it("regression: uses a separate text action and picks pinned media despite a wrong preview, duplicate titles, and row reorder", async () => {
    const { bytes, pinned, item } = fixture();
    const doc = install(
      `${composer()}${gallery("asset-decoy", DECOY_URL)}${gallery()}${picker([
        { id: "decoy", url: DECOY_URL },
        { id: "pinned", url: PINNED_URL },
      ])}`,
    );
    setPreviewOnRowClick(doc);
    let opens = 0;
    doc
      .querySelector<HTMLButtonElement>(
        "button[aria-label='Add ingredients to the prompt box']",
      )!
      .addEventListener("click", () => {
        opens++;
      });
    let activations = 0;
    const promptInput = vi.fn();
    const settingsClick = vi.fn();
    const generateClick = vi.fn();
    const queueDispatch = vi.fn();
    doc
      .querySelector("[contenteditable]")!
      .addEventListener("input", promptInput);
    doc
      .querySelector("[aria-label='Settings trigger']")!
      .addEventListener("click", settingsClick);
    doc
      .querySelector("[aria-label='Start generation']")!
      .addEventListener("click", generateClick);
    doc.addEventListener("automat:queue-dispatch", queueDispatch);
    doc.querySelector("aside button")!.addEventListener("click", () => {
      activations++;
      setTimeout(() => addChip(doc, MEDIA_ID), 20);
    });
    const ports = makePorts(pinned, bytes);
    const result = await attachPinnedFlowVideoReference(item, doc, ports);
    expect(result).toMatchObject({
      ok: true,
      referenceId: item.reference.referenceId,
      byteVerified: true,
      identityVerified: true,
    });
    expect(doc.querySelector("img.detail-preview-image")!.src).toBe(PINNED_URL);
    expect(ports.loadPinnedReference).toHaveBeenCalledWith(
      item.reference.referenceId,
    );
    expect(activations).toBe(1);
    expect(opens).toBe(0);
    expect(promptInput).not.toHaveBeenCalled();
    expect(settingsClick).not.toHaveBeenCalled();
    expect(generateClick).not.toHaveBeenCalled();
    expect(queueDispatch).not.toHaveBeenCalled();
  });

  it("resolves gallery-to-row by exact URL and rejects missing, ambiguous, or virtualized candidates", () => {
    const exact = install(
      `${gallery()}${picker([{ id: "one", url: PINNED_URL }], PINNED_URL)}`,
    );
    expect(resolveFlowPickerCandidate(exact, PINNED_URL)).toMatchObject({
      ok: true,
      candidate: { mediaId: MEDIA_ID },
    });
    const missing = install(
      `${gallery()}${picker([{ id: "other", url: DECOY_URL }])}`,
    );
    expect(resolveFlowPickerCandidate(missing, PINNED_URL)).toMatchObject({
      ok: false,
      reason: "candidate_missing_or_virtualized",
    });
    const duplicate = install(
      `${gallery()}${gallery()}${picker([{ id: "one", url: PINNED_URL }])}`,
    );
    expect(resolveFlowPickerCandidate(duplicate, PINNED_URL)).toMatchObject({
      ok: false,
      reason: "candidate_ambiguous",
    });
    expect(
      exact.querySelector(
        "button[role='option'] button[aria-label='Add to prompt']",
      ),
    ).toBeNull();
    expect(exact.querySelector("section aside button")?.textContent).toBe(
      "Add to prompt",
    );
  });

  it("opens a closed picker and selects the pinned row before using its separate detail action", async () => {
    const { bytes, pinned, item } = fixture();
    const doc = install(
      `${composer()}${gallery("asset-decoy", DECOY_URL)}${gallery()}`,
    );
    let opens = 0;
    let activations = 0;
    doc
      .querySelector<HTMLButtonElement>(
        "[aria-label='Add ingredients to the prompt box']",
      )!
      .addEventListener("click", () => {
        opens++;
        const wrapper = document.createElement("div");
        wrapper.innerHTML = picker([
          { id: "decoy", url: DECOY_URL },
          { id: "pinned", url: PINNED_URL },
        ]);
        const scope = wrapper.firstElementChild!;
        doc.body.append(scope);
        sizeElements(doc);
        setPreviewOnRowClick(doc);
        scope.querySelector("aside button")!.addEventListener("click", () => {
          activations++;
          setTimeout(() => addChip(doc, MEDIA_ID), 10);
        });
      });
    const result = await attachPinnedFlowVideoReference(
      item,
      doc,
      makePorts(pinned, bytes),
    );
    expect(result).toMatchObject({ ok: true, alreadyAttached: false });
    expect(opens).toBe(1);
    expect(activations).toBe(1);
    expect(doc.querySelector("img.detail-preview-image")!.src).toBe(PINNED_URL);
  });

  it("uses media ID for chip identity across distinct picker and signed chip URLs; missing identity remains unsupported", async () => {
    const { bytes, pinned, item } = fixture();
    const doc = install(
      `${composer()}${gallery()}${picker([{ id: "pinned", url: PINNED_URL }], PINNED_URL)}`,
    );
    addChip(doc, MEDIA_ID);
    const result = await attachPinnedFlowVideoReference(
      item,
      doc,
      makePorts(pinned, bytes),
    );
    expect(result).toMatchObject({
      ok: true,
      alreadyAttached: true,
      identityVerified: true,
    });
    const unsupported = install(
      `${composer()}${gallery()}${picker([{ id: "pinned", url: PINNED_URL }], PINNED_URL)}`,
    );
    // A chip with the observed signed URL form but no provider asset ID cannot be attributed.
    const chip = unsupported.createElement("button");
    chip.setAttribute("aria-label", "Ingredient");
    chip.setAttribute("aria-busy", "false");
    chip.innerHTML = `<img alt="Ingredient image" src="${CHIP_URL}">`;
    unsupported.querySelector("flow-base-prompt-box")!.append(chip);
    sizeElements(unsupported);
    expect(
      await attachPinnedFlowVideoReference(
        item,
        unsupported,
        makePorts(pinned, bytes),
      ),
    ).toMatchObject({ ok: false, reason: "attachment_unverified" });
  });

  it("rejects duplicate, conflicting, busy and missing-ready chips without removing ingredients", async () => {
    const { bytes, pinned, item } = fixture();
    for (const { setup, reason } of [
      {
        setup: (doc: Document) => addChip(doc, MEDIA_ID, { duplicate: true }),
        reason: "attachment_unverified",
      },
      {
        setup: (doc: Document) => {
          addChip(doc, MEDIA_ID);
          addChip(doc, "other-asset");
        },
        reason: "attachment_unverified",
      },
      {
        setup: (doc: Document) => addChip(doc, MEDIA_ID, { busy: true }),
        reason: "attachment_uncertain",
      },
      {
        setup: (doc: Document) => addChip(doc, MEDIA_ID, { ready: false }),
        reason: "attachment_unverified",
      },
    ]) {
      const doc = install(
        `${composer()}${gallery()}${picker([{ id: "pinned", url: PINNED_URL }], PINNED_URL)}`,
      );
      setup(doc);
      const count = doc.querySelectorAll(
        "button[aria-label='Ingredient']",
      ).length;
      expect(
        await attachPinnedFlowVideoReference(
          item,
          doc,
          makePorts(pinned, bytes),
        ),
      ).toMatchObject({ ok: false, reason });
      expect(
        doc.querySelectorAll("button[aria-label='Ingredient']"),
      ).toHaveLength(count);
    }
  });

  it("checks saved and candidate bytes separately and preserves the prepared reference after reselection", async () => {
    const { bytes, pinned, item } = fixture();
    const corrupt = {
      ...pinned,
      bytes: new Blob([new Uint8Array([9, 2, 3])]),
    } as ReferenceAssignmentRecord;
    const doc = install(
      `${composer()}${gallery()}${picker([{ id: "pinned", url: PINNED_URL }], PINNED_URL)}`,
    );
    expect(
      await attachPinnedFlowVideoReference(
        item,
        doc,
        makePorts(corrupt, bytes),
      ),
    ).toMatchObject({ ok: false, reason: "reference_bytes_corrupt" });
    const ports = makePorts(pinned, new Uint8Array([9]));
    expect(
      await attachPinnedFlowVideoReference(item, doc, ports),
    ).toMatchObject({ ok: false, reason: "candidate_bytes_mismatch" });
    expect(ports.loadPinnedReference).toHaveBeenCalledWith(
      item.reference.referenceId,
    );
  });

  it("rechecks candidate, document and target after awaited capture before any attachment", async () => {
    const { bytes, pinned, item } = fixture();
    const changedDoc = install(
      `${composer()}${gallery()}${picker([{ id: "pinned", url: PINNED_URL }], PINNED_URL)}`,
    );
    const changed = makePorts(pinned, bytes, {
      revalidateBinding: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    });
    const changedAction = vi.fn();
    changedDoc
      .querySelector("aside button")!
      .addEventListener("click", changedAction);
    expect(
      await attachPinnedFlowVideoReference(item, changedDoc, changed),
    ).toMatchObject({ ok: false, reason: "target_changed" });
    expect(changedAction).not.toHaveBeenCalled();

    const candidateDoc = install(
      `${composer()}${gallery()}${picker([{ id: "pinned", url: PINNED_URL }], PINNED_URL)}`,
    );
    const candidateAction = vi.fn();
    candidateDoc
      .querySelector("aside button")!
      .addEventListener("click", candidateAction);
    const changedCandidate = makePorts(pinned, bytes, {
      captureCandidate: async () => {
        candidateDoc.querySelector<HTMLImageElement>(
          "flow-image-tile img",
        )!.src = DECOY_URL;
        return bytes;
      },
    });
    expect(
      await attachPinnedFlowVideoReference(
        item,
        candidateDoc,
        changedCandidate,
      ),
    ).toMatchObject({ ok: false, reason: "candidate_missing_or_virtualized" });
    expect(candidateAction).not.toHaveBeenCalled();

    const previewDoc = install(
      `${composer()}${gallery()}${picker([{ id: "pinned", url: PINNED_URL }])}`,
    );
    setPreviewOnRowClick(previewDoc);
    const previewAction = vi.fn();
    previewDoc
      .querySelector("aside button")!
      .addEventListener("click", previewAction);
    let bindingReads = 0;
    const previewChangesDuringRecheck = makePorts(pinned, bytes, {
      revalidateBinding: async () => {
        bindingReads++;
        if (bindingReads === 3) {
          previewDoc.querySelector<HTMLImageElement>(
            "img.detail-preview-image",
          )!.src = DECOY_URL;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return true;
      },
    });
    expect(
      await attachPinnedFlowVideoReference(
        item,
        previewDoc,
        previewChangesDuringRecheck,
      ),
    ).toMatchObject({ ok: false, reason: "attachment_uncertain" });
    expect(previewAction).not.toHaveBeenCalled();
  });

  it("waits for a delayed identity-ready chip, activates once, and blocks concurrent/uncertain replay", async () => {
    const { bytes, pinned, item } = fixture();
    const doc = install(
      `${composer()}${gallery()}${picker([{ id: "pinned", url: PINNED_URL }], PINNED_URL)}`,
    );
    let activations = 0;
    doc.querySelector("aside button")!.addEventListener("click", () => {
      activations++;
      setTimeout(() => addChip(doc, MEDIA_ID), 70);
    });
    const ports = makePorts(pinned, bytes);
    const [first, concurrent] = await Promise.all([
      attachPinnedFlowVideoReference(item, doc, ports),
      attachPinnedFlowVideoReference(item, doc, ports),
    ]);
    expect(first).toMatchObject({ ok: true, alreadyAttached: false });
    expect(concurrent).toEqual(first);
    expect(activations).toBe(1);

    const uncertainDoc = install(
      `${composer()}${gallery()}${picker([{ id: "pinned", url: PINNED_URL }], PINNED_URL)}`,
    );
    const noChipPorts = makePorts(pinned, bytes, { maxWaitMs: 80 });
    const click = vi.fn();
    uncertainDoc
      .querySelector("aside button")!
      .addEventListener("click", click);
    expect(
      await attachPinnedFlowVideoReference(item, uncertainDoc, noChipPorts),
    ).toMatchObject({ ok: false, reason: "attachment_uncertain" });
    expect(
      await attachPinnedFlowVideoReference(item, uncertainDoc, noChipPorts),
    ).toMatchObject({ ok: false, reason: "attachment_uncertain" });
    expect(click).toHaveBeenCalledTimes(1);
    addChip(uncertainDoc, MEDIA_ID);
    expect(
      await attachPinnedFlowVideoReference(item, uncertainDoc, noChipPorts),
    ).toMatchObject({ ok: true, alreadyAttached: true });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("handles an already attached reference with the picker closed and performs no prompt, setting, Generate, or queue action", async () => {
    const { bytes, pinned, item } = fixture();
    const doc = install(`${composer()}${gallery()}`);
    addChip(doc, MEDIA_ID);
    const input = vi.fn(),
      setting = vi.fn(),
      generate = vi.fn(),
      queue = vi.fn();
    doc.querySelector("[contenteditable]")!.addEventListener("input", input);
    doc
      .querySelector("[aria-label='Settings trigger']")!
      .addEventListener("click", setting);
    doc
      .querySelector("[aria-label='Start generation']")!
      .addEventListener("click", generate);
    doc.addEventListener("automat:queue-dispatch", queue);
    const result = await attachPinnedFlowVideoReference(
      item,
      doc,
      makePorts(pinned, bytes),
    );
    expect(result, JSON.stringify(result)).toMatchObject({
      ok: true,
      alreadyAttached: true,
    });
    expect(doc.querySelector("[role=listbox]")).toBeNull();
    expect(input).not.toHaveBeenCalled();
    expect(setting).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });
});
