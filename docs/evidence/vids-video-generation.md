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
