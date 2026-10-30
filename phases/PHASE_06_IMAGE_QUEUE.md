# P06 — Timed sequential image submission

Status: P06.1 and P06.2 are OFFLINE_VERIFIED within the bounds recorded below. P06.3–P06.4 are NOT_STARTED. This revised mode is independent of P05 count-mode observation and rebaseline. P05 remains INCOMPLETE; automatic provider attribution and terminal acceptance are deferred and NOT_PASSED.

**Outcome:** Persist an ordered batch and manually confirmed Flow project/settings declaration, then (in later subphases) dispatch one prompt at a time using a fixed 40,000 ms minimum interval measured from the preceding durable dispatch receipt. Generation completion is not observed by this mode. A sent dispatch is evidence of input delivery only; provider outcome remains unknown.

**Prerequisites:** P03 exact source import/storage and P04 guarded one-image dispatch foundations. P05 is not a prerequisite for this timed mode. Its original acceptance remains open as separate deferred history.

**Requirements:** Revised R07, R05, R06, R08, C01, C03, C04, C06, C07, C09, C11, C14.

## Revised subphases

### P06.1 — Persistent queue model and truthful dashboard
Evidence mode: **offline**. Status: **OFFLINE_VERIFIED** for the P06.1 storage/dashboard boundary only.

Planned and necessary paths:

- `src/domain/jobs/queue.ts`
- `src/storage/db.ts`
- `src/storage/repositories.ts`
- `src/shared/schemas.ts`, `src/shared/messages.ts`
- `src/background/handlers/connections.ts`
- `src/app/features/image-batch/Progress.tsx`
- Shared import panel/styles and focused repository/UI tests

Acceptance: A Dexie-persisted ordered image queue contains the exact full imported source, its hash, immutable item prompt bodies/hashes/shot IDs/spans/order, selected project binding, frozen user-attested manual settings declaration, and fixed 40,000 ms mode. Creation validates saved-source integrity, selected-target/settings agreement, historical same-source locks and queue duplicates in a read/write transaction with readback. Dashboard shows actual prompt rows and queue records, truthful empty/source-ready/progress states, dispatch-unavailable status, and provider outcome unknown after any future sent evidence. It never simulates a send, countdown, or completed image. P06.1 does not send provider input or start count observation.

### P06.2 — Guarded dispatch and durable 40-second scheduling
Evidence mode: **offline**. Status: **OFFLINE_VERIFIED** for the guarded timed dispatch and durable scheduling boundary. No live provider action or installed-extension MV3 smoke was run.

- One dispatch operation at a time, for the next ordered pending source only.
- Before dispatch, revalidate selected project/tab/document, exact saved source and hash, immutable source lock eligibility, and settled exact editor readback.
- Conflicting editor text, wrong target, failed persistence, or uncertain dispatch blocks/pauses the queue.
- Persist dispatch intent before a single Generate activation; preserve press/release evidence.
- Persist and read back a dispatch intent before editor input. Persist an activation-start marker before the activation pair, so an interrupted activation remains uncertain.
- After the activation pair returns local dispatch evidence, atomically store the receipt and `nextEligibleAt = durableReceiptRecordedAt + 40,000 ms`. Each receipt has its own deadline; the scheduler uses only that persisted value and never catches up against a global clock.
- Time passage never marks provider generation complete. No automatic Generate replay.

#### P06.2 offline evidence — 30 October 2026

The worker routes `imageQueue.start` through a single-dispatch scheduler. Queue claims, activation-start markers, receipts/deadlines, and blocks use Dexie transactions, readback validation, and monotonic revisions. Startup reschedules only durable waiting deadlines; unresolved Sending/intent records remain fail-closed. Chrome alarms wake the scheduler, which reloads queue state and enforces the stored deadline before a dispatch. The `alarms` permission is packaged.

The timed Flow handler rechecks the selected verified Flow project/tab/document and exact prompt source/hash. It acquires the existing Flow debugger lease for the whole operation, uses guarded prompt entry with exact immediate and settled readback, inspects only the owned composer and its uniquely enabled Generate control (no result baseline/count/observer), rechecks frame/document binding, writes activation-start intent, sends one activation pair, then persists a receipt. The result remains `unknown`. Pre-activation refusal is persisted as blocked with `not_started`; any post-activation uncertainty is blocked with `unknown`. Source locks remain in force across queue IDs and historical attempts.

