import { createConnectionMessageListener } from "./handlers/connections";
import {
  createChromeFlowImageGenerateOncePort,
  createFlowImageGenerateOnceForWorker,
  createFlowImageReadinessCheck,
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
    flowImageObservation: flowImageObservation.handle,
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
