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
  state: "ready" | "waiting" | "paused" | "blocked" | "stopped" | "completed";
  pauseReason?: string;
  nextActionAt: number | null;
  revision: number;
  items: Array<{ itemId: string; order: number; shotId: string; state: string; reason?: string; attemptId?: string }>;
};

const RECONCILABLE_PRECLICK_RECORD = {
  preparedBatchId: "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179",
  itemId: "import:default:video:item:0",
  referenceId: "014ebcff-06e3-4ac2-b980-568f0755febf",
  updatedAt: 1793605485721,
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

  async function runVideoQueue(action: "start" | "pause" | "resume" | "stop") {
    setVideoQueueBusy(true);
    setVideoQueueError(null);
    const type = `flow.videoQueue.${action}` as const;
    const payload = action === "start"
      ? { preparedBatchId: preparedBatch.id }
      : { preparedBatchId: preparedBatch.id, expectedRevision: videoQueue?.revision ?? -1 };
    try {
      const result = await persistenceClient.request(type, payload);
      if (result) setVideoQueue(result as VideoQueueSnapshot);
    } catch (error) {
      const code = error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "queue_request_failed";
      setVideoQueueError(code);
    } finally {
      setVideoQueueBusy(false);
    }
  }

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
                <p>One start action processes paired references and prompts. Results advance only after attempt-bound verification.</p>
              </div>
              {!videoQueue || videoQueue.state === "ready" ? (
                <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("start")}>Start</button>
              ) : videoQueue.state === "waiting" ? (
                <div className={styles.videoQueueActions}>
                  <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("pause")}>Pause</button>
                  <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("stop")}>Stop queue</button>
                </div>
              ) : videoQueue.state === "paused" && videoQueue.pauseReason !== "video_result_attribution_unavailable" ? (
                <div className={styles.videoQueueActions}>
                  <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("resume")}>Resume</button>
                  <button type="button" disabled={videoQueueBusy} onClick={() => void runVideoQueue("stop")}>Stop queue</button>
                </div>
              ) : null}
            </div>
            {videoQueue ? (
              <>
                <p role="status">{videoQueue.state === "waiting" && videoQueue.nextActionAt
                  ? `Next dispatch/check: ${new Date(videoQueue.nextActionAt).toLocaleTimeString()}`
                  : videoQueue.pauseReason ? `Paused: ${videoQueue.pauseReason}` : `Queue ${videoQueue.state}`}</p>
                <p>{videoQueue.items.filter((item) => item.state === "completed").length}/{videoQueue.items.length} shots have attributable completion.</p>
                <ol aria-label="Flow video shot statuses">
                  {videoQueue.items.map((item) => (
                    <li key={item.itemId}>Shot {item.shotId}: {item.state.replaceAll("_", " ")}{item.reason ? ` — ${item.reason}` : ""}</li>
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
