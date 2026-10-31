import { z } from "zod";
import { sha256Hex } from "../batches/hashPrompt";

export const TIMED_IMAGE_SUBMISSION_INTERVAL_MS = 40_000 as const;

export const IMAGE_QUEUE_ITEM_STATES = [
  "pending",
  "sending",
  "sent",
  "blocked",
  "stopped",
] as const;
export type ImageQueueItemState = (typeof IMAGE_QUEUE_ITEM_STATES)[number];

export const IMAGE_QUEUE_STATES = [
  "ready",
  "waiting",
  "sent",
  "paused",
  "blocked",
  "stopped",
] as const;
export type ImageQueueState = (typeof IMAGE_QUEUE_STATES)[number];

export type ImageQueueManualSettingsDeclaration = {
  readonly confirmationId: string;
  readonly confirmedAt: number;
  readonly tabId: number;
  readonly projectId: string;
  readonly canonicalTarget: string;
  readonly declaredVariantCount: number;
  readonly userAttested: true;
};

export type PromptReadbackDiagnostic = {
  readonly queueId: string;
  readonly queueItemId: string;
  readonly order: number;
  readonly shotId?: string;
  readonly stage: string;
  readonly recordedAt: number;
  readonly expectedCodeUnits: number;
  readonly actualCodeUnits?: number;
  readonly expectedUtf8Bytes: number;
  readonly actualUtf8Bytes?: number;
  readonly expectedSha256: string;
  readonly actualSha256?: string;
  readonly firstDifferenceOffset?: number;
  readonly mismatchCategory?: "length" | "code-unit" | "representation";
  readonly expectedContext?: string;
  readonly actualContext?: string;
  readonly readError?: string;
  settledActualCodeUnits?: number;
  settledActualUtf8Bytes?: number;
  settledActualSha256?: string;
  settledEqual?: boolean;
  settledDifferenceOffset?: number;
};

export type FlowEditorReadbackInspectionResult = {
  readonly queueId: string;
  readonly queueItemId: string;
  readonly order: number;
  readonly shotId?: string;
  readonly stage: "read_only_editor_inspection";
  readonly inspectedAt: number;
  readonly equal: boolean;
  readonly expectedCodeUnits: number;
  readonly actualCodeUnits?: number;
  readonly expectedUtf8Bytes: number;
  readonly actualUtf8Bytes?: number;
  readonly expectedSha256: string;
  readonly actualSha256?: string;
  readonly firstDifferenceOffset?: number;
  readonly mismatchCategory?: "length" | "code-unit" | "representation";
  readonly expectedContext?: string;
  readonly actualContext?: string;
  readonly readError?: string;
};

export type ImageQueueItem = {
  readonly queueItemId: string;
  readonly sourceItemId: string;
  readonly order: number;
  readonly shotId?: string;
  readonly rawJsonBody: string;
  readonly promptHash: string;
  readonly sourceSpan: { readonly start: number; readonly end: number };
  itemState: ImageQueueItemState;
  providerOutcome: "not_started" | "unknown";
  dispatchIntent?: {
    attemptId: string;
    recordedAt: number;
    activationStartedAt?: number;
  };
  blockReason?: string;
  readbackDiagnostic?: PromptReadbackDiagnostic;
  dispatchReceipt?: {
    attemptId: string;
    storedAt: number;
    evidence: "activation_pair_sent_or_uncertain";
  };
};

