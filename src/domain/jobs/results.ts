import { z } from "zod";
import { flowImagePromptSnapshotId } from "../batches/flowImagePromptSnapshot";

const idSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !/^https?:\/\//i.test(value));
const projectIdSchema = z.string().min(1).max(512);

export const FlowProviderResultIdentitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("result_id"),
      projectId: projectIdSchema,
      resultId: idSchema,
      variantId: idSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("asset_id"),
      projectId: projectIdSchema,
      assetId: idSchema,
      variantId: idSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("group_variant_id"),
      projectId: projectIdSchema,
      groupId: idSchema,
      variantId: idSchema,
    })
    .strict(),
]);
export type FlowProviderResultIdentity = z.infer<
  typeof FlowProviderResultIdentitySchema
>;

const flowResultBindingSchema = z
  .object({
    workspaceId: z.string().min(1).max(128),
    batchId: z.string().min(1).max(256),
    itemId: z.string().min(1).max(256),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    sourceSnapshotId: z.string().min(1).max(512),
    attemptId: z.string().min(1).max(128),
    provider: z.literal("Flow"),
    projectId: projectIdSchema,
    tabId: z.number().int().nonnegative(),
    frameId: z.string().min(1).max(256),
    loaderId: z.string().min(1).max(256),
  })
  .strict();

const flowImageObservationSchema = z.discriminatedUnion("profile", [
  z
    .object({
      profile: z.literal("flow_empty_workspace_ui"),
      profileVersion: z.literal(1),
      workspaceTag: z.literal("flow-project-page"),
      markerPhrase: z.literal("Start creating or drop media"),
      markerCount: z.literal(1),
      visibleMediaCount: z.literal(0),
      visibleResultCardCount: z.literal(0),
      loadingMarkerCount: z.literal(0),
    })
    .strict(),
  z
    .object({
      profile: z.literal("flow_rendered_tile_candidates"),
      profileVersion: z.literal(1),
      renderedTileCount: z.number().int().positive().max(100),
      candidateIds: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(500),
      candidateMultiplicity: z
        .array(
          z
            .object({
              candidateId: z.string().regex(/^[0-9a-f]{64}$/),
              renderedCopies: z.number().int().positive().max(1000),
            })
            .strict(),
        )
        .max(500),
      repeatedCandidateCount: z.number().int().nonnegative().max(10_000),
      unidentifiedImageCount: z.number().int().nonnegative().max(1000),
      unrelatedImageCount: z.number().int().nonnegative().max(10_000),
      virtualized: z.boolean(),
      loadingSignalCount: z.number().int().nonnegative().max(10_000),
      captureGaps: z.array(z.string().min(1).max(64)).max(16),
    })
    .strict()
    .superRefine((observation, context) => {
      const uniqueIds = new Set(observation.candidateIds);
      const multiplicityIds = observation.candidateMultiplicity.map(
        (candidate) => candidate.candidateId,
      );
      if (
        uniqueIds.size !== observation.candidateIds.length ||
        multiplicityIds.length !== uniqueIds.size ||
        multiplicityIds.some((candidateId) => !uniqueIds.has(candidateId))
      ) {
        context.addIssue({
          code: "custom",
          message: "rendered_candidate_baseline_must_be_deduplicated",
        });
      }
    }),
  z
    .object({
      profile: z.literal("flow_labelled_results_region"),
      profileVersion: z.literal(1),
      regionLabel: z
        .string()
        .min(1)
        .max(80)
        .refine((label) =>
          /^(generated results|image results|results gallery)$/i.test(label),
        ),
      observedMediaCount: z.number().int().nonnegative().max(100_000),
    })
    .strict(),
]);

const variantDeclarationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("absent") }).strict(),
  z
    .object({
      status: z.literal("declared"),
      count: z.number().int().positive().max(100),
      source: z.literal("validated_settings_confirmation"),
    })
    .strict(),
]);

