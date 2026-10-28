# P04.1 Flow composer and exact text entry evidence

Date: 28 October 2026  
Subphase: P04.1  
Status: **OFFLINE_VERIFIED / LOCAL_BROWSER_FIXTURES_VERIFIED**. Real Flow DOM inspection and live editor fill: **NOT_RUN**.

## Scope and behavior

P04.1 adds a bounded image-prompt entry path for exactly one complete JSON body from the current validated image preview. It requires the user's explicit selected Flow project and the existing manual Flow settings confirmation. The worker validates the selection and current route, checks the current top-frame identity, and uses Chrome DevTools Protocol `Input.insertText` only for a uniquely discovered, empty textarea or text input. It reads back the full string immediately and through a bounded stable-read interval. Existing exact text is verified without insertion; different existing text is left unchanged. Timeouts and uncertain entry do not retry. There is no submit or Generate operation in this path; the result always reports generation unavailable.

Composer discovery excludes search controls and requires one visible, enabled editor inside a semantically labelled form/group/region or explicit composer boundary. Placeholder alone is insufficient. Candidate labels and selectors have not been checked against the real Flow DOM. Contenteditable is classified unsupported; the implementation does not attempt insertion through that path.

The required Chrome `debugger` permission is in `permissions`, not `optional_permissions`, because Chrome lists it among permissions that cannot be requested as optional. Chrome's permission warning includes access to the page debugger backend and broad website data wording. The control is explicit and only invoked from the dashboard's one-image validated-preview state after manual settings confirmation. See the [Chrome debugger API reference](https://developer.chrome.com/docs/extensions/reference/api/debugger) and [optional permission restrictions](https://developer.chrome.com/docs/extensions/reference/api/permissions).

## Offline evidence

- Full Vitest suite: **15 files / 137 tests PASS**. Coverage includes account-prefixed Flow identity, target change, debugger permission, composer discovery, preexisting text, exact single insertion, no submit/Generate activation, uncertain input no-retry, and safe mismatch reporting.
- `npm run typecheck`: **PASS**.
- `npm run lint`: **PASS**.
- Production build: **PASS** (Vite 8.3.5, 159 modules). Shared packaged build ID: `automat-faceless-0.1.0-mvs202rv`; dashboard, background worker, and connection probe contain the same ID. Built manifest matches `public/manifest.json` and includes the required `debugger` permission.
- Local Playwright suite: **8 tests PASS** using simple local DOM only. It covers semantic discovery and blocked candidate classes, empty/matching/conflicting text, exact entry of the approved image fixture into a local textarea, a local textarea node replacement, and CRLF representation behavior.
- The user-selected assistant-generated image test sample was copied byte-for-byte into `tests/fixtures/prompts/p04-image-user-approved-intended-use.json`. It is intended-use test data, not a historical production sample: 15,889 JavaScript code units, 16,013 UTF-8 bytes, SHA-256 `f452ef3df4f0e7281560c52f980378df7f3cbfbc1b461353be1e46294a664a8b`.

In the local textarea test, the approved sample read back exactly after Playwright's Chromium `page.keyboard.insertText` (654 ms test duration). A separate 25,000-code-unit, 25,062-byte CRLF fixture contained 42 CRLF pairs. Local textarea readback measured 24,958 code units and 25,020 UTF-8 bytes; the first mismatch was the first source CRLF pair (`CR` versus `LF`). The browser test asserted direct inequality and exact mismatch location. This is a local textarea contract observation only; it is not evidence that Flow normalizes or preserves line endings. The local browser suite completed in 9.0 seconds.

No actual Flow tab or provider page was accessed. No provider settings, navigation, refresh, generation, or submission occurred. Local browser tests do not establish Chrome extension debugger behavior against Flow or compatibility with a framework-managed editor. No browser version, live project, or live build is claimed.

## Remaining gates

- Read-only inspection of actual Flow composer metadata and editor type: **NOT_RUN**.
- Live Flow exact fill/readback with a user-approved long image sample: **NOT_RUN**.
- Provider prompt-size acceptance and image generation: **UNVERIFIED**; later subphases own those gates.
- P04.2 durable one-shot Generate attempt: **OFFLINE_VERIFIED / LOCAL_BROWSER_FIXTURES_VERIFIED**. P04.3 authorized live generation: **NOT_RUN**; P04.4 bounded failure attribution: **NOT_STARTED**.
- Phase 04 remains **INCOMPLETE**. P04.1 is complete only for its offline and local-fixture evidence boundary; G-IMAGE-ONE remains open pending later completion/attribution evidence.

## P04.2 durable one-image Generate attempt — 28 October 2026

Status: **OFFLINE_VERIFIED / LOCAL_BROWSER_FIXTURES_VERIFIED**. This entry supersedes the earlier P04.1 handoff statement above that P04.2 was not started. It does not claim a provider or extension-browser verification.

The image UI offers one-shot Generate only when the current preview has exactly one valid prompt, its source matches the saved image batch, and the user has manually confirmed the Flow image settings for the selected project. The worker re-reads and validates the saved repository record; the request includes only workspace ID, expected prompt SHA-256 and target-bound settings attestation. It verifies stored target/current tab/route, top-frame ID and loader, exact saved prompt/hash/measurements, and current selection before writing a durable `preparing` attempt. It fills and verifies exact settled text through the P04.1 path, then checks one semantic composer, an exact prompt readback, one enabled semantic Generate control, and one uniquely labelled results region with a pre-dispatch media-count baseline. It rechecks these bindings, stores `dispatch-intent`, and sends one CDP `mousePressed`/`mouseReleased` pair.

Durable attempt state contains workspace, batch, item, optional shot, hash/length/byte measurements, Flow project/tab/frame/loader, build/protocol ID, user-attested settings, baseline, timestamps, and fixed stage/reason events. Raw prompt text is not duplicated. Unique active-item and settings-confirmation keys prevent concurrent attempts and repeated clicks. `preparing`/`verified` are reconciled to `failed-before-dispatch`; `dispatch-intent` is reconciled to `uncertain`; dispatched and uncertain attempts are preserved. No restart path replays Generate. A `dispatched` response reports the input pair only; it does not report provider acceptance or a generated result.

Offline evidence: **16 Vitest files / 156 tests PASS**, including the later-save prompt-snapshot immutability and unavailable/mismatched-snapshot blocks. Focused Playwright browser fixtures: **12 PASS total**, four P04.2 local end-to-end cases (valid preflight/one activation pair; failed preflight/zero activation; repeat request/no duplicate; partial dispatch/uncertain/no replay) plus the existing eight P04.1 local composer/fill cases. `npm run typecheck`, `npm run lint`, production build, formatting and diff checks pass. Current build ID: `automat-faceless-0.1.0-mvs32n3j` (Vite 8.3.5; 163 modules; same ID in dashboard, worker and connector).

A sandboxed run of `npx playwright test --config tests/browser/playwright.config.ts --workers=1` failed because Playwright's `WorkerHost.startRunner` tried to `child_process.fork` a worker and Windows returned `spawn EPERM`. The project records elevated process-spawn permission as the permitted rerun method; rerunning that exact command through `exec_command` with `sandbox_permissions=require_escalated` passed all 12 fixtures. Playwright transpiles the handler outside Vite, so its test-only setup now defines the shared build-ID global before dynamically importing the worker handler. No application behavior was changed to bypass the runner issue. The production build and Vitest suite also required the permitted process-spawn method after sandboxed Vite startup returned `spawn EPERM`.

Prompt snapshot: the latest saved batch and item records are mutable and reuse their IDs during replacement, so the attempt no longer relies on those mutable bodies after creation. The repository stores a separate write-once, content-addressed snapshot for the exact attempted item (ID is derived from item ID plus SHA-256); attempts reference `sourceSnapshotId`. Existing snapshots are reused only when the exact body and identity match. Replacing the latest batch does not update or delete snapshots. Before text entry, the handler reloads the referenced snapshot and checks its ID, scope, exact body, hash, code-unit count and UTF-8 byte count; missing, corrupt or mismatched snapshots fail closed with no Generate activation. A regression replaces the saved batch immediately after attempt creation and confirms the attempt still fills and dispatches the original prompt; separate regressions confirm missing and mismatched snapshots both produce zero activation. This stores one immutable body per distinct attempted item/hash, rather than duplicating prompt text in every attempt record.

## Remaining Phase 04 gates

- P04.2 implementation and offline evidence: **OFFLINE_VERIFIED**.
- P04.2 focused synthetic local Playwright fixtures: **PASS, 4 tests** (12 total browser tests including P04.1 fixtures).
- P04.3 real Flow long-JSON entry and one authorized Generate observation: **NOT_RUN; stopped before target readiness because the selected Chrome session was not available to browser tooling**.
- P04.4 bounded pre-input/post-input failure attribution: **NOT_STARTED**.
- Actual Flow DOM selector compatibility, provider prompt-size acceptance, generated result attribution and terminal completion, and real MV3 worker suspension/restart: **UNVERIFIED**.
- Phase 04 and G-IMAGE-ONE remain **INCOMPLETE** until later required completion/attribution gates pass. P05 remains **NOT_STARTED**.

## P04.3 live-verification attempt: 28 October 2026

Status: **NOT_RUN; stopped before readiness.** The browser-surface inventory returned no apps or browsers. The native computer-use bridge's `list_apps()` failed on its initial call and recovery retry because its Windows native pipe was unavailable (`The system cannot find the file specified`, OS error 2). No existing Chrome profile or selected Flow tab was exposed. No extension reload, Flow tab action, provider setting change, prompt fill, Generate input, or provider interaction occurred.

The user-reported build is `automat-faceless-0.1.0-mvs32n3j`. Existing P04.2 offline/package evidence records that ID across dashboard, worker, and connector, but this session did not verify the loaded dashboard, worker, or connector identities. The selected account-prefixed Flow route/project, browser tab/document/frame identity, target-bound settings attestation, current saved-source record/hash, unique composer/editor and ownership boundary, editor attributes, composer-owned Generate control, and distinction between read-only connection and entry readiness are all **NOT_RUN**. No screenshot or stored attempt/activation record was observed. Therefore there is no P04.3 fill/readback result, activation count, provider acknowledgment, output, or error to report; none is inferred from local fixtures or prior screenshots.

### Minimal read-only diagnostic for the user's existing session

Keep the currently selected Flow project open; do not refresh, navigate, or change settings. In the existing packaged dashboard, record the Advanced details **Build state** and the selected Flow project/tab label plus current connection status. On that same Flow tab, open DevTools Console and run the following read-only inventory. It reports only URL path and DOM metadata, never editor text. It does not prove extension tab/document binding or entry readiness; return its JSON output so those remaining bindings can be checked before any fill action.

```js
(() => {
  const name = (el) =>
    el.getAttribute("aria-label") || el.getAttribute("title") || "";
  const visible = (el) => {
    const s = getComputedStyle(el);
    return (
      el.isConnected &&
      !el.matches(":disabled,[disabled],[aria-disabled='true']") &&
      !el.closest("[hidden],[inert],[aria-hidden='true']") &&
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      s.visibility !== "collapse" &&
      el.getClientRects().length > 0
    );
  };
  const editors = [
    ...document.querySelectorAll(
      'textarea,input:not([type]),input[type="text"],input[type="search"],[contenteditable="true"],[role="textbox"]',
    ),
  ];
  const candidates = editors.map((el) => {
    const boundary = el.closest(
      'form,[role="form"],[role="group"],[role="region"],[data-composer]',
    );
    const ownerText = `${name(el)} ${name(boundary || document.createElement("div"))} ${boundary?.getAttribute("data-testid") || ""}`;
    const owner = /prompt|composer|create/i.test(ownerText);
    const boundaryRole =
      boundary?.getAttribute("role") || boundary?.tagName.toLowerCase() || null;
    const buttons = boundary
      ? [...boundary.querySelectorAll('button,[role="button"]')]
      : [];
    const generate = buttons.filter((button) =>
      /^(generate|generate image|create image)$/i.test(
        name(button) || button.textContent.trim().replace(/\s+/g, " "),
      ),
    );
    const value =
      el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
        ? el.value
        : "";
    return {
      visible: visible(el),
      ownerSignal: owner,
      editorTag: el.tagName.toLowerCase(),
      inputType: el instanceof HTMLInputElement ? el.type : null,
      role: el.getAttribute("role"),
      ariaLabel: name(el),
      placeholder: el.getAttribute("placeholder"),
      contenteditable: el.getAttribute("contenteditable"),
      disabled: el.matches(":disabled,[disabled]"),
      readOnly:
        el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
          ? el.readOnly
          : null,
      boundaryTag: boundary?.tagName.toLowerCase() || null,
      boundaryRole,
      boundaryLabel: boundary ? name(boundary) : null,
      boundaryTestId: boundary?.getAttribute("data-testid") || null,
      currentTextPresent: value.length > 0,
      currentTextCodeUnits: value.length,
      generateControls: generate.map((button) => ({
        label: name(button) || button.textContent.trim().replace(/\s+/g, " "),
        visible: visible(button),
        disabled: button.matches(":disabled,[disabled],[aria-disabled='true']"),
      })),
      mediaElementsInBoundary: boundary
        ? boundary.querySelectorAll("img,video").length
        : null,
    };
  });
  return {
    origin: location.origin,
    path: location.pathname,
    title: document.title,
    topFrame: window.top === window,
    readyState: document.readyState,
    candidateCount: candidates.filter((c) => c.visible && c.ownerSignal).length,
    candidates,
    labelledResultsRegions: [
      ...document.querySelectorAll(
        'main [aria-label],[role="region"][aria-label],[role="list"][aria-label]',
      ),
    ]
      .filter(
        (el) =>
          visible(el) &&
          /^(generated results|image results|results gallery)$/i.test(
            el.getAttribute("aria-label") || "",
          ),
      )
      .map((el) => ({
        label: el.getAttribute("aria-label"),
        visibleMediaCount: [...el.querySelectorAll("img,video")].filter(visible)
          .length,
      })),
  };
})();
```

Diagnostic output is **NOT_COLLECTED** because no browser surface was available. Candidate metadata from this snippet would still need comparison with a live extension target/frame binding and the app's target-bound settings confirmation. No fill or Generate action is authorized by this diagnostic alone.
