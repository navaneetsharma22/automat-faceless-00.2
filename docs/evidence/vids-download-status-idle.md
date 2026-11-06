# Vids download status idle/error correction

Date: 6 November 2026  
Branch: `main`  
Mode: source trace and offline production-message tests

## Confirmed cause

The dashboard sends `vids.download.get` with an empty strict payload. `src/background/index.ts` creates `vidsDownload` and registers it in the worker dependencies. `connections.ts` dispatches the request to its `get()` handler. When storage has no attempt, `ChromePreferenceRepository.getVidsDownloadAttempt()` returns `undefined`, so the worker built a success response with `data: undefined`. Chrome message JSON serialization drops that `data` property. `AppResponseSchema` requires the property, and `createFoundationClient` consequently raises `malformed_response`. The dashboard caught that parse error and showed “Vids download status is unavailable. Reconnect before starting another attempt.”

This confirms a source-level path that can produce the reported error during normal idle status. A browser was unavailable, so the screenshot's exact runtime occurrence was not independently captured.

## Correction

- The worker returns `null` as the explicit successful no-attempt value.
- The consumer treats only explicit `null` as idle. Missing or malformed response data remains an error.
- Storage returns idle only when the attempt key is absent/undefined. An explicitly present malformed record raises a typed validation error instead of being collapsed to no attempt.
- The UI preserves actionable status errors and records a fixed bounded failure stage: `request_validation`, `worker_registration`, `download_status_storage`, `download_status_parse`, `response_parsing`, `response_wait`, `message_transport`, `extension_context`, or `status_consumer`.
- The worker's sender/document binding, one-time nonce, operation continuation, persisted dispatch intent, exact Chrome download ID, and no-replay behavior are unchanged.
- The URL/action row stacks on narrow widths. The placeholder `https://vids.google.com/video/your-document-id/edit` parses to `your-document-id` under the current parser. Existing 20px desktop card padding, 16px mobile padding, and compact collapsed split handoff remain in place.

## Validation

- Focused Vitest: **5 files / 26 tests PASS**. Tests exercise the production worker router and handler through Chrome-style JSON serialization; idle `null`; storage read failure; malformed stored state; missing handler registration; invalid request; runtime transport rejection; omitted response data; consumer parse rejection; helper download sender/nonce and exact-ID/no-replay regressions; existing UI workflow; and parser acceptance of the input placeholder.
- Typecheck: **PASS**.
- Lint: **PASS**.
- Production build: **PASS**, `automat-faceless-0.1.0-mw519i15` (four JavaScript bundles). Existing warnings remain for a minified chunk over 500 kB and connector `inlineDynamicImports` ignored with code splitting disabled.
- `git diff --check`: **PASS** after this note and status update.

## Visual and live limits

Desktop and narrow inspection at approximately 1440px and 390px: **NOT_RUN**. The connected browser inventory was empty and the supplied attachment directory contained only the text request, with no screenshot file. No account authorization, helper publication, provider preparation/download/generation, or FFmpeg execution occurred.
