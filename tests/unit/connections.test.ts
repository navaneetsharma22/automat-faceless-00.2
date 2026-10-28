import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILD_ID } from "../../src/shared/buildInfo";
import {
  attachToSelectedTab,
  providerTabFromUrl,
} from "../../src/platforms/shared/connection";
import {
  createChromeConnectionPort,
  hasTabListingAccess,
  listOpenProviderTabs,
  requestTabListingAccess,
} from "../../src/platforms/shared/chromeConnectionPort";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
  type ConnectionPort,
  type ConnectionProbeRequest,
  type ConnectionProbeResponse,
  type ProviderName,
  type ProviderTab,
} from "../../src/platforms/shared/contracts";
import { handleWorkerRestart } from "../../src/platforms/shared/connectionLifecycle";
import { FOUNDATION_WORKER_RESTARTED } from "../../src/shared/messages";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete (
    globalThis as typeof globalThis & {
      __automatFacelessConnector?: unknown;
    }
  ).__automatFacelessConnector;
  delete (
    globalThis as typeof globalThis & {
      __automatFacelessConnectionProbeInstalled?: boolean;
    }
  ).__automatFacelessConnectionProbeInstalled;
});

function makeTab(
  id = 42,
  provider: ProviderName = "Flow",
  projectId = "project-1",
): ProviderTab {
  const url =
    provider === "Flow"
      ? `https://labs.google/fx/tools/flow/${projectId}`
      : `https://vids.google.com/video/${projectId}/edit`;
  return providerTabFromUrl(id, `${provider} ${projectId}`, url)!;
}

function makeResponse(
  tab: ProviderTab,
  request: ConnectionProbeRequest,
  overrides: Partial<ConnectionProbeResponse> = {},
): ConnectionProbeResponse {
  return {
    ok: true,
    provider: tab.provider,
    canonicalTarget: tab.canonicalTarget,
    projectId: tab.projectId,
    protocolVersion: CONNECTOR_PROTOCOL_VERSION,
    buildId: BUILD_ID,
    attemptId: request.attemptId,
    documentToken: "document-token-1",
    capabilities: [CONNECTION_CAPABILITY],
    ...overrides,
  };
}

function makePort(tab = makeTab()) {
  let request: ConnectionProbeRequest | undefined;
  const port = {
    requestAccess: vi.fn(async () => true),
    getTab: vi.fn(async () => tab),
    pingTopFrame: vi.fn(async (_tabId, value) => {
      request = value;
      return undefined;
    }),
    identifyDocument: vi.fn(async () => ({
      documentId: "chrome-document-1",
      frameId: 0,
      url: tab.url,
    })),
    injectConnector: vi.fn(async () => ({
      documentId: "chrome-document-1",
      frameId: 0,
      url: tab.url,
    })),
    probeTopFrame: vi.fn(async (_tabId, _documentId, value) => {
      request = value;
      return makeResponse(tab, value);
    }),
    releaseConnector: vi.fn(async () => undefined),
    makeAttemptId: vi.fn(() => "attempt-1"),
  } satisfies ConnectionPort;
  const forbiddenTabActions = {
    reload: vi.fn(),
    navigate: vi.fn(),
    update: vi.fn(),
    replace: vi.fn(),
    close: vi.fn(),
    reopen: vi.fn(),
    remove: vi.fn(),
    mutateContent: vi.fn(),
    mutateTimeline: vi.fn(),
    mutateSettings: vi.fn(),
  };
  return { port, tab, forbiddenTabActions, getRequest: () => request };
}

function expectProviderUntouched(
  actions: ReturnType<typeof makePort>["forbiddenTabActions"],
) {
  for (const action of Object.values(actions)) {
    expect(action).not.toHaveBeenCalled();
  }
}

