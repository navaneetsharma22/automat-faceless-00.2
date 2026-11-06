# P11.1 Google Flow download feasibility diagnostic

## Scope and evidence provenance

This note combines the user-provided Flow observations below with offline implementation and test evidence. No live Chrome tab was inspected or changed in this task, and no upscale or download was initiated. The controlled live association run remains **NOT_RUN**.

The offline package produced by this task is **`automat-faceless-0.1.0-mw0vqugh`**. It has not yet been loaded or confirmed in Chrome.

## P11.1 offline follow-up Ã¢â‚¬â€ 4 November 2026

The user reports that build `automat-faceless-0.1.0-mw0vqugh` was armed for Flow tab `1957329822`, and that Chrome history showed `animate_d35cfe17_1080p.mp4` (5.0 MB) after a newly generated clip. The diagnostic reported `interrupted`, no card owner/menu binding, no native action, and no candidate MP4/WebM. The exact Chrome download ID and the association with the observed action remain unverified. This is user-supplied live evidence; Chrome remained inaccessible during this offline follow-up.

Source review found two confirmed diagnostic gaps. First, the manager has two paths to `interrupted`: a debugger `onDetach` handler that called `finish(..., "interrupted")` without retaining a cause, and status resolution when an exactly associated Chrome download is itself interrupted. The record now carries bounded `debugger_detached` or `matched_download_interrupted` causes. The reported live interruption cannot be attributed to either path from the supplied snapshot alone.

Second, Chrome `downloads.onCreated` candidates were already stored independently from Gallery action verification, but the report did not count received events or video candidates omitted after the six-candidate cap. Those bounded counters are now visible, alongside a bounded last Gallery capture issue. A debugger detach previously ended active capture before a later Chrome download event could be recorded. The interrupted diagnostic now continues collecting Chrome lifecycle evidence through its original expiry while the reason is `debugger_detached`; the record stays interrupted and any late candidate stays unassociated without the strict identity chain. The next run can distinguish a received non-video event, a stored MP4/WebM candidate awaiting association, and capacity omission. A zero event count still cannot distinguish an event that never occurred from one the browser did not deliver to the listener; the new listener registration is a precondition of arming.

The passive page observer listens in capture phase, checks the trusted click's composed path, normalizes `downloadDownload`, and resolves each `aria-controls` value at the relevant menu step. Its menu query is deferred to a microtask after the Download-row click so the dynamically created quality submenu can appear. The browser fixture replaces the main menu with the quality submenu between clicks and removes the quality menu immediately after the trusted quality click is handled. It confirms the click is received and accepted in that structure. It does not establish what the live Flow page emitted during the reported run; capture issue diagnostics now report expected-stage target/control/menu recognition failures when observed.

Final offline checks: focused diagnostic tests **2 files / 9 tests PASS**; typecheck, ESLint, production build/package validation, and `git diff --check` **PASS**. Final build: **`automat-faceless-0.1.0-mw1ix2hs`**, four JavaScript bundles. Live verification remains **NOT_RUN**. P11.2/P11.3 remain out of scope.

For the next live run, load and confirm build `automat-faceless-0.1.0-mw1ix2hs`, arm on the intended Flow tab, and perform one manually authorized Gallery action. The report should show whether the trusted action was captured, the last bounded capture issue if not, the main and quality menu bindings, Chrome created-event count, candidate count/omission count, and any stored candidate basename/state. If debugger detach precedes Chrome's download event, the report should retain the debugger cause and still capture the late Chrome candidate. Keep a candidate unassociated unless the strict selected-frame/action-media/Chrome ID chain is present. Do not repeat the action because the result is unverified.

## Previously collected Flow evidence

- In Gallery Ã¢â€ â€™ Videos Ã¢â€ â€™ a clip's More options Ã¢â€ â€™ Download, **1080p Upscaled** was visible and enabled for a 720p clip.
- The More options control is hover-dependent and its `aria-controls` identifies the main menu. The expanded Download row has its own `aria-controls` for the quality submenu. The diagnostic resolves both control IDs from the live DOM instead of hard-coding them.
- The Download row can render raw text as `downloadDownload` because its icon contributes text. The diagnostic normalizes the in-memory label and checks for the `download` substring; it does not save the label.
- A manual Edit View upscale produced a Chrome download after processing. The resulting MP4 was reported as **1920 Ãƒâ€” 1080 at 24 fps**.
- For that Edit View run, route ID `5b16d176-835d-43af-a177-f72457f2ac92`, media request evidence, and the downloaded filename were separately reported. The request and filename shared prefix `8c53eca2`. The Gallery card did not expose a usable stable ID in the inspected attributes, and its video source did not contain that prefix. These observations do **not** establish a Gallery-card-to-download-ID association.

The verified Edit View file properties are a separate historical observation. The new diagnostic does not inspect or verify a saved file's dimensions, frame rate, or playability.

## Offline diagnostic behavior

The Flow-only diagnostic is available under **Advanced details Ã¢â€ â€™ Flow Gallery upscale diagnostic**. It arms against the currently selected, currently verified Flow tab and its exact document binding. It captures one trusted click on the selected card's More options menu path, records whether the card owner was found and whether a stable-ID attribute existed, resolves the two dynamic `aria-controls` bindings, and records whether 1080p Upscaled was present and enabled. It never prevents or synthesizes a click.

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
3. In that same Flow tab, hover the one target Gallery clip and manually choose **More options Ã¢â€ â€™ Download Ã¢â€ â€™ 1080p Upscaled** once. The extension only observes the native clicks; it does not choose the quality or initiate the upscale/download.
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

The user reports build `mw1mmq40` on Flow tab `1957329822`. The trusted click path began at `mat-icon` Ã¢â€ â€™ More options button; `flow-video-tile` was at composed-path index 8 and the enclosing `flow-grid-tile-container[role=group]` at index 11. `productionClosestOwnerFound` was false and the then-current composed-path owner count was zero. `aria-controls` was absent at capture. Separate live inspection verified that opening More options links the trigger to the main menu and hovering Download links the row to a distinct quality submenu. These are user-supplied live observations; they were not independently reread in Chrome during this offline implementation.

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
- `Tyrannosaurus_breathing_and_shifÃ¢â‚¬Â¦_14ae0c64.mp4`
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

1. **Route clip Ã¢â€ â€™ upscale job/output asset:** no capture explicitly records the supplied route UUID as the source of an upscale job, or maps that job ID to a returned output asset/result ID. The filename token is separate and does not fill this link.
2. **Output asset Ã¢â€ â€™ downloaded blob:** no capture maps a returned output asset/result ID to the media response or blob URL that produced the download event for Chrome ID `2790`. The reported blob URL Ã¢â€ â€ Chrome download mapping reaches the browser download record, but by itself does not identify the clip or output asset.

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

## P11.1 separate arm/menu route status and detail-view observer review - 5 November 2026

### Route-stage diagnostics

The dashboard now displays two independent sanitized fields when the opt-in route identity capture is enabled. **Clip route at arm** reports `Match` or `No matching /edit/ UUID`. **Clip route when menu opened** reports `Not checked`, `Match`, `Changed or missing`, or `Not comparable (no matching /edit/ UUID at arm time)`. The second value is sampled from the current same-document URL when the Gallery More options menu resolves. It is not a continuous route watcher. The worker stores only the scoped route fingerprint and fixed status values; raw URLs and UUIDs are not included in the dashboard report or diagnostic logs.

The worker fixture arms first on a verified project URL with no matching detail UUID, then stops and re-arms on one synthetic detail route. It verifies `no_matching_edit_route` at arm, `matched` for the same clip at the menu stage, and `changed_or_missing` when the menu event carries a different clip UUID fingerprint. The same-clip fingerprint matches exactly; the other clip fingerprint is rejected. These are synthetic identity/status regressions and do not prove a live Flow card-to-route relation. Download association rules are unchanged.

### Detail-view and Gallery-link review

Read-only source and existing-fixture review confirms the current observer starts only from a trusted control whose normalized label includes `More options`, finds a Gallery card owner, then follows the bound Download submenu and its quality menu. It does not recognize a direct `Download media` control on an `/edit/` detail view as an entry point. No checked-in detail-view DOM fixture demonstrates that control opening a quality menu, and the control was not activated.

The observer does not inspect Gallery-card `href` or other links to derive the card's `/edit/` UUID. It reduces ID-like card attributes to a boolean, while the arm/menu UUID fingerprints come from the selected tab's current route. No existing fixture or captured live DOM establishes a reliable exact-card-to-route link. **Blocker:** without a demonstrated link, route identity cannot be attributed to the exact Gallery card; Gallery-to-detail identity remains **NOT_VERIFIED**. A live detail control/menu behavior check and exact-card route-link evidence remain outstanding. No route identity was inferred from title, order, tab ID, or prior navigation.

### Checks and boundary

- Focused Flow diagnostic tests: **2 files / 21 tests PASS**.
- Typecheck: **PASS**; ESLint: **PASS**; production package build and shared build-ID validation: **PASS**; `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw2wlegj`**, four JavaScript bundles.

No live browser interaction was performed. The supplied menu-only result remains stopped before quality selection with zero downloads. No upscale, download, or P11.2 work occurred. P11.1 is not live-verified; P11.2 remains pending and P11.3 remains out of scope.

## P11.1 normal clip navigation card-to-route check - 5 November 2026

### Build and observation availability

Checked the packaged extension files for build `automat-faceless-0.1.0-mw2wlegj`; the ID is present in the worker, connection probe, and the current dashboard/download bundles. The connected browser inventory returned no browser tabs or apps, so this build could not be confirmed as loaded in a live Flow tab. No normal clip navigation or two-card comparison was possible in this session.

### Available signal and blocker

