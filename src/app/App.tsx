import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "./components/Button";
import { ConnectionStatus } from "./components/ConnectionStatus";
import controlStyles from "./components/controls.module.css";
import { Field } from "./components/Field";
import { Navigation, type Workspace } from "./components/Navigation";
import { SettingsConfirmation } from "./components/SettingsConfirmation";
import { ToastHost } from "./components/ToastHost";
import { BUILD_ID } from "../shared/buildInfo";
import type { FlowSettingsConfirmation } from "../shared/schemas";
import type { ImageSubmissionQueueRecord } from "../domain/jobs/queue";
import type { ImportedPrompt } from "../domain/batches/importBatch";
import { createFoundationClient } from "../shared/messageClient";
import { flowTabFromUrl } from "../platforms/flow/connection";
import { registerDashboardFocusResponder } from "./dashboardFocus";
import { ImageImportPanel } from "./features/image-batch/ImportPanel";
import { ImageQueueProgress } from "./features/image-batch/Progress";
import { VideoImportPanel } from "./features/video-batch/ImportPanel";
import { PairingTable } from "./features/video-batch/PairingTable";
import {
  Destination,
  isCurrentVerifiedVideoTarget,
} from "./features/video-batch/Destination";
import { SelectedTargetConnectionStore } from "./features/video-batch/selectedTargetConnectionStore";
import { PreparedBatchReview } from "./features/video-batch/PreparedBatchReview";
import { ImportPreviewSession } from "./features/shared/importPreviewSession";
import { ReferenceSelection } from "./features/references/ReferenceSelection";
import { FlowGalleryDiagnostic } from "./features/downloads/FlowGalleryDiagnostic";
import { ProviderDownloads } from "./features/downloads/Downloads";
import type { PromptBatchSnapshot } from "../storage/repositories";
import type {
  PreparedVideoBatchRecord,
  VideoDestination,
} from "../domain/batches/types";
import type { BatchPairingResult } from "../domain/batches/pairShots";
import { sha256Hex } from "../domain/batches/hashPrompt";
import styles from "./Dashboard.module.css";

