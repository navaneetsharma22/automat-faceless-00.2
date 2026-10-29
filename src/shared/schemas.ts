import { z } from "zod";
import { INPUT_POLICY } from "../domain/batches/inputPolicy";
import {
  FLOW_IMAGE_ATTEMPT_STATES,
  flowImageAttemptActiveKey,
} from "../domain/jobs/attempt";
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
    stage: z.enum(["preparation", "verification", "dispatch", "recovery"]),
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
      })
      .strict(),
    state: z.enum(FLOW_IMAGE_ATTEMPT_STATES),
    baseline: z
      .object({
        regionLabel: z.string().min(1).max(80),
        mediaCount: z.number().int().nonnegative().max(100_000),
        capturedAt: z.number().finite().nonnegative(),
      })
      .strict()
      .optional(),
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
      attempt.activeKey === undefined ||
      attempt.activeKey === flowImageAttemptActiveKey(attempt.itemId),
  )
  .refine((attempt) =>
    attempt.state === "failed-before-dispatch"
      ? attempt.activeKey === undefined
      : attempt.activeKey === flowImageAttemptActiveKey(attempt.itemId),
  );

export const FlowSettingsConfirmationSchema = z
  .object({
    confirmationId: z.string().min(1).max(128),
    confirmedAt: z.number().finite().nonnegative(),
    tabId: z.number().int().nonnegative(),
    projectId: z.string().min(1).max(512),
    canonicalTarget: z.string().min(1).max(2048),
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
      })
      .strict(),
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
