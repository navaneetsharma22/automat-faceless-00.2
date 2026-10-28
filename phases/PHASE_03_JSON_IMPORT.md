# P03 — Lossless large JSON import for both stages

Status: **INCOMPLETE — REQUIRED GATES OPEN**. P03.1–P03.4 implementation and offline evidence are complete. Packaged browser save/reopen/load checks have **USER_REPORTED_PASS** for the stated synthetic samples, but other required browser checks and P00.2 production-sample evidence remain pending.

**Outcome:** Large image and video JSON batches become correct, stable, unchanged prompt items.

**Prerequisites:** P00.2, P02.2.

**Requirements:** R05, R06, R12, C01, C02, C03.

## Required context

- [Agent instructions](../AGENTS.md)
- [Current status](../PROJECT_STATUS.md)
- [INPUT_FORMAT.md](../INPUT_FORMAT.md)
- [DATA_MODEL.md](../DATA_MODEL.md)
- [TESTING.md](../TESTING.md)

## One-by-one subphases

The file lists below are planned paths in the new project. They are the initial editing scope, not a claim that source already exists. A necessary dependency edit may be added with an explanation; preserve unrelated work.

### P03.1 — Define fixtures, outer-label grammar and measured budgets

Evidence mode: **offline**.
Start in these files:

- src/domain/batches/types.ts
- src/domain/batches/inputPolicy.ts
- tests/fixtures/prompts/README.md
- INPUT_FORMAT.md

Acceptance: Proposed supported forms, stable identity rules, synthetic fixtures, and provisional app budgets are explicit. P03.1 does not complete real-sample-dependent acceptance while P00.2 samples are absent.

P03.1 implementation evidence (offline): `src/domain/batches/types.ts` and `inputPolicy.ts` define the proposed input and identity types, outer-label prefix grammar, canonical positive-decimal IDs, conflict/duplicate behavior, and a centralized budget assessment. `tests/fixtures/prompts/` contains eight deterministic synthetic JSON bodies at 10k/25k/50k/100k JavaScript code units for image and video, plus format and negative-case fixtures. Exact measurements, provenance, and expected future importer outcomes are recorded in the fixture README.

The provisional application policy is 1,500,000 JS code units and 2,000,000 UTF-8 bytes per prompt; 5,000,000 code units and 10,000,000 bytes per batch; at most 50 prompts; and a proposed depth guard of 128. Policy size/count assessment is implemented and tested; the depth limit is documented but not enforced until a scanner exists. These are application guardrails only, not provider or generation limits. P02.2 transport evidence is a mocked one-body path through the message/repository boundaries and does not prove aggregate batches, actual Chrome/IndexedDB, editor performance, or provider capacity.

**P00.2 remains EVIDENCE_PENDING:** no real image/video samples or production size profiles were available. The assistant-generated approved image structure is synthetic. At the P03.1 boundary, source-span scanning, import UI, and imported-item persistence were not implemented; P03.2–P03.4 were NOT_STARTED then. Sample-dependent acceptance remains pending.

### P03.1 verification record

Checks on 28 October 2026: `npm test -- --reporter=dot` — PASS (9 files, 72 tests); focused `npm test -- tests/unit/inputPolicy.test.ts --reporter=dot` — PASS (1 file, 8 tests); `npm run typecheck` — PASS; `npm run lint` — PASS; Prettier check on changed source, tests, and documentation — PASS; `npm run build` — PASS (Vite 8.3.5, 146 modules); `git diff --check` — PASS. Shared production build ID: `automat-faceless-0.1.0-mvrswqqb`. No Chrome extension load or live provider action was performed; live verification is NOT_RUN. Real sample profiles, clipboard/editor normalization, aggregate batch transport, actual IndexedDB, UI responsiveness, provider capacity, and JSON depth enforcement remain unverified.

### P03.2 — Implement a JSON-aware source-span importer

Evidence mode: **offline**.
Start in these files:

- src/domain/batches/jsonSpanScanner.ts
- src/domain/batches/importBatch.ts
- tests/unit/importBatch.test.ts

Acceptance: One decimal-array JSON remains one; two remain two; raw bodies, nested structures, strings, Unicode and CRLF policy are preserved. Duplicate/ambiguous/incomplete input is rejected clearly.