Source review finds one candidate signal: the observer fingerprints the current same-tab `/project/<project>/edit/<UUID>` URL at the More options event, and the worker compares it with the route captured at arm time. That can distinguish a same-route observation from a changed/missing route. However, the Gallery owner check retains only whether an ID-like attribute exists; it does not retain its value or inspect an anchor/link from that exact card to the detail route. No live observation establishes that navigating from a specific Gallery card changes the URL to that card's UUID or that the same relation can be rechecked at More options.

**Blocker:** exact Gallery card Ã¢â€ â€™ `/edit/` UUID identity is not demonstrated. The route fingerprint alone is not sufficient evidence that it belongs to the exact card. A read-only run with build `mw2wlegj` must compare two cards through normal navigation and observe a clip-specific card signal that remains checkable when More options opens. Until that evidence exists, card-to-route identity remains **NOT_VERIFIED**. No title, position, tab ID, or previously visited route was used as a substitute.

No Flow page was opened or navigated, and no menu/control was activated. No quality selection, upscale, download, association-rule change, or P11.2 work occurred. P11.1 remains not live-verified.

## P11.1 read-only Flow detail clip import proof of concept - 5 November 2026

### Import behavior

Added a Flow clip import panel to the existing dashboard diagnostic surface. Import is available only for the currently selected, currently verified Flow document and an exact `/project/<projectId>/edit/<clipUUID>` detail route. The worker rechecks the selected tab/project connection, targets its verified document ID for a read-only DOM inspection, validates the page route identity against the tab route, then checks the tab route again before storing the row. Missing clip identity, a different project, or a route/document change fails visibly without adding a row.

The in-page inspection reads a title from the existing heading/Open Graph/document title and metadata from the largest already visible image. It does not issue a network request or read the video element/file. Thumbnail URLs and signed query parameters are not returned or stored; only availability, dimensions, and an optional fingerprint of origin plus path are retained. Each row stores a deterministic key from Flow project ID plus clip UUID and a clean detail URL without query/hash. The title is display text only. Reimport updates that row while preserving its original import time; two clips with the same title remain separate. List readback validates each row's stored detail URL against its own project and clip identity and exposes the exact Flow link.

### Checks and live status

The user reports that live Flow inspection found two Gallery cards with the same title but different detail-route UUIDs in one project. That user-supplied observation motivates the project-plus-UUID key; the POC imports and deduplication were not exercised against those live pages in this session.

- Offline repository/worker and DOM fixtures: **3 files / 6 tests PASS**. They cover two same-title clips with different UUIDs, reimporting one without duplication, exact route verification, rejection of mismatched project/clip routes, missing clip UUID, thumbnail metadata extraction, omission of raw URL/query token, and zero `fetch` calls.
- Typecheck: **PASS**; ESLint: **PASS**; production build and shared build-ID validation: **PASS**; `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw2y72ln`**, four JavaScript bundles.

Live two-clip import/reimport verification: **NOT_RUN**. The connected browser inventory contained no tabs or apps, so neither of the two Flow detail views could be imported in the live dashboard. The synthetic fixtures do not establish that Flow's current live DOM exposes the title and thumbnail metadata in the same shape. No automatic Gallery scan, full-video fetch, quality selection, upscale, download, or P11.2 work occurred. P11.1 is not live-verified.

## P11.1 single-row Download 1080p proof gate - 5 November 2026

### Row binding and click boundary

The imported row for the requested target clip is the only row rendered with a **Download 1080p** action. The dashboard sends that exact row key only after the user clicks its button. The worker looks up the stored row, validates its project-plus-clip route, rejects any clip outside the fixed single-row allowlist, and revalidates the selected Flow target and `/edit/` route before inspecting the same verified document. It also compares the page's reported project and clip identity and rechecks the tab route after inspection. The other same-title clip is refused before `executeScript`, so it cannot trigger this action. The negative fixture uses a synthetic UUID with the supplied `bbc2bc82` prefix because the request abbreviated the full ID.

The page probe only inventories visible button/menu labels such as `Download media` and `1080p`; it does not click, fetch, inspect media bytes, or start an upscale/download. An observed control label does not prove its behavior. The browser download association classifier and its rules remain unchanged.

### Stop conditions and Saved evidence

Source/evidence review still does not verify a detail-page 1080p control's activation semantics. It also does not provide an explicit link from the selected `/edit/` clip UUID through a Flow output/result asset to the MP4 bytes delivered to Chrome. Consequently the proof action stops with one of these sanitized control blockers: no matching visible control, or a visible control whose semantics remain unverified. In both cases output-to-clip identity is reported **Unverified** and no Saved status is available. A completed browser download, filename pattern, or timing alone is not sufficient. The Saved predicate fixture requires a completed MP4 and exact equality of both selected/output project ID and selected/output clip UUID.

### Fixtures, checks, and live procedure

- Focused Vitest: **2 files / 6 tests PASS**. Fixtures cover two same-title rows where only the selected UUID is admitted, rejection of the other imported clip before page inspection, a visible `Download media` control read without activation, and rejection of incomplete or mismatched output evidence for Saved.
- Typecheck, ESLint, production package build and build-ID validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw2z2289`**, four JavaScript bundles.

Live check remains **NOT_RUN**; no Flow tab was available for route/control inspection. Manual test for this build: load the package, select/verify the Flow tab for the imported target, confirm that tab is on the target row's exact detail route, and click **Download 1080p** on that target row. Record the displayed sanitized route/control/output statuses, then stop. Confirm no quality selection occurred and Chrome reports zero new downloads. The second same-title row should have no Download 1080p button. Do not continue to an upscale or download until a safe 1080p action and a direct output-to-clip identity link are independently verified. P11.2 was not started.

## P11.1 detail-page Download media menu recognition - 5 November 2026

### Recognition boundary

Extended the single-row proof check to inspect the exact selected `/edit/` page after revalidating the imported Flow project and clip route. It does not activate the provider control. Recognition requires one visible Download media control, one `aria-controls` ID on that control, exactly one visible DOM element with that ID, and one enabled `1080p Upscaled` button/menu item inside that controlled element. The 1080p label elsewhere on the page, an unbound popover, ambiguous IDs/controls/items, a disabled option, or a closed menu fails with a fixed sanitized blocker. No raw URL, project UUID, clip UUID, menu ID, or token is returned by the page inspector. Download association rules remain unchanged.

The user-supplied screenshot visibly shows `720p Original size` and `1080p Upscaled` in the menu. The connected browser inventory was empty (`apps: []`, `browsers: []`), so there was no live DOM access to verify the menu's actual ARIA relationship. The implementation therefore treats that relation as a runtime condition; live DOM binding remains **NOT_RUN** and is not claimed from the screenshot alone.

### Offline verification and manual live check

- Focused Vitest: **2 files / 7 tests PASS**. Fixtures cover exact route binding, recognition inside the `Download media` controlled menu, rejection of the same 1080p label outside that menu, and rejection of the other imported clip before page script injection.
- Typecheck, ESLint, production build/build-ID validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw2zjzhw`**, four JavaScript bundles.

Manual live check: load `mw2zjzhw`; select/verify the Flow tab for the target imported clip; confirm its exact detail route; open its Download media menu; click **Check 1080p menu** on that row; confirm the result reports the controlled menu and enabled 1080p Upscaled item. Stop before selecting a quality. The other same-title row must not invoke the page inspector or report recognition. No quality selection, upscale, download, or P11.2 work occurred.

## P11.1 one-shot detail-menu selection and download lifecycle capture - 5 November 2026

### Arm and exact selection boundary

The selected target row now arms a one-shot observer only after worker revalidation of the imported project-plus-clip row, current verified Flow tab/document, exact detail route, and page identity. At arm time, the detail page must have one visible Download media control whose unique `aria-controls` target is visible and contains one enabled 1080p Upscaled item. The page observer then waits for a trusted user click on 1080p Upscaled inside that same controlled menu. At click time, it fingerprints the route UUID and the worker requires equality with the arm-time route fingerprint before accepting the selection. The observer is passive: no selection or provider action is synthesized.

The user reports that the prior live menu check passed. The connected browser inventory in this implementation session returned no apps or tabs, so no live selection or download was performed.

### Separate result fields

- **Clip association / path evidence:** a separate route-asset trace compares the arm/selection route fingerprint with UUID path components in action-time request URLs and page download/blob URLs. The capture retains only scoped fingerprints and reports whether a path-ID trace exists. It does not inspect response bodies, identify a Flow upscale job/result asset, or link output bytes to the clip. Therefore clip association remains **Unverified**, even if route-path evidence appears. The existing Gallery-card association rule was not changed and remains unverified in the detail route mode.
- **Download completion:** after a trusted selection, the diagnostic requires one selected-main-frame Page.downloadWillBegin record and one exact raw-URL equality to a Chrome DownloadItem, compared in bounded memory. It tracks only that exact DownloadItem ID to `in_progress`, `complete`, or `interrupted`. Filename/timing does not supply the association.
- **File resolution:** for a unique exact download ID after Chrome reports `complete`, the worker calls `chrome.downloads.search({id})` and retains only whether the file exists, is missing, or cannot be resolved. The path is not retained, and the file bytes/codec are not inspected.

### Checks and manual test

