# P10.2 Google Vids exact prepared prompt and one-shot Generate

Date: 2 November 2026

Status: offline implementation verified. Live Vids generation: **NOT_RUN**.

## Isolation and identity checks

- The action is exposed only in `VidsPreparedBatchReview` and uses `vids.video.generateOnce` / `vids.video.getGenerationStatus` routes.
- The worker accepts only a prepared Vids batch and exact selected item. It rehashes the source JSON and item body, validates the item order and canonical Shot ID, then verifies the immutable pinned reference, saved bytes, existing Vids attachment operation and Vids target/document/manual confirmation.
- Current attachment proof includes the upload operation's exact-byte SHA plus a fresh hash of the retained file input in the unique active Animate panel; the loaded preview/removal control must also match pinned MIME, byte size, and dimensions. Preview appearance or dimensions alone do not identify a reference.
- A new `vidsVideoGenerationOperations` store holds Vids-only item-bound intent/dispatch state. Its atomic claim checks the exact current attached operation snapshot. Flow attachment operations, Flow generation fields and Flow queues are untouched.

## Prompt and activation

- Only the observed AI video clip sidebar's active Animate panel is considered; editor is `div[role=textbox][contenteditable=true][aria-label="Add your image, then describe what should happen in your video."]` and Generate is `button[aria-label="Generate"]`.
- The production reader serializes text nodes and observed block/BR boundaries. It does not use `textContent` alone (which drops block separators) or compare `innerText` bytes (Chromium can expose leading indentation as NBSP). The writer inserts the exact prepared string as text nodes and emits input events.
- Immediate and three stable settled reads must equal the full prepared string and hash. Existing exact text is accepted; conflicting content is left untouched.
- Target, document, attachment, prompt and enabled unique Generate control are checked again after durable intent and immediately before one click. A durable dispatch says ï¿½Generate sentï¿½; it does not claim provider completion. Any existing intent/receipt prevents replay.
- No settings are opened/read/changed, image is not reuploaded/removed, and no timeline or other Vids controls are activated.

## Offline verification

- Focused Vitest: **2 files / 27 tests passed**.
- P10.2 production-function Chromium fixture: **3/3 passed**.
- Existing P10.1 Vids upload Chromium fixture: **4/4 passed**.
- Typecheck, ESLint, build and diff check passed.
- Build ID: `automat-faceless-0.1.0-mvzbf5c0`; output folder: `dist/`.
- Installed extension/live Vids state and live Generate: **NOT_RUN**. P10.3 remains not started.

Additional storage compatibility: Chromium migration harness **1/1 passed**. It upgraded seeded v9 IndexedDB data to schema v13 and verified the existing prepared record, saved reference, image queue, Flow video queue, and Flow attachment intent survived close/reopen; the new Vids generation table was available. Its offline Flow attachment simulation now identifies the production action injection rather than treating the earlier reference-byte acquisition as activation. This adjustment is test-only.

## Live `reference_identity_proof_unavailable` failure follow-up - 2 November 2026

- Source producer was shared by prompt-entry and final activation proof. It conflated missing input/file selection with file-read/hash exceptions. These now have bounded reasons and the durable stage is `reference_proof`.
- P10.1 persists exact uploaded-byte SHA and target document evidence. P10.2 still requires current retained-file bytes to hash-match; preview presence/dimensions are not a replacement.
- A post-intent proof failure returns before Generate and is persisted blocked with `activationAttempted=false`, `activationCount=0`. Uncertain activation/replies remain no-replay. UI copy now accurately says Generate was not activated for blocked attempts.
- Installed browser/storage availability: no browsers or apps exposed; live operation **NOT_READ**. Extension reload, document change, and missing persisted proof were not established as the actual live cause. No recovery/rearm was introduced without the exact record.
- Offline focused Vitest 2 files / 28 tests, Chromium injection 5/5, typecheck, ESLint, build and diff check passed. Build `automat-faceless-0.1.0-mvzc5j6l`.

## P10.1 → P10.2 post-upload proof contract correction - 2 November 2026

P10.1 persists a pre-upload exact-file SHA-256 and an attached operation bound to the Vids document. Normal post-upload DOM may remove Add image/file input and leave a blob preview. P10.2 now hashes actual bytes fetched from that unique same-document blob URL, then requires exact pinned MIME, byte size and SHA-256. It repeats the proof immediately before Generate. A stale upload record or preview geometry alone cannot pass. Blob source/read/hash outcomes are retained as bounded proof provenance in the P10.2 operation.

Offline local Chromium reproduced upload then input/button removal; blob bytes passed when exact. A same-dimension, same-size transformed blob failed the SHA check. Focused Vitest 2 files / 29 passed; P10.1/P10.2 Chromium 11/11 passed; typecheck, lint, build and diff check passed. Build `automat-faceless-0.1.0-mvzch6zc`.

