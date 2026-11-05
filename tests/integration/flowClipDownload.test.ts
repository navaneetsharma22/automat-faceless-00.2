import { describe, expect, it, vi } from "vitest";
import {
  createFlowDownloadDiagnosticManager,
  type FlowDownloadDiagnosticDependencies,
} from "../../src/background/flowDownloadDiagnostic";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";

const projectId = "000936e1-dc7a-4421-988b-d4c66a804aed";
const clipId = "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa";
const assetId = "d8d91f05-e14d-4e15-964f-104981510af6";

async function fixture() {
  const database = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(database);
  let currentUrl = `https://flow.google.com/project/${projectId}/edit/${clipId}`;
  await database.selectedTargets.put({
    provider: "Flow",
    tabId: 7,
    canonicalTarget: `https://flow.google.com/project/${projectId}`,
    verification: "verified",
    connectionState: "verified",
    updatedAt: Date.now(),
    verificationBinding: {
      provider: "Flow",
      tabId: 7,
      canonicalTarget: `https://flow.google.com/project/${projectId}`,
      projectId,
      frameId: 0,
      documentId: "doc",
      documentToken: "token",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: 1,
      capability: "read-only-connection-v1",
      verifiedAt: Date.now(),
    },
  });
  const row = await repositories.upsertFlowClipImport({
    projectId,
    clipId,
    title: "make it",
    detailUrl: currentUrl,
    thumbnail: { available: true },
  });
  const storage: Record<string, unknown> = {};
  const events: Parameters<
    FlowDownloadDiagnosticDependencies["debugger"]["onEvent"]["addListener"]
  >[0][] = [];
  const created: Parameters<
    FlowDownloadDiagnosticDependencies["downloads"]["onCreated"]["addListener"]
  >[0][] = [];
  const changed: Parameters<
    FlowDownloadDiagnosticDependencies["downloads"]["onChanged"]["addListener"]
  >[0][] = [];
  const sendCommand = vi.fn(async (_target: unknown, method: string) =>
    method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "root" } } }
      : {},
  );
  const executeScript = vi.fn(
    async (input: { func: { name: string }; args: unknown[] }) => [
      {
        documentId: "doc",
        result:
          input.func.name === "prepareFlowClipDownloadInPage" &&
          input.args[4] === true
            ? { status: "identity", assetId }
            : input.func.name === "inspectCurrentFlowClipInPage"
              ? {
                  projectId,
                  clipId,
                  title: "make it",
                  thumbnail: { available: true },
                }
              : { status: "ready", assetId, x: 50, y: 60 },
      },
    ],
  );
  const dependencies: FlowDownloadDiagnosticDependencies = {
    extensionId: "extension",
    repositories,
    permissions: { contains: async () => true },
    tabs: { get: async (id) => ({ id, url: currentUrl }) },
    scripting: { executeScript: executeScript as never },
    debugger: {
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand,
      onEvent: {
        addListener: (listener) => events.push(listener),
        removeListener: vi.fn(),
      },
      onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    downloads: {
      onCreated: {
        addListener: (listener) => created.push(listener),
        removeListener: vi.fn(),
      },
      onChanged: {
        addListener: (listener) => changed.push(listener),
        removeListener: vi.fn(),
      },
      search: async ({ id }) => [
        {
          id,
          state: "complete",
          filename: "C:/Downloads/make_it.mp4",
          exists: true,
        },
      ],
    },
    storage: {
      get: async () => storage,
      set: async (value) => {
        Object.assign(storage, value);
      },
      remove: async (key) => {
        delete storage[key];
      },
    },
    alarms: { create: vi.fn(), clear: async () => true },
  };
  const manager = createFlowDownloadDiagnosticManager(dependencies);
  return {
    manager,
    dependencies,
    row: row.record,
    sendCommand,
    executeScript,
    events,
    created,
    changed,
    storage,
    setUrl: (url: string) => {
      currentUrl = url;
    },
  };
}

