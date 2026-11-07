/* global AbortController, chrome, console, document, fetch, URL, window */

import { classifyDriveApiFailure, classifyDownloadHttpFailure, classifyDriveDownloadFailure, classifyMp4PreparationFailure, canOpenPreparedDownloadInBrowser, createMp4PreparationFlow, createPickerCallbackLifecycle, DRIVE_FILE_SCOPE, buildFilesDownloadUrl, canPrepareTwoClipProof, buildHostedMp4HandoffPayload, buildHostedVidsReviewHandoffPayload, buildDriveResourceKeysHeader, buildOperationGetUrl, evaluateDownloadOperation, evaluateMp4BytesResponse, evaluateVidsMetadata, getPickerViewConfiguration, getPreparedDownloadDiagnostics, hasRequestedScope, PICKER_MODE_ALL_TYPES_DIAGNOSTIC, PICKER_MODE_VIDS_ONLY, parseExpectedDocumentId, parseExtensionLaunchConfig, validateGoogleDownloadUri } from './logic.js';
import { SAVED_PICKER_KEY_STORAGE_KEY, SavedPickerKeyError, savedPickerKeyVault } from './saved-key.js';

const WEB_OAUTH_CLIENT_ID = '512586348088-scbsk1l4mfuvr524n0g88h9n1ovj6apg.apps.googleusercontent.com';
const CLOUD_PROJECT_NUMBER = '512586348088';
const EXTENSION_ID = parseExtensionLaunchConfig(window.location.search, window.location.hash) || '';
const EXTENSION_ID_VALID = Boolean(EXTENSION_ID);
const PICKER_LOAD_TIMEOUT_MS = 15000;
const METADATA_TIMEOUT_MS = 20000;
const DOWNLOAD_TIMEOUT_MS = 20000;
const METADATA_FIELDS = 'id,mimeType,capabilities(canDownload),resourceKey';
const MAX_PICKER_CALLBACK_DIAGNOSTICS = 16;
const PICKER_CALLBACK_CATEGORIES = new Set(['picked', 'cancel', 'error', 'nonterminal', 'missing_action']);

const form = document.querySelector('#proof-form');
const apiKeyInput = document.querySelector('#api-key');
const expectedInput = document.querySelector('#expected-document');
const startButton = document.querySelector('#start-proof');
const savedKeyDownload = document.querySelector('#saved-key-download');
const savedKeyDownloadStatus = document.querySelector('#saved-key-download-status');
const unlockPinLabel = document.querySelector('#unlock-pin-label');
const unlockPinInput = document.querySelector('#unlock-pin');
const unlockAttempts = document.querySelector('#unlock-attempts');
const unlockButton = document.querySelector('#unlock-saved-key');
const manualKeyEntry = document.querySelector('#manual-key-entry');
const savedKeySettingsStatus = document.querySelector('#saved-key-settings-status');
const savePickerKeyForm = document.querySelector('#save-picker-key-form');
const savedKeyExistingControls = document.querySelector('#saved-key-existing-controls');
const replacePickerKeyForm = document.querySelector('#replace-picker-key-form');
const lockSavedKeyButton = document.querySelector('#lock-saved-key');
const showReplaceSavedKeyButton = document.querySelector('#show-replace-saved-key');
const forgetSavedKeyButton = document.querySelector('#forget-saved-key');
let accessTokenInMemory = '';
let accessTokenExpiresAt = 0;
let apiKeyInMemory = '';
let apiKeySourceInMemory = '';
let savedRecordIdInMemory = null;
let savedKeyState = {
  exists: false,
  locked: false,
  attemptsRemaining: 0,
  recordId: null,
};
let replaceFormVisible = false;
let pickerApiReady = false;
let gisReady = false;
let pickerInstance;
let busy = false;
let pickerApiLoadPromise;
let pickerCallbackDiagnosticCount = 0;
let selectedProof;
let attemptProofInMemory;
let expectedInputTouched = false;
let lastExpectedDocumentId = '';
let preparationFlow;
let downloadUriInMemory;
let downloadResourceKeyInMemory;
let downloadResourceKeyPresentInMemory = false;
let downloadBlobInMemory;
let preparationBusy = false;
let preparationAttempted = false;
let preparationProofMode = 'single_clip';
let saveAttempted = false;
let extensionHandoffStarted = false;
let linkedPreparationAttempted = false;
let linkedHandoffStarted = false;
let linkedRequestNonceInMemory;
let downloadHandoffNonceInMemory;
let preparationStatusQueue = Promise.resolve(true);
let objectUrlInMemory;
let proofEpoch = 0;
const activeRequestControllers = new Set();

function activeProof() {
  return attemptProofInMemory || selectedProof;
}

function hasActiveAttempt() {
  return Boolean(attemptProofInMemory && (preparationAttempted || preparationBusy || downloadUriInMemory || extensionHandoffStarted || linkedPreparationAttempted || linkedRequestNonceInMemory));
}

const savedKeyErrorMessages = {
  secure_crypto_unavailable: 'Saved keys need browser encryption support. Paste-once entry is still available when no saved key exists.',
  cross_tab_lock_unavailable: 'Saved keys need browser cross-tab locking support. Paste-once entry is still available when no saved key exists.',
  saved_record_unavailable: 'Saved key storage is unavailable in this browser profile.',
  saved_record_invalid: 'The saved key record cannot be read. Forget it in Settings before setting up a new key.',
  saved_record_exists: 'A saved key already exists. Use Replace saved key in Settings.',
  saved_key_locked: 'Locked after 3 incorrect attempts. Forget the saved key in Settings to recover.',
  saved_key_changed: 'The saved key changed in another tab. Unlock it again before connecting.',
  saved_key_missing: 'The saved key was removed in another tab. Enter a key or set it up again.',
};

function attemptsText(count) {
  return `${count} ${count === 1 ? 'attempt' : 'attempts'} remaining`;
}

function updateStartButton() {
  const savedKeyReady = !savedKeyState.exists || (!savedKeyState.locked && apiKeySourceInMemory === 'saved' && Boolean(apiKeyInMemory) && savedRecordIdInMemory === savedKeyState.recordId);
  startButton.disabled = !gisReady || !pickerApiReady || busy || !savedKeyReady;
}

function currentTabHasSavedKey() {
  return Boolean(savedKeyState.exists && apiKeySourceInMemory === 'saved' && apiKeyInMemory && savedRecordIdInMemory === savedKeyState.recordId);
}

function setSavedKeyStatus(element, text, state = 'info') {
  if (!element) return;
  element.textContent = text;
  element.dataset.state = state;
}

function renderSavedKeyState(state, note) {
  savedKeyState = state;
  const hasSavedKey = state.exists;
  const locked = state.locked || state.invalid === true;
  const unlockedHere = currentTabHasSavedKey() && !locked;
  const storageAvailable = savedPickerKeyVault.isAvailable();
  savedKeyDownload.hidden = !hasSavedKey;
  manualKeyEntry.hidden = hasSavedKey;
  apiKeyInput.required = !hasSavedKey;
  if (hasSavedKey) apiKeyInput.value = '';
  savePickerKeyForm.hidden = hasSavedKey;
  savePickerKeyForm.querySelector('button[type="submit"]').disabled = busy || !storageAvailable;
  savedKeyExistingControls.hidden = !hasSavedKey;
  replacePickerKeyForm.hidden = !hasSavedKey || !replaceFormVisible || locked;
  unlockPinInput.disabled = locked || !storageAvailable;
  unlockButton.disabled = locked || !storageAvailable;
  unlockPinLabel.hidden = unlockedHere;
  unlockPinInput.hidden = unlockedHere;
  unlockAttempts.hidden = unlockedHere;
  unlockButton.hidden = unlockedHere;
  unlockAttempts.textContent = locked ? 'Locked after 3 incorrect attempts' : attemptsText(state.attemptsRemaining);
  if (locked) {
    unlockPinInput.value = '';
    setSavedKeyStatus(savedKeyDownloadStatus, note || 'Locked after 3 incorrect attempts. Forget the saved key in Settings to recover.', 'error');
    setSavedKeyStatus(savedKeySettingsStatus, 'Saved key locked after 3 incorrect attempts. Forget it to set up a new key.', 'error');
  } else if (unlockedHere) {
    unlockPinInput.value = '';
    setSavedKeyStatus(savedKeyDownloadStatus, note || 'Saved key unlocked in this tab. Click Connect / Select Vids Document when ready.', 'success');
    setSavedKeyStatus(savedKeySettingsStatus, note || 'Saved key is unlocked in this tab. Lock it here when finished.', 'success');
  } else {
    setSavedKeyStatus(savedKeyDownloadStatus, note || `Enter your PIN to unlock the saved key. ${attemptsText(state.attemptsRemaining)}.`, 'warning');
    setSavedKeyStatus(savedKeySettingsStatus, note || `Encrypted key saved. Unlock it from Download for this tab. ${attemptsText(state.attemptsRemaining)}.`, 'info');
  }
  lockSavedKeyButton.disabled = !unlockedHere || busy;
  showReplaceSavedKeyButton.disabled = locked || busy || !storageAvailable;
  forgetSavedKeyButton.disabled = busy;
  updateStartButton();
}

