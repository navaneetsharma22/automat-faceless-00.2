import { expect, test } from "@playwright/test";
import { rolldown } from "rolldown";
import { resolve } from "node:path";

test("real Dexie repository commits the verified-to-dispatch-intent count baseline", async ({
  page,
}) => {
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "fixture" }),
  );
  await page.goto("https://flow.google.com/project/storage-schema-fixture");

  const bundle = await rolldown({
    input: resolve(process.cwd(), "tests/browser/flowAttemptStorageHarness.ts"),
  });
  try {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const built = await bundle.generate({
      format: "iife",
      name: "FlowAttemptStorageFixture",
    });
    const chunk = built.output.find((output) => output.type === "chunk");
    if (!chunk) throw new Error("Storage regression harness bundle missing");
    await page.evaluate(() => {
      Object.defineProperty(globalThis, "__AUTOMAT_BUILD_ID__", {
        configurable: true,
        value: "automat-faceless-0.1.0-dexie-fixture",
      });
    });
    await page.addScriptTag({ content: chunk.code });
    if (!(await page.evaluate(() => "__FlowAttemptStorageFixture" in window)))
      throw new Error(`fixture_not_exposed_${pageErrors.join("|")}`);
    const report = await page.evaluate(() =>
      (
        window as unknown as {
          __FlowAttemptStorageFixture: {
            transitionPersistedIntermediateAttempt: () => Promise<{
              persistedPreparing: boolean;
              persistedVerified: boolean;
              state: string | null;
              hasResultBaseline: boolean;
              hasObservationSession: boolean;
              baselineRetainsVirtualScrollContainerCount: boolean;
              baselineRetainsVirtualizationEvidence: boolean;
              sourceSnapshotIntegrityVerified: boolean;
              countSessionBindingMatches: boolean;
              declarationBindingMatches: boolean;
              countBaselineNotApplicable: boolean;
              lastEventCode: string | null;
            }>;
          };
        }
      ).__FlowAttemptStorageFixture.transitionPersistedIntermediateAttempt(),
    );

    expect(report).toEqual({
      persistedPreparing: true,
      persistedVerified: true,
      state: "dispatch-intent",
      hasResultBaseline: true,
      hasObservationSession: true,
      baselineRetainsVirtualScrollContainerCount: true,
      baselineRetainsVirtualizationEvidence: true,
      sourceSnapshotIntegrityVerified: true,
      countSessionBindingMatches: true,
      declarationBindingMatches: true,
      countBaselineNotApplicable: true,
      lastEventCode: "dispatch_intent_persisted",
    });
  } finally {
    await bundle.close();
  }
});

test("real Dexie inspection, refresh, reconciliation, and recovery preserve a lost interrupted attempt", async ({
  page,
}) => {
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "fixture" }),
  );
  await page.goto("https://flow.google.com/project/recovery-dexie-fixture");

  const bundle = await rolldown({
    input: resolve(process.cwd(), "tests/browser/flowAttemptStorageHarness.ts"),
  });
  try {
    const built = await bundle.generate({
      format: "iife",
      name: "FlowAttemptStorageFixture",
    });
    const chunk = built.output.find((output) => output.type === "chunk");
    if (!chunk) throw new Error("Storage regression harness bundle missing");
    await page.evaluate(() => {
      Object.defineProperty(globalThis, "__AUTOMAT_BUILD_ID__", {
        configurable: true,
        value: "automat-faceless-0.1.0-dexie-recovery-fixture",
      });
    });
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(() =>
      (
        window as unknown as {
          __FlowAttemptStorageFixture: {
            inspectAndRecoverInterruptedDexieAttempt: () => Promise<{
              inspectionAttemptId: string | null;
              recoveryAttemptId: string | undefined;
              beforeInspection: Record<string, unknown>;
              readbackDecision: string | null;
              recoveryStatus: string | undefined;
              recoveryReason: string | undefined;
              recoveryDetailReason: string | undefined;
              recoveryCurrentDecisionStatus: string | undefined;
              recoveryOldAttemptId: string | undefined;
              readinessReason: string | undefined;
              reconciliation: { uncertain: number };
              afterInspection: Record<string, unknown>;
              oldRowUnchanged: boolean;
              oldLockPreserved: boolean;
              structuralObservationCount: number;
              observationReceiptCount: number;
              observationsPreserved: boolean;
              staleSnapshotWriteRejected: boolean;
              terminalTransitionRejected: boolean;
              recoveryCount: number;
              recoveryOldAttemptId: string | null;
            }>;
          };
        }
      ).__FlowAttemptStorageFixture.inspectAndRecoverInterruptedDexieAttempt(),
    );

    expect(report.inspectionAttemptId).toBe(
      "86e721b7-7cc9-4c1d-a476-f2fc2d30f9ec",
    );
    expect(report.recoveryOldAttemptId, JSON.stringify(report)).toBe(
      report.inspectionAttemptId,
    );
    expect(report.beforeInspection).toMatchObject({
      state: "dispatched",
      observationStatus: "lost",
      providerOutcomePersistedStatus: "unknown",
      countDecision: "interrupted",
      recoveryEligible: true,
    });
    expect(report.readbackDecision).toBe("interrupted");
    expect(report.recoveryStatus, JSON.stringify(report)).toBe("recovered");
    expect(report.readinessReason).toBe("count_session_paused");
    expect(report.reconciliation.uncertain).toBe(0);
    expect(report.afterInspection).toMatchObject({
      state: "dispatched",
      observationStatus: "lost",
      providerOutcomePersistedStatus: "unknown",
      countDecision: "interrupted",
      recoveryEligible: true,
    });
    expect(report.oldRowUnchanged).toBe(true);
    expect(report.oldLockPreserved).toBe(true);
    expect(report.structuralObservationCount).toBe(1);
    expect(report.observationReceiptCount).toBe(1);
    expect(report.observationsPreserved).toBe(true);
    expect(report.staleSnapshotWriteRejected).toBe(true);
    expect(report.terminalTransitionRejected).toBe(true);
    expect(report.recoveryCount).toBe(1);
    expect(report.recoveryOldAttemptId).toBe(report.inspectionAttemptId);
  } finally {
    await bundle.close();
  }
});