P03.2 implementation evidence (offline): `jsonSpanScanner.ts` tracks JSON delimiters, strings, escapes, and the shared depth limit using JavaScript offsets. `importBatch.ts` implements single object/array prompts, consistently numbered blocks, and schemaVersion 1 envelopes for both kinds. It validates JSON without replacing source slices, extracts envelope prompt spans, resolves/canonicalizes identities with shared P03.1 policy, rejects duplicates/conflicts and invalid or trailing input atomically, and applies the centralized count/size policy. It has no storage, messaging, UI, or provider side effects.

Checks on 28 October 2026: focused importer suite — PASS (1 file / 22 tests); full suite — PASS (10 files / 94 tests); `npm run typecheck`, `npm run lint`, changed-file Prettier, `npm run build` (Vite 8.3.5 / 146 modules), and `git diff --check` — PASS. Shared build ID: `automat-faceless-0.1.0-mvrthjnc`. Source/live provider verification is NOT_RUN. The fixture README retains exact synthetic size profiles; real production profiles remain pending P00.2.

### P03.3 — Build non-mutating import and preview UI

Evidence mode: **offline**.
Start in these files:

- src/app/features/image-batch/ImportPanel.tsx
- src/app/features/video-batch/ImportPanel.tsx
- src/app/components/JsonEditor.tsx
- tests/integration/importPreview.test.ts

Acceptance: Counts/shot IDs/errors are accurate; preview does not rewrite source; oversized input is rejected before partial acceptance. Editing remains responsive.

P03.3 implementation evidence (offline): Image and video panels use separate in-memory sessions and the P03.2 importer. Drafts start empty; synthetic examples are loaded only through an explicit action, with replacement confirmation when the draft is nonempty. JSON file imports check `File.size` before reading, require strict UTF-8, remove only a leading UTF-8 BOM, and preserve the decoded source text. Validation runs after a pending state is published, not on keystrokes. The current draft's errors are shown inline with item/location details; prior successful results remain in memory and are labeled stale after edits/failure. Results show ordered canonical IDs and code-unit/UTF-8 measurements, with only one raw body expanded at once. All actions remain local; provider send, pairing execution, generation, and downloads remain unavailable.

P03.3 tests cover independent drafts, preview count/IDs/provider-safe status, source preservation, stale previous results, late-result rejection, oversized file rejection before read, UTF-8/BOM handling, and the existing JSON editor controls. Five Node test-runner timings per fixture in the full suite (median/max, ms): IMAGE 10k 0.6/5.0, 25k 0.7/1.1, 50k 1.3/1.7, 100k 2.3/2.7; VIDEO 10k 0.3/0.3, 25k 0.7/0.8, 50k 1.2/6.4, 100k 2.4/3.1. These are importer timings in Node, not browser UI responsiveness evidence. Browser/theme/narrow-layout inspection is NOT_RUN because no browser surface was available. P00.2 production samples remain EVIDENCE_PENDING.

Checks on 28 October 2026: focused UI/importer regressions — PASS (3 files / 17 tests); full suite at that handoff — PASS (11 files / 100 tests); typecheck, lint, changed-file Prettier, production build (Vite 8.3.5 / 154 modules), and `git diff --check` — PASS. Shared build ID: `automat-faceless-0.1.0-mvru6149`. P03.4 was NOT_STARTED at that handoff; its later evidence is recorded below.

### P03.4 — Verify exact data preservation through storage and messages

Evidence mode: **offline**.
Start in these files:

- src/storage/repositories.ts
- src/shared/schemas.ts
- tests/integration/promptPreservation.test.ts

Acceptance: Import -> schema -> repository -> message retains each complete raw body for image and video kinds, including long nested JSON. No twelve-thousand-character assumption is copied.

P03.4 implementation evidence (offline): The import panel exposes explicit **Save validated batch** and **Load saved batch** actions. Saving is enabled only for a successful current revision; edited/stale previews cannot be saved. Loading a batch asks before replacing a nonempty unsaved draft, verifies the request has not become stale while awaiting the worker, restores the original input source, and validates it again. Image/video batches use separate `(workspaceId, kind)` keys; the current dashboard supplies its explicit `default` import workspace.

