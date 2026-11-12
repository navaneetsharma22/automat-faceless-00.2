import { useEffect, useRef, useState } from "react";
import type { PreparedVideoBatchRecord } from "../../../domain/batches/types";
import {
  VIDEO_QUEUE_DISPATCH_GAP_MS,
  isFlowVideoPickerPreAddReason,
} from "../../../domain/jobs/videoQueue";
import {
  FoundationClientError,
  type createFoundationClient,
} from "../../../shared/messageClient";
import styles from "./PreparedBatchReview.module.css";
import { Button } from "../../components/Button";
import { useOptionalToast } from "../../components/ToastHost";
import { ClearQueueAction } from "./ClearQueueAction";

export type PreparedBatchReviewProps = {
  preparedBatch: PreparedVideoBatchRecord;
  persistenceClient: ReturnType<typeof createFoundationClient>;
  currentVideoSourceHash?: string;
  currentImageSourceBatchId?: string;
  onQueueCleared?: (batch: PreparedVideoBatchRecord) => void;
};

type AttachmentOperationSnapshot = {
  id: string;
  preparedBatchId: string;
  itemId: string;
  referenceId: string;
  status: "action_intent" | "attached" | "uncertain" | "blocked";
  reason?: string;
  updatedAt: number;
  verifiedAttachment?: { documentId: string; mediaId: string; verifiedAt: number };
  videoGeneration?: {
    attemptId: string;
    state: "dispatch_intent" | "dispatched" | "uncertain" | "blocked";
    reason?: string;
    promptHash: string;
  };
  preActivationEvidence?: unknown;
};

type VideoQueueSnapshot = {
  queueId: string;
  preparedBatchId: string;
  state: "ready" | "waiting" | "sent" | "paused" | "blocked" | "stopped" | "completed";
  pauseReason?: string;
  nextActionAt: number | null;
  revision: number;
  items: Array<{
    itemId: string; order: number; shotId: string; referenceId: string; state: string; reason?: string; priorReason?: string; attemptId?: string;
    readinessStartedAt?: number; readinessDeadlineAt?: number;
    dispatchReceipt?: { attemptId: string; storedAt: number };
    byteMismatchDiagnostic?: {
      stage: "candidate_byte_verification" | "read_only_reference_inspection"; acquisitionRoute: "verified_document_same_origin" | "scoped_extension_fetch" | "verified_detail_original_extension_fetch"; preparedSha256: string; metadataSha256: string; savedBytesSha256: string;
      candidateBytesSha256: string; candidateMediaId: string; mimeType: string;
      preparedByteSize: number; savedByteSize: number; candidateByteSize: number;
      preparedWidth: number; preparedHeight: number; candidateWidth?: number; candidateHeight?: number;
    };
  }>;
};

type ReferenceByteInspection = {
  status: string;
  reason?: string;
  matches?: boolean;
  diagnostic?: NonNullable<VideoQueueSnapshot["items"][number]["byteMismatchDiagnostic"]>;
};

const RECONCILABLE_PRECLICK_RECORD = {
  preparedBatchId: "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179",
  itemId: "import:default:video:item:0",
  referenceId: "014ebcff-06e3-4ac2-b980-568f0755febf",
  updatedAt: 1793605485721,
} as const;
const RECONCILABLE_PREADD_RECORD = {
  preparedBatchId: "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179",
  itemId: "import:default:video:item:1",
  referenceId: "e8c9315f-f79a-45c6-8184-4fddfce541ce",
  reason: "candidate_missing_or_virtualized",
} as const;

