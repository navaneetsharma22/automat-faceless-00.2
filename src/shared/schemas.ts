import { z } from "zod";
import { INPUT_POLICY } from "../domain/batches/inputPolicy";
import {
  FLOW_IMAGE_ATTEMPT_STATES,
  flowImageAttemptActiveKey,
} from "../domain/jobs/attempt";
import {
  FlowImageResultBaselineSchema,
  FlowImageCountBaselineDeclarationSchema,
  FlowImageCountDecisionSchema,
  FlowImageCountModeRequestSchema,
  FlowImageObservationOutcomeSchema,
  FlowImageObservationReceiptSchema,
  FlowImageObservationSessionSchema,
  FlowStructuralObservationEventSchema,
  FlowImageResultLinkSchema,
  flowProviderResultIdentityKey,
  flowResultBaselineMatchesAttempt,
} from "../domain/jobs/results";
import { flowImagePromptSnapshotId } from "../domain/batches/flowImagePromptSnapshot";

const promptSourceSchema = z
  .string()
  .max(INPUT_POLICY.maxBatchCodeUnits)
  .refine(
    (source) =>
      new TextEncoder().encode(source).byteLength <=
      INPUT_POLICY.maxBatchUtf8Bytes,
    "Source exceeds the provisional total UTF-8 byte limit.",
  );

const workspaceIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const promptMeasurementSchema = z
  .object({
    stringCodeUnits: z.number().int().nonnegative(),
    utf8Bytes: z.number().int().nonnegative(),
  })
  .strict();

const sourceSpanSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((span) => span.end >= span.start);

export const PromptBatchInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    kind: z.enum(["image", "video"]),
    sourceText: promptSourceSchema,
  })
  .strict();

export const PromptBatchKeySchema = z
  .object({ workspaceId: workspaceIdSchema, kind: z.enum(["image", "video"]) })
  .strict();

export const PromptItemRecordSchema = z
  .object({
    id: z.string().min(1).max(256),
    batchId: z.string().min(1).max(256),
    workspaceId: workspaceIdSchema,
    kind: z.enum(["image", "video"]),
    order: z
      .number()
      .int()
      .nonnegative()
      .max(INPUT_POLICY.maxPromptCount - 1),
    shotId: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    identitySource: z
      .enum(["outer_label", "envelope", "body_shot_id"])
      .optional(),
    rawJsonBody: z
      .string()
      .min(2)
      .max(INPUT_POLICY.maxPromptCodeUnits)
      .refine(
        (body) =>
          new TextEncoder().encode(body).byteLength <=
          INPUT_POLICY.maxPromptUtf8Bytes,
      ),
    sourceSpan: sourceSpanSchema,
    measurement: promptMeasurementSchema,
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: z.number().finite().nonnegative(),
  })
  .strict()
  .refine(
    (item) =>
      item.measurement.stringCodeUnits === item.rawJsonBody.length &&
      item.measurement.utf8Bytes ===
        new TextEncoder().encode(item.rawJsonBody).byteLength,
  );

