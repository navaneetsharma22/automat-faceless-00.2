## P06.1 timed queue evidence - 30 October 2026

P06.1 now persists a separate timed image queue in additive Dexie v7 storage. Each record snapshots the exact saved source and source hash, ordered prompt bodies/hashes/source spans/shot IDs, Flow target binding, and current user-attested settings declaration. The fixed mode interval is 40,000 ms. New queues are `ready`; their items are `pending`; outcomes are `not_started`; no dispatch receipt or next-deadline exists. The dashboard reads actual queue rows and says provider submission/countdown are unavailable in this subphase.

The create transaction rechecks the saved batch/items and selected target/settings binding, scans blocking attempt hashes across IDs, refuses a source already in another timed queue, inserts the record, and validates exact source/body/hash/order on readback. It does not mutate attempts, snapshots, count decisions, locks, or observations. Timed mode does not invoke count observation or rebaseline. A sent receipt means dispatch evidence; provider outcome stays unknown.

Checks on 30 October 2026 for P06.1: focused unit/repository tests 10/10 PASS; full Vitest 24 files / 286 tests PASS; real-Dexie Chromium persistence/readback 1/1 PASS; configured offline Playwright 65/65 PASS; final dashboard focused rerun 1/1 PASS; typecheck, ESLint, Prettier, production build/package validation, and `git diff --check` PASS. Package ID `automat-faceless-0.1.0-mvv1t4bq`.

## P06.2 guarded timed dispatch evidence — 30 October 2026

`imageQueue.start` routes to one serialized scheduler operation at a time. A queue claim and per-item dispatch intent are written/read back before touching Flow. Activation-start is separately persisted before the click pair. Pre-activation failures stay `not_started`; post-activation uncertainty is `unknown`, blocks the queue, and cannot replay. Once the activation pair returns, a single Dexie transaction stores the dispatch receipt and next deadline at `receiptStoredAt + 40,000 ms`; the timestamp is recorded in the receipt transaction. The next item cannot claim before that saved deadline. Late/duplicate alarms reload state and either return early or find no pending item; there is no overdue catch-up loop. Unresolved Sending records at startup are not rescheduled.

The timed Flow handler verifies the exact immutable body/hash and selected verified project/tab/document; acquires the shared Flow debugger lease; uses guarded prompt entry and exact immediate/settled readback; checks the currently enabled Generate control in the owned composer; rechecks the frame/document before activation; records activation-start, then sends exactly one activation pair. This path does not invoke count readiness, image/result baseline, observation, or rebaseline. Same-source queue/history locks are preserved.

The real-Dexie Chromium integration invokes the production scheduler and production timed Flow dispatcher against a synthetic local composer with CDP input. It verified the exact two ordered source bodies, one activation per source, the first durable receipt before dispatch two, blocked at 39,999 ms, eligible at 40,000 ms, duplicate and late alarm suppression, and provider outcomes remaining unknown. Focused scheduler unit coverage includes uncertain activation, binding refusal, and failed receipt persistence blocking progression. The local Chromium fixture adapts browser debugger/document and alarm APIs; it does not constitute an installed-MV3 run. Installed-MV3 validation: **NOT_RUN**. Live provider actions: **NOT_RUN**.

Validation: focused Vitest 2 files / 9 tests PASS; full Vitest 25 files / 290 tests PASS; real-Dexie Chromium sequence 1/1 PASS; full configured Chromium suite 66/66 PASS; typecheck, ESLint, production package/build-ID validation, and `git diff --check` PASS. Validated package ID: `automat-faceless-0.1.0-mvv2q5pz` (to be replaced only if the final rebuild changes it). P06.3/P06.4 and all G-IMAGE gates remain open.

## P06.3 pause, restart, and uncertainty evidence — 30 October 2026

P06.3 adds revision-checked, idempotent Pause/Resume/Stop commands and truthful dashboard controls with durable readback, including a persisted reason when revalidation pauses continuation. `activationStartedAt` is the persisted authorization boundary: Pause/Stop winning before that write invalidates the stale claim and prevents input; if authorization wins first, the operation may finish and its receipt is committed while preserving the requested paused/stopped state. Stop marks unsent items stopped and remains terminal. Resume revalidates the saved target, project, document, and settings binding, preserves `nextEligibleDispatchAt`, and runs at most one overdue item. A missing dashboard reply is handled by re-reading the durable queue; unresolved Sending/intent records block on restart and are never replayed. Timed queue readiness is independent of the count observer/rebaseline startup path.

The installed-MV3 smoke used the final packaged worker in a temporary Chromium profile and a locally intercepted synthetic Flow page. It obtained the extension ID from `chrome://extensions`, exercised actual Chrome debugger/scripting APIs and alarms, sent two distinct synthetic prompts, paused/resumed, then terminated the worker through Chrome's ServiceWorker protocol and detached that CDP session before waiting for the saved alarm. After worker restart the real alarm produced exactly two ordered activations; persisted receipts were 40,266 ms apart, both provider outcomes remained `unknown`, and no worker DevTools target was kept open during the interval. This is local synthetic acceptance, not live Flow behavior or natural-idle suspension evidence.

The installed run exposed a real Dexie adapter bug in the resume transaction: its composite store key had been passed as two entries, so the adapter selected the queue-only transaction and the selected-target read failed with `NotFoundError`. The resume repository now uses the adapter's composite key for the atomic queue/target transaction. P06.3 regression coverage includes pause before/after authorization, stop during authorized work, deadline-preserving and overdue resume, repeated commands, crashes before and after activation authorization, durable receipt after a discarded reply, changed-target refusal, duplicate late alarms, and concurrent independent schedulers.

Final checks after the correction: full Vitest **26 files / 298 tests PASS**; configured Chromium suite **66/66 PASS**; typecheck, ESLint, Prettier, production build and package validation PASS. The first Chromium attempt's dashboard test failed because Vite was not listening on `127.0.0.1:5173`; rerun with the required local Vite server passed all 66 tests. Installed-MV3 smoke PASS with package ID `automat-faceless-0.1.0-mvv3udjn`. No live Flow Generate, provider input/navigation/refresh, historical settlement, deletion, or lock release occurred. P06.4 live acceptance and G-IMAGE-ONE/TWO/SCALE remain NOT_RUN / NOT_PASSED.

## Timed queue dashboard presentation — 31 October 2026

The active queue now occupies the image workspace summary column beside import and source summary, stacking on mobile. Receipt-backed prompt totals, current/next shot ID and scene title, state badge, prompt rows, and queue controls are visible. Exact prompt source, block codes, and technical/provider evidence are disclosed on demand. Control commands keep the existing worker routes; pending command feedback disables repeated clicks, and saved status changes only after readback.

The Waiting clock is a small isolated component driven by `nextEligibleDispatchAt`; its one-second local tick does not fetch queue data, mutate the deadline, or dispatch. Queue refresh runs at five-second intervals plus direct command readbacks. Countdown zero remains Pending and reads “Checking next prompt…”; only the durable state can show Sending. The meter uses the persisted 40,000 ms interval. Completed queues display the requested submission-finished and unverified-results wording without another wait. Sent count derives from durable local dispatch receipts.

