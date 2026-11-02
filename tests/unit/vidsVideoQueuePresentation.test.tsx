// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VidsPreparedBatchReview } from "../../src/app/features/video-batch/VidsPreparedBatchReview";
import { ToastHost } from "../../src/app/components/ToastHost";
import type { PreparedVideoBatchRecord } from "../../src/domain/batches/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; host?.remove(); host = undefined; vi.restoreAllMocks(); });

const batch: PreparedVideoBatchRecord = {
  id: "prepared:vids:ui", requestId: "33333333-3333-4333-8333-333333333333", workspaceId: "workspace", preparedAt: 1,
  videoBatchId: "video", videoSourceHash: "a".repeat(64), videoSourceText: "{}", imageSourceBatchId: "images", imageSourceBatchHash: "b".repeat(64), destination: "Vids",
  target: { provider: "Vids", tabId: 9, canonicalTarget: "https://docs.google.com/videos/d/project/edit", projectId: "project", documentId: "doc", verification: "verified", verifiedAt: 1 },
  manualSettingsDeclaration: { confirmationId: "confirm", confirmedAt: 1, destination: "Vids", declaredDurationSeconds: 8, tabId: 9, canonicalTarget: "https://docs.google.com/videos/d/project/edit", projectId: "project", documentId: "doc" },
  status: "prepared", itemCount: 2, items: [
    { itemId: "item-1", order: 0, shotId: "1", canonicalShotId: "1", rawJsonBody: "{\"shot_id\":\"1\"}", contentHash: "c".repeat(64), sourceSpan: { start: 0, end: 15 }, reference: { referenceId: "11111111-1111-4111-8111-111111111111", assignmentVersion: 1, sha256: "d".repeat(64), mimeType: "image/png", byteSize: 4, width: 1, height: 1, capturedAt: 1 } },
    { itemId: "item-2", order: 1, shotId: "2", canonicalShotId: "2", rawJsonBody: "{\"shot_id\":\"2\"}", contentHash: "e".repeat(64), sourceSpan: { start: 15, end: 30 }, reference: { referenceId: "22222222-2222-4222-8222-222222222222", assignmentVersion: 1, sha256: "f".repeat(64), mimeType: "image/png", byteSize: 4, width: 1, height: 1, capturedAt: 1 } },
  ], createdAt: 1, updatedAt: 1,
};

