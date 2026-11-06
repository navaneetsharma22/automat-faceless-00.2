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