Focused evidence on 31 October: Vitest **4 files / 24 tests PASS**; Playwright browser fixtures **2/2 PASS**; typecheck, ESLint, production build/package validation, and `git diff --check` PASS. Fixtures cover Waiting clock/deadline zero, Sending, Paused, Blocked, Stopped, and all-sent presentation; the local browser test additionally checks theme switching, keyboard focus, reduced-motion CSS, narrow-width overflow, one-second refresh isolation, Pause pending/readback, and absence of Generate/start messages. Screenshots are stored in `artifacts/image-queue-presentation/` for light desktop, dark desktop, mobile Waiting, and deadline zero. Package `automat-faceless-0.1.0-mvvu32ux`. No live provider operation or installed-dashboard check was performed.

## Finished queue followed by a distinct saved source — 31 October 2026

Cause: the Progress render condition used `queues.length === 0` to decide whether the Create timed queue action existed. That made any saved queue, including a finished historical queue, hide setup for the current distinct saved batch.

The create card now follows current saved-source identity. A completed queue remains visible under “Previous queue — N/N sent,” while the new source displays its exact shot-ID list, requires a fresh manual settings confirmation, and can create a new ready queue after strict readback verifies its source, IDs, project binding, and no-dispatch state. The regression fixture covers old completed Shots 8/9 followed by newly saved Shots 10–14. It confirms one create request, no activation/start, the old record retained, and the new queue ready with pending items and no receipts/deadline. Existing exact-source duplicate and unresolved/active queue protections are retained; unit coverage also checks concurrent same-source creation and queue blockers.

Checks: focused Vitest **2 files / 19 tests PASS**; focused browser suite **3/3 PASS**; typecheck PASS; ESLint PASS; production package and build-ID validation PASS; `git diff --check` PASS. Package ID `automat-faceless-0.1.0-mvvuq23e`. Tests use local fixtures and isolated memory persistence; no live provider operation or historical mutation occurred.

## Blocked shot identity and post-clear editor readback — 31 October 2026

The current code emits `editor_exact_readback_mismatch` only from the timed dispatcher's final `inspectTimedFlowGenerate` exact-prompt check. That stage occurs after `enterFlowPrompt` has required exact immediate and settled reads, and before the scheduler callback persists `activationStartedAt`; it returns `uncertain: false`. The newly supplied Source & evidence line is generated from the queue item (`no dispatchReceipt` and `providerOutcome: not_started`). The `imageQueue.list` repository validates the source hash and each ordered item body/hash/shot ID/source span before returning the record, while the queue schema requires `providerOutcome: unknown` if `activationStartedAt` exists. Thus the displayed Shot 11 row backs that item as not locally activation-authorized and without a receipt; it does not establish there were no separate attempts outside that item/history. The raw queue item and actual editor string were unavailable here, so the incident's expected/actual lengths, hashes, differing offset/context remain unverified. Do not use Shot 10's receipt count to infer other activation history.

The production-path local Chromium fixture reproduces first prompt → synthetic Generate click → Flow rich-editor clear to `P/BR` → second long JSON prompt. A second fixture injects a known trailing space only after Shot 11's successful immediate and settled reads, at the final pre-activation inspection. For that controlled mutation, expected Shot 11 is 16,332 code units/bytes, hash `4486ec043e231cd054abc5ca0a0fa1c40c8e8861691304a1cd5657fc9e167e23`; actual is 16,333 code units/bytes, hash `ae15d5090b4f3924d95bfeee8b3d1fd730824fa60d338b8255b805c5f5eb4032`; first difference is offset 16,332 (length mismatch). Bounded escaped context shows the synthetic appended space. The durable fixture row is Shot 11 `blocked`, `not_started`, no receipt, intent present, no activation-start marker, and `editor_exact_readback_mismatch`; only Shot 10 has a receipt. This verifies the stage and durable/UI mapping without claiming the synthetic difference was the incident's character. The actual screenshot mismatch remains unreproduced; no normalization, retry, or dispatcher behavior was changed.

The reproduced UI issue was independent: blocked queue presentation selected the later Pending item as current and styled all later pending rows Blocked; the import preview also asserted every prompt was Not sent despite a matching receipt-backed queue. The dashboard now identifies the blocked shot, leaves later items Pending, and only maps source-row states when the exact validated/saved source and ordered queue body/shot/span identities match. A nonmatching draft is labeled Preview.

Checks: focused Vitest **4 files / 33 tests PASS**; focused Playwright **5/5 PASS**; typecheck, ESLint, Prettier, production package/build-ID validation, and `git diff --check` PASS. Package `automat-faceless-0.1.0-mvvvkhnk`. No live Generate/provider action, replay, refresh/navigation, storage deletion, historical settlement, or lock release was performed.

## Bounded readback diagnostics and read-only inspection evidence — 31 October 2026

Existing durable state was insufficient: `ImageSubmissionQueueRecord` and its items stored only `blockReason: "editor_exact_readback_mismatch"` without lengths, hashes, first difference offset, or context. The exact cause of the historical Shot 11 mismatch remained unprovable from stored data alone.

1. **Bounded Diagnostic Collection**:
   When `inspectTimedFlowGenerate` detects `!inspection.exactPrompt`, `readCurrentFlowEditorText` extracts the live Flow editor text via read-only CDP evaluation without DOM mutation. `comparePromptReadbackSafely` computes code-unit lengths, SHA-256 hex digests, first difference offset, and bounded escaped context snippets (max 32 chars). Neither the full editor text nor the full prompt body is stored in logs or Dexie records.

2. **Immutable Queue Item Binding & Fail-Closed Safety**:
   The diagnostic is persisted on `item.readbackDiagnostic` via `blockTimedImageQueue`. If diagnostic collection fails, the catch block logs a bounded warning and returns `status: "blocked"` with `reason: "editor_exact_readback_mismatch"`. If storage fails schema validation, a fallback transaction blocks the item without the diagnostic. Generate activation is never authorized and the original mismatch is never masked.

3. **Read-Only Inspection Path**:
   `inspectFlowEditorAgainstQueueItem` (dispatched via `imageQueue.inspectReadback`) executes read-only CDP evaluation against the active Flow tab, retrieves the immutable queue item from Dexie, and runs `comparePromptReadbackSafely`. It does not insert text, click Generate, mutate queue or item state, or authorize replay.

4. **Synthetic Fixtures & Incident Verification**:
   The historical Shot 11 prompt body and provider DOM content were not preserved; all test fixtures (including the synthetic 3,874-character fixture derived from the user preview count) are explicitly labeled synthetic.

5. **Scheduler & Guard Preservation**:
   The exact-match guard and 40,000 ms interval remain strictly enforced. No text normalization, retry, replay, or live provider actions were performed.

Checks: full Vitest **28 files / 323 tests PASS**; Playwright browser sequence **2/2 PASS**; typecheck PASS; ESLint PASS; Prettier PASS; production package and build-ID validation PASS; `git diff --check` PASS. Package ID: **`automat-faceless-0.1.0-mvvwjrlo`**.

## Blocked queue read-only inspection button — 31 October 2026

1. **Queue ID Display**:
   The expanded “Queue and provider evidence” details discloses the persisted `Queue ID: <code>{queue.queueId}</code>`.

2. **Read-Only Inspection Button on Blocked Queue**:
   An “Inspect current editor (read-only)” button renders in the blocked queue's action row. It automatically binds to that queue's persisted `queueId` and the blocked item's `order` (targeting Shot 11).

