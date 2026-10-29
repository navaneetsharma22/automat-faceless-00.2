import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import {
  activateFlowImageGenerate,
  flowImageRuntimeExpression,
  type FlowGenerateDiscovery,
} from "../../src/platforms/flow/images";
import type { FlowImageGenerateOncePort } from "../../src/background/handlers/flow";
import type { FlowPromptEntryPort } from "../../src/platforms/flow/promptEntry";
import type { FlowSettingsConfirmation } from "../../src/shared/schemas";
import { ExtensionRepositories } from "../../src/storage/repositories";
import type { ProviderTab } from "../../src/platforms/shared/contracts";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";

const source = '{"shot_id":"01","scene":"SYNTHETIC local P04.2 fixture"}';
const observedFixturePath = resolve(
  process.cwd(),
  "tests/fixtures/flow/observed-composer.synthetic.html",
);
const selectedTab: ProviderTab = {
  id: 41,
  title: "Local Flow fixture",
  url: "https://flow.google.com/u/1/project/project_01?pli=1",
  provider: "Flow",
  projectId: "project_01",
  canonicalTarget: "https://flow.google.com/u/1/project/project_01",
};
const frame = {
  frameId: "local-frame-1",
  loaderId: "local-loader-1",
  url: selectedTab.url,
};
const settingsConfirmation: FlowSettingsConfirmation = {
  confirmationId: "local-confirmation-1",
  confirmedAt: 1_000,
  tabId: selectedTab.id,
  projectId: selectedTab.projectId,
  canonicalTarget: selectedTab.canonicalTarget,
};

async function installImageComposer(page: Page) {
  await page.setContent(await readFile(observedFixturePath, "utf8"));
  await page.evaluate(() => {
    const results = document.createElement("main");
    results.innerHTML =
      '<section role="region" aria-label="Generated results"><img alt="Existing local fixture result" /></section>';
    document.body.prepend(results);
    const submit = document.querySelector(
      "flow-base-prompt-box button:last-of-type",
    );
    submit?.setAttribute("aria-label", "Generate");
  });
  await page.addStyleTag({
    content:
      "body{font:16px sans-serif}main,section{display:block;min-height:40px}img{width:20px;height:20px}flow-base-prompt-box,flow-rich-text-editor{display:block}[contenteditable]{display:block;min-height:80px;white-space:pre-wrap}button{display:block}",
  });
}

async function inspectLocalComposer(page: Page, expected: string) {
  return page.evaluate(
    (expression) => (0, eval)(expression),
    flowImageRuntimeExpression(expected),
  ) as Promise<FlowGenerateDiscovery>;
}

async function inspectSemanticGenerateButton(page: Page) {
  const expression = flowImageRuntimeExpression(source, "button");
  return page.evaluate((runtime) => {
    const button = (0, eval)(runtime) as HTMLElement | null;
    return button?.getAttribute("aria-label") ?? null;
  }, expression);
}

async function createLocalAttempt(
  page: Page,
  options: { failRelease?: boolean } = {},
) {
  Object.defineProperty(globalThis, "__AUTOMAT_BUILD_ID__", {
    value: "local-p04-2-fixture",
    configurable: true,
  });
  const { createFlowImageGenerateOnce } =
    await import("../../src/background/handlers/flow");
  await installImageComposer(page);
  const repositories = new ExtensionRepositories(
    createMemoryRepositoryDatabase(),
    () => 1_100,
  );
  const saved = await repositories.savePromptBatch({
    workspaceId: "default",
    kind: "image",
    sourceText: source,
  });
  await repositories.recordSelectedTarget({
    provider: "Flow",
    tabId: selectedTab.id,
    canonicalTarget: selectedTab.canonicalTarget,
  });

  const mouseEvents: string[] = [];
  const commandPort: Pick<
    FlowPromptEntryPort,
    "sendCommand" | "attach" | "detach" | "now"
  > = {
    attach: async () => undefined,
    detach: async () => undefined,
    now: () => 1_100,
    sendCommand: async (_tabId, method, params) => {
      if (method === "Input.dispatchMouseEvent") {
        const type =
          (params as { type?: string } | undefined)?.type ?? "unknown";
        mouseEvents.push(type);
        if (options.failRelease && type === "mouseReleased") {
          throw new Error(
            "Local fixture simulates an unknown release response.",
          );
        }
      }
      return {};
    },
  };
  const port = {
    ...commandPort,
    getSelection: async () => ({
      tabId: selectedTab.id,
      canonicalTarget: selectedTab.canonicalTarget,
    }),
    getTab: async () => selectedTab,
    hasRequiredApis: () => true,
    hasDebuggerPermission: async () => true,
    captureFrame: async () => frame,
    readFrame: async () => frame,
    inspectGenerate: async (_tabId: number, expected: string) => {
      const discovery = await inspectLocalComposer(page, expected);
      return {
        ...discovery,
        buttonObjectId:
          discovery.generate === "identified"
            ? "local-generate-button"
            : undefined,
      };
    },
    recheckGenerate: async (
      _tabId: number,
      expected: string,
      expectedFrame: typeof frame,
      buttonId: string,
      baseline: NonNullable<FlowGenerateDiscovery["baseline"]>,
    ) => {
      const discovery = await inspectLocalComposer(page, expected);
      return (
        expectedFrame.frameId === frame.frameId &&
        expectedFrame.loaderId === frame.loaderId &&
        buttonId === "local-generate-button" &&
        discovery.composer === "identified" &&
        discovery.exactPrompt &&
        discovery.generate === "identified" &&
        discovery.observation === "ready" &&
        discovery.baseline?.regionLabel === baseline.regionLabel &&
        discovery.baseline?.mediaCount === baseline.mediaCount
      );
    },
    buttonPosition: async (_tabId: number, buttonId: string) => {
      const buttons = page.locator(
        'flow-base-prompt-box button[aria-label="Generate"]',
      );
      return buttonId === "local-generate-button" &&
        (await buttons.count()) === 1
        ? { x: 10, y: 10 }
        : undefined;
    },
    activate: (tabId: number, position: { x: number; y: number }) =>
      activateFlowImageGenerate(commandPort, tabId, position.x, position.y),
  } as unknown as FlowImageGenerateOncePort;

  const generate = createFlowImageGenerateOnce({
    repositories,
    port,
    fillPrompt: async (expectedSource) => {
      const editor = page.locator(
        'flow-base-prompt-box [contenteditable="true"][role="textbox"]',
      );
      await editor.focus();
      await page.keyboard.insertText(expectedSource);
      const actual = await editor.innerText();
      const matches = actual === expectedSource;
      return {
        fillVerified: matches,
        settledMatch: matches,
        stableReadback: matches,
        inputMethod: matches ? "CDP Input.insertText" : "none",
        outcome: matches ? "filled" : "readback-mismatch",
        code: matches ? "fill_verified" : "readback_mismatch",
      };
    },
    now: () => 1_100,
    createAttemptId: () => "local-browser-attempt",
  });

  return {
    generate,
    repositories,
    mouseEvents,
    payload: {
      workspaceId: "default",
      promptHash: await sha256Hex(saved.items[0]!.rawJsonBody),
      settingsConfirmation,
    },
  };
}

