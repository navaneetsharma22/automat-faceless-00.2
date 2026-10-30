import { AutomatDatabase } from "../../src/storage/db";
import {
  createDexieRepositoryDatabase,
  ExtensionRepositories,
  sha256Hex,
} from "../../src/storage/repositories";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import {
  createChromeFlowImageGenerateOncePort,
  createFlowImageCountDecisionReadback,
  createFlowImageGenerateOnceForWorker,
  createFlowImageReadinessCheck,
} from "../../src/background/handlers/flow";
import { createFlowImageObservationHandler } from "../../src/background/handlers/observations";
import {
  createConnectionLifecycleService,
  createReadinessAfterConnectionRevalidation,
} from "../../src/background/connectionLifecycle";
import type {
  ConnectionPort,
  ConnectionProbeRequest,
  ProviderTab,
} from "../../src/platforms/shared/contracts";
import { createFoundationClient } from "../../src/shared/messageClient";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";

const projectId = "observation-e2e-project";
const tabId = 41;
const canonicalTarget = `https://flow.google.com/project/${projectId}`;
const documentId = "fixture-document";
const frameId = "fixture-frame";
const loaderId = "fixture-loader";
const extensionId = "fixture-extension";
const rawJsonBody = '{"shot_id":"05","scene":"synthetic fixture"}';
const countSessionId = "290cfdaa-9655-4905-a7b0-54cff19297bb";
const confirmationId = "fixture-confirmation";
const candidateObjects = new Map<string, Element>();
const chromeListeners: Array<(...args: never[]) => unknown> = [];
let connectorScriptSource = "";
let syntheticActivationCount = 0;
let debuggerAttached = false;
let worker: ReturnType<typeof createConnectionMessageListener>;
let activeFixture: {
  attemptId: string;
  readReport: () => Promise<Record<string, unknown>>;
  close: () => Promise<void>;
} | null = null;

function installChromeFacade() {
  const listeners = chromeListeners as Array<
    (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => unknown
  >;
  const runtime = {
    id: extensionId,
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: unknown,
          sendResponse: (value: unknown) => void,
        ) => unknown,
      ) {
        if (!listeners.includes(listener)) listeners.push(listener);
      },
      removeListener(
        listener: (
          message: unknown,
          sender: unknown,
          sendResponse: (value: unknown) => void,
        ) => unknown,
      ) {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    },
    sendMessage(message: unknown) {
      return dispatchThroughWorker(message, {
        id: extensionId,
        tab: { id: tabId, url: canonicalTarget },
        frameId: 0,
        documentId,
      });
    },
  };
  const tab = {
    id: tabId,
    title: "Synthetic Flow project",
    url: canonicalTarget,
  };
  const chromeFacade = {
    runtime,
    permissions: { contains: async () => true },
    tabs: {
      get: async (id: number) => (id === tabId ? tab : undefined),
      sendMessage: async (_id: number, message: unknown) =>
        new Promise((resolve) => {
          const listener = listeners[0];
          if (!listener) return resolve(undefined);
          listener(
            message,
            { id: extensionId, tab, frameId: 0, documentId },
            resolve,
          );
        }),
    },
    scripting: {
      executeScript: async (details: {
        func?: (...args: unknown[]) => unknown;
        args?: unknown[];
        files?: string[];
      }) => {
        let result: unknown;
        if (details.files?.includes("connection-probe.js")) {
          if (!connectorScriptSource)
            throw new Error("fixture_connector_asset_missing");
          (0, eval)(connectorScriptSource);
        } else if (details.func) {
          result = await details.func(...(details.args ?? []));
        }
        return [{ frameId: 0, documentId, result }];
      },
    },
    debugger: {
      attach: async () => {
        debuggerAttached = true;
      },
      detach: async () => {
        debuggerAttached = false;
      },
      getTargets: async () => [{ tabId, attached: debuggerAttached }],
      sendCommand: async (
        _target: unknown,
        method: string,
        params?: Record<string, unknown>,
      ) => {
        if (method === "Page.getFrameTree")
          return {
            frameTree: {
              frame: { id: frameId, loaderId, url: canonicalTarget },
            },
          };
        if (method === "Runtime.evaluate") {
          const value = await (0, eval)(String(params?.expression ?? ""));
          if (params?.returnByValue === false && value instanceof Element) {
            const objectId = `fixture-node-${candidateObjects.size + 1}`;
            candidateObjects.set(objectId, value);
            return { result: { objectId, subtype: "node" } };
          }
          return { result: { value } };
        }
        if (method === "Runtime.callFunctionOn") {
          const element = candidateObjects.get(String(params?.objectId ?? ""));
          if (!element) throw new Error("fixture_cdp_node_missing");
          const call = (0, eval)(
            `(${String(params?.functionDeclaration ?? "")})`,
          );
          const value = await call.call(element);
          return { result: { value } };
        }
        if (method === "Input.insertText") {
          const editor = document.querySelector<HTMLElement>(
            '[contenteditable="true"][role="textbox"]',
          );
          if (!editor) throw new Error("fixture_editor_missing");
          editor.textContent = String(params?.text ?? "");
          editor.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: String(params?.text ?? ""),
            }),
          );
          return {};
        }
        if (method === "Input.dispatchMouseEvent") {
          if (
            params?.type === "mouseReleased" &&
            syntheticActivationCount === 0
          ) {
            syntheticActivationCount += 1;
            const button = document.querySelector<HTMLButtonElement>(
              "flow-base-prompt-box button",
            );
            button?.click();
          }
          return {};
        }
        return {};
      },
    },
  };
  (globalThis as typeof globalThis & { chrome?: unknown }).chrome =
    chromeFacade;
}

