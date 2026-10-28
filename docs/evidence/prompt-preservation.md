# P03.4 Prompt Preservation Evidence

Date: 28 October 2026  
Evidence levels: **OFFLINE_VERIFIED** for importer, schemas, repository methods, worker handler, JSON-cloned messaging, and mocked transactional storage; partial packaged dashboard checks are **USER_REPORTED_PASS** for the stated synthetic samples below. Independent browser observation and worker-restart recovery are not established.
Shared production build ID: `automat-faceless-0.1.0-mvrutblo`.

## Implemented path

The dashboard saves only the current successful import revision. It sends `workspaceId`, `kind`, and the exact source string over an extension-internal `promptBatch.put` request. Loading is explicit; a nonempty unsaved draft requires confirmation before replacement. The dashboard rejects a late load if its source revision changed while waiting.

The worker request handler accepts the operation only from the exact packaged dashboard URL and checks request shape, protocol, build, request ID, kind, and workspace. The worker invokes the same pure importer again. The repository validates the centralized policy, then saves one batch plus all ordered prompt items in a read/write transaction across the `batches` and `promptItems` tables. The database upgrade to version 2 adds the item table without clearing existing records.

The saved batch keeps the exact source, kind, workspace, input mode, order, total measurements, and item IDs. Items keep exact body strings, canonical shot IDs and identity source, order, source spans measured in JavaScript string offsets, UTF-16 code-unit/UTF-8-byte measurements, and supplemental SHA-256 hashes. Readback validates the complete records, reimports the retained source, and compares every body and metadata value, including each hash. Tests also compare raw strings directly; the digest does not replace string equality.

The request and record schemas use the centralized provisional limits: 1,500,000 code units / 2,000,000 UTF-8 bytes per prompt; 5,000,000 code units / 10,000,000 bytes for the source and batch; 50 prompts; and depth 128. The exact total-byte schema boundary and over-limit rejection are tested. The historical 12,000-character assumption is not used.

## Preservation coverage

- Both image and video: all eight synthetic 10k/25k/50k/100k fixtures passed exact import, schema, repository, handler, JSON-cloned message, and readback comparisons.
- Both image and video: the historical synthetic body of 1,260,163 JavaScript code units / 1,652,165 UTF-8 bytes passed exact save/readback.
- Both kinds: top-level array, numbered complete blocks, and schemaVersion 1 envelope preserved raw body slices, order, IDs, and source offsets.
- Fixtures include LF and CRLF, decimal arrays, nested objects/arrays, escaped quotes/backslashes, Hindi, and emoji.
- Failure checks cover invalid whole input, policy overflow, unauthorized page sender, unavailable message transport, corrupted storage data, and partial item-table write. Failed replacement keeps the previous valid batch.
- UI markup checks confirm a stale validation cannot enable Save and the current validation exposes save/load actions. A load never silently replaces a nonempty unsaved source.

Focused checks: **4 files / 38 tests PASS**. Full suite: **12 files / 119 tests PASS**. Typecheck, lint, changed-file Prettier, production build, manifest equality, build-ID consistency, and `git diff --check` are recorded in the P03.4 section of the phase card and project status.

## Evidence limits and browser check

The handler, schemas, importer, and repository methods are real project source. Tests serialize requests/responses with `JSON.stringify` / `JSON.parse` and use an in-memory table adapter that simulates transaction rollback. They do not execute Chrome runtime messaging, Chrome IndexedDB, dashboard persistence across a browser restart, or actual browser message-size limits.

### Long CRLF browser fixtures and safe manual procedure

The fixtures in [`tests/fixtures/prompts/README.md`](../../tests/fixtures/prompts/README.md) are one-prompt synthetic files with actual CRLF endings. Their measured code-unit/byte counts and SHA-256 values are listed there. File validation is not browser preservation evidence.

At the fixture-preparation point, the dashboard used the hardcoded `default` workspace and had no batch export. The subsequent exact-source export action and user-reported fixture workflow are documented below. The backup procedure used before that action was:

1. In a newly opened dashboard with an empty draft, use **Load saved batch** in Images. Confirm the loaded source is the existing dinosaur batch. Copy its full source into a local UTF-8 JSON backup such as `automat-p03-image-dinosaur-backup.json`. Repeat in Videos as `automat-p03-video-dinosaur-backup.json`.
2. Keep both backup files outside the fixture folder. Confirm each is valid JSON and visibly contains the expected dinosaur content. Do not continue if either batch cannot be loaded and backed up.
3. For Images, choose `tests/fixtures/prompts/p03-image-long-crlf.synthetic.json`, run **Validate & Preview**, verify one prompt and the fixture measurements, then **Save validated batch**. Close and reopen the dashboard, choose **Load saved batch**, and compare the restored editor contents directly with the fixture file. Record the measured restored source and comparison result.
4. Repeat in Videos with `tests/fixtures/prompts/p03-video-long-crlf.synthetic.json`.
5. Restore the dinosaur batches: open each backup JSON in its matching panel, **Validate & Preview**, **Save validated batch**, then reopen and **Load saved batch**. Compare the restored source with its backup before ending the check.

