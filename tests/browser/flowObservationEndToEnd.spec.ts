import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rolldown } from "rolldown";

const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/flow/image-lifecycle-recorder.synthetic.html",
);
const connectorAssetPath = resolve(process.cwd(), "dist/connection-probe.js");
const fixtureUrl = "https://flow.google.com/project/observation-e2e-project";
const rawPrompt = '{"shot_id":"05","scene":"synthetic fixture"}';
const rawPromptLength = rawPrompt.length;
const rawPromptBytes = new TextEncoder().encode(rawPrompt).byteLength;

test("production count path persists 4 existing images, two pending tiles, and two new candidates", async ({
  page,
}) => {
  const fixture = await readFile(fixturePath, "utf8");
  const connectorAsset = await readFile(connectorAssetPath, "utf8");
  const packageBuildId = /var [^=]+=\x60([^\x60]+)\x60/.exec(
    connectorAsset,
  )?.[1];
  if (!packageBuildId) throw new Error("packaged_connector_build_id_missing");
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  await page.goto(fixtureUrl);
  await page.locator("flow-base-prompt-box").evaluate((composer) => {
    const editor = composer.querySelector('[contenteditable="true"]');
    if (editor) editor.innerHTML = "<p><br></p>";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Generate";
    composer.append(button);
    button.addEventListener("click", () => {
      const activeComposer = document.querySelector("flow-base-prompt-box");
      const activeEditor = document.querySelector('[contenteditable="true"]');
      if (activeEditor) activeEditor.innerHTML = "<p><br></p>";
      if (!activeComposer) throw new Error("synthetic_composer_missing");
      const parent = activeComposer.parentElement;
      activeComposer.remove();
      window.setTimeout(() => parent?.prepend(activeComposer), 80);
      const container = document.querySelector("flow-tile-container");
      if (!container) throw new Error("synthetic_tile_container_missing");
      for (let index = 1; index <= 2; index += 1) {
        const tile = document.createElement("flow-image-tile");
        tile.dataset.fixtureOutput = String(index);
        const loading = document.createElement("div");
        loading.setAttribute("role", "progressbar");
        loading.dataset.loading = "true";
        loading.textContent = "synthetic loading";
        tile.append(loading);
        container.append(tile);
      }
      window.setTimeout(() => {
        for (const tile of Array.from(
          container.querySelectorAll("flow-image-tile[data-fixture-output]"),
        )) {
          const index = tile.getAttribute("data-fixture-output");
          tile.replaceChildren();
          const image = document.createElement("img");
          image.dataset.mediaId = `synthetic-new-output-${index}`;
          image.src =
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect width='24' height='24' fill='green'/%3E%3C/svg%3E";
          tile.append(image);
        }
      }, 850);
    });
  });
  const bundle = await rolldown({
    input: resolve(
      process.cwd(),
      "tests/browser/flowObservationEndToEndHarness.ts",
    ),
    plugins: [
      {
        name: "fixture-build-id",
        transform(code: string) {
          return code.replaceAll(
            "__AUTOMAT_BUILD_ID__",
            JSON.stringify(packageBuildId),
          );
        },
      },
    ],
  });
  try {
    const built = await bundle.generate({
      format: "iife",
      name: "FlowObservationEndToEnd",
    });
    const chunk = built.output.find((output) => output.type === "chunk");
    if (!chunk) throw new Error("Flow observation harness bundle missing");
    await page.addScriptTag({ content: chunk.code });
    const bundleGlobals = await page.evaluate(() => ({
      keys: Object.keys(window).filter((key) =>
        key.toLowerCase().includes("flowobservation"),
      ),
      kind: typeof (window as unknown as Record<string, unknown>)
        .FlowObservationEndToEnd,
      value: String(
        (window as unknown as Record<string, unknown>).FlowObservationEndToEnd,
      ).slice(0, 120),
    }));
    const setup = await page
      .evaluate(async (connectorSource) => {
        const harness = (
          window as unknown as {
            FlowObservationEndToEnd: {
              setupProductionObservationFixture: (
                connectorSource: string,
              ) => Promise<{
                attemptId: string;
                dispatchBoundaryAt: number | undefined;
                baselineSequence: number | undefined;
                setup: Record<string, unknown>;
              }>;
              readProductionObservationFixtureReport: () => Promise<{
                state: string;
                outcome: { status: string; reason?: string };
                session: { status: string; lastSequence: number };
                countDecision: {
                  status: string;
                  reason?: string;
                  startingImageCount: number;
                  declaredVariantCount: number;
                  expectedTotal: number;
                  observedEligibleCandidateIds: string[];
                };
                sequences: Array<{
                  sequence: number;
                  kind: string;
                  observedAt: number;
                  candidateIds: string[];
                  blockers: string[];
                  loadingSignalCount: number;
                  tileCount: number;
                  virtualized: boolean;
                  virtualizationEvidence: string[];
                  resourceEventCount: number;
                }>;
                countDecision: {
                  status: string;
                  reason?: string;
                  startingImageCount: number;
                  declaredVariantCount: number;
                  expectedTotal: number;
                  observedEligibleCandidateIds: string[];
                };
                receiptSequences: number[];
                diagnostics: string[];
                durableBoundary?: number;
              }>;
              markSyntheticActivationDispatched: () => Promise<void>;
              closeProductionObservationFixture: () => Promise<void>;
            };
          }
        ).FlowObservationEndToEnd;
        return await harness.setupProductionObservationFixture(connectorSource);
      }, connectorAsset)
      .catch((error: unknown) => {
        const details = error as {
          schemaIssuePaths?: string[];
          schemaIssueCodes?: string[];
        };
        throw new Error(
          `harness_bundle_not_exposed_${JSON.stringify(bundleGlobals)}_${JSON.stringify({ message: String(error), schemaIssuePaths: details.schemaIssuePaths, schemaIssueCodes: details.schemaIssueCodes })}`,
        );
      });
    const readReport = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            FlowObservationEndToEnd: {
              readProductionObservationFixtureReport: () => Promise<{
                state: string;
                outcome: { status: string; reason?: string };
                session: { status: string; lastSequence: number };
                countDecision: {
                  status: string;
                  reason?: string;
                  observedEligibleCandidateIds: string[];
                };
                sequences: Array<{
                  sequence: number;
                  kind: string;
                  observedAt: number;
                  candidateIds: string[];
                  blockers: string[];
                  loadingSignalCount: number;
                  tileCount: number;
                  virtualized: boolean;
                  virtualizationEvidence: string[];
                  resourceEventCount: number;
                }>;
                countDecision: {
                  status: string;
                  reason?: string;
                  observedEligibleCandidateIds: string[];
                };
                receiptSequences: number[];
                diagnostics: string[];
                durableBoundary?: number;
                audit: Record<string, unknown>;
                setup: Record<string, unknown>;
              }>;
            };
          }
        ).FlowObservationEndToEnd.readProductionObservationFixtureReport(),
      );

    expect(setup.setup.connection).toMatchObject({
      ok: true,
      state: "verified",
    });
    for (const readiness of [
      setup.setup.firstReadiness,
      setup.setup.secondReadiness,
    ] as Array<Record<string, unknown>>) {
      expect(readiness).toMatchObject({
        status: "ready",
        selectedCountMode: {
          mode: "existing_project",
          startingImageCount: 4,
          userConfirmed: true,
        },
        countModeEligibility: {
          status: "eligible",
          startingImageCount: 4,
          userConfirmed: true,
        },
        qualifyingCandidateCount: 4,
        baselineCoverageAssessment: {
          viewportOverflowObserved: true,
          actualScrollingObserved: false,
          candidateOwnershipAmbiguous: false,
          declaredExistingCountMatchesQualifyingCandidates: true,
          inventoryComplete: false,
          providerIdentityVerified: false,
        },
      });
    }
    if ((setup.setup.generation as { state?: string }).state !== "dispatched")
      throw new Error(JSON.stringify(setup.setup.generation));
    expect(setup.baselineSequence).toBeGreaterThanOrEqual(1);
    expect(setup.dispatchBoundaryAt).toBeGreaterThan(0);
    const initialReport = await readReport();
    expect(initialReport.sequences[0]?.candidateIds).toHaveLength(4);
    expect(initialReport.sequences[0]?.tileCount).toBe(4);
    expect(initialReport.sequences[0]?.virtualizationEvidence).toContain(
      "scroll_extent_exceeds_viewport",
    );
    expect(initialReport.sequences[0]?.virtualized).toBe(false);
    await page.evaluate(() =>
      (
        window as unknown as {
          FlowObservationEndToEnd: {
            markSyntheticActivationDispatched: () => Promise<void>;
          };
        }
      ).FlowObservationEndToEnd.markSyntheticActivationDispatched(),
    );
    await expect
      .poll(async () => {
        const report = await readReport();
        return report.sequences.some(
          (event) => event.loadingSignalCount >= 2 && event.tileCount === 6,
        );
      })
      .toBe(true);
    await expect
      .poll(async () => (await readReport()).countDecision.reason)
      .toBe("loading_or_processing_observed");
    await expect
      .poll(async () => (await readReport()).countDecision.status, {
        timeout: 8_000,
        intervals: [100, 250, 500],
      })
      .toBe("count_matched")
      .catch(async (error: unknown) => {
        throw new Error(
          `count_observation_failed_${JSON.stringify(await readReport())}_${String(error)}`,
        );
      });
    const report = await readReport();
    expect(report.state).toBe("dispatched");
    expect(report.outcome.status).toBe("unknown");
    expect(report.session.status).toBe("active");
    expect(report.durableBoundary).toBe(setup.dispatchBoundaryAt);
    expect(report.receiptSequences.length).toBeGreaterThanOrEqual(3);
    expect(report.receiptSequences).toEqual(
      report.sequences.map((event) => event.sequence),
    );
    expect(report.sequences[0]?.observedAt).toBeLessThan(
      setup.dispatchBoundaryAt,
    );
    expect(
      report.sequences.some(
        (event) =>
          event.observedAt > setup.dispatchBoundaryAt &&
          event.candidateIds.some((candidate) =>
            report.countDecision.observedEligibleCandidateIds.includes(
              candidate,
            ),
          ),
      ),
    ).toBe(true);
    expect(report.countDecision.observedEligibleCandidateIds).toHaveLength(2);
    expect(report.countDecision).toMatchObject({
      startingImageCount: 4,
      declaredVariantCount: 2,
      expectedTotal: 6,
    });
    expect(report.audit).toMatchObject({
      connectionState: "verified",
      connectionVerification: "verified",
      readinessPreservedVerification: true,
      verificationBindingMatchesAttempt: true,
      exactSourceHash: true,
      sourceSnapshotIdMatchesAttempt: true,
      sourceSnapshotCodeUnits: rawPromptLength,
      sourceSnapshotUtf8Bytes: rawPromptBytes,
      settingsDeclaredVariantCount: 2,
      settingsConfirmationMatchesAttempt: true,
      countStartingImageCount: 4,
      qualifyingBaselineCount: 4,
      armReceiptBaselineCount: 4,
      overflowEvidence: ["scroll_extent_exceeds_viewport"],
      baselineActualScrolling: false,
      countDecisionStatus: "count_matched",
      countDecisionExpectedTotal: 6,
      workerBuildId: packageBuildId,
      attemptBuildId: packageBuildId,
      attemptProtocolVersion: 4,
      workerProtocolVersion: 4,
      activationCount: 1,
    });
    expect(report.dashboardReadback).toMatchObject({
      status: "available",
      attemptState: "dispatched",
      countDecision: {
        status: "count_matched",
        startingImageCount: 4,
        expectedTotal: 6,
      },
      baselineInventoryComplete: false,
      providerOutcome: "unknown",
    });
    expect(report.sequences.some((event) => event.tileCount === 6)).toBe(true);
    expect(report.sequences.some((event) => event.resourceEventCount > 0)).toBe(
      true,
    );
    expect(
      report.sequences
        .filter((event) => event.observedAt > setup.dispatchBoundaryAt)
        .every(
          (event) =>
            !event.virtualized &&
            event.virtualizationEvidence.includes(
              "scroll_extent_exceeds_viewport",
            ),
        ),
    ).toBe(true);
    expect(report.diagnostics).toEqual([]);
    await page.evaluate(() =>
      (
        window as unknown as {
          FlowObservationEndToEnd: {
            closeProductionObservationFixture: () => Promise<void>;
          };
        }
      ).FlowObservationEndToEnd.closeProductionObservationFixture(),
    );
  } finally {
    await bundle.close();
  }
});
