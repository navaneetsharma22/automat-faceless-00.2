# Lossless Image and Video JSON Input Contract

Status: **P03.1 contract and provisional policy defined; scanner/importer not implemented.** The formats below are documented proposals for P03.2. They are not claims that the current application already parses or imports them.

## Evidence and provenance

No representative production image or video JSON sample has been supplied in this workspace. `docs/evidence/prompt-sample-profile.md` and the real sample profiles remain absent. P00.2 remains evidence-pending. The approved image example was assistant-generated and is **synthetic**; it confirms an intended structure containing subject, environment, composition, camera, lighting, grading, constraints, arrays, decimal values, and a `shot_id` field. It does not establish production prompt sizes, labels, nesting, line endings, or provider capacity.

The existing `tests/fixtures/syntheticPromptBodies.ts` and new P03.1 corpus are test fixtures only. None replaces the user's drafts or counts as production evidence.

## Proposed version-one input forms

The future importer will accept one of these modes per import request. It will not guess or mix modes.

### A. One JSON prompt

One complete top-level JSON object or array is exactly one prompt. A top-level array is data, not a batch separator. An unlabelled single prompt is valid and has no `shotId` unless an explicit supported identity is supplied. Its application-owned `itemId` will be assigned separately by a later importer; an absent `shotId` cannot pair it to another workflow stage.

### B. Numbered complete JSON blocks

Labels are recognized only between complete top-level JSON values, outside their source spans. The exact proposed prefix grammar is:

```text
HWS           := zero or more ASCII spaces or tabs
BARE_LABEL    := DECIMAL (":" | "." | ")")
PROMPT_LABEL  := "Prompt" one-or-more ASCII spaces-or-tabs DECIMAL ":"
DECIMAL       := one or more ASCII digits [0-9]
LABEL_PREFIX  := HWS (BARE_LABEL | PROMPT_LABEL) HWS JSON_OPEN
JSON_OPEN     := "{" | "["
```

`Prompt` is case-sensitive. The opening `{` or `[` must follow on the same physical line as the label. For example, `1: {`, `01. [`, `2) {`, and `Prompt 3: {` match. `Prompt 3.` and a label with the JSON delimiter on the next line do not match. Zero is not a valid shot identity even though `0:` matches the lexical decimal-token shape.

Labels are candidates only after the preceding JSON value is complete. A number-like line within a string, array, object, or nested value is prompt content and never a boundary. Outer separators may contain spaces, tabs, LF, or CRLF. Bare CR does not form an outer label line boundary. Leading/trailing separator whitespace and labels are outside the prompt body; they are not copied into it. Unrecognized non-whitespace text between/after values is an error. Two adjacent unlabelled top-level values are ambiguous and must be rejected.

Labels `1:`, `1.`, `1)`, and `Prompt 1:` are **proposed formats**. They have not been observed in a real production sample.

### C. Explicit versioned envelope

The proposed envelope signature is a top-level object with the reserved keys `schemaVersion`, `kind`, and `items`. `schemaVersion` must be `1`; `kind` must be `image` or `video`; `items` must be a non-empty array. An item must have `shotId` and `prompt`; `shotId` is a positive decimal string and `prompt` is a JSON object or array. A recognized signature with an unsupported version or malformed items is an envelope error, not a fallback creative prompt.

An `items` array by itself does **not** identify an envelope. An arbitrary object containing an `items` array but not the complete reserved signature is one prompt. Because the signature keys are reserved, an object with all three signature keys and an image/video `kind` is treated as an envelope candidate.

Example (synthetic only):

```json
{
  "schemaVersion": 1,
  "kind": "video",
  "items": [
    {
      "shotId": "01",
      "prompt": {
        "scene": "SYNTHETIC only",
        "camera": { "move": "lateral" },
        "effects": ["text reveal"],
        "duration": 8
      }
    }
  ]
}
```

The envelope parser must retain each `prompt` value's exact source span. Parsed objects are validation aids only and may never replace the source text.

## Shot identity contract

