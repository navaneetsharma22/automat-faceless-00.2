/**
 * Offline integration coverage for the production request → dispatcher →
 * attachment handler → repository path. Chrome scripting/tab APIs are the
 * only simulated boundary; returned page state is fixture data, not Flow acceptance.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import {
  createFlowVideoAttachmentHandler,
  flowVideoAttachmentActionInPage,
  flowVideoAttachmentStructurePreflightInPage,
} from "../../src/background/handlers/flowVideoAttachment";
import {
  flowReferenceCaptureInPage,
  flowResolveOriginalImageUrlInPage,
  flowRestoreGalleryAfterOriginalResolutionInPage,
} from "../../src/platforms/flow/references";
import {
  createFoundationClient,
  FoundationClientError,
} from "../../src/shared/messageClient";
import { AppRequestSchema } from "../../src/shared/schemas";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { CONNECTOR_PROTOCOL_VERSION } from "../../src/platforms/shared/contracts";
import {
  ChromePreferenceRepository,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import { sha256Bytes } from "../../src/domain/media/references";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";

const extensionId = "flow-video-attachment-integration";
const batchId = "prepared:default:1235934d-8b2d-43b9-990c-8e103413d179";
const itemId = "import:default:video:item:0";
const referenceId = "014ebcff-06e3-4ac2-b980-568f0755febf";
const priorOperationUpdatedAt = 1793605485721;
const mediaId = "67b8fc4f-e688-4a9b-8cc1-472ff37738d8";
const tabId = 77;
const documentId = "flow-document-1";
const projectId = "flow-project-1";
const canonicalTarget = `https://flow.google.com/project/${projectId}`;
const candidateUrl = "https://flow.google.com/asb/pinned-fixture";
const bytes = new Uint8Array([1, 2, 3, 4]);
type MockInjection = {
  func: (...args: never[]) => unknown;
  args?: unknown[];
  target: unknown;
};

function base64(data: Uint8Array) {
  return btoa(Array.from(data, (byte) => String.fromCharCode(byte)).join(""));
}

async function fixture(
  overrides: {
    destination?: "Flow" | "Vids";
    candidateBytes?: Uint8Array;
    savedReferenceBytes?: Uint8Array;
    candidateSourceUrl?: string;
    originalSourceUrl?: string;
    detailResolutionDocumentId?: string;
    detailRestoreDocumentId?: string;
    detailResolveFailure?: boolean;
    candidateMimeType?: string;
    permissionResult?: boolean;
    permissionError?: Error;
    selectedDocumentId?: string;
    selectedVerified?: boolean;
    extensionProtocolVersion?: number;
    connectorProtocolVersion?: number;
    structurePreflight?: { ok: boolean; reason?: string };
    omitManualSettings?: boolean;
    mismatchManualSettingsTarget?: boolean;
    verificationDocumentId?: string;
    verificationChip?: { busy: string | null; url: string };
    changeOperationDuringVerification?: boolean;
    injectedDocumentId?: string;
    pageResult?: { ok: boolean; already?: boolean; reason?: string };
    actionError?: Error;
    delayAction?: boolean;
  } = {},
) {
  const database = createMemoryRepositoryDatabase();
  const repositories = new ExtensionRepositories(database, () => 1000);
  const savedReferenceBytes = overrides.savedReferenceBytes ?? bytes;
  const sha256 = await sha256Bytes(savedReferenceBytes);
  const pin = {
    assignmentId: "workspace:batch:1",
    referenceId,
    captureOperationId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "workspace-1",
    batchId: "image-batch-1",
    batchSourceHash: "a".repeat(64),
    shotId: "1",
    promptHash: "b".repeat(64),
    selectionVersion: "33333333-3333-4333-8333-333333333333",
    assignmentVersion: 1,
    flowProjectId: projectId,
    tabId,
    canonicalTarget,
    documentId,
    providerAssetId: mediaId,
    observedSourceSha256: "c".repeat(64),
    sha256,
    mimeType: (overrides.candidateMimeType ?? "image/png") as "image/png",
    byteSize: savedReferenceBytes.length,
    width: 1,
    height: 1,
    capturedAt: 1,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch" as const,
    qualityProvenance: "observed_resource_original_bytes_no_upscale" as const,
    bytes: new Blob([savedReferenceBytes], { type: overrides.candidateMimeType ?? "image/png" }),
  };
  const item = {
    itemId,
    order: 0,
    canonicalShotId: "1",
    rawJsonBody: '{"scene":"preserve this exact body"}',
    contentHash: "d".repeat(64),
    sourceSpan: { start: 0, end: 32 },
    reference: {
      referenceId,
      assignmentVersion: 1,
      sha256,
      mimeType: overrides.candidateMimeType ?? "image/png",
      byteSize: savedReferenceBytes.length,
      width: 1,
      height: 1,
      capturedAt: 1,
    },
  };
  const batch = {
    id: batchId,
    requestId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "workspace-1",
    preparedAt: 1,
    videoBatchId: "video-source-1",
    videoSourceHash: "e".repeat(64),
    videoSourceText: item.rawJsonBody,
    imageSourceBatchId: "image-source-1",
    imageSourceBatchHash: "f".repeat(64),
    destination: overrides.destination ?? "Flow",
    target: {
      provider: overrides.destination ?? "Flow",
      tabId,
      canonicalTarget,
      projectId,
      documentId,
      verification: "verified" as const,
      verifiedAt: 1,
    },
    manualSettingsDeclaration: {
      confirmationId: "confirm-1",
      confirmedAt: 1,
      destination: overrides.destination ?? "Flow",
      declaredDurationSeconds: 5,
      tabId,
      canonicalTarget,
      projectId,
      documentId,
    },
    status: "prepared" as const,
    itemCount: 1,
    items: [item],
    createdAt: 1,
    updatedAt: 1,
  };
  const storedBatch = {
    ...batch,
    ...(overrides.mismatchManualSettingsTarget
      ? {
          manualSettingsDeclaration: {
            ...batch.manualSettingsDeclaration,
            canonicalTarget: `${canonicalTarget}/other`,
          },
        }
      : {}),
  } as typeof batch;
  if (overrides.omitManualSettings)
    delete (storedBatch as unknown as Record<string, unknown>)
      .manualSettingsDeclaration;
  await database.preparedVideoBatches.put(storedBatch);
  await database.pinnedReferenceMedia.put(pin);
  await database.selectedTargets.put({
    provider: "Flow",
    tabId,
    canonicalTarget,
    verification:
      overrides.selectedVerified === false ? "unverified" : "verified",
    connectionState:
      overrides.selectedVerified === false ? "disconnected" : "verified",
    verificationBinding: {
      provider: "Flow",
      tabId,
      canonicalTarget,
      projectId,
      frameId: 0,
      documentId: overrides.selectedDocumentId ?? documentId,
      documentToken: "doc-token",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion:
        overrides.extensionProtocolVersion ?? PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion:
        overrides.connectorProtocolVersion ?? CONNECTOR_PROTOCOL_VERSION,
      capability: "read-only-connection-v1",
      verifiedAt: 1,
    },
    updatedAt: 1,
  });

  const observedCandidateUrl = overrides.candidateSourceUrl ?? candidateUrl;
  const observedOriginalUrl = overrides.originalSourceUrl ?? `https://flow-content.google/image/${mediaId}?signed=fresh-original`;
  const hasMediaHostPermission = vi.fn(async (permission: string) => {
    expect(permission).toBe("https://flow-content.google/*");
    if (overrides.permissionError) throw overrides.permissionError;
    return overrides.permissionResult ?? true;
  });
  const fetchResource = vi.fn(async (url: string) => {
    expect(url).toBe(observedCandidateUrl === candidateUrl ? observedOriginalUrl : observedCandidateUrl);
    const response = new Response(overrides.candidateBytes ?? bytes, {
      status: 200,
      headers: { "content-type": overrides.candidateMimeType ?? "image/png" },
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  });
  const addActivation = vi.fn(async () => {
    if (overrides.delayAction)
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (overrides.actionError) throw overrides.actionError;
    return overrides.pageResult ?? { ok: true, already: false };
  });
  const preflightOperationStates: Array<string | undefined> = [];
  let verificationRevalidations = 0;
  const executeScript = vi.fn(async (input: unknown) => {
    const injection = input as MockInjection;
    if (injection.func === flowResolveOriginalImageUrlInPage) {
      expect(injection.target).toEqual({ tabId, documentIds: [documentId] });
      expect(injection.args?.[0]).toMatchObject({ mediaId, galleryUrl: observedCandidateUrl });
      return [{ documentId: overrides.detailResolutionDocumentId ?? documentId, result: {
        ok: !overrides.detailResolveFailure,
        opened: true,
        url: observedOriginalUrl,
        href: `${canonicalTarget}/edit/268e65f5-7fd4-4918-9e9e-6744371d16a8`,
        ...(overrides.detailResolveFailure ? { code: "reference_detail_unavailable" } : {}),
      } }];
    }
    if (injection.func === flowRestoreGalleryAfterOriginalResolutionInPage) {
      expect(injection.target).toEqual({ tabId, documentIds: [documentId] });
      return [{ documentId: overrides.detailRestoreDocumentId ?? documentId, result: { ok: true, href: canonicalTarget } }];
    }
    if (injection.func === flowVideoAttachmentStructurePreflightInPage) {
      preflightOperationStates.push(
        (
          await repositories.getFlowVideoAttachmentOperation(
            `${batchId}:${itemId}`,
          )
        )?.status,
      );
      return [
        {
          documentId,
          result: {
            ...(overrides.structurePreflight ?? { ok: true }),
            href: canonicalTarget,
          },
        },
      ];
    }
    if (injection.func === flowReferenceCaptureInPage) {
      expect(injection.target).toEqual({ tabId, documentIds: [documentId] });
      expect(injection.args?.[0]).toMatchObject({
        sourceUrl: observedCandidateUrl,
        expectedOrigin: "https://flow.google.com",
      });
      return [
        {
          documentId,
          result: {
            ok: true,
            data: base64(overrides.candidateBytes ?? bytes),
            mimeType: "image/png",
            width: 1,
            height: 1,
            byteLength: (overrides.candidateBytes ?? bytes).byteLength,
          },
        },
      ];
    }
    if (!injection.args && String(injection.func).includes("flow-base-prompt-box") && String(injection.func).includes("aria-busy")) {
      expect(injection.target).toEqual({ tabId, documentIds: [documentId] });
      return [
        {
          documentId: overrides.verificationDocumentId ?? documentId,
          result: {
            ok: true,
            href: canonicalTarget,
            count: 1,
            chips: [overrides.verificationChip ?? {
              busy: "false",
              url: `https://flow-content.google/image/${mediaId}?signed=readback`,
            }],
          },
        },
      ];
    }
    if (!injection.args) {
      expect(injection.target).toEqual({ tabId, documentIds: [documentId] });
      return [
        {
          documentId: overrides.injectedDocumentId ?? documentId,
          result: {
            href: canonicalTarget,
            candidates: [{ id: mediaId, url: observedCandidateUrl }],
          },
        },
      ];
    }
    expect(injection.target).toEqual({ tabId, documentIds: [documentId] });
    const durable = await repositories.getFlowVideoAttachmentOperation(
      `${batchId}:${itemId}`,
    );
    expect(durable?.status).toBe("action_intent");
    if (overrides.pageResult?.ok !== false) await addActivation();
    return [
      {
        documentId,
        result: overrides.pageResult ?? { ok: true, already: false },
      },
    ];
  });
  const handler = createFlowVideoAttachmentHandler({
    repositories,
    scripting: { executeScript },
    getTab: async (id) => ({ id, url: canonicalTarget }),
    revalidate: async () => {
      verificationRevalidations += 1;
      if (overrides.changeOperationDuringVerification && verificationRevalidations === 2) {
        const current = await repositories.getFlowVideoAttachmentOperation(`${batchId}:${itemId}`);
        if (current) await repositories.putFlowVideoAttachmentOperation({ ...current, reason: "concurrent_update", updatedAt: current.updatedAt + 1 });
      }
    },
    hasMediaHostPermission,
    fetchResource,
  });
  const listener = createConnectionMessageListener(extensionId, {
    repositories,
    preferences: new ChromePreferenceRepository({
      get: async () => ({}),
      set: async () => undefined,
    }),
    flowVideoAttachment: handler,
  });
  const sendMessage = (request: unknown) =>
    new Promise<unknown>((resolve) => {
      listener(
        request,
        {
          id: extensionId,
          url: `chrome-extension://${extensionId}/index.html`,
        },
        resolve,
      );
    });
  const client = createFoundationClient({
    sendMessage: (request) => sendMessage(request),
  });
  return {
    database,
    repositories,
    handler,
    listener,
    client,
    executeScript,
    addActivation,
    fetchResource,
    hasMediaHostPermission,
    preflightOperationStates,
    batch,
    item,
    pin,
  };
}

describe("Flow video reference attachment request-to-handler integration (offline browser boundary)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads the prepared pin, verifies bytes, binds tab/document, persists intent before one action, and returns structured success", async () => {
    const f = await fixture();
    expect(
      (await f.repositories.getSelectedTarget("Flow"))?.verificationBinding,
    ).toMatchObject({
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
    });
    const result = await f.client.request("flow.video.attachReference", {
      preparedBatchId: batchId,
      itemId,
    });
    expect(result).toEqual({ status: "attached" });
    expect(f.preflightOperationStates[0]).toBeUndefined();
    expect(f.addActivation).toHaveBeenCalledTimes(1);
    expect(f.executeScript.mock.calls.every(([call]) =>
      JSON.stringify((call as MockInjection).target) === JSON.stringify({ tabId, documentIds: [documentId] }),
    )).toBe(true);
    expect(f.executeScript.mock.calls.some(([call]) => (call as MockInjection).func === flowResolveOriginalImageUrlInPage)).toBe(true);
    expect(f.executeScript.mock.calls.some(([call]) => (call as MockInjection).func === flowRestoreGalleryAfterOriginalResolutionInPage)).toBe(true);
    expect(await f.repositories.getReferenceById(referenceId)).toMatchObject({
      referenceId,
      sha256: f.item.reference.sha256,
    });
    expect(
      (await f.repositories.getPreparedVideoBatchById(batchId))?.items[0]
        ?.rawJsonBody,
    ).toBe(f.item.rawJsonBody);
    expect(
      await f.repositories.getFlowVideoAttachmentOperation(
        `${batchId}:${itemId}`,
      ),
    ).toMatchObject({ status: "attached", referenceId });
  });

  it("rejects malformed requests in the production schema and refuses missing IDs or Vids destination before injection", async () => {
    const f = await fixture();
    expect(
      AppRequestSchema.safeParse({
        protocolVersion: PROTOCOL_VERSION,
        buildId: BUILD_ID,
        requestId: "x",
        type: "flow.video.attachReference",
        payload: {
          preparedBatchId: batchId,
          itemId,
          providerAssetId: "caller-controlled",
        },
      }).success,
    ).toBe(false);
    const malformed = await new Promise<unknown>((resolve) =>
      f.listener(
        {
          protocolVersion: PROTOCOL_VERSION,
          buildId: BUILD_ID,
          requestId: "malformed",
          type: "flow.video.attachReference",
          payload: { preparedBatchId: batchId, itemId, url: candidateUrl },
        },
        {
          id: extensionId,
          url: `chrome-extension://${extensionId}/index.html`,
        },
        resolve,
      ),
    );
    expect(malformed).toMatchObject({ ok: false });
    await expect(
      f.client.request("flow.video.attachReference", {
        preparedBatchId: "absent",
        itemId,
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "prepared_flow_item_required",
    });
    await expect(
      f.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId: "missing",
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "prepared_item_missing",
    });
    const vids = await fixture({ destination: "Vids" });
    await expect(
      vids.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).resolves.toMatchObject({ status: "blocked" });
    expect(f.addActivation).not.toHaveBeenCalled();
    expect(vids.addActivation).not.toHaveBeenCalled();
    expect(f.executeScript).not.toHaveBeenCalled();
  });

  it("inspects the blocked candidate bytes read-only without changing the queue or attachment operation", async () => {
    const f = await fixture({ candidateSourceUrl: candidateUrl, candidateBytes: new Uint8Array([9, 8, 7]) });
    const queueId = `flow-video:${batchId}`;
    const queue = {
      queueId, preparedBatchId: batchId, state: "paused" as const, pauseReason: "candidate_bytes_mismatch",
      items: [{ itemId, order: 0, shotId: "1", referenceId, promptHash: f.item.contentHash, state: "failed" as const, reason: "candidate_bytes_mismatch" }],
      lastDispatchAt: null, nextActionAt: null, revision: 4, createdAt: 1, updatedAt: 2,
    };
    await f.repositories.createFlowVideoQueue(queue);
    const operation = {
      id: `${batchId}:${itemId}`, preparedBatchId: batchId, itemId, referenceId,
      status: "blocked" as const, reason: "candidate_bytes_mismatch", updatedAt: 5,
    };
    await f.repositories.putFlowVideoAttachmentOperation(operation);
    const result = await f.client.request("flow.video.inspectReferenceBytes", { preparedBatchId: batchId, itemId });
    expect(result).toMatchObject({
      status: "inspected", matches: false,
      diagnostic: {
        stage: "read_only_reference_inspection",
        acquisitionRoute: "verified_detail_original_extension_fetch",
        preparedSha256: f.item.reference.sha256,
        metadataSha256: f.pin.sha256,
        savedBytesSha256: f.pin.sha256,
        candidateBytesSha256: await sha256Bytes(new Uint8Array([9, 8, 7])),
        candidateMediaId: mediaId, mimeType: "image/png",
        preparedByteSize: 4, savedByteSize: 4, candidateByteSize: 3,
      },
    });
    expect(f.addActivation).not.toHaveBeenCalled();
    expect(await f.repositories.getFlowVideoQueue(queueId)).toEqual(queue);
    expect(await f.repositories.getFlowVideoAttachmentOperation(operation.id)).toEqual(operation);
  });

  it("blocks changed/unverified target, document mismatch, corrupt saved bytes, and candidate hash mismatch without page action", async () => {
    for (const options of [
      { selectedDocumentId: "different-document" },
      { selectedVerified: false },
      { injectedDocumentId: "different-document" },
      { candidateBytes: new Uint8Array([9]) },
      { extensionProtocolVersion: 3 },
      { connectorProtocolVersion: 4 },
    ]) {
      const f = await fixture(options);
      const result = await f.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      });
      expect(result).toMatchObject({ status: "blocked" });
      expect(f.addActivation).not.toHaveBeenCalled();
    }
    const corrupt = await fixture();
    await corrupt.database.pinnedReferenceMedia.put({
      ...corrupt.pin,
      bytes: new Blob([new Uint8Array([0, 0, 0, 0])]),
    });
    await expect(
      corrupt.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "reference_bytes_corrupt",
    });
    expect(corrupt.executeScript).not.toHaveBeenCalled();
    const missingPin = await fixture();
    await missingPin.database.pinnedReferenceMedia.bulkDelete([referenceId]);
    await expect(
      missingPin.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "pinned_reference_mismatch",
    });
    expect(missingPin.executeScript).not.toHaveBeenCalled();
  });

  it("requires the existing manual-settings confirmation before provider activation", async () => {
    for (const overrides of [
      { omitManualSettings: true },
      { mismatchManualSettingsTarget: true },
    ]) {
      const f = await fixture(overrides);
      await expect(
        f.client.request("flow.video.attachReference", {
          preparedBatchId: batchId,
          itemId,
        }),
      ).resolves.toMatchObject({ status: "blocked" });
      expect(f.executeScript).not.toHaveBeenCalled();
      expect(f.addActivation).not.toHaveBeenCalled();
    }
  });

  it("verifies one ready matching chip in the bound document and atomically updates the same uncertain operation without activation", async () => {
    const f = await fixture();
    const original = {
      id: `${batchId}:${itemId}`,
      preparedBatchId: batchId,
      itemId,
      referenceId,
      status: "uncertain" as const,
      reason: "attachment_unverified",
      updatedAt: 90,
    };
    await f.repositories.putFlowVideoAttachmentOperation(original);
    await expect(f.client.request("flow.video.verifyAttachedReference", { preparedBatchId: batchId, itemId })).resolves.toMatchObject({
      status: "attached",
      reason: "attachment_unverified",
      operation: {
        id: original.id,
        status: "attached",
        reason: "attachment_unverified",
        verifiedAttachment: { documentId, mediaId },
      },
    });
    expect(f.addActivation).not.toHaveBeenCalled();
    expect(f.executeScript).toHaveBeenCalledTimes(1);
    expect((await f.repositories.getFlowVideoAttachmentOperation(original.id))?.id).toBe(original.id);
  });

  it("rejects a verification result from a different document without changing the operation", async () => {
    const f = await fixture({ verificationDocumentId: "other-document" });
    const original = {
      id: `${batchId}:${itemId}`, preparedBatchId: batchId, itemId, referenceId,
      status: "uncertain" as const, reason: "attachment_unverified", updatedAt: 91,
    };
    await f.repositories.putFlowVideoAttachmentOperation(original);
    await expect(f.client.request("flow.video.verifyAttachedReference", { preparedBatchId: batchId, itemId })).resolves.toMatchObject({
      status: "uncertain", reason: "verification_document_mismatch",
    });
    expect(await f.repositories.getFlowVideoAttachmentOperation(original.id)).toEqual(original);
    expect(f.addActivation).not.toHaveBeenCalled();
  });

  it("rejects a changed operation snapshot after successful chip inspection", async () => {
    const f = await fixture({ changeOperationDuringVerification: true });
    const original = {
      id: `${batchId}:${itemId}`, preparedBatchId: batchId, itemId, referenceId,
      status: "uncertain" as const, reason: "attachment_unverified", updatedAt: 92,
    };
    await f.repositories.putFlowVideoAttachmentOperation(original);
    await expect(f.client.request("flow.video.verifyAttachedReference", { preparedBatchId: batchId, itemId })).resolves.toMatchObject({
      status: "uncertain", reason: "operation_changed",
    });
    expect(await f.repositories.getFlowVideoAttachmentOperation(original.id)).toMatchObject({
      status: "uncertain", reason: "concurrent_update", updatedAt: 93,
    });
    expect(f.addActivation).not.toHaveBeenCalled();
  });

  it("requires exactly one ready chip matching the pinned media identity", async () => {
    const f = await fixture({ verificationChip: { busy: "true", url: `https://flow-content.google/image/${mediaId}` } });
    const original = {
      id: `${batchId}:${itemId}`, preparedBatchId: batchId, itemId, referenceId,
      status: "uncertain" as const, reason: "attachment_unverified", updatedAt: 93,
    };
    await f.repositories.putFlowVideoAttachmentOperation(original);
    await expect(f.client.request("flow.video.verifyAttachedReference", { preparedBatchId: batchId, itemId })).resolves.toMatchObject({
      status: "uncertain", reason: "verification_chip_not_exact_ready",
    });
    expect(await f.repositories.getFlowVideoAttachmentOperation(original.id)).toEqual(original);
    expect(f.addActivation).not.toHaveBeenCalled();
  });

  it("blocks a missing attachment control before durable intent and activation", async () => {
    const f = await fixture({
      structurePreflight: {
        ok: false,
        reason: "attachment_control_unavailable",
      },
    });
    await expect(
      f.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      stage: "attachment_structure_preflight",
      reason: "attachment_control_unavailable",
    });
    expect(
      f.executeScript.mock.calls.some(
        ([input]) =>
          (input as MockInjection).func ===
          flowVideoAttachmentStructurePreflightInPage,
      ),
    ).toBe(true);
    expect(f.addActivation).not.toHaveBeenCalled();
    expect(
      await f.repositories.getFlowVideoAttachmentOperation(
        `${batchId}:${itemId}`,
      ),
    ).toBeUndefined();
  });

  it("reconciles only the inspected pre-click record atomically and preserves unrelated uncertainty without activation", async () => {
    const f = await fixture();
    const exact = {
      id: `${batchId}:${itemId}`,
      preparedBatchId: batchId,
      itemId,
      referenceId,
      status: "uncertain" as const,
      reason: "composer_unsupported",
      updatedAt: priorOperationUpdatedAt,
    };
    const unrelated = {
      id: "another-prepared-batch:another-item",
      preparedBatchId: "another-prepared-batch",
      itemId: "another-item",
      referenceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "uncertain" as const,
      reason: "attachment_uncertain",
      updatedAt: 12,
    };
    await f.repositories.putFlowVideoAttachmentOperation(exact);
    await f.repositories.putFlowVideoAttachmentOperation(unrelated);

    const result = await f.client.request(
      "flow.video.reconcilePreClickFailure",
      {
        preparedBatchId: batchId,
        itemId,
        expectedStatus: "uncertain",
        expectedReason: "composer_unsupported",
        expectedReferenceId: referenceId,
        expectedUpdatedAt: priorOperationUpdatedAt,
      },
    );
    expect(result).toMatchObject({
      status: "reconciled",
      reason: "pre_activation_failure_reconciled",
      operation: {
        id: exact.id,
        status: "blocked",
        reason: "pre_activation_failure_reconciled",
        preActivationEvidence: {
          priorStatus: "uncertain",
          priorReason: "composer_unsupported",
          priorUpdatedAt: priorOperationUpdatedAt,
          producer: "historical_composer_unsupported_before_picker_click",
          pickerClickAttempted: false,
        },
      },
    });
    const reconciled = await f.repositories.getFlowVideoAttachmentOperation(
      exact.id,
    );
    expect(reconciled?.id).toBe(exact.id);
    expect(reconciled?.preActivationEvidence?.reconciledAt).toBe(
      reconciled?.updatedAt,
    );
    expect(
      await f.repositories.getFlowVideoAttachmentOperation(unrelated.id),
    ).toEqual(unrelated);
    expect(f.executeScript).not.toHaveBeenCalled();
    expect(f.addActivation).not.toHaveBeenCalled();
  });

  it("rejects a changed exact operation snapshot without overwriting it", async () => {
    const f = await fixture();
    const changed = {
      id: `${batchId}:${itemId}`,
      preparedBatchId: batchId,
      itemId,
      referenceId,
      status: "uncertain" as const,
      reason: "attachment_uncertain",
      updatedAt: priorOperationUpdatedAt + 1,
    };
    await f.repositories.putFlowVideoAttachmentOperation(changed);
    await expect(
      f.client.request("flow.video.reconcilePreClickFailure", {
        preparedBatchId: batchId,
        itemId,
        expectedStatus: "uncertain",
        expectedReason: "composer_unsupported",
        expectedReferenceId: referenceId,
        expectedUpdatedAt: priorOperationUpdatedAt,
      }),
    ).resolves.toMatchObject({
      status: "uncertain",
      reason: "operation_changed",
    });
    expect(
      await f.repositories.getFlowVideoAttachmentOperation(changed.id),
    ).toEqual(changed);
    expect(f.executeScript).not.toHaveBeenCalled();
    expect(f.addActivation).not.toHaveBeenCalled();
  });

  it("uses scoped worker acquisition for flow-content gallery bytes and verifies the hash before claiming intent", async () => {
    const crossOriginUrl = `https://flow-content.google/image/${mediaId}?signed=short-lived`;
    const good = await fixture({ candidateSourceUrl: crossOriginUrl });
    await expect(
      good.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).resolves.toEqual({ status: "attached" });
    expect(good.fetchResource).toHaveBeenCalledTimes(1);
    expect(good.fetchResource.mock.calls[0]?.[0]).toBe(crossOriginUrl);
    expect(good.hasMediaHostPermission).toHaveBeenCalledWith(
      "https://flow-content.google/*",
    );
    expect(
      good.executeScript.mock.calls.some(
        ([call]) => (call as MockInjection).func === flowReferenceCaptureInPage,
      ),
    ).toBe(false);
    expect(good.addActivation).toHaveBeenCalledTimes(1);

    const missing = await fixture({
      candidateSourceUrl: crossOriginUrl,
      permissionResult: false,
    });
    await expect(
      missing.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      stage: "reference_byte_acquisition",
      reason: "reference_media_permission_needed",
    });
    expect(missing.addActivation).not.toHaveBeenCalled();
    expect(
      await missing.repositories.getFlowVideoAttachmentOperation(
        `${batchId}:${itemId}`,
      ),
    ).toBeUndefined();

    const inspectionRejected = await fixture({
      candidateSourceUrl: crossOriginUrl,
      permissionError: new Error("inspection rejected"),
    });
    await expect(
      inspectionRejected.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      stage: "reference_byte_acquisition",
      reason: "reference_permission_inspection_failed",
    });
    expect(inspectionRejected.addActivation).not.toHaveBeenCalled();

    const mismatch = await fixture({
      candidateSourceUrl: candidateUrl,
      candidateBytes: new Uint8Array([9, 8, 7]),
    });
    const mismatchResult = await mismatch.client.request(
      "flow.video.attachReference",
      {
        preparedBatchId: batchId,
        itemId,
      },
    );
    expect(mismatchResult).toMatchObject({
      status: "blocked",
      stage: "candidate_byte_verification",
      reason: "candidate_bytes_mismatch",
      diagnostic: {
        stage: "candidate_byte_verification",
        acquisitionRoute: "verified_detail_original_extension_fetch",
        preparedSha256: mismatch.item.reference.sha256,
        metadataSha256: mismatch.pin.sha256,
        savedBytesSha256: mismatch.pin.sha256,
        candidateBytesSha256: await sha256Bytes(new Uint8Array([9, 8, 7])),
        candidateMediaId: mediaId,
        mimeType: "image/png",
        preparedByteSize: 4,
        savedByteSize: 4,
        candidateByteSize: 3,
      },
    });
    expect(mismatch.addActivation).not.toHaveBeenCalled();
    expect(
      await mismatch.repositories.getFlowVideoAttachmentOperation(
        `${batchId}:${itemId}`,
      ),
    ).toBeUndefined();
  });

  it("resolves the observed detail original for an /asb WebP and verifies unchanged original JPEG bytes before intent", async () => {
    const originalJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
    const originalUrl = `https://flow-content.google/image/${mediaId}?signed=observed-fresh`;
    const f = await fixture({ candidateBytes: originalJpeg, savedReferenceBytes: originalJpeg, candidateMimeType: "image/jpeg", originalSourceUrl: originalUrl });
    const result = await f.client.request("flow.video.attachReference", { preparedBatchId: batchId, itemId });
    expect(result).toEqual({ status: "attached" });
    expect(f.fetchResource).toHaveBeenCalledWith(originalUrl, expect.anything());
    const calls = f.executeScript.mock.calls.map(([call]) => (call as MockInjection).func);
    const pickerAction = f.executeScript.mock.calls.find(([call]) => (call as MockInjection).func === flowVideoAttachmentActionInPage)?.[0] as MockInjection | undefined;
    expect(pickerAction?.args).toEqual([mediaId, candidateUrl]);
    expect(pickerAction?.args?.[1]).not.toBe(originalUrl);
    expect(calls.indexOf(flowResolveOriginalImageUrlInPage)).toBeLessThan(calls.indexOf(flowRestoreGalleryAfterOriginalResolutionInPage));
    expect(calls.indexOf(flowRestoreGalleryAfterOriginalResolutionInPage)).toBeLessThan(calls.findIndex((func) => func !== flowResolveOriginalImageUrlInPage && func !== flowRestoreGalleryAfterOriginalResolutionInPage && func !== flowReferenceCaptureInPage && String(func).includes("flow-base-prompt-box")));
    expect(f.addActivation).toHaveBeenCalledTimes(1);
  });

  it("blocks a wrong observed original UUID and restores the detail view without claiming intent", async () => {
    const wrongUrl = "https://flow-content.google/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?signed=fresh";
    const f = await fixture({ originalSourceUrl: wrongUrl });
    await expect(f.client.request("flow.video.attachReference", { preparedBatchId: batchId, itemId })).resolves.toMatchObject({ status: "blocked", stage: "reference_byte_acquisition", reason: "reference_media_id_mismatch" });
    expect(f.executeScript.mock.calls.some(([call]) => (call as MockInjection).func === flowRestoreGalleryAfterOriginalResolutionInPage)).toBe(true);
    expect(f.addActivation).not.toHaveBeenCalled();
    expect(await f.repositories.getFlowVideoAttachmentOperation(`${batchId}:${itemId}`)).toBeUndefined();
  });

  it("blocks a detail document change and an original byte SHA mismatch before action intent", async () => {
    const changed = await fixture({ detailResolutionDocumentId: "changed-document" });
    await expect(changed.client.request("flow.video.attachReference", { preparedBatchId: batchId, itemId })).resolves.toMatchObject({ status: "blocked" });
    expect(changed.addActivation).not.toHaveBeenCalled();
    expect(await changed.repositories.getFlowVideoAttachmentOperation(`${batchId}:${itemId}`)).toBeUndefined();

    const mismatch = await fixture({ candidateBytes: new Uint8Array([1, 2, 3, 5]) });
    await expect(mismatch.client.request("flow.video.attachReference", { preparedBatchId: batchId, itemId })).resolves.toMatchObject({ status: "blocked", reason: "candidate_bytes_mismatch" });
    expect(mismatch.addActivation).not.toHaveBeenCalled();
    expect(await mismatch.repositories.getFlowVideoAttachmentOperation(`${batchId}:${itemId}`)).toBeUndefined();
  });

  it("does not replay on concurrent requests, lost reply, or worker recreation after an injection error", async () => {
    const concurrent = await fixture({ delayAction: true });
    const results = await Promise.all(
      [1, 2].map(() =>
        concurrent.client.request("flow.video.attachReference", {
          preparedBatchId: batchId,
          itemId,
        }),
      ),
    );
    expect(concurrent.addActivation).toHaveBeenCalledTimes(1);
    expect(results).toContainEqual({ status: "attached" });
    expect(results).toContainEqual({
      status: "uncertain",
      reason: "concurrent_or_prior_activation",
    });

    const lost = await fixture();
    const droppingClient = createFoundationClient({
      sendMessage: async (request) => {
        await new Promise((resolve) =>
          lost.listener(
            request,
            {
              id: extensionId,
              url: `chrome-extension://${extensionId}/index.html`,
            },
            resolve,
          ),
        );
        throw new Error("simulated response loss");
      },
    });
    await expect(
      droppingClient.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).rejects.toBeInstanceOf(FoundationClientError);
    await expect(
      lost.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).resolves.toMatchObject({ status: "already_attached" });
    expect(lost.addActivation).toHaveBeenCalledTimes(1);

    const interrupted = await fixture({
      actionError: new Error("simulated injection reply loss"),
    });
    await expect(
      interrupted.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).rejects.toBeInstanceOf(FoundationClientError);
    expect(
      await interrupted.repositories.getFlowVideoAttachmentOperation(
        `${batchId}:${itemId}`,
      ),
    ).toMatchObject({ status: "action_intent" });
    const reopenedRepositories = new ExtensionRepositories(
      interrupted.database,
    );
    const restartedHandler = createFlowVideoAttachmentHandler({
      repositories: reopenedRepositories,
      scripting: {
        executeScript: async (input: unknown) => {
          const injection = input as MockInjection;
          if (injection.func === flowReferenceCaptureInPage)
            return [{ documentId, result: { ok: true, data: base64(bytes) } }];
          if (!injection.args && String(injection.func).includes("flow-base-prompt-box") && String(injection.func).includes("aria-busy"))
            return [
              {
                documentId,
                result: {
                  ok: true,
                  href: canonicalTarget,
                  count: 1,
                  chips: [{ busy: "false", url: `https://flow-content.google/image/${mediaId}?signed=rotated` }],
                },
              },
            ];
          if (!injection.args)
            return [
              {
                documentId,
                result: {
                  href: canonicalTarget,
                  candidates: [{ id: mediaId, url: candidateUrl }],
                },
              },
            ];
          return [
            {
              documentId,
              result: [
                {
                  busy: "false",
                  url: `https://flow-content.google/image/${mediaId}?signed=rotated`,
                },
              ],
            },
          ];
        },
      },
      getTab: async (id) => ({ id, url: canonicalTarget }),
      revalidate: async () => undefined,
    });
    const restartedListener = createConnectionMessageListener(extensionId, {
      repositories: reopenedRepositories,
      preferences: new ChromePreferenceRepository({
        get: async () => ({}),
        set: async () => undefined,
      }),
      flowVideoAttachment: restartedHandler,
    });
    const restartedClient = createFoundationClient({
      sendMessage: (request) =>
        new Promise((resolve) =>
          restartedListener(
            request,
            {
              id: extensionId,
              url: `chrome-extension://${extensionId}/index.html`,
            },
            resolve,
          ),
        ),
    });
    await expect(
      restartedClient.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).resolves.toMatchObject({ status: "attached" });
    expect(interrupted.addActivation).toHaveBeenCalledTimes(1);
  });

  it("preserves the prepared reference and source records across a later Shot assignment; simulated chip mismatch cannot claim success", async () => {
    const mismatch = await fixture({
      pageResult: { ok: false, reason: "attachment_unverified" },
    });
    const oldPin = await mismatch.repositories.getReferenceById(referenceId);
    await mismatch.database.referenceAssignments.put({
      ...mismatch.pin,
      referenceId: "55555555-5555-4555-8555-555555555555",
      assignmentVersion: 2,
    });
    await expect(
      mismatch.client.request("flow.video.attachReference", {
        preparedBatchId: batchId,
        itemId,
      }),
    ).resolves.toMatchObject({ status: "uncertain" });
    expect(mismatch.addActivation).not.toHaveBeenCalled();
    expect(await mismatch.repositories.getReferenceById(referenceId)).toEqual(
      oldPin,
    );
    expect(
      (await mismatch.repositories.getPreparedVideoBatchById(batchId))?.items[0]
        ?.reference.referenceId,
    ).toBe(referenceId);
    expect(await mismatch.database.imageSubmissionQueues.toArray()).toEqual([]);
  });
});
