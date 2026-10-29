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

/** P04 UI observations are retained without claiming result identity. */
export type FlowImageBaseline =
  FlowImageGalleryBaseline | FlowEmptyWorkspaceBaseline;

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
  const emptyProfile = "kind" in profile;
  const baseline: FlowImageResultBaseline = {
    schemaVersion: 1,
    binding,
    capture: {
      method: "flow_image_runtime_observation",
      capturedAt: profile.capturedAt,
      buildId: provenance.buildId,
      protocolVersion: provenance.protocolVersion,
    },
    observation: emptyProfile
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
      : {
          profile: "flow_labelled_results_region",
          profileVersion: 1,
          regionLabel: profile.regionLabel,
          observedMediaCount: profile.mediaCount,
        },
    completeness: emptyProfile
      ? "complete_for_observed_empty_ui"
      : "incomplete",
    existingResultIdentities: [],
    excludedObservations: {
      count: emptyProfile ? 0 : profile.mediaCount,
      reasons: emptyProfile
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
    limitations: emptyProfile
      ? [
          "selected_workspace_scope_only",
          "provider_database_emptiness_not_proven",
          "provider_result_identity_contract_not_live_verified",
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
