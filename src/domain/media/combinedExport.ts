/** Parse the accepted document ID and URL forms used by the hosted Vids helper. */
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const VIDS_URL_HOSTS = new Set(["docs.google.com", "vids.google.com"]);

export type ExpectedDocumentId = {
  supplied: boolean;
  valid: boolean;
  fileId?: string;
};

export function parseExpectedDocumentId(rawValue: unknown): ExpectedDocumentId {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) return { supplied: false, valid: true };
  if (FILE_ID_PATTERN.test(value)) return { supplied: true, valid: true, fileId: value };
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !VIDS_URL_HOSTS.has(url.hostname)) {
      return { supplied: true, valid: false };
    }
    const pattern = url.hostname === "docs.google.com"
      ? /^\/videos\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{1,200})(?:\/|$)/i
      : /^\/(?:videos\/(?:u\/\d+\/)?d\/|video\/|d\/)([A-Za-z0-9_-]{1,200})(?:\/|$)/i;
    const match = pattern.exec(url.pathname);
    return match
      ? { supplied: true, valid: true, fileId: match[1] }
      : { supplied: true, valid: false };
  } catch {
    return { supplied: true, valid: false };
  }
}

export type VidsTimelineReadiness = {
  status: "user_attested";
  documentId: string;
  canonicalTarget: string;
  tabId: number;
  sceneOrderConfirmed: true;
  documentSavedConfirmed: true;
  attestedAt: number;
};

export function createVidsTimelineReadiness(input: Omit<VidsTimelineReadiness, "status" | "attestedAt">, now = Date.now()): VidsTimelineReadiness {
  return { ...input, status: "user_attested", attestedAt: now };
}

export function readinessMatchesDocument(readiness: VidsTimelineReadiness | undefined, documentId: string): boolean {
  return Boolean(readiness && readiness.documentId === documentId);
}

/** A synchronous guard also blocks two rapid clicks before React can rerender. */
export function createSubmissionGuard() {
  let pending = false;
  return {
    begin() {
      if (pending) return false;
      pending = true;
      return true;
    },
    end() { pending = false; },
  };
}

export type VidsDownloadState =
  | "ready"
  | "preparing_mp4"
  | "prepared"
  | "dispatching"
  | "downloading"
  | "chrome_complete"
  | "interrupted"
  | "needs_review";

export type VidsDownloadAttempt = {
  attemptId: string;
  documentId: string;
  canonicalTarget: string;
  tabId: number;
  state: VidsDownloadState;
  createdAt: number;
  updatedAt: number;
  requestNonce?: string;
  consumedNonceHash?: string;
  operationName?: string;
  downloadId?: number;
  sourcePath?: string;
  helperTabId?: number;
  helperDocumentId?: string;
  reason?: "dispatch_uncertain" | "operation_observation_lost" | "connection_changed" | "download_interrupted";
};

/** Null is the explicit wire representation for a successful status lookup with no attempt. */
export function parseVidsDownloadStatus(value: unknown): VidsDownloadAttempt | undefined {
  if (value === null) return undefined;
  if (!value || typeof value !== "object") throw new Error("vids_download_status_invalid");
  const attempt = value as Partial<VidsDownloadAttempt>;
  if (typeof attempt.attemptId !== "string" || !attempt.attemptId ||
    typeof attempt.documentId !== "string" || !attempt.documentId ||
    typeof attempt.canonicalTarget !== "string" || !attempt.canonicalTarget ||
    !Number.isInteger(attempt.tabId) || attempt.tabId! < 0 ||
    !["ready", "preparing_mp4", "prepared", "dispatching", "downloading", "chrome_complete", "interrupted", "needs_review"].includes(attempt.state ?? "") ||
    !Number.isFinite(attempt.createdAt) || !Number.isFinite(attempt.updatedAt) ||
    (attempt.downloadId !== undefined && (!Number.isInteger(attempt.downloadId) || attempt.downloadId < 0)) ||
    (["requestNonce", "consumedNonceHash", "operationName", "sourcePath", "helperDocumentId"] as const)
      .some((key) => attempt[key] !== undefined && typeof attempt[key] !== "string") ||
    (attempt.helperTabId !== undefined && (!Number.isInteger(attempt.helperTabId) || attempt.helperTabId < 0)) ||
    (attempt.reason !== undefined && !["dispatch_uncertain", "operation_observation_lost", "connection_changed", "download_interrupted"].includes(attempt.reason))) {
    throw new Error("vids_download_status_invalid");
  }
  return attempt as VidsDownloadAttempt;
}

/** Validate a prepared Drive URI without exposing or normalizing its query data. */
export function isValidatedPreparedUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) return false;
  try {
    const url = new URL(value);
    const googleHost = ["googleapis.com", "google.com", "googleusercontent.com"].some(
      (suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`),
    );
    return url.protocol === "https:" && googleHost && !url.username && !url.password && !url.port && !url.hash;
  } catch {
    return false;
  }
}

export function buildVidsDownloadFilename(documentId: string, attemptId: string): string {
  const safeDocumentId = FILE_ID_PATTERN.test(documentId) ? documentId : "vids-document";
  const safeAttemptId = /^[A-Za-z0-9_-]{1,100}$/.test(attemptId) ? attemptId : "attempt";
  return `Vids/${safeDocumentId}-${safeAttemptId}.mp4`;
}
