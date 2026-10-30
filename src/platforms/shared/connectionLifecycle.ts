import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import {
  CONNECTION_STATE_CHANGED_MESSAGE,
  FOUNDATION_WORKER_RESTARTED,
} from "../../shared/messages";
import { isSameProviderTargetUrl } from "./connection";
import type { ProviderTab } from "./contracts";

export type WorkerStartEvent = {
  buildId: string;
  workerInstanceId: string;
  protocolVersion: number;
};

export type ConnectionStateChangedEvent = {
  provider: "Flow" | "Vids";
  state:
    | "checking"
    | "verified"
    | "temporarily-unreachable"
    | "stale-document"
    | "stale-build"
    | "disconnected";
  reason: string;
};

export function readConnectionStateChangedEvent(
  message: unknown,
): ConnectionStateChangedEvent | undefined {
  if (!message || typeof message !== "object") return undefined;
  const event = message as Record<string, unknown>;
  if (
    event.type !== CONNECTION_STATE_CHANGED_MESSAGE ||
    event.buildId !== BUILD_ID ||
    event.protocolVersion !== PROTOCOL_VERSION ||
    (event.provider !== "Flow" && event.provider !== "Vids") ||
    ![
      "checking",
      "verified",
      "temporarily-unreachable",
      "stale-document",
      "stale-build",
      "disconnected",
    ].includes(String(event.state)) ||
    typeof event.reason !== "string" ||
    !/^[a-z0-9_]{1,64}$/.test(event.reason)
  )
    return undefined;
  return {
    provider: event.provider,
    state: event.state as ConnectionStateChangedEvent["state"],
    reason: event.reason,
  };
}

export function readWorkerStartEvent(
  message: unknown,
): WorkerStartEvent | undefined {
  if (
    !message ||
    typeof message !== "object" ||
    !("type" in message) ||
    message.type !== FOUNDATION_WORKER_RESTARTED ||
    !("buildId" in message) ||
    typeof message.buildId !== "string" ||
    !("workerInstanceId" in message) ||
    typeof message.workerInstanceId !== "string" ||
    message.workerInstanceId.length === 0 ||
    !("protocolVersion" in message) ||
    typeof message.protocolVersion !== "number"
  ) {
    return undefined;
  }
  return {
    buildId: message.buildId,
    workerInstanceId: message.workerInstanceId,
    protocolVersion: message.protocolVersion,
  };
}

export function isCurrentWorkerStart(event: WorkerStartEvent): boolean {
  return (
    event.buildId === BUILD_ID && event.protocolVersion === PROTOCOL_VERSION
  );
}

export function workerStartAction(
  hasSavedTarget: boolean,
  reconnectEnabled: boolean,
): "verify" | "preserve_disconnected" | "no_target" {
  if (!hasSavedTarget) return "no_target";
  return reconnectEnabled ? "verify" : "preserve_disconnected";
}

export function isCurrentConnectionAttempt(
  currentRevision: number,
  attemptRevision: number,
  reconnectEnabled: boolean,
): boolean {
  return currentRevision === attemptRevision && reconnectEnabled;
}

export function providerDocumentNeedsReverification(
  selected: ProviderTab,
  changeInfo: { url?: string; status?: string },
): boolean {
  if (changeInfo.status === "loading") return true;
  return Boolean(
    changeInfo.url && !isSameProviderTargetUrl(selected, changeInfo.url),
  );
}
