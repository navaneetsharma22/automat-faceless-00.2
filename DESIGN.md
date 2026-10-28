# Premium Extension Design Specification

Status: P01.1 theme/motion foundations, P01.2 shared components, and P01.3 dashboard are implemented. Final user visual approval remains pending.

## Product feel

A calm production workspace for long JSON batches, reference choices and video downloads. Make progress obvious. Keep diagnostic machinery behind an Advanced details disclosure.

Primary workspace: a full extension tab. A compact launcher may open the dashboard and show connection/batch status; do not duplicate the entire application in a tiny popup.

## Theme tokens

The user's palette families are confirmed. These exact hex values are the current design defaults. The user selected neon lime `#9BEC00` for the dark theme; it can be adjusted without affecting functional phases.

| Token role               | Light   | Dark    |
| ------------------------ | ------- | ------- |
| Page background          | #F7F1E8 | #0B0D10 |
| Main surface             | #FFFFFF | #15181D |
| Raised/secondary surface | #FCF8F3 | #1D2229 |
| Primary text             | #30242B | #F1F4F8 |
| Secondary text           | #75636D | #A7B0BD |
| Border                   | #E4D8D1 | #343C47 |
| Primary accent           | #731D3E | #9BEC00 |
| Text on filled primary   | #FFFFFF | #082119 |
| Hover accent             | #5C1531 | #B4FF35 |
| Focus ring               | #9C315B | #9BEC00 |
| Success text             | #236347 | #83DBAC |
| Warning text             | #805211 | #F1C574 |
| Error text               | #9F2941 | #FF9AAB |

Neon belongs on selected controls, focus and small status accents. Avoid glowing paragraphs or large neon page backgrounds. A primary dark button uses dark text on neon, not white text on a bright fill.

Define semantic CSS variables once. Components must not introduce a second hardcoded palette.

The implementation lives in `src/app/styles/tokens.css` and `src/app/styles/globals.css`. The document root uses `data-theme="light"` or `data-theme="dark"`; the theme attribute changes the semantic palette consistently. The dark primary accent and focus ring use the user-selected neon lime `#9BEC00`; hover uses `#B4FF35`. Keep neon restrained to selected controls, focus and small accents. Use dark text `#082119` on the neon-filled primary control.

## Typography and spacing

- Use a bundled/local system UI stack initially: system-ui, Segoe UI, sans-serif.
- Use ui-monospace for JSON bodies and technical details.
- Body text 14–16px, comfortable 1.45–1.6 line height.
- Main screen title 24–28px; section titles 18–20px.
- Spacing scale: 4, 8, 12, 16, 24, 32px.
- Card radius 16px; controls 10px; pills 999px.
- General screen content may use a max width around 1360px with responsive gutters.
- P01.3 desktop workspace content fills the available area after navigation, with 3vw responsive gutters (about 94% of the main work area at desktop widths); do not cap the dashboard at a narrow fixed max width.
- Desktop work area can use an input/preview column and a progress/reference column. Collapse to a single column on a narrow viewport.

These dimensions are proposed design tokens, not assumptions that every control must have identical width.

## P01.3 dashboard card family

The dashboard uses one card family for workspace panels, reference examples, progress rows, and download previews. Major panels use `--radius-card` and `--card-padding`; nested cards use `--radius-card-compact` with shared spacing tokens. Cards use semantic surface/border tokens, a subtle surface-to-raised tonal gradient, and `--shadow-card`. In light mode that means cream/white surfaces and a restrained maroon selection edge. In dark mode it means charcoal surfaces and lime `#9BEC00` only for primary actions, focus, small details, and selected state. Selected cards use `--shadow-card-selected`; ordinary cards keep neutral borders and shadows. Hover uses the existing short card transition and small lift. No card uses a persistent glow or animated gradient. Error and warning states retain semantic status tokens and readable labels.

All assets, progress bars, pair rows, and files in P01.3 are clearly marked as demonstration content. Provider-dependent actions remain disabled with adjacent explanations. The theme toggle is a session-only UI state for review and does not introduce preference storage.

## Shared component contracts

