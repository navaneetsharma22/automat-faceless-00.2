// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FLOW_1080P_PROOF_CLIP_ID,
  canMarkFlowClipDownloadSaved,
  isFlow1080pProofClip,
} from "../../src/domain/media/flowClipDownloadProof";
import { inspectFlowClipDownloadControlsInPage } from "../../src/platforms/flow/clipDownloadProof";

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

  it("reads visible control labels without activating them", () => {
    const click = vi.fn();
    const download = document.createElement("button");
    download.textContent = "Download media";
    download.getBoundingClientRect = () =>
      ({ width: 100, height: 30 } as DOMRect);
    download.addEventListener("click", click);
    document.body.append(download);

    expect(inspectFlowClipDownloadControlsInPage()).toEqual({
      downloadMediaControlCount: 1,
      explicit1080pControlCount: 0,
    });
    expect(click).not.toHaveBeenCalled();
  });
});