The dashboard sends only extension-internal `promptBatch.put/get` messages. The worker accepts these only from the exact packaged dashboard URL after request schema, protocol, build, request ID, kind, and workspace checks. The worker re-runs the P03.2 importer. The repository revalidates centralized source/prompt/count/complexity budgets, writes the exact source and ordered item records in one Dexie transaction across `batches` and `promptItems`, and retains JavaScript source offsets, canonical shot identities/order, measurements, and supplemental SHA-256 digests. Replacement failure rolls back both tables. Readback is revalidated at the repository boundary by importing stored source again and comparing every raw body, span, identity, measurement, order, and digest. No prompt body is sent to provider content scripts or logged.

Regression evidence compares exact strings directly. All eight P03.1 fixtures passed through the actual importer, schemas, repository methods, worker handler, JSON-cloned message envelope, and readback: image/video bodies at 10k, 25k, 50k, and 100k JavaScript code units, including LF/CRLF, decimal arrays, nested structures, escaped strings, Hindi, and emoji. The historical 1,260,163-code-unit / 1,652,165-byte fixture also passed for both kinds. Numbered blocks, top-level arrays, and versioned envelopes preserve body order and canonical IDs. Additional tests reject policy overflow, schema-invalid input, corrupted saved data, and failed messages; a partial item write is rolled back while the previous saved batch remains intact.

Evidence limits: the message handler and repository are production source exercised offline, but Chrome runtime serialization is represented by JSON cloning and IndexedDB is represented by a transactional in-memory table adapter with rollback behavior. These mocks do not prove actual Chrome message capacity or browser IndexedDB durability. The browser checks below are user-reported and were not independently observed in this session. No provider prompt field, settings change, refresh, pairing, generation, OAuth, or download occurred.

Full verification on 28 October 2026: focused preservation/UI/repository/message suite **PASS** (4 files / 38 tests); full suite **PASS** (12 files / 119 tests); typecheck, lint, changed-file Prettier, production build (Vite 8.3.5 / 154 modules), source/dist manifest equality, shared build ID consistency, and `git diff --check` **PASS**. Shared build ID: `automat-faceless-0.1.0-mvrutblo`. This records the existing offline checks; no checks were rerun for this documentation update.

### Packaged browser evidence

**USER_REPORTED_PASS:** The user tested synthetic samples in the packaged browser dashboard. Image JSON measured **15,889 JavaScript code units** and video JSON measured **17,935 JavaScript code units**; save, dashboard reopen, and load passed for each. The saved image and video batches remained separate. Loading both batches in the latest check did not disconnect Flow or Vids. These results are user-reported, not independently observed or automated. No byte counts, browser version, or build ID were supplied. No exact character equality is inferred from the screenshot.

**SCREENSHOT_EVIDENCE:** The supplied screenshot shows both providers Connected and the loaded video preview. This observation alone does not prove source equality or worker lifecycle recovery.

Still open: **P00.2 EVIDENCE_PENDING** for representative actual production samples and their profiles; the packaged unsaved-draft replacement check and long-CRLF check were not reported; worker-restart recovery is unverified. The browser results cover the stated synthetic save/reopen/load workflow only.

## Phase gate

P03.1–P03.4 implementation and offline contract, fixture, scanner, importer, UI, schema, repository, and worker-message evidence are complete. The reported packaged save/reopen/load checks passed for the stated synthetic samples. **P03 remains INCOMPLETE while required gates are open:** P00.2 actual production-sample evidence is pending, and the unsaved-draft replacement and long-CRLF packaged checks remain unreported. Worker-restart recovery is unverified and is not inferred from successful batch loading.

## Notes

- Do not split on arbitrary numbered-looking lines.
- A top-level array is a prompt unless an explicit supported batch envelope says otherwise.
- Do not silently JSON.stringify parsed objects for provider submission.

## Phase 04 boundary

P03.4 is complete to its offline evidence boundary. Phase 04 remains NOT_STARTED and was not started in this task.

## Completion report

State changed files and resulting behaviour, focused checks with actual output, relevant live/local-media evidence, remaining gaps and the next eligible subphase. Update PROJECT_STATUS.md, then stop. A required live gate remains NOT_RUN if no authorized runtime was available.

## Current task boundary

This card is a future work specification. Its presence does not authorize running live provider actions now. Follow the actual user task's authorization. Start only the requested subphase, not every row in this card.
