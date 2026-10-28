import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { INPUT_POLICY } from "../../src/domain/batches/inputPolicy";
import { importPromptBatch } from "../../src/domain/batches/importBatch";
import { ImageImportPanel } from "../../src/app/features/image-batch/ImportPanel";
import { VideoImportPanel } from "../../src/app/features/video-batch/ImportPanel";
import { ImportPreviewSession } from "../../src/app/features/shared/importPreviewSession";
import {
  ImportFileError,
  readJsonSourceFile,
} from "../../src/app/features/shared/importFile";
import { ToastHost } from "../../src/app/components/ToastHost";
import {
  promptSizeFixtures,
  representativeCases,
} from "../fixtures/prompts/promptFixtures";

function makeScheduledSession(kind: "image" | "video") {
  let scheduled: (() => void) | undefined;
  const session = new ImportPreviewSession(
    kind,
    importPromptBatch,
    (callback) => {
      scheduled = callback;
      return 1 as ReturnType<typeof setTimeout>;
    },
    () => 12,
  );
  return {
    session,
    run: () => {
      const callback = scheduled;
      if (!callback) throw new Error("No validation callback was scheduled");
      callback();
    },
  };
}

function renderImportPanel(
  kind: "image" | "video",
  session: ImportPreviewSession,
) {
  const props = {
    session,
    exampleSource: '{"scene":"SYNTHETIC example"}',
    wrapLines: false,
    setWrapLines: () => undefined,
    editorExpanded: false,
    setEditorExpanded: () => undefined,
  };
  const panel =
    kind === "image"
      ? createElement(ImageImportPanel, props)
      : createElement(VideoImportPanel, props);
  return renderToStaticMarkup(createElement(ToastHost, null, panel));
}

