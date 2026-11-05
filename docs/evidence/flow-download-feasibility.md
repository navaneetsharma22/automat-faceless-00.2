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

## P11.1 Gallery click and Chrome download metadata follow-up - 4 November 2026

### Findings and confidence

**Confirmed source cause for the main-menu capture issue:** while the observer was in `main_menu`, any trusted click whose composed path did not identify More options emitted `capture_issue: main_menu / click_target_not_recognized`. That included unrelated page clicks, and could replace a useful capture issue in the one-slot report. The supplied live snapshot does not identify the click that generated its issue, so whether the live occurrence was unrelated remains unconfirmed.

The observer now ignores unrelated clicks. It searches the composed path for the recognized More options control, which handles clicks on nested icon/text nodes, and requires a recognized containing card. It no longer guesses the card from `parentElement`. The Download row must belong to the exact main menu named by that control's `aria-controls`; the quality option must belong to the exact submenu named by the Download row's `aria-controls`. Each event is read during capture while its menu is still present. The synthetic regression replaces/removes menus around the clicks and exercises nested targets. This preserves strict card/menu binding and does not synthesize or prevent input.

**Confirmed source cause for premature non-video classification:** when `downloads.onCreated` had no usable filename, sanitization produced `unknown-file`; extension detection returned `other`, incremented `nonVideoDownloadCount`, and discarded that exact Chrome download ID. The manager now stores the ID as a bounded `pending` candidate. State-only changes leave it pending. A filename update for that exact ID reclassifies it as MP4/WebM, or removes it and counts it as non-video when the filename identifies another type. Existing exact URL/basename, selected-frame, action-time media identity, and unique-ID association checks are unchanged.

The user-reported Chrome count was one event, one non-video, no candidate omitted, while Chrome showed `animate_a1d1d9a4_1080p.mp4` (8.1 MB). The diagnostic snapshot did not include the event's download ID or initial filename. Therefore that event being an incomplete initial notification for the visible MP4 is a **hypothesis**, not a confirmed live attribution. Likewise, no native action, card owner, or menu binding was reported; the live click sequence is **unconfirmed**. No Chrome tab or download metadata was read during this offline follow-up.

### Offline regressions and checks

- Unit fixture verifies unrelated clicks do not create capture issues; nested control descendants are recognized; menu clicks are bound to the current `aria-controls` element; a menu may disappear immediately after the captured click.
- Worker integration reproduces a Chrome ID first arriving without a filename, retains it through state-only change, reclassifies the same ID when its MP4 filename arrives, and excludes a pending PDF after its filename arrives.
- Focused Vitest: **2 files / 9 tests PASS**.
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- New package: **`automat-faceless-0.1.0-mw1jflaw`**, four JavaScript bundles.

### Expected evidence for the next controlled live run

Confirm the loaded build is `automat-faceless-0.1.0-mw1jflaw`, arm the observer on the intended Flow tab, then perform one manually authorized Gallery action. The report should retain the exact Chrome download ID from `onCreated`, including `pending` if the filename is absent; later metadata should update that same ID to the sanitized MP4 basename and video extension. It should show native action, selected card owner, main-menu and quality-menu bindings, action-time request/page-download evidence, and association reason. A result remains unverified unless the existing strict chain matches. Record browser completion separately. Do not repeat the action if association is unverified. No live action was performed in this follow-up; the live gate remains **NOT_RUN**, and P11.2/P11.3 remain out of scope.

## P11.1 trigger and menu-binding timing follow-up - 4 November 2026

### User-reported retest

Chrome download ID `2782` was reported complete for `animated_4a4a3508_1080p.mp4`. The observer reported `main menu / control missing`, with no card owner, main menu, quality submenu, or native action. The debugger detached; its timing relative to the menu action and download is unknown. Association remains unverified. No live Flow page was inspected in this follow-up.

### Confirmed source branch and reproduction

The old observer handled the trusted More options click in document capture phase and immediately checked `target.hasAttribute("aria-controls")`. It emitted `main_menu / control_missing` if absent. A browser fixture reproduces this event order: the control is absent when document capture sees the click; the trigger's normal click handler assigns `aria-controls` and inserts its overlay afterward in the same event. The previous observer therefore rejected a trigger that acquired its control during the click. This confirms the timing failure mechanism in the fixture and pinpoints the failed source check. The live retest does not reveal whether Flow assigned the attribute later in that exact way or never assigned it.

The observer now waits up to two seconds for the clicked trigger's single `aria-controls` ID and exactly one available connected panel. It keeps the card owner and trigger bound throughout that wait. The Download row must be found inside the resolved main menu. A trusted pointer hover on that row starts the same bounded wait for its single unique available quality submenu; its quality option and enabled state are then recorded before selection. Duplicate IDs, multiple control IDs, a lost owner, missing control, or unavailable panel do not produce a successful binding. No raw IDs, URLs, or query tokens are sent in these records.

The dashboard shows these results in **Pre-click menu evidence**, separate from **Trusted quality click**, Chrome download events, and association. Operators can stop after menu-only verification without selecting a quality.

### Regression evidence and checks

