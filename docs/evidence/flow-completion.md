# Flow populated-results evidence and P05.3 collection

Date: 29 October 2026  
Status: **USER-COLLECTED STATIC TILE STRUCTURE REVIEWED; LIFECYCLE RECORDER PREPARED**. No new generation was authorized or performed.

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

## User-collected tile identity candidates and lifecycle recorder preparation — 29 October 2026

The user supplied `text.txt` containing two complete focused tile reports. These are **USER_COLLECTED_READ_ONLY_DOM_OBSERVATIONS**. Both reports describe one visible Flow project boundary owning one verified composer and two visible `flow-image-tile` elements. Each tile contains one visible `img[data-media-id]`; the two media-ID masks are distinct within each report. Each image reports `complete=true` and natural dimensions `1376 × 768`. No recognized loading, processing, completion, error, busy, progressbar, status, or alert markers were found in the reported project/tile scopes. The image dimensions establish decoded resource dimensions only, not lifecycle or ownership.

Each tile report also contains a nested `button` `aria-describedby` accessibility-reference candidate. It is not an asset identity. `data-media-id` is a provider-identity candidate by its attribute name only; the reports do not prove its semantic meaning, cross-run stability, uniqueness outside the currently rendered DOM, or whether it identifies a logical output versus a thumbnail/asset. Mask labels are local to each report and are deliberately not compared across runs. The tiles appear beneath `flow-tile-container`, `flow-grid-tile-container[role=group]`, and `cdk-virtual-scroll-viewport`; that group role is not treated as a generation or variant group. Virtualization means the two currently rendered tiles are not a project inventory. No historical or current attempt association was inferred.

### Prepared bounded recorder

The new [read-only lifecycle recorder](../../tools/diagnostics/flow-image-lifecycle-recorder-readonly.js) is for a later separately authorized controlled test; it was **not run against Flow** in this task. When armed in the selected top-level project, it requires a recognized Flow project route, one visible `flow-project-page`, and one verified composer owned by that project. It captures existing `img[data-media-id]` candidates and lifecycle-marker counts before any dispatch. One mask map is retained for the entire recording. Page-local node tokens let the report distinguish tile/media DOM additions, removals, attribute identity changes, and same-mask node replacement without claiming that a replacement is a new variant.

During recording it watches the project and discovered open shadow roots for tile/media changes, fixed loading/progress/error/completion structure, and image `load`/`error` events. A 500 ms bounded reconciliation checks route and project/composer binding; the hard duration limit is five minutes, with an explicit stop command. Events carry an increasing sequence and elapsed time. The report records capture-gap codes, traversal/event limits, project/route changes, pagehide/document loss, observer loss, the baseline, and final rendered-DOM summary. It reports identity repetition as a count only. Image completion, natural dimensions, elapsed time, a marker disappearance, or post-boundary appearance never establish provider success.

Full results are stored as `window.__FLOW_P053_LIFECYCLE_RESULT__`; `stop()` also returns the JSON. When DevTools `copy()` is available, stopping copies the complete JSON. The exact fallback export command is `copy(JSON.stringify(window.__FLOW_P053_LIFECYCLE_RESULT__, null, 2))`. The recorder itself never performs provider actions. The manual `markDispatchBoundary()` method records only an operator marker and explicitly does not prove worker dispatch.

**Local execution:** the complete recorder passed **3 Chromium fixture tests**. The synthetic fixture exercises pre-dispatch candidate capture, distinct and repeated masked identities, media identity changes, tile addition/removal, same-mask DOM replacement, image load/error event capture, lifecycle marker changes, ordered records, named JSON export, selected-project route change, and pagehide observer loss. Fixture IDs and synthetic lifecycle states are not evidence about Flow. ESLint, Prettier, and `git diff --check` pass. No provider page, settings, prompt, attempt, lock, storage, or network was accessed or changed.

### Evidence still needed before attempt attribution

The recorder observes only the page DOM session. A later controlled test still needs a fresh, user-confirmed variant declaration and a guarded attempt whose durable dispatch intent and immutable source/snapshot are bound to the same workspace/item, selected project, tab, frame, browser document, and observation session. A production event producer must receive the worker-created attempt/session binding before activation and report its bounded capture back through the sender tab/frame/document checks; a hand-entered operator marker is neither required nor proof of dispatch. Provider evidence must establish what `data-media-id` means and supply an authoritative logical-result/group/variant relationship and terminal/error lifecycle semantics. The page script cannot read the browser's document ID. If those bindings or lifecycle signals are absent or lost, the result remains unknown; screenshots, dimensions, counts, masks, or post-dispatch appearance cannot settle attempts or release locks.