describe("P03.3 import preview integration", () => {
  it("keeps image and video drafts independent and renders separate import panels", () => {
    const image = new ImportPreviewSession("image");
    const video = new ImportPreviewSession("video");
    const imageSource = '{\r\n  "shot_id":"01", "image":"source"\r\n}';
    const videoSource = '{\n  "shot_id":"02", "video":"source"\n}';
    image.setSource(imageSource);
    video.setSource(videoSource);

    expect(image.getSnapshot().source).toBe(imageSource);
    expect(video.getSnapshot().source).toBe(videoSource);
    image.setSource('{"shot_id":"3"}');
    expect(video.getSnapshot().source).toBe(videoSource);

    const imageMarkup = renderImportPanel("image", image);
    const videoMarkup = renderImportPanel("video", video);
    expect(imageMarkup).toContain("Image prompt source");
    expect(videoMarkup).toContain("Video prompt source");
    expect(imageMarkup).toContain("&quot;shot_id&quot;:&quot;3&quot;");
    expect(videoMarkup).toContain("&quot;shot_id&quot;:&quot;02&quot;");

    const example = new ImportPreviewSession("image");
    example.setSource('{"scene":"SYNTHETIC example"}');
    expect(renderImportPanel("image", example)).toContain(
      "Synthetic example loaded. This is test content",
    );
  });

  it("shows only current complete result counts and IDs with provider-safe wording", () => {
    const { session, run } = makeScheduledSession("image");
    session.setSource(representativeCases.numberedTwoBodies.source);
    const validationId = session.validate();
    expect(session.getSnapshot().status).toBe("pending");
    expect(session.getSnapshot().validationId).toBe(validationId);
    run();

    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe("success");
    expect(snapshot.result?.items.map((item) => item.shotId)).toEqual([
      "1",
      "2",
    ]);
    const markup = renderImportPanel("image", session);
    expect(markup).toContain("2 prompts detected");
    expect(markup).toContain("Shot ID 1");
    expect(markup).toContain("Shot ID 2");
    expect(markup).toContain("Nothing has been sent to a provider");
    expect(markup).toContain("Show raw body");
    expect(markup).not.toContain("<pre");
  });

  it("retains the previous successful preview as stale after edits or failure", () => {
    const { session, run } = makeScheduledSession("video");
    const initial = '{"shot_id":"8","scene":"valid"}';
    session.setSource(initial);
    session.validate();
    run();
    expect(session.getSnapshot().status).toBe("success");

    session.setSource('{"shot_id":"9","scene":');
    expect(session.getSnapshot().status).toBe("idle");
    expect(session.getSnapshot().result?.items[0]?.rawBody).toBe(initial);
    session.validate();
    run();
    const failed = session.getSnapshot();
    expect(failed.status).toBe("error");
    expect(failed.error?.code).toBe("incomplete_json");
    expect(failed.result?.items[0]?.rawBody).toBe(initial);
    expect(failed.resultRevision).not.toBe(failed.revision);
    const markup = renderImportPanel("video", session);
    expect(markup).toContain("PREVIOUS RESULT");
    expect(markup).toContain("does not describe the current draft");
    expect(markup).toContain("Line 1, column");
  });

  it("ignores a scheduled validation after a newer draft revision", () => {
    const { session, run } = makeScheduledSession("image");
    session.setSource('{"shot_id":"1"}');
    session.validate();
    session.setSource('{"shot_id":"2"}');
    run();
    expect(session.getSnapshot().source).toBe('{"shot_id":"2"}');
    expect(session.getSnapshot().status).toBe("idle");
    expect(session.getSnapshot().result).toBeUndefined();
  });

  it("rejects oversized files before reading and decodes only UTF-8 with a leading BOM", async () => {
    let readCount = 0;
    const tooLarge = {
      size: INPUT_POLICY.maxBatchUtf8Bytes + 1,
      arrayBuffer: async () => {
        readCount += 1;
        return new ArrayBuffer(0);
      },
    };
    await expect(readJsonSourceFile(tooLarge)).rejects.toMatchObject<
      Partial<ImportFileError>
    >({ code: "file_too_large" });
    expect(readCount).toBe(0);

    const original = '{\r\n  "shot_id":"01",\r\n  "scene":"BOM file"\r\n}';
    const encoded = new TextEncoder().encode(`\uFEFF${original}`);
    const file = {
      size: encoded.byteLength,
      arrayBuffer: async () =>
        encoded.buffer.slice(
          encoded.byteOffset,
          encoded.byteOffset + encoded.byteLength,
        ),
    };
    expect(await readJsonSourceFile(file)).toBe(original);

    const invalidBytes = new Uint8Array([0xff, 0xfe, 0xfd]);
    await expect(
      readJsonSourceFile({
        size: invalidBytes.byteLength,
        arrayBuffer: async () => invalidBytes.buffer,
      }),
    ).rejects.toMatchObject({ code: "invalid_utf8" });
  });

  it("measures validation time for all existing large image and video fixtures", () => {
    const timings: string[] = [];
    for (const fixture of promptSizeFixtures) {
      let scheduled: (() => void) | undefined;
      const session = new ImportPreviewSession(
        fixture.kind,
        importPromptBatch,
        (callback) => {
          scheduled = callback;
          return 1 as ReturnType<typeof setTimeout>;
        },
      );
      session.setSource(fixture.rawBody);
      const samples: number[] = [];
      for (let repeat = 0; repeat < 5; repeat += 1) {
        scheduled = undefined;
        session.validate();
        if (!scheduled) throw new Error("No validation callback was scheduled");
        scheduled();
        const snapshot = session.getSnapshot();
        expect(snapshot.status, fixture.name).toBe("success");
        expect(snapshot.result?.items[0]?.rawBody).toBe(fixture.rawBody);
        expect(snapshot.elapsedMs).toBeGreaterThanOrEqual(0);
        samples.push(snapshot.elapsedMs!);
      }
      const ordered = [...samples].sort((a, b) => a - b);
      const median = ordered[Math.floor(ordered.length / 2)]!;
      const maximum = ordered[ordered.length - 1]!;
      timings.push(
        `${fixture.name}:${median.toFixed(1)}ms median/${maximum.toFixed(1)}ms max`,
      );
    }
    console.info(`P03.3 synthetic validation timings: ${timings.join(", ")}`);
  });
});
