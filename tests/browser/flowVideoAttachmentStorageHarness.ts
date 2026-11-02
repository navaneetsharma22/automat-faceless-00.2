import Dexie from "dexie";
import { AutomatDatabase } from "../../src/storage/db";
import { createDexieRepositoryDatabase, ExtensionRepositories } from "../../src/storage/repositories";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import { createFlowVideoAttachmentHandler, flowVideoAttachmentStructurePreflightInPage } from "../../src/background/handlers/flowVideoAttachment";
import { ChromePreferenceRepository } from "../../src/storage/repositories";
import { createFoundationClient } from "../../src/shared/messageClient";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { sha256Bytes } from "../../src/domain/media/references";
import { flowReferenceCaptureInPage } from "../../src/platforms/flow/references";
import { CONNECTOR_PROTOCOL_VERSION } from "../../src/platforms/shared/contracts";

declare global {
  interface Window {
    __FlowVideoAttachmentStorageFixture?: {
      verifyUpgradeAndReopen: () => Promise<{
        oldPreparedDataPreserved: boolean;
        oldReferenceDataPreserved: boolean;
        oldQueueDataPreserved: boolean;
        videoQueueStoreAvailable: boolean;
        videoQueuePersistsAfterReopen: boolean;
        intentPersistsAfterReopen: boolean;
        databaseVersion: number;
        requestHandlerSuccess: boolean;
        handlerClaimBeforeSimulatedActivation: boolean;
        handlerUsedExactDocument: boolean;
        simulatedActivationCount: number;
      }>;
    };
  }
}

