import { createConnectionMessageListener } from "./handlers/connections";
import {
  createChromeFlowImageGenerateOncePort,
  createFlowImageGenerateOnceForWorker,
  createFlowImageReadinessCheck,
  createFlowCountBlockerInspection,
  createFlowCountRebaseline,
  createFlowImageCountDecisionReadback,
  createSavedFlowPromptEntry,
} from "./handlers/flow";
import { createFlowImageObservationHandler } from "./handlers/observations";
import { createFlowReferenceHandler } from "./handlers/references";
import {
  FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
  createFlowReferenceContextMenuProperties,
  flowReferenceContextMenuId,
} from "../platforms/flow/references";
import { registerDashboardAction } from "./openDashboard";
import {
  createConnectionLifecycleService,
  createReadinessAfterConnectionRevalidation,
} from "./connectionLifecycle";
import { classifyProviderRouteUpdate } from "../platforms/shared/providerRoute";
import { BUILD_ID, PROTOCOL_VERSION } from "../shared/buildInfo";
import {
  CONNECTION_STATE_CHANGED_MESSAGE,
  FOUNDATION_WORKER_RESTARTED,
} from "../shared/messages";
import {
  ChromePreferenceRepository,
  ExtensionRepositories,
} from "../storage/repositories";
import { CHROME_MIN_ALARM_DELAY_MS, createTimedImageQueueScheduler } from "./scheduler";
import {
  createFlowTimedQueueDispatcher,
  ImageQueueInspectionError,
  inspectFlowEditorAgainstQueueItem,
} from "./generationQueue";
import { flowTabFromUrl } from "../platforms/flow/connection";
import { createFlowVideoAttachmentHandler } from "./handlers/flowVideoAttachment";
import { createFlowVideoGenerateHandler } from "./handlers/flowVideo";
import { createFlowVideoQueueHandler } from "./handlers/flowVideoQueue";
import { createVidsVideoAttachmentHandler } from "./handlers/vidsVideoAttachment";
import { createVidsVideoGenerateHandler } from "./handlers/vidsVideo";
import { createVidsVideoQueueHandler } from "./handlers/vidsVideoQueue";
import { createRetryableVidsReadiness, createVidsAlarmLifecycle, createVidsStartupRetryController } from "./vidsAlarmLifecycle";
import { createFlowDownloadDiagnosticManager } from "./flowDownloadDiagnostic";
import { createHostedHelperConfigListener } from "./handlers/hostedHelper";
import { createVidsTimelineReadyHandler } from "./vidsTimelineReady";
import { createVidsDownloadManager } from "./downloadManager";
import { createHostedVidsDownloadListener, createVidsDownloadHandler } from "./handlers/vidsDownload";

const repositories = new ExtensionRepositories();
const preferences = new ChromePreferenceRepository({
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
});
const vidsDownloadManager = createVidsDownloadManager({
  preferences,
  downloads: {
    download: (options) => chrome.downloads.download(options),
    search: (query) => chrome.downloads.search(query),
  },
});
const vidsTimelineReady = createVidsTimelineReadyHandler({
  preferences,
  repositories,
  revalidate: () => connectionLifecycle.revalidate("Vids", false),
});
const flowPromptEntry = createSavedFlowPromptEntry(repositories);
const flowPort = createChromeFlowImageGenerateOncePort(repositories);
const flowImageGenerateOnce = createFlowImageGenerateOnceForWorker(
  repositories,
  flowPort,
);
const connectionLifecycle = createConnectionLifecycleService(
  repositories,
  undefined,
  (provider, state, reason, failureStage) => {
    void chrome.runtime
      .sendMessage({
        type: CONNECTION_STATE_CHANGED_MESSAGE,
        buildId: BUILD_ID,
        protocolVersion: PROTOCOL_VERSION,
        provider,
        state,
        reason,
        ...(failureStage ? { failureStage } : {}),
      })
      .catch(() => undefined);
  },
);
const vidsDownload = createVidsDownloadHandler({
  extensionId: chrome.runtime.id,
  preferences,
  repositories,
  manager: vidsDownloadManager,
  revalidate: () => connectionLifecycle.revalidate("Vids", false),
});
chrome.downloads?.onChanged?.addListener((delta) => {
  void vidsDownloadManager.onChanged(delta);
});
chrome.runtime.onStartup.addListener(() => {
  void vidsDownloadManager.reconcile();
});
void vidsDownloadManager.reconcile();
const flowImageReadinessCheck = createFlowImageReadinessCheck(repositories);
const flowImageReadiness = createReadinessAfterConnectionRevalidation(
  connectionLifecycle.revalidate,
  flowImageReadinessCheck,
);
const flowImageCountDecision =
  createFlowImageCountDecisionReadback(repositories);