export const FlowImageObservationArmReceiptSchema = z
  .object({
    capturedAt: z.number().finite().nonnegative(),
    sourceBaselineFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    captureFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    listenerRootCount: z.number().int().positive().max(256),
    baseline: z
      .object({
        completeForRenderedScope: z.boolean(),
        virtualized: z.boolean(),
        tileCount: z.number().int().nonnegative().max(100),
        mediaCandidateCount: z.number().int().nonnegative().max(500),
        identityCandidateCount: z.number().int().nonnegative().max(500),
        identityCandidatesTruncated: z.boolean().default(false),
        unidentifiedImageCount: z.number().int().nonnegative().max(1000),
        lifecycleSignalCount: z.number().int().nonnegative().max(500),
        resourceEventCount: z.number().int().nonnegative().max(100),
        captureGaps: z.array(z.string().min(1).max(64)).max(16),
      })
      .strict(),
  })
  .strict();
export type FlowImageObservationArmReceipt = z.infer<
  typeof FlowImageObservationArmReceiptSchema
>;

export const FlowImageObservationSessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    documentId: z.string().min(1).max(256),
    senderFrameId: z.number().int().nonnegative(),
    startedAt: z.number().finite().nonnegative(),
    deadlineAt: z.number().finite().nonnegative(),
    maxEvents: z.number().int().positive().max(128),
    profileSupport: z.enum([
      "unsupported",
      "fixture_supported",
      "production_observation_only",
    ]),
    status: z.enum([
      "arming",
      "active",
      "unsupported",
      "lost",
      "timed_out",
      "closed",
    ]),
    lastSequence: z.number().int().nonnegative(),
    reconciliationCount: z.number().int().nonnegative().max(3),
    armReceipt: FlowImageObservationArmReceiptSchema.optional(),
  })
  .strict()
  .refine((session) => session.deadlineAt > session.startedAt);
export type FlowImageObservationSession = z.infer<
  typeof FlowImageObservationSessionSchema
>;

/** Complete immutable binding passed to an observer after attempt persistence. */
export type FlowImageObservationArmBinding = {
  workspaceId: string;
  batchId: string;
  itemId: string;
  sourceHash: string;
  sourceSnapshotId: string;
  sourceBaselineFingerprint: string;
  attemptId: string;
  provider: "Flow";
  projectId: string;
  canonicalTarget: string;
  tabId: number;
  frameId: string;
  loaderId: string;
  documentId: string;
  senderFrameId: number;
  sessionId: string;
  startedAt: number;
  deadlineAt: number;
  maxEvents: number;
  buildId: string;
  protocolVersion: number;
};

const FlowStructuralTileSnapshotSchema = z
  .object({
    tileToken: z.string().regex(/^tile-[0-9]{1,6}$/),
    tag: z.literal("flow-image-tile"),
    visible: z.boolean(),
  })
  .strict();

const FlowStructuralMediaCandidateSchema = z
  .object({
    candidateId: z.string().regex(/^[0-9a-f]{64}$/),
    mediaToken: z.string().regex(/^media-[0-9]{1,6}$/),
    tileToken: z.string().regex(/^tile-[0-9]{1,6}$/),
    visible: z.boolean(),
    complete: z.boolean(),
    naturalWidth: z.number().int().nonnegative().max(100_000),
    naturalHeight: z.number().int().nonnegative().max(100_000),
  })
  .strict();

