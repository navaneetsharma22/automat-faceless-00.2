import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { importPromptBatch } from "../../../domain/batches/importBatch";
import { sha256Hex } from "../../../domain/batches/hashPrompt";
import { INPUT_POLICY } from "../../../domain/batches/inputPolicy";
import type { PromptKind } from "../../../domain/batches/types";
import { PromptBatchSnapshotSchema } from "../../../shared/schemas";
import type { FoundationClient } from "../../../shared/messageClient";
import type { FlowSettingsConfirmation } from "../../../shared/schemas";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { JsonEditor } from "../../components/JsonEditor";
import { Notice } from "../../components/Notice";
import { useToast } from "../../components/ToastHost";
import controlStyles from "../../components/controls.module.css";
import type { ImportPreviewSession } from "./importPreviewSession";
import { readJsonSourceFile } from "./importFile";
import {
  exportSavedPromptSource,
  type SavedSourceExportDetails,
} from "./savedSourceExport";
import styles from "./ImportPanel.module.css";
import {
  flowReadinessModeFromInput,
  flowReadinessReasonLabel,
} from "./flowReadinessPresentation";

type FileReplacementConfirmation = { revision: number; file: File };

export type FlowGenerateOutcomeMessage = {
  state?: string;
  failureStage?: string;
  providerOutcome?: string;
  attemptId?: string;
  code?: string;
  message?: string;
  pressAttempted?: boolean;
  releaseAttempted?: boolean;
  activationCount?: number;
  countDecision?: Record<string, unknown>;
  storageFailure?: {
    operation?: string;
    exceptionClass?: string;
    schemaIssuePaths?: string[];
    schemaIssueCodes?: string[];
    attemptStateBeforeFailure?: string;
    failedWriteOutcome?: string;
    failureRecordPersistence?: string;
  };
};

export function formatFlowGenerateOutcome(
  result: FlowGenerateOutcomeMessage,
): string {
  const evidence = (value: boolean | undefined) =>
    value === undefined ? "unknown" : value ? "sent or uncertain" : "not sent";
  const storageDetail = result.storageFailure
    ? ` Storage operation: ${result.storageFailure.operation ?? "unavailable"}; exception: ${result.storageFailure.exceptionClass ?? "unavailable"}; schema issue codes: ${(result.storageFailure.schemaIssueCodes ?? []).join(",") || "none"}; schema issue paths: ${(result.storageFailure.schemaIssuePaths ?? []).join(",") || "none"}; attempt state before failure: ${result.storageFailure.attemptStateBeforeFailure ?? "none"}; failed write outcome: ${result.storageFailure.failedWriteOutcome ?? "unknown"}; failure record persistence: ${result.storageFailure.failureRecordPersistence ?? "unknown"}.`
    : "";
  return `Action state: ${result.state ?? "unknown"}. Failure stage: ${result.failureStage ?? "unknown"}. Code: ${result.code ?? "unavailable"}. Provider outcome: ${result.providerOutcome ?? "unknown"}. ${result.message ?? "The Generate attempt did not complete."} Activation-pair attempts: ${result.activationCount === undefined ? "unknown" : result.activationCount}. Press: ${evidence(result.pressAttempted)}; release: ${evidence(result.releaseAttempted)}.${result.attemptId ? ` Attempt ${result.attemptId}.` : ""}${storageDetail}`;
}

export function flowGenerateResponseLostOutcome(): FlowGenerateOutcomeMessage {
  return {
    state: "uncertain",
    failureStage: "dispatch",
    providerOutcome: "unknown",
    code: "response_unknown",
    message:
      "The worker response was lost or invalid. Dispatch status and provider outcome are unknown; inspect the durable attempt before continuing. This action will not retry.",
  };
}

function formatFlowReadinessStatus(result: Record<string, unknown>) {
  const eligibility = result.countModeEligibility as
    Record<string, unknown> | undefined;
  return `${String(result.message ?? "Read-only readiness check finished.")} Readiness ${String(result.status ?? "unknown")}; reason ${flowReadinessReasonLabel(result.status, result.reason)}; count mode ${String(eligibility?.mode ?? "unavailable")}; eligibility ${String(eligibility?.status ?? "unavailable")}; blocker ${String(eligibility?.detailCode ?? eligibility?.reason ?? "none")}. Full sanitized details are available to copy or download.`;
}

function formatFlowRecoveryStatus(
  attemptId: string,
  result: Record<string, unknown>,
) {
  return `Attempt ${attemptId}: recovery ${String(result.status)}; reason ${String(result.reason ?? "unavailable")}${result.detailReason ? `; detail ${String(result.detailReason)}` : ""}${result.currentCountDecisionStatus ? `; current count decision ${String(result.currentCountDecisionStatus)}` : ""}. Historical provider outcome and observations remain unchanged.`;
}

export type ImportPanelProps = {
  kind: PromptKind;
  session: ImportPreviewSession;
  legacyFlowSetup?: ReactNode;
  wrapLines: boolean;
  setWrapLines: (value: boolean) => void;
  editorExpanded: boolean;
  setEditorExpanded: (value: boolean) => void;
  workspaceId: string;
  persistenceClient: FoundationClient;
  flowSettingsConfirmed?: boolean;
  flowSettingsConfirmation?: FlowSettingsConfirmation;
};