function renderNoSavedKey(note) {
  replaceFormVisible = false;
  const message = note || (savedPickerKeyVault.isAvailable() ? 'No saved Picker key. Paste once on Download or save one here.' : 'Saved keys are unavailable because this browser lacks required encryption or cross-tab locking support. Paste-once entry remains available.');
  renderSavedKeyState({ exists: false, locked: false, attemptsRemaining: 0, recordId: null }, message);
  setSavedKeyStatus(savedKeySettingsStatus, message, savedPickerKeyVault.isAvailable() ? 'info' : 'warning');
}

function clearSavedPickerKeyMemory() {
  if (apiKeySourceInMemory !== 'saved') return;
  apiKeyInMemory = '';
  apiKeySourceInMemory = '';
  savedRecordIdInMemory = null;
  apiKeyInput.value = '';
  try {
    pickerInstance?.dispose();
  } catch {
    // A dismissed Picker may already be disposed.
  }
  pickerInstance = undefined;
  updateStartButton();
}

function refreshSavedKeyState(note) {
  try {
    const state = savedPickerKeyVault.getState();
    if (apiKeySourceInMemory === 'saved' && (!state.exists || state.locked || state.recordId !== savedRecordIdInMemory)) {
      clearSavedPickerKeyMemory();
    }
    if (!state.exists) renderNoSavedKey(note);
    else renderSavedKeyState(state, note);
  } catch (error) {
    clearSavedPickerKeyMemory();
    const message = savedKeyErrorMessages[error?.code] || 'The saved key record could not be read. Forget it in Settings before setting up a new key.';
    renderSavedKeyState(
      {
        exists: true,
        locked: true,
        invalid: true,
        attemptsRemaining: 0,
        recordId: null,
      },
      message,
    );
  }
}

const fixedSelectionLabels = {
  idle: 'Not started',
  waiting: 'Waiting for Google Picker',
  expected_changed: 'Expected document changed; verify the new document again',
  cancelled: 'Selection cancelled',
  popup_failed: 'Authorization popup could not open',
  popup_closed: 'Authorization popup was closed',
  authorization_failed: 'Authorization denied or failed',
  scope_missing: 'Requested drive.file scope was not verified',
  picked: 'One file selected; checking metadata',
  verified: 'Verified Google Vids metadata',
  wrong_type: 'Selected file is not a Google Vids document',
  mismatch: 'Selected file does not match the expected document',
  multiple: 'Picker returned an unexpected selection count',
  picker_error: 'Google Picker could not complete the selection',
  picker_unavailable: 'Google Picker service did not load',
  api_denied: 'Drive API or file access was denied',
  auth_expired: 'Authorization expired; reconnect and select again',
  file_unavailable: 'Selected file is unavailable to this account',
  request_rejected: 'Drive API rejected the metadata request',
  rate_limited: 'Drive API rate limit reached',
  api_unavailable: 'Google Drive API is temporarily unavailable',
  network_error: 'Metadata request failed; check the network and API setup',
  metadata_timeout: 'Drive metadata request timed out',
  metadata_failed: 'File metadata could not be verified',
  invalid_expected: 'Expected Vids URL or document ID is invalid',
};

const mp4Messages = {
  starting: 'MP4 preparation requested once',
  polling: 'Waiting for Drive rendering',
  ready: 'MP4 ready',
  timeout: 'Polling timed out; continue checking the same operation',
  already_started: 'Preparation was already requested; no second request was sent',
  authorization_expired: 'Authorization expired; reset and reconnect before a new proof',
  rate_limited: 'Drive rate limit reached; continue checking later',
  access_denied: 'Drive denied the MP4 operation',
  operation_failed: 'Drive MP4 operation failed',
  transport_uncertain: 'Preparation transport failed; outcome is uncertain; reset before retrying',
  transport_unavailable: 'Operation check transport failed',
  api_unavailable: 'Drive API unavailable',
  api_request_rejected: 'Drive rejected the MP4 request',
  api_or_file_access_denied: 'Drive denied access to the existing operation',
  google_api_unavailable: 'Google Drive returned a server error',
  metadata_request_failed: 'The Drive operation request failed',
  selected_file_unavailable: 'Selected document unavailable',
  invalid_operation: 'Drive returned an invalid operation',
  invalid_download_uri: 'Drive returned an unusable download destination',
  no_operation: 'No operation is available',
  already_polling: 'Operation check already in progress',
  preparing: 'Preparing MP4',
  bytes_received: 'MP4 bytes received',
  cors_transport: 'Bytes not received; browser CORS or transport blocked access',
  unexpected_content_type: 'Received content was not video/mp4',
  empty_response: 'No MP4 bytes received',
  save_initiated: 'Browser save initiated; completion is not observable here',
  api_error: 'Drive returned an unclassified MP4 error',
};

function setMp4Status(state, category, stage) {
  if ((state === 'failed' || state === 'timeout') && stage) {
    setText('#mp4-operation-status', classifyMp4PreparationFailure(stage, category).message);
    return;
  }
  setText('#mp4-operation-status', mp4Messages[category] || mp4Messages[state] || 'MP4 task status unavailable (stage: helper_status; reason: unclassified_state). Check Dashboard status; do not retry this attempt.');
}