The installed Google Vids page's CSP and blob URL were not accessible here, so live blob access and live generation are NOT_RUN. The existing operation is NOT_READ; the Vids review now exposes a bounded copyable snapshot via its existing read-only status route. Do not rearm or retry an uncertain operation from the export alone. No operation or Flow state changed; P10.3 was not started.

## P10.2 `ai_sidebar_missing` scoped reader and pre-click recovery - 2 November 2026

The entry injection supports accessible names from `aria-label`, `aria-labelledby`, and `title`; final activation previously used only `aria-label`. The Chromium production injection now reproduces a labelled-by sidebar and confirms both stages resolve the same scoped Vids AI video clip / active Animate area. Discovery remains limited to that exact accessible name and unique composer/control.

For the supplied failure class only, an explicit recovery transition atomically compares the complete stored operation and attachment snapshots. It requires `blocked` / `generate_preflight` / `ai_sidebar_missing`, exact prompt readback, and `activationAttempted=false` plus `activationCount=0`; it also revalidates the prepared binding and current selected target/document. It preserves original attempt evidence on the same operation and moves it to `retry_ready`; no page injection or Generate occurs during recovery. A separate explicit Generate action is required. Changed snapshots and any uncertain/attempted activation remain unrecoverable.

The provided operation snapshot was not fetched from live browser storage (no browser/app surfaces available): live row remains **NOT_READ**. The existing Vids UI exposes a copyable current operation snapshot. Vitest 2 files / 31 passed; Chromium injection 9/9; typecheck, lint, build and diff check passed. Build `automat-faceless-0.1.0-mvzcubxn`. No live reconciliation or Generate; P10.3 not started.

## P10.3 isolated persisted Google Vids timed submission — 2 November 2026

Added an independent Vids queue record/table, Vids-only queue routes, background scheduler handler/alarm namespace, and controls in the Google Vids review. IndexedDB migration is additive schema v14 and keeps prior data. The queue owns each Vids prepared batch; both P10.1 attachment intent and P10.2 generation intent are transactionally rejected for per-Shot callers while an active Vids queue record exists. Queue-owned claims must match the persisted `preparing` or `checking_generate` stage. No Flow or Images queue source/timing changed.

At queue start, existing items are adopted as Sent only from a fully matching dispatched operation: workspace, prepared item/Shot, exact prompt hash, exact reference ID/hash, selected Vids target/tab/document, `activationAttempted=true`, `activationCount=1`, and persisted `dispatchedAt`. All other existing attempts fail closed. Sent items are skipped and retain their original operation/receipt. A confirmed receipt schedules the next pair at `dispatchedAt + 50,000 ms`; after the cooldown, the queue prepares the pair and opens a separate persisted 60-second Generate-readiness window. Disabled readiness causes a bounded repeat within the window; expiry pauses visibly. The queue does not inspect result history or wait for provider completion.

Pause and Stop clear future alarms but do not cancel an already-started provider request. Resume preserves the outstanding 50-second floor and any existing readiness deadline. Worker startup inspects the current persisted item/operation: exact durable dispatch is recorded as Sent; intent/uncertain/blocked activation is never replayed; an interrupted composer transition pauses for review. Calls are serialized by queue ID, queue transitions compare revisions, and duplicate Start/Resume requests cannot claim the same item twice.

For each item after the first dispatched item, the production Vids injection scopes itself to the unique AI video clip sidebar and active Animate panel. It proves the prior saved operation and uploaded reference binding in the worker, then rechecks the prior prompt’s exact body/hash and the current File or same-document preview blob’s exact SHA-256, MIME, bytes and dimensions. Only then does it use the unique Remove image control and clear only that exact prompt. If content differs, the transition leaves it untouched and pauses. When Animate is collapsed/missing, it leaves the document untouched and asks the user to open Animate in the same Vids target before explicit Resume; the queue repeats its identity check. It never uses a generic Clear control or modifies settings.

The Vids UI uses the shared Button and existing semantic tokens. It shows durable receipt progress, the next Shot/state, distinct cooldown/readiness clocks based on persisted deadlines, and the all-sent submission summary. Clock ticks only render; they issue no queue/attachment/Generate request. Success toast is tied to the observed durable all-sent transition and is absent on an already-finished remount. Sent copy never claims video completion. A scoped preview route renders only the immutable prepared reference after worker-side byte-hash validation.

