# Flow video ingredient chip identity observation

Date: 2 November 2026. Source: user-supplied direct inspection of a manually attached image in the connected Flow tab. This evidence is preserved separately from prior P09.1 records.

- Gallery `img[data-media-id]`: `67b8fc4f-e688-4a9b-8cc1-472ff37738d8`.
- Ingredient chip: `aria-label="Ingredient"`, `aria-busy="false"`.
- Chip image: `alt="Ingredient image"`, origin `https://flow-content.google`, path `/image/67b8fc4f-e688-4a9b-8cc1-472ff37738d8`, with signed query parameters.
- The image was complete and decoded at 1376 × 768; exactly one corresponding gallery image was found.

This supports the path UUID ↔ gallery media ID rule for this observed sample. The implementation parses HTTPS URL origin/path and compares the UUID to the gallery ID resolved at runtime; query values are ignored and never included in diagnostics. It does not establish saved-reference byte equality or extension-driven attachment. Live extension attachment remains NOT_RUN.

## P09.1 cross-origin preflight follow-up

On 2 November 2026, the attachment handler was corrected to use `fetchFlowReferenceBytes` in the worker for supported cross-origin gallery candidates such as the observed `flow-content.google` URL. Same-origin document capture remains in place. The worker checks the narrowly scoped host permission, validates the exact path UUID against the re-resolved gallery media ID, passes the freshly observed signed URL to fetch, compares original fetched bytes with the prepared reference SHA-256, re-resolves the candidate in the bound document, and revalidates the selected target before persisting `action_intent`.

Focused offline integration verifies successful cross-origin preflight, missing and rejected permission checks, candidate byte hash mismatch, zero activations for rejected preflight, and conservative handling of lost replies after intent. Build ID: `automat-faceless-0.1.0-mvyxnzjr`; packaged output: project-root `dist/`. Installed-extension acquisition/attachment is **NOT_RUN**. The earlier historical live exception remains unidentified; the offline fix does not prove that the specific operation's exception was this preflight failure.

## Packaged worker compatibility follow-up

The P09.1 handler now statically imports `BUILD_ID` and `PROTOCOL_VERSION`. Production bundle inspection after build `automat-faceless-0.1.0-mvyy11tw` found no runtime dynamic `import(` expressions and no Vite preload helper/error markers in `dist/background.js`. The bundle still contains `window` references in existing page-injected functions; these are separate from the removed Vite preload path.

Node/Vitest: focused attachment and reference regressions **3 files / 19 tests PASS**. Typecheck, lint, build and diff check passed. Existing MV3 smoke scripts also exercise Generate or dispatch, so they were not run within this task's no-Generate boundary; real packaged MV3 runtime verification is **NOT_RUN**. This confirms packaging/source behavior only, not live Flow attachment.

## P09.1 connector protocol guard correction

The attachment handler now checks the lifecycle-shaped versions independently: extension protocol 4 against `PROTOCOL_VERSION`, connector protocol 1 against `CONNECTOR_PROTOCOL_VERSION`. Regression coverage verifies the 4/1 binding reaches preflight and that either wrong protocol version blocks before intent/activation. The four build/project/tab/document/reference guards remain present.

Build `automat-faceless-0.1.0-mvyy9qdx` contains the packaged comparisons `extensionProtocolVersion!==4` and `connectorProtocolVersion!==1` with both build ID comparisons. Focused Vitest **1 file / 6 tests PASS**; typecheck, lint, build, and diff check passed. Live attachment is **NOT_RUN**.

## P09.1 composer mode reader evidence - superseded by manual-settings policy

This temporary implementation was removed by the manual-settings policy update below. Current P09.1 does not read settings radios or enforce specific provider modes. The following prior test/build result is historical only.

The worker calls this exact injected function before `claimFlowVideoAttachmentOperation`; on failure it returns a bounded blocked result before the first picker click and before intent. The old persisted operation was not queried or reconciled: no browser surface or exact batch/item identifiers were available. It was left untouched. The former code ordering indicates `composer_unsupported` preceded the first picker click but followed intent creation, which alone does not establish the exact record state. Live attachment remains **NOT_RUN**.

Focused tests: Vitest **3 files / 22 tests PASS**; typecheck, lint, build, and diff check passed. Build ID `automat-faceless-0.1.0-mvyytwvb`; output folder `dist/`.

## P09.1 manual-settings policy restoration - 2 November 2026

P09.1 reuses the stored `manualSettingsDeclaration` and its prepared target binding. It does not ask for another batch or inspect/change provider settings. Before `action_intent`, it checks only the exact verified document, unique visible composer, and unique enabled supported attachment control. It verifies the pinned reference bytes/hash and candidate before that structure check. A missing confirmation or changed confirmation binding is blocked with a bounded reason. No model, mode, resolution, duration, aspect ratio, or output-count rule is enforced.

The direct production structure injection tests allow Image/Frames selections and prove settings popover state, radio selection, prompt, picker, and Generate state are unchanged. Existing exact-record reconciliation evidence and other uncertainty protections remain. Focused Vitest **3 files / 23 tests PASS**; typecheck, lint, build, and diff check passed. Build `automat-faceless-0.1.0-mvyzu4kf`; output folder `dist/`. No live attachment replay was performed.

## P09.1 exact pre-click operation reconciliation

The prior producer ordering is confirmed in the historical source: it persisted `action_intent`, then emitted `composer_unsupported` before the injected action's first picker `open.click()` and before Add. This historical boundary is why the narrow no-activation reconciliation is supportable; current chip absence is not the proof.

The worker now accepts reconciliation only for `prepared:default:1235934d-8b2d-43b9-990c-8e103413d179` / `import:default:video:item:0` / reference `014ebcff-06e3-4ac2-b980-568f0755febf`, when status/reason/timestamp match the supplied uncertain `composer_unsupported` snapshot and the prepared item still binds to that reference. Atomic compare-and-update retains the row ID and stores prior state/timestamp as `preActivationEvidence`. A separate explicit dashboard button is shown only for that exact inspected record. Other uncertainty stays protected. Reconciliation itself performs no page injection or provider activation.

The browser's exact stored record was **NOT_READ / NOT_RECONCILED** here because no browser surface was available. Supported action: reload the existing extension from `dist/`, open the matching prepared item, confirm the displayed status/reason/timestamp match, and click **Reconcile pre-click failure**. This action does not attach; Attach remains separate. Focused Vitest **2 files / 14 tests PASS**; typecheck, lint, build and diff check passed. Build ID: `automat-faceless-0.1.0-mvyz84qd`. Live attachment remains **NOT_RUN**.
