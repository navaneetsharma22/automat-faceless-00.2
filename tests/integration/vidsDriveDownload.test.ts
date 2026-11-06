import { describe, expect, it, vi } from "vitest";
import { createVidsTimelineReadiness, type VidsDownloadAttempt } from "../../src/domain/media/combinedExport";
import { ChromePreferenceRepository } from "../../src/storage/repositories";
import { createVidsDownloadManager, type ChromeDownloadItem } from "../../src/background/downloadManager";
import { createHostedVidsDownloadListener, createVidsDownloadHandler } from "../../src/background/handlers/vidsDownload";
import { createHostedHelperConfigListener } from "../../src/background/handlers/hostedHelper";
import { buildHostedMp4HandoffPayload, classifyMp4PreparationFailure, createMp4PreparationFlow } from "../../external/vids-helper/logic.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const documentId = "vids-document-987";
const canonicalTarget = `https://vids.google.com/video/${documentId}/edit`;
const nonce = "a".repeat(64);
const sender = {
  origin: "https://navaneetsharma22.github.io",
  url: `https://navaneetsharma22.github.io/automat-faceless-picker/?extensionId=${extensionId}`,
  frameId: 0,
  tab: { id: 81 },
  documentId: "helper-document-81",
};
const handoff = (requestNonce = nonce, expectedId = documentId) => ({
  type: "HOSTED_MP4_DOWNLOAD",
  requestNonce,
  selectedFileId: expectedId,
  expectedFileId: expectedId,
  metadataVerified: true,
  mimeType: "application/vnd.google-apps.vid",
  canDownload: true,
  expectedMatch: true,
  preparedUriValidated: true,
  resourceKeyPresent: false,
  wholeDocumentAcknowledged: true,
  preparedUri: "https://www.googleapis.com/drive/v3/files/download?capability=private",
});

function fixture() {
  let attemptCount = 0;
  let nonceCount = 0;
  const values: Record<string, unknown> = {};
  const preferences = new ChromePreferenceRepository({
    get: async (key) => ({ [key]: values[key] }),
    set: async (items) => Object.assign(values, items),
  });
  const readiness = createVidsTimelineReadiness({
    documentId, canonicalTarget, tabId: 12, sceneOrderConfirmed: true, documentSavedConfirmed: true,
  }, 100);
  const selected = {
    provider: "Vids", verification: "verified", connectionState: "verified", tabId: 12,
    canonicalTarget,
    verificationBinding: { provider: "Vids", tabId: 12, canonicalTarget, projectId: documentId },
  };
  const repositories = { getSelectedTarget: vi.fn(async () => selected) };
  const connection = { id: 12, provider: "Vids", projectId: documentId, canonicalTarget };
  const searchResults: ChromeDownloadItem[] = [];
  const downloads = {
    download: vi.fn(async () => 44),
    search: vi.fn(async ({ id }: { id: number }) => searchResults.filter((item) => item.id === id)),
  };
  const manager = createVidsDownloadManager({
    preferences, downloads, now: () => 200,
  });
  const handler = createVidsDownloadHandler({
    extensionId, preferences, repositories: repositories as never, manager,
    revalidate: async () => ({ ok: true, state: "verified", tab: connection }),
    now: () => 200, makeAttemptId: () => `attempt_${++attemptCount}`, makeNonce: () => nonceCount++ === 0 ? nonce : "b".repeat(64),
  });
  const listener = createHostedVidsDownloadListener(handler);
  const send = (message: unknown, from = sender) => new Promise<unknown>((resolve) => {
    listener(message, from, resolve);
  });
  return { values, preferences, manager, handler, listener, send, downloads, searchResults, readiness, connection };
}