function Dashboard() {
  const [workspace, setWorkspace] = useState<Workspace>("Images");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [imageImportSession] = useState(
    () => new ImportPreviewSession("image"),
  );
  const [videoImportSession] = useState(
    () => new ImportPreviewSession("video"),
  );
  const [imageSourceReady, setImageSourceReady] = useState(false);
  const [imageSavedSource, setImageSavedSource] = useState<string>();
  const [imageSavedShotIds, setImageSavedShotIds] = useState<string[]>([]);
  const [currentImageQueue, setCurrentImageQueue] =
    useState<ImageSubmissionQueueRecord>();
  const [batchClient] = useState(() =>
    createFoundationClient({
      sendMessage: (message) => {
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
          return Promise.reject(
            new Error("Extension messaging is unavailable."),
          );
        }
        return chrome.runtime.sendMessage(message);
      },
    }),
  );
  const [videoWrapLines, setVideoWrapLines] = useState(false);
  const [videoEditorExpanded, setVideoEditorExpanded] = useState(false);
  const [imageSettingsConfirmation, setImageSettingsConfirmation] =
    useState<FlowSettingsConfirmation | null>(null);
  const [imageVariantCount, setImageVariantCount] = useState("");
  const [imageConfirmationPending, setImageConfirmationPending] =
    useState(false);
  const [imageConfirmationError, setImageConfirmationError] = useState<
    string | undefined
  >();
  const [videoConfirmed, setVideoConfirmed] = useState(false);
  const [destination, setDestination] = useState<"Flow" | "Vids">("Flow");

  const updateImageSettingsConfirmation = async (
    checked: boolean,
    declaredVariantCount: string,
  ) => {
    if (!checked) {
      setImageSettingsConfirmation(null);
      setImageConfirmationError(undefined);
      return;
    }
    const parsedVariantCount = Number(declaredVariantCount);
    if (
      !Number.isInteger(parsedVariantCount) ||
      parsedVariantCount < 1 ||
      parsedVariantCount > 100
    ) {
      setImageSettingsConfirmation(null);
      setImageConfirmationError(
        "Enter the variant count you manually selected in Flow (1–100).",
      );
      return;
    }
    setImageConfirmationPending(true);
    setImageConfirmationError(undefined);
    try {
      const selected = await batchClient.request("connections.getSelection", {
        provider: "Flow",
      });
      if (
        !selected ||
        typeof selected !== "object" ||
        !("tabId" in selected) ||
        typeof selected.tabId !== "number" ||
        !("canonicalTarget" in selected) ||
        typeof selected.canonicalTarget !== "string"
      ) {
        throw new Error("Select a Flow project in Connections first.");
      }
      const target = flowTabFromUrl(
        selected.tabId,
        "",
        selected.canonicalTarget,
      );
      if (!target)
        throw new Error("The selected Flow project is no longer valid.");
      setImageSettingsConfirmation({
        confirmationId: crypto.randomUUID(),
        confirmedAt: Date.now(),
        tabId: target.id,
        projectId: target.projectId,
        canonicalTarget: target.canonicalTarget,
        declaredVariantCount: parsedVariantCount,
      });
    } catch (error) {
      setImageSettingsConfirmation(null);
      setImageConfirmationError(
        error instanceof Error
          ? error.message
          : "Flow settings confirmation could not be bound to the selected project.",
      );
    } finally {
      setImageConfirmationPending(false);
    }
  };

  const updateImageSourceReadiness = useCallback(
    (ready: boolean, savedSource?: string, shotIds: string[] = []) => {
      setImageSourceReady(ready);
      setImageSavedSource(ready ? savedSource : undefined);
      setImageSavedShotIds(ready ? shotIds : []);
      if (!ready) {
        setImageSettingsConfirmation(null);
        setImageConfirmationError(undefined);
      }
    },
    [],
  );
  const updateCurrentImageQueue = useCallback(
    (queue: ImageSubmissionQueueRecord | undefined) => {
      setCurrentImageQueue((current) =>
        current?.queueId === queue?.queueId &&
        current?.revision === queue?.revision
          ? current
          : queue,
      );
    },
    [],
  );
  const clearImageDraftIfItMatchesQueue = useCallback(
    (queue: ImageSubmissionQueueRecord) => {
      if (imageImportSession.getSnapshot().source === queue.sourceText)
        imageImportSession.clear();
    },
    [imageImportSession],
  );

  useEffect(
    () => () => {
      imageImportSession.cancel();
      videoImportSession.cancel();
    },
    [imageImportSession, videoImportSession],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime?.onMessage ||
      !chrome.tabs?.getCurrent ||
      !chrome.windows?.update
    ) {
      return;
    }
    return registerDashboardFocusResponder(chrome);
  }, []);

  return (
    <main
      className={`${styles.appShell} ${workspace === "Images" ? styles.appShellImages : ""}`}
    >
      <aside className={styles.sidebar}>
        <a
          className={styles.brand}
          href="#workspace"
          aria-label="Automat Faceless home"
        >
          <span className={styles.brandMark} aria-hidden="true">
            A
          </span>
          <span>
            <strong>Automat</strong>
            <small>FACELESS STUDIO</small>
          </span>
        </a>
        <p className={styles.navLabel}>WORKSPACE</p>
        <Navigation active={workspace} onSelect={setWorkspace} />
        <ConnectionStatus />
      </aside>

      <section
        className={`${styles.mainArea} ${workspace === "Images" ? styles.mainAreaImages : ""}`}
        id="workspace"
      >
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            <span>Studio</span>
            <span aria-hidden="true">/</span>
            <strong>{workspace}</strong>
          </div>
          <div className={styles.topActions}>
            <button
              className={`${styles.themeToggle} motion-control`}
              type="button"
              onClick={() =>
                setTheme((current) => (current === "light" ? "dark" : "light"))
              }
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            >
              <span aria-hidden="true">{theme === "light" ? "◐" : "☼"}</span>
              {theme === "light" ? "Dark" : "Light"}
            </button>
          </div>
        </header>

        <div
          className={`${styles.content} ${workspace === "Images" ? styles.contentImages : ""} motion-screen-enter`}
        >
          <div className={styles.pageHeading}>
            <div>
              <p className={styles.kicker}>CREATIVE WORKSPACE</p>
              <h1>{workspace}</h1>
              <p className={styles.lede}>{workspaceSubtitle(workspace)}</p>
            </div>
          </div>
          <div
            hidden={workspace !== "Images"}
            className={styles.imagesWorkspaceShell}
          >
            <ImagesView
              session={imageImportSession}
              persistenceClient={batchClient}
              settingsConfirmation={imageSettingsConfirmation}
              confirmationPending={imageConfirmationPending}
              confirmationError={imageConfirmationError}
              declaredVariantCount={imageVariantCount}
              setDeclaredVariantCount={(value) => {
                setImageVariantCount(value);
                setImageSettingsConfirmation(null);
                setImageConfirmationError(undefined);
              }}
              setSettingsConfirmation={updateImageSettingsConfirmation}
              sourceReady={imageSourceReady}
              savedSource={imageSavedSource}
              savedShotIds={imageSavedShotIds}
              currentQueue={currentImageQueue}
              onCurrentQueueChange={updateCurrentImageQueue}
              onQueueCleared={clearImageDraftIfItMatchesQueue}
              onSourceReadinessChange={updateImageSourceReadiness}
            />
          </div>
          {workspace === "References" ? (
            <ReferenceSelection persistenceClient={batchClient} />
          ) : null}
          <div hidden={workspace !== "Videos"}>
            <VideosView
              session={videoImportSession}
              persistenceClient={batchClient}
              wrapLines={videoWrapLines}
              setWrapLines={setVideoWrapLines}
              editorExpanded={videoEditorExpanded}
              setEditorExpanded={setVideoEditorExpanded}
              destination={destination}
              setDestination={setDestination}
              confirmed={videoConfirmed}
              setConfirmed={setVideoConfirmed}
              onNavigateToReferences={() => setWorkspace("References")}
            />
          </div>
          {workspace === "Downloads" ? <DownloadsView persistenceClient={batchClient} /> : null}
          <details className={styles.advanced}>
            <summary>
              Advanced details <span>Technical preview information</span>
            </summary>
            <div className={styles.advancedContent}>
              <p>
                Provider connections are checked against the currently selected
                project. Image GenerateOnce remains a separately guarded legacy
                action; batch queueing is unavailable.
              </p>
              <dl>
                <div>
                  <dt>Build state</dt>
                  <dd>{BUILD_ID}</dd>
                </div>
                <div>
                  <dt>Provider actions</dt>
                  <dd>Generation unavailable</dd>
                </div>
              </dl>
              <FlowGalleryDiagnostic persistenceClient={batchClient} />
            </div>
          </details>
        </div>
      </section>
    </main>
  );
}

