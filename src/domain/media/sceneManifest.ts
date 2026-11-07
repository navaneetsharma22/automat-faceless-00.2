import { z } from "zod";

const sceneName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const sceneClip = z.object({
  name: sceneName,
  startFrameIndex: z.number().int().nonnegative(),
  endFrameIndexExclusive: z.number().int().positive(),
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().positive(),
}).strict();

const sourceDownload = z.object({
  provider: z.literal("Vids"),
  documentId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  downloadAttemptId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  chromeDownloadId: z.number().int().nonnegative(),
  chromeState: z.literal("complete"),
  sourceFileName: z.string().min(1).max(255).refine((value) => !/[\\/]/.test(value), "Use a file name, not a local path.").optional(),
}).strict();

/** Settings for local companion planning; ranges are generated from the selected MP4. */
export const FixedDurationSplitSettingsSchema = z.object({
  version: z.literal(1),
  mode: z.literal("fixed_duration"),
  sourceDownload,
  secondsPerClip: z.number().finite().positive().max(3600),
  expectedClipCount: z.number().int().min(1).max(100),
  assumption: z.literal("edited_timeline_uses_entered_clip_duration"),
}).strict();

export type FixedDurationSplitSettings = z.infer<typeof FixedDurationSplitSettingsSchema>;

export const SceneBoundaryManifestSchema = z.object({
  version: z.literal(1),
  sourceDownload,
  boundaryProvenance: z.object({
    assertion: z.literal("user_attested"),
    timelineOrder: z.literal("actual_edited_vids_timeline"),
    boundarySource: z.literal("source_mp4_frame_timestamps"),
    frameIndexBase: z.literal(0),
    frameRange: z.literal("start_inclusive_end_exclusive"),
  }).strict(),
  clips: z.array(sceneClip).min(1).max(100),
}).strict().superRefine((manifest, context) => {
  const names = new Set<string>();
  let previousEndFrame = -1;
  let previousEndSeconds = -1;
  manifest.clips.forEach((clip, index) => {
    const lowerName = clip.name.toLowerCase();
    if (names.has(lowerName)) {
      context.addIssue({ code: "custom", path: ["clips", index, "name"], message: "Scene names must be unique, including case-only differences." });
    }
    names.add(lowerName);
    if (clip.endFrameIndexExclusive <= clip.startFrameIndex) {
      context.addIssue({ code: "custom", path: ["clips", index, "endFrameIndexExclusive"], message: "End frame must be after start frame." });
    }
    if (clip.endSeconds <= clip.startSeconds) {
      context.addIssue({ code: "custom", path: ["clips", index, "endSeconds"], message: "End time must be after start time." });
    }
    if (clip.startFrameIndex < previousEndFrame || clip.startSeconds < previousEndSeconds) {
      context.addIssue({ code: "custom", path: ["clips", index], message: "Scenes must follow actual timeline order and cannot overlap; gaps are allowed." });
    }
    previousEndFrame = clip.endFrameIndexExclusive;
    previousEndSeconds = clip.endSeconds;
  });
});

export type SceneBoundaryClip = z.infer<typeof sceneClip>;
export type SceneBoundaryManifest = z.infer<typeof SceneBoundaryManifestSchema>;
export type SceneBoundaryDownloadRecord = {
  provider: "Vids";
  documentId: string;
  attemptId: string;
  downloadId: number;
  state: "chrome_complete";
  sourcePath?: string;
};

export function sourceFileNameFromPath(sourcePath?: string): string | undefined {
  if (!sourcePath) return undefined;
  const fileName = sourcePath.split(/[\\/]/).filter(Boolean).at(-1);
  return fileName && fileName.length <= 255 ? fileName : undefined;
}

export function createSceneBoundaryManifest(
  source: SceneBoundaryDownloadRecord,
  clips: readonly SceneBoundaryClip[],
  attestations: { actualTimelineOrder: boolean; sourceFrameTimestamps: boolean },
): SceneBoundaryManifest {
  if (!attestations.actualTimelineOrder || !attestations.sourceFrameTimestamps) {
    throw new Error("Confirm the edited Vids timeline order and source-frame timestamp measurements before exporting.");
  }
  if (clips.length === 0) throw new Error("Add each intended scene in actual edited timeline order.");
  const parsed = SceneBoundaryManifestSchema.safeParse({
    version: 1,
    sourceDownload: {
      provider: source.provider,
      documentId: source.documentId,
      downloadAttemptId: source.attemptId,
      chromeDownloadId: source.downloadId,
      chromeState: "complete",
      ...(sourceFileNameFromPath(source.sourcePath) ? { sourceFileName: sourceFileNameFromPath(source.sourcePath) } : {}),
    },
    boundaryProvenance: {
      assertion: "user_attested",
      timelineOrder: "actual_edited_vids_timeline",
      boundarySource: "source_mp4_frame_timestamps",
      frameIndexBase: 0,
      frameRange: "start_inclusive_end_exclusive",
    },
    clips,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Scene boundary manifest is invalid.");
  return parsed.data;
}

export function serializeSceneBoundaryManifest(manifest: SceneBoundaryManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function createFixedDurationSplitSettings(
  source: SceneBoundaryDownloadRecord,
  secondsPerClip: number,
  expectedClipCount: number,
): FixedDurationSplitSettings {
  const parsed = FixedDurationSplitSettingsSchema.safeParse({
    version: 1,
    mode: "fixed_duration",
    sourceDownload: {
      provider: source.provider,
      documentId: source.documentId,
      downloadAttemptId: source.attemptId,
      chromeDownloadId: source.downloadId,
      chromeState: "complete",
      ...(sourceFileNameFromPath(source.sourcePath) ? { sourceFileName: sourceFileNameFromPath(source.sourcePath) } : {}),
    },
    secondsPerClip,
    expectedClipCount,
    assumption: "edited_timeline_uses_entered_clip_duration",
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Fixed-duration split settings are invalid.");
  return parsed.data;
}

export function serializeFixedDurationSplitSettings(settings: FixedDurationSplitSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
