/* global URL, URLSearchParams, setTimeout */

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/** Accept only the exact extension launch query emitted by the Downloads panel. */
export function parseExtensionLaunchConfig(search, hash = '') {
  if (typeof search !== 'string' || typeof hash !== 'string' || hash !== '') return undefined;
  const params = new URLSearchParams(search);
  if ([...params.keys()].length !== 1 || params.getAll('extensionId').length !== 1) return undefined;
  const extensionId = params.get('extensionId');
  return typeof extensionId === 'string' && CHROME_EXTENSION_ID_PATTERN.test(extensionId)
    ? extensionId
    : undefined;
}
export const VIDS_MIME_TYPE = 'application/vnd.google-apps.vid';
export const MP4_MIME_TYPE = 'video/mp4';
export const PICKER_MODE_VIDS_ONLY = 'vids-only';
export const PICKER_MODE_ALL_TYPES_DIAGNOSTIC = 'all-types-diagnostic';

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const VIDS_URL_HOSTS = new Set(['docs.google.com', 'vids.google.com']);
const PICKER_CALLBACK_CATEGORIES = new Set([
  'picked',
  'cancel',
  'error',
  'nonterminal',
  'missing_action',
]);

export function getPickerViewConfiguration(mode) {
  const diagnostic = mode === PICKER_MODE_ALL_TYPES_DIAGNOSTIC;
  return {
    viewId: 'docs',
    viewMode: 'list',
    mimeTypes: diagnostic ? undefined : VIDS_MIME_TYPE,
    selectableMimeTypes: diagnostic ? undefined : VIDS_MIME_TYPE,
    maxItems: 1,
  };
}

export function evaluateVidsMetadata(metadata, selectedFileId, expectedFileId) {
  if (
    metadata?.id !== selectedFileId ||
    typeof metadata.mimeType !== 'string' ||
    typeof metadata.capabilities?.canDownload !== 'boolean'
  ) {
    return { valid: false, status: 'metadata_failed' };
  }

  const expectedMatch = expectedFileId === undefined ? undefined : expectedFileId === metadata.id;
  const status =
    metadata.mimeType !== VIDS_MIME_TYPE
      ? 'wrong_type'
      : expectedMatch === false
        ? 'mismatch'
        : 'verified';
  return {
    valid: true,
    status,
    mimeType: metadata.mimeType,
    canDownload: metadata.capabilities.canDownload,
    expectedMatch,
    resourceKeyPresent:
      Object.prototype.hasOwnProperty.call(metadata, 'resourceKey') &&
      metadata.resourceKey !== undefined &&
      metadata.resourceKey !== null,
    resourceKey:
      typeof metadata.resourceKey === 'string' &&
      /^[A-Za-z0-9_-]{1,200}$/.test(metadata.resourceKey)
        ? metadata.resourceKey
        : undefined,
  };
}

export function canPrepareTwoClipProof({ selectedProof, expectedFileId, attestations }) {
  return Boolean(
    selectedProof?.status === 'verified' &&
    selectedProof.mimeType === VIDS_MIME_TYPE &&
    selectedProof.canDownload === true &&
    selectedProof.expectedMatch === true &&
    typeof expectedFileId === 'string' &&
    expectedFileId.length > 0 &&
    selectedProof.fileId === expectedFileId &&
    attestations?.order === true &&
    attestations?.saved === true &&
    attestations?.noTransitionsOrGaps === true,
  );
}

export function buildFilesDownloadUrl(fileId) {
  if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) return undefined;
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/download`,
  );
  url.searchParams.set('mimeType', MP4_MIME_TYPE);
  return url;
}

export function buildOperationGetUrl(operationName) {
  if (
    typeof operationName !== 'string' ||
    !/^operations\/[A-Za-z0-9_-]{1,200}$/.test(operationName)
  ) {
    return undefined;
  }
  const operationId = operationName.slice('operations/'.length);
  return new URL(
    `https://www.googleapis.com/drive/v3/operations/${encodeURIComponent(operationId)}`,
  );
}

export function buildDriveResourceKeysHeader(fileId, resourceKey) {
  if (
    typeof fileId !== 'string' ||
    !FILE_ID_PATTERN.test(fileId) ||
    typeof resourceKey !== 'string' ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(resourceKey)
  ) {
    return undefined;
  }
  return `${fileId}/${resourceKey}`;
}