function updatePrepareEligibility() {
  const ack = document.querySelector('#ack-only-intended-clip')?.checked === true;
  const expected = parseExpectedDocumentId(expectedInput.value);
  const eligible = Boolean(!busy && !preparationBusy && !preparationAttempted && accessTokenInMemory && selectedProof?.status === 'verified' && selectedProof.canDownload === true && selectedProof.expectedMatch === true && expected.supplied && expected.valid && expected.fileId === selectedProof.fileId && ack);
  document.querySelector('#prepare-mp4').disabled = !eligible;
  const twoClipEligible = Boolean(
    !busy &&
    !preparationBusy &&
    !preparationAttempted &&
    accessTokenInMemory &&
    canPrepareTwoClipProof({
      selectedProof,
      expectedFileId: expected.supplied && expected.valid ? expected.fileId : undefined,
      attestations: {
        order: document.querySelector('#ack-two-clip-order')?.checked === true,
        saved: document.querySelector('#ack-two-clip-saved')?.checked === true,
        noTransitionsOrGaps: document.querySelector('#ack-two-clip-clean-boundary')?.checked === true,
      },
    }),
  );
  document.querySelector('#prepare-two-clip-mp4').disabled = !twoClipEligible;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function setAuthorizationStatus(value) {
  setText('#authorization-status', value);
}

function updatePreparedDownloadDiagnostics() {
  const proof = activeProof();
  const diagnostics = getPreparedDownloadDiagnostics(downloadUriInMemory, downloadResourceKeyInMemory || proof?.resourceKey, downloadResourceKeyPresentInMemory || proof?.resourceKeyPresent);
  setText('#prepared-uri-present', diagnostics.prepared_uri_present ? 'Yes' : 'No');
  setText('#prepared-uri-validated', diagnostics.prepared_uri_validated ? 'Yes' : 'No');
  setText('#resource-key-present', diagnostics.resource_key_present ? 'Yes' : 'No');

  const button = document.querySelector('#open-prepared-mp4');
  const eligible = canOpenPreparedDownloadInBrowser(diagnostics);
  button.hidden = !eligible;
  button.disabled = !eligible;
  const handoffButton = document.querySelector('#send-prepared-mp4-to-extension');
  const expected = parseExpectedDocumentId(expectedInput.value);
  const handoffEligible = Boolean(eligible && !extensionHandoffStarted && proof?.status === 'verified' && proof?.canDownload === true && proof?.expectedMatch === true && expected.valid && expected.supplied && expected.fileId === proof.fileId && document.querySelector('#ack-only-intended-clip')?.checked === true);
  handoffButton.hidden = !handoffEligible;
  handoffButton.disabled = !handoffEligible;
  const linkedButton = document.querySelector('#prepare-linked-mp4-for-review');
  const linkedEligible = Boolean(!busy && !preparationBusy && !linkedPreparationAttempted && accessTokenInMemory && selectedProof?.status === 'verified' && selectedProof?.canDownload === true && selectedProof?.expectedMatch === true && expected.supplied && expected.valid && expected.fileId === selectedProof.fileId && document.querySelector('#ack-only-intended-clip')?.checked === true);
  linkedButton.hidden = !linkedEligible;
  linkedButton.disabled = !linkedEligible;
  if (diagnostics.resource_key_present) {
    setText('#prepared-navigation-status', 'Browser navigation unavailable: the final request requires X-Goog-Drive-Resource-Keys, which a normal link cannot attach safely.');
  } else if (eligible) {
    setText('#prepared-navigation-status', 'Ready for an explicit browser navigation. The page will report only that navigation was initiated.');
  } else {
    setText('#prepared-navigation-status', 'No prepared destination');
  }
}

function setSelectionStatus(key) {
  setText('#selection-status', fixedSelectionLabels[key] || fixedSelectionLabels.metadata_failed);
}

function resetResults(expectedWasSupplied) {
  setAuthorizationStatus('Authorizing selected account');
  setSelectionStatus('waiting');
  setText('#selected-file-id', '—');
  setText('#mime-type', '—');
  setText('#can-download', '—');
  setText('#expected-match', expectedWasSupplied ? 'Not checked' : 'Not supplied');
}

function setBusy(value) {
  busy = value;
  updateStartButton();
  lockSavedKeyButton.disabled = !currentTabHasSavedKey() || value;
  showReplaceSavedKeyButton.disabled = savedKeyState.locked || value || !savedPickerKeyVault.isAvailable();
  forgetSavedKeyButton.disabled = value;
  savePickerKeyForm.querySelector('button[type="submit"]').disabled = value || savedKeyState.exists || !savedPickerKeyVault.isAvailable();
  unlockButton.disabled = value || savedKeyState.locked || !savedPickerKeyVault.isAvailable();
  replacePickerKeyForm.querySelector('button[type="submit"]').disabled = value;
  startButton.textContent = value ? 'Authorization and selection in progress…' : 'Connect / Select Vids Document';
}

function loadPickerApi() {
  if (pickerApiLoadPromise) return pickerApiLoadPromise;
  pickerApiLoadPromise = new Promise((resolve, reject) => {
    if (!window.gapi?.load) {
      reject(new Error('picker_unavailable'));
      return;
    }
    const timeout = window.setTimeout(() => reject(new Error('picker_unavailable')), PICKER_LOAD_TIMEOUT_MS);
    try {
      window.gapi.load('picker', {
        callback: () => {
          window.clearTimeout(timeout);
          if (window.google?.picker?.PickerBuilder) resolve();
          else reject(new Error('picker_unavailable'));
        },
        onerror: () => {
          window.clearTimeout(timeout);
          reject(new Error('picker_unavailable'));
        },
        ontimeout: () => {
          window.clearTimeout(timeout);
          reject(new Error('picker_unavailable'));
        },
        timeout: PICKER_LOAD_TIMEOUT_MS,
      });
    } catch {
      window.clearTimeout(timeout);
      reject(new Error('picker_unavailable'));
    }
  });
  return pickerApiLoadPromise;
}

function requestAccessTokenFromUserGesture(forceAccountSelection = false) {
  if (!forceAccountSelection && accessTokenInMemory && accessTokenExpiresAt > Date.now() + 30000) {
    return Promise.resolve({ kind: 'reused' });
  }
  return new Promise((resolve) => {
    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: WEB_OAUTH_CLIENT_ID,
        scope: DRIVE_FILE_SCOPE,
        include_granted_scopes: false,
        prompt: 'select_account consent',
        callback: (response) => resolve({ kind: 'response', response }),
        error_callback: (error) => {
          const errorType = error?.type;
          if (errorType === 'popup_failed_to_open') resolve({ kind: 'popup_failed' });
          else if (errorType === 'popup_closed') resolve({ kind: 'popup_closed' });
          else resolve({ kind: 'authorization_failed' });
        },
      });
      tokenClient.requestAccessToken({
        prompt: 'select_account consent',
        include_granted_scopes: false,
      });
    } catch {
      resolve({ kind: 'popup_failed' });
    }
  });
}

function recordPickerCallbackCategory(category) {
  if (pickerCallbackDiagnosticCount >= MAX_PICKER_CALLBACK_DIAGNOSTICS || !PICKER_CALLBACK_CATEGORIES.has(category)) {
    return;
  }
  pickerCallbackDiagnosticCount += 1;
  console.info('picker_callback', category);
}

async function processPickedFile(data, expectedFileId) {
  try {
    const picker = window.google?.picker;
    const documentsKey = picker?.Response?.DOCUMENTS;
    const docs = documentsKey === undefined ? undefined : data?.[documentsKey];
    if (!Array.isArray(docs) || docs.length !== 1) {
      setSelectionStatus('multiple');
      return;
    }
    const fileIdKey = picker?.Document?.ID;
    const fileId = fileIdKey === undefined ? undefined : docs[0]?.[fileIdKey];
    if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) {
      setSelectionStatus('picker_error');
      return;
    }

    setText('#selected-file-id', fileId);
    setSelectionStatus('picked');
    const result = await verifySelectedFile(fileId, expectedFileId);
    if (result?.status === 'verified' && result.canDownload && result.expectedMatch === true) {
      selectedProof = { ...result, fileId };
      setAuthorizationStatus('Authorized selected account for drive.file; token held in page memory for the explicit MP4 action');
    } else {
      accessTokenInMemory = '';
      accessTokenExpiresAt = 0;
      selectedProof = undefined;
    }
  } catch {
    setSelectionStatus('picker_error');
  } finally {
    closePickerAfterSelection();
    updatePrepareEligibility();
  }
}

function showPicker(expectedFileId, mode) {
  if (!pickerApiReady || !window.google?.picker) {
    throw new Error('picker_unavailable');
  }

  const picker = window.google.picker;
  const configuration = getPickerViewConfiguration(mode);
  const view = new picker.DocsView(picker.ViewId.DOCS);
  if (configuration.mimeTypes) view.setMimeTypes(configuration.mimeTypes);
  view.setMode(picker.DocsViewMode.LIST);
  const callbackLifecycle = createPickerCallbackLifecycle({
    actions: {
      picked: picker.Action?.PICKED,
      cancel: picker.Action?.CANCEL,
      error: picker.Action?.ERROR,
    },
    onCategory: recordPickerCallbackCategory,
    onCancel: () => {
      setSelectionStatus('cancelled');
      cleanUpSecrets();
    },
    onError: () => {
      setSelectionStatus('picker_error');
      cleanUpSecrets();
    },
    onPicked: (data) => {
      void processPickedFile(data, expectedFileId);
    },
  });
  const pickerBuilder = new picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(accessTokenInMemory)
    .setDeveloperKey(apiKeyInMemory)
    .setAppId(CLOUD_PROJECT_NUMBER)
    .setOrigin(window.location.origin)
    .setMaxItems(configuration.maxItems)
    .setCallback((data) => {
      const actionKey = picker.Response?.ACTION;
      const action = actionKey === undefined || data === null || typeof data !== 'object' ? undefined : data[actionKey];
      callbackLifecycle(action, data);
    });
  if (configuration.selectableMimeTypes) {
    pickerBuilder.setSelectableMimeTypes(configuration.selectableMimeTypes);
  }
  pickerInstance = pickerBuilder.build();
  pickerInstance.setVisible(true);
}

async function verifySelectedFile(fileId, expectedFileId) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', METADATA_FIELDS);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessTokenInMemory}`,
        ...(selectedProof?.resourceKey
          ? {
              'X-Goog-Drive-Resource-Keys': `${fileId}/${selectedProof.resourceKey}`,
            }
          : {}),
      },
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error',
      referrerPolicy: 'strict-origin-when-cross-origin',
      signal: controller.signal,
    });

    if (!response.ok) {
      const failure = classifyDriveApiFailure(response.status);
      if (failure === 'authorization_expired') {
        accessTokenInMemory = '';
        accessTokenExpiresAt = 0;
        setAuthorizationStatus('Authorization expired or was rejected');
        setSelectionStatus('auth_expired');
      } else if (failure === 'api_or_file_access_denied') {
        setSelectionStatus('api_denied');
      } else if (failure === 'selected_file_unavailable') {
        setSelectionStatus('file_unavailable');
      } else if (failure === 'api_request_rejected') {
        setSelectionStatus('request_rejected');
      } else if (failure === 'rate_limited') {
        setSelectionStatus('rate_limited');
      } else if (failure === 'google_api_unavailable') {
        setSelectionStatus('api_unavailable');
      } else {
        setSelectionStatus('metadata_failed');
      }
      return undefined;
    }

    const metadata = await response.json();
    const result = evaluateVidsMetadata(metadata, fileId, expectedFileId);
    if (!result.valid) {
      setSelectionStatus('metadata_failed');
      return undefined;
    }

    setText('#mime-type', result.mimeType.slice(0, 128));
    setText('#can-download', result.canDownload ? 'Yes' : 'No');
    setText('#expected-match', result.expectedMatch === undefined ? 'Not supplied' : result.expectedMatch ? 'Match' : 'Mismatch');
    setSelectionStatus(result.status);
    return result;
  } catch (error) {
    setSelectionStatus(error?.name === 'AbortError' ? 'metadata_timeout' : 'network_error');
    return undefined;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function driveJsonRequest(url, method, token, resourceKey) {
  if (url.origin !== 'https://www.googleapis.com') return { ok: false, category: 'api_request_rejected' };
  const controller = new AbortController();
  activeRequestControllers.add(controller);
  const timeout = window.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(buildDriveResourceKeysHeader(activeProof()?.fileId, resourceKey)
          ? {
              'X-Goog-Drive-Resource-Keys': buildDriveResourceKeysHeader(activeProof()?.fileId, resourceKey),
            }
          : {}),
      },
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) {
      let errorBody;
      if (response.status === 403) {
        try {
          errorBody = await response.json();
        } catch {
          /* fixed status category below */
        }
      }
      return {
        ok: false,
        category: classifyDriveDownloadFailure(response.status, errorBody),
      };
    }
    return { ok: true, operation: await response.json() };
  } catch (error) {
    return {
      ok: false,
      category: error?.name === 'AbortError' ? 'transport_unavailable' : 'transport_unavailable',
    };
  } finally {
    window.clearTimeout(timeout);
    activeRequestControllers.delete(controller);
  }
}

