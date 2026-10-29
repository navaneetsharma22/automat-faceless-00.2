# Flow populated-results evidence and P05.3 collection

Date: 29 October 2026  
Status: **LIVE DOM COLLECTION PENDING USER RUN**. No new generation was authorized or performed.

## Evidence reviewed

### Existing reported evidence

- The P04 record contains **user-provided screenshot evidence** of a manually selected `x2` setting and two completed images. Those screenshots did not include inspectable card attributes or a runtime/storage result association. They do not identify which DOM nodes represent logical outputs versus duplicate thumbnails, and they do not link either image to an attempt.
- The earlier user-collected P04.3 empty-workspace DOM report described a visible `Start creating or drop media` marker in a `span`, an enclosing `div` directly under `flow-project-page`, and the same project page containing the verified composer. It was evidence for that empty UI state only. It did not describe populated cards.
- P05.1/P05.2 result identities, state markers, and lifecycle events are synthetic contract fixtures. They are not Flow DOM evidence. The production event producer and populated-result contract remain unsupported.

### Current inspection attempt

The available computer/browser surface returned `apps=[]` and `browsers=[]`. No Flow tab was available to inspect. The explicitly selected project's route, workspace boundary, populated results boundary, card tags, identity attributes, thumbnail relationships, completion/loading/error markers, and project/composer ownership are therefore **NOT_OBSERVED** in this task. No account data, provider storage, attempt record, or current prompt was accessed.

Unavailable historical lifecycle evidence remains **NOT_OBSERVED**: screenshots of completed cards cannot reconstruct loading events, dispatch ownership, result linkage, or a missing variant declaration. No historical attempt was modified, settled, reset, or replayed.

## One focused read-only collection diagnostic

Use [flow-populated-results-readonly.js](../../tools/diagnostics/flow-populated-results-readonly.js) in DevTools Console for the **same existing Flow tab that is already explicitly selected and shows the project under review**. Do not refresh or navigate to another tab/project.

1. Open DevTools for that existing Flow tab and select its **Console**.
2. Paste the complete contents of `flow-populated-results-readonly.js` and run it once.
3. Return only the emitted `flow-populated-results-readonly-v1` JSON. The report uses consistent `project-N`/`identity-N` masks and fixed state signals; it does not include prompt text, labels, account details, credentials, raw URLs, or media sources.

The diagnostic reads the current top document and open shadow roots. It reports the recognized Flow route and masked project ID, observed `flow-project-page` boundaries, verified composer count/ownership, candidate card/media structure and ancestry, identity-like attribute names with consistently masked values, media multiplicity, visibility, and fixed loading/completion/error signals. It also reports two-frame stability and explicit truncation/unsupported states. It performs no click, input, navigation, storage access, or provider mutation.

**Local fixture verification:** the complete diagnostic was executed in Chromium against `tests/fixtures/flow/populated-results-diagnostic.synthetic.html`; the browser test `tests/browser/flowPopulatedResultsDiagnostic.spec.ts` passed. It verified valid JSON, project/composer ownership reporting, consistent identifier masking, duplicate-identity/media-count clues, fixed completion/error signals, privacy exclusions, and two-frame stability. This is fixture-only evidence and proves no live Flow selectors or identity semantics.

## Observations and interpretation boundary

At the time of this initial collection note, no populated structure or identifier had been reported. The subsequently supplied `flow.txt` is recorded below as user-collected structural evidence. Neither the broad report nor the focused follow-up diagnostic can establish that a candidate attribute is a provider asset ID, generation group ID, or variant ID without provider semantics evidence.

Repeated identical masked identity signals across cards, or multiple media descendants under one candidate, are only structural clues. They do not prove whether the nodes are duplicate thumbnails, re-rendered cards, or distinct outputs. Completion-like text/attributes do not establish current-attempt success without a validated ownership and lifecycle contract. A completed historical card cannot supply the missing start event or prove which attempt created it.

## Minimum production integration still required

P05.2 has a worker-side event schema, reducer, persistence path, and sender/session/document checks. The packaged `connection-probe.js` currently provides the read-only connection handshake; it is not a Flow result event producer. Production observation remains disabled.

After live evidence identifies the actual result boundary and semantics, the minimum missing integration is a narrowly scoped, read-only observer in the selected Flow top document that:

- binds to the verified project/composer boundary and the attempt's selected tab, frame, browser document, immutable snapshot, and observation session;
- observes only evidence-backed result identity and lifecycle attributes, with bounded mutation/event handling and cleanup;
- distinguishes a logical result and its variants from thumbnail/re-render duplicates using validated provider identities;
- emits ordered session events to the existing worker handler only when the observed metadata supports the attempt/snapshot attribution proof; and
- leaves unsupported, incomplete, contradictory, or lost evidence unknown, with no activation, retry, or lock release.

If Flow exposes no authoritative link from a result/group to the current generation, post-dispatch appearance alone cannot fill that gap; automatic attribution must remain blocked.

## Prerequisites for a later controlled attribution test

