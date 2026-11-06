import { describe, expect, it } from "vitest";
import { createSceneBoundaryManifest, serializeSceneBoundaryManifest, sourceFileNameFromPath } from "../../src/domain/media/sceneManifest";

const source = {
  provider: "Vids" as const,
  documentId: "edited-document-7",
  attemptId: "attempt-45",
  downloadId: 991,
  state: "chrome_complete" as const,
  sourcePath: "C:\\Users\\Example\\Downloads\\Vids\\edited-document-7-attempt-45 (1).mp4",
};
const clips = [
  { name: "opening", startFrameIndex: 0, endFrameIndexExclusive: 21, startSeconds: 0, endSeconds: 0.7 },
  { name: "later_scene", startFrameIndex: 24, endFrameIndexExclusive: 75, startSeconds: 0.8, endSeconds: 2.5 },
];

describe("explicit source-timeline scene manifest", () => {
  it("links measured irregular cuts to the exact completed Vids download record", () => {
    const manifest = createSceneBoundaryManifest(source, clips, {
      actualTimelineOrder: true,
      sourceFrameTimestamps: true,
    });
    expect(manifest.sourceDownload).toEqual({
      provider: "Vids",
      documentId: source.documentId,
      downloadAttemptId: source.attemptId,
      chromeDownloadId: source.downloadId,
      chromeState: "complete",
      sourceFileName: "edited-document-7-attempt-45 (1).mp4",
    });
    expect(manifest.clips.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds])).toEqual([[0, 0.7], [0.8, 2.5]]);
    expect(manifest.boundaryProvenance).toMatchObject({
      assertion: "user_attested",
      timelineOrder: "actual_edited_vids_timeline",
      boundarySource: "source_mp4_frame_timestamps",
      frameRange: "start_inclusive_end_exclusive",
    });
    expect(JSON.parse(serializeSceneBoundaryManifest(manifest))).toEqual(manifest);
  });

  it("requires both timeline and source-frame attestations and never invents cuts", () => {
    expect(() => createSceneBoundaryManifest(source, [], {
      actualTimelineOrder: true, sourceFrameTimestamps: true,
    })).toThrow("Add each intended scene");
    expect(() => createSceneBoundaryManifest(source, clips, {
      actualTimelineOrder: true, sourceFrameTimestamps: false,
    })).toThrow("Confirm the edited Vids timeline order");
  });

  it("rejects overlapping, out-of-order, duplicate-name, and invalid frame/time entries", () => {
    const overlap = [clips[0]!, { ...clips[1]!, startFrameIndex: 20, startSeconds: 0.6 }];
    expect(() => createSceneBoundaryManifest(source, overlap, { actualTimelineOrder: true, sourceFrameTimestamps: true }))
      .toThrow("cannot overlap");
    expect(() => createSceneBoundaryManifest(source, [clips[0]!, { ...clips[1]!, name: "OPENING" }], { actualTimelineOrder: true, sourceFrameTimestamps: true }))
      .toThrow("Scene names must be unique");
    expect(() => createSceneBoundaryManifest(source, [{ ...clips[0]!, endFrameIndexExclusive: 0 }], { actualTimelineOrder: true, sourceFrameTimestamps: true }))
      .toThrow();
  });

  it("keeps only a filename from the Chrome source path", () => {
    expect(sourceFileNameFromPath(source.sourcePath)).toBe("edited-document-7-attempt-45 (1).mp4");
    expect(sourceFileNameFromPath(undefined)).toBeUndefined();
  });
});
