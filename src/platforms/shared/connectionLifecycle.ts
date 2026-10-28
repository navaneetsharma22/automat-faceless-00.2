import { BUILD_ID } from "../../shared/buildInfo";
import { FOUNDATION_WORKER_RESTARTED } from "../../shared/messages";
import type { ProviderName } from "./contracts";

const providers: readonly ProviderName[] = ["Flow", "Vids"];

export function handleWorkerRestart(
  message: unknown,
  invalidate: (
    provider: ProviderName,
    status: "disconnected" | "stale-build",
    message: string,
  ) => void,
): boolean {
  if (
    !message ||
    typeof message !== "object" ||
    !("type" in message) ||
    message.type !== FOUNDATION_WORKER_RESTARTED
  ) {
    return false;
  }
  const workerBuildId =
    "buildId" in message && typeof message.buildId === "string"
      ? message.buildId
      : "";
  for (const provider of providers) {
    invalidate(
      provider,
      workerBuildId === BUILD_ID ? "disconnected" : "stale-build",
      workerBuildId === BUILD_ID
        ? "Disconnected · extension worker restarted. Reconnect to verify the selected project."
        : "Stale build · the extension worker build changed. Reopen this dashboard and reconnect.",
    );
  }
  return true;
}
