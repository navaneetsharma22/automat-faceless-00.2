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
import { registerDashboardAction } from "./openDashboard";
import {
  createConnectionLifecycleService,
  createReadinessAfterConnectionRevalidation,
} from "./connectionLifecycle";
import { BUILD_ID, PROTOCOL_VERSION } from "../shared/buildInfo";
import {
  CONNECTION_STATE_CHANGED_MESSAGE,
  FOUNDATION_WORKER_RESTARTED,
} from "../shared/messages";
import {
  ChromePreferenceRepository,
  ExtensionRepositories,
} from "../storage/repositories";
import { providerTabFromUrl } from "../platforms/shared/connection";

const repositories = new ExtensionRepositories();
const preferences = new ChromePreferenceRepository({
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
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
  (provider, state, reason) => {
    void chrome.runtime
      .sendMessage({
        type: CONNECTION_STATE_CHANGED_MESSAGE,
        buildId: BUILD_ID,
        protocolVersion: PROTOCOL_VERSION,
        provider,
        state,
        reason,
      })
      .catch(() => undefined);
  },
);
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
const workerReady = Promise.all([
  repositories.markTargetsUnverified(),
  repositories.reconcileInterruptedFlowImageAttempts(),
])
  .then(() => flowImageObservation.resumeReadOnlyAfterWorkerRestart())
  .then(() => undefined);
void workerReady.catch(() => undefined);

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
      const observed = changeInfo.url
        ? providerTabFromUrl(tabId, "", changeInfo.url)
        : undefined;
      const routeMismatch = Boolean(
        changeInfo.url &&
        observed?.canonicalTarget !== selected.canonicalTarget,
      );
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
        }
      } else if (changeInfo.url) {
        await repositories.recordConnectionLifecycleDiagnostic(
          provider,
          {
            kind: "document_changed",
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
    flowPromptEntry,
    flowImageGenerateOnce,
    flowImageReadiness,
    flowImageCountDecision,
    flowCountBlockerInspection,
    flowCountRebaseline,
    flowImageObservation: flowImageObservation.handle,
    revalidateConnection: (provider, enableReconnect) =>
      connectionLifecycle.revalidate(provider, enableReconnect),
  }),
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
