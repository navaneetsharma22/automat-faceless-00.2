# P09.1 Flow video reference attachment

Date: 2 November 2026. Evidence scope: source review and offline DOM/resource fixtures. No live provider action was performed.

## Supplied Flow observations

The task supplied direct observations from the user's Flow project: the composer editor and Add ingredients button; checked Video/Ingredients versus Frames settings; an Asset list with option rows and thumbnails; gallery images with `data-media-id`; a detail preview outside the row; and a separate visible-text “Add to prompt” action without an aria-label. Gallery and picker thumbnail URLs matched in the inspected state. The task also supplied a prior chip example whose image URL is on `flow-content.google/image/<UUID>` with signed parameters. The supplied chip does not expose a verified relationship to the gallery media ID.

## Source correction

`src/platforms/flow/video.ts` now begins from the prepared item's pinned `referenceId`. It validates the stored record and saved-byte SHA-256, resolves a unique rendered gallery image by the stored `providerAssetId` when available (otherwise it uses bounded byte matching), and connects the gallery image to one picker row through exact observed URL equality. It handles a closed picker, selects the pinned row if the current preview differs, scopes the visible-text action to the unique list/detail common panel, and re-resolves binding, mode, candidate, preview, action and chips after asynchronous work before activation. It waits for a ready chip after at most one action and has per-document concurrent/uncertain re-entry guards.

Chip verification requires a caller-supplied, provider-verified `readChipMediaId` mapping plus explicit ready evidence (`aria-busy="false"` or `data-state="ready"`). The provided chip DOM has no confirmed media-ID mapping; signed URL equality is not used as identity. Therefore unsupported chip identity fails closed. The adapter is not wired to a production caller and is not exposed as an available feature.

## Runtime wiring review

No production caller or `flow.video.attachReference` message exists. `PreparedBatchReview` still states Provider Execution Unavailable, and the message schemas define only video-batch preparation/readback. The existing saved-reference route calls `getSavedReference`, backed by `ExtensionRepositories.getReferenceById`; candidate image capture has the existing same-origin `flowReferenceCaptureInPage` injection. These are reusable pieces, but no current handler composes them with a P09.1 document-bound binding check or chip identity reader. No speculative message, UI command or storage/attempt system was added. Runtime attachment remains unavailable until that integration and identity evidence exist.

## Offline verification

`tests/unit/flowVideoReference.test.ts` uses jsdom fixtures shaped from the supplied structure. Its test-only chip identity reader is an explicit mock and does not establish a provider selector or runtime mapping. The suite covers separate text action, wrong initial preview, pinned asset despite reordered duplicate-title rows, picker opening and selection, distinct picker/chip URLs with ID evidence, unsupported identity, duplicate/conflicting/busy/incomplete chips, delayed ready-chip observation, changed mode/candidate/document binding, pinned bytes and candidate hash mismatch, picker-closed idempotency, concurrent calls, uncertain re-entry, and no prompt/settings/Generate/queue action.

Results: focused Vitest **1 file / 9 tests PASS**; typecheck **PASS**; ESLint **PASS**; production build **PASS**, package ID `automat-faceless-0.1.0-mvyn9f1g` (4 JavaScript bundles; Vite emitted its existing `inlineDynamicImports`/code-splitting warning); `git diff --check` **PASS**. Fixtures and mocked bytes are offline evidence only.

## Remaining limits

- No production caller exists; runtime feature remains unavailable.
- No verified provider mapping connects the supplied signed chip URL to gallery `data-media-id`; the adapter refuses to claim attachment success without that evidence.
- No real reference bytes, live picker interaction or actual Flow chip were checked. Live attachment is **NOT_RUN** and G-FLOW-VIDEO remains **NOT_PASSED**.
- The in-module serialization guard is document-scoped and is not durable across worker restarts. It is not presented as a runtime recovery mechanism.

## P09.1 runtime wiring follow-up — 2 November 2026