Focused offline Vitest: **4 Vids files / 49 tests passed**; queue coverage includes durable Shot 1 adoption, exact 50-second dispatch boundary, 60-second readiness timeout, readiness and cooldown Pause/Resume, restart, duplicate Start, uncertain no-replay, pre-intent blocking, Vids-only route dispatch, atomic queue/per-Shot claim separation, and all queue-state presentation. Existing Flow/Images queue regressions: **5 files / 38 passed**. Chromium production injection and IndexedDB fixtures: **17/17 passed**, covering exact prior-content transition, conflicting/collapsed preservation, distinct second reference, long multiline prompt and one Generate; existing P10.1/P10.2 production injections; and v9 data migration through v14 while preserving existing references/queues and pending intent. Typecheck, ESLint, build and `git diff --check` passed. Final build `automat-faceless-0.1.0-mvze160o`; output `dist/`.

The queue was not run against installed Vids. The supplied Shot 1 screenshot is not a live storage read and was not adopted as a receipt. Installed queue/storage, composer transition, and live Generate remain **NOT_RUN**. P10.4 remains pending; no live reconciliation, queue Resume, or Generate occurred.

## P10.3 Shot 1 → Shot 2 composer conflict follow-up — 2 November 2026

The exact live comparator remains unconfirmed: browser inventory contained no browser/app surfaces, so the queue, durable Shot 1 receipt, Shot 2 operation, and live composer are **NOT_READ**. The former page producer returned the same `vids_previous_composer_content_conflict` for prompt text mismatch and for preview count/readiness/dimension mismatch before comparing image bytes. Source review found the P10.2 and transition sidebar/tab/panel accessible-name handling and multiline DIV/P/BR serializers aligned; the transition already supported an exact selected File or same-document preview-blob SHA after file-input removal. The previous worker did not compare every attachment batch/item/target field. It now verifies workspace, item/Shot, prompt/reference hashes, exact tab/target/document on the dispatched operation and attachment, and checks the prior queue receipt against that operation.

The existing paused pre-attachment failure now exposes a user-triggered **Inspect transition (read-only)** action. It returns bounded stage, expected/current prompt SHA, separate prompt text/hash comparisons, expected/current reference SHA, File/blob proof source/result, MIME/byte-size/dimensions, DOM scope counts, and worker operation/attachment/target/document booleans. It does not return URLs/blob data or persist/change the inspection result. It rejects any current-item attachment/generation attempt and leaves the queue, operation, previous Sent receipt, and provider page unchanged. Normal explicit Resume can expand only one visible `Expand` control scoped to the unique AI video clip sidebar and marked `aria-expanded=false`; expansion returns to the worker for target/document revalidation before a second injection repeats all ownership checks. It never activates Generate, result/timeline controls, or settings. Obsolete “uploads only” review copy was corrected.

Offline focused Vitest **5 files / 64 passed**. Chromium production injections **19/19 passed**, including full P10.1 exact upload with disappearing Add/input, P10.2 preview-blob proof/exact prompt/one Generate, retained Shot 1 ownership check, transition to a distinct Shot 2 prompt/reference, read-only mismatch diagnostics, conflicting-content preservation, and scoped Expand. Typecheck, lint, production build and `git diff --check` **PASS**; build `automat-faceless-0.1.0-mvzese3k`, output `dist/`. Live browser inspection, queue Resume, and Generate remain **NOT_RUN**; the historical comparison and current stored operation remain **NOT_READ**. Existing queue and Shot 1 receipt were not changed.

## P10.3 recurring previous-reference transition blocker — 2 November 2026

The queue source binds each transition to the immediately preceding Sent item and exact generation/attachment records. With file input absent, the injected reader hashes the current same-origin blob preview. Fresh connected-browser inventory was empty; current blob bytes/operation remain **NOT_READ**, so no specific live byte mismatch is asserted. Read-only diagnostics now expose expected/current reference ID (current ID only on unique prepared-byte match), hashes, MIME, size, proof source and stage without URL/token/blob data. The true mismatch remains blocked.

Cleanup now requires the exact prior prompt and reference proof before removing the unique scoped image and clearing only the prior prompt. It waits for empty editor, no preview, and returned Add image/file input. Queue state/run ownership is checked after read-only proof and immediately before mutation. Pre-Generate restart handling can resume cleanup, attached upload, or exact P10.2 prompt preflight only when no generation intent exists; uncertain attachment/generation remains non-replayable. Sent receipts and timing remain intact.

Vitest: **3 files / 44 tests PASS**. Chromium production injection: **8/8 PASS**, with three Shots, two transitions, distinct blob references/prompts, byte-mismatch block, cleanup interruption, and Pause/Stop gate. Typecheck, ESLint, production build and `git diff --check` **PASS**; build **`automat-faceless-0.1.0-mvzfgibv`**, output `dist/`. Live current SHA, operation read, Resume, and Generate are **NOT_RUN**.
