import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { flowComposerRuntime } from "../../src/platforms/flow/composer";

const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/prompts/p04-image-user-approved-intended-use.json",
);
const crlfFixturePath = resolve(
  process.cwd(),
  "tests/fixtures/prompts/p03-image-long-crlf.synthetic.json",
);

async function installLocalComposer(page: Page, extra = "") {
  await page.setContent(`<!doctype html>
    <html><body>
      <header><input type="search" aria-label="Search projects" placeholder="Search" /></header>
      <form role="group" aria-label="Image prompt composer" data-testid="composer-fixture">
        <textarea aria-label="Prompt text" placeholder="What do you want to create?"></textarea>
        <button type="button" aria-label="Submit prompt">→</button>
      </form>
      ${extra}
    </body></html>`);
  await page.addStyleTag({
    content:
      "body{font:16px sans-serif} textarea{display:block;min-height:120px;border:1px solid}",
  });
}

async function inspect(page: Page, expectedText: string) {
  return page.evaluate(
    ({ source, expected }) => {
      const runtime = (0, eval)(`(${source})`) as (
        text: string,
        returnEditor?: boolean,
      ) => unknown;
      return runtime(expected, false);
    },
    { source: flowComposerRuntime.toString(), expected: expectedText },
  ) as Promise<{
    state: string;
    candidateCount: number;
    methodCompatible: boolean;
    currentText?: string;
  }>;
}

