import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import { AppRequestSchema } from "../../shared/schemas";
import type {
  AppRequest,
  AppResponse,
  FailureCategory,
} from "../../shared/schemas";
import type {
  ExtensionRepositories,
  ChromePreferenceRepository,
} from "../../storage/repositories";
import {
  ActiveFlowImageAttemptError,
  DuplicateTimedImageQueueSourceError,
  ImageQueueEligibilityError,
  PromptBatchValidationError,
  VideoBatchPreparationError,
} from "../../storage/repositories";
import { ImageQueueInspectionError } from "../generationQueue";
import { FlowClipDownloadStartError } from "../flowDownloadDiagnostic";
import { FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE } from "../../shared/schemas";
import { ReferenceSelectionError } from "./references";

export type ExtensionMessageSender = {
  id?: string;
  url?: string;
  tab?: { id?: number; url?: string };
  frameId?: number;
  documentId?: string;
};

export type FoundationDependencies = {
  repositories: ExtensionRepositories;
  preferences: ChromePreferenceRepository;
  ready?: Promise<void>;
  timedQueueReady?: Promise<void>;
  flowPromptEntry?: (input: {
    workspaceId: string;
    promptHash: string;
  }) => Promise<unknown>;
  flowImageGenerateOnce?: (
    input: Extract<AppRequest, { type: "flow.image.generateOnce" }>["payload"],
  ) => Promise<unknown>;
  flowImageReadiness?: (
    input: Extract<
      AppRequest,
      { type: "flow.image.checkReadiness" }
    >["payload"],
  ) => Promise<unknown>;
  flowImageCountDecision?: (attemptId: string) => Promise<unknown>;
  flowCountBlockerInspection?: () => Promise<unknown>;
  flowCountRebaseline?: (
    input: Extract<
      AppRequest,
      { type: "flow.image.rebaselineForNewPrompt" }
    >["payload"],
  ) => Promise<unknown>;
  flowImageObservation?: (
    message: unknown,
    sender: ExtensionMessageSender,
  ) => Promise<unknown>;
  revalidateConnection?: (
    provider: "Flow" | "Vids",
    enableReconnect?: boolean,
  ) => Promise<unknown>;
  startTimedImageQueue?: (queueId: string) => Promise<unknown>;
  commandTimedImageQueue?: (
    command: "pause" | "resume" | "stop",
    queueId: string,
    expectedRevision: number,
  ) => Promise<unknown>;
  inspectTimedQueueItemReadback?: (
    queueId: string,
    order?: number,
  ) => Promise<unknown>;
  retryBlockedImageQueueItem?: (
    queueId: string,
    expectedRevision: number,
    order: number,
  ) => Promise<unknown>;
  flowReferenceHandler?: {
    startSelection: (input: {
      workspaceId: string;
      batchId: string;
      shotId: string;
    }) => Promise<unknown>;
    cancelSelection: (sessionId: string, reason?: string) => Promise<unknown>;
    getState: (workspaceId: string) => Promise<unknown>;
    listCandidates?: (sessionId: string) => Promise<unknown>;
    chooseCandidate?: (
      sessionId: string,
      candidateId: string,
    ) => Promise<unknown>;
    getPreview?: (
      sessionId: string,
      candidateId: string,
      previewId: string,
    ) => Promise<unknown>;
    cancelPreview?: (sessionId: string, previewId: string) => Promise<unknown>;
    captureReference?: (input: {
      workspaceId: string;
      batchId: string;
      shotId: string;
      selectionVersion: string;
      expectedAssignmentVersion: number;
      captureOperationId: string;
    }) => Promise<unknown>;
    cancelCapture?: (captureOperationId: string) => Promise<unknown>;
    getCaptureStatus?: (captureOperationId: string) => Promise<unknown>;
    getSavedReference?: (referenceId: string) => Promise<unknown>;
    clearCandidate: (workspaceId: string, shotId: string) => Promise<unknown>;
    handleCandidateSelected: (
      message: unknown,
      sender: ExtensionMessageSender,
    ) => Promise<{ accepted: boolean; code?: string }>;
    invalidateActiveSession: (reason: string) => Promise<void>;
  };
  flowVideoAttachment?: {
    attach: (preparedBatchId: string, itemId: string) => Promise<unknown>;
    inspectReferenceBytes?: (preparedBatchId: string, itemId: string) => Promise<unknown>;
    verifyAttachedReference: (preparedBatchId: string, itemId: string) => Promise<unknown>;
    status: (preparedBatchId: string, itemId: string) => Promise<unknown>;
    reconcilePreClickFailure: (input: {
      preparedBatchId: string;
      itemId: string;
      expectedStatus: "uncertain";
      expectedReason: "composer_unsupported";
      expectedReferenceId: string;
      expectedUpdatedAt: number;
    }) => Promise<unknown>;
  };
  vidsVideoAttachment?: {
    attach: (preparedBatchId: string, itemId: string, fromQueue?: boolean) => Promise<unknown>;
    get: (preparedBatchId: string, itemId: string) => Promise<unknown>;
    getPreview?: (preparedBatchId: string, itemId: string) => Promise<unknown>;
  };
  vidsVideoGenerate?: {
    generateOnce: (preparedBatchId: string, itemId: string, fromQueue?: boolean) => Promise<unknown>;
    get: (preparedBatchId: string, itemId: string) => Promise<unknown>;
    recoverPreActivationFailure: (expected: unknown) => Promise<unknown>;
    transitionFromPrevious?: (preparedBatchId: string, previousItemId: string) => Promise<unknown>;
  };
  vidsVideoQueue?: {
    get: (preparedBatchId: string) => Promise<unknown>;
    start: (preparedBatchId: string) => Promise<unknown>;
    pause: (preparedBatchId: string, expectedRevision: number) => Promise<unknown>;
    resume: (preparedBatchId: string, expectedRevision: number, confirmSameAccount?: boolean) => Promise<unknown>;
    stop: (preparedBatchId: string, expectedRevision: number) => Promise<unknown>;
    inspectTransition: (preparedBatchId: string, itemId: string) => Promise<unknown>;
  };
  flowVideoGenerateOnce?: (preparedBatchId: string, itemId: string) => Promise<unknown>;
  flowVideoQueue?: {
    get: (preparedBatchId: string) => Promise<unknown>;
    start: (preparedBatchId: string) => Promise<unknown>;
    pause: (preparedBatchId: string, expectedRevision: number) => Promise<unknown>;
    resume: (preparedBatchId: string, expectedRevision: number) => Promise<unknown>;
    recheckAndResume: (preparedBatchId: string, expectedRevision: number) => Promise<unknown>;
    reconcilePreAddFailure: (preparedBatchId: string, expectedRevision: number) => Promise<unknown>;
    stop: (preparedBatchId: string, expectedRevision: number) => Promise<unknown>;
  };
  flowDownloadDiagnostic?: {
    arm: (identityCaptureEnabled?: boolean) => Promise<unknown>;
    stop: () => Promise<unknown>;
    get: () => Promise<unknown>;
    importCurrentClip: () => Promise<unknown>;
    listImportedClips: () => Promise<unknown>;
    inspectClipDownloadProof: (recordId: string) => Promise<unknown>;
    armClipDownloadProof: (recordId: string) => Promise<unknown>;
    startClipDownload?: (recordId: string, allowNewAttempt?: boolean) => Promise<unknown>;
    ingestPageEvent: (
      raw: unknown,
      sender: ExtensionMessageSender,
    ) => Promise<boolean>;
  };
};

