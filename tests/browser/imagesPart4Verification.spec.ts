import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { importPromptBatch } from "../../src/domain/batches/importBatch";
import {
  ImageSubmissionQueueRecordSchema,
  type ImageSubmissionQueueRecord,
} from "../../src/domain/jobs/queue";
import { PromptBatchSnapshotSchema } from "../../src/shared/schemas";

const epoch = Date.now();
const queueId = "6fbce7bd-cf6b-48dc-a01f-29e84b000041";
const historyQueueId = "c0242f1c-82f6-4bf8-8306-0e74b1000042";
const sourceText = Array.from({ length: 50 }, (_, index) => {
  const shotId = String(index + 1);
  return `${index + 1}: ${JSON.stringify({
    shot_id: shotId,
    scene_title: `Fixture scene ${shotId}`,
    description: `Long local fixture prompt ${shotId}. ${"A cinematic landscape with layered light and detail. ".repeat(10)}`,
  })}`;
}).join("\n");
const imported = importPromptBatch(sourceText, "image");
if (!imported.ok) throw new Error(`Images Part 4 fixture source is invalid: ${JSON.stringify(imported.error)}`);

const batchId = "import:default:image";
const promptBatch = PromptBatchSnapshotSchema.parse({
  batch: {
    id: batchId,
    workflowId: "default",
    workspaceId: "default",
    kind: "image",
    status: "draft",
    sourceText,
    sourceMode: imported.mode,
    orderedItemIds: imported.items.map((_, order) => `${batchId}:item:${order}`),
    total: imported.total,
    updatedAt: epoch,
  },
  items: imported.items.map((item, order) => ({
    id: `${batchId}:item:${order}`,
    batchId,
    workspaceId: "default",
    kind: "image",
    order,
    ...(item.shotId === undefined ? {} : { shotId: item.shotId }),
    ...(item.identitySource === undefined
      ? {}
      : { identitySource: item.identitySource }),
    rawJsonBody: item.rawBody,
    sourceSpan: item.sourceSpan,
    measurement: item.measurement,
    contentHash: String((order % 9) + 1).repeat(64),
    createdAt: epoch,
  })),
});

function makeQueue(
  state: "ready" | "processing" | "waiting" | "paused" | "blocked" | "stopped" | "sent",
  id = queueId,
  source = sourceText,
): ImageSubmissionQueueRecord {
  const hasSent = state !== "ready";
  const allSent = state === "sent";
  const items = imported.items.map((prompt, order) => {
    const isReceipt = allSent || (hasSent && order === 0);
    const isProcessing = state === "processing" && order === 1;
    const isBlocked = state === "blocked" && order === 1;
    return {
      queueItemId: `${id}:item:${order}`,
      sourceItemId: `${id}:source:${order}`,
      order,
      ...(prompt.shotId === undefined ? {} : { shotId: prompt.shotId }),
      rawJsonBody: prompt.rawBody,
      promptHash: String((order % 9) + 1).repeat(64),
      sourceSpan: prompt.sourceSpan,
      itemState: allSent
        ? ("sent" as const)
        : isReceipt
          ? ("sent" as const)
          : isProcessing
            ? ("sending" as const)
            : isBlocked
              ? ("blocked" as const)
              : ("pending" as const),
      providerOutcome: isReceipt || isProcessing ? ("unknown" as const) : ("not_started" as const),
      ...(isReceipt
        ? {
            dispatchReceipt: {
              attemptId: `${id}:attempt:${order}`,
              storedAt: epoch,
              evidence: "activation_pair_sent_or_uncertain" as const,
            },
          }
        : {}),
      ...(isProcessing
        ? {
            dispatchIntent: {
              attemptId: `${id}:attempt:${order}`,
              recordedAt: epoch,
              activationStartedAt: epoch,
            },
          }
        : {}),
      ...(isBlocked ? { blockReason: "target_changed" } : {}),
    };
  });

  const queue: ImageSubmissionQueueRecord = {
    queueId: id,
    workspaceId: "default",
    kind: "image",
    mode: "timed_submission",
    intervalMs: 40_000,
    state:
      state === "processing" || state === "waiting"
        ? "waiting"
        : state,
    ...(state === "paused" ? { pauseReason: "user_requested" } : {}),
    sourceText: source,
    sourceHash: "b".repeat(64),
    sourceMode: imported.mode,
    selectedProject: {
      provider: "Flow",
      tabId: 4,
      projectId: "presentation",
      canonicalTarget: "https://flow.google.com/project/presentation",
      selectionRevision: 1,
    },
    manualSettingsDeclaration: {
      confirmationId: "fixture-confirmation",
      confirmedAt: 1,
      tabId: 4,
      projectId: "presentation",
      canonicalTarget: "https://flow.google.com/project/presentation",
      declaredVariantCount: 1,
      userAttested: true,
    },
    items,
    lastDispatchReceiptStoredAt: hasSent ? epoch : null,
    nextEligibleDispatchAt: allSent ? null : hasSent ? epoch + 40_000 : null,
    createdAt: epoch - 60_000,
    updatedAt: epoch,
    revision: {
      ready: 0,
      processing: 1,
      waiting: 2,
      paused: 3,
      blocked: 4,
      stopped: 5,
      sent: 6,
    }[state],
  };
  const parsed = ImageSubmissionQueueRecordSchema.safeParse(queue);
  if (!parsed.success)
    throw new Error(`Invalid ${state} queue fixture: ${parsed.error.message}`);
  return parsed.data;
}

