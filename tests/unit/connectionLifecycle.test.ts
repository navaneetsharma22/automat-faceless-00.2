import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConnectionLifecycleService,
  createReadinessAfterConnectionRevalidation,
} from "../../src/background/connectionLifecycle";
import { createFlowImageReadinessCheck } from "../../src/background/handlers/flow";
import { providerTabFromUrl } from "../../src/platforms/shared/connection";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
  type ConnectionPort,
  type ConnectionProbeRequest,
  type ProviderName,
} from "../../src/platforms/shared/contracts";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";

const originalChrome = (globalThis as { chrome?: unknown }).chrome;
const flowUrl = "https://flow.google.com/project/project-1";
const vidsUrl = "https://vids.google.com/video/vid-1/edit";

afterEach(() => {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: originalChrome,
  });
});

function connectionPort(
  provider: ProviderName,
  url: string,
  options: {
    gateProbe?: boolean;
    buildId?: string;
    replacementBuildId?: string;
    tabId?: number;
  } = {},
) {
  const tab = providerTabFromUrl(
    options.tabId ?? (provider === "Flow" ? 9 : 19),
    "Selected project",
    url,
  )!;
  let installed = false;
  let browserDocumentId = `document-${provider}`;
  let reachable = true;
  let releaseProbe: (() => void) | undefined;
  const probeGate = options.gateProbe
    ? new Promise<void>((resolve) => {
        releaseProbe = resolve;
      })
    : Promise.resolve();
  const response = (request: ConnectionProbeRequest) => ({
    ok: true,
    provider,
    canonicalTarget: tab.canonicalTarget,
    projectId: tab.projectId,
    protocolVersion: CONNECTOR_PROTOCOL_VERSION,
    buildId:
      installed && options.replacementBuildId
        ? options.replacementBuildId
        : (options.buildId ?? BUILD_ID),
    attemptId: request.attemptId,
    documentToken: `token-${provider}`,
    capabilities: [CONNECTION_CAPABILITY],
  });
  const port: ConnectionPort = {
    getMissingAccess: vi.fn(async () => ({})),
    getTab: vi.fn(async () => tab),
    pingTopFrame: vi.fn(async (_tabId, request) =>
      installed || options.buildId !== undefined
        ? response(request)
        : undefined,
    ),
    identifyDocument: vi.fn(async () => ({
      documentId: browserDocumentId,
      frameId: 0,
      url,
    })),
    injectConnector: vi.fn(async () => {
      installed = true;
      return { documentId: browserDocumentId, frameId: 0, url };
    }),
    probeTopFrame: vi.fn(async (_tabId, _documentId, request) => {
      await probeGate;
      return reachable ? response(request) : undefined;
    }),
    releaseConnector: vi.fn(async () => undefined),
    makeAttemptId: vi.fn(() => `attempt-${provider}`),
  };
  return {
    port,
    tab,
    releaseProbe: () => releaseProbe?.(),
    changeDocument: (documentId: string) => {
      browserDocumentId = documentId;
    },
    setReachable: (value: boolean) => {
      reachable = value;
    },
  };
}

async function persistSelection(
  repositories: ExtensionRepositories,
  provider: ProviderName,
  tabId: number,
  url: string,
) {
  const target = providerTabFromUrl(tabId, "Selected project", url)!;
  await repositories.recordSelectedTarget({
    provider,
    tabId,
    canonicalTarget: target.canonicalTarget,
  });
  return target;
}

