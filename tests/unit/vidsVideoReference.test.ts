// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { CONNECTOR_PROTOCOL_VERSION } from "../../src/platforms/shared/contracts";
import { createVidsVideoAttachmentHandler } from "../../src/background/handlers/vidsVideoAttachment";
import { inspectVidsAiComposerInPage } from "../../src/platforms/vids/composer";
import { sha256Bytes } from "../../src/domain/media/references";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsConfirmation } from "../../src/app/components/SettingsConfirmation";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PreparedBatchReview } from "../../src/app/features/video-batch/PreparedBatchReview";
import type { createFoundationClient } from "../../src/shared/messageClient";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import { makeRequest } from "../../src/shared/messages";
import { ChromePreferenceRepository } from "../../src/storage/repositories";

const batchId = "prepared:workspace-1:vids-request";
const itemId = "video-item-1";
const referenceId = "11111111-1111-4111-8111-111111111111";
const documentId = "vids-document-1";
const canonicalTarget = `https://docs.google.com/videos/d/${documentId}/edit`;
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOo1nX+DwAD/QHrf7yFWAAAAABJRU5ErkJggg=="), (value) => value.charCodeAt(0));

async function setup(options: {
  injectedDocumentId?: string;
  inspectionState?: "ready" | "existing_preview_unbound" | "missing" | "ambiguous";
  uploadThrows?: boolean;
  uploadSuccess?: boolean;
  changePinnedBytes?: boolean;
  wrongAssignmentReference?: boolean;
  changeTargetAfterUpload?: boolean;
} = {}) {
  const database = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(database, () => 1000);
  const sha256 = await sha256Bytes(options.changePinnedBytes ? Uint8Array.from([...png, 0]) : png);
  const reference = {
    assignmentId: "workspace-1:image-batch:1", referenceId: options.wrongAssignmentReference ? "99999999-9999-4999-8999-999999999999" : referenceId,
    captureOperationId: "22222222-2222-4222-8222-222222222222", workspaceId: "workspace-1",
    batchId: "image-batch", batchSourceHash: "a".repeat(64), shotId: "1", promptHash: "b".repeat(64),
    selectionVersion: "33333333-3333-4333-8333-333333333333", assignmentVersion: 1,
    flowProjectId: "flow-project", tabId: 44, canonicalTarget: "https://flow.google.com/project/flow-project",
    documentId: "flow-document", observedSourceSha256: "c".repeat(64), providerAssetId: "asset-1",
    bytes: new Blob([png as BlobPart], { type: "image/png" }), mimeType: "image/png" as const,
    byteSize: png.length, sha256, width: 1, height: 1, capturedAt: 1,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch" as const,
    qualityProvenance: "observed_resource_original_bytes_no_upscale" as const,
  };
  const prepared = {
    id: batchId, requestId: "44444444-4444-4444-8444-444444444444", workspaceId: "workspace-1", preparedAt: 1,
    videoBatchId: "video-batch", videoSourceHash: "d".repeat(64), videoSourceText: "[]", imageSourceBatchId: "image-batch", imageSourceBatchHash: "a".repeat(64),
    destination: "Vids" as const,
    target: { provider: "Vids" as const, tabId: 90, canonicalTarget, projectId: documentId, documentId, verification: "verified" as const, verifiedAt: 1 },
    manualSettingsDeclaration: { confirmationId: "confirmed-once", confirmedAt: 1, destination: "Vids" as const, declaredDurationSeconds: 8, tabId: 90, canonicalTarget, projectId: documentId, documentId },
    status: "prepared" as const, itemCount: 1,
    items: [{ itemId, order: 0, canonicalShotId: "1", rawJsonBody: '{"shot_id":"1","prompt_type":"video","prompt":"keep exact"}', contentHash: "e".repeat(64), sourceSpan: { start: 0, end: 10 }, reference: { referenceId, assignmentVersion: 1, sha256, mimeType: "image/png", byteSize: png.length, width: 1, height: 1, capturedAt: 1 } }],
    createdAt: 1, updatedAt: 1,
  };
  const target = {
    provider: "Vids" as const, tabId: 90, canonicalTarget, verification: "verified" as const, connectionState: "verified" as const, updatedAt: 1,
    verificationBinding: { provider: "Vids" as const, tabId: 90, canonicalTarget, projectId: documentId, frameId: 0 as const, documentId, documentToken: "token", extensionBuildId: BUILD_ID, extensionProtocolVersion: PROTOCOL_VERSION, connectorBuildId: BUILD_ID, connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION, capability: "read-only-connection-v1" as const, verifiedAt: 1 },
  };
  await database.referenceAssignments.put(reference);
  await database.preparedVideoBatches.put(prepared);
  await database.selectedTargets.put(target);
  const calls: Array<{ input: { func: (...args: never[]) => unknown; args?: unknown[]; target: { tabId: number; documentIds: string[] } } }> = [];
  const scripting = {
    executeScript: vi.fn(async (input: { func: (...args: never[]) => unknown; args?: unknown[]; target: { tabId: number; documentIds: string[] } }) => {
      calls.push({ input });
      if (input.func === inspectVidsAiComposerInPage) return [{ documentId: options.injectedDocumentId ?? documentId, result: { href: canonicalTarget, state: calls.length === 1 ? options.inspectionState ?? "ready" : "existing_preview_unbound", previewCount: 1, removalControlCount: 1, previewLoaded: true, previewWidth: 1, previewHeight: 1 } }];
      const payload = input.args?.[0] as { base64: string; sha256: string; byteSize: number; mimeType: string };
      const transferred = Uint8Array.from(atob(payload.base64), (value) => value.charCodeAt(0));
      if (transferred.length !== png.length || await sha256Bytes(transferred) !== payload.sha256 || payload.byteSize !== png.length || payload.mimeType !== "image/png") throw new Error("exact_file_payload_mismatch");
      if (options.uploadThrows) throw new Error("injected_reply_lost");
      if (options.changeTargetAfterUpload) await database.selectedTargets.put({ ...target, verificationBinding: { ...target.verificationBinding, documentId: "replaced-document" } });
      return [{ documentId, result: { ok: options.uploadSuccess !== false, submitted: true, href: canonicalTarget, previewLoaded: true, previewWidth: 1, previewHeight: 1, removalControlPresent: true, ...(options.uploadSuccess === false ? { reason: "uploaded_preview_timeout" } : {}) } }];
    }),
  };
  const handler = createVidsVideoAttachmentHandler({
    repositories, scripting, getTab: async (tabId) => ({ id: tabId, url: canonicalTarget }), revalidate: async () => undefined,
    now: () => 2000, makeUploadOperationId: () => "55555555-5555-4555-8555-555555555555",
  });
  return { database, repositories, handler, calls, scripting, sha256, prepared };
}