3. **Response Presentation**:
   Clicking the button calls `imageQueue.inspectReadback` and presents the response:
   - Identifies the shot (`Live editor inspection (read-only) — Shot 11:`).
   - Reports match status and mismatch category.
   - Displays expected and actual code-unit lengths, UTF-8 byte sizes, and SHA-256 digests.
   - Highlights first difference offset and bounded context snippets.
   - Displays any inspection error or read error without modifying queue state, inserting text, clicking Generate, or authorizing replay.

Checks: full Vitest **28 files / 324 tests PASS**; Playwright browser sequence **2/2 PASS**; typecheck PASS; ESLint PASS; Prettier PASS; production package and build-ID validation PASS; `git diff --check` PASS. Package ID: **`automat-faceless-0.1.0-mvvxbkzj`**.

## Standalone debugger lease acquisition and bounded inspection error mapping — 31 October 2026

1. **Proven Cause Tracing**:
   - The generic error `"Inspection error: The timed queue operation could not be safely completed."` was produced by `createConnectionMessageListener` catch-all at `connections.ts:537-546`.
   - `inspectFlowEditorAgainstQueueItem` called `readCurrentFlowEditorText(pagePort, selected.tabId)` directly without acquiring its own debugger lease.
   - After a timed queue item blocked or dispatch completed, dispatch cleanup had already released its debugger lease (`pagePort.releaseDebuggerLease(lease)`) and detached Chrome's debugger.
   - In production, calling `pagePort.sendCommand` without an active debugger lease threw `Error: Debugger is not attached to that target`.
   - `connections.ts` `case "imageQueue.inspectReadback"` only caught `ImageQueueEligibilityError`, so the unhandled debugger error escaped to the outer `.catch` and was masked by the generic `"image_queue_operation_failed"` response.

2. **Standalone Debugger Lease Acquisition & Cleanup**:
   - `inspectFlowEditorAgainstQueueItem` now explicitly requests a dedicated standalone debugger lease with owner `timed-image-queue-inspect:${queue.queueId}:${order}` before reading editor text.
   - The lease is released in a strict `finally` block, leaving no dangling attachment or held tab lock.
   - It performs full pre-read validation: queue lookup, item order bounds, stored target and verification binding validation, live tab availability check, and document binding verification.

3. **Bounded Failure Stage and Error Classification**:
   - Added optional `stage` (`request_validation`, `queue_lookup`, `target_verification`, `debugger_lease`, `editor_readback`, `response_validation`) to `AppResponseSchema` error payload, `FoundationOperationError`, and `FoundationClientError`.
   - Introduced `ImageQueueInspectionError` to carry `stage`, bounded classification `code`, safe `message`, and private `cause` (preserving original error without exposing raw stack traces or JSON prompt text across the wire).
   - In `connections.ts`, all inspection errors are mapped to `FoundationOperationError` with bounded stage and code; none fall through to generic queue failure.
   - In `Progress.tsx`, errors are displayed as `[stage] code (category): message`.

4. **Integration Regression**:
   - Added `tests/integration/imageQueueInspection.test.ts` traversing the real message handler (`createConnectionMessageListener`) and production port adapter (`createChromeFlowImageGenerateOncePort`) after dispatch cleanup with no existing lease.
   - Verified:
     - Standalone lease acquisition and release in production adapter.
     - Bounded `debugger_lease` / `debugger_lease_acquisition_failed` mapping when attach fails.
     - Bounded `target_verification` / `selected_project_or_connection_changed` mapping when target changes.
     - Bounded `target_verification` / `selected_target_unavailable` mapping when tab is closed.
     - Immutability: zero queue state mutations, zero text insertions, zero Generate activations.
   - Clearly documented the distinction between Node/Vitest mocked API unit tests and installed-MV3 verification.

Checks: full Vitest **29 files / 329 tests PASS**; Playwright browser sequence **2/2 PASS**; typecheck PASS; ESLint PASS; production package and build-ID validation PASS; `git diff --check` PASS. Package ID: **`automat-faceless-0.1.0-mvvy408d`**.

## Guarded continuation and readback comparison for blocked Shot 11 — 31 October 2026

1. **Comparison of Production Final Pre-Activation Readback vs Read-Only Inspection**:
   - **Editor Selection**:
     - Both mechanisms share `flowComposerRuntime(expectedText, returnEditor = true, readText)`.
     - In the rich text host (`flow-rich-text-editor` / `flow-base-prompt-box`), both identify the uniquely owned contenteditable `div[role=textbox]` inside the verified prompt composer boundary.
     - Finding: Editor selection is identical.
   - **Text Extraction**:
     - Both mechanisms invoke `readFlowEditorRuntime(editor)`.
     - The extraction traverses direct `P` and `DIV` child blocks, extracts text recursively across inline `SPAN` elements (failing closed on unexpected tags or hidden nodes), treats isolated `<br>` tags within a line as empty lines rather than text modifications, and joins lines with `\n`.
     - Finding: Text extraction is identical; exact source equality is preserved.
   - **Execution Context**:
     - Production pre-activation readback (`inspectTimedFlowGenerate`): Injects `flowTimedGenerateRuntime` via CDP `Runtime.evaluate` (`returnByValue: false`), compares `actual === expectedText` in the webpage JS context, sets DOM dataset attributes on the remote button element (`button.dataset.afExact`), and retrieves the evaluation via a second CDP round-trip (`Runtime.callFunctionOn`).
     - Read-only inspection (`readCurrentFlowEditorText` + `inspectFlowEditorAgainstQueueItem`): Injects an IIFE via CDP `Runtime.evaluate` (`returnByValue: true`), retrieves the extracted string directly to the background service worker, and runs cryptographic digest/length comparisons in extension TypeScript via `comparePromptReadbackSafely`.
   - **Timing**:
     - Pre-activation readback executes immediately after synthetic input insertion and frame verification in the active dispatch cycle. Transient DOM mutations, pending React reconciliations, or asynchronous Lexical editor transformations could cause a temporary disparity during the pre-activation window.
     - Read-only inspection executes on demand long after input has completed, against a completely quiescent and settled DOM.
   - **Historical Mismatch Boundary**:
     - Live read-only inspection confirms the editor currently holds 3,874 code units with SHA-256 `3da7fe8413546bf5992a03b7a66e5f9570bcce001845003cbfc305c2d9849387`, matching the immutable saved prompt.
     - This post-facto match does NOT explain the historical mismatch; transient DOM states present at the historical moment of dispatch failure were not captured and cannot be presumed.