- Focused Vitest: **4 files / 29 tests PASS**. Fixtures cover selected-clip route matching, other-row rejection before injection, trusted detail-menu selection, evidence separated from Gallery association, exact page-event/Chrome URL pairing, completion, and file resolution.
- Synthetic Edge browser observer fixture: **1/1 PASS**. It confirms the exact bound detail menu emits the selection message and the same label outside that menu is ignored; no Flow provider page or download was used.
- Typecheck, ESLint, production build/build-ID validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw30ocfv`**, four JavaScript bundles.

Manual live test: load build `mw30ocfv`; select/verify the imported target clip's Flow tab and exact detail route; open the Download media menu; arm from that target row; confirm Armed; manually select 1080p Upscaled once; then wait for readback of clip-to-output path evidence, download completion, and file resolution. Stop after readback. If any result is missing or uncertain, leave it unverified and do not repeat the selection. Do not use the other same-title row except to confirm it is blocked. No live selection/upscale/download occurred in this implementation step; P11.2 remains unstarted.

## P11.1 supplied completed capture and metadata-structure probe - 5 November 2026

### Supplied run evidence

For clip `c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa` in project `000936e1-dc7a-4421-988b-d4c66a804aed`, the user reports: exact clip route matched at arm and selection; a trusted 1080p Upscaled selection occurred in the bound detail menu; the selected-main-frame blob URL exactly matched Chrome download ID `2792`; Chrome reported the download complete; and Windows Properties for `make_it_d8d91f05_1080p (1).mp4` showed 1920Ãƒâ€”1080, 24 fps, and displayed duration 00:00:03. These are user-supplied live observations, not observations made by this offline implementation task.

The blob URL equality explicitly links the selected-frame browser download event to Chrome download ID `2792`. Completion and the reported file properties describe that downloaded output. The available run evidence does **not** include request/response metadata or a direct output-asset-to-blob provenance record. It therefore does not yet explicitly link the selected clip to the Flow upscale job/result that produced the blob. A shared filename token, route match, or temporal proximity would be a hypothesis and does not fill this evidence gap. No run-specific metadata capture for this clip or download ID exists in the workspace.

### Opt-in bounded metadata capture

The target row's one-shot arm action now enables a structural metadata probe for that detail-clip session. The trusted selection handler rechecks the exact route and sends its already scoped route fingerprint immediately, without waiting for another hash operation. Metadata capture begins after the worker accepts that selection and is restricted to at most 12 selected-main-frame Fetch/XHR requests, at most 64 KiB per JSON body, eight object levels, 16 array entries per level, and 48 retained ID-shaped fields. The existing 20-minute capture expiry applies. It examines request `postData` when CDP provides it and retrieves JSON response bodies only after `Network.loadingFinished`; base64 bodies, oversized bodies, and unavailable bodies are omitted.

No Flow-specific request schema is assumed. The probe retains sanitized field paths, request/response roles, value kinds, session-scoped fingerprints, and computed equality flags against the route UUID, the opposite request/response role within the same request, and selected-frame blob URL path IDs. Raw JSON values and body text are discarded after fingerprinting; raw URLs, URL parameters, and tokens remain outside storage and logs. This generic structure discovery is intended to reveal the live field shape before any Flow-specific ID extraction or interpretation is designed. A missing field, omitted body, or opaque blob path remains unlinked.

The diagnostic now labels the prior file check **Chrome file-exists check** and states that it reflects Chrome metadata, not decoded media. The imported row's status text uses the current diagnostic state, so completion no longer leaves a stale Ã¢â‚¬Å“ArmedÃ¢â‚¬Â message. The diagnostic remains Flow-only; Vids Downloads were not changed.

### Offline validation and remaining live check

- Focused Vitest: **3 files / 26 tests PASS**. Coverage includes nested request/response ID field discovery, same-request job-field equality, route/blob equality, privacy of retained values, existing single-row guards, and download lifecycle evidence.
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- Targeted Playwright observer fixture: **NOT_RUN** because its configured Chromium executable is absent.
- Final build: **`automat-faceless-0.1.0-mw35ibrf`**, four JavaScript bundles.
- Live selection/upscale/download during this implementation task: **NOT_RUN**. The synthetic field structure does not establish Flow's actual live schema.

Remaining live check: in a future explicitly authorized one-shot run on the same target clip, load `mw35ibrf`, arm from the exact imported row with the bound detail menu open, and make one user-initiated 1080p Upscaled selection. Read the sanitized field roles/paths and equality flags to see whether the source clip ID appears in metadata, whether a request/response relation identifies a job and output asset, and whether that output fingerprint equals a blob-path ID or has another direct provenance link to the selected-frame blob. Stop after readback; if any edge is absent or ambiguous, retain **clip-to-output mapping unverified** and do not repeat the selection. The already supplied completed run remains complete for Chrome download ID `2792`; this follow-up is needed only to establish the missing clip-to-output mapping. P11.2 remains unstarted.

## P11.1 detail observer lifecycle and run 2795 review - 5 November 2026

### Supplied run and body sample availability

The user reports that Chrome download `2795` completed and its blob URL exactly matched the selected-main-frame page event, while the detail observer remained Armed and the worker received no quality action. The run also reports three JSON-category responses classified as `prefix_candidate` and failing parsing, with form request bodies marked unsupported. These are supplied run results. No raw or in-memory body sample from 2795 is available in the workspace or current session, and the extension does not persist body text. `prefix_candidate` is only a bounded heuristic label; it does not establish a Flow prefix or framing format. No decoder or field interpretation was added.

### Confirmed observer behavior and diagnostic gap

At arm, the worker injects the production observer into the bound document and accepts the arm only when installation succeeds and the current detail menu plus enabled option are found. The successful `Armed` status therefore confirms arm-time installation/preflight. It does not prove the listener was still present at the later click.

The detail path uses its own document capture listener. It re-queries the current route, `Download media` trigger, `aria-controls`, menu visibility, and option on each trusted click; it does not hold the original menu or option element. A valid replacement/reopening should continue to work if that live binding is still valid. Before this change, failed click checks silently returned. The detail path did not emit `quality_click_listener` or Gallery rejection events, although the UI displayed that Gallery-only diagnostic for detail captures. Thus run 2795's displayed Ã¢â‚¬Å“not reachedÃ¢â‚¬Â state could not establish whether the detail listener ran.

The new detail diagnostics retain the arm install/replaced result, observer lifecycle changes (`replaced` or page hidden), and a bounded count plus the last scoped click observation. A candidate/menu click records only route-match, current-menu binding, bounded option/candidate counts, candidate membership/enabled state, and a fixed decision. It retains no clicked text, URLs, IDs, or body data. A worker-received `detail_clip_selection` remains separately visible as the accepted action.

### Production observer fixture and parse status

A focused production-function fixture waits after install, replaces and reopens the controlled menu, invokes the stale detached option path and verifies rejection, then invokes the current option and verifies acceptance. It also replaces the observer and verifies the prior observer reports the lifecycle change. This confirms the observer logic handles a valid replacement/reopening in the fixture; it does not prove the live Flow menu emitted the same structure in run 2795.

The supplied `prefix_candidate` results do not provide body bytes or excerpts. The current classification means a JSON opener was detected shortly after leading content, while the whole string did not parse as JSON. It cannot distinguish a real protocol prefix from other leading text, malformed content, or framing. Form bodies are deliberately unsupported; they are not decoded or interpreted. No Flow format is claimed. Whether any of the captured requests were media-delivery requests or unrelated same-frame page traffic also remains unknown from the sanitized run summary.

Run 2795's exact blob-to-page-event-to-Chrome-download evidence remains separate. It does not establish a trusted quality action, clip-to-output association, or output-to-blob provenance. Keep clip-to-output **Unverified** and Vids Downloads unchanged.

### Validation and remaining check

- Focused Vitest: **2 files / 26 tests PASS**. Worker integration verifies install receipt and that a rejected detail click diagnostic is retained without marking an action received. Unit fixture exercises the production observer after delay, during a stale option click after menu replacement, and after reopening with the current option.
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- Production Playwright fixture: **NOT_RUN**; the configured Chromium headless executable is absent. No browser was installed.
- Build: **`automat-faceless-0.1.0-mw3867q8`**, four JavaScript bundles.
- Live selection, upscale, and download: **NOT_RUN**.

Next precise check: on one future explicitly authorized run, load `mw3867q8` on the same bound project/clip and arm while the detail menu is open. After a delay and any menu replacement/reopening, inspect the arm install/replaced receipt and lifecycle. If a 1080p candidate click is made, read its detail-specific listener decision and whether the selection reached the worker. Read the three response format diagnostics and form-body rejection categories without storing body content. Stop after readback; do not repeat if any stage is missing or ambiguous. No action from run 2795 can be reconstructed retroactively.

## P11.1 body parse and format diagnosis for run 2794 - 5 November 2026

### Supplied counts and source interpretation

The supplied run 2794 counts are: 5 eligible/admitted requests, 0 cap omissions, 3 request bodies read, 3 response bodies read, 0 successful and 6 failed JSON parses, 0 pending requests, and 0 accepted identity fields. Exact selected blob URL to Chrome download ID `2794` equality succeeded. These are user-supplied observations; no live inspection occurred in this task.

No raw body or captured sample for run 2794 is available in the workspace or current in-memory evidence. The extension intentionally persists no body text or scalar values. The evidence contains only summary counts, so prefix/envelope/framing/non-JSON causes cannot be distinguished retrospectively.

From source and those counts, the six failed parses correspond to six calls to `JSON.parse` on the three request and three response body strings. This is an implementation-based inference: request bodies were parsed without checking Content-Type; responses were parsed only after a coarse MIME check for `json` or `graphql`. An oversized body would have been filtered before parsing, and a response with `base64Encoded: true` would have been counted unsupported and skipped, so neither path explains one of the six parse failures. Given the supplied totals, the three response bodies were not flagged `base64Encoded: true`, and each string was within the old 64 KiB JavaScript-string-length limit. The response flag being absent would have been treated like `false` by that implementation. The failure category and actual structure remain unknown.

The old response path did not decode base64; it conservatively rejected it before JSON parsing. That avoided parsing a base64 representation as JSON, but persisted neither the flag nor a format reason. The request path ignored Content-Type, while the response path used a broad `json|graphql` MIME regex and retained no MIME category. Eligibility only required same-main-frame Fetch/XHR since arm; it did not establish that the requests served media delivery. The five eligible requests could include ordinary page traffic. The run's counts and zero fields cannot distinguish those cases.

### Bounded format diagnostics added

Each inspected body now retains only its stage (`request_body` or `response_body`), an allowlisted MIME category, the known `base64Encoded` flag, bounded UTF-8 byte length, generic format category, and fixed parse-failure category. No MIME string, body excerpt, scalar value, request ID/token, or raw URL is stored. Up to 24 body diagnostics are retained, corresponding to 12 admitted requests with at most request and response bodies. The byte count saturates at 65,537 to signal that the 64 KiB inspection cap was exceeded.

Declared JSON and missing-MIME bodies are parsed as JSON; explicit non-JSON MIME categories are marked unsupported without attempting JSON parsing. Parsed structures are labeled only as JSON object, array, or scalar. Failed parses may be labeled as a generic prefix/framing candidate when a JSON opener appears shortly after leading content; this is a heuristic category, not a confirmed Flow format. `base64Encoded: true` remains unsupported and is reported as such. No decoder was added because no real captured sample demonstrated a format to decode. Synthetic fixtures verify categories and rejection only; they do not establish Flow's live format.

Clip-to-output mapping and output-to-blob provenance remain unverified. Run 2794's exact blob-to-Chrome-download equality does not supply either missing link. No Flow field names or ID relationships were inferred, and Vids Downloads were not changed.

### Validation and remaining live check

- Focused Vitest: **2 files / 25 tests PASS** (`npx vitest run --configLoader native --pool=threads --maxWorkers=1 tests/unit/flowDownloadDiagnostic.test.ts tests/integration/flowClipDownloadProof.test.ts`). Fixtures cover allowlisted MIME categories, JSON and prefix-candidate format labels, UTF-8 byte length, and base64/non-JSON rejection without decoding or retaining raw body content.
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- Build: **`automat-faceless-0.1.0-mw37drkd`**, four JavaScript bundles.
- Live body inspection/provider action: **NOT_RUN**. No sample exists for run 2794.

Smallest remaining live check: with build `mw37drkd`, run one explicitly authorized capture on the exact project/clip, arm before the manual quality selection, and read back only the format diagnostics and counters after response completion. That run must produce real body categories before any decoder is considered. Request relevance remains unknown unless the live capture supplies direct evidence tying a request to the selected output; do not infer it from Fetch/XHR type or timing. Do not repeat the selection if the format is still unsupported or ambiguous.

## P11.1 metadata zero-count interpretation and response-drain follow-up - 5 November 2026

### Supplied run 2793 and what its zero means

The user reports that Chrome download `2793` completed after the target route matched at arm and trusted detail-menu selection, and the selected-main-frame blob URL exactly matched that Chrome download. The existing action-time request list showed 3 retained / 0 omitted; the metadata trace showed 0 identity fields. These are user-supplied observations. The workspace has no request/response body records, field paths, or expanded counters for run 2793, so the summary cannot identify which capture stage yielded zero.

In the previous implementation, a zero was only `detailMetadataFields.length === 0`. It could mean no eligible post-selection request, no request body available, no JSON response body, an unsupported/oversized body, a body read or parse failure, or successfully parsed JSON with no accepted fields. The 3 retained action-time requests are the separate URL-fingerprint list, which may contain Media as well as Fetch/XHR; that count does not establish that three JSON bodies were seen or read.

The identity filter does **not** accept only UUID values. It accepts UUID-shaped strings under any field, plus string or numeric values up to 128 characters when the field key ends in `id`, `uuid`, `asset`, `job`, `result`, `clip`, or `media` (optionally followed by `id`). Those values are structurally tagged/fingerprinted; the code does not assert that any particular key is a Flow field or that values have job, result, clip, or output semantics. Thus 0 accepted fields is not evidence that no UUIDs or useful provider identifiers existed outside the captured/accepted bodies.

### Capture window, response completion, and pending work

The previous implementation admitted metadata only after the worker accepted the trusted quality-selection message. A Fetch/XHR request loaded before that click could be excluded. This is a confirmed cause of an observation gap; whether Flow loaded relevant metadata before selection in run 2793 is unknown. The opt-in capture now begins at arm while the debugger is attached, admitting same-main-frame Fetch/XHR requests through the existing bounded observation. It retains at most 12 requests, caps bodies at 64 KiB, and persists only sanitized field roles/paths and scoped fingerprints. The focused fixture captures a generic JSON request before selection and verifies its identifier is fingerprinted while the raw value is absent.

Response body retrieval is correctly triggered by `Network.loadingFinished`, after the response body is complete. Source review found a separate confirmed race: browser download completion caused immediate debugger detach even when an admitted request was still waiting for `loadingFinished`. The subsequent completion event then failed the active-session guard and its response body was lost. The fix keeps the debugger attached after download completion while admitted requests remain, captures their completed or failed result, and detaches once the pending map drains. If the existing observation expiry or an external debugger detach ends the drain, pending requests are counted as unavailable. Request completion is not inferred from download completion.

The current bounded counters separate: eligible same-main-frame Fetch/XHR requests seen since arm; requests admitted/omitted at the 12-request cap; request bodies available/read; response body retrieval attempted/read; JSON parses succeeded/failed; parsed bodies with zero accepted fields; unavailable, failed, unsupported, and filtered bodies; and currently pending requests. Request `postData` is used when present, with `Network.getRequestPostData` as a bounded fallback when CDP indicates post data exists. Response retrieval remains at `Network.loadingFinished`. The existing 64 KiB body and 48-field caps remain. Only sanitized field paths/roles, scoped fingerprints, equality flags, and these bounded counts persist.

### Identity and output-to-blob limit

UUID equality between an arbitrary JSON field and the UUID-looking part of an opaque `blob:` URL is not direct provenance. It does not prove that the field names the produced asset or that the asset's bytes created that blob. The metadata trace reports such equality as a comparison only. It does not set association or Saved status. No Flow-specific body schema or ID relationship was added. Clip-to-output mapping and output-to-blob provenance remain **unverified**.

### Regression and validation

- Focused Vitest: **2 files / 24 tests PASS** with `npx vitest run --configLoader native --pool=threads --maxWorkers=1 tests/unit/flowDownloadDiagnostic.test.ts tests/integration/flowClipDownloadProof.test.ts`. The worker integration fixture completes the Chrome download while one selected-frame JSON response remains pending, verifies no premature debugger detach, then emits `Network.loadingFinished` and verifies body capture, counters, and detach after drain. It demonstrates that a pre-selection request since arm is admitted and fingerprinted, with no raw value retained, and counts a parsed no-ID body separately. Unit fixtures distinguish successful zero-field JSON, invalid JSON, unavailable input, and oversized input; an ID-keyed non-UUID value is accepted and fingerprinted without storing the raw value. The default forked Vitest runner hit Windows `spawn EPERM`; the single-thread run passed after selecting Vite's native config loader.
- Typecheck, ESLint, production build/package validation, and `git diff --check`: **PASS**.
- Final build: **`automat-faceless-0.1.0-mw36pcjn`**, four JavaScript bundles.
- Live inspection or provider action: **NOT_RUN**. The supplied run 2793 remains download-complete with clip-to-output mapping **unverified**.

Exact remaining live check: load build `automat-faceless-0.1.0-mw36pcjn`, arm the opt-in observer on project `000936e1-dc7a-4421-988b-d4c66a804aed`, clip `c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa`, with its bound detail menu open before the user makes one 1080p Upscaled selection. After Chrome completion, read the bounded counters and sanitized request/response field roles. Check whether observed fields directly connect the clip to a job/result and whether that output has direct provenance to the selected-frame blob. Stop after readback; do not repeat if either edge remains missing or ambiguous. The supplied run 2793 cannot be retroactively explained by the new counters.

No further live action is part of this change. On a future explicitly authorized one-shot capture, inspect the new stage counters first. A zero field count is meaningful as Ã¢â‚¬Å“parsed bodies had no accepted fieldsÃ¢â‚¬Â only when parsed-body and zero-field counts support that interpretation; otherwise use the separate unavailable/failed/unsupported/filtered counts. Any equality with an opaque blob UUID remains insufficient to claim output-to-blob provenance. Keep Vids Downloads separate; P11.2 remains unstarted.


## P11.2 dashboard single-clip implementation Ã¢â‚¬â€ 5 November 2026

Build `automat-faceless-0.1.0-mw39351k` adds a functional Download 1080p action for imported Flow detail clips, using the directly observed active navigation-thumbnail asset identity. The worker validates the exact row/project/route/document, resolves and opens the bound native menu, stores dispatch intent and sends one quality click. It tracks one exact selected-frame page event to Chrome download ID and distinguishes browser completion from output association and file dimensions. Flow Downloads and Vids Downloads now have separate tabs.

Ten focused test files / 95 tests, typecheck, ESLint and production/package validation passed. Live acceptance for this new build remains NOT_RUN. The implementation uses native Flow filenames and Chrome folder settings. Current-attempt tracking is implemented; batch downloading, per-row history, custom folder selection and output-to-blob provenance remain pending. The source archive omitted the root status/instructions and build configurations; build configurations were restored from the prior supplied P10.3 snapshot. See [single-clip implementation and operator steps](flow-single-clip-download.md).

### P11.2 Flow download injection and failure reporting correction - 5 November 2026

The confirmed Chrome scripting defect was fixed by replacing explicit `undefined` arguments with `null` for initial preparation and automatic download identity readback. Script preparation now takes a nullable expected asset ID with a null default. Tests enforce the JSON-serializable argument boundary, verify both call sites, verify injection rejection sends zero quality input, and verify native-input failure remains uncertain and blocks replay.

Failures retain fixed stage/code values and the native-input-attempted flag. Known Flow connection, route, document, and menu errors retain their specific codes. Unknown pre-input errors report preparation failure; unknown post-input errors report uncertainty. Persisted attempt evidence contains no raw exception text, URLs, or tokens. The complete P11.2 correction evidence and exact validation are in [flow-single-clip-download.md](flow-single-clip-download.md#p112-json-safe-injection-and-bounded-failure-reporting-correction---5-november-2026). Build `automat-faceless-0.1.0-mw3aodlh`. Browser checks **NOT_RUN**; no provider action occurred. Clip-to-output and output-to-blob provenance remain unverified; Vids Downloads were not changed.

### UI layout refresh - 5 November 2026

The extension now presents Flow and Vids as separate large provider cards in Downloads and Videos, with one workspace H1 and a selected-provider H2. Imported Flow clips use responsive cards, short identifiers, actual attempt messaging, explicit separation of Chrome download completion from association and file-exists metadata, a secondary Open in Flow action, a primary 1080p action, and collapsed row details. The 1080p action still calls the existing handler; no download code, association rule, permission, schema, or connection validation changed. Vids Downloads remains clearly unavailable. The live Flow/Vids actions were not used.

Build: `automat-faceless-0.1.0-mw3ckv3w` (four JS bundles). Focused UI/provider tests: 5 files / 28 tests pass; typecheck, lint, build/package validation pass. Playwright launched the existing dashboard cleanup test but that fixture failed its Images/mobile toolbar button-count assertion before reaching Downloads or Videos. Direct dev-server launch failed with `spawn EPERM`; new layout desktop/narrow browser inspection is NOT_RUN. No browser/live extension verification is claimed.

### Downloads compact provider and clip polish - 5 November 2026

The Downloads provider cards were shortened and now use a single selected border with a subtle tint; a separate outline appears for keyboard-visible focus. The Vids choice shows Unavailable and continues to reveal its explanatory panel. The Flow Downloads heading and list-derived count share a toolbar with Import open clip and Refresh list. Clip placeholders use a local 16:9 CSS frame and play icon. Current attempt status says Not started and the adjacent workflow text clarifies that earlier downloads are not tracked. The existing download behavior and guard remain unchanged.

Connection alerts now show the readable message without the fixed diagnostic code prefix. The bounded code is available in collapsed Connection details; alert display strips URL/query values.

Build: `automat-faceless-0.1.0-mw3d31tf`. Focused tests: 4 files / 22 tests pass; typecheck, lint, build/package validation, and diff check pass. A temporary local Chromium fixture inspected provider cards in Downloads and Videos at desktop and 390px, including selected Vids availability; imported clip row rendering was not available in the local preview and was not visually inspected. Live extension/provider verification is **NOT_RUN**. No upscale or download occurred.

## P11 Flow Videos navigation recognition correction - 5 November 2026

The user supplied sanitized Gallery DOM for the project root route: All media, Images, and Videos are native buttons; all three ARIA selection attributes are null; only Videos includes `mdc-list-item--activated`; Videos also includes focus-only classes `cdk-focused` and `cdk-mouse-focused`. The previous preflight recognized selection only through ARIA state, causing `videos_section_not_selected` before card discovery.

The focused change adds the observed activated class as selection evidence for a unique native Videos button in the project navigation group. Visible nested label text is normalized and resolved on the owning control; the observed All media/Images/Videos MDC button group provides the non-semantic navigation boundary, with semantic `nav`/`role=navigation` used when available. Existing ARIA selection signals remain supported. Focus alone, activated Images, duplicate Videos controls, and a Videos label outside the navigation group are rejected. The same unique selected node must remain selected after card discovery. Project, card identity, scan lifecycle and download code were not changed.

Focused validation: **2 files / 18 tests PASS**; typecheck, lint, production/package build and `git diff --check` pass. Build: **`automat-faceless-0.1.0-mw3jnzwe`**, four JS bundles. The existing connector packaging warning about `inlineDynamicImports` remains.

No live Gallery import was performed, so import success remains unverified. Retry the import on the same open Gallery after reloading the extension; confirm terminal scan status and real counts, then stop without downloading or upscaling.

## P11 Gallery unresolved-card counting correction - 5 November 2026

The supplied run on `mw3jnzwe` reported one discovered, zero imported, one unresolved, and a complete scan, with the unresolved title `Untitled video` and reason `asset identity missing`. The connected browser inventory contained no tabs/apps, so that result cannot distinguish one card from a grid/container misclassified as one card. Production source discovers leaf elements matching the current tile/result/gallery/media custom-element, list/grid role, or data-result adapters. It extracts candidate asset UUIDs from allowlisted image URL paths and accepts an exact same-card `/edit/` detail link. The actual rendered owner, image/video element, detail link, native open control, and scroll container remain unknown; selectors and identity extraction were intentionally left unchanged pending sanitized DOM evidence.

A confirmed source bug collapsed every unresolved card lacking an asset ID and observation fingerprint into the same `unkeyed:<reason>` entry. Unresolved cards now use a scoped asset UUID or exact route clip UUID when available; otherwise each card observation gets a separate bounded count. Because an identity-less observation cannot be safely deduplicated across virtualized/lazy snapshots, scanning stops with `identity_deduplication_unavailable` and Incomplete rather than claiming coverage. UI wording identifies that condition. Existing cancellation, terminal cleanup, project binding, exact-card navigation, and selected-asset checks remain unchanged.

Focused tests: **2 files / 19 tests PASS**. Typecheck, lint, production/package build and `git diff --check` pass. Build: **`automat-faceless-0.1.0-mw3jwhxa`**, four JS bundles; existing connector `inlineDynamicImports` warning remains. No live browser inspection/import, upscale, or download occurred. The provided run is not live verification of this build.

Next live verification requires one read-only sanitized probe on the current Videos Gallery to capture repeated card-owner tag/role/class structure, each card's media and controls, UUID-shaped candidates extracted locally from allowlisted URL paths or exact detail routes (no raw URLs/query values), and the scroll container. Use that evidence for a structure-based fixture before changing any production selector or identity parser. Then retry import and confirm multi-card discovered/unresolved counts and incomplete/complete status.

## P11 Gallery card-owner and media identity adapter - 5 November 2026

The supplied live DOM findings identify individual cards as `flow-grid-tile-container[role="group"]`, title via `aria-label`, and video cards via descendant `flow-video-tile`. Media may be `<video>` or `<img>`; inspected cards had no direct `/edit/` link. Clicking the card owner opens its detail route. The actual scroll ancestor is `.cdk-virtual-scrollable.page-container`. On detail pages, the selected media identity remains observable at `flow-navigation-rail-thumbnail button[aria-current="true"] img`.

The Gallery adapter now uses each matching group owner as one card and suppresses nested eligible tile/media wrappers, so a shared grid ancestor is not counted as a clip when it contains the observed owners. It reads owner `aria-label`, extracts candidate UUIDs from allowlisted HTTPS pathnames on either image or video media, and checks the video element's currentSrc, src, and nested source src independently. This accommodates the possibility that executeScript exposes a normal media URL even if a browser bridge showed an opaque URL. It does not decode `blob:`/opaque values, retain signed queries, or manufacture identity from title/order/fingerprint. Without an accepted source asset UUID, the card remains unresolved.

When no direct detail link exists, only the uniquely asset-matched observed card owner is clicked. The existing flow then requires the detail page's selected thumbnail asset UUID to equal the source card asset before accepting/storing the clip route. The known virtual-scroll ancestor is preferred for bounded lazy-loading traversal. Stable-boundary logic remains, and identity-less observations stop as Incomplete when safe cross-snapshot deduplication is unavailable.

Focused sanitized fixtures: **2 files / 22 tests PASS**, including multiple same-title owners, mixed video/image media, exact owner click, observed scroll parent, identity mismatch rejection, and independent unresolved counts. Typecheck, lint, production/package build and diff check pass. Build **`automat-faceless-0.1.0-mw3k75zg`**, four JS bundles. Live import was not run; the browser remained unavailable. If executeScript sees no allowlisted media path carrying a UUID, the card will specifically remain `asset_identity_missing`; no route association is created. No download/upscale occurred.

## P11 Gallery native-card navigation import - 5 November 2026

The supplied source Gallery capture shows 13 card owners and sampled thumbnail paths without a UUID; no visible video sample was available. This does not justify widening the URL allowlist or inferring an asset mapping. The existing source-asset method remains unchanged when Gallery asset identity and equality evidence are available.

For cards without a source UUID, a distinct native-card-navigation method now clicks one exact, reacquired `flow-grid-tile-container[role="group"]` owner that contains `flow-video-tile`, while excluding nested action controls. It waits for a stable detail view and uses the existing route/detail reader for the same-project `/edit/` clip UUID and uniquely selected navigation-rail asset. The observed selected asset is retained as detail evidence only. The row records `galleryImportMethod: native_card_navigation` and `detailSelectedAssetId`; it has no `galleryAssetId` and no `detail_selected_asset_match` evidence. Thus this path proves which detail route and rail asset followed the exact native card opening, but does not claim source Gallery asset equality or any clip-to-output association.

Traversal uses a transient scoped fingerprint only for same-scan card reacquisition, never as a persistent identity. It restores the gallery scroll location, revalidates the project and selected Videos gallery, reacquires owners after every navigation, deduplicates saved rows by project plus route clip UUID, and stops Incomplete if a card cannot be distinguished or reacquired. Cancellation, wrong project, ambiguous selection, missing detail identity, rerendered owners, and reimport are covered. Supplied live mappings for the two same-title Ã¢â‚¬Å“make itÃ¢â‚¬Â clips are used as fixtures and resolve to separate route UUIDs; they are not hardcoded into production behavior.

Focused validation: **3 files / 32 tests PASS**; typecheck, lint, production package build, and diff check pass. Build **`automat-faceless-0.1.0-mw3liikk`**, four JavaScript bundles. Existing connector `inlineDynamicImports` warning remains. The current browser inventory was empty; no Gallery import was run. Live verification remains **NOT_RUN**. No upscale or download occurred. Flow Downloads and Vids Downloads remain separate.

## P11 Project navigation selection and return restoration - 5 November 2026

The confirmed failure is in the Gallery importer call sequence. Its initial preflight invoked the page reader as `snapshot`, which verifies selected Videos but does not change the current section. Therefore a valid project-root page showing All media failed with `videos_section_not_selected` before card discovery. The earlier activated-class correction was still present; it was bypassed by the action used at preflight. Return paths similarly reopened the project URL and snapshotted immediately, allowing Flow's default All media section to fail revalidation. The project route prefix also matched `/edit/` paths and could classify a detail route as a gallery context. Source review did not find evidence that leading `videocam` text or duplicate nested matches caused this build failure; exact nested label resolution already existed, but no activation action was connected to it.

The Gallery adapter now uses one resolver scoped to the accessible `Project navigation` region. It resolves the visible Videos label to its owning control, ignores icon-only text, deduplicates matches by owner, and supports the exact activated class plus existing ARIA selection. Focus classes remain irrelevant. The import `start` and `restore` actions click the unique native Videos button only when it is not selected, then wait for stable selected state and a gallery surface. Snapshot, scroll, and open actions re-resolve and require Videos selected. Both detail-return paths restore the project root, revalidate connection/document identity, select Videos, and only then snapshot/reacquire. `/edit/` is no longer accepted as a project gallery route.

Fixtures exercise the full All media Ã¢â€ â€™ Videos Ã¢â€ â€™ discover Ã¢â€ â€™ open card Ã¢â€ â€™ read detail identity Ã¢â€ â€™ return Ã¢â€ â€™ restore Videos Ã¢â€ â€™ discover next card sequence, plus already-selected state, leading icon text, nested labels, navigation rerender, ambiguity, and wrong-project rejection. The two import provenance methods, identity checks, cancellation, and download association behavior are preserved.

Validation: **3 focused files / 35 tests PASS**; typecheck, lint, production/package build, and diff check pass. Build **`automat-faceless-0.1.0-mw3lzfrx`**, four bundles, with the existing connector warning. The browser was unavailable; live Gallery import is **NOT_RUN**. No upscale or download occurred. Flow Downloads and Vids Downloads remain separate.

## P11 exact Gallery owner token handoff - 5 November 2026

The live `mw3liikk` report says 13 discovered, zero imported, one unresolved `make it Ã‚Â· native card reacquire ambiguous`. In source, the manager maps any `native_traversal_ambiguous` exception to that row reason. Before this fix, both background reacquisition and page-side open filtered cards by equality with a repeatable `nativeTraversalFingerprint` and expected exactly one result; restoration used the same fingerprint again. A multi-match could be caused by identical media path/offset fingerprints, while a zero-match also took the same pre-click ambiguity path. Because the old result retained no throw-site or match-count detail, the exact live branch cannot be proven from that summary. The title does not participate in the predicate.

The fix replaces that fingerprint handoff with an ephemeral random owner token bound to the exact DOM node in the isolated page world. The token is generated/reused only inside a `scanId + documentId` scope. On open, the adapter looks up the token's single element binding and revalidates that exact element is still connected, within the validated project, the current selected Videos gallery, and the observed video-card owner structure (`flow-grid-tile-container[role="group"]` with `flow-video-tile`). It clicks that element directly. There is no title/order lookup or `.first()` fallback. The background records the originating document ID with each token; document changes invalidate all old bindings.

A snapshot after restoration is the rediscovery step. If the old token is absent, the importer reports a stale binding and never adopts another same-title card. If the owner changes after the snapshot but before open, the page reports `native_binding_stale` without clicking. Successfully imported identity continues to come from the verified detail route and uniquely selected navigation-rail asset; Gallery asset equality is not claimed.

The focused production-adapter fixture has two `make it` owners with no source UUID and identical media path/layout inputs. It verifies distinct tokens, exact clicks for either token, and no click through a replaced node or a token from another document. Focused tests: **3 files / 37 tests PASS**. Typecheck, lint, production packaging, and `git diff --check` pass. Build **`automat-faceless-0.1.0-mw3mp7wl`**, four bundles; existing connector warning remains. Live Gallery retry was not run, so the imported result remains **NOT_RUN**. No upscale or download occurred. Flow Downloads and Vids Downloads remain separate.

## P11.1 native card open-to-detail wait and failure stages - 5 November 2026

### Evidence and cause boundary

The user-reported `mw3mp7wl` result has 13 discovered titled cards, zero imported, and the repeated label `detail route unresolved`. It does not retain which branch failed. In source, that label previously concealed errors before page-side open, an open action that did not return a confirmed outcome, no route observed during polling, connection revalidation failure after route change, a detail-document injection/read failure, or selected-detail identity failure. The live report therefore does not prove a single actual substage.

The confirmed source limitation was that `resolveNativeNavigationCandidate` polled a route and then attempted connection verification immediately. A replaced/not-yet-revalidated document could be treated as a final candidate error instead of a pending connection. The prior polling read `tabs.get` afresh, so there is no source evidence that it used the Gallery's cached canonical URL as the detail URL. Native detail reading also lacked explicit stage outcomes in its caller. The catch-all message is removed for these paths.

### Correction

The exact native-card token is resolved in the page's current document and checked against one unique owner in the revalidated project Videos gallery. The owner must still be connected, remain under that project, retain `flow-grid-tile-container[role="group"]`, and contain `flow-video-tile`. Before clicking, the adapter samples points within the owner's current bounds and uses `document.elementFromPoint`; it rejects points that resolve outside the owner or inside nested buttons, links, menu actions, navigation, headers, or dialogs. It issues one `.click()` on a safe hit target. No candidate is substituted by title or order and there is no retry/double click. If no safe point is found, no click is issued.

The worker now waits for the current Chrome tab to report the same valid same-project `/edit/` URL twice. It then retries existing connection verification within a bounded 30-second / 40-poll window. Until the replacement verified binding is available, the detail reader is not injected. The worker verifies the new binding's document ID against both script results and reads the existing detail clip identity plus unique selected rail asset. The combined route, clip UUID, selected asset UUID, and document binding must be stable across two reads. Gallery restoration is gated on that successful read; a failed or cancelled detail attempt is not navigated back to Gallery before identity capture completes.

Terminal per-card reasons now distinguish `native_open_not_attempted`, `native_open_outcome_unknown`, `detail_route_rejected`, `detail_route_not_observed_by_deadline`, `detail_connection_unavailable`, `detail_connection_route_mismatch`, `detail_page_not_ready`, `detail_document_changed`, `detail_selected_asset_missing`, and `detail_identity_unstable`. A deadline result means the stage was not observed before the bound; it does not prove the Flow click handler itself was silent.

### Offline validation and live gate

The worker-to-page integration fixture delays route visibility across three tab reads, returns two pending connection results, replaces the selected binding's document ID, then verifies both detail reader injections target the new document and one route/selected-asset row is imported. Additional fixtures separately verify no route before deadline (no detail injection) and route present with connection never ready (no detail injection). The production page-adapter fixture checks exact bound-owner targeting with two same-title cards and nested More options controls.

Focused Vitest: **3 files / 40 tests PASS**. Typecheck and ESLint: **PASS**. First production build attempt failed at Vite config resolution with Windows `spawn EPERM`; the required build passed when rerun with process permission. Production/package validation: **PASS**, build **`automat-faceless-0.1.0-mw3nmywp`**, four JavaScript bundles; existing connector `inlineDynamicImports` warning. `git diff --check`: **PASS**.

Connected browser inventory returned no apps or browsers. The precise live substage for `mw3mp7wl`, current open hit target, replacement-document behavior, and a one-card live import remain **NOT_RUN**. The local one-row import test is not live verification. Do not repeat the 13-card Gallery scan yet; first obtain one live successful row with the new build. No upscale or download occurred. Flow Downloads and Vids Downloads remain separate.

## P11.1 focused one-card live importer check - 5 November 2026

Source inspection found no existing Gallery single-card limit. The normal Gallery start request previously accepted no parameters and always scanned the configured traversal. The added `singleCardCheck: true` option is an explicit bounded mode of the same `flow.projectVideos.import.start` operation. It is optional in the existing message schema; the normal Import project videos button still sends `{}` and retains full-scan behavior.

The bounded mode passes `maxCards: 1` into the existing page adapter during both initial Gallery validation and later snapshots/open actions. The production page reader enumerates its existing video-card owners, reads only the first currently visible owner, and binds its normal scan/document-scoped exact-owner token. The worker also slices as a second bound before merging, then runs the existing candidate resolver, route wait, replacement document revalidation, detail metadata and selected rail identity checks, repository upsert, and successful Gallery restoration. Candidate rules and native/source provenance are unchanged. It ends after that one candidate; it does not scroll for another. One-card completion sets `scope: one_card_check`, `scanCompleteness: incomplete`, and `reason: one_card_check_complete`, even when Imported or Already present is 1. This prevents presenting the action as Gallery coverage. Existing terminal cleanup releases the scanning lock. No quality input or download API is reachable from this path.

The Advanced details component shows **Test one Gallery clip**, its one-card-only explanation, current counts, Cancel while scanning, and the bounded unresolved/preflight stage. On completion, the imported list receives a refresh event. The displayed row can therefore be checked without using the full Gallery import action.

Offline validation: **4 focused files / 78 tests PASS**, including two actual card owners with only one selected/opened/imported, one-row persistence, a second run reported as Already present, `scanCompleteness: incomplete`, terminal completion, and page-reader max-one behavior. Typecheck, ESLint, production package validation, and `git diff --check`: **PASS**. Final build: **`automat-faceless-0.1.0-mw3o1eow`**, four JavaScript bundles. Build output contains a worker chunk-size warning and the existing connector `inlineDynamicImports` warning.

Live acceptance remains **NOT_RUN**. CUA returned empty app and browser inventories, so no actual Flow card could be opened or persisted in this session. Fixtures do not satisfy live acceptance. Manual steps: reload the extension, open the intended project's Videos Gallery, open **Advanced details**, click **Test one Gallery clip**, wait for a terminal result, and confirm Discovered `1`, Imported `1` or Already present `1`, Unresolved `0`, a visible imported row, and the message that Gallery coverage was not evaluated. Stop after this check; do not click **Import project videos**, **Download 1080p**, or any upscale until one actual card succeeds. Flow Downloads and Vids Downloads remain separate.

## P11.1 native Gallery open result and route observation - 5 November 2026

### Browser API research

| Documented behavior | Primary source | Relevance to this implementation | Does the live failure prove it? |
|---|---|---|---|
| `scripting.executeScript` serializes `func`; bound parameters and execution context are lost. It waits for an injected Promise and returns `Promise<InjectionResult[]>`. | [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) | Injected functions must keep their runtime helpers inside the function body. The worker must validate the result array and its document ID. | The live message alone does not expose the exception. A local production-function serialization fixture reproduced the missing closure directly. |
| Injection can target a specific document ID. | [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) | The importer continues targeting the exact verified document for the click, then revalidates the replacement document before reading detail identity. | The live message alone does not establish whether navigation replaced the document. |
| `webNavigation.onHistoryStateUpdated` reports History API URL changes; `onCommitted` reports a committed document and document ID changes for replacement documents. The API requires the `webNavigation` permission. | [Chrome webNavigation API](https://developer.chrome.com/docs/extensions/reference/api/webNavigation) | Flow may use SPA or document navigation. We observe the same tab's committed URL with `tabs.get`, avoiding an added permission while reusing the connection system for replacement verification. | Generic documentation does not establish which transition Flow used. |
| `tabs.get` returns the tab, and `Tab.url` is the last committed main-frame URL; it can be empty before commit. | [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) | Bounded polling can observe a route after either History API change or document commit. | The supplied failure does not show whether the URL changed before the result failed. |
| Chrome scripting uses an execution world; isolated-world JavaScript variables are separate from the host page. | [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) | The scan/document token registry remains scoped to the same `ISOLATED` document execution context. A replacement document is reconnected and verified before detail reads. | It does not prove Flow's click behavior or its transition type. |
| `HTMLElement.click()` fires a click event and returns `undefined`; the resulting click event is untrusted. | [MDN `HTMLElement.click()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/click), [MDN `Event.isTrusted`](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted) | The page adapter calls `.click()` but returns its own `{status: "opened", ...}` object. Its click return value is not the injected result. No `isTrusted` predicate exists in this Gallery path. | The manual UI click succeeding does not prove that Flow rejects the adapter click; MDN behavior is generic, not Flow evidence. |