test.describe("P04.2 local browser Flow fixtures only", () => {
  test("contenteditable composer preserves exact text and uniquely binds Generate", async ({
    page,
  }) => {
    await installImageComposer(page);
    const editor = page.locator(
      'flow-base-prompt-box [contenteditable="true"][role="textbox"]',
    );
    await editor.focus();
    await page.keyboard.insertText(source);

    expect(await inspectLocalComposer(page, source)).toMatchObject({
      composer: "identified",
      exactPrompt: true,
      actualCodeUnits: source.length,
      generate: "identified",
      observation: "ready",
      baseline: { regionLabel: "Generated results", mediaCount: 1 },
    });
    expect(await inspectSemanticGenerateButton(page)).toBe("Generate");

    await page
      .locator('flow-base-prompt-box button[aria-label="Generate"]')
      .evaluate((button) => button.after(button.cloneNode(true)));
    expect(await inspectLocalComposer(page, source)).toMatchObject({
      composer: "identified",
      exactPrompt: true,
      generate: "ambiguous",
    });
    expect(await inspectSemanticGenerateButton(page)).toBeNull();
  });

  test("successful local preflight permits exactly one activation pair", async ({
    page,
  }) => {
    const fixture = await createLocalAttempt(page);

    const result = await fixture.generate(fixture.payload);

    expect(result).toMatchObject({ state: "dispatched", activationCount: 1 });
    expect(fixture.mouseEvents).toEqual(["mousePressed", "mouseReleased"]);
  });

  test("failed local preflight permits zero Generate activation", async ({
    page,
  }) => {
    const fixture = await createLocalAttempt(page);
    await page
      .locator("section[aria-label='Generated results']")
      .evaluate((node) => {
        (node as HTMLElement).style.display = "none";
      });

    const result = await fixture.generate(fixture.payload);

    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      code: "observation_missing",
      activationCount: 0,
    });
    expect(fixture.mouseEvents).toEqual([]);
  });

  test("ambiguous semantic Generate controls block before dispatch", async ({
    page,
  }) => {
    const fixture = await createLocalAttempt(page);
    await page
      .locator('flow-base-prompt-box button[aria-label="Generate"]')
      .evaluate((button) => button.after(button.cloneNode(true)));

    const result = await fixture.generate(fixture.payload);

    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      code: "generate_ambiguous",
      activationCount: 0,
    });
    expect(fixture.mouseEvents).toEqual([]);
  });

  test("repeated activation requests do not duplicate submission", async ({
    page,
  }) => {
    const fixture = await createLocalAttempt(page);
    expect((await fixture.generate(fixture.payload)).state).toBe("dispatched");

    const repeated = await fixture.generate(fixture.payload);

    expect(repeated.code).toBe("attempt_already_active");
    expect(fixture.mouseEvents).toEqual(["mousePressed", "mouseReleased"]);
  });

  test("partial dispatch remains uncertain and is not automatically replayed", async ({
    page,
  }) => {
    const fixture = await createLocalAttempt(page, { failRelease: true });

    const first = await fixture.generate(fixture.payload);
    const repeated = await fixture.generate(fixture.payload);

    expect(first.state).toBe("uncertain");
    expect(repeated.code).toBe("attempt_already_active");
    expect(fixture.mouseEvents).toEqual(["mousePressed", "mouseReleased"]);
    expect(
      (await fixture.repositories.getAllFlowImageAttempts())[0]?.state,
    ).toBe("uncertain");
  });
});