2. **Durable Safety Proofs for Explicit Guarded Continuation (`imageQueue.retryBlocked`)**:
   - **Proof of No Activation Authorization**:
     - `item.providerOutcome === "not_started"`
     - `item.dispatchIntent?.activationStartedAt === undefined`
     - Refuses with `incompatible_activation_state` or `uncertain_activation_replay_prohibited` if any activation was ever initiated.
   - **Proof of No Receipt or Uncertain Dispatch**:
     - `item.dispatchReceipt === undefined`
     - All subsequent queue items have `dispatchReceipt === undefined`.
     - Refuses with `dispatch_receipt_already_exists` or `incompatible_queue_state`.
   - **Proof of Unchanged Source, Project, and Document**:
     - `sha256Hex(item.rawJsonBody) === item.promptHash`
     - `selectedTarget("Flow")` matches `queue.selectedProject` (`tabId`, `projectId`, `canonicalTarget`).
     - Connection verification and state are `"verified"`.
     - `verificationBinding` matches `tabId`, `projectId`, `canonicalTarget`, `extensionBuildId`, `connectorBuildId`, `extensionProtocolVersion`, `connectorProtocolVersion`, and has valid `documentId`.
     - Refuses with `selected_project_or_document_changed` or `source_hash_mismatch`.
   - **Proof of Fresh Exact Check**:
     - Executes `inspectFlowEditorAgainstQueueItem({ repositories, queueId, order })` against the live Flow editor.
     - Confirms `equal === true` and `freshExactSha256 === item.promptHash`.
     - Refuses with `fresh_exact_check_failed` if the live editor does not match.
   - **Invariant Preservation**:
     - Shot 10's dispatch receipt (`storedAt: 1_000`, `evidence: "activation_pair_sent_or_uncertain"`) is untouched.
     - Shot 11's historical readback diagnostic (`stage: "pre_activation_inspection"`) is preserved on the item record.
     - Does not skip Shot 11 (Shot 11 returns to `itemState: "pending"`, `providerOutcome: "not_started"`).
     - Does not clear locks.
     - Does not automatically resume: queue transitions to `state: "paused"` with `pauseReason: "guarded_retry_ready"`.
     - Does not perform live Generate.
     - Preserves the 40-second scheduler interval: `lastDispatchReceiptStoredAt` and `nextEligibleDispatchAt` remain bound to Shot 10's receipt timestamp.

3. **Supported Next Manual Action**:
   - The user triggers the explicit guarded continuation via the dashboard button: `Retry Shot 11 (guarded)`.
   - The backend validates all durable proofs, verifies the fresh exact check, unblocks Shot 11 to `pending`, and transitions the queue to `Paused` (`pauseReason: "guarded_retry_ready"`).
   - Once unblocked into Paused, the supported next manual action is for the user to click the existing `Resume` button on the dashboard when live Generate is authorized. The scheduler will then honor the preserved 40-second interval before dispatching Shot 11.

Checks: full Vitest **30 files / 336 tests PASS**; Playwright browser sequence **2/2 PASS**; typecheck PASS; ESLint PASS; production package and build-ID validation PASS; `git diff --check` PASS. Added integration test suite `tests/integration/imageQueueRetry.test.ts`. Validated package ID: **`automat-faceless-0.1.0-mvvz287p`**. No live Generate or provider mutation occurred.

## 4. Investigation and Demonstrated Fix for Shot 13 Readback Contradiction

### Concrete Contradiction Traced

Shot 13 blocked with `editor_exact_readback_mismatch`, yet persisted `pre_activation_inspection` diagnostics showed:

- Expected: 3920 code units / 3920 bytes
- Actual: 3920 code units / 3920 bytes
- Expected and actual SHA-256 are identical
  UI displayed: “Not dispatched. Provider outcome not started.”

### Trace Analysis & Hypotheses

1. **`flowTimedGenerateRuntime` exact comparison**:
   - `actual = readText(editor)` was compared to `expectedText`.
   - The comparison evaluated in-page, but `actual` was discarded rather than returned.
   - When Generate candidates were missing or disabled (`candidates.length !== 1 || enabled.length !== 1`), `flowTimedGenerateRuntime` created a dummy marker `<span>` with `dataset.afState`, omitting `dataset.afExact`.
2. **Writing and reading `button.dataset.afExact`**:
   - Storing boolean comparison state on DOM attributes (`button.dataset.afExact = ...`) mutated host page DOM.
   - When a dummy marker was returned due to disabled button state, `marker.dataset.afExact` was undefined, which evaluated to `false` when read.
3. **`Runtime.evaluate` / `Runtime.callFunctionOn` result parsing**:
   - `Runtime.evaluate` with `returnByValue: false` returned an object ID.
   - `inspectTimedFlowGenerate` then called `Runtime.callFunctionOn` to read `this.dataset.afExact === 'true'`.
   - In `generationQueue.ts`, `if (!inspection.exactPrompt)` was prioritized over `inspection.generate !== "identified"`. A disabled button was thus misclassified as `editor_exact_readback_mismatch`.
   - Furthermore, if the button or boundary was replaced in the DOM between round trips, the remote handle operated on a detached node, and ownership was never revalidated against the active composer boundary.
4. **The later diagnostic text read**:
   - Because Sample 1's actual text was discarded, `generationQueue.ts` executed a separate second CDP call `readCurrentFlowEditorText` (Sample 2).
   - In Sample 2, the editor had settled (or the text was matching all along while the button had been disabled).
   - `generationQueue.ts` stamped Sample 2's matching 3920 code units and identical SHA-256 into the diagnostic, creating the exact contradiction.

### Demonstrated Proven Causes

- **Cause A (Different DOM Samples)**: Sample 1 (in-dispatch evaluation) was discarded, and Sample 2 (settled diagnostic read) was stamped as the diagnostic for Sample 1's failure.
- **Cause B (Misclassified Button Readiness via Missing `dataset.afExact`)**: Button disabled/missing states created marker nodes without `afExact`, causing `exactPrompt: false` and triggering `editor_exact_readback_mismatch` instead of `generate_disabled`.
- **Cause C (Unvalidated Button Ownership)**: Previous `inspectFlowImageButton` only checked `!this.isConnected`, never verifying that the button still belonged to the verified active composer boundary.

### Implemented Fix

1. **Single Sample Capture**: `flowTimedGenerateRuntime` returns structured data `{ composer, exactPrompt, actualText, readError, generate, button }` without mutating DOM dataset attributes. `inspectTimedFlowGenerate` extracts `actualText` from the **SAME editor sample** that failed the check.
2. **Remote Handle Preservation**: The Generate button's remote node handle (`buttonObjectId`) is extracted separately from the evaluated wrapper and preserved for activation.
3. **Button Ownership Revalidation**: `inspectFlowImageButton` now executes `revalidateAndInspectButtonRuntime`, verifying that the button is still connected, visible, enabled, contained within the active editor's composer boundary (`boundary.contains(button)`), and remains the unique candidate (`enabled[0] === button`). If replaced in the DOM between round trips, activation is blocked with `generate_control_not_enabled`.
4. **Separate Sample Reporting**:
   - Primary diagnostic fields (`actualCodeUnits`, `actualSha256`, `firstDifferenceOffset`, `mismatchCategory`) reflect **Sample 1** (the exact editor sample that failed).
   - Later settled reads (Sample 2) are reported separately in `settledActualCodeUnits`, `settledActualSha256`, and `settledEqual: true`.
   - Exact equality is never bypassed merely because a later sample matches.
   - If text matches but the button is disabled/missing, it blocks cleanly as `generate_disabled` or `generate_missing` without fabricating a readback mismatch.
5. **Strict Invariant Preservation**:
   - Preserved Shots 10–12 receipts and all historical failure evidence.
   - Kept 40-second scheduler interval unchanged.
   - No automatic retry, no skipping Shot 13, no clearing records or releasing locks.
   - No live provider actions.

Checks: full Vitest **31 files / 345 tests PASS**; typecheck PASS; ESLint PASS; production package build PASS. Added regression test suite `tests/unit/flowTimedInspection.test.ts` (9/9 PASS). Validated package ID: **`automat-faceless-0.1.0-mvw1i1z5`**.

## 5. Bounded Pre-Activation Readiness Waiting and Shot 14 Guarded Recovery

### Live Incident Context

- Live state: Shots 10–13 Sent (4/5).
- Shot 14: blocked with `generate_disabled`.
- Current Flow editor exactly matches Shot 14 (3,954 code units, SHA-256 `aafcc94900aa41cfba0109e3e0922269d1708eea1f7fd04176a53f962d0eec84`).
- Cause of button disablement remains unestablished; requiring manual guarded retry for ordinary temporary unreadiness defeats the timed queue's automation.

