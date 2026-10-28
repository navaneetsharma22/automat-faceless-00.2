# P04 — One long image JSON: entry and one Generate

Status: **INCOMPLETE — P04.1 OFFLINE_VERIFIED / LOCAL_BROWSER_FIXTURES_VERIFIED; P04.2 OFFLINE_VERIFIED; P04.3–P04.4 NOT_STARTED.** Real Flow DOM compatibility, live entry, and provider outcome remain unverified.

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

P04.1 implementation summary: The shared canonical Flow parser now accepts the account-prefixed `/u/{number}/project/{projectId}` route and preserves it in canonical identity; the original tab URL is retained unchanged. `composer.ts` excludes search controls, requires a unique visible/enabled editor within a semantically owned composer boundary, and distinguishes missing/ambiguous/unsupported discovery from method compatibility. Placeholder text is not sufficient by itself. Textareas and text inputs are the only currently supported entry targets. Contenteditable candidates are blocked because local browser evidence did not demonstrate exact newline preservation for that representation. All selectors are candidate signals pending a user-run read-only inspection of the real Flow DOM.

The image import panel now offers **Inspect and fill Flow prompt (no Generate)** only for one successful current image JSON validation and the user's manual Flow settings confirmation. The worker validates the dashboard message/build/protocol, selected Flow record, live tab route, and top-frame document loader, then attaches CDP to that selected tab. It rechecks selection and document binding before input and after asynchronous work. Existing exact text is stable-read without insertion; different text conflicts without mutation; verified empty textarea input uses one `Input.insertText` command. A timeout or uncertain input is not retried, and the panel blocks subsequent automatic attempts for that mounted session. Generate/submit commands do not exist in this handler.

P04.1 permission decision: Chrome `debugger` is declared in required `permissions` because it cannot be requested as an optional permission. It is not included in `optional_permissions`. The permission only backs the explicit P04.1 fill action. No provider page, settings, refresh, navigation, or account state was touched during this task. The extension's generation capability remains unavailable.

### P04.1 offline and local-browser evidence

Focused Vitest: `tests/unit/flowComposer.test.ts`, `tests/unit/flowPromptEntry.test.ts`, and `tests/unit/connections.test.ts` — **3 files / 38 tests PASS**. Full Vitest regression suite: **15 files / 137 tests PASS**. These mocks cover route/account identity, missing permission, changed target, missing/ambiguous composer, conflicting content, existing exact text, single insertion, mismatch diagnostics, cleanup, and no submit/key activation. The source check does not establish live Chrome debugger behavior.

Local Playwright Chromium fixtures: **8 tests PASS** using local DOM fixtures only. Tests distinguish search from a uniquely labelled composer; reject missing, hidden, disabled, ambiguous, placeholder-only and unsupported contenteditable candidates; cover empty/matching/conflicting editor content; preserve the approved image sample exactly in a textarea; record an explicit CRLF-to-LF representation mismatch in a textarea; and verify exact text after a local textarea node replacement. These are simple local DOM fixtures, not a Flow page or a framework-managed editor. No Generate/submit was activated.

Approved sample identity: the file [`tests/fixtures/prompts/p04-image-user-approved-intended-use.json`](../tests/fixtures/prompts/p04-image-user-approved-intended-use.json) was copied byte-for-byte from the user-provided selected image source after verifying **15,889 JavaScript code units / 16,013 UTF-8 bytes / SHA-256 `f452ef3df4f0e7281560c52f980378df7f3cbfbc1b461353be1e46294a664a8b`**. It retains assistant-generated, user-approved intended-use provenance and is not a historical production sample.