export type ImageSubmissionQueueRecord = {
  readonly queueId: string;
  readonly workspaceId: string;
  readonly kind: "image";
  readonly mode: "timed_submission";
  readonly intervalMs: typeof TIMED_IMAGE_SUBMISSION_INTERVAL_MS;
  state: ImageQueueState;
  pauseReason?: string;
  readonly sourceText: string;
  readonly sourceHash: string;
  readonly sourceMode:
    "single_json_value" | "numbered_json_blocks" | "versioned_envelope";
  readonly selectedProject: {
    readonly provider: "Flow";
    readonly tabId: number;
    readonly projectId: string;
    readonly canonicalTarget: string;
    readonly selectionRevision: number | null;
  };
  readonly manualSettingsDeclaration: ImageQueueManualSettingsDeclaration;
  readonly items: readonly ImageQueueItem[];
  lastDispatchReceiptStoredAt: number | null;
  nextEligibleDispatchAt: number | null;
  readonly createdAt: number;
  updatedAt: number;
  revision: number;
};

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const PromptReadbackDiagnosticSchema = z
  .object({
    queueId: z.string().uuid().or(z.string().min(1).max(128)),
    queueItemId: z.string().min(1).max(512),
    order: z.number().int().nonnegative(),
    shotId: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    stage: z.string().min(1).max(64),
    recordedAt: z.number().finite().nonnegative(),
    expectedCodeUnits: z.number().int().nonnegative(),
    actualCodeUnits: z.number().int().nonnegative().optional(),
    expectedUtf8Bytes: z.number().int().nonnegative(),
    actualUtf8Bytes: z.number().int().nonnegative().optional(),
    expectedSha256: hashSchema,
    actualSha256: hashSchema.optional(),
    firstDifferenceOffset: z.number().int().nonnegative().optional(),
    mismatchCategory: z
      .enum(["length", "code-unit", "representation"])
      .optional(),
    expectedContext: z.string().max(256).optional(),
    actualContext: z.string().max(256).optional(),
    readError: z.string().max(128).optional(),
    settledActualCodeUnits: z.number().int().nonnegative().optional(),
    settledActualUtf8Bytes: z.number().int().nonnegative().optional(),
    settledActualSha256: hashSchema.optional(),
    settledEqual: z.boolean().optional(),
    settledDifferenceOffset: z.number().int().nonnegative().optional(),
  })
  .strict();

