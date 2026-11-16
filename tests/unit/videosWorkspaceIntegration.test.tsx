// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideosView } from "../../src/app/App";
import { ToastHost } from "../../src/app/components/ToastHost";
import { importPromptBatch } from "../../src/domain/batches/importBatch";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { ImportPreviewSession } from "../../src/app/features/shared/importPreviewSession";
import type { FoundationClient } from "../../src/shared/messageClient";
import type { PromptBatchSnapshot } from "../../src/storage/repositories";
import type { ReferenceAssignmentRecord } from "../../src/domain/media/references";
import type { SelectedTargetRecord } from "../../src/storage/db";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
} from "../../src/platforms/shared/contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  globalThis.URL.createObjectURL = vi.fn(() => "blob:reference-preview");
  globalThis.URL.revokeObjectURL = vi.fn();
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

function makePromptBatch(
  kind: "image" | "video",
  batchId: string,
  sourceText: string,
): PromptBatchSnapshot {
  const parsed = importPromptBatch(sourceText, kind);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const items = parsed.items.map((item, order) => ({
    id: `${batchId}:item:${order}`,
    batchId,
    workspaceId: "default",
    kind,
    order,
    shotId: item.shotId,
    identitySource: item.identitySource,
    rawJsonBody: item.rawBody,
    sourceSpan: item.sourceSpan,
    measurement: item.measurement,
    contentHash: "a".repeat(64),
    createdAt: 10,
  }));
  return {
    batch: {
      id: batchId,
      workflowId: "default",
      workspaceId: "default",
      kind,
      status: "draft",
      sourceText,
      sourceMode: parsed.mode,
      orderedItemIds: items.map((item) => item.id),
      total: parsed.total,
      updatedAt: 10,
    },
    items,
  } as PromptBatchSnapshot;
}

const target: SelectedTargetRecord = {
  provider: "Flow",
  tabId: 71,
  canonicalTarget: "https://flow.google.com/project/videos-review-project",
  verification: "verified",
  connectionState: "verified",
  updatedAt: 10,
  verificationBinding: {
    provider: "Flow",
    tabId: 71,
    canonicalTarget: "https://flow.google.com/project/videos-review-project",
    projectId: "videos-review-project",
    documentId: "videos-review-document",
    frameId: 0,
    documentToken: "videos-review-token",
    extensionBuildId: BUILD_ID,
    extensionProtocolVersion: PROTOCOL_VERSION,
    connectorBuildId: BUILD_ID,
    connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
    capability: CONNECTION_CAPABILITY,
    verifiedAt: 10,
  },
};