function workspaceSubtitle(workspace: Workspace) {
  return {
    Images: "Import, validate, and save an image JSON source.",
    References: "Reference capture and assignment status.",
    Videos: "Prepare a video source and review destination requirements.",
    Downloads: "Check available generated results and downloads.",
  }[workspace];
}

function ImagesView({
  session,
  persistenceClient,
  settingsConfirmation,
  confirmationPending,
  confirmationError,
  declaredVariantCount,
  setDeclaredVariantCount,
  setSettingsConfirmation,
  sourceReady,
  savedSource,
  savedShotIds,
  currentQueue,
  onCurrentQueueChange,
  onQueueCleared,
  onSourceReadinessChange,
}: {
  session: ImportPreviewSession;
  persistenceClient: ReturnType<typeof createFoundationClient>;
  settingsConfirmation: FlowSettingsConfirmation | null;
  confirmationPending: boolean;
  confirmationError?: string;
  declaredVariantCount: string;
  setDeclaredVariantCount: (value: string) => void;
  setSettingsConfirmation: (
    value: boolean,
    declaredVariantCount: string,
  ) => void;
  sourceReady: boolean;
  savedSource?: string;
  savedShotIds: string[];
  currentQueue?: ImageSubmissionQueueRecord;
  onCurrentQueueChange: (queue: ImageSubmissionQueueRecord | undefined) => void;
  onQueueCleared: (queue: ImageSubmissionQueueRecord) => void;
  onSourceReadinessChange: (
    ready: boolean,
    savedSource?: string,
    shotIds?: string[],
  ) => void;
}) {
  const [wrapLines, setWrapLines] = useState(false);
  const [editorExpanded, setEditorExpanded] = useState(false);

  return (
    <div className={styles.workspaceGrid}>
      <section
        className={`${styles.panel} ${styles.editorPanel}`}
        aria-labelledby="image-input-title"
        tabIndex={0}
        aria-label="Image prompt import and editor"
      >
        <ImageImportPanel
          session={session}
          workspaceId="default"
          persistenceClient={persistenceClient}
          settingsConfirmation={settingsConfirmation ?? undefined}
          onSourceReadinessChange={onSourceReadinessChange}
          wrapLines={wrapLines}
          setWrapLines={setWrapLines}
          editorExpanded={editorExpanded}
          setEditorExpanded={setEditorExpanded}
        />
      </section>
      <div
        className={styles.workspaceSideColumn}
        tabIndex={0}
        aria-label="Image queue and submission panel"
      >
        <ImageQueueProgress
          workspaceId="default"
          persistenceClient={persistenceClient}
          sourceReady={sourceReady}
          savedSource={savedSource}
          savedShotIds={savedShotIds}
          onCurrentQueueChange={onCurrentQueueChange}
          onQueueCleared={onQueueCleared}
          settingsConfirmation={settingsConfirmation ?? undefined}
          settingsConfirmationPending={confirmationPending}
          settingsConfirmationError={confirmationError}
          settingsConfirmationControls={
            <>
              <SettingsConfirmation
                id="image-settings-confirm"
                provider="Flow"
                checked={settingsConfirmation !== null}
                contextLabel={`${savedShotIds.length || "current"} prompt${savedShotIds.length === 1 ? "" : "s"} in this saved batch`}
                onChange={(checked) =>
                  void setSettingsConfirmation(checked, declaredVariantCount)
                }
                disabled={confirmationPending || !sourceReady}
                error={confirmationError}
              />
              <Field
                id="image-variant-count"
                label="Flow variants selected"
                hint="Enter the count you selected manually in Flow. This records your declaration; Automat Faceless does not inspect or change Flow settings."
                required
              >
                <input
                  id="image-variant-count"
                  className={controlStyles.control}
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  value={declaredVariantCount}
                  disabled={!sourceReady || confirmationPending}
                  onChange={(event) =>
                    setDeclaredVariantCount(event.currentTarget.value)
                  }
                  aria-label="Number of Flow image variants manually selected"
                />
              </Field>
            </>
          }
        />
        <ValidatedPromptPanel
          session={session}
          savedSource={savedSource}
          currentQueue={currentQueue}
        />
      </div>
    </div>
  );
}

