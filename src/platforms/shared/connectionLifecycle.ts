import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import { FOUNDATION_WORKER_RESTARTED } from "../../shared/messages";
import { isSameProviderTargetUrl } from "./connection";
import type { ProviderTab } from "./contracts";

export type WorkerStartEvent = {
  buildId: string;
  workerInstanceId: string;
  protocolVersion: number;
};

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