- A `shotId` is scoped to its `workspaceId`. The same ID can be used in another workspace without collision.
- Canonical IDs are positive decimal strings. Strip leading zeroes (`"1"` and `"01"` both become `"1"`); reject zero, signs, whitespace inside the ID, decimals, exponents, and non-digits.
- Keep IDs as strings. Never convert them through JavaScript `Number`; very large decimal IDs must remain exact.
- Preserve nonconsecutive IDs. Do not renumber gaps.
- Identity may come from a recognized outer label, envelope `shotId`, or the exact top-level creative-body field `shot_id` when that field is a decimal string. The body field is optional. A nested `shot_id` or arbitrary number is ordinary content.
- If more than one recognized identity source is present, canonical values must agree. A disagreement or invalid explicit value rejects that prompt. An arbitrary body number never overrides an outer/envelope identity.
- Duplicate canonical IDs within a workspace batch reject the whole batch, including collisions such as `1` and `01`.
- An unlabelled single JSON prompt may remain without a `shotId`; a multi-prompt import without explicit identities is ambiguous and rejects. App-owned `itemId` is separate from shot identity.

## Lossless source preservation

Preservation is relative to the exact string received at the future import boundary:

- The raw body starts at its opening object/array delimiter and ends just after its matching closing delimiter.
- Keep every body code unit unchanged: whitespace, key order, escaping, Unicode, and LF/CRLF line endings. Outer labels and inter-item separators are excluded.
- JSON parsing may validate syntax but cannot supply the persisted or submitted body. No trimming, summarizing, auto-repair, parse/stringify rewrite, or silent truncation is allowed.
- A schema or identity error must not silently accept only some items. Reject the complete import atomically before persistence.
- No fixed creative schema is imposed. Camera/effects/duration fields remain prompt content and never become application commands.

The contract begins at the received source string. Browser clipboard, textarea, and platform paste behavior that may normalize newlines before this boundary is **unverified**. P03.1 fixtures test that the source string retains both LF and CRLF; they do not establish clipboard/editor behavior.

## Centralized preliminary application budget

`src/domain/batches/inputPolicy.ts` defines the current P03.1 policy values:

| Guard                               |    Provisional value | Evidence and status                                                                                                                           |
| ----------------------------------- | -------------------: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| One prompt JavaScript string length | 1,500,000 code units | Above the largest P02.2 mock body (1,260,163 code units); importer/UI cost remains unmeasured.                                                |
| One prompt UTF-8 size               |      2,000,000 bytes | Above the largest P02.2 mock body (1,652,165 bytes); provider support is unknown.                                                             |
| Whole batch string length           | 5,000,000 code units | Aggregate multi-prompt transport/UI cost was not measured; provisional.                                                                       |
| Whole batch UTF-8 size              |     10,000,000 bytes | Aggregate multi-prompt transport/UI cost was not measured; provisional.                                                                       |
| Prompt count                        |                   50 | A new conservative application guardrail, not the legacy 100-item limit and not a product maximum; provisional pending queue/UI measurements. |
| JSON nesting depth                  |                  128 | Provisional future scanner guard against extreme nesting; P03.1 does not parse or enforce depth.                                              |

All size/count guards reject the whole batch; no partial acceptance is permitted. The policy assessment in P03.1 measures raw body sizes and count only. P03.2 must apply the syntax/depth and atomic import rules. These provisional application budgets do not assert Flow/Vids editor limits, model context limits, Chrome transport limits, or generation support.

### Existing transport evidence and its limits

P02.2 synthetic offline tests passed a **1,260,163-code-unit / 1,652,165-byte** body through a mocked Chrome JSON-envelope message transport, the actual extension message listener/dispatcher, `ExtensionRepositories`, and a map-backed table adapter. This establishes preservation at those mocked boundaries for that one test fixture. It does not establish browser Chrome message capacity, real IndexedDB execution, aggregate multi-item batch handling, dashboard editor responsiveness, clipboard behavior, provider editor limits, or provider generation acceptance.

## P03.1 synthetic fixture corpus

`tests/fixtures/prompts/promptFixtures.ts` contains deterministic IMAGE and VIDEO bodies at 10k, 25k, 50k, and 100k JavaScript code units, plus representative input-form and negative-case examples. The bodies cover nested structures, decimals, escaped quotes/backslashes, braces inside strings, English/Hindi/emoji, numbered instructions in a string, and both LF/CRLF. Expected negative importer outcomes are recorded as fixture metadata; P03.1 does not implement or test a scanner/importer.

Actual measurements and each fixture's prompt count/provenance are in [tests/fixtures/prompts/README.md](tests/fixtures/prompts/README.md). These are synthetic structural fixtures, not observed production samples or product limits.

## Historical reproduced defect

The legacy `parseFlowPromptList` function in `src/domain/flowPromptBatch.ts` splits by numbered-looking lines without JSON state. A read-only offline review of the supplied ZIP reproduced one valid nested JSON with three decimal coordinate lines becoming four prompts; two became eight. The original body was not preserved. This source defect does not establish the cause of any historical live Generate failure.
