import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const epoch = 1_800_000_000_000;
const batchId = "prepared:default:video-presentation";
const preparedBatch = {
  id: batchId, requestId: "33333333-3333-4333-8333-333333333333", workspaceId: "default", preparedAt: epoch,
  videoBatchId: "video-source", videoSourceHash: "a".repeat(64), videoSourceText: "[]", imageSourceBatchId: "image-source", imageSourceBatchHash: "b".repeat(64), destination: "Flow",
  target: { provider: "Flow", tabId: 7, canonicalTarget: "https://flow.google.com/project/p", projectId: "p", documentId: "doc", verification: "verified", verifiedAt: epoch },
  manualSettingsDeclaration: { confirmationId: "manual-confirmation", confirmedAt: epoch, destination: "Flow", declaredDurationSeconds: 8, tabId: 7, canonicalTarget: "https://flow.google.com/project/p", projectId: "p", documentId: "doc" },
  status: "prepared", itemCount: 5, createdAt: epoch, updatedAt: epoch,
  items: Array.from({ length: 5 }, (_, order) => ({
    itemId: `item-${order}`, order, shotId: String(order + 1), canonicalShotId: String(order + 1), rawJsonBody: JSON.stringify({ shot_id: String(order + 1), prompt_type: "video", scene_title: `Misty landscape ${order + 1}` }),
    contentHash: String(order + 1).repeat(64), sourceSpan: { start: order, end: order + 20 },
    reference: { referenceId: `00000000-0000-4000-8000-${String(order + 1).padStart(12, "0")}`, assignmentVersion: 1, sha256: "c".repeat(64), mimeType: "image/png", byteSize: 68, width: 1, height: 1, capturedAt: epoch },
  })),
};

