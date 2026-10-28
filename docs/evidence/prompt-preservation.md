# P03.4 Prompt Preservation Evidence

Date: 28 October 2026  
Evidence level: **OFFLINE_VERIFIED** for importer, schemas, repository methods, worker handler, JSON-cloned messaging, and mocked transactional storage. Browser durability and packaged dashboard interaction are **NOT_RUN**.
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

## Evidence limits and manual check

The handler, schemas, importer, and repository methods are real project source. Tests serialize requests/responses with `JSON.stringify` / `JSON.parse` and use an in-memory table adapter that simulates transaction rollback. They do not execute Chrome runtime messaging, Chrome IndexedDB, dashboard persistence across a browser restart, or actual browser message-size limits. No browser or app surface was available in the computer-use inventory; packaged save, dashboard reopen, and UI readback are **NOT_RUN**.

Manual packaged retest:

1. Load the built extension and open its packaged dashboard.
2. In Images, paste a known JSON source with line breaks and Unicode, choose **Validate & Preview**, then **Save validated batch**.
3. Close and reopen the dashboard. Choose **Load saved batch** and compare the complete editor text directly with the original source.
4. Repeat independently in Videos, then make a nonempty unsaved edit and confirm the load action asks before replacing it.
5. Repeat the save/reopen/readback with a long CRLF fixture.

Keep this check within the extension dashboard. No provider page, prompt field, settings, refresh, pairing, generation, OAuth, or download is involved. P00.2 real production samples remain **EVIDENCE_PENDING**; synthetic fixtures do not close that gate. Phase 03 remains **INCOMPLETE**.

## User-reported browser result and lifecycle regression

**USER_REPORTED_PASS:** The user reported successful image and video batch save, dashboard reopen, and load, with image and video data remaining separate. These are user-reported observations and are not independently automated or observed in this session. The report is separate from the offline message/repository tests above.

The focused lifecycle regression checks that image/video save/load operations leave the previously selected Flow and Vids target records and reconnect intent unchanged. `ConnectionStatus` remains mounted in the dashboard sidebar while workspace panels switch, and batch APIs do not mutate selected-target state. Independent packaged browser verification of durability and connection recovery after worker restart/reopen is **NOT_RUN** because no browser surface was available. See [connection proof](connection-proof.md) for the lifecycle cause and implementation evidence.
