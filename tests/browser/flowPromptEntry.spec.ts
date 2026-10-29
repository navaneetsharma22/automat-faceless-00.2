import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { flowComposerRuntimeExpression } from "../../src/platforms/flow/composer";
import { flowImageRuntimeExpression } from "../../src/platforms/flow/images";
import type { FlowPromptEntryPort } from "../../src/platforms/flow/promptEntry";
import { importPromptBatch } from "../../src/domain/batches/importBatch";
import { rolldown } from "rolldown";

const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/prompts/p04-image-user-approved-intended-use.json",
);
const crlfFixturePath = resolve(
  process.cwd(),
  "tests/fixtures/prompts/p03-image-long-crlf.synthetic.json",
);
const observedFixturePath = resolve(
  process.cwd(),
  "tests/fixtures/flow/observed-composer.synthetic.html",
);

async function installObservedComposer(page: Page) {
  await page.setContent(await readFile(observedFixturePath, "utf8"));
  await page.evaluate(() => {
    const state = { clicks: 0, submits: 0 };
    Object.assign(window, { localComposerEvents: state });
    document.addEventListener("click", () => {
      state.clicks += 1;
    });
    document.addEventListener("submit", (event) => {
      state.submits += 1;
      event.preventDefault();
    });
  });
}

/** Real Chromium Runtime/Input commands on about:blank; target identity is mocked.
 * No provider URL is opened and no user profile is used. */
async function enterObservedFixture(
  page: Page,
  source: string,
  partialFailure = false,
) {
  Object.defineProperty(globalThis, "__AUTOMAT_BUILD_ID__", {
    value: "local-observed-flow-fixture",
    configurable: true,
  });
  const { enterFlowPrompt } =
    await import("../../src/platforms/flow/promptEntry");
  const session = await page.context().newCDPSession(page);
  const url = "https://flow.google.com/u/1/project/local_fixture";
  const canonicalTarget = url;
  const commands: string[] = [];
  const port: FlowPromptEntryPort = {
    getSelection: async () => ({ tabId: 42, canonicalTarget }),
    getTab: async () => ({
      id: 42,
      title: "Synthetic local target",
      url,
      provider: "Flow",
      projectId: "local_fixture",
      canonicalTarget,
    }),
    hasRequiredApis: () => true,
    hasDebuggerPermission: async () => true,
    attach: async () => undefined,
    detach: () => session.detach(),
    sendCommand: async (_id, method, params) => {
      commands.push(method);
      if (method === "Page.getFrameTree")
        return {
          frameTree: {
            frame: { id: "local-frame", loaderId: "local-loader", url },
          },
        };
      if (method === "Input.insertText" && partialFailure) {
        await session.send("Input.insertText", {
          text: (params as { text: string }).text.slice(0, 12),
        });
        throw new Error("Synthetic unknown response after partial input");
      }
      return session.send(method as never, params as never);
    },
  };
  return { result: await enterFlowPrompt(source, port), commands };
}

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
    (expression) => (0, eval)(expression),
    flowComposerRuntimeExpression(expectedText),
  ) as Promise<{
    state: string;
    candidateCount: number;
    methodCompatible: boolean;
    currentText?: string;
  }>;
}

