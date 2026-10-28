import {
  assessBatchBudget,
  assessInputSourceSize,
  duplicateShotIds,
  INPUT_POLICY,
  measurePromptBody,
  OUTER_LABEL_PREFIX_PATTERN,
  resolveShotIdentity,
} from "./inputPolicy";
import {
  scanArrayElementSpans,
  scanJsonValue,
  scanObjectMemberSpans,
  skipJsonWhitespace,
  type JsonSpan,
  type JsonSpanErrorCode,
} from "./jsonSpanScanner";
import type {
  BatchBudgetIssue,
  CanonicalShotId,
  PromptInputMode,
  PromptKind,
  PromptMeasurement,
} from "./types";

export type SourceLocation = { offset: number; line: number; column: number };

export type ImportErrorCode =
  | "empty_input"
  | "empty_batch"
  | "input_code_units_exceeded"
  | "input_utf8_bytes_exceeded"
  | "expected_json_value"
  | "unsupported_prompt_root"
  | "invalid_json"
  | "incomplete_json"
  | "mismatched_json_delimiter"
  | "json_nesting_depth_exceeded"
  | "ambiguous_multiple_values"
  | "mixed_input_modes"
  | "missing_outer_label"
  | "unrecognized_trailing_input"
  | "invalid_envelope"
  | "unsupported_envelope_version"
  | "envelope_kind_mismatch"
  | "invalid_identity"
  | "conflicting_identity"
  | "unlabelled_multiple_prompts"
  | "duplicate_shot_id"
  | "prompt_code_units_exceeded"
  | "prompt_utf8_bytes_exceeded"
  | "batch_code_units_exceeded"
  | "batch_utf8_bytes_exceeded"
  | "too_many_items";

export type ImportError = {
  code: ImportErrorCode;
  message: string;
  location: SourceLocation;
  itemIndex?: number;
};

export type ImportedPrompt = {
  kind: PromptKind;
  rawBody: string;
  sourceSpan: JsonSpan;
  shotId?: CanonicalShotId;
  identitySource?: "outer_label" | "envelope" | "body_shot_id";
  measurement: PromptMeasurement;
};

export type ImportBatchResult =
  | {
      ok: true;
      kind: PromptKind;
      mode: PromptInputMode;
      items: ImportedPrompt[];
      total: PromptMeasurement;
    }
  | { ok: false; error: ImportError };

type Candidate = {
  span: JsonSpan;
  outerLabel?: string;
  envelopeShotId?: string;
  index: number;
};

type EnvelopeItem = {
  shotId: string;
  promptSpan: JsonSpan;
  value: unknown;
};

const RESERVED_ENVELOPE_KEYS = ["schemaVersion", "kind", "items"] as const;

