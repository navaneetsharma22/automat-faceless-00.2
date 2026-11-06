import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SplitHandoff } from "../../src/app/features/downloads/SplitHandoff";
import { SceneManifest } from "../../src/app/features/downloads/SceneManifest";
import { createSceneBoundaryManifest } from "../../src/domain/media/sceneManifest";

describe("Vids split-to-companion handoff", () => {
  it("offers the split handoff only after the Chrome download is complete", () => {
    const html = renderToStaticMarkup(<SplitHandoff attempt={{
      attemptId: "attempt-12", documentId: "vids-doc-12",
      canonicalTarget: "https://vids.google.com/video/vids-doc-12/edit", tabId: 4,
      state: "downloading", createdAt: 1, updatedAt: 2, downloadId: 23,
    }} />);
    expect(html).toContain("Split downloaded video");
    expect(html).toContain("Available after Chrome reports the intended whole-timeline MP4 download complete");
    expect(html).not.toContain("Run-Local-Vids-Split.cmd");
  });

  it("shows the exact combined download record and a user-launched companion with separate destinations", () => {
    const html = renderToStaticMarkup(<SplitHandoff attempt={{
      attemptId: "attempt-12", documentId: "vids-doc-12",
      canonicalTarget: "https://vids.google.com/video/vids-doc-12/edit", tabId: 4,
      state: "chrome_complete", createdAt: 1, updatedAt: 2, downloadId: 23,
      sourcePath: "C:\\Downloads\\Vids\\vids-doc-12-attempt-12.mp4",
    }} />);
    expect(html).toContain("vids-doc-12");
    expect(html).toContain("attempt-12");
    expect(html).toContain("Chrome download ID");
    expect(html).toContain("C:\\Downloads\\Vids\\vids-doc-12-attempt-12.mp4");
    expect(html).toContain("Chrome’s configured Downloads location");
    expect(html).toContain("choose a separate parent folder");
    expect(html).not.toContain("FFmpeg has been started");
  });

  it("carries the completed download identity into the exported format without guessing a scene count or duration", () => {
    const manifest = createSceneBoundaryManifest({
      provider: "Vids", documentId: "vids-doc-12", attemptId: "attempt-12",
      downloadId: 23, state: "chrome_complete",
    }, [{ name: "scene_alpha", startFrameIndex: 0, endFrameIndexExclusive: 31, startSeconds: 0, endSeconds: 1.033333 }], {
      actualTimelineOrder: true, sourceFrameTimestamps: true,
    });
    expect(manifest.sourceDownload.chromeDownloadId).toBe(23);
    expect(manifest.clips).toHaveLength(1);
    expect(manifest.clips[0]).toMatchObject({ startFrameIndex: 0, endFrameIndexExclusive: 31, startSeconds: 0, endSeconds: 1.033333 });
  });

  it("starts with no assumed scenes or boundary values", () => {
    const html = renderToStaticMarkup(<SceneManifest source={{
      provider: "Vids", documentId: "vids-doc-12", attemptId: "attempt-12",
      downloadId: 23, state: "chrome_complete",
    }} />);
    expect(html).toContain("Each scene entry requires an output name, start frame index, exclusive end frame index, start timestamp, and end timestamp.");
    expect(html).toContain("Add scene boundary");
    expect(html).toContain("I measured each boundary from source MP4 frame timestamps");
    expect(html).not.toContain('value="10"');
    expect(html).not.toContain("scene_1");
  });
});
