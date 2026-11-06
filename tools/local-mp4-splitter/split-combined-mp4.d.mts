export interface SplitterOutput {
  filename: string;
  path: string;
  startSeconds: number;
  endSeconds: number;
  expectedDurationSeconds: number;
  verifiedDurationSeconds: number;
  expectedVideoFrameCount: number;
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
export function main(args?: string[]): Promise<void>;
