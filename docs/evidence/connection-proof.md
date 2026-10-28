# P02.3 Offline Connection Proof and P02.4 Live Checklist

Date: 28 October 2026  
P02.3 evidence level: **OFFLINE_VERIFIED**  
P02.4 implementation attempt: **PREPARED; live gate NOT_RUN**

## P02.4 verification attempt — 28 October 2026

**Evidence source:** local source/build inspection and mocked unit tests. No Chrome UI, extension management page, or provider tab was available through the browser-control surface (`apps: []`, `browsers: []`). Local Chrome process inventory returned processes but no usable browser session or version. No separate profile was launched. No extension was loaded, and no Flow/Vids page was accessed. Therefore every live browser/provider check below remains **NOT_RUN**.

### Build under test

The production build was rebuilt after a focused toolbar-action correction: repeated action clicks now ask the open packaged dashboard to focus its own tab/window before creating a dashboard tab. This correction was necessary because the inspected implementation always created a new tab. Mocked tests cover this path and assert no provider-tab reload, navigation, close, or replacement API is called. Runtime toolbar behavior remains NOT_RUN.

| Artifact                      | Observed value                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Extension version             | `0.1.0`                                                                                            |
| Shared build ID               | `automat-faceless-0.1.0-mvrpitid`                                                                  |
| Manifest                      | MV3; `background.js`; minimum Chrome `106`                                                         |
| Dashboard                     | `index.html` references `assets/dashboard-DpK9DeQR.js` and `assets/dashboard-BnJUkPcU.css`         |
| Worker                        | `dist/background.js` exists and contains the shared build ID                                       |
| Connector                     | `dist/connection-probe.js` exists, contains the same build ID, and has no import/export statements |
| Dashboard/worker helper chunk | `assets/openDashboard-GsY6D-kY.js` exists and contains the shared build ID                         |
| Runtime/browser version       | Not available; Chrome UI could not be controlled or identified                                     |

Static artifact references and build identity agree. This proves only the generated package contents; manifest loading, worker registration, extension origin, packaged asset serving, and runtime build identity remain NOT_RUN.

### Offline check results for this attempt

- `npm test -- --run`: PASS, 7 files / 54 tests.
- `npm run typecheck`: PASS (`tsc --noEmit`).
- `npm run lint`: PASS (`eslint .`).
- `npm run build`: PASS (Vite 8.3.5; 143 modules transformed).
- Source `public/manifest.json` and built `dist/manifest.json` compare equal. Both declare optional `tabs`/`scripting` and only the Flow/Vids host patterns; this validates the local package, not which package the user's Chrome currently has loaded.
- Changed-file Prettier check: PASS; `git diff --check`: PASS after documentation edits.
- The first two sandboxed Vitest attempts failed before test discovery with Windows `spawn EPERM`; the suite passed when rerun with elevated process permission. One test synchronization issue was corrected before the passing run.

### Discovery failure investigation

Source inspection confirmed a permission-flow weakness: the original discovery click awaited `permissions.contains({permissions:["tabs"]})` and then called `permissions.request()` in the same handler. Chrome documents that optional permission requests must originate from a user gesture. The revised flow inspects the permission on **Find open projects**; if missing, it stops before querying and displays a separate **Allow tab access for discovery** button. That button invokes `permissions.request({permissions:["tabs"]})` as its first asynchronous API call from its own click. Only after grant does it query tabs. A denial remains a visible permission-denied message. Discovery requests only the optional `tabs` permission; `scripting` and the exact selected provider host remain separate and are still requested only during explicit Connect.

Discovery now distinguishes a missing permission, denied/request-failed permission, a rejected `tabs.query`, a supported provider origin with an unsupported editor/project route, unavailable/redacted URLs, and no matching project URL. It does not infer project identity from a title. Supported canonical routes are Flow `/project/{projectId}` on `flow.google.com`, the existing Flow `/fx/tools/flow/{projectId}` on `labs.google`, and Vids `/video/{documentId}/edit` on `vids.google.com`.

The user supplied the intended Flow URL pattern `https://flow.google.com/project/PROJECT_ID` (private ID omitted). The original parser and connector accepted only the older `labs.google/fx/tools/flow/{id}` route, so they rejected this supplied route. The strict Flow project ID character rule `[A-Za-z0-9_-]+` remains; the new accepted route is exactly `/project/{id}` with an optional trailing slash and query/fragment excluded from the canonical target. Nested routes, lookalike hosts, credentials, and wrong-project handshake IDs remain rejected. `https://flow.google.com/*` was added as an optional host pattern. During Connect, the required host grant is now derived from the explicitly selected tab's validated canonical origin, so legacy Flow, current Flow, and Vids request only their own host; no host grant is requested for a provider/target mismatch. The connector validates the same exact route and project ID before reporting read-only reachability.