function locationAt(source: string, offset: number): SourceLocation {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\r") {
      if (source[index + 1] === "\n") index += 1;
      line += 1;
      lineStart = index + 1;
    } else if (source[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { offset, line, column: offset - lineStart + 1 };
}

function failure(
  source: string,
  code: ImportErrorCode,
  message: string,
  offset: number,
  itemIndex?: number,
): ImportBatchResult {
  return {
    ok: false,
    error: {
      code,
      message,
      location: locationAt(
        source,
        Math.max(0, Math.min(offset, source.length)),
      ),
      ...(itemIndex === undefined ? {} : { itemIndex }),
    },
  };
}

function mapSpanError(code: JsonSpanErrorCode): ImportErrorCode {
  return code;
}

function getOuterLabel(
  source: string,
  cursor: number,
): { label: string; bodyStart: number } | undefined {
  const lineStart = source.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const lineEndIndex = source.indexOf("\n", lineStart);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  const line = source.slice(lineStart, lineEnd);
  const match = OUTER_LABEL_PREFIX_PATTERN.exec(line);
  if (!match) return undefined;
  const label = match[1] ?? match[2];
  if (label === undefined) return undefined;
  const bodyStart = lineStart + match[0].length;
  if (bodyStart !== cursor && source.slice(lineStart, cursor).trim() !== "") {
    return undefined;
  }
  if (source[bodyStart] !== "{" && source[bodyStart] !== "[") {
    return undefined;
  }
  return { label, bodyStart };
}

function hasOwnRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnvelopeCandidate(value: unknown): value is Record<string, unknown> {
  return (
    hasOwnRecord(value) &&
    RESERVED_ENVELOPE_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function lastMember(
  members: ReturnType<typeof scanObjectMemberSpans>,
  key: string,
): JsonSpan | undefined {
  for (let index = members.length - 1; index >= 0; index -= 1) {
    if (members[index]!.key === key) return members[index]!.value;
  }
  return undefined;
}

function extractEnvelopeItems(
  source: string,
  rootSpan: JsonSpan,
  envelope: Record<string, unknown>,
  requestedKind: PromptKind,
):
  | { ok: true; items: EnvelopeItem[] }
  | {
      ok: false;
      code: ImportErrorCode;
      message: string;
      offset: number;
      itemIndex?: number;
    } {
  if (envelope.schemaVersion !== 1) {
    return {
      ok: false,
      code: "unsupported_envelope_version",
      message: "Only explicit envelope schemaVersion 1 is supported.",
      offset: rootSpan.start,
    };
  }
  if (envelope.kind !== "image" && envelope.kind !== "video") {
    return {
      ok: false,
      code: "invalid_envelope",
      message: "Envelope kind must be image or video.",
      offset: rootSpan.start,
    };
  }
  if (envelope.kind !== requestedKind) {
    return {
      ok: false,
      code: "envelope_kind_mismatch",
      message: `Envelope kind does not match the requested ${requestedKind} import.`,
      offset: rootSpan.start,
    };
  }
  if (!Array.isArray(envelope.items) || envelope.items.length === 0) {
    return {
      ok: false,
      code: "invalid_envelope",
      message: "Envelope items must be a non-empty array.",
      offset: rootSpan.start,
    };
  }
  if (envelope.items.length > INPUT_POLICY.maxPromptCount) {
    return {
      ok: false,
      code: "too_many_items",
      message: `A batch may contain at most ${INPUT_POLICY.maxPromptCount} prompts.`,
      offset: rootSpan.start,
    };
  }

  const rootMembers = scanObjectMemberSpans(source, rootSpan);
  const itemsSpan = lastMember(rootMembers, "items");
  if (!itemsSpan || source[itemsSpan.start] !== "[") {
    return {
      ok: false,
      code: "invalid_envelope",
      message: "Envelope items must be an array.",
      offset: rootSpan.start,
    };
  }

  const elementSpans = scanArrayElementSpans(source, itemsSpan);
  if (elementSpans.length !== envelope.items.length) {
    return {
      ok: false,
      code: "invalid_envelope",
      message: "Envelope item source spans could not be resolved.",
      offset: itemsSpan.start,
    };
  }

  const result: EnvelopeItem[] = [];
  for (let index = 0; index < envelope.items.length; index += 1) {
    const itemValue = envelope.items[index];
    const itemSpan = elementSpans[index]!;
    if (
      !hasOwnRecord(itemValue) ||
      !Object.prototype.hasOwnProperty.call(itemValue, "shotId") ||
      !Object.prototype.hasOwnProperty.call(itemValue, "prompt")
    ) {
      return {
        ok: false,
        code: "invalid_envelope",
        message: "Each envelope item must have shotId and prompt fields.",
        offset: itemSpan.start,
        itemIndex: index,
      };
    }
    if (typeof itemValue.shotId !== "string") {
      return {
        ok: false,
        code: "invalid_identity",
        message: "Envelope shotId must be a positive decimal string.",
        offset: itemSpan.start,
        itemIndex: index,
      };
    }
    if (!hasOwnRecord(itemValue.prompt) && !Array.isArray(itemValue.prompt)) {
      return {
        ok: false,
        code: "invalid_envelope",
        message: "Envelope prompt must be a JSON object or array.",
        offset: itemSpan.start,
        itemIndex: index,
      };
    }

    const itemMembers = scanObjectMemberSpans(source, itemSpan);
    const promptSpan = lastMember(itemMembers, "prompt");
    if (!promptSpan) {
      return {
        ok: false,
        code: "invalid_envelope",
        message: "Envelope prompt source span could not be resolved.",
        offset: itemSpan.start,
        itemIndex: index,
      };
    }
    result.push({
      shotId: itemValue.shotId,
      promptSpan,
      value: itemValue.prompt,
    });
  }
  return { ok: true, items: result };
}

function bodyShotId(value: unknown): unknown {
  if (!hasOwnRecord(value)) return undefined;
  return Object.prototype.hasOwnProperty.call(value, "shot_id")
    ? value.shot_id
    : undefined;
}

function mapBudgetIssue(issue: BatchBudgetIssue): ImportErrorCode {
  return issue;
}

/** Pure JSON-aware, source-span-preserving image/video batch importer. */
export function importPromptBatch(
  source: string,
  kind: PromptKind,
): ImportBatchResult {
  const sourceIssues = assessInputSourceSize(source);
  if (sourceIssues.length > 0) {
    const code = sourceIssues[0]!;
    return failure(
      source,
      code,
      code === "input_code_units_exceeded"
        ? `Input exceeds ${INPUT_POLICY.maxBatchCodeUnits} JavaScript code units.`
        : `Input exceeds ${INPUT_POLICY.maxBatchUtf8Bytes} UTF-8 bytes.`,
      0,
    );
  }

  let cursor = skipJsonWhitespace(source, 0);
  if (cursor === source.length) {
    return failure(source, "empty_input", "Input contains no JSON prompt.", 0);
  }

  const candidates: Candidate[] = [];
  let mode: PromptInputMode = "single_json_value";
  let firstWasLabeled: boolean | undefined;
  let envelopeValue: Record<string, unknown> | undefined;

  while (cursor < source.length) {
    const label = getOuterLabel(source, cursor);
    const labeled = label !== undefined;
    if (firstWasLabeled === undefined) firstWasLabeled = labeled;
    else if (labeled !== firstWasLabeled) {
      return failure(
        source,
        firstWasLabeled ? "missing_outer_label" : "mixed_input_modes",
        firstWasLabeled
          ? "Every value in a numbered batch needs an outer label."
          : "Numbered labels cannot be mixed with an unlabelled first value.",
        cursor,
        candidates.length,
      );
    }

    if (labeled) {
      if (envelopeValue) {
        return failure(
          source,
          "unrecognized_trailing_input",
          "An explicit envelope must be the only top-level input value.",
          cursor,
        );
      }
      mode = "numbered_json_blocks";
    } else if (candidates.length > 0) {
      const character = source[cursor];
      if (character === "{" || character === "[") {
        return failure(
          source,
          firstWasLabeled ? "missing_outer_label" : "ambiguous_multiple_values",
          firstWasLabeled
            ? "Every value in a numbered batch needs an outer label."
            : "Multiple unlabelled JSON values are ambiguous; add supported outer labels.",
          cursor,
          candidates.length,
        );
      }
      return failure(
        source,
        "unrecognized_trailing_input",
        "Only whitespace or a supported outer label may follow a complete JSON value.",
        cursor,
      );
    }

    const bodyStart = label?.bodyStart ?? cursor;
    if (source[bodyStart] !== "{" && source[bodyStart] !== "[") {
      return failure(
        source,
        "unsupported_prompt_root",
        "A prompt must be one top-level JSON object or array.",
        bodyStart,
      );
    }
    const scanned = scanJsonValue(source, bodyStart);
    if (!scanned.ok) {
      return failure(
        source,
        mapSpanError(scanned.error.code),
        scanned.error.code === "json_nesting_depth_exceeded"
          ? `JSON nesting exceeds the provisional depth limit of ${INPUT_POLICY.maxJsonNestingDepth}.`
          : scanned.error.code === "incomplete_json"
            ? "JSON value is incomplete."
            : "JSON delimiters are malformed.",
        scanned.error.offset,
        candidates.length,
      );
    }
    const span = scanned.span;
    const rawBody = source.slice(span.start, span.end);
    const measurement = measurePromptBody(rawBody);
    if (measurement.stringCodeUnits > INPUT_POLICY.maxPromptCodeUnits) {
      return failure(
        source,
        "prompt_code_units_exceeded",
        `A prompt exceeds ${INPUT_POLICY.maxPromptCodeUnits} JavaScript code units.`,
        span.start,
        candidates.length,
      );
    }
    if (measurement.utf8Bytes > INPUT_POLICY.maxPromptUtf8Bytes) {
      return failure(
        source,
        "prompt_utf8_bytes_exceeded",
        `A prompt exceeds ${INPUT_POLICY.maxPromptUtf8Bytes} UTF-8 bytes.`,
        span.start,
        candidates.length,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch (error) {
      const position =
        error instanceof SyntaxError
          ? Number(/position (\d+)/i.exec(error.message)?.[1] ?? 0)
          : 0;
      return failure(
        source,
        "invalid_json",
        "JSON syntax is invalid.",
        span.start + position,
        candidates.length,
      );
    }

    if (candidates.length === 0 && !labeled && isEnvelopeCandidate(parsed)) {
      envelopeValue = parsed;
      const envelopeItems = extractEnvelopeItems(source, span, parsed, kind);
      if (!envelopeItems.ok) {
        return failure(
          source,
          envelopeItems.code,
          envelopeItems.message,
          envelopeItems.offset,
          envelopeItems.itemIndex,
        );
      }
      mode = "versioned_envelope";
      const prompts = envelopeItems.items.map((item, index) => ({
        span: item.promptSpan,
        envelopeShotId: item.shotId,
        index,
      }));
      candidates.push(...prompts);
    } else {
      if (
        candidates.length > 0 &&
        candidates.length >= INPUT_POLICY.maxPromptCount
      ) {
        return failure(
          source,
          "too_many_items",
          `A batch may contain at most ${INPUT_POLICY.maxPromptCount} prompts.`,
          span.start,
          candidates.length,
        );
      }
      candidates.push({
        span,
        ...(label ? { outerLabel: label.label } : {}),
        index: candidates.length,
      });
    }

    cursor = skipJsonWhitespace(source, span.end);
    if (cursor === source.length) break;
    if (envelopeValue) {
      return failure(
        source,
        "unrecognized_trailing_input",
        "An explicit envelope must be the only top-level input value.",
        cursor,
      );
    }
    if (candidates.length >= INPUT_POLICY.maxPromptCount) {
      const nextLabel = getOuterLabel(source, cursor);
      if (nextLabel) {
        return failure(
          source,
          "too_many_items",
          `A batch may contain at most ${INPUT_POLICY.maxPromptCount} prompts.`,
          cursor,
          candidates.length,
        );
      }
    }
  }

  if (candidates.length === 0) {
    return failure(
      source,
      "empty_input",
      "Input contains no prompt bodies.",
      0,
    );
  }

  const items: ImportedPrompt[] = [];
  for (const candidate of candidates) {
    const rawBody = source.slice(candidate.span.start, candidate.span.end);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      return failure(
        source,
        "invalid_json",
        "Extracted prompt JSON is invalid.",
        candidate.span.start,
        candidate.index,
      );
    }
    const identity = resolveShotIdentity({
      outerLabel: candidate.outerLabel,
      envelopeShotId: candidate.envelopeShotId,
      bodyShotId: bodyShotId(parsed),
      promptCount: candidates.length,
    });
    if (!identity.ok) {
      const offset = candidate.span.start;
      return failure(
        source,
        identity.reason,
        identity.reason === "conflicting_identity"
          ? "Outer, envelope, and top-level shot_id identities must agree."
          : identity.reason === "invalid_identity"
            ? "Shot IDs must be positive decimal strings."
            : "Every prompt in a multi-prompt batch needs an explicit shot ID.",
        offset,
        candidate.index,
      );
    }
    items.push({
      kind,
      rawBody,
      sourceSpan: candidate.span,
      ...(identity.shotId ? { shotId: identity.shotId } : {}),
      ...(identity.identitySource
        ? { identitySource: identity.identitySource }
        : {}),
      measurement: measurePromptBody(rawBody),
    });
  }

  const duplicate = duplicateShotIds(
    items.map((item) => ({ workspaceId: "import-batch", shotId: item.shotId })),
  )[0];
  if (duplicate) {
    const duplicateIndex = items.findIndex(
      (item, index) => index > 0 && item.shotId === duplicate.shotId,
    );
    return failure(
      source,
      "duplicate_shot_id",
      `Shot ID ${duplicate.shotId} occurs more than once in this batch.`,
      items[duplicateIndex]?.sourceSpan.start ?? 0,
      duplicateIndex,
    );
  }

  const budget = assessBatchBudget(items.map((item) => item.rawBody));
  if (!budget.accepted) {
    const issue = budget.issues[0]!;
    return failure(
      source,
      mapBudgetIssue(issue),
      `Batch exceeds the provisional input policy (${issue}).`,
      items[0]?.sourceSpan.start ?? 0,
    );
  }

  return {
    ok: true,
    kind,
    mode,
    items,
    total: budget.total,
  };
}