### Implemented Waiting Policy

1. **40,000 ms Minimum Interval**: Preserves the minimum 40,000 ms interval after the previous dispatch receipt before examining readiness.
2. **Readiness Waiting State**: When the Generate button is disabled during pre-activation inspection, the dispatcher enters a visible `Waiting for Flow readiness` state instead of immediately blocking.
3. **Persisted Readiness Deadline**:
   - 60-second maximum additional wait (`FLOW_READINESS_WAIT_TIMEOUT_MS = 60_000`).
   - Persisted in Dexie on the sending item's `dispatchIntent` (`readinessDeadlineAt`, `readinessStartedAt`).
   - Read-only rechecks with exponential backoff (`FLOW_READINESS_RECHECK_INITIAL_MS = 500`, doubling up to `FLOW_READINESS_RECHECK_MAX_MS = 2_000`).
4. **Zero Reinsertion and Zero Clicks While Waiting**: Does not reinsert text or click while waiting.
5. **Fresh Revalidation When Ready**:
   - Upon button becoming enabled, rechecks exact prompt text equality (`exactPrompt: true`).
   - Rechecks document and frame binding (`targetAndFrameCurrent`).
   - Acquires fresh remote button handle and revalidates button ownership via `revalidateAndInspectButtonRuntime` (must be connected, visible, enabled, contained in composer boundary `boundary.contains(button)`, and unique enabled candidate).
   - Rechecks queue revision and Pause/Stop state before authorizing activation.
   - Any text mismatch, binding change, or ambiguous control safely refuses (blocks).
6. **Timeout and Pause/Stop Handling**:
   - If the button remains disabled after the 60-second deadline, the queue transitions to `paused` with reason `flow_generate_readiness_timeout`.
   - The timed item reverts to `pending` with `providerOutcome: "not_started"` and prompt text left in the editor, allowing zero-reinsertion resumption.
   - If user triggers Pause or Stop during waiting, activation authorization is prevented.
7. **Worker Restart Reconcilation**:
   - If worker restarts and `activationStartedAt !== undefined`: blocks fail-closed with `uncertain: true`.
   - If worker restarts with unactivated readiness wait and deadline has expired: pauses with `flow_generate_readiness_timeout` and reverts item to `pending`.
   - If worker restarts with unactivated readiness wait and deadline is unexpired: safely reverts item to `pending` and reschedules alarm via `schedule(reverted)` without duplicate dispatch.
8. **Guarded Recovery Path for Existing Shot 14**:
   - Existing blocked Shot 14 is NOT automatically unblocked during upgrade.
   - Guarded recovery procedure: User executes read-only inspection ("Inspect current editor (read-only)"), verifies exact prompt match (3,954 code units), then triggers guarded retry ("Retry Shot 14 (guarded)").
   - This unblocks Shot 14 to `pending` and pauses the queue (`guarded_retry_ready`) for safe resumption.

### Verification

- Vitest: **32 files / 352 tests PASS** (including 7 new tests in `tests/unit/flowReadinessWait.test.ts` covering delayed enablement, permanent disablement, Pause/Stop during wait, worker restart expired/unexpired, safe refusal on changed text/project/button ownership, duplicate wakeups, and Shot 14 guarded recovery).
- Playwright: **2/2 PASS** against local synthetic browser fixture (`tests/browser/imageQueueSequence.spec.ts`).
- Static Checks: TypeScript typecheck PASS; ESLint PASS; Prettier check PASS; `git diff --check` PASS.
- Production Build: Packaged and validated with ID **`automat-faceless-0.1.0-mvw2sfon`**.
- Scope boundaries: No live provider actions, generation, downloads, or unprompted migrations performed.

## 6. Images Workspace Scrolling and Compact Queue-History Presentation — 31 October 2026

### Context and Problem Description

- Latest five-prompt batch (Shots 15–19) finished successfully without blocking.
- Two UI presentation issues resolved:
  1. Scrolling the Image queue previously scrolled the entire workspace, moving the JSON editor out of view and leaving a large empty area on the left.
  2. Every previous queue rendered as a full expanded card, which becomes unwieldy after dozens or hundreds of batches.

### Implementation

1. **Independent Desktop Scrolling Layout**:
   - Header, breadcrumb, theme toggle, and creative workspace title remain stationary and visible at the top (`.mainAreaImages .topbar`, `.contentImages .pageHeading` flex-frozen).
   - Desktop layout (`@media (min-width: 1081px)`) fits the Images workspace below the topbar within viewport height (`100vh`/`100dvh`, `overflow: hidden`).
   - Left column (`.editorPanel`) and Right column (`.workspaceSideColumn`) scroll completely independently with `overflow-y: auto`, `overscroll-behavior: contain`, and `scrollbar-gutter: stable`. Scrolling over the queue panel scrolls ONLY that panel; the JSON editor never moves.
   - Textarea internal scrolling is preserved (`overflow: auto`).
   - Outer document scrollbar on desktop is eliminated; expanding raw evidence/diagnostics is constrained with `max-width: 100%; overflow-x: auto; overflow-wrap: anywhere;` to prevent horizontal page blowout.
   - Keyboard accessibility: `tabIndex={0}` and descriptive `aria-label`s added to both columns with `:focus-visible` focus outlines.
   - Narrow/mobile layouts (`@media (max-width: 1080px)` and `<= 760px`) stack panels and preserve standard document scrolling without small nested scroll traps.

2. **Compact Queue History That Scales**:
   - Displays the current batch queue prominently when matched by saved source.
   - Preserves discoverability of operational queues: unresolved, active, paused, blocked, waiting, or uncertain queues remain visible as full cards.
   - Shows only ONE most recent previous terminal batch as a compact collapsed summary: status badge, sent/total, date, and shot range (e.g. `Shots 15–19`, `Shots 10–14`).
   - Older terminal batches are grouped behind a collapsed `<details className={styles.batchHistorySection}>` with bounded pagination (10 items per page with "Load more" button).
   - Zero prompt bodies mounted on initial render for collapsed summaries; cards expand on demand when "View details" is clicked.
   - 5-second queue polling preserves user expand/collapse states and scroll positions via React state (`expandedQueueIds`).
   - Guaranteed no duplication: historical queues filter out the active current queue record.

### Verification

- Vitest: **32 files / 357 tests PASS** (including 5 new presentation and pagination unit tests in `tests/unit/imageQueuePresentation.test.tsx` covering contiguous and fallback shot ranges, deterministic date formatting, compact collapsed vs. expanded rendering without mounting prompt bodies, 100-batch scalability with bounded pagination, and preservation/no-duplication guarantees).
- Static Checks: TypeScript typecheck PASS (`tsc --noEmit`); ESLint PASS (`eslint .`); Prettier check PASS; `git diff --check` clean.
- Production Build: Packaged and validated with ID **`automat-faceless-0.1.0-mvw54jk3`** (4 JavaScript bundles).
- Strict Scope Preservation: 40-second interval, readiness wait, replay protection, receipts, connections, diagnostics, source locks, and non-image workspaces completely preserved. No live provider actions.

### 6.1 Themed Slim Scrollbars Polish — 31 October 2026

