import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import type { FoundationClient } from "../../../shared/messageClient";
import type {
  ActiveReferenceSelectionSession,
  FlowReferenceEventMessage,
  FlowReferencePickerCandidate,
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
  const pickerReadGeneration = useRef(0);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [pickerCandidates, setPickerCandidates] = useState<
    FlowReferencePickerCandidate[]
  >([]);
  const [pickerSessionId, setPickerSessionId] = useState<string | null>(null);
  const [pickerStatus, setPickerStatus] = useState<string | null>(null);
  const [pickerAmbiguousCount, setPickerAmbiguousCount] = useState(0);
  const [pickerUnsupportedCount, setPickerUnsupportedCount] = useState(0);
  const [thumbnailFailures, setThumbnailFailures] = useState<
    Record<string, boolean>
  >({});

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
          if (eventMsg.batchId !== batch?.batch.id) return;
          pickerReadGeneration.current += 1;
          setPickerCandidates([]);
          setSelectionNotice(
            `Candidate selected for Shot ${eventMsg.shotId}. Image capture and saving are not implemented in this phase.`,
          );
          setActionPending(false);
          setActiveSession(null);
          setCandidates((prev) => ({
            ...prev,
            [eventMsg.shotId]: eventMsg.candidate,
          }));
          setActionError(null);
        } else if (eventMsg.event === "session_cancelled") {
          if (eventMsg.sessionId !== activeSession?.sessionId) return;
          pickerReadGeneration.current += 1;
          setPickerCandidates([]);
          setActionPending(false);
          setActiveSession(null);
        } else if (eventMsg.event === "session_started") {
          pickerReadGeneration.current += 1;
          setPickerCandidates([]);
          setPickerSessionId(null);
          setPickerStatus(null);
          setActionPending(false);
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
  }, [
    workspaceId,
    batch?.batch.id,
    activeSession?.sessionId,
    checkFlowConnection,
    loadBatchAndState,
  ]);

  useEffect(
    () => () => {
      pickerReadGeneration.current += 1;
    },
    [workspaceId, persistenceClient],
  );

  const loadFlowImageCandidates = async (sessionId: string) => {
    const generation = ++pickerReadGeneration.current;
    setActionPending(true);
    setPickerAmbiguousCount(0);
    setPickerUnsupportedCount(0);
    setPickerStatus("Reading eligible images from the verified Flow document…");
    setPickerCandidates([]);
    setThumbnailFailures({});
    setPickerSessionId(sessionId);
    try {
      const result = (await persistenceClient.request(
        "flow.reference.listCandidates",
        { sessionId },
      )) as {
        sessionId: string;
        candidates: FlowReferencePickerCandidate[];
        ambiguousCount: number;
        unsupportedCount: number;
      };
      if (generation !== pickerReadGeneration.current) return;
      if (result.sessionId !== sessionId) {
        setPickerStatus(
          "The Flow selection session changed. Reopen the picker.",
        );
        return;
      }
      setPickerCandidates(result.candidates);
      setPickerAmbiguousCount(result.ambiguousCount);
      setPickerUnsupportedCount(result.unsupportedCount);
      setPickerStatus(
        result.candidates.length === 0
          ? "No unambiguous eligible Flow images are available in this document."
          : `Showing ${result.candidates.length} eligible Flow image${result.candidates.length === 1 ? "" : "s"}. Choose one for this Shot.`,
      );
    } catch (err) {
      if (generation !== pickerReadGeneration.current) return;
      setPickerStatus(
        err instanceof Error
          ? err.message
          : "Flow images could not be read. Keep the verified project open and retry.",
      );
    } finally {
      if (generation === pickerReadGeneration.current) setActionPending(false);
    }
  };

  const handleStartSelection = async (shotId: string, browse = false) => {
    if (!batch) return;
    pickerReadGeneration.current += 1;
    setSelectionNotice(null);
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
      setPickerCandidates([]);
      setPickerSessionId(null);
      setPickerStatus(null);
      if (browse) await loadFlowImageCandidates(res.sessionId);
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

  const handleChooseFlowCandidate = async (candidateId: string) => {
    if (!activeSession || pickerSessionId !== activeSession.sessionId) return;
    const generation = ++pickerReadGeneration.current;
    setActionPending(true);
    setPickerStatus("Rechecking this image in the verified Flow document…");
    try {
      const response = (await persistenceClient.request(
        "flow.reference.chooseCandidate",
        {
          sessionId: activeSession.sessionId,
          candidateId,
        },
      )) as { accepted?: boolean };
      if (generation !== pickerReadGeneration.current) return;
      if (response.accepted !== true)
        throw new Error(
          "The candidate was not accepted. Refresh images and retry.",
        );
      setSelectionNotice(
        `Candidate selected for Shot ${activeSession.shotId}. Image capture and saving are not implemented in this phase.`,
      );
      setPickerCandidates([]);
      await loadBatchAndState();
    } catch (err) {
      if (generation !== pickerReadGeneration.current) return;
      setPickerStatus(
        err instanceof Error
          ? err.message
          : "This image was not accepted. Refresh the picker and choose again.",
      );
    } finally {
      if (generation === pickerReadGeneration.current) setActionPending(false);
    }
  };

  const handleCancelSelection = async () => {
    if (!activeSession) return;
    pickerReadGeneration.current += 1;
    setPickerCandidates([]);
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
                  <div className={refStyles.cardActions}>
                    <Button
                      onClick={() =>
                        void loadFlowImageCandidates(activeSession.sessionId)
                      }
                      disabled={!flowVerified || actionPending}
                    >
                      Browse Flow images
                    </Button>
                    <Button
                      onClick={handleCancelSelection}
                      disabled={actionPending}
                    >
                      Cancel selection
                    </Button>
                  </div>
                </div>
                <p className={refStyles.candidateMeta}>
                  Target Flow project: {activeSession.projectId} (Tab{" "}
                  {activeSession.tabId}). Choose an eligible gallery image in
                  Flow or browse verified Flow images below for Shot{" "}
                  {activeSession.shotId}.
                </p>
              </div>
            ) : null}

            {activeSession && pickerSessionId === activeSession.sessionId ? (
              <section
                className={refStyles.pickerPanel}
                aria-labelledby="flow-image-picker-title"
                aria-live="polite"
              >
                <div className={refStyles.pickerHeader}>
                  <div>
                    <strong id="flow-image-picker-title">
                      Flow images for Shot {activeSession.shotId}
                    </strong>
                    <p className={refStyles.candidateMeta}>
                      Candidates come from this verified Flow document. Their
                      prompt origin is unknown. Only images currently available
                      in the Flow document can be listed. Scroll Flow manually
                      to load other images, then refresh this list.
                    </p>
                  </div>
                  <Button
                    onClick={() =>
                      void loadFlowImageCandidates(activeSession.sessionId)
                    }
                    disabled={actionPending}
                  >
                    Refresh images
                  </Button>
                </div>
                {pickerStatus ? (
                  <p className={refStyles.pickerStatus} role="status">
                    {pickerStatus}
                  </p>
                ) : null}
                {pickerAmbiguousCount > 0 ? (
                  <p className={refStyles.pickerWarning}>
                    {pickerAmbiguousCount} Flow card
                    {pickerAmbiguousCount === 1 ? " was" : "s were"} omitted
                    because its image identity was ambiguous.
                  </p>
                ) : null}
                {pickerUnsupportedCount > 0 ? (
                  <p className={refStyles.pickerWarning}>
                    {pickerUnsupportedCount} image source
                    {pickerUnsupportedCount === 1 ? " was" : "s were"} omitted
                    because the source was unavailable or unsupported.
                  </p>
                ) : null}
                {pickerCandidates.length > 0 ? (
                  <div className={refStyles.pickerGrid}>
                    {pickerCandidates.map((candidate) => (
                      <article
                        key={candidate.candidateId}
                        className={refStyles.pickerCard}
                      >
                        <img
                          src={candidate.sourceUrl}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          alt={`Flow image candidate for Shot ${activeSession.shotId}`}
                          className={refStyles.pickerThumbnail}
                          onError={() =>
                            setThumbnailFailures((previous) => ({
                              ...previous,
                              [candidate.candidateId]: true,
                            }))
                          }
                        />
                        {thumbnailFailures[candidate.candidateId] ? (
                          <p className={refStyles.pickerWarning} role="status">
                            Thumbnail could not load. No substitute image was
                            used; refresh the picker or choose another image.
                          </p>
                        ) : null}
                        <span className={refStyles.candidateMeta}>
                          {candidate.providerAssetId
                            ? `Flow asset ${candidate.providerAssetId}`
                            : "Image source observed in Flow"}
                        </span>
                        <Button
                          onClick={() =>
                            void handleChooseFlowCandidate(
                              candidate.candidateId,
                            )
                          }
                          disabled={
                            actionPending ||
                            !flowVerified ||
                            !!thumbnailFailures[candidate.candidateId]
                          }
                        >
                          Choose for Shot {activeSession.shotId}
                        </Button>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {selectionNotice ? (
              <p className={refStyles.pickerStatus} role="status">
                {selectionNotice}
              </p>
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
                          loading="lazy"
                          referrerPolicy="no-referrer"
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
                              onClick={() =>
                                void handleStartSelection(shotId, true)
                              }
                              disabled={!flowVerified || actionPending}
                            >
                              Browse Flow images
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
                          <>
                            <Button
                              onClick={() => handleStartSelection(shotId)}
                              disabled={!flowVerified || actionPending}
                            >
                              Start selection
                            </Button>
                            <Button
                              onClick={() =>
                                void handleStartSelection(shotId, true)
                              }
                              disabled={!flowVerified || actionPending}
                            >
                              Browse Flow images
                            </Button>
                          </>
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
