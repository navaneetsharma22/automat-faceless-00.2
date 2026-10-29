import { describe, expect, it } from "vitest";
import { flowImagePromptSnapshotId } from "../../src/domain/batches/flowImagePromptSnapshot";
import { flowImageAttemptActiveKey } from "../../src/domain/jobs/attempt";
import {
  classifyFlowResultObservations,
  FlowImageResultBaselineSchema,
  flowProviderResultIdentityKey,
  flowResultBaselineMatchesAttempt,
  flowResultBaselineMatchesProfile,
  type FlowImageResultBaseline,
  type FlowProviderResultIdentity,
} from "../../src/domain/jobs/results";
import { captureFlowResultBaseline } from "../../src/platforms/flow/observer";
import { FlowImageAttemptRecordSchema } from "../../src/shared/schemas";

const binding = {
  workspaceId: "workspace-test",
  batchId: "batch-test",
  itemId: "item-test",
  sourceHash: "a".repeat(64),
  sourceSnapshotId: flowImagePromptSnapshotId("item-test", "a".repeat(64)),
  attemptId: "attempt-test",
  provider: "Flow" as const,
  projectId: "project-test",
  tabId: 7,
  frameId: "frame-test",
  loaderId: "loader-test",
};
const provenance = { buildId: "build-test", protocolVersion: 1 };

function emptyBaseline(): FlowImageResultBaseline {
  return captureFlowResultBaseline(
    {
      kind: "flow_empty_workspace_ui",
      workspaceTag: "flow-project-page",
      markerPhrase: "Start creating or drop media",
      markerCount: 1,
      visibleMediaCount: 0,
      visibleResultCardCount: 0,
      loadingMarkerCount: 0,
      capturedAt: 1_000,
    },
    binding,
    provenance,
  );
}

function candidate(
  identity?: FlowProviderResultIdentity,
  overrides: Record<string, unknown> = {},
) {
  return {
    binding,
    ...(identity ? { identity } : {}),
    ...overrides,
  };
}

