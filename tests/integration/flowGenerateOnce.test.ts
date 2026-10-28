import { describe, expect, it } from "vitest";
import { createFlowImageGenerateOnce } from "../../src/background/handlers/flow";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import {
  flowImageAttemptActiveKey,
  type FlowImageAttemptRecord,
  type FlowImageAttemptState,
} from "../../src/domain/jobs/attempt";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { activateFlowImageGenerate } from "../../src/platforms/flow/images";
import type { FlowPromptEntryPort } from "../../src/platforms/flow/promptEntry";
import { createFoundationClient } from "../../src/shared/messageClient";
import type { FlowSettingsConfirmation } from "../../src/shared/schemas";
import {
  ChromePreferenceRepository,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import type { ProviderTab } from "../../src/platforms/shared/contracts";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";

const prompt =
  '{\r\n  "shot_id": "01",\r\n  "scene": "SYNTHETIC test image"\r\n}';
const selectedTab: ProviderTab = {
  id: 41,
  title: "Flow local fixture",
  url: "https://flow.google.com/u/1/project/project_01?pli=1",
  provider: "Flow",
  projectId: "project_01",
  canonicalTarget: "https://flow.google.com/u/1/project/project_01",
};
const frame = {
  frameId: "top-frame-1",
  loaderId: "loader-1",
  url: selectedTab.url,
};
const settingsConfirmation: FlowSettingsConfirmation = {
  confirmationId: "confirm-1",
  confirmedAt: 1_000,
  tabId: selectedTab.id,
  projectId: selectedTab.projectId,
};

function discovery(
  overrides: Partial<{
    composer: "identified" | "missing" | "ambiguous" | "unsupported";
    exactPrompt: boolean;
    generate: "identified" | "missing" | "ambiguous" | "disabled";
    observation: "ready" | "missing" | "ambiguous";
  }> = {},
) {
  return {
    composer: "identified" as const,
    exactPrompt: true,
    actualCodeUnits: prompt.length,
    generate: "identified" as const,
    observation: "ready" as const,
    baseline: {
      regionLabel: "Generated results",
      mediaCount: 2,
      capturedAt: 1_010,
    },
    buttonObjectId: "generate-button",
    generationAvailable: false as const,
    ...overrides,
  };
}

function makePort(
  options: {
    permission?: boolean;
    target?: ProviderTab;
    selection?: { tabId: number; canonicalTarget: string };
    frame?: typeof frame;
    generated?: ReturnType<typeof discovery>;
    recheck?: boolean;
    position?: { x: number; y: number } | undefined;
    activation?: {
      complete: boolean;
      pressAttempted: boolean;
      releaseAttempted: boolean;
    };
  } = {},
) {
  const selected = options.selection ?? {
    tabId: selectedTab.id,
    canonicalTarget: selectedTab.canonicalTarget,
  };
  const tab = options.target ?? selectedTab;
  const liveFrame = options.frame ?? frame;
  const calls: string[] = [];
  let activations = 0;
  const port = {
    getSelection: async () => selected,
    getTab: async () => tab,
    hasRequiredApis: () => true,
    hasDebuggerPermission: async () => options.permission ?? true,
    attach: async () => undefined,
    detach: async () => undefined,
    sendCommand: async (_tabId: number, method: string) => {
      calls.push(method);
      return {};
    },
    captureFrame: async () => liveFrame,
    readFrame: async () => liveFrame,
    inspectGenerate: async () => options.generated ?? discovery(),
    recheckGenerate: async () => options.recheck ?? true,
    buttonPosition: async () => options.position ?? { x: 10, y: 20 },
    activate: async () => {
      activations += 1;
      return (
        options.activation ?? {
          complete: true,
          pressAttempted: true,
          releaseAttempted: true,
        }
      );
    },
  } as unknown as FlowPromptEntryPort & {
    captureFrame: () => Promise<typeof frame>;
    readFrame: () => Promise<typeof frame>;
    inspectGenerate: () => Promise<ReturnType<typeof discovery>>;
    recheckGenerate: () => Promise<boolean>;
    buttonPosition: () => Promise<{ x: number; y: number } | undefined>;
    activate: () => Promise<{
      complete: boolean;
      pressAttempted: boolean;
      releaseAttempted: boolean;
    }>;
  };
  return {
    port,
    calls,
    get activations() {
      return activations;
    },
  };
}

async function setup(options: Parameters<typeof makePort>[0] = {}) {
  const repositories = new ExtensionRepositories(
    createMemoryRepositoryDatabase(),
    () => 1_100,
  );
  const saved = await repositories.savePromptBatch({
    workspaceId: "default",
    kind: "image",
    sourceText: prompt,
  });
  await repositories.recordSelectedTarget({
    provider: "Flow",
    tabId: selectedTab.id,
    canonicalTarget: selectedTab.canonicalTarget,
  });
  const fixture = makePort(options);
  let id = 0;
  const fillCalls: Array<{ sourceText: string; expectedFrame: unknown }> = [];
  const fillPrompt = async (sourceText: string, expectedFrame: unknown) => {
    fillCalls.push({ sourceText, expectedFrame });
    return {
      fillVerified: true,
      settledMatch: true,
      stableReadback: true,
      inputMethod: "CDP Input.insertText" as const,
      outcome: "filled",
      code: "fill_verified",
    };
  };
  const generate = createFlowImageGenerateOnce({
    repositories,
    port: fixture.port as never,
    fillPrompt,
    now: () => 1_100,
    createAttemptId: () => `attempt-${++id}`,
  });
  const preferences = new ChromePreferenceRepository({
    get: async () => ({}),
    set: async () => undefined,
  });
  const listener = createConnectionMessageListener("test-extension", {
    repositories,
    preferences,
    flowImageGenerateOnce: generate,
  });
  const client = createFoundationClient({
    sendMessage: (request) =>
      new Promise((resolve) =>
        listener(
          request,
          {
            id: "test-extension",
            url: "chrome-extension://test-extension/index.html",
          },
          resolve,
        ),
      ),
  });
  const payload = {
    workspaceId: "default",
    promptHash: await sha256Hex(prompt),
    settingsConfirmation,
  };
  return {
    repositories,
    saved,
    fixture,
    fillCalls,
    generate,
    client,
    payload,
  };
}

describe("P04.2 durable Flow image Generate attempt", () => {
  it("persists context, verifies exact fill, and dispatches one mouse pair", async () => {
    const test = await setup();
    const result = (await test.client.request(
      "flow.image.generateOnce",
      test.payload,
    )) as { state: string; activationCount: number; attemptId: string };
    const attempts = await test.repositories.getAllFlowImageAttempts();
    expect(result).toMatchObject({
      state: "dispatched",
      activationCount: 1,
      attemptId: "attempt-1",
    });
    expect(test.fixture.activations).toBe(1);
    expect(test.fillCalls).toHaveLength(1);
    expect(test.fillCalls[0]?.sourceText).toBe(prompt);
    expect(test.fillCalls[0]?.expectedFrame).toMatchObject({
      frameId: frame.frameId,
      loaderId: frame.loaderId,
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      workspaceId: "default",
      batchId: test.saved.batch.id,
      itemId: test.saved.items[0]?.id,
      shotId: "1",
      promptHash: await sha256Hex(prompt),
      projectId: "project_01",
      tabId: selectedTab.id,
      frameId: frame.frameId,
      loaderId: frame.loaderId,
      state: "dispatched",
      settingsConfirmation: { userAttested: true, projectId: "project_01" },
      baseline: { regionLabel: "Generated results", mediaCount: 2 },
    });
    expect("prompt" in attempts[0]!).toBe(false);
    expect(
      (await test.repositories.getPromptBatch("default", "image"))?.items[0]
        ?.rawJsonBody,
    ).toBe(prompt);
  });

  it("sends one CDP press/release pair and never repeats a failed press", async () => {
    const commands: Array<{ method: string; type?: string }> = [];
    const port = {
      attach: async () => undefined,
      detach: async () => undefined,
      sendCommand: async (
        _tabId: number,
        method: string,
        params?: { type?: string },
      ) => {
        commands.push({ method, type: params?.type });
        return {};
      },
    } as unknown as FlowPromptEntryPort;
    const complete = await activateFlowImageGenerate(
      port,
      selectedTab.id,
      10,
      20,
    );
    expect(complete).toEqual({
      complete: true,
      pressAttempted: true,
      releaseAttempted: true,
    });
    expect(commands).toEqual([
      { method: "Input.dispatchMouseEvent", type: "mousePressed" },
      { method: "Input.dispatchMouseEvent", type: "mouseReleased" },
    ]);

    commands.length = 0;
    const failingPort = {
      ...port,
      sendCommand: async (
        _tabId: number,
        method: string,
        params?: { type?: string },
      ) => {
        commands.push({ method, type: params?.type });
        if (params?.type === "mousePressed") throw new Error("unknown result");
        return {};
      },
    } as unknown as FlowPromptEntryPort;
    const partial = await activateFlowImageGenerate(
      failingPort,
      selectedTab.id,
      10,
      20,
    );
    expect(partial).toEqual({
      complete: false,
      pressAttempted: true,
      releaseAttempted: true,
    });
    expect(commands.map((command) => command.type)).toEqual([
      "mousePressed",
      "mouseReleased",
    ]);
  });

  it("blocks concurrent clicks durably across distinct request IDs", async () => {
    const test = await setup();
    let releaseFill!: () => void;
    const pendingFill = new Promise<void>((resolve) => {
      releaseFill = resolve;
    });
    test.generate = createFlowImageGenerateOnce({
      repositories: test.repositories,
      port: test.fixture.port as never,
      fillPrompt: async () => {
        await pendingFill;
        return {
          fillVerified: true,
          settledMatch: true,
          stableReadback: true,
          inputMethod: "CDP Input.insertText",
          outcome: "filled",
          code: "fill_verified",
        };
      },
      now: () => 1_100,
      createAttemptId: () => "concurrent-attempt",
    });
    const first = test.generate(test.payload);
    while ((await test.repositories.getAllFlowImageAttempts()).length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const second = await test.generate(test.payload);
    releaseFill();
    const firstResult = await first;
    expect(second.code).toBe("attempt_already_active");
    expect(firstResult.state).toBe("dispatched");
    expect(test.fixture.activations).toBe(1);
    expect(await test.repositories.getAllFlowImageAttempts()).toHaveLength(1);
  });

  it("requires a fresh attestation after a definite pre-dispatch failure", async () => {
    const test = await setup({ recheck: false });
    const first = await test.generate(test.payload);
    expect(first.state).toBe("failed-before-dispatch");
    expect(test.fixture.activations).toBe(0);
    const repeated = await test.generate(test.payload);
    expect(repeated.code).toBe("duplicate_generate_click");
    expect(test.fixture.activations).toBe(0);
    expect(await test.repositories.getAllFlowImageAttempts()).toHaveLength(1);
  });

  it.each([
    ["permission", { permission: false }, "debugger_permission_missing"],
    [
      "disabled Generate",
      { generated: discovery({ generate: "disabled" }) },
      "generate_disabled",
    ],
    [
      "ambiguous Generate",
      { generated: discovery({ generate: "ambiguous" }) },
      "generate_ambiguous",
    ],
    [
      "missing observation",
      { generated: discovery({ observation: "missing" }) },
      "observation_missing",
    ],
    [
      "wrong readback",
      { generated: discovery({ exactPrompt: false }) },
      "prompt_readback_mismatch",
    ],
    ["binding loss", { recheck: false }, "final_preflight_changed"],
  ] as const)("issues zero activation for %s", async (_name, options, code) => {
    const test = await setup(options);
    if (options.generated?.exactPrompt === false) {
      test.generate = createFlowImageGenerateOnce({
        repositories: test.repositories,
        port: test.fixture.port as never,
        fillPrompt: async () => ({
          fillVerified: true,
          settledMatch: true,
          stableReadback: true,
          inputMethod: "none",
          outcome: "already-matching",
          code: "already_matching_verified",
        }),
        now: () => 1_100,
        createAttemptId: () => "no-readback",
      });
    }
    const result = await test.generate(test.payload);
    expect(result.code).toBe(code);
    expect(result.activationCount).toBe(0);
    expect(test.fixture.activations).toBe(0);
  });

  it("blocks source hash, target, and settings-context changes", async () => {
    const badHash = await setup();
    expect(
      (
        await badHash.generate({
          ...badHash.payload,
          promptHash: "0".repeat(64),
        })
      ).code,
    ).toBe("saved_prompt_changed");

    const wrongTarget = await setup({
      target: {
        ...selectedTab,
        projectId: "project_02",
        canonicalTarget: "https://flow.google.com/u/1/project/project_02",
        url: "https://flow.google.com/u/1/project/project_02",
      },
    });
    expect((await wrongTarget.generate(wrongTarget.payload)).code).toBe(
      "flow_document_changed",
    );

    const wrongAttestation = await setup();
    expect(
      (
        await wrongAttestation.generate({
          ...wrongAttestation.payload,
          settingsConfirmation: {
            ...settingsConfirmation,
            projectId: "another-project",
          },
        })
      ).code,
    ).toBe("settings_confirmation_stale");
    expect(
      badHash.fixture.activations +
        wrongTarget.fixture.activations +
        wrongAttestation.fixture.activations,
    ).toBe(0);
  });

  it("preserves uncertain delivery after a partial press/release result", async () => {
    const test = await setup({
      activation: {
        complete: false,
        pressAttempted: true,
        releaseAttempted: false,
      },
    });
    const result = await test.generate(test.payload);
    expect(result).toMatchObject({
      state: "uncertain",
      activationCount: 1,
      pressAttempted: true,
      releaseAttempted: false,
    });
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "uncertain",
    );
    expect((await test.generate(test.payload)).code).toBe(
      "attempt_already_active",
    );
  });

  it("keeps dispatch intent active if post-input persistence cannot settle", async () => {
    const test = await setup();
    const transition = test.repositories.transitionFlowImageAttempt.bind(
      test.repositories,
    );
    test.repositories.transitionFlowImageAttempt = async (input) => {
      if (input.next === "dispatched" || input.next === "uncertain") {
        throw new Error("controlled storage failure");
      }
      return transition(input);
    };
    const result = await test.generate(test.payload);
    expect(result.state).toBe("uncertain");
    expect(result.activationCount).toBe(1);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "dispatch-intent",
    );
    test.repositories.transitionFlowImageAttempt = transition;
    const recovered =
      await test.repositories.reconcileInterruptedFlowImageAttempts();
    expect(recovered.uncertain).toBe(1);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "uncertain",
    );
  });

  it("marks a failed dispatch-intent write before activation", async () => {
    const test = await setup();
    const transition = test.repositories.transitionFlowImageAttempt.bind(
      test.repositories,
    );
    test.repositories.transitionFlowImageAttempt = async (input) => {
      if (input.next === "dispatch-intent")
        throw new Error("intent write failed");
      return transition(input);
    };
    const result = await test.generate(test.payload);
    expect(result.state).toBe("failed-before-dispatch");
    expect(test.fixture.activations).toBe(0);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "failed-before-dispatch",
    );
  });

  it("reconciles worker restart boundaries without replaying Generate", async () => {
    const test = await setup();
    const states: FlowImageAttemptState[] = [
      "preparing",
      "verified",
      "dispatch-intent",
      "dispatched",
      "uncertain",
    ];
    for (const [index, state] of states.entries()) {
      const at = 1_200 + index;
      const record: FlowImageAttemptRecord = {
        attemptId: `restart-${state}`,
        confirmationKey: `restart-confirm-${state}`,
        ...(state === "failed-before-dispatch"
          ? {}
          : { activeKey: flowImageAttemptActiveKey(`restart-item-${state}`) }),
        workspaceId: "default",
        batchId: "batch-restart",
        itemId: `restart-item-${state}`,
        promptHash: await sha256Hex(prompt),
        promptCodeUnits: prompt.length,
        promptUtf8Bytes: new TextEncoder().encode(prompt).byteLength,
        provider: "Flow",
        projectId: "project_01",
        tabId: selectedTab.id,
        frameId: frame.frameId,
        loaderId: frame.loaderId,
        buildId: "test-build",
        protocolVersion: 3,
        settingsConfirmation: {
          confirmationId: `restart-confirm-${state}`,
          confirmedAt: at,
          userAttested: true,
          tabId: selectedTab.id,
          projectId: "project_01",
        },
        state,
        events: [{ stage: "preparation", at, method: "none" }],
        createdAt: at,
        updatedAt: at,
      };
      await test.repositories.createFlowImageAttempt(record);
    }
    const recovery =
      await test.repositories.reconcileInterruptedFlowImageAttempts();
    expect(recovery).toEqual({ failedBeforeDispatch: 2, uncertain: 1 });
    const records = await test.repositories.getAllFlowImageAttempts();
    expect(
      records.find((a) => a.attemptId === "restart-preparing")?.state,
    ).toBe("failed-before-dispatch");
    expect(records.find((a) => a.attemptId === "restart-verified")?.state).toBe(
      "failed-before-dispatch",
    );
    expect(
      records.find((a) => a.attemptId === "restart-dispatch-intent")?.state,
    ).toBe("uncertain");
    expect(
      records.find((a) => a.attemptId === "restart-dispatched")?.state,
    ).toBe("dispatched");
    expect(
      records.find((a) => a.attemptId === "restart-uncertain")?.state,
    ).toBe("uncertain");
    expect(test.fixture.activations).toBe(0);
  });

  it("allows LF only when fill and settled readback remain exact", async () => {
    const test = await setup();
    const generate = createFlowImageGenerateOnce({
      repositories: test.repositories,
      port: test.fixture.port as never,
      fillPrompt: async () => ({
        fillVerified: false,
        settledMatch: false,
        stableReadback: true,
        inputMethod: "CDP Input.insertText",
        outcome: "readback-mismatch",
        code: "readback_mismatch",
      }),
      now: () => 1_100,
      createAttemptId: () => "lf-mismatch",
    });
    const result = await generate(test.payload);
    expect(result.state).toBe("failed-before-dispatch");
    expect(test.fixture.activations).toBe(0);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "failed-before-dispatch",
    );
    expect(
      (await test.repositories.getAllFlowImageAttempts())[0]?.events.at(-1)
        ?.method,
    ).toBe("none");
  });
});
