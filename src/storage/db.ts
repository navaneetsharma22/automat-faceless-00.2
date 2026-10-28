import Dexie, { type Table } from "dexie";

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
  kind: "image" | "video";
  status: "draft";
  updatedAt: number;
};

export class AutomatDatabase extends Dexie {
  promptDrafts!: Table<PromptDraftRecord, string>;
  selectedTargets!: Table<SelectedTargetRecord, string>;
  workflows!: Table<WorkflowRecord, string>;
  batches!: Table<BatchRecord, string>;

  constructor(name = "automat-faceless-app-v1") {
    super(name);
    this.version(1).stores({
      promptDrafts: "&id, kind, updatedAt",
      selectedTargets: "&provider, tabId, verification, updatedAt",
      workflows: "&id, updatedAt",
      batches: "&id, workflowId, kind, status, updatedAt",
    });
  }
}

// This database is constructed only by the extension service worker.
export const appDatabase = new AutomatDatabase();
