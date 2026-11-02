# P10.1 — Google Vids exact prepared-reference attachment

**Status:** Offline implementation and tests complete. Installed-browser/live Google Vids verification **NOT_RUN**.

## Isolation

- Composer and upload injection live under `src/platforms/vids/`.
- The dashboard routes Vids batches to `VidsPreparedBatchReview`; Flow review is separate and has no Vids requests or UI controls.
- Worker entry points are `vids.video.attachReference` and `vids.video.getAttachmentStatus`. They call only the Vids attachment handler.
- Durable records use the dedicated `vidsVideoAttachmentOperations` table and a Vids-bound operation identity. Vids requests do not access Flow video attachment or queue handlers.
- The selected saved reference is read as immutable input. The Vids handler verifies the prepared pairing, exact stored bytes, SHA-256, format and media limits; target/document and manual confirmation are Vids-bound.
- The Vids operation cannot edit Flow attachment operations or Flow queue rows. No Vids queue, generation attempt, receipt or recovery mechanism was added in P10.1.

## Action boundary

One explicit **Attach reference** action transfers the exact saved PNG/JPEG bytes to the unique AI video clip Animate panel. It validates the file bytes and SHA-256 before setting the scoped file input, and persists the durable action intent before file selection. It verifies a single loaded preview and removal control in the same bound document before recording success. The route does not inspect or change settings, enter prompts, select timeline tools, or click Generate. Existing unbound previews are left untouched; uncertain delivery cannot automatically repeat the upload.

## Offline checks

- Focused Vitest: **5 files / 55 tests passed**.
- Local Chromium production injection fixture: **4/4 passed**.
- `npm run typecheck`: **passed**.
- `npm run lint`: **passed**.
- `npm run build`: **passed**, build ID `automat-faceless-0.1.0-mvz95cbl`, four JavaScript bundles in `dist/`.
- `git diff --check`: passed after the evidence/status update.

The browser fixture ran against localhost and did not use the installed extension or Google Vids. The existing Vids tab was left untouched. P10.2+ was not started.
