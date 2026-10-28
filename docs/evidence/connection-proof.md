# P02.3 Offline Connection Proof and P02.4 Evidence Record

## P02.4 user evidence — read-only connection scope

**SCREENSHOT_EVIDENCE:** User-supplied screenshots show Flow and Vids **Connected** in the packaged dashboard. The Vids preservation screenshot shows an empty document; this evidence covers that empty-document test only.

**USER_REPORTED_PASS:** The user confirmed both Flow and Vids passed reconnect without provider refresh/content changes, Disconnect → Connect, and successful connection verification after extension reload. The user also confirmed the toolbar action reuses the existing dashboard. These reports are not independently observed or automated verification.

| Evidence item                                                   | Classification                                  | Scope / limit                                                        |
| --------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| Flow and Vids display Connected in the packaged dashboard       | SCREENSHOT_EVIDENCE (user-supplied screenshots) | Screenshot evidence; no independent UI observation is claimed.       |
| Reconnect without provider refresh/content changes              | USER_REPORTED_PASS — Flow and Vids              | User report; not independently observed or automated.                |
| Disconnect → Connect                                            | USER_REPORTED_PASS — Flow and Vids              | User report; not independently observed or automated.                |
| Toolbar action reuses existing dashboard                        | USER_REPORTED_PASS                              | Dashboard-level user report.                                         |
| Extension reload followed by successful connection verification | USER_REPORTED_PASS — Flow and Vids              | User report; not independently observed or automated.                |
| Vids content preservation                                       | SCREENSHOT_EVIDENCE; USER_REPORTED_PASS         | Shown empty-document test only.                                      |
| Generated-scene preservation                                    | NOT_VERIFIED                                    | No claim made.                                                       |
| Separate worker-suspension test                                 | NOT_VERIFIED                                    | Extension reload result does not establish a worker-suspension test. |

Chrome version was not supplied and is not recorded. P02.4 and Phase 02 are **DONE for the read-only connection scope** based on the offline evidence, screenshots, and user-reported checks above. The user evidence is not labeled LIVE_VERIFIED or as independent automation. Generation, provider prompt entry, OAuth, and downloads remain unimplemented; P00.2 representative prompt evidence remains pending; Phase 03 remains NOT_STARTED.

## P02.4 Vids document route correction — 28 October 2026

The user supplied the actual Vids route `https://docs.google.com/videos/d/VIDEO_ID/edit?pli=1&scene=id.p#scene=id.p`. Source review confirmed that discovery's shared parser and the injected connector accepted only the older `vids.google.com/video/{id}/edit` route, so the actual document was neither listed nor validated. Both now extract the document ID from `/videos/d/{id}/edit` and canonicalize internally to `https://docs.google.com/videos/d/{id}/edit`. Query parameters and the fragment are excluded from identity, while the original URL remains in the selected tab record and is never rewritten.

The discovery unsupported-route filter recognizes unsupported `/videos/` paths on `docs.google.com`; the scoped selected-provider permission request and MV3 optional host list now include `https://docs.google.com/*`. The earlier `vids.google.com` route and permission pattern remain supported. Flow route matching and target validation are unchanged. Focused regression tests cover discovery, canonical ID parsing, permission scoping, connector handshake with the scene query/fragment, and preservation of the unmodified URL.

Verification: `npm test -- --reporter=dot` PASS (8 files / 64 tests); `npm run typecheck`, `npm run lint`, Prettier check, production build, and `git diff --check` PASS. Vite 8.3.5 transformed 146 modules. The new shared build ID is **`automat-faceless-0.1.0-mvrrrsd0`**; dashboard, worker, helper chunk, and connector contain that ID. `dist/index.html` references `dashboard-CPZEm9bx.js`, `dashboard-D1qJG5eW.css`, and `openDashboard-BXB2KvTE.js`; built manifest includes the docs.google.com host pattern. These are offline and static package checks only. No Chrome tab was opened, refreshed, or changed; live route compatibility remains **NOT_RUN**.

