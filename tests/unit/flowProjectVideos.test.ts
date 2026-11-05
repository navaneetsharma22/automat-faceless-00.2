import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectFlowProjectVideosInPage } from "../../src/platforms/flow/projectVideos";

const projectId = "project-test";
const firstAsset = "11111111-2222-4333-8444-555555555555";
const secondAsset = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const firstClip = "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa";
const secondClip = "bbc2bc82-eccc-4cbe-b3bd-2c8ee2fbd7fa";

function installGallery(
  cards: string,
  navigation = `<nav aria-label="Project navigation">
    <button class="mat-mdc-list-item">All media</button>
    <button class="mat-mdc-list-item">Images</button>
    <button class="mat-mdc-list-item" aria-current="page">Videos</button>
  </nav>`,
) {
  const dom = new JSDOM(
    `<!doctype html><body>
      ${navigation}
      <flow-project-page><main class="scroll" style="overflow-y:auto">
        ${cards}
      </main></flow-project-page>
    </body>`,
    { url: `https://flow.google.com/project/${projectId}` },
  );
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("location", dom.window.location);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal("crypto", globalThis.crypto);
  vi.stubGlobal("TextEncoder", TextEncoder);
  vi.spyOn(dom.window.HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    { x: 0, y: 0, width: 180, height: 100, top: 0, right: 180, bottom: 100, left: 0, toJSON: () => ({}) },
  );
  return dom;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Flow project Videos gallery adapter", () => {
  it("keeps same-title cards distinct by demonstrated asset and detail route", async () => {
    installGallery(`
      <flow-video-tile><h3>Same title</h3><img src="https://storage.googleapis.com/flow-content.google/video/${firstAsset}_upsampled?w=320"><a href="/project/${projectId}/edit/${firstClip}">Open</a></flow-video-tile>
      <flow-video-tile><h3>Same title</h3><img src="https://storage.googleapis.com/flow-content.google/video/${secondAsset}_upsampled?w=320"><a href="/project/${projectId}/edit/${secondClip}">Open</a></flow-video-tile>
    `);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string; cards: Array<{ title: string; assetId?: string; detailRoute?: { clipId: string } }> };
    expect(result.status).toBe("ready");
    expect(result.cards.map(({ title, assetId, detailRoute }) => [title, assetId, detailRoute?.clipId])).toEqual([
      ["Same title", firstAsset, firstClip],
      ["Same title", secondAsset, secondClip],
    ]);
  });

  it("rejects an explicit route for another project and ambiguous routes", async () => {
    installGallery(`
      <flow-video-tile><h3>Wrong project</h3><img src="https://storage.googleapis.com/flow-content.google/video/${firstAsset}_upsampled"><a href="/project/other-project/edit/${firstClip}">Open</a></flow-video-tile>
      <flow-video-tile><h3>Ambiguous</h3><img src="https://storage.googleapis.com/flow-content.google/video/${secondAsset}_upsampled"><a href="/project/${projectId}/edit/${firstClip}">First</a><a href="/project/${projectId}/edit/${secondClip}">Second</a></flow-video-tile>
    `);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { cards: Array<{ routeStatus: string }> };
    expect(result.cards.map((card) => card.routeStatus)).toEqual(["mismatch", "ambiguous"]);
  });

  it("marks missing and ambiguous asset identity and rejects a missing Videos selection", async () => {
    const dom = installGallery(`
      <flow-video-tile><h3>Missing</h3><img src="https://storage.googleapis.com/flow-content.google/video/thumbnail.jpg"></flow-video-tile>
      <flow-video-tile><h3>Ambiguous asset</h3><img src="https://storage.googleapis.com/flow-content.google/video/${firstAsset}_${secondAsset}"></flow-video-tile>
    `);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { cards: Array<{ assetStatus: string }> };
    expect(result.cards.map((card) => card.assetStatus)).toEqual(["missing", "ambiguous"]);
    dom.window.document.querySelectorAll("button")[2]?.remove();
    const missingSelection = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string; reason: string };
    expect(missingSelection).toMatchObject({ status: "blocked", reason: "videos_section_not_selected" });
  });

  it("accepts the observed activated Videos button with null ARIA state", async () => {
    installGallery("", `<nav aria-label="Project navigation">
      <button class="mat-mdc-list-item">All media</button>
      <button class="mat-mdc-list-item">Images</button>
      <button class="mat-mdc-list-item mdc-list-item--activated">Videos</button>
    </nav>`);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string };
    expect(result.status).toBe("ready");
  });

  it("does not treat focus classes as Videos selection", async () => {
    installGallery("", `<nav aria-label="Project navigation">
      <button class="mat-mdc-list-item">All media</button>
      <button class="mat-mdc-list-item">Images</button>
      <button class="mat-mdc-list-item cdk-focused cdk-mouse-focused">Videos</button>
    </nav>`);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string; reason: string };
    expect(result).toMatchObject({ status: "blocked", reason: "videos_section_not_selected" });
  });

  it("rejects activated Images when Videos is unselected", async () => {
    installGallery("", `<nav aria-label="Project navigation">
      <button class="mat-mdc-list-item">All media</button>
      <button class="mat-mdc-list-item mdc-list-item--activated">Images</button>
      <button class="mat-mdc-list-item">Videos</button>
    </nav>`);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string; reason: string };
    expect(result).toMatchObject({ status: "blocked", reason: "videos_section_not_selected" });
  });

  it("resolves nested visible Videos text to its owning button once", async () => {
    installGallery("", `<nav aria-label="Project navigation">
      <button class="mat-mdc-list-item"><span class="icon">movie</span><span>Videos</span></button>
      <button class="mat-mdc-list-item">All media</button>
      <button class="mat-mdc-list-item">Images</button>
    </nav>`);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string; reason?: string };
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("videos_section_not_selected");
    const nested = installGallery("", `<nav aria-label="Project navigation">
      <button class="mat-mdc-list-item mdc-list-item--activated"><span class="icon">movie</span><span><b>Videos</b></span></button>
      <button class="mat-mdc-list-item">All media</button>
      <button class="mat-mdc-list-item">Images</button>
    </nav>`);
    const selected = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string };
    expect(selected.status).toBe("ready");
    nested.window.close();
  });

  it("keeps ARIA selection support and ignores Videos labels outside project navigation", async () => {
    installGallery(`<button aria-current="page">Videos</button>`, `<nav aria-label="Project navigation">
      <button class="mat-mdc-list-item">All media</button>
      <button class="mat-mdc-list-item">Images</button>
      <button class="mat-mdc-list-item" aria-selected="true">Videos</button>
    </nav>`);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string; cards: unknown[] };
    expect(result.status).toBe("ready");
    expect(result.cards).toHaveLength(0);

    installGallery(`<button aria-current="page">Videos</button>`, `<nav aria-label="Project navigation">
      <button class="mat-mdc-list-item">All media</button>
      <button class="mat-mdc-list-item">Images</button>
      <button class="mat-mdc-list-item">Videos</button>
    </nav>`);
    const unrelated = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string; reason: string };
    expect(unrelated).toMatchObject({ status: "blocked", reason: "videos_section_not_selected" });
  });

  it("rejects duplicate Videos controls in the project navigation group", async () => {
    installGallery("", `<nav aria-label="Project navigation">
      <button class="mat-mdc-list-item mdc-list-item--activated">Videos</button>
      <button class="mat-mdc-list-item">Videos</button>
      <button class="mat-mdc-list-item">All media</button>
      <button class="mat-mdc-list-item">Images</button>
    </nav>`);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string; reason: string };
    expect(result).toMatchObject({ status: "blocked", reason: "videos_section_not_selected" });
  });

  it("selects Videos from All media before starting discovery and ignores the leading videocam icon", async () => {
    const dom = installGallery(`<flow-gallery>
      <flow-grid-tile-container role="group" aria-label="Video">
        <flow-video-tile><img src="https://flow.google.com/media/rendered-video"></flow-video-tile>
      </flow-grid-tile-container>
    </flow-gallery>`, `<nav role="navigation" aria-label="Project navigation">
      <button class="mat-mdc-list-item mdc-list-item--activated">All media</button>
      <button class="mat-mdc-list-item"><mat-icon>videocam</mat-icon><span><span>Videos</span></span></button>
      <button class="mat-mdc-list-item">Images</button>
    </nav>`);
    const nav = dom.window.document.querySelector("nav")!;
    const buttons = [...nav.querySelectorAll("button")];
    buttons[1]!.addEventListener("click", () => {
      buttons[0]!.classList.remove("mdc-list-item--activated");
      buttons[1]!.classList.add("mdc-list-item--activated");
    });

    const result = await inspectFlowProjectVideosInPage({ projectId, action: "start" }) as {
      status: string;
      cards: unknown[];
    };
    expect(result.status).toBe("ready");
    expect(result.cards).toHaveLength(1);
    expect(buttons[1]!.classList.contains("mdc-list-item--activated")).toBe(true);
  });

  it("reacquires a rerendered Project navigation after selecting Videos", async () => {
    const dom = installGallery(`<flow-gallery>
      <flow-grid-tile-container role="group" aria-label="Video"><flow-video-tile></flow-video-tile></flow-grid-tile-container>
    </flow-gallery>`, `<nav role="navigation" aria-label="Project navigation">
      <button class="mat-mdc-list-item">All media</button>
      <button class="mat-mdc-list-item"><mat-icon>videocam</mat-icon><span>Videos</span></button>
      <button class="mat-mdc-list-item">Images</button>
    </nav>`);
    const scroller = dom.window.document.createElement("div");
    scroller.className = "cdk-virtual-scrollable page-container";
    scroller.style.overflowY = "auto";
    const project = dom.window.document.querySelector("flow-project-page")!;
    project.before(scroller);
    scroller.append(project);
    const oldNav = dom.window.document.querySelector("nav")!;
    oldNav.querySelectorAll("button")[1]!.addEventListener("click", () => {
      const replacement = oldNav.cloneNode(true) as HTMLElement;
      replacement.querySelectorAll("button")[1]!.classList.add("mdc-list-item--activated");
      oldNav.replaceWith(replacement);
    });

    const result = await inspectFlowProjectVideosInPage({ projectId, action: "start" }) as {
      status: string;
      reason?: string;
    };
    expect(result.status).toBe("ready");
    expect(dom.window.document.querySelector("nav button:nth-child(2)")?.classList.contains("mdc-list-item--activated")).toBe(true);
  });

  it("rejects detail routes even when they contain the expected project UUID", async () => {
    const dom = installGallery("");
    dom.window.history.pushState({}, "", `/project/${projectId}/edit/${firstClip}`);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as {
      status: string;
      reason: string;
    };
    expect(result).toMatchObject({ status: "blocked", reason: "project_mismatch" });
  });

  it("enumerates observed group card owners with mixed video and image media", async () => {
    installGallery(`<flow-gallery>
      <flow-grid-tile-container role="group" aria-label="Same title">
        <flow-video-tile><video src="https://storage.googleapis.com/flow-content.google/video/${firstAsset}_upsampled"></video></flow-video-tile>
      </flow-grid-tile-container>
      <flow-grid-tile-container role="group" aria-label="Same title">
        <flow-video-tile><img src="https://storage.googleapis.com/flow-content.google/video/${secondAsset}_upsampled?w=320"></flow-video-tile>
      </flow-grid-tile-container>
    </flow-gallery>`);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as {
      status: string;
      cards: Array<{ title: string; assetId?: string; assetStatus: string; thumbnail: { available: boolean } }>;
    };
    expect(result.status).toBe("ready");
    expect(result.cards.map((card) => [card.title, card.assetId, card.assetStatus])).toEqual([
      ["Same title", firstAsset, "unique"],
      ["Same title", secondAsset, "unique"],
    ]);
    expect(result.cards.map((card) => card.thumbnail.available)).toEqual([false, true]);
  });

  it("opens only the exact observed group card owner, not nested actions", async () => {
    const dom = installGallery(`<flow-grid-tile-container role="group" aria-label="Same title">
      <flow-video-tile><video src="https://flow.google.com/media/rendered-video"></video></flow-video-tile>
      <button aria-label="More options">More options</button>
    </flow-grid-tile-container>`);
    const staleOwner = dom.window.document.querySelector("flow-grid-tile-container")!;
    const snapshot = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as {
      cards: Array<{ nativeTraversalFingerprint?: string }>;
    };
    const fingerprint = snapshot.cards[0]?.nativeTraversalFingerprint;
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const owner = staleOwner.cloneNode(true) as Element;
    staleOwner.replaceWith(owner);
    const nestedAction = dom.window.document.querySelector("button[aria-label='More options']")!;
    const click = vi.fn();
    const nestedClick = vi.fn();
    owner.addEventListener("click", click);
    nestedAction.addEventListener("click", nestedClick);
    const result = await inspectFlowProjectVideosInPage({
      projectId,
      action: "open",
      nativeTraversalFingerprint: fingerprint,
    }) as { status: string };
    expect(result.status).toBe("opened");
    expect(click).toHaveBeenCalledTimes(1);
    expect(nestedClick).not.toHaveBeenCalled();
  });

  it("does not treat an image-only group without the video discriminator as a video card", async () => {
    installGallery(`<flow-grid-tile-container role="group" aria-label="Image only">
      <img src="https://flow.google.com/media/rendered-image">
    </flow-grid-tile-container>`);
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as {
      status: string;
      cards: unknown[];
    };
    expect(result.status).toBe("ready");
    expect(result.cards).toHaveLength(0);
  });

  it("uses the observed virtual scroll ancestor for a bounded increment", async () => {
    const dom = installGallery(`<flow-grid-tile-container role="group" aria-label="Same title">
      <flow-video-tile><img src="https://storage.googleapis.com/flow-content.google/video/${firstAsset}_upsampled"></flow-video-tile>
    </flow-grid-tile-container>`);
    const project = dom.window.document.querySelector("flow-project-page")!;
    const scroller = dom.window.document.createElement("div");
    scroller.className = "cdk-virtual-scrollable page-container";
    scroller.style.overflowY = "auto";
    project.before(scroller);
    scroller.append(project);
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1200 });
    const result = await inspectFlowProjectVideosInPage({ projectId, action: "scroll" }) as {
      scroll: { containerFound: boolean; moved: boolean; top: number; max: number };
    };
    expect(result.scroll).toMatchObject({ containerFound: true, moved: true, top: 300, max: 800 });
  });
});