const flowCountBlockerInspection =
  createFlowCountBlockerInspection(repositories);
const flowCountRebaseline = createFlowCountRebaseline(repositories);
const flowImageObservation = createFlowImageObservationHandler({
  extensionId: chrome.runtime.id,
  repositories,
  port: flowPort,
});
const contextMenuReady = new Promise<void>((resolve) => {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    resolve();
  });
});
const flowReferenceHandler = createFlowReferenceHandler({
  extensionId: chrome.runtime.id,
  repositories,
  contextMenu: {
    ready: contextMenuReady,
    create: async (session) => {
      await contextMenuReady;
      await new Promise<void>((resolve, reject) => {
        chrome.contextMenus.create(
          createFlowReferenceContextMenuProperties(session),
          () => {
            if (chrome.runtime.lastError) {
              reject(
                new Error("Flow reference context menu could not be created."),
              );
              return;
            }
            resolve();
          },
        );
      });
    },
    remove: async (sessionId) => {
      await contextMenuReady;
      await new Promise<void>((resolve) => {
        chrome.contextMenus.remove(
          flowReferenceContextMenuId(sessionId),
          () => {
            void chrome.runtime.lastError;
            resolve();
          },
        );
      });
    },
  },
  sendToDocument: (tabId, documentId, message) =>
    chrome.tabs.sendMessage(tabId, message, { documentId }),
});
const flowVideoAttachment = createFlowVideoAttachmentHandler({
  repositories,
  scripting: {
    executeScript: (input) => chrome.scripting.executeScript(input as never),
  },
  getTab: async (tabId) => chrome.tabs.get(tabId),
  revalidate: () => connectionLifecycle.revalidate("Flow", false),
  hasMediaHostPermission: (permission) =>
    chrome.permissions.contains({ origins: [permission] }),
});
const flowVideoGenerate = createFlowVideoGenerateHandler({
  repositories,
  scripting: {
    executeScript: (input) => chrome.scripting.executeScript(input as never),
  },
  getTab: async (tabId) => chrome.tabs.get(tabId),
  revalidate: () => connectionLifecycle.revalidate("Flow", false),
  promptPort: flowPort,
});
const vidsVideoAttachment = createVidsVideoAttachmentHandler({
  repositories,
  scripting: { executeScript: (input) => chrome.scripting.executeScript(input as never) },
  getTab: async (tabId) => chrome.tabs.get(tabId),
  revalidate: () => connectionLifecycle.revalidate("Vids", false),
  queueCanContinue: async (preparedBatchId) => ["preparing", "checking_generate"].includes((await repositories.getVidsVideoQueue(`vids-video:${preparedBatchId}`))?.state ?? ""),
});
const vidsVideoGenerate = createVidsVideoGenerateHandler({
  repositories,
  scripting: { executeScript: (input) => chrome.scripting.executeScript(input as never) },
  getTab: async (tabId) => chrome.tabs.get(tabId),
  revalidate: () => connectionLifecycle.revalidate("Vids", false),
  queueCanContinue: async (preparedBatchId, itemId, promptHash, referenceId, referenceSha256) => {
    const queue = await repositories.getVidsVideoQueue(`vids-video:${preparedBatchId}`);
    const item = queue?.items.find((candidate) => candidate.itemId === itemId);
    return queue?.preparedBatchId === preparedBatchId && queue.state === "checking_generate" && item?.state === "sending" && item.promptHash === promptHash && item.referenceId === referenceId && item.referenceSha256 === referenceSha256;
  },
});
const vidsVideoQueue = createVidsVideoQueueHandler({
  repositories,
  alarms: chrome.alarms,
  revalidate: () => connectionLifecycle.revalidate("Vids", false),
  attach: (preparedBatchId, itemId, fromQueue) => vidsVideoAttachment.attach(preparedBatchId, itemId, fromQueue),
  getAttachment: (preparedBatchId, itemId) => vidsVideoAttachment.get(preparedBatchId, itemId),
  generate: (preparedBatchId, itemId, fromQueue) => vidsVideoGenerate.generateOnce(preparedBatchId, itemId, fromQueue),
  getGeneration: (preparedBatchId, itemId) => vidsVideoGenerate.get(preparedBatchId, itemId),
  transitionFromPrevious: (preparedBatchId, itemId, inspectOnly, nextItemId, checkpointedOwnership, phase, traceContext) => vidsVideoGenerate.transitionFromPrevious(preparedBatchId, itemId, inspectOnly, nextItemId, checkpointedOwnership, phase, traceContext) as Promise<{ status: "ready" | "blocked"; reason?: string; diagnostics?: unknown }>,
});
const flowVideoQueue = createFlowVideoQueueHandler({
  repositories,
  alarms: chrome.alarms,
  attachReference: (preparedBatchId, itemId) => flowVideoAttachment.attach(preparedBatchId, itemId),
  generateOnce: (preparedBatchId, itemId) => flowVideoGenerate.generateOnce(preparedBatchId, itemId),
  inspectReferenceBytes: (preparedBatchId, itemId) =>
    flowVideoAttachment.inspectReferenceBytes(preparedBatchId, itemId),
  revalidate: async (preparedBatchId) => {
    await connectionLifecycle.revalidate("Flow", false);
    const batch = await repositories.getPreparedVideoBatchById(preparedBatchId);
    const selected = await repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (!batch || !selected || selected.verification !== "verified" || !binding ||
      selected.tabId !== batch.target.tabId || selected.canonicalTarget !== batch.target.canonicalTarget ||
      binding.projectId !== batch.target.projectId || binding.documentId !== batch.target.documentId)
      return "selected_flow_target_changed";
    try {
      const tab = await chrome.tabs.get(selected.tabId);
      const route = flowTabFromUrl(selected.tabId, tab.title ?? "", tab.url);
      const [document] = await chrome.scripting.executeScript({
        target: { tabId: selected.tabId, frameIds: [0] },
        func: () => location.href,
      });
      const documentRoute = flowTabFromUrl(selected.tabId, "", document?.result);
      if (!route || route.canonicalTarget !== selected.canonicalTarget ||
        document?.documentId !== binding.documentId || document.frameId !== 0 ||
        !documentRoute || documentRoute.canonicalTarget !== selected.canonicalTarget)
        return "selected_flow_document_changed";
    } catch {
      return "selected_flow_target_unavailable";
    }
    return undefined;
  },
});
const flowDownloadDiagnostic = createFlowDownloadDiagnosticManager({
  extensionId: chrome.runtime.id,
  repositories,
  permissions: {
    contains: (input) => chrome.permissions.contains(input as never),
  },
  tabs: chrome.tabs,
  revalidateFlowConnection: () =>
    connectionLifecycle.revalidate("Flow", false).then((result) => ({
      ok: result.state === "verified",
      state: result.state,
    })),
  scripting: {
    executeScript: (input) => chrome.scripting.executeScript(input as never),
  },
  debugger: {
    attach: (target, version) => chrome.debugger.attach(target, version),
    sendCommand: (target, method, params) =>
      chrome.debugger.sendCommand(target, method, params),
    detach: (target) => chrome.debugger.detach(target),
    onEvent: chrome.debugger.onEvent,
    onDetach: chrome.debugger.onDetach,
  },
  downloads: {
    onCreated: {
      available: () => Boolean(chrome.downloads?.onCreated?.addListener),
      addListener: (listener) =>
        chrome.downloads?.onCreated?.addListener(listener as never),
      removeListener: (listener) =>
        chrome.downloads?.onCreated?.removeListener(listener as never),
    },
    onChanged: {
      available: () => Boolean(chrome.downloads?.onChanged?.addListener),
      addListener: (listener) =>
        chrome.downloads?.onChanged?.addListener(listener as never),
      removeListener: (listener) =>
        chrome.downloads?.onChanged?.removeListener(listener as never),
    },
    search: (query) => chrome.downloads.search(query),
  },
  storage: {
    get: (key) => chrome.storage.session.get(key),
    set: (value) => chrome.storage.session.set(value),
    remove: (key) => chrome.storage.session.remove(key),
  },
  alarms: chrome.alarms,
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    const result = await flowReferenceHandler.handleContextMenu(info, tab);
    if (!result.accepted || !result.session) return;
    void chrome.tabs
      .sendMessage(
        result.session.tabId,
        {
          type: FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
          sessionId: result.session.sessionId,
          shotId: result.session.shotId,
        },
        { documentId: result.session.documentId },
      )
      .catch(() => undefined);
  })().catch(() => undefined);
});
void flowReferenceHandler.restoreActiveContextMenu().catch(() => undefined);
const timedQueueScheduler = createTimedImageQueueScheduler({
  repositories,
  dispatch: createFlowTimedQueueDispatcher(repositories),
  alarms: chrome.alarms,
  verifyTargetForContinuation: async (queue) => {
    const selected = await repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (
      !selected ||
      selected.tabId !== queue.selectedProject.tabId ||
      selected.canonicalTarget !== queue.selectedProject.canonicalTarget ||
      !binding ||
      binding.tabId !== selected.tabId ||
      binding.projectId !== queue.selectedProject.projectId ||
      binding.canonicalTarget !== selected.canonicalTarget ||
      binding.extensionBuildId !== BUILD_ID ||
      binding.connectorBuildId !== BUILD_ID ||
      binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
      binding.connectorProtocolVersion !== 1
    )
      return "selected_project_or_connection_changed";
    try {
      const tab = await chrome.tabs.get(selected.tabId);
      const tabBinding = flowTabFromUrl(
        selected.tabId,
        tab.title ?? "",
        tab.url,
      );
      if (
        !tabBinding ||
        tabBinding.canonicalTarget !== selected.canonicalTarget
      )
        return "selected_tab_project_mismatch";
      const [document] = await chrome.scripting.executeScript({
        target: { tabId: selected.tabId, frameIds: [0] },
        func: () => location.href,
      });
      if (
        !document?.documentId ||
        document.documentId !== binding.documentId ||
        document.frameId !== 0
      )
        return "selected_document_changed";
      const documentBinding = flowTabFromUrl(
        selected.tabId,
        "",
        document.result,
      );
      if (
        !documentBinding ||
        documentBinding.canonicalTarget !== selected.canonicalTarget
      )
        return "selected_document_project_mismatch";
      await repositories.recordTargetVerification({
        ...binding,
        verifiedAt: Date.now(),
      });
      return undefined;
    } catch {
      return "selected_target_unavailable_for_revalidation";
    }
  },
});
const targetStartupReady = repositories.markTargetsUnverified();
const workerReady = Promise.all([
  targetStartupReady,
  repositories.reconcileInterruptedFlowImageAttempts(),
])
  .then(() => flowImageObservation.resumeReadOnlyAfterWorkerRestart())
  .then(() => undefined);