test("video queue prepared-batch presentation fixtures stay readable across states, themes and viewports", async ({ page }) => {
  const screenshotDir = "artifacts/video-queue-presentation";
  await mkdir(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.clock.install({ time: new Date(epoch) });
  await page.addInitScript(({ batch, fixedEpoch }) => {
    const requests: Array<{ type: string; at: number }> = [];
    Object.defineProperty(window, "__videoQueueFixtureRequests", { value: requests });
    const event = { addListener: () => undefined, removeListener: () => undefined };
    const runtime = { onMessage: event, sendMessage: (request: { type: string; requestId: string; protocolVersion: number; buildId: string }) => {
      requests.push({ type: request.type, at: Date.now() });
      let data: unknown = null;
      const caseName = new URL(location.href).searchParams.get("case") ?? "ready";
      if (request.type === "videoBatch.getPrepared") data = batch;
      if (request.type === "flow.videoQueue.get") {
        data = queueFor(caseName);
        Object.defineProperty(window, "__videoQueueFixtureQueue", { value: data, configurable: true });
      }
      if (request.type === "flow.video.getAttachmentStatus") data = { status: "not_started" };
      if (request.type === "flow.reference.getSavedReference") data = { data: "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjNzMxZDNlIi8+PC9zdmc+", reference: { mimeType: "image/svg+xml" } };
      return Promise.resolve({ ok: true, protocolVersion: request.protocolVersion, buildId: request.buildId, requestId: request.requestId, data });
    } };
    Object.defineProperty(window.chrome, "runtime", { value: runtime, configurable: true });
    Object.defineProperty(window.chrome, "tabs", { value: { onRemoved: event, onUpdated: event }, configurable: true });
    Object.defineProperty(window.chrome, "windows", { value: {}, configurable: true });
    function queueFor(caseName: string) {
      const cache = (window as unknown as { __videoQueueFixtureQueueCache?: Record<string, unknown> }).__videoQueueFixtureQueueCache ?? {};
      if (cache[caseName]) return cache[caseName];
      const queueNow = Date.now();
      const sentCount = caseName === "all-sent" ? 5 : ["waiting", "sending", "paused", "blocked"].includes(caseName) ? 2 : 0;
      const items = batch.items.map((item: typeof batch.items[number], order: number) => {
        const sent = order < sentCount;
        return { itemId: item.itemId, order, shotId: item.canonicalShotId, referenceId: item.reference.referenceId, promptHash: item.contentHash, state: sent ? "sent" : "pending", ...(sent ? { attemptId: `attempt-${order}`, dispatchReceipt: { attemptId: `attempt-${order}`, storedAt: fixedEpoch - 10_000 * (sentCount - order) } } : {}) };
      });
      const state = caseName === "all-sent" ? "sent" : caseName === "paused" ? "paused" : caseName === "blocked" ? "blocked" : caseName === "ready" ? "ready" : "waiting";
      const nextActionAt = caseName === "waiting" ? queueNow + 30_000 : null;
      if (caseName === "sending") items[2] = { ...items[2], state: "dispatching" };
      if (caseName === "blocked") items[2] = { ...items[2], state: "failed", reason: "candidate_bytes_mismatch", byteMismatchDiagnostic: { stage: "candidate_byte_verification", acquisitionRoute: "verified_detail_original_extension_fetch", preparedSha256: "c".repeat(64), metadataSha256: "c".repeat(64), savedBytesSha256: "c".repeat(64), candidateBytesSha256: "d".repeat(64), candidateMediaId: "66c14f25-59b9-42ea-a6f7-8eeb627dcf87", mimeType: "image/webp", preparedByteSize: 68, savedByteSize: 68, candidateByteSize: 61, preparedWidth: 1376, preparedHeight: 768 } };
      const queue = { queueId: `flow-video:${batch.id}`, preparedBatchId: batch.id, state, pauseReason: caseName === "paused" ? "user_paused" : caseName === "blocked" ? "candidate_bytes_mismatch" : undefined, items, lastDispatchAt: sentCount ? queueNow - 30_000 : null, nextActionAt, revision: 5, createdAt: fixedEpoch - 60_000, updatedAt: fixedEpoch };
      cache[caseName] = queue;
      Object.defineProperty(window, "__videoQueueFixtureQueueCache", { value: cache, configurable: true });
      return queue;
    }
  }, { batch: preparedBatch, fixedEpoch: epoch });

  for (const caseName of ["ready", "sending", "waiting", "paused", "blocked", "all-sent"]) {
    await page.goto(`http://127.0.0.1:5173/?case=${caseName}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Videos" }).click();
    const review = page.locator("section[aria-labelledby='prepared-review-heading']");
    await expect(review).toBeVisible();
    await expect(review.getByText(/of 5 prompts sent/)).toBeVisible();
    if (caseName === "waiting") {
      const timing = await page.evaluate(() => {
        const queue = (window as unknown as { __videoQueueFixtureQueue: { nextActionAt: number } }).__videoQueueFixtureQueue;
        const timer = document.querySelector<HTMLElement>("[role=timer]")!;
        return { seconds: Math.ceil((queue.nextActionAt - Date.now()) / 1000), display: timer.innerText };
      });
      expect(timing.display).toBe(`${String(Math.floor(timing.seconds / 60)).padStart(2, "0")}:${String(timing.seconds % 60).padStart(2, "0")}`);
      await expect(review.getByRole("progressbar", { name: "Prompts sent to Flow" })).toHaveAttribute("aria-valuetext", "2 of 5 prompts sent");
    }
    if (caseName === "all-sent") {
      await expect(review.getByRole("heading", { name: "All 5 image–prompt pairs sent to Flow" })).toBeVisible();
      await expect(review.getByText("Video completion is checked in Flow.")).toBeVisible();
      await expect(review.getByRole("timer")).toHaveCount(0);
      await expect(review.getByText("All 5 video prompts sent to Flow successfully.")).toHaveCount(0);
    }
    if (caseName === "blocked") await expect(review.getByText("Current blocker:")).toBeVisible();
    // Keep the app's sticky dashboard bar from covering the queue in a
    // component screenshot after Playwright scrolls the review into view.
    await page.addStyleTag({ content: "header { position: static !important; }" });
    await review.screenshot({ path: `${screenshotDir}/${caseName}-light-desktop.png` });
  }

  await page.goto("http://127.0.0.1:5173/?case=waiting", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Videos" }).click();
  const review = page.locator("section[aria-labelledby='prepared-review-heading']");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.addStyleTag({ content: "header { position: static !important; }" });
  await review.screenshot({ path: `${screenshotDir}/waiting-dark-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.viewport);
  await review.screenshot({ path: `${screenshotDir}/waiting-dark-mobile.png` });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await review.screenshot({ path: `${screenshotDir}/waiting-light-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1100 });
  const initialSeconds = Number((await review.getByRole("timer").innerText()).split(":")[1]);
  const requestsBeforeTick = await page.evaluate(() => (window as unknown as { __videoQueueFixtureRequests: Array<{ type: string }> }).__videoQueueFixtureRequests.map((entry) => entry.type));
  await page.clock.fastForward(1_000);
  const afterOneSecond = Number((await review.getByRole("timer").innerText()).split(":")[1]);
  expect(afterOneSecond).toBeLessThan(initialSeconds);
  await page.clock.fastForward(afterOneSecond * 1_000);
  await expect(review.getByRole("timer")).toHaveText("00:00");
  await expect(review.getByText("Checking next shot…")).toBeVisible();
  await expect(review.locator("[class*=dispatchTrack] span")).toHaveAttribute("style", /width: 100%/);
  const requestsAfterZero = await page.evaluate(() => (window as unknown as { __videoQueueFixtureRequests: Array<{ type: string }> }).__videoQueueFixtureRequests.map((entry) => entry.type));
  expect(requestsAfterZero.slice(requestsBeforeTick.length).some((type) => ["flow.videoQueue.start", "flow.videoQueue.resume", "flow.video.attachReference", "flow.video.generateOnce"].includes(type))).toBe(false);
});
