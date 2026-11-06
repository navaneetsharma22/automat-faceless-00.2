# Local combined MP4 splitter proof

This standalone Node CLI takes a **local combined MP4** and an explicit JSON
boundary manifest. It does not inspect Google Vids, detect scenes, infer clip
identity, or communicate with the extension.

## Requirements

- Node.js 20 or newer.
- `ffmpeg` and `ffprobe` available on `PATH` (or use the exported function with
  custom tool paths).
- An existing output directory that does not already contain the output names.

### Windows setup

FFmpeg's [Windows download guidance](https://ffmpeg.org/download.html#build-windows)
links the Gyan builds. Gyan documents this Windows Package Manager install for
the essentials build, which includes both required binaries:

```powershell
winget install "FFmpeg (Essentials Build)"
```

Open a new PowerShell window after installation and verify with
`ffmpeg -version` and `ffprobe -version`.

### Windows launcher

Double-click `Run-Local-Vids-Split.cmd`. The launcher asks you to choose the
existing combined MP4, its explicit JSON boundary manifest, and a parent
folder. It creates a new uniquely named output folder and calls the existing
`split-combined-mp4.mjs` CLI; encoding and verification stay in that CLI. A
console progress indicator remains visible while FFmpeg encodes and ffprobe
checks the results. On success, the launcher shows each output path and writes
the CLI's verification summary plus selected input paths to
`verification-results.json` in the output folder. On failure it displays the
splitter's diagnostic and retains any partial output folder for inspection.
The launcher captures stdout, stderr, and the child process's numeric exit code
separately. It reports success only after a zero exit code, valid output
summary, and a successful JSON write and read-back check.

The process-capture regressions can be run with
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\powershell\Test-LocalSplitterProcess.ps1`.

Requirements are Node.js 20+ and `ffmpeg`/`ffprobe` available on `PATH`. The
launcher does not infer boundaries, select a default source, or communicate
with Vids, Flow, or the extension. It never modifies the combined input. The
CLI refuses existing output files; each launcher run uses a new output folder.

## Boundary manifest

Boundaries are measured from the actual edited Vids timeline and the selected
combined MP4's decoded source-frame timestamps. The exported version-1 manifest
also records the exact Vids document ID, download attempt ID, and Chrome
download ID. Each clip carries zero-based `startFrameIndex` and
`endFrameIndexExclusive` values plus the corresponding `startSeconds` and
`endSeconds`. The start frame is included; the end frame is excluded. Every
timestamp must match the frame index in the source selected by the Windows
companion. Clips are listed in actual edited timeline order and cannot overlap;
gaps are allowed. Duration is always calculated as `endSeconds - startSeconds`.
Scene count and duration are entered from the edited source; neither is
inferred from prompts or a fixed per-scene duration.

```json
{
  "version": 1,
  "sourceDownload": {
    "provider": "Vids",
    "documentId": "the-exact-vids-document-id",
    "downloadAttemptId": "the-extension-attempt-id",
    "chromeDownloadId": 123,
    "chromeState": "complete"
  },
  "boundaryProvenance": {
    "assertion": "user_attested",
    "timelineOrder": "actual_edited_vids_timeline",
    "boundarySource": "source_mp4_frame_timestamps",
    "frameIndexBase": 0,
    "frameRange": "start_inclusive_end_exclusive"
  },
  "clips": [
    { "name": "opening", "startFrameIndex": 0, "endFrameIndexExclusive": 21, "startSeconds": 0, "endSeconds": 0.7 },
    { "name": "later-scene", "startFrameIndex": 24, "endFrameIndexExclusive": 75, "startSeconds": 0.8, "endSeconds": 2.5 }
  ]
}
```

The example values are illustrative only and are not a cut plan. The extension
exports the user's explicit entries for one completed Chrome download record;
the companion independently checks the frame indices and timestamps against
the selected local MP4 before encoding.

Names are restricted to 1–64 ASCII letters, digits, underscores, and hyphens;
each output is `<name>.mp4`. Names must be unique, including case-only
differences.

## Run

```powershell
node tools/local-mp4-splitter/split-combined-mp4.mjs `
  --input "C:\path\to\combined.mp4" `
  --manifest "C:\path\to\boundaries.json" `
  --output-dir "C:\path\to\new-output-folder"
```

The CLI rejects existing output files and uses FFmpeg's no-overwrite mode. When
frame indices are present, they must match the source frame timestamps and the
calculated frame count; the legacy seconds-only manifest format remains
accepted for existing manifests.
It retains the combined source. Each clip is decoded and re-encoded with
`libx264`, CRF 18, `yuv420p`, and AAC at 192 kb/s when the source has audio.
The source's frame timestamps are used to validate the cut boundaries and
expected frame counts. `ffprobe` then verifies each output's video stream,
frame count, duration tolerance, and audio stream when the source has audio.
The JSON summary reports each result separately. A zero exit code means the
local media checks passed; it does not prove that the source was exported from
Vids, that the manifest maps clips to sidebar results, or that Phase 4 is
complete.
