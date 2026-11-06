# Vids whole-timeline MP4 handoff evidence

Date: 6 November 2026  
Branch: `main`  
Mode: offline source review and integration fixtures

## Flow

The hosted helper keeps its existing same-account Picker and metadata verification, expected document ID, Vids MIME, `canDownload`, `files.download` request with `mimeType=video/mp4`, Drive operation polling, and continuation of the known operation. Before preparation begins, it requests a one-time nonce from the extension for the currently attested and connected Vids document. Operation name and bounded preparing/prepared/review states are sent to the worker; OAuth tokens and API keys are not sent. A timeout can continue polling only that operation. It does not start a second POST.

For the final handoff, the worker accepts only the exact hosted origin/path/frame/tab and current extension binding. It checks the nonce, exact expected and selected document IDs, helper verification flags, whole-document acknowledgment, and a validated HTTPS Google prepared URI. The URI is used transiently and is not written to logs or durable storage. The nonce is consumed and dispatch intent persisted before calling `chrome.downloads.download`.

The worker returns promptly after Chrome supplies an ID, including attempt ID, document ID, and exact Chrome download ID. It records that ID and observes only that download through `downloads.onChanged` and exact-ID searches after restart. A lost response can be reconciled from the durable ID; a dispatch with no ID becomes Needs review and is never replayed. Duplicate handoffs cannot start another Chrome download.

Filenames use the bound document ID plus the unique attempt ID, with Chrome `conflictAction: uniquify`. The extension follows Chrome's configured Downloads destination; no extension-owned reusable folder picker exists. “Chrome complete” is download state only and does not claim verified playback, duration, codec, or scene isolation.

## Validation

- Focused tests: 6 files, 63 tests passed.
- Includes a simulated transfer still in progress after 10.1 seconds, duplicate and concurrent handoffs, wrong sender/document, document change, a timed-out known Drive operation continued without another operation, lost response with exact-ID reconciliation, and uncertain dispatch with replay blocked.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; build ID `automat-faceless-0.1.0-mw4v5egr`, four JavaScript bundles.
- `git diff --check`: passed (line-ending normalization notices may appear for existing CRLF files).
- Live authorization, helper deployment, MP4 preparation, Chrome download, and media-property verification: **NOT_RUN**.

Existing build warnings remain: the worker bundle is larger than 500 kB, and the connector build reports `inlineDynamicImports` ignored because code splitting is disabled.
