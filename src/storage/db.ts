import Dexie, { type Table } from "dexie";
import type {
  PromptInputMode,
  PromptKind,
  PromptMeasurement,
} from "../domain/batches/types";
import type { JsonSpan } from "../domain/batches/jsonSpanScanner";
import type { FlowImageAttemptRecord } from "../domain/jobs/attempt";
import type { FlowImagePromptSnapshotRecord } from "../domain/batches/flowImagePromptSnapshot";

export type PromptDraftRecord = {
  id: string;
  kind: "image" | "video";
  rawText: string;
  updatedAt: number;
};

export type SelectedTargetRecord = {
  provider: "Flow" | "Vids";
  tabId: number;
  canonicalTarget: string;
  verification: "unverified" | "verified";
  reconnectEnabled?: boolean;
  updatedAt: number;
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
  }
}

// This database is constructed only by the extension service worker.
export const appDatabase = new AutomatDatabase();