Focused tests include first use with no optional permission granted (query remains uncalled until the separate permission request succeeds), direct permission-request invocation, query rejection, unsupported Flow route, unavailable URL, and the no-match case. Route tests cover the user-supplied Flow pattern, strict project ID extraction, nested-route rejection, spoofed-host rejection, and credential rejection. Connector tests confirm the current Flow host responds only for the matching project ID. **Confirmed causes:** the source lacked the user's supplied Flow route, and the discovery permission sequence did not make the required permission step explicit/directly gesture-bound. **Not confirmed:** whether either was the sole runtime cause of the reported no-project result; Chrome state, permission state, and live route parsing were not observed. Live discovery remains pending user retest.

### Live verification still NOT_RUN

No Chrome version, extension load result, optional permission prompt, explicit project target, tab/document identity, connector handshake, connected state, repeat-connect reuse, disconnect/reconnect, worker restart, extension reload, or content-preservation result was observed. Flow and Vids targets were not selected. Existing Vids content/timeline and Flow page state were not inspected before or after attachment. No screenshots are available. No user-reported live results have been received.

The prior checklist remains a set of steps, not evidence of execution. Use the manual handoff below in the user's existing Chrome profile; do not refresh, navigate, replace, close/reopen, or modify either provider tab.

### Manual live handoff (USER_REPORTED evidence requested)

1. In the existing Chrome profile, open `chrome://settings/help` and record the Chrome version. Open `chrome://extensions`, enable Developer mode, and use **Load unpacked** to select this workspace's `dist` directory. Do not reload any provider tab.
2. On `chrome://extensions`, click **Reload** on only Automat Faceless. Then click its toolbar action to open/reopen the packaged dashboard. Do not refresh the dashboard manually or any provider tab. Confirm no manifest/worker load error, the address starts with `chrome-extension://`, and the dashboard build ID is `automat-faceless-0.1.0-mvrpitid`. Click the toolbar action once more and confirm the existing dashboard is focused rather than a duplicate appearing.
3. Click **Find open projects**. If the interface says tab permission is required, click **Allow tab access for discovery** and grant only the `tabs` request. Discovery should then list exact URL-supported targets; denied/missing permissions, query failure, unsupported route, unavailable URL, and no-match result have distinct messages. Explicitly select the intended already-open Flow project and Vids document; never rely on title alone. Record sanitized IDs only; do not copy page content or credentials. Connect prompts should request only the selected provider's `scripting` and host permission, if missing.
4. Before connecting Vids, note a privacy-safe description or screenshot of the existing generated items/timeline. Connect Flow and Vids separately. Confirm read-only connection state and matching build identity. Repeat Connect, then Disconnect and Reconnect. Verify URLs/document IDs are unchanged and no page content/timeline/settings changed. Do not generate, fill prompts, alter settings/timeline, download, refresh, or navigate.
5. Restart the extension worker and reload the extension using Chrome controls while leaving provider tabs untouched. Confirm stale saved target metadata is not shown as Connected and a fresh handshake is required. Confirm reconnection targets the same explicit projects without provider refresh.
6. Return the results below. Mark them `USER_REPORTED`; they are not independently observed by this session.

| Result to report                                                           | Flow | Vids |
| -------------------------------------------------------------------------- | ---- | ---- |
| Chrome version; extension load result; dashboard origin/build ID           |      |      |
| Explicitly selected project identity and sanitized tab/document IDs        |      |      |
| Permission names/prompts and outcome                                       |      |      |
| First connection state, top-frame/read-only handshake, build ID            |      |      |
| Repeated Connect; Disconnect/Reconnect; same target, no provider refresh   |      |      |
| Worker restart and extension reload; fresh handshake required              |      |      |
| Provider state before/after; for Vids, existing content/timeline preserved |      |      |

Until both providers pass the real connection gate and Vids preservation is confirmed, P02.4 and overall Phase 02 remain incomplete.

## Offline evidence

