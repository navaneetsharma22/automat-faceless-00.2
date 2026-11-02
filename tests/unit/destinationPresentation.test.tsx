// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Destination } from "../../src/app/features/video-batch/Destination";
import { PreparedBatchReview } from "../../src/app/features/video-batch/PreparedBatchReview";
import type { createFoundationClient } from "../../src/shared/messageClient";
import type { PreparedVideoBatchRecord } from "../../src/domain/batches/types";
import type { SelectedTargetRecord } from "../../src/storage/db";

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

describe("P08.3 Destination and manual settings confirmation UI", () => {
  it("renders exclusive Flow and Vids choices and highlights selected provider", () => {
    const onSelectDestination = vi.fn();
    const onDeclaredDurationChange = vi.fn();
    const onConfirmationChange = vi.fn();

    const target: SelectedTargetRecord = {
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/proj-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
      verificationBinding: {
        provider: "Flow",
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/proj-1",
        projectId: "proj-1",
        documentId: "doc-1",
        frameId: 0,
        documentToken: "tok-1",
        extensionBuildId: "b-1",
        extensionProtocolVersion: 1,
        connectorBuildId: "b-1",
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: 10_000,
      },
    };

    act(() => {
      root?.render(
        createElement(Destination, {
          destination: "Flow",
          onSelectDestination,
          connectedTarget: target,
          declaredDuration: "6",
          onDeclaredDurationChange,
          confirmed: false,
          onConfirmationChange,
          disabled: false,
        }),
      );
    });

    const flowRadio = container?.querySelector("input[value='Flow']") as HTMLInputElement;
    const vidsRadio = container?.querySelector("input[value='Vids']") as HTMLInputElement;

    expect(flowRadio).not.toBeNull();
    expect(vidsRadio).not.toBeNull();
    expect(flowRadio.checked).toBe(true);
    expect(vidsRadio.checked).toBe(false);

    // Select Vids
    act(() => {
      vidsRadio.click();
    });
    expect(onSelectDestination).toHaveBeenCalledWith("Vids");
  });

  it("displays provider-specific confirmation wording with 'this batch'", () => {
    const target: SelectedTargetRecord = {
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/proj-1",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    };

    act(() => {
      root?.render(
        createElement(Destination, {
          destination: "Flow",
          onSelectDestination: vi.fn(),
          connectedTarget: target,
          declaredDuration: "8",
          onDeclaredDurationChange: vi.fn(),
          confirmed: false,
          onConfirmationChange: vi.fn(),
        }),
      );
    });

    const confirmLabel = container?.querySelector("label[for='video-settings-confirm']");
    expect(confirmLabel?.textContent).toContain(
      "I manually selected and checked the settings in Flow for this batch.",
    );
  });

  it("shows unverified warning when selected provider has no verified target", () => {
    const target: SelectedTargetRecord = {
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/proj-1",
      verification: "unverified",
      connectionState: "disconnected",
      updatedAt: 10_000,
    };

    act(() => {
      root?.render(
        createElement(Destination, {
          destination: "Flow",
          onSelectDestination: vi.fn(),
          connectedTarget: target,
          declaredDuration: "6",
          onDeclaredDurationChange: vi.fn(),
          confirmed: false,
          onConfirmationChange: vi.fn(),
        }),
      );
    });

    expect(container?.textContent).toContain("Not connected / Unverified");
    expect(container?.textContent).toContain(
      "Connect and verify a Flow project in Connections before preparing.",
    );
  });

  it("updates declared batch duration without provider inference or modification", () => {
    const onDeclaredDurationChange = vi.fn();
    const target: SelectedTargetRecord = {
      provider: "Vids",
      tabId: 202,
      canonicalTarget: "https://docs.google.com/videos/d/vids-doc/edit",
      verification: "verified",
      connectionState: "verified",
      updatedAt: 10_000,
    };

    act(() => {
      root?.render(
        createElement(Destination, {
          destination: "Vids",
          onSelectDestination: vi.fn(),
          connectedTarget: target,
          declaredDuration: "6",
          onDeclaredDurationChange,
          confirmed: false,
          onConfirmationChange: vi.fn(),
        }),
      );
    });

    const durationInput = container?.querySelector("#batch-duration-input") as HTMLInputElement;
    expect(durationInput).not.toBeNull();
    expect(durationInput.value).toBe("6");

    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(durationInput, "8");
      durationInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onDeclaredDurationChange).toHaveBeenCalledWith("8");
  });
});