## P02.4 connection API availability correction — historical build `automat-faceless-0.1.0-mvrq5ne8`

The reported failure on build `automat-faceless-0.1.0-mvrq5ne8` was traced to the dashboard-side guard in `createChromeConnectionPort()`: it required `chrome.scripting.executeScript` before returning any connection port. `scripting` is an optional permission and is needed only at the authorized connector-injection stage. When that API namespace was unavailable before permission was granted, Connect classified the packaged dashboard as lacking all Chrome connection APIs, so the user could not reach the provider-specific permission step. The source-level bootstrap dependency is confirmed; the exact API shape in the user's Chrome session was not captured, so the user's runtime instance remains unobserved.

The guard now checks only the packaged extension context, tab messaging/lookup, and permission inspection/request APIs needed to begin connection setup. It does not require worker messaging for the direct dashboard-to-tab attachment path. Discovery, explicit permission requests, worker messaging, and connector injection each have stage-specific API checks. `chrome.scripting.executeScript` is checked only when injection or top-frame document identification is required, after the selected target's missing permissions have been reported and granted through its explicit user-click action. The selected host request stays scoped to the validated provider origin; the manifest still lists `tabs` and `scripting` as optional. Existing target, project, top-frame, protocol, capability, and build validation remains in place.

When the setup guard fails, the panel first shows a pending status, then renders the complete wrapping diagnostic beneath the provider controls. The diagnostic reports execution context, stage, missing API name, runtime ID presence, and `scripting`/selected-host permission state. A `chrome-extension:` dashboard with no runtime ID is identified as `invalidated_extension_context`; localhost and other invalid contexts remain separate. No full URL, credential, or page content is included. Example safe retest output:

```text
connection_api_unavailable; context=packaged_extension; stage=connector_injection; missing_api=chrome.scripting.executeScript; runtime.id=present; permission.scripting=not_granted; permission.selected_host=not_granted
```

New production build: **`automat-faceless-0.1.0-mvrrfkyt`**. `dist/index.html` references `dashboard-BmS79ohz.js`, `dashboard-D1qJG5eW.css`, and `openDashboard-BxjufvJd.js`; the dashboard bundle, helper chunk, worker, and standalone connector contain the same shared build ID. Source and built manifests retain MV3, minimum Chrome `106`, optional `tabs`/`scripting`, and the existing scoped Flow/Vids host patterns. This is static artifact evidence only.

Regression coverage includes a packaged context before optional permissions are granted with `chrome.scripting` absent, the explicit permission request, injection availability after grant, already-granted permissions without requiring a popup, denied and rejected permission requests, localhost and invalid/invalidated contexts, and a packaged connection port that remains available without worker messaging. Complete error rendering and pending cleanup are tested. Results: **8 test files / 63 tests PASS**, typecheck PASS, lint PASS, changed-file Prettier PASS, production build PASS (Vite 8.3.5; 146 modules), and `git diff --check` PASS. The initial sandboxed Vitest invocation hit Windows `spawn EPERM` before test discovery; rerun with process-spawn permission passed.

Browser-control availability was checked and returned no apps or browsers. Chrome UI reproduction, packaged extension retest, permission prompts, live Flow/Vids connections, and Vids preservation remain **NOT_RUN**. The source confirms the bad guard and the regression test exercises its failure condition; it does not prove which Chrome API was absent in the user's original session. At that point P02.4 and Phase 02 remained incomplete; the current scope status is recorded above.

Date: 28 October 2026  
P02.3 evidence level: **OFFLINE_VERIFIED**  
P02.4 implementation attempt: **PREPARED; live gate NOT_RUN**

## P03 connection lifecycle integration fix — 28 October 2026

The observed disconnected warning was caused by the service worker's startup signal. `src/background/index.ts` emits `FOUNDATION_WORKER_RESTARTED` each time the MV3 worker is evaluated after a genuine restart or wake. `ConnectionStatus` treated that signal as a command to invalidate both providers and release their connectors. Saving or loading a batch did not itself invalidate provider state; the batch request could coincide with a worker wake after idle time. Repeated delivery from one worker instance is now deduplicated by its instance ID.

