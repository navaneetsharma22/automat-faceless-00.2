import { describe, expect, it } from "vitest";
import { INPUT_POLICY } from "../../src/domain/batches/inputPolicy";
import { importPromptBatch } from "../../src/domain/batches/importBatch";
import {
  promptSizeFixtures,
  representativeCases,
} from "../fixtures/prompts/promptFixtures";

const kinds = ["image", "video"] as const;

function expectFailure(
  source: string,
  kind: (typeof kinds)[number],
  code: string,
) {
  const result = importPromptBatch(source, kind);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe.each(kinds)("P03.2 %s source-span importer", (kind) => {
  it("keeps one multiline decimal-array prompt as one exact source slice", () => {
    const body =
      '{\r\n  "camera": {"path": [\r\n    1.25,\r\n    2.5,\r\n    3.75\r\n  ]},\r\n  "shot_id": "0007",\r\n  "text": "number 8. with braces {x}, escaped quote: \\"yes\\", slash: C:\\\\shot"\r\n}';
    const source = ` \t\r\n${body}\r\n`;
    const start = source.indexOf("{");
    const result = importPromptBatch(source, kind);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("single_json_value");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.rawBody).toBe(body);
    expect(result.items[0]!.sourceSpan).toEqual({
      start,
      end: start + body.length,
    });
    expect(
      source.slice(
        result.items[0]!.sourceSpan.start,
        result.items[0]!.sourceSpan.end,
      ),
    ).toBe(body);
    expect(result.items[0]!.shotId).toBe("7");
    expect(result.items[0]!.identitySource).toBe("body_shot_id");
    expect(result.items[0]!.measurement.stringCodeUnits).toBe(body.length);
    expect(result.items[0]!.measurement.utf8Bytes).toBe(
      new TextEncoder().encode(body).byteLength,
    );
  });

  it("accepts two numbered decimal-array bodies without splitting their contents", () => {
    const fixture = representativeCases.numberedTwoBodies;
    const result = importPromptBatch(fixture.source, kind);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("numbered_json_blocks");
    expect(result.items.map((item) => item.rawBody)).toEqual(
      fixture.validBodies,
    );
    expect(result.items.map((item) => item.shotId)).toEqual(["1", "2"]);
    expect(result.items[0]!.sourceSpan).toEqual({
      start: fixture.source.indexOf(fixture.validBodies[0]!),
      end:
        fixture.source.indexOf(fixture.validBodies[0]!) +
        fixture.validBodies[0]!.length,
    });
  });

  it("treats top-level and nested arrays and number-like strings as prompt content", () => {
    const topArray = representativeCases.topLevelArray.source;
    const arrayResult = importPromptBatch(topArray, kind);
    expect(arrayResult.ok).toBe(true);
    if (arrayResult.ok) {
      expect(arrayResult.items).toHaveLength(1);
      expect(arrayResult.items[0]!.rawBody).toBe(topArray);
      expect(arrayResult.items[0]!.sourceSpan).toEqual({
        start: 0,
        end: topArray.length,
      });
    }

    const nested =
      '{"nested":{"items":[{"n":1.25},{"n":2.5},{"n":3.75}]},"text":"1: {\\"not\\":\\"a prompt\\"} 2. [3]"}';
    const nestedResult = importPromptBatch(nested, kind);
    expect(nestedResult.ok).toBe(true);
    if (nestedResult.ok) {
      expect(nestedResult.items).toHaveLength(1);
      expect(nestedResult.items[0]!.rawBody).toBe(nested);
    }
  });

  it("preserves literal braces, escaped quotes, backslashes, Hindi, emoji, LF and CRLF", () => {
    const bodies = [
      '{\n  "text": "Hindi नमस्ते 🎬; braces { } and quote: \\"hi\\"",\n  "path": "C:\\\\clips\\\\one"\n}',
      '{\r\n  "text": "emoji 🎥; escaped slash \\\\ and braces } {",\r\n  "path": "D:\\\\vids\\\\take"\r\n}',
    ];
    for (const body of bodies) {
      const result = importPromptBatch(body, kind);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.items).toHaveLength(1);
        expect(result.items[0]!.rawBody).toBe(body);
        expect(result.items[0]!.sourceSpan).toEqual({
          start: 0,
          end: body.length,
        });
      }
    }
  });

  it("recognizes each supported label spelling and retains nonconsecutive IDs", () => {
    const first = '{"scene":"first"}';
    const second = '[{"scene":"second"}]';
    const third = '{"scene":"third"}';
    const source = `1: ${first}\r\n03. ${second}\nPrompt 90071992547409931234567890: ${third}`;
    const result = importPromptBatch(source, kind);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.rawBody)).toEqual([
      first,
      second,
      third,
    ]);
    expect(result.items.map((item) => item.shotId)).toEqual([
      "1",
      "3",
      "90071992547409931234567890",
    ]);
    for (const item of result.items) {
      expect(source.slice(item.sourceSpan.start, item.sourceSpan.end)).toBe(
        item.rawBody,
      );
    }
  });

  it("extracts envelope prompt spans exactly and validates its kind", () => {
    const source =
      '{\n "schemaVersion": 1,\n "kind": "' +
      kind +
      '",\n "items": [\n  {"shotId":"0004", "prompt": { "scene" : "one", "coords": [1.25, 2.5, 3.75] }},\n  {"shotId":"12", "prompt": [ {"scene":"two"} ]}\n ]\n}';
    const expectedBodies = [
      '{ "scene" : "one", "coords": [1.25, 2.5, 3.75] }',
      '[ {"scene":"two"} ]',
    ];
    const result = importPromptBatch(source, kind);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("versioned_envelope");
    expect(result.items.map((item) => item.rawBody)).toEqual(expectedBodies);
    expect(result.items.map((item) => item.shotId)).toEqual(["4", "12"]);
    for (const item of result.items) {
      expect(source.slice(item.sourceSpan.start, item.sourceSpan.end)).toBe(
        item.rawBody,
      );
    }
  });

  it("rejects duplicate and conflicting IDs without partial results", () => {
    expectFailure(
      representativeCases.duplicateCanonicalIds.source,
      kind,
      "duplicate_shot_id",
    );
    expectFailure(
      '1: {"shot_id":"2","scene":"conflict"}',
      kind,
      "conflicting_identity",
    );
    expectFailure('1: {"shot_id":0}', kind, "invalid_identity");
    expectFailure(
      '01: {"scene":"a"}\n1: {"scene":"b"}',
      kind,
      "duplicate_shot_id",
    );
  });

  it("rejects incomplete, invalid, trailing, ambiguous, and mixed-mode input", () => {
    expectFailure(
      representativeCases.incompleteJson.source,
      kind,
      "incomplete_json",
    );
    expectFailure('{"scene":,}', kind, "invalid_json");
    expectFailure(
      representativeCases.trailingText.source,
      kind,
      "unrecognized_trailing_input",
    );
    expectFailure(
      representativeCases.ambiguousAdjacentObjects.source,
      kind,
      "ambiguous_multiple_values",
    );
    expectFailure(
      '{"scene":"one"}\n2: {"scene":"two"}',
      kind,
      "mixed_input_modes",
    );
    expectFailure(
      '1: {"scene":"one"}\n{"scene":"two"}',
      kind,
      "missing_outer_label",
    );
    expectFailure('0: {"scene":"zero"}', kind, "invalid_identity");

    const located = importPromptBatch(
      '1: {"scene":"one"}\r\n{"scene":"two"}',
      kind,
    );
    expect(located.ok).toBe(false);
    if (!located.ok) {
      expect(located.error.code).toBe("missing_outer_label");
      expect(located.error.location.line).toBe(2);
      expect(located.error.location.offset).toBeGreaterThan(0);
    }
  });

  it("treats items-only creative objects as one prompt and rejects malformed envelopes", () => {
    const ordinary = representativeCases.arbitraryItemsObject.source;
    const ordinaryResult = importPromptBatch(ordinary, kind);
    expect(ordinaryResult.ok).toBe(true);
    if (ordinaryResult.ok) {
      expect(ordinaryResult.items).toHaveLength(1);
      expect(ordinaryResult.items[0]!.rawBody).toBe(ordinary);
    }

    expectFailure(
      '{"schemaVersion":2,"kind":"image","items":[]}',
      kind,
      "unsupported_envelope_version",
    );
    expectFailure(
      '{"schemaVersion":1,"kind":"invalid","items":[]}',
      kind,
      "invalid_envelope",
    );
    expectFailure(
      '{"schemaVersion":1,"kind":"' +
        (kind === "image" ? "video" : "image") +
        '","items":[{"shotId":"1","prompt":{}}]}',
      kind,
      "envelope_kind_mismatch",
    );
    expectFailure(
      '{"schemaVersion":1,"kind":"' +
        kind +
        '","items":[{"shotId":"0","prompt":{}}]}',
      kind,
      "invalid_identity",
    );
    expectFailure(
      '{"schemaVersion":1,"kind":"' +
        kind +
        '","items":[{"shotId":"1","prompt":null}]}',
      kind,
      "invalid_envelope",
    );
    expectFailure(
      '{"schemaVersion":1,"kind":"' +
        kind +
        '","items":[{"shotId":"1","prompt":{"shot_id":"2"}}]}',
      kind,
      "conflicting_identity",
    );
  });

  it("enforces exact provisional item, input-size, count, and nesting limits", () => {
    const prefix = '{"pad":"';
    const suffix = '"}';
    const exactBody =
      prefix +
      "x".repeat(
        INPUT_POLICY.maxPromptCodeUnits - prefix.length - suffix.length,
      ) +
      suffix;
    expect(exactBody.length).toBe(INPUT_POLICY.maxPromptCodeUnits);
    const atBoundary = importPromptBatch(exactBody, kind);
    expect(atBoundary.ok).toBe(true);
    if (atBoundary.ok) {
      expect(atBoundary.items[0]!.rawBody).toBe(exactBody);
      expect(atBoundary.items[0]!.sourceSpan).toEqual({
        start: 0,
        end: exactBody.length,
      });
    }
    const overBody =
      prefix +
      "x".repeat(
        INPUT_POLICY.maxPromptCodeUnits - prefix.length - suffix.length + 1,
      ) +
      suffix;
    expectFailure(overBody, kind, "prompt_code_units_exceeded");

    const overUtf8 = `{"pad":"${"🎬".repeat(
      Math.floor(INPUT_POLICY.maxPromptUtf8Bytes / 4) + 1,
    )}"}`;
    expectFailure(overUtf8, kind, "prompt_utf8_bytes_exceeded");

    const unicodePrefix = '{"pad":"';
    const unicodeSuffix = '"}';
    const exactUtf8Body =
      unicodePrefix +
      "界".repeat(
        Math.floor(
          (INPUT_POLICY.maxPromptUtf8Bytes -
            unicodePrefix.length -
            unicodeSuffix.length) /
            3,
        ),
      ) +
      "x" +
      unicodeSuffix;
    expect(new TextEncoder().encode(exactUtf8Body).byteLength).toBe(
      INPUT_POLICY.maxPromptUtf8Bytes,
    );
    expect(importPromptBatch(exactUtf8Body, kind).ok).toBe(true);

    const exactTotalSource =
      '{"scene":"x"}' +
      " ".repeat(INPUT_POLICY.maxBatchCodeUnits - '{"scene":"x"}'.length);
    expect(exactTotalSource.length).toBe(INPUT_POLICY.maxBatchCodeUnits);
    expect(importPromptBatch(exactTotalSource, kind).ok).toBe(true);
    expectFailure(
      " ".repeat(INPUT_POLICY.maxBatchCodeUnits + 1),
      kind,
      "input_code_units_exceeded",
    );

    const overTotalUtf8 = `{"pad":"${"界".repeat(
      Math.ceil((INPUT_POLICY.maxBatchUtf8Bytes - 10) / 3) + 1,
    )}"}`;
    expect(overTotalUtf8.length).toBeLessThan(INPUT_POLICY.maxBatchCodeUnits);
    expectFailure(overTotalUtf8, kind, "input_utf8_bytes_exceeded");

    const atCount = Array.from(
      { length: INPUT_POLICY.maxPromptCount },
      (_, index) => `${index + 1}: {"scene":"${index}"}`,
    ).join("\n");
    const countResult = importPromptBatch(atCount, kind);
    expect(countResult.ok).toBe(true);
    if (countResult.ok) expect(countResult.items).toHaveLength(50);

    const numbered = Array.from(
      { length: INPUT_POLICY.maxPromptCount + 1 },
      (_, index) => `${index + 1}: {"scene":"${index}"}`,
    ).join("\n");
    expectFailure(numbered, kind, "too_many_items");

    const atDepth = `${"[".repeat(INPUT_POLICY.maxJsonNestingDepth - 1)}{}${"]".repeat(INPUT_POLICY.maxJsonNestingDepth - 1)}`;
    expect(importPromptBatch(atDepth, kind).ok).toBe(true);
    const overDepth = `${"[".repeat(INPUT_POLICY.maxJsonNestingDepth)}{}${"]".repeat(INPUT_POLICY.maxJsonNestingDepth)}`;
    expectFailure(overDepth, kind, "json_nesting_depth_exceeded");
  });

  it("imports every valid 10k/25k/50k/100k synthetic fixture unchanged", () => {
    for (const fixture of promptSizeFixtures.filter(
      (entry) => entry.kind === kind,
    )) {
      const result = importPromptBatch(fixture.rawBody, kind);
      expect(result.ok, fixture.name).toBe(true);
      if (!result.ok) continue;
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.rawBody).toBe(fixture.rawBody);
      expect(result.items[0]!.sourceSpan).toEqual({
        start: 0,
        end: fixture.rawBody.length,
      });
      expect(result.items[0]!.measurement.stringCodeUnits).toBe(
        fixture.targetCodeUnits,
      );
      expect(result.items[0]!.measurement.utf8Bytes).toBe(
        new TextEncoder().encode(fixture.rawBody).byteLength,
      );
    }
  });
});