| Component                | Contract                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Primary/secondary button | 44px regular height; aligned label/icon; hover/pressed/focus/disabled/loading                                                            |
| Compact toolbar button   | 36–40px visual height, adequate click target, never used for primary batch start                                                         |
| Icon button              | 40–44px square; accessible name and visible focus                                                                                        |
| Text input/select        | 44px standard height; shared border/radius/padding                                                                                       |
| JSON editor              | Full column width; compact initial height; bounded scroll; accessible wrap and expand controls; expanded view fills most of the viewport |
| Field wrapper            | Label, optional helper, inline error, consistent spacing                                                                                 |
| Settings confirmation    | Clear checkbox sentence with selected provider/context                                                                                   |
| Progress row             | Shot ID, short stage label, progress/result state, optional details                                                                      |
| Reference card           | Shot label, image preview, selection/replacement action, pairing state                                                                   |
| Notice                   | Pending/success/warning/error; meaningful text, not colour alone                                                                         |
| Provider choice          | Two exclusive cards/radio options: Flow and Vids                                                                                         |

Do not add tests merely to assert these CSS numbers. Inspect the actual rendered controls and verify the shared tokens.

The JSON editor's Wrap lines control changes only textarea presentation (`wrap="soft"` versus `wrap="off"`); its controlled value remains the original raw string. Expand editor opens a native modal dialog and focuses its textarea. Escape and the Close editor form button close the dialog through native dialog behavior, returning focus to the invoking control. The compact editor keeps a bounded internal scroll, and the expanded editor uses the available viewport height.

## Screen inventory

| Screen           | Primary content                                                            | Primary action                   |
| ---------------- | -------------------------------------------------------------------------- | -------------------------------- |
| Connections      | Flow/Vids tab and project binding, build status                            | Connect / reconnect              |
| Image batch      | Raw JSON input, parsed count/IDs, declared variants, settings confirmation | Start image batch                |
| Image progress   | Current shot, generating/completed counts, pause state                     | Pause after current dispatch     |
| References       | Captured selections labelled by shot ID                                    | Confirm image assignments        |
| Video batch      | Video JSON input, image/prompt pairs, destination, settings confirmation   | Start video batch                |
| Downloads        | Result-to-file status, combined Vids export, split handoff                 | Prepare/download eligible result |
| Settings         | Theme and non-sensitive application preferences                            | Save preference                  |
| Advanced details | Build identity, bounded failure stage/reason and evidence                  | Copy content-free diagnostics    |

Normal users should not need to understand dispatch_intent, fingerprints, nonce, archive provenance or Chrome debugger ownership.

## Image batch form

1. Paste/upload the numbered JSON batch.
2. Show prompt count and shot IDs before execution.
3. Show a non-mutating preview and byte/character measurements.
4. Record the user's chosen Flow model and variants for tracking, without changing Flow.
5. Confirmation copy: "I have manually chosen Image mode, model, aspect ratio and variants in this Flow project."
6. Start becomes eligible only when the batch, target and required attestation are valid.

Model labels: Nano Banana Pro and Nano Banana 2.1. Variant count is not fixed at three. Do not restrict manually chosen ratios to 16:9/9:16 merely because an old dropdown did.

## Video batch form

1. Import complete video JSON bodies.
2. Show image and matching video JSON under the same shot ID.
3. Make missing/duplicate/unmatched rows obvious.
4. Select exactly one destination: Flow or Vids.
5. Confirmation copy uses that selected destination: "I have manually set video mode, model, duration, ratio, resolution and variants on this platform."
6. Explain that declared settings are user-confirmed; the extension does not automatically change them.

Duration inside JSON is not an instruction to change a duration control. Never show the old 6s action -> 8s generation rule.

The P01.3 pairing examples remain labeled as independent demo data and do not derive from either editor. P03.3 adds separate image and video source drafts with explicit Validate & Preview actions. Import previews show ordered IDs and measurements, render at most one expanded raw body, and state that no provider received the prompt. Pairing and generation remain unavailable.

The P01.3 Downloads preview uses an exclusive radio selector for Empty or Example downloads and renders only the selected state. Example files and progress remain labeled as demo content; the empty state is never displayed with populated cards.

