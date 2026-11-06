import { describe, expect, it, vi } from "vitest";
import { createFlowDownloadDiagnosticManager } from "../../src/background/flowDownloadDiagnostic";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { inspectFlowProjectVideosInPage, type FlowProjectVideoCard } from "../../src/platforms/flow/projectVideos";
import { inspectCurrentFlowClipInPage } from "../../src/platforms/flow/clipImport";
import { prepareFlowClipDownloadInPage } from "../../src/platforms/flow/clipDownload";

const projectId = "project-test";
const firstClip = "11111111-2222-4333-8444-555555555555";
const secondClip = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const proofClip = "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa";
const otherImportedClip = "bbc2bc82-0000-4000-8000-000000000000";
const firstAsset = "11111111-2222-4333-8444-555555555555";
const secondAsset = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const liveNativeMappings = [
  {
    token: "10000000-0000-4000-8000-000000000001",
    clipId: "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa",
    selectedAssetId: "d8d91f05-e14d-4e15-964f-104981510af6",
  },
  {
    token: "10000000-0000-4000-8000-000000000002",
    clipId: "bbc2bc82-eccc-4cbe-b3bd-2c8ee2fbd7fa",
    selectedAssetId: "5a796d9e-5c1a-414a-a961-ed77e35c78a3",
  },
];

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

