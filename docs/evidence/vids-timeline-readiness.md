# Vids timeline readiness evidence

Date: 6 November 2026  
Branch: `main`  
Mode: offline source and test evidence

## Implemented boundary

The Vids Downloads panel can bind a readiness declaration to the currently verified Vids document. The connected-document path uses read-only connection revalidation and checks the saved selection's tab ID, canonical route, and verification binding. The fallback accepts a bare ID or supported HTTPS Vids URL, extracts the document ID using the legacy helper rules, then requires exact equality with the current revalidated connection. The card link comes from the verified canonical route.

The user confirms manual scene insertion, complete intended order, and saved state. The persisted record is labeled `user_attested` and contains the document ID, canonical target, tab ID, and attestation time. It does not claim machine verification of scene isolation. Changing the intended document invalidates the prior record. A synchronous UI guard and worker-side in-flight guard prevent duplicate declarations; the worker revalidates again immediately before saving.

The legacy helper copy is under `external/vids-helper/`; it was not published. It reads the extension ID from the launch query and sends the configuration ping. Its generic proof text describes the full manually prepared timeline. The hardcoded City/YUGVERA case is retained inside a separately labeled legacy diagnostic disclosure.

## Validation

- Focused tests: 3 files, 9 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; build ID `automat-faceless-0.1.0-mw4u67em`, four JavaScript bundles.
- `git diff --check`: passed (Git reported existing line-ending normalization notices for modified CRLF files).
- Live account authorization, Vids scene insertion, MP4 preparation, helper publication, and download: **NOT_RUN**.

Build warnings retained: worker bundle is larger than 500 kB; connector build reports `inlineDynamicImports` ignored because code splitting is disabled.
