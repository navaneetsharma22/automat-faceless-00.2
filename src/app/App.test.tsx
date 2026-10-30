import React, { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DownloadsView, ValidatedPromptPanel } from "./App";
import { ImportPreviewSession } from "./features/shared/importPreviewSession";

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
    expect(emptyMarkup).toContain("No validated image batch yet");
    expect(emptyMarkup).not.toContain("SHOT-001");
    expect(emptyMarkup).not.toContain("% example");

    session.setSource('{"shot_id":"7"}');
    session.validate();
    validation?.();
    const validatedMarkup = renderElement(ValidatedPromptPanel, { session });
    expect(validatedMarkup).toContain("7");
    expect(validatedMarkup).toContain("Not sent to Flow");
    expect(validatedMarkup).not.toContain("progressTrack");
    expect(validatedMarkup).not.toContain("Sent to Flow");
  });
});

function renderElement(
  component: (props: { session: ImportPreviewSession }) => React.ReactNode,
  props: { session: ImportPreviewSession },
) {
  return renderToStaticMarkup(React.createElement(component, props));
}