### Confirmed implementation defect and correction

`inspectFlowProjectVideosInPage` referenced the module-scope `uuidPattern` when validating a native card token. Chrome serializes the function body without its closure. Evaluating the actual serialized function in a persistent isolated-style DOM fixture reproduced `ReferenceError: uuidPattern is not defined` during the exact-owner open action. The worker's open-result catch converted that exception into `native_open_outcome_unknown` and, before this patch, exited before checking the current tab. This is a confirmed defect that matches the reported generic failure; the supplied live status does not prove that this exact exception was the runtime event in build `mw3o1eow`.

The UUID validator is now declared inside the injected reader. Exact-token binding, owner checks, safe click point, and one-click behavior remain unchanged. The worker now starts bounded same-tab route polling before dispatch, verifies the tab is still on the same project Gallery root, and dispatches the page function once. A missing or malformed injection result no longer ends the attempt immediately: the worker continues observing that same tab without replay. Two stable same-project `/edit/` reads allow the existing connection replacement, verified detail reader, selected rail asset check, and persistence path to proceed. Both SPA transitions and full document replacement are covered. A route alone is not accepted as clip/output or download provenance.

`webNavigation` listeners and permissions were not added. Cancellation and deadline failures remain terminal through the existing scan lock cleanup. Click-rejection errors remain bounded; the worker distinguishes a blocked click from an unknown injection result and a route not observed by deadline.