describe("dashboard initiated Flow download", () => {
  it("ignores a same-frame completed MP4 whose asset candidate differs", async () => {
    const f = await fixture();
    await f.manager.startClipDownload(f.row.id);
    const url = "blob:https://flow.google.com/unrelated-same-frame";
    f.events[0]!({ tabId: 7 }, "Page.downloadWillBegin", {
      frameId: "root",
      url,
      suggestedFilename: "make_it_5a796d9e_1080p.mp4",
    });
    f.created[0]!({
      id: 99,
      state: "complete",
      url,
      filename: "make_it_5a796d9e_1080p.mp4",
    });
    expect(await f.manager.get()).toMatchObject({
      status: "action_observed",
      pageDownloads: [],
      automaticDownload: { ignoredPageEvents: 1 },
    });
    f.manager.dispose();
  });

  it("interrupts monitoring if the exact clip changes before the page download event", async () => {
    const f = await fixture();
    await f.manager.startClipDownload(f.row.id);
    f.setUrl(
      `https://flow.google.com/project/${projectId}/edit/bbc2bc82-eccc-4cbe-b3bd-2c8ee2fbd7fa`,
    );
    f.events[0]!({ tabId: 7 }, "Page.downloadWillBegin", {
      frameId: "root",
      url: "blob:https://flow.google.com/changed-context",
      suggestedFilename: "make_it_d8d91f05_1080p.mp4",
    });
    expect(await f.manager.get()).toMatchObject({
      status: "interrupted",
      interruptionReason: "dashboard_download_context_changed",
      pageDownloads: [],
    });
    f.manager.dispose();
  });

  it("sends one quality click and completes only the exact page-to-Chrome download", async () => {
    const f = await fixture();
    const report = await f.manager.startClipDownload(f.row.id);
    expect(report).toMatchObject({
      status: "action_observed",
      automaticDownload: { recordId: f.row.id, dispatchState: "sent" },
    });
    expect(
      f.sendCommand.mock.calls.filter(
        (call) => call[1] === "Input.dispatchMouseEvent",
      ),
    ).toHaveLength(2);
    await expect(f.manager.startClipDownload(f.row.id)).rejects.toThrow(
      "flow_diagnostic_already_active",
    );
    f.created[0]!({
      id: 100,
      state: "complete",
      filename: "other.mp4",
      url: "blob:https://flow.google.com/unrelated",
    });
    expect(await f.manager.get()).toMatchObject({ status: "action_observed" });
    const url =
      "blob:https://flow.google.com/11111111-2222-4333-8444-555555555555";
    f.events[0]!({ tabId: 7 }, "Page.downloadWillBegin", {
      frameId: "root",
      url,
      suggestedFilename: "make_it_d8d91f05_1080p.mp4",
    });
    f.created[0]!({
      id: 101,
      state: "in_progress",
      filename: "make_it_d8d91f05_1080p.mp4",
      url,
    });
    expect(await f.manager.get()).toMatchObject({
      detailTrackedDownloadId: 101,
      detailDownloadCompletionStatus: "in_progress",
    });
    f.changed[0]!({ id: 100, state: { current: "complete" } });
    expect(await f.manager.get()).toMatchObject({ status: "action_observed" });
    f.changed[0]!({ id: 101, state: { current: "complete" } });
    expect(await f.manager.get()).toMatchObject({
      status: "completed",
      detailTrackedDownloadId: 101,
      association: "unverified",
      detailFileResolutionStatus: "resolved",
    });
    expect(JSON.stringify(f.storage)).not.toContain(assetId);
    expect(JSON.stringify(f.storage)).not.toContain(url);
    f.manager.dispose();
  });

  it("rejects a different route before any page input", async () => {
    const f = await fixture();
    f.setUrl(
      `https://flow.google.com/project/${projectId}/edit/bbc2bc82-eccc-4cbe-b3bd-2c8ee2fbd7fa`,
    );
    await expect(f.manager.startClipDownload(f.row.id)).rejects.toThrow(
      "flow_clip_detail_route_mismatch",
    );
    expect(f.executeScript).not.toHaveBeenCalled();
    expect(f.sendCommand).not.toHaveBeenCalled();
    f.manager.dispose();
  });

  it("stops on changed selected asset before dispatch", async () => {
    const f = await fixture();
    const original = f.executeScript.getMockImplementation()!;
    let points = 0;
    f.executeScript.mockImplementation(async (input) => {
      if (input.func.name === "prepareFlowClipDownloadInPage" && ++points === 3)
        return [
          {
            documentId: "doc",
            result: {
              status: "blocked",
              reason: "flow_clip_selected_asset_changed",
            },
          } as never,
        ];
      return original(input);
    });
    await expect(f.manager.startClipDownload(f.row.id)).rejects.toThrow(
      "flow_clip_selected_asset_changed",
    );
    expect(
      f.sendCommand.mock.calls.filter(
        (call) => call[1] === "Input.dispatchMouseEvent",
      ),
    ).toHaveLength(0);
    expect(await f.manager.get()).toMatchObject({
      status: "stopped",
      automaticDownload: { dispatchState: "preparing" },
    });
    f.manager.dispose();
  });

  it("persists uncertain dispatch and never replays after failure or worker restart", async () => {
    const f = await fixture();
    const original = f.sendCommand.getMockImplementation()!;
    f.sendCommand.mockImplementation(async (target, method) => {
      if (method === "Input.dispatchMouseEvent")
        throw new Error("connection lost");
      return original(target, method);
    });
    await expect(f.manager.startClipDownload(f.row.id)).rejects.toThrow(
      "connection lost",
    );
    expect(await f.manager.get()).toMatchObject({
      status: "interrupted",
      automaticDownload: { dispatchState: "uncertain" },
    });
    await expect(f.manager.startClipDownload(f.row.id)).rejects.toThrow(
      "flow_download_previous_outcome_needs_review",
    );
    f.manager.dispose();
    const restarted = createFlowDownloadDiagnosticManager(f.dependencies);
    await expect(restarted.startClipDownload(f.row.id)).rejects.toThrow(
      "flow_download_previous_outcome_needs_review",
    );
    expect(
      f.sendCommand.mock.calls.filter(
        (call) => call[1] === "Input.dispatchMouseEvent",
      ),
    ).toHaveLength(1);
    restarted.dispose();
  });
});
