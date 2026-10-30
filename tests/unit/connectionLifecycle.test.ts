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
import { BUILD_ID } from "../../src/shared/buildInfo";
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
  options: { gateProbe?: boolean; buildId?: string } = {},
) {
  const tab = providerTabFromUrl(
    provider === "Flow" ? 9 : 19,
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
    buildId: options.buildId ?? BUILD_ID,
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

  it("keeps a genuine connector build mismatch blocked without reinjection", async () => {
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
    });
    expect(await repositories.getSelectedTarget("Vids")).toMatchObject({
      verification: "unverified",
      connectionState: "stale-build",
      tabId: 19,
    });
    expect(port.injectConnector).not.toHaveBeenCalled();
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

  it("blocks a genuine browser document change and preserves the old binding for diagnosis", async () => {
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
      ok: false,
      state: "stale-document",
      reason: "browser_document_id_mismatch",
    });
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "unverified",
      connectionState: "stale-document",
      verificationBinding: { documentId: "document-Flow" },
    });
  });
});
