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
    "article,[role='listitem'],li,[data-testid*='video-card' i],[class*='videoCard' i]";
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
