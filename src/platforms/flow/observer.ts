import {
  FlowImageResultBaselineSchema,
  type FlowImageResultBaseline,
} from "../../domain/jobs/results";

export type FlowImageGalleryBaseline = {
  regionLabel: string;
  mediaCount: number;
  capturedAt: number;
};

export type FlowEmptyWorkspaceBaseline = {
  kind: "flow_empty_workspace_ui";
  workspaceTag: "flow-project-page";
  markerPhrase: "Start creating or drop media";
  markerCount: 1;
  visibleMediaCount: 0;
  visibleResultCardCount: 0;
  loadingMarkerCount: 0;
  capturedAt: number;
};

export type FlowRenderedTileCandidateBaseline = {
  kind: "flow_rendered_tile_candidates";
  workspaceTag: "flow-project-page";
  renderedTileCount: number;
  candidateIds: string[];
  candidateMultiplicity: Array<{
    candidateId: string;
    renderedCopies: number;
  }>;
  repeatedCandidateCount: number;
  unidentifiedImageCount: number;
  unrelatedImageCount: number;
  virtualScrollContainerCount?: number;
  virtualizationEvidence?: Array<
    | "scroll_extent_exceeds_viewport"
    | "nonzero_scroll_offset"
    | "viewport_dimensions_unavailable"
    | "scroll_observed_during_capture"
    | "tile_identity_recycled"
  >;
  virtualized: boolean;
  loadingSignalCount: number;
  captureGaps: string[];
  capturedAt: number;
};

/** P04 UI observations are retained without claiming result identity. */
export type FlowImageBaseline =
  | FlowImageGalleryBaseline
  | FlowEmptyWorkspaceBaseline
  | FlowRenderedTileCandidateBaseline;

export type FlowResultBaselineBinding = FlowImageResultBaseline["binding"];

/**
 * Bind an existing P04 observation to the exact current attempt. This function
 * captures no new DOM evidence and introduces no provider selectors.
 */
export function captureFlowResultBaseline(
  profile: FlowImageBaseline,
  binding: FlowResultBaselineBinding,
  provenance: { buildId: string; protocolVersion: number },
  declaredVariantCount?: number,
): FlowImageResultBaseline {
  const isEmpty =
    "kind" in profile && profile.kind === "flow_empty_workspace_ui";
  const isPopulated =
    "kind" in profile && profile.kind === "flow_rendered_tile_candidates";
  const baseline: FlowImageResultBaseline = {
    schemaVersion: 1,
    binding,
    capture: {
      method: "flow_image_runtime_observation",
      capturedAt: profile.capturedAt,
      buildId: provenance.buildId,
      protocolVersion: provenance.protocolVersion,
    },
    observation: isEmpty
      ? {
          profile: "flow_empty_workspace_ui",
          profileVersion: 1,
          workspaceTag: profile.workspaceTag,
          markerPhrase: profile.markerPhrase,
          markerCount: profile.markerCount,
          visibleMediaCount: profile.visibleMediaCount,
          visibleResultCardCount: profile.visibleResultCardCount,
          loadingMarkerCount: profile.loadingMarkerCount,
        }
      : isPopulated
        ? {
            profile: "flow_rendered_tile_candidates",
            profileVersion: 1,
            renderedTileCount: profile.renderedTileCount,
            candidateIds: profile.candidateIds,
            candidateMultiplicity: profile.candidateMultiplicity,
            repeatedCandidateCount: profile.repeatedCandidateCount,
            unidentifiedImageCount: profile.unidentifiedImageCount,
            unrelatedImageCount: profile.unrelatedImageCount,
            virtualScrollContainerCount:
              profile.virtualScrollContainerCount ?? 0,
            virtualizationEvidence: profile.virtualizationEvidence ?? [],
            virtualized: profile.virtualized,
            loadingSignalCount: profile.loadingSignalCount,
            captureGaps: profile.captureGaps,
          }
        : "regionLabel" in profile
          ? {
              profile: "flow_labelled_results_region",
              profileVersion: 1,
              regionLabel: profile.regionLabel,
              observedMediaCount: profile.mediaCount,
            }
          : {
              profile: "flow_labelled_results_region",
              profileVersion: 1,
              regionLabel: "unknown",
              observedMediaCount: 0,
            },
    completeness: isEmpty ? "complete_for_observed_empty_ui" : "incomplete",
    existingResultIdentities: [],
    excludedObservations: {
      count: isEmpty
        ? 0
        : isPopulated
          ? profile.candidateIds.length
          : "mediaCount" in profile
            ? profile.mediaCount
            : 0,
      reasons: isEmpty
        ? []
        : [
            "stable_provider_identity_unavailable",
            "result_card_identity_unavailable",
          ],
    },
    variantDeclaration:
      declaredVariantCount === undefined
        ? { status: "absent" }
        : {
            status: "declared",
            count: declaredVariantCount,
            source: "validated_settings_confirmation",
          },
    limitations: isEmpty
      ? [
          "selected_workspace_scope_only",
          "provider_database_emptiness_not_proven",
          "provider_result_identity_contract_not_live_verified",
          "closed_shadow_roots_and_other_documents_not_inspected",
        ]
      : isPopulated
        ? [
            "provider_result_identity_contract_not_live_verified",
            "result_card_identity_not_observed",
            "rendered_candidate_identity_unverified",
            "rendered_tile_inventory_incomplete",
            "closed_shadow_roots_and_other_documents_not_inspected",
          ]
        : [
            "provider_result_identity_contract_not_live_verified",
            "result_card_identity_not_observed",
            "media_count_is_not_unique_asset_count",
            "closed_shadow_roots_and_other_documents_not_inspected",
          ],
  };
  return FlowImageResultBaselineSchema.parse(baseline);
}
