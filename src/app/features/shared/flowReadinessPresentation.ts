import type { FlowImageReadinessMode } from "../../../domain/jobs/results";

export function flowReadinessReasonLabel(
  status: unknown,
  reason: unknown,
): string {
  if (typeof reason === "string" && reason) return reason;
  return status === "ready" ? "none" : "readiness_result_unavailable";
}

export function flowReadinessModeFromInput(input: {
  mode: "new_empty_project" | "existing_project";
  countSessionId: string;
  startingImageCountText: string;
  userConfirmed: boolean;
}): FlowImageReadinessMode | undefined {
  if (input.mode === "new_empty_project")
    return {
      mode: "new_empty_project",
      countSessionId: input.countSessionId,
      startingImageCount: 0,
    };
  const normalized = input.startingImageCountText.trim();
  if (!normalized) return undefined;
  const startingImageCount = Number(normalized);
  if (
    !Number.isInteger(startingImageCount) ||
    startingImageCount < 0 ||
    startingImageCount > 100_000
  )
    return undefined;
  return {
    mode: "existing_project",
    countSessionId: input.countSessionId,
    startingImageCount,
    userConfirmed: input.userConfirmed,
  };
}
