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

Expected scanner/importer outcomes below are **future P03.2 expectations**, not executed scanner tests. Prompt counts for rejected fixtures describe candidate complete values and do not mean any item should be accepted.

| Fixture                  | JS code units | UTF-8 bytes | Lines | Candidate / expected prompt count  | Expected future outcome                                                             | Provenance             |
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

The three P02 measurements above are retained historical measurements from P02.2's evidence record. P03.1's tests validate the new corpus's content, length, UTF-8 measurement, line count, and provenance. They do not test JSON span extraction, outer-label scanning, atomic importer behavior, storage of these new fixture bodies, provider limits, or generation.
