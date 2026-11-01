// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReferenceSelection,
  summarizePickerThumbnailFailure,
} from "../../src/app/features/references/ReferenceSelection";
import type { FoundationClient } from "../../src/shared/messageClient";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

function savedReference(
  shotId: string,
  assignmentVersion = 1,
  distinctFixture = false,
) {
  const suffix = shotId.padStart(12, "0");
  const distinctNumber = Number(shotId) - 33;
  return {
    assignmentId: `workspace-1:batch-1:${shotId}`,
    referenceId: `00000000-0000-4000-8000-${suffix}`,
    captureOperationId: `10000000-0000-4000-8000-${suffix}`,
    workspaceId: "default",
    batchId: "batch-1",
    batchSourceHash: "a".repeat(64),
    shotId,
    promptHash: "b".repeat(64),
    selectionVersion: `20000000-0000-4000-8000-${suffix}`,
    assignmentVersion,
    flowProjectId: "project-1",
    tabId: 101,
    canonicalTarget: "https://flow.google.com/project/project-1",
    documentId: "document-1",
    providerAssetId: `fixture-media-shot-${shotId}`,
    observedSourceSha256: "c".repeat(64),
    mimeType: "image/png",
    byteSize: distinctFixture ? distinctNumber + 2 : 3,
    sha256: (distinctFixture ? String(distinctNumber) : "d").repeat(64),
    width: 1,
    height: 1,
    capturedAt: 10,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch",
    qualityProvenance: "observed_resource_original_bytes_no_upscale",
  };
}

