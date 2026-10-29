export function flowReadinessReasonLabel(
  status: unknown,
  reason: unknown,
): string {
  if (typeof reason === "string" && reason) return reason;
  return status === "ready" ? "none" : "readiness_result_unavailable";
}