The above source-review entry is historical and is superseded for runtime wiring by this follow-up. The caller is the per-item **Attach reference** button in `PreparedBatchReview`. The schema-validated `flow.video.attachReference` and `flow.video.getAttachmentStatus` requests route through `createConnectionMessageListener` to `createFlowVideoAttachmentHandler` in the background worker. It loads the prepared batch and item by ID, loads the exact pinned `referenceId` through `ExtensionRepositories.getReferenceById`, validates assignment metadata and saved-byte SHA-256, revalidates the selected Flow target and current project/document/build/protocol binding, obtains the gallery URL and `data-media-id` from an injection targeted to the selected document, and captures candidate bytes with the existing `flowReferenceCaptureInPage` same-origin bounded fetch before comparing hashes.

The page action is an isolated-world `chrome.scripting.executeScript` against that exact `documentId`. It requires Video + Ingredients, resolves the unique row by exact observed thumbnail URL, checks the detail preview, uses the separate visible-text Add to prompt action, performs at most one activation, and waits boundedly for one ready chip. Chip identity is read by `flowVideoChipMediaIdFromImageUrl`: HTTPS, exact `flow-content.google` host, exact `/image/<UUID>` pathname; the pathname UUID is compared to the dynamically discovered gallery media ID and signed query values are ignored. The supplied observation is retained at [Flow chip identity evidence](flow-video-chip-identity.md); it supports this identity rule for the inspected sample only.

Before activation, the worker writes a durable `flowVideoAttachmentOperations` record in IndexedDB. A previously unresolved intent is readback-only: a single exact ready chip can reconcile it to attached; otherwise the result stays uncertain and the action is not repeated. A verified completion remains idempotent. No prompt text, settings, Generate control, video queue, prepared JSON, or completion status is modified. Vids items do not expose the action.

Offline unit coverage was expanded with supported and rejected chip URL parser cases. Focused Vitest: `tests/unit/flowVideoReference.test.ts` **10/10 PASS**. The DOM tests remain fixture-based and their prior identity callback is mocked; they are not live compatibility evidence. Typecheck, full ESLint, and production build passed; package ID `automat-faceless-0.1.0-mvynvr68` (4 JavaScript bundles; existing Vite inlineDynamicImports/code-splitting warning). An initial sandbox Vitest launch failed with `spawn EPERM`; rerunning with the reviewed test command passed. Request-path integration coverage was added in the follow-up below. Live attachment remains **NOT_RUN**. G-FLOW-VIDEO remains **NOT_PASSED**.

## P09.1 request-to-handler integration verification — 2 November 2026

The previously missing offline request-to-handler integration coverage is now **COMPLETE**. `tests/integration/flowVideoReferenceAttachment.test.ts` calls the real `createFoundationClient`, production `AppRequestSchema` parsing, `createConnectionMessageListener` dispatcher, `createFlowVideoAttachmentHandler`, and `ExtensionRepositories` against an isolated transactional repository fixture. Only external tab and `chrome.scripting.executeScript` boundaries are simulated. The fixture asserts every injection targets the intended tab and exact document, candidate capture receives the inspected gallery URL, and durable `action_intent` is present before the simulated Add action.

Coverage includes structured success; malformed/missing requests, missing item and wrong destination; changed/unverified target and document; missing/corrupt saved pin and candidate hash mismatch; simulated chip identity rejection; concurrent claims; lost response; injection exception; recreating repositories/handler after uncertainty; exact attached readback; later Shot assignment preserving the prepared reference; and unchanged prepared prompt/queue state. Simulated page success is offline evidence only.

`tests/browser/flowVideoAttachmentStorage.spec.ts` also runs against actual Chromium IndexedDB. It opens a version-9 database with existing prepared batch, pinned media and queue records, upgrades through `AutomatDatabase` version 10, confirms those records survive, claims an intent through the production Dexie-backed `ExtensionRepositories`, closes/reopens the database, and verifies the intent remains. Its second path runs the production client/dispatcher/handler/repository against actual IndexedDB while simulating only the browser scripting boundary.

Results: focused Vitest **4 files / 40 tests PASS** (`flowVideoReferenceAttachment`, `videoBatchPreparation`, `flowVideoReference`, `messages`); Chromium IndexedDB test **1/1 PASS**; typecheck, full ESLint, production build **PASS** (package `automat-faceless-0.1.0-mvyofeth`, 4 JavaScript bundles; existing Vite inlineDynamicImports/code-splitting warning); `git diff --check` **PASS**. No live Flow action was performed. Live attachment remains **NOT_RUN** and G-FLOW-VIDEO remains **NOT_PASSED**.
