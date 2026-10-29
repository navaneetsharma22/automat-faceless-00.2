# P04 — One long image JSON: entry and one Generate

Status: **INCOMPLETE — P04.1/P04.2 remain offline/local-fixture verified; the P04.3 evidence-backed discovery and fill-only compatibility fix is implemented and offline/local-fixture verified; live Flow fill is NOT_RUN; P04.4 NOT_STARTED.** The user reports Flow/Vids connection success after the route fix. Actual live editor behavior, exact live fill/readback, and provider outcome remain unverified. Stop this task before live generation.

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

Fill-only entry uses the existing debugger binding and one CDP `Input.insertText` command after explicit focus and fresh target/frame/editor/source checks. The worker loads the one-item saved image batch, verifies its hash and measurements, writes/reads a content-addressed immutable source snapshot, then enters that exact body. The reader maps text nodes verbatim, `<br>` to LF, and direct `<p>`/`<div>` blocks to LF separators; unsupported markup fails closed. No trim, JSON rewrite, line-ending normalization, per-character loop, synthetic-only input path, overwrite, or automatic retry is used. Immediate and three-sample settled readback must match exactly. P04.2 continues to reject this contenteditable for Generate, so this compatibility path cannot activate Generate.

Local evidence on 29 October 2026: focused Vitest **6 files / 82 tests PASS**; local Playwright Chromium **23 tests PASS**; typecheck, lint, formatting, production build, standalone connector/shared build-ID checks, and `git diff --check` **PASS**. The local observed-structure fixture entered the approved source exactly (**15,889 code units / 16,013 UTF-8 bytes / SHA-256 `f452ef3df4f0e7281560c52f980378df7f3cbfbc1b461353be1e46294a664a8b`**), plus multiline Unicode/escaped/nested JSON. The local CRLF case remains an explicit mismatch and is not normalized. Fixture verification does not establish actual Flow framework behavior. No provider tab was refreshed or navigated, no settings or saved batch changed, and no Generate input was sent. Follow the user-run fill-only procedure in [the latest Flow evidence](../docs/evidence/flow-one-image.md#p043-offline-compatibility-implementation--29-october-2026); P04.3 live fill/readback remains **NOT_RUN** and P04.4 remains **NOT_STARTED**.

### P04.4 — Prove bounded pre-input and post-input failure attribution

Evidence mode: **offline**.
Start in these files:

- src/domain/jobs/attempt.ts
- src/background/handlers/flow.ts
- src/app/components/Notice.tsx
- tests/integration/flowGenerateBoundaries.test.ts

Acceptance: Preparation/preflight/observer/dispatch/storage failure stages stay distinct. Missing historic evidence remains absent; feedback arrives immediately.

## Phase gate

One-shot entry/dispatch proof passes. G-IMAGE-ONE is fully closed only after P05 also proves attributable terminal completion.

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