describe("P10.3 Vids queue presentation", () => {
  it.each([
    ["ready", "Ready", "Starting queue", false],
    ["cooldown", "Waiting for next shot", "Next prompt in", true],
    ["preparing", "Preparing next shot", "Preparing next shot", false],
    ["checking_generate", "Checking Generate", "Waiting for Generate", true],
    ["paused", "Paused", "Paused", false],
    ["stopped", "Stopped", "Stopped", false],
    ["blocked", "Needs attention", "Needs attention", false],
    ["all_sent", "All prompts sent", "Video completion can be checked in Google Vids.", false],
  ])("presents %s queue state without a misleading countdown", async (state, statusText, detailText, hasCountdown) => {
    const sent = state === "all_sent" || state === "cooldown";
    const items = batch.items.map((item, order) => ({
      itemId: item.itemId, order, shotId: item.canonicalShotId, referenceId: item.reference.referenceId,
      referenceSha256: item.reference.sha256, promptHash: item.contentHash,
      state: state === "all_sent" || (state === "cooldown" && order === 0) ? "sent" : state === "checking_generate" ? "checking_generate" : state === "preparing" ? "attaching" : state === "blocked" ? "uncertain" : "pending",
      ...(sent && (state === "all_sent" || order === 0) ? { attemptId: `attempt-${order}`, dispatchReceipt: { attemptId: `attempt-${order}`, storedAt: 1000 + order } } : {}),
    }));
    const now = Date.now();
    const queue = {
      queueId: `vids-video:${batch.id}`, preparedBatchId: batch.id, state, items, revision: 1, createdAt: 1, updatedAt: 1,
      lastDispatchAt: sent ? now - 1000 : null, cooldownDeadlineAt: sent ? now + 49_000 : null,
      readinessStartedAt: state === "checking_generate" ? now : null, readinessDeadlineAt: state === "checking_generate" ? now + 60_000 : null,
      nextActionAt: sent || state === "checking_generate" ? now + 49_000 : null, pauseReason: ["paused", "stopped", "blocked"].includes(state) ? "test_reason" : undefined, runId: "run",
    };
    const client = { request: vi.fn(async (type: string) => type === "vids.videoQueue.get" ? queue : type === "vids.video.getAttachmentStatus" ? { status: "not_started" } : type === "vids.video.getReferencePreview" ? null : null) };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(VidsPreparedBatchReview, { preparedBatch: batch, persistenceClient: client as never })); await Promise.resolve(); });
    expect(host.textContent).toContain(statusText);
    expect(host.textContent).toContain(detailText);
    expect(Boolean(host.querySelector('[aria-label="50-second dispatch interval"], [aria-label="Generate readiness window"]'))).toBe(hasCountdown);
  });

  it("renders receipt progress and deadline countdown; clock ticks issue no execution requests", async () => {
    let queue: unknown = null;
    const requests: string[] = [];
    const persisted = {
      queueId: `vids-video:${batch.id}`, preparedBatchId: batch.id, state: "cooldown", items: [{ itemId: "item-1", order: 0, shotId: "1", referenceId: batch.items[0]!.reference.referenceId, referenceSha256: batch.items[0]!.reference.sha256, promptHash: batch.items[0]!.contentHash, state: "sent", attemptId: "attempt-1", dispatchReceipt: { attemptId: "attempt-1", storedAt: Date.now() - 1000 } }, { itemId: "item-2", order: 1, shotId: "2", referenceId: batch.items[1]!.reference.referenceId, referenceSha256: batch.items[1]!.reference.sha256, promptHash: batch.items[1]!.contentHash, state: "pending" }],
      revision: 2, createdAt: 1, updatedAt: 1, lastDispatchAt: Date.now() - 1000, cooldownDeadlineAt: Date.now() + 49_000, readinessDeadlineAt: null, readinessStartedAt: null, nextActionAt: Date.now() + 49_000, runId: "run-1",
    };
    const client = { request: vi.fn(async (type: string) => { requests.push(type); if (type === "vids.videoQueue.get") return queue; if (type === "vids.video.getAttachmentStatus") return { status: "not_started" }; if (type === "vids.video.getReferencePreview") return null; if (type === "vids.videoQueue.start") { queue = persisted; return queue; } return null; }) };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(VidsPreparedBatchReview, { preparedBatch: batch, persistenceClient: client as never })); });
    const start = [...host.querySelectorAll("button")].find((button) => button.textContent === "Start Vids queue");
    expect(start).toBeTruthy();
    await act(async () => { start!.click(); await Promise.resolve(); });
    expect(host.textContent).toContain("1 of 2 prompts sent");
    expect(host.textContent).toContain("Next prompt in");
    const bar = host.querySelector('[aria-label="Vids prompt dispatch progress"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("1");
    const before = requests.filter((type) => !type.endsWith(".get") && !type.endsWith("Status") && !type.endsWith("Preview")).length;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(requests.filter((type) => !type.endsWith(".get") && !type.endsWith("Status") && !type.endsWith("Preview")).length).toBe(before);
    expect(requests).not.toContain("vids.video.generateOnce");
    expect(requests).not.toContain("vids.video.attachReference");
  });

  it("toasts once on the observed all-sent transition and keeps the summary after dismissal", async () => {
    const items = batch.items.map((item, order) => ({ itemId: item.itemId, order, shotId: item.canonicalShotId, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, promptHash: item.contentHash, state: "pending" }));
    let current: Record<string, unknown> = { queueId: `vids-video:${batch.id}`, preparedBatchId: batch.id, state: "ready", items, revision: 1, createdAt: 1, updatedAt: 1, lastDispatchAt: null, cooldownDeadlineAt: null, readinessDeadlineAt: null, readinessStartedAt: null, nextActionAt: null, runId: "run" };
    const sent = { ...current, state: "all_sent", revision: 2, items: items.map((item) => ({ ...item, state: "sent", attemptId: `attempt-${item.order}`, dispatchReceipt: { attemptId: `attempt-${item.order}`, storedAt: 10_000 + item.order } })) };
    const request = vi.fn(async (type: string) => { if (type === "vids.videoQueue.get") return current; if (type === "vids.videoQueue.start") { current = sent; return sent; } if (type === "vids.video.getAttachmentStatus") return { status: "not_started" }; if (type === "vids.video.getReferencePreview") return null; return null; });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(ToastHost, null, createElement(VidsPreparedBatchReview, { preparedBatch: batch, persistenceClient: { request } as never }))); await Promise.resolve(); });
    const start = [...host.querySelectorAll("button")].find((button) => button.textContent === "Start Vids queue");
    await act(async () => { start!.click(); await Promise.resolve(); });
    expect(host.textContent).toContain("All 2 image–prompt pairs sent to Google Vids");
    expect(host.textContent).toContain("All 2 prompts sent successfully to Google Vids.");
    await act(async () => { host!.querySelector<HTMLButtonElement>("button[aria-label='Dismiss success notification']")?.click(); await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(host.textContent).not.toContain("All 2 prompts sent successfully to Google Vids.");
    await act(async () => { root!.render(createElement(ToastHost, null, createElement(VidsPreparedBatchReview, { preparedBatch: batch, persistenceClient: { request } as never }))); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).not.toContain("All 2 prompts sent successfully to Google Vids.");
    expect(host.textContent).toContain("Video completion can be checked in Google Vids.");
  });
});