export const PromptBatchRecordSchema = z
  .object({
    id: z.string().min(1).max(256),
    workflowId: workspaceIdSchema,
    workspaceId: workspaceIdSchema,
    kind: z.enum(["image", "video"]),
    status: z.literal("draft"),
    sourceText: promptSourceSchema,
    sourceMode: z.enum([
      "single_json_value",
      "numbered_json_blocks",
      "versioned_envelope",
    ]),
    orderedItemIds: z
      .array(z.string().min(1).max(256))
      .min(1)
      .max(INPUT_POLICY.maxPromptCount),
    total: promptMeasurementSchema,
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict();

export const PromptBatchSnapshotSchema = z
  .object({
    batch: PromptBatchRecordSchema,
    items: z
      .array(PromptItemRecordSchema)
      .min(1)
      .max(INPUT_POLICY.maxPromptCount),
  })
  .strict();

export const FlowImagePromptSnapshotRecordSchema = z
  .object({
    snapshotId: z.string().min(1).max(512),
    workspaceId: workspaceIdSchema,
    batchId: z.string().min(1).max(256),
    itemId: z.string().min(1).max(256),
    promptHash: z.string().regex(/^[0-9a-f]{64}$/),
    rawJsonBody: z
      .string()
      .min(2)
      .max(INPUT_POLICY.maxPromptCodeUnits)
      .refine(
        (body) =>
          new TextEncoder().encode(body).byteLength <=
          INPUT_POLICY.maxPromptUtf8Bytes,
      ),
    promptCodeUnits: z.number().int().positive(),
    promptUtf8Bytes: z.number().int().positive(),
    createdAt: z.number().finite().nonnegative(),
  })
  .strict()
  .refine(
    (snapshot) =>
      snapshot.snapshotId ===
        flowImagePromptSnapshotId(snapshot.itemId, snapshot.promptHash) &&
      snapshot.promptCodeUnits === snapshot.rawJsonBody.length &&
      snapshot.promptUtf8Bytes ===
        new TextEncoder().encode(snapshot.rawJsonBody).byteLength,
  );

const flowImageAttemptEventSchema = z
  .object({
    stage: z.enum([
      "preparation",
      "verification",
      "preflight",
      "observer",
      "dispatch",
      "storage",
      "recovery",
    ]),
    at: z.number().finite().nonnegative(),
    method: z.enum([
      "none",
      "CDP Input.insertText",
      "CDP Input.dispatchMouseEvent",
    ]),
    code: z
      .string()
      .regex(/^[a-z0-9_]{1,64}$/)
      .optional(),
  })
  .strict();

export const FlowImageAttemptRecordSchema = z
  .object({
    attemptId: z.string().min(1).max(128),
    activeKey: z.string().min(1).max(512).optional(),
    confirmationKey: z.string().min(1).max(128),
    workspaceId: workspaceIdSchema,
    batchId: z.string().min(1).max(256),
    itemId: z.string().min(1).max(256),
    shotId: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    promptHash: z.string().regex(/^[0-9a-f]{64}$/),
    sourceSnapshotId: z.string().min(1).max(512),
    promptCodeUnits: z
      .number()
      .int()
      .positive()
      .max(INPUT_POLICY.maxPromptCodeUnits),
    promptUtf8Bytes: z
      .number()
      .int()
      .positive()
      .max(INPUT_POLICY.maxPromptUtf8Bytes),
    provider: z.literal("Flow"),
    projectId: z.string().min(1).max(512),
    tabId: z.number().int().nonnegative(),
    frameId: z.string().min(1).max(256),
    loaderId: z.string().min(1).max(256),
    documentId: z.string().min(1).max(256).optional(),
    senderFrameId: z.number().int().nonnegative().optional(),
    buildId: z.string().min(1).max(128),
    protocolVersion: z.number().int().positive(),
    settingsConfirmation: z
      .object({
        confirmationId: z.string().min(1).max(128),
        confirmedAt: z.number().finite().nonnegative(),
        userAttested: z.literal(true),
        tabId: z.number().int().nonnegative(),
        projectId: z.string().min(1).max(512),
        canonicalTarget: z.string().min(1).max(2048).optional(),
        declaredVariantCount: z.number().int().positive().max(100).optional(),
      })
      .strict(),
    state: z.enum(FLOW_IMAGE_ATTEMPT_STATES),
    baseline: z
      .union([
        z
          .object({
            regionLabel: z.string().min(1).max(80),
            mediaCount: z.number().int().nonnegative().max(100_000),
            capturedAt: z.number().finite().nonnegative(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("flow_empty_workspace_ui"),
            workspaceTag: z.literal("flow-project-page"),
            markerPhrase: z.literal("Start creating or drop media"),
            markerCount: z.literal(1),
            visibleMediaCount: z.literal(0),
            visibleResultCardCount: z.literal(0),
            loadingMarkerCount: z.literal(0),
            capturedAt: z.number().finite().nonnegative(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("flow_rendered_tile_candidates"),
            workspaceTag: z.literal("flow-project-page"),
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
            capturedAt: z.number().finite().nonnegative(),
          })
          .strict()
          .superRefine((baseline, context) => {
            const ids = new Set(baseline.candidateIds);
            if (
              ids.size !== baseline.candidateIds.length ||
              baseline.candidateMultiplicity.length !== ids.size ||
              baseline.candidateMultiplicity.some(
                (candidate) => !ids.has(candidate.candidateId),
              )
            ) {
              context.addIssue({
                code: "custom",
                message: "rendered_candidate_baseline_must_be_deduplicated",
              });
            }
          }),
      ])
      .optional(),
    resultBaseline: FlowImageResultBaselineSchema.optional(),
    observationSession: FlowImageObservationSessionSchema.optional(),
    resultLinks: z.array(FlowImageResultLinkSchema).max(100).optional(),
    observationReceipts: z
      .array(FlowImageObservationReceiptSchema)
      .max(128)
      .optional(),
    structuralObservations: z
      .array(FlowStructuralObservationEventSchema)
      .max(64)
      .optional(),
    resultOutcome: FlowImageObservationOutcomeSchema.optional(),
    countSessionId: z.string().uuid().optional(),
    countBaseline: FlowImageCountBaselineDeclarationSchema.optional(),
    countDecision: FlowImageCountDecisionSchema.optional(),
    events: z.array(flowImageAttemptEventSchema).min(1).max(24),
    createdAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict()
  .refine(
    (attempt) =>
      attempt.sourceSnapshotId ===
      flowImagePromptSnapshotId(attempt.itemId, attempt.promptHash),
  )
  .refine(
    (attempt) =>
      attempt.resultBaseline === undefined ||
      flowResultBaselineMatchesAttempt(attempt.resultBaseline, attempt),
    { message: "result_baseline_attempt_binding_mismatch" },
  )
  .refine(
    (attempt) =>
      attempt.observationSession === undefined ||
      (attempt.documentId === attempt.observationSession.documentId &&
        attempt.senderFrameId === attempt.observationSession.senderFrameId),
    { message: "observation_session_document_binding_mismatch" },
  )
  .refine((attempt) => {
    if (!attempt.resultBaseline) return true;
    const declaration = attempt.resultBaseline.variantDeclaration;
    const attemptCount = attempt.settingsConfirmation.declaredVariantCount;
    return declaration.status === "absent"
      ? attemptCount === undefined
      : declaration.count === attemptCount;
  }, "attempt_variant_declaration_mismatch")
  .refine((attempt) => {
    if (!attempt.countBaseline) return attempt.countDecision === undefined;
    const baseline = attempt.countBaseline;
    const decision = attempt.countDecision;
    const declaredVariantCount =
      attempt.settingsConfirmation.declaredVariantCount;
    return Boolean(
      decision &&
      declaredVariantCount !== undefined &&
      attempt.countSessionId === baseline.countSessionId &&
      baseline.projectId === attempt.projectId &&
      baseline.tabId === attempt.tabId &&
      baseline.documentId === attempt.documentId &&
      baseline.buildId === attempt.buildId &&
      baseline.protocolVersion === attempt.protocolVersion &&
      baseline.canonicalTarget ===
        attempt.settingsConfirmation.canonicalTarget &&
      decision.countSessionId === baseline.countSessionId &&
      decision.mode === baseline.mode &&
      decision.startingImageCount === baseline.startingImageCount &&
      decision.declaredVariantCount === declaredVariantCount &&
      decision.expectedCumulativeAdditions ===
        baseline.priorDeclaredAdditions + declaredVariantCount &&
      decision.priorMatchedAttemptIds.length ===
        baseline.priorMatchedAttemptIds.length &&
      decision.priorMatchedAttemptIds.every(
        (attemptId, index) =>
          attemptId === baseline.priorMatchedAttemptIds[index],
      ),
    );
  }, "attempt_count_decision_binding_mismatch")
  .refine((attempt) => {
    const identities = (attempt.resultLinks ?? []).map((link) =>
      flowProviderResultIdentityKey(link.identity),
    );
    return new Set(identities).size === identities.length;
  }, "duplicate_result_link_identity")
  .refine((attempt) => {
    const receipts = attempt.observationReceipts ?? [];
    return (
      new Set(receipts.map((receipt) => receipt.observationId)).size ===
        receipts.length &&
      new Set(receipts.map((receipt) => receipt.sequence)).size ===
        receipts.length
    );
  }, "duplicate_observation_receipt")
  .refine(
    (attempt) =>
      attempt.activeKey === undefined ||
      attempt.activeKey ===
        flowImageAttemptActiveKey(attempt.itemId, attempt.promptHash) ||
      attempt.activeKey === flowImageAttemptActiveKey(attempt.itemId),
  )
  .refine((attempt) =>
    attempt.state === "failed-before-dispatch"
      ? attempt.activeKey === undefined
      : attempt.activeKey ===
          flowImageAttemptActiveKey(attempt.itemId, attempt.promptHash) ||
        attempt.activeKey === flowImageAttemptActiveKey(attempt.itemId),
  );

export const FlowSettingsConfirmationSchema = z
  .object({
    confirmationId: z.string().min(1).max(128),
    confirmedAt: z.number().finite().nonnegative(),
    tabId: z.number().int().nonnegative(),
    projectId: z.string().min(1).max(512),
    canonicalTarget: z.string().min(1).max(2048),
    declaredVariantCount: z.number().int().positive().max(100),
  })
  .strict();
export type FlowSettingsConfirmation = z.infer<
  typeof FlowSettingsConfirmationSchema
>;

const requestBase = z
  .object({
    protocolVersion: z.number().int().positive(),
    buildId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
  })
  .strict();

export const AppRequestSchema = z.discriminatedUnion("type", [
  requestBase.extend({
    type: z.literal("foundation.ping"),
    payload: z.object({}).strict(),
  }),
  requestBase.extend({
    type: z.literal("promptDraft.put"),
    payload: z
      .object({
        id: z.string().min(1).max(128),
        kind: z.enum(["image", "video"]),
        rawText: z.string(),
      })
      .strict(),
  }),
  requestBase.extend({
    type: z.literal("promptDraft.get"),
    payload: z.object({ id: z.string().min(1).max(128) }).strict(),
  }),
  requestBase.extend({
    type: z.literal("promptBatch.put"),
    payload: PromptBatchInputSchema,
  }),
  requestBase.extend({
    type: z.literal("promptBatch.get"),
    payload: PromptBatchKeySchema,
  }),
  requestBase.extend({
    type: z.literal("connections.recordSelection"),
    payload: z
      .object({
        provider: z.enum(["Flow", "Vids"]),
        tabId: z.number().int().nonnegative(),
        canonicalTarget: z.string().min(1).max(2048),
      })
      .strict(),
  }),
  requestBase.extend({
    type: z.literal("connections.recordVerification"),
    payload: z
      .object({
        provider: z.enum(["Flow", "Vids"]),
        tabId: z.number().int().nonnegative(),
        canonicalTarget: z.string().min(1).max(2048),
        projectId: z.string().min(1).max(512),
        frameId: z.literal(0),
        documentId: z.string().min(1).max(256),
        documentToken: z.string().min(1).max(256),
        extensionBuildId: z.string().min(1).max(128),
        extensionProtocolVersion: z.number().int().positive(),
        connectorBuildId: z.string().min(1).max(128),
        connectorProtocolVersion: z.number().int().positive(),
        capability: z.literal("read-only-connection-v1"),
      })
      .strict(),
  }),
  requestBase.extend({
    type: z.literal("connections.getSelection"),
    payload: z.object({ provider: z.enum(["Flow", "Vids"]) }).strict(),
  }),
  requestBase.extend({
    type: z.literal("connections.setReconnectIntent"),
    payload: z
      .object({ provider: z.enum(["Flow", "Vids"]), enabled: z.boolean() })
      .strict(),
  }),
  requestBase.extend({
    type: z.literal("flow.prompt.fill"),
    payload: z
      .object({
        workspaceId: workspaceIdSchema,
        promptHash: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
  }),
  requestBase.extend({
    type: z.literal("flow.image.generateOnce"),
    payload: z
      .object({
        workspaceId: workspaceIdSchema,
        promptHash: z.string().regex(/^[0-9a-f]{64}$/),
        settingsConfirmation: FlowSettingsConfirmationSchema,
        countMode: FlowImageCountModeRequestSchema,
      })
      .strict(),
  }),
  requestBase.extend({
    type: z.literal("flow.image.checkReadiness"),
    payload: z.object({}).strict(),
  }),
  requestBase.extend({
    type: z.literal("flow.image.getCountDecision"),
    payload: z.object({ attemptId: z.string().min(1).max(128) }).strict(),
  }),
  requestBase.extend({
    type: z.literal("preferences.getTheme"),
    payload: z.object({}).strict(),
  }),
  requestBase.extend({
    type: z.literal("preferences.setTheme"),
    payload: z.object({ theme: z.enum(["light", "dark"]) }).strict(),
  }),
]);

export const FailureCategorySchema = z.enum([
  "invalid_request",
  "unauthorized_sender",
  "protocol_mismatch",
  "build_mismatch",
  "duplicate_request",
  "not_found",
  "storage_failure",
  "missing_receiver",
  "context_invalidated",
  "worker_error",
  "malformed_response",
  "timeout",
]);

const responseBase = z
  .object({
    protocolVersion: z.number().int(),
    buildId: z.string().max(128),
    requestId: z.string().min(1).max(128),
  })
  .strict();

export const AppResponseSchema = z.discriminatedUnion("ok", [
  responseBase.extend({ ok: z.literal(true), data: z.unknown() }),
  responseBase.extend({
    ok: z.literal(false),
    error: z
      .object({
        category: FailureCategorySchema,
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(240),
      })
      .strict(),
  }),
]);

export type AppRequest = z.infer<typeof AppRequestSchema>;
export type AppResponse = z.infer<typeof AppResponseSchema>;
export type FailureCategory = z.infer<typeof FailureCategorySchema>;
