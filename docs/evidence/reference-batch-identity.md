# Reference assignment source identity

Date: 2 November 2026

## Confirmed defect

Image imports use stable workspace-scoped image batch and item IDs. When another image JSON is imported, including one reusing Shot IDs 01�05, the mutable current image source changes while those IDs remain the same. Reference assignments were looked up by workspace + batch + Shot ID, and the References page mapped them by Shot ID. The old Dinosaur assignments were therefore displayed for the new Volcano source. Selection candidate/session state was likewise keyed without the source identity.

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
## References UI Part 2 — shot-card presentation — 16 November 2026

Cards now distinguish the currently saved reference from a transient replacement, disclose the unchanged complete prompt and fold technical IDs/hashes/metadata into expandable details. Saved reference images use the existing object URLs in a larger fixed-ratio frame with `object-fit: contain`; transient candidates have a text placeholder, with no new preview fetch or load. Status labels cover no candidate, unsaved candidate, saved reference, replacement, pending, failed, uncertain and cancelled capture. Existing controls and their handlers remain in the shot card; Part 1's modal behavior was preserved.

Focused DOM tests: `referencePickerPresentation.test.tsx` and `referenceSelection.test.ts`, **64/64 PASS**. Cases include empty, candidate selected, saved, unsaved replacement with prior saved image retained, pending capture/cancel control, failed capture, uncertain capture, modal focus restoration and stale-session isolation. Typecheck, scoped ESLint, package build and `git diff --check` PASS. Build ID **`automat-faceless-0.1.0-mwiwb87u`**. A direct local Chromium launch was attempted for 1920×1080, 1366×768 and 390×844 review, but the Playwright browser executable is absent; rendered viewport review is therefore **NOT_RUN**. No browser was downloaded, installed extension reloaded, or provider action performed.

Final Part 2 rebuild follow-up: after adding saved assignment version, prompt hash and observed-source hash to the technical disclosure, production build/package validation passed with final ID **`automat-faceless-0.1.0-mwiwgmc1`**. Focused tests passed **64/64** on the final rerun. One preceding run had a transient failure in the existing delayed-refresh fixture because the Browse control was unavailable at lookup; rerun passed without a fixture or production change. Typecheck, scoped ESLint and `git diff --check` passed.

## References UI Part 3 - picker presentation and success feedback - 16 November 2026

Improved only the existing modal presentation: a responsive candidate grid, consistent 4:3 thumbnail frames using object-fit: contain, stable preview placeholders, and clear not-loaded/loading/ready/failed states. Empty, permission, ambiguous, and unsupported results have explicit messages. Shot number, Refresh images, Cancel selection, and Close remain in the fixed dialog header while the candidate area scrolls independently. Preview requests remain manual; no new resource fetching path was added. Hover and actual preview-loading feedback use References-scoped styles and theme tokens, with reduced-motion behavior.

The existing ToastHost receives 'Shot N reference selected' only after a session/Shot-bound accepted response or accepted event, and 'Shot N reference saved' only after a matching persisted capture response, saved-operation readback, or post-commit saved event. Stable batch/source/Shot/selection-version and capture-operation identities deduplicate overlapping responses/events and child remounts. Startup hydration and failed, cancelled, or uncertain outcomes remain silent for success notifications.

Focused References Vitest: 2 files / 68 tests PASS. Coverage includes manual preview states, permission and eligibility messages, empty/ambiguous/unsupported results, accepted selection, persisted save, event/response dedupe, silent hydration/remount, failed and uncertain operations, and existing modal/session behavior. Typecheck and scoped ESLint PASS. Local production package build PASS; ID automat-faceless-0.1.0-mwiz2irc. git diff --check PASS.

Mocked local Chromium rendering (no installed extension or live Flow) covered light/dark at 1920x1080, 1366x768, and 390x844. All six checks kept Shot/Refresh/Close visible. Desktop rendered five columns and narrow rendered one, with matching geometry by theme. Loading/ready/failed placeholders rendered, and scrolling to the end left Refresh and Close reachable. Reduced-motion emulation disabled the loading spinner (animation-name: none). Screenshots: artifacts/references-part3-rendered/. No extension reload or live provider action occurred.
