import { describe, expect, it } from "vitest";
import {
  evaluateFlowImageCountBaselineEligibility,
  reduceFlowImageCountDecision,
  type FlowImageCountBaselineDeclaration,
  type FlowImageResultBaseline,
  type FlowStructuralObservationEvent,
} from "../../src/domain/jobs/results";

const projectId = "count-fixture-project";
const countSessionId = "8ca777a9-09a4-4640-82e1-8ece47164153";
const candidateA = "a".repeat(64);
const candidateB = "b".repeat(64);
const binding = {
  workspaceId: "workspace-fixture",
  batchId: "batch-fixture",
  itemId: "item-fixture",
  sourceHash: "c".repeat(64),
  sourceSnapshotId: "snapshot-fixture",
  attemptId: "attempt-fixture",
  provider: "Flow" as const,
  projectId,
  tabId: 41,
  frameId: "frame-fixture",
  loaderId: "loader-fixture",
};

function resultBaseline(
  profile: "empty" | "tiles" = "empty",
  candidateIds: string[] = [],
  virtualized = false,
): FlowImageResultBaseline {
  const isEmpty = profile === "empty";
  return {
    schemaVersion: 1,
    binding,
    capture: {
      method: "flow_image_runtime_observation",
      capturedAt: 10,
      buildId: "fixture-build",
      protocolVersion: 4,
    },
    observation: isEmpty
      ? {
          profile: "flow_empty_workspace_ui",
          profileVersion: 1,
          workspaceTag: "flow-project-page",
          markerPhrase: "Start creating or drop media",
          markerCount: 1,
          visibleMediaCount: 0,
          visibleResultCardCount: 0,
          loadingMarkerCount: 0,
        }
      : {
          profile: "flow_rendered_tile_candidates",
          profileVersion: 1,
          renderedTileCount: candidateIds.length || 1,
          candidateIds,
          candidateMultiplicity: candidateIds.map((candidateId) => ({
            candidateId,
            renderedCopies: 1,
          })),
          repeatedCandidateCount: 0,
          unidentifiedImageCount: 0,
          unrelatedImageCount: 0,
          virtualized,
          loadingSignalCount: 0,
          captureGaps: [],
        },
    completeness: isEmpty ? "complete_for_observed_empty_ui" : "incomplete",
    existingResultIdentities: [],
    excludedObservations: {
      count: isEmpty ? 0 : candidateIds.length,
      reasons: isEmpty
        ? []
        : [
            "stable_provider_identity_unavailable",
            "result_card_identity_unavailable",
          ],
    },
    variantDeclaration: {
      status: "declared",
      count: 1,
      source: "validated_settings_confirmation",
    },
    limitations: ["provider_result_identity_contract_not_live_verified"],
  };
}

function declaration(
  options: {
    mode?: "new_empty_project" | "existing_project";
    startingImageCount?: number;
    baselineCandidateIds?: string[];
    baselineTileTokens?: string[];
    virtualized?: boolean;
    priorMatchedAttemptIds?: string[];
    priorMatchedCandidateIds?: string[];
    priorDeclaredAdditions?: number;
  } = {},
): FlowImageCountBaselineDeclaration {
  const mode = options.mode ?? "new_empty_project";
  const common = {
    countSessionId,
    projectId,
    canonicalTarget: `https://flow.google.com/project/${projectId}`,
    tabId: 41,
    documentId: "browser-document-fixture",
    buildId: "fixture-build",
    protocolVersion: 4,
    capturedAt: 20,
    baselineCandidateIds: options.baselineCandidateIds ?? [],
    baselineTileTokens: options.baselineTileTokens ?? [],
    virtualized: options.virtualized ?? false,
    renderedScopeComplete: true,
    captureGaps: [],
    priorMatchedAttemptIds: options.priorMatchedAttemptIds ?? [],
    priorMatchedCandidateIds: options.priorMatchedCandidateIds ?? [],
    priorDeclaredAdditions: options.priorDeclaredAdditions ?? 0,
  };
  return mode === "new_empty_project"
    ? {
        ...common,
        mode,
        startingImageCount: 0,
        provenance: "observed_empty_ui_scope",
      }
    : {
        ...common,
        mode,
        startingImageCount: options.startingImageCount ?? 5,
        provenance: "user_attested_existing_image_count",
        inventoryComplete: false,
      };
}

