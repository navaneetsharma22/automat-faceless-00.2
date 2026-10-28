import React, { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { DownloadsView, VideosView } from "./App";
import { type PromptDrafts, updatePromptDrafts } from "./previewState";

function findElement(
  node: React.ReactNode,
  targetType: string,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, targetType);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (node.type === targetType) return node;
  if (typeof node.type === "function") {
    const component = node.type as (
      props: Record<string, unknown>,
    ) => React.ReactNode;
    return findElement(component(node.props), targetType);
  }
  return findElement(node.props.children as React.ReactNode, targetType);
}

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
    const initial: PromptDrafts = {
      images: '{\r\n  "kind": "image"\r\n}\n',
      videos: '{\n  "kind": "video"\n}',
    };
    const changedImage = '{  "image prompt": "edited exactly"  }\r\n';
    const changedVideo = '\n{ "video prompt": "separate edit" }  ';
    const afterImage = updatePromptDrafts(initial, "images", changedImage);

    expect(afterImage.images).toBe(changedImage);
    expect(afterImage.videos).toBe(initial.videos);

    let current = updatePromptDrafts(afterImage, "videos", changedVideo);
    const onVideoChange = (value: string) => {
      current = updatePromptDrafts(current, "videos", value);
    };
    const videoTree = VideosView({
      videoJson: current.videos,
      setVideoJson: onVideoChange,
      wrapLines: false,
      setWrapLines: vi.fn(),
      editorExpanded: false,
      setEditorExpanded: vi.fn(),
      destination: "Flow",
      setDestination: vi.fn(),
      confirmed: false,
      setConfirmed: vi.fn(),
    });
    const videoEditor = findElement(videoTree, "textarea");

    expect(videoEditor?.props.value).toBe(changedVideo);
    (videoEditor?.props.onChange as (event: unknown) => void)({
      currentTarget: { value: "video only" },
    });
    expect(current.videos).toBe("video only");
    expect(current.images).toBe(changedImage);
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
