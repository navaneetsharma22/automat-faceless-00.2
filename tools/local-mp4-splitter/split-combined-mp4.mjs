#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const MAX_PROBE_OUTPUT_BYTES = 128 * 1024 * 1024;
const TIMESTAMP_TOLERANCE_SECONDS = 0.000001;
const OUTPUT_DURATION_TOLERANCE_SECONDS = 0.1;

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateManifest(manifest) {
  if (!isObject(manifest) || manifest.version !== 1 || !Array.isArray(manifest.clips)) {
    fail('Manifest must be an object with version 1 and a clips array.');
  }
  if (manifest.clips.length < 1 || manifest.clips.length > 100) {
    fail('Manifest must contain between 1 and 100 clips.');
  }

  const names = new Set();
  let previousEnd = -Infinity;
  return manifest.clips.map((clip, index) => {
    if (!isObject(clip) || typeof clip.name !== 'string') {
      fail(`Clip ${index + 1} must have a name.`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(clip.name)) {
      fail(`Clip ${index + 1} name must use 1–64 letters, digits, underscores, or hyphens.`);
    }
    const normalizedName = clip.name.toLowerCase();
    if (names.has(normalizedName))
      fail('Clip names must be unique, including case-only differences.');
    names.add(normalizedName);
    if (
      typeof clip.startSeconds !== 'number' ||
      !Number.isFinite(clip.startSeconds) ||
      typeof clip.endSeconds !== 'number' ||
      !Number.isFinite(clip.endSeconds)
    ) {
      fail(`Clip ${clip.name} boundaries must be finite seconds values.`);
    }
    const hasFrameIndices = clip.startFrameIndex !== undefined || clip.endFrameIndexExclusive !== undefined;
    if (hasFrameIndices && (
      !Number.isInteger(clip.startFrameIndex) || clip.startFrameIndex < 0 ||
      !Number.isInteger(clip.endFrameIndexExclusive) || clip.endFrameIndexExclusive < 1
    )) {
      fail(`Clip ${clip.name} must provide both valid source frame indices.`);
    }
    if (clip.startSeconds < 0 || clip.endSeconds <= clip.startSeconds) {
      fail(`Clip ${clip.name} must have a non-negative start before its end.`);
    }
    if (clip.startSeconds < previousEnd - TIMESTAMP_TOLERANCE_SECONDS) {
      fail('Clip boundaries must be ordered and non-overlapping.');
    }
    previousEnd = clip.endSeconds;
    return {
      name: clip.name,
      startSeconds: clip.startSeconds,
      endSeconds: clip.endSeconds,
      ...(hasFrameIndices ? {
        startFrameIndex: clip.startFrameIndex,
        endFrameIndexExclusive: clip.endFrameIndexExclusive,
      } : {}),
      durationSeconds: clip.endSeconds - clip.startSeconds,
      filename: `${clip.name}.mp4`,
    };
  });
}

function parseProbe(stdout, label) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    fail(`ffprobe returned invalid ${label} metadata.`);
  }
  if (!isObject(data) || !Array.isArray(data.streams)) {
    fail(`ffprobe returned incomplete ${label} metadata.`);
  }
  const video = data.streams.find((stream) => stream?.codec_type === 'video');
  if (!video) fail(`${label} has no video stream.`);
  const duration = Number(data.format?.duration ?? video.duration);
  if (!Number.isFinite(duration) || duration <= 0) fail(`${label} has no valid media duration.`);
  const frames = Array.isArray(data.frames)
    ? data.frames
        .map((frame) => ({
          timestamp: Number(frame?.best_effort_timestamp_time),
          duration: Number(frame?.pkt_duration_time),
        }))
        .filter((frame) => Number.isFinite(frame.timestamp))
    : [];
  if (frames.length === 0) fail(`ffprobe returned no video frame timestamps for ${label}.`);
  return {
    durationSeconds: duration,
    video,
    hasAudio: data.streams.some((stream) => stream?.codec_type === 'audio'),
    frames,
  };
}

