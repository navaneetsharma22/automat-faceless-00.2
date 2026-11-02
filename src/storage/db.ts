import Dexie, { type Table } from "dexie";
import type {
  PromptInputMode,
  PromptKind,
  PromptMeasurement,
  PreparedVideoBatchRecord,
} from "../domain/batches/types";
import type { JsonSpan } from "../domain/batches/jsonSpanScanner";
import type { FlowImageAttemptRecord } from "../domain/jobs/attempt";
import type { FlowImagePromptSnapshotRecord } from "../domain/batches/flowImagePromptSnapshot";
import type { ImageSubmissionQueueRecord } from "../domain/jobs/queue";
import type { FlowVideoQueueRecord } from "../domain/jobs/videoQueue";
import type { VidsVideoAttachmentOperation } from "../domain/jobs/vidsVideoAttachment";
import type { VidsVideoGenerationOperation } from "../domain/jobs/vidsVideoGeneration";
import type {
  ReferenceAssignmentRecord,
  ReferenceCaptureOperationRecord,
} from "../domain/media/references";
import type { ConnectionFailureDiagnostic } from "../platforms/shared/contracts";

export type PromptDraftRecord = {
  id: string;
  kind: "image" | "video";
  rawText: string;
  updatedAt: number;
};

export type FlowVideoAttachmentOperation = {
  id: string;
  preparedBatchId: string;
  itemId: string;
  referenceId: string;
  status: "action_intent" | "attached" | "uncertain" | "blocked";
  reason?: string;
  updatedAt: number;
  verifiedAttachment?: {
    documentId: string;
    mediaId: string;
    verifiedAt: number;
  };
  videoGeneration?: {
    attemptId: string;
    preparedBatchId: string;
    itemId: string;
    canonicalShotId: string;
    promptHash: string;
    referenceId: string;
    tabId: number;
    projectId: string;
    canonicalTarget: string;
    documentId: string;
    state: "dispatch_intent" | "dispatched" | "uncertain" | "blocked";
    reason?: string;
    pressAttempted?: boolean;
    releaseAttempted?: boolean;
    createdAt: number;
    updatedAt: number;
  };
  preActivationEvidence?: {
    priorStatus: "uncertain";
    priorReason: "composer_unsupported";
    priorUpdatedAt: number;
    producer: "historical_composer_unsupported_before_picker_click";
    pickerClickAttempted: false;
    reconciledAt: number;
  };
  preAddReconciliationEvidence?: {
    priorStatus: "uncertain";
    priorReason: "candidate_missing_or_virtualized";
    priorUpdatedAt: number;
    producer: "historical_candidate_missing_before_add_activation";
    addClickAttempted: false;
    reconciledAt: number;
  };
};

export type SelectedTargetRecord = {
  provider: "Flow" | "Vids";
  tabId: number;
  canonicalTarget: string;
  verification: "unverified" | "verified";
  verificationBinding?: {
    provider: "Flow" | "Vids";
    tabId: number;
    canonicalTarget: string;
    projectId: string;
    frameId: 0;
    documentId: string;
    documentToken: string;
    extensionBuildId: string;
    extensionProtocolVersion: number;
    connectorBuildId: string;
    connectorProtocolVersion: number;
    capability: "read-only-connection-v1";
    verifiedAt: number;
  };
  reconnectEnabled?: boolean;
  connectionState?:
    | "checking"
    | "verified"
    | "temporarily-unreachable"
    | "permission-needed"
    | "stale-document"
    | "stale-build"
    | "disconnected";
  connectionFailure?: ConnectionFailureDiagnostic;
  /** Monotonic per-provider write token used to reject late handshake results. */
  revision?: number;
  lifecycleDiagnostics?: Array<{
    kind:
      | "worker_started"
      | "revalidation_started"
      | "revalidation_verified"
      | "same_project_route_changed"
      | "transport_unavailable"
      | "document_changed"
      | "tab_reload_signal"
      | "tab_discarded"
      | "tab_closed"
      | "tab_replaced"
      | "revalidation_refused";
    reason?: string;
    failureStage?: ConnectionFailureDiagnostic["stage"];
    bindingComparison?: VerificationBindingComparison;
    at: number;
  }>;
  updatedAt: number;
};

