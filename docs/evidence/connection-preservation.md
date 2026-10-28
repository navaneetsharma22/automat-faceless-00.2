# Selected provider tab connection preservation

Date: 28 October 2026  
Scope: P02.3 offline connection behavior; P02.4 live verification remains NOT_RUN.

This note records the earlier selected-tab preservation slice and its original 20-test result. It is superseded for current P02.3 acceptance by [connection-proof.md](connection-proof.md), which records the expanded implementation and current verification. The old test count below is historical, not the current suite count.

This note records the earlier selected-tab preservation slice and its original 20-test result. It is superseded for current P02.3 acceptance by [connection-proof.md](connection-proof.md), which records the expanded implementation and current verification. The old test count below is historical, not the current suite count.

## Implemented behavior

The Connections panel lists already-open Flow and Vids tabs and requires the user to select the intended tab explicitly. Connect and Reconnect validate that selected tab, then inject and message a read-only probe in frame 0. The implementation does not call tab reload or navigation APIs, update the selected provider tab, change tabs, or modify provider content, timeline, or settings. A failed probe displays an inline error and leaves the target selectable for a non-refresh retry.

Focused tests cover Flow and Vids selected-tab attachment, assert reload/navigation spies are untouched, and cover retry after an unsuccessful Vids probe. An unrelated Google Docs page is not accepted as a Vids target. These are offline mocked tests; they do not establish live provider compatibility or document integrity.

## Verification results

Run on 28 October 2026:

- `npm test` — PASS, 4 files / 20 tests.
- `npm run typecheck` — PASS (`tsc --noEmit`).
- `npm run lint` — PASS (`eslint .`).
- `npm run build` — PASS; Vite emitted `connection-probe.js` and the dashboard bundle.
- `git diff --check` — PASS.

## Live verification

**NOT_RUN.** The computer-use browser inventory returned no apps or browsers, and no already-open Vids document was available. No live attach or retry was attempted. Therefore, preservation of existing Vids content, timeline, and provider settings was not observed or confirmed. Flow live attachment is also unverified. No provider page was changed by this verification task.

The next live-read-only check must use the user's selected, already-open Vids document and confirm its existing content remains intact before and after attachment; it must not refresh or navigate the tab. The same no-refresh attachment behavior should be checked on Flow. A failed attach must be retried without refreshing either tab.
