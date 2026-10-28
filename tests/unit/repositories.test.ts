import { describe, expect, it } from "vitest";
import {
  ChromePreferenceRepository,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import { appDatabase } from "../../src/storage/db";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";

describe("extension repository boundaries", () => {
  it("declares the fresh extension-owned Dexie namespace and foundation tables", () => {
    expect(appDatabase.name).toBe("automat-faceless-app-v1");
    expect(appDatabase.tables.map((table) => table.name).sort()).toEqual([
      "batches",
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
    expect(selected.reconnectEnabled).toBe(true);
    expect(await repositories.setReconnectIntent("Vids", false)).toBe(true);
    expect(
      await repositories.markTargetVerified("Vids", selected.canonicalTarget),
    ).toBe(true);
    await repositories.markTargetsUnverified();
    expect(await repositories.getSelectedTarget("Vids")).toMatchObject({
      verification: "unverified",
      reconnectEnabled: false,
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
});
