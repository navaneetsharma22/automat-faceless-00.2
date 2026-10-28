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

## P04.2 durable one-image Generate attempt — 28 October 2026

Status: **OFFLINE_VERIFIED**. This entry supersedes the earlier P04.1 handoff statement above that P04.2 was not started. It does not claim a provider or extension-browser verification.

The image UI offers one-shot Generate only when the current preview has exactly one valid prompt, its source matches the saved image batch, and the user has manually confirmed the Flow image settings for the selected project. The worker re-reads and validates the saved repository record; the request includes only workspace ID, expected prompt SHA-256 and target-bound settings attestation. It verifies stored target/current tab/route, top-frame ID and loader, exact saved prompt/hash/measurements, and current selection before writing a durable `preparing` attempt. It fills and verifies exact settled text through the P04.1 path, then checks one semantic composer, an exact prompt readback, one enabled semantic Generate control, and one uniquely labelled results region with a pre-dispatch media-count baseline. It rechecks these bindings, stores `dispatch-intent`, and sends one CDP `mousePressed`/`mouseReleased` pair.

Durable attempt state contains workspace, batch, item, optional shot, hash/length/byte measurements, Flow project/tab/frame/loader, build/protocol ID, user-attested settings, baseline, timestamps, and fixed stage/reason events. Raw prompt text is not duplicated. Unique active-item and settings-confirmation keys prevent concurrent attempts and repeated clicks. `preparing`/`verified` are reconciled to `failed-before-dispatch`; `dispatch-intent` is reconciled to `uncertain`; dispatched and uncertain attempts are preserved. No restart path replays Generate. A `dispatched` response reports the input pair only; it does not report provider acceptance or a generated result.

Offline evidence: **16 test files / 153 tests PASS**, including 16 P04.2 integration tests for successful dispatch, one mouse pair, concurrency and repeat-click protection, exact saved-source input, zero activation on preflight failures, stale hash/target/settings rejection, partial activation, storage failures, and repository restart-state reconciliation. `npm run typecheck`, `npm run lint`, production build, and formatting/diff checks are recorded in PROJECT_STATUS.md. Build ID: `automat-faceless-0.1.0-mvs2r78k` (Vite 8.3.5; 162 modules; same ID in dashboard, worker and connector).

A local Playwright spec was added for the semantic local image composer and results baseline, but the runner could not start in this environment: Node failed to spawn its worker with `EPERM`, including with `--workers=1`. It is **NOT_RUN**, not passed. The pre-existing P04.1 local browser suite does not prove P04.2 behavior. No real Flow/provider page was accessed and no settings or provider action occurred.

## Remaining Phase 04 gates

- P04.2 implementation and offline evidence: **OFFLINE_VERIFIED**.
- P04.2 local Playwright fixture: **NOT_RUN** (`spawn EPERM`).
- P04.3 real Flow long-JSON entry and one authorized Generate observation: **NOT_STARTED / NOT_RUN**.
- P04.4 bounded pre-input/post-input failure attribution: **NOT_STARTED**.
- Actual Flow DOM selector compatibility, provider prompt-size acceptance, generated result attribution and terminal completion, and real MV3 worker suspension/restart: **UNVERIFIED**.
- Phase 04 and G-IMAGE-ONE remain **INCOMPLETE** until later required completion/attribution gates pass. P05 remains **NOT_STARTED**.