// Reconciliation is intentionally limited to durable queue state and alarm
// restoration, so queue messages can await it without waiting on dispatch.
const nonVidsQueueReady = targetStartupReady.then(async () => {
  await Promise.all([timedQueueScheduler.reconcileStartup(), flowVideoQueue.reconcileStartup()]);
});
const ensureVidsQueueReady = createRetryableVidsReadiness(targetStartupReady, () => vidsVideoQueue.reconcileStartup());
const vidsQueueReady = ensureVidsQueueReady();
const timedQueueReady = Promise.all([nonVidsQueueReady, vidsQueueReady]).then(() => undefined);
const vidsStartupRetry = createVidsStartupRetryController({ alarms: chrome.alarms, ready: ensureVidsQueueReady, minimumDelayMs: CHROME_MIN_ALARM_DELAY_MS });
void vidsQueueReady.catch(vidsStartupRetry.scheduleForFailure);
void workerReady.catch(() => undefined);
const vidsAlarmListener = createVidsAlarmLifecycle({
  prefix: "automat-vids-video-queue:",
  ready: ensureVidsQueueReady,
  recordReceived: vidsVideoQueue.recordAutomaticAlarmReceived,
  recordReconciliation: vidsVideoQueue.recordAutomaticAlarmReconciliation,
  dispatch: (name, scheduledTime) => vidsVideoQueue.onAlarm(name, scheduledTime),
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "automat-flow-gallery-download-diagnostic-expire") {
    void flowDownloadDiagnostic.onAlarm(alarm.name);
    return;
  }
  if (vidsStartupRetry.handleAlarm(alarm.name)) return;
  if (alarm.name.startsWith("automat-vids-video-queue:")) {
    vidsAlarmListener(alarm);
    return;
  }
  void nonVidsQueueReady.then(() => Promise.all([
    timedQueueScheduler.onAlarm(alarm.name),
    flowVideoQueue.onAlarm(alarm.name),
  ])).catch(() => undefined);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void ensureVidsQueueReady().then(() => vidsVideoQueue.onTargetVisible(tabId)).catch(() => undefined);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void ensureVidsQueueReady().then(async () => {
    const tabs = await chrome.tabs.query({ active: true, windowId });
    const tab = tabs[0];
    if (tab?.id !== undefined) await vidsVideoQueue.onTargetVisible(tab.id);
  }).catch(() => undefined);
});
void timedQueueReady.catch(() => undefined);