function validateAgainstMedia(clips, probe) {
  const timestamps = probe.frames.map((frame) => frame.timestamp);
  const frameDeltas = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const delta = timestamps[index] - timestamps[index - 1];
    if (delta <= 0) fail('Decoded video frame timestamps are not strictly ordered.');
    frameDeltas.push(delta);
  }
  if (frameDeltas.length === 0) fail('Video frame timing could not be established.');
  const typicalFrameDurationSeconds = frameDeltas.reduce(
    (smallest, delta) => Math.min(smallest, delta),
    Infinity,
  );
  const lastFrame = probe.frames.at(-1);
  const lastFrameDuration =
    Number.isFinite(lastFrame?.duration) && lastFrame.duration > 0
      ? lastFrame.duration
      : typicalFrameDurationSeconds;
  const frameBoundaryKeys = new Set(
    timestamps.map((timestamp) => Math.round(timestamp * 1_000_000)),
  );
  const isFrameBoundary = (time) =>
    frameBoundaryKeys.has(Math.round(time * 1_000_000)) ||
    Math.abs(timestamps.at(-1) + lastFrameDuration - time) <= TIMESTAMP_TOLERANCE_SECONDS;
  const lowerBound = (time) => {
    let low = 0;
    let high = timestamps.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (timestamps[middle] < time - TIMESTAMP_TOLERANCE_SECONDS) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  return clips.map((clip) => {
    if (clip.endSeconds > probe.durationSeconds + TIMESTAMP_TOLERANCE_SECONDS) {
      fail(`Clip ${clip.name} ends beyond the source media duration.`);
    }
    if (!isFrameBoundary(clip.startSeconds) || !isFrameBoundary(clip.endSeconds)) {
      fail(`Clip ${clip.name} boundaries must match decoded video frame boundaries.`);
    }
    if (clip.startFrameIndex !== undefined) {
      const startTimestamp = timestamps[clip.startFrameIndex];
      const endTimestamp = clip.endFrameIndexExclusive === timestamps.length
        ? timestamps.at(-1) + lastFrameDuration
        : timestamps[clip.endFrameIndexExclusive];
      if (
        clip.endFrameIndexExclusive <= clip.startFrameIndex ||
        startTimestamp === undefined ||
        endTimestamp === undefined ||
        Math.abs(startTimestamp - clip.startSeconds) > TIMESTAMP_TOLERANCE_SECONDS ||
        Math.abs(endTimestamp - clip.endSeconds) > TIMESTAMP_TOLERANCE_SECONDS
      ) {
        fail(`Clip ${clip.name} frame indices do not match its source frame timestamps.`);
      }
    }
    const expectedFrameCount = Math.max(
      0,
      lowerBound(clip.endSeconds) - lowerBound(clip.startSeconds),
    );
    if (expectedFrameCount < 1) fail(`Clip ${clip.name} contains no complete video frames.`);
    if (clip.startFrameIndex !== undefined && expectedFrameCount !== clip.endFrameIndexExclusive - clip.startFrameIndex) {
      fail(`Clip ${clip.name} frame indices do not match its source frame count.`);
    }
    return { ...clip, expectedFrameCount, typicalFrameDurationSeconds };
  });
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_PROBE_OUTPUT_BYTES) {
        child.kill();
        reject(new Error('Media probe output exceeded the bounded limit.'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', () => reject(new Error(`Unable to start required tool: ${command}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${path.basename(command)} exited with code ${code}.`));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

async function probeMedia(inputPath, ffprobePath, run) {
  const metadata = await run(ffprobePath, [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-select_streams',
    'v:0',
    '-show_frames',
    '-show_entries',
    'stream=codec_type,codec_name,width,height,duration:format=duration:frame=best_effort_timestamp_time,pkt_duration_time',
    '-of',
    'json',
    inputPath,
  ]);
  // Probe audio streams separately because -select_streams v:0 filters stream metadata.
  const streams = await run(ffprobePath, [
    '-v',
    'error',
    '-show_streams',
    '-show_entries',
    'stream=codec_type',
    '-of',
    'json',
    inputPath,
  ]);
  const parsed = parseProbe(metadata.stdout, inputPath);
  const allStreams = JSON.parse(streams.stdout);
  parsed.hasAudio =
    Array.isArray(allStreams.streams) &&
    allStreams.streams.some((stream) => stream.codec_type === 'audio');
  return parsed;
}

async function ensureRegularFile(filePath, label) {
  const stat = await lstat(filePath).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink()) fail(`${label} must be an existing regular file.`);
  return realpath(filePath);
}

async function ensureOutputAbsent(outputPath) {
  const existing = await lstat(outputPath).catch(() => undefined);
  if (existing) fail(`Refusing to overwrite existing output: ${path.basename(outputPath)}.`);
}

export async function splitCombinedMp4({
  inputPath,
  manifestPath,
  outputDir,
  ffmpegPath = 'ffmpeg',
  ffprobePath = 'ffprobe',
  run = runProcess,
}) {
  if (!inputPath || !manifestPath || !outputDir)
    fail('Input MP4, manifest, and output directory are required.');
  const sourcePath = await ensureRegularFile(path.resolve(inputPath), 'Input media');
  if (path.extname(sourcePath).toLowerCase() !== '.mp4') fail('Input must be an MP4 file.');
  const manifestRealPath = await ensureRegularFile(path.resolve(manifestPath), 'Manifest');
  const destinationDir = await realpath(path.resolve(outputDir)).catch(() => undefined);
  if (!destinationDir) fail('Output directory must already exist.');
  const sourceStat = await lstat(sourcePath);
  if (sourceStat.size === 0) fail('Input media is empty.');

  let manifest;
  try {
    manifest = JSON.parse(
      await (await import('node:fs/promises')).readFile(manifestRealPath, 'utf8'),
    );
  } catch {
    fail('Manifest file is not readable JSON.');
  }
  const clips = validateManifest(manifest);
  const sourceProbe = await probeMedia(sourcePath, ffprobePath, run);
  const planned = validateAgainstMedia(clips, sourceProbe);
  const outputs = planned.map((clip) => ({
    ...clip,
    path: path.join(destinationDir, clip.filename),
  }));
  const normalizedSource = process.platform === 'win32' ? sourcePath.toLowerCase() : sourcePath;
  for (const output of outputs) {
    const normalizedOutput = process.platform === 'win32' ? output.path.toLowerCase() : output.path;
    if (normalizedOutput === normalizedSource)
      fail('Output path cannot replace the combined source.');
    await ensureOutputAbsent(output.path);
  }

  const completed = [];
  for (const clip of outputs) {
    await run(ffmpegPath, [
      '-hide_banner',
      '-nostdin',
      '-n',
      '-i',
      sourcePath,
      '-ss',
      clip.startSeconds.toFixed(6),
      '-t',
      clip.durationSeconds.toFixed(6),
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-sn',
      '-dn',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-fps_mode',
      'passthrough',
      ...(sourceProbe.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      '-movflags',
      '+faststart',
      clip.path,
    ]);
    const outputProbe = await probeMedia(clip.path, ffprobePath, run);
    const expectedDuration = clip.durationSeconds;
    const durationTolerance = Math.max(
      OUTPUT_DURATION_TOLERANCE_SECONDS,
      sourceProbe.frames
        .slice(1)
        .reduce(
          (largest, frame, index) =>
            Math.max(largest, frame.timestamp - sourceProbe.frames[index].timestamp),
          0,
        ),
    );
    if (Math.abs(outputProbe.durationSeconds - expectedDuration) > durationTolerance) {
      fail(`Output ${clip.filename} duration did not verify against its manifest boundary.`);
    }
    if (sourceProbe.hasAudio && !outputProbe.hasAudio) {
      fail(`Output ${clip.filename} is missing the source audio stream.`);
    }
    if (outputProbe.frames.length !== clip.expectedFrameCount) {
      fail(`Output ${clip.filename} frame count did not verify against its manifest boundaries.`);
    }
    const outputStat = await lstat(clip.path);
    if (!outputStat.isFile() || outputStat.size === 0)
      fail(`Output ${clip.filename} is empty or invalid.`);
    completed.push({
      filename: clip.filename,
      path: clip.path,
      startSeconds: clip.startSeconds,
      endSeconds: clip.endSeconds,
      expectedDurationSeconds: expectedDuration,
      verifiedDurationSeconds: outputProbe.durationSeconds,
      expectedVideoFrameCount: clip.expectedFrameCount,
      audioStreamVerified: !sourceProbe.hasAudio || outputProbe.hasAudio,
      bytes: outputStat.size,
    });
  }
  return {
    sourceRetained: true,
    source: path.basename(sourcePath),
    encodingPolicy:
      'H.264 libx264 CRF 18, yuv420p, AAC 192 kb/s when source audio exists; decoded and re-encoded at explicit frame timestamps.',
    outputs: completed,
  };
}

function usage() {
  return 'Usage: node tools/local-mp4-splitter/split-combined-mp4.mjs --input <combined.mp4> --manifest <boundaries.json> --output-dir <existing-directory>';
}

export async function main(args = process.argv.slice(2)) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (
      !['--input', '--manifest', '--output-dir'].includes(key) ||
      !args[index + 1] ||
      args[index + 1].startsWith('--')
    ) {
      fail(usage());
    }
    if (options.has(key)) fail(`Duplicate option: ${key}`);
    options.set(key, args[++index]);
  }
  const report = await splitCombinedMp4({
    inputPath: options.get('--input'),
    manifestPath: options.get('--manifest'),
    outputDir: options.get('--output-dir'),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Splitter failed.'}\n`);
    process.exitCode = 1;
  });
}