- Synthetic browser fixture uses a hover-revealed More options trigger, dynamically assigns `aria-controls` after capture, inserts the main overlay, opens the quality submenu on Download hover, and removes that submenu on the quality click. It asserts owner and both menu bindings before any quality action.
- A second browser case adds a duplicate control target and verifies that the observer rejects the ambiguous binding.
- Installed Microsoft Edge browser tests: **2/2 PASS**.
- Focused Vitest: **2 files / 9 tests PASS**.
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw1k6wzd`**, four JavaScript bundles.

### Menu-only verification steps

1. Load and confirm build `automat-faceless-0.1.0-mw1k6wzd`; select and verify the intended Flow tab, then arm one observation.
2. In that Flow tab, hover the target Gallery card and click its More options trigger once. Wait for **Pre-click menu evidence** to show the card owner and main menu binding resolved.
3. Hover Download. Wait for the Download row and quality submenu binding to show resolved, and review the option's visible/enabled status.
4. Stop observation before choosing any quality. This verifies menu binding only; it does not record a native quality action or a download association.

No live upscale or download was triggered. The live menu sequence and association remain **NOT_RUN**. Preserve the separately captured Chrome ID `2782` as user-reported completed-download evidence only; it is not associated with a Gallery result. P11.2/P11.3 remain out of scope.

## P11.1 owner-missing diagnosis - 4 November 2026

### Live inspection availability and source trace

The connected Chrome inventory was unavailable: the computer-use bridge returned no apps or browsers, and the Windows computer-use native pipe failed to connect. No live DOM was inspected or changed. The user reports build `mw1k6wzd` on tab `1957329822` reported `main menu / owner missing`, with no owner or menu evidence. Chrome download ID `2782` is reported complete for `animated_4a4a3508_1080p.mp4`; association remains unverified. Debugger-detach timing is unknown.

In the reported build, the immediate `main_menu / owner_missing` branch fires when `target.closest("article,[role='listitem'],li,[data-testid*='video-card' i],[class*='videoCard' i]")` returns no element. A later `owner_missing` branch can also fire if the selected owner or trigger disconnects, or if the trigger fails containment validation during the two-second `aria-controls` wait. The reported absence of owner/menu evidence does not distinguish those branches by itself.

### Reproduced owner-lookup defect and correction

An offline Edge fixture places a More options button inside an open shadow root, with an eligible `article` card host outside that root. For the button, `closest(cardSelector)` returns no owner even though the composed click path contains the article. The existing observer selected only through `closest`, then would reject the composed-tree relationship with ordinary `owner.contains(trigger)`. This reproduces a concrete route to the reported error shape.

The observer now takes the nearest matching owner from the trusted event's composed path, falling back to the same nearest-ancestor selector. Its later binding check walks parent nodes and shadow hosts to verify composed containment. The recognized owner selector set is unchanged, and the control still has to resolve to one unique available menu element. This fixes the reproduced shadow-boundary case without broadening card recognition or weakening menu binding. The actual live card's tag/ARIA structure remains unknown; the snippet below will distinguish this cause from an unrecognized custom card tag or a disconnect during the binding wait.

### One-shot read-only DevTools inspection

If connected Chrome remains unavailable, open DevTools on the reported Flow tab, paste this into the Console, then hover the target card and click More options once. The listener removes itself after that recognized click. It prints element tags, safe ARIA states, selector-match booleans, and shadow-root boundaries. It does not print URLs, text content, element IDs, class names, `aria-controls` values, query strings, or tokens, and it does not prevent or modify the click.

```js
(() => {
  const ownerSelector =
    "flow-video-tile,article,[role='listitem'],li,[data-testid*='video-card' i],[class*='videoCard' i]";
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const labelKind = (element) => {
    const value = normalize(`${element.getAttribute("aria-label") ?? ""} ${element.innerText ?? element.textContent ?? ""}`);
    if (value.includes("moreoptions")) return "more_options";
    if (value.includes("download")) return "download";
    return value ? "other" : "none";
  };
  const describe = (node, pathIndex) => {
    if (node instanceof ShadowRoot) {
      return { pathIndex, kind: "shadow_root", hostTag: node.host.localName };
    }
    if (!(node instanceof Element)) return { pathIndex, kind: "non_element" };
    const controlValue = node.getAttribute("aria-controls");
    const controlIds = controlValue?.trim().split(/\s+/).filter(Boolean) ?? [];
    const controlTargetCounts = controlIds.map((controlId) =>
      [...document.querySelectorAll("[id]")].filter((candidate) => candidate.id === controlId).length,
    );
    return {
      pathIndex,
      kind: "element",
      tag: node.localName,
      role: node.getAttribute("role"),
      ariaLabelKind: labelKind(node),
      ariaControlsPresent: controlIds.length > 0,
      ariaControlsTargetCounts: controlTargetCounts,
      ariaHaspopupPresent: node.hasAttribute("aria-haspopup"),
      ariaExpanded: ["true", "false"].includes(node.getAttribute("aria-expanded"))
        ? node.getAttribute("aria-expanded")
        : "other_or_absent",
      ariaLabelledbyPresent: node.hasAttribute("aria-labelledby"),
      ariaOwnsPresent: node.hasAttribute("aria-owns"),
      productionOwnerSelectorMatch: node.matches(ownerSelector),
    };
  };
  const handler = (event) => {
    const path = event.composedPath();
    const elements = path.filter((node) => node instanceof Element);
    const trigger = elements.find((element) =>
      element.matches("button,[role='button'],[role='menuitem']") || element.hasAttribute("aria-controls")
        ? labelKind(element) === "more_options"
        : false,
    );
    if (!trigger) return;
    document.removeEventListener("click", handler, true);
    const pathOwners = path.filter(
      (node) => node instanceof Element && node.matches(ownerSelector),
    );
    console.info("Flow Gallery owner lookup (sanitized)", JSON.stringify({
      capturePhase: true,
      triggerControlsPresentAtCapture: trigger.hasAttribute("aria-controls"),
      productionClosestOwnerFound: Boolean(trigger.closest(ownerSelector)),
      composedPathOwnerCount: pathOwners.length,
      composedPathOwners: pathOwners.map((node) => ({ tag: node.localName, role: node.getAttribute("role") })),
      eventPath: path.slice(0, 16).map(describe),
    }, null, 2));
  };
  document.addEventListener("click", handler, true);
  console.info("Read-only probe armed: hover one Gallery card, then click More options once.");
})();
```

Compare `productionClosestOwnerFound` with `composedPathOwnerCount` and the printed tags. A matching owner in the composed path with `productionClosestOwnerFound: false` confirms the reproduced shadow-boundary case. Zero matching owners means the live card uses a structure outside the current selector set; the printed safe tags/roles are then needed before adding a narrowly scoped selector. If a path owner is present but owner/menu evidence still fails, use the printed capture state and menu target counts to inspect the second binding-wait branch.

### Regression and package evidence

- Focused Vitest: **2 files / 9 tests PASS**.
- Synthetic Microsoft Edge browser tests: **3/3 PASS**, including composed-path owner discovery, the dynamic trigger/menu lifecycle, and duplicate-control rejection.
- Typecheck, ESLint, production package validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw1mmq40`**, four JavaScript bundles.

No live menu retest or provider action occurred. The fix is verified for the reproduced composed-tree case; whether it covers tab `1957329822` remains **NOT_VERIFIED** pending the sanitized DevTools output and menu-only retest. Stop after the menu-only retest. P11.2/P11.3 remain out of scope.

## P11.1 verified Flow video tile owner - 4 November 2026

### Supplied live evidence

The user reports build `mw1mmq40` on Flow tab `1957329822`. The trusted click path began at `mat-icon` → More options button; `flow-video-tile` was at composed-path index 8 and the enclosing `flow-grid-tile-container[role=group]` at index 11. `productionClosestOwnerFound` was false and the then-current composed-path owner count was zero. `aria-controls` was absent at capture. Separate live inspection verified that opening More options links the trigger to the main menu and hovering Download links the row to a distinct quality submenu. These are user-supplied live observations; they were not independently reread in Chrome during this offline implementation.

### Cause and correction

Confirmed selector gap: the production owner selector recognized `article`, `[role=listitem]`, `li`, video-card test IDs, and `videoCard` classes, but omitted the live `<flow-video-tile>` host. Therefore neither `closest()` nor the existing composed-path search recognized the actual card. The parent `flow-grid-tile-container[role=group]` is a grid container, not the selected tile owner, and is intentionally not added as an owner selector.

Added `flow-video-tile` as an explicit owner selector. The observer resolves the nearest matching element from the trusted More options event path and keeps the existing composed-tree trigger-containment check. It does not require a mounted `<video>` or a stable tile ID. The existing two-second wait for one unique, available `aria-controls` menu target is unchanged for both the main menu and the quality submenu. Menu evidence remains separate from a trusted quality click and from download association.

The read-only DevTools snippet in the preceding owner diagnosis now includes `flow-video-tile` in its production selector so future comparisons reflect the current build.

### Regression and checks

