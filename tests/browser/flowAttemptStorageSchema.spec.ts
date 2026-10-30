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
    const built = await bundle.generate({
      format: "iife",
      name: "FlowAttemptStorageFixture",
    });
    const chunk = built.output.find((output) => output.type === "chunk");
    if (!chunk) throw new Error("Storage regression harness bundle missing");
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(() =>
      (
        window as unknown as {
          FlowAttemptStorageFixture: {
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
      ).FlowAttemptStorageFixture.transitionPersistedIntermediateAttempt(),
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
