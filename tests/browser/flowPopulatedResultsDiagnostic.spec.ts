import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const diagnosticPath = resolve(
  process.cwd(),
  "tools/diagnostics/flow-populated-results-readonly.js",
);
const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/flow/populated-results-diagnostic.synthetic.html",
);

test("runs the complete read-only result diagnostic against a synthetic browser fixture", async ({
  page,
}) => {
  const [diagnostic, fixture] = await Promise.all([
    readFile(diagnosticPath, "utf8"),
    readFile(fixturePath, "utf8"),
  ]);
  await page.setContent(fixture);
  const output = await page.evaluate((script) => {
    return eval(script) as Promise<string>;
  }, diagnostic);
  const report = JSON.parse(output) as {
    diagnostic: string;
    status: string;
    observation: {
      projectComposerOwnership: string;
      candidates: Array<{
        identitySignalsAlongAncestors: Array<{
          attributeName: string;
          valueMask: string;
        }>;
        identityMultiplicity: {
          candidatesWithSameAttributeAndMaskedValue: number;
        };
        media: { descendantNodeCount: number };
        state: {
          markerCounts: { completed: number; error: number; loading: number };
          visibleMarkerCounts: { loading: number };
          hiddenMarkerCounts: { loading: number };
        };
      }>;
    };
    stability: { stableAcrossTwoAnimationFrames: boolean | null };
    privacy: Record<string, boolean>;
  };
  const serialized = JSON.stringify(report);
  const candidates = report.observation.candidates;
  const sharedAssetCandidates = candidates.filter((candidate) =>
    candidate.identitySignalsAlongAncestors.some(
      (signal) => signal.attributeName === "data-asset-id",
    ),
  );

  expect(report.diagnostic).toBe("flow-populated-results-readonly-v1");
  expect(report.status).toBe("not_a_recognized_flow_project_route");
  expect(report.observation.projectComposerOwnership).toBe(
    "unique_project_boundary_contains_verified_composer",
  );
  expect(report.stability.stableAcrossTwoAnimationFrames).toBe(true);
  expect(sharedAssetCandidates.length).toBeGreaterThanOrEqual(2);
  expect(
    sharedAssetCandidates[0]?.identitySignalsAlongAncestors.find(
      (signal) => signal.attributeName === "data-asset-id",
    )?.valueMask,
  ).toBe(
    sharedAssetCandidates[1]?.identitySignalsAlongAncestors.find(
      (signal) => signal.attributeName === "data-asset-id",
    )?.valueMask,
  );
  expect(
    sharedAssetCandidates.some(
      (candidate) =>
        candidate.identityMultiplicity
          .candidatesWithSameAttributeAndMaskedValue >= 2 &&
        candidate.media.descendantNodeCount > 1,
    ),
  ).toBe(true);
  expect(
    candidates.some((candidate) => candidate.state.markerCounts.error > 0),
  ).toBe(true);
  expect(
    candidates.some((candidate) => candidate.state.markerCounts.completed > 0),
  ).toBe(true);
  expect(
    candidates.some(
      (candidate) =>
        candidate.state.markerCounts.loading > 0 &&
        candidate.state.visibleMarkerCounts.loading === 0 &&
        candidate.state.hiddenMarkerCounts.loading > 0,
    ),
  ).toBe(true);
  expect(serialized).not.toContain("private prompt text");
  expect(serialized).not.toContain("asset-shared-fixture");
  expect(serialized).not.toContain("result-private-fixture");
  expect(serialized).not.toContain("generation-private-fixture");
  expect(Object.values(report.privacy).every((value) => value === false)).toBe(
    true,
  );
});