- Browser regression models the supplied hierarchy with `flow-video-tile` inside `flow-grid-tile-container[role=group]`, nested wrappers and `<mat-icon>`, no `<video>`, and no stable tile ID.
- The More options click handler assigns its `aria-controls` and inserts the main menu after a delay. Hovering Download separately assigns its own control and adds the quality submenu after a delay.
- Assertions verify `ownerFound: true`, `stableIdAttributeObserved: false`, and both menu bindings with the quality option visible/enabled. The test stops before a quality click and asserts no `quality_action` or association evidence.
- Focused Vitest: **2 files / 9 tests PASS**.
- Synthetic Microsoft Edge browser tests: **4/4 PASS**.
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw1n5b95`**, four JavaScript bundles.

### Menu-only retest

1. Load and confirm build `automat-faceless-0.1.0-mw1n5b95`; arm the diagnostic on the intended verified Flow tab.
2. On the target video tile, click More options once and wait for the card owner and main menu binding to resolve.
3. Hover Download and wait for the row and quality submenu binding to resolve.
4. Stop observation before selecting any quality. This confirms menu ownership only; do not continue to an upscale or download in this retest.

No live retest, quality click, upscale, or download was performed in this pass. P11.2/P11.3 remain out of scope.

## P11.1 Flow frame-to-download association diagnosis - 4 November 2026

### Supplied live evidence

The user reports build `mw1mmq40` on Flow tab `1957329822`: card owner and both menu bindings resolved, the trusted 1080p Upscaled click was captured, Chrome download ID `2783` completed as `animated_9d5114d7_1080p.mp4`, and the observer reported `no download event was tied to the selected Flow frame`. This summary does not say whether Chrome delivered `Page.downloadWillBegin`, whether the event source tab/frame matched, or whether usable URL metadata was present. No live Flow tab was inspected in this offline pass.

### Production trace and confirmed behavior

The exact reason is selected in `classifyFlowDownloadAssociation`: after a trusted action and valid card/menu evidence, it filters `pageDownloads` for entries where both `frameMatched` and `afterAction` are true. An empty result emits `no_selected_frame_download_event`. Exact Chrome ID `2783` and its completed MP4 metadata do not change that branch.

The source event is Chrome DevTools Protocol `Page.downloadWillBegin`; its `params.frameId` supplies the frame attribution. At diagnostic arm, production attaches the debugger to the selected tab, sends `Page.enable` and `Network.enable`, then obtains the root frame ID from `Page.getFrameTree.frameTree.frame.id`. The download event is considered main-frame only when its `params.frameId` equals that saved root ID. The manager adds `chrome.debugger.onEvent` listener once during manager construction; each callback enters the serialized diagnostic event queue and is retained only while a diagnostic is active and unexpired. Events on another source tab are rejected before association; events on the selected tab with a non-main `params.frameId` are recorded with `frameMatched: false` and excluded by the classifier.

The offline worker fixture reproduces three states: no Flow download event received (zero event counters), a Page download event from another tab (target mismatch increments), and an event from the selected tab's child frame (frame mismatch increments and the page event remains unassociated). A valid selected-tab main-frame event increments the matching-frame counter; the association still requires the action-time media request identity, exact URL/filename pair, and exact Chrome download ID. New counters are bounded, sanitized counts only. They do not weaken matching and expose no URLs or tokens.

### Request evidence cap

The media request cap is applied during collection, before report rendering, so it can discard association evidence; it is not only a display cap. An offline worker reproduction filled all 16 slots with pre-click Media requests, then showed a later request after the trusted quality click would be omitted and could not participate in the association chain. This is a demonstrated general failure mode; whether those 16 requests preceded the user-reported live click is unknown.

Pre-click requests cannot satisfy the classifier condition `startedAt + request.offsetMs >= actionAt`. On the quality action, production now discards those ineligible pre-click entries and resets the cap-overflow count, leaving the bounded 16 slots for action-time evidence. Requests still arriving after those slots fill are counted as omitted; the evidence stays bounded and the report calls out truncation. No cap change can establish a match by filename, timing, or completed MP4 alone.

### Regression and checks

- Focused Vitest: **2 files / 10 tests PASS**. The unit regression verifies that missing and wrong-frame events both remain unverified. The worker integration regression verifies target/frame counters, pre-click cap saturation and reset, and the exact ID association path.
- Typecheck: **PASS**.
- ESLint: **PASS**.
- Production build/package validation: **PASS**, four JavaScript bundles.
- `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw1npjxx`**.

### Next controlled diagnostic evidence

On the next authorized controlled run, first confirm the installed build ID and arm only on the intended verified Flow tab. The report should show the Flow download-event received count, target mismatch count, selected-tab main-frame count, selected-tab non-main-frame count, retained request count, and post-click request overflow count. Zero received events indicates no Page download event reached the observer. A target mismatch or non-main-frame count shows a received event rejected at that binding check. A main-frame event with no association points to a later URL/filename or action-media identity condition; inspect only the sanitized fingerprints and counters. Preserve the exact Chrome download ID for comparison. A match requires the main-frame after-action event, action-time request identity, exact URL/filename pair, and exact Chrome download ID chain. Stop at the authorized boundary; do not repeat a quiet quality action.

Chrome download ID `2783` remains unassociated on the evidence supplied for this pass. Whether its event was absent, rejected by target/frame, or arrived without usable metadata remains **unverified**. No live upscale or download was triggered. P11.2/P11.3 remain out of scope.

## P11.1 counted main-frame event and request-cap follow-up - 4 November 2026

### Supplied live evidence

The user reports a trusted 1080p Upscaled click with card owner and both menus resolved, one debugger download event counted for the selected Flow tab's main frame, zero target mismatches, and completed Chrome download ID `2784` for `animated_dfacbd5d_1080p.mp4`. Association still reported no event tied to the selected Flow frame. The report also showed 16 retained action-time requests (all Fetch POST) and four omitted at capacity; the debugger detached, with detach/evidence-processing order unknown. No live Flow tab was inspected during this offline pass.

### Main-frame event trace

The event counter increments in the `Page.downloadWillBegin` branch before URL fingerprinting and before the event is added to `pageDownloads`. A missing or invalid URL makes `fingerprintFlowDownloadUrl` return no fingerprint; the worker keeps the receipt/main-frame counters, increments `pageDownloadMetadataRejected`, stores no page event, and the classifier emits `no_selected_frame_download_event`. A valid URL with no usable suggested filename is retained as `unknown-file` but cannot form the existing exact URL/filename pair with a named Chrome download; the report now counts `pageDownloadFilenameUnavailable` separately. If the event has valid metadata, it is retained, but `afterAction` is derived from the worker receipt time compared with the trusted quality-click timestamp. A main-frame event received before the click is stored with `afterAction: false` and excluded by the classifier. The dashboard now distinguishes counted events, target/frame attribution, retained events, retained action-time main-frame events, metadata rejection, missing filename, and page-event capacity omissions.

Detach calls `finish` with `interruptionReason: debugger_detached` and changes status to interrupted while preserving the record's existing page events, media requests, counters, and downloads. It does not clear evidence. A debugger callback that reaches the event queue only after the record has become interrupted is ignored by the active-record check; in that ordering it cannot increment counters or persist the event. The fixture verifies that a pre-click main-frame event remains stored and remains ineligible after the quality click and detach. The live summary gives no retained-event, metadata, or per-event timing detail, so the specific live cause remains unverified.

### Request-cap reproduction and correction

The cap can discard association evidence during collection. An offline worker fixture sends 16 unrelated action-time Fetch POST requests followed by a valid main-frame Media request whose URL fingerprint matches the page download event and Chrome download. With the prior first-16 policy, the Media request would be dropped and the chain could not match. The worker now preserves the bounded 16-entry list while allowing a new main-frame Media request to replace a retained Fetch/XHR entry when capacity is full. The displaced entry increments the existing bounded omission count. This preference changes retention only: association still requires a trusted quality click, owner/menu evidence, an after-click selected-frame page event, exact page-event URL/filename to the exact Chrome download candidate ID, and a matching action-time media identity. Filename or timing alone never matches.

### Regression and checks

- Focused Vitest: **2 files / 10 tests PASS**. Regressions cover main-frame receipt with missing URL, missing filename metadata, event-before-click eligibility, evidence persistence across detach, and 16 Fetch POSTs followed by an exact matching Media request and Chrome download ID.
- Typecheck: **PASS**.
- ESLint: **PASS**.
- Production build/package validation: **PASS**, four JavaScript bundles.
- `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw1xqgpd`**.

Chrome download ID `2784` remains unassociated on the supplied evidence. Missing event URL/filename metadata, event-before-click ordering, processing after detach, and a matching Media request arriving after the reported omitted requests remain live hypotheses. The offline fixtures demonstrate each relevant source behavior but do not establish which occurred in Flow. No live upscale or download was triggered. P11.2/P11.3 remain out of scope.

## P11.1 Flow download URL rejection and feasibility follow-up - 4 November 2026

### Supplied live evidence and exact rejection path

The user reports build `mw1xqgpd` on Flow tab `1957329822`: the trusted 1080p Upscaled click, card owner, both menu bindings, and one selected-tab main-frame download event were recorded. No page download record was retained; one event was rejected for unusable URL metadata. Chrome download ID `2785` completed, but association remained unverified. The live evidence does not give the rejected URL's category or exact reason, and it does not establish that the URL was a blob URL.

In production, `Page.downloadWillBegin` increments the receipt and frame counters before calling `fingerprintFlowDownloadUrl`. A rejected value increments `pageDownloadMetadataRejected`, stores only `lastPageDownloadUrlRejection`, and creates no `pageDownloads` entry. The association classifier then reports `no_selected_frame_download_event` because there is no retained after-action event from the selected main frame. The live summary confirms this branch shape but cannot identify the specific reason below.

| Bounded reason | Condition | Scheme category |
| --- | --- | --- |
| `missing` | URL metadata is not a string | `unknown` |
| `empty` | URL metadata is empty or whitespace | `unknown` |
| `malformed` | Non-empty value cannot be parsed as an absolute URL | Inferred only from an allowlisted prefix (`https`, `http`, `blob`); otherwise `other` or `unknown` |
| `unsupported_scheme` | URL parses, but the scheme is not `https`, `http`, or `blob` | `other` |
| `policy_rejected` | Parsed allowlisted URL exceeds 8,192 characters or contains user/password credentials | Parsed category: `https`, `http`, or `blob` |

Valid `https`, `http`, and `blob` URLs are accepted. The dashboard, logs, and persisted diagnostic contain no raw URL, query string, signed parameter, or blob token. Per-session fingerprints and exact Chrome download IDs are stored; raw URL strings exist only in bounded worker memory for exact equality comparisons.

### Controlled browser URL comparison

An offline Microsoft Edge extension fixture captured real `Page.downloadWillBegin` and Chrome `downloads.onCreated` values. It compared exact strings in memory and kept only scheme categories and equality booleans in its evidence:

| Fixture | Browser completed | Page event scheme | Chrome `url` / `finalUrl` scheme | Event URL equals `url` | Event URL equals `finalUrl` |
| --- | --- | --- | --- | --- | --- |
| Direct HTTPS | Yes | `https` | `https` / `https` | Yes | Yes |
| Redirected HTTPS | Yes | `https` | `https` / `https` | No | Yes |
| Page-created blob | Yes | `blob` | `blob` / `blob` | Yes | Yes |
| Two competing downloads | 2 completed | `https`, `https` | `https` / `https` for each | Yes for both | Yes for both |

The redirected fixture demonstrates that the event URL may equal Chrome's `finalUrl` while differing from its initial `url`; comparing both fields in memory is necessary. The blob case proves that this Edge path exposes the same blob URL in the Page event and Chrome DownloadItem. These fixture results establish URL comparison behavior for these controlled cases, not a Flow clip association.

The competing fixture produced two selected-tab page events and two Chrome download records, each with its own exact URL equality link. A focused classifier regression supplies those two competing events without action-time media identity and confirms `ambiguous / multiple_page_download_events`. Existing strict media identity can resolve a unique chain when present; filename, timing, or completion alone still cannot establish one.

### Archive and separate upscaled file dimensions

`C:\Users\ASUS\Downloads\flow vide D.zip` is present. `ffprobe` reports all five archive videos as H.264, 640x360, approximately 4.032 seconds:

- `Dinosaur_turning_head_5f43c1f9.mp4`
- `Dinosaur_lowering_head_to_inspect_6f0c5678.mp4`
- `Animal_breathing_and_blinking_7d96c2b5.mp4`
- `Tyrannosaurus_breathing_and_shif…_14ae0c64.mp4`
- `Dinosaur_shifting_weight_a1799825.mp4`

Separate local comparison files probe as H.264 1920x1080 at 5.970 seconds (`animated_4a4a3508_1080p.mp4`) and H.264 1728x960 at 8 seconds (`tnik3odvt5y3sah5byxjpujsem (4)_2x_upscaled.mp4`). Neither is established as a paired output of an archive entry. The browser fixtures establish browser download completion and URL-to-DownloadItem equality; they do not produce valid media for dimension analysis. No Flow clip-to-download association or live file dimension was established in this pass.

### Regression, checks, and remaining live acceptance

- Focused Vitest: **2 files / 14 tests PASS**, including each bounded rejection reason, exact ID URL linkage, two-event ambiguity, and the existing media-chain requirements.
- Offline Microsoft Edge URL comparison fixture: **1/1 PASS** (direct HTTPS, redirected HTTPS, blob, and competing downloads).
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw2018be`**, four JavaScript bundles.

