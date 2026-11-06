# Vids whole-timeline preparation failure evidence

Date: 6 November 2026  
Branch: `main`  
Build: `automat-faceless-0.1.0-mw52dpox`

## Source trace and confirmed defect

The normal **Prepare MP4 Download** click in `external/vids-helper/app.js` runs `prepareMp4()`. It requests `HOSTED_MP4_NONCE_CHALLENGE`, reports `preparing` through the bound `HOSTED_MP4_PREPARATION_STATUS` message, then enters `runMp4Preparation()` and the `createMp4PreparationFlow` in `external/vids-helper/logic.js`. That flow calls the Drive `files.download` POST once, captures a returned operation name, polls that same operation, and reports terminal outcomes. Only a usable prepared URI can reach the download handoff.

Before this correction, every flow failure/timeout reached the helper's `onState` callback as `phase: "needs_review"`, without the actual stage or bounded Drive category. `createVidsDownloadHandler` in `src/background/handlers/vidsDownload.ts` converted every such message to `reason: "operation_observation_lost"`. This is the confirmed source-level cause of the misleading attempt reason. The UI also rendered its prior “Handoff armed” notice after state changes because it did not gate that notice on the current attempt state.

No browser/runtime record for the reported attempt was available. The live sequence cannot establish whether its Drive POST was sent, rejected, accepted, or whether polling began. The external Pages assets could not be fetched and no browser surface was available, so the deployed helper version is unknown. This source review does not attribute the historical attempt to a specific Drive or transport failure.

## Failure evidence correction

The helper now sends strict bounded review fields through the existing preparation-status message: reason (`preparation_rejected`, `preparation_outcome_uncertain`, `operation_observation_lost`, `operation_timeout`, `operation_failed`, `invalid_download_uri`, or `invalid_operation`), stage, and a fixed failure code. The worker validates them and persists them on the existing attempt. The dashboard shows the current reason and stage/code; the armed notice appears only while the attempt is still ready. A known operation ID remains visible, and a known Chrome download ID is preserved by the existing attempt record.

The helper marks pre-POST binding failures in its local status as `nonce_binding` or `preparation_binding` and explicitly says preparation did not start. Once the Drive request begins, transport loss is classified as an uncertain outcome; an explicit non-accepted Drive response is a rejection; failures polling a returned operation retain its operation ID and are classified as observation failure or timeout. The existing one-shot preparation guard, nonce binding, no-replay rules, and Chrome exact-ID handling remain in place. The legacy “Prepare MP4 for confirmed review and send once” route was not used or promoted.

Current helper source was copied byte-for-byte to the local publication folder. The exact files requiring republication to the existing helper repository are:

- `app.js`
- `logic.js`

No credentials, tokens, signed URIs, or extension bundles are included. Publication was not performed.

## Validation and limits

- Focused Vitest: **3 files / 24 tests PASS**, including mocked Google Drive and Chrome APIs through the production helper preparation flow and worker message handlers. It covers an explicit Drive rejection, a failed poll with a retained operation ID, the successful normal Prepare path, exact Chrome download ID, and replay refusal.
- Typecheck: **PASS** (`npm run typecheck`).
- Lint: **PASS** (`npm run lint`).
- Production build: **PASS**, `automat-faceless-0.1.0-mw52dpox` (four JavaScript bundles). Existing >500 kB chunk and connector `inlineDynamicImports` warnings remain.
- `git diff --check`: **PASS**.
- Deployed helper version and actual historical POST/poll boundary: **UNKNOWN / NOT_RUN**; no runtime artifact or browser was available.
- Live authorization, preparation, download, generation, publication, and state reset: **NOT_PERFORMED**.

## Attempt `003d9d7e5abd68c5445fa5b0444bc151` read-only inspection follow-up

The connected runtime inventory returned no browser or app surfaces, and no extension-storage inspection tool was available. The attempt record was therefore **not read**. Its stored `operationName`, `failureStage`, and `failureCode` are **UNKNOWN**; no ID presence or historical request stage is inferred from source. No browser storage, worker state, or attempt was changed.

The dashboard now renders a Drive operation ID only when that field is actually present. For a Needs review record without an ID, attempt details say **Not recorded**, and copy describes the historical preparation outcome as unknown/evidence missing. With an ID, details show that exact value and the message directs the user to the helper's existing same-operation continuation control only where the failure evidence supports it. Helper continuation remains tied to the in-memory operation and calls polling only; it cannot start a new preparation. The existing button is now available after authorization/access or transport failures during polling when a known operation is still loaded.

Needs review copy distinguishes expired/denied authorization, polling transport failure, a terminal Drive operation failure, and missing historical evidence. It preserves the no-replay instruction. Focused Vitest: **3 files / 23 tests PASS**, including stored records with and without operation IDs, authorization and operation failure copy, and production continuation of the same operation with no second preparation POST or Chrome download. Typecheck, lint, build, and `git diff --check` pass. Build **`automat-faceless-0.1.0-mw53lgis`** (four JavaScript bundles). No authorization, replay, download, reset, or publication occurred.

## Supplied legacy helper comparison and production-click reproduction

Compared `hosted-picker-proof/app.js`, `logic.js`, `index.html`, and `styles.css` in `C:\Users\ASUS\Desktop\MY-WORKSPACE\AUTO FACELESS\package.zip` with `external/vids-helper` and the local publication copy.