const FlowStructuralIdentityCandidateSchema = z
  .object({
    carrierToken: z
      .string()
      .regex(/^(?:tile|media|marker|identity)-[0-9]{1,6}$/),
    carrierTag: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    carrierRelation: z.enum(["tile", "descendant", "ancestor"]),
    attributeName: z.string().regex(/^[a-z][a-z0-9:_-]{0,63}$/),
    category: z.enum([
      "dom_element_id_not_asset_proof",
      "accessibility_reference_not_asset_proof",
      "test_or_dom_identifier_not_asset_proof",
      "provider_asset_identity_candidate_unverified",
      "provider_variant_identity_candidate_unverified",
      "provider_group_identity_candidate_unverified",
      "provider_result_identity_candidate_unverified",
      "other_data_identity_candidate_unverified",
    ]),
    candidateId: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const FlowStructuralMarkerEvidenceSchema = z
  .object({
    attributeName: z.enum([
      "role",
      "aria-busy",
      "data-loading",
      "data-error",
      "data-state",
      "data-testid",
      "class",
    ]),
    signal: z.enum([
      "progressbar",
      "status",
      "alert",
      "busy",
      "loading",
      "spinner",
      "pending",
      "progress",
      "generating",
      "processing",
      "complete",
      "completed",
      "finished",
      "success",
      "ready",
      "done",
      "error",
      "failed",
      "failure",
      "blocked",
      "rejected",
    ]),
  })
  .strict();

const FlowStructuralLifecycleSignalSchema = z
  .object({
    markerToken: z.string().regex(/^marker-[0-9]{1,6}$/),
    markerTag: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    markerKind: z.enum([
      "loading",
      "processing",
      "completed_candidate",
      "error_candidate",
      "busy",
      "progressbar",
      "status",
      "alert",
    ]),
    scope: z.enum(["project", "tile"]),
    tileToken: z
      .string()
      .regex(/^tile-[0-9]{1,6}$/)
      .nullable(),
    visible: z.boolean(),
    evidence: z.array(FlowStructuralMarkerEvidenceSchema).max(12),
  })
  .strict()
  .refine((marker) =>
    marker.scope === "tile"
      ? marker.tileToken !== null
      : marker.tileToken === null,
  );

export const FlowStructuralSnapshotSchema = z
  .object({
    completeForRenderedScope: z.boolean(),
    virtualized: z.boolean(),
    unidentifiedImageCount: z.number().int().nonnegative().max(1000),
    tiles: z.array(FlowStructuralTileSnapshotSchema).max(100),
    mediaCandidates: z.array(FlowStructuralMediaCandidateSchema).max(500),
    identityCandidates: z.array(FlowStructuralIdentityCandidateSchema).max(500),
    identityCandidatesTruncated: z.boolean(),
    resourceEvents: z
      .array(
        z
          .object({
            mediaToken: z.string().regex(/^media-[0-9]{1,6}$/),
            tileToken: z
              .string()
              .regex(/^tile-[0-9]{1,6}$/)
              .nullable(),
            type: z.enum(["load", "error"]),
            complete: z.boolean(),
            naturalWidth: z.number().int().nonnegative().max(100_000),
            naturalHeight: z.number().int().nonnegative().max(100_000),
          })
          .strict(),
      )
      .max(100),
    lifecycleSignals: z.array(FlowStructuralLifecycleSignalSchema).max(500),
    captureGaps: z
      .array(
        z.enum([
          "document_scan_truncated",
          "project_scan_truncated",
          "tile_scan_truncated",
          "event_limit_reached",
          "duration_limit_reached",
          "media_identity_missing",
          "identity_candidate_excluded",
          "identity_candidates_truncated",
          "observer_detached",
          "document_binding_changed",
          "project_binding_changed",
          "capture_failed",
        ]),
      )
      .max(16),
  })
  .strict();

/** Page-derived structural evidence only. It cannot contain result links or terminal claims. */
export const FlowStructuralObservationEventSchema = z
  .object({
    kind: z.enum([
      "structural_snapshot",
      "observer_lost",
      "observer_timed_out",
    ]),
    attemptId: z.string().min(1).max(128),
    sessionId: z.string().uuid(),
    observationId: z.string().uuid(),
    sequence: z.number().int().positive(),
    observedAt: z.number().finite().nonnegative(),
    profile: z.literal("flow_tile_candidate_structure_v1"),
    binding: flowResultBindingSchema,
    sourceBaselineFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    captureFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    snapshot: FlowStructuralSnapshotSchema,
  })
  .strict();

export type FlowStructuralObservationEvent = z.infer<
  typeof FlowStructuralObservationEventSchema
>;

export const FlowImageResultLinkSchema = z
  .object({
    identity: FlowProviderResultIdentitySchema,
    status: z.enum(["processing", "succeeded", "failed"]),
    terminalEvidence: z
      .enum(["provider_success_marker", "provider_error_marker"])
      .optional(),
    firstObservedAt: z.number().finite().nonnegative(),
    lastObservedAt: z.number().finite().nonnegative(),
    attributionProof: z
      .object({
        source: z.literal("provider_attempt_metadata"),
        attemptId: z.string().min(1).max(128),
        sourceSnapshotId: z.string().min(1).max(512),
      })
      .strict(),
  })
  .strict()
  .refine((link) =>
    link.status === "processing"
      ? link.terminalEvidence === undefined
      : link.status === "succeeded"
        ? link.terminalEvidence === "provider_success_marker"
        : link.terminalEvidence === "provider_error_marker",
  );
export type FlowImageResultLink = z.infer<typeof FlowImageResultLinkSchema>;

export const FlowImageObservationOutcomeSchema = z
  .object({
    status: z.enum([
      "awaiting_evidence",
      "processing",
      "complete",
      "partial_error",
      "failed",
      "unknown",
    ]),
    reason: z
      .enum([
        "live_profile_unsupported",
        "variant_declaration_missing",
        "ownership_ambiguous",
        "conflicting_identity",
        "observation_lost",
        "observation_timeout",
        "binding_changed",
        "event_limit_reached",
        "observation_not_started",
      ])
      .optional(),
    declaredVariantCount: z.number().int().positive().max(100).optional(),
    observedSucceededCount: z.number().int().nonnegative().max(100),
    observedFailedCount: z.number().int().nonnegative().max(100),
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict();
export type FlowImageObservationOutcome = z.infer<
  typeof FlowImageObservationOutcomeSchema
>;

export const FlowImageObservationReceiptSchema = z
  .object({
    observationId: z.string().uuid(),
    sequence: z.number().int().positive(),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    receivedAt: z.number().finite().nonnegative(),
  })
  .strict();

const FlowImageTerminalObservationEventSchema = z
  .object({
    attemptId: z.string().min(1).max(128),
    sessionId: z.string().uuid(),
    observationId: z.string().uuid(),
    sequence: z.number().int().positive(),
    observedAt: z.number().finite().nonnegative(),
    profile: z.literal("flow_result_lifecycle_v1"),
    binding: flowResultBindingSchema,
    results: z
      .array(
        z
          .object({
            identity: FlowProviderResultIdentitySchema,
            status: z.enum(["processing", "succeeded", "failed"]),
            terminalEvidence: z
              .enum(["provider_success_marker", "provider_error_marker"])
              .optional(),
            attributionProof: z
              .object({
                source: z.literal("provider_attempt_metadata"),
                attemptId: z.string().min(1).max(128),
                sourceSnapshotId: z.string().min(1).max(512),
              })
              .strict(),
          })
          .strict()
          .refine((result) =>
            result.status === "processing"
              ? result.terminalEvidence === undefined
              : result.status === "succeeded"
                ? result.terminalEvidence === "provider_success_marker"
                : result.terminalEvidence === "provider_error_marker",
          ),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type FlowImageObservationEvent = z.infer<
  typeof FlowImageTerminalObservationEventSchema
>;

export const FlowImageObservationEventSchema = z.union([
  FlowImageTerminalObservationEventSchema,
  FlowStructuralObservationEventSchema,
]);
export type FlowImageAnyObservationEvent = z.infer<
  typeof FlowImageObservationEventSchema
>;

export const FlowImageObservationMessageSchema = z
  .object({
    type: z.literal("AUTOMAT_FLOW_IMAGE_OBSERVATION"),
    protocolVersion: z.number().int().positive(),
    buildId: z.string().min(1).max(128),
    observation: FlowImageObservationEventSchema,
  })
  .strict();

export type FlowImageLifecycleReduction = {
  links: FlowImageResultLink[];
  outcome: FlowImageObservationOutcome;
};

export const FlowImageResultBaselineSchema = z
  .object({
    schemaVersion: z.literal(1),
    binding: flowResultBindingSchema,
    capture: z
      .object({
        method: z.literal("flow_image_runtime_observation"),
        capturedAt: z.number().finite().nonnegative(),
        buildId: z.string().min(1).max(128),
        protocolVersion: z.number().int().positive(),
      })
      .strict(),
    observation: flowImageObservationSchema,
    completeness: z.enum(["complete_for_observed_empty_ui", "incomplete"]),
    existingResultIdentities: z
      .array(FlowProviderResultIdentitySchema)
      .max(10_000),
    excludedObservations: z
      .object({
        count: z.number().int().nonnegative().max(100_000),
        reasons: z
          .array(
            z.enum([
              "stable_provider_identity_unavailable",
              "result_card_identity_unavailable",
            ]),
          )
          .max(2),
      })
      .strict(),
    variantDeclaration: variantDeclarationSchema,
    limitations: z
      .array(
        z.enum([
          "selected_workspace_scope_only",
          "provider_database_emptiness_not_proven",
          "provider_result_identity_contract_not_live_verified",
          "result_card_identity_not_observed",
          "rendered_candidate_identity_unverified",
          "rendered_tile_inventory_incomplete",
          "media_count_is_not_unique_asset_count",
          "closed_shadow_roots_and_other_documents_not_inspected",
        ]),
      )
      .min(1)
      .max(8),
  })
  .strict()
  .refine(
    (baseline) =>
      baseline.binding.sourceSnapshotId ===
      flowImagePromptSnapshotId(
        baseline.binding.itemId,
        baseline.binding.sourceHash,
      ),
    { message: "result_baseline_snapshot_binding_mismatch" },
  )
  .superRefine((baseline, context) => {
    const emptyProfile =
      baseline.observation.profile === "flow_empty_workspace_ui";
    if (emptyProfile) {
      if (
        baseline.completeness !== "complete_for_observed_empty_ui" ||
        baseline.existingResultIdentities.length !== 0 ||
        baseline.excludedObservations.count !== 0
      ) {
        context.addIssue({
          code: "custom",
          message: "empty_ui_baseline_must_be_complete_for_its_scope",
        });
      }
    } else if (baseline.completeness !== "incomplete") {
      context.addIssue({
        code: "custom",
        message: "labelled_surface_without_stable_ids_is_incomplete",
      });
    }

    const seen = new Set<string>();
    for (const identity of baseline.existingResultIdentities) {
      const key = flowProviderResultIdentityKey(identity);
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "duplicate_baseline_result_identity",
        });
        break;
      }
      seen.add(key);
    }
  });
export type FlowImageResultBaseline = z.infer<
  typeof FlowImageResultBaselineSchema
>;

const partialBindingSchema = z
  .object({
    workspaceId: z.string().min(1).max(128).optional(),
    batchId: z.string().min(1).max(256).optional(),
    itemId: z.string().min(1).max(256).optional(),
    sourceHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    sourceSnapshotId: z.string().min(1).max(512).optional(),
    attemptId: z.string().min(1).max(128).optional(),
    provider: z.literal("Flow").optional(),
    projectId: projectIdSchema.optional(),
    tabId: z.number().int().nonnegative().optional(),
    frameId: z.string().min(1).max(256).optional(),
    loaderId: z.string().min(1).max(256).optional(),
  })
  .strict();

export const FlowResultAttributionProofSchema = z
  .object({
    source: z.literal("provider_attempt_metadata"),
    attemptId: z.string().min(1).max(128),
    sourceSnapshotId: z.string().min(1).max(512),
  })
  .strict();

export const FlowResultObservationCandidateSchema = z
  .object({
    binding: partialBindingSchema.optional(),
    identity: FlowProviderResultIdentitySchema.optional(),
    attributionProof: FlowResultAttributionProofSchema.optional(),
    observedAfterDispatch: z.boolean().optional(),
  })
  .strict();
export type FlowResultObservationCandidate = z.infer<
  typeof FlowResultObservationCandidateSchema
>;

export type FlowResultObservationClassification =
  | { classification: "baseline"; identity: FlowProviderResultIdentity }
  | {
      classification: "excluded";
      reason:
        | "binding_mismatch"
        | "identity_project_mismatch"
        | "duplicate_logical_identity"
        | "baseline_inventory_incomplete"
        | "attribution_proof_mismatch";
      identity?: FlowProviderResultIdentity;
      duplicateOfIndex?: number;
    }
  | {
      classification: "ambiguous_identity";
      reason: "stable_identity_missing" | "candidate_invalid";
    }
  | { classification: "new_candidate"; identity: FlowProviderResultIdentity }
  | {
      classification: "positively_attributable";
      identity: FlowProviderResultIdentity;
    };

export function flowProviderResultIdentityKey(
  identity: FlowProviderResultIdentity,
): string {
  switch (identity.kind) {
    case "result_id":
      return JSON.stringify([
        identity.projectId,
        identity.kind,
        identity.resultId,
        identity.variantId ?? null,
      ]);
    case "asset_id":
      return JSON.stringify([
        identity.projectId,
        identity.kind,
        identity.assetId,
        identity.variantId ?? null,
      ]);
    case "group_variant_id":
      return JSON.stringify([
        identity.projectId,
        identity.kind,
        identity.groupId,
        identity.variantId,
      ]);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function flowImageResultBaselineFingerprintInput(
  baseline: FlowImageResultBaseline,
): string {
  return stableJson(baseline);
}

export function flowStructuralSnapshotFingerprintInput(
  snapshot: unknown,
): string {
  return stableJson(snapshot);
}

export function flowImageObservationFingerprintInput(
  event: FlowImageAnyObservationEvent,
): string {
  return stableJson(event);
}

export function reduceFlowImageObservation(
  baselineInput: unknown,
  declaredVariantCount: number | undefined,
  currentLinks: readonly FlowImageResultLink[],
  eventInput: unknown,
  at: number,
): FlowImageLifecycleReduction {
  const parsedBaseline = FlowImageResultBaselineSchema.safeParse(baselineInput);
  const parsedEvent = FlowImageObservationEventSchema.safeParse(eventInput);
  const unknown = (
    reason: FlowImageObservationOutcome["reason"],
  ): FlowImageLifecycleReduction => ({
    links: [...currentLinks],
    outcome: {
      status: "unknown",
      ...(reason ? { reason } : {}),
      ...(declaredVariantCount ? { declaredVariantCount } : {}),
      observedSucceededCount: currentLinks.filter(
        (link) => link.status === "succeeded",
      ).length,
      observedFailedCount: currentLinks.filter(
        (link) => link.status === "failed",
      ).length,
      updatedAt: at,
    },
  });
  if (!parsedBaseline.success || !parsedEvent.success) {
    return unknown("ownership_ambiguous");
  }
  const baseline = parsedBaseline.data;
  const event = parsedEvent.data;
  if ("kind" in event) {
    const bindingMatches =
      event.attemptId === baseline.binding.attemptId &&
      Object.entries(baseline.binding).every(
        ([key, value]) =>
          event.binding[key as keyof typeof event.binding] === value,
      );
    return unknown(
      !bindingMatches
        ? "binding_changed"
        : event.kind === "observer_lost"
          ? "observation_lost"
          : event.kind === "observer_timed_out"
            ? "observation_timeout"
            : "ownership_ambiguous",
    );
  }
  const declaration = baseline.variantDeclaration;
  if (
    declaredVariantCount === undefined ||
    declaration.status !== "declared" ||
    declaration.count !== declaredVariantCount
  ) {
    return unknown("variant_declaration_missing");
  }
  if (
    event.attemptId !== baseline.binding.attemptId ||
    event.sessionId.length === 0 ||
    Object.entries(baseline.binding).some(
      ([key, value]) =>
        event.binding[key as keyof typeof event.binding] !== value,
    )
  ) {
    return unknown("binding_changed");
  }
  if (baseline.completeness === "incomplete") {
    return unknown("ownership_ambiguous");
  }

  const baselineKeys = new Set(
    baseline.existingResultIdentities.map(flowProviderResultIdentityKey),
  );
  const links = new Map(
    currentLinks.map((link) => [
      flowProviderResultIdentityKey(link.identity),
      link,
    ]),
  );
  const eventKeys = new Map<
    string,
    FlowImageObservationEvent["results"][number]
  >();
  for (const result of event.results) {
    const key = flowProviderResultIdentityKey(result.identity);
    const previousInEvent = eventKeys.get(key);
    if (
      previousInEvent &&
      (previousInEvent.status !== result.status ||
        previousInEvent.terminalEvidence !== result.terminalEvidence)
    ) {
      return unknown("conflicting_identity");
    }
    eventKeys.set(key, result);
    if (
      result.identity.projectId !== baseline.binding.projectId ||
      baselineKeys.has(key) ||
      result.attributionProof.attemptId !== baseline.binding.attemptId ||
      result.attributionProof.sourceSnapshotId !==
        baseline.binding.sourceSnapshotId
    ) {
      return unknown("ownership_ambiguous");
    }
    const previous = links.get(key);
    if (
      previous &&
      previous.status !== "processing" &&
      previous.status !== result.status
    ) {
      return unknown("conflicting_identity");
    }
    links.set(key, {
      identity: result.identity,
      status: result.status,
      ...(result.terminalEvidence
        ? { terminalEvidence: result.terminalEvidence }
        : {}),
      firstObservedAt: previous?.firstObservedAt ?? event.observedAt,
      lastObservedAt: event.observedAt,
      attributionProof: result.attributionProof,
    });
  }

  const nextLinks = [...links.values()];
  const succeeded = nextLinks.filter(
    (link) => link.status === "succeeded",
  ).length;
  const failed = nextLinks.filter((link) => link.status === "failed").length;
  let status: FlowImageObservationOutcome["status"];
  if (nextLinks.length > declaredVariantCount) {
    return unknown("conflicting_identity");
  } else if (
    nextLinks.length === declaredVariantCount &&
    succeeded === declaredVariantCount
  ) {
    status = "complete";
  } else if (failed > 0) {
    status =
      succeeded === 0 && failed === declaredVariantCount
        ? "failed"
        : "partial_error";
  } else if (nextLinks.some((link) => link.status === "processing")) {
    status = "processing";
  } else {
    status = "awaiting_evidence";
  }
  return {
    links: nextLinks,
    outcome: {
      status,
      declaredVariantCount,
      observedSucceededCount: succeeded,
      observedFailedCount: failed,
      updatedAt: at,
    },
  };
}

export function flowResultBaselineMatchesAttempt(
  baseline: FlowImageResultBaseline | undefined,
  attempt: {
    workspaceId: string;
    batchId: string;
    itemId: string;
    promptHash: string;
    sourceSnapshotId: string;
    attemptId: string;
    provider: "Flow";
    projectId: string;
    tabId: number;
    frameId: string;
    loaderId: string;
    buildId: string;
    protocolVersion: number;
    settingsConfirmation?: { declaredVariantCount?: number };
  },
): boolean {
  if (!baseline) return false;
  const parsed = FlowImageResultBaselineSchema.safeParse(baseline);
  if (!parsed.success) return false;
  const binding = parsed.data.binding;
  const variantDeclarationMatches =
    attempt.settingsConfirmation?.declaredVariantCount === undefined
      ? parsed.data.variantDeclaration.status === "absent"
      : parsed.data.variantDeclaration.status === "declared" &&
        parsed.data.variantDeclaration.count ===
          attempt.settingsConfirmation.declaredVariantCount;
  return (
    binding.workspaceId === attempt.workspaceId &&
    binding.batchId === attempt.batchId &&
    binding.itemId === attempt.itemId &&
    binding.sourceHash === attempt.promptHash &&
    binding.sourceSnapshotId === attempt.sourceSnapshotId &&
    binding.attemptId === attempt.attemptId &&
    binding.provider === attempt.provider &&
    binding.projectId === attempt.projectId &&
    binding.tabId === attempt.tabId &&
    binding.frameId === attempt.frameId &&
    binding.loaderId === attempt.loaderId &&
    parsed.data.capture.buildId === attempt.buildId &&
    parsed.data.capture.protocolVersion === attempt.protocolVersion &&
    variantDeclarationMatches
  );
}

export function flowResultBaselineMatchesProfile(
  baseline: FlowImageResultBaseline | undefined,
  profile:
    | {
        kind: "flow_empty_workspace_ui";
        markerCount: 1;
        visibleMediaCount: 0;
        visibleResultCardCount: 0;
        loadingMarkerCount: 0;
      }
    | { regionLabel: string; mediaCount: number }
    | {
        kind: "flow_rendered_tile_candidates";
        renderedTileCount: number;
        candidateIds: string[];
        candidateMultiplicity: Array<{
          candidateId: string;
          renderedCopies: number;
        }>;
        repeatedCandidateCount: number;
        unidentifiedImageCount: number;
        unrelatedImageCount: number;
        virtualized: boolean;
        loadingSignalCount: number;
        captureGaps: string[];
      },
): boolean {
  if (!baseline) return false;
  const parsed = FlowImageResultBaselineSchema.safeParse(baseline);
  if (!parsed.success) return false;
  if ("kind" in profile && profile.kind === "flow_empty_workspace_ui") {
    return (
      parsed.data.observation.profile === "flow_empty_workspace_ui" &&
      parsed.data.observation.markerCount === profile.markerCount &&
      parsed.data.observation.visibleMediaCount === profile.visibleMediaCount &&
      parsed.data.observation.visibleResultCardCount ===
        profile.visibleResultCardCount &&
      parsed.data.observation.loadingMarkerCount === profile.loadingMarkerCount
    );
  }
  if ("kind" in profile && profile.kind === "flow_rendered_tile_candidates") {
    const observation = parsed.data.observation;
    if (observation.profile !== "flow_rendered_tile_candidates") return false;
    const sorted = (
      entries: Array<{ candidateId: string; renderedCopies: number }>,
    ) =>
      [...entries]
        .sort((left, right) =>
          left.candidateId.localeCompare(right.candidateId),
        )
        .map((entry) => `${entry.candidateId}:${entry.renderedCopies}`)
        .join("|");
    return (
      observation.renderedTileCount === profile.renderedTileCount &&
      JSON.stringify([...observation.candidateIds].sort()) ===
        JSON.stringify([...profile.candidateIds].sort()) &&
      observation.repeatedCandidateCount === profile.repeatedCandidateCount &&
      observation.unidentifiedImageCount === profile.unidentifiedImageCount &&
      observation.unrelatedImageCount === profile.unrelatedImageCount &&
      observation.virtualized === profile.virtualized &&
      observation.loadingSignalCount === profile.loadingSignalCount &&
      observation.captureGaps.join("|") === profile.captureGaps.join("|") &&
      sorted(observation.candidateMultiplicity) ===
        sorted(profile.candidateMultiplicity)
    );
  }
  return (
    parsed.data.observation.profile === "flow_labelled_results_region" &&
    parsed.data.observation.regionLabel === profile.regionLabel &&
    parsed.data.observation.observedMediaCount === profile.mediaCount
  );
}

export function classifyFlowResultObservations(
  baselineInput: unknown,
  candidatesInput: readonly unknown[],
): FlowResultObservationClassification[] {
  const parsedBaseline = FlowImageResultBaselineSchema.safeParse(baselineInput);
  if (!parsedBaseline.success) {
    return candidatesInput.map(() => ({
      classification: "ambiguous_identity",
      reason: "candidate_invalid",
    }));
  }
  const baseline = parsedBaseline.data;
  const knownBaseline = new Set(
    baseline.existingResultIdentities.map(flowProviderResultIdentityKey),
  );
  const seen = new Map<string, number>();

  return candidatesInput.map((candidateInput, index) => {
    const parsedCandidate =
      FlowResultObservationCandidateSchema.safeParse(candidateInput);
    if (!parsedCandidate.success) {
      return {
        classification: "ambiguous_identity",
        reason: "candidate_invalid",
      };
    }
    const candidate = parsedCandidate.data;
    if (!candidate.identity) {
      return {
        classification: "ambiguous_identity",
        reason: "stable_identity_missing",
      };
    }
    if (candidate.identity.projectId !== baseline.binding.projectId) {
      return {
        classification: "excluded",
        reason: "identity_project_mismatch",
        identity: candidate.identity,
      };
    }
    const binding = candidate.binding;
    if (
      !binding ||
      Object.entries(baseline.binding).some(
        ([key, value]) => binding[key as keyof typeof binding] !== value,
      )
    ) {
      return {
        classification: "excluded",
        reason: "binding_mismatch",
        identity: candidate.identity,
      };
    }

    const identityKey = flowProviderResultIdentityKey(candidate.identity);
    const duplicateOfIndex = seen.get(identityKey);
    if (duplicateOfIndex !== undefined) {
      return {
        classification: "excluded",
        reason: "duplicate_logical_identity",
        identity: candidate.identity,
        duplicateOfIndex,
      };
    }
    seen.set(identityKey, index);

    if (knownBaseline.has(identityKey)) {
      return { classification: "baseline", identity: candidate.identity };
    }
    if (baseline.completeness === "incomplete") {
      return {
        classification: "excluded",
        reason: "baseline_inventory_incomplete",
        identity: candidate.identity,
      };
    }
    if (candidate.attributionProof) {
      if (
        candidate.attributionProof.attemptId !== baseline.binding.attemptId ||
        candidate.attributionProof.sourceSnapshotId !==
          baseline.binding.sourceSnapshotId
      ) {
        return {
          classification: "excluded",
          reason: "attribution_proof_mismatch",
          identity: candidate.identity,
        };
      }
      return {
        classification: "positively_attributable",
        identity: candidate.identity,
      };
    }
    // A post-dispatch appearance is only a candidate; time and order do not
    // establish ownership of a Flow result.
    return { classification: "new_candidate", identity: candidate.identity };
  });
}
