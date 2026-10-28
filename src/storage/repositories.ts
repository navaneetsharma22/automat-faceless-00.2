import type { Table } from "dexie";
import {
  appDatabase,
  type BatchRecord,
  type PromptDraftRecord,
  type SelectedTargetRecord,
  type WorkflowRecord,
} from "./db";

export type PromptDraftInput = Pick<
  PromptDraftRecord,
  "id" | "kind" | "rawText"
>;
export type SelectedTargetInput = Pick<
  SelectedTargetRecord,
  "provider" | "tabId" | "canonicalTarget"
>;

export type Theme = "light" | "dark";

export type PreferenceArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export type RepositoryDatabase = {
  promptDrafts: Pick<Table<PromptDraftRecord, string>, "put" | "get">;
  selectedTargets: Pick<
    Table<SelectedTargetRecord, string>,
    "put" | "get" | "toArray" | "bulkPut"
  >;
  workflows: Pick<Table<WorkflowRecord, string>, "put" | "get">;
  batches: Pick<Table<BatchRecord, string>, "put" | "get">;
  transaction: <T>(
    tableNames: string[],
    operation: () => Promise<T>,
  ) => Promise<T>;
};

export function createDexieRepositoryDatabase(
  database = appDatabase,
): RepositoryDatabase {
  return {
    promptDrafts: database.promptDrafts,
    selectedTargets: database.selectedTargets,
    workflows: database.workflows,
    batches: database.batches,
    transaction: (tableNames, operation) => {
      switch (tableNames[0]) {
        case "promptDrafts":
          return database.transaction("rw", database.promptDrafts, operation);
        case "selectedTargets":
          return database.transaction(
            "rw",
            database.selectedTargets,
            operation,
          );
        case "workflows":
          return database.transaction("rw", database.workflows, operation);
        case "batches":
          return database.transaction("rw", database.batches, operation);
        default:
          return Promise.reject(
            new Error("Unsupported repository transaction."),
          );
      }
    },
  };
}

export class ChromePreferenceRepository {
  constructor(private readonly area: PreferenceArea) {}

  async getTheme(): Promise<Theme> {
    const values = await this.area.get("theme");
    return values.theme === "dark" ? "dark" : "light";
  }

  async setTheme(theme: Theme): Promise<void> {
    await this.area.set({ theme });
  }
}

export class ExtensionRepositories {
  constructor(
    private readonly tables: RepositoryDatabase = createDexieRepositoryDatabase(),
    private readonly now = () => Date.now(),
  ) {}

  async savePromptDraft(input: PromptDraftInput): Promise<PromptDraftRecord> {
    const record: PromptDraftRecord = { ...input, updatedAt: this.now() };
    await this.tables.transaction(["promptDrafts"], () =>
      this.tables.promptDrafts.put(record).then(() => undefined),
    );
    return record;
  }

  getPromptDraft(id: string): Promise<PromptDraftRecord | undefined> {
    return this.tables.promptDrafts.get(id);
  }

  async recordSelectedTarget(
    input: SelectedTargetInput,
  ): Promise<SelectedTargetRecord> {
    const record: SelectedTargetRecord = {
      ...input,
      verification: "unverified",
      updatedAt: this.now(),
    };
    await this.tables.transaction(["selectedTargets"], () =>
      this.tables.selectedTargets.put(record).then(() => undefined),
    );
    return record;
  }

  getSelectedTarget(
    provider: SelectedTargetRecord["provider"],
  ): Promise<SelectedTargetRecord | undefined> {
    return this.tables.selectedTargets.get(provider);
  }

  async markTargetsUnverified(): Promise<void> {
    await this.tables.transaction(["selectedTargets"], async () => {
      const records = await this.tables.selectedTargets.toArray();
      if (records.length === 0) return;
      await this.tables.selectedTargets.bulkPut(
        records.map((record) => ({
          ...record,
          verification: "unverified" as const,
        })),
      );
    });
  }

  // Kept inside the extension-owned repository for a later fresh handshake.
  async markTargetVerified(
    provider: SelectedTargetRecord["provider"],
    canonicalTarget: string,
  ): Promise<boolean> {
    return this.tables.transaction(["selectedTargets"], async () => {
      const current = await this.tables.selectedTargets.get(provider);
      if (!current || current.canonicalTarget !== canonicalTarget) return false;
      await this.tables.selectedTargets.put({
        ...current,
        verification: "verified",
        updatedAt: this.now(),
      });
      return true;
    });
  }

  async saveWorkflow(record: WorkflowRecord): Promise<void> {
    await this.tables.transaction(["workflows"], () =>
      this.tables.workflows.put(record).then(() => undefined),
    );
  }

  getWorkflow(id: string): Promise<WorkflowRecord | undefined> {
    return this.tables.workflows.get(id);
  }

  async saveBatch(record: BatchRecord): Promise<void> {
    await this.tables.transaction(["batches"], () =>
      this.tables.batches.put(record).then(() => undefined),
    );
  }

  getBatch(id: string): Promise<BatchRecord | undefined> {
    return this.tables.batches.get(id);
  }
}
