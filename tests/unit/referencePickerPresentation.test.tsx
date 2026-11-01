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

async function setup() {
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
  let active = false;
  let chosen = false;
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
          items: [
            {
              id: "item-1",
              shotId: "34",
              order: 0,
              rawJsonBody: '{"shot_id":"34"}',
            },
          ],
        };
      if (type === "connections.getSelection")
        return { verification: "verified", connectionState: "verified" };
      if (type === "flow.reference.getState")
        return {
          activeSession: active
            ? {
                sessionId: "session-1",
                shotId: "34",
                projectId: "project-1",
                tabId: 101,
              }
            : null,
          candidates: chosen ? { "34": candidate } : {},
        };
      if (type === "flow.reference.startSelection") {
        active = true;
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
        chosen = true;
        active = false;
        return { accepted: true, candidate };
      }
      if (type === "flow.reference.cancelSelection") {
        active = false;
        return { cancelled: true };
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
  return {
    request,
    click,
    setList: (fn: typeof listResponse) => {
      listResponse = fn;
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
    expect(container.textContent).toContain(
      "Image capture and saving are not implemented",
    );
    expect(container.textContent).not.toContain("Flow images for Shot 34");
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