At the earlier save/reopen evidence point, saved-draft restoration was **USER_REPORTED_PASS** for the then-tested synthetic image/video samples, while the “Keep current draft” branch was **NOT_REPORTED**. Later CRLF browser round trips are recorded below. P00.2 is now profiled for user-approved intended-use samples; historical production samples remain absent. No provider prompt field, settings change, refresh, pairing, generation, or OAuth is involved in these import/export checks.

## User-reported browser result and lifecycle regression

### Offline automated evidence

The offline source, schema, worker-handler, repository, JSON-cloned message, exact-string comparison, and transactional-adapter results above remain **OFFLINE_VERIFIED**. They do not establish browser behavior.

### Screenshot observations

**SCREENSHOT_EVIDENCE:** The supplied screenshot shows Flow and Vids as Connected and shows a loaded video preview. A screenshot establishes only those visible states; it does not establish exact character-for-character equality of the loaded source.

### USER_REPORTED_PASS browser checks

The user reports testing synthetic samples in the packaged browser dashboard:

- Image JSON: **15,889 JavaScript code units**; save, dashboard reopen, and load passed.
- Video JSON: **17,935 JavaScript code units**; save, dashboard reopen, and load passed.
- The saved image and video batches remained separate.
- Loading both batches in the latest check did not disconnect Flow or Vids.

These are **USER_REPORTED_PASS**, separate from offline automated evidence and screenshot observations; they were not independently observed in this session. No UTF-8 byte counts, browser version, or build ID were reported. These are user-tested synthetic samples, not historical production samples. The user confirms saved-draft restoration after reopen for those samples. The “Keep current draft” outcome remains **NOT_REPORTED**. The report does not establish worker-restart recovery. The long-CRLF packaged check is reported separately below. Worker-restart recovery remains unverified.

The focused lifecycle regression checks that image/video save/load operations leave the previously selected Flow and Vids target records and reconnect intent unchanged. `ConnectionStatus` remains mounted in the dashboard sidebar while workspace panels switch, and batch APIs do not mutate selected-target state. The reported latest browser check says loading both batches did not disconnect Flow or Vids; it does not verify worker-restart recovery. See [connection proof](connection-proof.md) for the lifecycle cause and implementation evidence.

## Dinosaur backup preflight and provenance

The user selected the assistant-generated dinosaur image and video prompts as intended-use generation test samples. Preserve that provenance: these are user-approved intended-use samples, not historical production samples. Their P00.2 profile acceptance is recorded in [prompt-sample-profile.md](prompt-sample-profile.md); they do not establish historical production provenance or provider acceptance.

Before the exact-source export was available, the two manually copied files under `tests/` were read without modification. Both parse as valid JSON, but their lengths mismatch the user's dashboard source lengths. The newline diagnosis is:

| Backup file                        | BOM | CRLF | Bare LF | Bare CR | Original code units | LF-normalized code units | Expected dashboard length | Result                              |
| ---------------------------------- | --: | ---: | ------: | ------: | ------------------: | -----------------------: | ------------------------: | ----------------------------------- |
| `tests/dinosaur-image-backup.json` |   0 |  233 |       0 |       0 |              16,122 |                   15,889 |                    15,889 | Normalization explains length delta |
| `tests/dinosaur-video-backup.json` |   0 |  275 |       0 |       0 |              18,210 |                   17,935 |                    17,935 | Normalization explains length delta |

The length difference equals the CRLF count in each file. This explains the size mismatch, but matching normalized lengths and parsed JSON do not prove exact source equality. These earlier manual-copy files were not used to verify the browser fixture exports. The user-approved dinosaur source profiles are recorded in [prompt-sample-profile.md](prompt-sample-profile.md).

| Backup file                        | Dashboard source length | Measured file length | UTF-8 bytes | SHA-256                                                            | Result                         |
| ---------------------------------- | ----------------------: | -------------------: | ----------: | ------------------------------------------------------------------ | ------------------------------ |
| `tests/dinosaur-image-backup.json` |    15,889 JS code units | 16,122 JS code units |      16,246 | `6606fb94f91654a56de0d9d0ba8d98e8bf03a1709d312f9d3d9d1779d734535d` | **MISMATCH** (+233 code units) |
| `tests/dinosaur-video-backup.json` |    17,935 JS code units | 18,210 JS code units |      18,434 | `6420e66b0bce124769e72ab12bb74b4d81fa5e42ef3f66429066e642e42b6307` | **MISMATCH** (+275 code units) |

The lengths and hashes above describe the manually copied files as read. No normalization or rewrite was performed. They were not used to verify the later fixture exports. Subsequent saved-source dinosaur files are profiled by their exact byte hashes in [prompt-sample-profile.md](prompt-sample-profile.md).

## Exact saved-source export