export type SendResponse = (response: AppResponse) => void;

function failure(
  requestId: string,
  category: FailureCategory,
  code: string,
  message: string,
  stage?: string,
): AppResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    buildId: BUILD_ID,
    requestId,
    ok: false,
    error: {
      category,
      code,
      message,
      ...(stage ? { stage } : {}),
    },
  };
}

function allowedDashboardSender(
  sender: ExtensionMessageSender,
  extensionId: string,
): boolean {
  return (
    sender.id === extensionId &&
    sender.url === `chrome-extension://${extensionId}/index.html`
  );
}

async function dispatch(
  request: AppRequest,
  dependencies: FoundationDependencies,
): Promise<unknown> {
  switch (request.type) {
    case "foundation.ping":
      return { state: "ready" };
    case "promptDraft.put": {
      const record = await dependencies.repositories.savePromptDraft(
        request.payload,
      );
      return {
        id: record.id,
        characterCount: record.rawText.length,
        updatedAt: record.updatedAt,
      };
    }
    case "promptDraft.get": {
      const record = await dependencies.repositories.getPromptDraft(
        request.payload.id,
      );
      if (!record) {
        throw new FoundationOperationError(
          "not_found",
          "draft_not_found",
          "The requested local prompt draft was not found.",
        );
      }
      return record;
    }
    case "promptBatch.put":
      try {
        return await dependencies.repositories.savePromptBatch(request.payload);
      } catch (error) {
        if (error instanceof PromptBatchValidationError) {
          throw new FoundationOperationError(
            "invalid_request",
            "batch_validation_failed",
            "The prompt batch failed validation and was not saved.",
          );
        }
        throw error;
      }
    case "promptBatch.get": {
      try {
        const snapshot = await dependencies.repositories.getPromptBatch(
          request.payload.workspaceId,
          request.payload.kind,
        );
        if (!snapshot) {
          throw new FoundationOperationError(
            "not_found",
            "batch_not_found",
            "No saved prompt batch exists for this workspace and kind.",
          );
        }
        return snapshot;
      } catch (error) {
        if (error instanceof PromptBatchValidationError) {
          throw new FoundationOperationError(
            "storage_failure",
            "saved_batch_invalid",
            "The saved prompt batch failed integrity validation.",
          );
        }
        throw error;
      }
    }
    case "imageQueue.createTimed": {
      try {
        return await dependencies.repositories.createTimedImageSubmissionQueue({
          ...request.payload,
        });
      } catch (error) {
        if (error instanceof ActiveFlowImageAttemptError) {
          throw new FoundationOperationError(
            "worker_error",
            "image_queue_source_blocked",
            "An unresolved historical attempt blocks this exact prompt source.",
          );
        }
        if (error instanceof DuplicateTimedImageQueueSourceError) {
          throw new FoundationOperationError(
            "worker_error",
            "image_queue_source_already_queued",
            "This exact prompt source already belongs to a timed queue.",
          );
        }
        if (error instanceof ImageQueueEligibilityError) {
          throw new FoundationOperationError(
            "invalid_request",
            error.code,
            "The saved source or selected project changed; reload and review before creating a queue.",
          );
        }
        if (error instanceof PromptBatchValidationError) {
          throw new FoundationOperationError(
            "storage_failure",
            "saved_batch_invalid",
            "The saved image source failed integrity validation.",
          );
        }
        throw error;
      }
    }
    case "imageQueue.get": {
      const record =
        await dependencies.repositories.getTimedImageSubmissionQueue(
          request.payload.queueId,
        );
      if (!record) {
        throw new FoundationOperationError(
          "not_found",
          "image_queue_not_found",
          "The requested timed image queue was not found.",
        );
      }
      return record;
    }
    case "imageQueue.start": {
      if (!dependencies.startTimedImageQueue)
        throw new FoundationOperationError(
          "worker_error",
          "image_queue_execution_unavailable",
          "Timed queue execution is unavailable in this worker.",
        );
      try {
        return await dependencies.startTimedImageQueue(request.payload.queueId);
      } catch (error) {
        if (error instanceof ImageQueueEligibilityError)
          throw new FoundationOperationError(
            "invalid_request",
            error.code,
            "The saved queue is no longer eligible to start. Reload and review its project, source, and state.",
          );
        throw error;
      }
    }
    case "imageQueue.pause":
    case "imageQueue.resume":
    case "imageQueue.stop": {
      if (!dependencies.commandTimedImageQueue)
        throw new FoundationOperationError(
          "worker_error",
          "image_queue_lifecycle_unavailable",
          "Queue lifecycle controls are unavailable in this worker.",
        );
      try {
        return await dependencies.commandTimedImageQueue(
          request.type.slice("imageQueue.".length) as
            "pause" | "resume" | "stop",
          request.payload.queueId,
          request.payload.expectedRevision,
        );
      } catch (error) {
        if (error instanceof ImageQueueEligibilityError)
          throw new FoundationOperationError(
            "invalid_request",
            error.code,
            "The saved queue changed or cannot continue. Reload and review its current state.",
          );
        throw error;
      }
    }
    case "imageQueue.list":
      return dependencies.repositories.listTimedImageSubmissionQueues(
        request.payload.workspaceId,
      );
    case "imageQueue.inspectReadback": {
      if (!dependencies.inspectTimedQueueItemReadback)
        throw new FoundationOperationError(
          "worker_error",
          "image_queue_inspection_unavailable",
          "Readback inspection is unavailable in this worker.",
          "request_validation",
        );
      try {
        return await dependencies.inspectTimedQueueItemReadback(
          request.payload.queueId,
          request.payload.order,
        );
      } catch (error) {
        if (error instanceof FoundationOperationError) {
          throw error;
        }
        if (error instanceof ImageQueueInspectionError) {
          throw new FoundationOperationError(
            error.category,
            error.code,
            error.message,
            error.stage,
          );
        }
        if (error instanceof ImageQueueEligibilityError) {
          const stage =
            error.code === "image_queue_not_found" ||
            error.code === "image_queue_item_not_found"
              ? "queue_lookup"
              : "target_verification";
          throw new FoundationOperationError(
            "invalid_request",
            error.code,
            "The saved queue or target is unavailable for readback inspection.",
            stage,
          );
        }
        const boundedCode =
          error instanceof Error && error.name && error.name !== "Error"
            ? error.name.slice(0, 64)
            : "inspection_failed";
        throw new FoundationOperationError(
          "worker_error",
          boundedCode,
          "The read-only editor inspection encountered an unexpected worker error.",
          "editor_readback",
        );
      }
    }
    case "imageQueue.retryBlocked": {
      if (!dependencies.retryBlockedImageQueueItem)
        throw new FoundationOperationError(
          "worker_error",
          "image_queue_retry_unavailable",
          "Guarded retry is unavailable in this worker.",
          "request_validation",
        );
      try {
        return await dependencies.retryBlockedImageQueueItem(
          request.payload.queueId,
          request.payload.expectedRevision,
          request.payload.order,
        );
      } catch (error) {
        if (error instanceof FoundationOperationError) {
          throw error;
        }
        if (error instanceof ImageQueueInspectionError) {
          throw new FoundationOperationError(
            error.category,
            error.code,
            error.message,
            error.stage,
          );
        }
        if (error instanceof ImageQueueEligibilityError) {
          const stage =
            error.code === "image_queue_not_found" ||
            error.code === "image_queue_item_not_found"
              ? "queue_lookup"
              : error.code === "selected_project_or_document_changed"
                ? "target_verification"
                : "request_validation";
          throw new FoundationOperationError(
            "invalid_request",
            error.code,
            "The guarded retry could not be safely authorized for this item.",
            stage,
          );
        }
        const boundedCode =
          error instanceof Error && error.name && error.name !== "Error"
            ? error.name.slice(0, 64)
            : "retry_failed";
        throw new FoundationOperationError(
          "worker_error",
          boundedCode,
          "The guarded retry encountered an unexpected worker error.",
          "editor_readback",
        );
      }
    }
    case "connections.recordSelection": {
      const record = await dependencies.repositories.recordSelectedTarget(
        request.payload,
      );
      return {
        provider: record.provider,
        tabId: record.tabId,
        verification: record.verification,
        reconnectEnabled: record.reconnectEnabled,
      };
    }
    case "connections.getSelection":
      return (
        (await dependencies.repositories.getSelectedTarget(
          request.payload.provider,
        )) ?? null
      );
    case "connections.revalidate":
      if (!dependencies.revalidateConnection) {
        throw new FoundationOperationError(
          "worker_error",
          "connection_revalidation_unavailable",
          "The selected provider connection cannot be revalidated in this worker.",
        );
      }
      return dependencies.revalidateConnection(
        request.payload.provider,
        request.payload.enableReconnect,
      );
    case "connections.setReconnectIntent":
      return {
        updated: await dependencies.repositories.setReconnectIntent(
          request.payload.provider,
          request.payload.enabled,
        ),
      };
    case "flow.prompt.fill":
      if (!dependencies.flowPromptEntry) {
        throw new FoundationOperationError(
          "worker_error",
          "flow_entry_unavailable",
          "Flow prompt entry is unavailable in this extension context.",
        );
      }
      return dependencies.flowPromptEntry(request.payload);
    case "flow.image.generateOnce":
      if (!dependencies.flowImageGenerateOnce) {
        throw new FoundationOperationError(
          "worker_error",
          "flow_image_generate_unavailable",
          "Flow image generation is unavailable in this extension context.",
        );
      }
      return dependencies.flowImageGenerateOnce(request.payload);
    case "flow.image.checkReadiness":
      if (!dependencies.flowImageReadiness) {
        throw new FoundationOperationError(
          "worker_error",
          "flow_readiness_unavailable",
          "Flow readiness inspection is unavailable in this worker context.",
        );
      }
      return dependencies.flowImageReadiness(request.payload);
    case "flow.image.getCountDecision":
      if (!dependencies.flowImageCountDecision) {
        throw new FoundationOperationError(
          "worker_error",
          "flow_count_decision_unavailable",
          "The durable Flow count decision is unavailable in this worker context.",
        );
      }
      return dependencies.flowImageCountDecision(request.payload.attemptId);
    case "flow.image.inspectCountBlockers":
      if (!dependencies.flowCountBlockerInspection)
        throw new FoundationOperationError(
          "worker_error",
          "count_blocker_inspection_unavailable",
          "Flow count blocker inspection is unavailable.",
        );
      return dependencies.flowCountBlockerInspection();
    case "flow.image.rebaselineForNewPrompt":
      if (!dependencies.flowCountRebaseline)
        throw new FoundationOperationError(
          "worker_error",
          "count_rebaseline_unavailable",
          "Flow count recovery is unavailable.",
        );
      return dependencies.flowCountRebaseline(request.payload);
    case "preferences.getTheme":
      return { theme: await dependencies.preferences.getTheme() };
    case "preferences.setTheme":
      await dependencies.preferences.setTheme(request.payload.theme);
      return { theme: request.payload.theme };
    case "flow.reference.startSelection":
      if (!dependencies.flowReferenceHandler) {
        throw new FoundationOperationError(
          "worker_error",
          "reference_selection_unavailable",
          "Reference selection is unavailable in this worker context.",
        );
      }
      try {
        return await dependencies.flowReferenceHandler.startSelection(
          request.payload,
        );
      } catch (err) {
        if (err instanceof ReferenceSelectionError) {
          throw new FoundationOperationError(
            err.category,
            err.code,
            err.message,
          );
        }
        throw err;
      }
    case "flow.reference.cancelSelection":
      if (!dependencies.flowReferenceHandler) {
        throw new FoundationOperationError(
          "worker_error",
          "reference_selection_unavailable",
          "Reference selection is unavailable in this worker context.",
        );
      }
      return await dependencies.flowReferenceHandler.cancelSelection(
        request.payload.sessionId,
      );
    case "flow.reference.getState":
      if (!dependencies.flowReferenceHandler) {
        throw new FoundationOperationError(
          "worker_error",
          "reference_selection_unavailable",
          "Reference selection is unavailable in this worker context.",
        );
      }
      return await dependencies.flowReferenceHandler.getState(
        request.payload.workspaceId,
      );
    case "flow.reference.listCandidates":
      if (!dependencies.flowReferenceHandler?.listCandidates) {
        throw new FoundationOperationError(
          "worker_error",
          "reference_selection_unavailable",
          "Reference selection is unavailable in this worker context.",
        );
      }
      try {
        return await dependencies.flowReferenceHandler.listCandidates(
          request.payload.sessionId,
        );
      } catch (err) {
        if (err instanceof ReferenceSelectionError) {
          throw new FoundationOperationError(
            err.category,
            err.code,
            err.message,
          );
        }
        throw err;
      }
    case "flow.reference.chooseCandidate":
      if (!dependencies.flowReferenceHandler?.chooseCandidate) {
        throw new FoundationOperationError(
          "worker_error",
          "reference_selection_unavailable",
          "Reference selection is unavailable in this worker context.",
        );
      }
      try {
        return await dependencies.flowReferenceHandler.chooseCandidate(
          request.payload.sessionId,
          request.payload.candidateId,
        );
      } catch (err) {
        if (err instanceof ReferenceSelectionError) {
          throw new FoundationOperationError(
            err.category,
            err.code,
            err.message,
          );
        }
        throw err;
      }
    case "flow.reference.getPreview":
      if (!dependencies.flowReferenceHandler?.getPreview) {
        throw new FoundationOperationError(
          "worker_error",
          "reference_selection_unavailable",
          "Reference preview is unavailable in this worker context.",
        );
      }
      try {
        return await dependencies.flowReferenceHandler.getPreview(
          request.payload.sessionId,
          request.payload.candidateId,
          request.payload.previewId,
        );
      } catch (err) {
        if (err instanceof ReferenceSelectionError)
          throw new FoundationOperationError(
            err.category,
            err.code,
            err.message,
          );
        throw err;
      }
    case "flow.reference.cancelPreview":
      if (!dependencies.flowReferenceHandler?.cancelPreview) {
        throw new FoundationOperationError(
          "worker_error",
          "reference_selection_unavailable",
          "Reference preview is unavailable in this worker context.",
        );
      }
      try {
        return await dependencies.flowReferenceHandler.cancelPreview(
          request.payload.sessionId,
          request.payload.previewId,
        );
      } catch (err) {
        if (err instanceof ReferenceSelectionError)
          throw new FoundationOperationError(
            err.category,
            err.code,
            err.message,
          );
        throw err;
      }
    case "flow.reference.capture":
      if (!dependencies.flowReferenceHandler?.captureReference)
        throw new FoundationOperationError(
          "worker_error",
          "reference_capture_unavailable",
          "Reference capture is unavailable in this worker context.",
        );
      try {
        return await dependencies.flowReferenceHandler.captureReference(
          request.payload,
        );
      } catch (err) {
        if (err instanceof ReferenceSelectionError)
          throw new FoundationOperationError(
            err.category,
            err.code,
            err.message,
          );
        throw err;
      }
    case "flow.reference.cancelCapture":
      if (!dependencies.flowReferenceHandler?.cancelCapture)
        throw new FoundationOperationError(
          "worker_error",
          "reference_capture_unavailable",
          "Reference capture is unavailable in this worker context.",
        );
      try {
        return await dependencies.flowReferenceHandler.cancelCapture(
          request.payload.captureOperationId,
        );
      } catch (err) {
        if (err instanceof ReferenceSelectionError)
          throw new FoundationOperationError(
            err.category,
            err.code,
            err.message,
          );
        throw err;
      }
    case "flow.reference.getCaptureStatus":
      if (!dependencies.flowReferenceHandler?.getCaptureStatus)
        throw new FoundationOperationError(
          "worker_error",
          "reference_capture_unavailable",
          "Reference capture status is unavailable.",
        );
      return await dependencies.flowReferenceHandler.getCaptureStatus(
        request.payload.captureOperationId,
      );
    case "flow.reference.getSavedReference":
      if (!dependencies.flowReferenceHandler?.getSavedReference)
        throw new FoundationOperationError(
          "worker_error",
          "reference_capture_unavailable",
          "Saved references are unavailable in this worker context.",
        );
      try {
        return await dependencies.flowReferenceHandler.getSavedReference(
          request.payload.referenceId,
        );
      } catch (err) {
        if (err instanceof ReferenceSelectionError)
          throw new FoundationOperationError(
            err.category,
            err.code,
            err.message,
          );
        throw err;
      }
    case "flow.reference.clearCandidate":
      if (!dependencies.flowReferenceHandler) {
        throw new FoundationOperationError(
          "worker_error",
          "reference_selection_unavailable",
          "Reference selection is unavailable in this worker context.",
        );
      }
      return await dependencies.flowReferenceHandler.clearCandidate(
        request.payload.workspaceId,
        request.payload.shotId,
      );
    case "videoBatch.prepare": {
      try {
        return await dependencies.repositories.prepareVideoBatch(request.payload);
      } catch (error) {
        if (error instanceof VideoBatchPreparationError) {
          throw new FoundationOperationError(
            error.code === "reference_media_corrupt" ||
              error.code === "reference_media_missing"
              ? "storage_failure"
              : "invalid_request",
            error.code,
            error.message,
          );
        }
        throw error;
      }
    }
    case "videoBatch.getPrepared": {
      const record = await dependencies.repositories.getPreparedVideoBatch(
        request.payload.workspaceId,
      );
      return record ?? null;
    }
    case "flow.video.attachReference":
      if (!dependencies.flowVideoAttachment) throw new FoundationOperationError("worker_error", "flow_video_attachment_unavailable", "Flow reference attachment is unavailable.");
      return await dependencies.flowVideoAttachment.attach(request.payload.preparedBatchId, request.payload.itemId);
    case "vids.video.attachReference":
      if (!dependencies.vidsVideoAttachment) throw new FoundationOperationError("worker_error", "vids_video_attachment_unavailable", "Vids reference attachment is unavailable.");
      return await dependencies.vidsVideoAttachment.attach(request.payload.preparedBatchId, request.payload.itemId);
    case "vids.video.getAttachmentStatus":
      if (!dependencies.vidsVideoAttachment) throw new FoundationOperationError("worker_error", "vids_video_attachment_unavailable", "Vids reference attachment status is unavailable.");
      return await dependencies.vidsVideoAttachment.get(request.payload.preparedBatchId, request.payload.itemId);
    case "vids.video.getReferencePreview":
      if (!dependencies.vidsVideoAttachment?.getPreview) throw new FoundationOperationError("worker_error", "vids_video_attachment_unavailable", "Vids reference preview is unavailable.");
      return await dependencies.vidsVideoAttachment.getPreview(request.payload.preparedBatchId, request.payload.itemId);
    case "vids.video.generateOnce":
      if (!dependencies.vidsVideoGenerate) throw new FoundationOperationError("worker_error", "vids_video_generation_unavailable", "Vids generation is unavailable.");
      return await dependencies.vidsVideoGenerate.generateOnce(request.payload.preparedBatchId, request.payload.itemId);
    case "vids.video.getGenerationStatus":
      if (!dependencies.vidsVideoGenerate) throw new FoundationOperationError("worker_error", "vids_video_generation_unavailable", "Vids generation status is unavailable.");
      return await dependencies.vidsVideoGenerate.get(request.payload.preparedBatchId, request.payload.itemId);
    case "vids.video.recoverPreActivationFailure":
      if (!dependencies.vidsVideoGenerate) throw new FoundationOperationError("worker_error", "vids_video_generation_unavailable", "Vids generation recovery is unavailable.");
      return await dependencies.vidsVideoGenerate.recoverPreActivationFailure(request.payload.expected);
    case "vids.videoQueue.get":
      if (!dependencies.vidsVideoQueue) throw new FoundationOperationError("worker_error", "vids_video_queue_unavailable", "Vids queue is unavailable.");
      return await dependencies.vidsVideoQueue.get(request.payload.preparedBatchId);
    case "vids.videoQueue.start":
      if (!dependencies.vidsVideoQueue) throw new FoundationOperationError("worker_error", "vids_video_queue_unavailable", "Vids queue is unavailable.");
      return await dependencies.vidsVideoQueue.start(request.payload.preparedBatchId);
    case "vids.videoQueue.pause":
    case "vids.videoQueue.resume":
    case "vids.videoQueue.stop":
      if (!dependencies.vidsVideoQueue) throw new FoundationOperationError("worker_error", "vids_video_queue_unavailable", "Vids queue is unavailable.");
      if (request.type === "vids.videoQueue.resume") return await dependencies.vidsVideoQueue.resume(request.payload.preparedBatchId, request.payload.expectedRevision, request.payload.confirmSameAccount);
      return await dependencies.vidsVideoQueue[request.type.slice("vids.videoQueue.".length) as "pause" | "stop"](request.payload.preparedBatchId, request.payload.expectedRevision);
    case "vids.videoQueue.inspectTransition":
      if (!dependencies.vidsVideoQueue) throw new FoundationOperationError("worker_error", "vids_video_queue_unavailable", "Vids queue is unavailable.");
      return await dependencies.vidsVideoQueue.inspectTransition(request.payload.preparedBatchId, request.payload.itemId);
    case "flow.video.inspectReferenceBytes":
      if (!dependencies.flowVideoAttachment?.inspectReferenceBytes) throw new FoundationOperationError("worker_error", "flow_video_attachment_unavailable", "Flow reference inspection is unavailable.");
      return await dependencies.flowVideoAttachment.inspectReferenceBytes(request.payload.preparedBatchId, request.payload.itemId);
    case "flow.video.verifyAttachedReference":
      if (!dependencies.flowVideoAttachment) throw new FoundationOperationError("worker_error", "flow_video_attachment_unavailable", "Flow reference attachment is unavailable.");
      return await dependencies.flowVideoAttachment.verifyAttachedReference(request.payload.preparedBatchId, request.payload.itemId);
    case "flow.video.generateOnce":
      if (!dependencies.flowVideoGenerateOnce) throw new FoundationOperationError("worker_error", "flow_video_generation_unavailable", "Flow video generation is unavailable.");
      return await dependencies.flowVideoGenerateOnce(request.payload.preparedBatchId, request.payload.itemId);
    case "flow.video.getAttachmentStatus":
      if (!dependencies.flowVideoAttachment) throw new FoundationOperationError("worker_error", "flow_video_attachment_unavailable", "Flow reference attachment is unavailable.");
      return await dependencies.flowVideoAttachment.status(request.payload.preparedBatchId, request.payload.itemId);
    case "flow.videoQueue.get":
      if (!dependencies.flowVideoQueue) throw new FoundationOperationError("worker_error", "flow_video_queue_unavailable", "Flow video queue is unavailable.");
      return await dependencies.flowVideoQueue.get(request.payload.preparedBatchId);
    case "flow.videoQueue.start":
      if (!dependencies.flowVideoQueue) throw new FoundationOperationError("worker_error", "flow_video_queue_unavailable", "Flow video queue is unavailable.");
      return await dependencies.flowVideoQueue.start(request.payload.preparedBatchId);
    case "flow.videoQueue.pause":
    case "flow.videoQueue.resume":
    case "flow.videoQueue.stop":
    case "flow.videoQueue.recheckAndResume":
      if (!dependencies.flowVideoQueue) throw new FoundationOperationError("worker_error", "flow_video_queue_unavailable", "Flow video queue is unavailable.");
      return await dependencies.flowVideoQueue[request.type.slice("flow.videoQueue.".length) as "pause" | "resume" | "stop" | "recheckAndResume"](request.payload.preparedBatchId, request.payload.expectedRevision);
    case "flow.videoQueue.reconcilePreAddFailure":
      if (!dependencies.flowVideoQueue) throw new FoundationOperationError("worker_error", "flow_video_queue_unavailable", "Flow video queue is unavailable.");
      return await dependencies.flowVideoQueue.reconcilePreAddFailure(request.payload.preparedBatchId, request.payload.expectedRevision);
    case "flow.video.reconcilePreClickFailure":
      if (!dependencies.flowVideoAttachment) throw new FoundationOperationError("worker_error", "flow_video_attachment_unavailable", "Flow reference attachment is unavailable.");
      return await dependencies.flowVideoAttachment.reconcilePreClickFailure(request.payload);
    case "flow.downloadDiagnostic.arm":
      if (!dependencies.flowDownloadDiagnostic)
        throw new FoundationOperationError("worker_error", "flow_download_diagnostic_unavailable", "The Flow download diagnostic is unavailable in this worker.");
      return await dependencies.flowDownloadDiagnostic.arm(
        request.payload.identityCaptureEnabled ?? false,
      );
    case "flow.downloadDiagnostic.stop":
      if (!dependencies.flowDownloadDiagnostic)
        throw new FoundationOperationError("worker_error", "flow_download_diagnostic_unavailable", "The Flow download diagnostic is unavailable in this worker.");
      return await dependencies.flowDownloadDiagnostic.stop();
    case "flow.downloadDiagnostic.get":
      if (!dependencies.flowDownloadDiagnostic)
        throw new FoundationOperationError("worker_error", "flow_download_diagnostic_unavailable", "The Flow download diagnostic is unavailable in this worker.");
      return await dependencies.flowDownloadDiagnostic.get();
    case "flow.clipImport.importCurrent":
      if (!dependencies.flowDownloadDiagnostic)
        throw new FoundationOperationError("worker_error", "flow_clip_import_unavailable", "Flow clip import is unavailable in this worker.");
      try {
        return await dependencies.flowDownloadDiagnostic.importCurrentClip();
      } catch (error) {
        const rawCode = error instanceof Error ? error.message : "";
        const messages: Record<string, string> = {
          flow_target_not_currently_verified: "Import blocked: the selected Flow project is not currently verified.",
          flow_target_document_changed: "Import blocked: the selected Flow page no longer matches its verified project.",
          flow_clip_detail_route_required: "Open a Flow /edit/ detail view before importing a clip.",
          flow_clip_project_mismatch: "Import blocked: the clip belongs to a different Flow project.",
          flow_clip_document_changed: "Import blocked: the verified Flow document or clip changed during inspection.",
          flow_clip_identity_missing: "Import blocked: the detail page did not expose a clip UUID.",
          flow_clip_route_identity_mismatch: "Import blocked: the detail page clip UUID did not match the current route.",
          flow_clip_import_route_identity_mismatch: "Import blocked: the stored Flow route did not match its project and clip identity.",
        };
        const code = Object.hasOwn(messages, rawCode)
          ? rawCode
          : "flow_clip_import_failed";
        throw new FoundationOperationError(
          "invalid_request",
          code,
          messages[code] ?? "Flow clip import failed validation.",
        );
      }
    case "flow.clipImport.list":
      if (!dependencies.flowDownloadDiagnostic)
        throw new FoundationOperationError("worker_error", "flow_clip_import_unavailable", "Flow clip import is unavailable in this worker.");
      return await dependencies.flowDownloadDiagnostic.listImportedClips();
    case "flow.clipDownload.start": {
      if (!dependencies.flowDownloadDiagnostic?.startClipDownload)
        throw new FoundationOperationError("worker_error", "flow_download_unavailable", "Flow download is unavailable in this build.");
      try {
        return await dependencies.flowDownloadDiagnostic.startClipDownload(request.payload.recordId, request.payload.allowNewAttempt);
      } catch (error) {
        throw flowClipDownloadStartFailure(error);
      }
    }
    case "flow.clipDownloadProof.inspect":
      if (!dependencies.flowDownloadDiagnostic)
        throw new FoundationOperationError("worker_error", "flow_clip_download_proof_unavailable", "Flow clip download proof is unavailable in this worker.");
      return await dependencies.flowDownloadDiagnostic.inspectClipDownloadProof(
        request.payload.recordId,
      );
    case "flow.clipDownloadProof.arm":
      if (!dependencies.flowDownloadDiagnostic)
        throw new FoundationOperationError("worker_error", "flow_clip_download_proof_unavailable", "Flow clip download proof is unavailable in this worker.");
      try {
        return await dependencies.flowDownloadDiagnostic.armClipDownloadProof(
          request.payload.recordId,
        );
      } catch (error) {
        const rawCode = error instanceof Error ? error.message : "";
        const messages: Record<string, string> = {
          flow_diagnostic_already_active: "A Flow one-shot diagnostic is already active. Stop or complete it before arming another.",
          flow_target_not_currently_verified: "Capture blocked: the selected Flow project is not currently verified.",
          flow_target_document_changed: "Capture blocked: the selected Flow tab no longer matches its verified project.",
          flow_clip_import_row_unverified: "Capture blocked: the imported target row is missing or its route is unverified.",
          flow_clip_not_in_single_row_scope: "Capture blocked: this clip is outside the single-row diagnostic scope.",
          flow_clip_project_mismatch: "Capture blocked: the selected Flow project does not match the imported clip row.",
          flow_clip_detail_route_mismatch: "Open the imported target clip's exact verified /edit/ detail route before arming.",
          flow_clip_page_identity_mismatch: "Capture blocked: the detail page did not identify the imported target clip.",
          flow_detail_download_menu_not_ready: "Open the target detail page's bound Download media menu with 1080p Upscaled visible and enabled, then arm again.",
          flow_diagnostic_permissions_missing: "Capture blocked: the required Flow diagnostic permission is unavailable.",
          flow_downloads_api_unavailable: "Capture blocked: Chrome download tracking is unavailable.",
        };
        const code = Object.hasOwn(messages, rawCode)
          ? rawCode
          : "flow_clip_download_proof_arm_failed";
        throw new FoundationOperationError(
          "invalid_request",
          code,
          messages[code] ?? "The one-shot Flow clip diagnostic could not arm.",
        );
      }
  }
}

