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

At the P03.3 evidence boundary, representative prompt profiles and P03.4 persistence were still pending. The application limits remain provisional and do not measure Flow/Vids acceptance or model capacity. Later P03.4 offline and browser evidence is recorded in [prompt-preservation.md](prompt-preservation.md); the current P00.2 intended-use sample profiles are in [prompt-sample-profile.md](prompt-sample-profile.md). These later user-approved samples are not historical production samples.

## Later packaged-browser import evidence

**USER_REPORTED_PASS:** The user reports file import → Validate & Preview → save → dashboard reopen → load → export for both prepared long-CRLF fixtures. Separately, direct inspection of the uploaded exports found strict-valid UTF-8, valid JSON with one prompt each, 25,000 JavaScript code units, 25,062 UTF-8 bytes, no BOM, 42 CRLF, and zero bare LF/CR. The image hash `618342596a32b30a3e37ac1fc45b1b1b67c103e9f85e691a01065359844fb0f4` and video hash `7d04aee9475c7269a814f422542f026a86583bb720b61be7a8371eea53f2edc0` exactly matched the respective prepared fixture files. The browser interaction report and downloaded-file byte verification are separate evidence sources; the latter does not independently verify the browser actions. Full measurements are in [prompt-preservation evidence](prompt-preservation.md). Phase 03 is **DONE for its import/preservation scope**; provider acceptance and generation remain unverified.
