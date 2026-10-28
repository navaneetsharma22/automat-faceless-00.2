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
- P04.2 durable one-shot Generate attempt, P04.3 authorized live generation, and P04.4 bounded failure attribution: **NOT_STARTED**.
- Phase 04 remains **INCOMPLETE**. P04.1 is complete only for its offline and local-fixture evidence boundary; G-IMAGE-ONE remains open pending later completion/attribution evidence.
