import { describe, expect, it, vi } from "vitest";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { CONNECTOR_PROTOCOL_VERSION } from "../../src/platforms/shared/contracts";
import { createVidsVideoGenerateHandler } from "../../src/background/handlers/vidsVideo";
import { enterVidsPromptInPage, activateVidsGenerateInPage } from "../../src/platforms/vids/video";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { sha256Bytes } from "../../src/domain/media/references";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import { makeRequest } from "../../src/shared/messages";
import { ChromePreferenceRepository } from "../../src/storage/repositories";

const preparedBatchId = "prepared:vids-workspace:volcano";
const itemId = "video-item-1";
const referenceId = "11111111-1111-4111-8111-111111111111";
const documentId = "vids-doc-1";
const canonicalTarget = `https://docs.google.com/videos/d/${documentId}/edit`;
const prompt = JSON.stringify({ shot_id: "1", prompt_type: "video", direction: "A volcano plume rises slowly over a distant ridge", detail: ["first line", "second line\nwith explicit newline"] }, null, 2);
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg=="), (value) => value.charCodeAt(0));

async function setup(options: {
  entryReason?: string;
  generateDisabled?: boolean;
  generateCount?: number;
  changeTargetBeforeIntent?: boolean;
  activationThrows?: boolean;
  injectedDocumentId?: string;
  wrongPromptHash?: boolean;
} = {}) {
  const database = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(database, () => 1000);
  const referenceSha256 = await sha256Bytes(png);
  const promptHash = await sha256Hex(prompt);
  const sourceHash = await sha256Hex(prompt);
  const reference = {
    assignmentId: "workspace:image:1", referenceId, captureOperationId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "workspace", batchId: "image-batch", batchSourceHash: "a".repeat(64), shotId: "1", promptHash: "b".repeat(64),
    selectionVersion: "33333333-3333-4333-8333-333333333333", assignmentVersion: 1, flowProjectId: "flow-project",
    tabId: 44, canonicalTarget: "https://flow.google.com/project/flow-project", documentId: "flow-document",
    observedSourceSha256: "c".repeat(64), providerAssetId: "asset-1", bytes: new Blob([png as BlobPart], { type: "image/png" }),
    mimeType: "image/png" as const, byteSize: png.length, sha256: referenceSha256, width: 1, height: 1, capturedAt: 1,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch" as const, qualityProvenance: "observed_resource_original_bytes_no_upscale" as const,
  };
  const prepared = {
    id: preparedBatchId, requestId: "44444444-4444-4444-8444-444444444444", workspaceId: "workspace", preparedAt: 1,
    videoBatchId: "video-batch", videoSourceHash: sourceHash, videoSourceText: prompt, imageSourceBatchId: "image-batch", imageSourceBatchHash: "a".repeat(64),
    destination: "Vids" as const,
    target: { provider: "Vids" as const, tabId: 90, canonicalTarget, projectId: documentId, documentId, verification: "verified" as const, verifiedAt: 1 },
    manualSettingsDeclaration: { confirmationId: "confirmed-once", confirmedAt: 1, destination: "Vids" as const, declaredDurationSeconds: 8, tabId: 90, canonicalTarget, projectId: documentId, documentId },
    status: "prepared" as const, itemCount: 1,
    items: [{ itemId, order: 0, shotId: "1", canonicalShotId: "1", rawJsonBody: prompt, contentHash: options.wrongPromptHash ? "e".repeat(64) : promptHash,
      sourceSpan: { start: 0, end: prompt.length }, reference: { referenceId, assignmentVersion: 1, sha256: referenceSha256, mimeType: "image/png", byteSize: png.length, width: 1, height: 1, capturedAt: 1 } }],
    createdAt: 1, updatedAt: 1,
  };
  const target = {
    provider: "Vids" as const, tabId: 90, canonicalTarget, verification: "verified" as const, connectionState: "verified" as const, updatedAt: 1,
    verificationBinding: { provider: "Vids" as const, tabId: 90, canonicalTarget, projectId: documentId, frameId: 0 as const, documentId, documentToken: "token", extensionBuildId: BUILD_ID, extensionProtocolVersion: PROTOCOL_VERSION, connectorBuildId: BUILD_ID, connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION, capability: "read-only-connection-v1" as const, verifiedAt: 1 },
  };
  const attachmentId = `vids:${await sha256Hex(`${preparedBatchId}\u0000${itemId}`)}`;
  const attachment = {
    id: attachmentId, preparedBatchId, workspaceId: "workspace", itemId, shotId: "1", referenceId,
    assignmentVersion: 1, referenceSha256, mimeType: "image/png" as const, byteSize: png.length, width: 1, height: 1,
    tabId: 90, canonicalTarget, documentId, status: "attached" as const, createdAt: 2, updatedAt: 3,
    uploadEvidence: { mechanism: "verified_document_file_input" as const, exactBytesSha256: referenceSha256, byteSize: png.length,
      mimeType: "image/png" as const, fileInputCount: 1 as const, inputChangeDispatched: true as const, previewLoaded: true as const,
      previewWidth: 1, previewHeight: 1, removalControlPresent: true as const, uploadOperationId: "55555555-5555-4555-8555-555555555555", uploadedAt: 3 },
  };
  await database.referenceAssignments.put(reference);
  await database.preparedVideoBatches.put(prepared);
  await database.selectedTargets.put(target);
  await database.vidsVideoAttachmentOperations.put(attachment);
  const calls: Array<{ func: (...args: never[]) => unknown; args?: unknown[]; target: { tabId: number; documentIds: string[] } }> = [];
  const scripting = { executeScript: vi.fn(async (input: { func: (...args: never[]) => unknown; args?: unknown[]; target: { tabId: number; documentIds: string[] } }) => {
    calls.push(input);
    if (input.func === enterVidsPromptInPage) {
      if (options.changeTargetBeforeIntent && calls.length === 2) await database.selectedTargets.put({ ...target, verificationBinding: { ...target.verificationBinding, documentId: "replaced-doc" } });
      return [{ documentId: options.injectedDocumentId ?? documentId, result: {
        href: canonicalTarget, ok: !options.entryReason, ...(options.entryReason ? { reason: options.entryReason } : {}),
        promptState: "empty", expectedSha256: promptHash, actualSha256: promptHash, immediateMatch: true, settledMatch: true, stableReads: 3,
        referenceSha256, referenceByteSize: png.length, generateCount: options.generateCount ?? 1, generateDisabled: options.generateDisabled ?? false,
      } }];
    }
    if (options.activationThrows) throw new Error("lost_injected_reply");
    return [{ documentId, result: { href: canonicalTarget, ok: true, activationAttempted: true, activationCount: 1 } }];
  }) };
  const handler = createVidsVideoGenerateHandler({
    repositories, scripting, getTab: async (tabId) => ({ id: tabId, url: canonicalTarget }), revalidate: async () => undefined,
    now: () => 5000, createAttemptId: () => "66666666-6666-4666-8666-666666666666",
  });
  return { database, repositories, prepared, handler, calls, scripting, promptHash, referenceSha256, target, attachment };
}