function createPreparationFlow() {
  return createMp4PreparationFlow({
    startDownload: async (fileId) => {
      const result = await driveJsonRequest(buildFilesDownloadUrl(fileId), 'POST', accessTokenInMemory, downloadResourceKeyInMemory || activeProof()?.resourceKey);
      if (result.ok) {
        const operation = evaluateDownloadOperation(result.operation);
        downloadResourceKeyInMemory = operation.resourceKey || downloadResourceKeyInMemory || activeProof()?.resourceKey;
        downloadResourceKeyPresentInMemory = downloadResourceKeyPresentInMemory || operation.resourceKeyPresent === true || activeProof()?.resourceKeyPresent === true;
      }
      return result;
    },
    pollOperation: async (operationName) => {
      const result = await driveJsonRequest(buildOperationGetUrl(operationName), 'GET', accessTokenInMemory, downloadResourceKeyInMemory || activeProof()?.resourceKey);
      if (result.ok) {
        const operation = evaluateDownloadOperation(result.operation);
        downloadResourceKeyInMemory = operation.resourceKey || downloadResourceKeyInMemory || activeProof()?.resourceKey;
        downloadResourceKeyPresentInMemory = downloadResourceKeyPresentInMemory || operation.resourceKeyPresent === true || activeProof()?.resourceKeyPresent === true;
      }
      return result;
    },
    onState: (state, category, stage) => {
      const failed = state === 'timeout' || state === 'failed';
      const failure = failed ? classifyMp4PreparationFailure(stage, category) : undefined;
      setMp4Status(state, category, stage);
      const phase = state === 'ready' ? 'prepared' : failed ? 'needs_review' : 'preparing';
      void queuePreparationStatus(phase, preparationFlow?.operationName, failure);
    },
  });
}

async function prepareMp4() {
  updatePrepareEligibility();
  if (document.querySelector('#prepare-mp4').disabled || preparationBusy) return;
  preparationBusy = true;
  attemptProofInMemory = { ...selectedProof };
  const requestEpoch = proofEpoch;
  const expected = parseExpectedDocumentId(expectedInput.value);
  if (!expected.valid || !expected.supplied || !expected.fileId) {
    preparationBusy = false;
    return;
  }
  try {
    const challenge = await sendExternalMessage({
      type: 'HOSTED_MP4_NONCE_CHALLENGE',
      expectedFileId: expected.fileId,
    });
    if (!challenge?.success || typeof challenge.requestNonce !== 'string') {
      setText('#extension-handoff-status', 'No matching timeline-ready handoff is armed; MP4 preparation did not start.');
      setText('#mp4-operation-status', 'Preparation not started (stage: nonce_binding; reason: no_matching_armed_attempt).');
      preparationBusy = false;
      attemptProofInMemory = undefined;
      return;
    }
    downloadHandoffNonceInMemory = challenge.requestNonce;
    const accepted = await queuePreparationStatus('preparing');
    if (!accepted) {
      downloadHandoffNonceInMemory = undefined;
      setText('#extension-handoff-status', 'The extension did not accept the preparation binding; MP4 preparation did not start.');
      setText('#mp4-operation-status', 'Preparation not started (stage: preparation_binding; reason: worker_rejected_binding).');
      preparationBusy = false;
      attemptProofInMemory = undefined;
      return;
    }
  } catch {
    setText('#extension-handoff-status', 'The extension could not arm this document; MP4 preparation did not start.');
    setText('#mp4-operation-status', 'Preparation not started (stage: nonce_binding; reason: extension_message_unavailable).');
    preparationBusy = false;
    attemptProofInMemory = undefined;
    return;
  }
  if (requestEpoch !== proofEpoch) {
    preparationBusy = false;
    attemptProofInMemory = undefined;
    return;
  }
  preparationAttempted = true;
  preparationProofMode = 'single_clip';
  await runMp4Preparation();
}

async function prepareTwoClipMp4() {
  updatePrepareEligibility();
  if (document.querySelector('#prepare-two-clip-mp4').disabled || preparationBusy) return;
  preparationBusy = true;
  attemptProofInMemory = { ...selectedProof };
  preparationAttempted = true;
  preparationProofMode = 'two_clip_whole_document';
  setText('#two-clip-proof-status', 'Attestations accepted; preparing one whole-document MP4');
  await runMp4Preparation();
}

async function runMp4Preparation() {
  preparationFlow = createPreparationFlow();
  const requestEpoch = proofEpoch;
  document.querySelector('#prepare-mp4').disabled = true;
  try {
    const outcome = await preparationFlow.prepare(activeProof().fileId);
    if (requestEpoch === proofEpoch) handlePreparationOutcome(outcome);
  } catch {
    if (preparationProofMode === 'two_clip_whole_document') setText('#two-clip-proof-status', 'Preparation failed; see the shared preparation status');
  } finally {
    preparationBusy = false;
    updatePrepareEligibility();
  }
}

function handlePreparationOutcome(outcome) {
  if (outcome.state === 'ready') {
    downloadUriInMemory = outcome.downloadUri;
    downloadResourceKeyInMemory = outcome.resourceKey || downloadResourceKeyInMemory || activeProof()?.resourceKey;
    downloadResourceKeyPresentInMemory = downloadResourceKeyPresentInMemory || outcome.resourceKeyPresent === true || activeProof()?.resourceKeyPresent === true;
    accessTokenInMemory = '';
    accessTokenExpiresAt = 0;
    setAuthorizationStatus('Operation complete; authorization token cleared');
    setMp4Status('ready');
    if (preparationProofMode === 'two_clip_whole_document') {
      setText('#two-clip-proof-status', 'Whole-document MP4 prepared. Use the explicit browser download control; inspect the actual frame boundary before splitting.');
    }
    const button = document.querySelector('#receive-mp4-bytes');
    button.hidden = false;
    button.disabled = false;
    updatePreparedDownloadDiagnostics();
    if (linkedRequestNonceInMemory && !linkedHandoffStarted) {
      void sendLinkedPreparedMp4ToExtension();
    }
  } else if (outcome.state === 'timeout') {
    const button = document.querySelector('#continue-operation');
    button.hidden = false;
    button.disabled = false;
    setMp4Status('timeout', outcome.category, outcome.stage);
  } else if (outcome.state === 'error') {
    if (outcome.category !== 'transport_unavailable') {
      accessTokenInMemory = '';
      accessTokenExpiresAt = 0;
      setAuthorizationStatus(outcome.category === 'authorization_expired' ? 'Authorization expired; token cleared' : 'MP4 operation ended; authorization token cleared');
    }
    if (preparationFlow?.operationName && outcome.stage === 'operation_poll' && ['transport_unavailable', 'transport_uncertain', 'authorization_expired', 'access_denied', 'api_or_file_access_denied'].includes(outcome.category)) {
      const button = document.querySelector('#continue-operation');
      button.hidden = false;
      button.disabled = false;
    }
    setMp4Status('failed', outcome.category, outcome.stage);
  } else {
    setMp4Status(outcome.state, outcome.category, outcome.stage);
  }
}

async function continueOperationCheck() {
  if (!preparationFlow || preparationBusy) return;
  preparationBusy = true;
  const requestEpoch = proofEpoch;
  document.querySelector('#continue-operation').disabled = true;
  try {
    const outcome = await preparationFlow.continuePolling();
    if (requestEpoch === proofEpoch) handlePreparationOutcome(outcome);
  } finally {
    preparationBusy = false;
    document.querySelector('#continue-operation').disabled = false;
  }
}

