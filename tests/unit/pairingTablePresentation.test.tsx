// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PairingTable } from "../../src/app/features/video-batch/PairingTable";
import type { FoundationClient } from "../../src/shared/messageClient";
import type { PromptBatchSnapshot } from "../../src/storage/repositories";
import { sha256Hex } from "../../src/storage/repositories";
import type { ReferenceAssignmentRecord } from "../../src/domain/media/references";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  globalThis.URL.createObjectURL = vi.fn(
    () => `blob:mock-thumbnail-${Math.random()}`,
  );
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

function makeTestVideoBatch(
  shots: Array<{ shotId?: string; scene: string }>,
  batchId = "import:default:video",
): PromptBatchSnapshot {
  const items = shots.map((s, idx) => ({
    id: `${batchId}:item:${idx}`,
    batchId,
    workspaceId: "default",
    kind: "video" as const,
    order: idx,
    shotId: s.shotId,
    rawJsonBody: JSON.stringify({ scene: s.scene, shot_id: s.shotId }),
    sourceSpan: { start: 0, end: 100 },
    measurement: { stringCodeUnits: 100, utf8Bytes: 100 },
    contentHash: `hash-${idx}`,
    createdAt: 1000,
  }));

  return {
    batch: {
      id: batchId,
      workflowId: "default",
      workspaceId: "default",
      kind: "video",
      status: "draft",
      sourceText: "synthetic-video-source",
      sourceMode: "numbered_json_blocks",
      orderedItemIds: items.map((i) => i.id),
      total: { stringCodeUnits: 200, utf8Bytes: 200 },
      updatedAt: 1000,
    },
    items,
  };
}

function makeSavedReference(
  shotId: string,
  overrides: Partial<Omit<ReferenceAssignmentRecord, "bytes">> = {},
): Omit<ReferenceAssignmentRecord, "bytes"> {
  const suffix = shotId.padStart(12, "0");
  return {
    assignmentId: `default:import:default:image:${shotId}`,
    referenceId: `00000000-0000-4000-8000-${suffix}`,
    captureOperationId: `10000000-0000-4000-8000-${suffix}`,
    workspaceId: "default",
    batchId: "import:default:image",
    batchSourceHash: "a".repeat(64),
    shotId,
    promptHash: "b".repeat(64),
    selectionVersion: `20000000-0000-4000-8000-${suffix}`,
    assignmentVersion: 1,
    flowProjectId: "project-1",
    tabId: 101,
    canonicalTarget: "https://flow.google.com/project/project-1",
    documentId: "document-1",
    observedSourceSha256: "c".repeat(64),
    mimeType: "image/png",
    byteSize: 4,
    sha256: "d".repeat(64),
    width: 256,
    height: 256,
    capturedAt: 10_000,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch",
    qualityProvenance: "observed_resource_original_bytes_no_upscale",
    ...overrides,
  };
}

