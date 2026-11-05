import { describe, expect, it, vi } from "vitest";
import {
  createFlowDownloadDiagnosticManager,
  type FlowDownloadDiagnosticDebuggerDetachListener,
  type FlowDownloadDiagnosticDebuggerEventListener,
  type FlowDownloadDiagnosticDownloadChangedListener,
  type FlowDownloadDiagnosticDownloadCreatedListener,
} from "../../src/background/flowDownloadDiagnostic";
import {
  fingerprintFlowAssetPath,
  FLOW_GALLERY_DIAGNOSTIC_EVENT,
} from "../../src/platforms/flow/downloads";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";

const sessionId = "33333333-3333-4333-8333-333333333333";
const detailRouteUrl =
  "https://flow.google.com/project/project-test/edit/11111111-2222-4333-8444-555555555555";
const otherDetailRouteUrl =
  "https://flow.google.com/project/project-test/edit/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const mediaUrl =
  "https://media.example/8c53eca2/clip.mp4?signature=private-token";

describe("Flow Gallery download diagnostic worker path", () => {
  it("arms only the verified Flow document and records the native-to-download evidence chain", async () => {
    let now = 10_000;
    let currentTabUrl = "https://flow.google.com/project/project-test";
    const storage = new Map<string, unknown>();
    const debuggerEvents: FlowDownloadDiagnosticDebuggerEventListener[] = [];
    const debuggerDetaches: FlowDownloadDiagnosticDebuggerDetachListener[] = [];
    const createdListeners: FlowDownloadDiagnosticDownloadCreatedListener[] =
      [];
    const changedListeners: FlowDownloadDiagnosticDownloadChangedListener[] =
      [];
    const detachDebugger = vi.fn(async () => undefined);
    const executeScript = vi.fn(
      async (input: { func: (...args: never[]) => unknown }) => {
        if (input.func.name.includes("installFlowGalleryDownloadObserver"))
          return [{ documentId: "document-test", result: { installed: true } }];
        return [{ documentId: "document-test", result: { removed: true } }];
      },
    );
    const manager = createFlowDownloadDiagnosticManager({
      extensionId: "extension-test",
      repositories: {
        getSelectedTarget: async () =>
          ({
            provider: "Flow",
            tabId: 7,
            canonicalTarget: "https://flow.google.com/project/project-test",
            verification: "verified",
            connectionState: "verified",
            verificationBinding: {
              provider: "Flow",
              tabId: 7,
              canonicalTarget: "https://flow.google.com/project/project-test",
              projectId: "project-test",
              frameId: 0,
              documentId: "document-test",
              documentToken: "document-token",
              extensionBuildId: BUILD_ID,
              extensionProtocolVersion: PROTOCOL_VERSION,
              connectorBuildId: BUILD_ID,
              connectorProtocolVersion: 1,
              capability: "read-only-connection-v1",
              verifiedAt: 1,
            },
          }) as never,
      },
      permissions: { contains: async () => true },
      tabs: {
        get: async (tabId) => ({
          id: tabId,
          title: "Flow project",
          url: currentTabUrl,
        }),
      },
      scripting: { executeScript: executeScript as never },
      debugger: {
        attach: vi.fn(async () => undefined),
        sendCommand: vi.fn(async (_target, method) =>
          method === "Page.getFrameTree"
            ? { frameTree: { frame: { id: "main-frame-test" } } }
            : {},
        ),
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
          addListener: (listener) => createdListeners.push(listener),
          removeListener: vi.fn(),
        },
        onChanged: {
          addListener: (listener) => changedListeners.push(listener),
          removeListener: vi.fn(),
        },
      },
      storage: {
        get: async (key) => ({
          ...(storage.has(key) ? { [key]: storage.get(key) } : {}),
        }),
        set: async (items) => {
          for (const [key, value] of Object.entries(items))
            storage.set(key, value);
        },
        remove: async (key) => void storage.delete(key),
      },
      alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
      now: () => now,
      createSessionId: () => sessionId,
    });

    const armedWithoutEditRoute = await manager.arm(true);
    expect(armedWithoutEditRoute).toMatchObject({
      identityCaptureEnabled: true,
      assetRoutePreflight: {
        matchStatus: "no_matching_edit_route",
        selectedRouteMatchStatus: "not_checked",
      },
    });
    await manager.stop();

    currentTabUrl = detailRouteUrl;
    const armed = await manager.arm(true);
    expect(armed).toMatchObject({
      status: "armed",
      tabId: 7,
      identityCaptureEnabled: true,
      assetRoutePreflight: {
        matchStatus: "matched",
        assetPathFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(JSON.stringify(armed)).not.toContain("11111111-2222");
    expect(executeScript).toHaveBeenCalledTimes(3);

    const sender = {
      id: "extension-test",
      tab: { id: 7 },
      frameId: 0,
      documentId: "document-test",
    };
    const pageEvent = async (event: Record<string, unknown>) =>
      manager.ingestPageEvent(
        { type: FLOW_GALLERY_DIAGNOSTIC_EVENT, sessionId, ...event },
        sender,
      );
    await pageEvent({
      stage: "main_menu",
      capturedAt: now,
      ownerFound: true,
      stableIdAttributeObserved: false,
      assetPathFingerprint: await fingerprintFlowAssetPath(
        sessionId,
        detailRouteUrl,
        "project-test",
      ),
      mainMenuControlResolved: true,
    });
    expect(await manager.get()).toMatchObject({
      assetRoutePreflight: {
        matchStatus: "matched",
        selectedRouteMatchStatus: "matched",
      },
    });
    const otherClipFingerprint = await fingerprintFlowAssetPath(
      sessionId,
      otherDetailRouteUrl,
      "project-test",
    );
    expect(otherClipFingerprint).not.toBe(
      await fingerprintFlowAssetPath(sessionId, detailRouteUrl, "project-test"),
    );
    await pageEvent({
      stage: "main_menu",
      capturedAt: now + 1,
      ownerFound: true,
      stableIdAttributeObserved: false,
      assetPathFingerprint: otherClipFingerprint,
      mainMenuControlResolved: true,
    });
    expect(await manager.get()).toMatchObject({
      assetRoutePreflight: {
        matchStatus: "matched",
        selectedRouteMatchStatus: "changed_or_missing",
      },
    });
    await pageEvent({
      stage: "main_menu",
      capturedAt: now + 2,
      ownerFound: true,
      stableIdAttributeObserved: false,
      assetPathFingerprint: await fingerprintFlowAssetPath(
        sessionId,
        detailRouteUrl,
        "project-test",
      ),
      mainMenuControlResolved: true,
    });
    await pageEvent({
      stage: "download_row",
      capturedAt: now + 100,
      downloadRowRecognized: true,
      qualityMenuControlResolved: true,
      qualityOptionObserved: true,
      qualityOptionEnabled: true,
    });
    now += 1;
    for (const callback of debuggerEvents) {
      for (let index = 0; index < 17; index += 1) {
        callback({ tabId: 7 }, "Network.requestWillBeSent", {
          type: "Media",
          frameId: "main-frame-test",
          request: {
            url: `https://media.example/pre-action-${index}/noise.mp4`,
            method: "GET",
          },
        });
      }
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        mediaRequests: expect.arrayContaining([
          expect.objectContaining({ requestToken: "media-request-16" }),
        ]),
        mediaRequestsOmittedAtCap: 1,
      });
    });
    now += 200;
    const qualityClickAt = now;
    await pageEvent({
      stage: "quality_click_listener",
      capturedAt: qualityClickAt,
    });
    await pageEvent({
      stage: "quality_action_accepted_in_page",
      capturedAt: qualityClickAt,
    });
    // The CDP event reaches the worker before the queued quality_action message.
    now += 10;
    for (const callback of debuggerEvents) {
      callback({ tabId: 7 }, "Page.downloadWillBegin", {
        frameId: "main-frame-test",
        url: mediaUrl,
        suggestedFilename: "clip-8c53eca2.mp4",
      });
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        qualityClickListenerReached: true,
        qualityActionAcceptedInPage: true,
        pageDownloads: [
          expect.objectContaining({ frameMatched: true, afterAction: false }),
        ],
      });
      expect(await manager.get()).not.toHaveProperty(
        "qualityActionReceivedByWorker",
      );
    });
    await pageEvent({
      stage: "quality_action",
      capturedAt: qualityClickAt,
      trusted: true,
      requestedQuality: "1080p_upscaled",
    });
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        actionAt: qualityClickAt,
        qualityActionReceivedByWorker: true,
        pageDownloads: [
          expect.objectContaining({ frameMatched: true, afterAction: true }),
        ],
        mediaRequests: [],
        mediaRequestsOmittedAtCap: 0,
      });
    });

    now += 100;
    for (const callback of debuggerEvents) {
      for (let index = 0; index < 16; index += 1) {
        callback({ tabId: 7 }, "Network.requestWillBeSent", {
          type: "Media",
          frameId: "main-frame-test",
          request: {
            url: `https://media.example/no-identity-${index}/preview.mp4`,
            method: "GET",
          },
        });
      }
    }
    await vi.waitFor(async () => {
      expect((await manager.get()).mediaRequests).toHaveLength(16);
    });
    for (const callback of debuggerEvents) {
      callback({ tabId: 7 }, "Network.requestWillBeSent", {
        type: "Fetch",
        frameId: "main-frame-test",
        request: {
          url: "https://media.example/8c53eca2/clip-identity",
          method: "POST",
        },
      });
    }
    await vi.waitFor(async () => {
      const snapshot = await manager.get();
      expect(snapshot).toMatchObject({
        mediaRequestsOmittedAtCap: 1,
        mediaRequests: expect.arrayContaining([
          expect.objectContaining({
            resourceKind: "Fetch",
            method: "POST",
            mediaIdFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
          }),
        ]),
      });
    });
    for (const callback of debuggerEvents) {
      for (let index = 0; index < 16; index += 1) {
        callback({ tabId: 7 }, "Network.requestWillBeSent", {
          type: "Fetch",
          frameId: "main-frame-test",
          request: {
            url:
              "https://media.example/deadbeef0000000" +
              index.toString(16) +
              "/noise",
            method: "POST",
          },
        });
      }
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        mediaIdentityRequestsOmittedAtCap: 1,
      });
    });
    for (const callback of debuggerEvents) {
      callback({ tabId: 99 }, "Page.downloadWillBegin", {
        frameId: "other-target-frame",
        url: mediaUrl,
        suggestedFilename: "clip-8c53eca2.mp4",
      });
      callback({ tabId: 7 }, "Page.downloadWillBegin", {
        frameId: "child-frame-test",
        url: mediaUrl,
        suggestedFilename: "clip-8c53eca2.mp4",
      });
      callback({ tabId: 7 }, "Page.downloadWillBegin", {
        frameId: "main-frame-test",
        suggestedFilename: "clip-8c53eca2.mp4",
      });
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        association: "unverified",
        associationReason: "no_exact_url_filename_pair",
        pageDownloadEventsReceived: 4,
        pageDownloadTargetMismatches: 1,
        pageDownloadFrameMismatches: 1,
        pageDownloadMainFrameEvents: 2,
        pageDownloadMetadataRejected: 1,
        pageDownloads: expect.arrayContaining([
          expect.objectContaining({
            frameMatched: true,
            afterAction: true,
          }),
          expect.objectContaining({ frameMatched: false, afterAction: true }),
        ]),
      });
    });
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        association: "unverified",
        mediaRequests: expect.arrayContaining([
          expect.objectContaining({ resourceKind: "Fetch", method: "POST" }),
        ]),
        mediaRequestsOmittedAtCap: 17,
        mediaIdentityRequestsOmittedAtCap: 1,
        pageDownloadEventsReceived: 4,
        pageDownloadTargetMismatches: 1,
        pageDownloadFrameMismatches: 1,
        pageDownloadMainFrameEvents: 2,
        pageDownloadMetadataRejected: 1,
      });
    });
    now += 100;
    for (const listener of createdListeners) {
      listener({
        id: 50,
        filename: "C:\\Downloads\\unrelated.mp4",
        state: "complete",
        url: "https://other.example/unrelated.mp4?token=unrelated-secret",
        finalUrl: "https://other.example/unrelated.mp4?token=unrelated-secret",
      });
      listener({
        id: 51,
        filename: "C:\\Downloads\\clip-8c53eca2.mp4",
        state: "in_progress",
        url: "https://media.example/redirect-start?signature=initial-secret",
        finalUrl: mediaUrl,
      });
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        status: "action_observed",
        association: "matched",
        matchedDownloadId: 51,
        downloads: expect.arrayContaining([
          expect.objectContaining({
            downloadId: 50,
            filename: "unrelated.mp4",
            state: "complete",
          }),
          expect.objectContaining({
            downloadId: 51,
            filename: "clip-8c53eca2.mp4",
            state: "in_progress",
            urlScheme: "https",
            finalUrlScheme: "https",
          }),
        ]),
        pageDownloads: expect.arrayContaining([
          expect.objectContaining({
            exactDownloadIds: expect.arrayContaining([51]),
            urlScheme: "https",
          }),
        ]),
      });
    });
    expect(JSON.stringify(await manager.get())).not.toContain("private-token");
    expect(JSON.stringify(await manager.get())).not.toContain("media.example");
    expect(JSON.stringify(await manager.get())).not.toContain(
      "unrelated-secret",
    );

    now += 100;
    for (const listener of changedListeners) {
      listener({ id: 51, state: { current: "complete" } });
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        status: "completed",
        association: "matched",
        matchedDownloadId: 51,
      });
    });
    expect(debuggerDetaches).toHaveLength(1);
    expect(detachDebugger).toHaveBeenCalledTimes(2);

    await manager.arm();
    await pageEvent({
      stage: "main_menu",
      capturedAt: now,
      ownerFound: true,
      stableIdAttributeObserved: false,
      mainMenuControlResolved: true,
    });
    await pageEvent({
      stage: "download_row",
      capturedAt: now + 10,
      downloadRowRecognized: true,
      qualityMenuControlResolved: true,
      qualityOptionObserved: true,
      qualityOptionEnabled: true,
    });
    for (const callback of debuggerEvents) {
      callback({ tabId: 7 }, "Page.downloadWillBegin", {
        frameId: "main-frame-test",
        url: mediaUrl,
      });
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        pageDownloadMainFrameEvents: 1,
        pageDownloadFilenameUnavailable: 1,
        pageDownloads: [
          expect.objectContaining({
            frameMatched: true,
            afterAction: false,
            filename: "unknown-file",
          }),
        ],
      });
    });
    now += 100;
    await pageEvent({
      stage: "quality_action",
      capturedAt: now,
      trusted: true,
      requestedQuality: "1080p_upscaled",
    });
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        association: "unverified",
        associationReason: "no_selected_frame_download_event",
        pageDownloadFilenameUnavailable: 1,
        pageDownloads: [
          expect.objectContaining({
            frameMatched: true,
            afterAction: false,
            filename: "unknown-file",
          }),
        ],
      });
    });
    for (const listener of debuggerDetaches)
      listener({ tabId: 7 }, "target_closed");
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        status: "interrupted",
        interruptionReason: "debugger_detached",
        pageDownloadMainFrameEvents: 1,
        pageDownloadFilenameUnavailable: 1,
        pageDownloads: [
          expect.objectContaining({
            frameMatched: true,
            afterAction: false,
            filename: "unknown-file",
          }),
        ],
      });
    });
    for (const listener of createdListeners) {
      listener({
        id: 53,
        filename: "C:\\Downloads\\late-candidate.mp4",
        state: "in_progress",
        url: "https://media.example/late/candidate.mp4?signature=late-secret",
      });
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        status: "interrupted",
        interruptionReason: "debugger_detached",
        association: "unverified",
        downloadCreatedEvents: 1,
        downloads: [
          expect.objectContaining({
            downloadId: 53,
            filename: "late-candidate.mp4",
          }),
        ],
      });
    });
    expect(JSON.stringify(await manager.get())).not.toContain("late-secret");

    await manager.arm();
    for (const listener of createdListeners) {
      listener({
        id: 54,
        state: "in_progress",
        url: "https://media.example/pending/clip.mp4?signature=pending-secret",
      });
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        status: "armed",
        downloadCreatedEvents: 1,
        downloads: [
          expect.objectContaining({
            downloadId: 54,
            filename: "unknown-file",
            extension: "pending",
          }),
        ],
        nonVideoDownloadCount: 0,
      });
    });
    for (const listener of changedListeners)
      listener({ id: 54, state: { current: "in_progress" } });
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        downloads: [
          expect.objectContaining({ downloadId: 54, extension: "pending" }),
        ],
        nonVideoDownloadCount: 0,
      });
    });
    for (const listener of changedListeners) {
      listener({
        id: 54,
        filename: { current: "C:\\Downloads\\animate_a1d1d9a4_1080p.mp4" },
      });
    }
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        downloads: [
          expect.objectContaining({
            downloadId: 54,
            filename: "animate_a1d1d9a4_1080p.mp4",
            extension: "mp4",
          }),
        ],
        nonVideoDownloadCount: 0,
      });
    });
    expect(JSON.stringify(await manager.get())).not.toContain("pending-secret");

    await manager.stop();
    await manager.arm();
    for (const listener of createdListeners)
      listener({ id: 55, state: "in_progress" });
    await vi.waitFor(async () =>
      expect((await manager.get()).downloads).toEqual([
        expect.objectContaining({ downloadId: 55, extension: "pending" }),
      ]),
    );
    for (const listener of changedListeners)
      listener({ id: 55, filename: { current: "unrelated.pdf" } });
    await vi.waitFor(async () => {
      expect(await manager.get()).toMatchObject({
        downloads: [],
        nonVideoDownloadCount: 1,
        downloadCreatedEvents: 1,
      });
    });
  });
});
