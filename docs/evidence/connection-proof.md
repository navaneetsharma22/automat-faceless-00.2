# P02.3 Offline Connection Proof and P02.4 Live Checklist

Date: 28 October 2026  
P02.3 evidence level: **OFFLINE_VERIFIED**  
P02.4 live gate: **NOT_RUN**

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