export function ValidatedPromptPanel({
  session,
  savedSource,
  currentQueue,
}: {
  session: ImportPreviewSession;
  savedSource?: string;
  currentQueue?: ImageSubmissionQueueRecord;
}) {
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const validated =
    snapshot.status === "success" &&
    snapshot.result !== undefined &&
    snapshot.resultRevision === snapshot.revision;
  const items = validated ? (snapshot.result?.items ?? []) : [];
  const queueItems = exactQueueItemsForPreview(
    validated ? snapshot.source : undefined,
    savedSource,
    items,
    currentQueue,
  );

  return (
    <section
      className={`${styles.panel} ${styles.sourceSummary} ${items.length ? "" : styles.sourceSummaryEmpty}`}
      aria-labelledby="image-source-summary-title"
    >
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.kicker}>SOURCE SUMMARY</p>
          <h2 id="image-source-summary-title">
            {items.length
              ? `${items.length} validated prompt${items.length === 1 ? "" : "s"}`
              : "No validated prompts"}
          </h2>
        </div>
      </div>
      {items.length ? (
        <>
          <p className={styles.sourceStatus}>
            {queueItems
              ? "Saved source · status from its exact queue snapshot"
              : "Validated preview · dispatch status requires an exact saved-source match"}
          </p>
          <ol className={styles.sourcePromptList}>
            {items.map((item, index) => (
              <li
                className={styles.sourcePrompt}
                key={`${item.shotId ?? "prompt"}:${item.sourceSpan.start}`}
              >
                <strong>{item.shotId ?? `Prompt ${index + 1}`}</strong>
                <span>
                  {queueItems
                    ? sourceItemStatus(queueItems[index]!, currentQueue!.state)
                    : "Preview"}
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className={styles.sourceEmpty}>
          Validate a source to see its prompts here. Nothing is sent to Flow.
        </p>
      )}
    </section>
  );
}

function exactQueueItemsForPreview(
  previewSource: string | undefined,
  savedSource: string | undefined,
  previewItems: readonly ImportedPrompt[],
  queue: ImageSubmissionQueueRecord | undefined,
) {
  if (
    !previewSource ||
    previewSource !== savedSource ||
    queue?.sourceText !== savedSource ||
    queue.items.length !== previewItems.length
  )
    return undefined;
  const matches = previewItems.every((item, index) => {
    const queued = queue.items[index];
    return (
      queued !== undefined &&
      queued.order === index &&
      queued.rawJsonBody === item.rawBody &&
      queued.shotId === item.shotId &&
      queued.sourceSpan.start === item.sourceSpan.start &&
      queued.sourceSpan.end === item.sourceSpan.end
    );
  });
  return matches ? queue.items : undefined;
}

function sourceItemStatus(
  item: ImageSubmissionQueueRecord["items"][number],
  queueState: ImageSubmissionQueueRecord["state"],
) {
  if (item.itemState === "pending" && queueState === "paused") return "Paused";
  if (item.itemState === "pending" && queueState === "stopped")
    return "Stopped";
  return item.itemState[0]!.toUpperCase() + item.itemState.slice(1);
}

export function VideosView({
  session,
  persistenceClient,
  wrapLines,
  setWrapLines,
  editorExpanded,
  setEditorExpanded,
  destination,
  setDestination,
  confirmed,
  setConfirmed,
  onNavigateToReferences,
}: {
  session: ImportPreviewSession;
  persistenceClient: ReturnType<typeof createFoundationClient>;
  wrapLines: boolean;
  setWrapLines: (wrap: boolean) => void;
  editorExpanded: boolean;
  setEditorExpanded: (expanded: boolean) => void;
  destination: VideoDestination;
  setDestination: (value: VideoDestination) => void;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
  onNavigateToReferences?: () => void;
}) {
  const [videoSourceReady, setVideoSourceReady] = useState(false);
  const [videoBatch, setVideoBatch] = useState<PromptBatchSnapshot | null>(
    null,
  );
  const [videoBatchHash, setVideoBatchHash] = useState<string | undefined>();
  const [declaredDuration, setDeclaredDuration] = useState("6");
  const [targetConnectionStore] = useState(
    () =>
      new SelectedTargetConnectionStore((provider) =>
        persistenceClient.request("connections.getSelection", { provider }),
      ),
  );
  const targetConnection = useSyncExternalStore(
    targetConnectionStore.subscribe,
    targetConnectionStore.getSnapshot,
    targetConnectionStore.getSnapshot,
  );
  const connectedTarget = targetConnection.target;
  const targetLoading = targetConnection.loading;
  const [pairingResult, setPairingResult] = useState<BatchPairingResult | null>(
    null,
  );
  const [imageSourceBatchId, setImageSourceBatchId] = useState<
    string | undefined
  >();
  const [imageSourceHash, setImageSourceHash] = useState<string | undefined>();
  const [preparedBatch, setPreparedBatch] =
    useState<PreparedVideoBatchRecord | null>(null);
  const [preparePending, setPreparePending] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);

  useEffect(() => {
    const onRuntimeMessage = (message: unknown) => {
      targetConnectionStore.handleRuntimeMessage(message);
    };
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage)
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
    void targetConnectionStore.selectProvider(destination);
    return () => {
      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage)
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      targetConnectionStore.cancelPendingRequests();
    };
  }, [destination, targetConnectionStore]);

  const loadPreparedBatch = useCallback(async () => {
    try {
      const result = (await persistenceClient.request(
        "videoBatch.getPrepared",
        { workspaceId: "default" },
      )) as PreparedVideoBatchRecord | null;
      setPreparedBatch(result);
    } catch {
      setPreparedBatch(null);
    }
  }, [persistenceClient]);

  useEffect(() => {
    void loadPreparedBatch();
  }, [loadPreparedBatch]);

  const handleSourceReadiness = useCallback(
    async (ready: boolean, savedSource?: string) => {
      setVideoSourceReady(ready);
      setConfirmed(false);
      if (ready && savedSource) {
        try {
          const snapshot = (await persistenceClient.request("promptBatch.get", {
            workspaceId: "default",
            kind: "video",
          })) as PromptBatchSnapshot;
          setVideoBatch(snapshot);
          if (snapshot?.batch?.sourceText) {
            setVideoBatchHash(await sha256Hex(snapshot.batch.sourceText));
          } else {
            setVideoBatchHash(undefined);
          }
        } catch {
          setVideoBatch(null);
          setVideoBatchHash(undefined);
        }
      } else {
        setVideoBatch(null);
        setVideoBatchHash(undefined);
      }
    },
    [persistenceClient, setConfirmed],
  );

  const handleSelectDestination = (dest: VideoDestination) => {
    setDestination(dest);
    setConfirmed(false);
  };

  const handleDeclaredDurationChange = (value: string) => {
    setDeclaredDuration(value);
    setConfirmed(false);
  };

  const handlePairingResultChange = useCallback(
    (
      result: BatchPairingResult | null,
      sourceId: string | undefined,
      sourceHash: string | undefined,
    ) => {
      setPairingResult((prevResult) => {
        if (
          prevResult?.matchedPairCount !== result?.matchedPairCount ||
          prevResult?.batchValid !== result?.batchValid ||
          prevResult?.pairs.some((p, i) => {
            const nextP = result?.pairs[i];
            return (
              nextP?.reference?.assignmentVersion !==
                p.reference?.assignmentVersion ||
              nextP?.reference?.referenceId !== p.reference?.referenceId
            );
          })
        ) {
          setConfirmed(false);
        }
        return result;
      });
      setImageSourceBatchId((prev) => {
        if (prev !== sourceId) setConfirmed(false);
        return sourceId;
      });
      setImageSourceHash((prev) => {
        if (prev !== sourceHash) setConfirmed(false);
        return sourceHash;
      });
    },
    [setConfirmed],
  );

  const isTargetVerified = isCurrentVerifiedVideoTarget(
    connectedTarget,
    destination,
  );

  const parsedDuration = Number(declaredDuration);
  const isDurationValid =
    declaredDuration.trim() !== "" &&
    Number.isInteger(parsedDuration) &&
    parsedDuration > 0 &&
    parsedDuration <= 3600;

  const canPrepare =
    videoSourceReady &&
    videoBatch !== null &&
    imageSourceBatchId !== undefined &&
    pairingResult?.batchValid === true &&
    isTargetVerified &&
    isDurationValid &&
    confirmed &&
    !preparePending;

  let disabledReason =
    "Local preparation only. Provider execution is unavailable in this phase (P08.3).";
  if (!videoSourceReady) {
    disabledReason = "Save and validate a video prompt batch first.";
  } else if (!imageSourceBatchId) {
    disabledReason = "Select an image source batch to pair references.";
  } else if (!pairingResult?.batchValid) {
    disabledReason = `Cannot prepare: ${pairingResult?.invalidPairCount ?? 0} invalid pairs in batch.`;
  } else if (!isTargetVerified) {
    disabledReason = `Connect and verify ${destination} in Connections before preparing.`;
  } else if (!isDurationValid) {
    disabledReason =
      "Enter a valid duration (e.g. 6 or 8 seconds) before preparing.";
  } else if (!confirmed) {
    disabledReason = `Confirm manual ${destination} settings before preparing.`;
  }

  const handlePrepareBatch = async () => {
    if (!canPrepare || !connectedTarget || !pairingResult) return;
    setPreparePending(true);
    setPrepareError(null);
    try {
      const requestId = crypto.randomUUID();
      const result = (await persistenceClient.request("videoBatch.prepare", {
        workspaceId: "default",
        requestId,
        destination,
        imageSourceBatchId,
        manualSettingsDeclaration: {
          confirmationId: crypto.randomUUID(),
          confirmedAt: Date.now(),
          destination,
          declaredDurationSeconds: parsedDuration,
          tabId: connectedTarget.tabId,
          canonicalTarget: connectedTarget.canonicalTarget,
          projectId: connectedTarget.verificationBinding?.projectId,
          documentId: connectedTarget.verificationBinding?.documentId,
        },
        expectedVideoSourceHash: videoBatchHash,
        expectedImageSourceHash: imageSourceHash,
        expectedReferenceVersions: pairingResult.pairs.map((p) => ({
          canonicalShotId: p.canonicalShotId!,
          referenceId: p.reference!.referenceId,
          assignmentVersion: p.reference!.assignmentVersion,
        })),
      })) as PreparedVideoBatchRecord;

      setPreparedBatch(result);
    } catch (err) {
      setPrepareError(
        err instanceof Error
          ? err.message
          : "Failed to prepare video batch snapshot.",
      );
    } finally {
      setPreparePending(false);
    }
  };

  const handleStartNewVidsBatch = async () => {
    if (!canPrepare || destination !== "Vids" || !connectedTarget || !pairingResult || !imageSourceBatchId || !imageSourceHash || !videoBatchHash) return;
    setPreparePending(true);
    setPrepareError(null);
    try {
      const identityHash = await sha256Hex(JSON.stringify({
        workspaceId: "default",
        destination: "Vids",
        videoSourceHash: videoBatchHash,
        imageSourceBatchId,
        imageSourceHash,
        canonicalTarget: connectedTarget.canonicalTarget,
        tabId: connectedTarget.tabId,
        projectId: connectedTarget.verificationBinding?.projectId,
        documentId: connectedTarget.verificationBinding?.documentId,
        declaredDurationSeconds: parsedDuration,
        pairs: pairingResult.pairs.map((pair) => ({
          canonicalShotId: pair.canonicalShotId,
          promptHash: pair.contentHash,
          referenceId: pair.reference?.referenceId,
          assignmentVersion: pair.reference?.assignmentVersion,
          referenceSha256: pair.reference?.sha256,
        })),
      }));
      const uuidChars = identityHash.slice(0, 32).split("");
      uuidChars[12] = "5";
      uuidChars[16] = ((Number.parseInt(uuidChars[16]!, 16) & 0x3) | 0x8).toString(16);
      const requestId = `${uuidChars.slice(0, 8).join("")}-${uuidChars.slice(8, 12).join("")}-${uuidChars.slice(12, 16).join("")}-${uuidChars.slice(16, 20).join("")}-${uuidChars.slice(20, 32).join("")}`;
      const result = (await persistenceClient.request("videoBatch.prepare", {
        workspaceId: "default",
        requestId,
        destination: "Vids",
        imageSourceBatchId,
        manualSettingsDeclaration: {
          confirmationId: crypto.randomUUID(),
          confirmedAt: Date.now(),
          destination: "Vids",
          declaredDurationSeconds: parsedDuration,
          tabId: connectedTarget.tabId,
          canonicalTarget: connectedTarget.canonicalTarget,
          projectId: connectedTarget.verificationBinding?.projectId,
          documentId: connectedTarget.verificationBinding?.documentId,
        },
        expectedVideoSourceHash: videoBatchHash,
        expectedImageSourceHash: imageSourceHash,
        expectedReferenceVersions: pairingResult.pairs.map((pair) => ({
          canonicalShotId: pair.canonicalShotId!,
          referenceId: pair.reference!.referenceId,
          assignmentVersion: pair.reference!.assignmentVersion,
        })),
      })) as PreparedVideoBatchRecord;
      setPreparedBatch(result);
    } catch (err) {
      setPrepareError(err instanceof Error ? err.message : "Failed to prepare video batch snapshot.");
    } finally {
      setPreparePending(false);
    }
  };

  return (
    <div className={styles.workspaceGrid}>
      <section
        className={`${styles.panel} ${styles.editorPanel}`}
        aria-labelledby="video-provider-title"
      >
        <PanelHeader
          kicker="VIDEO WORKSPACE"
          title={`${destination} Videos`}
          id="video-provider-title"
          prominent
          description={
            destination === "Flow"
              ? "Prepare video prompts for your verified Flow project."
              : "Prepare a Vids batch; scene insertion remains manual in Vids."
          }
        />
        <h3 className={styles.panelSectionTitle}>Video prompt import</h3>
        <VideoImportPanel
          session={session}
          workspaceId="default"
          persistenceClient={persistenceClient}
          wrapLines={wrapLines}
          setWrapLines={setWrapLines}
          editorExpanded={editorExpanded}
          setEditorExpanded={setEditorExpanded}
          onSourceReadinessChange={handleSourceReadiness}
        />
        <PairingTable
          workspaceId="default"
          persistenceClient={persistenceClient}
          videoBatch={videoBatch}
          videoSourceReady={videoSourceReady}
          onNavigateToReferences={onNavigateToReferences ?? (() => {})}
          onPairingResultChange={handlePairingResultChange}
        />
        <Destination
          destination={destination}
          onSelectDestination={handleSelectDestination}
          connectedTarget={connectedTarget}
          targetLoading={targetLoading}
          declaredDuration={declaredDuration}
          onDeclaredDurationChange={handleDeclaredDurationChange}
          confirmed={confirmed}
          onConfirmationChange={setConfirmed}
        />
        <div className={styles.actionRow}>
          <Button
            disabled={!canPrepare}
            onClick={handlePrepareBatch}
            aria-describedby="video-disabled-reason"
          >
            {preparePending ? "Preparing batch..." : "Prepare video batch"}
          </Button>
          {destination === "Vids" ? (
            <Button
              disabled={!canPrepare}
              onClick={() => void handleStartNewVidsBatch()}
              aria-describedby="video-disabled-reason"
            >
              Start new batch
            </Button>
          ) : null}
          <p id="video-disabled-reason" className={styles.disabledReason}>
            {disabledReason}
          </p>
        </div>
        {prepareError ? (
          <p className={styles.fieldError} role="alert">
            {prepareError}
          </p>
        ) : null}

        {preparedBatch ? (
          <PreparedBatchReview
            preparedBatch={preparedBatch}
            persistenceClient={persistenceClient}
            currentVideoSourceHash={videoBatchHash}
            currentImageSourceBatchId={imageSourceBatchId}
            onQueueCleared={(batch) => {
              if (session.getSnapshot().source === batch.videoSourceText)
                session.clear();
            }}
          />
        ) : null}
      </section>
    </div>
  );
}

