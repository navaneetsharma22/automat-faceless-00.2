import { describe, expect, it, vi } from "vitest";
import { createFlowDownloadDiagnosticManager } from "../../src/background/flowDownloadDiagnostic";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import {
  fingerprintFlowAssetPath,
  diagnoseFlowRouteAssetBlobLink,
} from "../../src/platforms/flow/downloads";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";

const projectId = "project-detail-test";
const clipId = "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa";
const otherClipId = "bbc2bc82-0000-4000-8000-000000000000";
const detailUrl = `https://flow.google.com/project/${projectId}/edit/${clipId}`;

function makeVerifiedFlowTarget(now: number) {
  return {
    provider: "Flow" as const,
    tabId: 7,
    canonicalTarget: `https://flow.google.com/project/${projectId}`,
    verification: "verified" as const,
    connectionState: "verified" as const,
    verificationBinding: {
      provider: "Flow" as const,
      tabId: 7,
      canonicalTarget: `https://flow.google.com/project/${projectId}`,
      projectId,
      frameId: 0,
      documentId: "document-detail-test",
      documentToken: "document-token",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: 1,
      capability: "read-only-connection-v1" as const,
      verifiedAt: now,
    },
    updatedAt: now,
  };
}

describe("single-row Flow detail download capture", () => {
  it("records selection, exact Chrome completion, and file resolution separately", async () => {
    let now = 100_000;
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => now);
    await database.selectedTargets.put(makeVerifiedFlowTarget(now));
    const imported = await repositories.upsertFlowClipImport({
      projectId,
      clipId,
      title: "make it",
      detailUrl,
      thumbnail: { available: true, fingerprint: "a".repeat(64) },
    });
    const debuggerEvents: Array<
      (
        source: { tabId?: number },
        method: string,
        params: Record<string, unknown>,
      ) => void
    > = [];
    const debuggerDetaches: Array<
      (source: { tabId?: number }, reason: string) => void
    > = [];
    const downloadCreated: Array<(item: Record<string, unknown>) => void> = [];
    const downloadChanged: Array<(delta: Record<string, unknown>) => void> = [];
    const executeScript = vi.fn(
      async ({ func }: { func: (...args: never[]) => unknown }) => {
        const result =
          func.name === "inspectCurrentFlowClipInPage"
            ? {
                projectId,
                clipId,
                title: "make it",
                thumbnail: { available: true },
              }
            : {
                installed: true,
                menuBound: true,
                qualityOptionObserved: true,
                qualityOptionEnabled: true,
              };
        return [{ documentId: "document-detail-test", result }];
      },
    );
    const manager = createFlowDownloadDiagnosticManager({
      extensionId: "extension-detail-test",
      repositories,
      permissions: { contains: async () => true },
      tabs: {
        get: async (tabId) => ({
          id: tabId,
          title: "Flow detail",
          url: detailUrl,
        }),
      },
      scripting: { executeScript: executeScript as never },
      debugger: {
        attach: vi.fn(),
        sendCommand: async (_target, method) =>
          method === "Page.getFrameTree"
            ? { frameTree: { frame: { id: "main-frame-detail" } } }
            : {},
        detach: vi.fn(),
        onEvent: {
          addListener: (listener) => debuggerEvents.push(listener),
          removeListener: vi.fn(),
        },
        onDetach: {
          addListener: (listener) => debuggerDetaches.push(listener),
          removeListener: vi.fn(),
        },
      },
      downloads: {
        onCreated: {
          addListener: (listener) => downloadCreated.push(listener),
          removeListener: vi.fn(),
        },
        onChanged: {
          addListener: (listener) => downloadChanged.push(listener),
          removeListener: vi.fn(),
        },
        search: async ({ id }) => [
          {
            id,
            state: "complete",
            filename: "C:\\Downloads\\make_it.mp4",
            exists: true,
          },
        ],
      },
      storage: {
        get: async () => ({}),
        set: async () => undefined,
        remove: async () => undefined,
      },
      alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
      now: () => now,
      createSessionId: () => "33333333-3333-4333-8333-333333333333",
    });

    const armed = await manager.armClipDownloadProof(imported.record.id);
    expect(armed).toMatchObject({
      status: "armed",
      captureMode: "detail_clip",
      detailMenuBoundAtArm: true,
      detailClipSelectionStatus: "waiting_for_user_selection",
      detailDownloadCompletionStatus: "not_observed",
      detailFileResolutionStatus: "not_checked",
    });
    expect(armed).not.toHaveProperty("selectedCard");

    const sessionId = "33333333-3333-4333-8333-333333333333";
    const sender = {
      id: "extension-detail-test",
      tab: { id: 7 },
      frameId: 0,
      documentId: "document-detail-test",
    };
    const routeFingerprint = await fingerprintFlowAssetPath(
      sessionId,
      detailUrl,
      projectId,
    );
    expect(routeFingerprint).toMatch(/^[a-f0-9]{64}$/);
    await manager.ingestPageEvent(
      {
        type: "AUTOMAT_FLOW_GALLERY_DOWNLOAD_DIAGNOSTIC_EVENT",
        sessionId,
        stage: "detail_clip_selection",
        capturedAt: now + 10,
        trusted: true,
        requestedQuality: "1080p_upscaled",
        menuBound: true,
        assetPathFingerprint: routeFingerprint,
      },
      sender,
    );
    now += 20;
    for (const listener of debuggerEvents) {
      listener({ tabId: 7 }, "Network.requestWillBeSent", {
        type: "Media",
        frameId: "main-frame-detail",
        request: {
          url: `https://media.example/${clipId}/upscaled.mp4`,
          method: "GET",
        },
      });
      listener({ tabId: 7 }, "Page.downloadWillBegin", {
        frameId: "main-frame-detail",
        url: `blob:https://flow.google.com/${clipId}`,
        suggestedFilename: "make_it.mp4",
      });
    }
    await vi.waitFor(async () => {
      const observed = await manager.get();
      expect(observed).toMatchObject({
        detailClipSelectionStatus: "observed",
        detailDownloadCompletionStatus: "awaiting_chrome_match",
        pageDownloads: [
          expect.objectContaining({ frameMatched: true, afterAction: true }),
        ],
      });
    });
    for (const listener of downloadCreated) {
      listener({
        id: 91,
        filename: "C:\\Downloads\\make_it.mp4",
        state: "in_progress",
        url: `blob:https://flow.google.com/${clipId}`,
        finalUrl: `blob:https://flow.google.com/${clipId}`,
      });
    }
    await vi.waitFor(async () =>
      expect(await manager.get()).toMatchObject({
        detailDownloadCompletionStatus: "in_progress",
        detailTrackedDownloadId: 91,
        detailFileResolutionStatus: "not_checked",
      }),
    );
    now += 100;
    for (const listener of downloadChanged) {
      listener({ id: 91, state: { current: "complete" } });
    }
    await vi.waitFor(async () =>
      expect(await manager.get()).toMatchObject({
        status: "completed",
        detailDownloadCompletionStatus: "complete",
        detailFileResolutionStatus: "resolved",
        detailTrackedDownloadId: 91,
        association: "unverified",
        associationReason: "no_quality_action",
      }),
    );
    const completed = await manager.get();
    expect(diagnoseFlowRouteAssetBlobLink(completed as never)).toEqual({
      routeToOutput: "route_id_on_action_request",
      outputToBlob: "blob_id_matches_exact_chrome_download",
    });
    expect(JSON.stringify(completed)).not.toContain(clipId);
    expect(JSON.stringify(completed)).not.toContain("flow.google.com");
    expect(JSON.stringify(completed)).not.toContain("C:\\Downloads");
    expect(debuggerDetaches).toHaveLength(1);
  });

  it("refuses to arm for the other same-title imported clip", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database);
    await database.selectedTargets.put(makeVerifiedFlowTarget(10));
    const other = await repositories.upsertFlowClipImport({
      projectId,
      clipId: otherClipId,
      title: "make it",
      detailUrl: `https://flow.google.com/project/${projectId}/edit/${otherClipId}`,
      thumbnail: { available: true, fingerprint: "b".repeat(64) },
    });
    const executeScript = vi.fn();
    const attach = vi.fn();
    const manager = createFlowDownloadDiagnosticManager({
      extensionId: "extension-detail-test",
      repositories,
      permissions: { contains: async () => true },
      tabs: { get: async (tabId) => ({ id: tabId, url: detailUrl }) },
      scripting: { executeScript: executeScript as never },
      debugger: {
        attach,
        sendCommand: vi.fn(),
        detach: vi.fn(),
        onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
        onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      downloads: {
        onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: {
        get: async () => ({}),
        set: async () => undefined,
        remove: async () => undefined,
      },
      alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
    });
    await expect(manager.armClipDownloadProof(other.record.id)).rejects.toThrow(
      "flow_clip_not_in_single_row_scope",
    );
    expect(executeScript).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });
});