### Offline validation and live gate

The serialized-function fixture invokes the production reader through its serialized source in one persistent DOM realm for discovery and exact-token click, and verifies one intended owner click. Worker integration cases cover a missing result followed by delayed replacement navigation, a malformed result followed by delayed SPA navigation, one-card persistence through the existing verified detail readers, one-click/no replay, and missing or malformed result with no route. Existing tests cover stale token, cancellation, wrong-project route, and no-navigation terminal behavior.

Focused validation: **2 files / 44 tests PASS**. Typecheck and ESLint **PASS**. Production/package build **PASS**, build **`automat-faceless-0.1.0-mw3orez8`**, four JavaScript bundles; existing worker chunk-size and connector `inlineDynamicImports` warnings remain. `git diff --check` **PASS**.

Live acceptance remains **NOT_RUN**; connected browser inventory returned no apps or browsers. The one-card check still needs one actual card to reach its verified detail route and create/update a row. Reload the extension build, open the intended project's Videos Gallery, choose **Advanced details** Ã¢â€ â€™ **Test one Gallery clip**, and confirm Imported `1` or Already present `1`, Unresolved `0`, the visible row, and the one-card-only coverage message. Stop after this check. Do not run the full Gallery scan, upscale, or download. Flow Downloads and Vids Downloads remain separate.