// Persist only bounded lifecycle categories. URLs, titles and account data are
// intentionally excluded; these are browser-observed events, not refresh causes.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void (async () => {
    for (const provider of ["Flow", "Vids"] as const) {
      const selected = await repositories.getSelectedTarget(provider);
      if (selected?.tabId !== tabId) continue;
      if (changeInfo.discarded === true) {
        const updated = await repositories.setTargetConnectionState(
          provider,
          "temporarily-unreachable",
          selected.revision,
          true,
        );
        if (updated) {
          await repositories.recordConnectionLifecycleDiagnostic(
            provider,
            {
              kind: "tab_discarded",
              reason: "browser_discard_signal",
              at: Date.now(),
            },
            selected,
          );
          void chrome.runtime
            .sendMessage({
              type: CONNECTION_STATE_CHANGED_MESSAGE,
              buildId: BUILD_ID,
              protocolVersion: PROTOCOL_VERSION,
              provider,
              state: "temporarily-unreachable",
              reason: "browser_discard_signal",
            })
            .catch(() => undefined);
        }
      }
      const routeUpdate = changeInfo.url
        ? classifyProviderRouteUpdate(selected.canonicalTarget, changeInfo.url)
        : undefined;
      const routeMismatch = routeUpdate === "project_route_changed";
      if (changeInfo.status === "loading" || routeMismatch) {
        const reason = routeMismatch
          ? "project_route_changed"
          : "browser_loading_signal";
        const updated = await repositories.setTargetConnectionState(
          provider,
          "stale-document",
          selected.revision,
          true,
        );
        if (updated) {
          await repositories.recordConnectionLifecycleDiagnostic(
            provider,
            {
              kind: routeMismatch ? "document_changed" : "tab_reload_signal",
              reason,
              at: Date.now(),
            },
            selected,
          );
          void chrome.runtime
            .sendMessage({
              type: CONNECTION_STATE_CHANGED_MESSAGE,
              buildId: BUILD_ID,
              protocolVersion: PROTOCOL_VERSION,
              provider,
              state: "stale-document",
              reason,
            })
            .catch(() => undefined);
          if (provider === "Flow") {
            void flowReferenceHandler.invalidateActiveSession(reason);
          }
        }
      } else if (changeInfo.url) {
        await repositories.recordConnectionLifecycleDiagnostic(
          provider,
          {
            kind: "same_project_route_changed",
            reason: "url_changed_same_project",
            at: Date.now(),
          },
          selected,
        );
      }
      if (
        changeInfo.status === "complete" &&
        selected.reconnectEnabled !== false
      )
        void connectionLifecycle.revalidate(provider);
    }
  })().catch(() => undefined);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    for (const provider of ["Flow", "Vids"] as const) {
      const selected = await repositories.getSelectedTarget(provider);
      if (selected?.tabId !== tabId) continue;
      const updated = await repositories.setTargetConnectionState(
        provider,
        "disconnected",
        selected.revision,
        true,
      );
      if (!updated) continue;
      await repositories.recordConnectionLifecycleDiagnostic(
        provider,
        {
          kind: "tab_closed",
          reason: "browser_tab_removed",
          at: Date.now(),
        },
        selected,
      );
      void chrome.runtime
        .sendMessage({
          type: CONNECTION_STATE_CHANGED_MESSAGE,
          buildId: BUILD_ID,
          protocolVersion: PROTOCOL_VERSION,
          provider,
          state: "disconnected",
          reason: "browser_tab_removed",
        })
        .catch(() => undefined);
      if (provider === "Flow") {
        void flowReferenceHandler.invalidateActiveSession(
          "browser_tab_removed",
        );
      }
    }
  })().catch(() => undefined);
});
chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
  void (async () => {
    for (const provider of ["Flow", "Vids"] as const) {
      const selected = await repositories.getSelectedTarget(provider);
      if (selected?.tabId !== removedTabId) continue;
      const updated = await repositories.setTargetConnectionState(
        provider,
        "stale-document",
        selected.revision,
        true,
      );
      if (!updated) continue;
      await repositories.recordConnectionLifecycleDiagnostic(
        provider,
        {
          kind: "tab_replaced",
          reason: "browser_tab_replaced",
          at: Date.now(),
        },
        selected,
      );
      void chrome.runtime
        .sendMessage({
          type: CONNECTION_STATE_CHANGED_MESSAGE,
          buildId: BUILD_ID,
          protocolVersion: PROTOCOL_VERSION,
          provider,
          state: "stale-document",
          reason: "browser_tab_replaced",
        })
        .catch(() => undefined);
      if (provider === "Flow") {
        void flowReferenceHandler.invalidateActiveSession(
          "browser_tab_replaced",
        );
      }
    }
  })().catch(() => undefined);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void (async () => {
    for (const provider of ["Flow", "Vids"] as const) {
      const selected = await repositories.getSelectedTarget(provider);
      if (selected?.tabId === tabId && selected.reconnectEnabled !== false)
        void connectionLifecycle.revalidate(provider);
    }
  })().catch(() => undefined);
});
// Register extension listeners synchronously during worker evaluation.
chrome.runtime.onMessage.addListener(
  createConnectionMessageListener(chrome.runtime.id, {
    repositories,
    preferences,
    ready: workerReady,
    timedQueueReady,
    flowPromptEntry,
    flowImageGenerateOnce,
    flowImageReadiness,
    flowImageCountDecision,
    flowCountBlockerInspection,
    flowCountRebaseline,
    flowImageObservation: flowImageObservation.handle,
    flowReferenceHandler,
    flowVideoAttachment,
    vidsVideoAttachment,
    vidsVideoGenerate,
    vidsVideoQueue,
    flowVideoGenerateOnce: flowVideoGenerate.generateOnce,
    flowVideoQueue,
    flowDownloadDiagnostic,
    startTimedImageQueue: timedQueueScheduler.start,
    commandTimedImageQueue: (command, queueId, expectedRevision) =>
      timedQueueScheduler[command](queueId, expectedRevision),
    revalidateConnection: (provider, enableReconnect) =>
      connectionLifecycle.revalidate(provider, enableReconnect),
    vidsTimelineReady,
    vidsDownload,
    inspectTimedQueueItemReadback: (queueId, order) =>
      inspectFlowEditorAgainstQueueItem({ repositories, queueId, order }),
    retryBlockedImageQueueItem: async (queueId, expectedRevision, order) => {
      const inspection = await inspectFlowEditorAgainstQueueItem({
        repositories,
        queueId,
        order,
      });
      if (!inspection.equal || !inspection.actualSha256) {
        throw new ImageQueueInspectionError(
          "editor_readback",
          "fresh_exact_check_failed",
          "The live Flow editor does not exactly match the saved prompt.",
          "invalid_request",
        );
      }
      return await repositories.retryBlockedTimedImageQueueItem({
        queueId,
        expectedRevision,
        order,
        at: Date.now(),
        freshExactSha256: inspection.actualSha256,
      });
    },
  }),
);
chrome.runtime.onMessageExternal.addListener(
  createHostedHelperConfigListener(chrome.runtime.id),
);
chrome.runtime.onMessageExternal.addListener(
  createHostedVidsDownloadListener(vidsDownload),
);
registerDashboardAction(chrome);

// A dashboard must discard any in-memory Connected claim when the worker wakes.
void chrome.runtime
  .sendMessage({
    type: FOUNDATION_WORKER_RESTARTED,
    buildId: BUILD_ID,
    workerInstanceId: crypto.randomUUID(),
    protocolVersion: PROTOCOL_VERSION,
  })
  .catch(() => undefined);

console.info(
  `Automat Faceless worker ready (${BUILD_ID}, protocol ${PROTOCOL_VERSION}).`,
);