async function prepareLinkedMp4ForConfirmedReview() {
  const button = document.querySelector('#prepare-linked-mp4-for-review');
  const expected = parseExpectedDocumentId(expectedInput.value);
  if (linkedPreparationAttempted || preparationBusy || !accessTokenInMemory || !expected.supplied || !expected.valid || selectedProof?.status !== 'verified' || selectedProof?.canDownload !== true || selectedProof?.expectedMatch !== true || selectedProof?.fileId !== expected.fileId || document.querySelector('#ack-only-intended-clip')?.checked !== true) return;
  linkedPreparationAttempted = true;
  button.disabled = true;
  setText('#linked-preparation-status', 'Checking the armed run and current Vids snapshot');
  try {
    const challenge = await sendExternalMessage({
      type: 'HOSTED_VIDS_REVIEW_NONCE_CHALLENGE',
      expectedFileId: expected.fileId,
    });
    if (!challenge?.success || typeof challenge.requestNonce !== 'string') {
      setText('#linked-preparation-status', 'Not authorized: no fresh matching run binding; no MP4 preparation was started.');
      updatePreparedDownloadDiagnostics();
      return;
    }
    linkedRequestNonceInMemory = challenge.requestNonce;
    preparationBusy = true;
    preparationFlow = createPreparationFlow();
    const requestEpoch = proofEpoch;
    const outcome = await preparationFlow.prepare(selectedProof.fileId);
    if (requestEpoch === proofEpoch) handlePreparationOutcome(outcome);
  } catch {
    setText('#linked-preparation-status', 'Preparation outcome is unresolved; do not retry this run.');
  } finally {
    preparationBusy = false;
    updatePreparedDownloadDiagnostics();
  }
}

async function sendLinkedPreparedMp4ToExtension() {
  if (linkedHandoffStarted || !linkedRequestNonceInMemory || !downloadUriInMemory) return;
  const expected = parseExpectedDocumentId(expectedInput.value);
  const diagnostics = getPreparedDownloadDiagnostics(downloadUriInMemory, downloadResourceKeyInMemory || activeProof()?.resourceKey, downloadResourceKeyPresentInMemory || activeProof()?.resourceKeyPresent);
  if (!expected.valid || !expected.supplied || selectedProof?.fileId !== expected.fileId || selectedProof?.status !== 'verified' || selectedProof?.mimeType !== 'application/vnd.google-apps.vid' || selectedProof?.canDownload !== true || selectedProof?.expectedMatch !== true || diagnostics.prepared_uri_validated !== true || diagnostics.resource_key_present !== false || document.querySelector('#ack-only-intended-clip')?.checked !== true) {
    linkedHandoffStarted = true;
    linkedRequestNonceInMemory = undefined;
    downloadUriInMemory = undefined;
    setText('#linked-preparation-status', 'unresolved: prepared proof changed; do not retry this run.');
    updatePreparedDownloadDiagnostics();
    return;
  }
  linkedHandoffStarted = true;
  setText('#linked-preparation-status', 'Prepared for this armed review; requesting one extension download');
  try {
    const payload = buildHostedVidsReviewHandoffPayload({
      requestNonce: linkedRequestNonceInMemory,
      selectedProof,
      expectedFileId: expected.fileId,
      preparedUri: downloadUriInMemory.href,
      preparedUriValidated: diagnostics.prepared_uri_validated,
      resourceKeyPresent: diagnostics.resource_key_present,
      wholeDocumentAcknowledged: document.querySelector('#ack-only-intended-clip')?.checked === true,
    });
    if (!payload) {
      setText('#linked-preparation-status', 'Run handoff rejected by local proof checks; do not retry.');
      linkedRequestNonceInMemory = undefined;
      downloadUriInMemory = undefined;
      updatePreparedDownloadDiagnostics();
      return;
    }
    const outcome = await sendExternalMessage(payload);
    const status = ['requested', 'in_progress', 'complete', 'interrupted', 'unresolved'].includes(outcome?.status) ? outcome.status : 'unresolved';
    setText('#linked-preparation-status', status === 'complete' ? 'complete: exact Chrome download item completed; resolution and content are not verified here.' : `${status}: linked run remains protected unless Chrome reports complete.`);
    linkedRequestNonceInMemory = undefined;
    downloadUriInMemory = undefined;
    updatePreparedDownloadDiagnostics();
  } catch {
    setText('#linked-preparation-status', 'unresolved: extension acknowledgement was not received; do not retry.');
    linkedRequestNonceInMemory = undefined;
    downloadUriInMemory = undefined;
    updatePreparedDownloadDiagnostics();
  }
}

async function receiveMp4Bytes() {
  const uri = downloadUriInMemory;
  const destination = uri ? validateGoogleDownloadUri(uri.href) : undefined;
  if (!destination || destination.protocol !== 'https:' || !downloadUriInMemory) return;
  const controller = new AbortController();
  activeRequestControllers.add(controller);
  const timeout = window.setTimeout(() => controller.abort(), 60000);
  const button = document.querySelector('#receive-mp4-bytes');
  button.disabled = true;
  try {
    const response = await fetch(destination, {
      method: 'GET',
      headers: buildDriveResourceKeysHeader(selectedProof?.fileId, downloadResourceKeyInMemory || selectedProof?.resourceKey)
        ? {
            'X-Goog-Drive-Resource-Keys': buildDriveResourceKeysHeader(selectedProof.fileId, downloadResourceKeyInMemory || selectedProof?.resourceKey),
          }
        : {},
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) {
      setMp4Status('failed', classifyDownloadHttpFailure(response.status));
      if (response.status === 401) downloadUriInMemory = undefined;
      updatePreparedDownloadDiagnostics();
      return;
    }
    const blob = await response.blob();
    const result = evaluateMp4BytesResponse(response, blob);
    if (result.state !== 'received') {
      setMp4Status('failed', result.category);
      return;
    }
    downloadBlobInMemory = blob;
    downloadUriInMemory = undefined;
    updatePreparedDownloadDiagnostics();
    setText('#bytes-received-status', `Yes (${result.byteCount} bytes; ${blob.type || 'video/mp4'})`);
    setMp4Status('bytes_received');
    const saveButton = document.querySelector('#save-mp4');
    saveButton.hidden = false;
    saveButton.disabled = false;
  } catch {
    setMp4Status('failed', 'cors_transport');
  } finally {
    window.clearTimeout(timeout);
    activeRequestControllers.delete(controller);
    button.disabled = false;
  }
}

function openPreparedMp4() {
  const diagnostics = getPreparedDownloadDiagnostics(downloadUriInMemory, downloadResourceKeyInMemory || activeProof()?.resourceKey, downloadResourceKeyPresentInMemory || activeProof()?.resourceKeyPresent);
  if (!canOpenPreparedDownloadInBrowser(diagnostics) || !downloadUriInMemory) return;
  const destination = validateGoogleDownloadUri(downloadUriInMemory.href);
  if (!destination || destination.protocol !== 'https:') return;

  const anchor = document.createElement('a');
  anchor.href = destination.href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.referrerPolicy = 'no-referrer';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setText('#prepared-navigation-status', 'Navigation initiated; browser download completion is not observable here.');
}

function sendExternalMessage(message) {
  return new Promise((resolve, reject) => {
    if (!EXTENSION_ID_VALID || !chrome?.runtime?.sendMessage) {
      reject(new Error('unavailable'));
      return;
    }
    const timeout = window.setTimeout(() => reject(new Error('timeout')), 10000);
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, message, (response) => {
        window.clearTimeout(timeout);
        if (chrome.runtime.lastError) reject(new Error('unavailable'));
        else resolve(response);
      });
    } catch {
      window.clearTimeout(timeout);
      reject(new Error('unavailable'));
    }
  });
}

async function checkExtensionConfiguration() {
  const status = document.querySelector('#extension-config-status');
  if (!status) return;
  if (!EXTENSION_ID_VALID) {
    status.textContent = 'Extension configuration unavailable; open this helper from the extension.';
    return;
  }
  try {
    const response = await sendExternalMessage({
      type: 'VIDS_HELPER_CONFIG_PING',
    });
    if (!response?.success || response.status !== 'configured') {
      status.textContent = 'Extension configuration was rejected; reload the extension and helper.';
      return;
    }
    status.textContent = 'Extension configuration connected.';
    if (!expectedInputTouched && !expectedInput.value.trim() && typeof response.expectedDocumentId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(response.expectedDocumentId)) {
      expectedInput.value = response.expectedDocumentId;
      expectedInput.dataset.filledFromExtension = 'true';
      document.querySelector('#expected-document-source').hidden = false;
      handleExpectedDocumentChange();
    }
  } catch {
    status.textContent = 'Extension configuration could not be reached; update the hosted helper binding if needed.';
  }
}

