import { useEffect, useState } from "react";
import type { PreparedVideoBatchRecord } from "../../../domain/batches/types";
import {
  FoundationClientError,
  type createFoundationClient,
} from "../../../shared/messageClient";
import styles from "./PreparedBatchReview.module.css";

export type PreparedBatchReviewProps = {
  preparedBatch: PreparedVideoBatchRecord;
  persistenceClient: ReturnType<typeof createFoundationClient>;
  currentVideoSourceHash?: string;
  currentImageSourceBatchId?: string;
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

export function PreparedBatchReview({
  preparedBatch,
  persistenceClient,
  currentVideoSourceHash,
  currentImageSourceBatchId,
}: PreparedBatchReviewProps) {
  const isStaleSource =
    (currentVideoSourceHash &&
      currentVideoSourceHash !== preparedBatch.videoSourceHash) ||
    (currentImageSourceBatchId &&
      currentImageSourceBatchId !== preparedBatch.imageSourceBatchId);
  const [videoQueue, setVideoQueue] = useState<VideoQueueSnapshot | null>(null);
  const [videoQueueBusy, setVideoQueueBusy] = useState(false);
  const [videoQueueError, setVideoQueueError] = useState<string | null>(null);
  const [videoQueueNotice, setVideoQueueNotice] = useState<string | null>(null);
  const [referenceInspection, setReferenceInspection] = useState<Record<string, ReferenceByteInspection>>({});
  const [referenceInspectionBusy, setReferenceInspectionBusy] = useState<string | null>(null);

  useEffect(() => {
    if (preparedBatch.destination !== "Flow") return;
    let cancelled = false;
    const load = () => persistenceClient.request("flow.videoQueue.get", { preparedBatchId: preparedBatch.id })
      .then((value) => { if (!cancelled) setVideoQueue(value ? value as VideoQueueSnapshot : null); })
      .catch(() => undefined);
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [preparedBatch.destination, preparedBatch.id, persistenceClient]);

async function runVideoQueue(action: "start" | "pause" | "resume" | "stop" | "recheckAndResume" | "reconcilePreAddFailure") {
    setVideoQueueBusy(true);
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
      }
    } catch (error) {
      const code = error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "queue_request_failed";
      setVideoQueueError(code);
    } finally {
      setVideoQueueBusy(false);
    }
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
  const reconcilablePreAddFailure = preparedBatch.id === RECONCILABLE_PREADD_RECORD.preparedBatchId &&
    videoQueue?.preparedBatchId === RECONCILABLE_PREADD_RECORD.preparedBatchId &&
    (videoQueue.state === "paused" || videoQueue.state === "blocked") &&
    videoQueue.items.filter((item) => item.state === "uncertain" || item.state === "failed").length === 1 &&
    videoQueue.items.some((item) => item.itemId === RECONCILABLE_PREADD_RECORD.itemId && item.referenceId === RECONCILABLE_PREADD_RECORD.referenceId && item.state === "uncertain" && item.reason === RECONCILABLE_PREADD_RECORD.reason) &&
    !videoQueue.items.some((item) => item.itemId !== RECONCILABLE_PREADD_RECORD.itemId && ["uncertain", "failed", "attaching", "dispatching"].includes(item.state));

  return (
    <section
      className={styles.container}
      aria-labelledby="prepared-review-heading"
    >
      <div className={styles.header}>
        <div>
          <h3 id="prepared-review-heading" className={styles.title}>
            Prepared — not submitted to Flow/Vids.
          </h3>
          <p className={styles.disclaimer}>
            Use Start once to process the paired Flow references and video prompts sequentially. Provider settings remain user-controlled.
          </p>
        </div>
        <span className={styles.badge}>Status: Prepared</span>
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
          <span className={styles.metaValue}>{preparedBatch.destination}</span>
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
        {preparedBatch.destination === "Flow" ? (
          <section className={styles.videoQueue} aria-label="Flow video queue">
            <div className={styles.videoQueueHeader}>
              <div>
                <h3>Flow video queue</h3>
                <p>One start action sends paired references and prompts in order. Sent means Generate was dispatched; provider completion is not verified here.</p>
              </div>
              {!videoQueue || videoQueue.state === "ready" ? (
                <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("start")}>Start</button>
              ) : videoQueue.state === "waiting" ? (
                <div className={styles.videoQueueActions}>
                  <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("pause")}>Pause</button>
                  <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("stop")}>Stop queue</button>
                </div>
              ) : (videoQueue.state === "paused" || videoQueue.state === "blocked") && recheckableFailure ? (
                <button type="button" disabled={videoQueueBusy || referenceInspectionBusy !== null} onClick={() => void runVideoQueue("recheckAndResume")}>Recheck &amp; Resume</button>
              ) : (videoQueue.state === "paused" || videoQueue.state === "blocked") && reconcilablePreAddFailure ? (
                <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("reconcilePreAddFailure")}>Reconcile Shot 2 pre-Add failure</button>
              ) : videoQueue.state === "paused" && !videoQueue.items.some((item) => item.state === "uncertain" || item.state === "failed") ? (
                <div className={styles.videoQueueActions}>
                  <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("resume")}>Resume</button>
                  <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("stop")}>Stop queue</button>
                </div>
              ) : null}
            </div>
            {videoQueue ? (
              <>
                {videoQueueNotice ? <p role="status">{videoQueueNotice}</p> : null}
                {videoQueueError ? <p role="alert">Queue action failed: {videoQueueError}</p> : null}
                <p role="status">{videoQueue.state === "waiting" && videoQueue.nextActionAt
                  ? `${videoQueue.items.some((item) => item.state === "waiting_for_generate") ? "Waiting for Generate; next readiness check" : "Next dispatch"}: ${new Date(videoQueue.nextActionAt).toLocaleTimeString()}`
                  : videoQueue.pauseReason ? `${videoQueue.state === "blocked" ? "Blocked" : videoQueue.state === "stopped" ? "Stopped" : "Paused"}: ${videoQueue.pauseReason}`
                    : videoQueue.state === "sent" || videoQueue.state === "completed" ? "All sent; provider completion not verified" : `Queue ${videoQueue.state}`}</p>
                <p>{videoQueue.items.filter((item) => item.state === "sent" || item.state === "awaiting_completion" || item.state === "awaiting_verification" || item.state === "completed").length}/{videoQueue.items.length} shots sent. “All sent” does not mean all videos completed.</p>
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
                          <button type="button" disabled={referenceInspectionBusy !== null} onClick={() => void inspectReferenceBytes(item.itemId)}>
                            {referenceInspectionBusy === item.itemId ? "Inspecting reference bytes…" : "Inspect reference bytes"}
                          </button>
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
              </>
            ) : null}
            {videoQueueError ? <p role="alert">Queue action failed: {videoQueueError}</p> : null}
          </section>
        ) : null}
        {preparedBatch.items.map((item) => (
          <PreparedItemCard
            key={item.itemId}
            item={item}
            preparedBatchId={preparedBatch.id}
            eligible={preparedBatch.destination === "Flow"}
            persistenceClient={persistenceClient}
            queueManaged={preparedBatch.destination === "Flow"}
          />
        ))}
      </div>
    </section>
  );
}

function PreparedItemCard({
  item,
  preparedBatchId,
  eligible,
  persistenceClient,
  queueManaged,
}: {
  item: PreparedVideoBatchRecord["items"][number];
  preparedBatchId: string;
  eligible: boolean;
  persistenceClient: ReturnType<typeof createFoundationClient>;
  queueManaged: boolean;
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
        <pre className={styles.rawJson}>{item.rawJsonBody}</pre>
      </details>
    </article>
  );
}
