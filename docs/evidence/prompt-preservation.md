# P03.4 Prompt Preservation Evidence

Date: 28 October 2026  
Evidence levels: **OFFLINE_VERIFIED** for importer, schemas, repository methods, worker handler, JSON-cloned messaging, and mocked transactional storage; partial packaged dashboard checks are **USER_REPORTED_PASS** for the stated synthetic samples below. Independent browser observation and worker-restart recovery are not established.
Shared production build ID: `automat-faceless-0.1.0-mvrutblo`.

## Implemented path

The dashboard saves only the current successful import revision. It sends `workspaceId`, `kind`, and the exact source string over an extension-internal `promptBatch.put` request. Loading is explicit; a nonempty unsaved draft requires confirmation before replacement. The dashboard rejects a late load if its source revision changed while waiting.

The worker request handler accepts the operation only from the exact packaged dashboard URL and checks request shape, protocol, build, request ID, kind, and workspace. The worker invokes the same pure importer again. The repository validates the centralized policy, then saves one batch plus all ordered prompt items in a read/write transaction across the `batches` and `promptItems` tables. The database upgrade to version 2 adds the item table without clearing existing records.

The saved batch keeps the exact source, kind, workspace, input mode, order, total measurements, and item IDs. Items keep exact body strings, canonical shot IDs and identity source, order, source spans measured in JavaScript string offsets, UTF-16 code-unit/UTF-8-byte measurements, and supplemental SHA-256 hashes. Readback validates the complete records, reimports the retained source, and compares every body and metadata value, including each hash. Tests also compare raw strings directly; the digest does not replace string equality.

The request and record schemas use the centralized provisional limits: 1,500,000 code units / 2,000,000 UTF-8 bytes per prompt; 5,000,000 code units / 10,000,000 bytes for the source and batch; 50 prompts; and depth 128. The exact total-byte schema boundary and over-limit rejection are tested. The historical 12,000-character assumption is not used.

## Preservation coverage

- Both image and video: all eight synthetic 10k/25k/50k/100k fixtures passed exact import, schema, repository, handler, JSON-cloned message, and readback comparisons.
- Both image and video: the historical synthetic body of 1,260,163 JavaScript code units / 1,652,165 UTF-8 bytes passed exact save/readback.
- Both kinds: top-level array, numbered complete blocks, and schemaVersion 1 envelope preserved raw body slices, order, IDs, and source offsets.
- Fixtures include LF and CRLF, decimal arrays, nested objects/arrays, escaped quotes/backslashes, Hindi, and emoji.
- Failure checks cover invalid whole input, policy overflow, unauthorized page sender, unavailable message transport, corrupted storage data, and partial item-table write. Failed replacement keeps the previous valid batch.
- UI markup checks confirm a stale validation cannot enable Save and the current validation exposes save/load actions. A load never silently replaces a nonempty unsaved source.

Focused checks: **4 files / 38 tests PASS**. Full suite: **12 files / 119 tests PASS**. Typecheck, lint, changed-file Prettier, production build, manifest equality, build-ID consistency, and `git diff --check` are recorded in the P03.4 section of the phase card and project status.

## Evidence limits and browser check

The handler, schemas, importer, and repository methods are real project source. Tests serialize requests/responses with `JSON.stringify` / `JSON.parse` and use an in-memory table adapter that simulates transaction rollback. They do not execute Chrome runtime messaging, Chrome IndexedDB, dashboard persistence across a browser restart, or actual browser message-size limits.

Manual packaged retest:

1. Load the built extension and open its packaged dashboard.
2. In Images, paste a known JSON source with line breaks and Unicode, choose **Validate & Preview**, then **Save validated batch**.
3. Close and reopen the dashboard. Choose **Load saved batch** and compare the complete editor text directly with the original source.
4. Repeat independently in Videos, then make a nonempty unsaved edit and confirm the load action asks before replacing it.
5. Repeat the save/reopen/readback with a long CRLF fixture.

Keep any remaining check within the extension dashboard. No provider prompt field, settings change, refresh, pairing, generation, OAuth, or download is involved. P00.2 real production samples remain **EVIDENCE_PENDING**; synthetic fixtures do not close that gate.

## User-reported browser result and lifecycle regression

### Offline automated evidence

The offline source, schema, worker-handler, repository, JSON-cloned message, exact-string comparison, and transactional-adapter results above remain **OFFLINE_VERIFIED**. They do not establish browser behavior.

### Screenshot observations

**SCREENSHOT_EVIDENCE:** The supplied screenshot shows Flow and Vids as Connected and shows a loaded video preview. A screenshot establishes only those visible states; it does not establish exact character-for-character equality of the loaded source.

### USER_REPORTED_PASS browser checks

The user reports testing synthetic samples in the packaged browser dashboard:

- Image JSON: **15,889 JavaScript code units**; save, dashboard reopen, and load passed.
- Video JSON: **17,935 JavaScript code units**; save, dashboard reopen, and load passed.
- The saved image and video batches remained separate.
- Loading both batches in the latest check did not disconnect Flow or Vids.

These are **USER_REPORTED_PASS**, separate from offline automated evidence and screenshot observations; they were not independently observed in this session. No UTF-8 byte counts, browser version, or build ID were reported. These are user-tested synthetic samples, not P00.2 production samples. The report does not establish worker-restart recovery, an unsaved-draft replacement check, or the long-CRLF packaged check. Worker-restart recovery remains unverified.

The focused lifecycle regression checks that image/video save/load operations leave the previously selected Flow and Vids target records and reconnect intent unchanged. `ConnectionStatus` remains mounted in the dashboard sidebar while workspace panels switch, and batch APIs do not mutate selected-target state. The reported latest browser check says loading both batches did not disconnect Flow or Vids; it does not verify worker-restart recovery. See [connection proof](connection-proof.md) for the lifecycle cause and implementation evidence.
