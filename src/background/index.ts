import { createConnectionMessageListener } from "./handlers/connections";
import {
  createFlowImageGenerateOnceForWorker,
  createChromeFlowPromptEntryPort,
  createFlowPromptEntry,
} from "./handlers/flow";
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
const workerReady = Promise.all([
  repositories.markTargetsUnverified(),
  repositories.reconcileInterruptedFlowImageAttempts(),
]).then(() => undefined);
void workerReady.catch(() => undefined);
const flowPromptEntry = createFlowPromptEntry(
  createChromeFlowPromptEntryPort(repositories),
);
const flowImageGenerateOnce =
  createFlowImageGenerateOnceForWorker(repositories);

// Register extension listeners synchronously during worker evaluation.
chrome.runtime.onMessage.addListener(
  createConnectionMessageListener(chrome.runtime.id, {
    repositories,
    preferences,
    ready: workerReady,
    flowPromptEntry,
    flowImageGenerateOnce,
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