export function ImportPanel({
  kind,
  session,
  legacyFlowSetup,
  wrapLines,
  setWrapLines,
  editorExpanded,
  setEditorExpanded,
  workspaceId,
  persistenceClient,
  flowSettingsConfirmed = false,
  flowSettingsConfirmation,
}: ImportPanelProps) {
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const toast = useToast();
  const [replacement, setReplacement] =
    useState<FileReplacementConfirmation | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [fileLoading, setFileLoading] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState<number | null>(null);
  const [persistenceStatus, setPersistenceStatus] = useState<
    "idle" | "saving" | "saved" | "save_error" | "loading" | "load_error"
  >("idle");
  const [persistenceError, setPersistenceError] = useState<
    string | undefined
  >();
  const [savedSource, setSavedSource] = useState<string | undefined>();
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [exportingSavedSource, setExportingSavedSource] = useState(false);
  const [exportError, setExportError] = useState<string | undefined>();
  const [exportDetails, setExportDetails] = useState<
    SavedSourceExportDetails | undefined
  >();
  const [flowEntryPending, setFlowEntryPending] = useState(false);
  const [flowEntryRequiresReview, setFlowEntryRequiresReview] = useState(false);
  const [flowEntryResult, setFlowEntryResult] = useState<
    | {
        outcome?: string;
        stage?: string;
        connectorReachable?: boolean;
        composer?: string;
        methodCompatible?: boolean;
        message?: string;
        expectedCodeUnits?: number;
        actualCodeUnits?: number;
        expectedSha256?: string;
        actualSha256?: string;
        immediateMatch?: boolean;
        settledMatch?: boolean;
        firstDifferenceOffset?: number;
        mismatchCategory?: string;
        inputMethod?: string;
        editorKind?: string;
        composerProfile?: string;
        textReadback?: string;
        fillVerified?: boolean;
        generationAvailable?: false;
      }
    | undefined
  >();
  const [flowGeneratePending, setFlowGeneratePending] = useState(false);
  const [flowGenerateLockConfirmationId, setFlowGenerateLockConfirmationId] =
    useState<string | undefined>();
  const [flowGenerateRequiresReview, setFlowGenerateRequiresReview] =
    useState(false);
  const [flowGenerateResult, setFlowGenerateResult] = useState<
    FlowGenerateOutcomeMessage | undefined
  >();
  const [flowCountMode, setFlowCountMode] = useState<
    "new_empty_project" | "existing_project"
  >("new_empty_project");
  const [flowStartingImageCount, setFlowStartingImageCount] = useState("");
  const [flowExistingCountConfirmed, setFlowExistingCountConfirmed] =
    useState(false);
  const [flowCountSessionId, setFlowCountSessionId] = useState(() =>
    crypto.randomUUID(),
  );
  const [flowCountDecisionReport, setFlowCountDecisionReport] = useState<
    Record<string, unknown> | undefined
  >();
  const [flowCountDecisionPending, setFlowCountDecisionPending] =
    useState(false);
  const [flowReadinessPending, setFlowReadinessPending] = useState(false);
  const [flowReadinessExportStatus, setFlowReadinessExportStatus] = useState<
    string | undefined
  >();
  const [flowReadinessResult, setFlowReadinessResult] = useState<
    Record<string, unknown> | undefined
  >();
  const [flowCountBlockerReport, setFlowCountBlockerReport] = useState<
    Record<string, unknown> | undefined
  >();
  const [flowCountRecoveryReport, setFlowCountRecoveryReport] = useState<
    Record<string, unknown> | undefined
  >();
  const [flowCountRecoveryPending, setFlowCountRecoveryPending] =
    useState(false);
  const fileRequest = useRef(0);
  const lastToastId = useRef(0);
  const label = kind === "image" ? "Image" : "Video";

  useEffect(() => {
    if (
      snapshot.validationId <= lastToastId.current ||
      snapshot.status !== "error"
    ) {
      return;
    }
    lastToastId.current = snapshot.validationId;
    toast.add({
      kind: "error",
      message: `${label} import validation failed. Review the inline details.`,
      urgent: false,
    });
  }, [label, snapshot.status, snapshot.validationId, toast]);

  const updateSource = (source: string) => {
    fileRequest.current += 1;
    setFileLoading(false);
    setFileError(undefined);
    setPersistenceError(undefined);
    setFlowEntryResult(undefined);
    setReplacement(null);
    session.setSource(source);
  };

  const loadFile = async (file: File, expectedRevision: number) => {
    const request = ++fileRequest.current;
    setFileLoading(true);
    setFileError(undefined);
    try {
      const source = await readJsonSourceFile(file);
      if (request !== fileRequest.current) return;
      if (session.getSnapshot().revision !== expectedRevision) {
        setFileError(
          "The draft changed while the file was loading. Choose the file again to replace it.",
        );
        return;
      }
      session.setSource(source);
      setFileError(undefined);
    } catch (error) {
      if (request !== fileRequest.current) return;
      setFileError(
        error instanceof Error ? error.message : "File could not be read.",
      );
    } finally {
      if (request === fileRequest.current) setFileLoading(false);
    }
  };

  const selectFile = (file: File | undefined) => {
    if (!file) return;
    fileRequest.current += 1;
    setFileError(undefined);
    if (file.size > INPUT_POLICY.maxBatchUtf8Bytes) {
      setReplacement(null);
      setFileError(
        `File is ${file.size.toLocaleString()} bytes; the total-input limit is ${INPUT_POLICY.maxBatchUtf8Bytes.toLocaleString()} bytes. The file was not read.`,
      );
      return;
    }
    if (snapshot.source.length > 0) {
      setReplacement({ file, revision: snapshot.revision });
      return;
    }
    void loadFile(file, snapshot.revision);
  };

  const confirmReplacement = () => {
    if (!replacement) return;
    if (session.getSnapshot().revision !== replacement.revision) {
      setReplacement(null);
      setFileError(
        "The draft changed after the replacement was selected. Select the file again.",
      );
      return;
    }
    const selected = replacement;
    setReplacement(null);
    void loadFile(selected.file, selected.revision);
  };

  const stale =
    snapshot.result !== undefined &&
    snapshot.resultRevision !== snapshot.revision;
  const currentItemCount = snapshot.result?.items.length ?? 0;
  const visiblePreviewIndex =
    selectedPreview !== null && selectedPreview < currentItemCount
      ? selectedPreview
      : null;
  const visiblePreview =
    visiblePreviewIndex === null
      ? undefined
      : snapshot.result?.items[visiblePreviewIndex];
  const currentValidation =
    snapshot.status === "success" &&
    snapshot.result !== undefined &&
    snapshot.resultRevision === snapshot.revision;
  const changedSinceValidation =
    snapshot.result !== undefined &&
    snapshot.resultRevision !== snapshot.revision;
  const changedSinceSave =
    savedSource !== undefined && snapshot.source !== savedSource;
  const currentSettingsConfirmationIsLocked = Boolean(
    flowSettingsConfirmation?.confirmationId &&
    flowGenerateLockConfirmationId === flowSettingsConfirmation.confirmationId,
  );
  const currentSettingsConfirmationWasRejected =
    currentSettingsConfirmationIsLocked &&
    ["attempt_already_active", "duplicate_generate_click"].includes(
      flowGenerateResult?.code ?? "",
    );
  const existingCountIsUnconfirmed =
    flowCountMode === "existing_project" &&
    (!flowExistingCountConfirmed ||
      flowStartingImageCount.trim() === "" ||
      !Number.isInteger(Number(flowStartingImageCount)) ||
      Number(flowStartingImageCount) < 0);
  const generateDisabledReason = flowGenerateRequiresReview
    ? "Inspect the durable attempt before continuing; dispatch may have occurred."
    : !currentValidation
      ? "Validate the current image source before enabling Generate once."
      : currentItemCount !== 1
        ? "Flow single-prompt action requires exactly one validated prompt."
        : savedSource !== snapshot.source
          ? "Save the current validated prompt before enabling Generate once."
          : !flowSettingsConfirmation
            ? "Confirm the manual image settings for the selected Flow project."
            : currentSettingsConfirmationIsLocked
              ? currentSettingsConfirmationWasRejected
                ? "An attempt already matches this settings confirmation. Inspect its durable status before continuing."
                : "This settings confirmation is locked pending attempt review. Inspect the current durable state before continuing."
              : flowEntryPending || flowGeneratePending
                ? "A Flow action is already in progress. Wait for its current result."
                : persistenceStatus === "saving" ||
                    persistenceStatus === "loading"
                  ? "Wait for the current saved-source operation to finish."
                  : existingCountIsUnconfirmed
                    ? "Confirm a valid starting image count for the selected project."
                    : undefined;

  const readSnapshot = (value: unknown) => {
    const parsed = PromptBatchSnapshotSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error("The extension returned an invalid saved batch.");
    }
    return parsed.data;
  };

  const saveValidatedBatch = async () => {
    const current = session.getSnapshot();
    if (
      current.status !== "success" ||
      !current.result ||
      current.resultRevision !== current.revision
    ) {
      return;
    }
    const source = current.source;
    const result = current.result;
    const revision = current.revision;
    let saveSucceeded = false;
    setPersistenceStatus("saving");
    setPersistenceError(undefined);
    try {
      const saved = readSnapshot(
        await persistenceClient.request("promptBatch.put", {
          workspaceId,
          kind,
          sourceText: source,
        }),
      );
      if (
        saved.batch.workspaceId !== workspaceId ||
        saved.batch.kind !== kind ||
        saved.batch.sourceText !== source ||
        saved.items.length !== result.items.length ||
        saved.items.some(
          (item, index) => item.rawJsonBody !== result.items[index]?.rawBody,
        )
      ) {
        throw new Error(
          "Saved prompt bodies did not match the validated source.",
        );
      }
      setSavedSource(source);
      setPersistenceStatus("saved");
      saveSucceeded = true;
    } catch (error) {
      setPersistenceStatus("save_error");
      setPersistenceError(
        error instanceof Error
          ? error.message
          : "The batch could not be saved to extension storage.",
      );
    }
    if (saveSucceeded && session.getSnapshot().revision !== revision) {
      setPersistenceError(
        "Saved the validated revision; the current draft has changed since then.",
      );
    }
  };

  const loadSavedBatch = async () => {
    const expectedRevision = session.getSnapshot().revision;
    setConfirmLoad(false);
    setPersistenceStatus("loading");
    setPersistenceError(undefined);
    try {
      const saved = readSnapshot(
        await persistenceClient.request("promptBatch.get", {
          workspaceId,
          kind,
        }),
      );
      if (
        saved.batch.workspaceId !== workspaceId ||
        saved.batch.kind !== kind ||
        saved.items.some(
          (item, index) =>
            item.order !== index ||
            item.batchId !== saved.batch.id ||
            saved.batch.orderedItemIds[index] !== item.id,
        )
      ) {
        throw new Error("The saved prompt batch did not match this workspace.");
      }
      const verifiedSource = importPromptBatch(saved.batch.sourceText, kind);
      if (
        !verifiedSource.ok ||
        verifiedSource.items.length !== saved.items.length ||
        verifiedSource.items.some(
          (item, index) =>
            item.rawBody !== saved.items[index]?.rawJsonBody ||
            item.sourceSpan.start !== saved.items[index]?.sourceSpan.start ||
            item.sourceSpan.end !== saved.items[index]?.sourceSpan.end ||
            item.shotId !== saved.items[index]?.shotId,
        )
      ) {
        throw new Error(
          "The saved prompt bodies failed exact source verification.",
        );
      }
      if (session.getSnapshot().revision !== expectedRevision) {
        throw new Error(
          "The draft changed while the saved batch was loading. It was not replaced.",
        );
      }
      setSavedSource(saved.batch.sourceText);
      setPersistenceStatus("saved");
      session.setSource(saved.batch.sourceText);
      session.validate();
    } catch (error) {
      setPersistenceStatus("load_error");
      setPersistenceError(
        error instanceof Error
          ? error.message
          : "The saved batch could not be loaded from extension storage.",
      );
    }
  };

  const requestLoadSavedBatch = () => {
    if (snapshot.source.length > 0 && snapshot.source !== savedSource) {
      setConfirmLoad(true);
      return;
    }
    void loadSavedBatch();
  };

  const exportSavedSource = async () => {
    setExportingSavedSource(true);
    setExportError(undefined);
    setExportDetails(undefined);
    try {
      const details = await exportSavedPromptSource(
        persistenceClient,
        workspaceId,
        kind,
      );
      setExportDetails(details);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "The saved source could not be exported.",
      );
    } finally {
      setExportingSavedSource(false);
    }
  };

  const fillFlowPrompt = async () => {
    const current = session.getSnapshot();
    const item = current.result?.items[0];
    if (
      kind !== "image" ||
      !flowSettingsConfirmed ||
      current.status !== "success" ||
      current.resultRevision !== current.revision ||
      current.result?.items.length !== 1 ||
      !item
    ) {
      return;
    }
    setFlowEntryPending(true);
    setFlowEntryResult(undefined);
    try {
      const rawResult = await persistenceClient.request("flow.prompt.fill", {
        workspaceId,
        promptHash: await sha256Hex(item.rawBody),
      });
      if (!rawResult || typeof rawResult !== "object") {
        throw new Error("Flow entry returned an invalid status.");
      }
      const result = rawResult as NonNullable<typeof flowEntryResult>;
      setFlowEntryResult(result);
      if (
        result.outcome === "input-uncertain" ||
        (result.outcome === "readback-mismatch" &&
          result.inputMethod !== "none")
      ) {
        setFlowEntryRequiresReview(true);
      }
    } catch (error) {
      setFlowEntryRequiresReview(true);
      setFlowEntryResult({
        outcome: "input-uncertain",
        stage:
          error &&
          typeof error === "object" &&
          "category" in error &&
          error.category === "timeout"
            ? "timeout"
            : "worker-messaging",
        message:
          error &&
          typeof error === "object" &&
          "category" in error &&
          error.category === "timeout"
            ? "The request timed out. The editor outcome is unknown; inspect Flow before taking another action."
            : "The request failed before a verified result. The editor outcome is unknown; inspect Flow before taking another action.",
        generationAvailable: false,
      });
    } finally {
      setFlowEntryPending(false);
    }
  };

  const generateFlowImageOnce = async () => {
    const current = session.getSnapshot();
    const item = current.result?.items[0];
    const confirmation = flowSettingsConfirmation;
    if (
      kind !== "image" ||
      !confirmation ||
      current.status !== "success" ||
      current.resultRevision !== current.revision ||
      current.result?.items.length !== 1 ||
      !item ||
      savedSource !== current.source ||
      flowGeneratePending ||
      flowGenerateLockConfirmationId === confirmation?.confirmationId
    ) {
      return;
    }
    setFlowGeneratePending(true);
    setFlowGenerateResult(undefined);
    try {
      const promptHash = await sha256Hex(item.rawBody);
      if (session.getSnapshot().revision !== current.revision) {
        setFlowGenerateResult({
          state: "failed-before-dispatch",
          failureStage: "preparation",
          providerOutcome: "not_started",
          code: "draft_changed_before_request",
          message:
            "The image draft changed before dispatch. No Generate action was sent.",
        });
        return;
      }
      const rawResult = await persistenceClient.request(
        "flow.image.generateOnce",
        {
          workspaceId,
          promptHash,
          settingsConfirmation: confirmation,
          countMode:
            flowCountMode === "new_empty_project"
              ? {
                  mode: "new_empty_project",
                  countSessionId: flowCountSessionId,
                  startingImageCount: 0,
                }
              : {
                  mode: "existing_project",
                  countSessionId: flowCountSessionId,
                  startingImageCount: Number(flowStartingImageCount),
                  userConfirmed: true,
                },
        },
      );
      if (!rawResult || typeof rawResult !== "object") {
        throw new Error("The Generate attempt returned an invalid status.");
      }
      const result = rawResult as NonNullable<typeof flowGenerateResult>;
      setFlowGenerateResult(result);
      setFlowCountDecisionReport(undefined);
      if (
        result.state === "dispatched" ||
        result.state === "uncertain" ||
        (result.state === "blocked" &&
          [
            "preparation_persist_failed",
            "pre_dispatch_failure_record_failed",
          ].includes(result.code ?? ""))
      ) {
        setFlowGenerateRequiresReview(true);
      } else if (
        result.code === "attempt_already_active" ||
        result.code === "duplicate_generate_click"
      ) {
        setFlowGenerateLockConfirmationId(confirmation.confirmationId);
      }
    } catch {
      setFlowGenerateRequiresReview(true);
      setFlowGenerateResult(flowGenerateResponseLostOutcome());
    } finally {
      setFlowGeneratePending(false);
    }
  };

  const checkFlowReadiness = async () => {
    if (kind !== "image" || flowReadinessPending) return;
    const countMode = flowReadinessModeFromInput({
      mode: flowCountMode,
      countSessionId: flowCountSessionId,
      startingImageCountText: flowStartingImageCount,
      userConfirmed: flowExistingCountConfirmed,
    });
    if (
      !countMode ||
      (countMode.mode === "existing_project" && !countMode.userConfirmed)
    ) {
      setFlowReadinessResult({
        status: "blocked",
        reason: "count_declaration_unconfirmed",
        message:
          "Enter a whole starting image count and confirm it before checking existing-project readiness. No provider inspection was requested.",
        selectedCountMode: {
          mode: "existing_project",
          startingImageCount: null,
          userConfirmed: false,
        },
        countModeEligibility: {
          mode: "existing_project",
          startingImageCount: null,
          userConfirmed: false,
          status: "blocked",
          reason: "count_declaration_unconfirmed",
          detailCode: "count_declaration_unconfirmed",
          inventoryComplete: false,
          providerIdentityVerified: false,
          terminalSemanticsSupported: false,
        },
        attemptsCreated: 0,
        confirmationConsumed: false,
        productionReceiptCreated: false,
      });
      return;
    }
    setFlowReadinessPending(true);
    setFlowReadinessResult(undefined);
    try {
      const report = await persistenceClient.request(
        "flow.image.checkReadiness",
        { countMode },
      );
      if (report && typeof report === "object")
        setFlowReadinessResult(report as Record<string, unknown>);
      else
        setFlowReadinessResult({
          status: "blocked",
          reason: "invalid_worker_response",
          message:
            "The extension returned an invalid readiness report. Reopen the dashboard and retry.",
        });
    } catch {
      setFlowReadinessResult({
        status: "blocked",
        reason: "readiness_request_failed",
        message:
          "The no-Generate check could not reach the extension worker. Reopen the dashboard and retry.",
      });
    } finally {
      setFlowReadinessPending(false);
    }
  };

  const inspectFlowCountBlockers = async () => {
    try {
      const report = await persistenceClient.request(
        "flow.image.inspectCountBlockers",
        {},
      );
      setFlowCountBlockerReport(
        report && typeof report === "object"
          ? (report as Record<string, unknown>)
          : {
              status: "blocked",
              reason: "invalid_worker_response",
              blockers: [],
            },
      );
    } catch {
      setFlowCountBlockerReport({
        status: "blocked",
        reason: "readback_failed",
        blockers: [],
      });
    }
  };

  const rebaselineFlowForNewPrompt = async (oldAttemptId: string) => {
    const item = snapshot.result?.items[0];
    if (
      !item ||
      kind !== "image" ||
      flowCountRecoveryPending ||
      !flowExistingCountConfirmed ||
      !Number.isInteger(Number(flowStartingImageCount))
    )
      return;
    setFlowCountRecoveryPending(true);
    try {
      const report = await persistenceClient.request(
        "flow.image.rebaselineForNewPrompt",
        {
          oldAttemptId,
          workspaceId,
          promptHash: await sha256Hex(item.rawBody),
          countSessionId: flowCountSessionId,
          startingImageCount: Number(flowStartingImageCount),
          userConfirmed: true,
        },
      );
      setFlowCountRecoveryReport(
        report && typeof report === "object"
          ? {
              ...(report as Record<string, unknown>),
              attemptId: oldAttemptId,
            }
          : {
              status: "blocked",
              reason: "invalid_worker_response",
              attemptId: oldAttemptId,
            },
      );
      try {
        const refreshedInspection = await persistenceClient.request(
          "flow.image.inspectCountBlockers",
          {},
        );
        if (refreshedInspection && typeof refreshedInspection === "object")
          setFlowCountBlockerReport(
            refreshedInspection as Record<string, unknown>,
          );
      } catch {
        // Keep the recovery result visible if a follow-up read is unavailable.
      }
    } catch {
      setFlowCountRecoveryReport({
        status: "blocked",
        reason: "recovery_request_failed",
        providerOutcome: "unknown",
        attemptId: oldAttemptId,
      });
    } finally {
      setFlowCountRecoveryPending(false);
    }
  };

  const refreshFlowCountDecision = async () => {
    const attemptId = flowGenerateResult?.attemptId;
    if (!attemptId || flowCountDecisionPending) return;
    setFlowCountDecisionPending(true);
    try {
      const report = await persistenceClient.request(
        "flow.image.getCountDecision",
        { attemptId },
      );
      setFlowCountDecisionReport(
        report && typeof report === "object"
          ? (report as Record<string, unknown>)
          : {
              status: "unavailable",
              reason: "invalid_worker_response",
              providerOutcome: "unknown",
            },
      );
    } catch {
      setFlowCountDecisionReport({
        status: "unavailable",
        reason: "readback_failed",
        providerOutcome: "unknown",
      });
    } finally {
      setFlowCountDecisionPending(false);
    }
  };

  const copyFlowReadiness = async () => {
    if (!flowReadinessResult) return;
    const sanitized = {
      diagnostic: "flow-readiness-no-generate-v1",
      status: flowReadinessResult.status ?? "unknown",
      reason: flowReadinessResult.reason ?? null,
      message: flowReadinessResult.message ?? null,
      gates: flowReadinessResult.gates ?? null,
      countModeEligibility: flowReadinessResult.countModeEligibility ?? null,
      profile: flowReadinessResult.profile ?? null,
      listenerRoots: flowReadinessResult.listenerRoots ?? null,
      listenersAttached: flowReadinessResult.listenersAttached ?? false,
      stableBaseline: flowReadinessResult.stableBaseline ?? false,
      renderedTileCount: flowReadinessResult.renderedTileCount ?? null,
      distinctCandidateCount:
        flowReadinessResult.distinctCandidateCount ?? null,
      qualifyingCandidateCount:
        flowReadinessResult.qualifyingCandidateCount ?? null,
      repeatedCandidateCount:
        flowReadinessResult.repeatedCandidateCount ?? null,
      unidentifiedImageCount:
        flowReadinessResult.unidentifiedImageCount ?? null,
      unrelatedImageCount: flowReadinessResult.unrelatedImageCount ?? null,
      virtualized: flowReadinessResult.virtualized ?? null,
      virtualScrollContainerCount:
        flowReadinessResult.virtualScrollContainerCount ?? null,
      virtualizationEvidence: flowReadinessResult.virtualizationEvidence ?? [],
      loadingSignalCount: flowReadinessResult.loadingSignalCount ?? null,
      captureGaps: flowReadinessResult.captureGaps ?? [],
      inventoryComplete: false,
      providerIdentityVerified: false,
      terminalSemanticsSupported: false,
      attemptsCreated: 0,
      confirmationConsumed: false,
      productionReceiptCreated: false,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(sanitized, null, 2));
      setFlowReadinessExportStatus("copied");
    } catch {
      setFlowReadinessExportStatus("clipboard_unavailable");
    }
  };

  const downloadFlowReadiness = () => {
    if (!flowReadinessResult) return;
    const report = {
      diagnostic: "flow-readiness-no-generate-v1",
      status: flowReadinessResult.status ?? "unknown",
      reason: flowReadinessResult.reason ?? null,
      message: flowReadinessResult.message ?? null,
      gates: flowReadinessResult.gates ?? null,
      countModeEligibility: flowReadinessResult.countModeEligibility ?? null,
      profile: flowReadinessResult.profile ?? null,
      listenerRoots: flowReadinessResult.listenerRoots ?? null,
      listenersAttached: flowReadinessResult.listenersAttached ?? false,
      stableBaseline: flowReadinessResult.stableBaseline ?? false,
      renderedTileCount: flowReadinessResult.renderedTileCount ?? null,
      distinctCandidateCount:
        flowReadinessResult.distinctCandidateCount ?? null,
      qualifyingCandidateCount:
        flowReadinessResult.qualifyingCandidateCount ?? null,
      repeatedCandidateCount:
        flowReadinessResult.repeatedCandidateCount ?? null,
      unidentifiedImageCount:
        flowReadinessResult.unidentifiedImageCount ?? null,
      unrelatedImageCount: flowReadinessResult.unrelatedImageCount ?? null,
      virtualized: flowReadinessResult.virtualized ?? null,
      virtualScrollContainerCount:
        flowReadinessResult.virtualScrollContainerCount ?? null,
      virtualizationEvidence: flowReadinessResult.virtualizationEvidence ?? [],
      loadingSignalCount: flowReadinessResult.loadingSignalCount ?? null,
      captureGaps: flowReadinessResult.captureGaps ?? [],
      inventoryComplete: false,
      providerIdentityVerified: false,
      terminalSemanticsSupported: false,
      attemptsCreated: 0,
      confirmationConsumed: false,
      productionReceiptCreated: false,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `flow-readiness-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setFlowReadinessExportStatus("downloaded");
  };

  return (
    <div
      className={styles.importPanel}
      aria-busy={snapshot.status === "pending"}
    >
      <JsonEditor
        id={`${kind}-import-source`}
        label={`${label} prompt source`}
        hint="Paste or edit one JSON prompt, numbered complete JSON blocks, or a supported versioned envelope. The source is kept as entered."
        error={snapshot.error?.message}
        value={snapshot.source}
        onChange={updateSource}
        rows={8}
        wrapLines={wrapLines}
        onWrapLinesChange={setWrapLines}
        expanded={editorExpanded}
        onExpandedChange={setEditorExpanded}
        showCharacterCount={false}
        placeholder={`Paste ${kind} JSON here`}
        aria-describedby={`${kind}-import-instructions`}
      />
      <p id={`${kind}-import-instructions`} className={styles.subtleText}>
        Validation runs only when you choose Validate &amp; Preview. No draft is
        sent to a provider.
      </p>
      {replacement ? (
        <div
          className={styles.replacePrompt}
          role="group"
          aria-label="Confirm source replacement"
        >
          <p>
            Replace the current {label.toLowerCase()} draft with this file? The
            existing draft will be replaced in memory.
          </p>
          <div className={styles.sourceActions}>
            <Button type="button" onClick={confirmReplacement}>
              Replace draft
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setReplacement(null)}
            >
              Keep current draft
            </Button>
          </div>
        </div>
      ) : null}

      {fileLoading ? (
        <Notice kind="info">Reading the selected file…</Notice>
      ) : null}
      {fileError ? <Notice kind="error">{fileError}</Notice> : null}

      <div
        className={styles.sourceToolbar}
        role="group"
        aria-label={`${label} source actions`}
      >
        <Field id={`${kind}-json-file`} label="Load JSON">
          <input
            id={`${kind}-json-file`}
            className={styles.fileInput}
            type="file"
            accept=".json,application/json"
            aria-label={`Choose ${kind} JSON file`}
            aria-describedby={`${kind}-json-file-hint`}
            disabled={fileLoading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              selectFile(file);
            }}
          />
        </Field>
        <div className={styles.sourceToolbarButtons}>
          <Button
            type="button"
            variant="secondary"
            disabled={
              persistenceStatus === "loading" ||
              persistenceStatus === "saving" ||
              exportingSavedSource
            }
            onClick={requestLoadSavedBatch}
          >
            {persistenceStatus === "loading"
              ? "Loading saved batch…"
              : "Load saved batch"}
          </Button>

          <Button
            type="button"
            variant="secondary"
            disabled={
              exportingSavedSource ||
              persistenceStatus === "saving" ||
              persistenceStatus === "loading"
            }
            loading={exportingSavedSource}
            loadingLabel="Exporting saved source…"
            onClick={() => void exportSavedSource()}
          >
            Export saved source
          </Button>
        </div>
      </div>
      <p className={styles.sourceHelper} id={`${kind}-json-file-hint`}>
        UTF-8 JSON. Maximum {INPUT_POLICY.maxBatchUtf8Bytes.toLocaleString()}{" "}
        bytes.
      </p>

      {confirmLoad ? (
        <div
          className={styles.replacePrompt}
          role="group"
          aria-label="Confirm saved batch load"
        >
          <p>
            Loading the saved batch will replace this unsaved draft. Continue?
          </p>
          <div className={styles.sourceActions}>
            <Button type="button" onClick={() => void loadSavedBatch()}>
              Replace draft with saved batch
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmLoad(false)}
            >
              Keep current draft
            </Button>
          </div>
        </div>
      ) : null}
      {persistenceError ? (
        <Notice
          kind={persistenceStatus.endsWith("error") ? "error" : "warning"}
        >
          {persistenceError}
        </Notice>
      ) : null}
      {exportError ? <Notice kind="error">{exportError}</Notice> : null}
      {exportDetails ? (
        <div className={styles.exportDetails} role="status" aria-live="polite">
          <p>Saved source download started: {exportDetails.fileName}</p>
          <details>
            <summary>Technical export details</summary>
            <p>
              {exportDetails.codeUnits.toLocaleString()} JavaScript code units ·{" "}
              {exportDetails.byteCount.toLocaleString()} UTF-8 bytes
            </p>
            <code>{exportDetails.sha256}</code>
          </details>
        </div>
      ) : null}

      <div className={styles.validateRow}>
        <Button
          type="button"
          loading={snapshot.status === "pending"}
          loadingLabel="Validating…"
          disabled={snapshot.source.length === 0 || fileLoading}
          onClick={() => session.validate()}
        >
          Validate &amp; Preview
        </Button>
        {snapshot.status === "pending" ? (
          <span role="status" aria-live="polite">
            Validating the complete {kind} input…
          </span>
        ) : null}
      </div>

      {snapshot.status === "error" && snapshot.error ? (
        <Notice kind="error">
          {`${snapshot.error.message}${snapshot.error.itemIndex === undefined ? "" : ` Item ${snapshot.error.itemIndex + 1}.`} Line ${snapshot.error.location.line}, column ${snapshot.error.location.column} (source offset ${snapshot.error.location.offset}).`}
        </Notice>
      ) : null}

      {snapshot.result ? (
        <section
          className={styles.importResult}
          aria-labelledby={`${kind}-import-result-title`}
        >
          <div className={styles.resultHeading}>
            <div>
              <p className={styles.kicker}>
                {stale ? "PREVIOUS RESULT" : "IMPORT PREVIEW"}
              </p>
              <h3 id={`${kind}-import-result-title`}>
                {snapshot.result.items.length} prompt
                {snapshot.result.items.length === 1 ? "" : "s"} detected
              </h3>
            </div>
          </div>
          {stale ? (
            <Notice kind="warning">
              This is the previous successful preview. It does not describe the
              current draft; validate again to refresh it.
            </Notice>
          ) : (
            <p role="status" className={styles.subtleText}>
              Validated preview. Nothing has been sent to a provider.
            </p>
          )}
          <ol className={styles.importItems}>
            {snapshot.result.items.map((item, index) => (
              <li
                className={styles.importItem}
                key={`${item.sourceSpan.start}-${index}`}
              >
                <div className={styles.itemSummary}>
                  <div>
                    <strong>Prompt {index + 1}</strong>
                    <span>
                      {item.shotId === undefined
                        ? "No shot ID"
                        : `Shot ID ${item.shotId}`}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="compact"
                    aria-expanded={visiblePreviewIndex === index}
                    aria-controls={
                      visiblePreviewIndex === index
                        ? `${kind}-raw-preview-${index}`
                        : undefined
                    }
                    onClick={() =>
                      setSelectedPreview((current) =>
                        current === index ? null : index,
                      )
                    }
                  >
                    {visiblePreviewIndex === index
                      ? "Hide raw body"
                      : "Show raw body"}
                  </Button>
                </div>
                {visiblePreviewIndex === index ? (
                  <pre
                    id={`${kind}-raw-preview-${index}`}
                    className={styles.rawPreview}
                    tabIndex={0}
                    aria-label={`Raw JSON body for prompt ${index + 1}`}
                  >
                    {visiblePreview!.rawBody}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <details className={styles.technicalDetails}>
        <summary>Technical details</summary>
        <dl>
          <div>
            <dt>Source size</dt>
            <dd>
              {snapshot.source.length.toLocaleString()} JavaScript code units ·{" "}
              {new TextEncoder()
                .encode(snapshot.source)
                .byteLength.toLocaleString()}{" "}
              UTF-8 bytes
            </dd>
          </div>
          {snapshot.result ? (
            <>
              <div>
                <dt>Import format</dt>
                <dd>{snapshot.result.mode.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Validation time</dt>
                <dd>
                  {snapshot.elapsedMs === undefined
                    ? "unavailable"
                    : `${snapshot.elapsedMs.toFixed(1)} ms`}
                </dd>
              </div>
              <div>
                <dt>Prompt body sizes</dt>
                <dd>
                  {snapshot.result.items
                    .map(
                      (item, index) =>
                        `Prompt ${index + 1}: ${item.measurement.stringCodeUnits.toLocaleString()} code units / ${item.measurement.utf8Bytes.toLocaleString()} bytes`,
                    )
                    .join("; ") || "none"}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        <details className={styles.policyDetails}>
          <summary>Provisional application limits</summary>
          <p>
            These limits protect the extension UI and importer. They do not
            state Flow or Vids acceptance or model capacity.
          </p>
          <ul>
            <li>
              Per prompt: {INPUT_POLICY.maxPromptCodeUnits.toLocaleString()}{" "}
              JavaScript code units and{" "}
              {INPUT_POLICY.maxPromptUtf8Bytes.toLocaleString()} UTF-8 bytes.
            </li>
            <li>
              Total input: {INPUT_POLICY.maxBatchCodeUnits.toLocaleString()}{" "}
              JavaScript code units and{" "}
              {INPUT_POLICY.maxBatchUtf8Bytes.toLocaleString()} UTF-8 bytes.
            </li>
            <li>Prompt count: {INPUT_POLICY.maxPromptCount}.</li>
            <li>JSON nesting depth: {INPUT_POLICY.maxJsonNestingDepth}.</li>
          </ul>
        </details>
      </details>
      <div className={styles.saveRow}>
        <Button
          type="button"
          disabled={
            !currentValidation ||
            persistenceStatus === "saving" ||
            persistenceStatus === "loading" ||
            exportingSavedSource
          }
          loading={persistenceStatus === "saving"}
          loadingLabel="Savingâ€¦"
          onClick={() => void saveValidatedBatch()}
        >
          Save validated batch
        </Button>
        <p role="status" aria-live="polite">
          {persistenceStatus === "saving"
            ? "Saving validated sourceâ€¦"
            : persistenceStatus === "loading"
              ? "Reading saved sourceâ€¦"
              : changedSinceSave
                ? "Unsaved changes. The current draft differs from the saved source."
                : changedSinceValidation
                  ? "Unsaved changes. Validate the current draft before saving."
                  : currentValidation && savedSource === snapshot.source
                    ? "Saved."
                    : currentValidation
                      ? "Validated. Save is available for this exact revision."
                      : persistenceStatus === "saved"
                        ? "Saved source is unchanged."
                        : "Not saved. Validate before saving."}
        </p>
      </div>
      {kind === "image" ? (
        <details className={styles.legacyTools}>
          <summary>
            Legacy count-mode and one-shot tools
            <span>Guarded diagnostics and GenerateOnce</span>
          </summary>
          <div className={styles.legacyToolsContent}>
            {legacyFlowSetup}
            {kind === "image" ? (
              <div className={styles.sourceActions}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={flowReadinessPending || flowGeneratePending}
                  loading={flowReadinessPending}
                  loadingLabel="Checking Flow readiness…"
                  onClick={() => void checkFlowReadiness()}
                >
                  Check Flow readiness (no Generate)
                </Button>
                <p className={styles.subtleText}>
                  Point-in-time read-only scope and observer check. It does not
                  authorize Generate or change attempts/settings confirmation.
                </p>
                {flowReadinessResult ? (
                  <>
                    {flowReadinessResult.status === "ready" ? (
                      <p role="status" className={styles.subtleText}>
                        {formatFlowReadinessStatus(flowReadinessResult)}
                      </p>
                    ) : (
                      <Notice kind="warning">
                        {formatFlowReadinessStatus(flowReadinessResult)}
                      </Notice>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void copyFlowReadiness()}
                    >
                      Copy sanitized readiness report
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={downloadFlowReadiness}
                    >
                      Download sanitized readiness JSON
                    </Button>
                    {flowReadinessExportStatus ? (
                      <p className={styles.subtleText}>
                        Report export: {flowReadinessExportStatus}.
                      </p>
                    ) : null}
                  </>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    !currentValidation ||
                    !flowSettingsConfirmed ||
                    flowEntryPending ||
                    flowGeneratePending ||
                    flowGenerateRequiresReview ||
                    flowGenerateLockConfirmationId ===
                      flowSettingsConfirmation?.confirmationId ||
                    flowEntryRequiresReview ||
                    currentItemCount !== 1
                  }
                  loading={flowEntryPending}
                  loadingLabel="Inspecting Flow composer…"
                  onClick={() => void fillFlowPrompt()}
                >
                  Inspect and fill Flow prompt (no Generate)
                </Button>
                {!flowSettingsConfirmed ? (
                  <p className={styles.subtleText}>
                    Confirm that you manually selected Image mode, model, ratio,
                    and variants in Flow.
                  </p>
                ) : null}
                <Field
                  id="flow-count-mode"
                  label="Flow project count mode"
                  hint="This declaration controls a separate heuristic count. It does not prove provider inventory, identity, or success."
                >
                  <select
                    id="flow-count-mode"
                    className={`${controlStyles.control} ${controlStyles.select}`}
                    value={flowCountMode}
                    onChange={(event) => {
                      setFlowCountMode(
                        event.currentTarget.value as
                          "new_empty_project" | "existing_project",
                      );
                      setFlowExistingCountConfirmed(false);
                      setFlowCountSessionId(crypto.randomUUID());
                      setFlowCountDecisionReport(undefined);
                    }}
                  >
                    <option value="new_empty_project">New empty project</option>
                    <option value="existing_project">Existing project</option>
                  </select>
                </Field>
                {flowCountMode === "existing_project" ? (
                  <>
                    <Field
                      id="flow-starting-image-count"
                      label="Starting image count in this project"
                      hint="User-attested count only. The visible DOM inventory remains incomplete."
                      required
                    >
                      <input
                        id="flow-starting-image-count"
                        className={controlStyles.control}
                        type="number"
                        min={0}
                        max={100000}
                        step={1}
                        value={flowStartingImageCount}
                        onChange={(event) => {
                          setFlowStartingImageCount(event.currentTarget.value);
                          setFlowExistingCountConfirmed(false);
                          setFlowCountSessionId(crypto.randomUUID());
                          setFlowCountDecisionReport(undefined);
                        }}
                      />
                    </Field>
                    <label className={styles.subtleText}>
                      <input
                        type="checkbox"
                        checked={flowExistingCountConfirmed}
                        onChange={(event) =>
                          setFlowExistingCountConfirmed(
                            event.currentTarget.checked,
                          )
                        }
                        disabled={
                          flowStartingImageCount.trim() === "" ||
                          !Number.isInteger(Number(flowStartingImageCount)) ||
                          Number(flowStartingImageCount) < 0
                        }
                      />{" "}
                      I confirm this starting image count for the selected
                      project.
                    </label>
                  </>
                ) : null}
                <p className={styles.subtleText}>
                  Starting count:{" "}
                  {flowCountMode === "new_empty_project"
                    ? "0 (observed empty UI scope)"
                    : flowStartingImageCount || "not confirmed"}
                  ; expected additions for this prompt:{" "}
                  {flowSettingsConfirmation?.declaredVariantCount ??
                    "confirm Flow variants"}
                  ; expected total uses starting count plus frozen declarations
                  and is arithmetic only.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void inspectFlowCountBlockers()}
                >
                  Inspect unresolved count observations (read only)
                </Button>
                {flowCountBlockerReport ? (
                  <div className={styles.subtleText}>
                    <p>
                      Count blocker inspection:{" "}
                      {String(flowCountBlockerReport.status)}; reason:{" "}
                      {String(flowCountBlockerReport.reason ?? "none")}.
                    </p>
                    {Array.isArray(flowCountBlockerReport.blockers)
                      ? flowCountBlockerReport.blockers.map((entry) => {
                          const blocker = entry as Record<string, unknown>;
                          const oldAttemptId =
                            typeof blocker.attemptId === "string"
                              ? blocker.attemptId
                              : "";
                          const canRecover = blocker.recoveryEligible === true;
                          const missingPrerequisite =
                            !flowExistingCountConfirmed
                              ? "Confirm the current image count for the selected project."
                              : !currentValidation || currentItemCount !== 1
                                ? "Validate one new prompt before rebaseline."
                                : flowCountRecoveryPending
                                  ? "Recovery is already running for a selected blocker."
                                  : "";
                          const recoveryReason = canRecover
                            ? missingPrerequisite
                            : `Unavailable: ${String(blocker.recoveryBlockReason ?? "session_not_recoverable")}.`;
                          return (
                            <article
                              className={styles.recoveryCard}
                              key={oldAttemptId || `blocker-${String(entry)}`}
                              aria-labelledby={`count-blocker-${oldAttemptId}`}
                            >
                              <h3 id={`count-blocker-${oldAttemptId}`}>
                                Attempt{" "}
                                <code>{oldAttemptId || "ID unavailable"}</code>
                              </h3>
                              <p>
                                Action state: {String(blocker.state)} ·
                                Observation:{" "}
                                {String(
                                  blocker.observationStatus ?? "unreported",
                                )}{" "}
                                · Monitoring:{" "}
                                {String(
                                  blocker.monitoringClassification ??
                                    "unreported",
                                )}
                              </p>
                              <p>
                                Monitoring scope:{" "}
                                {String(
                                  blocker.monitoringClassification ===
                                    "other_document_not_inspected"
                                    ? "another document; current document was not inspected"
                                    : "selected Flow document",
                                )}
                              </p>
                              <p>
                                Count session:{" "}
                                {String(
                                  blocker.countSessionPresent ?? "unreported",
                                )}{" "}
                                · Producer:{" "}
                                {String(blocker.producerStatus ?? "unreported")}{" "}
                                · Provider outcome:{" "}
                                {String(
                                  blocker.providerOutcomePersistedStatus ??
                                    "unreported",
                                )}{" "}
                                · Count decision:{" "}
                                {String(blocker.countDecision ?? "unreported")}
                                {blocker.countDecisionReason
                                  ? ` (${String(blocker.countDecisionReason)})`
                                  : ""}
                              </p>
                              <p>
                                Recovery eligibility:{" "}
                                {canRecover ? "Eligible" : "Blocked"}
                                {recoveryReason ? ` · ${recoveryReason}` : ""}
                              </p>
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={
                                  !oldAttemptId ||
                                  !canRecover ||
                                  flowCountRecoveryPending ||
                                  !flowExistingCountConfirmed ||
                                  !currentValidation ||
                                  currentItemCount !== 1
                                }
                                loading={flowCountRecoveryPending}
                                onClick={() =>
                                  void rebaselineFlowForNewPrompt(oldAttemptId)
                                }
                              >
                                Rebaseline for a new prompt
                              </Button>
                              <p className={styles.subtleText}>
                                This action applies only to attempt{" "}
                                {oldAttemptId || "unavailable"}.
                              </p>
                              {flowCountRecoveryReport?.attemptId ===
                              oldAttemptId ? (
                                flowCountRecoveryReport.status ===
                                "recovered" ? (
                                  <p
                                    role="status"
                                    className={styles.subtleText}
                                  >
                                    {formatFlowRecoveryStatus(
                                      oldAttemptId,
                                      flowCountRecoveryReport,
                                    )}
                                  </p>
                                ) : (
                                  <Notice kind="warning">
                                    {formatFlowRecoveryStatus(
                                      oldAttemptId,
                                      flowCountRecoveryReport,
                                    )}
                                  </Notice>
                                )
                              ) : null}
                            </article>
                          );
                        })
                      : null}
                  </div>
                ) : null}
                {flowCountRecoveryReport &&
                !(
                  Array.isArray(flowCountBlockerReport?.blockers) &&
                  flowCountBlockerReport.blockers.some(
                    (entry) =>
                      (entry as Record<string, unknown>).attemptId ===
                      flowCountRecoveryReport.attemptId,
                  )
                ) ? (
                  <article className={styles.recoveryCard}>
                    <h3>
                      Recovery response for attempt{" "}
                      <code>
                        {String(
                          flowCountRecoveryReport.attemptId ?? "unavailable",
                        )}
                      </code>
                    </h3>
                    {flowCountRecoveryReport.status === "recovered" ? (
                      <p role="status" className={styles.subtleText}>
                        {formatFlowRecoveryStatus(
                          String(
                            flowCountRecoveryReport.attemptId ?? "unavailable",
                          ),
                          flowCountRecoveryReport,
                        )}
                      </p>
                    ) : (
                      <Notice kind="warning">
                        {formatFlowRecoveryStatus(
                          String(
                            flowCountRecoveryReport.attemptId ?? "unavailable",
                          ),
                          flowCountRecoveryReport,
                        )}
                      </Notice>
                    )}
                  </article>
                ) : null}
                <Button
                  type="button"
                  disabled={Boolean(generateDisabledReason)}
                  loading={flowGeneratePending}
                  loadingLabel="Preparing one Generate attempt…"
                  onClick={() => void generateFlowImageOnce()}
                >
                  Generate once in Flow
                </Button>
                {generateDisabledReason ? (
                  <p className={styles.subtleText}>{generateDisabledReason}</p>
                ) : null}
                {flowEntryRequiresReview ? (
                  <p className={styles.subtleText}>
                    The last fill result is uncertain or mismatched. Inspect the
                    selected Flow editor before continuing; this panel will not
                    retry input.
                  </p>
                ) : null}
              </div>
            ) : null}
            {flowEntryPending ? (
              <p role="status" className={styles.subtleText}>
                Flow composer discovery and prompt preflight are pending. No
                Generate action is available.
              </p>
            ) : null}
            {flowGeneratePending ? (
              <p role="status" className={styles.subtleText}>
                Preparing the saved prompt and checking the selected Flow
                document. No Generate input has been sent at this point.
              </p>
            ) : null}
            {flowGenerateResult ? (
              flowGenerateResult.state === "dispatched" ? (
                <p role="status" className={styles.subtleText}>
                  {formatFlowGenerateOutcome(flowGenerateResult)}
                </p>
              ) : (
                <Notice
                  kind={
                    flowGenerateResult.state === "uncertain" ||
                    flowGenerateResult.state === "blocked"
                      ? "warning"
                      : "error"
                  }
                >
                  {formatFlowGenerateOutcome(flowGenerateResult)}
                </Notice>
              )
            ) : null}
            {flowGenerateResult?.attemptId ? (
              <Button
                type="button"
                variant="secondary"
                disabled={flowCountDecisionPending}
                loading={flowCountDecisionPending}
                loadingLabel="Reading durable count decision…"
                onClick={() => void refreshFlowCountDecision()}
              >
                Refresh count decision (read-only)
              </Button>
            ) : null}
            {flowCountDecisionReport ? (
              <p role="status" className={styles.subtleText}>
                {`${(flowCountDecisionReport.countDecision as Record<string, unknown> | undefined)?.status === "count_matched" ? "Count matched — heuristic observation. " : ""}${String(flowCountDecisionReport.message ?? "Durable count decision read back.")} Decision ${String((flowCountDecisionReport.countDecision as Record<string, unknown> | undefined)?.status ?? flowCountDecisionReport.status ?? "unavailable")}; reason ${String((flowCountDecisionReport.countDecision as Record<string, unknown> | undefined)?.reason ?? flowCountDecisionReport.reason ?? "none")}; expected additions ${String((flowCountDecisionReport.countDecision as Record<string, unknown> | undefined)?.expectedCumulativeAdditions ?? "unknown")}; expected total ${String((flowCountDecisionReport.countDecision as Record<string, unknown> | undefined)?.expectedTotal ?? "unknown")}; observed eligible candidates ${String(((flowCountDecisionReport.countDecision as Record<string, unknown> | undefined)?.observedEligibleCandidateIds as unknown[] | undefined)?.length ?? "unknown")}. Provider outcome ${String(flowCountDecisionReport.providerOutcome ?? "unknown")}; this count match is heuristic observation only.`}
              </p>
            ) : null}
            {flowEntryResult ? (
              flowEntryResult.fillVerified ? (
                <p role="status" className={styles.subtleText}>
                  {`${flowEntryResult.stage ?? "Flow entry"}: ${flowEntryResult.message ?? "The selected Flow editor was verified."} Generate is unavailable.`}
                </p>
              ) : (
                <Notice kind="error">
                  {[
                    `${flowEntryResult.stage ?? "Flow entry"}: ${flowEntryResult.message ?? "Flow prompt entry did not complete."}`,
                    flowEntryResult.expectedCodeUnits !== undefined
                      ? `Expected ${flowEntryResult.expectedCodeUnits} code units; actual ${flowEntryResult.actualCodeUnits ?? "unavailable"}. Entry method: ${flowEntryResult.inputMethod ?? "none"}. Fill verified: ${flowEntryResult.fillVerified ? "yes" : "no"}. Generate: unavailable.`
                      : "",
                    flowEntryResult.composer
                      ? `Connector reachable: ${flowEntryResult.connectorReachable ? "yes" : "no"}; composer: ${flowEntryResult.composer}; entry method compatible: ${flowEntryResult.methodCompatible ? "yes" : "no"}.`
                      : "",
                    flowEntryResult.textReadback
                      ? `Editor: ${flowEntryResult.editorKind}; profile: ${flowEntryResult.composerProfile}; readback: ${flowEntryResult.textReadback}.`
                      : "",
                    flowEntryResult.expectedSha256
                      ? `Expected SHA-256 ${flowEntryResult.expectedSha256}; actual ${flowEntryResult.actualSha256 ?? "unavailable"}.`
                      : "",
                    flowEntryResult.immediateMatch !== undefined
                      ? `Immediate match: ${flowEntryResult.immediateMatch ? "yes" : "no"}; settled match: ${flowEntryResult.settledMatch ? "yes" : "no"}. Mismatch: ${flowEntryResult.mismatchCategory ?? "none"}${flowEntryResult.firstDifferenceOffset !== undefined ? ` at offset ${flowEntryResult.firstDifferenceOffset}` : ""}.`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </Notice>
              )
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
