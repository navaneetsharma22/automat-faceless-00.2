import { describe, expect, it } from "vitest";
import {
  assessBatchBudget,
  canonicalizeShotId,
  duplicateShotIds,
  INPUT_POLICY,
  measurePromptBody,
  OUTER_LABEL_PREFIX_PATTERN,
  resolveShotIdentity,
} from "../../src/domain/batches/inputPolicy";
import {
  promptSizeFixtures,
  representativeCases,
} from "../fixtures/prompts/promptFixtures";

describe("P03.1 synthetic prompt corpus", () => {
  it("provides valid IMAGE and VIDEO fixtures at each target source length", () => {
    expect(promptSizeFixtures).toHaveLength(8);
    for (const fixture of promptSizeFixtures) {
      expect(fixture.provenance).toBe(
        "SYNTHETIC_APPROVED_STRUCTURE_NOT_PRODUCTION_SAMPLE",
      );
      expect(fixture.rawBody.length).toBe(fixture.targetCodeUnits);
      expect(JSON.parse(fixture.rawBody)).toMatchObject({
        fixture_provenance: expect.stringContaining("SYNTHETIC ONLY"),
        shot_id: "0007",
      });
      expect(JSON.parse(fixture.rawBody).decimal_array).toEqual([
        1.25, 2.5, 3.75,
      ]);
      const measurement = measurePromptBody(fixture.rawBody);
      expect(measurement.stringCodeUnits).toBe(fixture.targetCodeUnits);
      expect(measurement.utf8Bytes).toBe(
        new TextEncoder().encode(fixture.rawBody).byteLength,
      );
      expect(fixture.rawBody.split(/\r\n|\n|\r/)).toHaveLength(
        fixture.targetCodeUnits === 10_000
          ? 29
          : fixture.targetCodeUnits === 25_000
            ? 43
            : fixture.targetCodeUnits === 50_000
              ? 68
              : 118,
      );
    }
    expect(new Set(promptSizeFixtures.map((fixture) => fixture.kind))).toEqual(
      new Set(["image", "video"]),
    );
  });

  it("keeps the required input-form and negative-case fixtures explicitly synthetic", () => {
    expect(Object.values(representativeCases)).toHaveLength(8);
    for (const fixture of Object.values(representativeCases)) {
      expect(fixture.provenance).toBe("SYNTHETIC_FIXTURE_ONLY");
      expect(fixture.expectedOutcome).toBeTruthy();
      const validBodies = (fixture as { validBodies?: string[] }).validBodies;
      for (const body of validBodies ?? [])
        expect(JSON.parse(body)).toBeDefined();
    }
    expect(JSON.parse(representativeCases.topLevelArray.source)).toHaveLength(
      2,
    );
    expect(
      JSON.parse(representativeCases.explicitEnvelope.source),
    ).toMatchObject({
      schemaVersion: 1,
      kind: "image",
      items: [{ shotId: "01" }],
    });
    expect(
      JSON.parse(representativeCases.arbitraryItemsObject.source),
    ).toHaveProperty("items");
  });
});