/** Immutable authorization for one distinct source after an explicit count rebaseline. */
export type FlowCountRecoveryRecord = {
  recoveryId: string;
  oldAttemptId: string;
  oldSessionId: string;
  oldSourceHash: string;
  oldOutcome: "unknown";
  oldMonitoringStatus: string;
  oldCountDecisionStatus: string;
  producerInspection: "absent_interrupted";
  newSourceHash: string;
  newWorkspaceId: string;
  newItemId: string;
  newSnapshotId: string;
  countSessionId: string;
  projectId: string;
  canonicalTarget: string;
  tabId: number;
  documentId: string;
  buildId: string;
  protocolVersion: number;
  countDeclarationProvenance: "user_attested_existing_image_count";
  userConfirmed: true;
  startingImageCount: number;
  baselineCandidateIds: string[];
  qualifyingBaselineCandidateIds: string[];
  baselineTileTokens: string[];
  capturedAt: number;
};

export type VerificationBindingMatch = "match" | "mismatch" | "missing";
export type VerificationBindingComparison = {
  savedBindingPresent: boolean;
  selectedTabId: VerificationBindingMatch;
  selectedProjectId: VerificationBindingMatch;
  selectedCanonicalTarget: VerificationBindingMatch;
  browserDocumentId: VerificationBindingMatch;
  connectorDocumentToken: VerificationBindingMatch;
  savedExtensionBuild: VerificationBindingMatch;
  savedConnectorBuild: VerificationBindingMatch;
  savedExtensionProtocol: VerificationBindingMatch;
  savedConnectorProtocol: VerificationBindingMatch;
  liveConnectorBuild: "current";
  liveConnectorProtocol: "current";
};

export type WorkflowRecord = {
  id: string;
  name: string;
  updatedAt: number;
};

export type BatchRecord = {
  id: string;
  workflowId: string;
  workspaceId: string;
  kind: "image" | "video";
  status: "draft";
  sourceText: string;
  sourceMode: PromptInputMode;
  orderedItemIds: string[];
  total: PromptMeasurement;
  updatedAt: number;
};

export type PromptItemRecord = {
  id: string;
  batchId: string;
  workspaceId: string;
  kind: PromptKind;
  order: number;
  shotId?: string;
  identitySource?: "outer_label" | "envelope" | "body_shot_id";
  rawJsonBody: string;
  sourceSpan: JsonSpan;
  measurement: PromptMeasurement;
  contentHash: string;
  createdAt: number;
};

export class AutomatDatabase extends Dexie {
  promptDrafts!: Table<PromptDraftRecord, string>;
  selectedTargets!: Table<SelectedTargetRecord, string>;
  workflows!: Table<WorkflowRecord, string>;
  batches!: Table<BatchRecord, string>;
  promptItems!: Table<PromptItemRecord, string>;
  flowImageAttempts!: Table<FlowImageAttemptRecord, string>;
  flowImagePromptSnapshots!: Table<FlowImagePromptSnapshotRecord, string>;
  flowCountRecoveries!: Table<FlowCountRecoveryRecord, string>;
  imageSubmissionQueues!: Table<ImageSubmissionQueueRecord, string>;
  referenceAssignments!: Table<ReferenceAssignmentRecord, string>;
  referenceCaptureOperations!: Table<ReferenceCaptureOperationRecord, string>;
  preparedVideoBatches!: Table<PreparedVideoBatchRecord, string>;
  pinnedReferenceMedia!: Table<ReferenceAssignmentRecord, string>;
  flowVideoAttachmentOperations!: Table<FlowVideoAttachmentOperation, string>;
  flowVideoQueues!: Table<FlowVideoQueueRecord, string>;
  vidsVideoAttachmentOperations!: Table<VidsVideoAttachmentOperation, string>;
  vidsVideoGenerationOperations!: Table<VidsVideoGenerationOperation, string>;

