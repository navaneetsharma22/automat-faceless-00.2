import React, { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { DownloadsView } from "./App";
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

  it("renders only the selected Downloads preview state", () => {
    const onStateChange = vi.fn();
    const emptyTree = DownloadsView({ state: "empty", onStateChange });
    const emptyRadios = findElements(emptyTree, "input");

    expect(emptyRadios).toHaveLength(2);
    expect(emptyRadios.map((radio) => radio.props.checked)).toEqual([
      true,
      false,
    ]);
    expect(
      findElements(emptyTree, "h3").map((heading) => heading.props.children),
    ).toContain("No downloads yet");
    expect(
      findElements(emptyTree, "h3").map((heading) => heading.props.children),
    ).not.toContain("SHOT-001_example.mp4");

    (emptyRadios[1]?.props.onChange as (event: unknown) => void)({
      currentTarget: { value: "examples" },
    });
    expect(onStateChange).toHaveBeenCalledExactlyOnceWith("examples");

    const examplesTree = DownloadsView({
      state: "examples",
      onStateChange,
    });
    const exampleRadios = findElements(examplesTree, "input");
    const headings = findElements(examplesTree, "h3").map(
      (heading) => heading.props.children,
    );
    expect(exampleRadios.map((radio) => radio.props.checked)).toEqual([
      false,
      true,
    ]);
    expect(headings).toContain("SHOT-001_example.mp4");
    expect(headings).not.toContain("No downloads yet");
  });
});