describe("centralized preliminary input policy", () => {
  it("defines a narrow outer-label prefix grammar", () => {
    for (const value of ["1: {", " 01. [", "2) {", "Prompt 001: {"]) {
      expect(OUTER_LABEL_PREFIX_PATTERN.exec(value)).not.toBeNull();
    }
    for (const value of ["Prompt 1. {", "Prompt 1) {", "1:\n{", "+1: {"]) {
      expect(OUTER_LABEL_PREFIX_PATTERN.exec(value)).toBeNull();
    }
  });

  it("accepts a batch inside every provisional budget and rejects an oversized batch atomically", () => {
    expect(INPUT_POLICY.limitsAreProvisional).toBe(true);
    const withinBudget = assessBatchBudget([
      "x".repeat(INPUT_POLICY.maxPromptCodeUnits),
    ]);
    expect(withinBudget.accepted).toBe(true);

    const overPerPrompt = assessBatchBudget([
      "x".repeat(INPUT_POLICY.maxPromptCodeUnits + 1),
    ]);
    expect(overPerPrompt).toMatchObject({
      accepted: false,
      issues: ["prompt_code_units_exceeded"],
    });

    const overBatch = assessBatchBudget([
      "x".repeat(1_300_000),
      "y".repeat(1_300_000),
      "z".repeat(1_300_000),
      "w".repeat(1_300_000),
    ]);
    expect(overBatch.accepted).toBe(false);
    expect(overBatch.issues).toContain("batch_code_units_exceeded");
    expect(overBatch.prompts).toHaveLength(4);

    expect(assessBatchBudget([])).toMatchObject({
      accepted: false,
      issues: ["empty_batch"],
    });
    expect(
      assessBatchBudget(Array.from({ length: 51 }, () => "{}")),
    ).toMatchObject({
      accepted: false,
      issues: ["too_many_items"],
    });
  });

  it("measures UTF-8 bytes separately from JavaScript string code units", () => {
    const body = "नमस्ते🎬";
    const measurement = measurePromptBody(body);
    expect(measurement.stringCodeUnits).toBe(body.length);
    expect(measurement.utf8Bytes).toBe(
      new TextEncoder().encode(body).byteLength,
    );
    expect(measurement.utf8Bytes).toBeGreaterThan(measurement.stringCodeUnits);

    const unicodeOverByteBudget = assessBatchBudget([
      "🎬".repeat(INPUT_POLICY.maxPromptUtf8Bytes / 4 + 1),
    ]);
    expect(unicodeOverByteBudget.accepted).toBe(false);
    expect(unicodeOverByteBudget.issues).toContain(
      "prompt_utf8_bytes_exceeded",
    );
  });

  it("canonicalizes positive decimal shot IDs as strings without numeric precision loss", () => {
    expect(canonicalizeShotId("0001")).toBe("1");
    expect(canonicalizeShotId("01")).toBe("1");
    expect(canonicalizeShotId("90071992547409931234567890")).toBe(
      "90071992547409931234567890",
    );
    expect(canonicalizeShotId("0")).toBeUndefined();
    expect(canonicalizeShotId("000")).toBeUndefined();
    expect(canonicalizeShotId(1)).toBeUndefined();
    expect(canonicalizeShotId(" 1 ")).toBeUndefined();
  });

  it("resolves explicit identities, allows an unlabelled singleton, and rejects conflicts", () => {
    expect(
      resolveShotIdentity({
        outerLabel: "01",
        bodyShotId: "1",
        promptCount: 1,
      }),
    ).toEqual({
      ok: true,
      shotId: "1",
      identitySource: "outer_label",
      kind: "explicit",
    });
    expect(resolveShotIdentity({ promptCount: 1 })).toEqual({
      ok: true,
      kind: "unlabelled_single",
    });
    expect(resolveShotIdentity({ promptCount: 2 })).toEqual({
      ok: false,
      reason: "unlabelled_multiple_prompts",
    });
    expect(
      resolveShotIdentity({
        outerLabel: "1",
        envelopeShotId: "2",
        promptCount: 1,
      }),
    ).toEqual({ ok: false, reason: "conflicting_identity" });
    expect(resolveShotIdentity({ outerLabel: "1x", promptCount: 1 })).toEqual({
      ok: false,
      reason: "invalid_identity",
    });
  });

  it("detects duplicate canonical shot IDs only within the same workspace", () => {
    expect(
      duplicateShotIds([
        { workspaceId: "workspace-a", shotId: "1" },
        { workspaceId: "workspace-a", shotId: "1" },
        { workspaceId: "workspace-b", shotId: "1" },
        { workspaceId: "workspace-a" },
      ]),
    ).toEqual([{ workspaceId: "workspace-a", shotId: "1" }]);
  });
});