test.describe("Flow composer local DOM fixtures only", () => {
  test("minified serialized runtimes keep their text-reader dependencies", async ({
    page,
  }) => {
    const bundle = await rolldown({
      input: resolve(process.cwd(), "tests/browser/runtimeFixtureExports.ts"),
    });
    try {
      const built = await bundle.generate({
        format: "iife",
        name: "LocalFlowRuntime",
        minify: true,
      });
      const chunk = built.output.find((output) => output.type === "chunk");
      if (!chunk) throw new Error("Local minified fixture bundle missing");
      await installObservedComposer(page);
      await page.addScriptTag({ content: chunk.code });
      const expressions = await page.evaluate(() => {
        const runtime = (
          window as unknown as {
            LocalFlowRuntime: {
              flowComposerRuntimeExpression: (text: string) => string;
              flowImageRuntimeExpression: (text: string) => string;
            };
          }
        ).LocalFlowRuntime;
        return [
          runtime.flowComposerRuntimeExpression("{}"),
          runtime.flowImageRuntimeExpression("{}"),
        ];
      });
      expect(
        await page.evaluate(
          (expression) => (0, eval)(expression),
          expressions[0]!,
        ),
      ).toMatchObject({
        state: "empty",
        profile: "flow-rich-text",
        methodCompatible: true,
      });
      expect(
        await page.evaluate(
          (expression) => (0, eval)(expression),
          expressions[1]!,
        ),
      ).toMatchObject({
        composer: "identified",
        exactPrompt: false,
        generate: "missing",
        generationAvailable: false,
      });
    } finally {
      await bundle.close();
    }
  });

  test("observed custom host structure identifies one rich editor and excludes search/navigation/hidden inputs", async ({
    page,
  }) => {
    await installObservedComposer(page);
    expect(await inspect(page, "{}")).toMatchObject({
      state: "empty",
      candidateCount: 1,
      editorKind: "contenteditable",
      profile: "flow-rich-text",
      textReadback: "dom-block-lines",
      methodCompatible: true,
    });
    // A create word in the navigation title still does not make it a composer.
    await page
      .locator("flow-navigation-header input")
      .evaluate((node) =>
        node.setAttribute("aria-label", "Create synthetic project title"),
      );
    expect(await inspect(page, "{}")).toMatchObject({
      candidateCount: 1,
      profile: "flow-rich-text",
    });
    await page.locator("body").evaluate((body) => {
      const unrelated = document.createElement("div");
      unrelated.setAttribute("contenteditable", "true");
      unrelated.setAttribute("role", "textbox");
      unrelated.setAttribute("aria-label", "Create unrelated note");
      unrelated.style.minHeight = "24px";
      body.append(unrelated);
    });
    expect(await inspect(page, "{}")).toMatchObject({
      state: "empty",
      candidateCount: 1,
    });
  });

  for (const variant of [
    "missing-host",
    "missing-editor",
    "missing-role",
    "hidden",
    "disabled",
    "readonly",
  ] as const) {
    test(`observed editor blocks ${variant} before any entry`, async ({
      page,
    }) => {
      await installObservedComposer(page);
      await page.locator("flow-base-prompt-box").evaluate((box, mode) => {
        const editor = box.querySelector("[contenteditable]")!;
        if (mode === "missing-host")
          box.replaceWith(...Array.from(box.childNodes));
        if (mode === "missing-editor") editor.remove();
        if (mode === "missing-role") editor.removeAttribute("role");
        if (mode === "hidden") box.setAttribute("hidden", "");
        if (mode === "disabled") box.setAttribute("aria-disabled", "true");
        if (mode === "readonly") editor.setAttribute("aria-readonly", "true");
      }, variant);
      const { result, commands } = await enterObservedFixture(
        page,
        '{"shot_id":"01","scene":"SYNTHETIC"}',
      );
      expect(result).toMatchObject({
        composer: "missing",
        inputMethod: "none",
        fillVerified: false,
      });
      expect(commands).not.toContain("Input.insertText");
    });
  }

  test("two observed rich editors are ambiguous and media content is blocked", async ({
    page,
  }) => {
    await installObservedComposer(page);
    await page
      .locator("flow-base-prompt-box")
      .evaluate((box) => box.after(box.cloneNode(true)));
    expect(await inspect(page, "{}")).toMatchObject({
      state: "ambiguous",
      candidateCount: 2,
      diagnostic: "multiple_eligible_editors",
    });
    const blocked = await enterObservedFixture(page, '{"scene":"SYNTHETIC"}');
    expect(blocked.commands).not.toContain("Input.insertText");
    await installObservedComposer(page);
    await page
      .locator("flow-base-prompt-box")
      .evaluate((box) => box.append(document.createElement("img")));
    expect(await inspect(page, "{}")).toMatchObject({
      state: "unsupported",
      diagnostic: "composer_media_present",
    });
  });

  test("observed rich-editor fixture preserves approved long JSON through actual local CDP immediate and settled readback", async ({
    page,
  }) => {
    await installObservedComposer(page);
    const source = await readFile(fixturePath, "utf8");
    const { result, commands } = await enterObservedFixture(page, source);
    expect(result).toMatchObject({
      outcome: "filled",
      fillVerified: true,
      immediateMatch: true,
      settledMatch: true,
      stableReadback: true,
      expectedCodeUnits: 15889,
      actualCodeUnits: 15889,
      actualUtf8Bytes: 16013,
      actualSha256:
        "f452ef3df4f0e7281560c52f980378df7f3cbfbc1b461353be1e46294a664a8b",
      generationAvailable: false,
      editorKind: "contenteditable",
      composerProfile: "flow-rich-text",
      textReadback: "dom-block-lines",
    });
    expect(
      commands.filter((method) => method === "Input.insertText"),
    ).toHaveLength(1);
    expect(commands).not.toContain("Input.dispatchMouseEvent");
    expect(commands).not.toContain("Input.dispatchKeyEvent");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { localComposerEvents: unknown })
            .localComposerEvents,
      ),
    ).toEqual({ clicks: 0, submits: 0 });
    // Contenteditable can be preflighted, but this fixture has no Generate or results region.
    expect(
      await page.evaluate(
        (expression) => (0, eval)(expression),
        flowImageRuntimeExpression(source),
      ),
    ).toMatchObject({
      composer: "identified",
      exactPrompt: true,
      generate: "missing",
      generationAvailable: false,
    });
  });

  test("rich editor rejects a bare empty paragraph or unsupported markup before input", async ({
    page,
  }) => {
    await installObservedComposer(page);
    const editor = page.locator('[contenteditable="true"]');
    await editor.evaluate((node) =>
      node.replaceChildren(document.createElement("p")),
    );
    expect(await inspect(page, "{}")).toMatchObject({
      state: "unsupported",
      diagnostic: "unverified_empty_editor",
    });
    const empty = await enterObservedFixture(page, '{"scene":"SYNTHETIC"}');
    expect(empty.commands).not.toContain("Input.insertText");
    await editor.evaluate((node) => {
      node.innerHTML = "<p><b>SYNTHETIC unsupported format</b></p>";
    });
    expect(await inspect(page, "{}")).toMatchObject({
      state: "unsupported",
      diagnostic: "editor_representation_unsupported",
    });
    const markup = await enterObservedFixture(page, '{"scene":"SYNTHETIC"}');
    expect(markup.commands).not.toContain("Input.insertText");
  });

  test("rich-editor logical lines preserve spaces and blank blocks without trimming", async ({
    page,
  }) => {
    await installObservedComposer(page);
    await page.locator('[contenteditable="true"]').evaluate((editor) => {
      editor.innerHTML =
        "<p> first </p><p><br></p><div>last <span>🦖</span></div>";
    });
    expect(await inspect(page, " first \n\nlast 🦖")).toMatchObject({
      state: "already-matching",
      currentText: " first \n\nlast 🦖",
    });
  });

  test("rich-editor local CDP preserves blank lines, decimal arrays, Hindi, emoji, and escaped strings", async ({
    page,
  }) => {
    await installObservedComposer(page);
    const source = JSON.stringify(
      {
        shot_id: "01",
        provenance: "SYNTHETIC local fixture",
        nested: {
          decimal: [1.25, 2.5],
          text: 'नमस्ते 🦖 "quoted" \\path \\r\\n',
        },
      },
      null,
      2,
    ).replace("{\n", "{  \n\n");
    const { result, commands } = await enterObservedFixture(page, source);
    expect(result).toMatchObject({
      fillVerified: true,
      immediateMatch: true,
      settledMatch: true,
      stableReadback: true,
      actualCodeUnits: source.length,
    });
    expect(result.actualSha256).toBe(result.expectedSha256);
    expect(
      commands.filter((method) => method === "Input.insertText"),
    ).toHaveLength(1);
  });

  test("observed rich editor preserves conflicting whitespace and never refills partial input", async ({
    page,
  }) => {
    await installObservedComposer(page);
    await page.locator('[contenteditable="true"]').evaluate((editor) => {
      (editor as HTMLElement).innerText = " ";
    });
    const source = '{"shot_id":"01","scene":"SYNTHETIC"}';
    const conflict = await enterObservedFixture(page, source);
    expect(conflict.result.code).toBe("editor_has_different_text");
    expect(conflict.commands).not.toContain("Input.insertText");
    expect(await page.locator('[contenteditable="true"]').innerText()).toBe(
      " ",
    );
    await installObservedComposer(page);
    const partial = await enterObservedFixture(page, source, true);
    expect(partial.result).toMatchObject({
      outcome: "input-uncertain",
      fillVerified: false,
      actualCodeUnits: 12,
    });
    expect(
      partial.commands.filter((method) => method === "Input.insertText"),
    ).toHaveLength(1);
  });

  test("observed rich-editor CRLF representation mismatch is reported without normalization or refill", async ({
    page,
  }) => {
    await installObservedComposer(page);
    const imported = importPromptBatch(
      await readFile(crlfFixturePath, "utf8"),
      "image",
    );
    if (!imported.ok) throw new Error("Synthetic CRLF fixture did not import");
    const source = imported.items[0]!.rawBody;
    const { result, commands } = await enterObservedFixture(page, source);
    expect(result).toMatchObject({
      outcome: "readback-mismatch",
      fillVerified: false,
      expectedCodeUnits: source.length,
      immediateMatch: false,
      settledMatch: false,
    });
    expect(result.actualSha256).not.toBe(result.expectedSha256);
    expect(result.actualCodeUnits).toBe(
      source.length - (source.match(/\r\n/g)?.length ?? 0),
    );
    expect(
      commands.filter((method) => method === "Input.insertText"),
    ).toHaveLength(1);
  });

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
