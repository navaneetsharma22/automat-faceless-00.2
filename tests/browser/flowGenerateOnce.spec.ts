import { expect, test } from "@playwright/test";
import { flowImageRuntime } from "../../src/platforms/flow/images";

async function installImageComposer(page: import("@playwright/test").Page) {
  await page.setContent(`<!doctype html>
    <html><body>
      <main><section role="region" aria-label="Generated results"><img alt="Existing local fixture result" /></section></main>
      <form role="group" aria-label="Image prompt composer">
        <textarea aria-label="Prompt text" placeholder="What do you want to create?"></textarea>
        <button type="button" aria-label="Generate">Generate</button>
      </form>
    </body></html>`);
  await page.addStyleTag({
    content:
      "body{font:16px sans-serif}main,section{min-height:40px}img{width:20px;height:20px}textarea{display:block;min-height:80px}button{display:block}",
  });
}

async function inspect(page: import("@playwright/test").Page, prompt: string) {
  return page.evaluate(
    ({ runtimeSource, expected }) => {
      const runtime = (0, eval)(`(${runtimeSource})`) as (
        text: string,
        mode?: "inspect" | "button",
      ) => unknown;
      return runtime(expected, "inspect");
    },
    { runtimeSource: flowImageRuntime.toString(), expected: prompt },
  ) as Promise<{
    composer: string;
    exactPrompt: boolean;
    actualCodeUnits: number;
    generate: string;
    observation: string;
    baseline?: { regionLabel: string; mediaCount: number };
    generationAvailable: false;
  }>;
}

test.describe("P04.2 local Flow image preflight fixtures only", () => {
  test("identifies exact local prompt, unique Generate, and observation baseline", async ({
    page,
  }) => {
    const prompt = '{"shot_id":"01","scene":"SYNTHETIC local fixture"}';
    await installImageComposer(page);
    await page.locator("textarea").fill(prompt);

    expect(await inspect(page, prompt)).toMatchObject({
      composer: "identified",
      exactPrompt: true,
      actualCodeUnits: prompt.length,
      generate: "identified",
      observation: "ready",
      baseline: { regionLabel: "Generated results", mediaCount: 1 },
      generationAvailable: false,
    });
  });

  test("blocks duplicate Generate controls and ambiguous results regions", async ({
    page,
  }) => {
    await installImageComposer(page);
    await page.locator("textarea").fill("synthetic local fixture");
    await page.locator("form").evaluate((form) => {
      const duplicateButton = document.createElement("button");
      duplicateButton.setAttribute("aria-label", "Generate image");
      form.append(duplicateButton);
      const duplicateRegion = document.createElement("section");
      duplicateRegion.setAttribute("role", "region");
      duplicateRegion.setAttribute("aria-label", "Image results");
      document.body.append(duplicateRegion);
    });

    expect(await inspect(page, "synthetic local fixture")).toMatchObject({
      composer: "identified",
      exactPrompt: true,
      generate: "ambiguous",
      observation: "ambiguous",
      generationAvailable: false,
    });
  });
});
