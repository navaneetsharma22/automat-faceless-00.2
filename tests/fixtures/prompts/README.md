# P03.1 Prompt Fixtures

Every entry here is explicitly test-only. None is a user production sample, a provider-supported maximum, or a replacement for a saved draft. P00.2 remains pending because no real image or video JSON body is present in this workspace.

The new size corpus is generated deterministically by `promptFixtures.ts`. `characters` means JavaScript `String.length` (UTF-16 code units); UTF-8 bytes use `TextEncoder`; LF and CRLF count as one physical line break each. The fixtures are valid JSON, each has one prompt body, and each measures exactly at the named target length.

## Size-profile fixtures

| Fixture    | Kind  | JS code units | UTF-8 bytes | Lines | Prompt count | Newlines | Provenance                                         |
| ---------- | ----- | ------------: | ----------: | ----: | -----------: | -------- | -------------------------------------------------- |
| IMAGE_10K  | image |        10,000 |      10,014 |    29 |            1 | LF       | SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE |
| IMAGE_25K  | image |        25,000 |      25,014 |    43 |            1 | CRLF     | SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE |
| IMAGE_50K  | image |        50,000 |      50,014 |    68 |            1 | LF       | SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE |
| IMAGE_100K | image |       100,000 |     100,014 |   118 |            1 | CRLF     | SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE |
| VIDEO_10K  | video |        10,000 |      10,014 |    29 |            1 | CRLF     | SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE |
| VIDEO_25K  | video |        25,000 |      25,014 |    43 |            1 | LF       | SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE |
| VIDEO_50K  | video |        50,000 |      50,014 |    68 |            1 | CRLF     | SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE |
| VIDEO_100K | video |       100,000 |     100,014 |   118 |            1 | LF       | SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE |

These fixtures include nested objects and arrays; multiline decimal coordinates `1.25`, `2.5`, `3.75`; escaped quotes and backslashes; braces inside a string; numbered instructions inside a string; English, Hindi, and emoji. Their padding is inert synthetic ASCII `x` data, split into physical lines of at most 1,000 padding code units to keep fixture line counts realistic.

## Format and negative-case fixtures

Expected P03.2 outcomes below are the importer contract. `tests/unit/importBatch.test.ts` exercises the representative cases for both image and video; prompt counts for rejected fixtures describe candidate complete values and do not mean any item is accepted.

| Fixture                  | JS code units | UTF-8 bytes | Lines | Candidate / expected prompt count  | Expected importer outcome                                                           | Provenance             |
| ------------------------ | ------------: | ----------: | ----: | ---------------------------------- | ----------------------------------------------------------------------------------- | ---------------------- |
| numberedTwoBodies        |           136 |         136 |     8 | 2                                  | Accept two bodies with outer IDs 1 and 2; internal numbered string remains content. | SYNTHETIC_FIXTURE_ONLY |
| topLevelArray            |            62 |          62 |     4 | 1                                  | Accept the top-level array as one prompt.                                           | SYNTHETIC_FIXTURE_ONLY |
| explicitEnvelope         |           125 |         125 |     7 | 1 item                             | Recognize the schemaVersion 1 image envelope and ID 01 → 1.                         | SYNTHETIC_FIXTURE_ONLY |
| arbitraryItemsObject     |            59 |          59 |     1 | 1                                  | Accept one creative object; an `items` array alone is not an envelope.              | SYNTHETIC_FIXTURE_ONLY |
| incompleteJson           |            32 |          32 |     1 | 1 incomplete candidate; 0 accepted | Reject incomplete JSON atomically.                                                  | SYNTHETIC_FIXTURE_ONLY |
| duplicateCanonicalIds    |           137 |         137 |     8 | 2 candidates; 0 accepted           | Reject duplicate IDs after 1 and 01 canonicalize to the same identity.              | SYNTHETIC_FIXTURE_ONLY |
| ambiguousAdjacentObjects |           130 |         130 |     8 | 2 candidates; 0 accepted           | Reject multiple unlabelled top-level values as ambiguous.                           | SYNTHETIC_FIXTURE_ONLY |
| trailingText             |            94 |          94 |     5 | 1 complete candidate; 0 accepted   | Reject unrecognized text after a complete JSON value.                               | SYNTHETIC_FIXTURE_ONLY |

