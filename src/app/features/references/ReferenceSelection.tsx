import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/Button";
import type { FoundationClient } from "../../../shared/messageClient";
import type {
  ActiveReferenceSelectionSession,
  FlowReferenceEventMessage,
  ReferenceCandidate,
} from "../../../shared/schemas";
import { FLOW_REFERENCE_EVENT_MESSAGE } from "../../../shared/schemas";
import { CONNECTION_STATE_CHANGED_MESSAGE } from "../../../shared/messages";
import type { PromptBatchSnapshot } from "../../../storage/repositories";
import styles from "../../Dashboard.module.css";
import refStyles from "./ReferenceSelection.module.css";

function PanelHeader({
  kicker,
  title,
  id,
}: {
  kicker: string;
  title: string;
  id: string;
}) {
  return (
    <div className={styles.panelHeading}>
      <div>
        <p className={styles.kicker}>{kicker}</p>
        <h2 id={id}>{title}</h2>
      </div>
    </div>
  );
}

export function ReferenceSelection({
  persistenceClient,
  workspaceId = "default",
}: {
  persistenceClient: FoundationClient;
  workspaceId?: string;
}) {
  const [batch, setBatch] = useState<PromptBatchSnapshot | null>(null);
  const [missingShotIds, setMissingShotIds] = useState(false);
  const [duplicateShotIds, setDuplicateShotIds] = useState<string[]>([]);
  const [activeSession, setActiveSession] =
    useState<ActiveReferenceSelectionSession | null>(null);
  const [candidates, setCandidates] = useState<
    Record<string, ReferenceCandidate>
  >({});
  const [flowVerified, setFlowVerified] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const checkFlowConnection = useCallback(async () => {
    try {
      const selected = await persistenceClient.request(
        "connections.getSelection",
        { provider: "Flow" },
      );
      if (
        selected &&
        typeof selected === "object" &&
        "verification" in selected &&
        selected.verification === "verified" &&
        "connectionState" in selected &&
        selected.connectionState === "verified"
      ) {
        setFlowVerified(true);
      } else {
        setFlowVerified(false);
      }
    } catch {
      setFlowVerified(false);
    }
  }, [persistenceClient]);

  const loadBatchAndState = useCallback(async () => {
    try {
      const batchData = (await persistenceClient.request("promptBatch.get", {
        workspaceId,
        kind: "image",
      })) as PromptBatchSnapshot | undefined;

      if (!batchData || !batchData.items || batchData.items.length === 0) {
        setBatch(null);
        setMissingShotIds(false);
        setDuplicateShotIds([]);
        return;
      }

      setBatch(batchData);

      const hasMissing = batchData.items.some((item) => !item.shotId);
      setMissingShotIds(hasMissing);

      const shotCounts = new Map<string, number>();
      for (const item of batchData.items) {
        if (item.shotId) {
          shotCounts.set(item.shotId, (shotCounts.get(item.shotId) ?? 0) + 1);
        }
      }
      const duplicates = Array.from(shotCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([id]) => id);
      setDuplicateShotIds(duplicates);
    } catch {
      setBatch(null);
      setMissingShotIds(false);
      setDuplicateShotIds([]);
    }

    try {
      const stateData = (await persistenceClient.request(
        "flow.reference.getState",
        { workspaceId },
      )) as {
        activeSession: ActiveReferenceSelectionSession | null;
        candidates: Record<string, ReferenceCandidate>;
      };
      if (stateData) {
        setActiveSession(stateData.activeSession ?? null);
        setCandidates(stateData.candidates ?? {});
      }
    } catch {
      // Ignored if worker reference handler not available yet
    }
  }, [persistenceClient, workspaceId]);

  useEffect(() => {
    void checkFlowConnection();
    void loadBatchAndState();
  }, [checkFlowConnection, loadBatchAndState]);

  // Listen to runtime broadcasts
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;

    const messageListener = (rawMsg: unknown) => {
      if (!rawMsg || typeof rawMsg !== "object" || !("type" in rawMsg)) return;

      if (rawMsg.type === CONNECTION_STATE_CHANGED_MESSAGE) {
        void checkFlowConnection();
      }

      if (rawMsg.type === FLOW_REFERENCE_EVENT_MESSAGE) {
        const eventMsg = rawMsg as FlowReferenceEventMessage;
        if (eventMsg.workspaceId !== workspaceId) return;

        if (eventMsg.event === "candidate_selected") {
          setActiveSession(null);
          setCandidates((prev) => ({
            ...prev,
            [eventMsg.shotId]: eventMsg.candidate,
          }));
          setActionError(null);
        } else if (eventMsg.event === "session_cancelled") {
          setActiveSession(null);
        } else if (eventMsg.event === "session_started") {
          void loadBatchAndState();
        } else if (eventMsg.event === "candidate_cleared") {
          setCandidates((prev) => {
            const next = { ...prev };
            delete next[eventMsg.shotId];
            return next;
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [workspaceId, checkFlowConnection, loadBatchAndState]);

  const handleStartSelection = async (shotId: string) => {
    if (!batch) return;
    setActionPending(true);
    setActionError(null);
    try {
      const res = (await persistenceClient.request(
        "flow.reference.startSelection",
        {
          workspaceId,
          batchId: batch.batch.id,
          shotId,
        },
      )) as {
        sessionId: string;
        tabId: number;
        projectId: string;
        canonicalTarget: string;
        shotId: string;
        status: string;
      };

      setActiveSession({
        sessionId: res.sessionId,
        workspaceId,
        batchId: batch.batch.id,
        sourceHash: batch.batch.id,
        shotId,
        tabId: res.tabId,
        projectId: res.projectId,
        canonicalTarget: res.canonicalTarget,
        documentId: "",
        frameId: 0,
        startedAt: Date.now(),
        status: "active",
      });
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Failed to start reference selection session.",
      );
    } finally {
      setActionPending(false);
    }
  };

  const handleCancelSelection = async () => {
    if (!activeSession) return;
    setActionPending(true);
    setActionError(null);
    try {
      await persistenceClient.request("flow.reference.cancelSelection", {
        sessionId: activeSession.sessionId,
      });
      setActiveSession(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to cancel selection.",
      );
    } finally {
      setActionPending(false);
    }
  };

  const handleClearCandidate = async (shotId: string) => {
    setActionPending(true);
    setActionError(null);
    try {
      await persistenceClient.request("flow.reference.clearCandidate", {
        workspaceId,
        shotId,
      });
      setCandidates((prev) => {
        const next = { ...prev };
        delete next[shotId];
        return next;
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to clear candidate.",
      );
    } finally {
      setActionPending(false);
    }
  };

  return (
    <div className={styles.workspaceGrid}>
      <section className={styles.panel} aria-labelledby="references-title">
        <PanelHeader
          kicker="REFERENCES"
          title="Shot references"
          id="references-title"
        />

        {!batch ? (
          <p className={styles.sourceEmpty}>
            No captured references are available. Reference capture and
            assignment are not implemented yet.
          </p>
        ) : missingShotIds || duplicateShotIds.length > 0 ? (
          <div className={refStyles.referencesContainer}>
            {missingShotIds ? (
              <div
                className={`${refStyles.noticeBox} ${refStyles.noticeWarning}`}
              >
                <strong>Ambiguous Shot Identity: Missing Shot IDs</strong>
                <p>
                  The saved image batch contains prompts without Shot IDs. All
                  prompts must have unambiguous Shot IDs to start reference
                  selection.
                </p>
              </div>
            ) : null}
            {duplicateShotIds.length > 0 ? (
              <div
                className={`${refStyles.noticeBox} ${refStyles.noticeWarning}`}
              >
                <strong>Ambiguous Shot Identity: Duplicate Shot IDs</strong>
                <p>
                  The saved image batch contains duplicate Shot IDs:{" "}
                  {duplicateShotIds.join(", ")}. Each prompt must have a unique
                  Shot ID.
                </p>
              </div>
            ) : null}
            <div className={refStyles.shotList}>
              {batch.items.map((item, index) => (
                <div key={item.id ?? index} className={refStyles.shotCard}>
                  <div className={refStyles.shotHeader}>
                    <span className={refStyles.shotBadge}>
                      {item.shotId ? `Shot ${item.shotId}` : "Missing Shot ID"}
                    </span>
                    <span className={refStyles.candidateMeta}>
                      Order {item.order + 1}
                    </span>
                  </div>
                  <p className={refStyles.promptExcerpt}>{item.rawJsonBody}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className={refStyles.referencesContainer}>
            {!flowVerified ? (
              <div
                className={`${refStyles.noticeBox} ${refStyles.noticeWarning}`}
              >
                A verified Flow project connection is required to start
                reference selection. See Connections to connect.
              </div>
            ) : null}

            {activeSession ? (
              <div
                className={`${refStyles.noticeBox} ${refStyles.noticeActive}`}
              >
                <div className={refStyles.activeHeader}>
                  <strong>
                    Selecting reference for Shot {activeSession.shotId} in Flow
                  </strong>
                  <Button
                    onClick={handleCancelSelection}
                    disabled={actionPending}
                  >
                    Cancel selection
                  </Button>
                </div>
                <p className={refStyles.candidateMeta}>
                  Target Flow project: {activeSession.projectId} (Tab{" "}
                  {activeSession.tabId}). Click an eligible gallery image in
                  Flow to choose that card as the candidate for Shot{" "}
                  {activeSession.shotId}.
                </p>
              </div>
            ) : null}

            {actionError ? (
              <p className={refStyles.noticeWarning}>{actionError}</p>
            ) : null}

            <div className={refStyles.shotList}>
              {batch.items.map((item) => {
                const shotId = item.shotId!;
                const candidate = candidates[shotId];
                const isTargetOfActiveSession =
                  activeSession?.shotId === shotId;

                return (
                  <article
                    key={item.id ?? shotId}
                    className={`${refStyles.shotCard} ${isTargetOfActiveSession ? refStyles.shotCardSelected : ""}`}
                  >
                    <div className={refStyles.shotHeader}>
                      <span className={refStyles.shotBadge}>Shot {shotId}</span>
                      <span className={refStyles.candidateMeta}>
                        Order {item.order + 1}
                      </span>
                    </div>

                    <p className={refStyles.promptExcerpt}>
                      {item.rawJsonBody}
                    </p>

                    {candidate ? (
                      <div className={refStyles.candidateDisplay}>
                        <img
                          src={candidate.sourceUrl}
                          alt={`Reference candidate for Shot ${shotId}`}
                          className={refStyles.candidateThumbnail}
                          onError={(e) => {
                            (
                              e.currentTarget as HTMLImageElement
                            ).style.display = "none";
                          }}
                        />
                        <div className={refStyles.candidateDetails}>
                          <span className={refStyles.candidateHonestStatus}>
                            Candidate selected — image capture and saving are
                            not implemented in this phase.
                          </span>
                          <span className={refStyles.candidateMeta}>
                            Dimensions:{" "}
                            {candidate.naturalWidth || candidate.displayWidth} ×{" "}
                            {candidate.naturalHeight || candidate.displayHeight}
                          </span>
                          <span className={refStyles.candidateMeta}>
                            Card tag: {candidate.cardTag}
                          </span>
                          {candidate.providerAssetId ? (
                            <span className={refStyles.candidateMeta}>
                              Provider asset ID: {candidate.providerAssetId}
                            </span>
                          ) : null}
                          <div
                            className={refStyles.cardActions}
                            style={{ marginTop: "6px" }}
                          >
                            <Button
                              onClick={() => handleStartSelection(shotId)}
                              disabled={!flowVerified || actionPending}
                            >
                              Re-select candidate
                            </Button>
                            <Button
                              onClick={() => handleClearCandidate(shotId)}
                              disabled={actionPending}
                            >
                              Clear candidate
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className={refStyles.cardActions}>
                        <span className={refStyles.candidateMeta}>
                          {isTargetOfActiveSession
                            ? "Awaiting card click in Flow..."
                            : "No reference candidate selected."}
                        </span>
                        {!isTargetOfActiveSession ? (
                          <Button
                            onClick={() => handleStartSelection(shotId)}
                            disabled={!flowVerified || actionPending}
                          >
                            Start selection
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        )}

        <div className={styles.actionRow}>
          <Button disabled aria-describedby="reference-disabled-reason">
            Confirm references
          </Button>
          <p id="reference-disabled-reason" className={styles.disabledReason}>
            Unavailable: reference image capture and saving are not implemented
            in this phase.
          </p>
        </div>
      </section>
    </div>
  );
}
