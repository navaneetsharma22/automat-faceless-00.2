# P02 — Toolchain, MV3 foundation and platform connections

Status: **DONE for the read-only connection scope.** P02.1–P02.3 are OFFLINE_VERIFIED. P02.4 has recorded offline evidence, user screenshots, and USER_REPORTED_PASS checks; user checks are not described as independent or automated verification.

**Outcome:** The new dashboard and worker connect read-only to the intended Flow/Vids targets with visible build identity.

**Prerequisites:** P00.1.

**Requirements:** R04, C06, C07, C09, C11.

## Required context

- [Agent instructions](../AGENTS.md)
- [Current status](../PROJECT_STATUS.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [DATA_MODEL.md](../DATA_MODEL.md)
- [CODING_STANDARDS.md](../CODING_STANDARDS.md)
- [TESTING.md](../TESTING.md)

## One-by-one subphases

The file lists below are planned paths in the new project. They are the initial editing scope, not a claim that source already exists. A necessary dependency edit may be added with an explanation; preserve unrelated work.

### P02.1 — Create and pin a compatible project toolchain

Evidence mode: **offline**. Reuse the Phase 00-installed Node/npm, package tree, lockfile, and scripts; do not recreate the project or reinstall working dependencies. Actual P02.1 evidence is recorded below.
Start in these files:

- package.json
- package-lock.json
- tsconfig.json
- tsconfig.app.json
- vite.config.ts
- eslint.config.js
- src/main.tsx

Acceptance: Install only chosen compatible dependencies; record actual runtime/tool versions. Typecheck/lint/build scripts work. Do not repeat stale package versions from memory or upgrade unrelated packages.

Observed setup: a single root `tsconfig.json` is used; no `tsconfig.app.json` exists or is required by the current scripts. Vitest configuration is embedded in `vite.config.ts`. Do not add split configuration solely to match this card's initial planned file list.

P02.1 verification on 28 October 2026: Node 22.19.0 and npm 10.9.3; dependency tree resolved with `npm ls --depth=0`; TypeScript 5.9.3, Vite 8.3.5, ESLint 10.13.0, Vitest 5.0.5, and `@vitejs/plugin-react` 6.1.2 are lockfile-installed. Installed metadata engine ranges accept the current Node runtime. `npm test` passed 4 files / 20 tests; typecheck, lint, Prettier, and production build passed. No packages were installed/upgraded and no configuration fix was needed.

The production build currently emits the React dashboard (`dist/index.html` and hashed dashboard JS/CSS), shared contract chunk, and standalone `dist/connection-probe.js`. The copied manifest currently has no `background.service_worker`, `action.default_popup`, or connector declaration. The generic probe output is not a provider connector. No worker has been built, and the production folder is not yet a complete load-unpacked extension.

Planned build entries at the P02.1 boundary were dashboard `index.html` -> `dist/index.html` plus dashboard assets; MV3 worker `src/background/index.ts` -> `dist/background.js` and a manifest `background.service_worker` entry; Flow and Vids connector entry points -> standalone packaged scripts wired by the manifest or targeted injection, without relying on the generic probe as the connector. P02.2 has now implemented dashboard/worker/probe packaging; the provider connector entries remain future work.

Planned Chrome minimum: **Chrome 106+**. The future target validation uses browser document identity; Chrome documents `documentId` on `runtime.MessageSender` and `scripting.InjectionResult` from Chrome 106. P02.2 now declares `minimum_chrome_version: "106"` in the production manifest. See [Chrome runtime MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime) and [Chrome scripting InjectionResult](https://developer.chrome.com/docs/extensions/reference/api/scripting).

### P02.2 — Add MV3 messaging and durable repository boundaries

Evidence mode: **offline**.
Start in these files:

- public/manifest.json
- src/background/index.ts
- src/background/handlers/connections.ts
- src/shared/messages.ts
- src/shared/schemas.ts
- src/storage/db.ts
- src/storage/repositories.ts
- tests/unit/messages.test.ts

Acceptance: Validated request/response IDs and appropriate async channels work in mocks. Immediate pending feedback is supported. No provider Generate command exists yet.

Planned requirements:

- Validate messages and correlate requests by ID; show immediate pending feedback and classify distinct errors.
- Define durable repository boundaries for app-owned records.
- Add an extension-only synthetic long-text round-trip test that proves exact string preservation.
- Do not inherit an arbitrary 12,000-character cap. Provider-side limits remain separately unverified.

P02.2 result on 28 October 2026: **OFFLINE_VERIFIED**. The production manifest declares Chrome 106+, a module service worker (`background.js`), and a toolbar action that opens a new full-tab extension dashboard. It never searches for, updates, or replaces provider tabs. Chrome 106 supports the selected runtime document identity APIs and the current MV3 scripting/message APIs used by this foundation.

Permission rationale:

- Required `storage`: Chrome `storage.local` stores the small theme preference.
- Optional `tabs`: the existing user-triggered connection preview enumerates and inspects already-open tabs; it is requested only when the user asks to find tabs.
- Optional `scripting`: only the selected provider tab's top frame needs the packaged read-only probe injected.
- Optional host access to `https://labs.google/*` and `https://vids.google.com/*`: grants injection/message access only to the supported provider origins after selection.
- No downloads, identity/OAuth, activeTab, all-sites, or unlimited-storage permission is declared. Opening the dashboard uses `tabs.create` for the extension URL and requires no provider-tab mutation.

`content_security_policy.extension_pages` is explicitly `script-src 'self'; object-src 'self';`. All executable entries and chunks are local. The built manifest points to `background.js`; `index.html` references its hashed dashboard assets; the standalone `connection-probe.js` is packaged for the existing targeted-injection path. The dashboard action opens a new extension tab per click. Successful build/file checks do not mean the extension was loaded unpacked.

The worker accepts only the extension dashboard sender at its exact extension URL. Requests carry protocol version, build ID, request ID, operation type, and Zod-validated payload. Async responses use `runtime.onMessage`/`sendResponse` with the listener returning `true`, compatible with the selected Chrome minimum; no long-lived Port is held. The client calls its local pending callback before sending and uses operation-specific deadlines capped at 30 seconds. Responses are correlated by request ID; a bounded recent-ID set rejects duplicates. Errors distinguish invalid request, unauthorized sender, protocol/build mismatch, duplicate request, missing record, storage failure, missing receiver, worker failure, malformed response, and timeout. A timed-out caller ignores a late response.

The extension worker owns Dexie namespace `automat-faceless-app-v1`; it defines prompt draft, selected target, workflow, and draft-batch tables. Prompt text is stored and returned as raw strings without parsing, stringification, normalization, or a fixed length cap. Chrome Storage is limited to theme preference. Selected-target records start unverified, and worker startup waits for persisted targets to be marked unverified before processing messages. No generation queue or provider command was added.

Synthetic fixture round-trips passed through the mocked Chrome JSON-envelope transport, actual message listener/dispatcher, `ExtensionRepositories` class, and a map-backed table adapter implementing the repository boundary:

| Fixture              | Characters | UTF-8 bytes | Newline |
| -------------------- | ---------: | ----------: | ------- |
| LF multiline JSON    |     15,913 |      20,815 | LF      |
| CRLF multiline JSON  |     15,918 |      20,820 | CRLF    |
| Large multiline JSON |  1,260,163 |   1,652,165 | LF      |

Fixtures include decimal arrays, escaped quotes, backslashes, Hindi, and Unicode symbols. These tests prove exact preservation for the stated synthetic sizes only; they do not establish real Chrome transport limits, IndexedDB browser execution, or provider-side limits. The Dexie schema metadata and boundary behavior are unit-tested, but this environment has no IndexedDB implementation in Node, so actual IndexedDB transactions were not exercised.

Focused verification: `npm test` PASS (7 files, 34 tests); `npm run typecheck`, `npm run lint`, changed-file Prettier, `npm run build`, and `git diff --check` PASS. Vite 8.3.5 transformed 139 modules and emitted `dist/index.html`, `dist/background.js`, `dist/connection-probe.js`, dashboard assets, and the required local worker chunk. Manifest and generated HTML/worker asset references were inspected and found in `dist`.

No extension load, provider tab access, live attachment, OAuth, prompt fill, generation, download, or refresh was performed for P02.2. At that handoff P02.3 was still pending; its current offline evidence is recorded below. P02.4 remains **NOT_STARTED**.

### P02.3 — Connect Flow and Vids using explicit target selection

Evidence mode: **offline**. Result on 28 October 2026: **OFFLINE_VERIFIED**; live attachment NOT_RUN (see [connection proof](../docs/evidence/connection-proof.md)).
Start in these files:

- src/platforms/shared/contracts.ts
- src/platforms/shared/connection.ts
- src/platforms/shared/chromeConnectionPort.ts
- src/platforms/shared/connectionProbe.ts
- src/app/components/ConnectionStatus.tsx
- tests/unit/connections.test.ts

Acceptance: Connect only to the explicitly selected canonical project/document, browser document ID, top-frame context and read-only connector capability. Do not guess a tab by first-match convenience. Connection reachability does not imply generation capability.

Planned requirements:

- Require explicit selection of an existing Flow or Vids project tab; validate project identity, browser document identity, top-frame context, connector capability, and build identity.
- Reuse a compatible existing connector and inject only when necessary.
- Prevent duplicate listeners and concurrent duplicate attachment attempts.
- Inspect optional permissions before requesting only the selected provider's required access from an explicit user action; denial/withholding remains a visible permission-needed state.
- Keep pending, connected, disconnected, permission-needed, wrong-target, stale-build and failed states distinct. Persist selected-target metadata without persisting live connection proof; revalidate after worker restart and invalidate on project/document change.
- Disconnect releases extension-owned listeners/channels without modifying the provider page. Connector reachability is not generation capability.
- Connect/Reconnect must never refresh, navigate, replace, close/reopen, or modify the provider page, settings, editor, or timeline.
- Never use automatic reload as a fallback, including when a tab is discarded.

P02.3 implementation evidence: The Connections panel lists candidate tabs with their browser title, parsed project/document ID and tab ID. It never selects the first candidate; a previous explicit saved selection may be restored only when the tab and canonical project still match. Persisted selection is always metadata and remains unverified. Connect/Reconnect revalidates the selected route before attachment, pings frame 0 first, reuses a compatible connector, or injects the packaged connector when missing/stale. It validates project ID, canonical route, Chrome `documentId`, frame 0, protocol version, build ID, request attempt ID, and `read-only-connection-v1` capability. It rechecks the route before and after the document-targeted handshake. The current Vids route is `docs.google.com/videos/d/{documentId}/edit`; the prior `vids.google.com/video/{documentId}/edit` route remains accepted. Flow `/project/{projectId}` and `/fx/tools/flow/{projectId}` remain supported. Query parameters and fragments do not affect canonical identity; live provider compatibility is unverified.

Permissions: Find open projects checks whether optional `tabs` permission is already present and requests it only after that explicit button action. Connect checks `scripting` and the selected provider host pattern separately and requests only missing access for that one origin. Vids host access includes `https://docs.google.com/*` for the current route and retains `https://vids.google.com/*` for the prior accepted route. Denied access is `permission-needed`; permission grants alone never produce Connected.

Connector lifecycle: matching build listeners are reused. Known stale extension-owned listeners are safely removed by exact listener reference before replacement. The earlier unmanaged probe exposed only a boolean marker, not its listener reference; the packaged connector does not add a duplicate in that case and attachment reports a blocked `stale-build`. Concurrent attachment calls for the same provider/tab share one in-flight operation, and repeated injection maintains one known listener per document. Worker-start notification clears open-dashboard Connected state; only a new handshake can restore it. Disconnect removes the extension listener through a message scoped to the attached document and does not alter provider content.

Offline verification on 28 October 2026: `npm test` PASS (7 files, 48 tests); test coverage includes explicit candidate selection, Flow/Vids route and ID validation, changed project/document, child-frame rejection, selected-origin permission request/denial, missing receiver, connector reuse, injection, stale-build replacement/blocking, request correlation, repeated clicks, listener cleanup/deduplication, worker-start state invalidation, closed targets, local-preview API absence, and assertions that provider navigation/content/settings/timeline mutation spies remain unused. Typecheck, lint, changed-file Prettier, production build, and `git diff --check` PASS. These are mocks/local fixtures only. They do not validate current provider routes, Chrome optional-permission prompts, actual `documentId` behavior, IndexedDB in Chrome, or live content preservation.

No provider tab was accessed and no unpacked extension was loaded. Connect/Reconnect did not run against Google Flow or Vids. Existing Vids content and timeline preservation remain unverified until P02.4.

### P02.4 — Verify actual build/connection and reconnect behaviour

Evidence mode: **live-read-only**.
Start in these files:

- src/shared/buildInfo.ts
- src/app/components/ConnectionStatus.tsx
- src/background/handlers/connections.ts
- docs/evidence/connection-proof.md

Acceptance: Dashboard, worker and content build identities agree on the actual authorized tabs; stale/closed/wrong targets show clear feedback. No generation or page refresh is required.

Planned requirements:

- Load the production build unpacked for verification.
- Capture real read-only Flow and Vids connection evidence.
- Confirm matching build identity for dashboard, worker, and connector.
- Confirm reconnection without provider refresh and confirm existing Vids content remains intact.
- Run negative target checks with mocks or separate test tabs, without touching unintended provider content.

P02.4 offline evidence, 28 October 2026: a focused toolbar-action fix was made because source inspection showed repeated activation always created another dashboard tab. The packaged dashboard now requests focus of its own tab/window and falls back to creating the dashboard only when no responder is available. Five focused mocked tests cover opening/focusing behavior and assert that the dashboard responder only activates its own tab/window; they do not prove Chrome runtime behavior. Production `dist` was rebuilt: version `0.1.0`, shared build ID `automat-faceless-0.1.0-mvrp0m5h`, minimum Chrome `106`; dashboard, worker, and standalone connector artifact IDs match. Subsequent offline corrections and build IDs are preserved in [connection proof](../docs/evidence/connection-proof.md).

**SCREENSHOT_EVIDENCE:** User-supplied screenshots show Flow and Vids as **Connected** in the packaged dashboard. The Vids preservation screenshot shows an empty document; this evidence covers that empty-document test only.

**USER_REPORTED_PASS:** The user separately reported for both providers (1) reconnect without provider refresh or content changes, (2) Disconnect → Connect, and (4) successful connection verification after extension reload. The user also reported (3) the toolbar action reusing the existing dashboard. These checks were not independently observed or automated by this task. Chrome version was not supplied. Generated-scene preservation and a separate worker-suspension test remain unverified.

## Phase gate

G-CONNECT is **DONE for the read-only Flow/Vids connection scope**, based on the recorded offline checks, user screenshots, and the user's reported passes. The screenshots and reports remain separately labeled and are not treated as independent automated verification. No generation was performed or enabled. Generated-scene preservation and a separate worker-suspension test remain unverified.

## Notes

- The minimum required host/API permissions must follow observed needs.
- Do not import third-provider code into the foundation.
- A new extension ID may require later OAuth/helper configuration changes; record the decision now.

## Ready-to-copy first task

```text
Implement only P02.1 from phases/PHASE_02_FOUNDATION.md.
Read AGENTS.md and PROJECT_STATUS.md first, then the context named in this card.
Start with this subphase's file list. Preserve unrelated work and legacy data.
Complete its acceptance checks. Live actions are excluded unless the user separately
includes a specific controlled live test in this task.
Do not start the next subphase. Update PROJECT_STATUS.md and report actual evidence.
```

## Completion report

State changed files and resulting behaviour, focused checks with actual output, relevant live/local-media evidence, remaining gaps and the next eligible subphase. Update PROJECT_STATUS.md, then stop. A required live gate remains NOT_RUN if no authorized runtime was available.

## Current task boundary

This card is a future work specification. Its presence does not authorize running live provider actions now. Follow the actual user task's authorization. Start only the requested subphase, not every row in this card.
