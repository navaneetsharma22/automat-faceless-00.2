import {
  isValidatedPreparedUri,
  type VidsDownloadAttempt,
} from "../../domain/media/combinedExport";
import type { ChromePreferenceRepository, ExtensionRepositories } from "../../storage/repositories";
import { parseProviderRoute } from "../../platforms/shared/providerRoute";
import {
  HostedMp4DownloadHandoffSchema,
  HostedMp4NonceChallengeSchema,
  HostedMp4PreparationStatusSchema,
} from "../../shared/schemas";
import { isAuthorizedHostedHelperSender, type HostedHelperSender } from "../../shared/utils/hostedMp4Handoff";
import type { createVidsDownloadManager } from "../downloadManager";

type DownloadManager = ReturnType<typeof createVidsDownloadManager>;
type ExternalResponse = (value: unknown) => void;

function createSecret(bytes = 32): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return Array.from(raw, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createVidsDownloadHandler(input: {
  extensionId: string;
  preferences: ChromePreferenceRepository;
  repositories: ExtensionRepositories;
  manager: DownloadManager;
  revalidate: () => Promise<unknown>;
  now?: () => number;
  makeAttemptId?: () => string;
  makeNonce?: () => string;
}) {
  const now = input.now ?? Date.now;
  const makeId = input.makeAttemptId ?? (() => createSecret(16));
  const makeNonce = input.makeNonce ?? (() => createSecret(32));
  const dispatching = new Set<string>();
  const bindingClaims = new Set<string>();

  async function currentDocument(expectedId: string) {
    const readiness = await input.preferences.getVidsTimelineReadiness();
    const result = await input.revalidate() as {
      ok?: boolean; state?: string; tab?: { id?: number; provider?: string; projectId?: string; canonicalTarget?: string };
    };
    const selected = await input.repositories.getSelectedTarget("Vids");
    const binding = selected?.verificationBinding;
    const route = parseProviderRoute(result?.tab?.canonicalTarget ?? "");
    if (!readiness || readiness.status !== "user_attested" || readiness.documentId !== expectedId ||
      !result?.ok || result.state !== "verified" || !result.tab || result.tab.provider !== "Vids" ||
      result.tab.projectId !== expectedId || !route || route.provider !== "Vids" || route.projectId !== expectedId ||
      route.canonicalTarget !== readiness.canonicalTarget || result.tab.canonicalTarget !== readiness.canonicalTarget ||
      result.tab.id !== readiness.tabId || !selected || selected.verification !== "verified" ||
      selected.connectionState !== "verified" || selected.tabId !== readiness.tabId ||
      selected.canonicalTarget !== readiness.canonicalTarget || !binding || binding.provider !== "Vids" ||
      binding.projectId !== expectedId || binding.tabId !== readiness.tabId || binding.canonicalTarget !== readiness.canonicalTarget) {
      return undefined;
    }
    return { readiness, route, tabId: result.tab.id };
  }

  function publicAttempt(attempt: VidsDownloadAttempt | undefined) {
    if (!attempt) return undefined;
    const publicValue = { ...attempt };
    delete publicValue.requestNonce;
    delete publicValue.consumedNonceHash;
    delete publicValue.helperTabId;
    delete publicValue.helperDocumentId;
    return publicValue;
  }

  function isBoundHelperDocument(attempt: VidsDownloadAttempt, sender: HostedHelperSender) {
    return attempt.helperTabId === sender.tab?.id && attempt.helperDocumentId === sender.documentId;
  }

  async function arm() {
    const readiness = await input.preferences.getVidsTimelineReadiness();
    if (!readiness || readiness.status !== "user_attested") throw new Error("vids_timeline_not_ready");
    const verified = await currentDocument(readiness.documentId);
    if (!verified) throw new Error("vids_timeline_document_mismatch");
    const previous = await input.preferences.getVidsDownloadAttempt();
    if (previous?.state === "ready" && previous.documentId === readiness.documentId && previous.requestNonce) {
      return { attempt: publicAttempt(previous), requestNonce: previous.requestNonce };
    }
    if (previous && ["preparing_mp4", "prepared", "dispatching", "downloading", "interrupted", "needs_review"].includes(previous.state)) {
      if (previous.documentId === readiness.documentId && previous.requestNonce && ["preparing_mp4", "prepared"].includes(previous.state))
        return { attempt: publicAttempt(previous), requestNonce: previous.requestNonce };
      throw new Error("vids_previous_attempt_needs_review");
    }
    const at = now();
    const attempt: VidsDownloadAttempt = {
      attemptId: makeId(), documentId: readiness.documentId, canonicalTarget: readiness.canonicalTarget,
      tabId: readiness.tabId, state: "ready", createdAt: at, updatedAt: at, requestNonce: makeNonce(),
    };
    await input.preferences.setVidsDownloadAttempt(attempt);
    return { attempt: publicAttempt(attempt), requestNonce: attempt.requestNonce };
  }

  async function get() {
    return publicAttempt(await input.preferences.getVidsDownloadAttempt());
  }

  async function acceptExternalMessage(message: unknown, sender: HostedHelperSender) {
    if (!isAuthorizedHostedHelperSender(sender, input.extensionId)) return { success: false, status: "rejected" };
    const challenge = HostedMp4NonceChallengeSchema.safeParse(message);
    if (challenge.success) {
      const attempt = await input.preferences.getVidsDownloadAttempt();
      const readiness = await input.preferences.getVidsTimelineReadiness();
      const selected = await input.repositories.getSelectedTarget("Vids");
      const binding = selected?.verificationBinding;
      if (!attempt || !readiness || !selected || !binding || attempt.documentId !== challenge.data.expectedFileId ||
        readiness.status !== "user_attested" || readiness.documentId !== attempt.documentId ||
        readiness.canonicalTarget !== attempt.canonicalTarget || readiness.tabId !== attempt.tabId ||
        selected.verification !== "verified" || selected.connectionState !== "verified" ||
        selected.tabId !== attempt.tabId || selected.canonicalTarget !== attempt.canonicalTarget ||
        binding.provider !== "Vids" || binding.projectId !== attempt.documentId || binding.tabId !== attempt.tabId ||
        binding.canonicalTarget !== attempt.canonicalTarget ||
        !attempt.requestNonce || attempt.state !== "ready") {
        return { success: false, status: "rejected" };
      }
      if (attempt.helperTabId !== undefined || attempt.helperDocumentId !== undefined) {
        if (!isBoundHelperDocument(attempt, sender)) return { success: false, status: "rejected" };
      } else {
        if (bindingClaims.has(attempt.attemptId)) return { success: false, status: "rejected" };
        bindingClaims.add(attempt.attemptId);
        try {
          const latest = await input.preferences.getVidsDownloadAttempt();
          if (!latest || latest.attemptId !== attempt.attemptId || latest.state !== "ready" ||
            latest.requestNonce !== attempt.requestNonce ||
            (latest.helperTabId !== undefined && !isBoundHelperDocument(latest, sender))) {
            return { success: false, status: "rejected" };
          }
          await input.preferences.setVidsDownloadAttempt({
            ...latest,
            helperTabId: sender.tab!.id!,
            helperDocumentId: sender.documentId!,
          });
        } finally {
          bindingClaims.delete(attempt.attemptId);
        }
      }
      return { success: true, status: "armed", requestNonce: attempt.requestNonce };
    }

    const preparation = HostedMp4PreparationStatusSchema.safeParse(message);
    if (preparation.success) {
      const attempt = await input.preferences.getVidsDownloadAttempt();
      if (!attempt || !isBoundHelperDocument(attempt, sender) || attempt.requestNonce !== preparation.data.requestNonce || attempt.documentId !== preparation.data.documentId) {
        return { success: false, status: "rejected" };
      }
      const state: VidsDownloadAttempt["state"] = preparation.data.phase === "preparing"
        ? "preparing_mp4"
        : preparation.data.phase === "prepared" ? "prepared" : "needs_review";
      await input.preferences.setVidsDownloadAttempt({
        ...attempt,
        state,
        ...(preparation.data.operationName ? { operationName: preparation.data.operationName } : {}),
        ...(preparation.data.phase === "needs_review" ? { reason: "operation_observation_lost" as const } : { reason: undefined }),
        updatedAt: now(),
      });
      return { success: true, status: state };
    }

    const parsed = HostedMp4DownloadHandoffSchema.safeParse(message);
    if (!parsed.success || !isValidatedPreparedUri(parsed.data.preparedUri)) {
      return { success: false, status: "rejected" };
    }
    const payload = parsed.data;
    const attempt = await input.preferences.getVidsDownloadAttempt();
    if (!attempt || !isBoundHelperDocument(attempt, sender)) return { success: false, status: "rejected" };
    const requestHash = await digest(payload.requestNonce);
    if (attempt.consumedNonceHash === requestHash) {
      if (attempt.downloadId !== undefined && ["downloading", "chrome_complete", "interrupted"].includes(attempt.state)) {
        return { success: true, status: attempt.state, attemptId: attempt.attemptId, documentId: attempt.documentId, downloadId: attempt.downloadId };
      }
      return { success: false, status: "needs_review", attemptId: attempt.attemptId, documentId: attempt.documentId };
    }
    if (attempt.requestNonce !== payload.requestNonce || attempt.state !== "prepared" || dispatching.has(attempt.attemptId) ||
      payload.selectedFileId !== attempt.documentId || payload.expectedFileId !== attempt.documentId ||
      payload.metadataVerified !== true || payload.mimeType !== "application/vnd.google-apps.vid" ||
      payload.canDownload !== true || payload.expectedMatch !== true || payload.preparedUriValidated !== true ||
      payload.resourceKeyPresent !== false || payload.wholeDocumentAcknowledged !== true) {
      return { success: false, status: "rejected" };
    }
    dispatching.add(attempt.attemptId);
    try {
      const current = await currentDocument(attempt.documentId);
      if (!current || current.readiness.documentId !== attempt.documentId || current.route.canonicalTarget !== attempt.canonicalTarget) {
        const stale = { ...attempt, state: "needs_review" as const, reason: "connection_changed" as const, requestNonce: undefined, updatedAt: now() };
        await input.preferences.setVidsDownloadAttempt(stale);
        return { success: false, status: "needs_review", attemptId: attempt.attemptId, documentId: attempt.documentId };
      }
      const consumed: VidsDownloadAttempt = {
        ...attempt, state: "dispatching", requestNonce: undefined, consumedNonceHash: requestHash, updatedAt: now(),
      };
      await input.preferences.setVidsDownloadAttempt(consumed);
      const outcome = await input.manager.dispatch(consumed, payload.preparedUri);
      if (outcome.status !== "downloading" || !outcome.attempt || outcome.downloadId === undefined) {
        return { success: false, status: "needs_review", attemptId: attempt.attemptId, documentId: attempt.documentId };
      }
      return { success: true, status: "downloading", attemptId: outcome.attempt.attemptId, documentId: outcome.attempt.documentId, downloadId: outcome.downloadId };
    } finally {
      dispatching.delete(attempt.attemptId);
    }
  }

  return { arm, get, reconcile: async () => publicAttempt(await input.manager.reconcile()), acceptExternalMessage };
}

export function createHostedVidsDownloadListener(handler: ReturnType<typeof createVidsDownloadHandler>) {
  return (message: unknown, sender: HostedHelperSender, sendResponse: ExternalResponse) => {
    const type = message && typeof message === "object" && "type" in message
      ? (message as { type?: unknown }).type
      : undefined;
    if (type !== "HOSTED_MP4_NONCE_CHALLENGE" && type !== "HOSTED_MP4_PREPARATION_STATUS" && type !== "HOSTED_MP4_DOWNLOAD") return false;
    void handler.acceptExternalMessage(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ success: false, status: "needs_review" }));
    return true;
  };
}
