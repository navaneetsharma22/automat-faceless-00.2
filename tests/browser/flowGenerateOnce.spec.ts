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
import { setLocalFlowFixture } from "./flowFixturePage";

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
  documentId: "local-document-1",
  senderFrameId: 0,
  url: selectedTab.url,
};
const settingsConfirmation: FlowSettingsConfirmation = {
  confirmationId: "local-confirmation-1",
  confirmedAt: 1_000,
  tabId: selectedTab.id,
  projectId: selectedTab.projectId,
  canonicalTarget: selectedTab.canonicalTarget,
  declaredVariantCount: 2,
};

async function installImageComposer(
  page: Page,
  actionName = "Start generation",
) {
  await setLocalFlowFixture(page, await readFile(observedFixturePath, "utf8"));
  await page.evaluate((actionName) => {
    const results = document.createElement("main");
    results.innerHTML =
      '<section role="region" aria-label="Generated results"><img alt="Existing local fixture result" /></section>';
    document.querySelector("flow-project-page")?.prepend(results);
    const submit = document.querySelector(
      "flow-base-prompt-box button:last-of-type",
    );
    submit?.setAttribute("aria-label", actionName);
  }, actionName);
  await page.addStyleTag({
    content:
      "body{font:16px sans-serif}main,section{display:block;min-height:40px}img{width:20px;height:20px}flow-base-prompt-box,flow-rich-text-editor{display:block}[contenteditable]{display:block;min-height:80px;white-space:pre-wrap}button,input[type=submit]{display:block}",
  });
}

async function installObservedEmptyWorkspace(page: Page) {
  await setLocalFlowFixture(page, await readFile(observedFixturePath, "utf8"));
  await page.evaluate(() => {
    const composer = document.querySelector("flow-base-prompt-box");
    if (!composer) throw new Error("fixture_composer_missing");
    const workspace = document.createElement("flow-project-page");
    const marker = document.createElement("div");
    marker.id = "empty-marker";
    const icon = document.createElement("mat-icon");
    icon.textContent = "add";
    const phrase = document.createElement("span");
    phrase.textContent = "Start creating or drop media";
    marker.append(icon, phrase);
    workspace.append(marker, composer);
    document.body.replaceChildren(workspace);
    const hiddenImage = document.createElement("img");
    hiddenImage.style.display = "none";
    const hiddenVideo = document.createElement("video");
    hiddenVideo.style.display = "none";
    workspace.append(hiddenImage, hiddenVideo);
  });
  await page.addStyleTag({
    content:
      "body{font:16px sans-serif}flow-project-page,flow-base-prompt-box,flow-rich-text-editor,mat-icon,section{display:block;min-height:40px}[contenteditable]{display:block;min-height:80px;white-space:pre-wrap}button,input[type=submit]{display:block}",
  });
}

function sameBaseline(
  first: NonNullable<FlowGenerateDiscovery["baseline"]>,
  second: NonNullable<FlowGenerateDiscovery["baseline"]>,
) {
  if ("kind" in first || "kind" in second) {
    return (
      "kind" in first &&
      "kind" in second &&
      first.kind === second.kind &&
      first.workspaceTag === second.workspaceTag &&
      first.markerPhrase === second.markerPhrase &&
      first.markerCount === second.markerCount &&
      first.visibleMediaCount === second.visibleMediaCount &&
      first.visibleResultCardCount === second.visibleResultCardCount &&
      first.loadingMarkerCount === second.loadingMarkerCount
    );
  }
  return (
    first.regionLabel === second.regionLabel &&
    first.mediaCount === second.mediaCount
  );
}

async function inspectLocalComposer(page: Page, expected: string) {
  return page.evaluate(
    (expression) => (0, eval)(expression),
    flowImageRuntimeExpression(expected),
  ) as Promise<FlowGenerateDiscovery>;
}

async function fillFixturePrompt(page: Page) {
  const editor = page.locator(
    'flow-base-prompt-box [contenteditable="true"][role="textbox"]',
  );
  await editor.focus();
  await page.keyboard.insertText(source);
}

async function inspectSemanticGenerateButton(page: Page) {
  const expression = flowImageRuntimeExpression(source, "button");
  return page.evaluate(async (runtime) => {
    const button = (await (0, eval)(runtime)) as HTMLElement | null;
    return button?.getAttribute("aria-label") ?? null;
  }, expression);
}