## P11.1 Gallery detail identity stage - 5 November 2026

### Trace of the `detail identity unresolved` result

There were two final fallback branches with that display reason: the source-asset candidate catch and the native-navigation candidate catch. The supplied one-card case has no usable Gallery source UUID, so it runs through the native-navigation catch. That branch mapped every error not matching a short list of known codes to `detail_identity_unresolved`. This proves the result was a catch-all; the live count/title/reason do not reveal whether the metadata reader threw, returned no result, failed schema/route validation, or whether selected rail identity was missing or malformed. No retained live body or stage receipt distinguishes these cases.

The Gallery identity stage injects two functions, both with `world: "ISOLATED"`, `target: {tabId, documentIds: [current verified documentId]}`:

| Function | Successful Import open clip | Gallery detail identity |
|---|---|---|
| `inspectCurrentFlowClipInPage()` | Injected; checked against `FlowClipPageMetadataSchema`; route and clip are compared with current tab before persistence. | Same function, args `[]`, same result schema. Gallery additionally compares project and clip to the opened route and rechecks the route after both reads. |
| `prepareFlowClipDownloadInPage(projectId, clipId, null, false, true)` | Not used by Import open clip. | Injected only to read the selected detail asset. Its identity result is checked by `FlowClipAssetIdentitySchema`. The selector is the observed `flow-navigation-rail-thumbnail button[aria-current="true"] img`. |

