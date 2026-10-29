import { BUILD_ID, PROTOCOL_VERSION } from "./buildInfo";
import type { AppRequest } from "./schemas";

export { BUILD_ID, PROTOCOL_VERSION };
export const FOUNDATION_WORKER_RESTARTED =
  "AUTOMAT_FOUNDATION_WORKER_RESTARTED";
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
  "connections.recordSelection": {
    provider: "Flow" | "Vids";
    tabId: number;
    canonicalTarget: string;
  };
  "connections.getSelection": { provider: "Flow" | "Vids" };
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
  };
  "flow.image.checkReadiness": Record<string, never>;
  "preferences.getTheme": Record<string, never>;
  "preferences.setTheme": { theme: "light" | "dark" };
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
  "connections.recordSelection": 5000,
  "connections.getSelection": 5000,
  "connections.setReconnectIntent": 5000,
  "flow.prompt.fill": 20_000,
  "flow.image.generateOnce": 30_000,
  "flow.image.checkReadiness": 15_000,
  "preferences.getTheme": 3000,
  "preferences.setTheme": 3000,
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
