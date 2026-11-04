# P11.1 Google Flow download feasibility diagnostic

## Scope and evidence provenance

This note combines the user-provided Flow observations below with offline implementation and test evidence. No live Chrome tab was inspected or changed in this task, and no upscale or download was initiated. The controlled live association run remains **NOT_RUN**.

The offline package produced by this task is **`automat-faceless-0.1.0-mw0vqugh`**. It has not yet been loaded or confirmed in Chrome.

## P11.1 offline follow-up — 4 November 2026

The user reports that build `automat-faceless-0.1.0-mw0vqugh` was armed for Flow tab `1957329822`, and that Chrome history showed `animate_d35cfe17_1080p.mp4` (5.0 MB) after a newly generated clip. The diagnostic reported `interrupted`, no card owner/menu binding, no native action, and no candidate MP4/WebM. The exact Chrome download ID and the association with the observed action remain unverified. This is user-supplied live evidence; Chrome remained inaccessible during this offline follow-up.

Source review found two confirmed diagnostic gaps. First, the manager has two paths to `interrupted`: a debugger `onDetach` handler that called `finish(..., "interrupted")` without retaining a cause, and status resolution when an exactly associated Chrome download is itself interrupted. The record now carries bounded `debugger_detached` or `matched_download_interrupted` causes. The reported live interruption cannot be attributed to either path from the supplied snapshot alone.

Second, Chrome `downloads.onCreated` candidates were already stored independently from Gallery action verification, but the report did not count received events or video candidates omitted after the six-candidate cap. Those bounded counters are now visible, alongside a bounded last Gallery capture issue. A debugger detach previously ended active capture before a later Chrome download event could be recorded. The interrupted diagnostic now continues collecting Chrome lifecycle evidence through its original expiry while the reason is `debugger_detached`; the record stays interrupted and any late candidate stays unassociated without the strict identity chain. The next run can distinguish a received non-video event, a stored MP4/WebM candidate awaiting association, and capacity omission. A zero event count still cannot distinguish an event that never occurred from one the browser did not deliver to the listener; the new listener registration is a precondition of arming.

The passive page observer listens in capture phase, checks the trusted click's composed path, normalizes `downloadDownload`, and resolves each `aria-controls` value at the relevant menu step. Its menu query is deferred to a microtask after the Download-row click so the dynamically created quality submenu can appear. The browser fixture replaces the main menu with the quality submenu between clicks and removes the quality menu immediately after the trusted quality click is handled. It confirms the click is received and accepted in that structure. It does not establish what the live Flow page emitted during the reported run; capture issue diagnostics now report expected-stage target/control/menu recognition failures when observed.

Final offline checks: focused diagnostic tests **2 files / 9 tests PASS**; typecheck, ESLint, production build/package validation, and `git diff --check` **PASS**. Final build: **`automat-faceless-0.1.0-mw1ix2hs`**, four JavaScript bundles. Live verification remains **NOT_RUN**. P11.2/P11.3 remain out of scope.

For the next live run, load and confirm build `automat-faceless-0.1.0-mw1ix2hs`, arm on the intended Flow tab, and perform one manually authorized Gallery action. The report should show whether the trusted action was captured, the last bounded capture issue if not, the main and quality menu bindings, Chrome created-event count, candidate count/omission count, and any stored candidate basename/state. If debugger detach precedes Chrome's download event, the report should retain the debugger cause and still capture the late Chrome candidate. Keep a candidate unassociated unless the strict selected-frame/action-media/Chrome ID chain is present. Do not repeat the action because the result is unverified.

## Previously collected Flow evidence

- In Gallery → Videos → a clip's More options → Download, **1080p Upscaled** was visible and enabled for a 720p clip.
- The More options control is hover-dependent and its `aria-controls` identifies the main menu. The expanded Download row has its own `aria-controls` for the quality submenu. The diagnostic resolves both control IDs from the live DOM instead of hard-coding them.
- The Download row can render raw text as `downloadDownload` because its icon contributes text. The diagnostic normalizes the in-memory label and checks for the `download` substring; it does not save the label.
- A manual Edit View upscale produced a Chrome download after processing. The resulting MP4 was reported as **1920 × 1080 at 24 fps**.
- For that Edit View run, route ID `5b16d176-835d-43af-a177-f72457f2ac92`, media request evidence, and the downloaded filename were separately reported. The request and filename shared prefix `8c53eca2`. The Gallery card did not expose a usable stable ID in the inspected attributes, and its video source did not contain that prefix. These observations do **not** establish a Gallery-card-to-download-ID association.

