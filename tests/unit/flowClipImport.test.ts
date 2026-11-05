import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  flowClipImportId,
  flowClipImportRouteMatches,
} from "../../src/domain/media/flowClipImport";
import { inspectCurrentFlowClipInPage } from "../../src/platforms/flow/clipImport";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";

const clipOne = "11111111-2222-4333-8444-555555555555";
const clipTwo = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("Flow detail clip import proof of concept", () => {
  it("keeps same-title clips separate by project plus clip UUID and upserts reimports", async () => {
    let now = 1_000;
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
      () => now,
    );
    const importClip = (clipId: string) =>
      repositories.upsertFlowClipImport({
        projectId: "project-test",
        clipId,
        title: "make it",
        detailUrl: `https://flow.google.com/project/project-test/edit/${clipId}`,
        thumbnail: {
          available: true,
          width: 1280,
          height: 720,
          fingerprint: "a".repeat(64),
        },
      });

    const first = await importClip(clipOne);
    now += 100;
    const second = await importClip(clipTwo);
    now += 100;
    const reimport = await importClip(clipOne);

    const rows = await repositories.listFlowClipImports();
    expect(first.reimported).toBe(false);
    expect(second.reimported).toBe(false);
    expect(reimport.reimported).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.title)).toEqual(["make it", "make it"]);
    expect(rows.map((row) => row.clipId)).toEqual([clipOne, clipTwo]);
    expect(rows[0]?.id).toBe(flowClipImportId("project-test", clipOne));
    expect(rows[1]?.id).toBe(flowClipImportId("project-test", clipTwo));
    expect(rows[0]?.importedAt).toBe(1_000);
    expect(rows[0]?.updatedAt).toBe(1_200);
    expect(rows.every(flowClipImportRouteMatches)).toBe(true);
  });

  it("rejects a row whose exact /edit/ URL points to another project or clip", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    await expect(
      repositories.upsertFlowClipImport({
        projectId: "project-test",
        clipId: clipOne,
        title: "make it",
        detailUrl: `https://flow.google.com/project/other-project/edit/${clipOne}`,
        thumbnail: { available: false },
      }),
    ).rejects.toThrow("flow_clip_import_route_identity_mismatch");
    await expect(
      repositories.upsertFlowClipImport({
        projectId: "project-test",
        clipId: clipOne,
        title: "make it",
        detailUrl: `https://flow.google.com/project/project-test/edit/${clipTwo}`,
        thumbnail: { available: false },
      }),
    ).rejects.toThrow("flow_clip_import_route_identity_mismatch");
    expect(await repositories.listFlowClipImports()).toEqual([]);
  });

  it("reads title and already-loaded thumbnail metadata without exposing its URL or query token", async () => {
    const dom = new JSDOM(
      `<title>make it | Google Flow</title><main><h1>make it</h1><img src="https://flow-content.google/thumb/${clipOne}?signature=private-token"></main>`,
      {
        url: `https://flow.google.com/project/project-test/edit/${clipOne}?view=private-token`,
      },
    );
    const image = dom.window.document.querySelector("img")!;
    image.getBoundingClientRect = () =>
      ({ width: 640, height: 360 } as DOMRect);
    const scope = globalThis as unknown as Record<string, unknown>;
    const previousDocument = scope.document;
    const previousLocation = scope.location;
    const previousGetComputedStyle = scope.getComputedStyle;
    const fetch = vi.fn();
    const previousFetch = scope.fetch;
    scope.document = dom.window.document;
    scope.location = dom.window.location;
    scope.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    scope.fetch = fetch;
    try {
      const result = await inspectCurrentFlowClipInPage();
      expect(result).toMatchObject({
        projectId: "project-test",
        clipId: clipOne,
        title: "make it",
        thumbnail: {
          available: true,
          width: 640,
          height: 360,
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(JSON.stringify(result)).not.toContain("flow-content.google");
      expect(JSON.stringify(result)).not.toContain("private-token");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      dom.window.close();
      if (previousDocument === undefined) delete scope.document;
      else scope.document = previousDocument;
      if (previousLocation === undefined) delete scope.location;
      else scope.location = previousLocation;
      if (previousGetComputedStyle === undefined)
        delete scope.getComputedStyle;
      else scope.getComputedStyle = previousGetComputedStyle;
      if (previousFetch === undefined) delete scope.fetch;
      else scope.fetch = previousFetch;
    }
  });
});