Connection state is owned in the dashboard component; the explicitly selected tab ID and canonical target are durable. Dashboard navigation keeps the connection panel mounted (views are switched in the app shell), so Images/Videos navigation and preview/save/load do not clear it. The runtime listeners now have stable effect lifetime and read current state through refs. On a real worker start or dashboard reopen, enabled saved targets enter **Checking connection…** and receive a bounded read-only handshake using the exact saved tab ID. Provider, tab, canonical identity, build, protocol, document, and read-only capability are checked by the existing no-refresh path. Closed, changed, unsupported, inaccessible, and permission-blocked targets remain visibly blocked; the code does not choose a substitute tab. Newly selected targets remain opt-out until a successful explicit Connect; legacy saved targets without this preference remain eligible for fresh verification. A manual Disconnect persists `reconnectEnabled=false`; worker starts and dashboard reopen preserve that choice until the user explicitly connects again. Vids query/fragment changes retain canonical document identity and do not count as a changed target.

Async attachment and verification results are guarded by per-provider revisions and current target/intent checks. A stale success cannot restore Connected after a newer selection or manual Disconnect, and a late connector is released when it no longer matches the user's current intent. Permission requests remain directly in the explicit click handler. Restart recovery does not replay prompt or generation operations. The additive database v3 schema preserves existing prompt batches and records the reconnect intent; no destructive migration was introduced.

Regression evidence: `tests/unit/connections.test.ts` checks genuine/current versus malformed or stale worker events, exact persisted-target verification, changed/closed target blocking, Vids query/fragment identity, and unused provider refresh/navigation/content mutation actions. `tests/unit/connectionPresentation.test.tsx` checks that connection ownership stays in the persistent dashboard shell while workspace views switch. `tests/unit/repositories.test.ts` checks that manual disconnect intent survives worker unverified marking and that legacy targets remain eligible for verification. Prompt save/load integration tests check that selected target records remain intact. On 28 October 2026, the focused suites passed **5 files / 62 tests**; the full suite passed **12 files / 123 tests**; typecheck, lint, and formatting passed. Production build passed (Vite 8.3.5; 154 modules). Shared build ID: **`automat-faceless-0.1.0-mvrxwne7`** across the dashboard, worker, and connector. `git diff --check` is recorded after documentation updates.

Browser-control inventory returned no apps or browsers. Packaged restart/reopen and provider handshake verification are **NOT_RUN**. The successful image/video save, dashboard reopen, load, and kind-isolation observations are recorded separately as **USER_REPORTED_PASS** in [prompt-preservation evidence](prompt-preservation.md); they are not independent browser verification. No provider settings, prompts, generation, or page refresh actions were performed for this integration fix.

## P02.4 verification attempt — 28 October 2026

**Evidence source:** local source/build inspection and mocked unit tests. No Chrome UI, extension management page, or provider tab was available through the browser-control surface (`apps: []`, `browsers: []`). Local Chrome process inventory returned processes but no usable browser session or version. No separate profile was launched. No extension was loaded, and no Flow/Vids page was accessed. Therefore every live browser/provider check below remains **NOT_RUN**.

### Build under test

The production build was rebuilt after a focused toolbar-action correction: repeated action clicks now ask the open packaged dashboard to focus its own tab/window before creating a dashboard tab. This correction was necessary because the inspected implementation always created a new tab. Mocked tests cover this path and assert no provider-tab reload, navigation, close, or replacement API is called. Runtime toolbar behavior remains NOT_RUN.

| Artifact                      | Observed value                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Extension version             | `0.1.0`                                                                                            |
| Shared build ID               | `automat-faceless-0.1.0-mvrq5ne8`                                                                  |
| Manifest                      | MV3; `background.js`; minimum Chrome `106`                                                         |
| Dashboard                     | `index.html` references `assets/dashboard-DM_L_T6C.js` and `assets/dashboard-D1qJG5eW.css`         |
| Worker                        | `dist/background.js` exists and contains the shared build ID                                       |
| Connector                     | `dist/connection-probe.js` exists, contains the same build ID, and has no import/export statements |
| Dashboard/worker helper chunk | `assets/openDashboard-C36R7kPR.js` exists and contains the shared build ID                         |
| Runtime/browser version       | Not available; Chrome UI could not be controlled or identified                                     |

