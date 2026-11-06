# Hosted Vids helper compatibility and publication readiness

## Current source contract review

- The Downloads panel constructs the existing hosted helper URL with `chrome.runtime.id` and only the `extensionId` query parameter.
- The current `external/vids-helper` source accepts only one valid extension ID parameter and rejects extra/duplicate parameters or a fragment. The helper sends `VIDS_HELPER_CONFIG_PING` and uses the supplied ID for all external runtime messages.
- Configuration, nonce challenge, preparation-status, and download messages require the exact hosted origin/path, the launch-time extension ID, top frame, tab, and a Chrome document token. The nonce challenge binds the attempt to that helper tab/document; preparation and download require the same binding.
- The extension records readiness as user attestation for the exact whole Vids timeline. The helper's whole-document acknowledgment is required in the handoff payload; neither side claims machine-verified scene isolation.
- The helper's preparation flow retains the returned operation name. Timeout continuation polls that same operation; the production worker accepts only the document-bound nonce and status.
- The worker persists dispatch intent and returns the exact attempt/document/Chrome download IDs after Chrome accepts dispatch. Chrome completion is observed separately by exact download ID.

## Offline cross-part regression

`tests/integration/vidsDriveDownload.test.ts` combines the current helper logic with the production extension configuration/download listeners and mocked Chrome/Google boundaries. It covers a same-operation timeout/continuation, exact timeline payload, exact helper tab/document binding, prompt accepted IDs, duplicate prevention, a transfer still in progress after 10 seconds, and later separate Chrome completion. `tests/unit/hostedHelperConfig.test.ts` checks launch-query parity and rejects wrong/extra query parameters and missing document binding.

Focused validation: **3 files / 12 tests PASS**. Typecheck and lint PASS. Production/package build PASS: **`automat-faceless-0.1.0-mw4z102f`**, four JavaScript bundles. Existing large-worker and connector `inlineDynamicImports` warnings remain. `git diff --check` PASS.

## Publication readiness and live gate

The upload-ready folder is `publication/automat-faceless-picker/`; its README names the exact files and existing GitHub Pages destination and provides extension reload and one-document manual checks. It includes no API key value, token, signed URI, or extension bundle.

No publish/push, Cloud setting change, authorization, MP4 preparation, or download occurred. Hosted compatibility has source and mocked-message-path coverage; the published page and live one-document download remain **NOT_RUN**.
