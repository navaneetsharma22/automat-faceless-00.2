// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FLOW_1080P_PROOF_CLIP_ID,
  canMarkFlowClipDownloadSaved,
  isFlow1080pProofClip,
} from "../../src/domain/media/flowClipDownloadProof";
import { inspectFlowClipDownloadMenuInPage } from "../../src/platforms/flow/clipDownloadProof";

afterEach(() => {
  document.body.replaceChildren();
});

describe("single-row Flow 1080p proof gate", () => {
  it("allows the requested clip row and rejects a second same-title clip", () => {
    const rows = [
      { title: "make it", clipId: FLOW_1080P_PROOF_CLIP_ID },
      {
        title: "make it",
        clipId: "bbc2bc82-0000-4000-8000-000000000000",
      },
    ];
    expect(rows.filter((row) => isFlow1080pProofClip(row.clipId))).toEqual([
      rows[0],
    ]);
    expect(isFlow1080pProofClip(rows[1]!.clipId)).toBe(false);
  });

  it("does not call a file Saved from completion, filename, or another clip identity", () => {
    expect(
      canMarkFlowClipDownloadSaved({
        selectedProjectId: "project-a",
        selectedClipId: FLOW_1080P_PROOF_CLIP_ID,
        outputProjectId: "project-a",
        outputClipId: "bbc2bc82-0000-4000-8000-000000000000",
        completedMp4: true,
      }),
    ).toBe(false);
    expect(
      canMarkFlowClipDownloadSaved({
        selectedProjectId: "project-a",
        selectedClipId: FLOW_1080P_PROOF_CLIP_ID,
        outputProjectId: "project-a",
        outputClipId: FLOW_1080P_PROOF_CLIP_ID,
        completedMp4: false,
      }),
    ).toBe(false);
    expect(
      canMarkFlowClipDownloadSaved({
        selectedProjectId: "project-a",
        selectedClipId: FLOW_1080P_PROOF_CLIP_ID,
        outputProjectId: "project-a",
        outputClipId: FLOW_1080P_PROOF_CLIP_ID,
        completedMp4: true,
      }),
    ).toBe(true);
  });

  it("recognizes 1080p Upscaled only inside the visible menu controlled by Download media", () => {
    const click = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "Download media";
    trigger.setAttribute("aria-controls", "download-quality-menu");
    trigger.setAttribute("aria-expanded", "true");
    trigger.getBoundingClientRect = () =>
      ({ width: 32, height: 32 }) as DOMRect;
    trigger.addEventListener("click", click);
    const menu = document.createElement("div");
    menu.id = "download-quality-menu";
    menu.setAttribute("role", "menu");
    menu.getBoundingClientRect = () => ({ width: 180, height: 180 }) as DOMRect;
    const original = document.createElement("button");
    original.textContent = "720p Original size";
    original.getBoundingClientRect = () =>
      ({ width: 100, height: 32 }) as DOMRect;
    const upscaled = document.createElement("button");
    upscaled.textContent = "1080p Upscaled";
    upscaled.getBoundingClientRect = () =>
      ({ width: 100, height: 32 }) as DOMRect;
    upscaled.addEventListener("click", click);
    menu.append(original, upscaled);
    document.body.append(trigger, menu);

    expect(
      inspectFlowClipDownloadMenuInPage(
        "project-a",
        FLOW_1080P_PROOF_CLIP_ID,
        `https://flow.google.com/project/project-a/edit/${FLOW_1080P_PROOF_CLIP_ID}`,
      ),
    ).toEqual({
      status: "recognized",
      menuBoundToDownloadMedia: true,
      qualityOptionObserved: true,
      qualityOptionEnabled: true,
    });
    expect(click).not.toHaveBeenCalled();
  });

  it("does not recognize a matching quality label outside the controlled menu", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Download media";
    trigger.setAttribute("aria-controls", "download-quality-menu");
    trigger.setAttribute("aria-expanded", "true");
    trigger.getBoundingClientRect = () =>
      ({ width: 32, height: 32 }) as DOMRect;
    const menu = document.createElement("div");
    menu.id = "download-quality-menu";
    menu.getBoundingClientRect = () => ({ width: 180, height: 180 }) as DOMRect;
    const outside = document.createElement("button");
    outside.textContent = "1080p Upscaled";
    outside.getBoundingClientRect = () =>
      ({ width: 100, height: 32 }) as DOMRect;
    document.body.append(trigger, menu, outside);

    expect(
      inspectFlowClipDownloadMenuInPage(
        "project-a",
        FLOW_1080P_PROOF_CLIP_ID,
        `https://flow.google.com/project/project-a/edit/${FLOW_1080P_PROOF_CLIP_ID}`,
      ),
    ).toEqual({
      status: "blocked",
      blocker: "quality_option_not_found_in_detail_menu",
    });
  });
});
