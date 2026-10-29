import { createConnectionMessageListener } from "./handlers/connections";
import {
  createChromeFlowImageGenerateOncePort,
  createFlowImageGenerateOnceForWorker,
  createFlowImageReadinessCheck,
  createFlowImageCountDecisionReadback,
  createSavedFlowPromptEntry,
} from "./handlers/flow";
import { createFlowImageObservationHandler } from "./handlers/observations";
import { registerDashboardAction } from "./openDashboard";
import { BUILD_ID, PROTOCOL_VERSION } from "../shared/buildInfo";
import { FOUNDATION_WORKER_RESTARTED } from "../shared/messages";
import {
  ChromePreferenceRepository,
  ExtensionRepositories,
} from "../storage/repositories";
import { providerTabFromUrl } from "../platforms/shared/connection";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
} from "../platforms/shared/contracts";

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
const flowImageReadiness = createFlowImageReadinessCheck(repositories);
const flowImageCountDecision =
  createFlowImageCountDecisionReadback(repositories);
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
    flowImageObservation: flowImageObservation.handle,
    recordConnectionVerification: async (binding) => {
      if (
        binding.extensionBuildId !== BUILD_ID ||
        binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
        binding.connectorBuildId !== BUILD_ID ||
        binding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION ||
        binding.capability !== CONNECTION_CAPABILITY
      )
        return { recorded: false, reason: "verification_metadata_mismatch" };
      const target = providerTabFromUrl(
        binding.tabId,
        binding.canonicalTarget,
        binding.canonicalTarget,
      );
      if (
        !target ||
        target.provider !== binding.provider ||
        target.projectId !== binding.projectId
      )
        return { recorded: false, reason: "verification_selection_mismatch" };
      try {
        const tab = await chrome.tabs.get(binding.tabId);
        if (
          !tab.url ||
          providerTabFromUrl(binding.tabId, "", tab.url)?.canonicalTarget !==
            binding.canonicalTarget
        )
          return { recorded: false, reason: "verification_selection_mismatch" };
        const current = await chrome.scripting.executeScript({
          target: { tabId: binding.tabId, frameIds: [0] },
          func: () => ({ top: window.top === window, href: location.href }),
        });
        const document = current[0];
        if (
          document?.frameId !== 0 ||
          document.documentId !== binding.documentId ||
          document.result?.top !== true ||
          providerTabFromUrl(binding.tabId, "", document.result.href)
            ?.canonicalTarget !== binding.canonicalTarget
        )
          return { recorded: false, reason: "verification_stale_document" };
      } catch {
        return {
          recorded: false,
          reason: "verification_transport_unavailable",
        };
      }
      return {
        recorded: await repositories.recordTargetVerification({
          ...binding,
          verifiedAt: Date.now(),
        }),
        reason: null,
      };
    },
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