Neither reader referenced an unavailable module-scope helper. Both are now exercised by evaluating their production serialized source in a persistent DOM realm. The previous closure defect remains fixed in `inspectFlowProjectVideosInPage`; this patch does not change the one-click navigation observation.

### Bounded detail-read behavior

A stable route alone does not complete readiness. The importer now retries both existing readers until it receives valid metadata and a uniquely selected rail asset, bounded by the existing 30-second deadline and 200 polls at 150 ms. Before accepting the identity, it re-reads the current tab route and revalidates the selected target/document. A route, clip, project, or document change prevents persistence. The detail page is restored to Gallery only after identity capture succeeds.

The selected-asset reader now returns fixed reason codes in identity-only mode for: selected rail missing/ambiguous; thumbnail missing/ambiguous; source URL invalid; asset UUID missing/ambiguous. The worker separately reports injection throw, reader result missing, metadata route parse failure, metadata schema invalid, route/clip mismatch, selected-asset result/schema invalid, document change, tab read failure, connection unavailable/mismatch, and identity instability. The unresolved UI no longer uses `detail_identity_unresolved`; an unexpected uncategorized error is shown as `detail_stage_unclassified`. A repository write failure is separately `row_persistence_failed`.

### Offline validation and remaining live check

Serialized production-reader tests cover metadata extraction, selected rail absent then rendered, successful asset extraction, and route mismatch. Worker integration tests cover stale reader document results followed by verified replacement, delayed rail readiness, thrown/missing/malformed metadata and asset results, route/project mismatch, each selected rail/thumbnail/extraction category, and one click only. Existing download tests were included to check that the non-identity-only download path still receives its original generic blocker and behavior.

Focused validation: **4 files / 70 tests PASS**. Typecheck, ESLint, production/package build, and `git diff --check` **PASS**. Build **`automat-faceless-0.1.0-mw3pojsg`**, four JavaScript bundles; existing worker-size and connector `inlineDynamicImports` warnings remain.

Live browser inventory was empty, so the precise substage behind `mw3orez8` remains unverified and one-card live acceptance is **NOT_RUN**. Reload the extension, open the same project's Videos Gallery, choose **Advanced details Ã¢â€ â€™ Test one Gallery clip**, then report the displayed fixed unresolved stage or confirm Imported/Already present `1`, Unresolved `0`, and the row. Do not run a full Gallery scan, upscale, or download. Flow Downloads and Vids Downloads remain separate.

## P11.1 one-card Gallery restoration lifecycle - 5 November 2026

### Restore path trace

The recording observations show Flow's loading state, then the same project's Gallery with All media selected, and a changing connection panel. The recording does not show whether detail identity was captured before cleanup. The recording file was not present in the workspace, so no additional frame-level review was possible.

The native one-card path had one root navigation call after a successful detail read: `tabs.update(selectedTabId, {url: galleryUrl})` in its `finally` block. The source-asset detail path also uses one `tabs.update` when it has opened a detail route. The importer has no `tabs.reload` call. Connection revalidation changes/validates connection state through its handshake; it does not navigate. The bug was immediately calling `verifyImportTarget(..., true)` and injecting the Gallery reader after `tabs.update`, without waiting for the root tab to finish loading. A temporary connection failure escaped the restore loop. Separately, the native resolver threw `gallery_restore_failed` before returning its already-resolved identity, so the caller skipped the row upsert and counted the candidate unresolved.

### Correction and preservation