describe("Vids prepared MP4 download production handler", () => {
  it("preserves an unknown attempt and creates a separate ready attempt only on explicit same-document recovery", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    const old: VidsDownloadAttempt = {
      attemptId: "003d9d7e5abd68c5445fa5b0444bc151", documentId, canonicalTarget, tabId: 12,
      state: "needs_review", createdAt: 110, updatedAt: 120, reason: "operation_observation_lost",
      failureStage: "files_download_response", requestNonce: nonce, helperTabId: 81, helperDocumentId: "old-helper-document",
    };
    await f.preferences.setVidsDownloadAttempt(old);

    const result = await f.handler.recoverUnknownAttempt(old.attemptId, documentId);
    expect(result.attempt).toMatchObject({
      attemptId: "attempt_1", documentId, state: "ready", priorAttempts: [{
        attemptId: old.attemptId, documentId, state: "needs_review", reason: "operation_observation_lost",
        failureStage: "files_download_response", createdAt: 110, updatedAt: 120,
        archiveReason: "new_attempt_after_unknown_outcome",
      }],
    });
    expect(result.attempt?.priorAttempts?.[0]).not.toHaveProperty("requestNonce");
    expect(result.attempt?.priorAttempts?.[0]).not.toHaveProperty("helperDocumentId");
    expect(result.attempt?.priorAttempts?.[0]).not.toHaveProperty("operationName");
    expect(await f.handler.get()).toMatchObject({ attemptId: "attempt_1", priorAttempts: [{ attemptId: old.attemptId, state: "needs_review" }] });
    expect(f.downloads.download).not.toHaveBeenCalled();
    await expect(f.handler.arm()).resolves.toMatchObject({ attempt: { attemptId: "attempt_1", state: "ready" } });
    expect(await f.handler.get()).toMatchObject({ priorAttempts: [{ attemptId: old.attemptId, state: "needs_review" }] });
  });

  it("rejects stale, mismatched, operation-bearing, and known-failure records without changing them", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    const unknown: VidsDownloadAttempt = {
      attemptId: "old_unknown", documentId, canonicalTarget, tabId: 12, state: "needs_review",
      createdAt: 1, updatedAt: 2, reason: "operation_observation_lost",
    };
    await f.preferences.setVidsDownloadAttempt(unknown);
    await expect(f.handler.recoverUnknownAttempt("stale_attempt", documentId)).rejects.toThrow("vids_unknown_attempt_recovery_not_allowed");
    await expect(f.handler.recoverUnknownAttempt(unknown.attemptId, "another_document")).rejects.toThrow("vids_unknown_attempt_recovery_not_allowed");
    expect(await f.handler.get()).toMatchObject({ attemptId: unknown.attemptId, state: "needs_review" });
    expect(await f.handler.get()).not.toHaveProperty("priorAttempts");

    await f.preferences.setVidsDownloadAttempt({ ...unknown, operationName: "operations/known" });
    await expect(f.handler.recoverUnknownAttempt(unknown.attemptId, documentId)).rejects.toThrow("vids_unknown_attempt_recovery_not_allowed");
    await f.preferences.setVidsDownloadAttempt({ ...unknown, reason: "preparation_rejected" });
    await expect(f.handler.recoverUnknownAttempt(unknown.attemptId, documentId)).rejects.toThrow("vids_unknown_attempt_recovery_not_allowed");
    expect(f.downloads.download).not.toHaveBeenCalled();
  });

  it("keeps the normal Prepare click's explicit Drive rejection distinct from an uncertain request and blocks replay", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    await f.handler.arm();
    const challenge = await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId }) as { requestNonce: string };
    let statusQueue: Promise<unknown> = Promise.resolve();
    const flow = createMp4PreparationFlow({
      startDownload: vi.fn(async (fileId: string) => {
        expect(fileId).toBe(documentId);
        return { ok: false, category: "access_denied" };
      }),
      pollOperation: vi.fn(async () => ({ ok: false, category: "operation_failed" })),
      onState: (state: string, category: string | undefined, stage: string | undefined) => {
        const failure = state === "failed" || state === "timeout"
          ? classifyMp4PreparationFailure(stage, category)
          : undefined;
        const phase = state === "ready" ? "prepared" : failure ? "needs_review" : "preparing";
        statusQueue = statusQueue.then(() => f.send({
          type: "HOSTED_MP4_PREPARATION_STATUS",
          requestNonce: challenge.requestNonce,
          documentId,
          phase,
          ...(flow.operationName ? { operationName: flow.operationName } : {}),
          ...(failure ? { reviewReason: failure.reason, failureStage: failure.failureStage, failureCode: failure.failureCode } : {}),
        }));
      },
    });

    const outcome = await flow.prepare(documentId);
    await statusQueue;
    expect(outcome).toMatchObject({ state: "error", category: "access_denied", stage: "files_download_response" });
    expect(await f.handler.get()).toMatchObject({
      state: "needs_review",
      reason: "preparation_rejected",
      failureStage: "files_download_response",
      failureCode: "access_denied",
    });
    expect(await f.handler.get()).not.toHaveProperty("operationName");
    expect(await f.handler.get()).not.toHaveProperty("downloadId");
    expect(await classifyMp4PreparationFailure("files_download_response", "access_denied")).toMatchObject({
      reason: "preparation_rejected",
      message: expect.stringContaining("Drive denied access"),
    });
    await expect(f.handler.arm()).rejects.toThrow("vids_previous_attempt_needs_review");
    expect(flow.preparationStarted).toBe(true);
    expect(f.downloads.download).not.toHaveBeenCalled();

    const uncertain = classifyMp4PreparationFailure("files_download_transport", "transport_unavailable");
    expect(uncertain).toMatchObject({ reason: "preparation_outcome_uncertain", failureStage: "files_download_transport" });
    expect(uncertain.message).toContain("may have accepted");
  });

  it("keeps a known Drive operation ID when polling fails and reports the observation stage", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    await f.handler.arm();
    const challenge = await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId }) as { requestNonce: string };
    let statusQueue: Promise<unknown> = Promise.resolve();
    const flow = createMp4PreparationFlow({
      startDownload: async () => ({ ok: true, operation: { name: "operations/preserve_me", done: false } }),
      pollOperation: vi.fn(async (operationName: string) => {
        expect(operationName).toBe("operations/preserve_me");
        return { ok: false, category: "api_or_file_access_denied" };
      }),
      wait: async () => undefined,
      now: () => 1000,
      onState: (state: string, category: string | undefined, stage: string | undefined) => {
        const failure = state === "failed" || state === "timeout"
          ? classifyMp4PreparationFailure(stage, category)
          : undefined;
        const phase = state === "ready" ? "prepared" : failure ? "needs_review" : "preparing";
        statusQueue = statusQueue.then(() => f.send({
          type: "HOSTED_MP4_PREPARATION_STATUS",
          requestNonce: challenge.requestNonce,
          documentId,
          phase,
          ...(flow.operationName ? { operationName: flow.operationName } : {}),
          ...(failure ? { reviewReason: failure.reason, failureStage: failure.failureStage, failureCode: failure.failureCode } : {}),
        }));
      },
    });
    const outcome = await flow.prepare(documentId);
    await statusQueue;
    expect(outcome).toMatchObject({ state: "error", category: "api_or_file_access_denied", stage: "operation_poll" });
    expect(await f.handler.get()).toMatchObject({
      state: "needs_review",
      reason: "operation_observation_lost",
      failureStage: "operation_poll",
      failureCode: "api_or_file_access_denied",
      operationName: "operations/preserve_me",
    });
    expect(await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId })).toMatchObject({ success: false, status: "rejected" });
    expect(f.downloads.download).not.toHaveBeenCalled();

    const resumed = await flow.continuePolling();
    await statusQueue;
    expect(resumed).toMatchObject({ state: "error", stage: "operation_poll" });
    expect(flow.operationName).toBe("operations/preserve_me");
    expect(await f.handler.get()).toMatchObject({ operationName: "operations/preserve_me", state: "needs_review" });
    expect(f.downloads.download).not.toHaveBeenCalled();
  });

  it("continues the normal Prepare path through the same operation and hands off once with the exact Chrome ID", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    await f.handler.arm();
    const challenge = await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId }) as { requestNonce: string };
    let statusQueue: Promise<unknown> = Promise.resolve();
    let polls = 0;
    const flow = createMp4PreparationFlow({
      startDownload: vi.fn(async (fileId: string) => ({
        ok: fileId === documentId,
        operation: { name: "operations/normal_prepare_click", done: false },
      })),
      pollOperation: vi.fn(async (operationName: string) => {
        expect(operationName).toBe("operations/normal_prepare_click");
        polls += 1;
        return { ok: true, operation: { done: true, response: { downloadUri: "https://www.googleapis.com/drive/v3/files/download?mock=prepared" } } };
      }),
      wait: async () => undefined,
      now: () => 1000 + polls,
      timeoutMs: 30_000,
      onState: (state: string, category: string | undefined, stage: string | undefined) => {
        const failure = state === "failed" || state === "timeout"
          ? classifyMp4PreparationFailure(stage, category)
          : undefined;
        const phase = state === "ready" ? "prepared" : failure ? "needs_review" : "preparing";
        statusQueue = statusQueue.then(() => f.send({
          type: "HOSTED_MP4_PREPARATION_STATUS",
          requestNonce: challenge.requestNonce,
          documentId,
          phase,
          ...(flow.operationName ? { operationName: flow.operationName } : {}),
          ...(failure ? { reviewReason: failure.reason, failureStage: failure.failureStage, failureCode: failure.failureCode } : {}),
        }));
      },
    });

    const prepared = await flow.prepare(documentId);
    await statusQueue;
    expect(prepared).toMatchObject({ state: "ready" });
    expect(flow.operationName).toBe("operations/normal_prepare_click");
    expect(await f.handler.get()).toMatchObject({ state: "prepared", operationName: "operations/normal_prepare_click" });
    const payload = buildHostedMp4HandoffPayload({
      requestNonce: challenge.requestNonce,
      selectedProof: { status: "verified", mimeType: "application/vnd.google-apps.vid", canDownload: true, expectedMatch: true, fileId: documentId },
      expectedFileId: documentId,
      preparedUri: prepared.downloadUri.href,
      preparedUriValidated: true,
      resourceKeyPresent: false,
      wholeDocumentAcknowledged: true,
    });
    expect(await f.send(payload)).toEqual({ success: true, status: "downloading", attemptId: "attempt_1", documentId, downloadId: 44 });
    expect(await f.handler.get()).toMatchObject({ state: "downloading", operationName: "operations/normal_prepare_click", downloadId: 44 });
    expect(f.downloads.download).toHaveBeenCalledTimes(1);
    expect(await f.send(payload)).toMatchObject({ success: true, status: "downloading", downloadId: 44 });
    expect(f.downloads.download).toHaveBeenCalledTimes(1);
  });

  it("connects the helper launch, same-operation polling, whole-document payload, and prompt Chrome dispatch across a slow transfer", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    const configReply = vi.fn();
    createHostedHelperConfigListener(extensionId)({ type: "VIDS_HELPER_CONFIG_PING" }, sender, configReply);
    expect(configReply).toHaveBeenCalledWith({ success: true, status: "configured" });

    await f.handler.arm();
    const challenge = await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId }) as { requestNonce: string };
    expect(challenge.requestNonce).toBe(nonce);
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: challenge.requestNonce, documentId, phase: "preparing" });

    let operationClock = 0;
    let pollCount = 0;
    const operationFlow = createMp4PreparationFlow({
      startDownload: vi.fn(async (fileId: string) => ({ ok: fileId === documentId, operation: { name: "operations/op_same", done: false } })),
      pollOperation: vi.fn(async (name: string) => {
        expect(name).toBe("operations/op_same");
        pollCount += 1;
        return { ok: true, operation: pollCount < 2
          ? { name, done: false }
          : { name, done: true, response: { downloadUri: "https://www.googleapis.com/drive/v3/files/download?capability=private" } } };
      }),
      wait: async (milliseconds: number) => { operationClock += milliseconds; },
      now: () => operationClock,
      timeoutMs: 25_000,
    });
    const timedOut = await operationFlow.prepare(documentId);
    expect(operationClock).toBeGreaterThan(10_000);
    expect(pollCount).toBe(1);
    expect(timedOut).toMatchObject({ state: "timeout", operationName: "operations/op_same" });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: challenge.requestNonce, documentId, phase: "needs_review", operationName: "operations/op_same" });
    const prepared = await operationFlow.continuePolling();
    expect(prepared).toMatchObject({ state: "ready" });
    expect(pollCount).toBe(2);
    expect(await operationFlow.prepare(documentId)).toMatchObject({ state: "already_started" });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: challenge.requestNonce, documentId, phase: "preparing", operationName: "operations/op_same" });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: challenge.requestNonce, documentId, phase: "prepared", operationName: operationFlow.operationName });

    const payload = buildHostedMp4HandoffPayload({
      requestNonce: challenge.requestNonce,
      selectedProof: { status: "verified", mimeType: "application/vnd.google-apps.vid", canDownload: true, expectedMatch: true, fileId: documentId },
      expectedFileId: documentId,
      preparedUri: prepared.downloadUri.href,
      preparedUriValidated: true,
      resourceKeyPresent: false,
      wholeDocumentAcknowledged: true,
    });
    expect(payload).toMatchObject({ wholeDocumentAcknowledged: true, selectedFileId: documentId, expectedFileId: documentId });

    vi.useFakeTimers();
    f.searchResults.push({ id: 44, state: "in_progress", filename: "C:\\Downloads\\Vids\\whole.mp4" });
    let finishTransfer!: () => void;
    const transfer = new Promise<void>((resolve) => { finishTransfer = resolve; });
    setTimeout(() => {
      f.searchResults[0]!.state = "complete";
      void f.manager.onChanged({ id: 44, state: { current: "complete" } }).then(() => { finishTransfer(); });
    }, 30_000);

    const response = await f.send(payload);
    expect(response).toEqual({ success: true, status: "downloading", attemptId: "attempt_1", documentId, downloadId: 44 });
    expect(await f.handler.get()).toMatchObject({ state: "downloading", downloadId: 44 });
    await vi.advanceTimersByTimeAsync(10_100);
    expect(await f.handler.get()).toMatchObject({ state: "downloading", downloadId: 44 });
    expect(f.downloads.download).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(19_900);
    await transfer;
    expect(await f.handler.get()).toMatchObject({ state: "chrome_complete", downloadId: 44 });
    vi.useRealTimers();
  });

  it("returns the exact Chrome download ID promptly while a slow file remains in progress", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    const armed = await f.handler.arm() as { attempt: VidsDownloadAttempt };
    expect(armed.attempt.state).toBe("ready");
    expect(await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId })).toMatchObject({ success: true, requestNonce: nonce });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "preparing", operationName: "operations/op_123" });
    expect(await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "prepared", operationName: "operations/op_123" })).toMatchObject({ success: true, status: "prepared" });

    vi.useFakeTimers();
    const response = await f.send(handoff());
    await vi.advanceTimersByTimeAsync(10_100);
    expect(response).toEqual({ success: true, status: "downloading", attemptId: "attempt_1", documentId, downloadId: 44 });
    expect(f.downloads.download).toHaveBeenCalledTimes(1);
    expect(f.downloads.download).toHaveBeenCalledWith(expect.objectContaining({
      filename: `Vids/${documentId}-attempt_1.mp4`, saveAs: false, conflictAction: "uniquify",
    }));
    expect(await f.handler.get()).toMatchObject({ state: "downloading", operationName: "operations/op_123", downloadId: 44 });
    expect(JSON.stringify(f.values)).not.toContain("capability=private");
    // The accepted response does not wait for the multi-minute Chrome transfer.
    expect(f.downloads.search).not.toHaveBeenCalled();
    vi.useRealTimers();

    f.searchResults.push({ id: 44, state: "in_progress", filename: "C:\\Downloads\\Vids\\source.mp4" });
    await f.manager.reconcile();
    expect(await f.handler.get()).toMatchObject({ state: "downloading", downloadId: 44 });
    f.searchResults[0]!.state = "complete";
    await f.manager.onChanged({ id: 44, state: { current: "complete" } });
    expect(await f.handler.get()).toMatchObject({ state: "chrome_complete", downloadId: 44, sourcePath: "C:\\Downloads\\Vids\\source.mp4" });
    expect(f.downloads.download).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong document and sender, and never dispatches on duplicate messages", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    await f.handler.arm();
    expect(await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: "other-doc" })).toMatchObject({ success: false });
    expect(await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId }, { ...sender, origin: "https://example.com" })).toMatchObject({ success: false });
    await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "prepared" });
    expect(await f.send(handoff(), { ...sender, url: "https://example.com/" })).toMatchObject({ success: false, status: "rejected" });
    expect(await f.send(handoff(nonce, "other-doc"))).toMatchObject({ success: false, status: "rejected" });
    expect(await f.send({ ...handoff(), mimeType: "video/mp4" })).toMatchObject({ success: false, status: "rejected" });
    expect(await f.send({ ...handoff(), canDownload: false })).toMatchObject({ success: false, status: "rejected" });
    expect(await f.send(handoff())).toMatchObject({ success: true, downloadId: 44 });
    expect(await f.send(handoff())).toMatchObject({ success: true, status: "downloading", downloadId: 44 });
    expect(f.downloads.download).toHaveBeenCalledTimes(1);
  });

  it("binds the nonce challenge, preparation status, and download to one helper tab and document", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    await f.handler.arm();
    expect(await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId })).toMatchObject({ success: true });
    const otherDocument = { ...sender, documentId: "helper-document-reloaded" };
    expect(await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "prepared" }, otherDocument)).toMatchObject({ success: false });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "prepared" });
    expect(await f.send(handoff(), { ...sender, tab: { id: 82 } })).toMatchObject({ success: false, status: "rejected" });
    expect(f.downloads.download).not.toHaveBeenCalled();
    expect(await f.send(handoff())).toMatchObject({ success: true, downloadId: 44 });
  });

  it("marks a document change during helper preparation for review before download dispatch", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    await f.handler.arm();
    await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "prepared" });
    f.connection.projectId = "changed-doc";
    f.connection.canonicalTarget = "https://vids.google.com/video/changed-doc/edit";
    expect(await f.send(handoff())).toMatchObject({ success: false, status: "needs_review" });
    expect(f.downloads.download).not.toHaveBeenCalled();
    expect(await f.handler.get()).toMatchObject({ state: "needs_review", reason: "connection_changed" });
  });

  it("retains a known operation for continuation and treats a lost handoff response as observable, never replayable", async () => {
    const f = fixture();
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    await f.handler.arm();
    await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "needs_review", operationName: "operations/op_slow" });
    expect(await f.handler.get()).toMatchObject({ state: "needs_review", operationName: "operations/op_slow" });
    // The live helper can continue polling this same operation with its in-memory token.
    expect(await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId })).toMatchObject({ success: false });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "preparing", operationName: "operations/op_slow" });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "prepared", operationName: "operations/op_slow" });

    // Simulate the sender losing the callback after dispatch. Durable state owns the exact ID.
    f.listener(handoff(), sender, () => undefined);
    await vi.waitFor(async () => expect(await f.handler.get()).toMatchObject({ state: "downloading", downloadId: 44 }));
    expect(await f.handler.reconcile()).toMatchObject({ state: "downloading", downloadId: 44 });
    expect(await f.send(handoff())).toMatchObject({ success: true, downloadId: 44 });
    expect(f.downloads.download).toHaveBeenCalledTimes(1);
  });

  it("marks a dispatch with no returned Chrome ID for review and refuses replay", async () => {
    const f = fixture();
    f.downloads.download.mockRejectedValueOnce(new Error("response lost after dispatch"));
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    await f.handler.arm();
    await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "prepared" });
    expect(await f.send(handoff())).toMatchObject({ success: false, status: "needs_review" });
    expect(await f.handler.get()).toMatchObject({ state: "needs_review", reason: "dispatch_uncertain" });
    expect(await f.send(handoff())).toMatchObject({ success: false, status: "needs_review" });
    expect(f.downloads.download).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent duplicate handoffs before Chrome returns the ID", async () => {
    const f = fixture();
    let finish!: (id: number) => void;
    f.downloads.download.mockImplementation(() => new Promise<number>((resolve) => { finish = resolve; }));
    await f.preferences.setVidsTimelineReadiness(f.readiness);
    await f.handler.arm();
    await f.send({ type: "HOSTED_MP4_NONCE_CHALLENGE", expectedFileId: documentId });
    await f.send({ type: "HOSTED_MP4_PREPARATION_STATUS", requestNonce: nonce, documentId, phase: "prepared" });
    const first = f.send(handoff());
    await vi.waitFor(() => expect(f.downloads.download).toHaveBeenCalledTimes(1));
    expect(await f.send(handoff())).toMatchObject({ success: false, status: "needs_review" });
    finish(45);
    expect(await first).toMatchObject({ success: true, status: "downloading", downloadId: 45 });
    expect(f.downloads.download).toHaveBeenCalledTimes(1);
  });
});
