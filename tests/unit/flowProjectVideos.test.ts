import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectFlowProjectVideosInPage } from "../../src/platforms/flow/projectVideos";

const projectId = "project-test";
const firstAsset = "11111111-2222-4333-8444-555555555555";
const secondAsset = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const firstClip = "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa";
const secondClip = "bbc2bc82-eccc-4cbe-b3bd-2c8ee2fbd7fa";

function installGallery(cards: string) {
  const dom = new JSDOM(
    `<!doctype html><body>
      <button aria-current="page">Videos</button>
      <flow-project-page><main class="scroll" style="overflow-y:auto">
        ${cards}
      </main></flow-project-page>
    </body>`,
    { url: `https://flow.google.com/project/${projectId}/videos` },
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
    dom.window.document.querySelector("button")?.remove();
    const missingSelection = await inspectFlowProjectVideosInPage({ projectId, action: "snapshot" }) as { status: string; reason: string };
    expect(missingSelection).toMatchObject({ status: "blocked", reason: "videos_section_not_selected" });
  });
});
