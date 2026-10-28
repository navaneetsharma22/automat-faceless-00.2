# P03.3 Import Preview Evidence

Date: 28 October 2026  
Evidence level: **OFFLINE_VERIFIED** for source integration, state handling, and mocked/render-to-string checks.  
Shared build ID: `automat-faceless-0.1.0-mvru6149`

## Implemented behavior

- Image and video import panels keep independent in-memory source drafts and preview sessions.
- Drafts start empty. Synthetic examples require an explicit action; replacing a nonempty draft requires confirmation.
- Text input is validated only through **Validate & Preview**. Pending feedback is published before the scheduled importer call.
- Success displays count, order, canonical IDs, code-unit/UTF-8 measurements, and a provider-safe preview notice. At most one raw body is rendered expanded at a time.
- Errors remain inline with importer item/location details. A previous successful result remains visible as stale after edits or failed validation. Revision checks reject late scheduled results.
- JSON files are rejected from byte metadata before reading if over the total-input limit. Files use strict UTF-8; exactly one leading UTF-8 BOM is excluded from the source text. No storage, message, or provider action occurs.
- Provider send, pairing execution, generation, and downloads remain unavailable.

## Checks

- Focused importer/preview/editor/workspace regressions: **3 files / 17 tests PASS**.
- Full test suite: **11 files / 100 tests PASS**.
- Typecheck, lint, changed-file Prettier, production build (Vite 8.3.5 / 154 modules), and `git diff --check`: **PASS**.

The existing synthetic fixtures were run through the importer/session and their returned raw bodies matched the original source strings. Five Node test-runner runs per fixture produced these median/maximum timings:

| Kind  | 10k median/max | 25k median/max | 50k median/max | 100k median/max |
| ----- | -------------: | -------------: | -------------: | --------------: |
| Image |   0.6 / 5.0 ms |   0.7 / 1.1 ms |   1.3 / 1.7 ms |    2.3 / 2.7 ms |
| Video |   0.3 / 0.3 ms |   0.7 / 0.8 ms |   1.2 / 6.4 ms |    2.4 / 3.1 ms |

These timings cover importer/session processing under Node; they do not establish browser rendering or editing responsiveness. The computer-use inventory returned no browser surface, so live dashboard inspection of both themes, narrow layouts, keyboard behavior, and long-input rendering is **NOT_RUN**.

P00.2 production samples remain **EVIDENCE_PENDING**. The application limits remain provisional and do not measure Flow/Vids acceptance or model capacity. At this P03.3 evidence boundary P03.4 was **NOT_STARTED**; its later storage/message evidence is recorded in [prompt-preservation.md](prompt-preservation.md). Phase 03 remains **INCOMPLETE**.
