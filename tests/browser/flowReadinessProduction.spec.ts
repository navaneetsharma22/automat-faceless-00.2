import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { rolldown } from "rolldown";

test("production readiness preserves a confirmed four-count and measures four real qualifying DOM candidates", async ({
  page,
}) => {
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Flow readiness fixture</title>",
    }),
  );
  await page.goto("https://flow.google.com/project/readiness-fixture");
  await page.setContent(`<!doctype html>
    <style>
      flow-project-page, flow-base-prompt-box, flow-rich-text-editor, cdk-virtual-scroll-viewport, .tile-list, flow-image-tile { display: block; }
      cdk-virtual-scroll-viewport { height: 60px; width: 180px; overflow: auto; }
      .tile-list { height: 80px; }
      flow-image-tile { height: 20px; }
      img { width: 10px; height: 10px; }
      [contenteditable="true"] { height: 12px; }
    </style>
    <flow-project-page>
      <flow-base-prompt-box><flow-rich-text-editor><div contenteditable="true" role="textbox"></div></flow-rich-text-editor></flow-base-prompt-box>
      <cdk-virtual-scroll-viewport><div class="tile-list">
        <flow-image-tile><img data-media-id="fixture-ready-one" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></flow-image-tile>
        <flow-image-tile><img data-media-id="fixture-ready-two" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></flow-image-tile>
        <flow-image-tile><img data-media-id="fixture-ready-three" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></flow-image-tile>
        <flow-image-tile><img data-media-id="fixture-ready-four" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></flow-image-tile>
      </div></cdk-virtual-scroll-viewport>
    </flow-project-page>`);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("flow-image-tile img")].every(
      (image) =>
        (image as HTMLImageElement).complete &&
        (image as HTMLImageElement).naturalWidth > 0,
    ),
  );
  const bundle = await rolldown({
    input: resolve(
      process.cwd(),
      "tests/browser/flowReadinessProductionHarness.ts",
    ),
    plugins: [
      {
        name: "fixture-build-id",
        transform(code: string) {
          return code.replaceAll(
            "__AUTOMAT_BUILD_ID__",
            JSON.stringify("flow-readiness-production-fixture-build"),
          );
        },
      },
    ],
  });
  try {
    const built = await bundle.generate({
      format: "iife",
      name: "FlowReadinessProductionFixture",
    });
    const chunk = built.output.find((entry) => entry.type === "chunk");
    if (!chunk) throw new Error("Flow readiness fixture bundle missing");
    await page.addScriptTag({ content: chunk.code });
    const runReadiness = async (startingImageCount = 4) =>
      page.evaluate(async (count) => {
        const fixture = window as Window & {
          FlowReadinessProductionFixture?: {
            runProductionReadinessFixture: (
              startingImageCount: number,
            ) => Promise<Record<string, unknown>>;
          };
        };
        if (!fixture.FlowReadinessProductionFixture)
          throw new Error("Flow readiness fixture export missing");
        return fixture.FlowReadinessProductionFixture.runProductionReadinessFixture(
          count,
        );
      }, startingImageCount);
    const result = await runReadiness();
    expect(result).toMatchObject({
      selectedVerified: true,
      attemptsCreated: 0,
      report: {
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
        profile: "populated_tiles",
        renderedTileCount: 4,
        distinctCandidateCount: 4,
        qualifyingCandidateCount: 4,
        viewportOverflowObserved: true,
        actualScrollingObserved: false,
        candidateOwnershipAmbiguous: false,
      },
    });
    expect(
      await page
        .locator("cdk-virtual-scroll-viewport")
        .evaluate((viewport) => (viewport as HTMLElement).scrollTop),
    ).toBe(0);

    await page
      .locator("flow-image-tile img")
      .first()
      .evaluate((image) => {
        image.setAttribute("src", "data:image/gif;base64,invalid-resource");
      });
    await page.waitForFunction(() => {
      const image = document.querySelector(
        "flow-image-tile img",
      ) as HTMLImageElement;
      return image.complete && image.naturalWidth === 0;
    });
    const incompleteResource = await runReadiness(4);
    expect(incompleteResource).toMatchObject({
      report: {
        status: "blocked",
        reason: "existing_count_candidate_count_mismatch",
        selectedCountMode: { startingImageCount: 4, userConfirmed: true },
        qualifyingCandidateCount: 3,
      },
      attemptsCreated: 0,
    });

    await page.locator("flow-image-tile img").evaluateAll((images) => {
      for (const image of images) {
        image.setAttribute("src", "data:image/gif;base64,invalid-resource");
      }
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("flow-image-tile img")].every(
        (image) =>
          (image as HTMLImageElement).complete &&
          (image as HTMLImageElement).naturalWidth === 0,
      ),
    );
    const measuredZero = await runReadiness(4);
    expect(measuredZero).toMatchObject({
      report: {
        status: "blocked",
        reason: "existing_count_candidate_count_mismatch",
        qualifyingCandidateCount: 0,
      },
      attemptsCreated: 0,
    });

    await page.locator("flow-image-tile img").evaluateAll((images) => {
      for (const image of images) {
        image.setAttribute(
          "src",
          "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
        );
      }
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("flow-image-tile img")].every(
        (image) =>
          (image as HTMLImageElement).complete &&
          (image as HTMLImageElement).naturalWidth > 0,
      ),
    );
    await page
      .locator("flow-image-tile img")
      .nth(1)
      .evaluate((image) => {
        image.setAttribute("data-media-id", "fixture-ready-one");
      });
    const duplicate = await runReadiness(4);
    expect(duplicate).toMatchObject({
      report: {
        status: "blocked",
        reason: "existing_count_candidate_count_mismatch",
        distinctCandidateCount: 3,
        qualifyingCandidateCount: 3,
        repeatedCandidateCount: 1,
      },
      attemptsCreated: 0,
    });

    await page
      .locator("flow-image-tile img")
      .nth(1)
      .evaluate((image) => {
        image.setAttribute("data-media-id", "fixture-ready-two");
      });
    const countMismatch = await runReadiness(3);
    expect(countMismatch).toMatchObject({
      report: {
        status: "blocked",
        reason: "existing_count_candidate_count_mismatch",
        selectedCountMode: { startingImageCount: 3, userConfirmed: true },
        qualifyingCandidateCount: 4,
      },
      attemptsCreated: 0,
    });
  } finally {
    await bundle.close();
  }
});