test.describe("Flow composer local DOM fixtures only", () => {
  test("distinguishes search from a unique semantic composer", async ({
    page,
  }) => {
    await installLocalComposer(page);
    const result = await inspect(page, "{}");
    expect(result).toMatchObject({
      state: "empty",
      candidateCount: 1,
      methodCompatible: true,
    });
  });

  test("blocks missing, hidden, disabled, and ambiguous candidates", async ({
    page,
  }) => {
    await installLocalComposer(
      page,
      `
      <form role="group" aria-label="Hidden prompt composer" hidden>
        <div contenteditable="true" role="textbox" aria-label="Prompt"></div>
      </form>
      <form role="group" aria-label="Disabled prompt composer">
        <textarea aria-label="Prompt" disabled></textarea>
      </form>`,
    );
    expect(await inspect(page, "{}")).toMatchObject({
      state: "empty",
      candidateCount: 1,
    });
    await page
      .locator("form[aria-label='Image prompt composer']")
      .evaluate((node) => node.remove());
    expect(await inspect(page, "{}")).toMatchObject({
      state: "missing",
      candidateCount: 0,
    });
    await page
      .locator("form[aria-label='Disabled prompt composer']")
      .evaluate((node) => node.remove());
    await page.locator("body").evaluate((body) => {
      const first = document.createElement("form");
      first.setAttribute("role", "group");
      first.setAttribute("aria-label", "First prompt composer");
      first.innerHTML =
        '<textarea aria-label="Prompt" placeholder="What do you want to create?"></textarea>';
      first.querySelector("textarea")!.style.minHeight = "10px";
      first.querySelector("textarea")!.style.display = "block";
      body.append(first);
      const duplicate = document.createElement("form");
      duplicate.setAttribute("role", "group");
      duplicate.setAttribute("aria-label", "Second prompt composer");
      duplicate.innerHTML =
        '<textarea aria-label="Prompt" placeholder="What do you want to create?"></textarea>';
      duplicate.querySelector("textarea")!.style.minHeight = "10px";
      duplicate.querySelector("textarea")!.style.display = "block";
      body.append(duplicate);
    });
    const ambiguous = await inspect(page, "{}");
    expect(ambiguous).toMatchObject({ state: "ambiguous", candidateCount: 2 });
  });

  test("does not trust placeholder text without semantic ownership", async ({
    page,
  }) => {
    await page.setContent(
      '<form><textarea placeholder="What do you want to create?"></textarea></form>',
    );
    await page.addStyleTag({ content: "textarea{display:block}" });
    expect(await inspect(page, "{}")).toMatchObject({
      state: "missing",
      candidateCount: 0,
    });
  });

  test("does not use the unverified contenteditable insertion path", async ({
    page,
  }) => {
    await page.setContent(`
      <form role="group" aria-label="Image prompt composer">
        <div contenteditable="true" role="textbox" aria-label="Prompt" data-placeholder="What do you want to create?"></div>
      </form>`);
    await page.addStyleTag({
      content: "[contenteditable]{display:block;min-height:40px}",
    });
    expect(await inspect(page, "{}")).toMatchObject({
      state: "unsupported",
      candidateCount: 1,
      methodCompatible: false,
    });
  });

  test("reports empty, already-matching, and conflicting text without mutation", async ({
    page,
  }) => {
    await installLocalComposer(page);
    expect(await inspect(page, "{}")).toMatchObject({ state: "empty" });
    await page
      .locator("textarea[aria-label='Prompt text']")
      .fill("existing text");
    expect(await inspect(page, "{}")).toMatchObject({
      state: "conflict",
      currentText: "existing text",
    });
    expect(
      await page.locator("textarea[aria-label='Prompt text']").inputValue(),
    ).toBe("existing text");
    expect(await inspect(page, "existing text")).toMatchObject({
      state: "already-matching",
    });
  });

  test("CDP-style local insertion preserves the approved dinosaur JSON exactly", async ({
    page,
  }) => {
    const bytes = await readFile(fixturePath);
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    expect(source.length).toBe(15_889);
    expect(bytes.byteLength).toBe(16_013);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "f452ef3df4f0e7281560c52f980378df7f3cbfbc1b461353be1e46294a664a8b",
    );
    await installLocalComposer(page);
    const editor = page.locator("textarea[aria-label='Prompt text']");
    await editor.focus();
    await page.keyboard.insertText(source);
    const actual = await editor.inputValue();
    expect(actual).toBe(source);
    expect(
      await page
        .locator("form")
        .evaluate((form) => form.matches(":focus-within")),
    ).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
      "TEXTAREA",
    );
    expect(await inspect(page, source)).toMatchObject({
      state: "already-matching",
      currentText: source,
    });
  });

  test("preserves 25k CRLF JSON including Unicode and escaped content", async ({
    page,
  }) => {
    const bytes = await readFile(crlfFixturePath);
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    expect(source.length).toBe(25_000);
    expect(bytes.byteLength).toBe(25_062);
    expect(source.match(/\r\n/g)?.length).toBe(42);
    expect(source.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "618342596a32b30a3e37ac1fc45b1b1b67c103e9f85e691a01065359844fb0f4",
    );
    await installLocalComposer(page);
    const editor = page.locator("textarea[aria-label='Prompt text']");
    await editor.focus();
    await page.keyboard.insertText(source);
    const actual = await editor.inputValue();
    expect(actual.length).toBe(24_958);
    expect(new TextEncoder().encode(actual).byteLength).toBe(25_020);
    expect(actual).not.toBe(source);
    expect(actual.replace(/\r\n/g, "").includes("\r")).toBe(false);
    expect(actual.replace(/\r\n/g, "").match(/\n/g)?.length).toBe(42);
    const readback = await inspect(page, source);
    expect(readback.state).toBe("conflict");
    expect(readback.currentText).toBe(actual);
    let firstDifferenceOffset = 0;
    while (source[firstDifferenceOffset] === actual[firstDifferenceOffset]) {
      firstDifferenceOffset += 1;
    }
    expect(firstDifferenceOffset).toBe(source.indexOf("\r\n"));
    expect(source[firstDifferenceOffset]).toBe("\r");
    expect(actual[firstDifferenceOffset]).toBe("\n");
  });

  test("settled exact text survives a local editor-node replacement", async ({
    page,
  }) => {
    await installLocalComposer(page);
    await page
      .locator("textarea[aria-label='Prompt text']")
      .evaluate((node) => {
        node.addEventListener(
          "input",
          () => {
            const replacement = node.cloneNode(false) as HTMLTextAreaElement;
            replacement.value = (node as HTMLTextAreaElement).value;
            node.replaceWith(replacement);
          },
          { once: true },
        );
      });
    const source =
      '{"nested":{"decimal":[1.25,2.5]},"text":"नमस्ते 🦕 \\"quoted\\""}';
    const editor = page.locator("textarea[aria-label='Prompt text']");
    await editor.focus();
    await page.keyboard.insertText(source);
    const current = page.locator("textarea[aria-label='Prompt text']");
    const actual = await current.inputValue();
    expect(actual).toBe(source);
    expect(await inspect(page, source)).toMatchObject({
      state: "already-matching",
    });
  });
});
