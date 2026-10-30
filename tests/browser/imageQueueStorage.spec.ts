import { expect, test } from "@playwright/test";
import { rolldown } from "rolldown";
import { resolve } from "node:path";

test("real Dexie stores and reads back the exact ordered timed queue", async ({
  page,
}) => {
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, body: "fixture" }),
  );
  await page.goto("https://flow.google.com/project/image-queue-fixture");
  const bundle = await rolldown({
    input: resolve(process.cwd(), "tests/browser/imageQueueStorageHarness.ts"),
  });
  try {
    const built = await bundle.generate({
      format: "iife",
      name: "ImageQueueStorageFixture",
    });
    const chunk = built.output.find((output) => output.type === "chunk");
    if (!chunk) throw new Error("Image queue storage harness bundle missing");
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(() =>
      window.__ImageQueueStorageFixture.persistTimedQueueReadback(),
    );
    expect(report).toEqual({
      recordEqualsReadback: true,
      exactSource: true,
      exactBodies: [
        '{"shot_id":"04","text":"first  \\n prompt"}',
        '{"shot_id":"09","text":"second"}',
      ],
      orderedShotIds: ["4", "9"],
      mode: "timed_submission",
      intervalMs: 40_000,
      initialState: "ready",
      outcomeStates: ["not_started", "not_started"],
      noDeadlineBeforeDispatch: true,
    });
  } finally {
    await bundle.close();
  }
});