A shared bounded restoration helper now checks that the selected tab stays on the same project and canonical Flow target. It issues at most one root navigation if the tab is still on a detail route; if already on the project root it skips navigation. It waits for the root tab to leave `loading`, attempts connection revalidation once and waits on the existing verified-target state, then runs the existing shared `restore` action and verifies a fresh Gallery snapshot. The existing resolver activates Videos when All media is selected and waits for Gallery readiness. Cancellation and deadline are checked during the wait; there is no reload/reconnect loop.

Both candidate resolvers return `clip` identity and `restorationWarning` separately. Verified identity is persisted before the importer applies the restoration warning to terminal progress. Restore timeout keeps the row and marks scan Incomplete; a project change keeps the row but marks scan Failed; cancellation after identity capture keeps the row and marks scan Cancelled. The progress object exposes the distinct warning, and the UI says the verified identity was saved. If identity itself fails, the original stage remains the unresolved result and no row is written. Download handlers, identity/provenance rules, and Flow/Vids separation are unchanged.

### Validation and live check

The integration fixture exercises detail resolution -> one project-root navigation -> two loading reads -> one temporary connection failure -> replacement Gallery binding -> restore from All media -> Videos activation -> fresh snapshot -> persisted row. Additional tests cover restore timeout, cancellation after verified identity, wrong-project navigation after identity, and preservation of the original detail-read failure. Focused validation: **4 files / 75 tests PASS**. Typecheck, ESLint, production/package build, and `git diff --check`: **PASS**. Build **`automat-faceless-0.1.0-mw3qovbe`**, four JavaScript bundles; existing worker-size and connector `inlineDynamicImports` warnings remain.

Live acceptance remains **NOT_RUN** because connected browser inventory returned no apps or browsers. The original run's detail identity outcome is unknown from the supplied recording/status. Reload this build, open the intended project's Videos Gallery, and use **Advanced details -> Test one Gallery clip** once. Confirm Imported or Already present `1`, Unresolved `0`, and the row; if restore fails after identity capture, confirm the separate warning and retained row. Stop after one card. Do not run a full Gallery scan, upscale, or download. Flow Downloads and Vids Downloads remain separate.

## P11.1 batch traversal stale-binding correction - 6 November 2026

### Confirmed stale-binding path

The full Gallery scan first completed discovery and retained native DOM-owner tokens in `job.nativeCandidates`. The processing phase copied that map to an array and iterated the old entries. A successful candidate opened detail, persisted verified project/detail identity, and restored Gallery; the loop then continued with owner tokens from before that navigation. A replacement document loses the injected binding registry, and same-document Gallery recreation leaves the registry pointing at disconnected owner nodes. In both cases the page reader's stale-binding rejection is correct. The observed 12 stale results after one successful card match this path.

### Correction

Native queue entries are now traversal progress only and contain no DOM token. The worker selects one descriptor at a time. After restoration it freshly scans the Gallery, locating a unique current owner by a transient fingerprint of safe media paths. The fingerprint is used only to reacquire the intended card; it is never persisted or accepted as clip identity. The new owner token is immediately checked by the production page reader before the one open click. A missing or duplicated fingerprint fails closed. Scan order, title, and latest selected card are not substitutes. After each verified identity is persisted, the next descriptor goes through the same fresh discovery/bind/revalidate path. Both replacement-document and same-document recreation are covered by the production-loop integration fixture, which also reorders three same-title cards and reimports them.

Discovered counts distinct run-local candidates; Processed is the sum of Imported, Already present, and Unresolved; Repeated discoveries counts later sightings/reacquisitions; Open attempts counts attempted fresh-owner opens. Removing duplicate unresolved bookkeeping keys corrects the prior counter inflation. Partial rows and cancellation behavior remain on the existing persistence/terminal path.

### Validation and live check

Focused integration/unit validation: **3 files / 70 tests PASS**. Typecheck: **PASS**. Full package build and diff check: pending final command output. Live multiple-card acceptance remains **NOT_RUN**. Preserve the successful one-card check, then exercise a multi-card scan on the next authorized live check. No upscale or download was triggered.

Final validation update: **3 focused files / 70 tests PASS**; typecheck and ESLint PASS; production/package build PASS, build **`automat-faceless-0.1.0-mw4faxgu`** (four JavaScript bundles); `git diff --check` PASS. Existing worker chunk-size and connector `inlineDynamicImports` warnings remain. Live multiple-card acceptance is still **NOT_RUN** because no connected browser was available. No upscale or download occurred.

## P11.1 native Gallery batch freshness follow-up - 6 November 2026

This is offline source and fixture evidence for the Gallery import path; it does not change the download association evidence above. Review of the prior batch rebinding fix found two remaining safety gaps: the isolated-world native-owner registry was not renewed on Gallery `restore`, and a native open did not require the current ownerâ€™s media fingerprint to match the selected snapshot. A virtualized card could therefore remain connected while representing different media. The previous scan also lacked a bounded final key-set comparison and could give distinct but indistinguishable owners unstable counters.

`restore` now creates a fresh owner-binding generation in the current document. The worker retains only a traversal descriptor, rediscovers current Gallery owners after restoration, and passes the exact current owner token plus expected transient media fingerprint to the serialized page function. The function re-reads media immediately before the one click and rejects changed media, stale owner bindings, or a changed project. The media fingerprint is never persisted as a clip identity or treated as proof of equality between a Gallery asset and a selected detail asset. Persisted identity continues to require the verified project and detail-route UUID.

Run-local keys now count distinct ambiguous owners separately and repeated sightings without inflating candidate or outcome counts. Missing or changed pending evidence stops further opens as Incomplete and leaves remaining candidates in Not processed. A bounded fresh Gallery scan after the import compares observed candidate keys with the original inventory; equal counts with changed keys remain Incomplete. The UI exposes Discovered, Processed, Not processed, Imported, Already present, Unresolved, Repeated discoveries and Open attempts.

The new production-loop regression uses serialized `inspectFlowProjectVideosInPage` across three virtualized cards (including same-title cards), project detail identification, persistence, Gallery restoration, and reimport. It also exercises replacement and same-document DOM lifecycles, reorder, one-row cancellation, missing/changed pending evidence, same-count changed final inventory and ambiguous owners. Focused validation: **6 files / 85 tests PASS**; typecheck, lint, package build and diff check PASS. Build **`automat-faceless-0.1.0-mw4r7rsi`**, four JavaScript bundles. The build retains the worker chunk-size and connector `inlineDynamicImports` warnings. Fixture success is not live acceptance. A live multi-card import and reimport remains **NOT_RUN**; no browser login, generation, upscale or download was performed.

Next manual check after reloading the built unpacked extension from `dist/`: in the intended verified projectâ€™s Videos Gallery, choose **Advanced details -> Import project videos**. Verify several cards import with no unresolved stale-binding flood, then repeat the import and confirm the same clip rows report Already present without duplicate rows. Flow download behavior and association remain separate and unchanged.

## P11.1 traversal evidence host mismatch - 6 November 2026

Main-source review confirmed the reported mismatch: traversal fingerprint production omitted `flow.google.com`, even though the current native card owner was valid. The corrected evidence producer accepts usable HTTPS paths from that same-origin host for traversal only. Asset UUID extraction continues to use its narrower existing media-path policy, so a Flow-origin traversal path cannot verify asset identity or clip association.

Traversal evidence reports bounded categories for missing media, rejected scheme/host, unusable or generic path, digest failure, and missing owner token. It strips query values before fingerprinting. Distinct same-origin paths remain separate; a shared fingerprint seen on multiple owners in one snapshot, a generic placeholder, or a path that changes during reacquisition remains ambiguous/incomplete. Owner tokens rotate when the Gallery binding is restored, so collision checks are scoped to one current snapshot and fresh batch reacquisition continues to use the fingerprint plus a newly validated owner token. A one-card check may use its current owner without a media fingerprint; full-gallery batches still require full-batch evidence and freshness checks.

Offline regressions: 3 focused files / 80 tests PASS; typecheck, lint, production/package build, and diff check PASS. Build `automat-faceless-0.1.0-mw4se4ad`. Live acceptance is NOT_RUN. The supplied 13-card result is source evidence only; no new Gallery scan was requested or run. No generation, upscale, or download occurred.

## P12.1 hosted Vids helper configuration — 6 November 2026

Compared the supplied `package.zip` sources with the current extension. The archive's `hosted-picker-proof/app.js` pins `EXTENSION_ID` to `iligjolepbmhcijfanahgnoaagoaeooo`. The current main manifest has no fixed public key or extension ID, and the browser inventory returned no connected browser, so the installed extension's actual runtime ID could not be observed. The legacy ID was not copied. The Downloads view now uses `chrome.runtime.id` from the current extension page and adds it as a non-secret launch parameter to the existing helper URL.

The current manifest allows external messages from the existing GitHub Pages origin. The worker accepts only a strict configuration ping from the exact sender origin and URL path, top frame, tab, and launch-time extension ID. The ping carries no account, API key, token, URI, or media data. The Vids Downloads panel distinguishes extension-side configuration readiness, hosted-helper compatibility, and Google account authorization (not checked). Flow Downloads are unchanged.

The archive was read as reference and was not modified or published. Required helper source update: in `hosted-picker-proof/app.js`, replace the fixed `EXTENSION_ID` with a strict parse of the `extensionId` query parameter from the existing helper URL, use it for `chrome.runtime.sendMessage`, and send the strict `VIDS_HELPER_CONFIG_PING` after initialization if the helper should display that it reached this extension. Until that update is published, the archived helper still targets its previous fixed ID. No Google Cloud, OAuth, account, media, or download action was performed.

Focused configuration/sender tests: **3 files / 16 tests PASS**. Typecheck, lint, production build, and `git diff --check` pass. Build **`automat-faceless-0.1.0-mw4tmufn`** (four JavaScript bundles); existing large-worker and connector `inlineDynamicImports` warnings remain. Live helper handshake and Google account authorization remain **NOT_RUN**.