async function setup(
  options: {
    shotIds?: string[];
    savedShotIds?: string[];
    failCapture?: boolean;
    distinctSavedReferences?: boolean;
  } = {},
) {
  const candidate = {
    candidateId: "00000000-0000-4000-8000-000000000001",
    sourceUrl: "https://example.test/chosen-image.png",
    naturalWidth: 1024,
    naturalHeight: 768,
    displayWidth: 256,
    displayHeight: 192,
    cardTag: "flow-image-tile",
    selectedAt: 10,
  };
  let shotIds = options.shotIds ?? ["34"];
  const savedRecords = new Map(
    (options.savedShotIds ?? []).map((shotId) => [
      shotId,
      savedReference(shotId, 1, options.distinctSavedReferences),
    ]),
  );
  const chosenCandidates: Record<
    string,
    typeof candidate & Record<string, unknown>
  > = Object.fromEntries(
    [...savedRecords].map(([shotId, record]) => [
      shotId,
      {
        ...candidate,
        selectionVersion: record.selectionVersion,
        workspaceId: "default",
        batchId: "batch-1",
        shotId,
      },
    ]),
  );
  let activeShotId: string | null = null;
  let listResponse = async () => ({
    sessionId: "session-1",
    candidates: [candidate],
    ambiguousCount: 0,
    unsupportedCount: 0,
  });
  const request = vi.fn(
    async (type: string, payload?: Record<string, unknown>) => {
      if (type === "promptBatch.get")
        return {
          batch: { id: "batch-1" },
          items: shotIds.map((shotId, index) => ({
            id: `item-${shotId}`,
            shotId,
            order: index,
            rawJsonBody: `{"shot_id":"${shotId}"}`,
          })),
        };
      if (type === "connections.getSelection")
        return { verification: "verified", connectionState: "verified" };
      if (type === "flow.reference.getState")
        return {
          activeSession: activeShotId
            ? {
                sessionId: "session-1",
                shotId: activeShotId,
                projectId: "project-1",
                tabId: 101,
              }
            : null,
          candidates: chosenCandidates,
          savedReferences: [...savedRecords.values()],
        };
      if (type === "flow.reference.startSelection") {
        activeShotId = String(payload?.shotId);
        return {
          sessionId: "session-1",
          tabId: 101,
          projectId: "project-1",
          canonicalTarget: "https://flow.google.com/project/project-1",
        };
      }
      if (type === "flow.reference.listCandidates") return listResponse();
      if (type === "flow.reference.getPreview")
        return {
          ok: true,
          sessionId: "session-1",
          candidateId: candidate.candidateId,
          previewId: payload?.previewId,
          mimeType: "image/webp",
          byteLength: 3,
          width: 1,
          height: 1,
          data: "AQID",
        };
      if (type === "flow.reference.chooseCandidate") {
        const shotId = activeShotId!;
        const acceptedCandidate = {
          ...candidate,
          selectionVersion: `30000000-0000-4000-8000-${shotId.padStart(12, "0")}`,
          workspaceId: "default",
          batchId: "batch-1",
          shotId,
        };
        chosenCandidates[shotId] = acceptedCandidate;
        activeShotId = null;
        return { accepted: true, candidate: acceptedCandidate };
      }
      if (type === "flow.reference.cancelSelection") {
        activeShotId = null;
        return { cancelled: true };
      }
      if (type === "flow.reference.getSavedReference") {
        const reference = [...savedRecords.values()].find(
          (record) => record.referenceId === payload?.referenceId,
        );
        if (!reference) throw new Error("saved_reference_missing");
        const dataBySize: Record<number, string> = {
          3: "AQID",
          4: "AQIDBA==",
          5: "AQIDBAU=",
          6: "AQIDBAUG",
        };
        return { reference, data: dataBySize[reference.byteSize] ?? "AQID" };
      }
      if (type === "flow.reference.capture") {
        if (options.failCapture) throw new Error("fixture_capture_failed");
        const shotId = String(payload?.shotId);
        const old = savedRecords.get(shotId);
        const next = {
          ...savedReference(
            shotId,
            (old?.assignmentVersion ?? 0) + 1,
            options.distinctSavedReferences,
          ),
          referenceId: `40000000-0000-4000-8000-${shotId.padStart(12, "0")}`,
          selectionVersion: String(payload?.selectionVersion),
          providerAssetId: `fixture-media-shot-${shotId}-replacement`,
          byteSize: 6,
          sha256: "e".repeat(64),
        };
        savedRecords.set(shotId, next);
        return { saved: true, reference: next };
      }
      if (type === "flow.reference.getCaptureStatus")
        return { status: "failed", reason: "fixture_capture_failed" };
      if (type === "flow.reference.clearCandidate") {
        delete chosenCandidates[String(payload?.shotId)];
        return { cleared: true };
      }
      throw new Error(`Unexpected request: ${type}`);
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(ReferenceSelection, {
        persistenceClient: { request } as unknown as FoundationClient,
      }),
    ),
  );
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === label,
    );
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
  };
  const clickInShot = async (shotId: string, label: string) => {
    const card = [...container.querySelectorAll("article")].find((article) =>
      article.textContent?.includes(`Shot ${shotId}`),
    );
    const button = [...(card?.querySelectorAll("button") ?? [])].find(
      (item) => item.textContent?.trim() === label,
    );
    expect(button, `${label} in Shot ${shotId}`).toBeDefined();
    await act(async () => button!.click());
  };
  return {
    request,
    click,
    clickInShot,
    chosenCandidates,
    setList: (fn: typeof listResponse) => {
      listResponse = fn;
    },
    setDisplayOrder: async (nextOrder: string[]) => {
      shotIds = [...nextOrder];
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () =>
        root.render(
          createElement(ReferenceSelection, {
            persistenceClient: { request } as unknown as FoundationClient,
          }),
        ),
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    },
  };
}

