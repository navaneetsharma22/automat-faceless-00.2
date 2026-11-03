import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  classifyFlowDownloadAssociation,
  fingerprintFlowDownloadUrl,
  FlowGalleryDownloadDiagnosticSchema,
  resolveFlowDownloadDiagnosticStatus,
  sanitizeFlowDownloadFilename,
  installFlowGalleryDownloadObserver,
  uninstallFlowGalleryDownloadObserver,
} from "../../src/platforms/flow/downloads";

const base = FlowGalleryDownloadDiagnosticSchema.parse({
  version: 1,
  sessionId: "33333333-3333-4333-8333-333333333333",
  status: "action_observed",
  startedAt: 1_000,
  expiresAt: 1_201_000,
  tabId: 7,
  projectId: "flow-project-test",
  documentId: "document-test",
  mainFrameId: "main-frame-test",
  actionAt: 2_000,
  nativeActionObserved: true,
  requestedQuality: "1080p_upscaled",
  selectedCard: {
    token: "selected-card-1",
    ownerFound: true,
    stableIdAttributeObserved: false,
  },
  menuBinding: {
    mainMenuControlResolved: true,
    downloadRowRecognized: true,
    qualityMenuControlResolved: true,
    qualityOptionObserved: true,
    qualityOptionEnabled: true,
  },
  mediaRequests: [
    {
      requestToken: "media-request-1",
      resourceKind: "Media",
      method: "GET",
      urlFingerprint: "aaaaaaaaaaaaaaaa",
      offsetMs: 1_100,
    },
  ],
  pageDownloads: [
    {
      eventToken: "page-download-1",
      filename: "clip-8c53eca2.mp4",
      urlFingerprint: "aaaaaaaaaaaaaaaa",
      frameMatched: true,
      afterAction: true,
      offsetMs: 3_000,
    },
  ],
  downloads: [
    {
      downloadId: 41,
      filename: "clip-8c53eca2.mp4",
      state: "in_progress",
      extension: "mp4",
      urlFingerprint: "aaaaaaaaaaaaaaaa",
      startedOffsetMs: 3_100,
    },
  ],
  nonVideoDownloadCount: 0,
  association: "unverified",
  associationReason: "no_quality_action",
});