- The legacy **Prepare MP4 Download** eligibility checks require a supplied, valid expected document ID, verified selected Vids metadata, `canDownload`, exact expected-ID match, a live token, and the manual “only intended clip” acknowledgement. The current normal button retains those checks.
- The legacy helper has a fixed extension ID and does not contact the extension before its Drive POST. It asks for a nonce only after preparation, during handoff. The current helper reads the runtime ID from its validated launch query, first asks the worker to bind the exact document/helper tab to the armed attempt, and requires the worker to accept the `preparing` status before it sends the Drive POST. This is an intentional additional gate, not by itself a reproduced defect.
- Drive request construction is equivalent in both versions: POST to the Vids `files/{id}/download` endpoint with `mimeType=video/mp4`, bearer authorization, optional resource-key header, JSON accept, no stored credentials, CORS mode, redirect rejection, and the same response JSON parsing. The operation evaluator uses the same `done`/`response` and download-URI validation. Both flows require a valid returned operation name for a pending result, assign it before polling, and poll that same operation. The current flow adds bounded stage/category reporting.
- The legacy helper keeps `operationName` in page memory and does not report preparation progress to the extension. The current helper sends the name in its preparation-status message to the production worker, which persists it with the attempt. Both catch fetch/JSON and poll exceptions; current pre-POST binding adds a separate awaited error path.
- Handoff remains exact-document checked. The current helper uses the nonce bound before preparation and sends `prepared` status before the one-time handoff; the legacy helper requests its nonce after preparation. No legacy review-button path is included in the comparison or regression.

Added a local browser regression which loads the actual current helper page and clicks its **Prepare MP4 Download** button. Google Identity Services, Picker, Drive, external messages, and Chrome downloads are fixtures. The production `createHostedVidsDownloadListener` and `createVidsDownloadHandler` handle the helper messages. A mocked Drive POST returns a pending response with an operation name; before the mocked operation GET is allowed to fail with 503, the test confirms the production worker record already contains that exact name. The attempt then enters Needs review with the same ID, one POST, one poll, and zero Chrome downloads. The test passes; the injected 503 is a fixture outcome, not evidence about the historical attempt. No defect was reproduced, so no production behavior was changed for this investigation.

The local publication folder matches all four current runtime files byte-for-byte. Relative to the supplied zip, `index.html`, `app.js`, and `logic.js` differ and `styles.css` matches. If the Pages repository still equals that zip, those three runtime files require upload. The remote Pages version remains **UNKNOWN**; no publication occurred.

For the actual attempt, the missing evidence is the helper's historical Network record showing whether the POST returned a JSON operation name and whether a subsequent operation GET occurred. One targeted read-only check, if the original helper tab's Network log is still retained: inspect only the `files/{id}/download` POST's status and whether its response had a `name` field, then whether an `/operations/{id}` GET followed. Do not copy authorization headers, signed download URIs, or query values. If that log is not retained, the historical request sequence cannot be recovered from this workspace; do not repeat preparation to recreate it.

Focused Playwright regression: **1/1 PASS**. Typecheck and lint **PASS**; `git diff --check` **PASS**. No new production build was needed because this investigation added only a browser regression and documentation; the current source build remains **`automat-faceless-0.1.0-mw53lgis`**. No account authorization, real preparation, Chrome download, attempt mutation/reset, or publication occurred.

## Explicit recovery from an unknown attempt — 6 November 2026

The normal Downloads UI did not support a new attempt from `needs_review`; `vids.download.arm` rejects that state. Because storage held one current-attempt record, allowing normal arm to proceed would have overwritten attempt `003d9d7e5abd68c5445fa5b0444bc151`. The user-provided live evidence says this attempt is Needs review, has no Drive operation ID, and has an unknown historical outcome. No live runtime record was accessed or altered in this implementation.

Added a separate, user-initiated recovery action. The dashboard requires the same currently revalidated Vids document, matching user-attested readiness, and an explicit acknowledgement that the old helper has no operation to continue and the prior outcome may have reached Drive. The worker rechecks the expected attempt ID, document ID, exact connection binding, no operation ID, and an unknown-outcome reason. It writes a separate `ready` attempt while archiving a sanitized snapshot of the prior record in the same durable record. The old attempt remains `needs_review`; nonce and helper-document binding secrets are omitted from history. Recovery itself performs no helper request, Drive preparation, or Chrome download.

Next manual steps: verify the same Vids document and timeline readiness; in the existing helper check that no operation is available to continue; explicitly acknowledge the unknown outcome and create the separate attempt; reload/reopen the helper, select that same document and verify its exact ID; then click **Prepare MP4 Download** once only if proceeding with the acknowledged possibility that Drive may already have accepted the earlier request. No new document or media should be created.

Focused integration/UI checks: **3 files / 19 tests PASS**, covering explicit confirmation, same-document binding, old-record preservation, no operation/download invocation during recovery, stale/mismatched/known-failure rejection, and normal helper no-replay behavior. Typecheck, lint, production build, and `git diff --check` pass. Build **`automat-faceless-0.1.0-mw56ioew`** (four JavaScript bundles); existing >500 kB chunk and connector `inlineDynamicImports` warning remain. No live account action, preparation, download, state reset, or helper publication occurred.