Offline validation: focused queue/scheduler Vitest **2 files / 9 tests PASS**; full Vitest and full configured Chromium results are recorded in `PROJECT_STATUS.md`; the real-Dexie Chromium sequence used the production timed dispatcher and synthetic local CDP editor/Generate input. It verified exact ordered bodies, one activation each, first receipt durable before item two, no second dispatch at 39,999 ms, eligibility at 40,000 ms, duplicate/late alarm suppression, and outcomes remaining unknown. Chrome alarm and extension APIs were adapted in this local fixture; installed-MV3 behavior was **NOT_RUN**.

### P06.3 — Pause, restart, and uncertainty
Evidence mode: **offline**.

- Pause/Stop block future dispatches without claiming cancellation of a provider job already sent.
- Restart reads the durable item, receipt, deadline, queue state, and attempt lock. It cannot resend an uncertain or already-dispatched source.
- Persist item dispatch state separately from batch waiting/paused/blocked/stopped state.
- A dispatch receipt means action evidence; provider result remains `unknown`. No count-mode observer, recovery, or rebaseline is started.
- State transitions are explicit and monotonic except for a validated resume of a paused queue; stopped queues remain terminal.

### P06.4 — Controlled live acceptance and scale
Evidence mode: **authorized live-generation only**.

- Complete P06.2/P06.3 offline gates first.
- Controlled one-then-two timed submissions, then 5/10/15 scale only when explicitly authorized.
- Record each dispatch receipt, its persisted 40-second deadline, exact source identity, and any user-observed provider state separately. Do not call time-delayed submission completion or provider success.
- G-IMAGE-ONE, G-IMAGE-TWO, and G-IMAGE-SCALE remain NOT_PASSED until their specifically revised timed-action criteria are met. The original terminal-attribution criterion remains deferred and is not implied by these gates.

## Superseded/deferred original completion-driven acceptance — preserved history

The earlier P06 specification required the queue to advance only after the current prompt's durable provider completion, required item 1 to be stored complete before item 2 dispatch, and made P05 strict attribution a P06 prerequisite. Those requirements are **superseded for the newly authorized timed submission workflow**. They are retained here and in the prior roadmap/acceptance history as **NOT_PASSED / DEFERRED**, not erased or retroactively satisfied. P05's strict provider result identity, causal attribution, and terminal success/error acceptance remains incomplete.

The former P06 gate required G-IMAGE-TWO followed by G-IMAGE-SCALE (5/10/15) with correct output identities and no duplicates. That gate has not passed. Revised P06.4 will assess timed dispatch behavior independently and must not claim provider completion, G-IMAGE-ONE, G-IMAGE-TWO, or G-IMAGE-SCALE based on P06.1 storage or synthetic tests.

## Data and safety rules

- Queue items copy exact validated source bodies and hashes; a hash supplements exact equality and never replaces it.
- New queue/item IDs never bypass a blocking historical attempt for the same exact source hash. Existing attempt, snapshots, unknown outcomes, observations, immutable bindings, and source locks are preserved.
- New queues cannot be used to retry an existing uncertain/dispatched source. This phase adds no historical settlement, deletion, or lock release.
- The declared variant count records user-selected settings; it does not multiply Generate activations.
- Provider model/ratio selection remains manual. Only fields actually present in the settings confirmation are frozen; no unobserved model/ratio is invented.
- Fixed 40 seconds is the minimum delay between durable dispatch receipts, not an estimate of generation duration.
- Timed mode uses only its separate queue state. Count mode, countDecision, observation sessions and rebaseline remain governed by P05/recovery guards.

## Phase gate

P06.1 and P06.2 offline acceptance establish the persisted foundation and synthetic guarded dispatch/scheduler behavior only. P06.3 and the authorized P06.4 gate remain open. No G-IMAGE live gate is claimed passed by this card's status update.
