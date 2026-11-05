import { describe, expect, it, vi } from "vitest";
import { createFlowDownloadDiagnosticManager } from "../../src/background/flowDownloadDiagnostic";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";

const projectId = "project-test";
const firstClip = "11111111-2222-4333-8444-555555555555";
const secondClip = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const proofClip = "c2989a6e-7cae-4cbf-84f2-51a44ddfd1fa";
const otherImportedClip = "bbc2bc82-0000-4000-8000-000000000000";

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
    const executeScript = vi.fn(async ({ func }: { func: (...args: never[]) => unknown }) => [{
      documentId: "document-test",
      result: func === (await import("../../src/platforms/flow/clipImport")).inspectCurrentFlowClipInPage
        ? { projectId, clipId: proofClip, title: "make it", thumbnail: { available: true } }
        : { downloadMediaControlCount: 1, explicit1080pControlCount: 0 },
    }]);
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
      now: () => now,
    });

    const rejectedOther = await manager.inspectClipDownloadProof(other.record.id);
    expect(rejectedOther).toMatchObject({
      status: "blocked",
      blocker: "clip_not_in_single_row_scope",
      outputStatus: "unverified",
    });
    expect(executeScript).not.toHaveBeenCalled();

    const target = await manager.inspectClipDownloadProof(first.record.id);
    expect(target).toMatchObject({
      status: "blocked",
      blocker: "detail_download_control_semantics_unverified",
      routeStatus: "matched",
      controlStatus: "observed_unverified",
      downloadMediaControlCount: 1,
      explicit1080pControlCount: 0,
      outputStatus: "unverified",
    });
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(JSON.stringify({ rejectedOther, target })).not.toContain(proofClip);
    expect(JSON.stringify({ rejectedOther, target })).not.toContain(otherImportedClip);
    now += 1;
  });
});