export function DownloadsView({ persistenceClient }: {
  persistenceClient?: Parameters<typeof ProviderDownloads>[0]["client"];
} = {}) {
  return (
    <section
      className={`${styles.panel} ${styles.downloadsPanel}`}
      aria-label="Downloads workspace"
    >
      {persistenceClient ? <ProviderDownloads client={persistenceClient} /> : <>
      <article className={`${styles.downloadCard} ${styles.downloadEmpty}`}>
        <span className={styles.fileIcon} aria-hidden="true">
          —
        </span>
        <h2>No eligible downloads</h2>
        <p>Generated results and a download workflow are not available yet.</p>
      </article>
      <div className={`${styles.actionRow} ${styles.downloadActionRow}`}>
        <Button disabled aria-describedby="download-disabled-reason">
          Download selected files
        </Button>
        <p id="download-disabled-reason" className={styles.disabledReason}>
          Unavailable: no real generated results or download workflow are
          present.
        </p>
      </div>
      </>}
    </section>
  );
}
function PanelHeader({
  kicker,
  title,
  id,
  description,
  prominent = false,
}: {
  kicker: string;
  title: string;
  id: string;
  description?: string;
  prominent?: boolean;
}) {
  return (
    <div className={`${styles.panelHeading} ${prominent ? styles.providerSectionHeading : ""}`}>
      <div>
        <p className={styles.kicker}>{kicker}</p>
        <h2 id={id}>{title}</h2>
        {description ? <p className={styles.providerPanelDescription}>{description}</p> : null}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastHost maxVisible={4}>
      <Dashboard />
    </ToastHost>
  );
}
