import { describe, expect, it, vi } from "vitest";
import {
  createFlowVideoGenerateHandler,
  inspectFlowVideoReferenceInPage,
} from "../../src/background/handlers/flowVideo";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { CONNECTOR_PROTOCOL_VERSION } from "../../src/platforms/shared/contracts";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import { ExtensionRepositories } from "../../src/storage/repositories";

const batchId = "prepared-flow-video-shot-one";
const itemId = "video-item-shot-one";
const referenceId = "11111111-1111-4111-8111-111111111111";
const mediaId = "5a836a9f-197d-4400-aa12-2d4c7492a444";
const otherMediaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tabId = 19;
const projectId = "000936e1-dc7a-4421-988b-d4c66a804aed";
const documentId = "flow-doc-one";
const canonicalTarget = `https://flow.google.com/project/${projectId}`;
const prompt = JSON.stringify({
  shot_id: "1",
  prompt_type: "video",
  scene_title: "Shot One",
  primary_instruction: "Preserve this complete video prompt.",
});
const mediaBytes = new Uint8Array([7, 8, 9, 10]);

async function fixture(
  overrides: {
    fill?: "success" | "mismatch" | "uncertain";
    verificationDocumentId?: string;
    verificationMediaId?: string;
    verificationBusy?: string | null;
    pinnedDocumentId?: string;
    pinnedProjectId?: string;
    pinnedTabId?: number;
    pinnedCanonicalTarget?: string;
    changeDocumentAfterFill?: boolean;
    changeReferenceAfterFill?: boolean;
    changePairing?: boolean;
    activation?: "success" | "uncertain";
  } = {},
) {
  const database = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(database);
  const contentHash = await sha256Hex(prompt);
  const source = overrides.changePairing
    ? JSON.stringify({
        shot_id: "2",
        prompt_type: "video",
        scene_title: "Shot Two",
        primary_instruction: "Different pairing.",
      })
    : prompt;
  const sourceHash = await sha256Hex(source);
  const referenceHash = await crypto.subtle
    .digest("SHA-256", mediaBytes)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    );
  const batch = {
    id: batchId,
    requestId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "default",
    preparedAt: 1,
    videoBatchId: "video-source",
    videoSourceHash: sourceHash,
    videoSourceText: source,
    imageSourceBatchId: "image-source",
    imageSourceBatchHash: "f".repeat(64),
    destination: "Flow" as const,
    target: {
      provider: "Flow" as const,
      tabId,
      canonicalTarget,
      projectId,
      documentId,
      verification: "verified" as const,
      verifiedAt: 1,
    },
    manualSettingsDeclaration: {
      confirmationId: "confirm-one",
      confirmedAt: 1,
      destination: "Flow" as const,
      declaredDurationSeconds: 6,
      tabId,
      canonicalTarget,
      projectId,
      documentId,
    },
    status: "prepared" as const,
    itemCount: 1,
    items: [
      {
        itemId,
        order: 0,
        shotId: "1",
        canonicalShotId: "1",
        rawJsonBody: prompt,
        contentHash,
        sourceSpan: { start: 0, end: prompt.length },
        reference: {
          referenceId,
          assignmentVersion: 1,
          sha256: referenceHash,
          mimeType: "image/png",
          byteSize: mediaBytes.length,
          width: 1,
          height: 1,
          capturedAt: 1,
        },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  await database.preparedVideoBatches.put(batch);
  await database.pinnedReferenceMedia.put({
    assignmentId: "default:image-source:1",
    referenceId,
    captureOperationId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "default",
    batchId: "image-source",
    batchSourceHash: "f".repeat(64),
    shotId: "1",
    promptHash: "e".repeat(64),
    selectionVersion: "44444444-4444-4444-8444-444444444444",
    assignmentVersion: 1,
    flowProjectId: overrides.pinnedProjectId ?? projectId,
    tabId: overrides.pinnedTabId ?? tabId,
    canonicalTarget: overrides.pinnedCanonicalTarget ?? canonicalTarget,
    documentId: overrides.pinnedDocumentId ?? documentId,
    providerAssetId: mediaId,
    observedSourceSha256: "d".repeat(64),
    sha256: referenceHash,
    mimeType: "image/png",
    byteSize: mediaBytes.length,
    width: 1,
    height: 1,
    capturedAt: 1,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch",
    qualityProvenance: "observed_resource_original_bytes_no_upscale",
    bytes: new Blob([mediaBytes], { type: "image/png" }),
  });
  await database.selectedTargets.put({
    provider: "Flow",
    tabId,
    canonicalTarget,
    verification: "verified",
    connectionState: "verified",
    verificationBinding: {
      provider: "Flow",
      tabId,
      canonicalTarget,
      projectId,
      frameId: 0,
      documentId,
      documentToken: "doc-token",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
      capability: "read-only-connection-v1",
      verifiedAt: 1,
    },
  });
  const attachmentOperation = {
    id: `${batchId}:${itemId}`,
    preparedBatchId: batchId,
    itemId,
    referenceId,
    status: "attached" as const,
    updatedAt: 1,
  };
  await repositories.putFlowVideoAttachmentOperation(attachmentOperation);
  let referenceReads = 0;
  const executeScript = vi.fn(
    async (input: { func: (...args: never[]) => unknown }) => {
      expect(input.func).toBe(inspectFlowVideoReferenceInPage);
      referenceReads++;
      return [
        {
          documentId: overrides.verificationDocumentId ?? documentId,
          result: {
            href: canonicalTarget,
            composerCount: 1,
            chips: [
              {
                busy: overrides.verificationBusy ?? "false",
                url: `https://flow-content.google/image/${overrides.changeReferenceAfterFill && referenceReads > 1 ? otherMediaId : (overrides.verificationMediaId ?? mediaId)}?sig=ephemeral`,
              },
            ],
          },
        },
      ];
    },
  );
  let frameReads = 0;
  const frame = {
    frameId: "main-frame",
    loaderId: "loader-one",
    url: canonicalTarget,
  };
  const promptPort = {
    getSelection: async () => ({ tabId, canonicalTarget }),
    getTab: async () => ({ id: tabId, url: canonicalTarget }),
    hasRequiredApis: () => true,
    hasDebuggerPermission: async () => true,
    attach: async () => undefined,
    sendCommand: async () => ({}),
    detach: async () => undefined,
    captureFrame: async () => frame,
    readFrame: async () => {
      frameReads++;
      return overrides.changeDocumentAfterFill && frameReads >= 1
        ? { ...frame, loaderId: "changed-loader" }
        : frame;
    },
  } as never;
  const enterPrompt = vi.fn(async (text: string) => ({
    outcome:
      overrides.fill === "uncertain"
        ? "input-uncertain"
        : overrides.fill === "mismatch"
          ? "readback-mismatch"
          : "filled",
    stage: "settled-readback",
    code: "fixture",
    message: "offline fixture",
    connectorReachable: true,
    composer: "identified",
    methodCompatible: true,
    fillVerified:
      overrides.fill !== "mismatch" && overrides.fill !== "uncertain",
    generationAvailable: false,
    inputMethod: "CDP Input.insertText",
    expectedCodeUnits: text.length,
    expectedUtf8Bytes: new TextEncoder().encode(text).length,
    expectedSha256: contentHash,
    immediateMatch:
      overrides.fill !== "mismatch" && overrides.fill !== "uncertain",
    settledMatch:
      overrides.fill !== "mismatch" && overrides.fill !== "uncertain",
    stableReadback:
      overrides.fill !== "mismatch" && overrides.fill !== "uncertain",
    elapsedMs: 2,
  }));
  const activate = vi.fn(async () => {
    const stored = await repositories.getFlowVideoAttachmentOperation(
      `${batchId}:${itemId}`,
    );
    expect(stored?.videoGeneration?.state).toBe("dispatch_intent");
    if (overrides.activation === "uncertain")
      throw new Error("reply lost after input may have started");
    return { complete: true, pressAttempted: true, releaseAttempted: true };
  });
  const handler = createFlowVideoGenerateHandler({
    repositories,
    scripting: { executeScript },
    getTab: async (id) => ({ id, url: canonicalTarget }),
    revalidate: async () => undefined,
    promptPort,
    enterPrompt,
    inspectGenerate: async () => ({
      composer: "identified",
      exactPrompt: true,
      generate: "identified",
      buttonObjectId: "generate-button",
    }),
    buttonPosition: async () => ({ x: 10, y: 20 }),
    activate,
    createAttemptId: () => "attempt-one",
    now: () => 100,
  });
  return {
    handler,
    repositories,
    executeScript,
    enterPrompt,
    activate,
    getReferenceReads: () => referenceReads,
  };
}

describe("P09.2 one prepared Flow video item (offline)", () => {
  it("pairs the exact prepared Shot 1 body, verifies readback/reference, persists intent, then activates once", async () => {
    const f = await fixture();
    await expect(
      f.handler.generateOnce(batchId, itemId),
    ).resolves.toMatchObject({ status: "dispatched", activationCount: 1 });
    expect(f.enterPrompt).toHaveBeenCalledWith(
      prompt,
      expect.objectContaining({ frameId: "main-frame" }),
      mediaId,
    );
    expect(f.activate).toHaveBeenCalledTimes(1);
    expect(f.getReferenceReads()).toBe(3);
    const operation = await f.repositories.getFlowVideoAttachmentOperation(
      `${batchId}:${itemId}`,
    );
    expect(operation?.videoGeneration).toMatchObject({
      state: "dispatched",
      canonicalShotId: "1",
      promptHash: await sha256Hex(prompt),
      referenceId,
    });
  });

  it("accepts an older pinned document in the same tab/project after a Flow reload", async () => {
    const f = await fixture({ pinnedDocumentId: "flow-doc-before-reload" });
    await expect(
      f.handler.generateOnce(batchId, itemId),
    ).resolves.toMatchObject({ status: "dispatched", activationCount: 1 });
    expect(f.activate).toHaveBeenCalledTimes(1);
    expect(f.getReferenceReads()).toBe(3);
    expect(
      (
        await f.repositories.getFlowVideoAttachmentOperation(
          `${batchId}:${itemId}`,
        )
      )?.videoGeneration,
    ).toMatchObject({ state: "dispatched", documentId });
  });

  it("still rejects a pinned reference from a different tab or project", async () => {
    for (const options of [
      { pinnedProjectId: "other-project" },
      { pinnedTabId: tabId + 1 },
      { pinnedCanonicalTarget: `${canonicalTarget}/other` },
    ]) {
      const f = await fixture(options);
      await expect(
        f.handler.generateOnce(batchId, itemId),
      ).resolves.toMatchObject({
        status: "blocked",
        reason: "matching_ready_reference_required",
      });
      expect(f.enterPrompt).not.toHaveBeenCalled();
      expect(f.activate).not.toHaveBeenCalled();
    }
  });

  it("rejects a source/item Shot pairing mismatch before prompt input", async () => {
    const f = await fixture({ changePairing: true });
    await expect(
      f.handler.generateOnce(batchId, itemId),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "prepared_item_pairing_or_hash_mismatch",
    });
    expect(f.enterPrompt).not.toHaveBeenCalled();
    expect(f.activate).not.toHaveBeenCalled();
  });

  it("leaves conflicting editor text unchanged when exact immediate/settled readback fails", async () => {
    const f = await fixture({ fill: "mismatch" });
    await expect(
      f.handler.generateOnce(batchId, itemId),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "exact_prompt_readback_failed",
    });
    expect(f.activate).not.toHaveBeenCalled();
    expect(
      (
        await f.repositories.getFlowVideoAttachmentOperation(
          `${batchId}:${itemId}`,
        )
      )?.videoGeneration,
    ).toBeUndefined();
  });

  it("blocks a changed document or mismatched ready reference before durable intent", async () => {
    for (const options of [
      { changeDocumentAfterFill: true },
      { changeReferenceAfterFill: true },
      { verificationMediaId: otherMediaId },
      { verificationBusy: "true" },
      { verificationDocumentId: "other-document" },
    ]) {
      const f = await fixture(options);
      await expect(
        f.handler.generateOnce(batchId, itemId),
      ).resolves.toMatchObject({ status: "blocked" });
      expect(f.activate).not.toHaveBeenCalled();
      expect(
        (
          await f.repositories.getFlowVideoAttachmentOperation(
            `${batchId}:${itemId}`,
          )
        )?.videoGeneration,
      ).toBeUndefined();
    }
  });

  it("claims one durable intent for repeated requests and never replays uncertain delivery", async () => {
    const concurrent = await fixture();
    await Promise.all([
      concurrent.handler.generateOnce(batchId, itemId),
      concurrent.handler.generateOnce(batchId, itemId),
    ]);
    expect(concurrent.activate).toHaveBeenCalledTimes(1);
    const repeated = await concurrent.handler.generateOnce(batchId, itemId);
    expect(repeated.status).toBe("already_dispatched");
    expect(concurrent.activate).toHaveBeenCalledTimes(1);

    const uncertain = await fixture({ activation: "uncertain" });
    await expect(
      uncertain.handler.generateOnce(batchId, itemId),
    ).resolves.toMatchObject({
      status: "uncertain",
      reason: "generate_delivery_uncertain",
    });
    await expect(
      uncertain.handler.generateOnce(batchId, itemId),
    ).resolves.toMatchObject({ status: "uncertain" });
    expect(uncertain.activate).toHaveBeenCalledTimes(1);
    expect(
      (
        await uncertain.repositories.getFlowVideoAttachmentOperation(
          `${batchId}:${itemId}`,
        )
      )?.videoGeneration?.state,
    ).toBe("uncertain");
  });
});