async function createLocalAttempt(
  page: Page,
  options: {
    failRelease?: boolean;
    emptyWorkspace?: boolean;
    mutateDuringRecheck?: "remove" | "change";
  } = {},
) {
  Object.defineProperty(globalThis, "__AUTOMAT_BUILD_ID__", {
    value: "local-p04-2-fixture",
    configurable: true,
  });
  const { createFlowImageGenerateOnce } =
    await import("../../src/background/handlers/flow");
  if (options.emptyWorkspace) await installObservedEmptyWorkspace(page);
  else await installImageComposer(page);
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
  let mutationInjected = false;
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
      let discovery: FlowGenerateDiscovery;
      if (options.mutateDuringRecheck && !mutationInjected) {
        mutationInjected = true;
        discovery = await page.evaluate(
          ({ expression, mutation }) => {
            const pending = (0, eval)(
              expression,
            ) as Promise<FlowGenerateDiscovery>;
            requestAnimationFrame(() => {
              const marker = document.querySelector("#empty-marker");
              if (mutation === "remove") marker?.remove();
              else {
                const phrase = marker?.querySelector("span");
                if (phrase) phrase.textContent = "Workspace changed";
              }
            });
            return pending;
          },
          {
            expression: flowImageRuntimeExpression(expected),
            mutation: options.mutateDuringRecheck,
          },
        );
      } else {
        discovery = await inspectLocalComposer(page, expected);
      }
      return (
        expectedFrame.frameId === frame.frameId &&
        expectedFrame.loaderId === frame.loaderId &&
        buttonId === "local-generate-button" &&
        discovery.composer === "identified" &&
        discovery.exactPrompt &&
        discovery.generate === "identified" &&
        discovery.observation === "ready" &&
        discovery.baseline !== undefined &&
        sameBaseline(discovery.baseline, baseline)
      );
    },
    startObservation: async (_tabId: number, binding: unknown) => ({
      status: "started",
      receipt: {
        capturedAt: 1_100,
        sourceBaselineFingerprint: (
          binding as { sourceBaselineFingerprint: string }
        ).sourceBaselineFingerprint,
        captureFingerprint: "c".repeat(64),
        listenerRootCount: 1,
        baseline: {
          completeForRenderedScope: true,
          virtualized: false,
          tileCount: 0,
          mediaCandidateCount: 0,
          identityCandidateCount: 0,
          identityCandidatesTruncated: false,
          unidentifiedImageCount: 0,
          lifecycleSignalCount: 0,
          resourceEventCount: 0,
          captureGaps: [],
          candidateIds: [],
          tileTokens: [],
          candidateTileRelationships: [],
        },
      },
    }),
    activateObservation: async () => "started",
    stopObservation: async () => undefined,
    buttonPosition: async (_tabId: number, buttonId: string) => {
      const buttons = page.locator(
        'flow-base-prompt-box button[aria-label="Start generation"]',
      );
      return buttonId === "local-generate-button" &&
        (await buttons.count()) === 1
        ? { x: 10, y: 10 }
        : undefined;
    },
    activate: (tabId: number, position: { x: number; y: number }) =>
      activateFlowImageGenerate(commandPort, tabId, position.x, position.y),
    productionObservationSupported: true,
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
      countMode: options.emptyWorkspace
        ? {
            mode: "new_empty_project" as const,
            countSessionId: "b317581d-9fe5-49bc-87c2-bd4e516a0db8",
            startingImageCount: 0 as const,
          }
        : {
            mode: "existing_project" as const,
            countSessionId: "b317581d-9fe5-49bc-87c2-bd4e516a0db9",
            startingImageCount: 1,
            userConfirmed: true as const,
          },
    },
  };
}