## Large JSON behaviour

- Text entry and paste must remain responsive.
- Count and validation work should not block every keystroke for a large batch.
- Limit rendered preview height/rows while retaining the full stored body.
- Offer expand/copy/view actions; any abbreviated display is labelled as a preview.
- No on-blur pretty printing, trimming or silent newline normalization.
- A visible line wrap is a display choice, not a content mutation.
- Surface supported app limits before Start.

## Feedback

- Immediately acknowledge an accepted click: "Sending request..." or the specific active stage.
- If a response is delayed, show "Still waiting; this request may still be processing."
- Delay does not mean cancellation. Do not enable a duplicate Start just because a timer fired.
- If a button is disabled, show the actual missing prerequisite next to it.
- Show actionable pre-input failure separately from uncertain delivery.
- A settings confirmation is not repeated after every normal successful item within the same confirmed batch/context.

## Accessibility and motion

Keyboard navigation, visible focus, associated labels and sufficient text contrast are required in both themes. Do not convey provider/error/progress by colour alone. Respect reduced-motion preferences. Use subtle 120–180ms hover/control transitions; avoid distracting effects while JSON is edited.

### Motion foundations

Shared CSS duration and easing variables are defined in `tokens.css`. Buttons use a 120ms colour/border/opacity transition and a brief 90ms pressed scale response. Cards use a 160ms selection/border/shadow transition and at most a 2px hover lift. Dialog/dropdown, small screen-entry, and status/toast entrance/exit use 180ms opacity and small transform transitions. Keep these effects on UI chrome; never animate page backgrounds or the JSON editor/content. `prefers-reduced-motion` reduces token durations and transitions to 1ms and suppresses hover lift.

### Toast design (implemented in P01.2)

- `Toast` and `ToastHost` are shared P01.2 components. Use one host fixed at the top-right of the app viewport, with 16px edge inset, a 12px stack gap, a maximum of four visible items, newest first, and a readable maximum width around 24rem; on narrow screens inset 12px and allow the toast to fill the available width. When full, remove the oldest item.
- Use the semantic success, error, warning and info text/surface tokens. Add a matching border or icon and a visible label so status is never conveyed by colour alone. Keep text contrast at or above WCAG AA for normal text.
- Keep messages concise, plain-language and actionable. Do not include raw prompt JSON, prompt excerpts, access tokens, credentials or other sensitive content.
- Announce routine success/info/warning messages through a polite live region (`role="status"`, `aria-live="polite"`). Use an assertive alert only for an urgent error that needs immediate attention; avoid re-announcing routine updates.
- Provide a keyboard-accessible dismiss button with an accessible name. Pause the auto-dismiss timer while the toast or any of its controls is hovered or keyboard-focused, and resume the remaining time when interaction leaves.
- Success and info messages may auto-dismiss after 5 seconds; warnings after 8 seconds. Errors remain until dismissed. Critical or actionable errors also remain visible inline near the affected control or job; the toast is a summary and must not be the only place to recover.
- Deduplicate repeated identical notifications while one is already visible. Do not generate a new toast for every progress tick or ordinary queue item.
- Enter and exit with the shared short opacity/transform motion, following `prefers-reduced-motion`.

## Visual acceptance

The user reviews light and dark screenshots/rendered UI at the UI milestone. Verify long JSON, empty state, mixed pairing errors, active generation, delayed response, failed download and a narrow viewport. Do not claim visual approval without the user's actual feedback.

## Token contrast check

Static foreground/background contrast calculations for the implemented tokens: light body on page 13.24:1; light muted text on white 5.58:1; white on maroon primary/hover 10.64:1/13.07:1; dark body on page 17.64:1; dark muted text on dark surface 8.12:1; dark text `#082119` on neon primary `#9BEC00`/hover `#B4FF35` 11.59:1/13.93:1. Neon focus against the dark main surface is 12.19:1. Success, warning, error and info text tokens also exceed 4.5:1 against their matching status surfaces in both themes. These calculations do not replace rendered-state/user review.