const variants = {
  ready: makeQueue("ready"),
  processing: makeQueue("processing"),
  waiting: makeQueue("waiting"),
  paused: makeQueue("paused"),
  blocked: makeQueue("blocked"),
  stopped: makeQueue("stopped"),
  sent: makeQueue("sent"),
};
const secondSent = ImageSubmissionQueueRecordSchema.parse({
  ...variants.waiting,
  items: variants.waiting.items.map((item, index) =>
    index === 1
      ? {
          ...item,
          itemState: "sent",
          providerOutcome: "unknown",
          dispatchReceipt: {
            attemptId: `${queueId}:attempt:1`,
            storedAt: epoch + 1,
            evidence: "activation_pair_sent_or_uncertain",
          },
        }
      : item,
  ),
  lastDispatchReceiptStoredAt: epoch + 1,
  nextEligibleDispatchAt: epoch + 40_001,
  revision: 6,
  updatedAt: epoch + 1,
});
const history = makeQueue("sent", historyQueueId, '{"shot_id":"900","scene_title":"Historical fixture"}');
variants.sent.revision = 7;

test("Images Part 4 rendered layout, states, motion, and notifications use only local fixtures", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.install({ time: new Date(epoch + 20_000) });
  await page.addInitScript(
    ({ variants: stateFixtures, historyFixture, savedBatch }) => {
      const requests: string[] = [];
      const local = {
        requests,
        queueVisible: false,
        queue: stateFixtures.ready,
        variants: stateFixtures,
        history: historyFixture,
        savedBatch,
        releaseStart: undefined as undefined | (() => void),
      };
      Object.defineProperty(window, "__imagesPart4", {
        value: local,
        configurable: true,
      });
      const envelope = (request: { protocolVersion: number; buildId: string; requestId: string }, data: unknown) => ({
        ok: true,
        protocolVersion: request.protocolVersion,
        buildId: request.buildId,
        requestId: request.requestId,
        data,
      });
      const runtime = {
        onMessage: {
          addListener: () => undefined,
          removeListener: () => undefined,
        },
        sendMessage: (request: {
          type: string;
          protocolVersion: number;
          buildId: string;
          requestId: string;
        }) => {
          requests.push(request.type);
          if (request.type === "imageQueue.start") {
            return new Promise((resolve) => {
              local.releaseStart = () => {
                local.queue = stateFixtures.processing;
                resolve(envelope(request, local.queue));
              };
            });
          }
          if (request.type === "imageQueue.pause") {
            local.queue = stateFixtures.paused;
            return Promise.resolve(envelope(request, local.queue));
          }
          if (request.type === "imageQueue.resume") {
            local.queue = stateFixtures.waiting;
            return Promise.resolve(envelope(request, local.queue));
          }
          if (request.type === "imageQueue.stop") {
            local.queue = stateFixtures.stopped;
            return Promise.resolve(envelope(request, local.queue));
          }
          let data: unknown = null;
          if (request.type === "imageQueue.list")
            data = local.queueVisible ? [local.queue, local.history] : [];
          else if (request.type === "promptBatch.put") data = local.savedBatch;
          else if (request.type === "flow.downloadDiagnostic.get")
            data = { status: "idle" };
          else if (request.type === "flow.projectVideos.import.get")
            data = {
              status: "idle",
              discovered: 0,
              imported: 0,
              alreadyPresent: 0,
              unresolved: 0,
              scanCompleteness: "pending",
              cancelRequested: false,
              unresolvedCards: [],
            };
          else if (request.type === "flow.clipImport.list") data = [];
          return Promise.resolve(envelope(request, data));
        },
      };
      Object.defineProperty(window.chrome, "runtime", {
        value: runtime,
        configurable: true,
      });
      const event = { addListener: () => undefined, removeListener: () => undefined };
      Object.defineProperty(window.chrome, "tabs", {
        value: { onRemoved: event, onUpdated: event },
        configurable: true,
      });
      const toastEvents: string[] = [];
      Object.defineProperty(window, "__imagesPart4ToastEvents", {
        value: toastEvents,
      });
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            const toasts = node.matches("[data-toast-kind]")
              ? [node]
              : Array.from(node.querySelectorAll("[data-toast-kind]"));
            for (const toast of toasts) toastEvents.push(toast.textContent ?? "");
          }
        }
      }).observe(document, { childList: true, subtree: true });
    },
    { variants, historyFixture: history, savedBatch: promptBatch },
  );

  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  const buildDetails = page.getByText("Advanced details");
  await buildDetails.click();
  await expect(page.getByText("automat-faceless-0.1.0-mwg2dl4j")).toBeVisible();
  await buildDetails.click();

  const screenshotDir = "artifacts/images-part4-rendered";
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}/empty-light-1920x1080.png` });

  const editor = page.locator("#image-import-source");
  await editor.fill(sourceText);
  expect(await editor.inputValue()).toBe(sourceText);
  const sourceBeforeValidation = await editor.evaluate((element: HTMLTextAreaElement) => ({
    value: element.value,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(sourceBeforeValidation.value).toBe(sourceText);
  expect(sourceBeforeValidation.scrollHeight).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Validate & Preview" }).click();
  await expect(page.getByRole("heading", { name: "50 prompts detected" })).toBeVisible();
  await expect(page.getByText("Validated preview. Nothing has been sent to a provider.")).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/validated-preview-light-1920x1080.png` });
  const settingsControl = page.locator("#image-variant-count");
  await settingsControl.focus();
  await page.getByRole("button", { name: "Save validated batch" }).click();
  await expect(page.getByText("Image batch saved and verified.")).toBeVisible();
  const setup = page.locator("[class*=createCard]");
  await settingsControl.focus();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("image-variant-count");
  expect(await setup.count()).toBe(1);

  await page.evaluate(() => {
    const local = (window as unknown as { __imagesPart4: { queueVisible: boolean } }).__imagesPart4;
    local.queueVisible = true;
  });
  await page.clock.fastForward(5_000);
  const queue = page.getByRole("region", { name: `Timed image queue ${queueId}` });
  await expect(queue).toBeVisible();
  const currentBlock = page.locator("[class*=currentQueueBlock]");
  await expect(currentBlock).toBeVisible();
  await expect(currentBlock.locator('[aria-label^="Timed image queue "]')).toHaveCount(1);
  await expect(currentBlock.getByRole("heading", { name: "Ready" })).toBeVisible();
  await expect(currentBlock.getByRole("button", { name: "Start queue" })).toBeVisible();
  const setupOrder = await currentBlock.evaluate((element) =>
    Boolean(element.compareDocumentPosition(document.querySelector("[class*=createCard]")!) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  expect(setupOrder).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("image-variant-count");
  await expect(page.locator("[class*=previousQueueBlock]")).toBeVisible();
  await expect(page.locator("[class*=sourceSummary]")).toBeVisible();
  const sectionOrder = await page.evaluate(() => {
    const queuePanel = document.querySelector('[aria-labelledby="image-queue-title"]')!;
    const source = document.querySelector('[class*=sourceSummary]')!;
    return Boolean(queuePanel.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(sectionOrder).toBe(true);

  const startButton = currentBlock.getByRole("button", { name: "Start queue" });
  await startButton.focus();
  await page.keyboard.press("Enter");
  const startingButton = currentBlock.getByRole("button", { name: "Starting queue" });
  await expect(startingButton).toBeVisible();
  const loadingMotion = await startingButton.evaluate((element) => ({
    animation: getComputedStyle(element, "::after").animationName,
    background: getComputedStyle(element, "::after").backgroundImage,
    width: element.getBoundingClientRect().width,
  }));
  expect(loadingMotion.animation).not.toBe("none");
  expect(loadingMotion.background).toContain("gradient");
  await page.evaluate(() => (window as unknown as { __imagesPart4: { releaseStart?: () => void } }).__imagesPart4.releaseStart?.());
  await expect(currentBlock.getByRole("heading", { name: "Sending" })).toBeVisible();
  await expect(currentBlock.locator('li[data-processing="true"]')).toHaveCount(1);
  expect(
    await currentBlock.locator('li[data-processing="true"]').evaluate((element) => getComputedStyle(element).animationName),
  ).not.toBe("none");
  await expect(currentBlock.locator('button[aria-busy="true"]')).toHaveCount(0);

  await page.clock.fastForward(5_000);
  const toastEventCountBeforeRepeat = await page.evaluate(() =>
    (window as unknown as { __imagesPart4ToastEvents: string[] }).__imagesPart4ToastEvents.filter((message) => message.includes("Image prompt 1 sent")).length,
  );
  expect(toastEventCountBeforeRepeat).toBe(1);
  await page.clock.fastForward(5_000);
  const toastEventCountAfterRepeat = await page.evaluate(() =>
    (window as unknown as { __imagesPart4ToastEvents: string[] }).__imagesPart4ToastEvents.filter((message) => message.includes("Image prompt 1 sent")).length,
  );
  expect(toastEventCountAfterRepeat).toBe(1);

  await page.evaluate(() => {
    const local = (window as unknown as { __imagesPart4: { queue: unknown; variants: Record<string, unknown> } }).__imagesPart4;
    local.queue = local.variants.waiting;
  });
  await page.clock.fastForward(5_000);
  await expect(currentBlock.getByRole("heading", { name: "Waiting" })).toBeVisible();
  await expect(currentBlock.getByRole("timer")).toBeVisible();
  await expect(currentBlock.locator("li").nth(1)).toContainText("Shot 2");
  await expect(currentBlock.locator('li[data-processing="true"]')).toHaveCount(0);

  await page.screenshot({ path: `${screenshotDir}/waiting-light-1920x1080.png` });
  for (const theme of ["light", "dark"] as const) {
    const actualTheme = await page.locator("html").getAttribute("data-theme");
    if (actualTheme !== theme) await page.getByRole("button", { name: /Switch to .* theme/ }).click();
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        theme: document.documentElement.dataset.theme,
      }));
      expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
      expect(dimensions.theme).toBe(theme);
      const queueTitle = currentBlock.getByRole("heading", { name: "Waiting" });
      await expect(queueTitle).toBeVisible();
      await expect(currentBlock.getByRole("timer")).toBeVisible();
      const editorFooter = page.locator("[class*=imageActionFooter]");
      const footerBox = await editorFooter.boundingBox();
      expect(footerBox).not.toBeNull();
      await page.screenshot({
        path: `${screenshotDir}/waiting-${theme}-${size.width}x${size.height}.png`,
        fullPage: true,
      });
    }
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await currentBlock.evaluate((element) => ({
    countdown: getComputedStyle(element.querySelector("[class*=countdown]")!).animationName,
    progressTransition: getComputedStyle(element.querySelector("[class*=waitingTrack] span")!).transitionDuration,
  }));
  expect(reducedMotion.countdown).toBe("none");
  expect(Number.parseFloat(reducedMotion.progressTransition)).toBeLessThanOrEqual(0.001);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  const pause = currentBlock.getByRole("button", { name: "Pause" });
  await pause.focus();
  await page.keyboard.press("Enter");
  await expect(currentBlock.getByRole("heading", { name: "Paused" })).toBeVisible();
  await expect(currentBlock.getByRole("timer")).toHaveCount(0);
  await expect(currentBlock.locator('li[data-processing="true"]')).toHaveCount(0);

  await currentBlock.getByRole("button", { name: "Resume" }).click();
  await expect(currentBlock.getByRole("heading", { name: "Waiting" })).toBeVisible();
  await page.evaluate(() => {
    const local = (window as unknown as { __imagesPart4: { queue: unknown; variants: Record<string, unknown> } }).__imagesPart4;
    local.queue = local.variants.blocked;
  });
  await page.clock.fastForward(5_000);
  await expect(currentBlock.getByRole("heading", { name: "Blocked" })).toBeVisible();
  await expect(currentBlock.getByRole("button", { name: "Inspect current editor (read-only)" })).toBeVisible();
  await expect(currentBlock.locator('li[data-processing="true"]')).toHaveCount(0);
  await page.evaluate(() => {
    const local = (window as unknown as { __imagesPart4: { queue: unknown; variants: Record<string, unknown> } }).__imagesPart4;
    local.queue = local.variants.stopped;
  });
  await page.clock.fastForward(5_000);
  await expect(currentBlock.getByRole("heading", { name: "Stopped" })).toBeVisible();
  await expect(currentBlock.locator('li[data-processing="true"]')).toHaveCount(0);

  await page.evaluate((fixture) => {
    const local = (window as unknown as { __imagesPart4: { queue: unknown } }).__imagesPart4;
    local.queue = fixture;
  }, secondSent);
  await page.clock.fastForward(5_000);
  await expect.poll(async () =>
    page.evaluate(() => (window as unknown as { __imagesPart4ToastEvents: string[] }).__imagesPart4ToastEvents
      .filter((message) => message.includes("Image prompt 2 sent")).length),
  ).toBe(1);
  console.log("Images Part 4 per-item transition", JSON.stringify({
    fromRevision: variants.stopped.revision,
    fromState: variants.stopped.state,
    toRevision: secondSent.revision,
    toState: secondSent.state,
    newlySentShotId: secondSent.items[1]?.shotId,
    toastText: await page.evaluate(() =>
      (window as unknown as { __imagesPart4ToastEvents: string[] })
        .__imagesPart4ToastEvents,
    ),
  }));
  await page.clock.fastForward(5_000);
  expect(await page.evaluate(() => (window as unknown as { __imagesPart4ToastEvents: string[] }).__imagesPart4ToastEvents
    .filter((message) => message.includes("Image prompt 2 sent")).length)).toBe(1);
  await page.evaluate(() => {
    const local = (window as unknown as { __imagesPart4: { queue: unknown; variants: Record<string, unknown> } }).__imagesPart4;
    local.queue = local.variants.sent;
  });
  await page.clock.fastForward(5_000);
  await expect(currentBlock.getByRole("heading", { name: "Finished" })).toBeVisible();
  const toastMessages = await page.evaluate(() =>
    (window as unknown as { __imagesPart4ToastEvents: string[] }).__imagesPart4ToastEvents,
  );
  expect(toastMessages.filter((message) => message.includes("Image prompt 2 sent")), JSON.stringify(toastMessages)).toHaveLength(1);
  expect(toastMessages.filter((message) => message.includes("All 50 image prompts sent")), JSON.stringify(toastMessages)).toHaveLength(1);
  expect(await page.locator("[data-toast-kind]").count()).toBeLessThanOrEqual(4);
  await page.clock.fastForward(5_000);
  const repeatedToastMessages = await page.evaluate(() =>
    (window as unknown as { __imagesPart4ToastEvents: string[] }).__imagesPart4ToastEvents,
  );
  expect(repeatedToastMessages.filter((message) => message.includes("All 50 image prompts sent")), JSON.stringify(repeatedToastMessages)).toHaveLength(1);
  console.log("Images Part 4 batch completion", JSON.stringify({
    fromRevision: secondSent.revision,
    toRevision: variants.sent.revision,
    state: variants.sent.state,
    toastText: repeatedToastMessages,
  }));
