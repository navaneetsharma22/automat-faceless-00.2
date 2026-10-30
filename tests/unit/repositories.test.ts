import { describe, expect, it } from "vitest";
import {
  ChromePreferenceRepository,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import { appDatabase } from "../../src/storage/db";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";
import { flowImagePromptSnapshotId } from "../../src/domain/batches/flowImagePromptSnapshot";
import { sha256Hex } from "../../src/storage/repositories";

describe("extension repository boundaries", () => {
  it("declares the fresh extension-owned Dexie namespace and foundation tables", () => {
    expect(appDatabase.name).toBe("automat-faceless-app-v1");
    expect(appDatabase.tables.map((table) => table.name).sort()).toEqual([
      "batches",
      "flowImageAttempts",
      "flowImagePromptSnapshots",
      "promptDrafts",
      "promptItems",
      "selectedTargets",
      "workflows",
    ]);
  });

  it("writes prompt text unchanged and keeps selected targets unverified", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
      () => 100,
    );
    const escapedQuote = String.fromCharCode(92, 34);
    const hindi = "\u0928\u092e\u0938\u094d\u0924\u0947";
    const rawText = `{"decimal":[0.125,1.75],"quoted":"${escapedQuote}${hindi}${escapedQuote}"}\r\n`;
    const savedDraft = await repositories.savePromptDraft({
      id: "offline-draft",
      kind: "video",
      rawText,
    });
    const selected = await repositories.recordSelectedTarget({
      provider: "Vids",
      tabId: 22,
      canonicalTarget: "https://vids.google.com/video/demo/edit",
    });

    expect(savedDraft.rawText).toBe(rawText);
    expect(await repositories.getPromptDraft("offline-draft")).toEqual(
      savedDraft,
    );
    expect(selected.verification).toBe("unverified");
    expect(selected.reconnectEnabled).toBe(false);
    expect(await repositories.setReconnectIntent("Vids", false)).toBe(true);
    expect(await repositories.setReconnectIntent("Vids", true)).toBe(true);
    expect(
      await repositories.recordTargetVerification({
        provider: "Vids",
        tabId: selected.tabId,
        canonicalTarget: selected.canonicalTarget,
        projectId: "demo",
        frameId: 0,
        documentId: "browser-document-1",
        documentToken: "connector-document-1",
        extensionBuildId: "build-current",
        extensionProtocolVersion: 4,
        connectorBuildId: "build-current",
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: 100,
      }),
    ).toBe(true);
    expect(await repositories.getSelectedTarget("Vids")).toMatchObject({
      verification: "verified",
      verificationBinding: {
        provider: "Vids",
        tabId: selected.tabId,
        canonicalTarget: selected.canonicalTarget,
        projectId: "demo",
        frameId: 0,
        documentId: "browser-document-1",
        extensionBuildId: "build-current",
        extensionProtocolVersion: 4,
        connectorBuildId: "build-current",
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
      },
    });
    await repositories.markTargetsUnverified();
    expect(await repositories.getSelectedTarget("Vids")).toMatchObject({
      verification: "unverified",
      reconnectEnabled: true,
    });
    expect(await repositories.setReconnectIntent("Flow", false)).toBe(false);
  });

  it("stores only approved small theme preferences through the Chrome Storage boundary", async () => {
    const values: Record<string, unknown> = {};
    const repository = new ChromePreferenceRepository({
      get: async (key) => (key in values ? { [key]: values[key] } : {}),
      set: async (items) => Object.assign(values, items),
    });

    expect(await repository.getTheme()).toBe("light");
    await repository.setTheme("dark");
    expect(await repository.getTheme()).toBe("dark");
    expect(values).toEqual({ theme: "dark" });
  });

  it("keeps content-addressed Flow image source snapshots immutable", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
      () => 100,
    );
    const source = '{"shot_id":"01","text":"preserve  \\n exact"}';
    const hash = await sha256Hex(source);
    const snapshot = {
      snapshotId: flowImagePromptSnapshotId("item-01", hash),
      workspaceId: "workspace-01",
      batchId: "batch-01",
      itemId: "item-01",
      promptHash: hash,
      rawJsonBody: source,
      promptCodeUnits: source.length,
      promptUtf8Bytes: new TextEncoder().encode(source).byteLength,
      createdAt: 100,
    };
    await repositories.saveFlowImagePromptSnapshot(snapshot);
    await repositories.saveFlowImagePromptSnapshot({
      ...snapshot,
      createdAt: 200,
    });
    expect(
      await repositories.getFlowImagePromptSnapshot(snapshot.snapshotId),
    ).toEqual(snapshot);
    await expect(
      repositories.saveFlowImagePromptSnapshot({
        ...snapshot,
        workspaceId: "workspace-02",
      }),
    ).rejects.toThrow("immutable Flow image prompt snapshot");
    expect(
      await repositories.getFlowImagePromptSnapshot(snapshot.snapshotId),
    ).toEqual(snapshot);
  });

  it("treats a pre-lifecycle saved target as eligible for fresh verification", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 100);
    await database.selectedTargets.put({
      provider: "Flow",
      tabId: 17,
      canonicalTarget: "https://flow.google.com/project/legacy",
      verification: "unverified",
      updatedAt: 12,
    });

    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      tabId: 17,
      reconnectEnabled: true,
    });
  });
});