Chrome download ID `2785` remains unassociated. Its live rejection reason and scheme category remain unknown because that report predates the new bounded fields. Live acceptance still requires a future controlled run to retain a selected-tab main-frame event after the trusted quality click, report only its bounded reason/category when rejected, or establish exact in-memory URL equality to the same Chrome download ID plus the existing action-time media identity and unique-chain conditions. Browser completion, clip association, and file dimensions must continue to be reported as separate evidence. No live Flow upscale or download occurred. P11.2/P11.3 remain out of scope.

## P11.1 blob URL match and Download-row menu diagnosis - 4 November 2026

### Supplied live evidence

The user reports that a selected Flow main-frame blob URL exactly matched completed Chrome download ID `2786`. No trusted quality click was captured, so this is event-to-download URL evidence only; clip-to-download association remains **unverified**. The build ID and whether equality was against `DownloadItem.url` or `DownloadItem.finalUrl` were not supplied.

### Menu-only check availability

The requested live sequence was not run in this session. The connected browser inventory returned no apps or browser tabs. The computer-use workflow's `list_apps()` and `list_windows()` calls failed because its native pipe was unavailable. No Flow page was inspected, no diagnostic was armed, and no More options click or Download hover was performed. The menu-only live check is therefore **NOT_RUN**; no live DOM mismatch is confirmed and no production fix is justified by current evidence.