Static artifact references and build identity agree. This proves only the generated package contents; manifest loading, worker registration, extension origin, packaged asset serving, and runtime build identity remain NOT_RUN.

### Offline check results for this attempt

- `npm test -- --run`: PASS, 8 files / 61 tests.
- `npm run typecheck`: PASS (`tsc --noEmit`).
- `npm run lint`: PASS (`eslint .`).
- `npm run build`: PASS (Vite 8.3.5; 145 modules transformed).
- Source `public/manifest.json` and built `dist/manifest.json` compare equal. Both declare optional `tabs`/`scripting` and only the Flow/Vids host patterns; this validates the local package, not which package the user's Chrome currently has loaded.
- Changed-file Prettier check: PASS; `git diff --check`: PASS after documentation edits.
- The first two sandboxed Vitest attempts failed before test discovery with Windows `spawn EPERM`; the suite passed when rerun with elevated process permission. One test synchronization issue was corrected before the passing run.

### Discovery failure investigation

Source inspection confirmed a permission-flow weakness: the original discovery click awaited `permissions.contains({permissions:["tabs"]})` and then called `permissions.request()` in the same handler. Chrome documents that optional permission requests must originate from a user gesture. The revised flow inspects the permission on **Find open projects**; if missing, it stops before querying and displays a separate **Allow tab access for discovery** button. That button invokes `permissions.request({permissions:["tabs"]})` as its first asynchronous API call from its own click. Only after grant does it query tabs. A denial remains a visible permission-denied message. Discovery requests only the optional `tabs` permission; `scripting` and the exact selected provider host remain separate and are still requested only during explicit Connect.

Discovery now distinguishes a missing permission, denied/request-failed permission, a rejected `tabs.query`, a supported provider origin with an unsupported editor/project route, unavailable/redacted URLs, and no matching project URL. It does not infer project identity from a title. Supported canonical routes are Flow `/project/{projectId}` on `flow.google.com`, the existing Flow `/fx/tools/flow/{projectId}` on `labs.google`, current Vids `/videos/d/{documentId}/edit` on `docs.google.com`, and previously supported Vids `/video/{documentId}/edit` on `vids.google.com`.

The user supplied the intended Flow URL pattern `https://flow.google.com/project/PROJECT_ID` (private ID omitted). The original parser and connector accepted only the older `labs.google/fx/tools/flow/{id}` route, so they rejected this supplied route. The strict Flow project ID character rule `[A-Za-z0-9_-]+` remains; the new accepted route is exactly `/project/{id}` with an optional trailing slash and query/fragment excluded from the canonical target. Nested routes, lookalike hosts, credentials, and wrong-project handshake IDs remain rejected. `https://flow.google.com/*` was added as an optional host pattern. During Connect, the required host grant is now derived from the explicitly selected tab's validated canonical origin, so legacy Flow, current Flow, and Vids request only their own host; no host grant is requested for a provider/target mismatch. The connector validates the same exact route and project ID before reporting read-only reachability.

Focused tests include first use with no optional permission granted (query remains uncalled until the separate permission request succeeds), direct permission-request invocation, query rejection, unsupported Flow route, unavailable URL, and the no-match case. Route tests cover the user-supplied Flow pattern, strict project ID extraction, nested-route rejection, spoofed-host rejection, and credential rejection. Connector tests confirm the current Flow host responds only for the matching project ID. **Confirmed causes:** the source lacked the user's supplied Flow route, and the discovery permission sequence did not make the required permission step explicit/directly gesture-bound. **Not confirmed:** whether either was the sole runtime cause of the reported no-project result; Chrome state, permission state, and live route parsing were not observed. Live discovery remains pending user retest.

### Connect failure diagnostics for build `automat-faceless-0.1.0-mvrq5ne8`

