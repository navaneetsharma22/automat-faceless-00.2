# Flow video prepared-batch / queue identity — 16 November 2026

## Finding

The screenshot is consistent with a source-level race in `FlowPreparedBatchReview`: prepared metadata and shot cards came from the current `preparedBatch` prop, while `videoQueue` was retained in component state until the new batch's asynchronous queue read settled. The Flow review was not keyed by `preparedBatch.id`, and a missing queue response was previously indistinguishable from a loaded empty queue. A prior 14-item Sent queue could therefore remain visible beside a new 15-item prepared snapshot during the transition. Live dashboard, extension build, and storage metadata were not available in this session; this is a reproduced source-level cause, not a live queue diagnosis.

## Identity trace

- `VideosView` sends `videoBatch.prepare` with a request ID. `ExtensionRepositories.prepareVideoBatch` persists the immutable prepared record at `prepared:${workspaceId}:${requestId}`. Repeating a request with the same request ID returns that same prepared record. Flow's normal Prepare uses a new UUID per user action; draft edits alone do not replace the prepared record or its queue.
- `createFlowVideoQueueHandler` derives queue key `flow-video:${preparedBatchId}`. `get` reads that key. `makeQueue` loads the prepared record by its exact ID and creates a queue from its ordered item IDs, canonical shot IDs, reference IDs, and prompt hashes. Existing dispatch intent and receipt lookup is scoped to `${preparedBatchId}:${itemId}` and generation binding checks compare the saved item/reference/prompt/target identity.
- The UI's metadata and cards are derived from the prepared record; queue counts, status, actions, and shot badges are derived from the queue. Previously the queue result was accepted without checking its `preparedBatchId`, key, item count, or ordered item bindings.

## Correction

Flow prepared review remounts on prepared-batch ID changes. Queue reads now have explicit loading, loaded, mismatch, and error states; older overlapping poll responses are ignored. Queue responses and action results are accepted only when the queue ID, prepared-batch ID, item count, order, stable item ID, canonical shot ID, reference ID, and prompt hash match the current prepared snapshot. While unresolved or mismatched, the UI shows that state and exposes no queue action. A truly missing queue becomes Ready only after its exact-key read completes. Startup prepared-batch hydration is ignored if a user has begun a newer Prepare request, preventing its delayed older result from replacing that newer result.

No queue records, receipts, attempts, IDs, or live data were changed. Queue identity, duplicate submission policy, action handlers, recovery rules, and dispatch timing remain unchanged.

## Verification

- Focused component regression: a delayed Sent response for a 14-item batch A cannot replace batch B's loading state or 15-item queue; B remains correct after remount. **PASS**.
- Production queue handler/repository regression: seeded A retains its original Sent receipts; new B reuses the first shot and item identities but receives a separate 15-item queue with zero Sent receipts; repeated B start reads remain idempotent. Mock Generate readiness remains disabled, so no dispatch is authorized by this test. **PASS**.
- Existing preparation idempotency regression remains included in the focused run. **PASS**.
- Focused run: `destinationPresentation`, `flowVideoQueue`, `videoBatchPreparation` — **3 files / 57 tests PASS**.
- `npm run typecheck` **PASS**; scoped ESLint on changed app and test files **PASS**; `git diff --check` **PASS**.
- Production build **PASS**, ID `automat-faceless-0.1.0-mwj9h85p` (existing large-chunk and ignored `inlineDynamicImports` advisories remain).
- Runtime/IndexedDB inspection and installed build identification: **NOT_RUN**. Browser native pipe was unavailable. No extension reload, live queue mutation, or live provider action occurred.