function projectVideoCard(assetId: string, clipId: string, title = "Same title", routeStatus = "unique"): FlowProjectVideoCard {
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

function unresolvedProjectVideoCard(
  title: string,
  nativeCardToken?: string,
): FlowProjectVideoCard {
  return {
    title,
    ...(nativeCardToken ? { nativeCardToken } : {}),
    ...(nativeCardToken ? { observationFingerprint: nativeCardToken.replaceAll("-", "").padEnd(64, "a").slice(0, 64) } : {}),
    assetStatus: "missing",
    thumbnail: { available: false },
    routeStatus: "none",
  };
}

async function makeProjectVideoImportManager(options: {
  snapshots?: Array<ReturnType<typeof projectVideoCard>[]>;
  selectedAssetId?: string;
  lazy?: boolean;
  cardsCapped?: boolean;
  preflightRejection?: "project_missing" | "videos_section_not_selected";
  nativeMappings?: Array<typeof liveNativeMappings[number]>;
  nativeWrongProject?: boolean;
  nativeSelectionAmbiguous?: boolean;
  nativeReacquireFailsFor?: string;
  rerenderCards?: boolean;
  recreateNativeDom?: boolean;
  reorderNativeCardsOnRestore?: boolean;
  initialVideosSelected?: boolean;
  nativeRouteDelayReads?: number;
  nativeRouteTransition?: "spa" | "replacement";
  nativeOpenResult?: "missing" | "malformed";
  nativeStaleDetailResultCount?: number;
  nativeMetadataOutcome?: "throw" | "missing" | "malformed" | "route_mismatch";
  nativeAssetOutcome?: "throw" | "missing" | "malformed" | "rail_missing" | "rail_ambiguous" | "thumbnail_missing" | "thumbnail_ambiguous" | "asset_id_missing" | "asset_id_ambiguous" | "source_invalid";
  nativeAssetUnavailableReads?: number;
  nativeConnectionPendingChecks?: number;
  restoreLoadingReads?: number;
  restoreConnectionPendingChecks?: number;
  restoreWrongProject?: boolean;
  restoreNeverCompletes?: boolean;
  cancelDuringRestore?: boolean;
  wait?: (milliseconds: number) => Promise<void>;
} = {}) {
  let now = 20_000;
  let tabUrl = `https://flow.google.com/project/${projectId}`;
  let pendingNativeUrl: string | undefined;
  let currentDocumentId = "document-test";
  let routeReadsWhilePending = 0;
  let pendingConnectionChecks = 0;
  let nativeOpenAttempts = 0;
  let nativeStaleDetailResultCount = options.nativeStaleDetailResultCount ?? 0;
  let nativeAssetUnavailableReads = options.nativeAssetUnavailableReads ?? 0;
  let replacementConnectionObserved = false;
  let restoreLoadingReads = 0;
  let projectRootNavigations = 0;
  let restoreConnectionChecks = 0;
  let restoreConnectionRecovered = false;
  let cancelAfterRestore = false;
  const managerRef: { current?: ReturnType<typeof createFlowDownloadDiagnosticManager> } = {};
  const detailInjectionDocumentIds: string[] = [];
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
  let activeNativeMapping: (typeof liveNativeMappings)[number] | undefined;
  let nativeBindingGeneration = 0;
  let nativeCardsReordered = false;
  let latestGalleryCards: FlowProjectVideoCard[] = snapshots[0] ?? [];
  let rejectPreflight = Boolean(options.preflightRejection);
  let videosSelected = options.initialVideosSelected ?? true;
  const galleryActions: string[] = [];
  const executeScript = vi.fn(async (input: { func: (...args: never[]) => unknown; args: unknown[]; target?: { documentIds?: string[] } }) => {
    let result: unknown;
    if (input.func === inspectFlowProjectVideosInPage) {
      const action = (input.args[0] as { action: string }).action;
      galleryActions.push(action);
      if ((action === "start" || action === "restore") && !videosSelected) {
        videosSelected = true;
        galleryActions.push("select-videos");
      }
      if (action === "open") {
        if ((input.args[0] as { nativeCardToken?: string }).nativeCardToken)
          nativeOpenAttempts += 1;
        const nativeCardToken = (input.args[0] as { nativeCardToken?: string }).nativeCardToken;
        const pageCards = latestGalleryCards;
        const card = nativeCardToken
          ? pageCards.find((candidate) => candidate.nativeCardToken === nativeCardToken) ?? unresolvedProjectVideoCard("make it", nativeCardToken)
          : undefined;
        if (nativeCardToken && nativeCardToken === options.nativeReacquireFailsFor) {
          result = { status: "blocked", reason: "native_binding_stale", projectId, cards: [], cardsCapped: false, scroll: { containerFound: true, top: 0, max: 0, moved: false, atBottom: true, busy: false } };
          return [{ documentId: "document-test", result }];
        }
        if (nativeCardToken) {
          const origin = options.nativeMappings?.find((mapping) => snapshots.flat().some((original) => original.nativeCardToken === mapping.token && original.observationFingerprint === card?.observationFingerprint));
          activeNativeMapping = origin;
          const routeProject = options.nativeWrongProject ? "other-project" : projectId;
          const destination = `https://flow.google.com/project/${routeProject}/edit/${activeNativeMapping?.clipId ?? firstClip}`;
          if (options.nativeRouteDelayReads) {
            pendingNativeUrl = destination;
            routeReadsWhilePending = 0;
          } else {
            tabUrl = destination;
          }
          videosSelected = false;
          result = { status: "opened", projectId, cards: [card!], cardsCapped: false, scroll: { containerFound: true, top: 0, max: 0, moved: false, atBottom: true, busy: false }, card };
          if (options.nativeOpenResult === "missing") return [];
          if (options.nativeOpenResult === "malformed")
            return [{ documentId: "document-test", result: { status: "opened" } }];
        } else {
          const card = first;
          result = { status: "opened", projectId, cards: [card], cardsCapped: false, scroll: { containerFound: true, top: 0, max: 0, moved: false, atBottom: true, busy: false }, card };
          tabUrl = `https://flow.google.com/project/${projectId}/edit/${firstClip}`;
        }
      } else {
        if (action === "start") snapshotIndex = 0;
        if (action === "snapshot" && !videosSelected) {
          result = { status: "blocked", reason: "videos_section_not_selected", projectId, cards: [], cardsCapped: false, scroll: { containerFound: false, top: 0, max: 0, moved: false, atBottom: false, busy: false } };
          return [{ documentId: "document-test", result }];
        }
        if ((action === "start" || action === "snapshot") && rejectPreflight) {
          rejectPreflight = false;
          result = { status: "blocked", reason: options.preflightRejection, projectId, cards: [], cardsCapped: false, scroll: { containerFound: false, top: 0, max: 0, moved: false, atBottom: false, busy: false } };
          return [{ documentId: "document-test", result }];
        }
        if (action === "scroll") snapshotIndex = Math.min(snapshotIndex + 1, snapshots.length - 1);
        if (action === "restore" && options.reorderNativeCardsOnRestore && !nativeCardsReordered) nativeCardsReordered = true;
        if (action === "restore" && options.recreateNativeDom) nativeBindingGeneration += 1;
        const sourceCardsBase = snapshots[snapshotIndex] ?? [];
        const sourceCards = nativeCardsReordered ? [...sourceCardsBase].reverse() : sourceCardsBase;
        const maxCards = (input.args[0] as { maxCards?: number }).maxCards;
        const cards = (maxCards === 1 ? sourceCards.slice(0, 1) : sourceCards).map((card, cardIndex) => {
          if (
            options.nativeReacquireFailsFor &&
            activeNativeMapping?.token === options.nativeReacquireFailsFor &&
            !/\/edit\//i.test(tabUrl) &&
            card.nativeCardToken === options.nativeReacquireFailsFor
          )
            return { ...card, nativeCardToken: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
          if (options.recreateNativeDom && nativeBindingGeneration > 0 && card.nativeCardToken) {
            const suffix = `${String(nativeBindingGeneration).padStart(4, "0")}${String(cardIndex + 1).padStart(8, "0")}`;
            return { ...card, nativeCardToken: `90000000-0000-4000-8000-${suffix}` };
          }
          return options.rerenderCards ? { ...card } : card;
        });
        latestGalleryCards = cards as FlowProjectVideoCard[];
        const max = options.lazy && snapshotIndex === 0 ? 100 : 0;
        const requestedTop = (input.args[0] as { scrollTop?: number }).scrollTop;
        const top = action === "restore" ? requestedTop ?? 0 : options.lazy && snapshotIndex > 0 ? 100 : 0;
        result = { status: "ready", projectId, cards, cardsCapped: options.cardsCapped ?? false, scroll: { containerFound: true, top, max, moved: action === "scroll", atBottom: top >= max, busy: false } };
      }
    } else if (input.func === inspectCurrentFlowClipInPage) {
      if (/\/edit\//i.test(tabUrl)) detailInjectionDocumentIds.push(input.target?.documentIds?.[0] ?? "missing-document");
      if (/\/edit\//i.test(tabUrl) && options.nativeMetadataOutcome === "throw") throw new Error("injected metadata reader failed");
      const clipId = /\/edit\/([0-9a-f-]{36})/i.exec(tabUrl)?.[1] ?? firstClip;
      result = options.nativeMetadataOutcome === "malformed"
        ? { clipId }
        : { projectId: options.nativeMetadataOutcome === "route_mismatch" ? "other-project" : projectId, clipId, title: "make it", thumbnail: { available: true, width: 320, height: 180 } };
      if (/\/edit\//i.test(tabUrl) && options.nativeMetadataOutcome === "missing") return [];
      if (/\/edit\//i.test(tabUrl) && nativeStaleDetailResultCount > 0) {
        nativeStaleDetailResultCount -= 1;
        return [{ documentId: "stale-detail-document", result }];
      }
    } else if (input.func === prepareFlowClipDownloadInPage) {
      if (/\/edit\//i.test(tabUrl)) detailInjectionDocumentIds.push(input.target?.documentIds?.[0] ?? "missing-document");
      if (/\/edit\//i.test(tabUrl) && options.nativeAssetOutcome === "throw") throw new Error("injected asset reader failed");
      result = options.nativeSelectionAmbiguous && activeNativeMapping
        ? { status: "blocked", reason: "flow_clip_selected_rail_ambiguous" }
        : { status: "identity", assetId: activeNativeMapping?.selectedAssetId ?? options.selectedAssetId ?? secondAsset };
      const assetFailureReasons = {
        rail_missing: "flow_clip_selected_rail_missing",
        rail_ambiguous: "flow_clip_selected_rail_ambiguous",
        thumbnail_missing: "flow_clip_selected_thumbnail_missing",
        thumbnail_ambiguous: "flow_clip_selected_thumbnail_ambiguous",
        asset_id_missing: "flow_clip_selected_asset_id_missing",
        asset_id_ambiguous: "flow_clip_selected_asset_id_ambiguous",
        source_invalid: "flow_clip_selected_asset_source_invalid",
      } as const;
      if (options.nativeAssetOutcome && options.nativeAssetOutcome in assetFailureReasons)
        result = { status: "blocked", reason: assetFailureReasons[options.nativeAssetOutcome as keyof typeof assetFailureReasons] };
      if (nativeAssetUnavailableReads > 0) {
        nativeAssetUnavailableReads -= 1;
        result = { status: "blocked", reason: "flow_clip_selected_rail_missing" };
      }
      if (/\/edit\//i.test(tabUrl) && options.nativeAssetOutcome === "missing") return [];
      if (/\/edit\//i.test(tabUrl) && options.nativeAssetOutcome === "malformed") result = { status: "identity", asset: "invalid" };
      if (/\/edit\//i.test(tabUrl) && nativeStaleDetailResultCount > 0) {
        nativeStaleDetailResultCount -= 1;
        return [{ documentId: "stale-detail-document", result }];
      }
    }
    return [{ documentId: input.target?.documentIds?.[0] ?? currentDocumentId, result }];
  });
  const manager = createFlowDownloadDiagnosticManager({
    extensionId: "extension-test",
    repositories,
    permissions: { contains: async () => true },
    tabs: {
      get: async (tabId) => {
        if (pendingNativeUrl) {
          routeReadsWhilePending += 1;
          if (routeReadsWhilePending >= (options.nativeRouteDelayReads ?? 1)) {
            tabUrl = pendingNativeUrl;
            pendingNativeUrl = undefined;
            if (options.nativeRouteDelayReads && options.nativeRouteTransition !== "spa") currentDocumentId = "detail-document-replaced";
          }
        }
        const status = options.restoreNeverCompletes && restoreLoadingReads > 0
          ? "loading"
          : restoreLoadingReads > 0
            ? (restoreLoadingReads--, "loading")
            : "complete";
        if (
          !restoreConnectionRecovered &&
          !/\/edit\//i.test(tabUrl) &&
          status === "complete" &&
          restoreConnectionChecks >= (options.restoreConnectionPendingChecks ?? 0) &&
          options.restoreConnectionPendingChecks
        ) {
          const selected = await database.selectedTargets.get("Flow");
          if (selected?.verificationBinding) {
            await database.selectedTargets.put({
              ...selected,
              verification: "verified",
              connectionState: "verified",
              verificationBinding: {
                ...selected.verificationBinding,
                documentId: currentDocumentId,
                documentToken: "gallery-document-token",
              },
              updatedAt: now,
            });
            restoreConnectionRecovered = true;
          }
        }
        return { id: tabId, title: "Flow project", url: tabUrl, status };
      },
      update: async (_tabId, properties) => {
        projectRootNavigations += 1;
        tabUrl = options.restoreWrongProject
          ? `https://flow.google.com/project/other-project`
          : properties.url;
        pendingNativeUrl = undefined;
        if (options.nativeRouteDelayReads) currentDocumentId = "gallery-document-restored";
        restoreLoadingReads = options.restoreNeverCompletes
          ? Number.MAX_SAFE_INTEGER
          : options.restoreLoadingReads ?? 0;
        if (options.cancelDuringRestore) cancelAfterRestore = true;
        videosSelected = false;
        return { id: 7, url: tabUrl };
      },
    },
    revalidateFlowConnection: async () => {
      if (/\/edit\//i.test(tabUrl) && options.nativeConnectionPendingChecks && !replacementConnectionObserved) {
        pendingConnectionChecks += 1;
        if (pendingConnectionChecks <= options.nativeConnectionPendingChecks)
          return { ok: false, state: "temporarily-unreachable" };
        const selected = await database.selectedTargets.get("Flow");
        if (selected?.verificationBinding) {
          await database.selectedTargets.put({
            ...selected,
            verificationBinding: { ...selected.verificationBinding, documentId: currentDocumentId, documentToken: "detail-document-token" },
            updatedAt: now,
          });
        }
        replacementConnectionObserved = true;
      } else if (!/\/edit\//i.test(tabUrl)) {
        if (restoreConnectionChecks < (options.restoreConnectionPendingChecks ?? 0)) {
          restoreConnectionChecks += 1;
          return { ok: false, state: "temporarily-unreachable" };
        }
        const selected = await database.selectedTargets.get("Flow");
        if (selected?.verificationBinding && selected.verificationBinding.documentId !== currentDocumentId) {
          await database.selectedTargets.put({
            ...selected,
            verificationBinding: { ...selected.verificationBinding, documentId: currentDocumentId, documentToken: "gallery-document-token" },
            updatedAt: now,
          });
        }
      }
      return { ok: true, state: "verified" };
    },
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
    wait: options.wait ?? (async () => {
      if (cancelAfterRestore && managerRef.current) {
        cancelAfterRestore = false;
        await managerRef.current.cancelProjectVideoImport();
      }
    }),
    now: () => now++,
  });
  managerRef.current = manager;
  return {
    manager, repositories, executeScript, galleryActions,
    getTabUrl: () => tabUrl,
    getRouteReadsWhilePending: () => routeReadsWhilePending,
    getPendingConnectionChecks: () => pendingConnectionChecks,
    getNativeOpenAttempts: () => nativeOpenAttempts,
    getReplacementConnectionObserved: () => replacementConnectionObserved,
    getDetailInjectionDocumentIds: () => detailInjectionDocumentIds,
    getProjectRootNavigations: () => projectRootNavigations,
    getRestoreConnectionChecks: () => restoreConnectionChecks,
  };
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

  it("counts separate unresolved cards without collapsing missing identities", async () => {
    const { manager } = await makeProjectVideoImportManager({
      snapshots: [[
        unresolvedProjectVideoCard("Untitled video"),
        unresolvedProjectVideoCard("Untitled video"),
      ]],
    });
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 100; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      status: "incomplete",
      discovered: 2,
      imported: 0,
      alreadyPresent: 0,
      unresolved: 2,
      scanCompleteness: "incomplete",
      reason: "identity_deduplication_unavailable",
    });
  });

  it("imports same-title native cards by verified detail route and selected asset, then reimports by route key", async () => {
    const cards = liveNativeMappings.map((mapping) =>
      unresolvedProjectVideoCard("make it", mapping.token),
    );
    const { manager, repositories, galleryActions } = await makeProjectVideoImportManager({
      snapshots: [cards],
      nativeMappings: liveNativeMappings,
      rerenderCards: true,
      initialVideosSelected: false,
    });
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      status: "completed",
      discovered: 2,
      imported: 2,
      alreadyPresent: 0,
      unresolved: 0,
      scanCompleteness: "complete",
    });
    const rows = await repositories.listFlowClipImports();
    expect(rows.map((row) => [row.title, row.clipId, row.detailSelectedAssetId])).toEqual([
      ["make it", liveNativeMappings[0]!.clipId, liveNativeMappings[0]!.selectedAssetId],
      ["make it", liveNativeMappings[1]!.clipId, liveNativeMappings[1]!.selectedAssetId],
    ]);
    expect(rows.every((row) =>
      row.galleryImportMethod === "native_card_navigation" &&
      row.galleryAssetId === undefined &&
      row.galleryIdentityEvidence === undefined,
    )).toBe(true);
    const firstOpen = galleryActions.indexOf("open");
    const returnedRestore = galleryActions.indexOf("restore", firstOpen + 1);
    expect(galleryActions.slice(0, 4)).toEqual(["start", "select-videos", "start", "snapshot"]);
    expect(galleryActions.slice(returnedRestore, returnedRestore + 3)).toEqual([
      "restore",
      "select-videos",
      "snapshot",
    ]);
    expect(galleryActions.slice(returnedRestore + 3)).toContain("open");

    await manager.startProjectVideoImport();
    progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 200; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ imported: 0, alreadyPresent: 2, unresolved: 0 });
    expect(await repositories.listFlowClipImports()).toHaveLength(2);
  });

  it("rebinds each next native card after replacement-document restoration and Gallery reordering", async () => {
    const mappings = [
      ...liveNativeMappings,
      {
        token: "10000000-0000-4000-8000-000000000003",
        clipId: "33333333-4444-4555-8666-777777777777",
        selectedAssetId: "dddddddd-eeee-4fff-8000-111111111111",
      },
    ];
    const cards = mappings.map((mapping) => unresolvedProjectVideoCard("Same title", mapping.token));
    const setup = await makeProjectVideoImportManager({
      snapshots: [cards],
      nativeMappings: mappings,
      recreateNativeDom: true,
      reorderNativeCardsOnRestore: true,
      nativeRouteTransition: "replacement",
      nativeRouteDelayReads: 1,
    });
    await setup.manager.startProjectVideoImport();
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "completed", discovered: 3, imported: 3, alreadyPresent: 0, unresolved: 0, scanCompleteness: "complete" });
    expect((await setup.repositories.listFlowClipImports()).map((row) => row.clipId).sort()).toEqual(mappings.map((mapping) => mapping.clipId).sort());
    expect(setup.galleryActions.filter((action) => action === "open")).toHaveLength(3);

    await setup.manager.startProjectVideoImport();
    progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "completed", discovered: 3, imported: 0, alreadyPresent: 3, unresolved: 0, scanCompleteness: "complete" });
    expect(await setup.repositories.listFlowClipImports()).toHaveLength(3);
  });

  it("checks at most one production-importer card and terminates without claiming Gallery coverage", async () => {
    const cards = liveNativeMappings.map((mapping) =>
      unresolvedProjectVideoCard("make it", mapping.token),
    );
    const setup = await makeProjectVideoImportManager({
      snapshots: [cards],
      nativeMappings: liveNativeMappings,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      scope: "one_card_check",
      status: "completed",
      discovered: 1,
      imported: 1,
      alreadyPresent: 0,
      unresolved: 0,
      scanCompleteness: "incomplete",
      reason: "one_card_check_complete",
    });
    expect(setup.getTabUrl()).toBe(`https://flow.google.com/project/${projectId}`);
    expect(setup.galleryActions.filter((action) => action === "open")).toHaveLength(1);
    const firstRow = (await setup.repositories.listFlowClipImports())[0];
    expect(firstRow?.clipId).toBe(liveNativeMappings[0]!.clipId);

    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      scope: "one_card_check",
      status: "completed",
      discovered: 1,
      imported: 0,
      alreadyPresent: 1,
      unresolved: 0,
      scanCompleteness: "incomplete",
      reason: "one_card_check_complete",
    });
    expect(await setup.repositories.listFlowClipImports()).toHaveLength(1);
    expect(setup.galleryActions.filter((action) => action === "open")).toHaveLength(2);
  });

  it("waits for a delayed detail route and replacement connection before reading identity", async () => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 3,
      nativeConnectionPendingChecks: 2,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      scope: "one_card_check",
      status: "completed",
      discovered: 1,
      imported: 1,
      alreadyPresent: 0,
      unresolved: 0,
      scanCompleteness: "incomplete",
      reason: "one_card_check_complete",
    });
    expect(setup.getRouteReadsWhilePending()).toBeGreaterThanOrEqual(3);
    expect(setup.getPendingConnectionChecks()).toBeGreaterThanOrEqual(3);
    expect(setup.getReplacementConnectionObserved()).toBe(true);
    expect(setup.getDetailInjectionDocumentIds().length).toBeGreaterThanOrEqual(2);
    expect(setup.getDetailInjectionDocumentIds().every((id) => id === "detail-document-replaced")).toBe(true);
    expect(await setup.repositories.listFlowClipImports()).toMatchObject([
      {
        projectId,
        clipId: liveNativeMappings[0]!.clipId,
        detailSelectedAssetId: liveNativeMappings[0]!.selectedAssetId,
        galleryImportMethod: "native_card_navigation",
      },
    ]);
  });

  it("waits through project loading and temporary connection loss, then restores Videos and retains identity", async () => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 3,
      restoreLoadingReads: 2,
      restoreConnectionPendingChecks: 1,
      initialVideosSelected: false,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      status: "completed",
      imported: 1,
      alreadyPresent: 0,
      unresolved: 0,
      reason: "one_card_check_complete",
    });
    expect(setup.getTabUrl()).toBe(`https://flow.google.com/project/${projectId}`);
    expect(setup.getProjectRootNavigations()).toBe(1);
    expect(setup.getRestoreConnectionChecks()).toBe(1);
    const restoreIndex = setup.galleryActions.lastIndexOf("restore");
    expect(setup.galleryActions.slice(restoreIndex, restoreIndex + 3)).toEqual([
      "restore", "select-videos", "snapshot",
    ]);
    expect(await setup.repositories.listFlowClipImports()).toMatchObject([{
      clipId: liveNativeMappings[0]!.clipId,
      detailSelectedAssetId: liveNativeMappings[0]!.selectedAssetId,
      galleryImportMethod: "native_card_navigation",
    }]);
  });

  it("keeps a fully verified row when Gallery restore times out", async () => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 2,
      restoreNeverCompletes: true,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      status: "incomplete",
      imported: 1,
      unresolved: 0,
      reason: "gallery_restore_failed",
      restorationWarning: "gallery_restore_failed",
    });
    expect(await setup.repositories.listFlowClipImports()).toHaveLength(1);
  });

  it("preserves verified identity when restoration discovers a different project", async () => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 2,
      restoreWrongProject: true,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      status: "failed",
      imported: 1,
      unresolved: 0,
      reason: "navigation_changed",
      restorationWarning: "navigation_changed",
    });
    expect(await setup.repositories.listFlowClipImports()).toHaveLength(1);
  });

  it("retains captured identity if the user cancels during Gallery restoration", async () => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 2,
      cancelDuringRestore: true,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      status: "cancelled",
      imported: 1,
      unresolved: 0,
      reason: "cancelled",
      restorationWarning: "cancelled",
      cancelRequested: true,
    });
    expect(await setup.repositories.listFlowClipImports()).toHaveLength(1);
  });

  it("keeps the original detail-read failure when no verified identity exists to restore", async () => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeMetadataOutcome: "throw",
      restoreWrongProject: true,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      status: "incomplete",
      imported: 0,
      unresolved: 1,
      unresolvedCards: [{ reason: "detail_reader_injection_failed" }],
    });
    expect(progress.restorationWarning).toBeUndefined();
    expect(setup.getProjectRootNavigations()).toBe(0);
    expect(await setup.repositories.listFlowClipImports()).toHaveLength(0);
  });

  it.each([
    ["missing executeScript result during replacement navigation", "missing", "replacement"],
    ["malformed executeScript result during delayed SPA navigation", "malformed", "spa"],
  ] as const)("continues observing the same tab after a %s", async (_label, nativeOpenResult, nativeRouteTransition) => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 3,
      nativeConnectionPendingChecks: 1,
      nativeRouteTransition,
      nativeOpenResult,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      status: "completed",
      discovered: 1,
      imported: 1,
      alreadyPresent: 0,
      unresolved: 0,
      scanCompleteness: "incomplete",
      reason: "one_card_check_complete",
    });
    expect(setup.getNativeOpenAttempts()).toBe(1);
    expect(setup.getDetailInjectionDocumentIds().length).toBeGreaterThanOrEqual(2);
    if (nativeRouteTransition === "replacement") {
      expect(setup.getDetailInjectionDocumentIds().every((id) => id === "detail-document-replaced")).toBe(true);
    } else {
      expect(setup.getDetailInjectionDocumentIds().every((id) => id === "document-test")).toBe(true);
    }
    expect(setup.getTabUrl()).toBe(`https://flow.google.com/project/${projectId}`);
    expect(await setup.repositories.listFlowClipImports()).toMatchObject([{
      clipId: liveNativeMappings[0]!.clipId,
      galleryImportMethod: "native_card_navigation",
      detailSelectedAssetId: liveNativeMappings[0]!.selectedAssetId,
    }]);
  });

  it.each(["missing", "malformed"] as const)(
    "reports an unknown open outcome when the %s result is followed by no route",
    async (nativeOpenResult) => {
      const setup = await makeProjectVideoImportManager({
        snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
        nativeMappings: liveNativeMappings,
        nativeRouteDelayReads: 100,
        nativeOpenResult,
      });
      await setup.manager.startProjectVideoImport({ singleCardCheck: true });
      let progress = await setup.manager.getProjectVideoImport();
      for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
        await Promise.resolve();
        progress = await setup.manager.getProjectVideoImport();
      }
      expect(progress).toMatchObject({
        status: "incomplete",
        imported: 0,
        unresolved: 1,
        unresolvedCards: [{ title: "make it", reason: "native_open_outcome_unknown" }],
      });
      expect(setup.getNativeOpenAttempts()).toBe(1);
      expect(setup.getDetailInjectionDocumentIds()).toEqual([]);
    },
  );

  it("rejects stale identity-reader document results and retries only on the verified replacement document", async () => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 1,
      nativeConnectionPendingChecks: 1,
      nativeStaleDetailResultCount: 2,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "completed", imported: 1, alreadyPresent: 0, unresolved: 0 });
    expect(setup.getNativeOpenAttempts()).toBe(1);
    expect(setup.getDetailInjectionDocumentIds().every((id) => id === "detail-document-replaced")).toBe(true);
    expect(await setup.repositories.listFlowClipImports()).toMatchObject([{
      clipId: liveNativeMappings[0]!.clipId,
      detailSelectedAssetId: liveNativeMappings[0]!.selectedAssetId,
    }]);
  });

  it.each([
    ["metadata injection throw", { nativeMetadataOutcome: "throw" }, "detail_reader_injection_failed"],
    ["metadata result missing", { nativeMetadataOutcome: "missing" }, "detail_reader_result_missing"],
    ["metadata schema invalid", { nativeMetadataOutcome: "malformed" }, "detail_metadata_schema_invalid"],
    ["route identity mismatch", { nativeMetadataOutcome: "route_mismatch" }, "detail_route_identity_mismatch"],
    ["asset injection throw", { nativeAssetOutcome: "throw" }, "detail_reader_injection_failed"],
    ["asset result missing", { nativeAssetOutcome: "missing" }, "detail_selected_asset_result_missing"],
    ["asset schema invalid", { nativeAssetOutcome: "malformed" }, "detail_selected_asset_schema_invalid"],
    ["selected rail absent", { nativeAssetOutcome: "rail_missing" }, "detail_selected_rail_missing"],
    ["selected rail ambiguous", { nativeAssetOutcome: "rail_ambiguous" }, "detail_selected_rail_ambiguous"],
    ["selected thumbnail absent", { nativeAssetOutcome: "thumbnail_missing" }, "detail_selected_thumbnail_missing"],
    ["selected thumbnail ambiguous", { nativeAssetOutcome: "thumbnail_ambiguous" }, "detail_selected_thumbnail_ambiguous"],
    ["asset UUID absent", { nativeAssetOutcome: "asset_id_missing" }, "detail_selected_asset_id_missing"],
    ["asset UUID ambiguous", { nativeAssetOutcome: "asset_id_ambiguous" }, "detail_selected_asset_id_ambiguous"],
    ["asset extraction rejected", { nativeAssetOutcome: "source_invalid" }, "detail_selected_asset_extraction_failed"],
  ] as const)("reports the bounded %s stage", async (_name, outcome, reason) => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 1,
      ...outcome,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "incomplete", imported: 0, unresolved: 1 });
    expect(progress.unresolvedCards).toContainEqual({ title: "make it", reason });
    expect(setup.getNativeOpenAttempts()).toBe(1);
    expect(await setup.repositories.listFlowClipImports()).toEqual([]);
  });

  it("waits for a delayed selected rail before persisting the verified identity", async () => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 1,
      nativeAssetUnavailableReads: 3,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "completed", imported: 1, unresolved: 0 });
    expect(setup.getNativeOpenAttempts()).toBe(1);
    expect(await setup.repositories.listFlowClipImports()).toMatchObject([{
      clipId: liveNativeMappings[0]!.clipId,
      detailSelectedAssetId: liveNativeMappings[0]!.selectedAssetId,
    }]);
  });

  it("reports a route that never appears separately from an open-control rejection", async () => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 100,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      scope: "one_card_check",
      status: "incomplete",
      imported: 0,
      unresolved: 1,
      unresolvedCards: [{ title: "make it", reason: "detail_route_not_observed_by_deadline" }],
    });
    expect(setup.getTabUrl()).toBe(`https://flow.google.com/project/${projectId}`);
    expect(setup.getDetailInjectionDocumentIds()).toEqual([]);
  });

  it("reports a route whose verified document connection never becomes ready", async () => {
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeRouteDelayReads: 1,
      nativeConnectionPendingChecks: 500,
    });
    await setup.manager.startProjectVideoImport({ singleCardCheck: true });
    let progress = await setup.manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await setup.manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      scope: "one_card_check",
      status: "incomplete",
      imported: 0,
      unresolved: 1,
      unresolvedCards: [{ title: "make it", reason: "detail_connection_unavailable" }],
    });
    expect(setup.getDetailInjectionDocumentIds()).toEqual([]);
  });

  it("rejects a native card that navigates into another project", async () => {
    const { manager, repositories } = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeWrongProject: true,
    });
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 100; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "failed", reason: "navigation_changed", imported: 0 });
    expect(await repositories.listFlowClipImports()).toHaveLength(0);
  });

  it("cancels native navigation, restores the Gallery, and saves no unverified row", async () => {
    let enteredNativeWait!: () => void;
    let releaseNativeWait!: () => void;
    const nativeWaitEntered = new Promise<void>((resolve) => { enteredNativeWait = resolve; });
    const nativeWaitGate = new Promise<void>((resolve) => { releaseNativeWait = resolve; });
    const wait = async (milliseconds: number) => {
      if (milliseconds === 150) {
        enteredNativeWait();
        await nativeWaitGate;
      }
    };
    const setup = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      wait,
    });
    const manager = setup.manager;
    await manager.startProjectVideoImport();
    await nativeWaitEntered;
    await manager.cancelProjectVideoImport();
    releaseNativeWait();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 200; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "cancelled", scanCompleteness: "incomplete", reason: "cancelled" });
    expect(setup.getTabUrl()).toBe(`https://flow.google.com/project/${projectId}/edit/${liveNativeMappings[0]!.clipId}`);
    expect(await setup.repositories.listFlowClipImports()).toHaveLength(0);
  });

  it("does not import a native card when detail rail selection is ambiguous or unavailable", async () => {
    const { manager, repositories } = await makeProjectVideoImportManager({
      snapshots: [[unresolvedProjectVideoCard("make it", liveNativeMappings[0]!.token)]],
      nativeMappings: liveNativeMappings,
      nativeSelectionAmbiguous: true,
    });
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({ status: "incomplete", imported: 0, unresolved: 1 });
    expect(progress.unresolvedCards).toContainEqual({
      title: "make it",
      reason: "detail_selected_rail_ambiguous",
    });
    expect(await repositories.listFlowClipImports()).toHaveLength(0);
  });

  it("stops incomplete when rerendered owners cannot be uniquely reacquired", async () => {
    const token = liveNativeMappings[0]!.token;
    const { manager, repositories } = await makeProjectVideoImportManager({
      snapshots: [[
        unresolvedProjectVideoCard("make it", token),
        unresolvedProjectVideoCard("make it", token),
      ]],
      nativeMappings: liveNativeMappings,
      rerenderCards: true,
    });
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 100; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      status: "incomplete",
      scanCompleteness: "incomplete",
      reason: "ambiguous_identity",
      discovered: 2,
      unresolved: 2,
    });
    expect(await repositories.listFlowClipImports()).toHaveLength(0);
  });

  it("keeps prior rows and stops before clicking when a later owner binding is stale", async () => {
    const cards = liveNativeMappings.map((mapping) =>
      unresolvedProjectVideoCard("make it", mapping.token),
    );
    const { manager, repositories } = await makeProjectVideoImportManager({
      snapshots: [cards],
      nativeMappings: liveNativeMappings,
      nativeReacquireFailsFor: liveNativeMappings[1]!.token,
    });
    await manager.startProjectVideoImport();
    let progress = await manager.getProjectVideoImport();
    for (let index = 0; progress.status === "scanning" && index < 10000; index += 1) {
      await Promise.resolve();
      progress = await manager.getProjectVideoImport();
    }
    expect(progress).toMatchObject({
      status: "incomplete",
      scanCompleteness: "incomplete",
      reason: "coverage_unproven",
      imported: 1,
      unresolved: 0,
    });
    const rows = await repositories.listFlowClipImports();
    expect(rows.map((row) => row.clipId)).toEqual([liveNativeMappings[0]!.clipId]);
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