function handleExpectedDocumentChange() {
  const parsed = parseExpectedDocumentId(expectedInput.value);
  const nextDocumentId = parsed.supplied && parsed.valid ? parsed.fileId : '';
  if (nextDocumentId === lastExpectedDocumentId) {
    updatePrepareEligibility();
    updatePreparedDownloadDiagnostics();
    return;
  }
  lastExpectedDocumentId = nextDocumentId;
  selectedProof = undefined;
  document.querySelector('#ack-only-intended-clip').checked = false;
  for (const selector of ['#ack-two-clip-order', '#ack-two-clip-saved', '#ack-two-clip-clean-boundary']) {
    document.querySelector(selector).checked = false;
  }
  setText('#selected-file-id', '—');
  setText('#mime-type', '—');
  setText('#can-download', '—');
  setText('#expected-match', parsed.supplied ? 'Not checked' : 'Not supplied');
  if (hasActiveAttempt()) {
    setAuthorizationStatus(`The active attempt remains bound to document ${attemptProofInMemory.fileId}. Restore that document ID to continue its operation or send its prepared MP4.`);
  } else {
    setSelectionStatus(parsed.supplied ? parsed.valid ? 'expected_changed' : 'invalid_expected' : 'waiting');
  }
  updatePrepareEligibility();
  updatePreparedDownloadDiagnostics();
}

async function sendPreparedMp4ToExtension() {
  if (extensionHandoffStarted) return;
  const proof = activeProof();
  const expected = parseExpectedDocumentId(expectedInput.value);
  const diagnostics = getPreparedDownloadDiagnostics(downloadUriInMemory, downloadResourceKeyInMemory || proof?.resourceKey, downloadResourceKeyPresentInMemory || proof?.resourceKeyPresent);
  if (!expected.valid || !expected.supplied || !downloadUriInMemory || !canOpenPreparedDownloadInBrowser(diagnostics) || proof?.status !== 'verified' || proof?.canDownload !== true || proof?.expectedMatch !== true || proof?.fileId !== expected.fileId || !downloadHandoffNonceInMemory || document.querySelector('#ack-only-intended-clip')?.checked !== true) {
    return;
  }
  document.querySelector('#send-prepared-mp4-to-extension').disabled = true;
  extensionHandoffStarted = true;
  setText('#extension-handoff-status', 'requested');
  try {
    if (!(await queuePreparationStatus('prepared', preparationFlow?.operationName))) {
      setText('#extension-handoff-status', 'Prepared state was not accepted; check the extension status before continuing.');
      return;
    }
    const payload = buildHostedMp4HandoffPayload({
      requestNonce: downloadHandoffNonceInMemory,
      selectedProof: proof,
      expectedFileId: expected.fileId,
      preparedUri: downloadUriInMemory.href,
      preparedUriValidated: diagnostics.prepared_uri_validated,
      resourceKeyPresent: diagnostics.resource_key_present,
      wholeDocumentAcknowledged: document.querySelector('#ack-only-intended-clip')?.checked === true,
    });
    if (!payload) {
      setText('#extension-handoff-status', 'unresolved: prepared document proof is no longer eligible');
      return;
    }
    const outcome = await sendExternalMessage(payload);
    downloadHandoffNonceInMemory = undefined;
    if (outcome?.success === true && outcome.status === 'downloading' && Number.isInteger(outcome.downloadId)) {
      setText('#extension-handoff-status', `Accepted · attempt ${outcome.attemptId} · document ${outcome.documentId} · Chrome download ID ${outcome.downloadId}. Completion is tracked separately.`);
    } else if (outcome?.status === 'needs_review') {
      setText('#extension-handoff-status', `Needs review · attempt ${outcome.attemptId || 'unknown'} · document ${outcome.documentId || expected.fileId}. Do not resend.`);
    } else {
      setText('#extension-handoff-status', 'Handoff was not accepted; check extension Downloads before any further action.');
    }
  } catch {
    downloadHandoffNonceInMemory = undefined;
    setText('#extension-handoff-status', 'Response not received. Check extension Downloads and Chrome downloads; do not resend this handoff.');
  }
}

async function reportPreparationStatus(phase, operationName, failure) {
  const proof = activeProof();
  if (!downloadHandoffNonceInMemory || !proof?.fileId) return false;
  try {
    const response = await sendExternalMessage({
      type: 'HOSTED_MP4_PREPARATION_STATUS',
      requestNonce: downloadHandoffNonceInMemory,
      documentId: proof.fileId,
      phase,
      ...(typeof operationName === 'string' ? { operationName } : {}),
      ...(failure
        ? {
            reviewReason: failure.reason,
            failureStage: failure.failureStage,
            failureCode: failure.failureCode,
          }
        : {}),
    });
    return response?.success === true;
  } catch {
    return false;
  }
}

function queuePreparationStatus(phase, operationName, failure) {
  preparationStatusQueue = preparationStatusQueue.then(() => reportPreparationStatus(phase, operationName, failure)).catch(() => false);
  return preparationStatusQueue;
}

function saveMp4() {
  if (!downloadBlobInMemory || saveAttempted) return;
  saveAttempted = true;
  document.querySelector('#save-mp4').disabled = true;
  objectUrlInMemory = URL.createObjectURL(downloadBlobInMemory);
  const anchor = document.createElement('a');
  anchor.href = objectUrlInMemory;
  anchor.download = 'selected-vids.mp4';
  anchor.rel = 'noopener noreferrer';
  anchor.referrerPolicy = 'no-referrer';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setText('#browser-save-status', mp4Messages.save_initiated);
  setText('#saved-file-status', 'Not verifiable by this webpage');
  window.setTimeout(() => {
    if (objectUrlInMemory) URL.revokeObjectURL(objectUrlInMemory);
    objectUrlInMemory = undefined;
  }, 60000);
}

function resetProof({ preserveAuthorization = false } = {}) {
  proofEpoch += 1;
  const proof = activeProof();
  if ((preparationAttempted || preparationBusy) && downloadHandoffNonceInMemory && proof?.fileId) {
    const hasOperation = typeof preparationFlow?.operationName === 'string';
    const failure = classifyMp4PreparationFailure(hasOperation ? 'operation_poll' : 'files_download_transport', hasOperation ? 'transport_unavailable' : 'transport_uncertain');
    void sendExternalMessage({
      type: 'HOSTED_MP4_PREPARATION_STATUS',
      requestNonce: downloadHandoffNonceInMemory,
      documentId: proof.fileId,
      phase: 'needs_review',
      ...(preparationFlow?.operationName ? { operationName: preparationFlow.operationName } : {}),
      reviewReason: failure.reason,
      failureStage: failure.failureStage,
      failureCode: failure.failureCode,
    }).catch(() => undefined);
  }
  preparationFlow?.cancel();
  for (const controller of activeRequestControllers) controller.abort();
  activeRequestControllers.clear();
  cleanUpSecrets({ preserveAuthorization });
  selectedProof = undefined;
  attemptProofInMemory = undefined;
  preparationFlow = undefined;
  downloadUriInMemory = undefined;
  downloadResourceKeyInMemory = undefined;
  downloadResourceKeyPresentInMemory = false;
  downloadBlobInMemory = undefined;
  preparationBusy = false;
  preparationAttempted = false;
  saveAttempted = false;
  extensionHandoffStarted = false;
  linkedPreparationAttempted = false;
  linkedHandoffStarted = false;
  linkedRequestNonceInMemory = undefined;
  downloadHandoffNonceInMemory = undefined;
  preparationStatusQueue = Promise.resolve(true);
  if (objectUrlInMemory) URL.revokeObjectURL(objectUrlInMemory);
  objectUrlInMemory = undefined;
  document.querySelector('#ack-only-intended-clip').checked = false;
  for (const selector of ['#ack-two-clip-order', '#ack-two-clip-saved', '#ack-two-clip-clean-boundary']) {
    document.querySelector(selector).checked = false;
  }
  preparationProofMode = 'single_clip';
  setText('#two-clip-proof-status', 'No two-clip proof started');
  updatePreparedDownloadDiagnostics();
  for (const selector of ['#continue-operation', '#receive-mp4-bytes', '#save-mp4']) {
    const button = document.querySelector(selector);
    button.hidden = true;
    button.disabled = true;
  }
  const handoffButton = document.querySelector('#send-prepared-mp4-to-extension');
  handoffButton.hidden = true;
  handoffButton.disabled = true;
  setText('#extension-handoff-status', 'No extension handoff requested');
  setText('#linked-preparation-status', 'No linked run continuation requested');
  setText('#mp4-operation-status', 'Not prepared');
  setText('#bytes-received-status', 'No');
  setText('#browser-save-status', 'Not initiated');
  setText('#saved-file-status', 'Not verifiable by this webpage');
  updatePrepareEligibility();
}

function closePickerAfterSelection() {
  apiKeyInMemory = '';
  apiKeySourceInMemory = '';
  savedRecordIdInMemory = null;
  try {
    pickerInstance?.dispose();
  } catch {
    /* already disposed */
  }
  pickerInstance = undefined;
  setBusy(false);
  refreshSavedKeyState();
}

function cleanUpSecrets({ preserveAuthorization = false } = {}) {
  if (!preserveAuthorization) {
    accessTokenInMemory = '';
    accessTokenExpiresAt = 0;
  }
  apiKeyInMemory = '';
  apiKeySourceInMemory = '';
  savedRecordIdInMemory = null;
  try {
    pickerInstance?.dispose();
  } catch {
    // The picker may already have disposed itself after cancellation.
  }
  pickerInstance = undefined;
  setBusy(false);
  refreshSavedKeyState();
}