window.__FlowVideoAttachmentStorageFixture = {
  async verifyUpgradeAndReopen() {
    const name = `flow-video-attachment-v9-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const legacy = new Dexie(name);
    legacy.version(9).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, workspaceId, kind, status, updatedAt",
      promptItems: "&id, batchId, workspaceId, kind, order",
      flowImageAttempts: "&attemptId, &activeKey, &confirmationKey, workspaceId, batchId, itemId, state, createdAt",
      flowImagePromptSnapshots: "&snapshotId, workspaceId, batchId, itemId, promptHash, createdAt",
      flowCountRecoveries: "&recoveryId, oldAttemptId, oldSourceHash, newSourceHash, projectId, createdAt",
      imageSubmissionQueues: "&queueId, workspaceId, state, createdAt",
      referenceAssignments: "&assignmentId, referenceId, captureOperationId, workspaceId, batchId, shotId, selectionVersion",
      referenceCaptureOperations: "&captureOperationId, workspaceId, batchId, shotId, status, startedAt",
      preparedVideoBatches: "&id, requestId, workspaceId, videoBatchId, destination, status, createdAt",
      pinnedReferenceMedia: "&referenceId, workspaceId, batchId, shotId, sha256",
    });
    await legacy.open();
    const prepared = { id: "legacy-prepared", payloadMarker: "keep-prepared" };
    const reference = { referenceId: "legacy-reference", payloadMarker: "keep-reference" };
    const queue = { queueId: "legacy-queue", payloadMarker: "keep-queue" };
    await legacy.table("preparedVideoBatches").put(prepared);
    await legacy.table("pinnedReferenceMedia").put(reference);
    await legacy.table("imageSubmissionQueues").put(queue);
    legacy.close();

    const upgraded = new AutomatDatabase(name);
    await upgraded.open();
    const repositories = new ExtensionRepositories(createDexieRepositoryDatabase(upgraded));
    const preserved = {
      prepared: await upgraded.preparedVideoBatches.get(prepared.id),
      reference: await upgraded.pinnedReferenceMedia.get(reference.referenceId),
      queue: await upgraded.imageSubmissionQueues.get(queue.queueId),
    };
    const intent = {
      id: "prepared:item",
      preparedBatchId: "prepared",
      itemId: "item",
      referenceId: "reference",
      status: "action_intent" as const,
      updatedAt: 10,
    };
    const claimed = await repositories.claimFlowVideoAttachmentOperation(intent);
    const duplicateClaimRejected = !(await repositories.claimFlowVideoAttachmentOperation({ ...intent, updatedAt: 11 }));
    const intentReadBeforeClose = await repositories.getFlowVideoAttachmentOperation(intent.id);
    const videoQueueRecord = { queueId: "flow-video:migration-fixture", preparedBatchId: "migration-fixture", state: "ready", items: [], lastDispatchAt: null, nextActionAt: null, revision: 0, createdAt: 1, updatedAt: 1 };
    await upgraded.flowVideoQueues.put(videoQueueRecord as never);
    const videoQueueStoreAvailable = Boolean(upgraded.flowVideoQueues);
    const version = upgraded.verno;
    upgraded.close();

    const reopened = new AutomatDatabase(name);
    await reopened.open();
    const reopenedRepositories = new ExtensionRepositories(createDexieRepositoryDatabase(reopened));
    const durable = await reopenedRepositories.getFlowVideoAttachmentOperation(intent.id);
    const durableVideoQueue = await reopened.flowVideoQueues.get(videoQueueRecord.queueId);
    await reopened.close();
    await new AutomatDatabase(name).delete();
    const runtimeName = `flow-video-request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const runtime = new AutomatDatabase(runtimeName);
    const runtimeRepositories = new ExtensionRepositories(createDexieRepositoryDatabase(runtime));
    const referenceBytes = new Uint8Array([1, 2, 3]);
    const referenceHash = await sha256Bytes(referenceBytes);
    const referenceId = "11111111-1111-4111-8111-111111111111";
    const targetDocumentId = "offline-flow-document";
    const targetTabId = 87;
    const targetProjectId = "offline-project";
    const targetUrl = `https://flow.google.com/project/${targetProjectId}`;
    const candidateUrl = "https://flow.google.com/asb/offline-pinned";
    const preparedId = "prepared-with-real-indexeddb";
    const itemId = "prepared-item";
    const mediaId = "67b8fc4f-e688-4a9b-8cc1-472ff37738d8";
    const pinned = { assignmentId: "workspace:batch:1", referenceId, captureOperationId: "22222222-2222-4222-8222-222222222222", workspaceId: "workspace", batchId: "image-source", batchSourceHash: "a".repeat(64), shotId: "1", promptHash: "b".repeat(64), selectionVersion: "33333333-3333-4333-8333-333333333333", assignmentVersion: 1, flowProjectId: targetProjectId, tabId: targetTabId, canonicalTarget: targetUrl, documentId: targetDocumentId, providerAssetId: mediaId, observedSourceSha256: "c".repeat(64), sha256: referenceHash, mimeType: "image/png" as const, byteSize: referenceBytes.length, width: 1, height: 1, capturedAt: 1, acquisitionProvenance: "verified_flow_document_same_origin_fetch" as const, qualityProvenance: "observed_resource_original_bytes_no_upscale" as const, bytes: new Blob([referenceBytes], { type: "image/png" }) };
    await runtime.preparedVideoBatches.put({ id: preparedId, requestId: "44444444-4444-4444-8444-444444444444", workspaceId: "workspace", preparedAt: 1, videoBatchId: "video-source", videoSourceHash: "d".repeat(64), videoSourceText: "{}", imageSourceBatchId: "image-source", imageSourceBatchHash: "e".repeat(64), destination: "Flow", target: { provider: "Flow", tabId: targetTabId, canonicalTarget: targetUrl, projectId: targetProjectId, documentId: targetDocumentId, verification: "verified", verifiedAt: 1 }, manualSettingsDeclaration: { confirmationId: "settings-confirmation", confirmedAt: 1, destination: "Flow", declaredDurationSeconds: 5, tabId: targetTabId, canonicalTarget: targetUrl, projectId: targetProjectId, documentId: targetDocumentId }, status: "prepared", itemCount: 1, items: [{ itemId, order: 0, canonicalShotId: "1", rawJsonBody: "{}", contentHash: "f".repeat(64), sourceSpan: { start: 0, end: 2 }, reference: { referenceId, assignmentVersion: 1, sha256: referenceHash, mimeType: "image/png", byteSize: referenceBytes.length, width: 1, height: 1, capturedAt: 1 } }], createdAt: 1, updatedAt: 1 });
    await runtime.pinnedReferenceMedia.put(pinned);
    await runtime.selectedTargets.put({ provider: "Flow", tabId: targetTabId, canonicalTarget: targetUrl, verification: "verified", connectionState: "verified", verificationBinding: { provider: "Flow", tabId: targetTabId, canonicalTarget: targetUrl, projectId: targetProjectId, frameId: 0, documentId: targetDocumentId, documentToken: "offline-token", extensionBuildId: BUILD_ID, extensionProtocolVersion: PROTOCOL_VERSION, connectorBuildId: BUILD_ID, connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION, capability: "read-only-connection-v1", verifiedAt: 1 }, updatedAt: 1 });
    let intentBeforeAction = false;
    let activationCount = 0;
    let exactDocument = true;
    const transport = { executeScript: async (input: unknown) => {
      const injection = input as { func: (...args: never[]) => unknown; args?: unknown[]; target: { tabId: number; documentIds: string[] } };
      exactDocument &&= injection.target.tabId === targetTabId && injection.target.documentIds[0] === targetDocumentId;
      if (injection.func === flowReferenceCaptureInPage) return [{ documentId: targetDocumentId, result: { ok: true, data: btoa(String.fromCharCode(...referenceBytes)) } }];
      if (injection.func === flowVideoAttachmentStructurePreflightInPage) return [{ documentId: targetDocumentId, result: { ok: true, href: targetUrl } }];
      if (injection.args) {
        intentBeforeAction = (await runtimeRepositories.getFlowVideoAttachmentOperation(`${preparedId}:${itemId}`))?.status === "action_intent";
        activationCount++;
        return [{ documentId: targetDocumentId, result: { ok: true, already: false } }];
      }
      return [{ documentId: targetDocumentId, result: { href: targetUrl, candidates: [{ id: mediaId, url: candidateUrl }] } }];
    } };
    const attachment = createFlowVideoAttachmentHandler({ repositories: runtimeRepositories, scripting: transport, getTab: async (id) => ({ id, url: targetUrl }), revalidate: async () => undefined });
    const listener = createConnectionMessageListener("offline-extension", { repositories: runtimeRepositories, preferences: new ChromePreferenceRepository({ get: async () => ({}), set: async () => undefined }), flowVideoAttachment: attachment });
    const client = createFoundationClient({ sendMessage: (request) => new Promise((resolve) => listener(request, { id: "offline-extension", url: "chrome-extension://offline-extension/index.html" }, resolve)) });
    const response = await client.request("flow.video.attachReference", { preparedBatchId: preparedId, itemId });
    await runtime.close();
    await new AutomatDatabase(runtimeName).delete();
    await reopened.delete();
    return {
      oldPreparedDataPreserved: preserved.prepared?.payloadMarker === prepared.payloadMarker,
      oldReferenceDataPreserved: preserved.reference?.payloadMarker === reference.payloadMarker,
      oldQueueDataPreserved: preserved.queue?.payloadMarker === queue.payloadMarker,
      videoQueueStoreAvailable,
      videoQueuePersistsAfterReopen: durableVideoQueue?.queueId === videoQueueRecord.queueId,
      intentPersistsAfterReopen: durable?.status === "action_intent",
      repositoryClaimIsExclusive: claimed && duplicateClaimRejected && intentReadBeforeClose?.updatedAt === 10,
      databaseVersion: version,
      requestHandlerSuccess: (response as { status?: string }).status === "attached",
      handlerClaimBeforeSimulatedActivation: intentBeforeAction,
      handlerUsedExactDocument: exactDocument,
      simulatedActivationCount: activationCount,
    };
  },
};
