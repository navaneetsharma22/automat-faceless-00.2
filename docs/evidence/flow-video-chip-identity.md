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
