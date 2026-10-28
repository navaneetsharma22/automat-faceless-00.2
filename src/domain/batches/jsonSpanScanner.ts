import { INPUT_POLICY } from "./inputPolicy";

export type JsonSpan = { start: number; end: number };

export type JsonSpanErrorCode =
  | "expected_json_value"
  | "incomplete_json"
  | "mismatched_json_delimiter"
  | "json_nesting_depth_exceeded"
  | "invalid_json";

export type JsonSpanError = {
  code: JsonSpanErrorCode;
  offset: number;
};

export type JsonSpanResult =
  { ok: true; span: JsonSpan } | { ok: false; error: JsonSpanError };

const JSON_WHITESPACE = /[\t\n\r ]/;

export function skipJsonWhitespace(source: string, offset: number): number {
  let cursor = offset;
  while (cursor < source.length && JSON_WHITESPACE.test(source[cursor]!)) {
    cursor += 1;
  }
  return cursor;
}

/**
 * Finds the end of one object/array value without treating delimiters inside
 * JSON strings as structure. Offsets are JavaScript string offsets.
 */
export function scanJsonValue(
  source: string,
  start: number,
  maxDepth = INPUT_POLICY.maxJsonNestingDepth,
): JsonSpanResult {
  const opening = source[start];
  if (opening === '"') {
    let escaped = false;
    for (let cursor = start + 1; cursor < source.length; cursor += 1) {
      const character = source[cursor]!;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') {
        return { ok: true, span: { start, end: cursor + 1 } };
      }
    }
    return {
      ok: false,
      error: { code: "incomplete_json", offset: source.length },
    };
  }

  if (opening !== "{" && opening !== "[") {
    if (opening === undefined) {
      return {
        ok: false,
        error: { code: "expected_json_value", offset: start },
      };
    }
    let cursor = start;
    while (cursor < source.length && !/[\t\n\r ,\]}]/.test(source[cursor]!)) {
      cursor += 1;
    }
    if (cursor === start) {
      return {
        ok: false,
        error: { code: "expected_json_value", offset: start },
      };
    }
    return { ok: true, span: { start, end: cursor } };
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{" || character === "[") {
      stack.push(character === "{" ? "}" : "]");
      if (stack.length > maxDepth) {
        return {
          ok: false,
          error: { code: "json_nesting_depth_exceeded", offset: cursor },
        };
      }
      continue;
    }

    if (character === "}" || character === "]") {
      if (stack.at(-1) !== character) {
        return {
          ok: false,
          error: { code: "mismatched_json_delimiter", offset: cursor },
        };
      }
      stack.pop();
      if (stack.length === 0) {
        return { ok: true, span: { start, end: cursor + 1 } };
      }
    }
  }

  return {
    ok: false,
    error: { code: "incomplete_json", offset: source.length },
  };
}

export type JsonMemberSpan = { key: string; value: JsonSpan };

/** Returns direct object member spans for an already validated object value. */
export function scanObjectMemberSpans(
  source: string,
  objectSpan: JsonSpan,
  maxDepth = INPUT_POLICY.maxJsonNestingDepth,
): JsonMemberSpan[] {
  const members: JsonMemberSpan[] = [];
  let cursor = skipJsonWhitespace(source, objectSpan.start + 1);
  while (cursor < objectSpan.end - 1) {
    const keyStart = cursor;
    const keyResult = scanJsonValue(source, keyStart, maxDepth);
    if (!keyResult.ok || source[keyStart] !== '"') return [];
    const key = JSON.parse(
      source.slice(keyResult.span.start, keyResult.span.end),
    ) as string;
    cursor = skipJsonWhitespace(source, keyResult.span.end);
    if (source[cursor] !== ":") return [];
    cursor = skipJsonWhitespace(source, cursor + 1);
    const valueResult = scanJsonValue(source, cursor, maxDepth);
    if (!valueResult.ok) return [];
    members.push({ key, value: valueResult.span });
    cursor = skipJsonWhitespace(source, valueResult.span.end);
    if (source[cursor] === ",") {
      cursor = skipJsonWhitespace(source, cursor + 1);
    } else {
      break;
    }
  }
  return members;
}

/** Returns direct value spans for an already validated array value. */
export function scanArrayElementSpans(
  source: string,
  arraySpan: JsonSpan,
  maxDepth = INPUT_POLICY.maxJsonNestingDepth,
): JsonSpan[] {
  const elements: JsonSpan[] = [];
  let cursor = skipJsonWhitespace(source, arraySpan.start + 1);
  while (cursor < arraySpan.end - 1) {
    const valueResult = scanJsonValue(source, cursor, maxDepth);
    if (!valueResult.ok) return [];
    elements.push(valueResult.span);
    cursor = skipJsonWhitespace(source, valueResult.span.end);
    if (source[cursor] === ",") {
      cursor = skipJsonWhitespace(source, cursor + 1);
    } else {
      break;
    }
  }
  return elements;
}
