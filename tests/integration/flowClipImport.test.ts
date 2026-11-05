import { describe, expect, it, vi } from "vitest";
import { createFlowDownloadDiagnosticManager } from "../../src/background/flowDownloadDiagnostic";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { inspectFlowProjectVideosInPage } from "../../src/platforms/flow/projectVideos";
import { inspectCurrentFlowClipInPage } from "../../src/platforms/flow/clipImport";
import { prepareFlowClipDownloadInPage } from "../../src/platforms/flow/clipDownload";

const projectId = "project-test";
const firstClip = "11111111-2222-4333-8444-555555555555";
const secondClip = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const proofClip = "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa";
const otherImportedClip = "bbc2bc82-0000-4000-8000-000000000000";
const firstAsset = "11111111-2222-4333-8444-555555555555";
const secondAsset = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("verified Flow detail clip import", () => {
  it("imports two same-title detail routes separately and reimport updates the same row", async () => {
    let now = 10_000;
    let currentClipId = firstClip;
    let pageProjectId = projectId;
    const currentTabUrl = () =>
      `https://flow.google.com/project/${projectId}/edit/${currentClipId}?signature=private-token`;
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => now);
    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 7,
      canonicalTarget: `https://flow.google.com/project/${projectId}`,
      verification: "verified",
      connectionState: "verified",
      verificationBinding: {
        provider: "Flow",
        tabId: 7,
        canonicalTarget: `https://flow.google.com/project/${projectId}`,
        projectId,
        frameId: 0,
        documentId: "document-test",
        documentToken: "document-token",
        extensionBuildId: BUILD_ID,
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: BUILD_ID,
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: now,
      },
      updatedAt: now,
    });
    const manager = createFlowDownloadDiagnosticManager({
      extensionId: "extension-test",
      repositories,
      permissions: { contains: async () => true },
      tabs: {
        get: async (tabId) => ({
          id: tabId,
          title: "Flow project",
          url: currentTabUrl(),
        }),
      },
      scripting: {
        executeScript: async () => [
          {
            documentId: "document-test",
            result: {
              projectId: pageProjectId,
              clipId: currentClipId,
              title: "make it",
              thumbnail: {
                available: true,
                width: 1280,
                height: 720,
                fingerprint: "a".repeat(64),
              },
            },
          },
        ],
      },
      debugger: {
        attach: vi.fn(),
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
      alarms: {} as never,
      now: () => now,
    });

    const first = await manager.importCurrentClip();
    currentClipId = secondClip;
    now += 100;
    const second = await manager.importCurrentClip();
    currentClipId = firstClip;
    now += 100;
    const repeated = await manager.importCurrentClip();

    expect(first).toMatchObject({ status: "imported", reimported: false });
    expect(second).toMatchObject({ status: "imported", reimported: false });
    expect(repeated).toMatchObject({ status: "imported", reimported: true });
    const rows = await manager.listImportedClips();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.title, row.clipId])).toEqual([
      ["make it", firstClip],
      ["make it", secondClip],
    ]);
    expect(rows.map((row) => row.routeVerified)).toEqual([true, true]);
    expect(rows.map((row) => row.detailUrl)).toEqual([
      `https://flow.google.com/project/${projectId}/edit/${firstClip}`,
      `https://flow.google.com/project/${projectId}/edit/${secondClip}`,
    ]);
    expect(JSON.stringify(rows)).not.toContain("private-token");

    pageProjectId = "different-project";
    await expect(manager.importCurrentClip()).rejects.toThrow(
      "flow_clip_project_mismatch",
    );
    expect(await repositories.listFlowClipImports()).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it("visibly refuses import without a clip UUID on a project route", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database);
    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 7,
      canonicalTarget: `https://flow.google.com/project/${projectId}`,
      verification: "verified",
      connectionState: "verified",
      verificationBinding: {
        provider: "Flow",
        tabId: 7,
        canonicalTarget: `https://flow.google.com/project/${projectId}`,
        projectId,
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
      updatedAt: 1,
    });
    const manager = createFlowDownloadDiagnosticManager({
      extensionId: "extension-test",
      repositories,
      permissions: { contains: async () => true },
      tabs: {
        get: async (tabId) => ({
          id: tabId,
          title: "Flow project",
          url: `https://flow.google.com/project/${projectId}`,
        }),
      },
      scripting: { executeScript: vi.fn() },
      debugger: {
        attach: vi.fn(),
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
      alarms: {} as never,
    });
    await expect(manager.importCurrentClip()).rejects.toThrow(
      "flow_clip_detail_route_required",
    );
    expect(await repositories.listFlowClipImports()).toEqual([]);
  });

  it("rejects the other imported clip before inspection and only reads target controls", async () => {
    let now = 10_000;
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => now);
    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 7,
      canonicalTarget: `https://flow.google.com/project/${projectId}`,
      verification: "verified",
      connectionState: "verified",
      verificationBinding: {
        provider: "Flow",
        tabId: 7,
        canonicalTarget: `https://flow.google.com/project/${projectId}`,
        projectId,
        frameId: 0,
        documentId: "document-test",
        documentToken: "document-token",
        extensionBuildId: BUILD_ID,
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: BUILD_ID,
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: now,
      },
      updatedAt: now,
    });
    const first = await repositories.upsertFlowClipImport({
      projectId,
      clipId: proofClip,
      title: "make it",
      detailUrl: `https://flow.google.com/project/${projectId}/edit/${proofClip}`,
      thumbnail: { available: true, fingerprint: "a".repeat(64) },
    });
    const other = await repositories.upsertFlowClipImport({
      projectId,
      clipId: otherImportedClip,
      title: "make it",
      detailUrl: `https://flow.google.com/project/${projectId}/edit/${otherImportedClip}`,
      thumbnail: { available: true, fingerprint: "b".repeat(64) },
    });
    const executeScript = vi.fn(
      async ({ func }: { func: (...args: never[]) => unknown }) => [
        {
          documentId: "document-test",
          result:
            func ===
            (await import("../../src/platforms/flow/clipImport"))
              .inspectCurrentFlowClipInPage
              ? {
                  projectId,
                  clipId: proofClip,
                  title: "make it",
                  thumbnail: { available: true },
                }
              : {
                  status: "recognized",
                  menuBoundToDownloadMedia: true,
                  qualityOptionObserved: true,
                  qualityOptionEnabled: true,
                },
        },
      ],
    );
    const manager = createFlowDownloadDiagnosticManager({
      extensionId: "extension-test",
      repositories,
      permissions: { contains: async () => true },
      tabs: {
        get: async (tabId) => ({
          id: tabId,
          title: "Flow project",
          url: `https://flow.google.com/project/${projectId}/edit/${proofClip}`,
        }),
      },
      scripting: { executeScript: executeScript as never },
      debugger: {
        attach: vi.fn(),
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
      alarms: {} as never,
      now: () => now,
    });

    const rejectedOther = await manager.inspectClipDownloadProof(
      other.record.id,
    );
    expect(rejectedOther).toMatchObject({
      status: "blocked",
      blocker: "clip_not_in_single_row_scope",
      outputStatus: "unverified",
    });
    expect(executeScript).not.toHaveBeenCalled();
    await expect(
      manager.armClipDownloadProof(other.record.id),
    ).rejects.toThrow("flow_clip_not_in_single_row_scope");
    expect(executeScript).not.toHaveBeenCalled();

    const target = await manager.inspectClipDownloadProof(first.record.id);
    expect(target).toMatchObject({
      status: "menu_recognized",
      routeStatus: "matched",
      menuRecognitionStatus: "recognized",
      qualityOptionStatus: "visible_enabled",
      outputStatus: "unverified",
    });
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(JSON.stringify({ rejectedOther, target })).not.toContain(proofClip);
    expect(JSON.stringify({ rejectedOther, target })).not.toContain(
      otherImportedClip,
    );
    now += 1;
  });
});

