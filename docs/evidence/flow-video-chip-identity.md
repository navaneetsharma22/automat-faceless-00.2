# Flow video ingredient chip identity observation

Date: 2 November 2026. Source: user-supplied direct inspection of a manually attached image in the connected Flow tab. This evidence is preserved separately from prior P09.1 records.

- Gallery `img[data-media-id]`: `67b8fc4f-e688-4a9b-8cc1-472ff37738d8`.
- Ingredient chip: `aria-label="Ingredient"`, `aria-busy="false"`.
- Chip image: `alt="Ingredient image"`, origin `https://flow-content.google`, path `/image/67b8fc4f-e688-4a9b-8cc1-472ff37738d8`, with signed query parameters.
- The image was complete and decoded at 1376 × 768; exactly one corresponding gallery image was found.

This supports the path UUID ↔ gallery media ID rule for this observed sample. The implementation parses HTTPS URL origin/path and compares the UUID to the gallery ID resolved at runtime; query values are ignored and never included in diagnostics. It does not establish saved-reference byte equality or extension-driven attachment. Live extension attachment remains NOT_RUN.
