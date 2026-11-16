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
import type { ReferenceAssignmentRecord } from "../../../domain/media/references";
import { sha256Hex } from "../../../domain/batches/hashPrompt";
import { CONNECTION_STATE_CHANGED_MESSAGE } from "../../../shared/messages";
import { requestProviderAccess } from "../../../platforms/shared/chromeConnectionPort";
import { flowReferenceResource } from "../../../platforms/flow/referenceResource";
import { useOptionalToast } from "../../components/ToastHost";
import type { ToastManager } from "../../components/toastManager";
import type { PromptBatchSnapshot } from "../../../storage/repositories";
import styles from "../../Dashboard.module.css";
import refStyles from "./ReferenceSelection.module.css";

const referenceSuccessToastKeys = new WeakMap<ToastManager, Set<string>>();

function notifyReferenceSuccess(
  toast: ToastManager | null,
  identity: string,
  message: string,
) {
  if (!toast) return;
  const notified = referenceSuccessToastKeys.get(toast) ?? new Set<string>();
  if (notified.has(identity)) return;
  notified.add(identity);
  referenceSuccessToastKeys.set(toast, notified);
  toast.add({
    kind: "success",
    message,
    dedupeKey: `references-success:${identity}`,
  });
}

function referenceEventIdentity(
  kind: "selected" | "saved",
  workspaceId: string,
  batchId: string,
  batchSourceHash: string,
  shotId: string,
  operationId: string,
) {
  return `${kind}:${workspaceId}:${batchId}:${batchSourceHash}:${shotId}:${operationId}`;
}

function isSavedReferenceForCapture(
  reference: Omit<ReferenceAssignmentRecord, "bytes"> | undefined,
  expected: {
    workspaceId: string;
    batchId: string;
    batchSourceHash: string;
    shotId: string;
    selectionVersion: string;
    captureOperationId: string;
  },
) {
  return Boolean(
    reference &&
      reference.workspaceId === expected.workspaceId &&
      reference.batchId === expected.batchId &&
      reference.batchSourceHash === expected.batchSourceHash &&
      reference.shotId === expected.shotId &&
      reference.selectionVersion === expected.selectionVersion &&
      reference.captureOperationId === expected.captureOperationId,
  );
}

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

export type PickerThumbnailFailureDiagnostic = {
  sourceComparison: string;
  protocol: string;
  origin: string;
  referrerPolicy: string;
  imageState: string;
  httpStatus: string;
  transferTiming: string;
  redirectTiming: string;
  contentType: string;
  cspDirective: string;
};

export function summarizePickerThumbnailFailure(input: {
  sourceUrl: string;
  referrerPolicy: string;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  responseStatus?: number;
  transferSize?: number;
  redirectStart?: number;
  redirectEnd?: number;
  cspDirective?: string;
  cspDisposition?: string;
}): PickerThumbnailFailureDiagnostic {
  let protocol = "unavailable";
  let origin = "unavailable";
  try {
    const source = new URL(input.sourceUrl);
    protocol = source.protocol.slice(0, 16);
    origin = source.origin.slice(0, 256);
  } catch {
    // Do not include the unparsed source because it may contain a signed URL.
  }
  const status = input.responseStatus;
  const transferSize = input.transferSize;
  return {
    sourceComparison:
      "Same candidate URL used for preview; final redirect target is not exposed here",
    protocol,
    origin,
    referrerPolicy: input.referrerPolicy.slice(0, 32) || "default",
    imageState: `complete=${input.complete}; natural=${Math.max(0, input.naturalWidth)}x${Math.max(0, input.naturalHeight)}`,
    httpStatus:
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? `HTTP ${status}`
        : "not exposed by Resource Timing",
    transferTiming:
      typeof transferSize === "number" && transferSize > 0
        ? `${Math.min(2_147_483_647, Math.trunc(transferSize))} bytes reported`
        : "0 or unavailable (may be cached or cross-origin redacted)",
    redirectTiming:
      (input.redirectStart ?? 0) > 0 || (input.redirectEnd ?? 0) > 0
        ? "redirect timing exposed"
        : "none or cross-origin redacted",
    contentType: "not exposed to an HTMLImageElement",
    cspDirective: input.cspDirective
      ? `${input.cspDirective.slice(0, 80)} (${(input.cspDisposition ?? "unknown").slice(0, 16)})`
      : "no matching img-src violation observed",
  };
}

