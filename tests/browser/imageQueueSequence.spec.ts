import { expect, test } from "@playwright/test";
import { rolldown } from "rolldown";
import { resolve } from "node:path";

test("production timed scheduler sequences synthetic inputs using real Dexie receipts", async ({
  page,
}) => {
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body><form role="group" aria-label="Image prompt composer" data-composer><textarea aria-label="Prompt text" placeholder="What do you want to create?"></textarea><button type="button" aria-label="Generate image">Generate</button></form><script>globalThis.__timedClickLog=[];document.querySelector('button').addEventListener('click',()=>{const input=document.querySelector('textarea');globalThis.__timedClickLog.push(input.value);input.value='';});</script></body></html>`,
    }),
  );
  await page.goto("https://flow.google.com/project/timed-sequence");
  await page.addScriptTag({
    content: "globalThis.__AUTOMAT_BUILD_ID__='fixture-build';",
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await page.exposeFunction(
    "__timedCdpSend",
    (method: string, params?: object) =>
      cdp.send(method as never, params as never),
  );
  const bundle = await rolldown({
    input: resolve(process.cwd(), "tests/browser/imageQueueSequenceHarness.ts"),
  });
  try {
    const built = await bundle.generate({
      format: "iife",
      name: "TimedQueueSequenceFixture",
    });
    const chunk = built.output.find(
      (output) => output.type === "chunk" && output.isEntry,
    );
    if (!chunk) throw new Error("Timed queue fixture bundle missing");
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(() =>
      window.__TimedQueueSequenceFixture.runDexieTimedQueueSequence(),
    );
    expect(report.orderedProviderInputs).toEqual(report.expectedBodies);
    expect(report.earlyCount).toBe(1);
    expect(report.dispatchCount).toBe(2);
    expect(report.activationCounts).toEqual([1, 1]);
    expect(report.receiptDurableBeforeSecond).toBe(true);
    expect(report.receiptTimes).toEqual([1_000, 41_000]);
    expect(report.outcomes).toEqual(["unknown", "unknown"]);
    expect(report.finalState).toBe("sent");
    expect(report.deadlines).toBeNull();
    expect(report.alarmCount).toBe(0);
  } finally {
    await bundle.close();
    await cdp.detach();
  }
});