const itemSchema = z
  .object({
    queueItemId: z.string().min(1).max(512),
    sourceItemId: z.string().min(1).max(256),
    order: z.number().int().nonnegative(),
    shotId: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    rawJsonBody: z.string().min(2),
    promptHash: hashSchema,
    sourceSpan: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict(),
    itemState: z.enum(IMAGE_QUEUE_ITEM_STATES),
    providerOutcome: z.enum(["not_started", "unknown"]),
    dispatchIntent: z
      .object({
        attemptId: z.string().min(1).max(128),
        recordedAt: z.number().finite().nonnegative(),
        activationStartedAt: z.number().finite().nonnegative().optional(),
      })
      .strict()
      .optional(),
    blockReason: z.string().min(1).max(64).optional(),
    readbackDiagnostic: PromptReadbackDiagnosticSchema.optional(),
    dispatchReceipt: z
      .object({
        attemptId: z.string().min(1).max(128),
        storedAt: z.number().finite().nonnegative(),
        evidence: z.literal("activation_pair_sent_or_uncertain"),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((item) => item.sourceSpan.end >= item.sourceSpan.start)
  .refine(
    (item) => (item.itemState === "sent") === Boolean(item.dispatchReceipt),
  )
  .refine(
    (item) =>
      item.providerOutcome ===
      (item.dispatchReceipt ||
      item.dispatchIntent?.activationStartedAt !== undefined
        ? "unknown"
        : "not_started"),
  );

export const ImageSubmissionQueueRecordSchema = z
  .object({
    queueId: z.string().uuid(),
    workspaceId: z.string().min(1).max(128),
    kind: z.literal("image"),
    mode: z.literal("timed_submission"),
    intervalMs: z.literal(TIMED_IMAGE_SUBMISSION_INTERVAL_MS),
    state: z.enum(IMAGE_QUEUE_STATES),
    pauseReason: z.string().min(1).max(64).optional(),
    sourceText: z.string().min(1),
    sourceHash: hashSchema,
    sourceMode: z.enum([
      "single_json_value",
      "numbered_json_blocks",
      "versioned_envelope",
    ]),
    selectedProject: z
      .object({
        provider: z.literal("Flow"),
        tabId: z.number().int().nonnegative(),
        projectId: z.string().min(1).max(256),
        canonicalTarget: z.string().min(1).max(2048),
        selectionRevision: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    manualSettingsDeclaration: z
      .object({
        confirmationId: z.string().min(1).max(128),
        confirmedAt: z.number().finite().nonnegative(),
        tabId: z.number().int().nonnegative(),
        projectId: z.string().min(1).max(256),
        canonicalTarget: z.string().min(1).max(2048),
        declaredVariantCount: z.number().int().positive(),
        userAttested: z.literal(true),
      })
      .strict(),
    items: z.array(itemSchema).min(1).max(100),
    lastDispatchReceiptStoredAt: z.number().finite().nonnegative().nullable(),
    nextEligibleDispatchAt: z.number().finite().nonnegative().nullable(),
    createdAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .refine((record) => record.items.every((item, index) => item.order === index))
  .refine(
    (record) =>
      record.selectedProject.tabId === record.manualSettingsDeclaration.tabId &&
      record.selectedProject.projectId ===
        record.manualSettingsDeclaration.projectId &&
      record.selectedProject.canonicalTarget ===
        record.manualSettingsDeclaration.canonicalTarget,
  )
  .refine((record) => {
    const sent = record.items.filter((item) => item.dispatchReceipt);
    return sent.length === 0
      ? record.lastDispatchReceiptStoredAt === null &&
          record.nextEligibleDispatchAt === null &&
          record.state !== "waiting"
      : record.state !== "ready" &&
          record.lastDispatchReceiptStoredAt ===
            sent.at(-1)?.dispatchReceipt?.storedAt &&
          (record.nextEligibleDispatchAt === null
            ? record.items.every((item) => item.itemState === "sent")
            : record.nextEligibleDispatchAt >=
              record.lastDispatchReceiptStoredAt +
                TIMED_IMAGE_SUBMISSION_INTERVAL_MS);
  });

export function canTransitionImageQueue(
  from: ImageQueueState,
  to: ImageQueueState,
): boolean {
  const allowed: Record<ImageQueueState, readonly ImageQueueState[]> = {
    ready: ["waiting", "paused", "blocked", "stopped"],
    waiting: ["sent", "paused", "blocked", "stopped"],
    paused: ["ready", "waiting", "stopped"],
    blocked: ["stopped"],
    sent: [],
    stopped: [],
  };
  return allowed[from].includes(to);
}

export function canTransitionImageQueueItem(
  from: ImageQueueItemState,
  to: ImageQueueItemState,
): boolean {
  const allowed: Record<ImageQueueItemState, readonly ImageQueueItemState[]> = {
    pending: ["sending", "blocked", "stopped"],
    sending: ["sent", "blocked"],
    sent: [],
    blocked: [],
    stopped: [],
  };
  return allowed[from].includes(to);
}

/** P06.2 must call this only after the preceding dispatch receipt is durable. */
export function nextTimedDispatchDeadline(
  receiptDurablyStoredAt: number,
): number {
  if (!Number.isFinite(receiptDurablyStoredAt) || receiptDurablyStoredAt < 0) {
    throw new RangeError("Dispatch deadline inputs must be finite timestamps.");
  }
  return receiptDurablyStoredAt + TIMED_IMAGE_SUBMISSION_INTERVAL_MS;
}

export type FlowPromptReadbackComparison = {
  equal: boolean;
  expectedCodeUnits: number;
  actualCodeUnits: number;
  expectedUtf8Bytes: number;
  actualUtf8Bytes: number;
  expectedSha256: string;
  actualSha256: string;
  firstDifferenceOffset?: number;
  mismatchCategory?: "length" | "code-unit" | "representation";
  expectedContext?: string;
  actualContext?: string;
};

export async function comparePromptReadbackSafely(input: {
  expectedText: string;
  actualText: string;
  expectedSha256?: string;
}): Promise<FlowPromptReadbackComparison> {
  const { expectedText, actualText } = input;
  const limit = Math.min(expectedText.length, actualText.length);
  let firstDifferenceOffset = 0;
  while (
    firstDifferenceOffset < limit &&
    expectedText[firstDifferenceOffset] === actualText[firstDifferenceOffset]
  ) {
    firstDifferenceOffset += 1;
  }
  const equal = expectedText === actualText;
  const contextStart = Math.max(0, firstDifferenceOffset - 16);
  const contextEnd = firstDifferenceOffset + 16;
  const expectedSha256 =
    input.expectedSha256 ?? (await sha256Hex(expectedText));
  const actualSha256 = await sha256Hex(actualText);
  return {
    equal,
    expectedCodeUnits: expectedText.length,
    actualCodeUnits: actualText.length,
    expectedUtf8Bytes: new TextEncoder().encode(expectedText).byteLength,
    actualUtf8Bytes: new TextEncoder().encode(actualText).byteLength,
    expectedSha256,
    actualSha256,
    firstDifferenceOffset: equal ? undefined : firstDifferenceOffset,
    mismatchCategory: equal
      ? undefined
      : expectedText.length === actualText.length
        ? "code-unit"
        : firstDifferenceOffset === limit
          ? "length"
          : "representation",
    ...(equal
      ? {}
      : {
          expectedContext: JSON.stringify(
            expectedText.slice(contextStart, contextEnd),
          ),
          actualContext: JSON.stringify(
            actualText.slice(contextStart, contextEnd),
          ),
        }),
  };
}