  constructor(name = "automat-faceless-app-v1") {
    super(name);
    this.version(1).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, kind, status, updatedAt",
    });
    this.version(2).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, workspaceId, kind, status, updatedAt",
      promptItems: "&id, batchId, workspaceId, kind, order",
    });
    this.version(3).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, workspaceId, kind, status, updatedAt",
      promptItems: "&id, batchId, workspaceId, kind, order",
    });
    this.version(4).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, workspaceId, kind, status, updatedAt",
      promptItems: "&id, batchId, workspaceId, kind, order",
      flowImageAttempts:
        "&attemptId, &activeKey, &confirmationKey, workspaceId, batchId, itemId, state, createdAt",
    });
    this.version(5).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, workspaceId, kind, status, updatedAt",
      promptItems: "&id, batchId, workspaceId, kind, order",
      flowImageAttempts:
        "&attemptId, &activeKey, &confirmationKey, workspaceId, batchId, itemId, state, createdAt",
      flowImagePromptSnapshots:
        "&snapshotId, workspaceId, batchId, itemId, promptHash, createdAt",
    });
    this.version(6).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, workspaceId, kind, status, updatedAt",
      promptItems: "&id, batchId, workspaceId, kind, order",
      flowImageAttempts:
        "&attemptId, &activeKey, &confirmationKey, workspaceId, batchId, itemId, state, createdAt",
      flowImagePromptSnapshots:
        "&snapshotId, workspaceId, batchId, itemId, promptHash, createdAt",
      flowCountRecoveries:
        "&recoveryId, oldAttemptId, oldSourceHash, newSourceHash, projectId, createdAt",
    });
    this.version(7).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, workspaceId, kind, status, updatedAt",
      promptItems: "&id, batchId, workspaceId, kind, order",
      flowImageAttempts:
        "&attemptId, &activeKey, &confirmationKey, workspaceId, batchId, itemId, state, createdAt",
      flowImagePromptSnapshots:
        "&snapshotId, workspaceId, batchId, itemId, promptHash, createdAt",
      flowCountRecoveries:
        "&recoveryId, oldAttemptId, oldSourceHash, newSourceHash, projectId, createdAt",
      imageSubmissionQueues: "&queueId, workspaceId, state, createdAt",
    });
    this.version(8).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, workspaceId, kind, status, updatedAt",
      promptItems: "&id, batchId, workspaceId, kind, order",
      flowImageAttempts:
        "&attemptId, &activeKey, &confirmationKey, workspaceId, batchId, itemId, state, createdAt",
      flowImagePromptSnapshots:
        "&snapshotId, workspaceId, batchId, itemId, promptHash, createdAt",
      flowCountRecoveries:
        "&recoveryId, oldAttemptId, oldSourceHash, newSourceHash, projectId, createdAt",
      imageSubmissionQueues: "&queueId, workspaceId, state, createdAt",
      referenceAssignments:
        "&assignmentId, referenceId, captureOperationId, workspaceId, batchId, shotId, selectionVersion",
      referenceCaptureOperations:
        "&captureOperationId, workspaceId, batchId, shotId, status, startedAt",
    });
    this.version(9).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, workspaceId, kind, status, updatedAt",
      promptItems: "&id, batchId, workspaceId, kind, order",
      flowImageAttempts:
        "&attemptId, &activeKey, &confirmationKey, workspaceId, batchId, itemId, state, createdAt",
      flowImagePromptSnapshots:
        "&snapshotId, workspaceId, batchId, itemId, promptHash, createdAt",
      flowCountRecoveries:
        "&recoveryId, oldAttemptId, oldSourceHash, newSourceHash, projectId, createdAt",
      imageSubmissionQueues: "&queueId, workspaceId, state, createdAt",
      referenceAssignments:
        "&assignmentId, referenceId, captureOperationId, workspaceId, batchId, shotId, selectionVersion",
      referenceCaptureOperations:
        "&captureOperationId, workspaceId, batchId, shotId, status, startedAt",
      preparedVideoBatches:
        "&id, requestId, workspaceId, videoBatchId, destination, status, createdAt",
      pinnedReferenceMedia:
        "&referenceId, workspaceId, batchId, shotId, sha256",
    });
    this.version(10).stores({
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
      flowVideoAttachmentOperations: "&id, preparedBatchId, itemId, referenceId, status, updatedAt",
    });
    this.version(11).stores({
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
      flowVideoAttachmentOperations: "&id, preparedBatchId, itemId, referenceId, status, updatedAt",
      flowVideoQueues: "&queueId, preparedBatchId, state, updatedAt",
    });
    this.version(12).stores({
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
      flowVideoAttachmentOperations: "&id, preparedBatchId, itemId, referenceId, status, updatedAt",
      flowVideoQueues: "&queueId, preparedBatchId, state, updatedAt",
      vidsVideoAttachmentOperations: "&id, preparedBatchId, itemId, referenceId, status, updatedAt",
    });
    this.version(13).stores({
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
      flowVideoAttachmentOperations: "&id, preparedBatchId, itemId, referenceId, status, updatedAt",
      flowVideoQueues: "&queueId, preparedBatchId, state, updatedAt",
      vidsVideoAttachmentOperations: "&id, preparedBatchId, itemId, referenceId, status, updatedAt",
      vidsVideoGenerationOperations: "&id, preparedBatchId, itemId, canonicalShotId, promptHash, referenceId, status, updatedAt",
    });
  }
}

// This database is constructed only by the extension service worker.
export const appDatabase = new AutomatDatabase();