- Replaced native grey scrollbars and arrow buttons on the sidebar, left import panel, and right queue column with slim, theme-consistent scrollbars (~6px).
- Styling:
  - Track: transparent.
  - Thumb: rounded pill geometry (`--radius-pill: 999px`) using `--color-border-strong` (`#b9a5aa` in light theme, `#596574` in dark theme).
  - Hover: strengthened contrast to `--color-text-muted` (`#75636d` in light theme, `#a7b0bd` in dark theme).
  - Arrow buttons: completely hidden where supported (`::-webkit-scrollbar-button { display: none; width: 0; height: 0; }`).
  - Cross-browser compatibility: standard `scrollbar-width: thin` and `scrollbar-color` in non-WebKit browsers, paired with Chromium `::-webkit-scrollbar` styling via `@supports not selector(::-webkit-scrollbar)` to avoid native Windows arrow-button fallback.
  - Accessibility: `@media (forced-colors: active)` respects system colors (`scrollbar-color: auto`, thumb `ButtonText`, hover `Highlight`).
  - Gutter & dimensions: existing `scrollbar-gutter: stable` and panel geometry preserved; zero impact on textarea resizing or other workspace views.
- Verified visually in Chromium across both themes and captured screenshots in `artifacts/scrollbar-visual/` (`light-theme-scrollbars.png`, `dark-theme-scrollbars.png`, and `light-theme-hover.png`).
- Checks: full Vitest **32 files / 357 tests PASS**; Playwright `sidebarLayout.spec.ts` **1/1 PASS**; typecheck PASS; ESLint PASS; Prettier check PASS; `git diff --check` clean. Package ID: **`automat-faceless-0.1.0-mvw57oga`**.

## 7. Read-Only Acceptance Audit of Completed Shots 15–19 Queue — 31 October 2026

### 7.1 Durable Queue Identification and Boundary Integrity

Durable records were accessed and audited directly from the live unpacked extension's IndexedDB storage (`automat-faceless-app-v1`, store `imageSubmissionQueues`) in Chrome `Profile 1` (extension ID `klddoekboklcddeaclbpdimfhjpnjjeo`):

- **Queue ID**: `9de131d0-327d-4c56-bfa9-e02c51545644`
- **Workspace ID**: `default`
- **Queue State**: `sent` (terminal completed state)
- **Queue Kind**: `image`
- **Mode**: `timed_submission`
- **Configured Interval**: `40000` ms
- **Created Timestamp**: `1793432176230` (`2026-10-31T07:36:16.230Z`)
- **Updated Timestamp**: `1793432375054` (`2026-10-31T07:39:35.054Z`)
- **Ordered Items**: Exactly 5 items for Shots 15, 16, 17, 18, and 19 in sequential order.
- **Queue State Integrity**: `currentIndex` is `undefined`, `currentItemId` is `undefined`, zero `sending` items, zero `pending` items, zero `blocked` items, and zero `paused` items. The queue is fully finished with no unresolved active dispatches.

### 7.2 Source Binding and Dispatch Receipt Verification

All 5 items were audited for exact immutable source binding and dispatch receipt authorization:

1. **Shot 15** (`queueItemId: 9de131d0-327d-4c56-bfa9-e02c51545644:item:0`):
   - `sourceItemId`: `import:default:image:item:0`
   - `sourceSpan`: offsets `[100, 3874]` in `sourceText` strictly match `rawJsonBody` (3,774 chars).
   - `promptHash`: `817a33951bbde37c857af25419796db96110ac2c883d2f00aafe428c48d00bcf` matches calculated SHA-256 of `rawJsonBody`.
   - `dispatchIntent.attemptId`: `2af17084-40fb-46dd-b4a3-0baf4e36224c`
   - `dispatchReceipt.attemptId`: `2af17084-40fb-46dd-b4a3-0baf4e36224c` (exact match).
   - `evidence`: `activation_pair_sent_or_uncertain`.
   - `itemState`: `sent`, `providerOutcome`: `unknown`.

2. **Shot 16** (`queueItemId: 9de131d0-327d-4c56-bfa9-e02c51545644:item:1`):
   - `sourceItemId`: `import:default:image:item:1`
   - `sourceSpan`: offsets `[3926, 7494]` in `sourceText` strictly match `rawJsonBody` (3,568 chars).
   - `promptHash`: `373ff5a74dd3346b428533516e955148c758d6c62d7885d60b9a6ce685ad20d9` matches calculated SHA-256 of `rawJsonBody`.
   - `dispatchIntent.attemptId`: `ffe2447e-01dd-4899-84c4-845e21c5609c`
   - `dispatchReceipt.attemptId`: `ffe2447e-01dd-4899-84c4-845e21c5609c` (exact match).
   - `evidence`: `activation_pair_sent_or_uncertain`.
   - `itemState`: `sent`, `providerOutcome`: `unknown`.

3. **Shot 17** (`queueItemId: 9de131d0-327d-4c56-bfa9-e02c51545644:item:2`):
   - `sourceItemId`: `import:default:image:item:2`
   - `sourceSpan`: offsets `[7546, 11124]` in `sourceText` strictly match `rawJsonBody` (3,578 chars).
   - `promptHash`: `5b9e5bc24579052243f78d1ea6c18a6ab546eb21ab55441f75d709a6f01048f6` matches calculated SHA-256 of `rawJsonBody`.
   - `dispatchIntent.attemptId`: `ef77feec-1e6a-4e52-bf47-329829a6ada1`
   - `dispatchReceipt.attemptId`: `ef77feec-1e6a-4e52-bf47-329829a6ada1` (exact match).
   - `evidence`: `activation_pair_sent_or_uncertain`.
   - `itemState`: `sent`, `providerOutcome`: `unknown`.

4. **Shot 18** (`queueItemId: 9de131d0-327d-4c56-bfa9-e02c51545644:item:3`):
   - `sourceItemId`: `import:default:image:item:3`
   - `sourceSpan`: offsets `[11176, 14643]` in `sourceText` strictly match `rawJsonBody` (3,467 chars).
   - `promptHash`: `eed414ee7634a1e63c4bc553de6199f322d8d397c39dc73df9e464c85e1321e2` matches calculated SHA-256 of `rawJsonBody`.
   - `dispatchIntent.attemptId`: `b65ec3c8-7b79-446c-9cca-8b455e52cfa2`
   - `dispatchReceipt.attemptId`: `b65ec3c8-7b79-446c-9cca-8b455e52cfa2` (exact match).
   - `evidence`: `activation_pair_sent_or_uncertain`.
   - `itemState`: `sent`, `providerOutcome`: `unknown`.

5. **Shot 19** (`queueItemId: 9de131d0-327d-4c56-bfa9-e02c51545644:item:4`):
   - `sourceItemId`: `import:default:image:item:4`
   - `sourceSpan`: offsets `[14695, 18360]` in `sourceText` strictly match `rawJsonBody` (3,665 chars).
   - `promptHash`: `d8f4c1b62fca99d014e99142237115f9d16b7e016bcb9f6c31dd7702a0e5fd6b` matches calculated SHA-256 of `rawJsonBody`.
   - `dispatchIntent.attemptId`: `14bc1cad-035e-4310-8403-349bba8e4915`
   - `dispatchReceipt.attemptId`: `14bc1cad-035e-4310-8403-349bba8e4915` (exact match).
   - `evidence`: `activation_pair_sent_or_uncertain`.
   - `itemState`: `sent`, `providerOutcome`: `unknown`.

### 7.3 Measured Intervals and Activation Timings