### Current observer branch and limits

Source review shows the first Download-row gate in the passive document-capture `pointerover` handler. It requires a trusted event while the observer is in `download_row`, filters the composed path to buttons, menu items, or elements with `aria-controls`, checks that the path is inside the unique visible panel bound from More options, and searches the filtered path for normalized accessible text containing `download`. If that row lookup finds nothing, the handler returns silently: it does not emit a `capture_issue` or a failed row record.

After a row is recognized, the observer waits up to two seconds for exactly one `aria-controls` ID and one visible linked submenu. The row may be outside the card owner because it is rendered in the overlay, but the selected card owner must remain connected. Only after the linked submenu resolves does it send `downloadRowRecognized`, `qualityMenuControlResolved`, and option visibility/enabled booleans. The current diagnostic does not retain the live row's tag, role, label category, `aria-expanded`, or submenu visibility details; those need a sanitized read-only DOM observation to distinguish a path/text recognition miss from a submenu-binding miss.

Possible source mismatches to check, not confirmed live causes: the live Download row may lack a recognized interactive role and `aria-controls` at pointerover, its accessible text may not normalize to a label containing `download`, the event path may not fall inside the bound main panel, or the row's control may not resolve to one visible submenu. Do not broaden the observer selector or relax unique binding without live evidence.

### Sanitized menu-only observation for the next available live session

On the intended verified Flow tab, confirm build `automat-faceless-0.1.0-mw2018be`, arm the diagnostic, and paste this read-only snippet in DevTools before opening More options. It prints fixed label/role categories, element tags, `aria-expanded` state, whether `aria-controls` exists, target counts, and whether the linked panel is visible. It never prints raw labels, IDs, URLs, text, or tokens. Then click More options, hover Download, review the one console record, and stop before choosing any quality.

```js
(() => {
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const labelKind = (element) => {
    const value = normalize(`${element.getAttribute("aria-label") ?? ""} ${element.innerText ?? element.textContent ?? ""}`);
    if (value.includes("moreoptions")) return "more_options";
    if (value.includes("download")) return "download";
    if (value.includes("1080pupscaled")) return "quality_option";
    return value ? "other" : "none";
  };
  const roleKind = (element) => {
    const role = (element.getAttribute("role") ?? "").toLowerCase();
    return ["button", "menu", "menuitem", "option", "group", "presentation"].includes(role)
      ? role
      : role ? "other" : "absent";
  };
  const visible = (element) => {
    if (!element?.isConnected || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const controlInfo = (element, path = []) => {
    const ids = (element.getAttribute("aria-controls") ?? "").trim().split(/\s+/).filter(Boolean);
    const roots = new Set([document, ...path.map((node) => node.getRootNode()).filter((root) => root instanceof ShadowRoot)]);
    const targets = [...roots].flatMap((root) =>
      [...root.querySelectorAll("[id]")].filter((target) => ids.includes(target.id)),
    );
    const uniqueTarget = ids.length === 1 && targets.length === 1 ? targets[0] : undefined;
    return {
      ariaControlsPresent: ids.length > 0,
      ariaControlsCount: ids.length,
      resolvedTargetCount: targets.length,
      linkedPanelVisible: Boolean(uniqueTarget && visible(uniqueTarget)),
      linkedPanelTag: uniqueTarget?.localName ?? "none",
      linkedPanelRole: uniqueTarget ? roleKind(uniqueTarget) : "none",
    };
  };
  let moreTrigger;
  const onClick = (event) => {
    if (!event.isTrusted) return;
    const path = event.composedPath().filter((node) => node instanceof HTMLElement);
    moreTrigger = path.find((node) => labelKind(node) === "more_options");
  };
  const onPointerOver = (event) => {
    if (!event.isTrusted || !moreTrigger) return;
    const path = event.composedPath().filter((node) => node instanceof HTMLElement);
    const row = path.find((node) => labelKind(node) === "download");
    if (!row) return;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerover", onPointerOver, true);
    const mainBinding = controlInfo(moreTrigger, [moreTrigger]);
    const mainTargets = (moreTrigger.getAttribute("aria-controls") ?? "").trim().split(/\s+/).filter(Boolean);
    const withinMainPanel = path.some((node) => {
      const roots = new Set([document, node.getRootNode()]);
      return [...roots].some((root) =>
        [...root.querySelectorAll("[id]")].some((target) => mainTargets.includes(target.id) && (target === node || target.contains(node))),
      );
    });
    console.info("Flow menu-only observation (sanitized)", JSON.stringify({
      moreOptions: {
        tag: moreTrigger.localName,
        role: roleKind(moreTrigger),
        labelKind: labelKind(moreTrigger),
        ariaExpanded: ["true", "false"].includes(moreTrigger.getAttribute("aria-expanded")) ? moreTrigger.getAttribute("aria-expanded") : "other_or_absent",
        ...mainBinding,
      },
      downloadRow: {
        tag: row.localName,
        role: roleKind(row),
        labelKind: labelKind(row),
        ariaExpanded: ["true", "false"].includes(row.getAttribute("aria-expanded")) ? row.getAttribute("aria-expanded") : "other_or_absent",
        withinBoundMainPanel: withinMainPanel,
        ...controlInfo(row, path),
      },
      observerPathGate: path.some((node) => node.matches("button,[role='button'],[role='menuitem']") || node.hasAttribute("aria-controls")),
    }, null, 2));
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("pointerover", onPointerOver, true);
  console.info("Read-only probe armed: click More options, hover Download, then stop before quality selection.");
})();
```

This pass records no confirmed Download-row mismatch and makes no code change. The supplied blob URL equality for ID `2786` is retained as user-reported event/download evidence only. No trusted quality action or Flow clip association is established. P11.2/P11.3 remain out of scope.

## P11.1 supplied Download-row markup production-observer fixture - 4 November 2026

### Supplied menu-only DOM evidence

The separate inspection reports a `flow-video-tile` owner and a More options `aria-controls` binding to that card's main `role="menu"` panel. The Download control was a `button[role="menuitem"][aria-haspopup="menu"]` with no `aria-label`; its `textContent` was `downloadDownload`, from an `aria-hidden` `mat-icon` reading `download` and a visible `span.label` reading `Download`. Before hover, `aria-expanded` was false and `aria-controls` absent. After hover, `aria-expanded` became true and `aria-controls` resolved to one `role="menu"` submenu. The 1080p Upscaled option was enabled and was not clicked. This is user-provided DOM evidence; the original live page was not accessible in this session.

### Production-observer reproduction

Added an Edge browser fixture that installs the actual production `installFlowGalleryDownloadObserver` function and reproduces the reported custom-element owner, main-menu binding, exact button role/haspopup/label/text structure, hidden icon, and initially absent submenu control. Hover changes `aria-expanded` and, after a short delay, assigns `aria-controls` and mounts one visible quality menu with an enabled 1080p Upscaled item.