describe("P05.1 Flow result baseline and conservative attribution", () => {
  it("captures the evidenced empty workspace UI as scoped and explicitly limited", () => {
    const baseline = emptyBaseline();
    expect(FlowImageResultBaselineSchema.parse(baseline)).toMatchObject({
      binding,
      observation: {
        profile: "flow_empty_workspace_ui",
        markerPhrase: "Start creating or drop media",
      },
      completeness: "complete_for_observed_empty_ui",
      existingResultIdentities: [],
      variantDeclaration: { status: "absent" },
      limitations: expect.arrayContaining([
        "selected_workspace_scope_only",
        "provider_database_emptiness_not_proven",
      ]),
    });
  });

  it("does not promote unavailable or labelled media-count observations to a complete empty baseline", () => {
    const baseline = captureFlowResultBaseline(
      { regionLabel: "Generated results", mediaCount: 3, capturedAt: 1_000 },
      binding,
      provenance,
    );
    expect(baseline.completeness).toBe("incomplete");
    expect(baseline.existingResultIdentities).toEqual([]);
    expect(baseline.excludedObservations.count).toBe(3);
    expect(
      FlowImageResultBaselineSchema.safeParse({
        ...emptyBaseline(),
        completeness: "incomplete",
      }).success,
    ).toBe(false);
    expect(
      classifyFlowResultObservations(undefined, [
        candidate({
          kind: "asset_id",
          projectId: binding.projectId,
          assetId: "unavailable-baseline-candidate",
        }),
      ]),
    ).toMatchObject([
      { classification: "ambiguous_identity", reason: "candidate_invalid" },
    ]);
    expect(
      FlowImageResultBaselineSchema.safeParse({
        ...emptyBaseline(),
        observation: {
          profile: "flow_labelled_results_region",
          profileVersion: 1,
          regionLabel: "Generated results",
          observedMediaCount: 0,
        },
        completeness: "complete_for_observed_empty_ui",
      }).success,
    ).toBe(false);
  });

  it("keeps old result identities as baseline when lazy assets load after capture", () => {
    const captured = captureFlowResultBaseline(
      { regionLabel: "Generated results", mediaCount: 1, capturedAt: 1_000 },
      binding,
      provenance,
    );
    const baseline = {
      ...captured,
      existingResultIdentities: [
        {
          kind: "asset_id" as const,
          projectId: binding.projectId,
          assetId: "old-asset",
        },
      ],
    };
    const observations = classifyFlowResultObservations(baseline, [
      candidate(
        {
          kind: "asset_id",
          projectId: binding.projectId,
          assetId: "old-asset",
        },
        { observedAfterDispatch: true },
      ),
    ]);
    expect(observations[0]?.classification).toBe("baseline");
  });

  it("deduplicates rerendered identities but preserves distinct declared variants", () => {
    const same = {
      kind: "asset_id" as const,
      projectId: binding.projectId,
      assetId: "asset-new",
    };
    const variants = [
      {
        kind: "group_variant_id" as const,
        projectId: binding.projectId,
        groupId: "group",
        variantId: "v1",
      },
      {
        kind: "group_variant_id" as const,
        projectId: binding.projectId,
        groupId: "group",
        variantId: "v2",
      },
    ];
    const repeated = classifyFlowResultObservations(emptyBaseline(), [
      candidate(same),
      candidate(same, { observedAfterDispatch: true }),
    ]);
    expect(repeated.map((entry) => entry.classification)).toEqual([
      "new_candidate",
      "excluded",
    ]);
    expect(repeated[1]).toMatchObject({
      reason: "duplicate_logical_identity",
      duplicateOfIndex: 0,
    });
    const reordered = classifyFlowResultObservations(emptyBaseline(), [
      candidate({
        kind: "asset_id",
        projectId: binding.projectId,
        assetId: "other",
      }),
      candidate(same),
      candidate(same, { observedAfterDispatch: true }),
    ]);
    expect(reordered.map((entry) => entry.classification)).toEqual([
      "new_candidate",
      "new_candidate",
      "excluded",
    ]);
    expect(flowProviderResultIdentityKey(variants[0]!)).not.toBe(
      flowProviderResultIdentityKey(variants[1]!),
    );
    expect(
      classifyFlowResultObservations(
        emptyBaseline(),
        variants.map((identity) => candidate(identity)),
      ),
    ).toHaveLength(2);
  });

  it("excludes another project and any mismatched workspace, project, document, or attempt", () => {
    const identity = {
      kind: "asset_id" as const,
      projectId: binding.projectId,
      assetId: "asset",
    };
    const wrongProject = candidate({
      ...identity,
      projectId: "another-project",
    });
    const wrongTab = candidate(identity, {
      binding: { ...binding, tabId: binding.tabId + 1 },
    });
    const wrongFrame = candidate(identity, {
      binding: { ...binding, frameId: "stale-frame" },
    });
    const wrongLoader = candidate(identity, {
      binding: { ...binding, loaderId: "stale-loader" },
    });
    const wrongSource = candidate(identity, {
      binding: { ...binding, sourceHash: "c".repeat(64) },
    });
    const wrongSnapshot = candidate(identity, {
      binding: { ...binding, sourceSnapshotId: "stale-snapshot" },
    });
    const wrongAttempt = candidate(identity, {
      binding: { ...binding, attemptId: "stale-attempt" },
    });
    expect(
      classifyFlowResultObservations(emptyBaseline(), [
        wrongProject,
        wrongTab,
        wrongFrame,
        wrongLoader,
        wrongSource,
        wrongSnapshot,
        wrongAttempt,
      ]).map((entry) => entry.classification),
    ).toEqual([
      "excluded",
      "excluded",
      "excluded",
      "excluded",
      "excluded",
      "excluded",
      "excluded",
    ]);
  });

  it("keeps missing or colliding identities ambiguous and rejects URL or positional substitutes", () => {
    const missing = candidate();
    const urlIdentity = candidate({
      kind: "asset_id",
      projectId: binding.projectId,
      assetId: "https://media.test/image.png",
    } as never);
    const extraPosition = {
      ...candidate({
        kind: "asset_id",
        projectId: binding.projectId,
        assetId: "asset",
      }),
      cardIndex: 0,
    };
    expect(
      classifyFlowResultObservations(emptyBaseline(), [
        missing,
        urlIdentity,
        extraPosition,
      ]),
    ).toMatchObject([
      {
        classification: "ambiguous_identity",
        reason: "stable_identity_missing",
      },
      { classification: "ambiguous_identity", reason: "candidate_invalid" },
      { classification: "ambiguous_identity", reason: "candidate_invalid" },
    ]);
  });

  it("blocks non-baseline attribution while the baseline inventory is incomplete", () => {
    const incomplete = captureFlowResultBaseline(
      { regionLabel: "Generated results", mediaCount: 2, capturedAt: 1_000 },
      binding,
      provenance,
    );
    expect(
      classifyFlowResultObservations(incomplete, [
        candidate({
          kind: "asset_id",
          projectId: binding.projectId,
          assetId: "new",
        }),
      ]),
    ).toMatchObject([
      { classification: "excluded", reason: "baseline_inventory_incomplete" },
    ]);
  });

  it("requires attempt and immutable snapshot proof; post-dispatch timing alone is only a candidate", () => {
    const identity = {
      kind: "asset_id" as const,
      projectId: binding.projectId,
      assetId: "new",
    };
    const observations = classifyFlowResultObservations(emptyBaseline(), [
      candidate(identity, { observedAfterDispatch: true }),
      candidate(
        { ...identity, assetId: "proof-match" },
        {
          attributionProof: {
            source: "provider_attempt_metadata",
            attemptId: binding.attemptId,
            sourceSnapshotId: binding.sourceSnapshotId,
          },
        },
      ),
      candidate(
        { ...identity, assetId: "proof-wrong" },
        {
          attributionProof: {
            source: "provider_attempt_metadata",
            attemptId: "another-attempt",
            sourceSnapshotId: binding.sourceSnapshotId,
          },
        },
      ),
    ]);
    expect(observations.map((entry) => entry.classification)).toEqual([
      "new_candidate",
      "positively_attributable",
      "excluded",
    ]);
  });

  it("validates the full durable attempt binding and rejects a changed baseline profile", () => {
    const baseline = emptyBaseline();
    const attempt = {
      ...binding,
      promptHash: binding.sourceHash,
      buildId: provenance.buildId,
      protocolVersion: provenance.protocolVersion,
    };
    expect(flowResultBaselineMatchesAttempt(baseline, attempt)).toBe(true);
    expect(
      flowResultBaselineMatchesAttempt(baseline, {
        ...attempt,
        frameId: "other-frame",
      }),
    ).toBe(false);
    expect(
      flowResultBaselineMatchesProfile(baseline, {
        kind: "flow_empty_workspace_ui",
        markerCount: 1,
        visibleMediaCount: 0,
        visibleResultCardCount: 0,
        loadingMarkerCount: 0,
      }),
    ).toBe(true);
    expect(
      flowResultBaselineMatchesProfile(baseline, {
        kind: "flow_empty_workspace_ui",
        markerCount: 1,
        visibleMediaCount: 1,
        visibleResultCardCount: 0,
        loadingMarkerCount: 0,
      }),
    ).toBe(false);
  });

  it("keeps historical attempts without P05.1 result baseline readable", () => {
    const hash = "b".repeat(64);
    const record = {
      attemptId: "historical-attempt",
      confirmationKey: "historical-confirmation",
      workspaceId: "default",
      batchId: "historical-batch",
      itemId: "historical-item",
      shotId: "1",
      promptHash: hash,
      sourceSnapshotId: flowImagePromptSnapshotId("historical-item", hash),
      promptCodeUnits: 5,
      promptUtf8Bytes: 5,
      provider: "Flow",
      projectId: "historical-project",
      tabId: 1,
      frameId: "historical-frame",
      loaderId: "historical-loader",
      buildId: "historical-build",
      protocolVersion: 1,
      settingsConfirmation: {
        confirmationId: "historical-confirmation",
        confirmedAt: 1,
        userAttested: true,
        tabId: 1,
        projectId: "historical-project",
      },
      state: "dispatched",
      activeKey: flowImageAttemptActiveKey("historical-item", hash),
      baseline: {
        regionLabel: "Generated results",
        mediaCount: 1,
        capturedAt: 2,
      },
      events: [
        {
          stage: "dispatch",
          at: 3,
          method: "CDP Input.dispatchMouseEvent",
          code: "activation_pair_sent",
        },
      ],
      createdAt: 1,
      updatedAt: 3,
    };
    expect(FlowImageAttemptRecordSchema.safeParse(record).success).toBe(true);
    expect(record).not.toHaveProperty("resultBaseline");
  });
});
