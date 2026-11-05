import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  classifyFlowDownloadAssociation,
  diagnoseFlowRouteAssetBlobLink,
  diagnoseFlowDownloadMediaIdentity,
  fingerprintFlowDownloadUrl,
  fingerprintFlowAssetPath,
  fingerprintFlowAssetUrlPath,
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
      urlScheme: "https",
      exactDownloadIds: [41],
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
        <button aria-label="More options" aria-controls="gallery-menu">&#x22ee;</button>
      </article>`,
      { url: "https://flow.google.com/project/test" },
    );
    const scope = globalThis as unknown as Record<string, unknown>;
    const originalDocument = scope.document;
    const originalHTMLElement = scope.HTMLElement;
    const originalMutationObserver = scope.MutationObserver;
    const originalWindow = scope.window;
    const originalChrome = scope.chrome;
    const sent: unknown[] = [];
    scope.document = dom.window.document;
    scope.HTMLElement = dom.window.HTMLElement;
    scope.MutationObserver = dom.window.MutationObserver;
    scope.window = dom.window;
    scope.chrome = {
      runtime: {
        sendMessage: vi.fn(async (message: unknown) => {
          sent.push(message);
        }),
      },
    };
    let clickListener: EventListener | undefined;
    let pointerOverListener: EventListener | undefined;
    const originalAdd = dom.window.document.addEventListener.bind(
      dom.window.document,
    );
    dom.window.document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "click" && typeof listener === "function")
        clickListener = listener as EventListener;
      if (type === "pointerover" && typeof listener === "function")
        pointerOverListener = listener as EventListener;
      return originalAdd(type, listener, options);
    }) as typeof dom.window.document.addEventListener;
    const session = "33333333-3333-4333-8333-333333333333";
    try {
      expect(installFlowGalleryDownloadObserver(session)).toMatchObject({
        installed: true,
      });
      dom.window.document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="gallery-menu"><div role="menuitem" aria-controls="quality-menu">downloadDownload</div></div>`,
      );
      const click = (selector: string) => {
        const element = dom.window.document.querySelector(selector);
        if (!(element instanceof dom.window.HTMLElement))
          throw new Error("test control missing");
        clickListener?.({
          isTrusted: true,
          composedPath: () => [element],
        } as unknown as Event);
      };
      // A click elsewhere in the page is not a failed attempt at the Gallery action.
      click("body");
      const more = dom.window.document.querySelector(
        "button[aria-label='More options']",
      )!;
      const nested = dom.window.document.createElement("span");
      more.append(nested);
      clickListener?.({
        isTrusted: true,
        composedPath: () => [nested, more, more.closest("article")],
      } as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const download = dom.window.document.querySelector(
        "[role='menuitem'][aria-controls='quality-menu']",
      )!;
      const downloadIcon = dom.window.document.createElement("span");
      download.append(downloadIcon);
      pointerOverListener?.({
        isTrusted: true,
        composedPath: () => [downloadIcon, download],
      } as unknown as Event);
      dom.window.document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="quality-menu"><button role="menuitem">1080p Upscaled</button></div>`,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const quality = dom.window.document.querySelector(
        "#quality-menu button",
      )!;
      const qualityText = dom.window.document.createElement("span");
      qualityText.textContent = "1080p Upscaled";
      quality.textContent = "";
      quality.append(qualityText);
      clickListener?.({
        isTrusted: true,
        composedPath: () => [qualityText, quality],
      } as unknown as Event);
      // The submenu also closes in response to the same click, after capture.
      dom.window.document.querySelector("#quality-menu")?.remove();

      expect(sent, JSON.stringify(sent)).toHaveLength(5);
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
            stage: "quality_click_listener",
          }),
          expect.objectContaining({
            stage: "quality_action_accepted_in_page",
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
      expect(sent).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stage: "capture_issue" }),
        ]),
      );
      expect(uninstallFlowGalleryDownloadObserver(session)).toEqual({
        removed: true,
      });
    } finally {
      dom.window.close();
      if (originalDocument === undefined) delete scope.document;
      else scope.document = originalDocument;
      if (originalHTMLElement === undefined) delete scope.HTMLElement;
      else scope.HTMLElement = originalHTMLElement;
      if (originalMutationObserver === undefined) delete scope.MutationObserver;
      else scope.MutationObserver = originalMutationObserver;
      if (originalWindow === undefined) delete scope.window;
      else scope.window = originalWindow;
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
    const noIdentity = { ...base, mediaRequests: [] };
    expect(classifyFlowDownloadAssociation(noIdentity)).toMatchObject({
      association: "unverified",
      associationReason: "no_action_media_identity_link",
    });
    expect(diagnoseFlowDownloadMediaIdentity(noIdentity)).toBe(
      "identity_not_extracted",
    );
  });

  it("does not match an unrelated clip's completed download when request identity differs", () => {
    const mismatch = {
      ...base,
      pageDownloads: [
        {
          ...base.pageDownloads[0]!,
          mediaIdFingerprint: "aaaaaaaaaaaaaaaa",
        },
      ],
      downloads: [
        {
          ...base.downloads[0]!,
          state: "complete" as const,
          mediaIdFingerprint: "aaaaaaaaaaaaaaaa",
        },
      ],
      mediaRequests: [
        {
          ...base.mediaRequests[0]!,
          urlFingerprint: "bbbbbbbbbbbbbbbb",
          mediaIdFingerprint: "cccccccccccccccc",
        },
      ],
    };
    expect(classifyFlowDownloadAssociation(mismatch)).toEqual({
      association: "unverified",
      associationReason: "no_action_media_identity_link",
    });
    expect(diagnoseFlowDownloadMediaIdentity(mismatch)).toBe(
      "identity_extracted_no_match",
    );
  });

  it("reports an identity-bearing request dropped by the bounded request buffer", () => {
    expect(
      diagnoseFlowDownloadMediaIdentity({
        ...base,
        mediaRequests: [],
        mediaIdentityRequestsOmittedAtCap: 1,
      }),
    ).toBe("identity_request_dropped_at_cap");
  });

  it("reports a retained request identity that matches the exact event/download pair", () => {
    expect(diagnoseFlowDownloadMediaIdentity(base)).toBe(
      "matching_request_retained",
    );
  });

  it("requires an in-memory exact URL equality link to the Chrome ID", () => {
    expect(
      classifyFlowDownloadAssociation({
        ...base,
        pageDownloads: [{ ...base.pageDownloads[0]!, exactDownloadIds: [] }],
      }),
    ).toEqual({
      association: "unverified",
      associationReason: "no_exact_url_filename_pair",
    });
  });

  it("keeps missing and wrong-frame page events unassociated", () => {
    expect(
      classifyFlowDownloadAssociation({ ...base, pageDownloads: [] }),
    ).toEqual({
      association: "unverified",
      associationReason: "no_selected_frame_download_event",
    });
    expect(
      classifyFlowDownloadAssociation({
        ...base,
        pageDownloads: [{ ...base.pageDownloads[0]!, frameMatched: false }],
      }),
    ).toEqual({
      association: "unverified",
      associationReason: "no_selected_frame_download_event",
    });
  });

  it("retains a Chrome video candidate as unverified before the Gallery action is confirmed", () => {
    const candidateOnly = {
      ...base,
      status: "armed" as const,
      actionAt: undefined,
      nativeActionObserved: undefined,
      requestedQuality: undefined,
      pageDownloads: [],
      downloads: [{ ...base.downloads[0]!, downloadId: 52 }],
    };
    expect(candidateOnly.downloads).toHaveLength(1);
    expect(classifyFlowDownloadAssociation(candidateOnly)).toEqual({
      association: "unverified",
      associationReason: "no_quality_action",
    });
  });

  it("reports ambiguous when multiple Chrome IDs share the exact evidence", () => {
    const duplicate = {
      ...base,
      pageDownloads: [
        { ...base.pageDownloads[0]!, exactDownloadIds: [41, 42] },
      ],
      downloads: [...base.downloads, { ...base.downloads[0]!, downloadId: 42 }],
    };
    expect(classifyFlowDownloadAssociation(duplicate)).toEqual({
      association: "ambiguous",
      associationReason: "multiple_exact_download_candidates",
    });
  });

  it("keeps two competing selected-frame download events ambiguous", () => {
    const secondEvent = {
      ...base.pageDownloads[0]!,
      eventToken: "page-download-2" as const,
      filename: "second.mp4",
      urlFingerprint: "cccccccccccccccc",
      exactDownloadIds: [42],
    };
    const competing = {
      ...base,
      mediaRequests: [],
      pageDownloads: [
        { ...base.pageDownloads[0]!, exactDownloadIds: [41] },
        secondEvent,
      ],
      downloads: [
        ...base.downloads,
        {
          ...base.downloads[0]!,
          downloadId: 42,
          filename: "second.mp4",
          urlFingerprint: "cccccccccccccccc",
        },
      ],
    };
    expect(classifyFlowDownloadAssociation(competing)).toEqual({
      association: "ambiguous",
      associationReason: "multiple_page_download_events",
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
        {
          ...base,
          status: "armed",
          actionAt: undefined,
          requestedQuality: undefined,
        },
        base.expiresAt,
      ),
    ).toMatchObject({ status: "expired", association: "unverified" });
  });

  it("keeps filenames to basenames and never returns URL query tokens", async () => {
    expect(
      sanitizeFlowDownloadFilename("C:\\Users\\me\\clip 01.mp4?secret=token"),
    ).toBe("clip 01.mp4");
    const fingerprints = await fingerprintFlowDownloadUrl(
      base.sessionId,
      "https://media.example/8c53eca2/video.mp4?signature=secret-token",
    );
    expect(fingerprints).toMatchObject({
      accepted: true,
      schemeCategory: "https",
      urlFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
      mediaIdFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
    });
    expect(JSON.stringify(fingerprints)).not.toContain("secret-token");
  });

  it("classifies rejected download URLs without returning their contents", async () => {
    const cases = [
      [undefined, { reason: "missing", schemeCategory: "unknown" }],
      ["  ", { reason: "empty", schemeCategory: "unknown" }],
      ["https://%", { reason: "malformed", schemeCategory: "https" }],
      [
        "ftp://download.example/clip.mp4",
        { reason: "unsupported_scheme", schemeCategory: "other" },
      ],
      [
        "https://user:secret@download.example/clip.mp4?token=private",
        { reason: "policy_rejected", schemeCategory: "https" },
      ],
    ] as const;
    for (const [rawUrl, rejection] of cases) {
      const result = await fingerprintFlowDownloadUrl(base.sessionId, rawUrl);
      expect(result).toEqual({ accepted: false, rejection });
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(JSON.stringify(result)).not.toContain("private");
    }
  });

  it("accepts HTTP and blob URL forms for exact in-memory comparison", async () => {
    await expect(
      fingerprintFlowDownloadUrl(
        base.sessionId,
        "http://localhost:4173/download.mp4",
      ),
    ).resolves.toMatchObject({ accepted: true, schemeCategory: "http" });
    await expect(
      fingerprintFlowDownloadUrl(
        base.sessionId,
        "blob:https://flow.example/opaque-token",
      ),
    ).resolves.toMatchObject({ accepted: true, schemeCategory: "blob" });
  });

  it("fingerprints only the selected project's /edit asset route and matching URL path IDs", async () => {
    const route = await fingerprintFlowAssetPath(
      base.sessionId,
      "https://flow.google.com/project/project-test/edit/11111111-2222-4333-8444-555555555555",
      "project-test",
    );
    expect(route).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      fingerprintFlowAssetPath(
        base.sessionId,
        "https://flow.google.com/project/other/edit/11111111-2222-4333-8444-555555555555",
        "project-test",
      ),
    ).resolves.toBeUndefined();
    await expect(
      fingerprintFlowAssetPath(
        base.sessionId,
        "https://flow.google.com/project/project-test",
        "project-test",
      ),
    ).resolves.toBeUndefined();
    await expect(
      fingerprintFlowAssetUrlPath(
        base.sessionId,
        "https://media.example/assets/11111111-2222-4333-8444-555555555555/video",
      ),
    ).resolves.toBe(route);
    expect(route).not.toContain("11111111");
  });

  it("does not let unrelated output IDs or an exact but unrelated download satisfy the route-to-blob trace", async () => {
    const routeFingerprint = await fingerprintFlowAssetPath(
      base.sessionId,
      "https://flow.google.com/project/project-test/edit/11111111-2222-4333-8444-555555555555",
      "project-test",
    );
    const unrelatedAsset = await fingerprintFlowAssetUrlPath(
      base.sessionId,
      "https://media.example/assets/eeeeeeee-1111-4111-8111-111111111111/video",
    );
    const unrelated = {
      ...base,
      identityCaptureEnabled: true,
      assetRoutePreflight: {
        matchStatus: "matched",
        assetPathFingerprint: routeFingerprint,
      },
      selectedCard: {
        ...base.selectedCard!,
        assetPathFingerprint: routeFingerprint,
      },
      mediaRequests: [
        {
          ...base.mediaRequests[0]!,
          urlFingerprint: "bbbbbbbbbbbbbbbb",
          assetPathFingerprint: unrelatedAsset,
        },
      ],
      pageDownloads: [
        { ...base.pageDownloads[0]!, assetPathFingerprint: unrelatedAsset },
      ],
      downloads: [
        { ...base.downloads[0]!, assetPathFingerprint: unrelatedAsset },
      ],
    };
    expect(diagnoseFlowRouteAssetBlobLink(unrelated)).toEqual({
      routeToOutput: "route_id_not_in_action_request",
      outputToBlob: "route_id_not_in_action_request",
    });
    expect(classifyFlowDownloadAssociation(unrelated)).toMatchObject({
      association: "unverified",
      associationReason: "no_action_media_identity_link",
    });
  });

  it("reports the exact stop when a route-matching asset request has no route-matching blob download", async () => {
    const routeFingerprint = await fingerprintFlowAssetPath(
      base.sessionId,
      "https://flow.google.com/project/project-test/edit/11111111-2222-4333-8444-555555555555",
      "project-test",
    );
    const unrelatedBlobAsset = await fingerprintFlowAssetUrlPath(
      base.sessionId,
      "blob:https://flow.google.com/eeeeeeee-1111-4111-8111-111111111111",
    );
    expect(
      diagnoseFlowRouteAssetBlobLink({
        ...base,
        identityCaptureEnabled: true,
        assetRoutePreflight: {
          matchStatus: "matched",
          assetPathFingerprint: routeFingerprint,
        },
        selectedCard: {
          ...base.selectedCard!,
          assetPathFingerprint: routeFingerprint,
        },
        mediaRequests: [
          { ...base.mediaRequests[0]!, assetPathFingerprint: routeFingerprint },
        ],
        pageDownloads: [
          { ...base.pageDownloads[0]!, assetPathFingerprint: unrelatedBlobAsset },
        ],
        downloads: [
          { ...base.downloads[0]!, assetPathFingerprint: unrelatedBlobAsset },
        ],
      }),
    ).toEqual({
      routeToOutput: "route_id_on_action_request",
      outputToBlob: "blob_id_not_observed",
    });
  });

  it("requires the route UUID on the blob URL and exact Chrome ID for the final identity edge", async () => {
    const routeFingerprint = await fingerprintFlowAssetPath(
      base.sessionId,
      "https://flow.google.com/project/project-test/edit/11111111-2222-4333-8444-555555555555",
      "project-test",
    );
    const blobAssetFingerprint = await fingerprintFlowAssetUrlPath(
      base.sessionId,
      "blob:https://flow.google.com/11111111-2222-4333-8444-555555555555",
    );
    expect(
      diagnoseFlowRouteAssetBlobLink({
        ...base,
        identityCaptureEnabled: true,
        assetRoutePreflight: {
          matchStatus: "matched",
          assetPathFingerprint: routeFingerprint,
        },
        selectedCard: {
          ...base.selectedCard!,
          assetPathFingerprint: routeFingerprint,
        },
        mediaRequests: [
          { ...base.mediaRequests[0]!, assetPathFingerprint: routeFingerprint },
        ],
        pageDownloads: [
          {
            ...base.pageDownloads[0]!,
            urlScheme: "blob",
            assetPathFingerprint: blobAssetFingerprint,
          },
        ],
        downloads: [
          { ...base.downloads[0]!, assetPathFingerprint: blobAssetFingerprint },
        ],
      }),
    ).toEqual({
      routeToOutput: "route_id_on_action_request",
      outputToBlob: "blob_id_matches_exact_chrome_download",
    });
  });
});