Local browser results: the approved image source read back exactly after `page.keyboard.insertText` into a local textarea (Playwright's Chromium text-input path; 654 ms test duration). A separate 25,000-code-unit / 25,062-byte CRLF fixture entered into a local textarea read back as **24,958 code units / 25,020 UTF-8 bytes**, with all 42 CRLF pairs represented as LF. The test asserts the first mismatch is at the first CRLF pair (`CR` in source versus `LF` in textarea readback), and asserts exact inequality; no normalization is applied. The suite completed in 9.0 seconds. Results are local-fixture evidence only, not proof of Flow editor behavior or provider acceptance.

Final offline checks: `npm run typecheck`, `npm run lint`, changed-file Prettier check, `npm run build` (Vite 8.3.5, 159 modules), and `git diff --check` passed. Shared packaged build ID: **`automat-faceless-0.1.0-mvs202rv`**. The built manifest matches the public manifest, and the dashboard, background worker, and connection probe share the build ID. This verifies packaged output offline; it is not a live loaded-extension/build claim.

### Read-only Flow DOM inspection handoff

No actual Flow DOM was inspected in this task. If a user later wants to provide the missing read-only evidence, open the already-selected Flow project without refreshing or navigating it, open DevTools Console, and run a read-only metadata inspection such as:

```js
Array.from(
  document.querySelectorAll(
    'textarea, input, [contenteditable="true"], [role="textbox"]',
  ),
).map((el) => {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const owner = el.closest(
    'form, [role="form"], [role="group"], [role="region"], [data-composer]',
  );
  return {
    tag: el.tagName,
    role: el.getAttribute("role"),
    type: el.getAttribute("type"),
    ariaLabel: el.getAttribute("aria-label"),
    placeholder:
      el.getAttribute("placeholder") ?? el.getAttribute("data-placeholder"),
    contenteditable: el.getAttribute("contenteditable"),
    disabled: el.matches(':disabled, [disabled], [aria-disabled="true"]'),
    visible:
      r.width > 0 &&
      r.height > 0 &&
      style.visibility === "visible" &&
      style.display !== "none",
    ownerTag: owner?.tagName,
    ownerRole: owner?.getAttribute("role"),
    ownerLabel: owner?.getAttribute("aria-label"),
    textLength: "value" in el ? el.value.length : (el.textContent ?? "").length,
  };
});
```

Share only the returned metadata, not prompt text. The procedure does not focus, click, type, submit, or alter page state. This evidence is still **NOT_RUN**.

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

Implementation: The image workspace exposes **Generate once in Flow** only for one currently validated prompt whose source exactly matches its saved image batch, after a manual settings confirmation bound to the currently selected Flow tab/project. The worker reloads that saved batch through the validated repository, checks the item hash and measurements, validates the stored selected target against the current Flow route, and binds the attempt to the current top-frame ID/loader. The attempt record contains workspace/batch/item/shot identity, prompt hash/measurements, target/frame/build/protocol identity, user attestation, pre-dispatch result-region baseline, fixed event codes, and state; it does not duplicate the prompt body.

The worker persists `preparing` before exact saved-source fill/readback, then `verified`, inspects one semantic image composer, one exact enabled Generate control and one labelled results region, and rechecks the target/frame, prompt, control and baseline before persisting `dispatch-intent`. Only then does it issue one CDP `mousePressed`/`mouseReleased` pair. Dispatched means the pair was sent; it does not mean Flow accepted the request or produced an image. Partial/unknown activation is retained as `uncertain` and cannot be replayed. Active item and confirmation keys prevent concurrent and repeated clicks. Worker-start reconciliation turns `preparing`/`verified` into `failed-before-dispatch` and `dispatch-intent` into `uncertain`; it never replays Generate.

Evidence boundary: offline handler/repository tests exercise state and failure decisions, including restart-state reconciliation. The P04.2 local Playwright suite could not start in this environment because its worker process was denied with `spawn EPERM`; no local browser result is claimed for P04.2. No real Flow page, provider settings, or Generate control was accessed. The semantic selectors remain candidates, and the provider result observer is only a labelled-region baseline, not terminal attribution.

P04.2 implementation is **OFFLINE_VERIFIED**. P04.3 real-provider long-JSON entry/Generate and P04.4 bounded failure attribution remain **NOT_STARTED**. The Phase 04 gate remains **INCOMPLETE** pending those gates and P05 terminal completion/attribution evidence.

### P04.3 — Run one explicitly authorized real long-JSON entry/Generate test

Evidence mode: **live-generation**.
Start in these files:

- docs/evidence/flow-one-image.md
- PROJECT_STATUS.md

Acceptance: Record the actual user-representative JSON profile, build/project, exact readback, one activation and observed provider outcome. Do not replay an uncertain result.

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
