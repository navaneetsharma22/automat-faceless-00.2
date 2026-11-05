export const FLOW_1080P_PROOF_CLIP_ID =
  "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa";

export type FlowClipDownloadBlocker =
  | "clip_not_in_single_row_scope"
  | "imported_row_missing_or_unverified"
  | "project_not_currently_verified"
  | "detail_route_missing_or_changed"
  | "page_clip_identity_mismatch"
  | "detail_download_control_not_found"
  | "detail_download_control_semantics_unverified"
  | "output_clip_identity_unverified";

export function isFlow1080pProofClip(clipId: string): boolean {
  return clipId.toLowerCase() === FLOW_1080P_PROOF_CLIP_ID;
}

/** Saved requires exact output identity and completed browser file evidence. */
export function canMarkFlowClipDownloadSaved(input: {
  selectedProjectId: string;
  selectedClipId: string;
  outputProjectId?: string;
  outputClipId?: string;
  completedMp4: boolean;
}): boolean {
  return (
    input.completedMp4 &&
    input.selectedProjectId === input.outputProjectId &&
    input.selectedClipId.toLowerCase() === input.outputClipId?.toLowerCase()
  );
}