## Earlier P02.2 transport/repository fixtures

These existing synthetic records established one-body preservation through the mocked Chrome JSON-envelope transport, actual message listener/dispatcher, `ExtensionRepositories`, and a map-backed table adapter. They did not exercise a real Chrome runtime, IndexedDB, an aggregate batch, UI editing, clipboard behavior, or a provider editor.

| Fixture                    | JS code units | UTF-8 bytes | Lines | Prompt count | Provenance                           |
| -------------------------- | ------------: | ----------: | ----: | -----------: | ------------------------------------ |
| syntheticPromptBodies.lf   |        15,913 |      20,815 |     6 |            1 | SYNTHETIC_P02_MOCK_TRANSPORT_FIXTURE |
| syntheticPromptBodies.crlf |        15,918 |      20,820 |     6 |            1 | SYNTHETIC_P02_MOCK_TRANSPORT_FIXTURE |
| syntheticPromptBodies.long |     1,260,163 |   1,652,165 |     6 |            1 | SYNTHETIC_P02_MOCK_TRANSPORT_FIXTURE |

The three P02 measurements above are retained historical measurements from P02.2's evidence record. P03.1 tests validate the new corpus's content, length, UTF-8 measurement, line count, and provenance. P03.2 importer tests verify exact source spans and atomic rejection for representative input forms. No tests establish storage of these new fixture bodies, provider limits, or generation behavior.

## P03 browser long-CRLF fixtures

These files are one-prompt synthetic JSON inputs prepared for the remaining manual packaged-dashboard save/reopen/load check. Each is valid UTF-8 without a BOM and contains nested objects, decimal arrays, escaped strings, Hindi, emoji, and a clearly labeled synthetic payload. The files use actual CRLF line endings; the CRLF count includes all line breaks in the file. Measurements and SHA-256 values were calculated from the written bytes after strict UTF-8 decoding and JSON parsing.

| Fixture file                         | Kind  | Expected prompts | JS code units | UTF-8 bytes | CRLF | Bare LF | SHA-256                                                            |
| ------------------------------------ | ----- | ---------------: | ------------: | ----------: | ---: | ------: | ------------------------------------------------------------------ |
| `p03-image-long-crlf.synthetic.json` | image |                1 |        25,000 |      25,062 |   42 |       0 | `618342596a32b30a3e37ac1fc45b1b1b67c103e9f85e691a01065359844fb0f4` |
| `p03-video-long-crlf.synthetic.json` | video |                1 |        25,000 |      25,062 |   42 |       0 | `7d04aee9475c7269a814f422542f026a86583bb720b61be7a8371eea53f2edc0` |

The 62-byte difference between code units and UTF-8 bytes comes from multibyte Hindi and emoji characters. Both files have zero bare CR characters, contain no BOM, and passed strict UTF-8 decoding and `JSON.parse`. These fixture checks are file-integrity evidence only; they are not browser save/readback or preservation evidence.

## P04.1 user-approved intended-use image sample

`p04-image-user-approved-intended-use.json` is an unchanged byte-for-byte copy of the user-selected assistant-generated image prompt supplied for upcoming intended-use generation tests. It is not a historical production sample and is not a reconstructed short fixture. The source file was verified before copying; both source and fixture have the same SHA-256.

| Fixture file                                | Kind  | Expected prompts | JS code units | UTF-8 bytes | Lines / newline profile | SHA-256                                                            |
| ------------------------------------------- | ----- | ---------------: | ------------: | ----------: | ----------------------: | ------------------------------------------------------------------ |
| `p04-image-user-approved-intended-use.json` | image |                1 |        15,889 |      16,013 |      234 lines / 233 LF | `f452ef3df4f0e7281560c52f980378df7f3cbfbc1b461353be1e46294a664a8b` |