const GOOGLE_DOWNLOAD_HOST_SUFFIXES = ['googleapis.com', 'google.com', 'googleusercontent.com'];

export function validateGoogleDownloadUri(rawUri) {
  if (typeof rawUri !== 'string' || rawUri.length === 0 || rawUri.length > 8192) return undefined;
  try {
    const url = new URL(rawUri);
    const googleHost = GOOGLE_DOWNLOAD_HOST_SUFFIXES.some(
      (suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`),
    );
    if (
      url.protocol !== 'https:' ||
      !googleHost ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export function getPreparedDownloadDiagnostics(downloadUri, resourceKey, resourceKeyPresent) {
  const preparedUriPresent = downloadUri !== undefined && downloadUri !== null;
  const rawUri = downloadUri instanceof URL ? downloadUri.href : downloadUri;
  const hasResourceKey =
    resourceKeyPresent ?? (typeof resourceKey === 'string' && resourceKey.length > 0);
  return {
    prepared_uri_present: preparedUriPresent,
    prepared_uri_validated: Boolean(preparedUriPresent && validateGoogleDownloadUri(rawUri)),
    resource_key_present: Boolean(preparedUriPresent && hasResourceKey),
  };
}

export function canOpenPreparedDownloadInBrowser(diagnostics) {
  return Boolean(
    diagnostics?.prepared_uri_present === true &&
    diagnostics?.prepared_uri_validated === true &&
    diagnostics?.resource_key_present === false,
  );
}

export function buildHostedMp4HandoffPayload({
  requestNonce,
  selectedProof,
  expectedFileId,
  preparedUri,
  preparedUriValidated,
  resourceKeyPresent,
  wholeDocumentAcknowledged,
}) {
  if (
    typeof requestNonce !== 'string' ||
    !/^[A-Za-z0-9_-]{40,100}$/.test(requestNonce) ||
    selectedProof?.status !== 'verified' ||
    selectedProof?.mimeType !== VIDS_MIME_TYPE ||
    selectedProof?.canDownload !== true ||
    selectedProof?.expectedMatch !== true ||
    selectedProof?.fileId !== expectedFileId ||
    preparedUriValidated !== true ||
    resourceKeyPresent !== false ||
    wholeDocumentAcknowledged !== true ||
    !validateGoogleDownloadUri(preparedUri)
  ) {
    return undefined;
  }
  return {
    type: 'HOSTED_MP4_DOWNLOAD',
    requestNonce,
    selectedFileId: selectedProof.fileId,
    expectedFileId,
    metadataVerified: true,
    mimeType: VIDS_MIME_TYPE,
    canDownload: true,
    expectedMatch: true,
    preparedUriValidated: true,
    resourceKeyPresent: false,
    wholeDocumentAcknowledged: true,
    preparedUri,
  };
}

export function buildHostedVidsReviewHandoffPayload({
  requestNonce,
  selectedProof,
  expectedFileId,
  preparedUri,
  preparedUriValidated,
  resourceKeyPresent,
  wholeDocumentAcknowledged,
}) {
  const standalonePayload = buildHostedMp4HandoffPayload({
    requestNonce,
    selectedProof,
    expectedFileId,
    preparedUri,
    preparedUriValidated,
    resourceKeyPresent,
    wholeDocumentAcknowledged,
  });
  return standalonePayload
    ? { ...standalonePayload, type: 'HOSTED_VIDS_REVIEW_DOWNLOAD' }
    : undefined;
}

export function evaluateDownloadOperation(operation) {
  if (!operation || typeof operation !== 'object') return { state: 'invalid_operation' };
  const resourceKey =
    typeof operation.metadata?.resourceKey === 'string' &&
    /^[A-Za-z0-9_-]{1,200}$/.test(operation.metadata.resourceKey)
      ? operation.metadata.resourceKey
      : undefined;
  const resourceKeyPresent =
    Boolean(operation.metadata) &&
    Object.prototype.hasOwnProperty.call(operation.metadata, 'resourceKey') &&
    operation.metadata.resourceKey !== undefined &&
    operation.metadata.resourceKey !== null;
  if (operation.done === true) {
    if (operation.error) {
      const code = Number(operation.error.code);
      return {
        state: 'error',
        category:
          code === 16
            ? 'authorization_expired'
            : code === 8
              ? 'rate_limited'
              : code === 7
                ? 'access_denied'
                : 'operation_failed',
      };
    }
    const downloadUri = operation.response?.downloadUri;
    const validatedUri = validateGoogleDownloadUri(downloadUri);
    return validatedUri
      ? {
          state: 'ready',
          downloadUri: validatedUri,
          resourceKeyPresent,
          ...(resourceKey ? { resourceKey } : {}),
        }
      : { state: 'invalid_download_uri' };
  }
  if (operation.done === false || operation.done === null || operation.done === undefined) {
    return { state: 'pending', resourceKeyPresent, ...(resourceKey ? { resourceKey } : {}) };
  }
  return { state: 'invalid_operation' };
}

const PREPARATION_FAILURE_CODES = new Set([
  'authorization_expired',
  'access_denied',
  'api_or_file_access_denied',
  'selected_file_unavailable',
  'rate_limited',
  'google_api_unavailable',
  'api_request_rejected',
  'metadata_request_failed',
  'transport_unavailable',
  'transport_uncertain',
  'invalid_operation',
  'invalid_download_uri',
  'operation_failed',
  'operation_timeout',
  'api_error',
]);

/** Convert helper outcomes into fixed, safe worker status fields and user copy. */
export function classifyMp4PreparationFailure(stage, category) {
  const validStages = new Set([
    'files_download_response',
    'files_download_transport',
    'operation_response',
    'operation_poll',
    'operation_poll_timeout',
    'operation_result',
  ]);
  const safeStage = validStages.has(stage) ? stage : 'operation_response';
  const safeCode = PREPARATION_FAILURE_CODES.has(category) ? category : 'operation_failed';
  let reason;
  if (safeStage === 'files_download_response') {
    reason = ['google_api_unavailable', 'transport_unavailable', 'transport_uncertain'].includes(safeCode)
      ? 'preparation_outcome_uncertain'
      : 'preparation_rejected';
  } else if (safeStage === 'files_download_transport') {
    reason = 'preparation_outcome_uncertain';
  } else if (safeStage === 'operation_poll_timeout') {
    reason = 'operation_timeout';
  } else if (safeStage === 'operation_poll') {
    reason = 'operation_observation_lost';
  } else if (safeStage === 'operation_result' && safeCode === 'invalid_download_uri') {
    reason = 'invalid_download_uri';
  } else if (safeStage === 'operation_response' || safeCode === 'invalid_operation') {
    reason = 'invalid_operation';
  } else {
    reason = 'operation_failed';
  }
  const codeMessages = {
    authorization_expired: 'authorization expired',
    access_denied: 'Drive denied access',
    api_or_file_access_denied: 'Drive denied API or file access',
    selected_file_unavailable: 'the selected Vids document is unavailable',
    rate_limited: 'Drive rate limit reached',
    google_api_unavailable: 'Google Drive returned a server error',
    api_request_rejected: 'Drive rejected the request',
    metadata_request_failed: 'the Drive request failed',
    transport_unavailable: 'the response was not received',
    transport_uncertain: 'the response was not received',
    invalid_operation: 'Drive returned an invalid operation',
    invalid_download_uri: 'Drive returned an invalid download destination',
    operation_failed: 'the Drive operation failed',
    operation_timeout: 'operation polling timed out',
  };
  const stageMessages = {
    files_download_response: 'Drive responded to the preparation request',
    files_download_transport: 'the preparation request outcome is unknown',
    operation_response: 'the preparation operation response could not be validated',
    operation_poll: 'the existing Drive operation could not be checked',
    operation_poll_timeout: 'the existing Drive operation did not finish before the polling limit',
    operation_result: 'Drive returned a terminal operation result',
  };
  const message = reason === 'preparation_rejected'
    ? `${codeMessages[safeCode] || 'Drive rejected the request'}; no operation was accepted. Do not retry this attempt.`
    : reason === 'preparation_outcome_uncertain'
      ? 'Drive may have accepted the preparation request. Do not start another preparation; review this attempt.'
      : reason === 'operation_observation_lost'
        ? 'The existing operation could not be checked. Its ID is retained in Dashboard status; do not prepare again.'
        : reason === 'operation_timeout'
          ? 'Polling timed out. Continue checking the same operation; do not prepare again.'
          : `${stageMessages[safeStage]} (${codeMessages[safeCode] || 'unknown failure'}). Do not start another preparation.`;
  return { reason, failureStage: safeStage, failureCode: safeCode, message };
}

/** One POST per flow instance; polling timeout can only resume the saved operation. */
export function createMp4PreparationFlow({
  startDownload,
  pollOperation,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
  timeoutMs = 120000,
  onState,
}) {
  let preparationStarted = false;
  let operationName;
  let polling = false;
  let cancelled = false;

  function publish(state, category, stage) {
    onState?.(state, category, stage);
  }

  async function pollUntilDone() {
    if (cancelled) return { state: 'cancelled' };
    if (!operationName) return { state: 'no_operation' };
    if (polling) return { state: 'already_polling' };
    polling = true;
    const deadline = now() + timeoutMs;
    let delayMs = 10000;
    publish('polling', undefined, 'operation_poll');
    try {
      while (now() < deadline) {
        const waitMs = Math.min(delayMs, Math.max(0, deadline - now()));
        await wait(waitMs);
        if (cancelled) return { state: 'cancelled' };
        if (now() >= deadline) break;
        let result;
        try {
          result = await pollOperation(operationName);
        } catch {
          if (cancelled) return { state: 'cancelled' };
          publish('failed', 'transport_unavailable', 'operation_poll');
          return { state: 'error', category: 'transport_unavailable', stage: 'operation_poll' };
        }
        if (cancelled) return { state: 'cancelled' };
        if (!result?.ok) {
          if (result?.category === 'rate_limited') {
            delayMs = Math.min(delayMs * 2, 30000);
            continue;
          }
          publish('failed', result?.category || 'api_error', 'operation_poll');
          return { state: 'error', category: result?.category || 'api_error', stage: 'operation_poll' };
        }
        const outcome = evaluateDownloadOperation(result.operation);
        if (outcome.state === 'pending') {
          delayMs = Math.min(delayMs * 2, 30000);
          continue;
        }
        if (outcome.state === 'ready') {
          publish('ready', undefined, 'operation_result');
          return outcome;
        }
        const category = outcome.category || outcome.state;
        publish('failed', category, 'operation_result');
        return { state: 'error', category, stage: 'operation_result' };
      }
      publish('timeout', 'operation_timeout', 'operation_poll_timeout');
      return { state: 'timeout', operationName, category: 'operation_timeout', stage: 'operation_poll_timeout' };
    } finally {
      polling = false;
    }
  }

  return {
    async prepare(fileId) {
      if (cancelled) return { state: 'cancelled' };
      if (preparationStarted) return { state: 'already_started' };
      preparationStarted = true;
      publish('starting', undefined, 'files_download_response');
      let result;
      try {
        result = await startDownload(fileId);
      } catch {
        publish('failed', 'transport_uncertain', 'files_download_transport');
        return { state: 'error', category: 'transport_uncertain', stage: 'files_download_transport' };
      }
      if (cancelled) return { state: 'cancelled' };
      if (!result?.ok) {
        const category = result?.category || 'api_error';
        const stage = ['transport_unavailable', 'transport_uncertain'].includes(category)
          ? 'files_download_transport'
          : 'files_download_response';
        publish('failed', category, stage);
        return { state: 'error', category, stage };
      }
      const initial = evaluateDownloadOperation(result.operation);
      if (initial.state === 'ready') {
        publish('ready', undefined, 'operation_result');
        return initial;
      }
      if (initial.state !== 'pending') {
        const category = initial.category || initial.state;
        const stage = initial.state === 'invalid_operation' ? 'operation_response' : 'operation_result';
        publish('failed', category, stage);
        return { state: 'error', category, stage };
      }
      if (
        typeof result.operation.name !== 'string' ||
        !buildOperationGetUrl(result.operation.name)
      ) {
        publish('failed', 'invalid_operation', 'operation_response');
        return { state: 'error', category: 'invalid_operation', stage: 'operation_response' };
      }
      operationName = result.operation.name;
      return await pollUntilDone();
    },
    async continuePolling() {
      return await pollUntilDone();
    },
    cancel() {
      cancelled = true;
    },
    get operationName() {
      return operationName;
    },
    get preparationStarted() {
      return preparationStarted;
    },
  };
}

/**
 * Owns the Picker callback lifecycle. Once PICKED arrives, metadata verification
 * owns cleanup and later Picker callbacks cannot interrupt that operation.
 */
export function createPickerCallbackLifecycle({
  actions,
  onCategory,
  onCancel,
  onError,
  onPicked,
}) {
  let state = 'open';

  return (action, eventData) => {
    let category = 'nonterminal';
    if (action === undefined || action === null) {
      category = 'missing_action';
    } else if (actions?.cancel !== undefined && action === actions.cancel) {
      category = 'cancel';
    } else if (actions?.error !== undefined && action === actions.error) {
      category = 'error';
    } else if (actions?.picked !== undefined && action === actions.picked) {
      category = 'picked';
    }

    if (PICKER_CALLBACK_CATEGORIES.has(category)) onCategory?.(category);
    if (state !== 'open') return;

    if (category === 'cancel') {
      state = 'terminal';
      onCancel?.();
    } else if (category === 'error') {
      state = 'terminal';
      onError?.();
    } else if (category === 'picked') {
      state = 'picked';
      onPicked?.(eventData);
    }
  };
}

export function parseExpectedDocumentId(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return { supplied: false, valid: true, fileId: undefined };

  if (FILE_ID_PATTERN.test(value)) {
    return { supplied: true, valid: true, fileId: value };
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !VIDS_URL_HOSTS.has(url.hostname)) {
      return { supplied: true, valid: false, fileId: undefined };
    }
    const pattern =
      url.hostname === 'docs.google.com'
        ? /^\/videos\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{1,200})(?:\/|$)/i
        : /^\/(?:videos\/(?:u\/\d+\/)?d\/|d\/)([A-Za-z0-9_-]{1,200})(?:\/|$)/i;
    const match = url.pathname.match(pattern);
    return match
      ? { supplied: true, valid: true, fileId: match[1] }
      : { supplied: true, valid: false, fileId: undefined };
  } catch {
    return { supplied: true, valid: false, fileId: undefined };
  }
}

export function hasRequestedScope(tokenResponse, oauthApi) {
  return Boolean(
    tokenResponse?.access_token &&
    tokenResponse.scope &&
    oauthApi?.hasGrantedAllScopes?.(tokenResponse, DRIVE_FILE_SCOPE) &&
    tokenResponse.scope.split(/\s+/).includes(DRIVE_FILE_SCOPE),
  );
}

export function classifyDriveApiFailure(status) {
  if (status === 401) return 'authorization_expired';
  if (status === 403) return 'api_or_file_access_denied';
  if (status === 404) return 'selected_file_unavailable';
  if (status === 400) return 'api_request_rejected';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'google_api_unavailable';
  return 'metadata_request_failed';
}

export function classifyDownloadHttpFailure(status) {
  if (status === 401) return 'authorization_expired';
  if (status === 403) return 'access_denied';
  if (status === 404) return 'selected_file_unavailable';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'google_api_unavailable';
  return 'api_request_rejected';
}

export function classifyDriveDownloadFailure(status, body) {
  if (status === 403) {
    const reasons = Array.isArray(body?.error?.errors)
      ? body.error.errors.map((item) => item?.reason)
      : [];
    if (
      reasons.some((reason) => reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')
    ) {
      return 'rate_limited';
    }
  }
  return classifyDownloadHttpFailure(status);
}

export function evaluateMp4BytesResponse(response, blob) {
  if (!response?.ok)
    return { state: 'error', category: classifyDownloadHttpFailure(response?.status || 0) };
  if (
    response.headers?.get?.('content-type')?.split(';')[0].trim().toLowerCase() !== MP4_MIME_TYPE
  ) {
    return { state: 'error', category: 'unexpected_content_type' };
  }
  if (!blob || blob.size <= 0) return { state: 'error', category: 'empty_response' };
  return { state: 'received', byteCount: blob.size };
}
