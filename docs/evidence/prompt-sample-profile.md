# P00.2 Prompt Sample Profiles

Date: 28 October 2026

## Status and provenance

**P00.2 DONE for the explicitly user-approved intended-use sample profiles.** The user selected these assistant-generated image and video prompts for upcoming generation tests. They are actual intended-use test samples, not historical production samples. No historical production prompt was supplied or is represented here.

Profiles below were measured from the UTF-8 files in the user's Downloads folder. Files were decoded strictly, parsed as JSON, and hashed over their original bytes. No prompt text is reproduced in this note.

| Kind  | Source file                                            | JS code units | UTF-8 bytes | Lines | Newline profile         | Top-level form / outer label                                                         | SHA-256                                                            |
| ----- | ------------------------------------------------------ | ------------: | ----------: | ----: | ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Image | `automat-faceless-default-image-saved-source (1).json` |        15,889 |      16,013 |   234 | 233 LF; no CRLF, no BOM | One JSON object; no outer label; top-level `shot_id` = `01`, `prompt_type` = `image` | `f452ef3df4f0e7281560c52f980378df7f3cbfbc1b461353be1e46294a664a8b` |
| Video | `automat-faceless-default-video-saved-source.json`     |        17,935 |      18,159 |   276 | 275 LF; no CRLF, no BOM | One JSON object; no outer label; top-level `shot_id` = `01`, `prompt_type` = `video` | `413d2f267f8745267e9e8a9d0e4e333e66e58d9bf6cb3a74cb22b2d4850baf32` |

The user confirmed both original dinosaur batches were restored after the CRLF fixture checks (**USER_REPORTED_PASS**). Supplied screenshots show the expected lengths, saved timestamps, and Flow/Vids Connected (**SCREENSHOT_EVIDENCE**); they do not prove exact source equality. The “Keep current draft” branch remains **NOT_REPORTED**.

The image object contains nested creative direction, subject/anatomy/pose, environment, composition, camera staging, lighting, grading, continuity, quality-control and exclusion sections. The video object contains nested reference-image contract, creative direction, shot structure, subject/camera/environment motion, temporal continuity, audio direction, and negative constraints. Both contain multilingual creative-reference fields. The detailed semantics of those instructions remain prompt content.

## Evidence limits

- These measurements describe the selected intended-use files. They do not establish historical production provenance, successful generation, provider acceptance, or provider prompt-size capacity.
- Browser version and build ID for the user-reported generation-test preparation are unknown.
- Application input budgets remain provisional guardrails. Provider limits and generation outcomes remain unverified.
- P00.2 profiles freeze the accepted intended-use examples for later controlled tests; any claim about past production use remains unsupported.

## P00.2 acceptance reconciliation

The requested redacted size, line-count, outer-form, nested-structure, and provenance profiles are recorded above for both expressly user-approved intended-use samples. This satisfies P00.2 sample-profile acceptance. Their assistant-generated provenance is preserved; they are not historical production samples. Provider prompt-size acceptance and generation remain unknown and belong to later authorized gates. Application limits remain provisional.