describe("P10.2 Google Vids exact prompt and one-shot generation", () => {
  it("validates the exact prepared pair, checks target/reference, records intent, then dispatches once", async () => {
    const fixture = await setup();
    const result = await fixture.handler.generateOnce(preparedBatchId, itemId);
    expect(result.status, JSON.stringify(result)).toBe("dispatched");
    expect(fixture.calls).toHaveLength(3); // two full prompt/reference preflights, one activation
    expect(fixture.calls.map((call) => call.target.documentIds)).toEqual([[documentId], [documentId], [documentId]]);
    const operation = await fixture.repositories.getVidsVideoGenerationOperation((result.operation as { id: string }).id);
    expect(operation).toMatchObject({ status: "dispatched", promptHash: fixture.promptHash, referenceSha256: fixture.referenceSha256, documentId, canonicalShotId: "1", activationAttempted: true, activationCount: 1, promptReadback: { expectedSha256: fixture.promptHash, actualSha256: fixture.promptHash, serialization: "contenteditable_blocks_v1", immediateMatch: true, settledMatch: true, stableReads: 3 } });
    expect(await fixture.database.flowVideoAttachmentOperations.toArray()).toEqual([]);
    expect(await fixture.database.flowVideoQueues.toArray()).toEqual([]);
    expect(await fixture.database.vidsVideoAttachmentOperations.toArray()).toHaveLength(1);
    expect(await fixture.database.vidsVideoGenerationOperations.toArray()).toHaveLength(1);
  });

  it.each([
    ["prepared pair or hash mismatch", { wrongPromptHash: true }, "prepared_item_pairing_or_hash_mismatch"],
    ["conflicting text", { entryReason: "prompt_editor_contains_conflicting_text" }, "prompt_editor_contains_conflicting_text"],
    ["missing reference identity proof", { entryReason: "reference_identity_proof_unavailable" }, "reference_identity_proof_unavailable"],
    ["disabled Generate", { generateDisabled: true }, "generate_disabled"],
    ["ambiguous Generate control", { generateCount: 2 }, "vids_generate_control_ambiguous"],
    ["wrong injected document", { injectedDocumentId: "replacement-document" }, "vids_document_changed"],
    ["target changes after prompt preflight", { changeTargetBeforeIntent: true }, "vids_target_changed_before_intent"],
  ])("blocks %s before intent and activation", async (_name, options, reason) => {
    const fixture = await setup(options);
    const result = await fixture.handler.generateOnce(preparedBatchId, itemId);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(reason);
    expect(await fixture.database.vidsVideoGenerationOperations.toArray()).toEqual([]);
    expect(fixture.calls.some((call) => call.func === activateVidsGenerateInPage)).toBe(false);
  });

  it("does not repeat Generate after a successful receipt or an activation reply is lost", async () => {
    for (const options of [{}, { activationThrows: true }]) {
      const fixture = await setup(options);
      const first = await fixture.handler.generateOnce(preparedBatchId, itemId);
      const calls = fixture.calls.length;
      const second = await fixture.handler.generateOnce(preparedBatchId, itemId);
      expect(fixture.calls).toHaveLength(calls);
      expect(second.status).toBe(options.activationThrows ? "uncertain" : "already_dispatched");
      expect(first.status).toBe(options.activationThrows ? "uncertain" : "dispatched");
    }
  });

  it("atomically prevents two concurrent requests from activating Generate twice", async () => {
    const fixture = await setup();
    const [first, second] = await Promise.all([
      fixture.handler.generateOnce(preparedBatchId, itemId),
      fixture.handler.generateOnce(preparedBatchId, itemId),
    ]);
    expect([first.status, second.status].filter((status) => status === "dispatched")).toHaveLength(1);
    expect(fixture.calls.filter((call) => call.func === activateVidsGenerateInPage)).toHaveLength(1);
    expect(await fixture.database.vidsVideoGenerationOperations.toArray()).toHaveLength(1);
  });

  it("routes generation only through Vids handlers and leaves Flow queue and operations untouched", async () => {
    const fixture = await setup();
    const vidsGenerate = vi.fn(async () => ({ status: "dispatched" }));
    const vidsGet = vi.fn(async () => ({ status: "not_started" }));
    const flowGenerate = vi.fn(async () => ({ status: "dispatched" }));
    const preferences = new ChromePreferenceRepository({ get: async () => ({}), set: async () => undefined });
    const listener = createConnectionMessageListener("vids-generate-isolation", {
      repositories: fixture.repositories, preferences,
      vidsVideoGenerate: { generateOnce: vidsGenerate, get: vidsGet },
      flowVideoGenerateOnce: flowGenerate,
      vidsVideoAttachment: { attach: vi.fn(), get: vi.fn() },
    });
    const sender = { id: "vids-generate-isolation", url: "chrome-extension://vids-generate-isolation/index.html" };
    const send = (type: "vids.video.generateOnce" | "vids.video.getGenerationStatus") => new Promise<unknown>((resolve) => {
      const request = makeRequest(type, { preparedBatchId, itemId }, `request-${type}`);
      listener(JSON.parse(JSON.stringify(request)), sender, resolve);
    });
    await send("vids.video.getGenerationStatus");
    await send("vids.video.generateOnce");
    expect(vidsGet).toHaveBeenCalledWith(preparedBatchId, itemId);
    expect(vidsGenerate).toHaveBeenCalledWith(preparedBatchId, itemId);
    expect(flowGenerate).not.toHaveBeenCalled();
    expect(await fixture.database.flowVideoQueues.toArray()).toEqual([]);
    expect(await fixture.database.flowVideoAttachmentOperations.toArray()).toEqual([]);
  });
});