describe("worker-owned connection lifecycle", () => {
  it("preserves Flow verification across repeated readiness checks and deduplicates concurrent checks", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const { port } = connectionPort("Flow", flowUrl);
    const service = createConnectionLifecycleService(repositories, () => port);
    await persistSelection(repositories, "Flow", 9, flowUrl);

    expect(await service.revalidate("Flow", true)).toMatchObject({
      ok: true,
      state: "verified",
    });
    const before = await repositories.getSelectedTarget("Flow");
    expect(before).toMatchObject({
      verification: "verified",
      connectionState: "verified",
    });

    const checksBefore = vi.mocked(port.probeTopFrame).mock.calls.length;
    const concurrent = [service.revalidate("Flow"), service.revalidate("Flow")];
    const responses = await Promise.all(concurrent);
    expect(responses.every((response) => response.ok)).toBe(true);
    expect(port.probeTopFrame).toHaveBeenCalledTimes(checksBefore + 1);

    const tabsApi = {
      reload: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
    };
    const bindingResult = () => [
      {
        documentId: "document-Flow",
        frameId: 0,
        result: { href: flowUrl, top: true },
      },
    ];
    const installResult = () => [
      { documentId: "document-Flow", frameId: 0, result: { status: "ready" } },
    ];
    const readinessResult = () => [
      {
        documentId: "document-Flow",
        frameId: 0,
        result: {
          status: "ready",
          profile: "empty_marker",
          completeForRenderedScope: true,
          listenersAttached: true,
          stableBaseline: true,
          renderedTileCount: 0,
          distinctCandidateCount: 0,
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
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([
        {
          documentId: "document-Flow",
          frameId: 0,
          result: { href: flowUrl, top: true },
        },
      ])
      .mockResolvedValueOnce([
        {
          documentId: "document-Flow",
          frameId: 0,
          result: { status: "ready" },
        },
      ])
      .mockResolvedValueOnce(readinessResult())
      .mockResolvedValueOnce(bindingResult())
      .mockResolvedValueOnce(installResult())
      .mockResolvedValueOnce(readinessResult());
    const sendCommand = vi.fn();
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        scripting: { executeScript },
        debugger: { sendCommand },
        tabs: tabsApi,
      },
    });
    const readiness = createReadinessAfterConnectionRevalidation(
      service.revalidate,
      createFlowImageReadinessCheck(repositories),
    );
    await readiness({
      countMode: {
        mode: "new_empty_project",
        countSessionId: "8ca777a9-09a4-4640-82e1-8ece47164153",
        startingImageCount: 0,
      },
    });
    await readiness({
      countMode: {
        mode: "new_empty_project",
        countSessionId: "8ca777a9-09a4-4640-82e1-8ece47164153",
        startingImageCount: 0,
      },
    });

    const after = await repositories.getSelectedTarget("Flow");
    expect(after?.verification).toBe("verified");
    expect(after?.connectionState).toBe("verified");
    expect(after?.verificationBinding).toMatchObject({
      tabId: 9,
      canonicalTarget: flowUrl,
      documentId: "document-Flow",
    });
    expect(after?.revision).toBeGreaterThan(before?.revision ?? 0);
    expect(tabsApi.reload).not.toHaveBeenCalled();
    expect(tabsApi.update).not.toHaveBeenCalled();
    expect(tabsApi.create).not.toHaveBeenCalled();
    expect(tabsApi.remove).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
    expect(port.releaseConnector).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledTimes(6);
  });

  it("revalidates a saved Vids target independently", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const { port } = connectionPort("Vids", vidsUrl);
    const service = createConnectionLifecycleService(repositories, () => port);
    await persistSelection(repositories, "Vids", 19, vidsUrl);
    expect(await service.revalidate("Vids", true)).toMatchObject({
      ok: true,
      state: "verified",
    });
    expect(await repositories.getSelectedTarget("Vids")).toMatchObject({
      verification: "verified",
      connectionState: "verified",
      tabId: 19,
    });
  });

  it("refreshes mismatched saved verification metadata without touching a lost attempt", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database);
    const fixture = connectionPort("Flow", flowUrl, { buildId: BUILD_ID });
    const service = createConnectionLifecycleService(
      repositories,
      () => fixture.port,
    );
    await persistSelection(repositories, "Flow", 9, flowUrl);
    await repositories.setReconnectIntent("Flow", true);
    const selected = await repositories.getSelectedTarget("Flow");
    if (!selected) throw new Error("Flow target fixture missing");

    // Simulate a legacy row whose selected target is Project 1 while its
    // mutable verification cache still describes Project 2.
    const previousProjectUrl = "https://flow.google.com/project/project-2";
    await database.selectedTargets.put({
      ...selected,
      verification: "unverified",
      connectionState: "stale-document",
      verificationBinding: {
        provider: "Flow",
        tabId: 9,
        canonicalTarget: previousProjectUrl,
        projectId: "project-2",
        frameId: 0,
        documentId: "document-Flow",
        documentToken: "previous-connector-token",
        extensionBuildId: "previous-package",
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: "previous-package",
        connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
        capability: CONNECTION_CAPABILITY,
        verifiedAt: 1,
      },
    });
    const lostAttempt = {
      attemptId: "attempt-lost-observation-fixture",
      state: "uncertain",
      provider: "Flow",
      projectId: "project-1",
      tabId: 9,
      documentId: "historical-document",
      observationSession: { status: "lost", lastSequence: 1 },
      resultOutcome: { status: "unknown", reason: "binding_changed" },
    };
    await database.flowImageAttempts.put(lostAttempt as never);
    const attemptsBefore = await repositories.getAllFlowImageAttempts();

    const result = await service.revalidate("Flow");
    expect(result).toMatchObject({
      ok: true,
      state: "verified",
      savedBindingComparison: {
        savedBindingPresent: true,
        selectedTabId: "match",
        selectedProjectId: "mismatch",
        selectedCanonicalTarget: "mismatch",
        browserDocumentId: "match",
        connectorDocumentToken: "mismatch",
        savedExtensionBuild: "mismatch",
        savedConnectorBuild: "mismatch",
        liveConnectorBuild: "current",
        liveConnectorProtocol: "current",
      },
    });
    const after = await repositories.getSelectedTarget("Flow");
    expect(after).toMatchObject({
      verification: "verified",
      connectionState: "verified",
      verificationBinding: {
        tabId: 9,
        projectId: "project-1",
        canonicalTarget: flowUrl,
        documentId: "document-Flow",
        extensionBuildId: BUILD_ID,
        connectorBuildId: BUILD_ID,
      },
    });
    expect(after?.lifecycleDiagnostics?.at(-1)).toMatchObject({
      kind: "revalidation_verified",
      reason: "saved_verification_binding_refreshed",
      bindingComparison: result.savedBindingComparison,
    });
    expect(JSON.stringify(result.savedBindingComparison)).not.toContain(
      "project-2",
    );
    expect(JSON.stringify(result.savedBindingComparison)).not.toContain(
      "previous-connector-token",
    );
    expect(await repositories.getAllFlowImageAttempts()).toEqual(
      attemptsBefore,
    );
  });

  it("switches from another Flow project back to the old target and verifies the current selection", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const workingUrl = "https://flow.google.com/project/working-project";
    const oldTarget = connectionPort("Flow", flowUrl);
    let activePort = oldTarget.port;
    const service = createConnectionLifecycleService(
      repositories,
      () => activePort,
    );

    await persistSelection(repositories, "Flow", 9, flowUrl);
    expect(await service.revalidate("Flow", true)).toMatchObject({
      ok: true,
      state: "verified",
    });

    const workingTarget = connectionPort("Flow", workingUrl, { tabId: 10 });
    await persistSelection(repositories, "Flow", 10, workingUrl);
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "unverified",
      verificationBinding: undefined,
    });
    activePort = workingTarget.port;
    expect(await service.revalidate("Flow", true)).toMatchObject({
      ok: true,
      state: "verified",
    });

    await persistSelection(repositories, "Flow", 9, flowUrl);
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "unverified",
      verificationBinding: undefined,
    });
    activePort = oldTarget.port;
    expect(await service.revalidate("Flow", true)).toMatchObject({
      ok: true,
      state: "verified",
      savedBindingComparison: { savedBindingPresent: false },
    });
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      tabId: 9,
      canonicalTarget: flowUrl,
      verification: "verified",
      verificationBinding: { projectId: "project-1" },
    });
  });

  it("refuses verification when a safe versioned replacement still reports the old live build", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const { port } = connectionPort("Vids", vidsUrl, {
      buildId: "old-connector-build",
    });
    const service = createConnectionLifecycleService(repositories, () => port);
    await persistSelection(repositories, "Vids", 19, vidsUrl);
    expect(await service.revalidate("Vids", true)).toMatchObject({
      ok: false,
      state: "stale-build",
      reason: "stale_connector_live",
    });
    expect(await repositories.getSelectedTarget("Vids")).toMatchObject({
      verification: "unverified",
      connectionState: "stale-build",
      tabId: 19,
    });
    expect(port.injectConnector).toHaveBeenCalledOnce();
    expect(port.releaseConnector).not.toHaveBeenCalled();
  });

  it("revalidates an old saved binding against the current live connector and persists the new binding", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const fixture = connectionPort("Flow", flowUrl, {
      buildId: BUILD_ID,
    });
    const service = createConnectionLifecycleService(
      repositories,
      () => fixture.port,
    );
    await persistSelection(repositories, "Flow", 9, flowUrl);
    await repositories.setReconnectIntent("Flow", true);
    const selected = await repositories.getSelectedTarget("Flow");
    if (!selected) throw new Error("Flow target fixture missing");
    await repositories.recordTargetVerification(
      {
        provider: "Flow",
        tabId: 9,
        canonicalTarget: flowUrl,
        projectId: "project-1",
        frameId: 0,
        documentId: "document-Flow",
        documentToken: "old-token",
        extensionBuildId: "previous-package",
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: "previous-package",
        connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
        capability: CONNECTION_CAPABILITY,
        verifiedAt: 1,
      },
      selected.revision,
    );

    expect(await service.revalidate("Flow")).toMatchObject({
      ok: true,
      state: "verified",
    });
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "verified",
      connectionState: "verified",
      verificationBinding: {
        extensionBuildId: BUILD_ID,
        connectorBuildId: BUILD_ID,
        documentId: "document-Flow",
      },
    });
    expect(fixture.port.injectConnector).not.toHaveBeenCalled();
  });

  it("refuses stale connector replacement during an active Flow observation and leaves it untouched", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const fixture = connectionPort("Flow", flowUrl, {
      buildId: "old-connector-build",
      replacementBuildId: BUILD_ID,
    });
    const activeObservation = {
      provider: "Flow",
      tabId: 9,
      projectId: "project-1",
      documentId: "document-Flow",
      observationSession: { status: "active" },
    };
    vi.spyOn(repositories, "getAllFlowImageAttempts").mockResolvedValue([
      activeObservation as never,
    ]);
    const service = createConnectionLifecycleService(
      repositories,
      () => fixture.port,
    );
    await persistSelection(repositories, "Flow", 9, flowUrl);
    await repositories.setReconnectIntent("Flow", true);
    const selected = await repositories.getSelectedTarget("Flow");
    if (!selected) throw new Error("Flow target fixture missing");
    await repositories.recordTargetVerification(
      {
        provider: "Flow",
        tabId: 9,
        canonicalTarget: flowUrl,
        projectId: "project-1",
        frameId: 0,
        documentId: "document-Flow",
        documentToken: "old-token",
        extensionBuildId: "previous-package",
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: "previous-package",
        connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
        capability: CONNECTION_CAPABILITY,
        verifiedAt: 1,
      },
      selected.revision,
    );

    expect(await service.revalidate("Flow")).toMatchObject({
      ok: false,
      state: "stale-build",
      reason: "stale_connector_active_observation",
    });
    expect(fixture.port.injectConnector).not.toHaveBeenCalled();
    expect(fixture.port.releaseConnector).not.toHaveBeenCalled();
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      connectionState: "stale-build",
      verificationBinding: {
        extensionBuildId: "previous-package",
        documentId: "document-Flow",
      },
    });
    expect(await repositories.getAllFlowImageAttempts()).toEqual([
      activeObservation,
    ]);
  });

  it("uses the versioned same-document connector replacement when no Flow observation is active", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const fixture = connectionPort("Flow", flowUrl, {
      buildId: "old-connector-build",
      replacementBuildId: BUILD_ID,
    });
    const service = createConnectionLifecycleService(
      repositories,
      () => fixture.port,
    );
    await persistSelection(repositories, "Flow", 9, flowUrl);
    await repositories.setReconnectIntent("Flow", true);
    const selected = await repositories.getSelectedTarget("Flow");
    if (!selected) throw new Error("Flow target fixture missing");
    await repositories.recordTargetVerification(
      {
        provider: "Flow",
        tabId: 9,
        canonicalTarget: flowUrl,
        projectId: "project-1",
        frameId: 0,
        documentId: "document-Flow",
        documentToken: "old-token",
        extensionBuildId: BUILD_ID,
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: "old-connector-build",
        connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
        capability: CONNECTION_CAPABILITY,
        verifiedAt: 1,
      },
      selected.revision,
    );

    expect(await service.revalidate("Flow")).toMatchObject({
      ok: true,
      state: "verified",
    });
    expect(fixture.port.injectConnector).toHaveBeenCalledOnce();
    expect(fixture.port.releaseConnector).not.toHaveBeenCalled();
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "verified",
      verificationBinding: {
        extensionBuildId: BUILD_ID,
        connectorBuildId: BUILD_ID,
        documentId: "document-Flow",
      },
    });
  });

  it("does not replace a stale connector when the saved browser document has changed", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const fixture = connectionPort("Flow", flowUrl, {
      buildId: "old-connector-build",
      replacementBuildId: BUILD_ID,
    });
    const service = createConnectionLifecycleService(
      repositories,
      () => fixture.port,
    );
    await persistSelection(repositories, "Flow", 9, flowUrl);
    await repositories.setReconnectIntent("Flow", true);
    const selected = await repositories.getSelectedTarget("Flow");
    if (!selected) throw new Error("Flow target fixture missing");
    await repositories.recordTargetVerification(
      {
        provider: "Flow",
        tabId: 9,
        canonicalTarget: flowUrl,
        projectId: "project-1",
        frameId: 0,
        documentId: "document-Flow",
        documentToken: "old-token",
        extensionBuildId: "previous-package",
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: "old-connector-build",
        connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
        capability: CONNECTION_CAPABILITY,
        verifiedAt: 1,
      },
      selected.revision,
    );
    fixture.changeDocument("replacement-browser-document");

    expect(await service.revalidate("Flow")).toMatchObject({
      ok: false,
      state: "stale-document",
      reason: "saved_document_changed_before_replacement",
    });
    expect(fixture.port.injectConnector).not.toHaveBeenCalled();
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "unverified",
      connectionState: "stale-document",
      verificationBinding: { documentId: "document-Flow" },
    });
  });

  it("surfaces temporary transport loss and recovers with a bounded read-only check", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const fixture = connectionPort("Flow", flowUrl);
    const service = createConnectionLifecycleService(
      repositories,
      () => fixture.port,
    );
    await persistSelection(repositories, "Flow", 9, flowUrl);
    expect(await service.revalidate("Flow", true)).toMatchObject({ ok: true });
    fixture.setReachable(false);
    expect(await service.revalidate("Flow")).toMatchObject({
      ok: false,
      state: "temporarily-unreachable",
      reason: "handshake",
    });
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      connectionState: "temporarily-unreachable",
    });
    fixture.setReachable(true);
    expect(await service.revalidate("Flow")).toMatchObject({
      ok: true,
      state: "verified",
    });
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "verified",
      connectionState: "verified",
    });
  });

  it("does not let an in-flight handshake overwrite a later manual disconnect", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const fixture = connectionPort("Flow", flowUrl, { gateProbe: true });
    const service = createConnectionLifecycleService(
      repositories,
      () => fixture.port,
    );
    await persistSelection(repositories, "Flow", 9, flowUrl);
    const check = service.revalidate("Flow", true);
    await vi.waitFor(async () => {
      expect(fixture.port.probeTopFrame).toHaveBeenCalledTimes(1);
    });
    await repositories.setReconnectIntent("Flow", false);
    fixture.releaseProbe();
    expect(await check).toMatchObject({ ok: false, state: "disconnected" });
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      reconnectEnabled: false,
      verification: "unverified",
      connectionState: "disconnected",
    });
  });

  it("does not let an in-flight handshake verify a newly selected project", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const fixture = connectionPort("Flow", flowUrl, { gateProbe: true });
    const service = createConnectionLifecycleService(
      repositories,
      () => fixture.port,
    );
    await persistSelection(repositories, "Flow", 9, flowUrl);
    const check = service.revalidate("Flow", true);
    await vi.waitFor(async () => {
      expect(fixture.port.probeTopFrame).toHaveBeenCalledTimes(1);
    });
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: 10,
      canonicalTarget: "https://flow.google.com/project/another-project",
    });
    fixture.releaseProbe();

    expect(await check).toMatchObject({
      ok: false,
      state: "disconnected",
      reason: "selection_or_disconnect_changed_during_handshake",
    });
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      tabId: 10,
      verification: "unverified",
      connectionState: "disconnected",
      verificationBinding: undefined,
    });
  });

  it("reports a saved-document mismatch and refreshes verification only after a fresh current-document handshake", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    const fixture = connectionPort("Flow", flowUrl);
    const service = createConnectionLifecycleService(
      repositories,
      () => fixture.port,
    );
    await persistSelection(repositories, "Flow", 9, flowUrl);
    expect(await service.revalidate("Flow", true)).toMatchObject({ ok: true });
    fixture.changeDocument("replacement-browser-document");

    expect(await service.revalidate("Flow")).toMatchObject({
      ok: true,
      state: "verified",
      savedBindingComparison: { browserDocumentId: "mismatch" },
    });
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "verified",
      connectionState: "verified",
      verificationBinding: {
        documentId: "replacement-browser-document",
        extensionBuildId: BUILD_ID,
      },
    });
  });
});