async function startProof(event) {
  event.preventDefault();
  if (busy) return;
  let state;
  try {
    state = savedPickerKeyVault.getState();
  } catch (error) {
    refreshSavedKeyState();
    setAuthorizationStatus(savedKeyErrorMessages[error?.code] || 'Saved key state is unavailable.');
    return;
  }
  if (state.exists && !savedPickerKeyVault.isAvailable()) {
    renderSavedKeyState(state, savedKeyErrorMessages.cross_tab_lock_unavailable);
    setAuthorizationStatus(savedKeyErrorMessages.cross_tab_lock_unavailable);
    return;
  }
  if (state.locked) {
    clearSavedPickerKeyMemory();
    renderSavedKeyState(state);
    setAuthorizationStatus('Saved Picker key is locked. Forget it in Settings to recover.');
    return;
  }
  const keySource = state.exists ? 'saved' : 'manual';
  const apiKey = state.exists ? (currentTabHasSavedKey() && savedRecordIdInMemory === state.recordId ? apiKeyInMemory : '') : apiKeyInput.value.trim();
  if (state.exists && !apiKey) {
    renderSavedKeyState(state, 'Unlock the saved key from this tab before connecting.');
    return;
  }
  const expected = parseExpectedDocumentId(expectedInput.value);
  if (hasActiveAttempt()) {
    const attemptId = attemptProofInMemory?.fileId;
    setAuthorizationStatus(attemptId && attemptId !== expected.fileId
      ? 'An active attempt is still bound to its original document. Restore that document ID to continue it.'
      : 'An attempt is active for this document. Continue its operation or send its prepared MP4 using the separate action.');
    setSelectionStatus('waiting');
    return;
  }
  if (!expected.valid) {
    resetProof();
    if (keySource === 'saved' && apiKey) {
      apiKeyInMemory = apiKey;
      apiKeySourceInMemory = 'saved';
      savedRecordIdInMemory = state.recordId;
      refreshSavedKeyState();
    }
    resetResults(expected.supplied);
    setAuthorizationStatus('Not started');
    setSelectionStatus('invalid_expected');
    return;
  }
  if (!apiKey || !gisReady || !pickerApiReady) {
    if (keySource === 'saved' && apiKey) {
      apiKeyInMemory = apiKey;
      apiKeySourceInMemory = 'saved';
      savedRecordIdInMemory = state.recordId;
      updateStartButton();
    }
    setAuthorizationStatus('Not started');
    setSelectionStatus(!pickerApiReady ? 'picker_unavailable' : 'metadata_failed');
    return;
  }

  resetProof({ preserveAuthorization: true });
  resetResults(expected.supplied);
  const selectedMode = form.querySelector('input[name="picker-mode"]:checked')?.value;
  const mode = selectedMode === PICKER_MODE_ALL_TYPES_DIAGNOSTIC ? selectedMode : PICKER_MODE_VIDS_ONLY;
  apiKeyInMemory = apiKey;
  apiKeySourceInMemory = keySource;
  savedRecordIdInMemory = keySource === 'saved' ? state.recordId : null;
  apiKeyInput.value = '';
  setBusy(true);

  // Start the GIS popup before awaiting other work so this remains tied to the user's click.
  const tokenPromise = requestAccessTokenFromUserGesture();
  const tokenResult = await tokenPromise;

  if (tokenResult.kind === 'popup_failed') {
    setAuthorizationStatus('Authorization popup could not open');
    setSelectionStatus('popup_failed');
    cleanUpSecrets();
    return;
  }
  if (tokenResult.kind === 'popup_closed') {
    setAuthorizationStatus('Authorization popup was closed');
    setSelectionStatus('popup_closed');
    cleanUpSecrets();
    return;
  }
  if (tokenResult.kind === 'reused') {
    setAuthorizationStatus('Reusing the authorized Google account for this helper tab');
  } else if (tokenResult.kind !== 'response' || tokenResult.response?.error) {
    setAuthorizationStatus('Authorization denied or failed');
    setSelectionStatus('authorization_failed');
    cleanUpSecrets();
    return;
  }

  if (tokenResult.kind === 'response') {
    const tokenResponse = tokenResult.response;
    const oauthApi = window.google.accounts.oauth2;
    if (!hasRequestedScope(tokenResponse, oauthApi) || typeof tokenResponse.access_token !== 'string') {
      setAuthorizationStatus('Requested drive.file scope or token lifetime was not verified');
      setSelectionStatus('scope_missing');
      cleanUpSecrets();
      return;
    }
    accessTokenInMemory = tokenResponse.access_token;
    accessTokenExpiresAt = Number.isFinite(Number(tokenResponse.expires_in))
      ? Date.now() + Number(tokenResponse.expires_in) * 1000
      : 0;
    setAuthorizationStatus('Authorized selected account for drive.file');
  }
  setSelectionStatus('waiting');

  try {
    await loadPickerApi();
    await savedPickerKeyVault.withPickerPermit(keySource === 'saved' ? savedRecordIdInMemory : null, () => {
      if (keySource === 'saved' && !currentTabHasSavedKey()) {
        throw new SavedPickerKeyError('saved_key_changed');
      }
      showPicker(expected.fileId, mode);
    });
  } catch (error) {
    if (error instanceof SavedPickerKeyError) {
      refreshSavedKeyState(savedKeyErrorMessages[error.code]);
      setAuthorizationStatus(savedKeyErrorMessages[error.code] || 'The Picker key could not be used. Check Settings.');
    }
    setSelectionStatus('picker_unavailable');
    cleanUpSecrets();
    return;
  }
}

async function switchGoogleAccount(event) {
  event.preventDefault();
  if (busy) return;
  const activeAttempt = hasActiveAttempt();
  if (activeAttempt) {
    const expected = parseExpectedDocumentId(expectedInput.value);
    if (!expected.valid || expected.fileId !== attemptProofInMemory?.fileId) {
      setAuthorizationStatus('Restore the active attempt document ID before switching Google accounts.');
      return;
    }
  } else {
    resetProof();
  }
  accessTokenInMemory = '';
  accessTokenExpiresAt = 0;
  setBusy(true);
  const tokenResult = await requestAccessTokenFromUserGesture(true);
  if (tokenResult.kind === 'response' && !tokenResult.response?.error &&
    hasRequestedScope(tokenResult.response, window.google.accounts.oauth2) &&
    typeof tokenResult.response.access_token === 'string') {
    accessTokenInMemory = tokenResult.response.access_token;
    accessTokenExpiresAt = Number.isFinite(Number(tokenResult.response.expires_in))
      ? Date.now() + Number(tokenResult.response.expires_in) * 1000
      : 0;
    setAuthorizationStatus(activeAttempt
      ? `Google account authorization renewed. The active attempt remains bound to document ${attemptProofInMemory.fileId}.`
      : 'Google account authorized in this tab. Click Connect / Select Vids Document to verify a document.');
    if (!activeAttempt) setSelectionStatus('waiting');
  } else {
    accessTokenInMemory = '';
    accessTokenExpiresAt = 0;
    setAuthorizationStatus(tokenResult.kind === 'popup_closed' ? 'Google account selection was closed' : 'Google account authorization could not be renewed');
  }
  setBusy(false);
}

savePickerKeyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const keyInput = document.querySelector('#save-picker-key-input');
  const pinInput = document.querySelector('#save-picker-pin');
  const confirmInput = document.querySelector('#save-picker-pin-confirm');
  const apiKey = keyInput.value.trim();
  const pin = pinInput.value;
  const confirmation = confirmInput.value;
  const saveButton = savePickerKeyForm.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  keyInput.value = '';
  pinInput.value = '';
  confirmInput.value = '';
  if (!apiKey || !pin) {
    setSavedKeyStatus(savedKeySettingsStatus, 'Enter the API key and a PIN or passphrase.', 'error');
    saveButton.disabled = false;
    return;
  }
  if (pin !== confirmation) {
    setSavedKeyStatus(savedKeySettingsStatus, 'The PIN confirmation does not match.', 'error');
    saveButton.disabled = false;
    return;
  }
  setSavedKeyStatus(savedKeySettingsStatus, 'Encrypting and saving the key in this browser profile…', 'info');
  void (async () => {
    try {
      const state = await savedPickerKeyVault.saveNew(apiKey, pin);
      apiKeyInMemory = apiKey;
      apiKeySourceInMemory = 'saved';
      savedRecordIdInMemory = state.recordId;
      replaceFormVisible = false;
      renderSavedKeyState(state, 'Key encrypted and saved. It is unlocked in this tab; click Connect on Download when ready.');
    } catch (error) {
      const message = savedKeyErrorMessages[error?.code] || 'Could not save the encrypted Picker key.';
      setSavedKeyStatus(savedKeySettingsStatus, message, 'error');
      refreshSavedKeyState(message);
    } finally {
      keyInput.value = '';
      pinInput.value = '';
      confirmInput.value = '';
      saveButton.disabled = false;
    }
  })();
});