The user reported that Connect on build `mvrpitid` produced no visible permission popup or connection, and the narrow panel truncated its status text. The exact failed runtime stage was not observable, so permission denial was not assumed. Source trace found that Connect itself uses direct `tabs`, `permissions`, and `scripting` APIs; the dashboard-to-worker channel is used for selection persistence, not the read-only attach. Selection persistence worker failures now preserve the client's safe error category/code. Promise-based Chrome APIs reject on failure; failures are mapped to bounded stage diagnostics rather than logging raw exception text, target URLs, page content, or credentials.

Connect now inspects `scripting` and the explicitly selected host grant before attaching. If either is missing, it shows a scoped **Allow requested Flow/Vids access** control; its click invokes `permissions.request()` directly before any awaited work. A `true`/already-granted state proceeds without relying on a popup. A `false` result is shown as `permission_denied`; a rejected request has a separate `permission_request` failure. No automatic retry occurs after grant; the user clicks Connect again. The request contains only missing `scripting` and the selected tab's exact validated host origin.

The status label is compact; full stage and actionable error text is rendered in a separate wrapping alert below that provider's controls. Pending status is set synchronously before awaited reconnect cleanup and the operation clears the busy state in `finally` on success, returned failure, or thrown failure. Failure stages distinguish permission inspection, selected-target validation, connector injection, top-frame handshake, and response validation. Ping errors remain the expected no-listener signal that leads to a safe injection attempt; injection/handshake rejection is then reported at its actual stage. A missing connector response is not presented as a permission denial. No unsafe raw exception or provider response message is surfaced.

Regression coverage now includes already-granted access (no permission request and no popup dependency), a denied permission result, a rejected permission promise, permission-inspection failure, selected-host scoping, connection injection and handshake failures, worker rejection/unavailable receiver categories, complete alert text without ellipsis, and pending cleanup on resolved/rejected operations. These are offline unit tests. Live Chrome permission UI, actual runtime failure stage, Flow/Vids connection, and content preservation remain **NOT_RUN**.

### Earlier live verification status — before the user evidence above

At the time of that earlier note, no Chrome version, extension load result, optional permission prompt, tab/document identity, connector handshake, connected state, repeat-connect reuse, disconnect/reconnect, worker restart, extension reload, or content-preservation result had been independently observed, and no screenshots had been supplied. The user reported for prior build `mvrpitid` that Flow discovery worked, the Flow project was explicitly selected, and Connect showed no popup or success while the short status was clipped; that remains `USER_REPORTED` evidence for the failed attempt only. Subsequent screenshots and USER_REPORTED_PASS results are recorded above. The historical earlier note did not record Vids content/timeline or Flow page state before/after.

The following manual handoff was written before the later user evidence above and is retained as historical context.

### Manual live handoff from the earlier offline attempt (superseded)

1. In the existing Chrome profile, open `chrome://settings/help` and record the Chrome version. Open `chrome://extensions`, enable Developer mode, and use **Load unpacked** to select this workspace's `dist` directory. Do not reload any provider tab.
2. On `chrome://extensions`, click **Reload** on only Automat Faceless. Then click its toolbar action to open/reopen the packaged dashboard. Do not refresh the dashboard manually or any provider tab. Confirm no manifest/worker load error, the address starts with `chrome-extension://`, and the dashboard build ID is `automat-faceless-0.1.0-mvrrfkyt`. Click the toolbar action once more and confirm the existing dashboard is focused rather than a duplicate appearing.
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
- Flow `/project/{projectId}` and `/fx/tools/flow/{projectId}` routes, current Vids `/videos/d/{documentId}/edit`, and previous Vids `/video/{documentId}/edit` routes are accepted; unsupported routes and origins are rejected. Vids query parameters and fragments do not affect canonical identity.
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

## Earlier P02.4 live-read-only checklist — NOT_RUN at the time of the offline attempt

This checklist records the state before the later user evidence above. Its NOT_RUN entries are historical and are superseded for read-only connection completion by the current evidence record.

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