describe("P08.3 PreparedBatchReview presentation UI", () => {
  const mockPreparedBatch: PreparedVideoBatchRecord = {
    id: "prepared:default:req-12345",
    requestId: "req-12345",
    workspaceId: "default",
    preparedAt: 1600000000000,
    videoBatchId: "import:default:video",
    videoSourceHash: "abc123hash",
    videoSourceText: '1: {"scene":"Tiger leaping across stream"}',
    imageSourceBatchId: "import:default:image",
    imageSourceBatchHash: "def456hash",
    destination: "Flow",
    target: {
      provider: "Flow",
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/proj-1",
      projectId: "proj-1",
      verification: "verified",
      verifiedAt: 1600000000000,
    },
    manualSettingsDeclaration: {
      confirmationId: "conf-1",
      confirmedAt: 1600000000000,
      destination: "Flow",
      declaredDurationSeconds: 8,
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/proj-1",
      projectId: "proj-1",
    },
    status: "prepared",
    itemCount: 1,
    items: [
      {
        itemId: "import:default:video:item:0",
        order: 0,
        shotId: "1",
        canonicalShotId: "1",
        rawJsonBody: '{"scene":"Tiger leaping across stream"}',
        contentHash: "hash-item-1",
        sourceSpan: { start: 3, end: 41 },
        reference: {
          referenceId: "00000000-0000-4000-8000-000000000001",
          assignmentVersion: 1,
          sha256: "ref-sha-256",
          mimeType: "image/png",
          byteSize: 1024,
          width: 512,
          height: 512,
          capturedAt: 1599999990000,
        },
      },
    ],
    createdAt: 1600000000000,
    updatedAt: 1600000000000,
  };

  const mockPersistenceClient = {
    request: vi.fn(async (type: string) => {
      if (type === "flow.reference.getSavedReference") {
        return {
          referenceId: "00000000-0000-4000-8000-000000000001",
          bytes: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        };
      }
      return null;
    }),
  } as unknown as ReturnType<typeof createFoundationClient>;

  it("renders 'Prepared — not submitted to Flow/Vids.' banner", () => {
    act(() => {
      root?.render(
        createElement(PreparedBatchReview, {
          preparedBatch: mockPreparedBatch,
          persistenceClient: mockPersistenceClient,
        }),
      );
    });

    expect(container?.textContent).toContain(
      "Prepared — not submitted to Flow/Vids.",
    );
  });

  it("offers one Flow queue start action without per-shot action buttons", () => {
    act(() => {
      root?.render(
        createElement(PreparedBatchReview, {
          preparedBatch: mockPreparedBatch,
          persistenceClient: mockPersistenceClient,
        }),
      );
    });

    expect(container?.textContent).toContain("Flow video queue");

    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    const buttonTexts = buttons.map((b) => b.textContent?.trim());
    expect(buttonTexts).not.toContain("Generate");
    expect(buttonTexts).toContain("Start");
    expect(buttonTexts.filter((text) => text === "Start")).toHaveLength(1);
    expect(buttonTexts).not.toContain("Attach reference");
    expect(buttonTexts).not.toContain("Submit");
  });

  it("offers read-only inspection and the explicit server-side recheck action for a blocked mismatch", async () => {
    const queue = {
      queueId: "flow-video:prepared:default:req-12345", preparedBatchId: "prepared:default:req-12345", state: "paused",
      pauseReason: "candidate_bytes_mismatch", nextActionAt: null, revision: 4,
      items: [{ itemId: "import:default:video:item:0", order: 0, shotId: "1", referenceId: "00000000-0000-4000-8000-000000000001", promptHash: "x".repeat(64), state: "failed", reason: "candidate_bytes_mismatch" }],
    };
    const inspected = {
      status: "inspected", matches: false,
      diagnostic: {
        stage: "read_only_reference_inspection", acquisitionRoute: "verified_document_same_origin",
        preparedSha256: "a".repeat(64), metadataSha256: "a".repeat(64), savedBytesSha256: "a".repeat(64),
        candidateBytesSha256: "b".repeat(64), candidateMediaId: "67b8fc4f-e688-4a9b-8cc1-472ff37738d8",
        mimeType: "image/png", preparedByteSize: 4, savedByteSize: 4, candidateByteSize: 3,
        preparedWidth: 1, preparedHeight: 1, candidateWidth: 1, candidateHeight: 1,
      },
    };
    const request = vi.fn(async (type: string) => type === "flow.videoQueue.get" ? queue : type === "flow.video.inspectReferenceBytes" ? inspected : type === "flow.videoQueue.recheckAndResume" ? queue : null);
    const client = { request } as unknown as ReturnType<typeof createFoundationClient>;
    await act(async () => {
      root?.render(createElement(PreparedBatchReview, { preparedBatch: mockPreparedBatch, persistenceClient: client }));
      await Promise.resolve();
    });
    const inspectButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("Inspect reference bytes"));
    expect(inspectButton).toBeDefined();
    const recheckButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("Recheck & Resume"));
    expect(recheckButton).toBeDefined();
    expect(Array.from(container?.querySelectorAll("button") ?? []).some((button) => button.textContent?.trim() === "Resume")).toBe(false);
    await act(async () => { inspectButton?.click(); await Promise.resolve(); });
    expect(container?.textContent).toContain("Fetched bytes differ from the prepared reference");
    expect(request).toHaveBeenCalledWith("flow.video.inspectReferenceBytes", { preparedBatchId: "prepared:default:req-12345", itemId: "import:default:video:item:0" });
    expect(request.mock.calls.some(([type]) => type === "flow.videoQueue.resume" || type === "flow.videoQueue.start" || type === "flow.video.attachReference" || type === "flow.video.generateOnce")).toBe(false);
    expect(request.mock.calls.some(([type]) => type === "flow.videoQueue.recheckAndResume")).toBe(false);
    await act(async () => { recheckButton?.click(); await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith("flow.videoQueue.recheckAndResume", { preparedBatchId: "prepared:default:req-12345", expectedRevision: 4 });
  });

  it("exposes exact Shot 2 pre-Add reconciliation and then a separate Resume action", async () => {
    const batchId = "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179";
    const shotTwoRef = "e8c9315f-f79a-45c6-8184-4fddfce541ce";
    const base = {
      queueId: `flow-video:${batchId}`, preparedBatchId: batchId, state: "paused", pauseReason: "candidate_missing_or_virtualized", nextActionAt: null, revision: 9,
      items: [
        { itemId: "import:default:video:item:0", order: 0, shotId: "1", referenceId: "014ebcff-06e3-4ac2-b980-568f0755febf", promptHash: "a".repeat(64), state: "sent", attemptId: "shot-one" },
        { itemId: "import:default:video:item:1", order: 1, shotId: "2", referenceId: shotTwoRef, promptHash: "b".repeat(64), state: "uncertain", reason: "candidate_missing_or_virtualized" },
      ],
    };
    let reconciled = false;
    const request = vi.fn(async (type: string) => {
      if (type === "flow.videoQueue.get") return base;
      if (type === "flow.videoQueue.reconcilePreAddFailure") {
        reconciled = true;
        return { ...base, state: "paused", pauseReason: "pre_add_failure_reconciled", revision: 10,
          items: [base.items[0], { ...base.items[1], state: "pending", reason: undefined, priorReason: "candidate_missing_or_virtualized" }] };
      }
      return null;
    });
    const client = { request } as unknown as ReturnType<typeof createFoundationClient>;
    const preparedBatch = { ...mockPreparedBatch, id: batchId };
    await act(async () => {
      root?.render(createElement(PreparedBatchReview, { preparedBatch, persistenceClient: client }));
      await Promise.resolve();
    });
    const reconcile = Array.from(container?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("Reconcile Shot 2 pre-Add failure"));
    expect(reconcile).toBeDefined();
    await act(async () => { reconcile?.click(); await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith("flow.videoQueue.reconcilePreAddFailure", { preparedBatchId: batchId, expectedRevision: 9 });
    expect(container?.textContent).toContain("Resume is a separate action");
    expect(Array.from(container?.querySelectorAll("button") ?? []).some((button) => button.textContent?.trim() === "Resume")).toBe(true);
    expect(reconciled).toBe(true);
    expect(request.mock.calls.some(([type]) => type === "flow.videoQueue.resume" || type === "flow.video.attachReference" || type === "flow.video.generateOnce")).toBe(false);
  });

  it("displays metadata grid with destination, target, declared duration, and expandable JSON", () => {
    act(() => {
      root?.render(
        createElement(PreparedBatchReview, {
          preparedBatch: mockPreparedBatch,
          persistenceClient: mockPersistenceClient,
        }),
      );
    });

    expect(container?.textContent).toContain("Flow");
    expect(container?.textContent).toContain("https://flow.google.com/project/proj-1");
    expect(container?.textContent).toContain("8s");
    expect(container?.textContent).toContain("User-declared whole-batch metadata");
    expect(container?.textContent).toContain("Shot 1");
    expect(container?.textContent).toContain('{"scene":"Tiger leaping across stream"}');
  });
});
