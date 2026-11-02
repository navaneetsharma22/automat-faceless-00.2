# Reference assignment source identity

Date: 2 November 2026

## Confirmed defect

Image imports use stable workspace-scoped image batch and item IDs. When another image JSON is imported, including one reusing Shot IDs 01–05, the mutable current image source changes while those IDs remain the same. Reference assignments were looked up by workspace + batch + Shot ID, and the References page mapped them by Shot ID. The old Dinosaur assignments were therefore displayed for the new Volcano source. Selection candidate/session state was likewise keyed without the source identity.

## Correction

Reference assignment identities and ephemeral selection/capture keys include the SHA-256 of the exact image source. Active reads/events are filtered by workspace, batch and source hash. New source assignments use a distinct key; existing legacy-key rows are eligible only when their stored source hash matches the requested source. No existing references, prepared batches, operations, receipts or storage records are deleted or reset.

## Verification

- Unit/integration tests exercised reimport with stable batch/item/Shot IDs, confirmed the Dinosaur reference is absent from the Volcano view, then selected and saved a Volcano candidate through the production selection/capture handler path.
- The older Dinosaur assignment remained readable and unchanged under its original source hash.
- Browser IndexedDB harness verified distinct source-scoped assignments survive database close/reopen and same-shot replacement.
- Focused Vitest: 3 files / 61 tests passed.
- Browser storage harness: 4/4 passed.
- Typecheck, ESLint, production build and `git diff --check` passed.
- Build: `automat-faceless-0.1.0-mvza7y6s`; output folder: `dist/`.
- Installed extension/live Flow verification: **NOT_RUN**.
