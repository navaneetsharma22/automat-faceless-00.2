// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareFlowClipDownloadInPage } from "../../src/platforms/flow/clipDownload";

const project = "000936e1-dc7a-4421-988b-d4c66a804aed";
const clip = "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa";
const asset = "d8d91f05-e14d-4e15-964f-104981510af6";
const otherClip = "bbc2bc82-eccc-4cbe-b3bd-2c8ee2fbd7fa";
const otherAsset = "5a796d9e-5c1a-414a-a961-ed77e35c78a3";

function page() {
  vi.stubGlobal(
    "location",
    new URL(`https://flow.google.com/project/${project}/edit/${clip}`),
  );
  document.body.innerHTML = `<flow-navigation-rail-thumbnail>
    <button aria-current="true" aria-label="make it"><img src="https://storage.googleapis.com/ai-sandbox-videofx/image/${asset}?Signature=private-token"></button>
    </flow-navigation-rail-thumbnail>
    <button aria-label="Download media" aria-expanded="false"></button>
    <div id="quality" role="menu" hidden><button role="menuitem">1080p Upscaled</button></div>`;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 20,
    y: 20,
    width: 100,
    height: 40,
  } as DOMRect);
  const trigger = document.querySelector<HTMLButtonElement>(
    '[aria-label="Download media"]',
  )!;
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  const option = menu.querySelector<HTMLButtonElement>("button")!;
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => option,
  });
  const open = vi.fn(() => {
    trigger.setAttribute("aria-controls", "quality");
    trigger.setAttribute("aria-expanded", "true");
    menu.hidden = false;
  });
  trigger.addEventListener("click", open);
  return { trigger, menu, option, open };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("Flow clip download preparation", () => {
  it("opens only the native menu and identifies the selected asset without selecting quality", async () => {
    const { option, open } = page();
    const select = vi.spyOn(option, "click");
    const result = await prepareFlowClipDownloadInPage(
      project,
      clip,
      undefined,
      true,
    );
    expect(result).toEqual({ status: "ready", assetId: asset, x: 70, y: 40 });
    expect(open).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("rejects another same-title row before opening the menu", async () => {
    const { open } = page();
    expect(
      await prepareFlowClipDownloadInPage(project, otherClip, undefined, true),
    ).toMatchObject({
      status: "blocked",
      reason: "flow_clip_detail_route_mismatch",
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("supports the second real same-title mapping without a hardcoded production clip", async () => {
    page();
    vi.stubGlobal(
      "location",
      new URL(`https://flow.google.com/project/${project}/edit/${otherClip}`),
    );
    document.querySelector("img")!.src =
      `https://storage.googleapis.com/ai-sandbox-videofx/image/${otherAsset}`;
    expect(
      await prepareFlowClipDownloadInPage(project, otherClip, undefined, true),
    ).toMatchObject({ status: "ready", assetId: otherAsset });
  });

  it("rejects duplicate active thumbnails and a changed asset", async () => {
    page();
    expect(
      await prepareFlowClipDownloadInPage(project, clip, otherAsset, true),
    ).toMatchObject({ reason: "flow_clip_selected_asset_changed" });
    document.body.append(
      document.querySelector("flow-navigation-rail-thumbnail")!.cloneNode(true),
    );
    expect(
      await prepareFlowClipDownloadInPage(project, clip, undefined, true),
    ).toMatchObject({ reason: "flow_clip_selected_asset_unavailable" });
  });

  it("rejects an unrelated 1080p item outside the bound menu", async () => {
    const { option } = page();
    document.body.append(option);
    expect(
      await prepareFlowClipDownloadInPage(project, clip, undefined, true),
    ).toMatchObject({ reason: "flow_detail_download_menu_not_ready" });
  });

  it("rejects disabled or obscured quality items", async () => {
    const { option } = page();
    option.disabled = true;
    expect(
      await prepareFlowClipDownloadInPage(project, clip, undefined, true),
    ).toMatchObject({ reason: "flow_clip_1080p_unavailable" });
    option.disabled = false;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => document.body,
    });
    expect(
      await prepareFlowClipDownloadInPage(project, clip, asset),
    ).toMatchObject({ reason: "flow_clip_quality_obscured" });
  });
});
