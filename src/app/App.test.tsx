import React, { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DownloadsView, ValidatedPromptPanel } from "./App";
import { ImportPreviewSession } from "./features/shared/importPreviewSession";
import type { ImageSubmissionQueueRecord } from "../domain/jobs/queue";

function findElements(
  node: React.ReactNode,
  targetType: string,
): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findElements(child, targetType));
  }
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (typeof node.type === "function") {
    const component = node.type as (
      props: Record<string, unknown>,
    ) => React.ReactNode;
    return findElements(component(node.props), targetType);
  }
  const found = node.type === targetType ? [node] : [];
  return [
    ...found,
    ...findElements(node.props.children as React.ReactNode, targetType),
  ];
}

describe("P01.3 workspace previews", () => {
  it("keeps image and video prompt drafts independent", () => {
    const image = new ImportPreviewSession("image");
    const video = new ImportPreviewSession("video");
    image.setSource('{\r\n  "kind": "image"\r\n}\n');
    video.setSource('{\n  "kind": "video"\n}');
    const changedImage = '{  "image prompt": "edited exactly"  }\r\n';
    const changedVideo = '\n{ "video prompt": "separate edit" }  ';
    const untouchedVideo = video.getSnapshot().source;
    image.setSource(changedImage);
    expect(image.getSnapshot().source).toBe(changedImage);
    expect(video.getSnapshot().source).toBe(untouchedVideo);

    video.setSource(changedVideo);
    expect(video.getSnapshot().source).toBe(changedVideo);
    expect(image.getSnapshot().source).toBe(changedImage);
  });

  it("shows a truthful download empty state without fabricated files or progress", () => {
    const tree = DownloadsView();
    const headings = findElements(tree, "h3").map(
      (heading) => heading.props.children,
    );
    expect(headings).toContain("No eligible downloads");
    expect(headings).not.toContain("SHOT-001_example.mp4");
    expect(findElements(tree, "input")).toHaveLength(0);
    expect(
      findElements(tree, "span").map((entry) => entry.props.style),
    ).not.toContainEqual(
      expect.objectContaining({ width: expect.any(String) }),
    );
  });

  it("shows only actual validated image prompts and an honest empty state", () => {
    let validation: (() => void) | undefined;
    const session = new ImportPreviewSession("image", undefined, (callback) => {
      validation = callback;
      return 1 as ReturnType<typeof setTimeout>;
    });
    const emptyMarkup = renderElement(ValidatedPromptPanel, { session });
    expect(emptyMarkup).toContain("No validated prompts");
    expect(emptyMarkup).toContain("Nothing is sent to Flow");
    expect(emptyMarkup).not.toContain("SHOT-001");
    expect(emptyMarkup).not.toContain("% example");

    session.setSource('{"shot_id":"7"}');
    session.validate();
    validation?.();
    const validatedMarkup = renderElement(ValidatedPromptPanel, { session });
    expect(validatedMarkup).toContain("7");
    expect(validatedMarkup).toContain("Validated preview");
    expect(validatedMarkup).toContain(">Preview</span>");
    expect(validatedMarkup).not.toContain("progressTrack");
    expect(validatedMarkup).not.toContain("Sent to Flow");
  });

  it("reconciles source labels only against an exact saved queue snapshot", () => {
    let validation: (() => void) | undefined;
    const session = new ImportPreviewSession("image", undefined, (callback) => {
      validation = callback;
      return 1 as ReturnType<typeof setTimeout>;
    });
    const source = [
      '{"shot_id":"10","scene_title":"First"}',
      '{"shot_id":"11","scene_title":"Blocked"}',
      '{"shot_id":"12","scene_title":"Later"}',
      '{"shot_id":"13","scene_title":"Later"}',
      '{"shot_id":"14","scene_title":"Later"}',
    ]
      .map((body, index) => `${index + 10}: ${body}`)
      .join("\n");
    session.setSource(source);
    session.validate();
    validation?.();
    const imported = session.getSnapshot().result!.items;
    const items = imported.map((item, order) => ({
      queueItemId: `queue-item-${order}`,
      sourceItemId: `source-item-${order}`,
      order,
      shotId: item.shotId,
      rawJsonBody: item.rawBody,
      promptHash: "a".repeat(64),
      sourceSpan: item.sourceSpan,
      itemState:
        order === 0
          ? ("sent" as const)
          : order === 1
            ? ("blocked" as const)
            : ("pending" as const),
      providerOutcome:
        order === 0 ? ("unknown" as const) : ("not_started" as const),
      ...(order === 0
        ? {
            dispatchReceipt: {
              attemptId: "attempt-10",
              storedAt: 10,
              evidence: "activation_pair_sent_or_uncertain" as const,
            },
          }
        : order === 1
          ? { blockReason: "editor_exact_readback_mismatch" }
          : {}),
    }));
    const queue = {
      queueId: "queue-shot-10-to-14",
      sourceText: source,
      state: "blocked",
      items,
    } as unknown as ImageSubmissionQueueRecord;
    const exactMarkup = renderElement(ValidatedPromptPanel, {
      session,
      savedSource: source,
      currentQueue: queue,
    });
    expect(exactMarkup).toContain(
      "Saved source · status from its exact queue snapshot",
    );
    expect(exactMarkup.match(/>Sent<\/span>/g)).toHaveLength(1);
    expect(exactMarkup.match(/>Blocked<\/span>/g)).toHaveLength(1);
    expect(exactMarkup.match(/>Pending<\/span>/g)).toHaveLength(3);

    const differentSourceMarkup = renderElement(ValidatedPromptPanel, {
      session,
      savedSource: `${source} `,
      currentQueue: queue,
    });
    expect(differentSourceMarkup).toContain("Validated preview");
    expect(differentSourceMarkup).toContain(">Preview</span>");
    expect(differentSourceMarkup).not.toContain(">Sent</span>");
  });
});

function renderElement(
  component: (props: {
    session: ImportPreviewSession;
    savedSource?: string;
    currentQueue?: ImageSubmissionQueueRecord;
  }) => React.ReactNode,
  props: {
    session: ImportPreviewSession;
    savedSource?: string;
    currentQueue?: ImageSubmissionQueueRecord;
  },
) {
  return renderToStaticMarkup(React.createElement(component, props));
}
