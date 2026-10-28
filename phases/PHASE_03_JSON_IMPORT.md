# P03 — Lossless large JSON import for both stages

Status: **INCOMPLETE** — P03.1 is OFFLINE_VERIFIED for the proposed contract, synthetic fixtures, and provisional policy. Real production sample profiles remain EVIDENCE_PENDING; P03.2–P03.4 are NOT_STARTED.

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

**P00.2 remains EVIDENCE_PENDING:** no real image/video samples or production size profiles were available. The assistant-generated approved image structure is synthetic. P03.1 does not implement source-span scanning, import UI, or persistence for imported prompt items. Sample-dependent acceptance remains pending; P03.2–P03.4 remain NOT_STARTED.

### P03.1 verification record

Checks on 28 October 2026: `npm test -- --reporter=dot` — PASS (9 files, 72 tests); focused `npm test -- tests/unit/inputPolicy.test.ts --reporter=dot` — PASS (1 file, 8 tests); `npm run typecheck` — PASS; `npm run lint` — PASS; Prettier check on changed source, tests, and documentation — PASS; `npm run build` — PASS (Vite 8.3.5, 146 modules); `git diff --check` — PASS. Shared production build ID: `automat-faceless-0.1.0-mvrswqqb`. No Chrome extension load or live provider action was performed; live verification is NOT_RUN. Real sample profiles, clipboard/editor normalization, aggregate batch transport, actual IndexedDB, UI responsiveness, provider capacity, and JSON depth enforcement remain unverified.

### P03.2 — Implement a JSON-aware source-span importer

Evidence mode: **offline**.
Start in these files:

- src/domain/batches/jsonSpanScanner.ts
- src/domain/batches/importBatch.ts
- tests/unit/importBatch.test.ts

Acceptance: One decimal-array JSON remains one; two remain two; raw bodies, nested structures, strings, Unicode and CRLF policy are preserved. Duplicate/ambiguous/incomplete input is rejected clearly.

### P03.3 — Build non-mutating import and preview UI

Evidence mode: **offline**.
Start in these files:

- src/app/features/image-batch/ImportPanel.tsx
- src/app/features/video-batch/ImportPanel.tsx
- src/app/components/JsonEditor.tsx
- tests/integration/importPreview.test.ts

Acceptance: Counts/shot IDs/errors are accurate; preview does not rewrite source; oversized input is rejected before partial acceptance. Editing remains responsive.

### P03.4 — Verify exact data preservation through storage and messages

Evidence mode: **offline**.
Start in these files:

- src/storage/repositories.ts
- src/shared/schemas.ts
- tests/integration/promptPreservation.test.ts

Acceptance: Import -> schema -> repository -> message retains each complete raw body for image and video kinds, including long nested JSON. No twelve-thousand-character assumption is copied.

## Phase gate

P03 is INCOMPLETE. P03.1 provides offline contract/fixture/policy evidence only. AC03–AC06 require later scanner/importer, UI, persistence, and real sample evidence; none is claimed complete here.

## Notes

- Do not split on arbitrary numbered-looking lines.
- A top-level array is a prompt unless an explicit supported batch envelope says otherwise.
- Do not silently JSON.stringify parsed objects for provider submission.

## Deferred next subphase (not started)

P03.2 remains NOT_STARTED. It depends on representative prompt evidence from P00.2; do not begin it until separately requested and its prerequisite evidence is available.

## Completion report

State changed files and resulting behaviour, focused checks with actual output, relevant live/local-media evidence, remaining gaps and the next eligible subphase. Update PROJECT_STATUS.md, then stop. A required live gate remains NOT_RUN if no authorized runtime was available.

## Current task boundary

This card is a future work specification. Its presence does not authorize running live provider actions now. Follow the actual user task's authorization. Start only the requested subphase, not every row in this card.