async function dispatchThroughWorker(message: unknown, sender: unknown) {
  return await new Promise<unknown>((resolve) => {
    worker(message, sender as never, resolve as never);
  });
}

export async function setupProductionObservationFixture(
  connectorSource: string,
) {
  try {
    connectorScriptSource = connectorSource;
    installChromeFacade();
    syntheticActivationCount = 0;
    const database = new AutomatDatabase(
      `flow-observation-e2e-${crypto.randomUUID()}`,
    );
    await database.open();
    const repositories = new ExtensionRepositories(
      createDexieRepositoryDatabase(database),
    );
    const flowPort = createChromeFlowImageGenerateOncePort(repositories);
    const selectedTab: ProviderTab = {
      id: tabId,
      title: "Synthetic Flow project",
      url: canonicalTarget,
      provider: "Flow",
      projectId,
      canonicalTarget,
    };
    const requestProbe = (request: ConnectionProbeRequest) =>
      new Promise<unknown>((resolve) => {
        const listener = chromeListeners[0] as unknown as
          | ((
              message: unknown,
              sender: unknown,
              sendResponse: (value: unknown) => void,
            ) => unknown)
          | undefined;
        if (!listener) return resolve(undefined);
        listener(
          request,
          {
            id: extensionId,
            tab: { id: tabId, url: canonicalTarget },
            frameId: 0,
            documentId,
          },
          resolve,
        );
      });
    let connectorPresent = false;
    const connectorPort: ConnectionPort = {
      getMissingAccess: async () => ({}),
      getTab: async () => selectedTab,
      pingTopFrame: async (_id, request) =>
        connectorPresent ? ((await requestProbe(request)) as never) : undefined,
      identifyDocument: async () => ({
        documentId,
        frameId: 0,
        url: canonicalTarget,
      }),
      injectConnector: async () => {
        (0, eval)(connectorScriptSource);
        connectorPresent = true;
        return { documentId, frameId: 0, url: canonicalTarget };
      },
      probeTopFrame: async (_id, _documentId, request) =>
        (await requestProbe(request)) as never,
      releaseConnector: async () => {
        connectorPresent = false;
      },
      makeAttemptId: () => crypto.randomUUID(),
    };
    const lifecycle = createConnectionLifecycleService(
      repositories,
      () => connectorPort,
    );
    const observation = createFlowImageObservationHandler({
      extensionId,
      repositories,
      port: flowPort,
    });
    const workerReady = repositories.markTargetsUnverified();
    const readiness = createReadinessAfterConnectionRevalidation(
      lifecycle.revalidate,
      createFlowImageReadinessCheck(repositories),
    );
    worker = createConnectionMessageListener(extensionId, {
      repositories,
      preferences: {
        getTheme: async () => "light",
        setTheme: async () => undefined,
      } as never,
      ready: workerReady,
      revalidateConnection: (provider, enableReconnect) =>
        lifecycle.revalidate(provider, enableReconnect),
      flowImageReadiness: readiness,
      flowImageGenerateOnce: createFlowImageGenerateOnceForWorker(
        repositories,
        flowPort,
      ),
      flowImageObservation: observation.handle,
      flowImageCountDecision:
        createFlowImageCountDecisionReadback(repositories),
    });
    const client = createFoundationClient({
      sendMessage: (request) =>
        dispatchThroughWorker(request, {
          id: extensionId,
          url: `chrome-extension://${extensionId}/index.html`,
        }),
    });

    const selection = await client.request("connections.recordSelection", {
      provider: "Flow",
      tabId,
      canonicalTarget,
    });
    const connection = (await client.request("connections.revalidate", {
      provider: "Flow",
      enableReconnect: true,
    })) as Record<string, unknown>;
    const savedSource = (await client.request("promptBatch.put", {
      workspaceId: "default",
      kind: "image",
      sourceText: rawJsonBody,
    })) as { items?: Array<{ contentHash: string }> };
    const promptHash = savedSource.items?.[0]?.contentHash;
    if (!promptHash) throw new Error("fixture_saved_source_missing_hash");
    const countMode = {
      mode: "existing_project" as const,
      countSessionId,
      startingImageCount: 4,
      userConfirmed: true as const,
    };
    const firstReadiness = (await client.request("flow.image.checkReadiness", {
      countMode,
    })) as Record<string, unknown>;
    const afterFirstReadiness = await repositories.getSelectedTarget("Flow");
    const secondReadiness = (await client.request("flow.image.checkReadiness", {
      countMode,
    })) as Record<string, unknown>;
    const afterSecondReadiness = await repositories.getSelectedTarget("Flow");
    const generation = (await client.request("flow.image.generateOnce", {
      workspaceId: "default",
      promptHash,
      settingsConfirmation: {
        confirmationId,
        confirmedAt: Date.now(),
        tabId,
        projectId,
        canonicalTarget,
        declaredVariantCount: 2,
      },
      countMode,
    })) as {
      state: string;
      providerOutcome: string;
      attemptId?: string;
      code: string;
    };
    if (!generation.attemptId)
      throw new Error(
        `fixture_generate_once_no_attempt_${generation.code}_${JSON.stringify({ connection, selectedTarget: await repositories.getSelectedTarget("Flow") })}`,
      );

    const readReport = async () => {
      const saved = await repositories.getFlowImageAttempt(
        generation.attemptId!,
      );
      if (!saved) throw new Error("fixture_attempt_missing");
      const sourceSnapshot = await repositories.getFlowImagePromptSnapshot(
        saved.sourceSnapshotId,
      );
      const selectedTarget = await repositories.getSelectedTarget("Flow");
      const dashboardReadback = (await client.request(
        "flow.image.getCountDecision",
        { attemptId: saved.attemptId },
      )) as Record<string, unknown>;
      const countDecision = dashboardReadback.countDecision as Record<
        string,
        unknown
      >;
      return {
        state: saved.state,
        outcome: saved.resultOutcome,
        session: saved.observationSession,
        countDecision,
        dashboardReadback,
        sequences: saved.structuralObservations?.map((event) => ({
          sequence: event.sequence,
          kind: event.kind,
          observedAt: event.observedAt,
          candidateIds: event.snapshot.mediaCandidates.map(
            (candidate) => candidate.candidateId,
          ),
          blockers: event.snapshot.captureGaps,
          loadingSignalCount: event.snapshot.lifecycleSignals.filter(
            (signal) =>
              signal.visible &&
              ["loading", "processing", "busy", "progressbar"].includes(
                signal.markerKind,
              ),
          ).length,
          tileCount: event.snapshot.tiles.length,
          virtualized: event.snapshot.virtualized,
          virtualizationEvidence: event.snapshot.virtualizationEvidence ?? [],
          resourceEventCount: event.snapshot.resourceEvents.length,
        })),
        receiptSequences: saved.observationReceipts?.map(
          (receipt) => receipt.sequence,
        ),
        diagnostics: saved.events
          .filter((event) => event.stage === "observer")
          .map((event) => event.code),
        durableBoundary: saved.countDecision?.dispatchBoundaryAt,
        audit: {
          connectionState: selectedTarget?.connectionState,
          connectionVerification: selectedTarget?.verification,
          verificationBindingMatchesAttempt: Boolean(
            selectedTarget?.verificationBinding?.tabId === saved.tabId &&
            selectedTarget.verificationBinding.projectId === saved.projectId &&
            selectedTarget.verificationBinding.documentId ===
              saved.documentId &&
            selectedTarget.verificationBinding.extensionBuildId ===
              saved.buildId &&
            selectedTarget.verificationBinding.connectorBuildId ===
              saved.buildId,
          ),
          readinessPreservedVerification: Boolean(
            afterFirstReadiness?.verification === "verified" &&
            afterFirstReadiness.connectionState === "verified" &&
            afterSecondReadiness?.verification === "verified" &&
            afterSecondReadiness.connectionState === "verified",
          ),
          sourceSnapshotPresent: Boolean(sourceSnapshot),
          exactSourceHash: Boolean(
            sourceSnapshot &&
            sourceSnapshot.rawJsonBody === rawJsonBody &&
            sourceSnapshot.snapshotId === saved.sourceSnapshotId &&
            sourceSnapshot.workspaceId === saved.workspaceId &&
            sourceSnapshot.batchId === saved.batchId &&
            sourceSnapshot.itemId === saved.itemId &&
            sourceSnapshot.promptHash === saved.promptHash &&
            sourceSnapshot.promptCodeUnits === rawJsonBody.length &&
            sourceSnapshot.promptUtf8Bytes ===
              new TextEncoder().encode(rawJsonBody).byteLength &&
            (await sha256Hex(sourceSnapshot.rawJsonBody)) === saved.promptHash,
          ),
          sourceSnapshotCodeUnits: sourceSnapshot?.promptCodeUnits,
          sourceSnapshotUtf8Bytes: sourceSnapshot?.promptUtf8Bytes,
          sourceSnapshotIdMatchesAttempt:
            sourceSnapshot?.snapshotId === saved.sourceSnapshotId,
          settingsDeclaredVariantCount:
            saved.settingsConfirmation.declaredVariantCount,
          settingsConfirmationMatchesAttempt:
            saved.settingsConfirmation.tabId === saved.tabId &&
            saved.settingsConfirmation.projectId === saved.projectId &&
            saved.settingsConfirmation.canonicalTarget === canonicalTarget,
          countStartingImageCount: saved.countBaseline?.startingImageCount,
          qualifyingBaselineCount:
            saved.countBaseline?.qualifyingBaselineCandidateIds?.length,
          armReceiptBaselineCount:
            saved.observationSession?.armReceipt?.baseline
              .qualifyingCandidateIds?.length,
          overflowEvidence: saved.countBaseline?.virtualizationEvidence,
          baselineActualScrolling: saved.countBaseline?.virtualized,
          countDecisionStatus: saved.countDecision?.status,
          countDecisionExpectedTotal: saved.countDecision?.expectedTotal,
          durableReceiptCount: saved.observationReceipts?.length ?? 0,
          attemptBuildId: saved.buildId,
          attemptProtocolVersion: saved.protocolVersion,
          workerBuildId: BUILD_ID,
          workerProtocolVersion: PROTOCOL_VERSION,
          activationCount: syntheticActivationCount,
        },
        setup: {
          selection,
          connection,
          firstReadiness,
          secondReadiness,
          generation,
        },
      };
    };
    const initial = await repositories.getFlowImageAttempt(
      generation.attemptId,
    );
    if (!initial) throw new Error("fixture_attempt_missing_after_dispatch");
    activeFixture = {
      attemptId: generation.attemptId,
      readReport,
      close: async () => {
        database.close();
        await database.delete();
        activeFixture = null;
      },
    };
    return {
      attemptId: generation.attemptId,
      dispatchBoundaryAt: initial.countDecision?.dispatchBoundaryAt,
      baselineSequence: initial.observationSession?.lastSequence,
      setup: { connection, firstReadiness, secondReadiness, generation },
    };
  } catch (error) {
    const details = error as {
      schemaIssuePaths?: string[];
      schemaIssueCodes?: string[];
    };
    throw new Error(
      `fixture_setup_failed_${JSON.stringify({ schemaIssuePaths: details.schemaIssuePaths, schemaIssueCodes: details.schemaIssueCodes, message: String(error) })}`,
      { cause: error },
    );
  }
}

export async function readProductionObservationFixtureReport() {
  if (!activeFixture) throw new Error("fixture_not_initialized");
  return activeFixture.readReport();
}

export async function markSyntheticActivationDispatched() {
  if (!activeFixture) throw new Error("fixture_not_initialized");
  // The production GenerateOnce handler already persisted the dispatched
  // transition after issuing the synthetic CDP activation pair.
}

export async function closeProductionObservationFixture() {
  await activeFixture?.close();
}
