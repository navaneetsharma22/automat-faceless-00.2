# P10.4 Google Vids live verification and queue troubleshooting

## Evidence record — 3 November 2026

The following live outcomes are user-reported. All times are **IST**. This documentation pass did not access Chrome, inspect live storage, or perform provider actions.

### Two-shot run

**Dashboard queue evidence:** The user reports that both image–prompt pairs reached **Sent**. At **20:08:20 IST**, the scheduled alarm was received, startup reconciliation completed, and the queue handler reached, claimed, and sent Shot 2 with trigger `automatic_alarm`. The trace reported **15,996 ms**. The alarm cleared at **20:08:36 IST**.

**Google Vids render evidence:** The user reports two distinct generated clip cards, each labeled **720p** and **0:10**.

### Five-shot run

**Dashboard queue evidence:** The user reports all five image–prompt pairs reached **Sent**. At **20:17:39 IST**, the final scheduled alarm was received, startup reconciliation completed, and the queue handler reached, claimed, and sent the shot with trigger `automatic_alarm`. The trace reported **16,021 ms**. The alarm cleared at **20:17:55 IST**. The supplied screenshot captures this final automatic handoff. Intermediate handoff traces were not provided and are not inferred here.

**Google Vids render evidence:** The user reports screenshots showing five distinct generated clip cards, each labeled **720p** and **0:10**.

Dashboard **Sent** receipts show queue dispatch. The Google Vids clip cards are separate user-reported render evidence. Timeline insertion remains manual.

### Build and compatibility context

The reported fix build is `automat-faceless-0.1.0-mw0shkgc`, which includes compatibility for older saved `composerToggleObservations` without `candidateCount`. The field may be absent in a legacy observation; when present, it remains an integer from 0 through 10, and the current producer continues to emit it. See the [candidateCount compatibility evidence](vids-video-generation.md#p103-legacy-cleanup-observation-missing-candidatecount-3-november-2026).

The supplied reports do not show the extension dashboard's **Build** state for either run. Installed build confirmation is therefore **NOT_CONFIRMED** for both runs; the fix build ID is recorded as the reference build only.

### P10.4 sign-off status

No separate one-pair live verification was found in the existing Phase 10 evidence. The P10.2 evidence explicitly records live generation as not run, and the Phase 10 roadmap requires one-pair followed by two-pair live verification. The two-shot and five-shot reports above are recorded, but formal P10.4 sign-off remains **PENDING** until the one-pair live evidence is documented. **G-VIDS-VIDEO remains PENDING** and separate from Flow.

The evidence here is user-reported; this note does not independently establish a live build, queue/database read, or item-by-item association between each prepared pair and each rendered card. No new generation is authorized by this documentation record.

## Troubleshooting — Shot 1 Sent, next shot Pending at 00:00

When the queue remains at **00:00** beyond its scheduled time:

1. **Inspect the live dashboard first.** When normal troubleshooting stalls, try the ChatGPT browser extension in the same Chrome profile and confirm it can read the relevant tab and queue trace. If access is insufficient, inspect the dashboard and DevTools manually. Capture the installed **Build** state, queue status, and latest **Automatic alarm lifecycle**. Compare their timestamps so a stale snapshot is not mistaken for a fresh failure.

2. **Choose the next check from the trace.**
   - **No fresh alarm receipt:** inspect alarm scheduling, worker startup, and dashboard refresh. A missing alarm now does not prove that it never fired earlier.
   - **Alarm received; reconciliation failed; handler `not_reached`:** investigate the reported reconciliation step. For `queue_list / vids_video_queue_invalid`, inspect saved queue validation.
   - **Handler reached and shot claimed:** inspect the latest failure stage and durable attachment/Generate records. Preserve Sent receipts. Never replay an uncertain Generate attempt.
   - **Outdated connector after a build update:** confirm the installed build and reconnect the intended project before continuing verification.

3. **Inspect saved data only when the trace points to it.** Use the stable queue ID or digest; the displayed record index can change. Read the exact row by primary key in a readonly IndexedDB transaction. Compare its `preparedBatchId` with the batch ID explicitly bound to the active dashboard view. Report sanitized field paths, expected types, and stored shapes only. Label the result `SHAPE_CHECK_ONLY` unless the matching validator actually ran.

4. **Worked example — legacy `candidateCount`.** The user-reported unrelated saved queue, digest `5a65a2716242c4a7` at revision 7, belonged to a different saved batch and lacked `items[1].cleanupDiagnostics.handoffTrace.composerToggleObservations[0].candidateCount`. It blocked startup reconciliation before the active shot could be claimed. The compatibility fix allows that field to be absent in older observations while retaining the integer range 0–10 when present. The current producer still emits the field. See the [compatibility record](vids-video-generation.md#p103-legacy-cleanup-observation-missing-candidatecount-3-november-2026). This example is user-provided evidence, not an independently reread record in this session.

5. **Verify recovery through a fresh automatic alarm.** Look for reconciliation `completed`, handler `reached`, claim `claimed`, outcome `sent`, and the expected durable Sent receipts. Check Google Vids separately for completed renders. Keep storage read-only during diagnosis. Do not delete historical queues, clear IndexedDB, or use manual Resume as evidence that automatic dispatch recovered.

No manual timeline insertion or provider-setting change is part of this queue verification.
