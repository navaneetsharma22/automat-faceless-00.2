# Existing Vids helper publication package

This folder contains the current standalone helper page and its local runtime assets. It is prepared for a manual update to the existing repository; nothing here has been published.

## Upload destination and files

Upload these exact files from this folder, preserving names and placing `index.html` at the existing Pages source root:

- `index.html`
- `app.js`
- `logic.js`
- `styles.css`
- `README.md`

Existing repository: [navaneetsharma22/automat-faceless-picker](https://github.com/navaneetsharma22/automat-faceless-picker). Existing Pages URL: <https://navaneetsharma22.github.io/automat-faceless-picker/>. Use that repository's already configured Pages branch/source directory; do not change Pages, OAuth, or Cloud settings.

## Extension reload and launch

After the helper update is manually published, open `chrome://extensions`, reload Automat Faceless from this workspace's `dist/`, then reopen the Vids Downloads panel and click **Open existing helper** so the URL carries the reloaded extension's current runtime ID. Build ID: **`automat-faceless-0.1.0-mw4z102f`** (four JavaScript bundles). Close any old helper tab before this check.

## Manual compatibility and one-document download checks

1. Confirm the helper says **Extension configuration connected**. The dashboard's **Google account authorization: Not checked** remains separate from this configuration handshake.
2. Manually authorize the intended Google account in the existing helper. Select one intended Vids document and confirm its exact document ID, Vids MIME type, `canDownload: Yes`, and expected-ID match.
3. Confirm the extension's Timeline ready record names that same document. Arm the MP4 handoff for it, then prepare the whole document in the helper. If polling times out, use **Continue checking operation**; verify it resumes the same Drive operation.
4. Send the prepared handoff once. Confirm the helper's accepted attempt ID, document ID, and Chrome download ID match the dashboard and Chrome Downloads. Wait for Chrome completion separately; inspect playback and media properties separately.
5. Stop after this one-document check. Do not infer scene isolation from a whole-document download.

These are manual checks only; no account authorization, preparation, or download was performed while assembling this folder.

## Package contents and exclusions

`index.html` loads the hosted GIS and Picker scripts; `app.js` and `logic.js` run on the hosted page, and `styles.css` is its local stylesheet. The helper retains the existing OAuth client/project configuration and `drive.file` route. This package contains no API key value, access token, signed prepared URI, or extension `dist/` bundle. Enter any restricted Picker API key locally in the hosted page during an authorized manual check.
