import { JSDOM } from "jsdom";
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createFlowDownloadDiagnosticManager } from "../../src/background/flowDownloadDiagnostic";
import { inspectCurrentFlowClipInPage } from "../../src/platforms/flow/clipImport";
import { prepareFlowClipDownloadInPage } from "../../src/platforms/flow/clipDownload";
import { inspectFlowProjectVideosInPage } from "../../src/platforms/flow/projectVideos";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";

const projectId = "project-test";
const clips = [
  "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa",
  "bbc2bc82-eccc-4cbe-b3bd-2c8ee2fbd7fa",
  "d2f99702-57ad-4c5e-a5fc-49293d51b112",
];
const selectedAssets = [
  "5e7f2082-a8e1-4dad-84d4-b40aef14a122",
  "115bb802-8cc2-4b70-8d4e-e58449125f00",
  "716cab29-f2d8-4f4b-8a77-f325b9c883bf",
];

function createTraversalHarness(options: {
  replaceDocumentOnRestore?: boolean;
  mutateAfterFirstRestore?: boolean;
  changeFinalInventory?: boolean;
  ambiguousOwners?: boolean;
  reorderAfterRestore?: boolean;
  flowOrigin?: boolean;
  missingMedia?: boolean;
  sharedPlaceholder?: boolean;
  queryOnlyCollision?: boolean;
  connectionFailuresBeforeReady?: number;
  connectionNeverReady?: boolean;
  connectionFailsAfterIdentity?: boolean;
  offscreenCardIndex?: number;
  obscureAfterScroll?: boolean;
  duplicateAfterScroll?: boolean;
} = {}) {
  const replaceDocumentOnRestore = options.replaceDocumentOnRestore ?? true;
  let now = 100;
  let documentId = "gallery-doc-1";
  let galleryDocumentVersion = 1;
  let restoreCount = 0;
  let tabUrl = `https://flow.google.com/project/${projectId}`;
  const mediaOverrides = new Map<number, string>();
  const scrollIntoViewIndices: number[] = [];
  const scrolledIntoViewIndices = new Set<number>();
  const obscuredIndices = new Set<number>();
  let dom = makeGalleryDom();
  const database = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(database, () => now);
  const pageReads: string[] = [];
  const openResults: unknown[] = [];
  const clickRoutes: string[] = [];
  const detailIdentityReads: string[] = [];
  let detailRevalidationAttempts = 0;
  let pageReader: ((input: Record<string, unknown>) => Promise<unknown>) | undefined;

  function makeGalleryDom() {
    const page = new JSDOM(`<!doctype html><body>
      <nav aria-label="Project navigation">
        <button>All media</button><button>Images</button>
        <button class="mdc-list-item--activated"><span>videocam</span><span>Videos</span></button>
      </nav>
      <flow-project-page class="cdk-virtual-scrollable page-container" style="overflow-y:auto">
        <flow-gallery></flow-gallery>
      </flow-project-page>
    </body>`, { url: `https://flow.google.com/project/${projectId}`, runScripts: "outside-only" });
    Object.defineProperty(page.window, "crypto", { configurable: true, value: webcrypto });
    const project = page.window.document.querySelector("flow-project-page")!;
    Object.defineProperties(project, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 1400 },
    });
    const gallery = page.window.document.querySelector("flow-gallery")!;
    let lastRenderedTop = -1;
    let forceGalleryRerender = true;
    const renderWindow = (top: number) => {
      if (!forceGalleryRerender && top === lastRenderedTop)
        return [...gallery.querySelectorAll("flow-grid-tile-container")];
      forceGalleryRerender = false;
      lastRenderedTop = top;
      const first = top >= 750 ? 2 : top >= 375 ? 1 : 0;
      const indices = [first];
      if (first < 2) indices.push(first + 1);
      if (options.duplicateAfterScroll && options.offscreenCardIndex !== undefined &&
        scrolledIntoViewIndices.has(options.offscreenCardIndex))
        indices.push(options.offscreenCardIndex);
      if (options.reorderAfterRestore && restoreCount > 0) indices.reverse();
      const host = options.flowOrigin ? "flow.google.com" : "flow-content.google";
      gallery.innerHTML = indices.map((index) => {
        const defaultPath = options.sharedPlaceholder
          ? "media/placeholder"
          : options.queryOnlyCollision && index < 2
            ? "media/shared-render"
            : `video/render-${options.ambiguousOwners && index < 2 ? 0 : index}`;
        const query = options.queryOnlyCollision && index < 2
          ? `?signature=query-secret-${index}`
          : "";
        const media = options.missingMedia
          ? "<flow-video-tile></flow-video-tile>"
          : `<flow-video-tile><video src="https://${host}/${mediaOverrides.get(index) ?? defaultPath}${query}"></video></flow-video-tile>`;
        return `<flow-grid-tile-container role="group" aria-label="Same title" data-test-index="${index}">${media}</flow-grid-tile-container>`;
      }).join("");
      const owners = [...gallery.querySelectorAll("flow-grid-tile-container")];
      for (const owner of owners) {
        const index = Number(owner.getAttribute("data-test-index"));
        const left = index * 240;
        Object.defineProperty(owner, "getBoundingClientRect", { value: () => {
          const offscreen = index === options.offscreenCardIndex && !scrolledIntoViewIndices.has(index);
          const top = offscreen ? 900 : 100;
          return { x: left, y: top, width: 200, height: 120, top, right: left + 200, bottom: top + 120, left, toJSON: () => ({}) };
        } });
        Object.defineProperty(owner, "scrollIntoView", { value: () => {
          scrollIntoViewIndices.push(index);
          scrolledIntoViewIndices.add(index);
          if (options.obscureAfterScroll) obscuredIndices.add(index);
          forceGalleryRerender = true;
          renderWindow(project.scrollTop);
        } });
        owner.addEventListener("click", () => {
          const clipId = clips[Number(owner.getAttribute("data-test-index"))]!;
          tabUrl = `https://flow.google.com/project/${projectId}/edit/${clipId}`;
          clickRoutes.push(tabUrl);
        });
      }
      return owners;
    };
    Object.assign(page.window, {
      __renderGalleryWindow: renderWindow,
      __invalidateGalleryWindow: () => { forceGalleryRerender = true; },
    });
    const blocker = page.window.document.createElement("div");
    blocker.id = "gallery-click-blocker";
    page.window.document.body.append(blocker);
    renderWindow(0);
    Object.defineProperty(page.window.document, "elementFromPoint", {
      value: (x: number, y: number) => {
        const owner = [...page.window.document.querySelectorAll("flow-grid-tile-container")].find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        });
        return owner && obscuredIndices.has(Number(owner.getAttribute("data-test-index")))
          ? blocker
          : owner;
      },
    });
    vi.spyOn(page.window.HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      { x: 0, y: 0, width: 200, height: 120, top: 0, right: 200, bottom: 120, left: 0, toJSON: () => ({}) },
    );
    return page;
  }

  return {
    async setup() {
      await database.selectedTargets.put({
        provider: "Flow", tabId: 7,
        canonicalTarget: `https://flow.google.com/project/${projectId}`,
        verification: "verified", connectionState: "verified",
        verificationBinding: {
          provider: "Flow", tabId: 7,
          canonicalTarget: `https://flow.google.com/project/${projectId}`,
          projectId, frameId: 0, documentId, documentToken: "gallery-token",
          extensionBuildId: BUILD_ID, extensionProtocolVersion: PROTOCOL_VERSION,
          connectorBuildId: BUILD_ID, connectorProtocolVersion: 1,
          capability: "read-only-connection-v1", verifiedAt: now,
        },
        updatedAt: now,
      });
      const manager = createFlowDownloadDiagnosticManager({
        extensionId: "extension-test", repositories,
        permissions: { contains: async () => true },
        tabs: {
          get: async (id) => ({ id, title: "Flow project", url: tabUrl, status: "complete" }),
          update: async (_id, details) => {
            tabUrl = details.url!;
            restoreCount += 1;
            galleryDocumentVersion += 1;
            documentId = `gallery-doc-${galleryDocumentVersion}`;
            if (replaceDocumentOnRestore) {
              dom.window.close();
              dom = makeGalleryDom();
              pageReader = undefined;
            }
            if (options.reorderAfterRestore) {
              const gallery = dom.window.document.querySelector("flow-gallery")!;
              [...gallery.children].reverse().forEach((owner) => gallery.append(owner));
            }
            if (options.mutateAfterFirstRestore && restoreCount === 1) {
              mediaOverrides.set(1, "replaced-card");
            }
            const target = await database.selectedTargets.get("Flow");
            if (target?.verificationBinding) {
              await database.selectedTargets.put({
                ...target,
                verificationBinding: { ...target.verificationBinding, documentId, documentToken: "gallery-token-restored" },
              });
            }
            return { id: 7, url: tabUrl };
          },
        },
        revalidateFlowConnection: async () => {
          if (/\/edit\//.test(tabUrl)) {
            detailRevalidationAttempts += 1;
            if (options.connectionNeverReady || detailRevalidationAttempts <= (options.connectionFailuresBeforeReady ?? 0))
              return {
                ok: false,
                state: "temporarily-unreachable",
                failureStage: "handshake",
                reason: "connector_not_ready",
              };
            if (options.connectionFailsAfterIdentity && detailRevalidationAttempts % 2 === 0)
              return {
                ok: false,
                state: "temporarily-unreachable",
                failureStage: "handshake_validation",
                reason: "connector_revalidation_lost",
              };
            documentId = "detail-document";
            const target = await database.selectedTargets.get("Flow");
            if (target?.verificationBinding)
              await database.selectedTargets.put({ ...target, verificationBinding: { ...target.verificationBinding, documentId, documentToken: "detail-token" } });
          }
          return { ok: true, state: "verified" };
        },
        scripting: {
          executeScript: async ({ func, args = [], target }) => {
            const boundDocument = target?.documentIds?.[0] ?? documentId;
            if (func === inspectFlowProjectVideosInPage) {
              if (boundDocument !== documentId) return [{ documentId: boundDocument, result: undefined }];
              pageReader ??= dom.window.eval(`(${inspectFlowProjectVideosInPage.toString()})`) as typeof pageReader;
              const input = args[0] as Record<string, unknown>;
              pageReads.push(String(input.action));
              if (input.action === "snapshot") {
                const render = (dom.window as unknown as { __renderGalleryWindow: (top: number) => Element[] }).__renderGalleryWindow;
                render(dom.window.document.querySelector("flow-project-page")!.scrollTop);
              }
              if (input.action === "open") openResults.push({ input, boundDocument });
              try {
                const result = await pageReader!(input);
                if (input.action === "restore") {
                  (dom.window as unknown as { __invalidateGalleryWindow: () => void }).__invalidateGalleryWindow();
                }
                if (input.action === "open") openResults.push(result);
                return [{ documentId: boundDocument, result }];
              } catch (error) {
                if (input.action === "open") openResults.push(String(error));
                throw error;
              }
            }
            const clipIndex = clips.findIndex((clip) => tabUrl.endsWith(clip));
            if (func === inspectCurrentFlowClipInPage) {
              detailIdentityReads.push("metadata");
              return [{ documentId: boundDocument, result: { projectId, clipId: clips[clipIndex], title: "Same title", thumbnail: { available: true, width: 320, height: 180 } } }];
            }
            if (func === prepareFlowClipDownloadInPage) {
              detailIdentityReads.push("selected_asset");
              return [{ documentId: boundDocument, result: { status: "identity", assetId: selectedAssets[clipIndex] } }];
            }
            return [];
          },
        },
        debugger: { attach: vi.fn(), sendCommand: vi.fn(), detach: vi.fn(), onEvent: { addListener: vi.fn(), removeListener: vi.fn() }, onDetach: { addListener: vi.fn(), removeListener: vi.fn() } },
        downloads: { onCreated: { addListener: vi.fn(), removeListener: vi.fn() }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
        storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
        alarms: {} as never,
        wait: async () => {
          now += 1;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        },
        now: () => now,
      });
      return {
        manager, repositories, pageReads, openResults, clickRoutes, detailIdentityReads, scrollIntoViewIndices,
        getDetailRevalidationAttempts: () => detailRevalidationAttempts,
        changeMedia(index: number, value: string) {
          mediaOverrides.set(index, value);
        },
      };
    },
    dispose() { dom.window.close(); },
  };
}