The verified Edit View file properties are a separate historical observation. The new diagnostic does not inspect or verify a saved file's dimensions, frame rate, or playability.

## Offline diagnostic behavior

The Flow-only diagnostic is available under **Advanced details → Flow Gallery upscale diagnostic**. It arms against the currently selected, currently verified Flow tab and its exact document binding. It captures one trusted click on the selected card's More options menu path, records whether the card owner was found and whether a stable-ID attribute existed, resolves the two dynamic `aria-controls` bindings, and records whether 1080p Upscaled was present and enabled. It never prevents or synthesizes a click.

During the observation, the worker uses the existing debugger capability for read-only `Network` and `Page` events on that Flow tab. It retains at most 16 relevant Media/Fetch/XHR request fingerprints, four page download events, six MP4/WebM candidates, and a capped count of other file downloads. URL fingerprints and any hex-like media identifier are salted to the diagnostic session and hashed in memory. Raw URLs, query strings, headers, response bodies, prompts, cookies, and credentials are not stored or displayed. Candidate filenames are reduced to a sanitized basename.

Chrome's optional **`downloads` permission** is requested when the operator arms the observation. The Chrome downloads events can expose a local download ID, filename/path, state, URL, and interruption code. This diagnostic keeps only the ID, basename, state, a bounded interruption code, and salted URL/media fingerprints. It does not call `chrome.downloads.download()` or alter the browser's download behavior. The existing `debugger`, `tabs`, and `scripting` access from the verified Flow connection is also required.

Association is **matched** only when the trusted 1080p action is tied to a selected-frame `Page.downloadWillBegin`, an action-time media request shares the event's exact URL fingerprint or salted media identifier, and one Chrome download ID has the same URL fingerprint and exact sanitized basename. Timing, title, the next MP4, or a filename prefix alone remains **unverified** or **ambiguous**. Multiple exact Chrome candidates remain ambiguous. Browser completion is reported separately from saved-file media verification.

The record is kept in extension `storage.session`, is limited to one observation, and expires after 20 minutes. The operator can stop it earlier. A completed browser download ends the observation; it does not assert the file's resolution or that it belongs to a prepared shot.

## Offline verification

- Focused unit and worker-integration coverage: **2 files / 8 tests PASS**. The tests cover the passive dynamic menu observer (including `downloadDownload`), one exact action/media/download chain, an unrelated MP4 candidate, duplicate exact candidates, interrupted and expired states, and URL-token redaction.
- Typecheck: **PASS**.
- ESLint: **PASS**.
- Production build and packaged bundle/build-ID validation: **PASS**, four JavaScript bundles, build `automat-faceless-0.1.0-mw0vqugh`. The connector-only Vite pass printed its existing `inlineDynamicImports`/`codeSplitting: false` warning; package validation still passed.
- `git diff --check`: **PASS**.

These results use synthetic DOM, fake Chrome event ports, and the offline build. They do not demonstrate that the current Flow Gallery emits a matching media request and native download event.

## Controlled operator steps after loading the build

1. Load the built extension from this repository's `dist/` directory. In the extension dashboard, open **Advanced details** and confirm Build state `automat-faceless-0.1.0-mw0vqugh`.
2. In Videos, select and connect the intended Google Flow project tab. Return to **Advanced details** in the dashboard and choose **Arm one observation**. Grant the optional Chrome downloads permission when Chrome prompts. The panel must show **Armed** and the selected tab ID before proceeding.
3. In that same Flow tab, hover the one target Gallery clip and manually choose **More options → Download → 1080p Upscaled** once. The extension only observes the native clicks; it does not choose the quality or initiate the upscale/download.
4. Wait for the panel to show its observed action, request fingerprints, candidate Chrome download ID/name/state, and association result. Stop the observation if you are ending the run early. Do not repeat the upscale based on an unverified or interrupted result.
5. Record browser completion separately. If actual output properties are needed, verify the downloaded file in a later approved media-verification step; this diagnostic does not read or decode the file.

## P11.1 exit status

The diagnostic implementation and offline checks are complete. Live Gallery event coverage, exact result-to-download-ID association, and confirmation that the built package is installed remain **NOT_RUN**. P11.1's live-read-only acceptance is therefore still pending. Do not mark P11.1 live-verified or pass **G-FLOW-DOWNLOAD** until the controlled run supplies a result-bound association; P11.2 and P11.3 remain deferred.
