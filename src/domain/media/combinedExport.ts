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
  reason?: "dispatch_uncertain" | "operation_observation_lost" | "connection_changed" | "download_interrupted"
    | "preparation_rejected" | "preparation_outcome_uncertain" | "operation_timeout" | "operation_failed"
    | "invalid_download_uri" | "invalid_operation";
  failureStage?: "files_download_response" | "files_download_transport" | "operation_response"
    | "operation_poll" | "operation_poll_timeout" | "operation_result";
  failureCode?: "authorization_expired" | "access_denied" | "api_or_file_access_denied"
    | "selected_file_unavailable" | "rate_limited" | "google_api_unavailable" | "api_request_rejected"
    | "metadata_request_failed" | "transport_unavailable" | "transport_uncertain" | "invalid_operation"
    | "invalid_download_uri" | "operation_failed" | "operation_timeout" | "api_error";
  priorAttempts?: VidsPriorAttempt[];
};

/** Sanitized historical snapshot; transient nonce and helper-document bindings are deliberately excluded. */
export type VidsPriorAttempt = Pick<VidsDownloadAttempt,
  "attemptId" | "documentId" | "canonicalTarget" | "tabId" | "state" | "createdAt" | "updatedAt" |
  "operationName" | "downloadId" | "sourcePath" | "reason" | "failureStage" | "failureCode"> & {
    archivedAt: number;
    archiveReason: "new_attempt_after_unknown_outcome";
  };

/** Null is the explicit wire representation for a successful status lookup with no attempt. */
export function parseVidsDownloadStatus(value: unknown): VidsDownloadAttempt | undefined {
  if (value === null) return undefined;
  if (!value || typeof value !== "object") throw new Error("vids_download_status_invalid");
  const attempt = value as Partial<VidsDownloadAttempt>;
  const priorAttemptsValid = attempt.priorAttempts === undefined ||
    (Array.isArray(attempt.priorAttempts) && attempt.priorAttempts.length <= 20 && attempt.priorAttempts.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const prior = entry as Partial<VidsPriorAttempt>;
      return typeof prior.attemptId === "string" && Boolean(prior.attemptId) &&
        typeof prior.documentId === "string" && Boolean(prior.documentId) &&
        typeof prior.canonicalTarget === "string" && Boolean(prior.canonicalTarget) &&
        Number.isInteger(prior.tabId) && prior.tabId! >= 0 &&
        ["ready", "preparing_mp4", "prepared", "dispatching", "downloading", "chrome_complete", "interrupted", "needs_review"].includes(prior.state ?? "") &&
        Number.isFinite(prior.createdAt) && Number.isFinite(prior.updatedAt) && Number.isFinite(prior.archivedAt) &&
        prior.archiveReason === "new_attempt_after_unknown_outcome" &&
        (prior.downloadId === undefined || (Number.isInteger(prior.downloadId) && prior.downloadId >= 0)) &&
        (["operationName", "sourcePath"] as const).every((key) => prior[key] === undefined || typeof prior[key] === "string") &&
        (prior.reason === undefined || ["dispatch_uncertain", "operation_observation_lost", "connection_changed", "download_interrupted", "preparation_rejected", "preparation_outcome_uncertain", "operation_timeout", "operation_failed", "invalid_download_uri", "invalid_operation"].includes(prior.reason)) &&
        (prior.failureStage === undefined || ["files_download_response", "files_download_transport", "operation_response", "operation_poll", "operation_poll_timeout", "operation_result"].includes(prior.failureStage)) &&
        (prior.failureCode === undefined || ["authorization_expired", "access_denied", "api_or_file_access_denied", "selected_file_unavailable", "rate_limited", "google_api_unavailable", "api_request_rejected", "metadata_request_failed", "transport_unavailable", "transport_uncertain", "invalid_operation", "invalid_download_uri", "operation_failed", "operation_timeout", "api_error"].includes(prior.failureCode));
    }));
  if (!priorAttemptsValid || typeof attempt.attemptId !== "string" || !attempt.attemptId ||
    typeof attempt.documentId !== "string" || !attempt.documentId ||
    typeof attempt.canonicalTarget !== "string" || !attempt.canonicalTarget ||
    !Number.isInteger(attempt.tabId) || attempt.tabId! < 0 ||
    !["ready", "preparing_mp4", "prepared", "dispatching", "downloading", "chrome_complete", "interrupted", "needs_review"].includes(attempt.state ?? "") ||
    !Number.isFinite(attempt.createdAt) || !Number.isFinite(attempt.updatedAt) ||
    (attempt.downloadId !== undefined && (!Number.isInteger(attempt.downloadId) || attempt.downloadId < 0)) ||
    (["requestNonce", "consumedNonceHash", "operationName", "sourcePath", "helperDocumentId"] as const)
      .some((key) => attempt[key] !== undefined && typeof attempt[key] !== "string") ||
    (attempt.helperTabId !== undefined && (!Number.isInteger(attempt.helperTabId) || attempt.helperTabId < 0)) ||
    (attempt.reason !== undefined && !["dispatch_uncertain", "operation_observation_lost", "connection_changed", "download_interrupted", "preparation_rejected", "preparation_outcome_uncertain", "operation_timeout", "operation_failed", "invalid_download_uri", "invalid_operation"].includes(attempt.reason)) ||
    (attempt.failureStage !== undefined && !["files_download_response", "files_download_transport", "operation_response", "operation_poll", "operation_poll_timeout", "operation_result"].includes(attempt.failureStage)) ||
    (attempt.failureCode !== undefined && !["authorization_expired", "access_denied", "api_or_file_access_denied", "selected_file_unavailable", "rate_limited", "google_api_unavailable", "api_request_rejected", "metadata_request_failed", "transport_unavailable", "transport_uncertain", "invalid_operation", "invalid_download_uri", "operation_failed", "operation_timeout", "api_error"].includes(attempt.failureCode))) {
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
