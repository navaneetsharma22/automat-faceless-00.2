import { describe, expect, it } from 'vitest';
import { planFixedDurationSplit } from '../../tools/local-mp4-splitter/split-combined-mp4.mjs';

const settings = (secondsPerClip, expectedClipCount) => ({
  version: 1,
  mode: 'fixed_duration',
  sourceDownload: { provider: 'Vids', documentId: 'vids-doc', downloadAttemptId: 'attempt-1', chromeDownloadId: 12, chromeState: 'complete' },
  secondsPerClip,
  expectedClipCount,
  assumption: 'edited_timeline_uses_entered_clip_duration',
});

function probeFor(durationSeconds, frameRate, dimensions = [1920, 1080]) {
  const frameCount = Math.round(durationSeconds * frameRate);
  const frameDuration = 1 / frameRate;
  return {
    durationSeconds,
    video: { width: dimensions[0], height: dimensions[1] },
    frames: Array.from({ length: frameCount }, (_, index) => ({
      timestamp: index * frameDuration,
      duration: frameDuration,
    })),
  };
}

describe('fixed-duration split planning from source frame timestamps', () => {
  it('plans an exact multiple without adding or dropping a clip', () => {
    const plan = planFixedDurationSplit(settings(7, 2), probeFor(14, 30));
    expect(plan.clips).toHaveLength(2);
    expect(plan.clips.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds])).toEqual([[0, 7], [7, 14]]);
    expect(plan.hasShortRemainder).toBe(false);
    expect(plan.countMismatch).toBe(false);
  });

  it('keeps fractional requested durations aligned to measured 29.97 fps source timestamps', () => {
    const plan = planFixedDurationSplit(settings(1.25, 3), probeFor(3.75, 30000 / 1001));
    expect(plan.sourceFrameCount).toBe(112);
    expect(plan.timestampDerivedAverageFrameRate).toBeCloseTo(30000 / 1001, 2);
    expect(plan.clips).toHaveLength(3);
    for (const clip of plan.clips) {
      expect(Number.isInteger(clip.startFrameIndex)).toBe(true);
      expect(Number.isInteger(clip.endFrameIndexExclusive)).toBe(true);
      expect(clip.expectedFrameCount).toBe(clip.endFrameIndexExclusive - clip.startFrameIndex);
    }
    expect(plan.clips.at(-1).endSeconds).toBeCloseTo(plan.sourceDurationSeconds, 8);
  });

  it('shows and includes a short final remainder instead of dropping it', () => {
    const plan = planFixedDurationSplit(settings(7, 2), probeFor(15.5, 2));
    expect(plan.hasShortRemainder).toBe(true);
    expect(plan.remainderSeconds).toBe(1.5);
    expect(plan.actualClipCount).toBe(3);
    expect(plan.clips.at(-1)).toMatchObject({ startSeconds: 14, endSeconds: 15.5, durationSeconds: 1.5 });
  });

  it('reports count mismatch and all footage beyond the expected total duration', () => {
    const plan = planFixedDurationSplit(settings(7, 2), probeFor(15, 25, [1280, 720]));
    expect(plan.countMismatch).toBe(true);
    expect(plan.expectedClipCount).toBe(2);
    expect(plan.actualClipCount).toBe(3);
    expect(plan.footageBeyondExpectedSeconds).toBe(1);
    expect(plan.sourceWidth).toBe(1280);
    expect(plan.sourceHeight).toBe(720);
  });

  it.each([25, 30000 / 1001, 60])('uses actual source timestamps at %s fps without a fixed 24 fps assumption', (frameRate) => {
    const plan = planFixedDurationSplit(settings(1, 2), probeFor(2, frameRate));
    expect(plan.timestampDerivedAverageFrameRate).toBeCloseTo(frameRate, 2);
    expect(plan.sourceFrameCount).toBe(Math.round(2 * frameRate));
    expect(plan.clips.at(-1).endFrameIndexExclusive).toBe(plan.sourceFrameCount);
  });
});