describe("Flow Gallery traversal production integration", () => {
  it("runs serialized production page reads through three same-title cards, persists each detail identity, restores, and reimports without duplicate rows", async () => {
    const harness = createTraversalHarness({ reorderAfterRestore: true, flowOrigin: true });
    const { manager, repositories, pageReads, openResults, clickRoutes } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }
    expect(progress, JSON.stringify({ progress, pageReads, openResults, clickRoutes })).toMatchObject({ status: "completed", discovered: 3, openAttempts: 3, imported: 3, alreadyPresent: 0, unresolved: 0, scanCompleteness: "complete" });
    expect(pageReads).toContain("restore");
    expect(pageReads.filter((action) => action === "open")).toHaveLength(3);
    const rows = await repositories.listFlowClipImports();
    expect(rows.map((row) => row.clipId)).toEqual(clips);
    expect(rows.map((row) => row.detailSelectedAssetId)).toEqual(selectedAssets);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows.every((row) => row.galleryImportMethod === "native_card_navigation" && row.galleryAssetId === undefined && row.galleryIdentityEvidence === undefined)).toBe(true);

    await manager.startProjectVideoImport();
    progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "completed", discovered: 3, imported: 0, alreadyPresent: 3, unresolved: 0, scanCompleteness: "complete" });
    expect(await repositories.listFlowClipImports()).toHaveLength(3);
    harness.dispose();
  }, 15_000);

  it("scrolls an offscreen exact Gallery card into view, reacquires its new owner, and opens it once", async () => {
    const harness = createTraversalHarness({ offscreenCardIndex: 2, flowOrigin: true });
    const { manager, repositories, pageReads, clickRoutes, scrollIntoViewIndices } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }

    expect(progress).toMatchObject({ status: "completed", discovered: 3, openAttempts: 3, imported: 3, alreadyPresent: 0, unresolved: 0, scanCompleteness: "complete" });
    expect(scrollIntoViewIndices).toEqual([2]);
    expect(pageReads.filter((action) => action === "open")).toHaveLength(3);
    expect(clickRoutes).toHaveLength(3);
    const rows = await repositories.listFlowClipImports();
    expect(rows.map((row) => row.clipId)).toEqual(clips);
    expect(rows.map((row) => row.detailSelectedAssetId)).toEqual(selectedAssets);
    harness.dispose();
  }, 15_000);

  it("reports an offscreen card that remains obscured without clicking it or losing partial counts", async () => {
    const harness = createTraversalHarness({ offscreenCardIndex: 2, obscureAfterScroll: true, flowOrigin: true });
    const { manager, repositories, clickRoutes, scrollIntoViewIndices } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }

    expect(progress).toMatchObject({ status: "incomplete", discovered: 3, openAttempts: 3, imported: 2, alreadyPresent: 0, unresolved: 1, scanCompleteness: "incomplete" });
    expect(progress.unresolvedCards.at(-1)).toMatchObject({ reason: "native_card_obscured" });
    expect(progress.imported + progress.alreadyPresent + progress.unresolved).toBe(3);
    expect(progress.discovered - progress.imported - progress.alreadyPresent - progress.unresolved).toBe(0);
    expect(scrollIntoViewIndices).toEqual([2]);
    expect(clickRoutes).toHaveLength(2);
    expect(await repositories.listFlowClipImports()).toHaveLength(2);
    harness.dispose();
  }, 15_000);

  it("reports an ambiguous exact-card reacquisition after scrolling without clicking either owner", async () => {
    const harness = createTraversalHarness({ offscreenCardIndex: 2, duplicateAfterScroll: true, flowOrigin: true });
    const { manager, repositories, clickRoutes, scrollIntoViewIndices } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }

    expect(progress).toMatchObject({ status: "incomplete", discovered: 3, openAttempts: 3, imported: 2, unresolved: 1, scanCompleteness: "incomplete" });
    expect(progress.unresolvedCards.at(-1)).toMatchObject({ reason: "native_card_reacquire_ambiguous" });
    expect(progress.imported + progress.alreadyPresent + progress.unresolved).toBe(3);
    expect(progress.discovered - progress.imported - progress.alreadyPresent - progress.unresolved).toBe(0);
    expect(scrollIntoViewIndices).toEqual([2]);
    expect(clickRoutes).toHaveLength(2);
    expect(await repositories.listFlowClipImports()).toHaveLength(2);
    harness.dispose();
  }, 15_000);

  it("retries detail connection failures until the same-project connector becomes ready", async () => {
    const harness = createTraversalHarness({ connectionFailuresBeforeReady: 2, flowOrigin: true });
    const { manager, repositories, pageReads, clickRoutes, detailIdentityReads, getDetailRevalidationAttempts } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }

    expect(progress).toMatchObject({ status: "completed", discovered: 3, openAttempts: 3, imported: 3, alreadyPresent: 0, unresolved: 0, scanCompleteness: "complete" });
    expect(getDetailRevalidationAttempts()).toBeGreaterThan(2);
    expect(pageReads.filter((action) => action === "open")).toHaveLength(3);
    expect(clickRoutes).toHaveLength(3);
    expect(detailIdentityReads).toContain("metadata");
    const rows = await repositories.listFlowClipImports();
    expect(rows.map((row) => row.clipId)).toEqual(clips);
    expect(rows.map((row) => row.detailSelectedAssetId)).toEqual(selectedAssets);
    harness.dispose();
  }, 15_000);

  it("reports the last connection failure without claiming clip identity or miscounting partial progress", async () => {
    const harness = createTraversalHarness({ connectionNeverReady: true, flowOrigin: true });
    const { manager, repositories, pageReads, detailIdentityReads } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }

    expect(progress, JSON.stringify(progress)).toMatchObject({ status: "incomplete", discovered: 3, openAttempts: 1, imported: 0, alreadyPresent: 0, unresolved: 1, scanCompleteness: "incomplete" });
    expect(progress.unresolvedCards[0]).toMatchObject({
      reason: "detail_connection_unavailable",
      connectionFailure: {
        phase: "before_identity_read",
        state: "temporarily-unreachable",
        stage: "handshake",
        reason: "connector_not_ready",
      },
    });
    expect(progress.imported + progress.alreadyPresent + progress.unresolved).toBe(1);
    expect(progress.discovered - progress.imported - progress.alreadyPresent - progress.unresolved).toBe(2);
    expect(pageReads.filter((action) => action === "open")).toHaveLength(1);
    expect(detailIdentityReads).toEqual([]);
    expect(await repositories.listFlowClipImports()).toHaveLength(0);
    harness.dispose();
  }, 15_000);

  it("distinguishes connection loss after the detail identity readers ran", async () => {
    const harness = createTraversalHarness({ connectionFailsAfterIdentity: true, flowOrigin: true });
    const { manager, detailIdentityReads } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }

    expect(progress).toMatchObject({ status: "incomplete", openAttempts: 1, imported: 0, unresolved: 1 });
    expect(progress.unresolvedCards[0]?.connectionFailure).toMatchObject({
      phase: "after_identity_read",
      state: "temporarily-unreachable",
      stage: "handshake_validation",
      reason: "connector_revalidation_lost",
    });
    expect(detailIdentityReads).toContain("metadata");
    harness.dispose();
  }, 15_000);

  it("cancels after the first durable row and leaves later candidates unprocessed", async () => {
    const harness = createTraversalHarness({ replaceDocumentOnRestore: false });
    const { manager, repositories } = await harness.setup();
    const originalUpsert = repositories.upsertFlowClipImport.bind(repositories);
    let cancelled = false;
    repositories.upsertFlowClipImport = async (...args) => {
      const saved = await originalUpsert(...args);
      if (!cancelled) {
        cancelled = true;
        await manager.cancelProjectVideoImport();
      }
      return saved;
    };
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "cancelled", discovered: 3, openAttempts: 1, imported: 1, unresolved: 0, scanCompleteness: "incomplete" });
    expect(await repositories.listFlowClipImports()).toHaveLength(1);
    harness.dispose();
  });

  it("stops with retained partial progress when a pending card changes after restoration", async () => {
    const harness = createTraversalHarness({ mutateAfterFirstRestore: true, flowOrigin: true });
    const { manager, repositories } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "incomplete", discovered: 3, openAttempts: 1, imported: 1, unresolved: 0, scanCompleteness: "incomplete" });
    expect(await repositories.listFlowClipImports()).toHaveLength(1);
    harness.dispose();
  });

  it("does not claim coverage when the final Gallery has the same count but different candidate keys", async () => {
    const harness = createTraversalHarness({ flowOrigin: true });
    const { manager, repositories, changeMedia } = await harness.setup();
    const originalUpsert = repositories.upsertFlowClipImport.bind(repositories);
    repositories.upsertFlowClipImport = async (...args) => {
      const saved = await originalUpsert(...args);
      if ((await repositories.listFlowClipImports()).length === 3)
        changeMedia(2, "new-final-card");
      return saved;
    };
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "incomplete", discovered: 3, imported: 3, unresolved: 0, scanCompleteness: "incomplete", reason: "coverage_unproven" });
    expect(await repositories.listFlowClipImports()).toHaveLength(3);
    harness.dispose();
  });

  it("counts indistinguishable owners separately and reports ambiguity without opening either", async () => {
    const harness = createTraversalHarness({ queryOnlyCollision: true, flowOrigin: true });
    const { manager, repositories, pageReads } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "incomplete", discovered: 2, imported: 0, unresolved: 2, scanCompleteness: "incomplete", reason: "ambiguous_identity" });
    expect(pageReads.filter((action) => action === "open")).toHaveLength(0);
    expect(JSON.stringify(progress)).not.toContain("query-secret");
    expect(await repositories.listFlowClipImports()).toHaveLength(0);
    harness.dispose();
  });

  it("opens the one-card owner in its current binding without requiring cross-navigation media evidence", async () => {
    const harness = createTraversalHarness({ replaceDocumentOnRestore: false, missingMedia: true });
    const { manager, pageReads, repositories } = await harness.setup();
    await manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }
    const openIndex = pageReads.indexOf("open");
    expect(progress).toMatchObject({ status: "completed", scope: "one_card_check", discovered: 1, openAttempts: 1, imported: 1, unresolved: 0, reason: "one_card_check_complete" });
    expect(pageReads.slice(0, openIndex)).toEqual(["start", "start", "snapshot"]);
    expect(await repositories.listFlowClipImports()).toHaveLength(1);
    harness.dispose();
  });

  it("reports shared same-origin placeholder paths as unusable without opening owners", async () => {
    const harness = createTraversalHarness({ flowOrigin: true, sharedPlaceholder: true });
    const { manager, pageReads } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "incomplete", discovered: 2, unresolved: 2, reason: "identity_deduplication_unavailable" });
    expect(progress.unresolvedCards.map((card) => card.reason)).toEqual(["native_media_path_unusable", "native_media_path_unusable"]);
    expect(pageReads.filter((action) => action === "open")).toHaveLength(0);
    harness.dispose();
  });

  it("reports absent media separately when native owner bindings are available", async () => {
    const harness = createTraversalHarness({ flowOrigin: true, missingMedia: true });
    const { manager, pageReads } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "incomplete", discovered: 2, unresolved: 2 });
    expect(progress.unresolvedCards.every((card) => card.reason === "native_media_absent")).toBe(true);
    expect(pageReads.filter((action) => action === "open")).toHaveLength(0);
    harness.dispose();
  });
});