unlockButton.addEventListener('click', () => {
  const pin = unlockPinInput.value;
  unlockPinInput.value = '';
  if (!pin || unlockButton.disabled) return;
  unlockButton.disabled = true;
  void (async () => {
    try {
      const result = await savedPickerKeyVault.unlock(pin);
      if (result.status === 'unlocked') {
        apiKeyInMemory = result.apiKey;
        apiKeySourceInMemory = 'saved';
        savedRecordIdInMemory = result.state.recordId;
        renderSavedKeyState(result.state, 'Saved key unlocked in this tab. Click Connect / Select Vids Document to continue.');
      } else if (result.status === 'wrong_pin') {
        const message = `Incorrect PIN. ${attemptsText(result.state.attemptsRemaining)}.`;
        renderSavedKeyState(result.state, message);
        setSavedKeyStatus(savedKeyDownloadStatus, message, 'error');
        setSavedKeyStatus(savedKeySettingsStatus, message, 'error');
      } else if (result.status === 'locked') {
        clearSavedPickerKeyMemory();
        renderSavedKeyState(result.state, 'Locked after 3 incorrect attempts.');
      } else {
        renderNoSavedKey('No saved key was found. Paste a key or set it up in Settings.');
      }
    } catch (error) {
      const message = savedKeyErrorMessages[error?.code] || 'Could not unlock the saved key.';
      refreshSavedKeyState(message);
      setSavedKeyStatus(savedKeyDownloadStatus, message, 'error');
    } finally {
      unlockPinInput.value = '';
      updateStartButton();
    }
  })();
});

lockSavedKeyButton.addEventListener('click', () => {
  if (busy) return;
  clearSavedPickerKeyMemory();
  refreshSavedKeyState('Saved key locked for this tab. Enter the PIN on Download to unlock it again.');
});

showReplaceSavedKeyButton.addEventListener('click', () => {
  if (showReplaceSavedKeyButton.disabled) return;
  replaceFormVisible = true;
  replacePickerKeyForm.hidden = false;
  document.querySelector('#replace-current-pin').focus();
});

document.querySelector('#cancel-replace-saved-key').addEventListener('click', () => {
  replacePickerKeyForm.reset();
  replaceFormVisible = false;
  replacePickerKeyForm.hidden = true;
});

replacePickerKeyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const currentPinInput = document.querySelector('#replace-current-pin');
  const keyInput = document.querySelector('#replace-picker-key-input');
  const newPinInput = document.querySelector('#replace-picker-pin');
  const confirmationInput = document.querySelector('#replace-picker-pin-confirm');
  const currentPin = currentPinInput.value;
  const newApiKey = keyInput.value.trim();
  const newPin = newPinInput.value;
  const confirmation = confirmationInput.value;
  const submitButton = replacePickerKeyForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  for (const input of [currentPinInput, keyInput, newPinInput, confirmationInput]) {
    input.value = '';
  }
  if (!currentPin || !newApiKey || !newPin) {
    setSavedKeyStatus(savedKeySettingsStatus, 'Enter the current PIN, replacement key, and new PIN.', 'error');
    submitButton.disabled = false;
    return;
  }
  if (newPin !== confirmation) {
    setSavedKeyStatus(savedKeySettingsStatus, 'The new PIN confirmation does not match.', 'error');
    submitButton.disabled = false;
    return;
  }
  setSavedKeyStatus(savedKeySettingsStatus, 'Replacing the encrypted key…', 'info');
  void (async () => {
    try {
      const result = await savedPickerKeyVault.replace(newApiKey, currentPin, newPin);
      if (result.status === 'replaced') {
        apiKeyInMemory = newApiKey;
        apiKeySourceInMemory = 'saved';
        savedRecordIdInMemory = result.state.recordId;
        replaceFormVisible = false;
        renderSavedKeyState(result.state, 'Saved key replaced and encrypted. Click Connect on Download when ready.');
      } else if (result.status === 'wrong_pin') {
        if (result.state.locked) clearSavedPickerKeyMemory();
        const message = result.state.locked ? 'Locked after 3 incorrect attempts.' : `Current PIN is incorrect. ${attemptsText(result.state.attemptsRemaining)}.`;
        renderSavedKeyState(result.state, message);
        setSavedKeyStatus(savedKeySettingsStatus, message, 'error');
      } else if (result.status === 'locked') {
        clearSavedPickerKeyMemory();
        renderSavedKeyState(result.state, 'Locked after 3 incorrect attempts.');
      } else {
        refreshSavedKeyState('No saved key was found to replace.');
      }
    } catch (error) {
      const message = savedKeyErrorMessages[error?.code] || 'Could not replace the saved key.';
      refreshSavedKeyState(message);
      setSavedKeyStatus(savedKeySettingsStatus, message, 'error');
    } finally {
      for (const input of [currentPinInput, keyInput, newPinInput, confirmationInput]) {
        input.value = '';
      }
      submitButton.disabled = false;
    }
  })();
});

forgetSavedKeyButton.addEventListener('click', () => {
  if (busy || !window.confirm('Forget the encrypted Picker key in this browser profile? You will need the actual API key and a new PIN to set it up again.')) {
    return;
  }
  forgetSavedKeyButton.disabled = true;
  void (async () => {
    try {
      await savedPickerKeyVault.forget();
      clearSavedPickerKeyMemory();
      apiKeyInMemory = '';
      apiKeySourceInMemory = '';
      savedRecordIdInMemory = null;
      replacePickerKeyForm.reset();
      replaceFormVisible = false;
      renderNoSavedKey('Saved key forgotten. Enter the actual API key and set a new PIN to save one.');
    } catch (error) {
      const message = savedKeyErrorMessages[error?.code] || 'Could not forget the saved key.';
      refreshSavedKeyState(message);
      setSavedKeyStatus(savedKeySettingsStatus, message, 'error');
    }
  })();
});

window.addEventListener('storage', (event) => {
  if (event.key === SAVED_PICKER_KEY_STORAGE_KEY || event.key === null) {
    refreshSavedKeyState();
  }
});

form.addEventListener('submit', (event) => {
  void startProof(event);
});

window.addEventListener('load', () => {
  gisReady = Boolean(window.google?.accounts?.oauth2?.initTokenClient);
  if (!gisReady) {
    setAuthorizationStatus('Google Identity Services did not load');
  }
  loadPickerApi()
    .then(() => {
      pickerApiReady = true;
      setBusy(false);
    })
    .catch(() => {
      pickerApiReady = false;
      setSelectionStatus('picker_unavailable');
    });
  setBusy(false);
  startButton.textContent = 'Connect / Select Vids Document';
});

document.querySelector('script[src="https://accounts.google.com/gsi/client"]')?.addEventListener('error', () => {
  gisReady = false;
  startButton.disabled = true;
  setAuthorizationStatus('Google Identity Services did not load');
});

document.querySelector('script[src="https://apis.google.com/js/api.js"]')?.addEventListener('error', () => {
  pickerApiReady = false;
  startButton.disabled = true;
  setSelectionStatus('picker_unavailable');
});

document.querySelector('#ack-only-intended-clip')?.addEventListener('change', () => {
  updatePrepareEligibility();
  updatePreparedDownloadDiagnostics();
});
for (const selector of ['#ack-two-clip-order', '#ack-two-clip-saved', '#ack-two-clip-clean-boundary']) {
  document.querySelector(selector)?.addEventListener('change', updatePrepareEligibility);
}
expectedInput.addEventListener('input', () => {
  expectedInputTouched = true;
  expectedInput.dataset.filledFromExtension = 'false';
  document.querySelector('#expected-document-source').hidden = true;
  handleExpectedDocumentChange();
});
document.querySelector('#switch-google-account').addEventListener('click', (event) => {
  void switchGoogleAccount(event);
});
document.querySelector('#prepare-mp4').addEventListener('click', () => {
  void prepareMp4();
});
document.querySelector('#prepare-two-clip-mp4').addEventListener('click', () => {
  void prepareTwoClipMp4();
});
document.querySelector('#prepare-linked-mp4-for-review').addEventListener('click', () => {
  void prepareLinkedMp4ForConfirmedReview();
});
document.querySelector('#continue-operation').addEventListener('click', () => {
  void continueOperationCheck();
});
document.querySelector('#receive-mp4-bytes').addEventListener('click', () => {
  void receiveMp4Bytes();
});
document.querySelector('#open-prepared-mp4').addEventListener('click', openPreparedMp4);
document.querySelector('#send-prepared-mp4-to-extension').addEventListener('click', () => void sendPreparedMp4ToExtension());
document.querySelector('#save-mp4').addEventListener('click', saveMp4);
document.querySelector('#reset-proof').addEventListener('click', resetProof);
refreshSavedKeyState();
void checkExtensionConfiguration();