test.describe("P04.3 local browser Flow fixtures only", () => {
  test("observed span and div marker form one stable empty workspace baseline", async ({
    page,
  }) => {
    await installObservedEmptyWorkspace(page);
    await fillFixturePrompt(page);

    const discovery = await inspectLocalComposer(page, source);

    expect(discovery).toMatchObject({
      composer: "identified",
      exactPrompt: true,
      generate: "identified",
      observation: "ready",
      baseline: {
        kind: "flow_empty_workspace_ui",
        workspaceTag: "flow-project-page",
        markerPhrase: "Start creating or drop media",
        markerCount: 1,
        visibleMediaCount: 0,
        visibleResultCardCount: 0,
        loadingMarkerCount: 0,
      },
    });
    expect(
      await page.locator("flow-project-page > #empty-marker").count(),
    ).toBe(1);
  });

  test("independent empty markers are ambiguous and block activation", async ({
    page,
  }) => {
    const fixture = await createLocalAttempt(page, { emptyWorkspace: true });
    await page
      .locator("#empty-marker")
      .evaluate((marker) => marker.after(marker.cloneNode(true)));

    const result = await fixture.generate(fixture.payload);

    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      code: "observation_ambiguous",
      activationCount: 0,
    });
    expect(fixture.mouseEvents).toEqual([]);
  });

  test("marker owned by a different project page cannot establish baseline", async ({
    page,
  }) => {
    await installObservedEmptyWorkspace(page);
    await page.evaluate(() => {
      const marker = document.querySelector("#empty-marker");
      const otherProject = document.createElement("flow-project-page");
      otherProject.append(marker!);
      document.body.append(otherProject);
    });
    await fillFixturePrompt(page);

    const discovery = await inspectLocalComposer(page, source);
    expect(discovery).toMatchObject({
      observation: "missing",
    });
    expect(discovery.baseline).toBeUndefined();
  });

  test("hidden phrase marker is not accepted as an empty baseline", async ({
    page,
  }) => {
    await installObservedEmptyWorkspace(page);
    await page.locator("#empty-marker").evaluate((marker) => {
      (marker as HTMLElement).style.display = "none";
    });
    await fillFixturePrompt(page);

    const discovery = await inspectLocalComposer(page, source);
    expect(discovery).toMatchObject({
      observation: "missing",
    });
    expect(discovery.baseline).toBeUndefined();
  });

  test("visible loading state blocks readiness while reporting the marker baseline", async ({
    page,
  }) => {
    await installObservedEmptyWorkspace(page);
    await page.evaluate(() => {
      const loading = document.createElement("div");
      loading.setAttribute("data-state", "loading");
      loading.style.cssText = "display:block;min-height:40px";
      document.querySelector("flow-project-page")?.append(loading);
    });
    await fillFixturePrompt(page);

    const discovery = await inspectLocalComposer(page, source);
    expect(discovery).toMatchObject({
      observation: "unsupported",
    });
    expect(discovery.baseline).toMatchObject({
      kind: "flow_empty_workspace_ui",
      markerCount: 1,
    });
  });

  test("conflicting visible results surface blocks empty baseline", async ({
    page,
  }) => {
    await installObservedEmptyWorkspace(page);
    await page.evaluate(() => {
      const results = document.createElement("section");
      results.setAttribute("role", "region");
      results.setAttribute("aria-label", "Generated results");
      results.style.cssText = "display:block;min-height:40px";
      document.querySelector("flow-project-page")?.append(results);
    });
    await fillFixturePrompt(page);

    const discovery = await inspectLocalComposer(page, source);
    expect(discovery).toMatchObject({
      observation: "ambiguous",
    });
    expect(discovery.baseline).toMatchObject({
      kind: "flow_empty_workspace_ui",
      markerCount: 1,
    });
  });

  test("hidden unowned media do not become generated results", async ({
    page,
  }) => {
    await installObservedEmptyWorkspace(page);
    await fillFixturePrompt(page);

    expect(await inspectLocalComposer(page, source)).toMatchObject({
      observation: "ready",
      baseline: {
        kind: "flow_empty_workspace_ui",
        visibleMediaCount: 0,
        visibleResultCardCount: 0,
      },
    });
  });

  test("positive empty UI baseline is durable and remains duplicate-blocked", async ({
    page,
  }) => {
    const fixture = await createLocalAttempt(page, { emptyWorkspace: true });

    const first = await fixture.generate(fixture.payload);
    const attempt = (await fixture.repositories.getAllFlowImageAttempts())[0];
    const repeated = await fixture.generate(fixture.payload);

    expect(first).toMatchObject({ state: "dispatched", activationCount: 1 });
    expect(first.message).toContain(
      "Provider acceptance and results are not verified",
    );
    expect(attempt?.baseline).toMatchObject({
      kind: "flow_empty_workspace_ui",
      workspaceTag: "flow-project-page",
      markerCount: 1,
      visibleMediaCount: 0,
      visibleResultCardCount: 0,
      loadingMarkerCount: 0,
    });
    expect(repeated.code).toBe("attempt_already_active");
    expect(fixture.mouseEvents).toEqual(["mousePressed", "mouseReleased"]);
  });

  for (const mutation of ["remove", "change"] as const) {
    test(`marker ${mutation} during final baseline preflight blocks activation`, async ({
      page,
    }) => {
      const fixture = await createLocalAttempt(page, {
        emptyWorkspace: true,
        mutateDuringRecheck: mutation,
      });

      const result = await fixture.generate(fixture.payload);

      expect(result).toMatchObject({
        state: "failed-before-dispatch",
        activationCount: 0,
      });
      expect([
        "final_preflight_changed",
        "post_intent_preflight_changed",
      ]).toContain(result.code);
      expect(fixture.mouseEvents).toEqual([]);
    });
  }

  test("observed four-control composer uniquely binds Start generation", async ({
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
    expect(
      await page
        .locator(
          'flow-base-prompt-box button, flow-base-prompt-box [role="button"]',
        )
        .count(),
    ).toBe(4);
    expect(
      await page.locator('flow-base-prompt-box button[type="submit"]').count(),
    ).toBe(1);
    expect(
      await page
        .locator('flow-base-prompt-box input[type="submit"][role="button"]')
        .count(),
    ).toBe(1);
    expect(await inspectSemanticGenerateButton(page)).toBe("Start generation");

    await page
      .locator('flow-base-prompt-box button[aria-label="Start generation"]')
      .evaluate((button) => button.after(button.cloneNode(true)));
    expect(await inspectLocalComposer(page, source)).toMatchObject({
      composer: "identified",
      exactPrompt: true,
      generate: "ambiguous",
    });
    expect(await inspectSemanticGenerateButton(page)).toBeNull();
  });

  test("same Start generation label outside the verified composer is ignored", async ({
    page,
  }) => {
    await installImageComposer(page);
    await page.evaluate(() => {
      const outside = document.createElement("button");
      outside.setAttribute("aria-label", "Start generation");
      outside.textContent = "Start generation";
      document.body.append(outside);
    });

    expect(await inspectLocalComposer(page, source)).toMatchObject({
      composer: "identified",
      generate: "identified",
    });
    expect(await inspectSemanticGenerateButton(page)).toBe("Start generation");
  });

  test("hidden and disabled Start generation controls are rejected", async ({
    page,
  }) => {
    for (const state of ["hidden", "disabled"] as const) {
      await installImageComposer(page);
      await page
        .locator('flow-base-prompt-box button[aria-label="Start generation"]')
        .evaluate((button, controlState) => {
          if (controlState === "hidden") {
            (button as HTMLElement).style.display = "none";
          } else {
            (button as HTMLButtonElement).disabled = true;
          }
        }, state);

      expect(await inspectLocalComposer(page, source)).toMatchObject({
        composer: "identified",
        generate: "disabled",
      });
      expect(await inspectSemanticGenerateButton(page)).toBeNull();
    }
  });

  test("longer misleading action labels do not match", async ({ page }) => {
    for (const label of ["Start generation now", "Do not Start generation"]) {
      await installImageComposer(page, label);

      expect(await inspectLocalComposer(page, source)).toMatchObject({
        composer: "identified",
        generate: "missing",
      });
      expect(await inspectSemanticGenerateButton(page)).toBeNull();
    }
  });

  test("existing exact Generate action names remain supported", async ({
    page,
  }) => {
    for (const label of ["Generate", "Generate image", "Create image"]) {
      await installImageComposer(page, label);

      expect(await inspectLocalComposer(page, source)).toMatchObject({
        composer: "identified",
        generate: "identified",
      });
      expect(await inspectSemanticGenerateButton(page)).toBe(label);
    }
  });

  test("successful local preflight permits exactly one activation pair", async ({
    page,
  }) => {
    const fixture = await createLocalAttempt(page, { emptyWorkspace: true });

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
      code: "composer_unsupported",
      activationCount: 0,
    });
    expect(fixture.mouseEvents).toEqual([]);
  });

  test("ambiguous semantic Generate controls block before dispatch", async ({
    page,
  }) => {
    const fixture = await createLocalAttempt(page);
    await page
      .locator('flow-base-prompt-box button[aria-label="Start generation"]')
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
    const fixture = await createLocalAttempt(page, { emptyWorkspace: true });
    expect((await fixture.generate(fixture.payload)).state).toBe("dispatched");

    const repeated = await fixture.generate(fixture.payload);

    expect(repeated.code).toBe("attempt_already_active");
    expect(fixture.mouseEvents).toEqual(["mousePressed", "mouseReleased"]);
  });

  test("partial dispatch remains uncertain and is not automatically replayed", async ({
    page,
  }) => {
    const fixture = await createLocalAttempt(page, {
      emptyWorkspace: true,
      failRelease: true,
    });

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
