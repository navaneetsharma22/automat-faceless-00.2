import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Notice } from "../../components/Notice";
import type { FoundationClient } from "../../../shared/messageClient";
import type { PromptBatchSnapshot } from "../../../storage/repositories";
import { sha256Hex } from "../../../storage/repositories";
import type { ReferenceAssignmentRecord } from "../../../domain/media/references";
import {
  validateAndPairVideoShots,
  type BatchPairingResult,
  type VideoShotPair,
} from "../../../domain/batches/pairShots";
import styles from "./PairingTable.module.css";

export type PairingTableProps = {
  workspaceId?: string;
  persistenceClient: FoundationClient;
  videoBatch: PromptBatchSnapshot | null;
  videoSourceReady: boolean;
  onNavigateToReferences: () => void;
};

export function PairingTable({
  workspaceId = "default",
  persistenceClient,
  videoBatch,
  videoSourceReady,
  onNavigateToReferences,
}: PairingTableProps) {
  const [imageBatch, setImageBatch] = useState<PromptBatchSnapshot | null>(
    null,
  );
  const [imageBatchHash, setImageBatchHash] = useState<string | undefined>();
  const [selectedImageSourceId, setSelectedImageSourceId] = useState<
    string | null
  >(null);
  const [savedReferences, setSavedReferences] = useState<
    Array<Omit<ReferenceAssignmentRecord, "bytes">>
  >([]);
  const [pairingResult, setPairingResult] = useState<BatchPairingResult | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>(
    {},
  );
  const thumbnailUrlsRef = useRef<Map<string, string>>(new Map());
  const thumbnailReadGen = useRef(0);
  const dataFetchGen = useRef(0);

  // Clean up object URLs
  const revokeAllThumbnails = useCallback(() => {
    for (const url of thumbnailUrlsRef.current.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    thumbnailUrlsRef.current.clear();
    setThumbnailUrls({});
  }, []);

  useEffect(() => {
    return () => {
      revokeAllThumbnails();
    };
  }, [revokeAllThumbnails]);

  // Load saved reference thumbnails for valid pairs
  const loadThumbnails = useCallback(
    async (pairs: VideoShotPair[]) => {
      const gen = ++thumbnailReadGen.current;
      revokeAllThumbnails();

      const pairsWithRef = pairs.filter(
        (p) => p.status === "valid" && p.reference?.referenceId,
      );
      if (pairsWithRef.length === 0) return;

      let cursor = 0;
      const worker = async () => {
        while (cursor < pairsWithRef.length) {
          const pair = pairsWithRef[cursor++];
          if (!pair || !pair.reference) return;
          const { referenceId, byteSize, mimeType } = pair.reference;

          try {
            const response = (await persistenceClient.request(
              "flow.reference.getSavedReference",
              { referenceId },
            )) as {
              reference: Omit<ReferenceAssignmentRecord, "bytes">;
              data: string;
            };

            if (gen !== thumbnailReadGen.current) return;
            if (response.reference.referenceId !== referenceId) continue;

            const binary = atob(response.data);
            if (binary.length !== byteSize) continue;

            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: mimeType });
            const url = URL.createObjectURL(blob);

            if (gen !== thumbnailReadGen.current) {
              URL.revokeObjectURL(url);
              return;
            }

            thumbnailUrlsRef.current.set(referenceId, url);
            setThumbnailUrls((prev) => ({
              ...prev,
              [referenceId]: url,
            }));
          } catch {
            // thumbnail load failure is non-fatal for pairing review
          }
        }
      };

      await Promise.all([worker(), worker()]);
    },
    [persistenceClient, revokeAllThumbnails],
  );

  // Load available image batch and references
  const loadData = useCallback(async () => {
    const fetchId = ++dataFetchGen.current;
    setLoading(true);
    setError(null);

    try {
      // 1. Load image batch snapshot
      let imgSnapshot: PromptBatchSnapshot | null = null;
      try {
        const resp = (await persistenceClient.request("promptBatch.get", {
          workspaceId,
          kind: "image",
        })) as PromptBatchSnapshot;
        if (resp && resp.batch && resp.batch.id && Array.isArray(resp.items)) {
          imgSnapshot = resp;
        } else {
          imgSnapshot = null;
        }
      } catch {
        imgSnapshot = null;
      }

      if (fetchId !== dataFetchGen.current) return;
      setImageBatch(imgSnapshot);

      let imgHash: string | undefined;
      if (imgSnapshot?.batch?.sourceText) {
        imgHash = await sha256Hex(imgSnapshot.batch.sourceText);
        if (fetchId !== dataFetchGen.current) return;
        setImageBatchHash(imgHash);
      } else {
        setImageBatchHash(undefined);
      }

      // 2. Load saved references via flow.reference.getState
      let refs: Array<Omit<ReferenceAssignmentRecord, "bytes">> = [];
      try {
        const state = (await persistenceClient.request(
          "flow.reference.getState",
          { workspaceId },
        )) as {
          savedReferences?: Array<Omit<ReferenceAssignmentRecord, "bytes">>;
        };
        refs = state?.savedReferences ?? [];
      } catch {
        refs = [];
      }

      if (fetchId !== dataFetchGen.current) return;
      setSavedReferences(refs);

      // 3. Compute pairing if image source is explicitly selected
      if (selectedImageSourceId && videoBatch && videoSourceReady) {
        const result = validateAndPairVideoShots({
          workspaceId,
          videoBatch,
          imageSourceBatchId: selectedImageSourceId,
          imageSourceBatchHash: imgHash,
          referenceAssignments: refs,
        });
        setPairingResult(result);
        void loadThumbnails(result.pairs);
      } else {
        setPairingResult(null);
        revokeAllThumbnails();
      }
    } catch (err) {
      if (fetchId !== dataFetchGen.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load image reference sources or saved references.",
      );
    } finally {
      if (fetchId === dataFetchGen.current) {
        setLoading(false);
      }
    }
  }, [
    workspaceId,
    persistenceClient,
    selectedImageSourceId,
    videoBatch,
    videoSourceReady,
    loadThumbnails,
    revokeAllThumbnails,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSelectImageSource = (batchId: string) => {
    setSelectedImageSourceId(batchId);
  };

  const handleClearImageSource = () => {
    setSelectedImageSourceId(null);
    setPairingResult(null);
    revokeAllThumbnails();
  };

  // If video source is not ready (modified or not saved)
  if (!videoSourceReady || !videoBatch || videoBatch.items.length === 0) {
    return (
      <div className={styles.container}>
        <Notice kind="warning">
          Save or validate a video prompt draft to review its pairing with saved
          image references.
        </Notice>
      </div>
    );
  }

  const videoBatchId = videoBatch.batch.id;
  const videoShotCount = videoBatch.items.length;

  return (
    <div className={styles.container}>
      {error ? <Notice kind="error">{error}</Notice> : null}

      {/* 1. Explicit Image Reference Source Selection */}
      <section
        className={styles.sourceSelectionBox}
        aria-labelledby="image-source-selection-title"
      >
        <div className={styles.sourceSelectionHeader}>
          <h4
            id="image-source-selection-title"
            className={styles.sourceSelectionTitle}
          >
            Image Reference Source Selection
          </h4>
          <Button
            variant="quiet"
            size="compact"
            onClick={loadData}
            loading={loading}
            loadingLabel="Refreshing…"
          >
            Refresh Pairing
          </Button>
        </div>

        {imageBatch && imageBatch.batch ? (
          <div>
            <p className={styles.sourceDetails}>
              Available saved image source:{" "}
              <span className={styles.sourceBadge}>{imageBatch.batch.id}</span>{" "}
              ({imageBatch.items.length} items
              {imageBatchHash ? `, hash: ${imageBatchHash.slice(0, 12)}…` : ""})
            </p>
            <div
              style={{
                marginTop: "8px",
                display: "flex",
                gap: "8px",
                alignItems: "center",
              }}
            >
              {selectedImageSourceId === imageBatch.batch.id ? (
                <>
                  <span className={styles.statusValid}>
                    ✓ Selected for pairing review
                  </span>
                  <Button
                    variant="quiet"
                    size="compact"
                    onClick={handleClearImageSource}
                  >
                    Change Source
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => handleSelectImageSource(imageBatch.batch.id)}
                >
                  Pair with this Image Source
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className={styles.sourceDetails}>
            No saved image batch found in workspace &quot;{workspaceId}&quot;.
            Import and validate an image batch in Images first.
          </p>
        )}
      </section>

      {/* 2. Pairing Review Summary Bar (only when source is explicitly selected) */}
      {selectedImageSourceId && pairingResult ? (
        <>
          <div
            className={styles.summaryBar}
            role="region"
            aria-label="Pairing summary"
          >
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Saved Video Batch</span>
              <span className={styles.summaryValue} title={videoBatchId}>
                {videoShotCount} shots
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>
                Image Reference Source
              </span>
              <span
                className={styles.summaryValue}
                title={selectedImageSourceId}
              >
                {savedReferences.length} saved
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Matched Pairs</span>
              <span
                className={`${styles.summaryValue} ${styles.summaryValueSuccess}`}
              >
                {pairingResult.matchedPairCount}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Invalid Pairs</span>
              <span
                className={`${styles.summaryValue} ${
                  pairingResult.invalidPairCount > 0
                    ? styles.summaryValueDanger
                    : ""
                }`}
              >
                {pairingResult.invalidPairCount}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Unused References</span>
              <span className={styles.summaryValue}>
                {pairingResult.unusedReferenceCount}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Review Status</span>
              <span
                className={`${styles.summaryValue} ${
                  pairingResult.batchValid
                    ? styles.summaryValueSuccess
                    : styles.summaryValueDanger
                }`}
              >
                {pairingResult.batchValid ? "Valid" : "Invalid"}
              </span>
            </div>
          </div>

          {!pairingResult.batchValid ? (
            <Notice kind="error">
              {pairingResult.invalidPairCount === 1
                ? "1 video Shot cannot be paired. Resolve the issue before proceeding."
                : `${pairingResult.invalidPairCount} video Shots cannot be paired. Resolve the issues before proceeding.`}
            </Notice>
          ) : (
            <Notice kind="success">
              {`All ${pairingResult.matchedPairCount} video shots successfully paired with verified saved references.`}
            </Notice>
          )}

          {/* 3. Pairing Review Table */}
          <div className={styles.tableWrapper}>
            <table
              className={styles.table}
              aria-label="Video shot pairing review"
            >
              <thead>
                <tr>
                  <th style={{ width: "40px" }}>#</th>
                  <th style={{ width: "100px" }}>Shot ID</th>
                  <th style={{ width: "140px" }}>Saved Reference</th>
                  <th style={{ width: "140px" }}>Pair Status</th>
                  <th>Video Prompt JSON</th>
                </tr>
              </thead>
              <tbody>
                {pairingResult.pairs.map((pair) => {
                  const isValid = pair.status === "valid";
                  const refUrl = pair.reference?.referenceId
                    ? thumbnailUrls[pair.reference.referenceId]
                    : undefined;

                  return (
                    <tr
                      key={pair.itemId}
                      className={isValid ? styles.rowValid : styles.rowInvalid}
                    >
                      <td>{pair.order + 1}</td>
                      <td>
                        <span className={styles.shotBadge}>
                          Shot {pair.canonicalShotId ?? "—"}
                          {pair.declaredShotId &&
                          pair.declaredShotId !== pair.canonicalShotId ? (
                            <span className={styles.declaredShot}>
                              ({pair.declaredShotId})
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td>
                        <div className={styles.thumbnailCell}>
                          {refUrl ? (
                            <img
                              src={refUrl}
                              alt={`Saved reference for Shot ${pair.canonicalShotId}`}
                              className={styles.thumbnailImage}
                            />
                          ) : isValid ? (
                            <div className={styles.thumbnailPlaceholder}>
                              <span>Loading…</span>
                            </div>
                          ) : (
                            <div className={styles.thumbnailPlaceholder}>
                              <span>No image</span>
                            </div>
                          )}
                          {pair.reference ? (
                            <span className={styles.thumbnailMeta}>
                              {pair.reference.width}×{pair.reference.height} •{" "}
                              {Math.round(pair.reference.byteSize / 1024)}KB
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {isValid ? (
                          <span className={styles.statusValid}>Valid Pair</span>
                        ) : (
                          <div>
                            <span className={styles.statusInvalid}>
                              Invalid Pair
                            </span>
                            <p className={styles.errorMessage}>
                              {pair.issue?.message ?? "Validation failed"}
                            </p>
                          </div>
                        )}
                      </td>
                      <td>
                        <details className={styles.promptDisclosure}>
                          <summary>
                            Raw video prompt ({pair.rawJsonBody.length} chars)
                          </summary>
                          <pre className={styles.promptJsonPre}>
                            {pair.rawJsonBody}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 4. Unused References (Informational) */}
          {pairingResult.unusedReferences.length > 0 ? (
            <section
              className={styles.unusedSection}
              aria-labelledby="unused-references-title"
            >
              <h5
                id="unused-references-title"
                style={{ margin: 0, fontSize: "var(--font-size-sm)" }}
              >
                Unused Image References ({pairingResult.unusedReferences.length}
                )
              </h5>
              <p className={styles.sourceDetails} style={{ marginTop: "4px" }}>
                These references are saved in the image source but have no
                matching video shot in this batch. They remain intact in
                References and do not invalidate this video batch.
              </p>
              <div className={styles.unusedList}>
                {pairingResult.unusedReferences.map((ref) => (
                  <span key={ref.referenceId} className={styles.sourceBadge}>
                    Shot {ref.canonicalShotId} ({ref.width}×{ref.height})
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <p className={styles.sourceDetails}>
          Select the image reference source above to review Shot pairing against
          this video batch.
        </p>
      )}

      {/* 5. Link to References workspace */}
      <aside className={styles.referencesNotice}>
        <p className={styles.referencesNoticeText}>
          To select, replace, or capture reference images, use the References
          workspace.
        </p>
        <Button
          variant="secondary"
          size="compact"
          onClick={onNavigateToReferences}
        >
          Go to References
        </Button>
      </aside>
    </div>
  );
}
