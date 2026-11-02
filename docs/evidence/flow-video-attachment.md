# P09.1 Flow video reference attachment evidence

Date: 1 November 2026

## Result

Implementation was not started. Exact reference attachment depends on an evidence-backed Flow DOM and provider asset identity/version relationship. Neither is present in the repository's current evidence, and no inspectable Flow tab was available.

## Existing reusable contracts inspected

- P07 reference assignments pin captured image bytes and record SHA-256, MIME type, dimensions, capture provenance, project, tab, document, and an optional observed provider asset ID.
- P08 prepared video items pin the canonical Shot ID, reference ID, assignment version, SHA-256, MIME type, byte size, and dimensions.
- The prepared batch is immutable and retrievable by ID; current references must not replace its pinned reference.
- The existing Flow connection binding checks provider, project, tab, top-frame document, build, protocol, capability, and verification state.

These local contracts do not prove which Flow UI target is the video composer, how its asset picker exposes provider identity, or whether a provider asset ID refers to the same bytes as the saved reference. Screenshot observations and Google help documentation do not supply those DOM identity details.

## Actions and verification

- Read-only browser inventory: no browser tabs available.
- No Flow login/navigation, attachment, prompt entry, Generate, provider setting change, or scheduler action performed.
- No source implementation or tests changed; focused tests, typecheck, lint, Prettier, diff check, and build were not run.

## Remaining evidence gap

Inspect the current Flow Video + Ingredients composer and the evidenced picker or gallery route read-only. Record stable composer scoping and reliable provider asset identity/version/source or verified-byte evidence. Only then can a supported attachment-only action be implemented and tested. P09.1 and G-FLOW-VIDEO remain incomplete.
