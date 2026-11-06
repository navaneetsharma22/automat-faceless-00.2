import { buildVidsDownloadFilename, type VidsDownloadAttempt } from "../domain/media/combinedExport";
import type { ChromePreferenceRepository } from "../storage/repositories";

export type ChromeDownloadItem = { id: number; state?: string; error?: string; filename?: string };
export type ChromeDownloadDelta = { id: number; state?: { current?: string } };

export function createVidsDownloadManager(input: {
  preferences: ChromePreferenceRepository;
  downloads: {
    download: (options: { url: string; filename: string; saveAs: false; conflictAction: "uniquify" }) => Promise<number>;
    search: (query: { id: number }) => Promise<ChromeDownloadItem[]>;
  };
  now?: () => number;
}) {
  const now = input.now ?? Date.now;

  async function update(state: VidsDownloadAttempt["state"], patch: Partial<VidsDownloadAttempt> = {}) {
    const current = await input.preferences.getVidsDownloadAttempt();
    if (!current) return undefined;
    const next = { ...current, ...patch, state, updatedAt: now() };
    await input.preferences.setVidsDownloadAttempt(next);
    return next;
  }

  async function observe(downloadId: number) {
    const attempt = await input.preferences.getVidsDownloadAttempt();
    if (!attempt || attempt.downloadId !== downloadId) return attempt;
    let results: ChromeDownloadItem[];
    try { results = await input.downloads.search({ id: downloadId }); }
    catch { return attempt; }
    const item = results.find((candidate) => candidate.id === downloadId);
    if (!item) return attempt;
    if (item.state === "complete") return update("chrome_complete", { reason: undefined, ...(item.filename ? { sourcePath: item.filename } : {}) });
    if (item.state === "interrupted") return update("interrupted", { reason: "download_interrupted" });
    if (item.state === "in_progress") return update("downloading");
    return attempt;
  }

  return {
    async dispatch(attempt: VidsDownloadAttempt, url: string) {
      const dispatching = { ...attempt, state: "dispatching" as const, updatedAt: now() };
      await input.preferences.setVidsDownloadAttempt(dispatching);
      try {
        const downloadId = await input.downloads.download({
          url,
          filename: buildVidsDownloadFilename(attempt.documentId, attempt.attemptId),
          saveAs: false,
          conflictAction: "uniquify",
        });
        const current = await input.preferences.getVidsDownloadAttempt();
        if (!current || current.attemptId !== attempt.attemptId) return { status: "needs_review" as const };
        const accepted = { ...current, state: "downloading" as const, downloadId, updatedAt: now(), requestNonce: undefined };
        await input.preferences.setVidsDownloadAttempt(accepted);
        return { status: "downloading" as const, attempt: accepted, downloadId };
      } catch {
        // The API may have accepted the request before the response was lost.
        // Never replay it; reconcile manually because there is no exact ID.
        const current = await input.preferences.getVidsDownloadAttempt();
        if (current?.attemptId === attempt.attemptId) {
          await input.preferences.setVidsDownloadAttempt({
            ...current, state: "needs_review", reason: "dispatch_uncertain", requestNonce: undefined, updatedAt: now(),
          });
        }
        return { status: "needs_review" as const };
      }
    },
    observe,
    async onChanged(delta: ChromeDownloadDelta) {
      if (typeof delta.id === "number") await observe(delta.id);
    },
    async reconcile() {
      const attempt = await input.preferences.getVidsDownloadAttempt();
      if (!attempt) return undefined;
      if (attempt.state === "dispatching") {
        return update("needs_review", { reason: "dispatch_uncertain", requestNonce: undefined });
      }
      if (attempt.downloadId !== undefined && ["downloading", "interrupted"].includes(attempt.state)) {
        return observe(attempt.downloadId);
      }
      return attempt;
    },
  };
}
