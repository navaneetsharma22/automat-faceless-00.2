import { z } from "zod";

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
