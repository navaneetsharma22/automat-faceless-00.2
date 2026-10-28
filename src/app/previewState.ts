export type PromptDrafts = {
  images: string;
  videos: string;
};

export type DownloadPreviewState = "empty" | "examples";

export function updatePromptDrafts(
  drafts: PromptDrafts,
  workspace: keyof PromptDrafts,
  value: string,
): PromptDrafts {
  return { ...drafts, [workspace]: value };
}
