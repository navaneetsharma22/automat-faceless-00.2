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
            <strong>Provider Execution Unavailable:</strong> This video batch is
            prepared and persisted locally. No provider requests, scheduler
            alarms, prompt insertions, or generate actions were executed. Provider
            execution is not implemented in this phase (P08.3).
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
            persistenceClient={persistenceClient}
          />
        ))}
      </div>
    </section>
  );
}

function PreparedItemCard({
  item,
  persistenceClient,
}: {
  item: PreparedVideoBatchRecord["items"][number];
  persistenceClient: ReturnType<typeof createFoundationClient>;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

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

      <details className={styles.details}>
        <summary className={styles.summary}>
          Exact video prompt JSON (hash: {item.contentHash.slice(0, 12)}...)
        </summary>
        <pre className={styles.rawJson}>{item.rawJsonBody}</pre>
      </details>
    </article>
  );
}