export class FoundationOperationError extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly code: string,
    message: string,
    readonly stage?: string,
  ) {
    super(message);
    this.name = "FoundationOperationError";
  }
}

const FLOW_CLIP_DOWNLOAD_FAILURE_MESSAGES: Record<string, string> = {
  flow_target_not_currently_verified: "Connect and verify the intended Flow project before preparing this download.",
  flow_target_document_changed: "The verified Flow document changed. Reconnect to the intended project and review the clip route.",
  flow_clip_detail_route_mismatch: "Open this row's exact Flow clip, verify its project connection, then click Download 1080p.",
  flow_clip_import_row_unverified: "Reimport this clip from its verified Flow detail page.",
  flow_clip_project_mismatch: "The imported clip belongs to a different Flow project. Open the matching project before preparing the download.",
  flow_clip_document_changed: "The verified Flow document changed during preparation. Reconnect and review the exact clip before trying again.",
  flow_clip_page_identity_mismatch: "The Flow detail page no longer matches the imported clip. Reopen the exact clip and reimport it.",
  flow_clip_download_preparation_failed: "Download preparation failed before quality input was attempted. Review the exact clip and its 1080p menu before trying again.",
  flow_clip_selected_asset_changed: "The clip, selected asset or menu changed during preparation. Review Flow before starting another attempt.",
  flow_clip_selected_asset_unavailable: "The selected clip asset could not be verified. Review the exact Flow detail page before trying again.",
  flow_clip_download_control_unavailable: "Flow's Download media control could not be verified. Review the exact detail page before trying again.",
  flow_clip_1080p_unavailable: "The 1080p Upscaled option is unavailable. Review the Flow menu before trying again.",
  flow_clip_quality_obscured: "The 1080p Upscaled option could not be safely targeted. Review the Flow menu before trying again.",
  flow_detail_download_menu_not_ready: "The bound Flow download menu was not ready. Reopen the menu and review the clip before trying again.",
  flow_diagnostic_already_active: "A Flow observation or download is already active. Review it or stop observation before starting another clip.",
  flow_download_already_starting: "A Flow download is already being prepared.",
  flow_download_previous_outcome_needs_review: "The previous attempt may have started a download. Review Chrome downloads before explicitly starting another attempt.",
  flow_diagnostic_permissions_missing: "Grant downloads permission and reconnect the intended Flow project.",
  flow_download_dispatch_uncertain: "Quality input may have reached Flow. Review the retained attempt and Chrome downloads before starting another attempt.",
  flow_download_identity_readback_failed: "Quality input was attempted, but Flow identity readback failed. Review the retained attempt and Chrome downloads before starting another attempt.",
};