The export action reads `promptBatch.get` for the panel's current workspace and kind. The worker obtains the source through `ExtensionRepositories.getPromptBatch`, which validates the stored batch, reparses its original `sourceText`, and verifies item bodies and metadata. The dashboard checks workspace/kind identity again, encodes that untouched `sourceText` directly with `TextEncoder`, computes SHA-256 over those bytes, and downloads a `.json` file. It does not use the editor draft or preview, parse and stringify the source for export, or change storage/connection state. The browser object URL is revoked after download activation, with immediate cleanup on activation failure.

Offline verification on 28 October 2026: focused preservation/preview/export tests **PASS** (3 files / 29 tests); full suite **PASS** (13 files / 127 tests); typecheck, lint, source/test Prettier, production build (Vite 8.3.5 / 155 modules), and `git diff --check` **PASS**. New shared build ID: `automat-faceless-0.1.0-mvrzmjyw`. Exact-byte tests cover LF, CRLF, Hindi, emoji, and escaped content, check workspace/kind scoping and no batch/connection changes, verify missing-data/wrong-scope failures, and exercise temporary object URL cleanup. These results are offline evidence; the later browser and downloaded-file evidence is recorded separately below.

### Export both dinosaur saved sources

1. Load the packaged extension dashboard. In Images, click **Export saved source** and save the downloaded `automat-faceless-default-image-saved-source.json` file. Record the displayed code-unit length, UTF-8 byte count, and SHA-256.
2. Repeat in Videos and save `automat-faceless-default-video-saved-source.json`; record its displayed values.
3. Verify each downloaded file's byte count and hash against the export details. In PowerShell, substitute each actual download path:

   ```powershell
   $path = 'C:\Users\ASUS\Downloads\automat-faceless-default-image-saved-source.json'
   $bytes = [System.IO.File]::ReadAllBytes($path)
   $text = [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes)
   [pscustomobject]@{
     CodeUnits = $text.Length
     Utf8Bytes = $bytes.Length
     Sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
   }
   ```

   Compare all three values with the matching panel's export details. Keep these verified downloads as the exact saved-source backups before replacing either default-workspace batch with a browser fixture. Do not use the earlier copied files as exact backups based on normalized lengths alone.

The user later reported completing the packaged browser workflow for both CRLF fixtures: file import, validate, save, dashboard reopen, load, and export (**USER_REPORTED_PASS**). This records the user's actions and observations; it does not independently observe the browser session.

### Uploaded CRLF export verification

The exported files were read from Downloads as UTF-8 bytes and compared with the prepared fixture files. Both decoded with strict UTF-8, parsed as JSON, contained no BOM, had 42 CRLF sequences and zero bare LF or bare CR, and measured 25,000 JavaScript code units / 25,062 bytes. Their hashes matched their corresponding fixture files exactly:

| Kind  | Exported file inspected                                | Prompt count | Code units | UTF-8 bytes | CRLF / bare LF / bare CR | SHA-256                                                            | Fixture comparison    |
| ----- | ------------------------------------------------------ | -----------: | ---------: | ----------: | -----------------------: | ------------------------------------------------------------------ | --------------------- |
| Image | `automat-faceless-default-image-saved-source (3).json` |            1 |     25,000 |      25,062 |               42 / 0 / 0 | `618342596a32b30a3e37ac1fc45b1b1b67c103e9f85e691a01065359844fb0f4` | Exact byte hash match |
| Video | `automat-faceless-default-video-saved-source (1).json` |            1 |     25,000 |      25,062 |               42 / 0 / 0 | `7d04aee9475c7269a814f422542f026a86583bb720b61be7a8371eea53f2edc0` | Exact byte hash match |

This is direct file-level verification that the downloaded exports match the prepared fixture bytes; the user's report supplies the intervening browser actions. The files are synthetic CRLF fixtures, not dinosaur intended-use samples or historical production samples. The reported browser action sequence is USER_REPORTED_PASS: file import → validate → save → dashboard reopen → load → export for each kind. File hashes verify fixture-byte identity; they do not independently observe the browser import/save/load interaction.

The reported browser action sequence is **USER_REPORTED_PASS**: file import → validate → save → dashboard reopen → load → export for each kind. This report is separate from the direct downloaded-file measurements above. File hashes verify fixture-byte identity; they do not independently observe the browser import/save/load interaction.

### Dinosaur intended-use sample export and restoration evidence

The user reports both original user-selected dinosaur batches were restored after fixture testing. The supplied screenshots show the expected dashboard lengths, saved timestamps, and both Flow and Vids Connected (**SCREENSHOT_EVIDENCE**). The screenshots establish the displayed states, not byte equality. The intended-use sample files themselves were separately measured and hashed in [prompt-sample-profile.md](prompt-sample-profile.md).

The user reports that saved-draft replacement/restoration passed (**USER_REPORTED_PASS**). The “Keep current draft” branch remains **NOT_REPORTED**. Connection persistence while loading batches is user-reported and screenshot-supported; it does not establish worker-restart recovery, which remains unverified. No provider generation or prompt submission is claimed.
