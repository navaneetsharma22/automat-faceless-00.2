import { describe, expect, it } from "vitest";
import {
  enterFlowPrompt,
  type FlowPromptEntryPort,
} from "../../src/platforms/flow/promptEntry";
import type { ProviderTab } from "../../src/platforms/shared/contracts";

const prompt = JSON.stringify({
  shot_id: "01",
  prompt_type: "image",
  value: [1.25, 2.5],
  note: 'धुंध 🦖 "quoted" \\path',
});
const selectedTab: ProviderTab = {
  id: 42,
  title: "Flow test fixture",
  url: "https://flow.google.com/u/1/project/project_01?pli=1",
  provider: "Flow",
  projectId: "project_01",
  canonicalTarget: "https://flow.google.com/u/1/project/project_01",
};
const frameTree = {
  frameTree: {
    frame: {
      id: "frame-top",
      loaderId: "loader-one",
      url: selectedTab.url,
    },
  },
};

function makePort(
  options: {
    tab?: ProviderTab | undefined;
    permission?: boolean;
    apis?: boolean;
    state?: string;
    initialText?: string;
    replacement?: boolean;
    inputError?: boolean;
  } = {},
) {
  let actualText = options.initialText ?? "";
  let inputCount = 0;
  let detachCount = 0;
  const commands: string[] = [];
  const port: FlowPromptEntryPort = {
    getSelection: async () => ({
      tabId: selectedTab.id,
      canonicalTarget: selectedTab.canonicalTarget,
    }),
    getTab: async () => options.tab ?? selectedTab,
    hasRequiredApis: () => options.apis ?? true,
    hasDebuggerPermission: async () => options.permission ?? true,
    attach: async () => undefined,
    detach: async () => {
      detachCount += 1;
    },
    sendCommand: async (_tabId, method, params) => {
      commands.push(method);
      if (method === "Page.enable" || method === "Runtime.enable") return {};
      if (method === "Page.getFrameTree") return frameTree;
      if (method === "Runtime.evaluate") {
        if ((params as { returnByValue?: boolean }).returnByValue === false) {
          return { result: { objectId: "editor-node", subtype: "node" } };
        }
        return {
          result: {
            value: {
              state: options.state ?? "empty",
              candidateCount: options.state === "ambiguous" ? 2 : 1,
              editorKind: "contenteditable",
              methodCompatible: true,
            },
          },
        };
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = (params as { functionDeclaration: string })
          .functionDeclaration;
        if (declaration.includes("this.focus()")) {
          return { result: { value: true } };
        }
        if (
          options.replacement &&
          commands.filter((c) => c === method).length === 1
        ) {
          return { result: { value: { connected: false, text: "" } } };
        }
        return { result: { value: { connected: true, text: actualText } } };
      }
      if (method === "Input.insertText") {
        inputCount += 1;
        if (options.inputError) {
          actualText = prompt.slice(0, 12);
          throw new Error("CDP command result uncertain");
        }
        actualText = (params as { text: string }).text;
        return {};
      }
      throw new Error(`Unexpected command ${method}`);
    },
  };
  return {
    port,
    commands,
    get inputCount() {
      return inputCount;
    },
    get detachCount() {
      return detachCount;
    },
  };
}

describe("bounded Flow prompt entry", () => {
  it("blocks before input when the selected project changed", async () => {
    const other: ProviderTab = {
      ...selectedTab,
      projectId: "another-project",
      url: "https://flow.google.com/u/1/project/another-project",
      canonicalTarget: "https://flow.google.com/u/1/project/another-project",
    };
    const fixture = makePort({ tab: other });
    const result = await enterFlowPrompt(prompt, fixture.port);
    expect(result.code).toBe("flow_target_changed");
    expect(result.inputMethod).toBe("none");
    expect(fixture.inputCount).toBe(0);
  });

  it("blocks before input if debugger permission is missing", async () => {
    const fixture = makePort({ permission: false });
    const result = await enterFlowPrompt(prompt, fixture.port);
    expect(result.code).toBe("debugger_permission_missing");
    expect(fixture.inputCount).toBe(0);
    expect(fixture.detachCount).toBe(0);
  });

  it("does not input into a missing or ambiguous composer", async () => {
    const fixture = makePort({ state: "ambiguous" });
    const result = await enterFlowPrompt(prompt, fixture.port);
    expect(result.composer).toBe("ambiguous");
    expect(fixture.inputCount).toBe(0);
    expect(fixture.detachCount).toBe(1);
    expect(fixture.commands).not.toContain("Input.insertText");
  });

  it("does not clear or replace existing different text", async () => {
    const fixture = makePort({ state: "conflict", initialText: "keep this" });
    const result = await enterFlowPrompt(prompt, fixture.port);
    expect(result.code).toBe("editor_has_different_text");
    expect(fixture.inputCount).toBe(0);
    expect(fixture.commands).not.toContain("Input.insertText");
  });

  it("uses one CDP text insertion and reports exact settled readback", async () => {
    const fixture = makePort();
    const result = await enterFlowPrompt(prompt, fixture.port);
    expect(result.outcome).toBe("filled");
    expect(result.fillVerified).toBe(true);
    expect(result.inputMethod).toBe("CDP Input.insertText");
    expect(result.expectedCodeUnits).toBe(prompt.length);
    expect(result.actualCodeUnits).toBe(prompt.length);
    expect(result.immediateMatch).toBe(true);
    expect(result.settledMatch).toBe(true);
    expect(result.generationAvailable).toBe(false);
    expect(fixture.inputCount).toBe(1);
    expect(fixture.commands).not.toContain("Input.dispatchKeyEvent");
    expect(fixture.commands).not.toContain("Page.captureScreenshot");
    expect(fixture.detachCount).toBe(1);
  });

  it("does not retry after uncertain partial insertion", async () => {
    const fixture = makePort({ inputError: true });
    const result = await enterFlowPrompt(prompt, fixture.port);
    expect(result.outcome).toBe("input-uncertain");
    expect(result.inputMethod).toBe("CDP Input.insertText");
    expect(result.actualCodeUnits).toBe(12);
    expect(fixture.inputCount).toBe(1);
    expect(
      fixture.commands.filter((command) => command === "Input.insertText"),
    ).toHaveLength(1);
    expect(fixture.commands).not.toContain("Input.dispatchKeyEvent");
  });

  it("does not insert again when exact source is already in the editor", async () => {
    const fixture = makePort({
      state: "already-matching",
      initialText: prompt,
    });
    const result = await enterFlowPrompt(prompt, fixture.port);
    expect(result.outcome).toBe("already-matching");
    expect(result.fillVerified).toBe(true);
    expect(result.inputMethod).toBe("none");
    expect(fixture.inputCount).toBe(0);
  });
});
