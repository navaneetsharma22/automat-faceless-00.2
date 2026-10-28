import type { PromptKind } from "../../../src/domain/batches/types";

export type PromptSizeFixture = {
  name: string;
  kind: PromptKind;
  targetCodeUnits: number;
  newline: "LF" | "CRLF";
  provenance: "SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE";
  rawBody: string;
};

function makePromptBody(
  kind: PromptKind,
  targetCodeUnits: number,
  newline: "\n" | "\r\n",
): string {
  const domainFields =
    kind === "image"
      ? [
          '  "composition": {"framing": "wide", "constraints": ["no logos", "single subject"]},',
          '  "camera": {',
          '    "position": [1.25,',
          "      2.5,",
          '      3.75], "lens": {"focal_length": 35.5}',
          "  },",
          '  "lighting": {"key": "soft window light", "fill": [0.25, 0.5]},',
          '  "grading": {"palette": ["warm cream", "soft maroon"], "contrast": 0.875},',
        ]
      : [
          '  "composition": {"framing": "wide", "constraints": ["no logos", "single subject"]},',
          '  "camera": {',
          '    "move": "slow lateral", "path": [1.25,',
          "      2.5,",
          "      3.75]",
          "  },",
          '  "lighting": {"key": "soft window light", "fill": [0.25, 0.5]},',
          '  "effects": ["text reveal", "warm grade"], "duration": 8.5,',
        ];
  const prefix =
    [
      "{",
      `  "fixture_provenance": "SYNTHETIC ONLY; ${kind}; not production data",`,
      '  "shot_id": "0007",',
      '  "subject": {"description": "A quiet studio portrait", "features": ["natural", "cinematic"]},',
      '  "environment": {"place": "small atelier", "details": {"window": true, "props": []}},',
      ...domainFields,
      '  "instructions": "1. Preserve the scene\\n2) Do not crop the subject; braces {like this} stay text; escaped quote: \\"hello\\"; path: C:\\\\set\\\\one",',
      '  "multilingual": "Hindi नमस्ते; English light; emoji 🎬",',
      '  "decimal_array": [1.25, 2.5, 3.75],',
      '  "padding": [',
    ].join(newline) + newline;
  const suffix = `  ]${newline}}`;
  const availableCodeUnits = targetCodeUnits - prefix.length - suffix.length;
  if (availableCodeUnits < 0) {
    throw new Error(`Target fixture size is too small: ${targetCodeUnits}`);
  }

  const maxPaddingRowCodeUnits = 1_000;
  let rowCount = Math.max(1, Math.ceil(availableCodeUnits / 1_010));
  let paddingCodeUnits: number;
  while (true) {
    const rowOverhead = rowCount * (6 + newline.length) + (rowCount - 1);
    paddingCodeUnits = availableCodeUnits - rowOverhead;
    if (
      paddingCodeUnits >= 0 &&
      paddingCodeUnits <= rowCount * maxPaddingRowCodeUnits
    ) {
      break;
    }
    rowCount += 1;
  }
  const baseRowCodeUnits = Math.floor(paddingCodeUnits / rowCount);
  const extraCodeUnits = paddingCodeUnits % rowCount;
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const contentLength = baseRowCodeUnits + (index < extraCodeUnits ? 1 : 0);
    const comma = index + 1 < rowCount ? "," : "";
    return `    "${"x".repeat(contentLength)}"${comma}${newline}`;
  }).join("");
  return `${prefix}${rows}${suffix}`;
}

const sizes = [10_000, 25_000, 50_000, 100_000] as const;

function makeSizeFixtures(kind: PromptKind): PromptSizeFixture[] {
  return sizes.map((targetCodeUnits, index) => {
    const newline =
      (kind === "image" ? index % 2 : (index + 1) % 2) === 0 ? "\n" : "\r\n";
    return {
      name: `${kind.toUpperCase()}_${targetCodeUnits / 1_000}K`,
      kind,
      targetCodeUnits,
      newline: newline === "\n" ? "LF" : "CRLF",
      provenance: "SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE",
      rawBody: makePromptBody(kind, targetCodeUnits, newline),
    };
  });
}

export const promptSizeFixtures = [
  ...makeSizeFixtures("image"),
  ...makeSizeFixtures("video"),
] as const;

const firstNumberedBody =
  '{\n  "scene": "SYNTHETIC one",\n  "points": [1.25, 2.5, 3.75]\n}';
const secondNumberedBody =
  '{\n  "scene": "SYNTHETIC two",\n  "text": "internal 3. Do not split"\n}';

export const representativeCases = {
  numberedTwoBodies: {
    source: `1: ${firstNumberedBody}\n2. ${secondNumberedBody}`,
    validBodies: [firstNumberedBody, secondNumberedBody],
    expectedOutcome: "two_prompts_outer_ids_1_and_2",
    provenance: "SYNTHETIC_FIXTURE_ONLY",
  },
  topLevelArray: {
    source: '[\n  {"scene": "SYNTHETIC one"},\n  {"scene": "SYNTHETIC two"}\n]',
    expectedOutcome: "one_prompt_top_level_array_is_data",
    provenance: "SYNTHETIC_FIXTURE_ONLY",
  },
  explicitEnvelope: {
    source:
      '{\n  "schemaVersion": 1,\n  "kind": "image",\n  "items": [\n    {"shotId": "01", "prompt": {"scene": "SYNTHETIC envelope"}}\n  ]\n}',
    expectedOutcome: "one_prompt_envelope_item_id_1",
    provenance: "SYNTHETIC_FIXTURE_ONLY",
  },
  arbitraryItemsObject: {
    source: '{"scene": "SYNTHETIC creative content", "items": [1, 2, 3]}',
    expectedOutcome: "one_prompt_not_an_envelope",
    provenance: "SYNTHETIC_FIXTURE_ONLY",
  },
  incompleteJson: {
    source: '{"scene": "SYNTHETIC unfinished"',
    expectedOutcome: "reject_incomplete_json_no_partial_acceptance",
    provenance: "SYNTHETIC_FIXTURE_ONLY",
  },
  duplicateCanonicalIds: {
    source: `1: ${firstNumberedBody}\n01) ${secondNumberedBody}`,
    validBodies: [firstNumberedBody, secondNumberedBody],
    expectedOutcome: "reject_duplicate_ids_after_canonicalization",
    provenance: "SYNTHETIC_FIXTURE_ONLY",
  },
  ambiguousAdjacentObjects: {
    source: `${firstNumberedBody}\n${secondNumberedBody}`,
    validBodies: [firstNumberedBody, secondNumberedBody],
    expectedOutcome: "reject_ambiguous_unlabelled_multiple_values",
    provenance: "SYNTHETIC_FIXTURE_ONLY",
  },
  trailingText: {
    source: `${firstNumberedBody}\nnot an outer label or JSON value`,
    validBodies: [firstNumberedBody],
    expectedOutcome: "reject_unrecognized_trailing_text",
    provenance: "SYNTHETIC_FIXTURE_ONLY",
  },
} as const;
