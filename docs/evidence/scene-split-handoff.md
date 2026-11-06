# Part 4 — local split handoff evidence

## Implemented boundary

The Vids Downloads panel exposes **Split downloaded video** only for a completed combined-download attempt with its exact Chrome download ID. The handoff shows the document ID, attempt ID, Chrome download ID, and Chrome-reported source path. The extension exports a JSON boundary manifest bound to that record. The manifest stores only the selected source basename, not the local path.

The user must enter every scene name, zero-based start-frame index, exclusive end-frame index, and the corresponding source-frame timestamps. The manifest also records that the entries follow the actual edited Vids timeline and that frame timestamps were read from the source MP4. These are user attestations. There are no default scenes, cuts, scene counts, fixed durations, prompt-derived boundaries, or inferred ordering. The companion checks frame/timestamp alignment against the selected MP4 before encoding.

The existing Windows companion remains user-launched through `Run-Local-Vids-Split.cmd`. The extension does not run FFmpeg, invoke the companion, or communicate with it. The user selects the completed combined MP4, exported manifest, and a parent output folder in the companion; the companion creates a unique `VidsSplit-*` directory. Chrome's configured Downloads location and the user-selected splitter output location are separate. The combined source is retained; existing output files are refused. Per-scene frame count, duration, and audio are verified by the legacy CLI/ffprobe path, and the Windows launcher writes its separate verification summary.

## Offline evidence

- Focused Vitest: **5 files / 22 tests PASS** (`sceneManifest`, legacy CLI behavior, split handoff UI, Vids download integration, Downloads UI).
- PowerShell process capture: **PASS** (valid JSON and stderr are kept separate; exit code 7 is retained on failure).
- Typecheck, ESLint, production/package build, and `git diff --check`: **PASS**.
- Build ID: **`automat-faceless-0.1.0-mw4vrfif`**, four JavaScript bundles. Existing worker bundle-size and connector `inlineDynamicImports` warnings remain.
- Test fixtures are synthetic/mocked. No actual source MP4 or boundary manifest was supplied; local FFmpeg/ffprobe scene verification is **NOT_RUN**.
- No account authorization, provider action, generation, or download was initiated. No Windows split was launched.

## Manual acceptance checklist

1. Open the intended Vids document and confirm the manually prepared timeline and saved state.
2. Download the whole MP4 through the existing Vids flow; confirm the completion state, exact document ID, attempt ID, and Chrome download ID.
3. Play the combined MP4 and inspect its media properties. Chrome completion alone does not verify playback or media properties.
4. From that actual edited timeline and the combined MP4's source-frame timestamps, enter every scene's explicit name, frame range, and matching timestamps; export the manifest attached to the exact completed download record.
5. Launch `Run-Local-Vids-Split.cmd` yourself. Select that combined source and manifest, then choose a separate parent output folder.
6. Inspect `verification-results.json`, each output's frame count, duration and audio, and playback/scene separation. Confirm the combined source remains unchanged and the scene files are correctly separated.
