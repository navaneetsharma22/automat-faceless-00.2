# P04 — One long image JSON: entry and one Generate

Status: **INCOMPLETE — P04.1/P04.2 and P04.3 compatibility are offline/local-fixture verified; P04.4 failure attribution is OFFLINE_VERIFIED. Live fill/readback, Generate label, progress, completed dinosaur image, and dashboard `dispatched` state are USER_REPORTED screenshot evidence, including one activation-pair attempt. Attempt `54589885-74c8-4088-beeb-e41f7fda9341` is screenshot evidence only; runtime/storage evidence was not independently inspected. Automatic result attribution remains unverified.** The user reports Flow/Vids connection success after the route fix. Provider acceptance and automatic result attribution are not independently verified. No live Generate was performed by the agent.

**Latest P04 evidence (29 October 2026):** the user-provided screenshots for the second live test report exact immediate/settled readback of 3,321 code units, source SHA-256 `bfed2a90b794a8b5de8e644a203d7a09ea73b999dc509808a7c9fbd6ee4301cb`, and attempt `5344f4f1-7277-452b-9e1e-d863b70d7a12` as `dispatched` / `activation_pair_sent`, with one activation-pair attempt and provider outcome `unverified`. They show manually selected `x2` and two completed Flow images. Press/release evidence remains uncertain as displayed. These screenshots do not independently verify runtime/storage, link the images to the attempt, or establish automatic terminal attribution. Preserve both attempts; P04 remains **INCOMPLETE** and P05 **NOT_STARTED**.

**Outcome:** The extension can enter one actual long JSON in the correct Flow composer and activate Generate once.

**Prerequisites:** P01, P02, P03.

**Requirements:** R06, R08, R09, C01, C04, C07, C13.

## Required context