describe("References-owned Flow image picker", () => {
  it("summarizes preview failure evidence without exposing signed URL components", () => {
    const diagnostic = summarizePickerThumbnailFailure({
      sourceUrl:
        "https://images.example.test/path/image.webp?token=secret-value",
      referrerPolicy: "no-referrer",
      complete: true,
      naturalWidth: 0,
      naturalHeight: 0,
      responseStatus: 403,
      transferSize: 0,
      redirectStart: 0,
      redirectEnd: 0,
      cspDirective: "img-src",
      cspDisposition: "enforce",
    });
    expect(diagnostic).toMatchObject({
      sourceComparison:
        "Same candidate URL used for preview; final redirect target is not exposed here",
      protocol: "https:",
      origin: "https://images.example.test",
      referrerPolicy: "no-referrer",
      httpStatus: "HTTP 403",
      contentType: "not exposed to an HTMLImageElement",
      cspDirective: "img-src (enforce)",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret-value");
    expect(JSON.stringify(diagnostic)).not.toContain("/path/image.webp");
  });

  it("browses and chooses without provider clicks, retaining visible acknowledgement after session closes", async () => {
    const { click, request } = await setup();
    await click("Browse Flow images");
    await click("Load preview");
    const preview = container.querySelector("img")!;
    expect(preview.getAttribute("src")).toMatch(/^blob:/);
    await act(async () => preview.dispatchEvent(new Event("load")));
    await click("Choose for Shot 34");
    expect(request).toHaveBeenCalledWith("flow.reference.chooseCandidate", {
      sessionId: "session-1",
      candidateId: "00000000-0000-4000-8000-000000000001",
    });
    expect(container.textContent).toContain("Candidate selected for Shot 34");
    expect(container.textContent).toContain("Candidate selection is transient");
    expect(container.textContent).toContain("Save reference");
    expect(container.textContent).not.toContain("Flow images for Shot 34");
  });

  it("Re-select opens the extension picker for the saved Shot and keeps browse and cancel controls available", async () => {
    const { clickInShot, request } = await setup({
      shotIds: ["35", "36"],
      savedShotIds: ["35", "36"],
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    await clickInShot("35", "Re-select candidate");

    expect(request).toHaveBeenCalledWith("flow.reference.startSelection", {
      workspaceId: "default",
      batchId: "batch-1",
      shotId: "35",
    });
    expect(request).toHaveBeenCalledWith("flow.reference.listCandidates", {
      sessionId: "session-1",
    });
    expect(container.textContent).toContain("Flow images for Shot 35");
    expect(container.textContent).toContain("Browse Flow images");
    expect(container.textContent).toContain("Refresh images");
    expect(container.textContent).toContain("Cancel selection");
    expect(container.textContent).not.toContain("Awaiting card click in Flow");
    expect(
      container.querySelector('img[alt="Saved reference for Shot 35"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("SHA-256 " + "d".repeat(64));
  });

  it("cancelling re-selection preserves the saved image", async () => {
    const { click, clickInShot, request } = await setup({
      shotIds: ["35", "36"],
      savedShotIds: ["35", "36"],
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await clickInShot("35", "Re-select candidate");
    await click("Cancel selection");

    expect(request).toHaveBeenCalledWith("flow.reference.cancelSelection", {
      sessionId: "session-1",
    });
    expect(
      container.querySelector('img[alt="Saved reference for Shot 35"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('img[alt="Saved reference for Shot 36"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("SHA-256 " + "d".repeat(64));
  });

  it("clearing the transient candidate preserves the saved image", async () => {
    const { clickInShot, request } = await setup({
      shotIds: ["35", "36"],
      savedShotIds: ["35", "36"],
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await clickInShot("35", "Clear candidate");

    expect(request).toHaveBeenCalledWith("flow.reference.clearCandidate", {
      workspaceId: "default",
      shotId: "35",
    });
    expect(
      container.querySelector('img[alt="Saved reference for Shot 35"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("SHA-256 " + "d".repeat(64));
    expect(container.textContent).toContain("No reference candidate selected.");
  });

  it("choosing a replacement leaves the saved assignment unchanged until Save reference succeeds", async () => {
    const { click, clickInShot, request } = await setup({
      shotIds: ["35", "36"],
      savedShotIds: ["35", "36"],
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await clickInShot("35", "Re-select candidate");
    await click("Load preview");
    await act(async () =>
      container
        .querySelector('img[alt^="Flow image candidate preview"]')!
        .dispatchEvent(new Event("load")),
    );
    await click("Choose for Shot 35");

    expect(request).not.toHaveBeenCalledWith(
      "flow.reference.capture",
      expect.anything(),
    );
    expect(
      container.querySelector('img[alt="Saved reference for Shot 35"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("SHA-256 " + "d".repeat(64));
    expect(container.textContent).toContain(
      "Candidate selected — not saved yet.",
    );
    expect(container.textContent).toContain("Save reference");
  });

  it("saves the replacement only to the targeted Shot", async () => {
    const { click, clickInShot, request } = await setup({
      shotIds: ["35", "36"],
      savedShotIds: ["35", "36"],
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await clickInShot("35", "Re-select candidate");
    await click("Load preview");
    await act(async () =>
      container
        .querySelector('img[alt^="Flow image candidate preview"]')!
        .dispatchEvent(new Event("load")),
    );
    await click("Choose for Shot 35");
    await clickInShot("35", "Save reference");

    expect(request).toHaveBeenCalledWith(
      "flow.reference.capture",
      expect.objectContaining({ shotId: "35", expectedAssignmentVersion: 1 }),
    );
    expect(container.textContent).toContain("SHA-256 " + "e".repeat(64));
    const shot36 = [...container.querySelectorAll("article")].find((article) =>
      article.textContent?.includes("Shot 36"),
    );
    expect(shot36?.textContent).toContain("SHA-256 " + "d".repeat(64));
    expect(shot36?.textContent).not.toContain("SHA-256 " + "e".repeat(64));
  });

  it("keeps media, hashes, and thumbnail associations by Shot ID after reorder and replacement", async () => {
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob) => `blob:fixture-${blob.size}`);
    const { click, clickInShot, setDisplayOrder } = await setup({
      shotIds: ["34", "35", "36"],
      savedShotIds: ["34", "35", "36"],
      distinctSavedReferences: true,
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const expectCardAssociation = (
      shotId: string,
      hash: string,
      size: number,
      mediaId: string,
    ) => {
      const card = [...container.querySelectorAll("article")].find((article) =>
        article.textContent?.includes(`Shot ${shotId}`),
      );
      expect(card?.textContent).toContain(`SHA-256 ${hash.repeat(64)}`);
      expect(card?.textContent).toContain(mediaId);
      expect(
        card
          ?.querySelector(`img[alt="Saved reference for Shot ${shotId}"]`)
          ?.getAttribute("src"),
      ).toBe(`blob:fixture-${size}`);
    };

    expectCardAssociation("34", "1", 3, "fixture-media-shot-34");
    expectCardAssociation("35", "2", 4, "fixture-media-shot-35");
    expectCardAssociation("36", "3", 5, "fixture-media-shot-36");

    await clickInShot("35", "Re-select candidate");
    await click("Load preview");
    await act(async () =>
      container
        .querySelector('img[alt^="Flow image candidate preview"]')!
        .dispatchEvent(new Event("load")),
    );
    await click("Choose for Shot 35");
    await clickInShot("35", "Save reference");

    await setDisplayOrder(["36", "34", "35"]);
    expectCardAssociation("36", "3", 5, "fixture-media-shot-36");
    expectCardAssociation("34", "1", 3, "fixture-media-shot-34");
    expectCardAssociation("35", "e", 6, "fixture-media-shot-35-replacement");
    expect(createUrl).toHaveBeenCalled();
  });

  it("capture failure keeps the previous saved image and other Shot assignment", async () => {
    const { click, clickInShot } = await setup({
      shotIds: ["35", "36"],
      savedShotIds: ["35", "36"],
      failCapture: true,
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await clickInShot("35", "Re-select candidate");
    await click("Load preview");
    await act(async () =>
      container
        .querySelector('img[alt^="Flow image candidate preview"]')!
        .dispatchEvent(new Event("load")),
    );
    await click("Choose for Shot 35");
    await clickInShot("35", "Save reference");

    expect(
      container.querySelector('img[alt="Saved reference for Shot 35"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("SHA-256 " + "d".repeat(64));
    expect(container.textContent).toContain(
      "Capture failed (fixture_capture_failed)",
    );
    const shot36 = [...container.querySelectorAll("article")].find((article) =>
      article.textContent?.includes("Shot 36"),
    );
    expect(shot36?.textContent).toContain("SHA-256 " + "d".repeat(64));
  });

  it("reports failed thumbnail loading and prevents choosing an unseen substitute", async () => {
    const { click } = await setup();
    await click("Browse Flow images");
    await click("Load preview");
    await act(async () =>
      container.querySelector("img")!.dispatchEvent(new Event("error")),
    );
    expect(container.textContent).toContain("Thumbnail could not load");
    const choose = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Choose for Shot 34",
    );
    expect(choose?.disabled).toBe(true);
  });

  it("revokes transient preview URLs when candidate results refresh", async () => {
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:transient-preview");
    const { click } = await setup();
    await click("Browse Flow images");
    await click("Load preview");
    await click("Refresh images");
    expect(revoke).toHaveBeenCalledWith("blob:transient-preview");
    expect(
      container.querySelector('img[src="blob:transient-preview"]'),
    ).toBeNull();
  });

  it("ignores a delayed refresh after the References view unmounts", async () => {
    const { click, setList } = await setup();
    await click("Browse Flow images");
    let resolve!: (value: {
      sessionId: string;
      candidates: never[];
      ambiguousCount: number;
      unsupportedCount: number;
    }) => void;
    setList(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await click("Refresh images");
    // Leave the References view while the refresh is in flight.
    await act(async () => root.unmount());
    await act(async () =>
      resolve({
        sessionId: "session-1",
        candidates: [],
        ambiguousCount: 0,
        unsupportedCount: 0,
      }),
    );
    expect(container.textContent).toBe("");
    root = createRoot(container);
  });
});