The connection implementation is in `src/app/components/ConnectionStatus.tsx`, `src/platforms/shared/connection.ts`, `src/platforms/shared/chromeConnectionPort.ts`, `src/platforms/shared/connectionProbe.ts`, and `src/platforms/shared/connectionLifecycle.ts`. The offline suite uses mocks and local fixtures only.

`npm test` passed **7 test files / 48 tests**. Connection cases cover:

- Selection of a named candidate among multiple Flow tabs; no first-match selection.
- Observed Flow `/fx/tools/flow/{projectId}` and Vids `/video/{documentId}/edit` routes; unsupported routes and origins are rejected.
- Revalidation of current project route before attachment, before the final handshake, and after it; changed project/document and non-top-frame identity fail visibly.
- Inspection of existing optional permission state; tab listing asks only for `tabs`; connection asks only for missing `scripting` and the selected provider origin; denial stays `permission-needed`.
- Graceful local preview when Chrome extension APIs are absent.
- Compatible connector ping/reuse, absent connector injection, legacy stale listener blocking, safe replacement of a known listener, incompatible protocol/build handling, and missing receiver/injection failures.
- Attempt ID correlation, one in-flight attachment per provider/tab, duplicate listener prevention, worker restart invalidation, and closed-tab disconnection.
- Spies representing reload, navigation, tab replacement/close/reopen, provider content/settings/timeline mutation remain unused on success and failure.

The offline handshake binds the final message to Chrome's `documentId` and frame 0 from the `scripting.executeScript` result. It confirms the current route/project ID, extension build/protocol, attempt ID, document token, and `read-only-connection-v1` capability. The dashboard exposes its shared build ID in the collapsed technical details; the worker logs its ID at startup, and the injected connector returns its ID in the handshake. This connector does not advertise generation capability. The selected-target repository record remains `unverified`; the dashboard's Connected state is in-memory only and is cleared on worker startup, tab URL change, tab close, or disconnect.

Other checks on 28 October 2026: `npm run typecheck` PASS; `npm run lint` PASS; changed-file Prettier PASS; `npm run build` PASS (Vite 8.3.5, 142 modules transformed); `git diff --check` PASS. The production manifest references an emitted `background.js`; dashboard asset references exist; the injected `connection-probe.js` is a standalone script with no imports. The build ID `automat-faceless-0.1.0-mvroba9a` was present in the dashboard bundle, worker and connector bundle. This confirms static build identity in the generated artifacts only, not runtime identity on live provider tabs. The generated files were not loaded into Chrome.

## Boundaries not proven offline

These tests do not prove live Google routes, Chrome permission prompt behavior, actual browser `documentId` targeting, current provider page compatibility, IndexedDB execution in Chrome, or preservation of existing Vids content/timeline/settings. No real provider tab or browser session was accessed. No extension was loaded unpacked. No prompt, settings, editor, timeline, or generated content was touched.

## P02.4 live-read-only checklist — NOT_RUN

Do not treat this checklist as evidence of execution. Record each result and attach screenshots only after the user-authorized P02.4 checks are performed.

| Check                                                                                                                            | Status      | Evidence to record                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| Load the production `dist` build unpacked and confirm manifest/worker/dashboard build IDs                                        | **NOT_RUN** | Extension version, build ID shown by dashboard/worker/connector             |
| Connect to the user's explicitly selected, already-open Flow project; compare URL/project before and after                       | **NOT_RUN** | Selected tab title, canonical project ID, document ID, read-only capability |
| Reconnect to the same Flow project without refresh/navigation                                                                    | **NOT_RUN** | Before/after tab URL and document ID; no page reload/navigation             |
| Connect to the user's explicitly selected, already-open Vids document; inventory its existing content/timeline before connection | **NOT_RUN** | User-approved visual baseline of existing Vids content and timeline         |
| Reconnect to that same Vids document without refresh/navigation and compare its content/timeline/settings                        | **NOT_RUN** | Before/after evidence showing existing content remains intact               |
| Confirm permission-denied, closed-tab, wrong-project, stale-build and missing-connector feedback on isolated/test targets        | **NOT_RUN** | Target IDs, visible state and safe failure outcome                          |
| Confirm disconnect releases the extension connector listener without changing provider content                                   | **NOT_RUN** | Read-only before/after document comparison                                  |

Required safety invariants during P02.4: use only the explicitly selected existing provider tab; do not refresh, navigate, replace, close/reopen, edit prompts/settings/content, generate, or download. If a handshake fails, report the visible failure and retry without refresh. Existing Vids content integrity must be checked before and after connection before any live-preservation claim is made.