describe("Videos workspace integration with mocked storage and connection", () => {
  it("keeps Prepare gated until validated, saved, paired, and manually confirmed", async () => {
    const session = new ImportPreviewSession("video");
    const imageSource = '{"shot_id":"1","prompt":"Reference source"}';
    const imageBatch = makePromptBatch("image", "import:default:image", imageSource);
    const referenceId = "00000000-0000-4000-8000-000000000071";
    const imageHash = await sha256Hex(imageSource);
    const reference: Omit<ReferenceAssignmentRecord, "bytes"> = {
      assignmentId: "default:import:default:image:1",
      referenceId,
      captureOperationId: "10000000-0000-4000-8000-000000000071",
      workspaceId: "default",
      batchId: "import:default:image",
      batchSourceHash: imageHash,
      shotId: "1",
      promptHash: "b".repeat(64),
      selectionVersion: "20000000-0000-4000-8000-000000000071",
      assignmentVersion: 1,
      flowProjectId: "videos-review-project",
      tabId: target.tabId,
      canonicalTarget: target.canonicalTarget,
      documentId: "videos-review-document",
      observedSourceSha256: "c".repeat(64),
      mimeType: "image/png",
      byteSize: 4,
      sha256: "d".repeat(64),
      width: 64,
      height: 64,
      capturedAt: 10,
      acquisitionProvenance: "verified_flow_document_same_origin_fetch",
      qualityProvenance: "observed_resource_original_bytes_no_upscale",
    };
    let savedVideoBatch: PromptBatchSnapshot | null = null;
    const request = vi.fn(async (type: string, args?: Record<string, unknown>) => {
      if (type === "connections.getSelection") return target;
      if (type === "videoBatch.getPrepared") return null;
      if (type === "promptBatch.get") {
        return args?.kind === "image" ? imageBatch : savedVideoBatch;
      }
      if (type === "flow.reference.getState") {
        return { savedReferences: [reference] };
      }
      if (type === "flow.reference.getSavedReference") {
        return { reference, data: btoa("1234") };
      }
      if (type === "promptBatch.put") {
        savedVideoBatch = makePromptBatch(
          "video",
          "import:default:video",
          String(args?.sourceText ?? ""),
        );
        return savedVideoBatch;
      }
      if (type === "videoBatch.prepare") return null;
      return null;
    });
    const persistenceClient = { request } as unknown as FoundationClient;

    function Harness() {
      const [destination, setDestination] = useState<"Flow" | "Vids">("Flow");
      const [confirmed, setConfirmed] = useState(false);
      const [wrapLines, setWrapLines] = useState(false);
      const [editorExpanded, setEditorExpanded] = useState(false);
      return createElement(
        ToastHost,
        null,
        createElement(VideosView, {
          session,
          persistenceClient,
          wrapLines,
          setWrapLines,
          editorExpanded,
          setEditorExpanded,
          destination,
          setDestination,
          confirmed,
          setConfirmed,
        }),
      );
    }

    await act(async () => {
      root?.render(createElement(Harness));
      await Promise.resolve();
    });

    const prepareButton = () =>
      Array.from(container!.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Prepare video batch",
      )!;
    expect(prepareButton().disabled).toBe(true);
    expect(container?.textContent).toContain(
      "Save and validate a video prompt batch first.",
    );
    expect(container?.querySelectorAll("input[type=file]")).toHaveLength(1);
    expect(container?.textContent).toContain("Expand editor");

    const invalidSource = "{";
    await act(async () => {
      session.setSource(invalidSource);
    });
    const textarea = container?.querySelector(
      "#video-import-source",
    ) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 1);
    textarea.scrollTop = 24;
    await act(async () => {
      Array.from(container!.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Validate & Preview"))
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "incomplete",
    );
    expect(prepareButton().disabled).toBe(true);

    const longScene = "Long prompt segment. ".repeat(500);
    const sourceText = JSON.stringify({ shot_id: "1", scene: longScene });
    await act(async () => {
      session.setSource(sourceText);
    });
    await act(async () => {
      Array.from(container!.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Validate & Preview"))
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(textarea.value).toBe(sourceText);
    expect(container?.textContent).toContain("Validated preview");
    const saveButton = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save validated batch",
    )!;
    expect(saveButton.disabled).toBe(false);
    textarea.focus();
    textarea.setSelectionRange(5, 10);
    textarea.scrollTop = 24;
    await act(async () => {
      saveButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("Saved.");
    expect(request).toHaveBeenCalledWith(
      "promptBatch.put",
      expect.objectContaining({ kind: "video", sourceText }),
    );
    expect(textarea).toBe(container?.querySelector("#video-import-source"));
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(10);
    expect(textarea.scrollTop).toBe(24);

    const pairButton = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Pair with this Image Source"),
    );
    expect(pairButton).toBeDefined();
    await act(async () => {
      pairButton?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("All 1 video shots successfully paired");
    expect(prepareButton().disabled).toBe(true);
    expect(container?.textContent).toContain(
      "Confirm manual Flow settings before preparing.",
    );

    const confirmation = container?.querySelector(
      "#video-settings-confirm",
    ) as HTMLInputElement;
    await act(async () => {
      confirmation.click();
    });
    expect(prepareButton().disabled).toBe(false);
    await act(async () => {
      prepareButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith(
      "videoBatch.prepare",
      expect.objectContaining({ destination: "Flow" }),
    );
    expect(
      request.mock.calls.some(([type]) =>
        ["flow.videoQueue.start", "flow.video.generateOnce"].includes(type),
      ),
    ).toBe(false);
  });
});
