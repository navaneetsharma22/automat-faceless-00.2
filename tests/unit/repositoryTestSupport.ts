import type { RepositoryDatabase } from "../../src/storage/repositories";
import type {
  BatchRecord,
  PromptDraftRecord,
  SelectedTargetRecord,
  WorkflowRecord,
} from "../../src/storage/db";

export function createMemoryRepositoryDatabase(): RepositoryDatabase {
  const drafts = new Map<string, PromptDraftRecord>();
  const targets = new Map<string, SelectedTargetRecord>();
  const workflows = new Map<string, WorkflowRecord>();
  const batches = new Map<string, BatchRecord>();

  const table = <T extends { id?: string; provider?: string }>(
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
  });

  return {
    promptDrafts: table(drafts, (item) => item.id!),
    selectedTargets: table(targets, (item) => item.provider!),
    workflows: table(workflows, (item) => item.id!),
    batches: table(batches, (item) => item.id!),
    transaction: async (_tableNames, operation) => operation(),
  };
}
