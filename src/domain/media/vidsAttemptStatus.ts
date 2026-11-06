import type { VidsDownloadAttempt } from "./combinedExport";

function boundedEvidence(attempt: VidsDownloadAttempt): string {
  const values = [
    attempt.failureStage ? `stage: ${attempt.failureStage}` : undefined,
    attempt.failureCode ? `reason: ${attempt.failureCode}` : undefined,
  ].filter(Boolean);
  return values.length ? ` (${values.join("; ")})` : "";
}

/** Describe a Vids review state only from evidence actually persisted on that attempt. */
export function getVidsNeedsReviewHelp(attempt: VidsDownloadAttempt): string {
  const operationName = attempt.operationName;
  const evidence = boundedEvidence(attempt);

  if (attempt.failureCode === "authorization_expired" || attempt.failureCode === "access_denied" || attempt.failureCode === "api_or_file_access_denied") {
    if (operationName && attempt.failureStage === "operation_poll") {
      return `Authorization or file access failed while checking Drive operation ${operationName}${evidence}. After manually restoring authorization for the same account, use the helper's existing Continue checking operation control for this ID. It checks this operation only; do not prepare again.`;
    }
    if (!operationName && attempt.failureStage === "files_download_response") {
      return `Drive authorization or file access was rejected${evidence}. No operation was accepted; this attempt will not be replayed.`;
    }
    if (!operationName) {
      return `Drive authorization or file access failed${evidence}, and no Drive operation ID is present. The remaining outcome evidence is incomplete; do not prepare again.`;
    }
    return `Drive authorization or file access failed${evidence}. The existing attempt will not be replayed.`;
  }

  if (!operationName && ["operation_observation_lost", "operation_timeout"].includes(attempt.reason ?? "")) {
    return `No Drive operation ID is present in this attempt. Historical preparation evidence is missing, so the outcome is unknown${evidence}. Do not prepare again.`;
  }

  switch (attempt.reason) {
    case "preparation_rejected":
      return `Drive rejected the preparation request${evidence}. No operation was accepted; this attempt will not be replayed.`;
    case "preparation_outcome_uncertain":
      return `The preparation request may have reached Drive${evidence}. No replacement preparation is allowed; the outcome remains under review.`;
    case "operation_observation_lost":
      if (operationName && attempt.failureStage === "operation_poll" &&
        ["transport_unavailable", "transport_uncertain"].includes(attempt.failureCode ?? "")) {
        return `Polling transport failed for Drive operation ${operationName}${evidence}. Use the helper's existing Continue checking operation control to check this same ID; do not prepare again.`;
      }
      return operationName
        ? `Drive operation ${operationName} could not be checked${evidence}. Continue only through the helper's same-operation check; do not prepare again.`
        : `No Drive operation ID is recorded. Historical evidence is missing and this attempt's outcome is unknown${evidence}. Do not prepare again.`;
    case "operation_timeout":
      return operationName
        ? `Polling timed out for Drive operation ${operationName}${evidence}. Continue checking this same operation in the helper; do not prepare again.`
        : `No Drive operation ID is recorded. Historical evidence is missing and this attempt's outcome is unknown${evidence}. Do not prepare again.`;
    case "operation_failed":
      return operationName
        ? `Drive reported that operation ${operationName} failed${evidence}. This attempt will not be replayed.`
        : `Drive reported a failed operation, but no operation ID is present. Historical evidence is incomplete${evidence}; do not prepare again.`;
    case "invalid_download_uri":
      return operationName
        ? `Operation ${operationName} completed without a usable download destination${evidence}. This attempt will not be replayed.`
        : `The completed operation has no recorded ID or usable download destination${evidence}. Do not prepare again.`;
    case "invalid_operation":
      return `The preparation operation response was invalid${evidence}. Its result needs review; do not prepare again.`;
    case "dispatch_uncertain":
      return "The handoff result is uncertain. Check this attempt and Chrome Downloads before taking another action; it will not be replayed.";
    case "connection_changed":
      return "The verified Vids document changed during preparation. This attempt will not be replayed.";
    case "download_interrupted":
      return "Chrome interrupted this download. Review the exact Chrome download; it will not be restarted automatically.";
    default:
      return operationName
        ? `This attempt needs review. Drive operation ${operationName} is recorded; do not prepare again.`
        : "This attempt needs review. No Drive operation ID is recorded, so its historical outcome is unknown. Do not prepare again.";
  }
}