export function ReferenceSelection({
  persistenceClient,
  workspaceId = "default",
}: {
  persistenceClient: FoundationClient;
  workspaceId?: string;
}) {
  const toast = useOptionalToast();
  const [batch, setBatch] = useState<PromptBatchSnapshot | null>(null);
  const [batchSourceHash, setBatchSourceHash] = useState<string | null>(null);
  const batchSourceHashRef = useRef<string | null>(null);
  const batchStateReadGeneration = useRef(0);
  const [missingShotIds, setMissingShotIds] = useState(false);
  const [duplicateShotIds, setDuplicateShotIds] = useState<string[]>([]);
  const [activeSession, setActiveSession] =
    useState<ActiveReferenceSelectionSession | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerDialogRef = useRef<HTMLDialogElement>(null);
  const pickerOpenerRef = useRef<HTMLElement | null>(null);
  const pickerScrollYRef = useRef<number | null>(null);
  const selectionGeneration = useRef(0);
  const [candidates, setCandidates] = useState<
    Record<string, ReferenceCandidate>
  >({});
  const [savedReferences, setSavedReferences] = useState<
    Record<string, Omit<ReferenceAssignmentRecord, "bytes">>
  >({});
  const [savedReferenceUrls, setSavedReferenceUrls] = useState<
    Record<string, string>
  >({});
  const savedReferenceUrlsRef = useRef(new Map<string, string>());
  const savedReferenceReadGeneration = useRef(0);
  const [captureStatus, setCaptureStatus] = useState<Record<string, string>>(
    {},
  );
  const [captureOperationIds, setCaptureOperationIds] = useState<
    Record<string, string>
  >({});
  const [mediaPermissionNeeded, setMediaPermissionNeeded] = useState<
    Record<string, boolean>
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
  const [previewPermissionNeeded, setPreviewPermissionNeeded] = useState<
    Record<string, boolean>
  >({});
  const [thumbnailDiagnostics, setThumbnailDiagnostics] = useState<
    Record<string, PickerThumbnailFailureDiagnostic>
  >({});
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [previewLoaded, setPreviewLoaded] = useState<Record<string, boolean>>(
    {},
  );
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>(
    {},
  );
  const previewRequests = useRef(
    new Map<string, { sessionId: string; previewId: string }>(),
  );
  const previewObjectUrls = useRef(new Map<string, string>());
  const previewConcurrency = useRef(new Set<string>());

  const restorePickerFocus = () => {
    const opener = pickerOpenerRef.current;
    pickerOpenerRef.current = null;
    if (opener) queueMicrotask(() => opener.focus({ preventScroll: true }));
  };

  useEffect(() => {
    const dialog = pickerDialogRef.current;
    if (!dialog) return;
    if (
      pickerOpen &&
      activeSession &&
      pickerSessionId === activeSession.sessionId
    ) {
      const previousScrollY = pickerScrollYRef.current ?? window.scrollY;
      pickerScrollYRef.current = null;
      if (!dialog.open) dialog.showModal();
      const root = document.documentElement;
      const previousRootOverflow = root.style.overflow;
      const previousRootPadding = root.style.paddingInlineEnd;
      const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
      root.style.overflow = "hidden";
      if (scrollbarWidth > 0) {
        const existingPadding = Number.parseFloat(
          getComputedStyle(root).paddingInlineEnd,
        ) || 0;
        root.style.paddingInlineEnd = `${existingPadding + scrollbarWidth}px`;
      }
      if (window.scrollY !== previousScrollY)
        window.scrollTo(0, previousScrollY);
      return () => {
        root.style.overflow = previousRootOverflow;
        root.style.paddingInlineEnd = previousRootPadding;
        if (window.scrollY !== previousScrollY)
          window.scrollTo(0, previousScrollY);
      };
    }
    if (dialog.open) dialog.close();
    if (!pickerOpen) {
      const opener = pickerOpenerRef.current;
      pickerOpenerRef.current = null;
      opener?.focus({ preventScroll: true });
    }
  }, [pickerOpen, activeSession?.sessionId, pickerSessionId]);

  const clearPreviews = useCallback(() => {
    for (const [candidateId, request] of previewRequests.current) {
      void persistenceClient
        .request("flow.reference.cancelPreview", {
          sessionId: request.sessionId,
          previewId: request.previewId,
        })
        .catch(() => undefined);
      previewRequests.current.delete(candidateId);
    }
    for (const url of previewObjectUrls.current.values())
      URL.revokeObjectURL(url);
    previewObjectUrls.current.clear();
    setPreviewUrls({});
    setPreviewLoaded({});
    setPreviewLoading({});
  }, [persistenceClient]);

  const loadSavedReferenceImages = useCallback(
    async (records: Omit<ReferenceAssignmentRecord, "bytes">[]) => {
      const generation = ++savedReferenceReadGeneration.current;
      for (const url of savedReferenceUrlsRef.current.values())
        URL.revokeObjectURL(url);
      savedReferenceUrlsRef.current.clear();
      setSavedReferenceUrls({});
      let cursor = 0;
      const worker = async () => {
        while (cursor < records.length) {
          const record = records[cursor++];
          if (!record) return;
          try {
            const response = (await persistenceClient.request(
              "flow.reference.getSavedReference",
              { referenceId: record.referenceId },
            )) as {
              reference: Omit<ReferenceAssignmentRecord, "bytes">;
              data: string;
            };
            if (
              generation !== savedReferenceReadGeneration.current ||
              response.reference.referenceId !== record.referenceId ||
              response.reference.sha256 !== record.sha256 ||
              response.data.length > Math.ceil((12 * 1024 * 1024) / 3) * 4
            )
              continue;
            const binary = atob(response.data);
            if (binary.length !== record.byteSize) continue;
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1)
              bytes[index] = binary.charCodeAt(index);
            const url = URL.createObjectURL(
              new Blob([bytes], { type: record.mimeType }),
            );
            if (generation !== savedReferenceReadGeneration.current) {
              URL.revokeObjectURL(url);
              continue;
            }
            savedReferenceUrlsRef.current.set(record.shotId, url);
            setSavedReferenceUrls((current) => ({
              ...current,
              [record.shotId]: url,
            }));
          } catch {
            if (generation === savedReferenceReadGeneration.current)
              setCaptureStatus((current) => ({
                ...current,
                [record.shotId]:
                  "Saved bytes could not be read. Refresh References to retry.",
              }));
          }
        }
      };
      await Promise.all([worker(), worker()]);
    },
    [persistenceClient],
  );
  const cspDiagnostics = useRef<
    Record<string, { directive: string; disposition: string }>
  >({});

  useEffect(() => {
    const onSecurityPolicyViolation = (event: SecurityPolicyViolationEvent) => {
      if (!event.effectiveDirective.startsWith("img-src")) return;
      let blockedOrigin = "opaque";
      try {
        blockedOrigin = new URL(event.blockedURI).origin.slice(0, 256);
      } catch {
        // Keep only a fixed category for inline, data, and unparsable values.
      }
      cspDiagnostics.current = {
        ...cspDiagnostics.current,
        [blockedOrigin]: {
          directive: event.effectiveDirective.slice(0, 80),
          disposition: event.disposition.slice(0, 16),
        },
      };
      const origins = Object.keys(cspDiagnostics.current);
      for (const oldOrigin of origins.slice(
        0,
        Math.max(0, origins.length - 8),
      )) {
        delete cspDiagnostics.current[oldOrigin];
      }
    };
    window.addEventListener(
      "securitypolicyviolation",
      onSecurityPolicyViolation,
    );
    return () =>
      window.removeEventListener(
        "securitypolicyviolation",
        onSecurityPolicyViolation,
      );
  }, []);

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
    const generation = ++batchStateReadGeneration.current;
    let batchData: PromptBatchSnapshot | undefined;
    try {
      batchData = (await persistenceClient.request("promptBatch.get", {
        workspaceId,
        kind: "image",
      })) as PromptBatchSnapshot | undefined;
    } catch {
      if (generation === batchStateReadGeneration.current) {
        setBatch(null);
        setBatchSourceHash(null);
        batchSourceHashRef.current = null;
        setCandidates({});
        setSavedReferences({});
        setSavedReferenceUrls({});
        setMissingShotIds(false);
        setDuplicateShotIds([]);
      }
      return;
    }

    if (generation !== batchStateReadGeneration.current) return;
    if (!batchData || !batchData.items || batchData.items.length === 0) {
      setBatch(null);
      setBatchSourceHash(null);
      batchSourceHashRef.current = null;
      setCandidates({});
      setSavedReferences({});
      setSavedReferenceUrls({});
      setMissingShotIds(false);
      setDuplicateShotIds([]);
      return;
    }
    const currentBatchSourceHash = await sha256Hex(batchData.batch.sourceText);
    if (generation !== batchStateReadGeneration.current) return;
    if (batchSourceHashRef.current !== currentBatchSourceHash) {
      batchSourceHashRef.current = currentBatchSourceHash;
      for (const url of savedReferenceUrlsRef.current.values()) URL.revokeObjectURL(url);
      savedReferenceUrlsRef.current.clear();
      savedReferenceReadGeneration.current += 1;
      setCandidates({});
      setSavedReferences({});
      setSavedReferenceUrls({});
      setCaptureStatus({});
      setCaptureOperationIds({});
    }
    setBatch(batchData);
    setBatchSourceHash(currentBatchSourceHash);
    setMissingShotIds(batchData.items.some((item) => !item.shotId));
    const shotCounts = new Map<string, number>();
    for (const item of batchData.items) {
      if (item.shotId) shotCounts.set(item.shotId, (shotCounts.get(item.shotId) ?? 0) + 1);
    }
    setDuplicateShotIds([...shotCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id));

    try {
      const stateData = (await persistenceClient.request(
        "flow.reference.getState",
        { workspaceId },
      )) as {
        activeSession: ActiveReferenceSelectionSession | null;
        batchId?: string | null;
        batchSourceHash?: string | null;
        candidates: Record<string, ReferenceCandidate>;
        savedReferences?: Omit<ReferenceAssignmentRecord, "bytes">[];
        captureOperations?: Array<{
          captureOperationId: string;
          shotId: string;
          status: "acquiring";
          reason?: string;
        }>;
      };
      if (generation !== batchStateReadGeneration.current) return;
      if (stateData && stateData.batchId === batchData.batch.id && stateData.batchSourceHash === currentBatchSourceHash) {
        setActiveSession(stateData.activeSession ?? null);
        setCandidates(stateData.candidates ?? {});
        const saved = stateData.savedReferences ?? [];
        setSavedReferences(
          Object.fromEntries(saved.map((record) => [record.shotId, record])),
        );
        const unfinishedCaptures = stateData.captureOperations ?? [];
        setCaptureOperationIds(
          Object.fromEntries(
            unfinishedCaptures.map((operation) => [
              operation.shotId,
              operation.captureOperationId,
            ]),
          ),
        );
        setCaptureStatus((current) => {
          const next = { ...current };
          for (const operation of unfinishedCaptures)
            next[operation.shotId] =
              "Capture is active or its outcome is uncertain. Check status or cancel this operation before another save.";
          return next;
        });
        void loadSavedReferenceImages(saved);
      } else {
        setActiveSession(null);
        setCandidates({});
        setSavedReferences({});
        setSavedReferenceUrls({});
      }
    } catch {
      // Ignored if worker reference handler not available yet
    }
  }, [persistenceClient, workspaceId, loadSavedReferenceImages]);

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
        if (eventMsg.event !== "session_cancelled" && (
          !("batchId" in eventMsg) || eventMsg.batchId !== batch?.batch.id ||
          !("batchSourceHash" in eventMsg) || eventMsg.batchSourceHash !== batchSourceHash
        )) return;

        if (eventMsg.event === "candidate_selected") {
          if (
            !activeSession ||
            eventMsg.sessionId !== activeSession.sessionId ||
            eventMsg.shotId !== activeSession.shotId ||
            eventMsg.candidate.shotId !== activeSession.shotId ||
            eventMsg.candidate.workspaceId !== workspaceId ||
            eventMsg.candidate.batchId !== batch?.batch.id ||
            eventMsg.candidate.batchSourceHash !== batchSourceHash
          ) return;
          if (eventMsg.candidate.selectionVersion) {
            notifyReferenceSuccess(
              toast,
              referenceEventIdentity(
                "selected",
                workspaceId,
                eventMsg.batchId,
                eventMsg.batchSourceHash,
                eventMsg.shotId,
                eventMsg.candidate.selectionVersion,
              ),
              `Shot ${eventMsg.shotId} reference selected`,
            );
          }
          pickerReadGeneration.current += 1;
          clearPreviews();
          setPickerCandidates([]);
          setSelectionNotice(
            `Candidate selected for Shot ${eventMsg.shotId}. Save reference to capture and keep its image bytes.`,
          );
          setActionPending(false);
          setActiveSession(null);
          setPickerOpen(false);
          restorePickerFocus();
          setCandidates((prev) => ({
            ...prev,
            [eventMsg.shotId]: eventMsg.candidate,
          }));
          setActionError(null);
        } else if (eventMsg.event === "session_cancelled") {
          if (eventMsg.sessionId !== activeSession?.sessionId) return;
          pickerReadGeneration.current += 1;
          clearPreviews();
          setPickerCandidates([]);
          setActionPending(false);
          setActiveSession(null);
        } else if (eventMsg.event === "session_started") {
          pickerReadGeneration.current += 1;
          clearPreviews();
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
        } else if (eventMsg.event === "capture_progress") {
          setCaptureOperationIds((current) => ({
            ...current,
            [eventMsg.shotId]: eventMsg.captureOperationId,
          }));
          setCaptureStatus((current) => ({
            ...current,
            [eventMsg.shotId]:
              eventMsg.stage === "capturing"
                ? "Capturing reference…"
                : "Saving reference…",
          }));
        } else if (eventMsg.event === "reference_saved") {
          notifyReferenceSuccess(
            toast,
            referenceEventIdentity(
              "saved",
              workspaceId,
              eventMsg.batchId,
              eventMsg.batchSourceHash,
              eventMsg.shotId,
              eventMsg.captureOperationId,
            ),
            `Shot ${eventMsg.shotId} reference saved`,
          );
          setCaptureStatus((current) => ({
            ...current,
            [eventMsg.shotId]: "Reference saved",
          }));
          setCaptureOperationIds((current) => {
            const next = { ...current };
            delete next[eventMsg.shotId];
            return next;
          });
          void loadBatchAndState();
        }
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [
    workspaceId,
    toast,
    batch?.batch.id,
    batchSourceHash,
    activeSession?.sessionId,
    checkFlowConnection,
    loadBatchAndState,
    clearPreviews,
    loadSavedReferenceImages,
  ]);

  useEffect(
    () => () => {
      pickerReadGeneration.current += 1;
      savedReferenceReadGeneration.current += 1;
      for (const request of previewRequests.current.values()) {
        void persistenceClient
          .request("flow.reference.cancelPreview", {
            sessionId: request.sessionId,
            previewId: request.previewId,
          })
          .catch(() => undefined);
      }
      for (const url of previewObjectUrls.current.values())
        URL.revokeObjectURL(url);
      previewObjectUrls.current.clear();
      for (const url of savedReferenceUrlsRef.current.values())
        URL.revokeObjectURL(url);
      savedReferenceUrlsRef.current.clear();
      previewRequests.current.clear();
    },
    [workspaceId, persistenceClient],
  );

  const loadFlowImageCandidates = async (sessionId: string) => {
    const generation = ++pickerReadGeneration.current;
    clearPreviews();
    setActionPending(true);
    setPickerAmbiguousCount(0);
    setPickerUnsupportedCount(0);
    setPickerStatus("Reading eligible images from the verified Flow document…");
    setPickerCandidates([]);
    setThumbnailFailures({});
    setThumbnailDiagnostics({});
    setPickerSessionId(sessionId);
    setPickerOpen(true);
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
          ? "No eligible Flow images are available in this verified document right now. Scroll Flow manually to load more, then refresh images."
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

  const handleRequestMediaPermission = async (
    sourceUrl: string,
    mediaId: string | undefined,
    key: string,
    preview = false,
  ) => {
    let permission: string;
    try {
      permission = flowReferenceResource(sourceUrl, mediaId).permission;
    } catch {
      return;
    }
    try {
      const granted = await requestProviderAccess({ origins: [permission] });
      if (granted) {
        if (preview)
          setPreviewPermissionNeeded((current) => ({
            ...current,
            [key]: false,
          }));
        else
          setMediaPermissionNeeded((current) => ({ ...current, [key]: false }));
        setPickerStatus(
          "Flow image host access granted. Retry the preview or Save reference action.",
        );
      } else {
        setPickerStatus(
          "Flow image host access was not granted. The preview remains unloaded; you can request access again from this candidate.",
        );
      }
    } catch {
      setPickerStatus(
        "Flow image host permission could not be checked or requested. Retry from this button.",
      );
    }
  };

  const handleLoadPreview = async (candidateId: string) => {
    if (
      !activeSession ||
      pickerSessionId !== activeSession.sessionId ||
      previewRequests.current.has(candidateId)
    )
      return;
    if (previewConcurrency.current.size >= 2) {
      setPickerStatus(
        "Two previews are already loading. Wait for one to finish.",
      );
      return;
    }
    const sessionId = activeSession.sessionId;
    const previewId = crypto.randomUUID();
    const generation = pickerReadGeneration.current;
    previewConcurrency.current.add(previewId);
    previewRequests.current.set(candidateId, { sessionId, previewId });
    setPreviewLoading((current) => ({ ...current, [candidateId]: true }));
    setThumbnailFailures((current) => ({ ...current, [candidateId]: false }));
    setPickerStatus(
      "Loading a bounded preview from the verified Flow document…",
    );
    try {
      const response = (await persistenceClient.request(
        "flow.reference.getPreview",
        { sessionId, candidateId, previewId },
      )) as {
        ok: boolean;
        sessionId: string;
        candidateId: string;
        previewId: string;
        mimeType: string;
        byteLength: number;
        width: number;
        height: number;
        data: string;
      };
      if (
        generation !== pickerReadGeneration.current ||
        activeSession?.sessionId !== sessionId ||
        previewRequests.current.get(candidateId)?.previewId !== previewId
      )
        return;
      if (
        !response?.ok ||
        response.sessionId !== sessionId ||
        response.candidateId !== candidateId ||
        response.previewId !== previewId ||
        response.mimeType !== "image/webp" ||
        response.byteLength < 1 ||
        response.byteLength > 96 * 1024 ||
        response.width < 1 ||
        response.width > 320 ||
        response.height < 1 ||
        response.height > 320 ||
        response.data.length > 128 * 1024
      )
        throw new Error("preview_invalid_response");
      const binary = atob(response.data);
      if (binary.length !== response.byteLength)
        throw new Error("preview_invalid_response");
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: response.mimeType }),
      );
      previewObjectUrls.current.set(candidateId, url);
      setPreviewUrls((current) => ({ ...current, [candidateId]: url }));
      setThumbnailFailures((current) => ({ ...current, [candidateId]: false }));
      setThumbnailDiagnostics((current) => ({
        ...current,
        [candidateId]: {
          sourceComparison: "Preview transported from verified Flow document",
          protocol: "https:",
          origin: "verified document origin",
          referrerPolicy: "same-origin fetch",
          imageState: `preview ${response.width}x${response.height}`,
          httpStatus: "HTTP success",
          transferTiming: `${response.byteLength} preview bytes`,
          redirectTiming: "same-origin only",
          contentType: response.mimeType,
          cspDirective: "extension-local object URL",
        },
      }));
      setPickerStatus(
        "Preview ready. Confirm the candidate against its original Flow identity before choosing.",
      );
    } catch (error) {
      if (
        generation !== pickerReadGeneration.current ||
        activeSession?.sessionId !== sessionId
      )
        return;
      const errorCode =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : error instanceof Error
            ? error.message
            : "preview_failed";
      const message = errorCode.slice(0, 140);
      setPreviewPermissionNeeded((current) => ({
        ...current,
        [candidateId]: errorCode === "reference_media_permission_needed",
      }));
      setThumbnailFailures((current) => ({ ...current, [candidateId]: true }));
      setPickerStatus(
        `Preview failed (${message}). Refresh images or try another candidate.`,
      );
    } finally {
      previewConcurrency.current.delete(previewId);
      if (previewRequests.current.get(candidateId)?.previewId === previewId)
        previewRequests.current.delete(candidateId);
      setPreviewLoading((current) => ({ ...current, [candidateId]: false }));
    }
  };

  const handleStartSelection = async (
    shotId: string,
    browse = false,
    opener?: HTMLElement,
  ) => {
    if (!batch) return;
    if (browse && opener) {
      pickerOpenerRef.current = opener;
      pickerScrollYRef.current = window.scrollY;
    }
    const currentGeneration = ++selectionGeneration.current;
    clearPreviews();
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

      if (currentGeneration !== selectionGeneration.current) return;

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
    const session = activeSession;
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
      )) as { accepted?: boolean; candidate?: ReferenceCandidate };
      if (
        generation !== pickerReadGeneration.current ||
        activeSession?.sessionId !== session.sessionId
      ) return;
      if (
        response.accepted !== true ||
        !response.candidate ||
        (response.candidate.shotId !== undefined &&
          response.candidate.shotId !== session.shotId) ||
        (response.candidate.selectionSessionId !== undefined &&
          response.candidate.selectionSessionId !== session.sessionId)
      )
        throw new Error(
          "The candidate was not accepted for this Shot. Refresh images and retry.",
        );
      if (
        batch &&
        response.candidate.selectionVersion &&
        response.candidate.workspaceId === workspaceId &&
        response.candidate.batchId === batch?.batch.id &&
        response.candidate.batchSourceHash === batchSourceHash &&
        response.candidate.shotId === session.shotId &&
        response.candidate.selectionSessionId === session.sessionId
      ) {
        notifyReferenceSuccess(
          toast,
          referenceEventIdentity(
            "selected",
            workspaceId,
            batch.batch.id,
            batchSourceHash!,
            session.shotId,
            response.candidate.selectionVersion,
          ),
          `Shot ${session.shotId} reference selected`,
        );
      }
      setSelectionNotice(
        `Candidate selected for Shot ${session.shotId}. Save reference to capture and keep image bytes.`,
      );
      setPickerCandidates([]);
      setPickerOpen(false);
      setActiveSession(null);
      restorePickerFocus();
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

  const handleSaveReference = async (shotId: string) => {
    if (!batch) return;
    const candidate = candidates[shotId];
    if (
      !candidate?.selectionVersion ||
      candidate.workspaceId !== workspaceId ||
      candidate.batchId !== batch.batch.id ||
      candidate.batchSourceHash !== batchSourceHash ||
      candidate.shotId !== shotId
    ) {
      setCaptureStatus((current) => ({
        ...current,
        [shotId]:
          "Capture failed (candidate_binding_missing). Re-select this Shot, then try Save reference again.",
      }));
      return;
    }
    const captureOperationId = crypto.randomUUID();
    setCaptureOperationIds((current) => ({
      ...current,
      [shotId]: captureOperationId,
    }));
    setCaptureStatus((current) => ({
      ...current,
      [shotId]: "Capturing reference…",
    }));
    const expectedSave = {
      workspaceId,
      batchId: batch.batch.id,
      batchSourceHash: batchSourceHash!,
      shotId,
      selectionVersion: candidate.selectionVersion,
      captureOperationId,
    };
    try {
      const result = (await persistenceClient.request(
        "flow.reference.capture",
        {
          workspaceId,
          batchId: batch.batch.id,
          shotId,
          selectionVersion: candidate.selectionVersion,
          expectedAssignmentVersion:
            savedReferences[shotId]?.assignmentVersion ?? 0,
          captureOperationId,
        },
      )) as {
        saved?: boolean;
        reference?: Omit<ReferenceAssignmentRecord, "bytes">;
      };
      if (
        result?.saved !== true ||
        !isSavedReferenceForCapture(result.reference, expectedSave)
      ) throw new Error("capture_acknowledgement_missing");
      notifyReferenceSuccess(
        toast,
        referenceEventIdentity(
          "saved",
          workspaceId,
          batch.batch.id,
          batchSourceHash!,
          shotId,
          captureOperationId,
        ),
        `Shot ${shotId} reference saved`,
      );
      setCaptureStatus((current) => ({
        ...current,
        [shotId]: "Reference saved",
      }));
      setCaptureOperationIds((current) => {
        const next = { ...current };
        delete next[shotId];
        return next;
      });
      await loadBatchAndState();
    } catch (error) {
      try {
        const status = (await persistenceClient.request(
          "flow.reference.getCaptureStatus",
          { captureOperationId },
        )) as {
          status: string;
          reason?: string;
          reference?: Omit<ReferenceAssignmentRecord, "bytes">;
        };
        if (
          status.status === "saved" &&
          isSavedReferenceForCapture(status.reference, expectedSave)
        ) {
          notifyReferenceSuccess(
            toast,
            referenceEventIdentity(
              "saved",
              workspaceId,
              batch.batch.id,
              batchSourceHash!,
              shotId,
              captureOperationId,
            ),
            `Shot ${shotId} reference saved`,
          );
          setCaptureStatus((current) => ({
            ...current,
            [shotId]: "Reference saved",
          }));
          setCaptureOperationIds((current) => {
            const next = { ...current };
            delete next[shotId];
            return next;
          });
          await loadBatchAndState();
          return;
        }
        if (status.status === "acquiring") {
          setCaptureStatus((current) => ({
            ...current,
            [shotId]:
              "Capture outcome uncertain. Check status or cancel this operation before starting another save.",
          }));
          return;
        }
        if (status.status === "cancelled" || status.status === "failed") {
          setMediaPermissionNeeded((current) => ({
            ...current,
            [shotId]: status.reason === "reference_media_permission_needed",
          }));
          setCaptureOperationIds((current) => {
            const next = { ...current };
            delete next[shotId];
            return next;
          });
          setCaptureStatus((current) => ({
            ...current,
            [shotId]: `Capture failed (${(status.reason ?? (error instanceof Error ? error.message : "capture_failed")).slice(0, 100)}). Review the Flow document and try again.`,
          }));
          return;
        }
      } catch {
        setCaptureStatus((current) => ({
          ...current,
          [shotId]:
            "Capture outcome uncertain. Refresh References and check saved state before another save.",
        }));
        return;
      }
      setCaptureOperationIds((current) => {
        const next = { ...current };
        delete next[shotId];
        return next;
      });
      const reason =
        error instanceof Error ? error.message.slice(0, 100) : "capture_failed";
      setMediaPermissionNeeded((current) => ({
        ...current,
        [shotId]: reason === "reference_media_permission_needed",
      }));
      setCaptureStatus((current) => ({
        ...current,
        [shotId]: `Capture failed (${reason}). The previous saved reference was kept.`,
      }));
    }
  };

  const handleCancelReferenceCapture = async (shotId: string) => {
    const captureOperationId = captureOperationIds[shotId];
    if (!captureOperationId) return;
    try {
      const result = (await persistenceClient.request(
        "flow.reference.cancelCapture",
        { captureOperationId },
      )) as { cancelled: boolean; status: string };
      setCaptureStatus((current) => ({
        ...current,
        [shotId]:
          result.status === "saved"
            ? "Reference saved"
            : result.cancelled
              ? "Capture cancelled. The previous saved reference was kept."
              : "Capture status is being reconciled. Check saved state before retrying.",
      }));
      if (result.status !== "acquiring")
        setCaptureOperationIds((current) => {
          const next = { ...current };
          delete next[shotId];
          return next;
        });
    } catch {
      setCaptureStatus((current) => ({
        ...current,
        [shotId]:
          "Capture cancellation could not be confirmed. Check status before starting another save.",
      }));
    }
  };

  const handleCancelSelection = async () => {
    if (!activeSession) return;
    clearPreviews();
    pickerReadGeneration.current += 1;
    setPickerCandidates([]);
    setActionPending(true);
    setActionError(null);
    try {
      await persistenceClient.request("flow.reference.cancelSelection", {
        sessionId: activeSession.sessionId,
      });
      setPickerOpen(false);
      setActiveSession(null);
      restorePickerFocus();
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
            No saved references are available. Save an accepted Flow candidate
            to capture image bytes for its Shot.
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
                      onClick={(event) => {
                        pickerOpenerRef.current = event.currentTarget;
                        pickerScrollYRef.current = window.scrollY;
                        void loadFlowImageCandidates(activeSession.sessionId);
                      }}
                      disabled={!flowVerified || actionPending}
                    >
                      Browse Flow images
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
              <dialog
                ref={pickerDialogRef}
                className={refStyles.pickerDialog}
                aria-labelledby="flow-image-picker-title"
                aria-describedby="flow-image-picker-description"
                onCancel={(event) => {
                  event.preventDefault();
                  if (!actionPending) setPickerOpen(false);
                }}
                onClose={() => {
                  setPickerOpen(false);
                  restorePickerFocus();
                }}
                onClick={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    !actionPending
                  ) setPickerOpen(false);
                }}
              >
                <div className={refStyles.pickerDialogHeader}>
                  <h2 id="flow-image-picker-title">
                    Flow images for Shot {activeSession.shotId}
                  </h2>
                  <div className={refStyles.pickerDialogActions}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={actionPending}
                      onClick={() =>
                        void loadFlowImageCandidates(activeSession.sessionId)
                      }
                    >
                      Refresh images
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={actionPending}
                      onClick={() => void handleCancelSelection()}
                    >
                      Cancel selection
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      aria-label="Close Flow image picker"
                      disabled={actionPending}
                      onClick={() => setPickerOpen(false)}
                    >
                      Close
                    </Button>
                  </div>
                </div>
                <div className={refStyles.pickerDialogScroll}>
              <section
                className={refStyles.pickerPanel}
                aria-live="polite"
              >
                <div className={refStyles.pickerHeader}>
                  <div>
                    <p
                      id="flow-image-picker-description"
                      className={refStyles.candidateMeta}
                    >
                      Candidates come from this verified Flow document. Their
                      prompt origin is unknown. Only images currently available
                      in the Flow document can be listed. Scroll Flow manually
                      to load other images, then refresh this list.
                    </p>
                  </div>
                </div>
                {pickerStatus ? (
                  <p className={refStyles.pickerStatus} role="status">
                    {pickerStatus}
                  </p>
                ) : null}
                {pickerAmbiguousCount > 0 ? (
                  <p className={refStyles.pickerWarning}>
                    {pickerAmbiguousCount} Flow card
                    {pickerAmbiguousCount === 1 ? " was" : "s were"} skipped
                    because it could not be matched to one exact image identity. No similar image was substituted.
                  </p>
                ) : null}
                {pickerUnsupportedCount > 0 ? (
                  <p className={refStyles.pickerWarning}>
                    {pickerUnsupportedCount} image source
                    {pickerUnsupportedCount === 1 ? " is" : "s are"} unavailable or unsupported in this verified document and cannot be previewed here.
                  </p>
                ) : null}
                {pickerCandidates.length > 0 ? (
                  <div className={refStyles.pickerGrid}>
                    {pickerCandidates.map((candidate) => {
                      const candidateId = candidate.candidateId;
                      const previewUrl = previewUrls[candidateId];
                      const previewFailed = Boolean(thumbnailFailures[candidateId]);
                      const previewReady = Boolean(previewLoaded[candidateId]);
                      const previewState = previewFailed
                        ? "failed"
                        : previewLoading[candidateId] || (previewUrl && !previewReady)
                          ? "loading"
                          : previewReady
                            ? "ready"
                            : "not-loaded";
                      const previewLabel = {
                        "not-loaded": "Preview not loaded",
                        loading: "Loading preview…",
                        ready: "Preview ready",
                        failed: "Preview failed",
                      }[previewState];
                      return (
                      <article
                        key={candidateId}
                        className={refStyles.pickerCard}
                      >
                        <div
                          className={refStyles.pickerThumbnailFrame}
                          data-preview-state={previewState}
                          role="group"
                          aria-label={`Shot ${activeSession.shotId} candidate: ${previewLabel}`}
                        >
                          {previewUrl && !previewFailed ? (
                            <img
                              src={previewUrl}
                              alt={`Flow image candidate preview for Shot ${activeSession.shotId}`}
                              className={refStyles.pickerThumbnail}
                              onLoad={() =>
                                setPreviewLoaded((current) => ({
                                  ...current,
                                  [candidateId]: true,
                                }))
                              }
                              onError={() => {
                                setPreviewLoaded((current) => ({
                                  ...current,
                                  [candidateId]: false,
                                }));
                                setThumbnailFailures((current) => ({
                                  ...current,
                                  [candidateId]: true,
                                }));
                                setPickerStatus(
                                  "The transferred preview could not be displayed. Refresh images before choosing.",
                                );
                              }}
                            />
                          ) : null}
                          {!previewReady ? (
                            <div
                              className={refStyles.previewPlaceholder}
                              role={previewState === "loading" ? "status" : undefined}
                              aria-live={previewState === "loading" ? "polite" : undefined}
                            >
                              {previewLabel}
                            </div>
                          ) : null}
                        </div>
                        <Button
                          onClick={() =>
                            void handleLoadPreview(candidateId)
                          }
                          disabled={
                            actionPending ||
                            !!previewLoading[candidateId] ||
                            !!previewUrl
                          }
                        >
                          {previewLoading[candidateId] || (previewUrl && !previewReady && !previewFailed)
                            ? "Loading preview…"
                            : previewReady
                              ? "Preview loaded"
                              : "Load preview"}
                        </Button>
                        {previewFailed ? (
                          <p className={refStyles.pickerWarning} role="status">
                            Thumbnail could not load. No substitute image was
                            used; refresh the picker or choose another image.
                          </p>
                        ) : null}
                        {previewPermissionNeeded[candidateId] ? (
                          <Button
                            onClick={() =>
                              void handleRequestMediaPermission(
                                candidate.sourceUrl,
                                candidate.providerAssetId,
                                candidateId,
                                true,
                              )
                            }
                          >
                            Allow Flow image host access
                          </Button>
                        ) : null}
                        {thumbnailDiagnostics[candidate.candidateId] ? (
                          <details className={refStyles.thumbnailDiagnostics}>
                            <summary>Preview diagnostics</summary>
                            <dl>
                              {Object.entries(
                                thumbnailDiagnostics[candidateId]!,
                              ).map(([label, value]) => (
                                <div key={label}>
                                  <dt>{label}</dt>
                                  <dd>{value}</dd>
                                </div>
                              ))}
                            </dl>
                          </details>
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
                            !!thumbnailFailures[candidateId] ||
                            !previewReady
                          }
                        >
                          Choose for Shot {activeSession.shotId}
                        </Button>
                      </article>
                      );
                    })}
                  </div>
                ) : null}
              </section>
                </div>
              </dialog>
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
                const savedReference = savedReferences[shotId];
                const candidateIsSaved =
                  !!candidate?.selectionVersion &&
                  candidate.selectionVersion ===
                    savedReference?.selectionVersion;
                const isTargetOfActiveSession =
                  activeSession?.shotId === shotId;
                const captureMessage = captureStatus[shotId];
                const captureUncertain = Boolean(
                  captureMessage &&
                  /(uncertain|reconcil|could not be confirmed|check status)/i.test(
                    captureMessage,
                  ),
                );
                const captureFailed = Boolean(
                  captureMessage && /\bfailed\b/i.test(captureMessage),
                );
                const captureCancelled = Boolean(
                  captureMessage && /\bcancelled\b/i.test(captureMessage),
                );
                const cardState = captureUncertain
                  ? "capture-uncertain"
                  : captureOperationIds[shotId]
                    ? "capture-pending"
                    : captureFailed
                      ? "capture-failed"
                      : captureCancelled
                        ? "capture-cancelled"
                        : captureMessage === "Reference saved"
                          ? "reference-saved"
                          : candidate && !candidateIsSaved
                            ? savedReference
                              ? "replacement-not-saved"
                              : "candidate-not-saved"
                            : savedReference
                              ? "reference-saved"
                              : "no-candidate";
                const cardStateLabel =
                  cardState === "capture-pending"
                    ? "Capture pending"
                    : cardState === "capture-uncertain"
                      ? "Capture outcome uncertain"
                      : cardState === "capture-failed"
                        ? "Capture failed"
                        : cardState === "capture-cancelled"
                          ? "Capture cancelled"
                          : cardState === "replacement-not-saved"
                            ? "Replacement selected — not saved"
                            : cardState === "candidate-not-saved"
                              ? "Candidate selected — not saved"
                              : cardState === "reference-saved"
                                ? "Reference saved"
                                : "No candidate selected";

                return (
                  <article
                    key={item.id ?? shotId}
                    className={`${refStyles.shotCard} ${isTargetOfActiveSession ? refStyles.shotCardSelected : ""}`}
                  >
                    <div className={refStyles.shotHeader}>
                      <div className={refStyles.shotIdentity}>
                        <span className={refStyles.shotBadge}>
                          Shot {shotId}
                        </span>
                        <span className={refStyles.shotOrder}>
                          Order {item.order + 1}
                        </span>
                      </div>
                      <span
                        className={refStyles.shotState}
                        data-state={cardState}
                        aria-label={`Shot ${shotId}: ${cardStateLabel}`}
                      >
                        {cardStateLabel}
                      </span>
                    </div>

                    <div className={refStyles.promptBlock}>
                      <p className={refStyles.promptLabel}>Image prompt</p>
                      <p className={refStyles.promptExcerpt}>
                        {item.rawJsonBody}
                      </p>
                      <details className={refStyles.promptDisclosure}>
                        <summary>Read complete prompt</summary>
                        <pre>{item.rawJsonBody}</pre>
                      </details>
                    </div>

                    {savedReference ? (
                      <section
                        className={`${refStyles.referencePanel} ${refStyles.savedReferencePanel}`}
                        aria-label={`Saved reference for Shot ${shotId}`}
                      >
                        <div className={refStyles.referencePreview}>
                          {savedReferenceUrls[shotId] ? (
                            <img
                              src={savedReferenceUrls[shotId]}
                              alt={`Saved reference for Shot ${shotId}`}
                              className={refStyles.candidateThumbnail}
                            />
                          ) : (
                            <span>Saved preview unavailable</span>
                          )}
                        </div>
                        <div className={refStyles.referenceContent}>
                          <div className={refStyles.referenceHeading}>
                            <strong>Currently saved reference</strong>
                            {candidate && !candidateIsSaved ? (
                              <span>Kept until replacement is saved</span>
                            ) : null}
                          </div>
                          <p className={refStyles.candidateMeta}>
                            {savedReference.width} × {savedReference.height} ·{" "}
                            {savedReference.mimeType} ·{" "}
                            {savedReference.byteSize} bytes
                          </p>
                          <details className={refStyles.technicalDetails}>
                            <summary>Saved reference details</summary>
                            <dl>
                              <div>
                                <dt>SHA-256</dt>
                                <dd> {savedReference.sha256}</dd>
                              </div>
                              <div>
                                <dt>Reference ID</dt>
                                <dd>{savedReference.referenceId}</dd>
                              </div>
                              <div>
                                <dt>Capture operation</dt>
                                <dd>{savedReference.captureOperationId}</dd>
                              </div>
                              <div>
                                <dt>Assignment</dt>
                                <dd>{savedReference.assignmentId} · v{savedReference.assignmentVersion}</dd>
                              </div>
                              {savedReference.providerAssetId ? (
                                <div>
                                  <dt>Flow asset ID</dt>
                                  <dd>{savedReference.providerAssetId}</dd>
                                </div>
                              ) : null}
                              <div>
                                <dt>Prompt SHA-256</dt>
                                <dd>{savedReference.promptHash}</dd>
                              </div>
                              <div>
                                <dt>Observed source SHA-256</dt>
                                <dd>{savedReference.observedSourceSha256}</dd>
                              </div>
                              <div>
                                <dt>Captured</dt>
                                <dd>
                                  {new Date(
                                    savedReference.capturedAt,
                                  ).toLocaleString()}
                                </dd>
                              </div>
                              <div>
                                <dt>Acquisition</dt>
                                <dd>{savedReference.acquisitionProvenance}</dd>
                              </div>
                              <div>
                                <dt>Quality</dt>
                                <dd>{savedReference.qualityProvenance}</dd>
                              </div>
                            </dl>
                          </details>
                        </div>
                      </section>
                    ) : null}

                    {candidate && !candidateIsSaved ? (
                      <section
                        className={`${refStyles.referencePanel} ${refStyles.candidatePanel}`}
                        aria-label={`Selected candidate for Shot ${shotId}`}
                      >
                        <div
                          className={refStyles.candidatePreview}
                          aria-hidden="true"
                        >
                          Candidate preview is available in Browse Flow images.
                        </div>
                        <div className={refStyles.referenceContent}>
                          <div className={refStyles.referenceHeading}>
                            <strong>Selected candidate</strong>
                            <span>Not saved</span>
                          </div>
                          <p className={refStyles.candidateNote}>
                            Candidate selection is transient. Candidate selected
                            — not saved yet. Saving captures and retains the
                            original image bytes.
                          </p>
                          <details className={refStyles.technicalDetails}>
                            <summary>Candidate details</summary>
                            <dl>
                              <div>
                                <dt>Dimensions</dt>
                                <dd>
                                  {candidate.naturalWidth ||
                                    candidate.displayWidth}{" "}
                                  ×{" "}
                                  {candidate.naturalHeight ||
                                    candidate.displayHeight}
                                </dd>
                              </div>
                              <div>
                                <dt>Flow card tag</dt>
                                <dd>{candidate.cardTag}</dd>
                              </div>
                              {candidate.providerAssetId ? (
                                <div>
                                  <dt>Flow asset ID</dt>
                                  <dd>{candidate.providerAssetId}</dd>
                                </div>
                              ) : null}
                              {candidate.selectionVersion ? (
                                <div>
                                  <dt>Selection version</dt>
                                  <dd>{candidate.selectionVersion}</dd>
                                </div>
                              ) : null}
                              {candidate.promptHash ? (
                                <div>
                                  <dt>Prompt SHA-256</dt>
                                  <dd>{candidate.promptHash}</dd>
                                </div>
                              ) : null}
                              {candidate.observedSourceSha256 ? (
                                <div>
                                  <dt>Observed source SHA-256</dt>
                                  <dd>{candidate.observedSourceSha256}</dd>
                                </div>
                              ) : null}
                              {candidate.selectionSessionId ? (
                                <div>
                                  <dt>Selection session</dt>
                                  <dd>{candidate.selectionSessionId}</dd>
                                </div>
                              ) : null}
                            </dl>
                          </details>
                        </div>
                      </section>
                    ) : null}

                    {candidate ? (
                      <div className={refStyles.shotActions}>
                        <div className={refStyles.cardActions}>
                          {!candidateIsSaved ? (
                            <Button
                              onClick={() => void handleSaveReference(shotId)}
                              disabled={
                                !candidate.selectionVersion ||
                                !!captureOperationIds[shotId]
                              }
                            >
                              Save reference
                            </Button>
                          ) : null}
                          {mediaPermissionNeeded[shotId] ? (
                            <Button
                              onClick={() =>
                                void handleRequestMediaPermission(
                                  candidate.sourceUrl,
                                  candidate.providerAssetId,
                                  shotId,
                                )
                              }
                            >
                              Allow Flow image host access
                            </Button>
                          ) : null}
                          <Button
                            onClick={(event) =>
                              void handleStartSelection(
                                shotId,
                                true,
                                event.currentTarget,
                              )
                            }
                            disabled={!flowVerified || actionPending}
                          >
                            Re-select candidate
                          </Button>
                          <Button
                            onClick={(event) =>
                              void handleStartSelection(
                                shotId,
                                true,
                                event.currentTarget,
                              )
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
                          {captureOperationIds[shotId] ? (
                            <Button
                              onClick={() =>
                                void handleCancelReferenceCapture(shotId)
                              }
                            >
                              Cancel capture
                            </Button>
                          ) : null}
                        </div>
                        {captureMessage ? (
                          <p
                            className={
                              captureFailed || captureUncertain
                                ? refStyles.captureAlert
                                : refStyles.captureStatus
                            }
                            role={
                              captureFailed || captureUncertain
                                ? "alert"
                                : "status"
                            }
                          >
                            {captureMessage}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className={refStyles.shotActions}>
                        <p className={refStyles.candidateNote}>
                          {isTargetOfActiveSession
                            ? "Selection is active. Choose an image from Flow or browse the verified images here."
                            : "No reference candidate selected."}
                        </p>
                        <div className={refStyles.cardActions}>
                          <Button
                            onClick={() => void handleStartSelection(shotId)}
                            disabled={
                              !flowVerified ||
                              actionPending ||
                              isTargetOfActiveSession
                            }
                          >
                            Start selection
                          </Button>
                          <Button
                            onClick={(event) => {
                              if (isTargetOfActiveSession && activeSession) {
                                pickerOpenerRef.current = event.currentTarget;
                                pickerScrollYRef.current = window.scrollY;
                                void loadFlowImageCandidates(
                                  activeSession.sessionId,
                                );
                              } else {
                                void handleStartSelection(
                                  shotId,
                                  true,
                                  event.currentTarget,
                                );
                              }
                            }}
                            disabled={!flowVerified || actionPending}
                          >
                            Browse Flow images
                          </Button>
                        </div>
                        {captureMessage ? (
                          <p
                            className={
                              captureFailed
                                ? refStyles.captureAlert
                                : refStyles.captureStatus
                            }
                            role={captureFailed ? "alert" : "status"}
                          >
                            {captureMessage}
                          </p>
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
            Unavailable: saved references are not yet connected to video
            handoff.
          </p>
        </div>
      </section>
    </div>
  );
}