The fixture passes. The observer recognizes the row because its path includes a `button`/`role=menuitem` and `textFor()` sees normalized `downloadDownload`. Its bounded mutation wait sees the delayed submenu binding, resolves exactly one menu panel, and reports `downloadRowRecognized`, `qualityMenuControlResolved`, `qualityOptionObserved`, and `qualityOptionEnabled`. No quality action or association message is emitted. The supplied live markup is already supported by the production observer; no selector or matching-rule change was made.

### Smallest additional menu-only diagnostic

The remaining blind spot is before submenu binding: if a trusted hover is inside the bound main menu but no node in the filtered path passes the Download-row lookup, the observer silently returns. Once a row is recognized, the existing two-second wait already distinguishes `control_missing` (no `aria-controls` appeared) from `menu_unresolved` (control appeared but did not resolve to one visible panel).

If future evidence still shows a missing row, the smallest diagnostic is one bounded pre-binding row-lookup result on the trusted, bound-main-menu hover: `candidate_found` or `no_candidate`. Keep it separate from the later submenu-wait result, and expose no raw text, IDs, URLs, or tokens. Do not change the current matching rules based on the present fixture, which passes.

### Regression and status

- Focused Microsoft Edge production-observer fixture: **1/1 PASS**.
- Typecheck: **PASS**.
- ESLint on the modified fixture: **PASS**.
- Production observer, trusted quality-click logic, download association rules, and package build were unchanged; no new build ID was produced.
- `git diff --check`: **PASS**.

Chrome download ID `2786` remains unassociated with a Flow clip because no trusted quality click was captured. No quality option was clicked in the fixture or live page. P11.2 remains out of scope.

## P11.1 quality click listener and worker receipt follow-up - 4 November 2026

### Supplied live evidence

The user reports that run `2787` resolved the Flow card, main menu, Download row, and enabled 1080p Upscaled option. The selected main-frame blob URL exactly matched completed Chrome download ID `2787`. No trusted quality click was recorded, so ID `2787` remains complete but **unassociated** with a clip. This is supplied evidence; no live Flow page was accessed in this pass.

### Production quality-click path

The passive observer's document-capture `click` listener first requires a trusted event and the `quality_option` stage. It reduces the composed path to interactive nodes, verifies the path is inside the unique visible submenu bound from the Download row's `aria-controls`, and searches that path for the normalized 1080p Upscaled option. It then requires exactly one candidate and rejects a disabled candidate. Before this change, clicks failing the bound-menu or candidate checks returned silently. A passing click sets the observer to done and sends a page-accepted marker followed by the trusted `quality_action` message.

The worker validates the message schema, extension sender, diagnostic session, selected tab, main frame, document ID, and expiry, then serializes ingestion. The accepted-in-page marker and action receipt are now separate bounded report fields. The click diagnostic records listener events (capped at 100), candidate rejection count (capped at 100) and the last fixed rejection reason: `outside_bound_submenu`, `quality_option_not_found`, `quality_option_ambiguous`, or `quality_option_disabled`. The report shows listener event receipt, last candidate outcome, page acceptance, and worker receipt. It stores no page text, URL, or token.

### Reproduction and ordering

The production observer passes a Microsoft Edge fixture that clicks the nested text label inside the 1080p button and removes the submenu immediately in the button's click handler. The capture listener sees the bound submenu before teardown and emits listener reached, page accepted, and action messages. A click on a different item in the same submenu emits `quality_option_not_found` and does not close the menu or accept an action. The first fixture attempt exposed a mock-only problem: its `sendMessage` stub returned `Array.push()`'s number instead of the Promise returned by Chrome runtime messaging. After correcting the stub to return a resolved Promise, the production observer fixture passes. No corresponding production failure was reproduced.

The worker integration regression delivers a selected-main-frame `Page.downloadWillBegin` event after the page acceptance marker but before the worker receives `quality_action`. The event is initially retained with `afterAction: false`; when the delayed trusted action message arrives with the earlier click timestamp, the worker re-evaluates it to `afterAction: true`. Existing strict matching remains unchanged: the event still needs the trusted action, selected frame, action-time media identity, exact event/download URL and filename relationship, and unique exact Chrome download ID before association can match.

### Checks and remaining evidence

- Focused Vitest: **2 files / 14 tests PASS**.
- Focused Microsoft Edge production-observer fixture: **1/1 PASS**.
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw23suv6`**, four JavaScript bundles.

Chrome ID `2787` remains complete but unassociated because no trusted quality click was captured. Browser completion and blob URL equality are separate from clip association; no saved-file dimensions were inspected. No live quality selection, upscale, or download occurred. P11.2 remains pending; P11.3 is out of scope.

## P11.1 action media-identity diagnosis and request-cap retention - 4 November 2026

### Supplied live evidence

The user reports that build `mw23suv6` recorded the trusted 1080p click in the page and worker. The post-click selected-main-frame blob URL exactly matched completed Chrome download ID `2788`. Association failed with `no media request identity linked the action to the download event`; 16 request entries were retained and 8 omitted. This is user-supplied live evidence. It does not identify the retained or omitted request types or fingerprints, so it cannot show whether the matching request was missing, retained but mismatched, or lost at capacity. ID `2788` remains complete but **unassociated**.

### Exact classifier rule

`no_action_media_identity_link` is returned after a trusted action/menu gate and at least one eligible selected-frame, after-action page event has been found, and after an exact event-to-Chrome candidate pair exists, but no retained action-time media request links to that pair.

The exact event-to-download pair requires the event's `exactDownloadIds` to contain the Chrome ID, the page-event URL fingerprint to equal the Chrome item's URL or final-URL fingerprint, and the sanitized filenames to be identical. Exact URL equality is established in memory and represented by ID/fingerprint evidence; raw URL strings and signed parameters are not persisted.

Then at least one media request must have a capture time at or after the trusted quality click and satisfy one of these identity comparisons: its session-scoped URL fingerprint equals the selected-frame event URL fingerprint, or its media-ID fingerprint equals the event or exact Chrome candidate media-ID fingerprint. The media-ID fingerprint is derived from a hex-shaped path identifier or sanitized filename identifier and hashed with the diagnostic session. Timing only qualifies when the identity also matches. A filename match, completed state, URL-to-Chrome-ID equality, or request count alone cannot establish clip identity.

The card owner gate is recorded as `ownerFound` plus the trusted quality action and resolved menu bindings; the diagnostic does not capture or compare a stable card ID to a network request. Thus the selected clip is inferred through the verified card-bound action and the action-time media request identity chain. That limitation remains explicit; no weaker fallback was added.

### Controlled identity and cap fixtures

The classifier fixtures separate three cases. With no retained media request, the result is `no_action_media_identity_link`. With a retained request whose URL and media-ID fingerprints differ from the event and Chrome candidate, the same rejection is produced despite the exact event-to-download pair. These cases are distinguished by fixture inputs, while the bounded production reason remains the same because neither establishes a media identity link.

The worker cap fixture reproduces 16 unrelated action-time `Media` requests without usable media IDs, followed by a relevant `Fetch` request carrying the media ID that matches the selected-frame event. The previous cap branch could replace `Fetch`/`XHR` only when a new request was `Media`; therefore this relevant request would have been omitted. The request buffer now prioritizes a request that matches an action-time selected-frame event, replacing a retained request that does not match. When the event is not yet available, an identity-bearing request can replace an entry without a media-ID fingerprint. The 16-entry limit remains unchanged; the omission counter still records the displaced or dropped item. Final association still requires the complete strict chain.

The regression reaches a unique match only after the exact page event and Chrome ID pair exist and the retained Fetch request's media-ID fingerprint matches the event/candidate identity. This confirms the cap could cause the observed failure class in a controlled order and that prioritizing identity-linked evidence resolves that fixture. The live run's 8 omitted entries are not individually described, so their relevance remains unconfirmed.

### Checks and remaining evidence

- Focused identity/worker Vitest: **2 files / 15 tests PASS**.
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw24ddro`**, four JavaScript bundles.

