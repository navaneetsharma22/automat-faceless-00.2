# P00 — Requirements, legacy evidence and clean workspace

Status: **SETUP_COMPLETE; P00.2 PROFILED for approved intended-use samples.**

**Outcome:** A clean implementation boundary with the current requirements and evidence preserved.

**Prerequisites:** Current documentation baseline.

**Requirements:** R24, R25, C09, C11.

## Required context

- [Agent instructions](../AGENTS.md)
- [Current status](../PROJECT_STATUS.md)
- [PROJECT.md](../PROJECT.md)
- [REQUIREMENTS.md](../REQUIREMENTS.md)
- [LEGACY_REUSE.md](../LEGACY_REUSE.md)
- [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md)

## One-by-one subphases

The file lists below are planned paths in the new project. They are the initial editing scope, not a claim that source already exists. A necessary dependency edit may be added with an explanation; preserve unrelated work.

### P00.1 — Establish fresh workspace and read-only legacy reference

Evidence mode: **offline**.
Start in these files:

- AGENTS.md
- README.md
- PROJECT_STATUS.md
- docs/evidence/legacy-inventory.md

Acceptance: The source archive remains unchanged. The fresh runtime has a deliberate namespace/identity plan. No old pending storage is read, cleared or imported.

### P00.2 — Collect representative JSON and freeze the supported import examples

Evidence mode: **offline**.
Start in these files:

- INPUT_FORMAT.md
- docs/evidence/prompt-sample-profile.md
- tests/fixtures/prompts/README.md

Acceptance: Record redacted sample sizes, line counts, outer labels and nested structures. Actual samples are needed for later live gates; synthetic fixtures are explicitly labelled.

P00.2 evidence update (28 October 2026): **DONE for user-approved intended-use sample profiles.** The user explicitly selected assistant-generated image and video prompts as the intended-use samples for upcoming generation tests. Their redacted profiles, file measurements, outer forms, nested sections, and provenance are recorded in [prompt-sample-profile.md](../docs/evidence/prompt-sample-profile.md). These are not historical production samples; no such production provenance is claimed. Provider prompt-size acceptance and generation remain unknown and must be established in their authorized later gates.

### P00.3 — Confirm task sequencing and unresolved implementation choices

Evidence mode: **offline**.
Start in these files:

- DECISIONS.md
- OPEN_QUESTIONS.md
- PROJECT_STATUS.md

Acceptance: Separate user-confirmed requirements, proposed defaults and real provider unknowns. No unrequested product features are added.

## Technology Installation and Setup

Establish the reusable project toolchain in the existing project root before later compiled UI or application phases. Verify installed Node.js/npm versions and package engine/peer-dependency compatibility before selecting versions. Keep package-lock.json with the package manifest so later setup tasks reuse this installation.

- React + React DOM for the minimal application entry.
- TypeScript with strict mode; Vite + the React plugin for development and production builds.
- CSS Modules + CSS Variables for component styling and shared tokens. Neither requires a separate runtime package.
- Chrome Manifest V3 + Chrome API type declarations for the extension platform.
- IndexedDB through Dexie for future application data; Chrome Storage for preferences. Chrome Storage is provided by the Chrome API and does not require a separate runtime package.
- Zod for runtime validation.
- Vitest for unit-test configuration; Playwright for browser-test tooling.
- ESLint + Prettier for linting and formatting.
- npm for package management, with package-lock.json as the reproducible dependency lock.

Provide `dev`, `typecheck`, `lint`, `format`, `test`, and `build` scripts. Create only the minimal React placeholder needed to verify the toolchain. Do not implement product screens, provider connections, parsing, queues or generation in this setup addition. OAuth/helper integration and FFmpeg companion setup remain in their existing later phases, which reuse this installation.

## Phase gate

Technology setup and available offline checks are complete. P00.2 sample profiling is complete for the user's explicitly approved intended-use samples. Their historical production status is not claimed. Live/provider acceptance evidence is not claimed.

## Notes

- This phase is preparation, not permission to run the legacy app.
- Do not confuse a clean runtime namespace with deleting old data.
- At the earlier sequencing boundary, P01 and P02 could progress while P00.2 representative sample profiles were pending; the current profile disposition is recorded above.

## Ready-to-copy first task

```text
Implement only P00.1 from phases/PHASE_00_BASELINE.md.
Read AGENTS.md and PROJECT_STATUS.md first, then the context named in this card.
Start with this subphase's file list. Preserve unrelated work and legacy data.
Complete its acceptance checks. Live actions are excluded unless the user separately
includes a specific controlled live test in this task.
Do not start the next subphase. Update PROJECT_STATUS.md and report actual evidence.
```

## Completion report

State changed files and resulting behaviour, focused checks with actual output, relevant live/local-media evidence, remaining gaps and the next eligible subphase. Update PROJECT_STATUS.md, then stop. A required live gate remains NOT_RUN if no authorized runtime was available.

## Current task boundary

This card is a future work specification. Its presence does not authorize running live provider actions now. Follow the actual user task's authorization. Start only the requested subphase, not every row in this card.
