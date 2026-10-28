import type { Table } from "dexie";
import {
  appDatabase,
  type BatchRecord,
  type PromptItemRecord,
  type PromptDraftRecord,
  type SelectedTargetRecord,
  type WorkflowRecord,
} from "./db";
import {
  PromptBatchInputSchema,
  PromptBatchRecordSchema,
  PromptBatchSnapshotSchema,
  PromptItemRecordSchema,
} from "../shared/schemas";
import { importPromptBatch } from "../domain/batches/importBatch";
import type { PromptKind } from "../domain/batches/types";

export type PromptDraftInput = Pick<
  PromptDraftRecord,
  "id" | "kind" | "rawText"
>;
export type SelectedTargetInput = Pick<
  SelectedTargetRecord,
  "provider" | "tabId" | "canonicalTarget"
>;

export type PromptBatchInput = {
  workspaceId: string;
  kind: PromptKind;
  sourceText: string;
};

export type PromptBatchSnapshot = {
  batch: BatchRecord;
  items: PromptItemRecord[];
};

export class PromptBatchValidationError extends Error {
  constructor() {
    super("The prompt batch did not pass the shared import policy.");
    this.name = "PromptBatchValidationError";
  }
}

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
  promptItems: Pick<
    Table<PromptItemRecord, string>,
    "bulkPut" | "bulkDelete" | "toArray"
  >;
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
    promptItems: database.promptItems,
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
        case "batches+promptItems":
          return database.transaction(
            "rw",
            database.batches,
            database.promptItems,
            operation,
          );
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
      reconnectEnabled: false,
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
    return this.tables.selectedTargets
      .get(provider)
      .then((record) =>
        record
          ? { ...record, reconnectEnabled: record.reconnectEnabled !== false }
          : undefined,
      );
  }

  async setReconnectIntent(
    provider: SelectedTargetRecord["provider"],
    enabled: boolean,
  ): Promise<boolean> {
    return this.tables.transaction(["selectedTargets"], async () => {
      const current = await this.tables.selectedTargets.get(provider);
      if (!current) return false;
      await this.tables.selectedTargets.put({
        ...current,
        reconnectEnabled: enabled,
        updatedAt: this.now(),
      });
      return true;
    });
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

  async savePromptBatch(input: PromptBatchInput): Promise<PromptBatchSnapshot> {
    const parsedInput = PromptBatchInputSchema.safeParse(input);
    if (!parsedInput.success) throw new PromptBatchValidationError();
    const imported = importPromptBatch(input.sourceText, input.kind);
    if (!imported.ok) throw new PromptBatchValidationError();

    const batchId = promptBatchId(input.workspaceId, input.kind);
    const now = this.now();
    const items = await Promise.all(
      imported.items.map(async (item, order): Promise<PromptItemRecord> => {
        const record: PromptItemRecord = {
          id: `${batchId}:item:${order}`,
          batchId,
          workspaceId: input.workspaceId,
          kind: input.kind,
          order,
          rawJsonBody: item.rawBody,
          sourceSpan: item.sourceSpan,
          measurement: item.measurement,
          contentHash: await sha256Hex(item.rawBody),
          createdAt: now,
          ...(item.shotId === undefined ? {} : { shotId: item.shotId }),
          ...(item.identitySource === undefined
            ? {}
            : { identitySource: item.identitySource }),
        };
        if (!PromptItemRecordSchema.safeParse(record).success) {
          throw new PromptBatchValidationError();
        }
        return record;
      }),
    );
    const batch: BatchRecord = {
      id: batchId,
      workflowId: input.workspaceId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      status: "draft",
      sourceText: input.sourceText,
      sourceMode: imported.mode,
      orderedItemIds: items.map((item) => item.id),
      total: imported.total,
      updatedAt: now,
    };
    if (!PromptBatchRecordSchema.safeParse(batch).success) {
      throw new PromptBatchValidationError();
    }

    await this.tables.transaction(["batches+promptItems"], async () => {
      const existing = (await this.tables.promptItems.toArray()).filter(
        (item) => item.batchId === batchId,
      );
      await this.tables.promptItems.bulkPut(items);
      await this.tables.batches.put(batch);
      const replacedIds = existing
        .map((item) => item.id)
        .filter((id) => !batch.orderedItemIds.includes(id));
      if (replacedIds.length > 0) {
        await this.tables.promptItems.bulkDelete(replacedIds);
      }
    });
    return { batch, items };
  }

  async getPromptBatch(
    workspaceId: string,
    kind: PromptKind,
  ): Promise<PromptBatchSnapshot | undefined> {
    let batch: BatchRecord | undefined;
    let batchItems: PromptItemRecord[] = [];
    await this.tables.transaction(["batches+promptItems"], async () => {
      batch = await this.tables.batches.get(promptBatchId(workspaceId, kind));
      if (batch) {
        batchItems = (await this.tables.promptItems.toArray()).filter(
          (item) => item.batchId === batch!.id,
        );
      }
    });
    if (!batch) return undefined;
    const savedBatch = batch;

    const parsedBatch = PromptBatchRecordSchema.safeParse(savedBatch);
    if (!parsedBatch.success) throw new PromptBatchValidationError();
    const storedItems = savedBatch.orderedItemIds.map((id) =>
      batchItems.find((item) => item.id === id),
    );
    if (storedItems.some((item) => item === undefined)) {
      throw new PromptBatchValidationError();
    }
    const items = storedItems as PromptItemRecord[];
    const parsedSnapshot = PromptBatchSnapshotSchema.safeParse({
      batch: savedBatch,
      items,
    });
    if (!parsedSnapshot.success) throw new PromptBatchValidationError();
    if (
      savedBatch.workspaceId !== workspaceId ||
      savedBatch.workflowId !== workspaceId ||
      savedBatch.kind !== kind ||
      savedBatch.id !== promptBatchId(workspaceId, kind) ||
      batchItems.length !== items.length ||
      items.some(
        (item, order) =>
          !PromptItemRecordSchema.safeParse(item).success ||
          item.id !== `${savedBatch.id}:item:${order}` ||
          item.batchId !== savedBatch.id ||
          item.workspaceId !== workspaceId ||
          item.kind !== kind ||
          item.order !== order,
      )
    ) {
      throw new PromptBatchValidationError();
    }

    const imported = importPromptBatch(savedBatch.sourceText, kind);
    const expectedHashes = imported.ok
      ? await Promise.all(imported.items.map((item) => sha256Hex(item.rawBody)))
      : [];
    if (
      !imported.ok ||
      imported.mode !== savedBatch.sourceMode ||
      imported.items.length !== items.length ||
      imported.total.stringCodeUnits !== savedBatch.total.stringCodeUnits ||
      imported.total.utf8Bytes !== savedBatch.total.utf8Bytes ||
      imported.items.some((expected, index) => {
        const stored = items[index]!;
        return (
          expected.rawBody !== stored.rawJsonBody ||
          expected.sourceSpan.start !== stored.sourceSpan.start ||
          expected.sourceSpan.end !== stored.sourceSpan.end ||
          expected.measurement.stringCodeUnits !==
            stored.measurement.stringCodeUnits ||
          expected.measurement.utf8Bytes !== stored.measurement.utf8Bytes ||
          expectedHashes[index] !== stored.contentHash ||
          expected.shotId !== stored.shotId ||
          expected.identitySource !== stored.identitySource
        );
      })
    ) {
      throw new PromptBatchValidationError();
    }
    return { batch: savedBatch, items };
  }
}

export function promptBatchId(workspaceId: string, kind: PromptKind): string {
  return `import:${workspaceId}:${kind}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