export function flowClipDownloadStartFailure(error: unknown): FoundationOperationError {
  const code = error instanceof FlowClipDownloadStartError
    ? error.code
    : error instanceof Error
      ? error.message
      : "";
  const failureStage = error instanceof FlowClipDownloadStartError
    ? `${error.stage}_${error.inputAttempted ? "input_attempted" : "input_not_attempted"}`
    : undefined;
  const safeCode = Object.hasOwn(FLOW_CLIP_DOWNLOAD_FAILURE_MESSAGES, code)
    ? code
    : "flow_clip_download_preparation_failed";
  return new FoundationOperationError(
    "worker_error",
    safeCode,
    FLOW_CLIP_DOWNLOAD_FAILURE_MESSAGES[safeCode]!,
    failureStage,
  );
}

export function createConnectionMessageListener(
  extensionId: string,
  dependencies: FoundationDependencies,
) {
  const seenRequestIds = new Set<string>();
  const recentRequestIds: string[] = [];

  return (
    rawRequest: unknown,
    sender: ExtensionMessageSender,
    sendResponse: SendResponse,
  ): true => {
    if (
      rawRequest !== null &&
      typeof rawRequest === "object" &&
      "type" in rawRequest &&
      rawRequest.type === "AUTOMAT_FLOW_GALLERY_DOWNLOAD_DIAGNOSTIC_EVENT"
    ) {
      const diagnostic = dependencies.flowDownloadDiagnostic;
      if (!diagnostic) {
        sendResponse(
          failure(
            "flow-download-diagnostic",
            "unauthorized_sender",
            "flow_download_diagnostic_unavailable",
            "The Flow download diagnostic is unavailable in this worker.",
          ),
        );
        return true;
      }
      void diagnostic
        .ingestPageEvent(rawRequest, sender)
        .then((accepted) => {
          sendResponse({
            protocolVersion: PROTOCOL_VERSION,
            buildId: BUILD_ID,
            requestId: "flow-download-diagnostic",
            ok: true,
            data: { accepted },
          });
        })
        .catch(() => {
          sendResponse(
            failure(
              "flow-download-diagnostic",
              "storage_failure",
              "flow_download_diagnostic_event_failed",
              "The bounded Flow page observation could not be recorded.",
            ),
          );
        });
      return true;
    }
    if (
      rawRequest !== null &&
      typeof rawRequest === "object" &&
      "type" in rawRequest &&
      rawRequest.type === "AUTOMAT_FLOW_IMAGE_OBSERVATION"
    ) {
      if (!dependencies.flowImageObservation) {
        sendResponse(
          failure(
            "flow-observation",
            "unauthorized_sender",
            "flow_observation_unavailable",
            "Flow result observation is unavailable in this worker context.",
          ),
        );
        return true;
      }
      void Promise.resolve(dependencies.ready)
        .then(() => dependencies.flowImageObservation!(rawRequest, sender))
        .then((data) => {
          sendResponse({
            protocolVersion: PROTOCOL_VERSION,
            buildId: BUILD_ID,
            requestId: "flow-observation",
            ok: true,
            data,
          });
        })
        .catch(() => {
          sendResponse(
            failure(
              "flow-observation",
              "storage_failure",
              "flow_observation_failed",
              "Flow result observation could not be safely recorded.",
            ),
          );
        });
      return true;
    }
    if (
      rawRequest !== null &&
      typeof rawRequest === "object" &&
      "type" in rawRequest &&
      rawRequest.type === FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE
    ) {
      if (!dependencies.flowReferenceHandler) {
        sendResponse(
          failure(
            "flow-reference-candidate",
            "unauthorized_sender",
            "reference_selection_unavailable",
            "Reference selection is unavailable in this worker context.",
          ),
        );
        return true;
      }
      void dependencies.flowReferenceHandler
        .handleCandidateSelected(rawRequest, sender)
        .then((result) => {
          if (result.accepted) {
            sendResponse({
              protocolVersion: PROTOCOL_VERSION,
              buildId: BUILD_ID,
              requestId: "flow-reference-candidate",
              ok: true,
              data: result,
            });
          } else {
            sendResponse(
              failure(
                "flow-reference-candidate",
                "invalid_request",
                result.code ?? "candidate_rejected",
                "Reference candidate selection was not accepted.",
              ),
            );
          }
        })
        .catch(() => {
          sendResponse(
            failure(
              "flow-reference-candidate",
              "storage_failure",
              "reference_selection_failed",
              "The reference candidate could not be safely recorded.",
            ),
          );
        });
      return true;
    }
    if (
      rawRequest !== null &&
      typeof rawRequest === "object" &&
      "type" in rawRequest &&
      rawRequest.type === "AUTOMAT_FLOW_REFERENCE_SESSION_CANCELLED"
    ) {
      if (
        dependencies.flowReferenceHandler &&
        "sessionId" in rawRequest &&
        typeof rawRequest.sessionId === "string"
      ) {
        void dependencies.flowReferenceHandler.cancelSelection(
          rawRequest.sessionId,
          "content_banner_cancelled",
        );
      }
      sendResponse({
        protocolVersion: PROTOCOL_VERSION,
        buildId: BUILD_ID,
        requestId: "flow-reference-cancel",
        ok: true,
        data: { cancelled: true },
      });
      return true;
    }
    const parsed = parseRequest(rawRequest);
    if (!parsed.ok) {
      sendResponse(
        failure(
          "invalid-request",
          "invalid_request",
          "invalid_request",
          "The request did not match the supported message schema.",
        ),
      );
      return true;
    }
    const request = parsed.request;
    if (!allowedDashboardSender(sender, extensionId)) {
      sendResponse(
        failure(
          request.requestId,
          "unauthorized_sender",
          "unauthorized_sender",
          "Only the extension dashboard may issue this request.",
        ),
      );
      return true;
    }
    if (request.protocolVersion !== PROTOCOL_VERSION) {
      sendResponse(
        failure(
          request.requestId,
          "protocol_mismatch",
          "protocol_mismatch",
          "The dashboard and worker message protocols do not match.",
        ),
      );
      return true;
    }
    if (request.buildId !== BUILD_ID) {
      sendResponse(
        failure(
          request.requestId,
          "build_mismatch",
          "build_mismatch",
          "The dashboard and worker builds do not match.",
        ),
      );
      return true;
    }
    if (seenRequestIds.has(request.requestId)) {
      sendResponse(
        failure(
          request.requestId,
          "duplicate_request",
          "duplicate_request",
          "A request with this ID is already being handled.",
        ),
      );
      return true;
    }

    seenRequestIds.add(request.requestId);
    recentRequestIds.push(request.requestId);
    if (recentRequestIds.length > 256) {
      seenRequestIds.delete(recentRequestIds.shift()!);
    }
    const readiness = request.type.startsWith("imageQueue.")
      ? (dependencies.timedQueueReady ?? dependencies.ready)
      : dependencies.ready;
    void Promise.resolve(readiness)
      .then(() => dispatch(request, dependencies))
      .then((data) => {
        sendResponse({
          protocolVersion: PROTOCOL_VERSION,
          buildId: BUILD_ID,
          requestId: request.requestId,
          ok: true,
          data,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof FoundationOperationError) {
          sendResponse(
            failure(
              request.requestId,
              error.category,
              error.code,
              error.message,
              error.stage,
            ),
          );
          return;
        }
        if (request.type.startsWith("vids.videoQueue.")) {
          const rawCode = error instanceof Error ? error.message : "";
          const code = /^[a-z0-9_]{1,64}$/.test(rawCode) ? rawCode : "vids_video_queue_operation_failed";
          const stage = request.type.endsWith(".resume") ? "resume_validation" : "queue_operation";
          sendResponse(failure(request.requestId, "storage_failure", code, "The Vids queue could not safely continue. Review the queue stage and reconnect requirements before retrying.", stage));
          return;
        }
        if (request.type.startsWith("imageQueue.")) {
          sendResponse(
            failure(
              request.requestId,
              "storage_failure",
              "image_queue_operation_failed",
              "The timed queue operation could not be safely completed.",
              request.type === "imageQueue.inspectReadback" ||
                request.type === "imageQueue.retryBlocked"
                ? "editor_readback"
                : undefined,
            ),
          );
          return;
        }
        sendResponse(
          failure(
            request.requestId,
            "storage_failure",
            "operation_failed",
            "The extension could not complete this local operation.",
          ),
        );
      });
    return true;
  };
}

function parseRequest(
  rawRequest: unknown,
): { ok: true; request: AppRequest } | { ok: false } {
  // Kept local so invalid payloads never leak Zod's value-bearing diagnostics.
  const result = AppRequestSchema.safeParse(rawRequest);
  return result.success ? { ok: true, request: result.data } : { ok: false };
}