describe("Flow Gallery download feasibility diagnostic", () => {
  it("reads changing aria-controls and recognizes icon-duplicated Download without acting", async () => {
    const dom = new JSDOM(
      `<article data-video-id="private-clip-id">
        <button aria-label="More options" aria-controls="gallery-menu">⋮</button>
        <div id="gallery-menu"><div role="menuitem" aria-controls="quality-menu">downloadDownload</div></div>
        <div id="quality-menu"><button role="menuitem">1080p Upscaled</button></div>
      </article>`,
      { url: "https://flow.google.com/project/test" },
    );
    const scope = globalThis as unknown as Record<string, unknown>;
    const originalDocument = scope.document;
    const originalHTMLElement = scope.HTMLElement;
    const originalChrome = scope.chrome;
    const sent: unknown[] = [];
    scope.document = dom.window.document;
    scope.HTMLElement = dom.window.HTMLElement;
    scope.chrome = {
      runtime: {
        sendMessage: vi.fn(async (message: unknown) => {
          sent.push(message);
        }),
      },
    };
    let clickListener: EventListener | undefined;
    const originalAdd = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "click" && typeof listener === "function")
        clickListener = listener as EventListener;
      return originalAdd(type, listener, options);
    }) as typeof dom.window.document.addEventListener;
    const session = "33333333-3333-4333-8333-333333333333";
    try {
      expect(installFlowGalleryDownloadObserver(session)).toMatchObject({
        installed: true,
      });
      const click = (selector: string) => {
        const element = dom.window.document.querySelector(selector);
        if (!(element instanceof dom.window.HTMLElement))
          throw new Error("test control missing");
        clickListener?.({
          isTrusted: true,
          composedPath: () => [element],
        } as unknown as Event);
      };
      click("button[aria-label='More options']");
      await new Promise((resolve) => setTimeout(resolve, 0));
      click("[role='menuitem'][aria-controls='quality-menu']");
      await new Promise((resolve) => setTimeout(resolve, 0));
      click("#quality-menu button");

      expect(sent).toHaveLength(3);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stage: "main_menu",
            mainMenuControlResolved: true,
            ownerFound: true,
            stableIdAttributeObserved: true,
          }),
          expect.objectContaining({
            stage: "download_row",
            downloadRowRecognized: true,
            qualityMenuControlResolved: true,
            qualityOptionObserved: true,
            qualityOptionEnabled: true,
          }),
          expect.objectContaining({
            stage: "quality_action",
            requestedQuality: "1080p_upscaled",
            trusted: true,
          }),
        ]),
      );
      expect(JSON.stringify(sent)).not.toContain("private-clip-id");
      expect(JSON.stringify(sent)).not.toContain("gallery-menu");
      expect(uninstallFlowGalleryDownloadObserver(session)).toEqual({
        removed: true,
      });
    } finally {
      dom.window.close();
      if (originalDocument === undefined) delete scope.document;
      else scope.document = originalDocument;
      if (originalHTMLElement === undefined) delete scope.HTMLElement;
      else scope.HTMLElement = originalHTMLElement;
      if (originalChrome === undefined) delete scope.chrome;
      else scope.chrome = originalChrome;
    }
  });

  it("matches one selected-frame native download to its exact Chrome ID", () => {
    expect(classifyFlowDownloadAssociation(base)).toEqual({
      association: "matched",
      associationReason: "unique_action_media_and_download_chain",
      matchedDownloadId: 41,
    });
    expect(
      resolveFlowDownloadDiagnosticStatus(
        {
          ...base,
          downloads: [{ ...base.downloads[0]!, state: "complete" }],
        },
        4_000,
      ),
    ).toMatchObject({ status: "completed", matchedDownloadId: 41 });
  });

  it("does not let an unrelated MP4 candidate displace the exact match", () => {
    const withUnrelated = {
      ...base,
      downloads: [
        {
          downloadId: 40,
          filename: "unrelated.mp4",
          state: "complete" as const,
          extension: "mp4" as const,
          urlFingerprint: "bbbbbbbbbbbbbbbb",
          startedOffsetMs: 2_500,
        },
        ...base.downloads,
      ],
    };
    expect(classifyFlowDownloadAssociation(withUnrelated)).toMatchObject({
      association: "matched",
      matchedDownloadId: 41,
    });
  });

  it("does not call a filename or timing-only match a result association", () => {
    expect(
      classifyFlowDownloadAssociation({ ...base, mediaRequests: [] }),
    ).toMatchObject({
      association: "unverified",
      associationReason: "no_action_media_identity_link",
    });
  });

  it("reports ambiguous when multiple Chrome IDs share the exact evidence", () => {
    const duplicate = {
      ...base,
      downloads: [
        ...base.downloads,
        { ...base.downloads[0]!, downloadId: 42 },
      ],
    };
    expect(classifyFlowDownloadAssociation(duplicate)).toEqual({
      association: "ambiguous",
      associationReason: "multiple_exact_download_candidates",
    });
  });

  it("preserves an interrupted exact match and expires an uncompleted observation", () => {
    const interrupted = resolveFlowDownloadDiagnosticStatus(
      {
        ...base,
        downloads: [{ ...base.downloads[0]!, state: "interrupted" }],
      },
      4_000,
    );
    expect(interrupted).toMatchObject({
      status: "interrupted",
      association: "matched",
      matchedDownloadId: 41,
    });
    expect(
      resolveFlowDownloadDiagnosticStatus(
        { ...base, status: "armed", actionAt: undefined, requestedQuality: undefined },
        base.expiresAt,
      ),
    ).toMatchObject({ status: "expired", association: "unverified" });
  });

  it("keeps filenames to basenames and never returns URL query tokens", async () => {
    expect(sanitizeFlowDownloadFilename("C:\\Users\\me\\clip 01.mp4?secret=token"))
      .toBe("clip 01.mp4");
    const fingerprints = await fingerprintFlowDownloadUrl(
      base.sessionId,
      "https://media.example/8c53eca2/video.mp4?signature=secret-token",
    );
    expect(fingerprints).toMatchObject({
      urlFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
      mediaIdFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
    });
    expect(JSON.stringify(fingerprints)).not.toContain("secret-token");
  });
});