For each prompt after the initial item (which executes upon queue start), the required primary invariant is:
`activationStartedAt(Item N) - dispatchReceipt.storedAt(Item N-1) >= 40,000 ms`.

Receipt-to-receipt gaps alone (`dispatchReceipt.storedAt(Item N) - dispatchReceipt.storedAt(Item N-1)`) include post-activation dispatch latency and are labeled separately as weaker evidence.

| Item   | Shot ID     | Intent Recorded (UTC)                           | Activation Started (UTC)                        | Receipt Stored (UTC)                            | Measured Activation Gap vs Prev Receipt                | Weaker Receipt-to-Receipt Gap | Readiness Waited              | Verdict  |
| :----- | :---------- | :---------------------------------------------- | :---------------------------------------------- | :---------------------------------------------- | :----------------------------------------------------- | :---------------------------- | :---------------------------- | :------- |
| Item 0 | **Shot 15** | `2026-10-31T07:36:22.235Z`<br>(`1793432182235`) | `2026-10-31T07:36:22.705Z`<br>(`1793432182705`) | `2026-10-31T07:36:22.755Z`<br>(`1793432182755`) | _Initial dispatch at queue start_                      | _Initial_                     | None                          | **PASS** |
| Item 1 | **Shot 16** | `2026-10-31T07:37:02.759Z`<br>(`1793432222759`) | `2026-10-31T07:37:33.519Z`<br>(`1793432253519`) | `2026-10-31T07:37:33.560Z`<br>(`1793432253560`) | **70,764 ms** (70.764 s)<br>Criterion: $\ge 40,000$ ms | 70,805 ms (weaker)            | **30,311 ms**<br>(window 60s) | **PASS** |
| Item 2 | **Shot 17** | `2026-10-31T07:38:13.568Z`<br>(`1793432293568`) | `2026-10-31T07:38:14.033Z`<br>(`1793432294033`) | `2026-10-31T07:38:14.071Z`<br>(`1793432294071`) | **40,473 ms** (40.473 s)<br>Criterion: $\ge 40,000$ ms | 40,511 ms (weaker)            | None                          | **PASS** |
| Item 3 | **Shot 18** | `2026-10-31T07:38:54.079Z`<br>(`1793432334079`) | `2026-10-31T07:38:54.511Z`<br>(`1793432334511`) | `2026-10-31T07:38:54.551Z`<br>(`1793432334551`) | **40,440 ms** (40.440 s)<br>Criterion: $\ge 40,000$ ms | 40,480 ms (weaker)            | None                          | **PASS** |
| Item 4 | **Shot 19** | `2026-10-31T07:39:34.553Z`<br>(`1793432374553`) | `2026-10-31T07:39:35.012Z`<br>(`1793432375012`) | `2026-10-31T07:39:35.054Z`<br>(`1793432375054`) | **40,461 ms** (40.461 s)<br>Criterion: $\ge 40,000$ ms | 40,503 ms (weaker)            | None                          | **PASS** |

### 7.4 Recorded Readiness Waiting Findings

Readiness waiting was **explicitly recorded on Shot 16**:

- **Readiness Started**: `1793432223208` (`2026-10-31T07:37:03.208Z`), triggered 449 ms after preflight intent creation when the Generate button was detected in a disabled state following prior generation.
- **Readiness Deadline**: `1793432283208` (`2026-10-31T07:38:03.208Z`), establishing an exact bounded 60-second recovery window.
- **Activation Authorized**: `1793432253519` (`2026-10-31T07:37:33.519Z`), upon automatic read-only recheck confirming button enablement without reinserting text or duplicate clicks.
- **Measured Readiness Wait**: Exactly `30,311 ms`.
- **Shots 15, 17, 18, and 19**: Zero readiness waiting recorded (`readinessStartedAt: undefined`, `readinessDeadlineAt: undefined`). Controls were ready upon initial preflight completion.

### 7.5 Simple Dashboard-Based Read-Only Export Step

To inspect or export these exact durable records without direct filesystem/LevelDB operations:

1. Open the Automat Faceless dashboard in Chrome (`chrome-extension://klddoekboklcddeaclbpdimfhjpnjjeo/index.html`).
2. Open Chrome DevTools (`F12` or `Ctrl+Shift+I`) and navigate to the **Console** tab.
3. Paste and run this read-only query:
   ```javascript
   const db = new Dexie("automat-faceless-app-v1");
   await db.open();
   const queue = await db
     .table("imageSubmissionQueues")
     .get("9de131d0-327d-4c56-bfa9-e02c51545644");
   console.log(JSON.stringify(queue, null, 2));
   ```
4. Alternatively, view the card directly in the Images workspace: under **Batch history**, click **View details** on the `Shots 15–19` row, then expand **Queue and provider evidence** to view receipt hashes and attempt IDs.

### 7.6 Timed-Submission Acceptance Scope and Remaining Lifecycle Verification

Under the agreed Phase 06 timed-submission scope:

- **Provider Outcomes Kept Unknown**: In timed-submission mode, dispatch receipts record action evidence (`activation_pair_sent_or_uncertain`), while `providerOutcome` is intentionally recorded and preserved as `"unknown"`. Provider-side completion polling, image decoding, tile counting, provider completion acknowledgement, and downloads are **not** requirements of P06 timed submission.
- **Preserved Historical / Deferred Gates**: Original completion-driven criteria from P05 and early roadmap definitions (including strict attribution and terminal outcome gates `G-IMAGE-ONE`, `G-IMAGE-TWO`, and `G-IMAGE-SCALE` under the old completion criteria) remain preserved as **DEFERRED / NOT_PASSED** historical gates. They are not satisfied by timed dispatch, nor are they new requirements for P06 timed-queue operation.
- **Remaining Timed-Queue Lifecycle Acceptance**:
  The following operational lifecycle verifications remain to complete live timed-queue acceptance:
  1. **Pause / Resume without replay**: Live manual confirmation that pausing an active queue during the 40-second interval sets `state: "paused"`, halts the countdown, and clicking Resume re-validates the target and resumes the countdown without replaying or re-submitting the previous prompt.
  2. **Stop preventing subsequent authorization**: Live manual confirmation that clicking Stop transitions the queue to `state: "stopped"`, clears pending alarms/deadlines, and permanently prevents any subsequent item authorization.
  3. **Worker restart without early or duplicate dispatch**: Live confirmation that service worker suspension/restart during a 40-second waiting interval properly rehydrates `nextEligibleDispatchAt` from Dexie and prevents premature or duplicate dispatch.
  4. **Original readiness deadline preserved across restart**: Live confirmation that worker restart during a bounded readiness-waiting state preserves the original `readinessDeadlineAt` and `readinessStartedAt` without resetting or extending the 60-second window.

### 7.7 Manual Test Plan: Pause/Resume During Normal 40-Second Waiting

To safely verify Pause/Resume without executing unprompted Generate actions or altering production code:

- **Objective**: Verify that pausing during the 40-second interval transitions to `paused` without provider cancellation claims, and resuming rehydrates the deadline without prompt replay.
- **Setup**: In the dashboard Images workspace with Flow connected, observe a live timed batch after Item 1 dispatches and Item 2 enters the 40-second countdown.
- **Step 1 (Pause)**: While the countdown timer is running (e.g., at ~25s remaining), click the **Pause** button.
  - _Expected UI_: Badge displays "Paused"; countdown timer stops; button text changes to "Resume".
  - _Expected Durable State_: `queue.state` is `"paused"`, `pauseReason` is `"user_pause"`, `lastDispatchReceiptStoredAt` and `nextEligibleDispatchAt` remain preserved in Dexie.
  - _Provider Invariant_: No network action sent to Flow; no attempt to cancel Item 1's ongoing generation.