describe("PairingTable UI presentation", () => {
  it("renders warning when video draft is modified or not ready", async () => {
    const videoBatch = makeTestVideoBatch([{ shotId: "1", scene: "First" }]);
    const mockClient = {
      request: vi.fn(),
    } as unknown as FoundationClient;

    await act(async () => {
      root!.render(
        createElement(PairingTable, {
          persistenceClient: mockClient,
          videoBatch,
          videoSourceReady: false,
          onNavigateToReferences: vi.fn(),
        }),
      );
    });

    expect(container?.textContent).toContain(
      "Save or validate a video prompt draft to review its pairing",
    );
  });

  it("requires explicit image-source selection before computing review", async () => {
    const videoBatch = makeTestVideoBatch([
      { shotId: "1", scene: "Scene 1" },
      { shotId: "2", scene: "Scene 2" },
    ]);
    const imageSourceText = "image-source";
    const imageHash = await sha256Hex(imageSourceText);
    const ref1 = makeSavedReference("1", { batchSourceHash: imageHash });
    const ref2 = makeSavedReference("2", { batchSourceHash: imageHash });

    const mockClient = {
      request: vi.fn(async (type: string) => {
        if (type === "promptBatch.get") {
          return {
            batch: {
              id: "import:default:image",
              sourceText: imageSourceText,
            },
            items: [
              { id: "item-1", shotId: "1" },
              { id: "item-2", shotId: "2" },
            ],
          };
        }
        if (type === "flow.reference.getState") {
          return {
            savedReferences: [ref1, ref2],
          };
        }
        return undefined;
      }),
    } as unknown as FoundationClient;

    await act(async () => {
      root!.render(
        createElement(PairingTable, {
          persistenceClient: mockClient,
          videoBatch,
          videoSourceReady: true,
          onNavigateToReferences: vi.fn(),
        }),
      );
    });

    // Before explicit selection, the available image source is displayed with an action button
    expect(container?.textContent).toContain("Available saved image source:");
    expect(container?.textContent).toContain("import:default:image");
    expect(container?.textContent).toContain("Pair with this Image Source");
    expect(container?.textContent).toContain(
      "Select the image reference source above to review Shot pairing",
    );

    // Click "Pair with this Image Source"
    const pairButton = Array.from(container!.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Pair with this Image Source"),
    );
    expect(pairButton).toBeDefined();

    await act(async () => {
      pairButton?.click();
    });

    // Now pairing review is shown
    expect(container?.textContent).toContain("Matched Pairs");
    expect(container?.textContent).toContain("Valid Pair");
    expect(container?.textContent).toContain(
      "All 2 video shots successfully paired",
    );
  });

  it("renders expandable prompt disclosure and saved thumbnails with URL cleanup", async () => {
    const videoBatch = makeTestVideoBatch([
      { shotId: "1", scene: "Detailed dialogue scene with long description" },
    ]);
    const imageSourceText = "img-source";
    const imageHash = await sha256Hex(imageSourceText);
    const ref1 = makeSavedReference("1", { batchSourceHash: imageHash });

    // 4 base64 characters representing 4 bytes
    const base64Data = btoa("1234");

    const mockClient = {
      request: vi.fn(async (type: string) => {
        if (type === "promptBatch.get") {
          return {
            batch: {
              id: "import:default:image",
              sourceText: imageSourceText,
            },
            items: [{ id: "item-1", shotId: "1" }],
          };
        }
        if (type === "flow.reference.getState") {
          return {
            savedReferences: [ref1],
          };
        }
        if (type === "flow.reference.getSavedReference") {
          return {
            reference: ref1,
            data: base64Data,
          };
        }
        return undefined;
      }),
    } as unknown as FoundationClient;

    await act(async () => {
      root!.render(
        createElement(PairingTable, {
          persistenceClient: mockClient,
          videoBatch,
          videoSourceReady: true,
          onNavigateToReferences: vi.fn(),
        }),
      );
    });

    // Explicitly pair
    const pairBtn = Array.from(container!.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Pair with this Image Source"),
    );
    await act(async () => {
      pairBtn?.click();
    });

    // Check thumbnail loaded via createObjectURL
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    const img = container?.querySelector("img");
    expect(img).toBeDefined();
    expect(img?.getAttribute("alt")).toBe("Saved reference for Shot 1");

    // Check expandable disclosure (<details>)
    const details = container?.querySelector("details");
    expect(details).toBeDefined();
    expect(details?.querySelector("summary")?.textContent).toContain(
      "Raw video prompt",
    );
    expect(details?.querySelector("pre")?.textContent).toContain(
      "Detailed dialogue scene with long description",
    );

    // Unmount triggers revokeObjectURL
    await act(async () => {
      root?.unmount();
      root = null;
    });

    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("navigates to References workspace when Go to References button is clicked", async () => {
    const videoBatch = makeTestVideoBatch([{ shotId: "1", scene: "Scene 1" }]);
    const mockNavigate = vi.fn();
    const mockClient = {
      request: vi.fn(async (type: string) => {
        if (type === "promptBatch.get") return null;
        return {};
      }),
    } as unknown as FoundationClient;

    await act(async () => {
      root!.render(
        createElement(PairingTable, {
          persistenceClient: mockClient,
          videoBatch,
          videoSourceReady: true,
          onNavigateToReferences: mockNavigate,
        }),
      );
    });

    const goRefBtn = Array.from(container!.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Go to References"),
    );
    expect(goRefBtn).toBeDefined();

    await act(async () => {
      goRefBtn?.click();
    });

    expect(mockNavigate).toHaveBeenCalledOnce();
  });

  it("displays structured error when an intended pair has no saved reference", async () => {
    const videoBatch = makeTestVideoBatch([
      { shotId: "1", scene: "Has reference" },
      { shotId: "2", scene: "Missing reference" },
    ]);
    const imageSourceText = "src";
    const imageHash = await sha256Hex(imageSourceText);
    const ref1 = makeSavedReference("1", { batchSourceHash: imageHash });

    const mockClient = {
      request: vi.fn(async (type: string) => {
        if (type === "promptBatch.get") {
          return {
            batch: { id: "import:default:image", sourceText: imageSourceText },
            items: [{ id: "item-1", shotId: "1" }],
          };
        }
        if (type === "flow.reference.getState") {
          return {
            savedReferences: [ref1],
          };
        }
        return undefined;
      }),
    } as unknown as FoundationClient;

    await act(async () => {
      root!.render(
        createElement(PairingTable, {
          persistenceClient: mockClient,
          videoBatch,
          videoSourceReady: true,
          onNavigateToReferences: vi.fn(),
        }),
      );
    });

    const pairBtn = Array.from(container!.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Pair with this Image Source"),
    );
    await act(async () => {
      pairBtn?.click();
    });

    expect(container?.textContent).toContain("Invalid Pair");
    expect(container?.textContent).toContain(
      'No saved reference assignment found for Shot ID "2"',
    );
    expect(container?.textContent).toContain(
      "1 video Shot cannot be paired. Resolve the issue before proceeding.",
    );
  });
});
