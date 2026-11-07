export interface SplitterOutput {
  filename: string;
  path: string;
  startSeconds: number;
  endSeconds: number;
  expectedDurationSeconds: number;
  verifiedDurationSeconds: number;
  expectedVideoFrameCount: number;
  frameCadenceVerified: boolean;
  audioStreamVerified: boolean;
  bytes: number;
}

export interface SplitterReport {
  sourceRetained: true;
  source: string;
  encodingPolicy: string;
  outputs: SplitterOutput[];
}

export interface SplitterOptions {
  inputPath: string;
  manifestPath: string;
  outputDir: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  run?: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

export function splitCombinedMp4(options: SplitterOptions): Promise<SplitterReport>;
export function planFixedDurationSplit(settings: unknown, probe: {
  durationSeconds: number;
  video?: { width?: number; height?: number };
  frames: { timestamp: number; duration?: number }[];
}): {
  mode: "fixed_duration";
  sourceDurationSeconds: number;
  sourceFrameCount: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
  timestampDerivedAverageFrameRate: number;
  secondsPerClip: number;
  expectedClipCount: number;
  actualClipCount: number;
  countMismatch: boolean;
  hasShortRemainder: boolean;
  remainderSeconds: number;
  footageBeyondExpectedSeconds: number;
  documentId: string;
  downloadAttemptId: string;
  chromeDownloadId: number;
  sourceFileName: string | null;
  clips: { name: string; startFrameIndex: number; endFrameIndexExclusive: number; startSeconds: number; endSeconds: number; durationSeconds: number; expectedFrameCount: number }[];
};
export function main(args?: string[]): Promise<void>;
