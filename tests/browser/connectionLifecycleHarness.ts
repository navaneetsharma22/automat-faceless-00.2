import { AutomatDatabase } from "../../src/storage/db";
import {
  createDexieRepositoryDatabase,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import {
  createConnectionLifecycleService,
  createReadinessAfterConnectionRevalidation,
} from "../../src/background/connectionLifecycle";
import { createFlowImageReadinessCheck } from "../../src/background/handlers/flow";
import type {
  ConnectionPort,
  ConnectionProbeRequest,
  ProviderTab,
} from "../../src/platforms/shared/contracts";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
} from "../../src/platforms/shared/contracts";
import { BUILD_ID } from "../../src/shared/buildInfo";
import { makeRequest } from "../../src/shared/messages";

const extensionId = "connection-lifecycle-fixture";
const flowUrl = "https://flow.google.com/project/connection-lifecycle-fixture";
const projectTab: ProviderTab = {
  id: 41,
  title: "Synthetic Flow project",
  url: flowUrl,
  provider: "Flow",
  projectId: "connection-lifecycle-fixture",
  canonicalTarget: flowUrl,
};
const makeFixtureId = () =>
  `fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function readyResult() {
  return [
    {
      documentId: "fixture-browser-document",
      frameId: 0,
      result: {
        status: "ready",
        profile: "empty_marker",
        completeForRenderedScope: true,
        listenersAttached: true,
        stableBaseline: true,
        renderedTileCount: 0,
        distinctCandidateCount: 0,
        qualifyingCandidateCount: 0,
        candidateIds: [],
        repeatedCandidateCount: 0,
        unidentifiedImageCount: 0,
        unrelatedImageCount: 0,
        virtualized: false,
        virtualScrollContainerCount: 1,
        virtualizationEvidence: [],
        loadingSignalCount: 0,
        captureGaps: [],
        terminalSemanticsSupported: false,
      },
    },
  ];
}

export async function runConnectionLifecycleRegression() {
  const database = new AutomatDatabase(
    `connection-lifecycle-${makeFixtureId()}`,
  );
  await database.open();
  const repositories = new ExtensionRepositories(
    createDexieRepositoryDatabase(database),
  );
  const providerInputCalls = 0;
  let connectorReleaseCalls = 0;
  let scriptCall = 0;
  const scriptResults = [
    [
      {
        documentId: "fixture-browser-document",
        frameId: 0,
        result: { href: flowUrl, top: true },
      },
    ],
    [
      {
        documentId: "fixture-browser-document",
        frameId: 0,
        result: { status: "ready" },
      },
    ],
    readyResult(),
    [
      {
        documentId: "fixture-browser-document",
        frameId: 0,
        result: { href: flowUrl, top: true },
      },
    ],
    [
      {
        documentId: "fixture-browser-document",
        frameId: 0,
        result: { status: "ready" },
      },
    ],
    readyResult(),
    [
      {
        documentId: "fixture-browser-document",
        frameId: 0,
        result: { href: flowUrl, top: true },
      },
    ],
    [
      {
        documentId: "fixture-browser-document",
        frameId: 0,
        result: { status: "ready" },
      },
    ],
    readyResult(),
  ];
  const scriptingPort = {
    executeScript: async () => {
      scriptCall += 1;
      return (scriptResults.shift() ??
        []) as chrome.scripting.InjectionResult[];
    },
  };

  let connectorInstalled = false;
  const makeResponse = (request: ConnectionProbeRequest) => ({
    ok: true,
    provider: "Flow" as const,
    canonicalTarget: flowUrl,
    projectId: projectTab.projectId,
    protocolVersion: CONNECTOR_PROTOCOL_VERSION,
    buildId: BUILD_ID,
    attemptId: request.attemptId,
    documentToken: "fixture-connector-document-token",
    capabilities: [CONNECTION_CAPABILITY],
  });
  const port: ConnectionPort = {
    getMissingAccess: async () => ({}),
    getTab: async () => projectTab,
    pingTopFrame: async (_tabId, request) =>
      connectorInstalled ? makeResponse(request) : undefined,
    identifyDocument: async () => ({
      documentId: "fixture-browser-document",
      frameId: 0,
      url: flowUrl,
    }),
    injectConnector: async () => {
      connectorInstalled = true;
      return {
        documentId: "fixture-browser-document",
        frameId: 0,
        url: flowUrl,
      };
    },
    probeTopFrame: async (_tabId, _documentId, request) =>
      makeResponse(request),
    releaseConnector: async () => {
      connectorReleaseCalls += 1;
    },
    makeAttemptId: makeFixtureId,
  };
  const service = createConnectionLifecycleService(repositories, () => port);
  const readiness = createReadinessAfterConnectionRevalidation(
    service.revalidate,
    createFlowImageReadinessCheck(repositories, scriptingPort),
  );
  const worker = createConnectionMessageListener(extensionId, {
    repositories,
    preferences: {
      getTheme: async () => "light",
      setTheme: async () => undefined,
    },
    ready: Promise.resolve(),
    revalidateConnection: service.revalidate,
    flowImageReadiness: readiness,
  });
  const workerRequest = (
    type: "connections.revalidate" | "flow.image.checkReadiness",
    payload: unknown,
  ) =>
    new Promise<unknown>((resolve) => {
      worker(
        makeRequest(type, payload as never, makeFixtureId()),
        {
          id: extensionId,
          url: `chrome-extension://${extensionId}/index.html`,
        },
        resolve,
      );
    });

  try {
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: projectTab.id,
      canonicalTarget: projectTab.canonicalTarget,
    });
    const connected = await workerRequest("connections.revalidate", {
      provider: "Flow",
      enableReconnect: true,
    });
    const before = await repositories.getSelectedTarget("Flow");
    const beforeReadiness = {
      verification: before?.verification,
      connectionState: before?.connectionState,
      tabId: before?.verificationBinding?.tabId,
      canonicalTarget: before?.verificationBinding?.canonicalTarget,
      documentId: before?.verificationBinding?.documentId,
      documentToken: before?.verificationBinding?.documentToken,
    };

    const concurrent = await Promise.all([
      workerRequest("connections.revalidate", { provider: "Flow" }),
      workerRequest("connections.revalidate", { provider: "Flow" }),
    ]);
    const mode = {
      countMode: {
        mode: "new_empty_project" as const,
        countSessionId: "5e7606d2-c27a-4a36-aadb-16f03d08104c",
        startingImageCount: 0 as const,
      },
    };
    const firstReadiness = await workerRequest(
      "flow.image.checkReadiness",
      mode,
    );
    const secondReadiness = await workerRequest(
      "flow.image.checkReadiness",
      mode,
    );
    await repositories.markTargetsUnverified();
    const afterWorkerRestart = await repositories.getSelectedTarget("Flow");
    const restartReadiness = await workerRequest(
      "flow.image.checkReadiness",
      mode,
    );
    const after = await repositories.getSelectedTarget("Flow");
    return {
      connected,
      concurrent,
      firstReadiness,
      secondReadiness,
      restartReadiness,
      beforeReadiness,
      afterReadiness: {
        verification: after?.verification,
        connectionState: after?.connectionState,
        tabId: after?.verificationBinding?.tabId,
        canonicalTarget: after?.verificationBinding?.canonicalTarget,
        documentId: after?.verificationBinding?.documentId,
        documentToken: after?.verificationBinding?.documentToken,
      },
      afterWorkerRestart: {
        verification: afterWorkerRestart?.verification,
        connectionState: afterWorkerRestart?.connectionState,
        documentId: afterWorkerRestart?.verificationBinding?.documentId,
      },
      lifecycleDiagnostics: (after?.lifecycleDiagnostics ?? []).map(
        ({ kind, reason }) => ({ kind, reason }),
      ),
      scriptCall,
      tabCounts: { reload: 0, update: 0, create: 0, remove: 0 },
      debuggerCommands: 0,
      providerInputCalls,
      connectorReleaseCalls,
      persistedAttempts: await repositories.getAllFlowImageAttempts(),
    };
  } finally {
    await database.delete();
  }
}
