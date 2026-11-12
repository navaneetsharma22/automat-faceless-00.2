// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flowVideoGalleryCandidateInPage } from "../../src/background/handlers/flowVideoAttachment";

const mediaId = "67b8fc4f-e688-4a9b-8cc1-472ff37738d8";
const galleryUrl = "https://flow.google.com/asb/pinned-fixture";
const rect = { width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

function layout(element: Element) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

function addTile(url = galleryUrl, id = mediaId) {
  const tile = document.createElement("flow-image-tile");
  const image = document.createElement("img");
  image.dataset.mediaId = id;
  image.src = url;
  layout(image);
  tile.append(image);
  document.body.append(tile);
  return image;
}

function addScroller(options: { scrollHeight: number; clientHeight: number; initialTop: number }) {
  const scroller = document.createElement("cdk-virtual-scroll-viewport");
  layout(scroller);
  let top = options.initialTop;
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: options.scrollHeight,
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: options.clientHeight,
  });
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  document.body.append(scroller);
  return {
    scroller,
    get scrollTop() {
      return top;
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("flowVideoGalleryCandidateInPage", () => {
  it("returns the exact media ID already rendered in the gallery", async () => {
    const image = addTile();

    await expect(flowVideoGalleryCandidateInPage(mediaId)).resolves.toMatchObject({
      ok: true,
      candidate: { id: mediaId, url: image.src },
    });
  });

  it("finds a virtualized tile by scrolling the project gallery and leaves it rendered", async () => {
    const viewport = addScroller({
      scrollHeight: 150,
      clientHeight: 100,
      initialTop: 0,
    });
    const original = Object.getOwnPropertyDescriptor(viewport.scroller, "scrollTop")!;
    Object.defineProperty(viewport.scroller, "scrollTop", {
      configurable: true,
      get: original.get,
      set: (value: number) => {
        original.set?.call(viewport.scroller, value);
        if (value >= 50 && !document.querySelector("flow-image-tile")) addTile();
      },
    });

    await expect(flowVideoGalleryCandidateInPage(mediaId)).resolves.toMatchObject({
      ok: true,
      candidate: { id: mediaId, url: galleryUrl },
    });
    expect(viewport.scrollTop).toBe(50);
    expect(document.querySelectorAll("flow-image-tile")).toHaveLength(1);
  });

  it("reports candidate_missing and restores the original scroll position", async () => {
    const viewport = addScroller({
      scrollHeight: 150,
      clientHeight: 100,
      initialTop: 10,
    });

    await expect(flowVideoGalleryCandidateInPage(mediaId)).resolves.toMatchObject({
      ok: false,
      reason: "candidate_missing",
    });
    expect(viewport.scrollTop).toBe(10);
  });

  it("reports candidate_ambiguous when more than one visible tile has the pinned media ID", async () => {
    addTile();
    addTile(`${galleryUrl}-duplicate`);

    await expect(flowVideoGalleryCandidateInPage(mediaId)).resolves.toMatchObject({
      ok: false,
      reason: "candidate_ambiguous",
    });
  });
});
