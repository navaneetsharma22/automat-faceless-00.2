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

## References UI Part 1 - shot-specific Flow picker modal - 15 November 2026

The existing extension-owned picker is rendered once inside a native dialog labelled **Flow images for Shot N**. Browse and Re-select open it for the clicked shot; the shot-card list remains mounted and the active Browse control retains identity for focus return. Accepted choice closes the modal only after the session-bound chooser accepts the current candidate, refreshes that Shot's transient candidate, and leaves **Save reference** as a separate manual action. X/Escape dismiss only the presentation; explicit Cancel selection and capture cancellation remain separate. Stale picker operations are ignored by generation/session guards. Backend, connector, storage, prompt/generation, and capture code are unchanged.

Focused Vitest for `referencePickerPresentation.test.tsx`, `referenceSelection.test.ts`, and `referenceCapture.test.ts`: **3 files / 66 tests PASS**. DOM fixtures cover bottom-shot launch, one picker, stable list DOM, accepted/failed selection, dismissal/reopen, no implicit save/cancel, and a stale chooser response after a different session starts. Typecheck, scoped ESLint, and `git diff --check` PASS.

Local Chromium rendering with mocked component data covered light/dark at **1920x1080**, **1366x768**, and **390x844**. Modal geometry matched between themes at each viewport. The gallery scrolled independently; opening/closing from Shot 40 preserved page scroll and restored focus to its Browse button. Native `showModal()` supplies keyboard focus containment. This is local rendered UI evidence, not installed-extension or live Flow acceptance. Build/package validation PASS; ID **`automat-faceless-0.1.0-mwhi7vat`**. Existing large dashboard chunk and connector `inlineDynamicImports` warnings remain. No extension reload or provider action occurred.