describe("P10.1 Google Vids prepared reference attachment", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("uses the existing single Vids batch settings confirmation with the requested wording", () => {
    const html = renderToStaticMarkup(createElement(SettingsConfirmation, { id: "vids-confirm", provider: "Vids", checked: true, onChange: () => undefined, contextLabel: "this batch" }));
    expect(html).toContain("I have manually configured the settings in Google Vids for this batch.");
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).toContain("does not inspect");
  });

  it("wires one explicit prepared Vids Attach reference action and displays its durable status", async () => {
    const fixture = await setup();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let uploaded = false;
    const request = vi.fn(async (type: string) => {
      if (type === "vids.video.getAttachmentStatus") return { status: uploaded ? "attached" : "not_started" };
      if (type === "vids.video.attachReference") { uploaded = true; return { status: "attached" }; }
      return null;
    });
    try {
      await act(async () => {
        root.render(createElement(PreparedBatchReview, { preparedBatch: fixture.prepared, persistenceClient: { request } as unknown as ReturnType<typeof createFoundationClient> }));
        await Promise.resolve();
      });
      expect(container.querySelector('[aria-labelledby="vids-review-title"]')).not.toBeNull();
      expect(container.textContent).toContain("Confirmed for this Vids batch and target");
      const attach = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Attach reference");
      expect(attach).toBeDefined();
      await act(async () => { attach?.click(); await Promise.resolve(); });
      expect(request).toHaveBeenCalledWith("vids.video.attachReference", { preparedBatchId: batchId, itemId });
      expect(request.mock.calls.some(([type]) => String(type).startsWith("flow."))).toBe(false);
      expect(container.textContent).toContain("Reference uploaded and bound to the verified Google Vids document.");
      expect(request.mock.calls.filter(([type]) => type === "vids.video.attachReference")).toHaveLength(1);
      expect(request.mock.calls.some(([type]) => type === "vids.video.generateOnce" || type === "flow.video.generateOnce" || type === "vids.video.enterPrompt")).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("routes Vids attachment and status only to Vids handlers without touching Flow operations or queue records", async () => {
    const fixture = await setup();
    const vidsAttach = vi.fn(async () => ({ status: "attached" }));
    const vidsGet = vi.fn(async () => ({ status: "attached" }));
    const flowAttach = vi.fn(async () => ({ status: "attached" }));
    const flowQueueGet = vi.fn(async () => null);
    const preferences = new ChromePreferenceRepository({ get: async () => ({}), set: async () => undefined });
    const listener = createConnectionMessageListener("vids-isolation-test", {
      repositories: fixture.repositories,
      preferences,
      vidsVideoAttachment: { attach: vidsAttach, get: vidsGet },
      flowVideoAttachment: { attach: flowAttach, inspectReferenceBytes: vi.fn(), verifyAttachedReference: vi.fn(), status: vi.fn(), reconcilePreClickFailure: vi.fn() },
      flowVideoQueue: { get: flowQueueGet, start: vi.fn(), pause: vi.fn(), resume: vi.fn(), recheckAndResume: vi.fn(), reconcilePreAddFailure: vi.fn(), stop: vi.fn() },
    });
    const sender = { id: "vids-isolation-test", url: "chrome-extension://vids-isolation-test/index.html" };
    const send = (type: "vids.video.attachReference" | "vids.video.getAttachmentStatus") => new Promise<unknown>((resolve) => {
      const request = makeRequest(type, { preparedBatchId: batchId, itemId }, `isolation-${type}`);
      listener(JSON.parse(JSON.stringify(request)), sender, resolve);
    });
    await send("vids.video.getAttachmentStatus");
    await send("vids.video.attachReference");
    expect(vidsGet).toHaveBeenCalledWith(batchId, itemId);
    expect(vidsAttach).toHaveBeenCalledWith(batchId, itemId);
    expect(flowAttach).not.toHaveBeenCalled();
    expect(flowQueueGet).not.toHaveBeenCalled();
    expect(await fixture.database.flowVideoQueues.toArray()).toEqual([]);
    expect(await fixture.database.vidsVideoAttachmentOperations.toArray()).toEqual([]);
  });

  it("inspects only the unique AI video clip Animate panel and ignores unrelated file inputs and canvas editor", () => {
    document.body.innerHTML = `<input type="file"><div role="textbox" aria-label="Document content" contenteditable="true"></div><aside role="complementary" aria-label="AI video clip"><button role="tab" aria-label="Animate" aria-selected="true">Animate</button><section role="tabpanel" aria-label="Animate"><button aria-label="Add image">Add image</button><input type="file" accept="image/png, image/jpeg"></section></aside>`;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 100, height: 24, top: 0, right: 100, bottom: 24, left: 0, toJSON: () => ({}) });
    expect(inspectVidsAiComposerInPage()).toMatchObject({ state: "ready", sidebarCount: 1, panelCount: 1, fileInputCount: 1, addImageCount: 1, previewCount: 0 });
  });

  it("uploads the exact prepared bytes once and persists a document/reference/hash binding", async () => {
    const fixture = await setup();
    const result = await fixture.handler.attach(batchId, itemId);
    expect(result.status).toBe("attached");
    expect(fixture.scripting.executeScript).toHaveBeenCalledTimes(3);
    expect(fixture.calls[1]!.input.target).toEqual({ tabId: 90, documentIds: [documentId] });
    const operation = await fixture.repositories.getVidsVideoAttachmentOperation((result.operation as { id: string }).id);
    expect(operation).toMatchObject({ status: "attached", referenceId, referenceSha256: fixture.sha256, documentId, canonicalTarget, tabId: 90, uploadEvidence: { mechanism: "verified_document_file_input", exactBytesSha256: fixture.sha256, byteSize: png.length, inputChangeDispatched: true, previewLoaded: true, previewWidth: 1, previewHeight: 1, removalControlPresent: true } });
    expect(JSON.stringify(operation)).not.toContain("blob:");
    expect(await fixture.database.flowVideoAttachmentOperations.toArray()).toEqual([]);
    expect(await fixture.database.flowVideoQueues.toArray()).toEqual([]);
    expect(await fixture.database.vidsVideoAttachmentOperations.toArray()).toHaveLength(1);
  });

  it.each([
    ["wrong document", { injectedDocumentId: "replaced-document" }],
    ["existing unbound preview", { inspectionState: "existing_preview_unbound" as const }],
    ["missing scoped panel", { inspectionState: "missing" as const }],
    ["ambiguous scoped panel", { inspectionState: "ambiguous" as const }],
  ])("blocks %s before file assignment", async (_name, options) => {
    const fixture = await setup(options);
    const result = await fixture.handler.attach(batchId, itemId);
    expect(result.status).toBe("not_started");
    expect(fixture.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(await fixture.repositories.getVidsVideoAttachmentOperation(`vids:${await sha256Hex(`${batchId}\u0000${itemId}`)}`)).toBeUndefined();
  });

  it("rejects corrupt stored bytes before target injection", async () => {
    const fixture = await setup({ changePinnedBytes: true });
    expect((await fixture.handler.attach(batchId, itemId)).reason).toBe("reference_bytes_integrity_failed");
    expect(fixture.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("rejects a changed prepared reference binding before upload", async () => {
    const fixture = await setup({ wrongAssignmentReference: true });
    expect((await fixture.handler.attach(batchId, itemId)).reason).toBe("prepared_reference_binding_mismatch");
    expect(fixture.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("does not repeat a completed upload after a duplicate request", async () => {
    const fixture = await setup();
    const first = await fixture.handler.attach(batchId, itemId);
    const second = await fixture.handler.attach(batchId, itemId);
    expect(first.status).toBe("attached");
    expect(second.status).toBe("attached");
    expect(fixture.scripting.executeScript).toHaveBeenCalledTimes(3);
  });

  it("keeps lost upload replies uncertain across handler recreation and never uploads again", async () => {
    const fixture = await setup({ uploadThrows: true });
    const first = await fixture.handler.attach(batchId, itemId);
    expect(first.status).toBe("uncertain");
    expect(fixture.scripting.executeScript).toHaveBeenCalledTimes(2);
    const restartedHandler = createVidsVideoAttachmentHandler({
      repositories: fixture.repositories, scripting: fixture.scripting,
      getTab: async (tabId) => ({ id: tabId, url: canonicalTarget }), revalidate: async () => undefined,
    });
    const second = await restartedHandler.attach(batchId, itemId);
    expect(second.status).toBe("uncertain");
    expect(fixture.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect((await fixture.repositories.getVidsVideoAttachmentOperation((first.operation as { id: string }).id))?.reason).toBe("vids_upload_delivery_uncertain");
  });

  it("does not claim success when the upload preview never becomes verifiable", async () => {
    const fixture = await setup({ uploadSuccess: false });
    const result = await fixture.handler.attach(batchId, itemId);
    expect(result.status).toBe("uncertain");
    expect(result.reason).toBe("uploaded_preview_timeout");
    expect((await fixture.repositories.getVidsVideoAttachmentOperation((result.operation as { id: string }).id))?.status).toBe("uncertain");
  });

  it("retains uncertain evidence when the selected Vids document changes before persistence", async () => {
    const fixture = await setup({ changeTargetAfterUpload: true });
    const result = await fixture.handler.attach(batchId, itemId);
    expect(result.status).toBe("uncertain");
    expect(result.reason).toBe("vids_target_changed_after_upload");
    expect((await fixture.repositories.getVidsVideoAttachmentOperation((result.operation as { id: string }).id))?.status).toBe("uncertain");
  });
});
