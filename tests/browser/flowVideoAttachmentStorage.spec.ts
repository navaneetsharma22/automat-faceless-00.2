import { expect, test } from "@playwright/test";
import { rolldown } from "rolldown";
import { resolve } from "node:path";

test("upgrades v9 IndexedDB without clearing existing records and keeps attachment intent after reopen", async ({ page }) => {
  await page.route("https://flow.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "offline fixture" }));
  await page.goto("https://flow.google.com/project/attachment-storage-fixture");
  const bundle = await rolldown({ input: resolve(process.cwd(), "tests/browser/flowVideoAttachmentStorageHarness.ts") });
  try {
    const built = await bundle.generate({ format: "iife", name: "FlowVideoAttachmentStorageFixture" });
    const chunk = built.output.find((output) => output.type === "chunk");
    if (!chunk) throw new Error("Flow video attachment storage harness missing");
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(() => window.__FlowVideoAttachmentStorageFixture!.verifyUpgradeAndReopen());
    expect(report).toEqual({
      oldPreparedDataPreserved: true,
      oldReferenceDataPreserved: true,
      oldQueueDataPreserved: true,
      videoQueueStoreAvailable: true,
      vidsGenerationStoreAvailable: true,
      vidsVideoQueueStoreAvailable: true,
      videoQueuePersistsAfterReopen: true,
      intentPersistsAfterReopen: true,
      repositoryClaimIsExclusive: true,
      databaseVersion: 14,
      requestHandlerSuccess: true,
      handlerClaimBeforeSimulatedActivation: true,
      handlerUsedExactDocument: true,
      simulatedActivationCount: 1,
    });
  } finally {
    await bundle.close();
  }
});
