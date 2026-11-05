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
    const detachDebugger = vi.fn();
    const downloadCreated: Array<(item: Record<string, unknown>) => void> = [];
    const downloadChanged: Array<(delta: Record<string, unknown>) => void> = [];
    const sendCommand = vi.fn(
      async (_target: unknown, method: string, params?: Record<string, unknown>) =>
        method === "Page.getFrameTree"
          ? { frameTree: { frame: { id: "main-frame-detail" } } }
          : method === "Network.getResponseBody" &&
              params?.requestId === "metadata-failed-response"
            ? Promise.reject(new Error("response body unavailable"))
          : method === "Network.getResponseBody" &&
              params?.requestId === "metadata-empty-response"
            ? { body: JSON.stringify({ status: "ready" }), base64Encoded: false }
            : method === "Network.getResponseBody" &&
                params?.requestId === "metadata-oversized-response"
              ? { body: "x".repeat(64 * 1024 + 1), base64Encoded: false }
              : method === "Network.getResponseBody" &&
                  params?.requestId === "metadata-invalid-response"
                ? { body: "not-json", base64Encoded: false }
            : method === "Network.getResponseBody"
              ? { body: JSON.stringify({ id: "job-safe-42", uuid: "77777777-2222-4333-8444-555555555555" }), base64Encoded: false }
              : {},
    );
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
        sendCommand: sendCommand as never,
        detach: detachDebugger,
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
    for (const listener of debuggerEvents) {
      listener({ tabId: 7 }, "Network.requestWillBeSent", {
        requestId: "preselection-request",
        type: "Fetch",
        frameId: "main-frame-detail",
        request: {
          url: "https://flow.google.com/api/preselection",
          method: "POST",
          postData: JSON.stringify({ priorJobId: "loaded-before-click" }),
        },
      });
      listener({ tabId: 7 }, "Network.responseReceived", {
        requestId: "preselection-request",
        response: { mimeType: "application/json" },
      });
      listener({ tabId: 7 }, "Network.loadingFinished", {
        requestId: "preselection-request",
      });
    }
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
        requestId: "metadata-request-id-1",
        type: "Fetch",
        frameId: "main-frame-detail",
        request: {
          url: "https://flow.google.com/api/upscale",
          method: "POST",
          postData: JSON.stringify({ id: clipId, uuid: "job-safe-42" }),
        },
      });
      listener({ tabId: 7 }, "Network.responseReceived", {
        requestId: "metadata-request-id-1",
        response: { mimeType: "application/json" },
      });
      listener({ tabId: 7 }, "Network.requestWillBeSent", {
        requestId: "metadata-empty-response",
        type: "XHR",
        frameId: "main-frame-detail",
        request: { url: "https://flow.google.com/api/state", method: "GET" },
      });
      listener({ tabId: 7 }, "Network.responseReceived", {
        requestId: "metadata-empty-response",
        response: { mimeType: "application/json" },
      });
      listener({ tabId: 7 }, "Network.loadingFinished", {
        requestId: "metadata-empty-response",
      });
      for (const [requestId, mimeType] of [
        ["metadata-unsupported-response", "text/plain"],
        ["metadata-failed-response", "application/json"],
        ["metadata-oversized-response", "application/json"],
        ["metadata-invalid-response", "application/json"],
      ] as const) {
        listener({ tabId: 7 }, "Network.requestWillBeSent", {
          requestId,
          type: "Fetch",
          frameId: "main-frame-detail",
          request: { url: "https://flow.google.com/api/read", method: "GET" },
        });
        listener({ tabId: 7 }, "Network.responseReceived", {
          requestId,
          response: { mimeType },
        });
        listener({ tabId: 7 }, "Network.loadingFinished", { requestId });
      }
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
    await vi.waitFor(async () => {
      const metadata = await manager.get();
      expect(metadata?.detailMetadataFields?.length).toBeGreaterThanOrEqual(2);
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
        detailMetadataPendingRequests: 1,
        detailFileResolutionStatus: "resolved",
      }),
    );
    expect(detachDebugger).not.toHaveBeenCalled();
    expect(await manager.get()).toMatchObject({
      status: "completed",
      detailMetadataPendingRequests: 1,
      detailMetadataEligibleRequestsSeen: 7,
      detailMetadataRequestsAdmitted: 7,
      detailMetadataRequestBodiesAvailable: 2,
      detailMetadataRequestBodiesRead: 2,
      detailMetadataJsonParseSucceeded: 4,
      detailMetadataParsedBodiesWithoutIdentityFields: 1,
      detailMetadataResponseBodiesAttempted: 5,
      detailMetadataResponseBodiesRead: 4,
      detailMetadataBodiesUnavailable: 0,
      detailMetadataBodiesFailed: 1,
      detailMetadataBodiesUnsupported: 1,
      detailMetadataBodiesFiltered: 1,
    });
    expect(JSON.stringify(await manager.get())).not.toContain("loaded-before-click");
    for (const listener of debuggerEvents) {
      listener({ tabId: 7 }, "Network.loadingFinished", {
        requestId: "metadata-request-id-1",
      });
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        detailMetadataResponseBodiesAttempted: 6,
        detailMetadataResponseBodiesRead: 5,
        detailMetadataJsonParseSucceeded: 5,
        detailMetadataJsonParseFailed: 1,
        detailMetadataParsedBodiesWithoutIdentityFields: 1,
        detailMetadataBodiesUnavailable: 0,
        detailMetadataBodiesFailed: 1,
        detailMetadataBodiesUnsupported: 1,
        detailMetadataBodiesFiltered: 1,
        detailMetadataPendingRequests: 0,
      });
    });
    expect(sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Network.getResponseBody",
      { requestId: "metadata-request-id-1" },
    );
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
    expect(JSON.stringify(completed)).not.toContain("job-safe-42");
    expect(completed.detailMetadataFields?.map((field) => field.fieldPath)).toEqual([
      "priorJobId",
      "id",
      "uuid",
      "id",
      "uuid",
      "id",
      "uuid",
    ]);
    expect(completed.detailMetadataFields?.find((field) => field.fieldPath === "id" && field.routeEquality)).toMatchObject({
      routeEquality: true,
      blobPathEquality: true,
    });
    expect(completed.detailMetadataFields?.find((field) => field.fieldPath === "uuid" && field.requestResponseEquality)?.requestResponseEquality).toBe(true);
    expect(detachDebugger).toHaveBeenCalledTimes(1);
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