- [Agent instructions](../AGENTS.md)
- [Current status](../PROJECT_STATUS.md)
- [INPUT_FORMAT.md](../INPUT_FORMAT.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [DESIGN.md](../DESIGN.md)
- [LEGACY_REUSE.md](../LEGACY_REUSE.md)

## One-by-one subphases

The file lists below are planned paths in the new project. They are the initial editing scope, not a claim that source already exists. A necessary dependency edit may be added with an explanation; preserve unrelated work.

### P04.1 — Resolve the real composer and preserve settled text

Evidence mode: **offline + local-browser-fixtures**. Real provider access is excluded.
Start in these files:

- src/platforms/flow/composer.ts
- src/platforms/flow/connection.ts
- src/background/handlers/flow.ts
- tests/unit/flowComposer.test.ts
- tests/browser/flowPromptEntry.spec.ts

Acceptance: Read-only discovery is distinguished from readiness. Long JSON fill/readback uses a demonstrated editor path; no Generate is performed during fill-only tests.

P04.1 implementation summary: The shared canonical Flow parser now accepts the account-prefixed `/u/{number}/project/{projectId}` route and preserves it in canonical identity; the original tab URL is retained unchanged. `composer.ts` excludes search controls, requires one visible/enabled editor, and distinguishes missing/ambiguous/unsupported discovery from method compatibility. P04.3 extends fill-only support to the exact evidenced `flow-base-prompt-box` > `flow-rich-text-editor` > `div[contenteditable=true][role=textbox]` structure; arbitrary contenteditables remain unsupported, and `create` alone is not enough outside that host pair. The approved 15,889-code-unit sample and multiline/Unicode cases passed local Chromium insertion and exact readback. Flow's live DOM/editor behavior remains pending user retest.

The image import panel now offers **Inspect and fill Flow prompt (no Generate)** only for one successful current image JSON validation and the user's manual Flow settings confirmation. The worker validates the dashboard message/build/protocol, selected Flow record, live tab route, and top-frame document loader, then attaches CDP to that selected tab. It rechecks selection and document binding before input and after asynchronous work. Existing exact text is stable-read without insertion; different text conflicts without mutation; verified empty textarea input uses one `Input.insertText` command. A timeout or uncertain input is not retried, and the panel blocks subsequent automatic attempts for that mounted session. Generate/submit commands do not exist in this handler.

P04.1 permission decision: Chrome `debugger` is declared in required `permissions` because it cannot be requested as an optional permission. It is not included in `optional_permissions`. The permission only backs the explicit P04.1 fill action. No provider page, settings, refresh, navigation, or account state was touched during this task. The extension's generation capability remains unavailable.

### P04.1 offline and local-browser evidence

Focused Vitest: `tests/unit/flowComposer.test.ts`, `tests/unit/flowPromptEntry.test.ts`, and `tests/unit/connections.test.ts` — **3 files / 38 tests PASS**. Full Vitest regression suite: **15 files / 137 tests PASS**. These mocks cover route/account identity, missing permission, changed target, missing/ambiguous composer, conflicting content, existing exact text, single insertion, mismatch diagnostics, cleanup, and no submit/key activation. The source check does not establish live Chrome debugger behavior.

Local Playwright Chromium fixtures: **8 tests PASS** using local DOM fixtures only. Tests distinguish search from a uniquely labelled composer; reject missing, hidden, disabled, ambiguous, placeholder-only and unsupported contenteditable candidates; cover empty/matching/conflicting editor content; preserve the approved image sample exactly in a textarea; record an explicit CRLF-to-LF representation mismatch in a textarea; and verify exact text after a local textarea node replacement. These are simple local DOM fixtures, not a Flow page or a framework-managed editor. No Generate/submit was activated.

Approved sample identity: the file [`tests/fixtures/prompts/p04-image-user-approved-intended-use.json`](../tests/fixtures/prompts/p04-image-user-approved-intended-use.json) was copied byte-for-byte from the user-provided selected image source after verifying **15,889 JavaScript code units / 16,013 UTF-8 bytes / SHA-256 `f452ef3df4f0e7281560c52f980378df7f3cbfbc1b461353be1e46294a664a8b`**. It retains assistant-generated, user-approved intended-use provenance and is not a historical production sample.

Local browser results: the approved image source read back exactly after `page.keyboard.insertText` into a local textarea (Playwright's Chromium text-input path; 654 ms test duration). A separate 25,000-code-unit / 25,062-byte CRLF fixture entered into a local textarea read back as **24,958 code units / 25,020 UTF-8 bytes**, with all 42 CRLF pairs represented as LF. The test asserts the first mismatch is at the first CRLF pair (`CR` in source versus `LF` in textarea readback), and asserts exact inequality; no normalization is applied. The suite completed in 9.0 seconds. Results are local-fixture evidence only, not proof of Flow editor behavior or provider acceptance.

Final offline checks: `npm run typecheck`, `npm run lint`, changed-file Prettier check, `npm run build` (Vite 8.3.5, 159 modules), and `git diff --check` passed. Shared packaged build ID: **`automat-faceless-0.1.0-mvs202rv`**. The built manifest matches the public manifest, and the dashboard, background worker, and connection probe share the build ID. This verifies packaged output offline; it is not a live loaded-extension/build claim.

### Read-only Flow DOM inspection handoff

No actual Flow DOM was inspected in this task. The current handoff uses the bounded, masked [`flow-composer-readonly.js`](../tools/diagnostics/flow-composer-readonly.js) diagnostic and [its instructions](../docs/evidence/flow-one-image.md#minimal-read-only-diagnostic-for-the-users-existing-session). It reports structure and fixed rejection/signal codes without editor values, raw labels, account data, or URLs. This supersedes the older raw-attribute snippet. Diagnostic output is **NOT_COLLECTED**; do not implement a DOM-specific fix or repeat fill until the report is available.

At this P04.1 handoff, live Flow composer discovery/fill and actual editor framework readback are **NOT_RUN**. No browser version or live build/project evidence is claimed. Provider prompt-size acceptance and generation remain unverified. P04.2, P04.3, and P04.4 remain **NOT_STARTED**; Phase 04 remains **INCOMPLETE**.

### P04.2 — Add a single durable Generate attempt and phase evidence

Evidence mode: **offline**.
Start in these files:

- src/domain/jobs/attempt.ts
- src/platforms/flow/images.ts
- src/background/handlers/flow.ts
- src/storage/repositories.ts
- tests/integration/flowGenerateOnce.test.ts

Acceptance: Intent is durable before input; zero input occurs on failed preflight; normal success produces one activation (one press/release pair if CDP is used). Preserve uncertain delivery unchanged.

Implementation: The image workspace exposes **Generate once in Flow** only for one currently validated prompt whose source exactly matches its saved image batch, after a manual settings confirmation bound to the currently selected Flow tab/project. The worker reloads that saved batch through the validated repository, checks the item hash and measurements, validates the stored selected target against the current Flow route, and binds the attempt to the current top-frame ID/loader. Before creating the attempt, it writes the exact prompt body once to a write-once, content-addressed `flowImagePromptSnapshots` record keyed by item ID and prompt hash. The attempt stores the snapshot ID, workspace/batch/item/shot identity, prompt hash/measurements, target/frame/build/protocol identity, user attestation, pre-dispatch result-region baseline, fixed event codes, and state; the attempt record does not duplicate the prompt body. Later saved-batch replacement cannot change this snapshot. Snapshot retrieval rechecks schema, measurements and SHA-256; unavailable or mismatched source blocks dispatch.

The worker persists `preparing` before exact saved-source fill/readback, then `verified`, inspects one semantic image composer, one exact enabled Generate control and one labelled results region, and rechecks the target/frame, prompt, control and baseline before persisting `dispatch-intent`. Only then does it issue one CDP `mousePressed`/`mouseReleased` pair. Dispatched means the pair was sent; it does not mean Flow accepted the request or produced an image. Partial/unknown activation is retained as `uncertain` and cannot be replayed. Active item and confirmation keys prevent concurrent and repeated clicks. Worker-start reconciliation turns `preparing`/`verified` into `failed-before-dispatch` and `dispatch-intent` into `uncertain`; it never replays Generate.

Evidence boundary: offline handler/repository tests exercise state and failure decisions, including a later-save immutability regression and restart-state reconciliation. The focused local Playwright suite passed 12 tests total, including four P04.2 synthetic-DOM/in-memory repository cases for valid activation, failed preflight, repeated request protection, and partial dispatch without replay. The sandboxed runner first failed because Playwright's `WorkerHost.startRunner` called `child_process.fork` and Windows returned `spawn EPERM`; the project's permitted process-spawn execution method resolved it. The local fixture does not use a Flow tab or prove extension debugger behavior. No real Flow page, provider settings, or Generate control was accessed. The semantic selectors remain candidates, and the provider result observer is only a labelled-region baseline, not terminal attribution.

P04.2 implementation is **OFFLINE_VERIFIED / LOCAL_BROWSER_FIXTURES_VERIFIED**. P04.3 was attempted only to establish runtime access, then stopped before target readiness: the available browser surface had no apps or browsers, and the native computer-use bridge failed its recovery retry because its Windows pipe was unavailable. The user-reported build ID `automat-faceless-0.1.0-mvs32n3j` was not independently verified as the loaded dashboard/worker/connector build. No Flow target, source record, attestation, composer, editor, or Generate control was inspected; no prompt was filled and no Generate input was sent. P04.3 live verification is **NOT_RUN**, not passed. The read-only diagnostic procedure and its NOT_COLLECTED output status are recorded in [P04.3 evidence](../docs/evidence/flow-one-image.md#p043-live-verification-attempt-28-october-2026). P04.4 bounded failure attribution remains **NOT_STARTED**. The Phase 04 gate remains **INCOMPLETE** pending its remaining gates and P05 terminal completion/attribution evidence.

### P04.3 — Run one explicitly authorized real long-JSON entry/Generate test

Evidence mode: **live-generation**.
Start in these files:

- docs/evidence/flow-one-image.md
- PROJECT_STATUS.md

Acceptance: Record the actual user-representative JSON profile, build/project, exact readback, one activation and observed provider outcome. Do not replay an uncertain result.

### P04.3 offline compatibility implementation — 29 October 2026

The user-supplied read-only diagnostic identifies the unique candidate shape used by this fix. Discovery accepts a contenteditable only when it is a `div[contenteditable="true"][role="textbox"]` nested in both `flow-rich-text-editor` and the same `flow-base-prompt-box`. Within that observed structure, a prompt/composer/create signal on the editable qualifies ownership; a `create` signal by itself on an arbitrary textbox does not. Search/navigation, hidden, disabled/read-only, unsupported representations, and multiple eligible editors remain excluded or blocked.

Fill-only entry uses the existing debugger binding and one CDP `Input.insertText` command after explicit focus and fresh target/frame/editor/source checks. The worker loads the one-item saved image batch, verifies its hash and measurements, writes/reads a content-addressed immutable source snapshot, then enters that exact body. The reader maps text nodes verbatim, `<br>` to LF, and direct `<p>`/`<div>` blocks to LF separators; unsupported markup fails closed. No trim, JSON rewrite, line-ending normalization, per-character loop, synthetic-only input path, overwrite, or automatic retry is used. Immediate and three-sample settled readback must match exactly. The guarded Generate path accepts the exact observed `Start generation` action name only for this verified rich-text composer profile, while retaining the existing exact action names and all dispatch safeguards.

Local evidence on 29 October 2026: focused Vitest **6 files / 82 tests PASS**; local Playwright Chromium **33 tests PASS**; typecheck, lint, formatting, production build, standalone connector/shared build-ID checks, and `git diff --check` **PASS**. The local observed-structure fixture entered the approved source exactly (**15,889 code units / 16,013 UTF-8 bytes / SHA-256 `f452ef3df4f0e7281560c52f980378df7f3cbfbc1b461353be1e46294a664a8b`**), plus multiline Unicode/escaped/nested JSON. The local CRLF case remains an explicit mismatch and is not normalized. Fixture verification does not establish actual Flow framework behavior. No provider tab was refreshed or navigated, no settings or saved batch changed, and no live Generate input was sent.

The user-reported targeted Flow diagnostic identifies one enabled submit control inside the uniquely verified composer with exact resolver name `Start generation`. The Generate resolver now accepts that exact name only for the observed rich-text composer profile; it retains `Generate`, `Generate image`, and `Create image`, all exact-match only. Local browser fixtures cover the observed four-control structure, the second non-Generate submit control, an identically named control outside the composer, hidden/disabled controls, duplicate eligible controls, misleading longer labels, all existing names, and the one-shot/duplicate/uncertain safeguards. These are synthetic fixtures, not a live dispatch.

The successful fill/readback and control label are user-reported live evidence; the failed attempt `eeb218cc-f987-4b86-b1b5-cc64d78d71bc` remains preserved with zero activation. The loaded package identity, fresh live target/document, current prompt/snapshot and settings confirmation, live results baseline, actual dispatch, and provider outcome remain unverified. Follow the one-shot user retest in [the current Flow evidence](../docs/evidence/flow-one-image.md#p043-generate-label-compatibility-fix--29-october-2026); no fill-only action is requested. P04.4 remains **NOT_STARTED**.

### P04.4 — Prove bounded pre-input and post-input failure attribution

Evidence mode: **offline**.
Start in these files:

- src/domain/jobs/attempt.ts
- src/background/handlers/flow.ts
- src/app/components/Notice.tsx
- tests/integration/flowGenerateBoundaries.test.ts

Acceptance: Preparation/preflight/observer/dispatch/storage failure stages stay distinct. Missing historic evidence remains absent; feedback arrives immediately.

P04.4 implementation summary: Worker results carry a fixed failure stage and separate action state from provider outcome. Pre-input failures retain `not_started`; successful input dispatch is reported as provider outcome `unverified`; partial input, lost acknowledgements, post-input observation/storage failure, and response loss retain `unknown`/`uncertain` and remain replay-blocking. Activation counts and press/release values are omitted when unobserved. The worker performs a fresh selected-document binding check after a complete input pair; it does not infer provider acceptance or result completion. UI pending feedback is set before awaited hashing/worker work, outcome text labels action/provider state separately, and unknown evidence is shown as unknown. A storage failure while persisting a pre-input failure blocks the action pending durable-state review.

P04.4 offline verification: focused boundary integration **24 tests PASS**; full Vitest **16 files / 172 tests PASS**; typecheck, lint, formatting, normal production build, manifest comparison, standalone connector/shared build identity, and `git diff --check` **PASS**. Packaged build ID: **`automat-faceless-0.1.0-mvt4oxfr`**. The user-provided screenshot identifies attempt `54589885-74c8-4088-beeb-e41f7fda9341`; it was not read or modified in storage. No live provider interaction was performed. P04.4 is **OFFLINE_VERIFIED**; live behavior remains unverified.

### Active-attempt identity collision follow-up — 29 October 2026

Source inspection confirmed that position-based item IDs could be reused after replacing one shot's JSON with another at the same batch position, while the active-attempt key contained only the item ID. The active key now includes the exact source hash. Repository checks also compare item ID plus exact source hash, preserving same-source and legacy-attempt duplicate blocking while allowing a genuinely changed source at the same position. Integration coverage exercises replacing shot 01 with shot 02 while the first attempt is still active.

Focused boundary integration **25 tests PASS**; full Vitest **16 files / 173 tests PASS**; typecheck, lint, formatting, production build, manifest equality, standalone connector/shared build IDs, and `git diff --check` **PASS**. Local package ID: **`automat-faceless-0.1.0-mvt58224`**. The historical attempt's project/item/shot/source hash/snapshot/state, the current selected provider project/workspace, and whether shot 02 is saved and selected were not available for independent inspection. Attempt `54589885-74c8-4088-beeb-e41f7fda9341` remains user-provided screenshot evidence only and was not changed. No provider page was accessed and Generate was not activated. See [the identity collision evidence](../docs/evidence/flow-one-image.md#p04-active-attempt-identity-collision-follow-up--29-october-2026). Phase 04 remains **INCOMPLETE**; do not reset or replay the historical attempt.

### Second live test — user-reported screenshot evidence — 29 October 2026

The user-provided screenshots report exact immediate and settled editor readback of **3,321 code units** with SHA-256 `bfed2a90b794a8b5de8e644a203d7a09ea73b999dc509808a7c9fbd6ee4301cb`. Attempt `5344f4f1-7277-452b-9e1e-d863b70d7a12` is shown as action state `dispatched`, code `activation_pair_sent`, one activation-pair attempt, and provider outcome `unverified`. Screenshots show manually selected `x2` and two completed Flow images. Press/release evidence remains uncertain as displayed; no missing acknowledgement is inferred. This is screenshot evidence, not independently verified runtime or stored attempt/result linkage. The images are not automatically attributed to the attempt. Preserve the attempt. P04 remains **INCOMPLETE**; P05 remains **NOT_STARTED**.

## Phase gate

One-shot entry/dispatch proof has offline/local-fixture evidence and user-reported screenshots, but no independently observed live runtime/storage evidence. G-IMAGE-ONE is fully closed only after P05 proves attributable terminal completion. P04.4 offline verification does not close that gate; P05 remains unstarted.

## Notes

- Settings are selected manually: Nano Banana Pro or Nano Banana 2.1, ratio and variants.
- No queue scaling or settlement redesign belongs in this phase.
- If real editor text representation normalizes anything, record the measured contract; never hide content mutation behind a generic normalization.

## Ready-to-copy first task

```text
Implement only P04.1 from phases/PHASE_04_FLOW_ONE_IMAGE.md.
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

## Latest P04.2/P04.3 handoff — 29 October 2026

The user reports a successful live **fill/readback only**: CDP `Input.insertText`, expected/actual length 15,889, exact SHA-256 `f452ef3df4f0e7281560c52f980378df7f3cbfbc1b461353be1e46294a664a8b`, immediate and settled match, no mismatch, and no Generate activation. This is user-provided screenshot evidence, not an independently inspected browser run; project and loaded package IDs for that fill were not provided.

P04.2 review found and fixed its contenteditable adapter gap. The one-shot handler now preflights the observed `flow-base-prompt-box` containing `flow-rich-text-editor` with its `div[contenteditable=true][role=textbox]`, validates exact saved prompt content, and resolves a unique enabled semantic Generate control within the composer. For this rich-text profile only, it supports the exact user-reported accessible name `Start generation` alongside the existing exact names `Generate`, `Generate image`, and `Create image`. It keeps source/project/top-document/settings/dispatch-intent/duplicate/no-replay guards. Local fixture coverage uses the observed four-control structure and verifies unique control acceptance, ambiguity blocking, and one-shot safeguards. No live Generate was sent.

Checks and current package ID are recorded in the latest [Generate-label compatibility evidence](../docs/evidence/flow-one-image.md#p043-generate-label-compatibility-fix--29-october-2026).

**Next eligible action:** one explicit user-triggered **Generate once in Flow** after loading the newly built package ID recorded in the current evidence and verifying the current project, unchanged saved source, and exact visible prompt. Keep the manually selected settings unchanged and reconfirm them once to create a fresh settings-confirmation ID; the preserved failed attempt already used the previous ID. Do not run the separate fill-only action. One-shot preparation must see exact existing text and report already-matching (`inputMethod=none`) without insertion; otherwise stop. The handler rechecks the immutable saved snapshot and target/document bindings. Any target/document/source/settings/control/baseline mismatch must stop before activation. An uncertain attempt must not be replayed. The user-reported live control label is not an independently observed dispatch; results observer behavior, live dispatch, provider outcome, and P05 terminal completion remain unverified. P04.4/P05 are not started.

The results-baseline failure below supersedes that prior next-action note: **do not run Generate yet**. The current next step is the read-only diagnostic described below.

## Latest P04.3 results-baseline blocker — 29 October 2026

The user reports attempt `b5eba61e-b239-4e9e-823b-ecc2591e8927` failed before dispatch at the results-observation gate with zero activation pairs; the historical attempt `eeb218cc-f987-4b86-b1b5-cc64d78d71bc` remains preserved. The precise fixed code (`observation_missing` or `observation_ambiguous`) and loaded package ID were not supplied. The current observer accepts a visible exact-labelled result region and records visible `img`/`video` count; a zero count is not positive empty-state evidence. Existing reports contain no Flow result-surface DOM, so do not change selectors or relax the baseline yet.

Run [the focused results-baseline diagnostic](../tools/diagnostics/flow-results-baseline-readonly.js) in the same existing Flow tab and provide its JSON plus the dashboard build ID. It also reports composer and Generate DOM checks where observable; saved-source/project/document/settings/attempt checks remain worker-only. It does not read or return prompt text, URLs, media sources, account data or credentials. No provider page, prompt, settings, saved source, attempt, or Generate control was changed or activated. One-shot Generate remains **NOT_READY** pending the actual result-surface evidence; P04.4/P05 remain **NOT_STARTED**.

## P04.3 observed empty-workspace baseline compatibility — 29 October 2026

The user-provided live DOM evidence identifies the exact visible `Start creating or drop media` span inside a `div` whose direct children are `mat-icon` and `span`, directly under `flow-project-page`. That page contains the verified composer; the phrase is outside it and outside navigation/account ancestry. The marker scope has no media/cards/loading markers. Two non-visible project-scope media nodes have unverified ownership and are ignored. The user reports a stable two-animation-frame observation. This is user-reported live DOM evidence, not an independently inspected Flow run, and establishes only the selected workspace's empty UI.

The adapter now supports this exact profile without requiring synthetic gallery labels. It binds one visible marker to the unique composer-owning `flow-project-page`, deduplicates nested matches by marker element ownership, and requires no visible media/card/loading or same-workspace labelled-results conflicts plus a stable two-frame sample. Independent markers, wrong ownership, hidden marker, loading, conflicting visible result signals, and marker mutation block preflight. The prior exact-labelled region profile remains supported. Hidden media is not classified or counted as generated results; unobserved populated-card structure remains unsupported. A sent activation pair continues to report dispatch only; provider acceptance/results stay unverified, and no post-dispatch observation can trigger a second activation.

Local fixture verification: full Vitest **16 files / 167 tests PASS**; focused Generate browser suite **20 tests PASS**, full local browser suite **43 tests PASS**; typecheck, lint, Prettier on changed source/docs (except the established non-Prettier PROJECT_STATUS table), production build, standalone connector, shared build IDs, and `git diff --check` **PASS**. Build ID: **`automat-faceless-0.1.0-mvt3k04r`** across dashboard, worker and standalone connector. Fixture verification is not live Flow dispatch. No provider page, prompt, settings, attempt, or P01.3 demo asset was modified; failed attempts `eeb218cc-f987-4b86-b1b5-cc64d78d71bc` and `b5eba61e-b239-4e9e-823b-ecc2591e8927` remain preserved.

**One-shot user retest:** load the build with ID `automat-faceless-0.1.0-mvt3k04r` without refreshing/navigating the provider tab. Verify the existing selected project, saved immutable prompt source, exact prompt already in the composer, and unchanged manually selected settings; reconfirm the current settings in the dashboard if required for a fresh attempt. Invoke **Generate once in Flow** exactly once. If preflight blocks, preserve the reason and stop. After input dispatch, `dispatched` means only that the single input pair was sent; provider acceptance and results remain unknown. Do not retry an uncertain or unsupported result. P04.4/P05 remain **NOT_STARTED**.

## P04.3 user-reported live dispatch and output — 29 October 2026

The user reports screenshots show Flow generation progress followed by a completed dinosaur image. A dashboard screenshot reportedly shows `dispatched` and one activation-pair attempt. This is **USER_REPORTED_SCREENSHOT_EVIDENCE**. The attempt ID was not included in this report. No browser runtime, debugger event stream, or durable attempt record was independently inspected, so the dashboard state and activation count are not independently storage/runtime verified. Preserve the attempt as-is; do not reset or replay it.

This evidence supports a user-reported live Generate dispatch and visible output, but does not establish automatic result attribution, persisted provider-result linkage, or independently verified completion. P04.4 remains **NOT_STARTED**. Its original acceptance is: keep preparation/preflight/observer/dispatch/storage failure stages distinct; leave missing historical evidence absent rather than fabricating it; and provide immediate feedback. The original P04.4 file list is `src/domain/jobs/attempt.ts`, `src/background/handlers/flow.ts`, `src/app/components/Notice.tsx`, and `tests/integration/flowGenerateBoundaries.test.ts`. No P04.4 or P05 implementation has started.
