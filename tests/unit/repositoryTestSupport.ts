import type { RepositoryDatabase } from "../../src/storage/repositories";
import type {
  BatchRecord,
  PromptDraftRecord,
  PromptItemRecord,
  SelectedTargetRecord,
  WorkflowRecord,
} from "../../src/storage/db";
import type { FlowImageAttemptRecord } from "../../src/domain/jobs/attempt";
import type { FlowImagePromptSnapshotRecord } from "../../src/domain/batches/flowImagePromptSnapshot";

export function createMemoryRepositoryDatabase(): RepositoryDatabase {
  const drafts = new Map<string, PromptDraftRecord>();
  const targets = new Map<string, SelectedTargetRecord>();
  const workflows = new Map<string, WorkflowRecord>();
  const batches = new Map<string, BatchRecord>();
  const promptItems = new Map<string, PromptItemRecord>();
  const flowImageAttempts = new Map<string, FlowImageAttemptRecord>();
  const flowImagePromptSnapshots = new Map<
    string,
    FlowImagePromptSnapshotRecord
  >();
  let transactionTail = Promise.resolve();

  const table = <T extends object>(
    values: Map<string, T>,
    key: (item: T) => string,
  ) => ({
    put: async (item: T) => {
      values.set(key(item), item);
      return key(item);
    },
    get: async (id: string) => values.get(id),
    toArray: async () => [...values.values()],
    bulkPut: async (items: T[]) => {
      for (const item of items) values.set(key(item), item);
      return items.length;
    },
    bulkDelete: async (keys: string[]) => {
      for (const value of keys) values.delete(value);
    },
    add: async (item: T) => {
      const id = key(item);
      if (values.has(id))
        throw new DOMException("Duplicate key", "ConstraintError");
      if (
        "activeKey" in item &&
        item.activeKey !== undefined &&
        [...values.values()].some(
          (existing) =>
            "activeKey" in existing && existing.activeKey === item.activeKey,
        )
      ) {
        throw new DOMException("Duplicate active key", "ConstraintError");
      }
      if (
        "confirmationKey" in item &&
        [...values.values()].some(
          (existing) =>
            "confirmationKey" in existing &&
            existing.confirmationKey === item.confirmationKey,
        )
      ) {
        throw new DOMException("Duplicate confirmation key", "ConstraintError");
      }
      values.set(id, item);
      return id;
    },
  });

  return {
    promptDrafts: table(drafts, (item) => item.id!),
    selectedTargets: table(targets, (item) => item.provider!),
    workflows: table(workflows, (item) => item.id!),
    batches: table(batches, (item) => item.id!),
    promptItems: table(promptItems, (item) => item.id!),
    flowImageAttempts: table(flowImageAttempts, (item) => item.attemptId),
    flowImagePromptSnapshots: table(
      flowImagePromptSnapshots,
      (item) => item.snapshotId,
    ),
    transaction: async (_tableNames, operation) => {
      let release!: () => void;
      const previous = transactionTail;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshots = [
        drafts,
        targets,
        workflows,
        batches,
        promptItems,
        flowImageAttempts,
        flowImagePromptSnapshots,
      ].map((values) => new Map(values));
      try {
        return await operation();
      } catch (error) {
        [
          drafts,
          targets,
          workflows,
          batches,
          promptItems,
          flowImageAttempts,
          flowImagePromptSnapshots,
        ].forEach((values, index) => {
          values.clear();
          for (const [key, value] of snapshots[index]!) {
            values.set(key, value);
          }
        });
        throw error;
      } finally {
        release();
      }
    },
  };
}