describe("explicit read-only Flow/Vids attachment", () => {
  it("accepts only the observed project routes and extracts stable IDs", () => {
    expect(
      providerTabFromUrl(
        8,
        "Flow project",
        "https://flow.google.com/project/AbC_9-xy?panel=assets",
      ),
    ).toMatchObject({
      provider: "Flow",
      projectId: "AbC_9-xy",
      canonicalTarget: "https://flow.google.com/project/AbC_9-xy",
    });
    expect(
      providerTabFromUrl(
        9,
        "Flow project",
        "https://labs.google/fx/tools/flow/project_9?tab=assets",
      ),
    ).toMatchObject({
      provider: "Flow",
      projectId: "project_9",
      canonicalTarget: "https://labs.google/fx/tools/flow/project_9",
    });
    expect(
      providerTabFromUrl(
        10,
        "Vids document",
        "https://vids.google.com/video/vid-10/edit?panel=share",
      ),
    ).toMatchObject({
      provider: "Vids",
      projectId: "vid-10",
      canonicalTarget: "https://vids.google.com/video/vid-10/edit",
    });
    expect(
      providerTabFromUrl(11, "Vids home", "https://vids.google.com/"),
    ).toBeUndefined();
    expect(
      providerTabFromUrl(
        12,
        "Other Google page",
        "https://docs.google.com/document/d/not-a-vids-project/edit",
      ),
    ).toBeUndefined();
    expect(
      providerTabFromUrl(
        13,
        "Flow nested route",
        "https://labs.google/fx/tools/flow/project-1/settings",
      ),
    ).toBeUndefined();
    expect(
      providerTabFromUrl(
        14,
        "Flow nested route",
        "https://flow.google.com/project/valid/settings",
      ),
    ).toBeUndefined();
    expect(
      providerTabFromUrl(
        15,
        "Spoofed Flow host",
        "https://flow.google.com.evil.example/project/valid",
      ),
    ).toBeUndefined();
    expect(
      providerTabFromUrl(
        16,
        "Credentials in URL",
        "https://user:secret@flow.google.com/project/valid",
      ),
    ).toBeUndefined();
  });

  it("attaches only to the user-selected candidate and reuses a compatible connector", async () => {
    const candidates = [
      makeTab(41, "Flow", "first"),
      makeTab(42, "Flow", "chosen"),
    ];
    const chosen = candidates[1]!;
    const { port, forbiddenTabActions, getRequest } = makePort(chosen);
    vi.mocked(port.pingTopFrame).mockImplementation(async (_id, request) => {
      return makeResponse(chosen, request);
    });

    const result = await attachToSelectedTab("Flow", chosen, port);

    expect(result).toMatchObject({ ok: true, tab: chosen, state: "connected" });
    expect(port.getTab).toHaveBeenCalledWith(chosen.id);
    expect(port.identifyDocument).toHaveBeenCalledExactlyOnceWith(chosen.id);
    expect(port.injectConnector).not.toHaveBeenCalled();
    expect(port.probeTopFrame).toHaveBeenCalledWith(
      chosen.id,
      "chrome-document-1",
      expect.objectContaining({ attemptId: "attempt-1" }),
    );
    expect(getRequest()?.projectId).toBe("chosen");
    expect(candidates[0]?.id).not.toBe(chosen.id);
    expectProviderUntouched(forbiddenTabActions);
  });

  it("pings first, injects into the selected top frame, then revalidates identity", async () => {
    for (const provider of ["Flow", "Vids"] as const) {
      const tab = makeTab(provider === "Flow" ? 20 : 21, provider, "selected");
      const { port, forbiddenTabActions } = makePort(tab);
      const result = await attachToSelectedTab(provider, tab, port);

      expect(result).toMatchObject({ ok: true, tab, state: "connected" });
      expect(port.pingTopFrame).toHaveBeenCalledBefore(port.injectConnector);
      expect(port.injectConnector).toHaveBeenCalledExactlyOnceWith(tab.id);
      expect(port.getTab).toHaveBeenCalledTimes(3);
      expect(port.probeTopFrame).toHaveBeenCalledExactlyOnceWith(
        tab.id,
        "chrome-document-1",
        expect.objectContaining({ provider, projectId: "selected" }),
      );
      expectProviderUntouched(forbiddenTabActions);
    }
  });

  it("rejects a changed project before attachment and a changed project after injection", async () => {
    const selected = makeTab();
    const { port, forbiddenTabActions } = makePort(selected);
    vi.mocked(port.getTab).mockResolvedValueOnce(
      makeTab(selected.id, "Flow", "changed-project"),
    );
    const changed = await attachToSelectedTab("Flow", selected, port);
    expect(changed).toMatchObject({ ok: false, state: "wrong-target" });
    expect(port.pingTopFrame).not.toHaveBeenCalled();

    const { port: afterInjectionPort, forbiddenTabActions: afterActions } =
      makePort(selected);
    vi.mocked(afterInjectionPort.getTab)
      .mockResolvedValueOnce(selected)
      .mockResolvedValueOnce(makeTab(selected.id, "Flow", "changed-project"));
    const afterInjection = await attachToSelectedTab(
      "Flow",
      selected,
      afterInjectionPort,
    );
    expect(afterInjection).toMatchObject({ ok: false, state: "wrong-target" });
    expect(afterInjectionPort.probeTopFrame).not.toHaveBeenCalled();
    expectProviderUntouched(forbiddenTabActions);
    expectProviderUntouched(afterActions);
  });

  it("blocks a changed document and any non-top-frame identity", async () => {
    const tab = makeTab();
    const { port } = makePort(tab);
    vi.mocked(port.getTab)
      .mockResolvedValueOnce(tab)
      .mockResolvedValueOnce(tab)
      .mockResolvedValueOnce(makeTab(tab.id, "Flow", "new-document-project"));
    const changedDocument = await attachToSelectedTab("Flow", tab, port);
    expect(changedDocument).toMatchObject({ ok: false, state: "wrong-target" });

    const nonTop = makePort(tab);
    vi.mocked(nonTop.port.injectConnector).mockResolvedValueOnce({
      documentId: "child-frame",
      frameId: 3,
      url: tab.url,
    });
    const nonTopResult = await attachToSelectedTab("Flow", tab, nonTop.port);
    expect(nonTopResult).toMatchObject({ ok: false, state: "failed" });
    expect(nonTop.port.probeTopFrame).not.toHaveBeenCalled();
  });

  it("reports permission denial without probing or injecting", async () => {
    const { port, forbiddenTabActions } = makePort();
    vi.mocked(port.requestAccess).mockResolvedValueOnce(false);
    const result = await attachToSelectedTab("Flow", makeTab(), port);
    expect(result).toMatchObject({ ok: false, state: "permission-needed" });
    expect(port.getTab).not.toHaveBeenCalled();
    expect(port.pingTopFrame).not.toHaveBeenCalled();
    expect(port.injectConnector).not.toHaveBeenCalled();
    expectProviderUntouched(forbiddenTabActions);
  });

  it("inspects connect permissions and requests only the selected site", async () => {
    const permissions = {
      contains: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      request: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal("chrome", {
      permissions,
      tabs: { get: vi.fn(), query: vi.fn(), sendMessage: vi.fn() },
      scripting: { executeScript: vi.fn() },
    });
    const port = createChromeConnectionPort()!;

    expect(await port.requestAccess("Flow", makeTab())).toBe(true);
    expect(permissions.contains).toHaveBeenNthCalledWith(1, {
      permissions: ["scripting"],
    });
    expect(permissions.contains).toHaveBeenNthCalledWith(2, {
      origins: ["https://labs.google/*"],
    });
    expect(permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: ["https://labs.google/*"],
    });

    permissions.contains
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    permissions.request.mockResolvedValueOnce(true);
    const currentFlowRoute = providerTabFromUrl(
      19,
      "Flow current route",
      "https://flow.google.com/project/selected-project",
    )!;
    expect(await port.requestAccess("Flow", currentFlowRoute)).toBe(true);
    expect(permissions.contains).toHaveBeenNthCalledWith(3, {
      permissions: ["scripting"],
    });
    expect(permissions.contains).toHaveBeenNthCalledWith(4, {
      origins: ["https://flow.google.com/*"],
    });
    expect(permissions.request).toHaveBeenLastCalledWith({
      origins: ["https://flow.google.com/*"],
    });

    expect(
      await port.requestAccess(
        "Vids",
        providerTabFromUrl(
          20,
          "Vids project",
          "https://flow.google.com/project/wrong-provider",
        )!,
      ),
    ).toBe(false);
    expect(permissions.request).toHaveBeenCalledTimes(2);

    permissions.request.mockResolvedValueOnce(false);
    const tabPermission = requestTabListingAccess();
    expect(permissions.request).toHaveBeenLastCalledWith({
      permissions: ["tabs"],
    });
    expect(await tabPermission).toBe(false);
  });

  it("first checks tabs access, then requests it synchronously from the dedicated user action", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        id: 5,
        title: "Flow project",
        url: "https://flow.google.com/project/selected-project",
      },
    ]);
    const permissions = {
      contains: vi.fn().mockResolvedValue(false),
      request: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal("chrome", {
      permissions,
      tabs: { query, get: vi.fn(), sendMessage: vi.fn() },
      scripting: { executeScript: vi.fn() },
    });

    expect(await hasTabListingAccess()).toBe(false);
    expect(permissions.contains).toHaveBeenCalledExactlyOnceWith({
      permissions: ["tabs"],
    });
    expect(query).not.toHaveBeenCalled();

    const permissionRequest = requestTabListingAccess();
    expect(permissions.request).toHaveBeenCalledExactlyOnceWith({
      permissions: ["tabs"],
    });
    expect(await permissionRequest).toBe(true);

    const listing = await listOpenProviderTabs();
    expect(query).toHaveBeenCalledExactlyOnceWith({});
    expect(listing.tabs).toMatchObject([
      { provider: "Flow", projectId: "selected-project" },
    ]);
  });

  it("distinguishes unsupported provider routes and unavailable URLs from no matches", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        id: 1,
        title: "Flow project",
        url: "https://labs.google/fx/tools/flow/project-1/settings",
      },
      { id: 2, title: "Hidden URL" },
      { id: 3, title: "Unrelated", url: "https://example.com/" },
    ]);
    vi.stubGlobal("chrome", { tabs: { query } });

    await expect(listOpenProviderTabs()).resolves.toMatchObject({
      tabs: [],
      unsupportedProviderRoutes: 1,
      unavailableUrls: 1,
    });
    query.mockResolvedValueOnce([
      { id: 4, title: "Unrelated", url: "https://example.com/" },
    ]);
    await expect(listOpenProviderTabs()).resolves.toMatchObject({
      tabs: [],
      unsupportedProviderRoutes: 0,
      unavailableUrls: 0,
    });
    query.mockRejectedValueOnce(new Error("query failed"));
    await expect(listOpenProviderTabs()).rejects.toThrow("query failed");
  });

  it("keeps the local preview graceful when Chrome extension APIs are absent", async () => {
    vi.stubGlobal("chrome", undefined);
    expect(createChromeConnectionPort()).toBeUndefined();
    expect(await requestTabListingAccess()).toBe(false);
  });

  it("rejects a connector response for a different project before injecting", async () => {
    const tab = makeTab();
    const { port } = makePort(tab);
    vi.mocked(port.pingTopFrame).mockImplementationOnce(async (_id, request) =>
      makeResponse(tab, request, {
        projectId: "other-project",
        canonicalTarget: "https://labs.google/fx/tools/flow/other-project",
      }),
    );
    const result = await attachToSelectedTab("Flow", tab, port);
    expect(result).toMatchObject({ ok: false, state: "wrong-target" });
    expect(port.injectConnector).not.toHaveBeenCalled();
  });

  it("keeps missing receivers and injection failures visibly failed", async () => {
    const { port, forbiddenTabActions } = makePort();
    vi.mocked(port.injectConnector).mockResolvedValueOnce(undefined);
    const result = await attachToSelectedTab("Flow", makeTab(), port);
    expect(result).toMatchObject({ ok: false, state: "failed" });
    expect(port.pingTopFrame).toHaveBeenCalledOnce();
    expect(port.probeTopFrame).not.toHaveBeenCalled();
    expectProviderUntouched(forbiddenTabActions);
  });

  it("safely replaces a stale connector and blocks when replacement cannot be confirmed", async () => {
    const tab = makeTab();
    const replaced = makePort(tab);
    vi.mocked(replaced.port.pingTopFrame).mockImplementationOnce(
      async (_id, request) =>
        makeResponse(tab, request, { buildId: "old-build", ok: false }),
    );
    const connected = await attachToSelectedTab("Flow", tab, replaced.port);
    expect(connected).toMatchObject({ ok: true, state: "connected" });
    expect(replaced.port.injectConnector).toHaveBeenCalledOnce();

    const blocked = makePort(tab);
    vi.mocked(blocked.port.pingTopFrame).mockImplementationOnce(
      async (_id, request) =>
        makeResponse(tab, request, { buildId: "old-build", ok: false }),
    );
    vi.mocked(blocked.port.injectConnector).mockResolvedValueOnce(undefined);
    const stale = await attachToSelectedTab("Flow", tab, blocked.port);
    expect(stale).toMatchObject({ ok: false, state: "stale-build" });
  });

  it("requires response correlation and exact protocol/build/capability identity", async () => {
    const tab = makeTab();
    const { port } = makePort(tab);
    vi.mocked(port.probeTopFrame).mockImplementationOnce(
      async (_id, _documentId, request) =>
        makeResponse(tab, request, { attemptId: "other-attempt" }),
    );
    const result = await attachToSelectedTab("Flow", tab, port);
    expect(result).toMatchObject({ ok: false, state: "wrong-target" });

    const staleProtocol = makePort(tab);
    vi.mocked(staleProtocol.port.pingTopFrame).mockImplementationOnce(
      async (_id, request) =>
        makeResponse(tab, request, { protocolVersion: 999, ok: false }),
    );
    vi.mocked(staleProtocol.port.probeTopFrame).mockImplementationOnce(
      async (_id, _documentId, request) =>
        makeResponse(tab, request, { protocolVersion: 999 }),
    );
    const protocolResult = await attachToSelectedTab(
      "Flow",
      tab,
      staleProtocol.port,
    );
    expect(protocolResult).toMatchObject({ ok: false, state: "stale-build" });
  });

  it("coalesces repeated Connect clicks so only one attachment runs", async () => {
    const { port } = makePort();
    let grant!: (allowed: boolean) => void;
    vi.mocked(port.requestAccess).mockImplementationOnce(
      () => new Promise((resolve) => (grant = resolve)),
    );
    const selected = makeTab();
    const first = attachToSelectedTab("Flow", selected, port);
    const second = attachToSelectedTab("Flow", selected, port);
    expect(second).toBe(first);
    expect(port.requestAccess).toHaveBeenCalledOnce();
    grant(true);
    expect(await first).toMatchObject({ ok: true, state: "connected" });
    expect(port.injectConnector).toHaveBeenCalledOnce();
  });

  it("leaves disconnected or closed targets unconnected", async () => {
    const { port } = makePort();
    vi.mocked(port.getTab).mockResolvedValueOnce(undefined);
    const result = await attachToSelectedTab("Flow", makeTab(), port);
    expect(result).toMatchObject({ ok: false, state: "wrong-target" });
  });

  it("invalidates in-memory Connected status after worker restart or build change", () => {
    const invalidate = vi.fn();
    expect(
      handleWorkerRestart(
        { type: FOUNDATION_WORKER_RESTARTED, buildId: BUILD_ID },
        invalidate,
      ),
    ).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenNthCalledWith(
      1,
      "Flow",
      "disconnected",
      expect.stringContaining("worker restarted"),
    );
    expect(invalidate).toHaveBeenNthCalledWith(
      2,
      "Vids",
      "disconnected",
      expect.stringContaining("worker restarted"),
    );

    invalidate.mockClear();
    handleWorkerRestart(
      { type: FOUNDATION_WORKER_RESTARTED, buildId: "different-build" },
      invalidate,
    );
    expect(invalidate).toHaveBeenCalledWith(
      "Flow",
      "stale-build",
      expect.stringContaining("Stale build"),
    );
    expect(handleWorkerRestart({ type: "unrelated-event" }, invalidate)).toBe(
      false,
    );
  });

  it("keeps all provider page mutation and navigation methods unused", async () => {
    for (const failureState of ["success", "denied", "missing"] as const) {
      const { port, forbiddenTabActions } = makePort();
      if (failureState === "denied") {
        vi.mocked(port.requestAccess).mockResolvedValueOnce(false);
      }
      if (failureState === "missing") {
        vi.mocked(port.injectConnector).mockResolvedValueOnce(undefined);
      }
      await attachToSelectedTab("Flow", makeTab(), port);
      expectProviderUntouched(forbiddenTabActions);
    }
  });
});