Chrome ID `2788` remains complete but unassociated; its missing-versus-mismatched-versus-cap-lost media identity evidence cannot be distinguished from the supplied counts alone. No live Flow page was inspected and no upscale or download was triggered. P11.2 remains pending; P11.3 is out of scope.

## P11.1 selected-clip identity availability and bounded diagnosis - 4 November 2026

### Supplied live evidence

The user reports that run `2789` captured the trusted 1080p click in the page and worker, then observed an exact post-click selected-frame blob URL match to completed Chrome download ID `2789`. Association still failed with `no_action_media_identity_link`; the report retained 16 requests and omitted 12, but did not include a build ID or per-request identity evidence. ID `2789` remains complete but **unassociated**.

### Identity available at click time

Source trace shows the observer resolves the trusted More options trigger to its card owner and emits `ownerFound` plus the boolean `stableIdAttributeObserved`. It does not retain the card's `data-video-id`, `data-asset-id`, or `id` value. The page-click message carries the requested quality and timestamp, not an asset or upscale-job identifier. No Flow job-ID extraction or association field appears in the diagnostic path. The controlled DOM observer fixture supplies a synthetic `data-video-id`, confirms only the boolean is reported, and verifies that the raw value is absent from messages.

The worker can derive a session-scoped media-ID fingerprint from a hex-shaped URL path component and from the sanitized page/Chrome filename. It does not independently know that this value is the selected tile's asset ID. That fingerprint bridges the selected action to a request only when the action-time request ID matches the selected-frame page event or exact Chrome candidate. No existing observed asset/job identifier reliably connects the selected card directly to the downloaded blob, so no new identity source or relaxed match was added.

### Bounded identity diagnostics and cap regression

The report now distinguishes `not_evaluated`, `identity_not_extracted`, `identity_extracted_no_match`, `matching_request_retained`, and `identity_request_dropped_at_cap`. It separately counts ID-bearing request entries displaced or dropped at the 16-entry cap, bounded to 100. This counter describes that an identifier-bearing request was omitted; it does not claim the omitted request belonged to the selected clip. The displayed evidence contains only scoped fingerprints and counts, never raw URLs, tokens, or ID strings.

Controlled cases confirm: no retained action-time media ID yields `identity_not_extracted`; a retained request with a different URL/media-ID fingerprint yields `identity_extracted_no_match`; a cap-omitted identity-bearing request with no retained ID yields `identity_request_dropped_at_cap`. A separate case gives an unrelated completed clip an exact page-event/Chrome-ID URL and filename pair but a different action-time request identity; it remains unverified and can never report Matched.

The worker fixture fills all 16 slots with action-time Media requests without media IDs, then sends an identity-bearing Fetch request matching the selected-frame event. The request replaces a nonmatching entry and remains within the 16-entry cap; the strict exact event/Chrome ID pair plus matching request identity can then produce one unique match. Further identity-bearing requests after all slots contain identity fingerprints increment the bounded identity-omission counter. The live `16 retained / 12 omitted` counts do not reveal whether run `2789` had any of these identity patterns.

### Checks and remaining evidence

