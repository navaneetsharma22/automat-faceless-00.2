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
} = {}) {
  const replaceDocumentOnRestore = options.replaceDocumentOnRestore ?? true;
  let now = 100;
  let documentId = "gallery-doc-1";
  let galleryDocumentVersion = 1;
  let restoreCount = 0;
  let tabUrl = `https://flow.google.com/project/${projectId}`;
  const mediaOverrides = new Map<number, string>();
  let dom = makeGalleryDom();
  const database = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(database, () => now);
  const pageReads: string[] = [];
  const openResults: unknown[] = [];
  const clickRoutes: string[] = [];
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
    const renderWindow = (top: number) => {
      const first = top >= 750 ? 2 : top >= 375 ? 1 : 0;
      const indices = [first];
      if (first < 2) indices.push(first + 1);
      if (options.reorderAfterRestore && restoreCount > 0) indices.reverse();
      gallery.innerHTML = indices.map((index) => `<flow-grid-tile-container role="group" aria-label="Same title" data-test-index="${index}">
        <flow-video-tile><video src="https://flow-content.google/video/${mediaOverrides.get(index) ?? `render-${options.ambiguousOwners && index < 2 ? 0 : index}`}"></video></flow-video-tile>
      </flow-grid-tile-container>`).join("");
      const owners = [...gallery.querySelectorAll("flow-grid-tile-container")];
      for (const owner of owners) {
        const index = Number(owner.getAttribute("data-test-index"));
        const left = index * 240;
        Object.defineProperty(owner, "getBoundingClientRect", { value: () => ({ x: left, y: 0, width: 200, height: 120, top: 0, right: left + 200, bottom: 120, left, toJSON: () => ({}) }) });
        owner.addEventListener("click", () => {
          const clipId = clips[Number(owner.getAttribute("data-test-index"))]!;
          tabUrl = `https://flow.google.com/project/${projectId}/edit/${clipId}`;
          clickRoutes.push(tabUrl);
        });
      }
      return owners;
    };
    Object.assign(page.window, { __renderGalleryWindow: renderWindow });
    renderWindow(0);
    Object.defineProperty(page.window.document, "elementFromPoint", {
      value: (x: number, y: number) => [...page.window.document.querySelectorAll("flow-grid-tile-container")].find((owner) => {
        const rect = owner.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      }),
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
                if (input.action === "open") openResults.push(result);
                return [{ documentId: boundDocument, result }];
              } catch (error) {
                if (input.action === "open") openResults.push(String(error));
                throw error;
              }
            }
            const clipIndex = clips.findIndex((clip) => tabUrl.endsWith(clip));
            if (func === inspectCurrentFlowClipInPage)
              return [{ documentId: boundDocument, result: { projectId, clipId: clips[clipIndex], title: "Same title", thumbnail: { available: true, width: 320, height: 180 } } }];
            if (func === prepareFlowClipDownloadInPage)
              return [{ documentId: boundDocument, result: { status: "identity", assetId: selectedAssets[clipIndex] } }];
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
        manager, repositories, pageReads, openResults, clickRoutes,
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
    const harness = createTraversalHarness({ reorderAfterRestore: true });
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
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);

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
    const harness = createTraversalHarness({ mutateAfterFirstRestore: true });
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
    const harness = createTraversalHarness();
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
    const harness = createTraversalHarness({ ambiguousOwners: true });
    const { manager, repositories, pageReads } = await harness.setup();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 1000; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "incomplete", discovered: 2, imported: 0, unresolved: 2, scanCompleteness: "incomplete", reason: "ambiguous_identity" });
    expect(pageReads.filter((action) => action === "open")).toHaveLength(0);
    expect(await repositories.listFlowClipImports()).toHaveLength(0);
    harness.dispose();
  });
});
