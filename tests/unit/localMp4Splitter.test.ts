import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { splitCombinedMp4 } from '../../tools/local-mp4-splitter/split-combined-mp4.mjs';

const temporaryDirectories: string[] = [];
const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automat-mp4-split-'));
  temporaryDirectories.push(root);
  const outputDir = path.join(root, 'outputs');
  await mkdir(outputDir);
  const inputPath = path.join(root, 'combined.mp4');
  const manifestPath = path.join(root, 'boundaries.json');
  await writeFile(inputPath, 'retained combined source');
  return { root, outputDir, inputPath, manifestPath };
}

function fakeMediaRunner(inputPath: string) {
  return async (command: string, args: string[]) => {
    if (command === 'ffprobe') {
      if (args.includes('-show_frames')) {
        const isSource = args.at(-1) === inputPath;
        const duration = isSource ? 2 : 1;
        const timestamps = isSource ? [0, 0.5, 1, 1.5] : [0, 0.5];
        return {
          stdout: JSON.stringify({
            streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }],
            format: { duration: String(duration) },
            frames: timestamps.map((timestamp) => ({
              best_effort_timestamp_time: String(timestamp),
              pkt_duration_time: '0.5',
            })),
          }),
          stderr: '',
        };
      }
      return {
        stdout: JSON.stringify({ streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] }),
        stderr: '',
      };
    }
    const outputPath = args.at(-1)!;
    await writeFile(outputPath, 'simulated encoded output');
    return { stdout: '', stderr: '' };
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('standalone local MP4 splitter', () => {
  it.skipIf(!ffmpegAvailable)('probes, previews, and accurately splits a locally generated 30000/1001 fps MP4', async () => {
    const files = await fixture();
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30000/1001:d=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', files.inputPath,
    ]);
    const originalSource = await readFile(files.inputPath);
    const settings = {
      version: 1, mode: 'fixed_duration',
      sourceDownload: { provider: 'Vids', documentId: 'generated-fixture', downloadAttemptId: 'attempt-fixture', chromeDownloadId: 1, chromeState: 'complete' },
      secondsPerClip: 1.5, expectedClipCount: 3,
      assumption: 'edited_timeline_uses_entered_clip_duration',
    };
    await writeFile(files.manifestPath, JSON.stringify(settings));
    const splitterCli = fileURLToPath(new URL('../../tools/local-mp4-splitter/split-combined-mp4.mjs', import.meta.url));
    const plan = JSON.parse(execFileSync(process.execPath, [splitterCli, '--input', files.inputPath, '--settings', files.manifestPath, '--plan'], { encoding: 'utf8' }));
    expect(plan.timestampDerivedAverageFrameRate).toBeCloseTo(30000 / 1001, 2);
    expect(plan.actualClipCount).toBe(3);
    await writeFile(files.manifestPath, JSON.stringify({
      version: 1, mode: 'fixed_duration', sourceDownload: settings.sourceDownload,
      secondsPerClip: settings.secondsPerClip, expectedClipCount: settings.expectedClipCount,
      actualClipCount: plan.actualClipCount, clips: plan.clips,
    }));
    const report = await splitCombinedMp4({ ...files });
    expect(report.splitMode).toBe('fixed_duration');
    expect(report.fixedDuration).toMatchObject({ secondsPerClip: 1.5, expectedClipCount: 3, actualClipCount: 3, rangeGeneration: 'source_frame_timestamps' });
    expect(report.outputs).toHaveLength(3);
    expect(report.outputs.every((output) => output.audioStreamVerified)).toBe(true);
    expect(report.outputs.every((output) => output.frameCadenceVerified)).toBe(true);
    expect(await readFile(files.inputPath)).toEqual(originalSource);
  }, 120_000);

  it('splits only explicit ordered boundaries and verifies each output separately', async () => {
    const files = await fixture();
    await writeFile(
      files.manifestPath,
      JSON.stringify({
        version: 1,
        sourceDownload: { provider: 'Vids', documentId: 'edited-document', downloadAttemptId: 'attempt-1', chromeDownloadId: 7, chromeState: 'complete' },
        boundaryProvenance: { assertion: 'user_attested', boundarySource: 'source_mp4_frame_timestamps' },
        clips: [
          { name: 'opening', startFrameIndex: 0, endFrameIndexExclusive: 2, startSeconds: 0, endSeconds: 1 },
          { name: 'closing', startFrameIndex: 2, endFrameIndexExclusive: 4, startSeconds: 1, endSeconds: 2 },
        ],
      }),
    );

    const report = await splitCombinedMp4({
      ...files,
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      run: fakeMediaRunner(files.inputPath),
    });

    expect(report.sourceRetained).toBe(true);
    expect(report.outputs.map((output) => output.filename)).toEqual(['opening.mp4', 'closing.mp4']);
    expect(report.outputs.map((output) => output.verifiedDurationSeconds)).toEqual([1, 1]);
    expect(report.outputs.every((output) => output.audioStreamVerified)).toBe(true);
    expect(await readFile(files.inputPath, 'utf8')).toBe('retained combined source');
    expect(report.encodingPolicy).toContain('libx264');
  });

  it('rejects overlapping or out-of-order boundaries before invoking FFmpeg', async () => {
    const files = await fixture();
    await writeFile(
      files.manifestPath,
      JSON.stringify({
        version: 1,
        clips: [
          { name: 'first', startSeconds: 0, endSeconds: 1.25 },
          { name: 'second', startSeconds: 1, endSeconds: 2 },
        ],
      }),
    );
    let ffmpegCalled = false;
    const runner = async (command: string, args: string[]) => {
      if (command === 'ffmpeg') ffmpegCalled = true;
      return fakeMediaRunner(files.inputPath)(command, args);
    };

    await expect(splitCombinedMp4({ ...files, run: runner })).rejects.toThrow(
      'ordered and non-overlapping',
    );
    expect(ffmpegCalled).toBe(false);
  });

  it('rejects boundaries that are not decoded frame timestamps', async () => {
    const files = await fixture();
    await writeFile(
      files.manifestPath,
      JSON.stringify({ version: 1, clips: [{ name: 'cut', startSeconds: 0.1, endSeconds: 1 }] }),
    );

    await expect(
      splitCombinedMp4({ ...files, run: fakeMediaRunner(files.inputPath) }),
    ).rejects.toThrow('decoded video frame boundaries');
  });

  it('refuses any pre-existing output instead of overwriting it', async () => {
    const files = await fixture();
    await writeFile(
      files.manifestPath,
      JSON.stringify({ version: 1, clips: [{ name: 'opening', startSeconds: 0, endSeconds: 1 }] }),
    );
    const outputPath = path.join(files.outputDir, 'opening.mp4');
    await writeFile(outputPath, 'keep me');

    await expect(
      splitCombinedMp4({ ...files, run: fakeMediaRunner(files.inputPath) }),
    ).rejects.toThrow('Refusing to overwrite existing output');
    expect(await readFile(outputPath, 'utf8')).toBe('keep me');
    expect(await readFile(files.inputPath, 'utf8')).toBe('retained combined source');
  });

  it('rejects unsafe output names and boundaries outside the probed media', async () => {
    const files = await fixture();
    await writeFile(
      files.manifestPath,
      JSON.stringify({ version: 1, clips: [{ name: '../opening', startSeconds: 0, endSeconds: 3 }] }),
    );

    await expect(
      splitCombinedMp4({ ...files, run: fakeMediaRunner(files.inputPath) }),
    ).rejects.toThrow('name must use');
  });

  it('requires explicit frame indices to match their measured source timestamps', async () => {
    const files = await fixture();
    await writeFile(files.manifestPath, JSON.stringify({
      version: 1,
      clips: [{ name: 'misaligned', startFrameIndex: 1, endFrameIndexExclusive: 3, startSeconds: 0, endSeconds: 1 }],
    }));
    await expect(splitCombinedMp4({ ...files, run: fakeMediaRunner(files.inputPath) }))
      .rejects.toThrow('frame indices do not match its source frame timestamps');
  });

  it('requires both start and exclusive end frame indices when frame provenance is present', async () => {
    const files = await fixture();
    await writeFile(files.manifestPath, JSON.stringify({
      version: 1,
      clips: [{ name: 'partial', startFrameIndex: 0, startSeconds: 0, endSeconds: 1 }],
    }));
    await expect(splitCombinedMp4({ ...files, run: fakeMediaRunner(files.inputPath) }))
      .rejects.toThrow('must provide both valid source frame indices');
  });
});
