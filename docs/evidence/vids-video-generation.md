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
- Target, document, attachment, prompt and enabled unique Generate control are checked again after durable intent and immediately before one click. A durable dispatch says �Generate sent�; it does not claim provider completion. Any existing intent/receipt prevents replay.
- No settings are opened/read/changed, image is not reuploaded/removed, and no timeline or other Vids controls are activated.

## Offline verification

- Focused Vitest: **2 files / 27 tests passed**.
- P10.2 production-function Chromium fixture: **3/3 passed**.
- Existing P10.1 Vids upload Chromium fixture: **4/4 passed**.
- Typecheck, ESLint, build and diff check passed.
- Build ID: `automat-faceless-0.1.0-mvzbf5c0`; output folder: `dist/`.
- Installed extension/live Vids state and live Generate: **NOT_RUN**. P10.3 remains not started.

Additional storage compatibility: Chromium migration harness **1/1 passed**. It upgraded seeded v9 IndexedDB data to schema v13 and verified the existing prepared record, saved reference, image queue, Flow video queue, and Flow attachment intent survived close/reopen; the new Vids generation table was available. Its offline Flow attachment simulation now identifies the production action injection rather than treating the earlier reference-byte acquisition as activation. This adjustment is test-only.