function projectVideoCard(assetId: string, clipId: string, title = "Same title", routeStatus = "unique") {
  return {
    observationFingerprint: assetId.replaceAll("-", "").padEnd(64, "a").slice(0, 64),
    assetId,
    assetStatus: "unique" as const,
    title,
    thumbnail: { available: true, width: 320, height: 180, fingerprint: "f".repeat(64) },
    routeStatus: routeStatus as "unique" | "none",
    ...(routeStatus === "unique"
      ? { detailRoute: { projectId, clipId, detailUrl: `https://flow.google.com/project/${projectId}/edit/${clipId}` } }
      : {}),
  };
}

async function makeProjectVideoImportManager(options: {
  snapshots?: Array<ReturnType<typeof projectVideoCard>[]>;
  selectedAssetId?: string;
  lazy?: boolean;
  cardsCapped?: boolean;
  preflightRejection?: "project_missing" | "videos_section_not_selected";
  wait?: (milliseconds: number) => Promise<void>;
} = {}) {
  let now = 20_000;
  let tabUrl = `https://flow.google.com/project/${projectId}`;
  const database = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(database, () => now);
  await database.selectedTargets.put({
    provider: "Flow",
    tabId: 7,
    canonicalTarget: `https://flow.google.com/project/${projectId}`,
    verification: "verified",
    connectionState: "verified",
    verificationBinding: {
      provider: "Flow",
      tabId: 7,
      canonicalTarget: `https://flow.google.com/project/${projectId}`,
      projectId,
      frameId: 0,
      documentId: "document-test",
      documentToken: "document-token",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: 1,
      capability: "read-only-connection-v1",
      verifiedAt: now,
    },
    updatedAt: now,
  });
  const first = projectVideoCard(firstAsset, firstClip);
  const second = projectVideoCard(secondAsset, secondClip);
  const snapshots = options.snapshots ?? [[first, second]];
  let snapshotIndex = 0;
  let rejectPreflight = Boolean(options.preflightRejection);
  const executeScript = vi.fn(async (input: { func: (...args: never[]) => unknown; args: unknown[] }) => {
    let result: unknown;
    if (input.func === inspectFlowProjectVideosInPage) {
      const action = (input.args[0] as { action: string }).action;
      if (action === "open") {
        const card = first;
        result = { status: "opened", projectId, cards: [card], cardsCapped: false, scroll: { containerFound: true, top: 0, max: 0, moved: false, atBottom: true, busy: false }, card };
        tabUrl = `https://flow.google.com/project/${projectId}/edit/${firstClip}`;
      } else {
        if (action === "snapshot" && rejectPreflight) {
          rejectPreflight = false;
          result = { status: "blocked", reason: options.preflightRejection, projectId, cards: [], cardsCapped: false, scroll: { containerFound: false, top: 0, max: 0, moved: false, atBottom: false, busy: false } };
          return [{ documentId: "document-test", result }];
        }
        if (action === "scroll") snapshotIndex = Math.min(snapshotIndex + 1, snapshots.length - 1);
        const cards = snapshots[snapshotIndex] ?? [];
        const max = options.lazy && snapshotIndex === 0 ? 100 : 0;
        const top = options.lazy && snapshotIndex > 0 ? 100 : 0;
        result = { status: "ready", projectId, cards, cardsCapped: options.cardsCapped ?? false, scroll: { containerFound: true, top, max, moved: action === "scroll", atBottom: top >= max, busy: false } };
      }
    } else if (input.func === inspectCurrentFlowClipInPage) {
      result = { projectId, clipId: firstClip, title: "Same title", thumbnail: { available: true, width: 320, height: 180 } };
    } else if (input.func === prepareFlowClipDownloadInPage) {
      result = { status: "identity", assetId: options.selectedAssetId ?? secondAsset };
    }
    return [{ documentId: "document-test", result }];
  });
  const manager = createFlowDownloadDiagnosticManager({
    extensionId: "extension-test",
    repositories,
    permissions: { contains: async () => true },
    tabs: {
      get: async (tabId) => ({ id: tabId, title: "Flow project", url: tabUrl }),
      update: async (_tabId, properties) => { tabUrl = properties.url; return { id: 7, url: tabUrl }; },
    },
    revalidateFlowConnection: async () => ({ ok: true, state: "verified" }),
    scripting: { executeScript },
    debugger: {
      attach: vi.fn(), sendCommand: vi.fn(), detach: vi.fn(),
      onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
      onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    downloads: {
      onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    alarms: {} as never,
    wait: options.wait ?? (async () => undefined),
    now: () => now++,
  });
  return { manager, repositories, executeScript };
}

describe("Flow Videos Gallery import", () => {
  it("retains the exact bounded preflight rejection, terminates, and allows a fresh scan", async () => {
    const { manager } = await makeProjectVideoImportManager({
      preflightRejection: "videos_section_not_selected",
    });
    const failed = await manager.startProjectVideoImport();
    expect(failed).toMatchObject({
      status: "failed",
      discovered: 0,
      imported: 0,
      alreadyPresent: 0,
      unresolved: 0,
      scanCompleteness: "incomplete",
      failureReason: "videos_section_not_selected",
    });
    expect((await manager.getProjectVideoImport()).status).toBe("failed");

    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 100; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "completed", scanCompleteness: "complete" });
  });

  it("imports same-title clips as separate rows and reimport updates without duplicates", async () => {
    const { manager, repositories } = await makeProjectVideoImportManager();
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 100; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "completed", discovered: 2, imported: 2, alreadyPresent: 0, unresolved: 0, scanCompleteness: "complete" });
    const rows = await manager.listImportedClips();
    expect(rows.map((row) => [row.title, row.clipId, row.galleryAssetId])).toEqual([
      ["Same title", firstClip, firstAsset],
      ["Same title", secondClip, secondAsset],
    ]);
    await manager.startProjectVideoImport();
    progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 100; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ imported: 0, alreadyPresent: 2 });
    expect(await repositories.listFlowClipImports()).toHaveLength(2);
  });

  it("discovers a lazily loaded card after an incremental scroll", async () => {
    const { manager } = await makeProjectVideoImportManager({
      snapshots: [[projectVideoCard(firstAsset, firstClip)], [projectVideoCard(secondAsset, secondClip)]],
      lazy: true,
    });
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 100; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ discovered: 2, imported: 2, scanCompleteness: "complete" });
  });

  it("rejects a source-card to selected-detail-asset mismatch", async () => {
    const card = projectVideoCard(firstAsset, firstClip, "Same title", "none");
    const { manager, repositories } = await makeProjectVideoImportManager({ snapshots: [[card]], selectedAssetId: secondAsset });
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 100; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "completed", scanCompleteness: "complete", unresolved: 1 });
    expect(progress.unresolvedCards).toContainEqual({ title: "Same title", reason: "detail_asset_identity_mismatch" });
    expect(await repositories.listFlowClipImports()).toHaveLength(0);
  });

  it("cancels a bounded scan and reports incomplete coverage", async () => {
    let releaseWait: (() => void) | undefined;
    const wait = () => new Promise<void>((resolve) => { releaseWait = resolve; });
    const { manager } = await makeProjectVideoImportManager({ wait });
    await manager.startProjectVideoImport();
    const cancelled = await manager.cancelProjectVideoImport();
    expect(cancelled.cancelRequested).toBe(true);
    releaseWait?.();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 100; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "cancelled", scanCompleteness: "incomplete", reason: "cancelled" });
  });

  it("reports an incomplete scan when the card cap is reached", async () => {
    const { manager } = await makeProjectVideoImportManager({ cardsCapped: true });
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 100; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "incomplete", scanCompleteness: "incomplete", reason: "bound_reached" });
  });
});