P05.3 remains **INCOMPLETE**. The static DOM collection is complete for this collection step, and the bounded recorder is prepared for later separately authorized use. No live lifecycle recording, current-attempt attribution, terminal completion, production event producer, lock release, or new generation occurred.

## User-supplied lifecycle capture and offline pre-dispatch observer seam — 29 October 2026

The user supplied the complete `flow-image-lifecycle-recorder-readonly-v1` JSON for session `capture-y49x2q8m` and dashboard screenshots for attempt `c8350874-d524-4e92-a855-fc7e5505414b`. This is **USER_PROVIDED_CAPTURE_AND_SCREENSHOT_EVIDENCE**, not independently inspected runtime or storage evidence. The recorder reports an empty scoped baseline at elapsed 3 ms, then two visible tiles and two loading markers at about 133.4 s, followed by two distinct report-local media identity masks, each attached to a different tile node. It records image load events with positive `1376 × 768` natural dimensions and the two loading markers being removed. It reports no gaps, observer loss, scan truncation, or event truncation; the user stopped it at 203.8 s.

The recorder's marker predicate is structural: `role=progressbar/status/alert`, `aria-busy=true`, `data-loading=true`, `data-error`, or loading/processing/completion/error words in `data-state`, `data-testid`, or class. It does not read page text or provider-private state. Image candidates are `img[data-media-id]` beneath the nearest `flow-image-tile`; `load`/`error` listeners are captured only when composed ancestry reaches the selected project. Dimensions and load events are supporting resource evidence only. Marker removal is a DOM transition, not a terminal success signal.

The supplied capture has **no `operator_marked_dispatch_boundary` event**. In addition, the old report format did not attach a marker to a tile or emit a per-tile media/marker relationship snapshot. Therefore the two loading markers cannot be assigned to the two individual tiles from this capture, and no elapsed time or later appearance establishes a dispatch-to-output relation. The capture does establish that both media candidates were observed under separate tile nodes. The project route was recognized and the unique project owned a verified composer, but the page recorder had no browser document ID and no attempt/session binding.

The screenshots report source length **1,375 code units**, hash `c84f9f6add46737ce29b3cb970a82125ab52e526ffec80a2a9765ec0fa62dd4d`, declared variants **2**, and action `dispatched` / `activation_pair_sent` with one activation-pair attempt; provider outcome remains **unverified**. The capture and dashboard attempt cannot be linked by this evidence because the recorder emitted no dispatch marker or durable attempt/session identity. The images are not automatically attributed and no historical attempt/result link was changed.

### Offline implementation boundary

The worker now has an explicit observer-arm port contract. For fixture-supported sessions it persists the attempt and `dispatch-intent` first, passes the observer an immutable binding containing workspace/batch/item/source hash/snapshot/attempt/project/tab/frame/loader/document/sender-frame/session/build/protocol fields, starts observation, persists the session as active, then performs the final binding/baseline checks before activation. If arming or final preflight fails, it stops the observer where applicable, records a before-dispatch failure, closes the session, and leaves the provider outcome unknown. This path is covered by synthetic integration tests.

The production Chrome port still returns `unsupported`; it does not start a Flow event producer. Thus this change does not claim that live observation currently starts in Flow. It preserves the existing unsupported-profile outcome and does not use the lifecycle recorder's manual Console marker as dispatch proof. The read-only recorder now emits tile-scoped relationship snapshots and includes `scope`/`tileNode` on marker additions/removals. Its original baseline repeated-identity summary also now counts the captured initial media rather than an uninitialized previous-sample map. These improvements apply to future captures only; they do not reconstruct relationships or identities absent from session `capture-y49x2q8m`.

The precise live facts still missing are: whether `data-media-id` is a stable logical output or asset identity and how it relates to variants; which lifecycle marker authoritatively means terminal success/error; and a production event-producer receipt correlated to the same durable attempt, session, selected project, and browser document. Image load and loading-marker removal do not answer any of those questions. P05.3, P05, G-IMAGE-ONE, and automatic attribution remain **INCOMPLETE**; no generation, settlement, or lock release occurred.

**Offline verification:** the focused P04/P05 integration suites passed **45 tests across 3 files**; the recorder passed **3 Chromium fixture tests**; full Vitest passed **193 tests across 18 files**. Typecheck, lint, Prettier for changed source/test files, and `git diff --check` passed. Production build passed; dashboard, worker, and standalone connector share build ID `automat-faceless-0.1.0-mvte3npg`. The package manifest matches the public manifest. No loaded-browser verification was available, and no provider page was accessed or changed.