export function FlowPreparedBatchReview({
  preparedBatch,
  persistenceClient,
  currentVideoSourceHash,
  currentImageSourceBatchId,
  onQueueCleared,
}: PreparedBatchReviewProps) {
  const isStaleSource =
    (currentVideoSourceHash &&
      currentVideoSourceHash !== preparedBatch.videoSourceHash) ||
    (currentImageSourceBatchId &&
      currentImageSourceBatchId !== preparedBatch.imageSourceBatchId);
  const [videoQueue, setVideoQueue] = useState<VideoQueueSnapshot | null>(null);
  const [videoQueueBusy, setVideoQueueBusy] = useState(false);
  const [videoQueueAction, setVideoQueueAction] = useState<string | null>(null);
  const [videoQueueError, setVideoQueueError] = useState<string | null>(null);
  const [videoQueueNotice, setVideoQueueNotice] = useState<string | null>(null);
  const toast = useOptionalToast();
  const previousAllSent = useRef<{ queueId: string; allSent: boolean } | null>(null);
  const [referenceInspection, setReferenceInspection] = useState<Record<string, ReferenceByteInspection>>({});
  const [referenceInspectionBusy, setReferenceInspectionBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => persistenceClient.request("flow.videoQueue.get", { preparedBatchId: preparedBatch.id })
      .then((value) => { if (!cancelled) setVideoQueue(value ? value as VideoQueueSnapshot : null); })
      .catch(() => undefined);
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [preparedBatch.id, persistenceClient]);

  const sentReceiptCount = videoQueue?.items.filter(hasDurableDispatchReceipt).length ?? 0;
  const allPromptsSent = Boolean(videoQueue && videoQueue.items.length > 0 && sentReceiptCount === videoQueue.items.length);

  useEffect(() => {
    if (!videoQueue) return;
    const previous = previousAllSent.current;
    if (previous?.queueId === videoQueue.queueId && !previous.allSent && allPromptsSent) {
      toast?.add({ kind: "success", message: `All ${videoQueue.items.length} video prompts sent to Flow successfully.` });
    }
    previousAllSent.current = { queueId: videoQueue.queueId, allSent: allPromptsSent };
  }, [allPromptsSent, toast, videoQueue]);

  async function runVideoQueue(action: "start" | "pause" | "resume" | "stop" | "recheckAndResume" | "retryPreAddPickerFailure" | "reconcilePreAddFailure"): Promise<boolean> {
    setVideoQueueBusy(true);
    setVideoQueueAction(action);
    setVideoQueueError(null);
    setVideoQueueNotice(null);
    const type = `flow.videoQueue.${action}` as const;
    const payload = action === "start"
      ? { preparedBatchId: preparedBatch.id }
      : { preparedBatchId: preparedBatch.id, expectedRevision: videoQueue?.revision ?? -1 };
    try {
      const result = await persistenceClient.request(type, payload);
      if (result) {
        setVideoQueue(result as VideoQueueSnapshot);
        if (action === "reconcilePreAddFailure") setVideoQueueNotice("Shot 2's pre-Add failure was reconciled. Resume is a separate action; no attachment or Generate action was performed.");
        if (action === "retryPreAddPickerFailure") setVideoQueueNotice("The picker failure occurred before Add. The queue reconciled it and is retrying attachment; Generate dispatches only after the reference is verified.");
        return true;
      }
      return false;
    } catch (error) {
      const code = error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "queue_request_failed";
      setVideoQueueError(code);
      return false;
    } finally {
      setVideoQueueBusy(false);
      setVideoQueueAction(null);
    }
  }

  async function clearBlockedVideoQueue() {
    if (videoQueue?.state !== "blocked" || videoQueueBusy) return false;
    const stopped = await runVideoQueue("stop");
    if (stopped) onQueueCleared?.(preparedBatch);
    return stopped;
  }

  async function inspectReferenceBytes(itemId: string) {
    if (referenceInspectionBusy) return;
    setReferenceInspectionBusy(itemId);
    setReferenceInspection((current) => ({ ...current, [itemId]: { status: "inspecting" } }));
    try {
      const result = await persistenceClient.request("flow.video.inspectReferenceBytes", {
        preparedBatchId: preparedBatch.id,
        itemId,
      }) as ReferenceByteInspection;
      setReferenceInspection((current) => ({ ...current, [itemId]: result }));
    } catch (error) {
      const code = error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "inspection_request_failed";
      setReferenceInspection((current) => ({ ...current, [itemId]: { status: "blocked", reason: code } }));
    } finally {
      setReferenceInspectionBusy(null);
    }
  }

  const failedQueueItems = videoQueue?.items.filter((item) => item.state === "failed") ?? [];
  const recheckableFailure = failedQueueItems.length === 1 &&
    failedQueueItems[0]?.reason === "candidate_bytes_mismatch" &&
    !videoQueue?.items.some((item) => item.state === "uncertain");
  const recoverablePreIntentResolutionFailure = videoQueue?.state === "paused" &&
    failedQueueItems.length === 1 &&
    (failedQueueItems[0]?.reason === "target_changed" || failedQueueItems[0]?.reason === "candidate_missing") &&
    !videoQueue.items.some((item) => item.state === "uncertain");
  const reconcilablePreAddFailure = preparedBatch.id === RECONCILABLE_PREADD_RECORD.preparedBatchId &&
    videoQueue?.preparedBatchId === RECONCILABLE_PREADD_RECORD.preparedBatchId &&
    (videoQueue.state === "paused" || videoQueue.state === "blocked") &&
    videoQueue.items.filter((item) => item.state === "uncertain" || item.state === "failed").length === 1 &&
    videoQueue.items.some((item) => item.itemId === RECONCILABLE_PREADD_RECORD.itemId && item.referenceId === RECONCILABLE_PREADD_RECORD.referenceId && item.state === "uncertain" && item.reason === RECONCILABLE_PREADD_RECORD.reason) &&
    !videoQueue.items.some((item) => item.itemId !== RECONCILABLE_PREADD_RECORD.itemId && ["uncertain", "failed", "attaching", "dispatching"].includes(item.state));
  const pickerBlockedItem = (() => {
    if (!videoQueue || !["paused", "blocked"].includes(videoQueue.state)) return undefined;
    const unresolved = videoQueue.items.filter((item) =>
      ["failed", "uncertain", "attaching", "dispatching"].includes(item.state));
    if (unresolved.length !== 1 || unresolved[0]?.state !== "uncertain") return undefined;
    return isFlowVideoPickerPreAddReason(unresolved[0].reason) ? unresolved[0] : undefined;
  })();
  const retryablePickerFailure = pickerBlockedItem !== undefined;
  const activeQueueItem = videoQueue?.items.find((item) => item.state === "attaching" || item.state === "dispatching");
  const readinessQueueItem = videoQueue?.items.find((item) => item.state === "waiting_for_generate");
  const nextQueueItem = activeQueueItem ?? readinessQueueItem ?? videoQueue?.items.find((item) => item.state === "pending");
  const videoQueueStatus = getVideoQueueStatus(videoQueue, allPromptsSent, activeQueueItem, readinessQueueItem);
  const preparedHeading = allPromptsSent
    ? `All ${videoQueue?.items.length ?? 0} image–prompt pairs sent to Flow`
    : videoQueueStatus === "Ready" || !videoQueue
      ? "Prepared — not submitted to Flow."
      : videoQueueStatus === "Sending"
        ? "Sending video prompts to Flow"
        : `Video queue ${videoQueueStatus.toLowerCase()}`;

  return (
    <section
      className={styles.container}
      aria-labelledby="prepared-review-heading"
    >
      <div className={styles.header}>
        <div>
          <h3 id="prepared-review-heading" className={styles.title}>
            {preparedHeading}
          </h3>
          <p className={styles.disclaimer}>
            Use Start once to process the paired Flow references and video prompts sequentially. Provider settings remain user-controlled.
          </p>
        </div>
        <span className={styles.badge}>Status: {allPromptsSent ? "All sent" : videoQueueStatus}</span>
      </div>

      {isStaleSource ? (
        <p className={styles.staleAlert} role="note">
          Notice: Current video editor draft or selected image source differs
          from this saved prepared batch. The snapshot below remains preserved
          unchanged. To prepare an updated batch, review and confirm below.
        </p>
      ) : null}

      <div className={styles.metaGrid}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Prepared Batch ID</span>
          <span className={styles.metaValue}>{preparedBatch.id}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Destination</span>
          <span className={styles.metaValue}>Flow</span>
          <span className={styles.metaSubtext}>
            Target: {preparedBatch.target.canonicalTarget} (Tab{" "}
            {preparedBatch.target.tabId})
          </span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Declared Duration</span>
          <span className={styles.metaValue}>
            {preparedBatch.manualSettingsDeclaration.declaredDurationSeconds}s
          </span>
          <span className={styles.metaSubtext}>
            User-declared whole-batch metadata
          </span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Items Prepared</span>
          <span className={styles.metaValue}>
            {preparedBatch.itemCount} paired shots
          </span>
          <span className={styles.metaSubtext}>
            Target revalidation required on execution
          </span>
        </div>
      </div>

      <div className={styles.itemList}>
          <section className={styles.videoQueue} aria-label="Flow video queue">
            <div className={styles.videoQueueHeader}>
              <div>
                <h3>Flow video queue</h3>
                <p>One start action sends paired references and prompts in order. Sent means Generate was dispatched; provider completion is not verified here.</p>
              </div>
              {!videoQueue || videoQueue.state === "ready" ? (
                <Button type="button" disabled={videoQueueBusy} loading={videoQueueAction === "start"} loadingLabel="Starting" onClick={() => void runVideoQueue("start")}>Start</Button>
              ) : videoQueue.state === "waiting" ? (
                <div className={styles.videoQueueActions}>
                  <Button type="button" variant="secondary" disabled={videoQueueBusy} loading={videoQueueAction === "pause"} loadingLabel="Pausing" onClick={() => void runVideoQueue("pause")}>Pause</Button>
                  <Button type="button" variant="secondary" disabled={videoQueueBusy} onClick={() => void runVideoQueue("stop")}>Stop queue</Button>
                </div>
              ) : (videoQueue.state === "paused" || videoQueue.state === "blocked") && recheckableFailure ? (
                <Button type="button" disabled={videoQueueBusy || referenceInspectionBusy !== null} loading={videoQueueAction === "recheckAndResume"} loadingLabel="Rechecking" onClick={() => void runVideoQueue("recheckAndResume")}>Recheck &amp; Resume</Button>
              ) : (videoQueue.state === "paused" || videoQueue.state === "blocked") && reconcilablePreAddFailure ? (
                <Button type="button" disabled={videoQueueBusy} loading={videoQueueAction === "reconcilePreAddFailure"} loadingLabel="Reconciling" onClick={() => void runVideoQueue("reconcilePreAddFailure")}>Reconcile Shot 2 pre-Add failure</Button>
              ) : retryablePickerFailure ? (
                <div className={styles.videoQueueActions}>
                  <Button type="button" disabled={videoQueueBusy} loading={videoQueueAction === "retryPreAddPickerFailure"} loadingLabel="Retrying" onClick={() => void runVideoQueue("retryPreAddPickerFailure")}>Retry Shot {pickerBlockedItem?.shotId}</Button>
                  <Button type="button" variant="secondary" disabled={videoQueueBusy} onClick={() => void runVideoQueue("stop")}>Stop queue</Button>
                </div>
              ) : recoverablePreIntentResolutionFailure ? (
                <div className={styles.videoQueueActions}>
                  <Button type="button" disabled={videoQueueBusy} loading={videoQueueAction === "resume"} loadingLabel="Rechecking" onClick={() => void runVideoQueue("resume")}>Resume</Button>
                  <Button type="button" variant="secondary" disabled={videoQueueBusy} onClick={() => void runVideoQueue("stop")}>Stop queue</Button>
                </div>
              ) : videoQueue.state === "paused" && !videoQueue.items.some((item) => item.state === "uncertain" || item.state === "failed") ? (
                <div className={styles.videoQueueActions}>
                  <Button type="button" disabled={videoQueueBusy} loading={videoQueueAction === "resume"} loadingLabel="Resuming" onClick={() => void runVideoQueue("resume")}>Resume</Button>
                  <Button type="button" variant="secondary" disabled={videoQueueBusy} onClick={() => void runVideoQueue("stop")}>Stop queue</Button>
                </div>
              ) : null}
              {videoQueue?.state === "blocked" ? (
                <ClearQueueAction
                  disabled={videoQueueBusy}
                  onConfirm={clearBlockedVideoQueue}
                />
              ) : null}
            </div>
            {videoQueue ? (
              <>
                {videoQueueNotice ? <p role="status">{videoQueueNotice}</p> : null}
                {videoQueueError ? <p role="alert">Queue action failed: {videoQueueError}</p> : null}
                <div className={styles.queueOverview}>
                  <div className={styles.queueOverviewState}>
                    <span className={`${styles.stateBadge} ${styles[`state${videoQueueStatus.replace(/[^a-zA-Z0-9]/g, "")}`] ?? ""}`}>
                      <span aria-hidden="true">{statusIcon(videoQueueStatus)}</span> {videoQueueStatus}
                    </span>
                    {videoQueue.pauseReason && ["paused", "stopped", "blocked"].includes(videoQueue.state) ? <p>{videoQueue.pauseReason.replaceAll("_", " ")}</p> : null}
                  </div>
                  <div className={styles.queueOverviewProgress}>
                    <label htmlFor={`video-queue-progress-${videoQueue.queueId}`}>Prompts sent to Flow</label>
                    <progress id={`video-queue-progress-${videoQueue.queueId}`} max={videoQueue.items.length || 1} value={sentReceiptCount} aria-valuetext={`${sentReceiptCount} of ${videoQueue.items.length} prompts sent`} />
                    <strong>{sentReceiptCount} of {videoQueue.items.length} prompts sent</strong>
                    {allPromptsSent ? <p>Video completion is checked in Flow.</p> : null}
                  </div>
                  <div className={styles.queueOverviewShot}>
                    <span>{activeQueueItem ? "Current Shot" : "Current / next Shot"}</span>
                    <strong>{nextQueueItem ? `Shot ${nextQueueItem.shotId}` : allPromptsSent ? "All prompts sent" : videoQueue.state === "stopped" ? "Queue stopped" : "No pending Shot"}</strong>
                    {nextQueueItem?.reason && (nextQueueItem.state === "failed" || nextQueueItem.state === "uncertain") ? <code>{nextQueueItem.reason}</code> : null}
                  </div>
                </div>
                {videoQueue.state === "waiting" && videoQueue.nextActionAt !== null && !activeQueueItem && !allPromptsSent ? (
                  <VideoDispatchClock deadline={videoQueue.nextActionAt} waitingForGenerate={Boolean(readinessQueueItem)} intervalMs={VIDEO_QUEUE_DISPATCH_GAP_MS} shotId={nextQueueItem?.shotId} />
                ) : null}
                {videoQueue.state === "waiting" && videoQueue.nextActionAt === null && !allPromptsSent ? (
                  <p className={styles.queueChecking} role="status" aria-live="polite">{readinessQueueItem ? "Checking Generate readiness…" : activeQueueItem ? "Sending next shot…" : "Checking next shot…"}</p>
                ) : null}
                <p className={styles.queueStatusAnnouncement} role="status" aria-live="polite">{videoQueueStatus}{nextQueueItem && !allPromptsSent ? ` — Shot ${nextQueueItem.shotId}` : ""}</p>
                <details className={styles.queueDiagnostics}>
                  <summary>Queue diagnostics and recovery evidence</summary>
                <ol aria-label="Flow video shot statuses">
                  {videoQueue.items.map((item) => (
                    <li key={item.itemId}>
                      Shot {item.shotId}: {item.state === "pending" ? "Pending" : item.state === "attaching" || item.state === "dispatching" ? "Sending" : item.state === "waiting_for_generate" ? "Waiting for Generate" : item.state === "sent" || item.state === "awaiting_completion" || item.state === "awaiting_verification" || item.state === "completed" ? "Sent" : item.state === "skipped" ? "Stopped" : item.state === "failed" || item.state === "uncertain" ? "Blocked" : item.state}{item.reason ? ` (${item.reason})` : ""}{item.priorReason ? ` — previously blocked: ${item.priorReason}` : ""}
                      {item.byteMismatchDiagnostic ? (
                        <details>
                          <summary>Bounded candidate byte comparison</summary>
                          <dl>
                            <dt>Media ID</dt><dd>{item.byteMismatchDiagnostic.candidateMediaId}</dd>
                            <dt>Acquisition route</dt><dd>{item.byteMismatchDiagnostic.acquisitionRoute}</dd>
                            <dt>MIME</dt><dd>{item.byteMismatchDiagnostic.mimeType}</dd>
                            <dt>Bytes: prepared / saved / candidate</dt><dd>{item.byteMismatchDiagnostic.preparedByteSize} / {item.byteMismatchDiagnostic.savedByteSize} / {item.byteMismatchDiagnostic.candidateByteSize}</dd>
                            <dt>SHA-256: prepared</dt><dd>{item.byteMismatchDiagnostic.preparedSha256}</dd>
                            <dt>SHA-256: saved metadata</dt><dd>{item.byteMismatchDiagnostic.metadataSha256}</dd>
                            <dt>SHA-256: saved bytes</dt><dd>{item.byteMismatchDiagnostic.savedBytesSha256}</dd>
                            <dt>SHA-256: fetched candidate</dt><dd>{item.byteMismatchDiagnostic.candidateBytesSha256}</dd>
                            {item.byteMismatchDiagnostic.candidateWidth && item.byteMismatchDiagnostic.candidateHeight ? <><dt>Dimensions: prepared / candidate</dt><dd>{item.byteMismatchDiagnostic.preparedWidth}×{item.byteMismatchDiagnostic.preparedHeight} / {item.byteMismatchDiagnostic.candidateWidth}×{item.byteMismatchDiagnostic.candidateHeight}</dd></> : null}
                          </dl>
                        </details>
                      ) : null}
                      {item.state === "failed" && item.reason === "candidate_bytes_mismatch" ? (
                        <div>
                          <Button size="compact" variant="secondary" type="button" disabled={referenceInspectionBusy !== null} loading={referenceInspectionBusy === item.itemId} loadingLabel="Inspecting" onClick={() => void inspectReferenceBytes(item.itemId)}>
                            {referenceInspectionBusy === item.itemId ? "Inspecting reference bytes…" : "Inspect reference bytes"}
                          </Button>
                          {referenceInspection[item.itemId] ? (
                            referenceInspection[item.itemId]!.diagnostic ? (
                              <details open>
                                <summary>{referenceInspection[item.itemId]!.matches ? "Fetched bytes match the prepared reference" : "Fetched bytes differ from the prepared reference"}</summary>
                                <dl>
                                  <dt>Acquisition route</dt><dd>{referenceInspection[item.itemId]!.diagnostic!.acquisitionRoute}</dd>
                                  <dt>Media ID</dt><dd>{referenceInspection[item.itemId]!.diagnostic!.candidateMediaId}</dd>
                                  <dt>MIME</dt><dd>{referenceInspection[item.itemId]!.diagnostic!.mimeType}</dd>
                                  <dt>Bytes: expected / saved / actual</dt><dd>{referenceInspection[item.itemId]!.diagnostic!.preparedByteSize} / {referenceInspection[item.itemId]!.diagnostic!.savedByteSize} / {referenceInspection[item.itemId]!.diagnostic!.candidateByteSize}</dd>
                                  <dt>SHA-256: expected</dt><dd>{referenceInspection[item.itemId]!.diagnostic!.preparedSha256}</dd>
                                  <dt>SHA-256: saved metadata</dt><dd>{referenceInspection[item.itemId]!.diagnostic!.metadataSha256}</dd>
                                  <dt>SHA-256: saved bytes</dt><dd>{referenceInspection[item.itemId]!.diagnostic!.savedBytesSha256}</dd>
                                  <dt>SHA-256: actual candidate</dt><dd>{referenceInspection[item.itemId]!.diagnostic!.candidateBytesSha256}</dd>
                                  {referenceInspection[item.itemId]!.diagnostic!.candidateWidth && referenceInspection[item.itemId]!.diagnostic!.candidateHeight ? <><dt>Dimensions: expected / actual</dt><dd>{referenceInspection[item.itemId]!.diagnostic!.preparedWidth}×{referenceInspection[item.itemId]!.diagnostic!.preparedHeight} / {referenceInspection[item.itemId]!.diagnostic!.candidateWidth}×{referenceInspection[item.itemId]!.diagnostic!.candidateHeight}</dd></> : null}
                                </dl>
                              </details>
                            ) : <p role="status">Reference inspection: {referenceInspection[item.itemId]!.reason ?? referenceInspection[item.itemId]!.status}. No attachment action was taken.</p>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
                </details>
              </>
            ) : null}
            {videoQueueError ? <p role="alert">Queue action failed: {videoQueueError}</p> : null}
          </section>
        {preparedBatch.items.map((item) => (
          <PreparedItemCard
            key={item.itemId}
            item={item}
            preparedBatchId={preparedBatch.id}
            eligible
            persistenceClient={persistenceClient}
            queueManaged
            queueItem={videoQueue?.items.find((entry) => entry.itemId === item.itemId)}
            queueState={videoQueue?.state}
          />
        ))}
      </div>
    </section>
  );
}

function hasDurableDispatchReceipt(item: VideoQueueSnapshot["items"][number]): boolean {
  return Boolean(item.attemptId && item.dispatchReceipt?.attemptId === item.attemptId && Number.isFinite(item.dispatchReceipt.storedAt));
}

function getVideoQueueStatus(
  queue: VideoQueueSnapshot | null,
  allSent: boolean,
  active?: VideoQueueSnapshot["items"][number],
  readiness?: VideoQueueSnapshot["items"][number],
): string {
  if (allSent) return "All sent";
  if (!queue) return "Ready";
  if (queue.state === "blocked") return "Blocked";
  if (queue.state === "paused") return "Paused";
  if (queue.state === "stopped") return "Stopped";
  if (active) return "Sending";
  if (readiness) return "Waiting for Generate";
  if (queue.state === "ready") return "Ready";
  return queue.nextActionAt === null ? "Checking" : "Waiting";
}

function statusIcon(status: string): string {
  if (status === "Sent" || status === "All sent") return "✓";
  if (status === "Sending") return "●";
  if (status.includes("Waiting")) return "◷";
  if (status === "Blocked") return "!";
  if (status === "Paused") return "Ⅱ";
  if (status === "Stopped") return "■";
  if (status === "Ready") return "○";
  return "…";
}

function getQueueItemStatus(item?: VideoQueueSnapshot["items"][number], queueState?: VideoQueueSnapshot["state"]): string {
  if (!item) return "Prepared";
  if (hasDurableDispatchReceipt(item)) return "Sent";
  if (item.state === "attaching" || item.state === "dispatching") return "Sending";
  if (item.state === "waiting_for_generate") return "Waiting for Generate";
  if (item.state === "failed" || item.state === "uncertain") return "Blocked";
  if (item.state === "skipped" || (item.state === "pending" && queueState === "stopped")) return "Stopped";
  if (item.state === "pending" && queueState === "paused") return "Paused";
  if (item.state === "pending" && queueState === "ready") return "Ready";
  return item.state === "pending" ? "Pending" : item.state.replaceAll("_", " ");
}

function QueueItemBadge({ item, queueState }: { item?: VideoQueueSnapshot["items"][number]; queueState?: VideoQueueSnapshot["state"] }) {
  const status = getQueueItemStatus(item, queueState);
  const stateClass = styles[`itemState${status.replace(/[^a-zA-Z0-9]/g, "")}`] ?? "";
  return <span className={`${styles.itemStatusBadge} ${stateClass}`}><span aria-hidden="true">{statusIcon(status)}</span> {status}</span>;
}

function VideoDispatchClock({
  deadline,
  waitingForGenerate,
  intervalMs,
  shotId,
}: {
  deadline: number;
  waitingForGenerate: boolean;
  intervalMs: number;
  shotId?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, deadline - now);
  const seconds = Math.ceil(remaining / 1000);
  const display = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const progress = Math.max(0, Math.min(100, ((intervalMs - remaining) / intervalMs) * 100));
  return (
    <section className={styles.dispatchClock} aria-label="Video dispatch interval">
      <div className={styles.dispatchClockHeader}>
        <strong>{waitingForGenerate ? "Waiting for Generate — remaining" : "Next shot in"}</strong>
        {shotId ? <span>{waitingForGenerate ? "Readiness check" : `Shot ${shotId}`}</span> : null}
      </div>
      <div className={styles.dispatchTimer} role="timer" aria-live="off" aria-label={`${waitingForGenerate ? "Waiting for Generate" : "Next shot in"}: ${display}`}>
        {display}
      </div>
      <div className={styles.dispatchTrack} aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      <p>{remaining === 0 ? (waitingForGenerate ? "Checking Generate readiness…" : "Checking next shot…") : "The saved scheduler deadline controls the next check."}</p>
    </section>
  );
}

function PreparedItemCard({
  item,
  preparedBatchId,
  eligible,
  persistenceClient,
  queueManaged,
  queueItem,
  queueState,
}: {
  item: PreparedVideoBatchRecord["items"][number];
  preparedBatchId: string;
  eligible: boolean;
  persistenceClient: ReturnType<typeof createFoundationClient>;
  queueManaged: boolean;
  queueItem?: VideoQueueSnapshot["items"][number];
  queueState?: VideoQueueSnapshot["state"];
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState(
    "Loading attachment status…",
  );
  const [attachmentOperation, setAttachmentOperation] =
    useState<AttachmentOperationSnapshot | null>(null);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void persistenceClient
      .request("flow.video.getAttachmentStatus", {
        preparedBatchId,
        itemId: item.itemId,
      })
      .then((result) => {
        const operation = (
          result as { operation?: AttachmentOperationSnapshot }
        )?.operation;
        if (!cancelled) setAttachmentOperation(operation ?? null);
        const status =
          (result as { status?: string; reason?: string })?.status ??
          "not_started";
        const reason = (result as { reason?: string })?.reason;
        const generation = operation?.videoGeneration;
        if (!cancelled)
          setAttachmentStatus(
            generation?.state === "dispatched"
              ? "Generate was sent once; provider acceptance and completion are unverified"
              : generation?.state === "dispatch_intent" || generation?.state === "uncertain"
                ? `Generation delivery uncertain — inspect Flow before retrying${generation.reason ? ` (${generation.reason})` : ""}`
                : generation?.state === "blocked"
                  ? `Generation blocked${generation.reason ? ` (${generation.reason})` : ""}; no automatic retry`
                  : status === "attached" || status === "already_attached"
              ? "Attached and verified"
              : status === "uncertain"
                ? "Attachment delivery uncertain"
                : status === "blocked"
                  ? reason === "pre_activation_failure_reconciled"
                    ? "Reconciled: historical failure preceded the picker click. Attach reference remains a separate action."
                    : `Blocked: ${reason ?? "review required"}`
                  : "Not attached",
          );
      })
      .catch(() => {
        if (!cancelled) setAttachmentStatus("Status unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [preparedBatchId, item.itemId, persistenceClient]);

  async function attachReference() {
    setAttaching(true);
    setAttachmentStatus("Checking Flow target and reference…");
    try {
      const result = (await persistenceClient.request(
        "flow.video.attachReference",
        { preparedBatchId, itemId: item.itemId },
      )) as { status?: string; reason?: string };
      const status = result?.status;
      const stage = (result as { stage?: string }).stage;
      const diagnostic = [stage, result?.reason]
        .filter((part) => part && /^[a-z0-9_]{1,64}$/.test(part))
        .join(": ");
      setAttachmentStatus(
        status === "attached"
          ? "Attached and verified"
          : status === "already_attached"
            ? "Already attached and verified"
            : status === "uncertain"
              ? `Attachment delivery uncertain — inspect Flow before retrying${diagnostic ? ` (${diagnostic})` : ""}`
              : status === "blocked"
                ? `Blocked${diagnostic ? ` (${diagnostic})` : ": preflight failed"}`
                : "Attachment status unavailable",
      );
    } catch (error) {
      const code =
        error instanceof FoundationClientError &&
        /^[a-z0-9_]{1,64}$/.test(error.code)
          ? error.code
          : "request_failed";
      const stage =
        error instanceof FoundationClientError &&
        error.stage &&
        /^[a-z0-9_]{1,64}$/.test(error.stage)
          ? `${error.stage}:`
          : "";
      setAttachmentStatus(
        `Attachment delivery uncertain — inspect Flow before retrying (${stage}${code})`,
      );
    } finally {
      setAttaching(false);
    }
  }

  async function verifyAttachedReference() {
    if (!attachmentOperation || !["uncertain", "action_intent"].includes(attachmentOperation.status)) return;
    setAttaching(true);
    setAttachmentStatus("Verifying the existing reference in the bound Flow document…");
    try {
      const result = (await persistenceClient.request(
        "flow.video.verifyAttachedReference",
        { preparedBatchId, itemId: item.itemId },
      )) as { status?: string; reason?: string; operation?: AttachmentOperationSnapshot };
      if (result.status === "attached" && result.operation) {
        setAttachmentOperation(result.operation);
        setAttachmentStatus("Attached and verified in the bound Flow document");
      } else {
        const reason = result.reason && /^[a-z0-9_]{1,64}$/.test(result.reason) ? result.reason : "verification_unconfirmed";
        setAttachmentStatus(`Verification not confirmed (${reason}); no attachment action was taken`);
      }
    } catch (error) {
      const code = error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "request_failed";
      setAttachmentStatus(`Verification unavailable (${code}); no attachment action was taken`);
    } finally {
      setAttaching(false);
    }
  }

  async function generateVideoOnce() {
    if (!attachmentOperation || attachmentOperation.status !== "attached" || attachmentOperation.videoGeneration) return;
    setAttaching(true);
    setAttachmentStatus("Checking the prepared prompt and attached reference…");
    try {
      const result = (await persistenceClient.request("flow.video.generateOnce", {
        preparedBatchId,
        itemId: item.itemId,
      })) as {
        status?: string;
        reason?: string;
        operation?: AttachmentOperationSnapshot;
      };
      if (result.operation) setAttachmentOperation(result.operation);
      if (result.status === "dispatched" || result.status === "already_dispatched") {
        setAttachmentStatus("Generate was sent once; provider acceptance and completion are unverified");
      } else if (result.status === "uncertain") {
        setAttachmentStatus(`Generation delivery uncertain — inspect Flow before retrying${result.reason ? ` (${result.reason})` : ""}`);
      } else {
        setAttachmentStatus(`Generation blocked${result.reason ? ` (${result.reason})` : ""}; no automatic retry`);
      }
    } catch (error) {
      const code = error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "request_failed";
      setAttachmentStatus(`Generation result unavailable (${code}); inspect Flow before retrying`);
    } finally {
      try {
        const latest = (await persistenceClient.request("flow.video.getAttachmentStatus", { preparedBatchId, itemId: item.itemId })) as { operation?: AttachmentOperationSnapshot };
        if (latest.operation) setAttachmentOperation(latest.operation);
      } catch {
        // The generation operation itself remains authoritative; status is only a readback.
      }
      setAttaching(false);
    }
  }

  const canReconcilePreClickFailure = Boolean(
    eligible &&
    attachmentOperation &&
    preparedBatchId === RECONCILABLE_PRECLICK_RECORD.preparedBatchId &&
    item.itemId === RECONCILABLE_PRECLICK_RECORD.itemId &&
    item.reference.referenceId === RECONCILABLE_PRECLICK_RECORD.referenceId &&
    attachmentOperation.id ===
      `${RECONCILABLE_PRECLICK_RECORD.preparedBatchId}:${RECONCILABLE_PRECLICK_RECORD.itemId}` &&
    attachmentOperation.preparedBatchId ===
      RECONCILABLE_PRECLICK_RECORD.preparedBatchId &&
    attachmentOperation.itemId === RECONCILABLE_PRECLICK_RECORD.itemId &&
    attachmentOperation.referenceId ===
      RECONCILABLE_PRECLICK_RECORD.referenceId &&
    attachmentOperation.status === "uncertain" &&
    attachmentOperation.reason === "composer_unsupported" &&
    attachmentOperation.updatedAt === RECONCILABLE_PRECLICK_RECORD.updatedAt &&
    !attachmentOperation.preActivationEvidence,
  );

  async function reconcilePreClickFailure() {
    if (!canReconcilePreClickFailure || !attachmentOperation) return;
    setAttaching(true);
    setAttachmentStatus("Reconciling the recorded pre-click failure…");
    try {
      const result = (await persistenceClient.request(
        "flow.video.reconcilePreClickFailure",
        {
          preparedBatchId,
          itemId: item.itemId,
          expectedStatus: "uncertain",
          expectedReason: "composer_unsupported",
          expectedReferenceId: attachmentOperation.referenceId,
          expectedUpdatedAt: attachmentOperation.updatedAt,
        },
      )) as {
        status?: string;
        reason?: string;
        operation?: AttachmentOperationSnapshot;
      };
      if (result.status === "reconciled" && result.operation) {
        setAttachmentOperation(result.operation);
        setAttachmentStatus(
          "Reconciled: the recorded failure preceded the picker click. Attach reference remains a separate action.",
        );
      } else {
        setAttachmentStatus(
          `Reconciliation not applied: ${result.reason ?? "operation_changed"}`,
        );
      }
    } catch {
      setAttachmentStatus(
        "Reconciliation not confirmed. The operation was not automatically retried.",
      );
    } finally {
      setAttaching(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadThumbnail() {
      try {
        const response = (await persistenceClient.request(
          "flow.reference.getSavedReference",
          { referenceId: item.reference.referenceId },
        )) as { data: string; reference: { mimeType: string } };

        if (!cancelled && response?.data) {
          setThumbnailUrl(
            `data:${response.reference.mimeType};base64,${response.data}`,
          );
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    }

    void loadThumbnail();
    return () => {
      cancelled = true;
    };
  }, [item.reference.referenceId, persistenceClient]);

  return (
    <article className={styles.itemCard}>
      <div className={styles.itemHeader}>
        <div className={styles.thumbnailContainer}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={`Reference thumbnail for Shot ${item.canonicalShotId}`}
              className={styles.thumbnailImage}
            />
          ) : (
            <span className={styles.thumbnailPlaceholder}>
              {loadError ? "Unavailable" : "Loading..."}
            </span>
          )}
        </div>
        <div className={styles.itemMeta}>
          <h4 className={styles.itemShotTitle}>
            Shot {item.canonicalShotId}{" "}
            {item.shotId && item.shotId !== item.canonicalShotId
              ? `(raw "${item.shotId}")`
              : ""}
          </h4>
          {queueManaged ? <QueueItemBadge item={queueItem} queueState={queueState} /> : null}
          {queueItem && (queueItem.state === "failed" || queueItem.state === "uncertain") && queueItem.reason ? <p className={styles.currentBlocker} role="alert">Current blocker: <code>{queueItem.reason}</code></p> : null}
          <p className={styles.itemSpecs}>
            Reference: {item.reference.width}×{item.reference.height},{" "}
            {item.reference.mimeType}, version{" "}
            {item.reference.assignmentVersion}
          </p>
        </div>
      </div>

      {eligible && !queueManaged ? (
        <div>
          {canReconcilePreClickFailure ? (
            <button
              type="button"
              disabled={attaching}
              onClick={() => void reconcilePreClickFailure()}
            >
              Reconcile pre-click failure
            </button>
          ) : null}
          {attachmentOperation &&
          (attachmentOperation.status === "uncertain" || attachmentOperation.status === "action_intent") ? (
            <button type="button" disabled={attaching} onClick={() => void verifyAttachedReference()}>
              Verify attached reference
            </button>
          ) : null}
          {attachmentOperation?.status === "attached" ? (
            <button
              type="button"
              disabled={attaching || Boolean(attachmentOperation.videoGeneration)}
              onClick={() => void generateVideoOnce()}
            >
              {attaching ? "Preparing this shot…" : attachmentOperation.videoGeneration ? "Generation already attempted" : "Generate this shot once"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={
              attaching ||
              attachmentStatus.startsWith("Attached") ||
              attachmentStatus.startsWith("Already attached")
            }
            onClick={() => void attachReference()}
          >
            {attaching ? "Attaching…" : "Attach reference"}
          </button>
          <span role="status" aria-live="polite">
            {" "}
            {attachmentStatus}
          </span>
        </div>
      ) : null}

      <details className={styles.details}>
        <summary className={styles.summary}>
          Exact video prompt JSON (hash: {item.contentHash.slice(0, 12)}...)
        </summary>
        <p className={styles.fullPromptHash}>SHA-256: <code>{item.contentHash}</code></p>
        <pre className={styles.rawJson}>{item.rawJsonBody}</pre>
        {queueItem?.priorReason ? <p className={styles.priorFailure}>Previous failure (resolved by explicit recovery): <code>{queueItem.priorReason}</code></p> : null}
      </details>
    </article>
  );
}
