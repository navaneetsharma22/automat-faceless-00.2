import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FlowImageGenerateOncePort } from "../../src/background/handlers/flow";
import type { FlowImageObservationArmBinding } from "../../src/domain/jobs/results";
import type { ExtensionRepositories } from "../../src/storage/repositories";
import type { ChromePreferenceRepository } from "../../src/storage/repositories";

const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/flow/image-lifecycle-recorder.synthetic.html",
);
const fixtureUrl = "https://flow.google.com/project/synthetic-project";
const binding: FlowImageObservationArmBinding = {
  workspaceId: "default",
  batchId: "import:default:image",
  itemId: "shot-05",
  sourceHash: "a".repeat(64),
  sourceSnapshotId: "flow-image-source:shot-05:" + "a".repeat(64),
  sourceBaselineFingerprint: "b".repeat(64),
  attemptId: "attempt-production-arm-fixture",
  provider: "Flow",
  projectId: "synthetic-project",
  canonicalTarget: fixtureUrl,
  tabId: 41,
  frameId: "fixture-frame",
  loaderId: "fixture-loader",
  documentId: "fixture-document",
  senderFrameId: 0,
  sessionId: "d7a5ea61-9721-4a65-8485-798f2f4e0c11",
  startedAt: Date.now(),
  deadlineAt: Date.now() + 30_000,
  maxEvents: 12,
  buildId: "fixture-build",
  protocolVersion: 4,
};

async function installProductionArmPort(
  page: import("@playwright/test").Page,
  mode: "success" | "arm_exception",
) {
  Object.defineProperty(globalThis, "__AUTOMAT_BUILD_ID__", {
    configurable: true,
    value: "fixture-build",
  });
  const { createChromeFlowImageGenerateOncePort } =
    await import("../../src/background/handlers/flow");
  const { createConnectionMessageListener } =
    await import("../../src/background/handlers/connections");
  const { createFoundationClient } =
    await import("../../src/shared/messageClient");
  const { BUILD_ID } = await import("../../src/shared/buildInfo");
  const fixture = await readFile(fixturePath, "utf8");
  const workerListener = createConnectionMessageListener("fixture-extension", {
    repositories: {} as ExtensionRepositories,
    preferences: {} as ChromePreferenceRepository,
    ready: Promise.resolve(),
    flowImageObservation: async () => ({ accepted: true, duplicate: false }),
  });
  const workerSendMessage = async (
    request: unknown,
    sender: "dashboard" | "content",
  ) =>
    await new Promise((resolveMessage) => {
      workerListener(
        request,
        sender === "dashboard"
          ? {
              id: "fixture-extension",
              url: "chrome-extension://fixture-extension/index.html",
            }
          : {
              id: "fixture-extension",
              tab: { id: binding.tabId, url: fixtureUrl },
              frameId: binding.senderFrameId,
              documentId: binding.documentId,
            },
        resolveMessage,
      );
    });
  await page.exposeFunction("workerFixtureSendMessage", (request: unknown) =>
    workerSendMessage(request, "content"),
  );
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  await page.goto(fixtureUrl);
  await page.evaluate(() => {
    (window as Window & { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: async (message: unknown) =>
          (
            window as Window & {
              workerFixtureSendMessage: (request: unknown) => Promise<unknown>;
            }
          ).workerFixtureSendMessage(message),
      },
    };
  });
  let injectionCount = 0;
  const chromeShim = {
    scripting: {
      executeScript: async (details: {
        func: (...args: unknown[]) => unknown;
        args?: unknown[];
        target: { tabId: number; documentIds?: string[] };
      }) => {
        injectionCount += 1;
        if (mode === "arm_exception" && injectionCount === 2)
          throw new Error("synthetic internal detail must not escape");
        const result = await page.evaluate(
          async ({ source, args }) => {
            const injected = (0, eval)(`(${source})`) as (
              ...values: unknown[]
            ) => unknown;
            return await injected(...args);
          },
          { source: details.func.toString(), args: details.args ?? [] },
        );
        return [
          {
            frameId: 0,
            documentId: "fixture-document",
            result,
          },
        ];
      },
    },
  };
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: chromeShim,
  });
  const port = createChromeFlowImageGenerateOncePort(
    {} as ExtensionRepositories,
  ) as FlowImageGenerateOncePort;
  const connector = createFoundationClient(
    {
      sendMessage: (request) => workerSendMessage(request, "dashboard"),
    },
    { buildId: BUILD_ID, makeRequestId: () => "fixture-ping" },
  );
  const ping = await connector.request("foundation.ping", {});
  expect(ping).toMatchObject({ state: "ready" });
  return { port, injectionCount: () => injectionCount };
}

test("production arm port installs scope and arms against populated project DOM", async ({
  page,
}) => {
  const { port, injectionCount } = await installProductionArmPort(
    page,
    "success",
  );
  const armed = await port.startObservation(binding.tabId, binding);
  expect(typeof armed).toBe("object");
  expect(armed).toMatchObject({ status: "started" });
  if (typeof armed === "object" && armed.status === "started") {
    expect(armed.receipt.listenerRootCount).toBeGreaterThan(0);
    expect(armed.receipt.baseline).toMatchObject({
      completeForRenderedScope: true,
      virtualScrollContainerCount: 1,
      tileCount: 4,
      unidentifiedImageCount: 0,
    });
    await port.stopObservation(binding.tabId, binding);
  }
  expect(injectionCount()).toBe(3);
});

test("production arm exception is actionable and remains before any activation", async ({
  page,
}) => {
  const { port, injectionCount } = await installProductionArmPort(
    page,
    "arm_exception",
  );
  const activationCalls = 0;
  const armed = await port.startObservation(binding.tabId, binding);
  expect(armed).toMatchObject({
    status: "unsupported",
    diagnostic: {
      phase: "arm_injection",
      reason: "injection_exception",
      exceptionName: "Error",
    },
  });
  expect(JSON.stringify(armed)).not.toContain("synthetic internal detail");
  expect(activationCalls).toBe(0);
  expect(injectionCount()).toBe(2);
});