describe("packaged connector listener lifecycle", () => {
  it("validates the current Flow host and exact project ID in its read-only handshake", async () => {
    const listeners = new Set<(...args: unknown[]) => unknown>();
    const runtime = {
      id: "offline-extension",
      onMessage: {
        addListener: vi.fn((listener: (...args: unknown[]) => unknown) =>
          listeners.add(listener),
        ),
        removeListener: vi.fn((listener: (...args: unknown[]) => unknown) =>
          listeners.delete(listener),
        ),
      },
    };
    vi.stubGlobal("chrome", { runtime });
    vi.stubGlobal("document", {});
    const frame = { top: undefined as unknown };
    frame.top = frame;
    vi.stubGlobal("window", frame);
    vi.stubGlobal("location", {
      href: "https://flow.google.com/project/selected_9?panel=assets",
    });

    await import("../../src/platforms/shared/connectionProbe");

    const [listener] = [...listeners];
    const respond = vi.fn();
    const request = {
      type: "AUTOMAT_FACELESS_CONNECTION_PROBE",
      provider: "Flow",
      canonicalTarget: "https://flow.google.com/project/selected_9",
      projectId: "selected_9",
      protocolVersion: CONNECTOR_PROTOCOL_VERSION,
      buildId: BUILD_ID,
      attemptId: "attempt-current-flow",
    };
    listener!(request, { id: runtime.id }, respond);
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        provider: "Flow",
        projectId: "selected_9",
        canonicalTarget: "https://flow.google.com/project/selected_9",
        attemptId: "attempt-current-flow",
        capabilities: [CONNECTION_CAPABILITY],
      }),
    );

    const wrongProjectResponse = vi.fn();
    listener!(
      { ...request, projectId: "other-project" },
      { id: runtime.id },
      wrongProjectResponse,
    );
    expect(wrongProjectResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        projectId: "selected_9",
        error: "The current document does not match the selected project.",
      }),
    );
  });

  it("removes a known prior listener before installing one replacement", async () => {
    const listeners = new Set<(...args: unknown[]) => unknown>();
    const runtime = {
      id: "offline-extension",
      onMessage: {
        addListener: vi.fn((listener: (...args: unknown[]) => unknown) =>
          listeners.add(listener),
        ),
        removeListener: vi.fn((listener: (...args: unknown[]) => unknown) =>
          listeners.delete(listener),
        ),
      },
    };
    const oldListener = vi.fn();
    (
      globalThis as typeof globalThis & { __automatFacelessConnector?: unknown }
    ).__automatFacelessConnector = {
      buildId: "old-build",
      listener: oldListener,
      documentToken: "old-document",
    };
    vi.stubGlobal("chrome", { runtime });
    vi.stubGlobal("document", {});
    const frame = { top: undefined as unknown };
    frame.top = frame;
    vi.stubGlobal("window", frame);
    vi.stubGlobal("location", {
      href: "https://labs.google/fx/tools/flow/project-1",
    });

    await import("../../src/platforms/shared/connectionProbe");

    const firstInstalled = [...listeners][0];
    vi.resetModules();
    await import("../../src/platforms/shared/connectionProbe");

    expect(runtime.onMessage.removeListener).toHaveBeenLastCalledWith(
      firstInstalled,
    );
    expect(runtime.onMessage.removeListener).toHaveBeenCalledTimes(2);
    expect(runtime.onMessage.addListener).toHaveBeenCalledTimes(2);
    expect(listeners).toHaveLength(1);
  });

  it("does not duplicate a legacy listener whose reference cannot be removed safely", async () => {
    const runtime = {
      id: "offline-extension",
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    vi.stubGlobal("chrome", { runtime });
    vi.stubGlobal("document", {});
    const frame = { top: undefined as unknown };
    frame.top = frame;
    vi.stubGlobal("window", frame);
    vi.stubGlobal("location", {
      href: "https://vids.google.com/video/vid-1/edit",
    });
    (
      globalThis as typeof globalThis & {
        __automatFacelessConnectionProbeInstalled?: boolean;
      }
    ).__automatFacelessConnectionProbeInstalled = true;

    await import("../../src/platforms/shared/connectionProbe");

    expect(runtime.onMessage.addListener).not.toHaveBeenCalled();
    expect(runtime.onMessage.removeListener).not.toHaveBeenCalled();
  });
});