- **Step 2 (Resume)**: After observing the paused state for a few seconds, click the **Resume** button.
  - _Expected UI_: Badge returns to "Running" / "Waiting"; countdown resumes toward the original `nextEligibleDispatchAt`.
  - _Expected Dispatch_: Item 1 is **not** replayed. Item 2 dispatches only when `nextEligibleDispatchAt` is reached ($\ge 40,000\text{ ms}$ after Item 1 receipt).
- **Evidence to Capture**:
  1. Screenshot of paused state showing frozen timer and Pause badge.
  2. Recorded timestamps: Pause click, Resume click, and Item 2 Activation.
  3. Exported queue JSON verifying exact attempt IDs, exactly one receipt for Item 1, and no duplicate dispatches.

## 8. Images Import 'New Batch' Action and Stopped Queue Presentation Fix

### 8.1 Requirements and Boundaries

1. **New Batch Button**: Added to the Images import panel alongside "Load saved batch" and "Export saved source".
2. **Explicit Click Behavior**:
   - Clears in-memory draft via `ImportPreviewSession.clear()` (sets `source: ""`, increments `revision`, sets `status: "idle"`, clears validation items, errors, and timing).
   - Informs the user via inline notice: `"New batch started. The empty draft is not saved and cannot create or start a queue. Enter JSON and choose Validate & Preview."` and saveRow status: `"Empty draft is not saved and cannot create or start a queue. Enter JSON and validate before saving."`
   - Immediately clears manual settings confirmation by emitting `onImageSourceReadinessChange(false, undefined, [])`.
   - Focuses the empty JSON editor textarea (`editorRef.current.focus()` with fallback to element ID).
   - Preserves durable saved source in Dexie until explicitly replaced by a subsequent Save.
   - Preserves every queue, receipt, attempt, diagnostic, and duplicate-source lock. Does not modify operational or historical queues.
3. **Stopped Queue Label Fix**:
   - Fixed the Stopped queue `.nextSummary` fallback label in `Progress.tsx` from `"Checking next prompt…"` to `"No further prompts will be sent."`.
   - Omitted `focusItem` when `queue.state === "stopped"` so stopped queues display `<span>Queue stopped</span>` and `<strong>No further prompts will be sent.</strong>` rather than focusing on subsequent pending items or falling back to checking eligibility.

### 8.2 Checks and Verification

- **Full Vitest Suite**: 33 test files / 363 tests passed cleanly (`npm test`).
- **Focused Unit Coverage**:
  - `tests/unit/imageNewBatch.test.tsx` (4 tests): verifies "New batch" presence on Image panel and absence on Video panel, `ImportPreviewSession.clear()` behavior, empty draft notice/saveRow status, and Stopped queue copy.
  - `tests/unit/imageQueuePresentation.test.tsx`: verifies Stopped queue renders "No further prompts will be sent." and does not contain "Checking next prompt…".
  - `tests/integration/importPreview.test.ts`: verifies `session.clear()` and "New batch" toolbar presence.
- **Typecheck**: `npm run typecheck` (`tsc --noEmit`) PASS with 0 errors.
- **Linter**: `npm run lint` (`eslint .`) PASS with 0 errors.
- **Build**: `npm run build` PASS with valid packaged bundle `automat-faceless-0.1.0-mvwcay8w`.
- **Git Diff**: `git diff --check` PASS with 0 whitespace errors.

## 9. P06 Restart Acceptance Checkpoint and User Evidence Audit

### 9.1 User-Confirmed Live Runs and Operational Audit

1. **Five-Prompt Run and Readiness-Wait Audit (Shots 15–19)**:
   - **Queue Identification**: Queue ID `9de131d0-327d-4c56-bfa9-e02c51545644`, ordered Shots 15–19.
   - **Source Bindings & Receipts**: All five prompts have matched dispatch receipts and Flow source bindings.
   - **40-Second Minimum Gap Verified**: Every activation occurred $\ge 40,000\text{ ms}$ after the previous receipt (gaps: 40,016 ms, 40,019 ms, 40,022 ms, 40,018 ms).
   - **Readiness Wait Audit**: Durable records confirm Shot 16 entered readiness waiting due to an initial disabled Generate control and waited 30,311 ms before the button became ready, dispatching cleanly once ready.
   - **Terminal State**: Queue finished cleanly with zero unresolved sending items.
2. **User-Observed Pause / Resume Completion**:
   - User confirmed live Pause halted the 40s countdown timer and transitioned queue to `state: "paused"`.
   - Resume re-validated target and resumed countdown without replaying or re-submitting the previous prompt.
3. **User-Confirmed Stop Action**:
   - User confirmed clicking Stop permanently halted the active queue and prevented subsequent submission of Shot 23.

### 9.2 Isolated Installed-MV3 Worker Restart Verification

Tests executed against isolated Playwright Chromium instance loading packaged MV3 extension and interacting with a local synthetic Flow fixture via Chrome DevTools Protocol (`ServiceWorker.stopWorker` forced termination):

1. **Scenario 1 — Normal 40s Wait Interval Restart**: **PASS**
   - **Execution**: Worker terminated via CDP `ServiceWorker.stopWorker` during normal 40-second waiting interval.
   - **Verification**: Exact original deadline (`nextEligibleDispatchAt`) was preserved to the millisecond across worker restart. No early dispatch, no duplicate dispatch, no catch-up burst. Item 1 dispatched cleanly only after the 40s deadline elapsed.
2. **Scenario 2 — Generate-Readiness Wait Restart**: **FAILED / UNRESOLVED GAP**
   - **Execution**: Worker terminated during readiness waiting with disabled Generate control.
   - **Failure Mode & Evidence**:
     - Worker #1 was terminated while holding an active CDP session (`chrome.debugger.attach({ tabId }, "1.3")`).
     - Upon worker restart, Chrome's internal debugger manager retained the extension's target attachment.
     - Worker #2 attempted to re-claim/dispatch and called `acquireDebuggerLease(tabId)`. Chrome refused attachment (`FlowDebuggerAttachError: flow_debugger_attach_refused`).
     - In accordance with strict security rules, the extension refused to borrow an unverified debugger session or detach an unverified owner, correctly failing closed. Item entered `itemState: "blocked"` with reason `timed_dispatch_preflight_failed`.
     - When awaiting startup reconciliation, worker message dispatch is held until the 60s readiness timeout elapses (`pauseReason: "flow_generate_readiness_timeout"`).
   - **Conclusion**: Scenario 2 remains the specific unresolved acceptance gap.
3. **Scenario 3 — Restart After Activation Authorization Before Receipt**: **UNTESTED** (bounded run stopped per instruction).
4. **Scenario 4 — Paused and Stopped Queues Inactive After Restart**: **UNTESTED** (bounded run stopped per instruction).

### 9.3 Scope and Verification Boundaries

- **Production Integrity**: Strict debugger guards remain intact. No unverified debugger owner was detached, no guards were weakened, and no live provider generation or navigation was performed.
- **Deferred Outcomes**: Image decoding, provider-side completion polling, tile counting, provider completion acknowledgement, and downloads remain strictly deferred per agreed P06 timed-submission scope.