1. Review the one live diagnostic output and establish the selected project's unique result/composer ownership boundary.
2. Establish from actual Flow evidence which identifier(s) denote a logical result, group, and variant, and how duplicate thumbnails/re-renders relate to them.
3. Observe real loading, success, and error lifecycle markers without deliberately causing an error. Completed historical cards can support static structure only; they cannot provide the missed lifecycle or attempt link.
4. Confirm the build and worker can produce and accept events bound to the same tab/frame/document/session and immutable source snapshot. Ensure no active/uncertain lock blocks the intended new attempt; do not clear one to bypass it.
5. Obtain separate explicit authorization for one controlled new generation and record the variant count from a fresh manual settings confirmation. Never infer it from screenshots or gallery size.

P05.3 live-generation acceptance remains **NOT_STARTED**. P05, Phase 04's G-IMAGE-ONE, and automatic result attribution remain **INCOMPLETE**.

## User-collected populated tile structure and focused follow-up — 29 October 2026

The user supplied the complete `flow.txt` output from `flow-populated-results-readonly-v1`. These are **USER_COLLECTED_READ_ONLY_DOM_OBSERVATIONS**, not an independent browser inspection by this agent. The report identifies one visible `flow-project-page`, one verified composer owned by it, a recognized selected Flow route with a masked project identifier, and a stable two-animation-frame sample with no scan truncation. The project boundary reports four media nodes in total, of which two are visible and two hidden or non-rendered; ownership of those hidden nodes is not established.

Within that project, the report contains two visible `flow-image-tile` elements, each with one visible `img`. Each reported composed-looking chain includes `flow-tile-container`, `flow-grid-tile-container` (`role=group`), and `cdk-virtual-scroll-viewport`. The report's tile-level `ownRelevantAttributeNames`, `ownIdentityAttributeNames`, and `identitySignalsAlongAncestors` arrays are empty. Its recognized project and tile loading/processing/completed/error marker counts are zero; its bounded status-text signals are false. This means the report observed no such markers in the inspected DOM scope. It does not prove provider lifecycle events did not occur.

Those facts establish the current rendered structure only. One image per visible tile does not prove each tile is a distinct logical output; `role=group` does not prove a generation or variant group; and virtualized rendering means the two visible tiles are not a complete project inventory. No asset, result, group, or variant identity is proven. The broad collector's eight-ancestor identity scan omitted tile descendants, and its 16-element candidate ownership path could misreport deeply nested hotbars. Its ownership anomaly is a collector limitation, not evidence that the nested controls are outside the project.

### Focused next collection

Use [flow-image-tile-readonly.js](../../tools/diagnostics/flow-image-tile-readonly.js) in DevTools **Console** for the same existing Flow tab and selected project that produced `flow.txt`. Run it once without refreshing or navigating. It scopes to the current `flow-image-tile` elements inside the unique project boundary, walks each tile's descendants and open shadow roots, and reports full composed ancestry up to the project boundary with explicit traversal limits. It emits attribute names and consistently masked candidate values, separately classifies possible provider data identifiers versus DOM IDs, ARIA references, and test IDs, and reports current image load/dimension signals only as supporting resource state. It reports the relevant tile/grid/virtual-scroll containers, lifecycle marker counts, and truncation/stability signals. It does not emit prompt text, labels, accessible names, account data, credentials, or media URLs, and does not inspect framework-private state or replay network requests.

The script prints a compact summary. When run in DevTools, it also copies the complete JSON to the DevTools clipboard using its `copy()` helper; paste that JSON into the reply. If the helper is unavailable, the script logs the full JSON. The clipboard contains only the diagnostic JSON.

The complete collector passed **1 local Chromium browser fixture test**. The synthetic fixture mirrors the observed tile/container tags and exercises deep hotbar ancestry, DOM and accessibility identifiers, repeated masked asset-candidate values, an open shadow root, image load/dimension signals, virtual-scroll scope, and privacy exclusions. These invented fixture attributes validate collector behavior only; they do not establish Flow's live identity contract. Formatting, lint, and diff checks are recorded with this evidence update.

### Identity and lifecycle limitation

If the focused report still finds no provider-defined identity candidate, the essential missing evidence is a provider-exposed stable identifier within the tile or its descendants (or an authoritative result event carrying one), plus evidence that defines whether it identifies an asset, logical output, generation group, or variant and how repeated thumbnails/re-renders map to it. DOM IDs, ARIA references, test IDs, tile order, image dimensions/load state, and `role=group` cannot substitute. A later controlled attribution test would separately need fresh dispatch/source/document binding and live terminal lifecycle evidence; historical cards cannot provide those missed events. No result has been attached to an attempt, and no automatic attribution, settlement, or lock release is supported.

P05.3's **read-only structural evidence collection** now has user-collected evidence and a focused follow-up collector ready. Populated identity semantics, lifecycle/error contract, production event producer, and current-attempt ownership remain **NOT_OBSERVED / NOT_VERIFIED**. No generation was authorized or performed. Phase 05, G-IMAGE-ONE, and automatic result attribution remain **INCOMPLETE**.
