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
} from "../../storage/repositories";

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
};

export type SendResponse = (response: AppResponse) => void;

function failure(
  requestId: string,
  category: FailureCategory,
  code: string,
  message: string,
): AppResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    buildId: BUILD_ID,
    requestId,
    ok: false,
    error: { category, code, message },
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
    case "imageQueue.list":
      return dependencies.repositories.listTimedImageSubmissionQueues(
        request.payload.workspaceId,
      );
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
  }
}

export class FoundationOperationError extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
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
    void Promise.resolve(dependencies.ready)
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
