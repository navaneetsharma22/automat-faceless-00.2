import { BUILD_ID, PROTOCOL_VERSION } from "./buildInfo";
import type { AppRequest } from "./schemas";

export { BUILD_ID, PROTOCOL_VERSION };
export const FOUNDATION_WORKER_RESTARTED =
  "AUTOMAT_FOUNDATION_WORKER_RESTARTED";
export const CONNECTION_STATE_CHANGED_MESSAGE =
  "AUTOMAT_CONNECTION_STATE_CHANGED";
export {
  AppRequestSchema,
  AppResponseSchema,
  PromptBatchSnapshotSchema,
} from "./schemas";
export type { AppRequest, AppResponse, FailureCategory } from "./schemas";

export type RequestPayloads = {
  "foundation.ping": Record<string, never>;
  "promptDraft.put": { id: string; kind: "image" | "video"; rawText: string };
  "promptDraft.get": { id: string };
  "promptBatch.put": {
    workspaceId: string;
    kind: "image" | "video";
    sourceText: string;
  };
  "promptBatch.get": { workspaceId: string; kind: "image" | "video" };
  "imageQueue.createTimed": {
    workspaceId: string;
    queueId: string;
    settingsConfirmation: {
      confirmationId: string;
      confirmedAt: number;
      tabId: number;
      projectId: string;
      canonicalTarget: string;
      declaredVariantCount: number;
    };
  };
  "imageQueue.get": { queueId: string };
  "imageQueue.start": { queueId: string };
  "imageQueue.pause": { queueId: string; expectedRevision: number };
  "imageQueue.resume": { queueId: string; expectedRevision: number };
  "imageQueue.stop": { queueId: string; expectedRevision: number };
  "imageQueue.list": { workspaceId: string };
  "imageQueue.inspectReadback": { queueId: string; order?: number };
  "imageQueue.retryBlocked": {
    queueId: string;
    expectedRevision: number;
    order: number;
  };
  "connections.recordSelection": {
    provider: "Flow" | "Vids";
    tabId: number;
    canonicalTarget: string;
  };
  "connections.getSelection": { provider: "Flow" | "Vids" };
  "connections.revalidate": {
    provider: "Flow" | "Vids";
    enableReconnect?: boolean;
  };
  "connections.setReconnectIntent": {
    provider: "Flow" | "Vids";
    enabled: boolean;
  };
  "flow.prompt.fill": { workspaceId: string; promptHash: string };
  "flow.image.generateOnce": {
    workspaceId: string;
    promptHash: string;
    settingsConfirmation: {
      confirmationId: string;
      confirmedAt: number;
      tabId: number;
      projectId: string;
      canonicalTarget: string;
      declaredVariantCount: number;
    };
    countMode:
      | {
          mode: "new_empty_project";
          countSessionId: string;
          startingImageCount: 0;
        }
      | {
          mode: "existing_project";
          countSessionId: string;
          startingImageCount: number;
          userConfirmed: true;
        };
  };
  "flow.image.checkReadiness": {
    countMode:
      | {
          mode: "new_empty_project";
          countSessionId: string;
          startingImageCount: 0;
        }
      | {
          mode: "existing_project";
          countSessionId: string;
          startingImageCount: number;
          userConfirmed: boolean;
        };
  };
  "flow.image.getCountDecision": { attemptId: string };
  "flow.image.inspectCountBlockers": Record<string, never>;
  "flow.image.rebaselineForNewPrompt": {
    oldAttemptId: string;
    workspaceId: string;
    promptHash: string;
    countSessionId: string;
    startingImageCount: number;
    userConfirmed: true;
  };
  "preferences.getTheme": Record<string, never>;
  "preferences.setTheme": { theme: "light" | "dark" };
  "flow.reference.startSelection": {
    workspaceId: string;
    batchId: string;
    shotId: string;
  };
  "flow.reference.cancelSelection": { sessionId: string };
  "flow.reference.getState": { workspaceId: string };
  "flow.reference.clearCandidate": { workspaceId: string; shotId: string };
  "flow.reference.listCandidates": { sessionId: string };
  "flow.reference.chooseCandidate": {
    sessionId: string;
    candidateId: string;
  };
  "flow.reference.getPreview": {
    sessionId: string;
    candidateId: string;
    previewId: string;
  };
  "flow.reference.cancelPreview": { sessionId: string; previewId: string };
};

export type RequestTypes = keyof RequestPayloads;

export type MessageTransport = {
  sendMessage: (message: AppRequest) => Promise<unknown>;
};

export type FoundationClientOptions = {
  buildId?: string;
  timeoutMs?: Partial<Record<RequestTypes, number>>;
  onPending?: (requestId: string, type: RequestTypes) => void;
  makeRequestId?: () => string;
};

export const DEFAULT_TIMEOUT_MS: Record<RequestTypes, number> = {
  "foundation.ping": 3000,
  "promptDraft.put": 15000,
  "promptDraft.get": 5000,
  "promptBatch.put": 30_000,
  "promptBatch.get": 30_000,
  "imageQueue.createTimed": 30_000,
  "imageQueue.get": 10_000,
  "imageQueue.start": 30_000,
  "imageQueue.pause": 10_000,
  "imageQueue.resume": 30_000,
  "imageQueue.stop": 10_000,
  "imageQueue.list": 10_000,
  "imageQueue.inspectReadback": 15_000,
  "imageQueue.retryBlocked": 30_000,
  "connections.recordSelection": 5000,
  "connections.getSelection": 5000,
  "connections.revalidate": 10_000,
  "connections.setReconnectIntent": 5000,
  "flow.prompt.fill": 20_000,
  "flow.image.generateOnce": 30_000,
  "flow.image.checkReadiness": 15_000,
  "flow.image.getCountDecision": 10_000,
  "flow.image.inspectCountBlockers": 10_000,
  "flow.image.rebaselineForNewPrompt": 20_000,
  "preferences.getTheme": 3000,
  "preferences.setTheme": 3000,
  "flow.reference.startSelection": 15_000,
  "flow.reference.cancelSelection": 5000,
  "flow.reference.getState": 5000,
  "flow.reference.clearCandidate": 5000,
  "flow.reference.listCandidates": 10_000,
  "flow.reference.chooseCandidate": 10_000,
  "flow.reference.getPreview": 15_000,
  "flow.reference.cancelPreview": 5000,
};

export function makeRequest<T extends RequestTypes>(
  type: T,
  payload: RequestPayloads[T],
  requestId: string,
  buildId: string = BUILD_ID,
): AppRequest {
  return {
    protocolVersion: PROTOCOL_VERSION,
    buildId,
    requestId,
    type,
    payload,
  } as AppRequest;
}