function structuralEvent(
  sequence: number,
  options: {
    media?: Array<{
      candidateId: string;
      tileToken?: string;
      visible?: boolean;
      complete?: boolean;
      naturalWidth?: number;
      naturalHeight?: number;
    }>;
    virtualized?: boolean;
    loading?: boolean;
    error?: boolean;
    captureGaps?: string[];
    completeForRenderedScope?: boolean;
    unidentifiedImageCount?: number;
    identityCandidatesTruncated?: boolean;
    kind?: FlowStructuralObservationEvent["kind"];
    observedAt?: number;
  } = {},
): FlowStructuralObservationEvent {
  const media = options.media ?? [];
  const tileTokens = [
    ...new Set(media.map((item) => item.tileToken ?? "tile-1")),
  ];
  const lifecycleSignals: FlowStructuralObservationEvent["snapshot"]["lifecycleSignals"] =
    [];
  if (options.loading || options.error) {
    lifecycleSignals.push({
      markerToken: "marker-1",
      markerTag: "div",
      markerKind: options.error ? "error_candidate" : "loading",
      scope: "project",
      tileToken: null,
      visible: true,
      evidence: [
        {
          attributeName: options.error ? "data-error" : "data-state",
          signal: options.error ? "error" : "loading",
        },
      ],
    });
  }
  return {
    kind: options.kind ?? "structural_snapshot",
    attemptId: binding.attemptId,
    sessionId: countSessionId,
    observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    observedAt: options.observedAt ?? 101 + sequence,
    profile: "flow_tile_candidate_structure_v1",
    binding,
    sourceBaselineFingerprint: "d".repeat(64),
    captureFingerprint: "e".repeat(64),
    snapshot: {
      completeForRenderedScope: options.completeForRenderedScope ?? true,
      virtualized: options.virtualized ?? false,
      unidentifiedImageCount: options.unidentifiedImageCount ?? 0,
      tiles: tileTokens.map((tileToken) => ({
        tileToken,
        tag: "flow-image-tile" as const,
        visible: true,
      })),
      mediaCandidates: media.map((item, index) => ({
        candidateId: item.candidateId,
        mediaToken: `media-${index + 1}`,
        tileToken: item.tileToken ?? "tile-1",
        visible: item.visible ?? true,
        complete: item.complete ?? true,
        naturalWidth: item.naturalWidth ?? 100,
        naturalHeight: item.naturalHeight ?? 100,
      })),
      identityCandidates: [],
      identityCandidatesTruncated: options.identityCandidatesTruncated ?? false,
      resourceEvents: [],
      lifecycleSignals,
      captureGaps: options.captureGaps ?? [],
    },
  };
}

function reduce(
  mode: "new_empty_project" | "existing_project",
  events: FlowStructuralObservationEvent[],
  options: {
    declaration?: FlowImageCountBaselineDeclaration;
    baseline?: FlowImageResultBaseline;
    previous?: Parameters<typeof reduceFlowImageCountDecision>[0]["previous"];
    declaredVariantCount?: number;
    expectedCumulativeAdditions?: number;
    dispatchBoundaryAt?: number;
  } = {},
) {
  const declarationValue =
    options.declaration ??
    declaration({
      mode,
      ...(mode === "existing_project" ? { startingImageCount: 5 } : {}),
    });
  const baselineValue = options.baseline ?? resultBaseline("empty");
  const variantCount = options.declaredVariantCount ?? 1;
  return reduceFlowImageCountDecision({
    declaration: declarationValue,
    declaredVariantCount: variantCount,
    expectedCumulativeAdditions:
      options.expectedCumulativeAdditions ??
      declarationValue.priorDeclaredAdditions + variantCount,
    priorMatchedAttemptIds: declarationValue.priorMatchedAttemptIds,
    resultBaseline: baselineValue,
    events,
    ...(options.dispatchBoundaryAt === undefined
      ? {}
      : { dispatchBoundaryAt: options.dispatchBoundaryAt }),
    ...(options.previous ? { previous: options.previous } : {}),
    now: 200,
  });
}

