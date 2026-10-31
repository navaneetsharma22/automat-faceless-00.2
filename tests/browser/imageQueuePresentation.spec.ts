import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const presentationEpoch = Date.now();
const queueFixture = {
  queueId: "cc8f9178-f79a-4a7d-a781-22d0e17a0001",
  workspaceId: "default",
  kind: "image",
  mode: "timed_submission",
  intervalMs: 40_000,
  state: "waiting",
  sourceText: "fixture-only",
  sourceHash: "b".repeat(64),
  sourceMode: "single_json_value",
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
  items: [
    {
      queueItemId: "sent-1",
      sourceItemId: "source-1",
      order: 0,
      shotId: "1",
      rawJsonBody: JSON.stringify({ scene_title: "Dinosaur at the valley" }),
      promptHash: "a".repeat(64),
      sourceSpan: { start: 0, end: 50 },
      itemState: "sent",
      providerOutcome: "unknown",
      dispatchReceipt: {
        attemptId: "fixture-attempt",
        storedAt: presentationEpoch,
        evidence: "activation_pair_sent_or_uncertain",
      },
    },
    {
      queueItemId: "pending-2",
      sourceItemId: "source-2",
      order: 1,
      shotId: "2",
      rawJsonBody: JSON.stringify({
        scene_title: "A second prompt in the mist",
      }),
      promptHash: "c".repeat(64),
      sourceSpan: { start: 51, end: 100 },
      itemState: "pending",
      providerOutcome: "not_started",
    },
  ],
  lastDispatchReceiptStoredAt: presentationEpoch,
  nextEligibleDispatchAt: presentationEpoch + 40_000,
  createdAt: 1,
  updatedAt: presentationEpoch,
  revision: 2,
};
const pausedFixture = {
  ...queueFixture,
  state: "paused",
  pauseReason: "user_requested",
  revision: 3,
  updatedAt: presentationEpoch + 40_000,
};

test("waiting queue countdown stays read-only and renders in both themes and viewports", async ({
  page,
}) => {
  page.on("pageerror", (error) => console.log("page error", error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(
    ({ fixture, paused }) => {
      const requests: Array<{ type: string; at: number }> = [];
      Object.defineProperty(window, "__queueFixtureRequests", {
        value: requests,
      });
      const runtime = {
        onMessage: {
          addListener: () => undefined,
          removeListener: () => undefined,
        },
        sendMessage: (request: {
          type: string;
          requestId: string;
          protocolVersion: number;
          buildId: string;
        }) => {
          requests.push({ type: request.type, at: Date.now() });
          if (request.type === "imageQueue.pause") {
            return new Promise((resolve) => {
              Object.defineProperty(window, "__resolvePauseReadback", {
                value: () =>
                  resolve({
                    ok: true,
                    protocolVersion: request.protocolVersion,
                    buildId: request.buildId,
                    requestId: request.requestId,
                    data: paused,
                  }),
                configurable: true,
              });
            });
          }
          return Promise.resolve({
            ok: true,
            protocolVersion: request.protocolVersion,
            buildId: request.buildId,
            requestId: request.requestId,
            data: request.type === "imageQueue.list" ? [fixture] : null,
          });
        },
      };
      Object.defineProperty(window.chrome, "runtime", {
        value: runtime,
        configurable: true,
      });
      const event = {
        addListener: () => undefined,
        removeListener: () => undefined,
      };
      Object.defineProperty(window.chrome, "tabs", {
        value: { onRemoved: event, onUpdated: event },
        configurable: true,
      });
    },
    { fixture: queueFixture, paused: pausedFixture },
  );
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.clock.install({ time: new Date(presentationEpoch + 20_000) });

  const card = page.getByRole("region", {
    name: `Timed image queue ${queueFixture.queueId}`,
  });
  await expect(card).toBeVisible();
  await expect(card.getByText(/1\s*\/\s*2/)).toBeVisible();
  await expect(card.getByRole("timer")).toHaveText("00:20");
  await expect(
    card.getByText("Shot 2 · A second prompt in the mist"),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Stop queue" })).toBeVisible();
  const setupCard = page.locator("[class*=createCard]");
  await expect(
    setupCard.getByRole("button", { name: "Create timed queue" }),
  ).toBeDisabled();
  await expect(
    setupCard.getByText(
      "Validate and save the current image source before creating a queue.",
    ),
  ).toBeVisible();

  await card.getByRole("button", { name: "Pause" }).focus();
  expect(
    await card
      .getByRole("button", { name: "Pause" })
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await card
      .locator("[class*=waitingTrack] span")
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe("0.001s");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  const screenshotDir = "artifacts/image-queue-presentation";
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: `${screenshotDir}/waiting-light-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: `${screenshotDir}/waiting-dark-desktop.png`,
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByRole("timer")).toBeVisible();
  const mobileWidths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(mobileWidths.page).toBeLessThanOrEqual(mobileWidths.viewport);
  await page.screenshot({
    path: `${screenshotDir}/waiting-mobile.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const beforeTick = await page.evaluate(
    () =>
      (window as unknown as { __queueFixtureRequests: unknown[] })
        .__queueFixtureRequests.length,
  );
  const beforeSeconds = await card.getByRole("timer").innerText();
  await page.clock.fastForward(1_000);
  await expect
    .poll(async () => {
      const [minutes, seconds] = (await card.getByRole("timer").innerText())
        .split(":")
        .map(Number);
      return minutes * 60 + seconds;
    })
    .toBeLessThan(Number(beforeSeconds.split(":")[1]));
  const afterTick = await page.evaluate(
    () =>
      (window as unknown as { __queueFixtureRequests: unknown[] })
        .__queueFixtureRequests.length,
  );
  expect(afterTick).toBe(beforeTick);

  const currentTime = await card.getByRole("timer").innerText();
  const [minutes, seconds] = currentTime.split(":").map(Number);
  await page.clock.fastForward((minutes * 60 + seconds) * 1_000);
  await expect(card.getByRole("timer")).toHaveText("00:00");
  await expect(card.getByText("Checking next prompt…")).toBeVisible();
  await expect(card.getByText("Pending", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${screenshotDir}/deadline-zero.png`,
    fullPage: true,
  });

  await card.getByRole("button", { name: "Pause" }).click();
  await expect(card.getByText(/Pausing queue/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Pausing…" })).toBeDisabled();
  await expect(card.getByRole("heading", { name: "Waiting" })).toBeVisible();
  const pendingCommandCount = await page.evaluate(
    () =>
      (
        window as unknown as { __queueFixtureRequests: { type: string }[] }
      ).__queueFixtureRequests.filter(
        (request) => request.type === "imageQueue.pause",
      ).length,
  );
  expect(pendingCommandCount).toBe(1);
  await page.evaluate(() => {
    (
      window as unknown as { __resolvePauseReadback: () => void }
    ).__resolvePauseReadback();
  });
  await expect(card.getByRole("heading", { name: "Paused" })).toBeVisible();
  await expect(card.getByRole("timer")).toHaveCount(0);
  const requestedTypes = await page.evaluate(() =>
    (
      window as unknown as { __queueFixtureRequests: { type: string }[] }
    ).__queueFixtureRequests.map((request) => request.type),
  );
  expect(requestedTypes).not.toContain("flow.image.generateOnce");
  expect(requestedTypes).not.toContain("imageQueue.start");
});
