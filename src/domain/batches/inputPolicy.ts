import type {
  BatchBudgetAssessment,
  BatchBudgetIssue,
  IdentityResolution,
  PromptIdentity,
  PromptMeasurement,
} from "./types";

/**
 * Preliminary application guardrails. The importer and UI have not yet been
 * measured, so these are provisional and do not state provider capacity.
 */
export const INPUT_POLICY = {
  maxPromptCodeUnits: 1_500_000,
  maxPromptUtf8Bytes: 2_000_000,
  maxBatchCodeUnits: 5_000_000,
  maxBatchUtf8Bytes: 10_000_000,
  maxPromptCount: 50,
  maxJsonNestingDepth: 128,
  limitsAreProvisional: true,
} as const;

/**
 * P03.2 scanner grammar. A label must begin at the first non-horizontal
 * whitespace on a physical line, and its JSON delimiter must follow on that
 * same line. Prompt labels are case-sensitive and use a colon; bare labels
 * accept colon, period, or close parenthesis.
 */
export const OUTER_LABEL_GRAMMAR =
  "[space-or-tab]*(bare-positive-decimal plus :, ., or ); OR case-sensitive `Prompt` + space-or-tab + positive-decimal + :)[space-or-tab]*(same-line `{` or `[`)" as const;

/** Prefix matcher; the scanner applies it only between complete JSON values. */
export const OUTER_LABEL_PREFIX_PATTERN =
  /^[ \t]*(?:([0-9]+)[:.)]|Prompt[ \t]+([0-9]+):)[ \t]*(?=\{|\[)/;

const positiveDecimal = /^[0-9]+$/;

/** Canonicalize decimal identity without converting through Number. */
export function canonicalizeShotId(value: unknown): string | undefined {
  if (typeof value !== "string" || !positiveDecimal.test(value)) {
    return undefined;
  }
  const canonical = value.replace(/^0+/, "");
  return canonical.length > 0 ? canonical : undefined;
}

export type ShotIdentityInputs = {
  outerLabel?: unknown;
  envelopeShotId?: unknown;
  /** Only the recognized top-level creative-body `shot_id` field is passed. */
  bodyShotId?: unknown;
  promptCount: number;
};

export function resolveShotIdentity(
  input: ShotIdentityInputs,
): IdentityResolution {
  const candidates = [
    ["outer_label", input.outerLabel],
    ["envelope", input.envelopeShotId],
    ["body_shot_id", input.bodyShotId],
  ] as const;
  const present = candidates.filter(([, value]) => value !== undefined);
  const normalized = present.map(([source, value]) => ({
    source,
    shotId: canonicalizeShotId(value),
  }));

  if (normalized.some((candidate) => candidate.shotId === undefined)) {
    return { ok: false, reason: "invalid_identity" };
  }

  const ids = new Set(normalized.map((candidate) => candidate.shotId));
  if (ids.size > 1) return { ok: false, reason: "conflicting_identity" };

  const explicit = normalized[0];
  if (explicit?.shotId) {
    return {
      ok: true,
      shotId: explicit.shotId,
      identitySource: explicit.source,
      kind: "explicit",
    };
  }

  return input.promptCount === 1
    ? { ok: true, kind: "unlabelled_single" }
    : { ok: false, reason: "unlabelled_multiple_prompts" };
}

/** Duplicate shot IDs are scoped to a workspace, never to gallery order. */
export function duplicateShotIds(
  identities: readonly PromptIdentity[],
): Array<{ workspaceId: string; shotId: string }> {
  const seen = new Set<string>();
  const duplicates = new Map<string, { workspaceId: string; shotId: string }>();
  for (const identity of identities) {
    if (!identity.shotId) continue;
    const key = `${identity.workspaceId}\u0000${identity.shotId}`;
    if (seen.has(key)) {
      duplicates.set(key, {
        workspaceId: identity.workspaceId,
        shotId: identity.shotId,
      });
    }
    seen.add(key);
  }
  return [...duplicates.values()];
}

export function measurePromptBody(rawBody: string): PromptMeasurement {
  return {
    stringCodeUnits: rawBody.length,
    utf8Bytes: new TextEncoder().encode(rawBody).byteLength,
  };
}

/** Early whole-source guard before scanning or parsing the batch. */
export function assessInputSourceSize(
  source: string,
): Array<"input_code_units_exceeded" | "input_utf8_bytes_exceeded"> {
  const measurement = measurePromptBody(source);
  const issues: Array<
    "input_code_units_exceeded" | "input_utf8_bytes_exceeded"
  > = [];
  if (measurement.stringCodeUnits > INPUT_POLICY.maxBatchCodeUnits) {
    issues.push("input_code_units_exceeded");
  }
  if (measurement.utf8Bytes > INPUT_POLICY.maxBatchUtf8Bytes) {
    issues.push("input_utf8_bytes_exceeded");
  }
  return issues;
}

/** Budget-only assessment; JSON syntax, identity and source spans are separate. */
export function assessBatchBudget(
  rawBodies: readonly string[],
): BatchBudgetAssessment {
  const prompts = rawBodies.map(measurePromptBody);
  const total = prompts.reduce(
    (sum, prompt) => ({
      stringCodeUnits: sum.stringCodeUnits + prompt.stringCodeUnits,
      utf8Bytes: sum.utf8Bytes + prompt.utf8Bytes,
    }),
    { stringCodeUnits: 0, utf8Bytes: 0 },
  );
  const issues: BatchBudgetIssue[] = [];

  if (prompts.length === 0) issues.push("empty_batch");
  if (prompts.length > INPUT_POLICY.maxPromptCount) {
    issues.push("too_many_items");
  }
  if (
    prompts.some(
      (prompt) => prompt.stringCodeUnits > INPUT_POLICY.maxPromptCodeUnits,
    )
  ) {
    issues.push("prompt_code_units_exceeded");
  }
  if (
    prompts.some((prompt) => prompt.utf8Bytes > INPUT_POLICY.maxPromptUtf8Bytes)
  ) {
    issues.push("prompt_utf8_bytes_exceeded");
  }
  if (total.stringCodeUnits > INPUT_POLICY.maxBatchCodeUnits) {
    issues.push("batch_code_units_exceeded");
  }
  if (total.utf8Bytes > INPUT_POLICY.maxBatchUtf8Bytes) {
    issues.push("batch_utf8_bytes_exceeded");
  }

  return {
    accepted: issues.length === 0,
    itemCount: prompts.length,
    total,
    prompts,
    issues,
  };
}
