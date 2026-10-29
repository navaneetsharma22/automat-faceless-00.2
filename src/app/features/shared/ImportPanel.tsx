import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import type { ImportPreviewSession } from "./importPreviewSession";
import { readJsonSourceFile } from "./importFile";
import {
  exportSavedPromptSource,
  type SavedSourceExportDetails,
} from "./savedSourceExport";
import styles from "./ImportPanel.module.css";

type ExampleConfirmation =
  | { type: "example"; revision: number }
  | { type: "file"; revision: number; file: File };

export type ImportPanelProps = {
  kind: PromptKind;
  session: ImportPreviewSession;
  exampleSource: string;
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
  exampleSource,
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
  const [replacement, setReplacement] = useState<ExampleConfirmation | null>(
    null,
  );
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
  const [savedAt, setSavedAt] = useState<number | undefined>();
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
    | {
        state?: string;
        attemptId?: string;
        code?: string;
        message?: string;
        pressAttempted?: boolean;
        releaseAttempted?: boolean;
        activationCount?: number;
      }
    | undefined
  >();
  const fileRequest = useRef(0);
  const lastToastId = useRef(0);
  const label = kind === "image" ? "Image" : "Video";

  useEffect(() => {
    if (
      snapshot.validationId <= lastToastId.current ||
      (snapshot.status !== "success" && snapshot.status !== "error")
    ) {
      return;
    }
    lastToastId.current = snapshot.validationId;
    if (snapshot.status === "success") {
      toast.add({
        kind: "success",
        message: `${label} import preview is ready. Nothing was sent to a provider.`,
      });
    } else {
      toast.add({
        kind: "error",
        message: `${label} import validation failed. Review the inline details.`,
        urgent: false,
      });
    }
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

  const requestExample = () => {
    setFileError(undefined);
    if (snapshot.source.length === 0) {
      updateSource(exampleSource);
      return;
    }
    setReplacement({ type: "example", revision: snapshot.revision });
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
      setReplacement({ type: "file", file, revision: snapshot.revision });
      return;
    }
    void loadFile(file, snapshot.revision);
  };

  const confirmReplacement = () => {
    if (!replacement) return;
    if (session.getSnapshot().revision !== replacement.revision) {
      setReplacement(null);
      setFileError(
        "The draft changed after the replacement was selected. Select the example or file again.",
      );
      return;
    }
    const selected = replacement;
    setReplacement(null);
    if (selected.type === "example") {
      updateSource(exampleSource);
    } else {
      void loadFile(selected.file, selected.revision);
    }
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
      setSavedAt(saved.batch.updatedAt);
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
      setSavedAt(saved.batch.updatedAt);
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
        },
      );
      if (!rawResult || typeof rawResult !== "object") {
        throw new Error("The Generate attempt returned an invalid status.");
      }
      const result = rawResult as NonNullable<typeof flowGenerateResult>;
      setFlowGenerateResult(result);
      if (result.state === "dispatched" || result.state === "uncertain") {
        setFlowGenerateRequiresReview(true);
      } else if (
        result.code === "attempt_already_active" ||
        result.code === "duplicate_generate_click"
      ) {
        setFlowGenerateLockConfirmationId(confirmation.confirmationId);
      }
    } catch (error) {
      setFlowGenerateRequiresReview(true);
      setFlowGenerateResult({
        state: "uncertain",
        code: "response_unknown",
        message:
          error instanceof Error
            ? `${error.message} Check the attempt status before continuing; the action will not retry.`
            : "The worker response is unknown. Check the attempt status before continuing; the action will not retry.",
      });
    } finally {
      setFlowGeneratePending(false);
    }
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
        placeholder={`Paste ${kind} JSON here`}
        aria-describedby={`${kind}-import-instructions`}
      />
      <p id={`${kind}-import-instructions`} className={styles.subtleText}>
        Validation runs only when you choose Validate &amp; Preview. No draft is
        sent to a provider.
      </p>
      {snapshot.source === exampleSource ? (
        <Notice kind="info" announce={false}>
          Synthetic example loaded. This is test content, not a user production
          prompt.
        </Notice>
      ) : null}

      <div className={styles.sourceActions}>
        <Button type="button" onClick={requestExample} variant="secondary">
          Load synthetic example
        </Button>
        <Field
          id={`${kind}-json-file`}
          label="Load UTF-8 JSON file"
          hint={`Files over ${INPUT_POLICY.maxBatchUtf8Bytes.toLocaleString()} bytes are rejected before reading.`}
        >
          <input
            id={`${kind}-json-file`}
            className={styles.fileInput}
            type="file"
            accept=".json,application/json"
            aria-label={`Choose ${kind} JSON file`}
            disabled={fileLoading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              selectFile(file);
            }}
          />
        </Field>
      </div>
      {kind === "image" ? (
        <div className={styles.sourceActions}>
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
              Confirm that you manually selected Image mode, model, ratio, and
              variants in Flow.
            </p>
          ) : null}
          <Button
            type="button"
            disabled={
              !currentValidation ||
              !flowSettingsConfirmation ||
              savedSource !== snapshot.source ||
              persistenceStatus === "saving" ||
              persistenceStatus === "loading" ||
              flowEntryPending ||
              flowGeneratePending ||
              flowGenerateRequiresReview ||
              flowGenerateLockConfirmationId ===
                flowSettingsConfirmation?.confirmationId ||
              currentItemCount !== 1
            }
            loading={flowGeneratePending}
            loadingLabel="Preparing one Generate attempt…"
            onClick={() => void generateFlowImageOnce()}
          >
            Generate once in Flow
          </Button>
          {!flowSettingsConfirmation ? (
            <p className={styles.subtleText}>
              Confirm manual image settings for the currently selected Flow
              project before this one-shot action.
            </p>
          ) : null}
          {savedSource !== snapshot.source ? (
            <p className={styles.subtleText}>
              Save the current validated one-prompt batch before enabling
              Generate once.
            </p>
          ) : null}
          {!currentValidation ? (
            <p className={styles.subtleText}>
              Validate the current image source before Flow composer inspection
              is available.
            </p>
          ) : currentItemCount !== 1 ? (
            <p className={styles.subtleText}>
              Flow single-prompt fill requires exactly one validated JSON body.
            </p>
          ) : null}
          {flowEntryRequiresReview ? (
            <p className={styles.subtleText}>
              The last fill result is uncertain or mismatched. Inspect the
              selected Flow editor before continuing; this panel will not retry
              input.
            </p>
          ) : null}
        </div>
      ) : null}
      {flowEntryPending ? (
        <Notice kind="info">
          Flow composer discovery and prompt preflight are pending. No Generate
          action is available.
        </Notice>
      ) : null}
      {flowGeneratePending ? (
        <Notice kind="info">
          Preparing the saved prompt and checking the selected Flow document.
          Generate has not been dispatched yet.
        </Notice>
      ) : null}
      {flowGenerateResult ? (
        <Notice
          kind={
            flowGenerateResult.state === "dispatched"
              ? "info"
              : flowGenerateResult.state === "uncertain"
                ? "warning"
                : flowGenerateResult.state === "blocked"
                  ? "warning"
                  : "error"
          }
        >
          {`${flowGenerateResult.state ?? "Attempt"}: ${flowGenerateResult.message ?? "The Generate attempt did not complete."} Activation pair attempts: ${flowGenerateResult.activationCount ?? 0}. Press: ${flowGenerateResult.pressAttempted ? "sent or uncertain" : "not sent"}; release: ${flowGenerateResult.releaseAttempted ? "sent or uncertain" : "not sent"}.${flowGenerateResult.attemptId ? ` Attempt ${flowGenerateResult.attemptId}.` : ""}`}
        </Notice>
      ) : null}
      {flowGenerateRequiresReview ||
      flowGenerateLockConfirmationId ===
        flowSettingsConfirmation?.confirmationId ? (
        <p className={styles.subtleText}>
          {flowGenerateRequiresReview
            ? "This attempt is dispatched or uncertain. Do not activate Generate again; inspect its durable attempt status first."
            : "This settings confirmation was already used. Reconfirm the manual settings before starting another attempt."}
        </p>
      ) : null}
      {flowEntryResult ? (
        <Notice kind={flowEntryResult.fillVerified ? "success" : "error"}>
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
      ) : null}

      {replacement ? (
        <div
          className={styles.replacePrompt}
          role="group"
          aria-label="Confirm source replacement"
        >
          <p>
            Replace the current {label.toLowerCase()} draft with this{" "}
            {replacement.type === "example" ? "synthetic example" : "file"}? The
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

      <div className={styles.sourceActions}>
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
          disabled={
            !currentValidation ||
            persistenceStatus === "saving" ||
            persistenceStatus === "loading" ||
            exportingSavedSource
          }
          loading={persistenceStatus === "saving"}
          loadingLabel="Saving…"
          onClick={() => void saveValidatedBatch()}
        >
          Save validated batch
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
      <p role="status" aria-live="polite">
        {persistenceStatus === "saving"
          ? "Saving the complete validated batch…"
          : persistenceStatus === "loading"
            ? "Reading the saved batch from extension storage…"
            : changedSinceSave
              ? "Changed since save. The current draft is not the saved batch."
              : changedSinceValidation
                ? "Changed since validation. Validate the current draft before saving."
                : currentValidation && savedSource === snapshot.source
                  ? `Saved${savedAt === undefined ? "" : ` at ${new Date(savedAt).toLocaleString()}`}.`
                  : currentValidation
                    ? "Validated. Save is available for this exact revision."
                    : persistenceStatus === "saved"
                      ? `Saved${savedAt === undefined ? "" : ` at ${new Date(savedAt).toLocaleString()}`}.`
                      : "Draft. Validate before saving."}
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
          <p>
            {exportDetails.codeUnits.toLocaleString()} JavaScript code units ·{" "}
            {exportDetails.byteCount.toLocaleString()} UTF-8 bytes
          </p>
          <details>
            <summary>SHA-256</summary>
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

      <details className={styles.policyDetails}>
        <summary>Provisional application limits</summary>
        <p>
          These limits protect the extension UI and importer. They do not state
          Flow or Vids acceptance or model capacity.
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
            <span className={styles.resultMode}>
              {snapshot.result.mode.replaceAll("_", " ")}
            </span>
          </div>
          {stale ? (
            <Notice kind="warning">
              This is the previous successful preview. It does not describe the
              current draft; validate again to refresh it.
            </Notice>
          ) : (
            <Notice kind="success">
              Validated preview. Nothing has been sent to a provider.
            </Notice>
          )}
          <p className={styles.totalMeasurement}>
            Total prompt bodies:{" "}
            {snapshot.result.total.stringCodeUnits.toLocaleString()} JavaScript
            code units · {snapshot.result.total.utf8Bytes.toLocaleString()}{" "}
            UTF-8 bytes
            {snapshot.elapsedMs === undefined
              ? ""
              : ` · validated in ${snapshot.elapsedMs.toFixed(1)} ms`}
          </p>
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
                    <small>
                      {item.measurement.stringCodeUnits.toLocaleString()}{" "}
                      JavaScript code units ·{" "}
                      {item.measurement.utf8Bytes.toLocaleString()} UTF-8 bytes
                    </small>
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
    </div>
  );
}
