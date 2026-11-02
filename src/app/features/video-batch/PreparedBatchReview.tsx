import { useEffect, useState } from "react";
import type { PreparedVideoBatchRecord } from "../../../domain/batches/types";
import type { createFoundationClient } from "../../../shared/messageClient";
import styles from "./PreparedBatchReview.module.css";

export type PreparedBatchReviewProps = {
  preparedBatch: PreparedVideoBatchRecord;
  persistenceClient: ReturnType<typeof createFoundationClient>;
  currentVideoSourceHash?: string;
  currentImageSourceBatchId?: string;
};

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
            Flow reference attachment is available per item. The batch remains
            prepared: no video prompt is entered and no generation is submitted.
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
        {preparedBatch.items.map((item) => (
          <PreparedItemCard
            key={item.itemId}
            item={item}
            preparedBatchId={preparedBatch.id}
            eligible={preparedBatch.destination === "Flow"}
            persistenceClient={persistenceClient}
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
}: {
  item: PreparedVideoBatchRecord["items"][number];
  preparedBatchId: string;
  eligible: boolean;
  persistenceClient: ReturnType<typeof createFoundationClient>;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState("Loading attachment status…");
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void persistenceClient.request("flow.video.getAttachmentStatus", { preparedBatchId, itemId: item.itemId }).then((result) => {
      const status = (result as { status?: string; reason?: string })?.status ?? "not_started";
      if (!cancelled) setAttachmentStatus(status === "attached" || status === "already_attached" ? "Attached and verified" : status === "uncertain" ? "Attachment delivery uncertain" : status === "blocked" ? `Blocked: ${(result as { reason?: string }).reason ?? "review required"}` : "Not attached");
    }).catch(() => { if (!cancelled) setAttachmentStatus("Status unavailable"); });
    return () => { cancelled = true; };
  }, [preparedBatchId, item.itemId, persistenceClient]);

  async function attachReference() {
    setAttaching(true);
    setAttachmentStatus("Checking Flow target and reference…");
    try {
      const result = (await persistenceClient.request("flow.video.attachReference", { preparedBatchId, itemId: item.itemId })) as { status?: string; reason?: string };
      const status = result?.status;
      setAttachmentStatus(status === "attached" ? "Attached and verified" : status === "already_attached" ? "Already attached and verified" : status === "uncertain" ? "Attachment delivery uncertain — inspect Flow before retrying" : status === "blocked" ? `Blocked: ${result?.reason ?? "preflight failed"}` : "Attachment status unavailable");
    } catch { setAttachmentStatus("Attachment delivery uncertain — inspect Flow before retrying"); }
    finally { setAttaching(false); }
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
            {item.reference.mimeType}, version {item.reference.assignmentVersion}
          </p>
        </div>
      </div>

      {eligible ? <div><button type="button" disabled={attaching || attachmentStatus.startsWith("Attached") || attachmentStatus.startsWith("Already attached")} onClick={() => void attachReference()}>{attaching ? "Attaching…" : "Attach reference"}</button><span role="status" aria-live="polite"> {attachmentStatus}</span></div> : null}

      <details className={styles.details}>
        <summary className={styles.summary}>
          Exact video prompt JSON (hash: {item.contentHash.slice(0, 12)}...)
        </summary>
        <pre className={styles.rawJson}>{item.rawJsonBody}</pre>
      </details>
    </article>
  );
}