- Focused identity/worker Vitest: **2 files / 17 tests PASS**.
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw24y49t`**, four JavaScript bundles.

Chrome ID `2789` remains complete but unassociated. The supplied evidence does not establish an asset/job identifier bridge or whether a suitable identity was never extracted, mismatched among retained requests, or omitted at capacity. No live Flow page was inspected and no upscale or download was triggered. P11.2 remains pending; P11.3 is out of scope.

## P11.1 selected-clip identity trace for download 2790 - 4 November 2026

### Status and inspection boundary

Keep Chrome download ID `2790` **Complete / Association Unverified**, as directed. This pass made no live Flow changes. Read-only connected-browser inspection was attempted through the computer-use workflow, but the Windows native pipe remained unavailable after its prescribed recovery; live DOM and route inspection are **NOT_RUN**. The repository contains no separate captured card DOM, media element, detail route, or upscale-result trace for run `2790`.

### Identity surfaces in the available source and traces

The P11.1 Gallery observer identifies the clicked owner (including `flow-video-tile`) and checks whether that element has an `id`, `data-id`, `data-video-id`, or `data-asset-id`. It reports only `stableIdAttributeObserved: true/false`; it does not retain the attribute value, inspect an `href` or detail route, or read an image/video element's source or identity. Therefore source review confirms that this diagnostic does not extract a selected video card ID. It cannot establish whether the live card or route actually exposes one.

Other Flow identity code is for the input ingredient image. The video attachment path reads a pinned `providerAssetId` and checks that the attached Ingredient chip resolves to the same source image media ID. That identity belongs to the prepared input reference; no existing trace connects it to the generated Gallery video or its downloaded file. Separately, the Flow result identity schemas describe result/asset/group-variant IDs and attribution for Flow image-result observation. Those image lifecycle records are not emitted by the P11.1 video Gallery observer, and no such record for the selected video or ID `2790` was found. The legacy video queue's optional `resultIdentity` has no production writer or consumer in `src`.

The P11.1 worker can compare sanitized, session-scoped request/event/download fingerprints under its existing strict rules. Those fingerprints can link action-time media evidence to the page download event and exact Chrome download record when they agree, but they do not encode which Gallery card was selected. The available identity chain therefore ends before the clip: there is no demonstrated stable card ID, no observed video upscale job/result ID, and no same-ID trace from card to result/blob. A detail-route ID, if present live, remains uninspected. Timing, filename, download completion, and blob URL equality cannot fill that gap.

### Finding

Confirmed from source: the current P11.1 observer reduces ID-like card attributes to a boolean and has no card-to-media or card-to-result identity comparison. Confirmed from the inspected repository traces: no video result identity for ID `2790` is available to complete that bridge. Not confirmed: whether the live card/media/detail route exposes a stable ID or whether Flow's upscale response contains a corresponding ID. ID `2790` remains **Complete / Association Unverified**. No matching fallback or weakened rule was added; no upscale or download was triggered. P11.2 remains pending and P11.3 remains out of scope.

## P11.1 route-to-output identity trace for download 2790 - 4 November 2026

### Supplied identifiers and local evidence

The user identifies the selected clip by title and supplies its Flow detail-route UUID; the user separately identifies a token embedded in the download filename. Treat the route UUID and filename token as distinct values. They are not evidence of equality or a mapping. To keep the evidence record sanitized, the raw route UUID and filename token are not copied here.

Searched the existing P11.1 evidence, project status, source, tests/fixtures, e2e, artifacts, and test-results for the supplied route UUID, filename token, clip title, and download ID. No run-specific log or capture containing the route UUID, clip title, or filename token is present. The only local `2790` record is the prior status/evidence entry retaining **Complete / Association Unverified**. Available browser fixtures are synthetic and do not represent this live run. The previously reported blob-to-Chrome-ID match is user-supplied evidence; its raw capture is not present in the workspace.

### Missing links

1. **Route clip → upscale job/output asset:** no capture explicitly records the supplied route UUID as the source of an upscale job, or maps that job ID to a returned output asset/result ID. The filename token is separate and does not fill this link.
2. **Output asset → downloaded blob:** no capture maps a returned output asset/result ID to the media response or blob URL that produced the download event for Chrome ID `2790`. The reported blob URL ↔ Chrome download mapping reaches the browser download record, but by itself does not identify the clip or output asset.

### One future capture needed

A single bounded capture around one already-authorized trusted quality action would need to preserve these explicit relations, all bound to the same selected tab, main frame, project, and action:

- a sanitized fingerprint for the clicked card's detail-route UUID, recorded at trusted click time;
- the upscale request/response correlation that explicitly relates that source route UUID to one job ID, and that job ID to one output asset/result ID;
- the media request/response or object-URL creation evidence that explicitly relates that output asset/result ID to the selected-frame blob URL (compare exact values in memory; retain only scoped fingerprints/equality flags);
- the existing selected-frame `Page.downloadWillBegin` record and exact Chrome DownloadItem ID/URL comparison, so the final output-to-blob-to-download edge remains exact and unique.

Record only bounded event types, relation/equality outcomes, and scoped fingerprints; do not persist raw URLs, signed parameters, tokens, or raw media identifiers. The capture must show each edge directly, not infer it from the filename token, title, timing, or a shared download. Until those links are observed, ID `2790` remains **Complete / Association Unverified**. No matching rule changed, and no upscale or download was triggered. P11.2 remains pending; P11.3 remains out of scope.

## P11.1 opt-in route-asset identity capture readiness - 4 November 2026

### Flow surfaces and trace boundary

Source review confirms Flow's `/project/<project>/edit/<UUID>` route is its project-scoped read-only asset detail route. `providerRoute.ts` retains the project as the canonical target and intentionally strips this UUID, so the P11.1 capture must fingerprint the detail UUID separately while staying bound to the already verified project, tab, document, main frame, and trusted action.

The existing debugger surface captures selected-main-frame `Network.requestWillBeSent` URL metadata for Media/Fetch/XHR, `Page.downloadWillBegin`, and exact in-memory URL equality to Chrome DownloadItems. It does not receive request/response bodies, parse job or result metadata, or observe which bytes are passed to `URL.createObjectURL`. The asset route UUID can therefore be compared to UUID path components on action-time request/download URLs, but a job ID in a JSON payload or a source relation held only in response data is not currently visible.

### Temporary opt-in trace

Added an unchecked **Capture sanitized /edit asset path identity** option to the existing one-observation arm. When enabled, the trusted More options click captures only a session-scoped SHA-256 fingerprint of the current Flow detail-route UUID, after validating that the route is for the selected project. The selected main-frame request URLs, page download URL, and Chrome URL/final URL are independently examined in memory for UUID path components. Persisted values are only full-length scoped fingerprints; raw route values, URLs, signed parameters, and tokens are not added to this evidence. The trace is bounded by the existing one-shot session, request/download caps, selected document/frame checks, and expiry.

The new display is separate from association. It reports whether the route UUID appeared in an action-time request path and whether that same UUID appeared in a selected-main-frame `blob:` download URL with an exact Chrome DownloadItem URL match. It never substitutes the route UUID or filename for the existing association evidence and does not change the production matcher.

### Offline regressions and remaining stop

Focused fixtures verify that an unrelated action request/output ID plus an otherwise exact page-event-to-Chrome-ID pair leaves the route trace unlinked; a route-matching request with a different blob path ID stops at `blob_id_not_observed`; and the direct route-ID-on-blob-path case requires a selected-frame after-action blob event plus an exact Chrome URL/ID pair. The latter is a synthetic positive case, not evidence that Flow uses this URL shape.

Capture readiness is partial. It can test route UUID -> action request URL path ID. It cannot prove that such a request is an upscale job or output asset when the relation is only in request/response metadata, because the observer does not capture those bodies. It can test output asset ID -> blob only when the exact route asset UUID is present in the page-created blob URL path and the existing exact Chrome URL comparison succeeds. For an opaque/random blob UUID, capture stops at the page blob URL; proving which output bytes created it would require a separate bounded response-body/blob-content fingerprint link, which is not implemented here.

- Focused identity/worker tests: **2 files / 21 tests PASS**.
- Typecheck, full ESLint, production package build, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw27jykf`**, four JavaScript bundles.

No live capture, upscale, or download was performed. Chrome ID `2790` remains **Complete / Association Unverified**. P11.1 is not live-verified; the next controlled run would only test whether Flow exposes route identity in URL paths. P11.2 remains pending; P11.3 remains out of scope.

## P11.1 arm-time Flow detail-route preflight - 4 November 2026

### Sampling cause

The prior opt-in route fingerprint was sampled only in `installFlowGalleryDownloadObserver` after a trusted More options click on a recognized card owner. It was not sampled by `arm()` and there is no route-navigation listener. Before that menu click, `selectedCard.assetPathFingerprint` was unset, so the route trace correctly displayed `route_not_observed`; that status did not establish that the open tab lacked an `/edit/` UUID. The live report does not say whether More options had already been clicked, so this source cause explains the pre-click state but does not reconstruct the exact live sequence.

### Read-only arm preflight

The opt-in capture now fingerprints the `/project/<selected-project>/edit/<UUID>` route from the same current tab URL that passed selected Flow target validation, before debugger attachment or page-observer installation. It stores only the session-scoped fingerprint and a bounded `matched`/`not_matched` status. A route only matches when it is the recognized Flow detail route and its project segment matches the verified selected project. The dashboard exposes only **Match** or **No match**, never the UUID or fingerprint.

When More options is clicked, the page observer samples that route again and sends only its scoped fingerprint. The worker compares it to the arm-time fingerprint and retains only the equality status. A route that changed, disappeared, or moved to another project reports **No match** before a quality action can be accepted. There is still no continuous navigation listener; the arm-time status is immediate and the second check occurs at the menu-opening click. The diagnostic remains passive and the association classifier is unchanged.

### Regression and checks

The worker integration fixture arms on a synthetic verified `/edit/` route, confirms the arm-time preflight is matched before any menu or quality action, verifies the UUID is absent from the persisted snapshot, then sends a matching menu observation and checks the equality status. Unit coverage rejects a non-detail project URL and a route from another project. The existing unrelated output/blob-chain regressions remain in place.

- Focused Flow diagnostic tests: **2 files / 21 tests PASS**.
- Typecheck, full ESLint, production package build, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw26ia9k`**, four JavaScript bundles.

The live run was not repeated. Chrome ID `2790` remains **Complete / Association Unverified**. The next menu-only check can confirm the arm-time **Match** status and that it remains matched after opening More options, then stop before any quality selection. No upscale or download occurred. P11.2 remains pending; P11.3 is out of scope.