describe("P05 revised count observation decision", () => {
  it("treats explicit virtualization risk evidence as ambiguous even if a boolean is inconsistent", () => {
    expect(
      evaluateFlowImageCountBaselineEligibility({
        mode: "existing_project",
        startingImageCount: 9,
        profile: "flow_rendered_tile_candidates",
        renderedTileCount: 2,
        candidateIds: [candidateA, candidateB],
        renderedScopeComplete: true,
        captureGaps: [],
        unidentifiedImageCount: 0,
        virtualized: false,
        virtualizationEvidence: ["tile_identity_recycled"],
        virtualScrollContainerCount: 1,
        priorMatchedAttemptIds: [],
        priorMatchedCandidateIds: [],
        priorDeclaredAdditions: 0,
      }),
    ).toEqual({
      status: "ambiguous",
      reason: "existing_project_virtualized",
      detailCode: "tile_identity_recycling_observed",
    });
  });

  it("matches exactly one new visible, loaded media candidate after dispatch", () => {
    const decision = reduce(
      "new_empty_project",
      [structuralEvent(1, { media: [{ candidateId: candidateA }] })],
      { dispatchBoundaryAt: 100 },
    );
    expect(decision).toMatchObject({
      status: "count_matched",
      observedEligibleCandidateIds: [candidateA],
      startingImageCount: 0,
      expectedCumulativeAdditions: 1,
      expectedTotal: 1,
      dispatchBoundaryAt: 100,
    });
  });

  it("does not count a resource load, a disappeared loading marker, or pre-dispatch candidates", () => {
    const loadOnly = structuralEvent(1);
    loadOnly.snapshot.resourceEvents.push({
      mediaToken: "media-1",
      tileToken: "tile-1",
      type: "load",
      complete: true,
      naturalWidth: 100,
      naturalHeight: 100,
    });
    expect(reduce("new_empty_project", [loadOnly]).status).toBe("observing");
    expect(
      reduce(
        "new_empty_project",
        [
          structuralEvent(1, {
            media: [{ candidateId: candidateA }],
            observedAt: 99,
          }),
        ],
        { dispatchBoundaryAt: 100 },
      ).status,
    ).toBe("observing");
    expect(
      reduce(
        "new_empty_project",
        [
          structuralEvent(1, {
            media: [{ candidateId: candidateA }],
            observedAt: 100,
          }),
        ],
        { dispatchBoundaryAt: 100 },
      ).status,
    ).toBe("observing");
  });

  it("deduplicates repeated and reappearing candidates and ignores the captured baseline", () => {
    const baseline = resultBaseline("tiles", [candidateA]);
    const declarationValue = declaration({
      mode: "existing_project",
      startingImageCount: 8,
      baselineCandidateIds: [candidateA],
      baselineTileTokens: ["tile-1"],
    });
    const decision = reduce(
      "existing_project",
      [
        structuralEvent(1, {
          media: [
            { candidateId: candidateA, tileToken: "tile-1" },
            { candidateId: candidateB, tileToken: "tile-2" },
          ],
        }),
        structuralEvent(2, {
          media: [{ candidateId: candidateB, tileToken: "tile-3" }],
        }),
      ],
      {
        baseline,
        declaration: declarationValue,
        dispatchBoundaryAt: 100,
      },
    );
    expect(decision.status).toBe("count_matched");
    expect(decision.observedEligibleCandidateIds).toEqual([candidateB]);
  });

  it("pauses on loading, extra candidates, errors, reused baseline tiles, gaps, and truncation", () => {
    expect(
      reduce("new_empty_project", [structuralEvent(1, { loading: true })])
        .status,
    ).toBe("observing");
    expect(
      reduce(
        "new_empty_project",
        [
          structuralEvent(1, {
            media: [
              { candidateId: candidateA, tileToken: "tile-1" },
              { candidateId: candidateB, tileToken: "tile-2" },
            ],
          }),
        ],
        { dispatchBoundaryAt: 100 },
      ).status,
    ).toBe("blocked");
    expect(
      reduce("new_empty_project", [structuralEvent(1, { error: true })]).status,
    ).toBe("blocked");
    const existingBaseline = resultBaseline("tiles", [candidateA]);
    expect(
      reduce(
        "existing_project",
        [
          structuralEvent(1, {
            media: [{ candidateId: candidateB, tileToken: "tile-1" }],
          }),
        ],
        {
          baseline: existingBaseline,
          declaration: declaration({
            mode: "existing_project",
            startingImageCount: 5,
            baselineCandidateIds: [candidateA],
            baselineTileTokens: ["tile-1"],
          }),
          dispatchBoundaryAt: 100,
        },
      ).reason,
    ).toBe("candidate_ownership_ambiguous");
    expect(
      reduce("new_empty_project", [
        structuralEvent(1, { captureGaps: ["capture_failed"] }),
      ]).status,
    ).toBe("ambiguous");
    expect(
      reduce("new_empty_project", [
        structuralEvent(1, { identityCandidatesTruncated: true }),
      ]).status,
    ).toBe("ambiguous");
  });

  it("blocks virtualized existing inventory and newly revealed prior cards", () => {
    const existing = reduce("existing_project", [], {
      baseline: resultBaseline("tiles", [candidateA], true),
      declaration: declaration({
        mode: "existing_project",
        startingImageCount: 10,
        baselineCandidateIds: [candidateA],
        baselineTileTokens: ["tile-1"],
        virtualized: true,
      }),
    });
    expect(existing).toMatchObject({
      status: "ambiguous",
      reason: "existing_project_virtualized",
    });
    const nextPrompt = reduce("new_empty_project", [], {
      baseline: resultBaseline("tiles", [candidateA, candidateB]),
      declaration: declaration({
        mode: "new_empty_project",
        baselineCandidateIds: [candidateA, candidateB],
        baselineTileTokens: ["tile-1", "tile-2"],
        priorMatchedAttemptIds: ["attempt-previous"],
        priorMatchedCandidateIds: [candidateA],
        priorDeclaredAdditions: 1,
      }),
      expectedCumulativeAdditions: 2,
    });
    expect(nextPrompt).toMatchObject({
      status: "ambiguous",
      reason: "candidate_ownership_ambiguous",
    });
  });

  it("tracks cumulative arithmetic while keeping prior candidates out of the current prompt", () => {
    const decision = reduce(
      "new_empty_project",
      [
        structuralEvent(1, {
          media: [{ candidateId: candidateB, tileToken: "tile-2" }],
        }),
      ],
      {
        baseline: resultBaseline("tiles", [candidateA]),
        declaration: declaration({
          mode: "new_empty_project",
          baselineCandidateIds: [candidateA],
          baselineTileTokens: ["tile-1"],
          priorMatchedAttemptIds: ["attempt-previous"],
          priorMatchedCandidateIds: [candidateA],
          priorDeclaredAdditions: 1,
        }),
        expectedCumulativeAdditions: 2,
        declaredVariantCount: 1,
        dispatchBoundaryAt: 100,
      },
    );
    expect(decision).toMatchObject({
      status: "count_matched",
      expectedCumulativeAdditions: 2,
      expectedTotal: 2,
      observedEligibleCandidateIds: [candidateB],
    });
  });

  it("interrupts on loss or timeout and blocks mismatched/incomplete bindings", () => {
    expect(
      reduce("new_empty_project", [
        structuralEvent(1, { kind: "observer_lost" }),
      ]).status,
    ).toBe("interrupted");
    expect(
      reduce("new_empty_project", [
        structuralEvent(1, { kind: "observer_timed_out" }),
      ]).reason,
    ).toBe("observer_timeout");
    const staleDeclaration = declaration({});
    expect(
      reduce("new_empty_project", [], {
        declaration: { ...staleDeclaration, projectId: "other-project" },
      }).reason,
    ).toBe("baseline_binding_mismatch");
    expect(
      reduce("new_empty_project", [], {
        baseline: resultBaseline("tiles", [candidateA]),
      }).reason,
    ).toBe("baseline_incomplete");
  });
});
