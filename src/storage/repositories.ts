import type { Table } from "dexie";
import {
  appDatabase,
  type BatchRecord,
  type PromptItemRecord,
  type PromptDraftRecord,
  type SelectedTargetRecord,
  type WorkflowRecord,
  type FlowCountRecoveryRecord,
} from "./db";
import {
  PromptBatchInputSchema,
  PromptBatchRecordSchema,
  PromptBatchSnapshotSchema,
  FlowImageAttemptRecordSchema,
  FlowImagePromptSnapshotRecordSchema,
  FlowCountRecoveryRecordSchema,
  PromptItemRecordSchema,
} from "../shared/schemas";
import { importPromptBatch } from "../domain/batches/importBatch";
import type { PromptKind } from "../domain/batches/types";
import { sha256Hex } from "../domain/batches/hashPrompt";
export { sha256Hex } from "../domain/batches/hashPrompt";
import type { FlowImagePromptSnapshotRecord } from "../domain/batches/flowImagePromptSnapshot";
import { flowImagePromptSnapshotId } from "../domain/batches/flowImagePromptSnapshot";
import {
  canTransitionFlowImageAttempt,
  flowImageAttemptActiveKey,
  isBlockingFlowImageAttempt,
  type FlowImageAttemptEvent,
  type FlowImageAttemptRecord,
  type FlowImageAttemptState,
} from "../domain/jobs/attempt";
import {
  FlowImageObservationEventSchema,
  reduceFlowImageObservation,
  reduceFlowImageCountDecision,
  type FlowImageAnyObservationEvent,
} from "../domain/jobs/results";

const FLOW_IMAGE_ATTEMPTS_AND_COUNT_RECOVERIES = [
  "flowImageAttempts+flowCountRecoveries",
];

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

export class ActiveFlowImageAttemptError extends Error {
  constructor() {
    super(
      "A dispatched, uncertain, or active attempt already exists for this image prompt.",
    );
    this.name = "ActiveFlowImageAttemptError";
  }
}

export class FlowCountSessionActiveError extends Error {
  constructor() {
    super("A prior attempt in this count session is unresolved.");
    this.name = "FlowCountSessionActiveError";
  }
}

export class DuplicateFlowImageConfirmationError extends Error {
  constructor() {
    super(
      "This settings confirmation has already been used for a Generate attempt.",
    );
    this.name = "DuplicateFlowImageConfirmationError";
  }
}

export class FlowImageAttemptTransitionError extends Error {
  constructor() {
    super(
      "The image attempt state changed or the requested transition is invalid.",
    );
    this.name = "FlowImageAttemptTransitionError";
  }
}

export class FlowImageAttemptValidationError extends Error {
  readonly schemaIssuePaths: string[];
  readonly schemaIssueCodes: string[];

  constructor(
    issues: readonly { code: string; path: readonly PropertyKey[] }[] = [],
  ) {
    super("The image attempt record failed validation.");
    this.name = "FlowImageAttemptValidationError";
    this.schemaIssuePaths = issues
      .slice(0, 16)
      .map((issue) => issue.path.map(String).join(".") || "$root");
    this.schemaIssueCodes = issues
      .slice(0, 16)
      .map((issue) => issue.code.slice(0, 40));
  }
}

function assertValidFlowImageAttempt(record: FlowImageAttemptRecord): void {
  const parsed = FlowImageAttemptRecordSchema.safeParse(record);
  if (!parsed.success)
    throw new FlowImageAttemptValidationError(parsed.error.issues);
}

export class FlowImageObservationRejectedError extends Error {
  constructor(readonly code: string) {
    super(
      "The Flow image observation did not match the active attempt session.",
    );
    this.name = "FlowImageObservationRejectedError";
  }
}

export class FlowImagePromptSnapshotValidationError extends Error {
  constructor() {
    super(
      "The immutable Flow image prompt snapshot failed integrity validation.",
    );
    this.name = "FlowImagePromptSnapshotValidationError";
  }
}

export class FlowImagePromptSnapshotConflictError extends Error {
  constructor() {
    super(
      "The immutable Flow image prompt snapshot does not match this attempt.",
    );
    this.name = "FlowImagePromptSnapshotConflictError";
  }
}

export class FlowCountRecoveryValidationError extends Error {
  constructor() {
    super("The count recovery could not be safely established.");
    this.name = "FlowCountRecoveryValidationError";
  }
}

function isSameBlockingImageSource(
  existing: FlowImageAttemptRecord,
  candidate: FlowImageAttemptRecord,
): boolean {
  return (
    isBlockingFlowImageAttempt(existing) &&
    existing.itemId === candidate.itemId &&
    existing.promptHash === candidate.promptHash
  );
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
  flowImageAttempts: Pick<
    Table<FlowImageAttemptRecord, string>,
    "add" | "get" | "put" | "toArray"
  >;
  flowImagePromptSnapshots: Pick<
    Table<FlowImagePromptSnapshotRecord, string>,
    "add" | "get"
  >;
  flowCountRecoveries: Pick<
    Table<FlowCountRecoveryRecord, string>,
    "add" | "get" | "toArray"
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
    flowImageAttempts: database.flowImageAttempts,
    flowImagePromptSnapshots: database.flowImagePromptSnapshots,
    flowCountRecoveries: database.flowCountRecoveries,
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
        case "flowImageAttempts":
          return database.transaction(
            "rw",
            database.flowImageAttempts,
            operation,
          );
        case "flowImageAttempts+flowImagePromptSnapshots":
          return database.transaction(
            "rw",
            database.flowImageAttempts,
            database.flowImagePromptSnapshots,
            operation,
          );
        case "flowImagePromptSnapshots":
          return database.transaction(
            "rw",
            database.flowImagePromptSnapshots,
            operation,
          );
        case "flowCountRecoveries":
          return database.transaction(
            "rw",
            database.flowCountRecoveries,
            operation,
          );
        case "flowImageAttempts+flowCountRecoveries":
          return database.transaction(
            "rw",
            database.flowImageAttempts,
            database.flowCountRecoveries,
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
    let record!: SelectedTargetRecord;
    await this.tables.transaction(["selectedTargets"], async () => {
      const current = await this.tables.selectedTargets.get(input.provider);
      record = {
        ...input,
        verification: "unverified",
        verificationBinding: undefined,
        reconnectEnabled: false,
        connectionState: "disconnected",
        revision: (current?.revision ?? 0) + 1,
        lifecycleDiagnostics: current?.lifecycleDiagnostics ?? [],
        updatedAt: this.now(),
      };
      await this.tables.selectedTargets.put(record);
    });
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
        verification: enabled ? current.verification : "unverified",
        connectionState: enabled ? "checking" : "disconnected",
        revision: (current.revision ?? 0) + 1,
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
          connectionState:
            record.reconnectEnabled === false
              ? ("disconnected" as const)
              : ("checking" as const),
          revision: (record.revision ?? 0) + 1,
          lifecycleDiagnostics: [
            ...(record.lifecycleDiagnostics ?? []),
            { kind: "worker_started" as const, at: this.now() },
          ].slice(-32),
          updatedAt: this.now(),
        })),
      );
    });
  }

  async recordTargetVerification(
    binding: NonNullable<SelectedTargetRecord["verificationBinding"]>,
    expectedRevision?: number,
  ): Promise<boolean> {
    return this.tables.transaction(["selectedTargets"], async () => {
      const current = await this.tables.selectedTargets.get(binding.provider);
      if (
        !current ||
        current.tabId !== binding.tabId ||
        current.canonicalTarget !== binding.canonicalTarget ||
        current.reconnectEnabled === false ||
        (expectedRevision !== undefined &&
          (current.revision ?? 0) !== expectedRevision)
      )
        return false;
      await this.tables.selectedTargets.put({
        ...current,
        verification: "verified",
        verificationBinding: binding,
        connectionState: "verified",
        revision: (current.revision ?? 0) + 1,
        updatedAt: this.now(),
      });
      return true;
    });
  }

  async recordConnectionLifecycleDiagnostic(
    provider: SelectedTargetRecord["provider"],
    event: NonNullable<SelectedTargetRecord["lifecycleDiagnostics"]>[number],
    expected?: Pick<SelectedTargetRecord, "tabId" | "canonicalTarget">,
  ): Promise<boolean> {
    return this.tables.transaction(["selectedTargets"], async () => {
      const current = await this.tables.selectedTargets.get(provider);
      if (
        !current ||
        (expected &&
          (current.tabId !== expected.tabId ||
            current.canonicalTarget !== expected.canonicalTarget))
      )
        return false;
      await this.tables.selectedTargets.put({
        ...current,
        lifecycleDiagnostics: [
          ...(current.lifecycleDiagnostics ?? []),
          { ...event, reason: event.reason?.slice(0, 64) },
        ].slice(-32),
      });
      return true;
    });
  }

  async setTargetConnectionState(
    provider: SelectedTargetRecord["provider"],
    state: NonNullable<SelectedTargetRecord["connectionState"]>,
    expectedRevision?: number,
    invalidateVerification = false,
  ): Promise<boolean> {
    return this.tables.transaction(["selectedTargets"], async () => {
      const current = await this.tables.selectedTargets.get(provider);
      if (
        !current ||
        (expectedRevision !== undefined &&
          (current.revision ?? 0) !== expectedRevision)
      )
        return false;
      await this.tables.selectedTargets.put({
        ...current,
        connectionState: state,
        verification: invalidateVerification
          ? "unverified"
          : current.verification,
        revision: invalidateVerification
          ? (current.revision ?? 0) + 1
          : current.revision,
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

  async createFlowImageAttempt(
    input: Omit<FlowImageAttemptRecord, "activeKey" | "sourceSnapshotId"> & {
      activeKey?: string;
      sourceSnapshot: FlowImagePromptSnapshotRecord;
    },
  ): Promise<FlowImageAttemptRecord> {
    const { sourceSnapshot, ...attemptInput } = input;
    const record: FlowImageAttemptRecord = {
      ...attemptInput,
      sourceSnapshotId: sourceSnapshot.snapshotId,
      activeKey: flowImageAttemptActiveKey(
        attemptInput.itemId,
        attemptInput.promptHash,
      ),
    };
    if (
      sourceSnapshot.workspaceId !== record.workspaceId ||
      sourceSnapshot.batchId !== record.batchId ||
      sourceSnapshot.itemId !== record.itemId ||
      sourceSnapshot.promptHash !== record.promptHash ||
      sourceSnapshot.promptCodeUnits !== record.promptCodeUnits ||
      sourceSnapshot.promptUtf8Bytes !== record.promptUtf8Bytes ||
      sourceSnapshot.snapshotId !==
        flowImagePromptSnapshotId(record.itemId, record.promptHash) ||
      !FlowImagePromptSnapshotRecordSchema.safeParse(sourceSnapshot).success ||
      (await sha256Hex(sourceSnapshot.rawJsonBody)) !==
        sourceSnapshot.promptHash
    ) {
      throw new FlowImagePromptSnapshotConflictError();
    }
    assertValidFlowImageAttempt(record);
    try {
      await this.tables.transaction(
        ["flowImageAttempts+flowImagePromptSnapshots"],
        async () => {
          const existing = await this.tables.flowImageAttempts.toArray();
          if (
            existing.some((attempt) =>
              isSameBlockingImageSource(attempt, record),
            )
          ) {
            throw new ActiveFlowImageAttemptError();
          }
          if (
            record.countSessionId &&
            existing.some(
              (attempt) =>
                attempt.countSessionId === record.countSessionId &&
                attempt.state !== "failed-before-dispatch" &&
                !(
                  attempt.state === "dispatched" &&
                  attempt.countDecision?.status === "count_matched"
                ),
            )
          ) {
            throw new FlowCountSessionActiveError();
          }
          if (
            existing.some(
              (attempt) => attempt.confirmationKey === record.confirmationKey,
            )
          ) {
            throw new DuplicateFlowImageConfirmationError();
          }
          const savedSnapshot = await this.tables.flowImagePromptSnapshots.get(
            sourceSnapshot.snapshotId,
          );
          if (savedSnapshot) {
            if (
              !FlowImagePromptSnapshotRecordSchema.safeParse(savedSnapshot)
                .success ||
              savedSnapshot.rawJsonBody !== sourceSnapshot.rawJsonBody ||
              savedSnapshot.promptHash !== sourceSnapshot.promptHash ||
              savedSnapshot.workspaceId !== sourceSnapshot.workspaceId ||
              savedSnapshot.batchId !== sourceSnapshot.batchId ||
              savedSnapshot.itemId !== sourceSnapshot.itemId
            ) {
              throw new FlowImagePromptSnapshotConflictError();
            }
          } else {
            await this.tables.flowImagePromptSnapshots.add(sourceSnapshot);
          }
          await this.tables.flowImageAttempts.add(record);
        },
      );
    } catch (error) {
      if (error instanceof ActiveFlowImageAttemptError) throw error;
      if (error instanceof FlowCountSessionActiveError) throw error;
      if (error instanceof DuplicateFlowImageConfirmationError) throw error;
      if (error instanceof FlowImagePromptSnapshotConflictError) throw error;
      if (error instanceof DOMException && error.name === "ConstraintError") {
        const existing = await this.tables.flowImageAttempts.toArray();
        if (
          existing.some((attempt) => isSameBlockingImageSource(attempt, record))
        ) {
          throw new ActiveFlowImageAttemptError();
        }
        if (
          existing.some(
            (attempt) => attempt.confirmationKey === record.confirmationKey,
          )
        ) {
          throw new DuplicateFlowImageConfirmationError();
        }
        throw error;
      }
      throw error;
    }
    return record;
  }

  async getFlowImagePromptSnapshot(
    snapshotId: string,
  ): Promise<FlowImagePromptSnapshotRecord | undefined> {
    const snapshot = await this.tables.flowImagePromptSnapshots.get(snapshotId);
    if (!snapshot) return undefined;
    if (
      !FlowImagePromptSnapshotRecordSchema.safeParse(snapshot).success ||
      (await sha256Hex(snapshot.rawJsonBody)) !== snapshot.promptHash
    ) {
      throw new FlowImagePromptSnapshotValidationError();
    }
    return snapshot;
  }

  async saveFlowImagePromptSnapshot(
    snapshot: FlowImagePromptSnapshotRecord,
  ): Promise<void> {
    if (
      snapshot.snapshotId !==
        flowImagePromptSnapshotId(snapshot.itemId, snapshot.promptHash) ||
      !FlowImagePromptSnapshotRecordSchema.safeParse(snapshot).success ||
      (await sha256Hex(snapshot.rawJsonBody)) !== snapshot.promptHash ||
      snapshot.rawJsonBody.length !== snapshot.promptCodeUnits ||
      new TextEncoder().encode(snapshot.rawJsonBody).byteLength !==
        snapshot.promptUtf8Bytes
    ) {
      throw new FlowImagePromptSnapshotValidationError();
    }
    await this.tables.transaction(["flowImagePromptSnapshots"], async () => {
      const existing = await this.tables.flowImagePromptSnapshots.get(
        snapshot.snapshotId,
      );
      if (existing) {
        if (
          !FlowImagePromptSnapshotRecordSchema.safeParse(existing).success ||
          existing.workspaceId !== snapshot.workspaceId ||
          existing.batchId !== snapshot.batchId ||
          existing.itemId !== snapshot.itemId ||
          existing.promptHash !== snapshot.promptHash ||
          existing.promptCodeUnits !== snapshot.promptCodeUnits ||
          existing.promptUtf8Bytes !== snapshot.promptUtf8Bytes ||
          existing.rawJsonBody !== snapshot.rawJsonBody
        ) {
          throw new FlowImagePromptSnapshotConflictError();
        }
        return;
      }
      await this.tables.flowImagePromptSnapshots.add(snapshot);
    });
  }

  async transitionFlowImageAttempt(input: {
    attemptId: string;
    expected: FlowImageAttemptState;
    next: FlowImageAttemptState;
    event: FlowImageAttemptEvent;
    baseline?: FlowImageAttemptRecord["baseline"];
    resultBaseline?: FlowImageAttemptRecord["resultBaseline"];
    observationSession?: FlowImageAttemptRecord["observationSession"];
    resultOutcome?: FlowImageAttemptRecord["resultOutcome"];
    countBaseline?: FlowImageAttemptRecord["countBaseline"];
    countDecision?: FlowImageAttemptRecord["countDecision"];
  }): Promise<FlowImageAttemptRecord> {
    if (
      input.next === "dispatch-intent" &&
      (!input.resultBaseline ||
        !input.observationSession ||
        !input.resultOutcome)
    ) {
      throw new FlowImageAttemptValidationError();
    }
    return this.tables.transaction(["flowImageAttempts"], async () => {
      const current = await this.tables.flowImageAttempts.get(input.attemptId);
      if (
        !current ||
        current.state !== input.expected ||
        !canTransitionFlowImageAttempt(current.state, input.next)
      ) {
        throw new FlowImageAttemptTransitionError();
      }
      const next: FlowImageAttemptRecord = {
        ...current,
        state: input.next,
        ...(input.next === "failed-before-dispatch"
          ? { activeKey: undefined }
          : {}),
        ...(input.baseline ? { baseline: input.baseline } : {}),
        ...(input.resultBaseline
          ? { resultBaseline: input.resultBaseline }
          : {}),
        ...(input.observationSession
          ? { observationSession: input.observationSession }
          : {}),
        ...(input.resultOutcome ? { resultOutcome: input.resultOutcome } : {}),
        ...(input.countBaseline ? { countBaseline: input.countBaseline } : {}),
        ...(input.countDecision ? { countDecision: input.countDecision } : {}),
        events: [...current.events, input.event],
        updatedAt: input.event.at,
      };
      assertValidFlowImageAttempt(next);
      await this.tables.flowImageAttempts.put(next);
      return next;
    });
  }

  async getFlowImageAttempt(
    attemptId: string,
  ): Promise<FlowImageAttemptRecord | undefined> {
    return this.tables.flowImageAttempts.get(attemptId);
  }

  async recordFlowImageCountDispatchBoundary(input: {
    attemptId: string;
    boundaryAt: number;
  }): Promise<FlowImageAttemptRecord> {
    return this.tables.transaction(["flowImageAttempts"], async () => {
      const current = await this.tables.flowImageAttempts.get(input.attemptId);
      if (
        !current ||
        current.state !== "dispatch-intent" ||
        !current.countBaseline ||
        !current.countDecision ||
        current.countDecision.dispatchBoundaryAt !== undefined
      )
        throw new FlowImageAttemptValidationError();
      const next: FlowImageAttemptRecord = {
        ...current,
        countDecision: {
          ...current.countDecision,
          dispatchBoundaryAt: input.boundaryAt,
          updatedAt: input.boundaryAt,
        },
        updatedAt: input.boundaryAt,
      };
      assertValidFlowImageAttempt(next);
      await this.tables.flowImageAttempts.put(next);
      const readback = await this.tables.flowImageAttempts.get(input.attemptId);
      if (readback?.countDecision?.dispatchBoundaryAt !== input.boundaryAt)
        throw new FlowImageAttemptValidationError();
      return readback;
    });
  }

  getAllFlowImageAttempts(): Promise<FlowImageAttemptRecord[]> {
    return this.tables.flowImageAttempts.toArray();
  }

  getFlowCountRecoveries(): Promise<FlowCountRecoveryRecord[]> {
    return this.tables.flowCountRecoveries.toArray().then((records) => {
      if (
        records.some(
          (record) => !FlowCountRecoveryRecordSchema.safeParse(record).success,
        )
      )
        throw new FlowCountRecoveryValidationError();
      return records;
    });
  }

  getFlowCountRecovery(
    recoveryId: string,
  ): Promise<FlowCountRecoveryRecord | undefined> {
    return this.tables.flowCountRecoveries.get(recoveryId).then((record) => {
      if (record && !FlowCountRecoveryRecordSchema.safeParse(record).success)
        throw new FlowCountRecoveryValidationError();
      return record;
    });
  }

  async persistFlowCountRecovery(
    record: FlowCountRecoveryRecord,
  ): Promise<FlowCountRecoveryRecord> {
    if (!FlowCountRecoveryRecordSchema.safeParse(record).success)
      throw new FlowCountRecoveryValidationError();
    const transactionTables = FLOW_IMAGE_ATTEMPTS_AND_COUNT_RECOVERIES;
    return this.tables.transaction(transactionTables, async () => {
      const old = await this.tables.flowImageAttempts.get(record.oldAttemptId);
      if (
        !old ||
        old.state !== "dispatched" ||
        !old.countSessionId ||
        old.resultOutcome?.status !== "unknown" ||
        old.promptHash !== record.oldSourceHash ||
        old.projectId !== record.projectId ||
        old.tabId !== record.tabId ||
        old.documentId !== record.documentId ||
        old.countDecision?.status !== "interrupted" ||
        old.observationSession?.sessionId !== record.oldSessionId ||
        old.observationSession.status !== record.oldMonitoringStatus
      )
        throw new FlowCountRecoveryValidationError();
      const existing = await this.tables.flowCountRecoveries.get(
        record.recoveryId,
      );
      if (existing) {
        if (
          JSON.stringify({ ...existing, capturedAt: 0 }) ===
          JSON.stringify({ ...record, capturedAt: 0 })
        )
          return existing;
        throw new FlowCountRecoveryValidationError();
      }
      if (
        (await this.tables.flowCountRecoveries.toArray()).some(
          (entry) => entry.oldAttemptId === record.oldAttemptId,
        )
      )
        throw new FlowCountRecoveryValidationError();
      await this.tables.flowCountRecoveries.add(record);
      const readback = await this.tables.flowCountRecoveries.get(
        record.recoveryId,
      );
      if (!readback || JSON.stringify(readback) !== JSON.stringify(record))
        throw new FlowCountRecoveryValidationError();
      return readback;
    });
  }

  async recordFlowImageObservation(input: {
    attemptId: string;
    event: FlowImageAnyObservationEvent;
    fingerprint: string;
    receivedAt: number;
  }): Promise<{
    status: "applied" | "duplicate";
    attempt: FlowImageAttemptRecord;
  }> {
    const parsedEvent = FlowImageObservationEventSchema.safeParse(input.event);
    if (!parsedEvent.success || !/^[0-9a-f]{64}$/.test(input.fingerprint)) {
      throw new FlowImageObservationRejectedError("invalid_observation");
    }
    const structuralEvent = "kind" in parsedEvent.data;
    const receipt: NonNullable<
      FlowImageAttemptRecord["observationReceipts"]
    >[number] = {
      observationId: parsedEvent.data.observationId,
      sequence: parsedEvent.data.sequence,
      fingerprint: input.fingerprint,
      receivedAt: input.receivedAt,
    };
    const transactionTables = FLOW_IMAGE_ATTEMPTS_AND_COUNT_RECOVERIES;
    return this.tables.transaction(transactionTables, async () => {
      const current = await this.tables.flowImageAttempts.get(input.attemptId);
      if (
        (await this.tables.flowCountRecoveries.toArray()).some(
          (recovery) => recovery.oldAttemptId === input.attemptId,
        )
      )
        throw new FlowImageObservationRejectedError("attempt_superseded");
      if (!current) {
        throw new FlowImageObservationRejectedError("attempt_missing");
      }
      const session = current.observationSession;
      if (
        (current.state !== "dispatch-intent" &&
          current.state !== "dispatched" &&
          current.state !== "uncertain") ||
        (current.state === "dispatch-intent" && !structuralEvent) ||
        !session ||
        session.status !== "active" ||
        session.sessionId !== parsedEvent.data.sessionId ||
        parsedEvent.data.attemptId !== current.attemptId ||
        !current.resultBaseline ||
        (!current.settingsConfirmation.declaredVariantCount && !structuralEvent)
      ) {
        throw new FlowImageObservationRejectedError("session_not_active");
      }
      if (
        !current.resultBaseline ||
        Object.entries(current.resultBaseline.binding).some(
          ([key, value]) =>
            parsedEvent.data.binding[
              key as keyof typeof parsedEvent.data.binding
            ] !== value,
        )
      ) {
        throw new FlowImageObservationRejectedError("binding_mismatch");
      }
      const priorReceipt = (current.observationReceipts ?? []).find(
        (entry) => entry.observationId === receipt.observationId,
      );
      if (priorReceipt) {
        if (priorReceipt.fingerprint !== receipt.fingerprint) {
          throw new FlowImageObservationRejectedError(
            "observation_id_conflict",
          );
        }
        return { status: "duplicate", attempt: current };
      }
      if (
        parsedEvent.data.sequence !== session.lastSequence + 1 ||
        parsedEvent.data.sequence > session.maxEvents ||
        (current.observationReceipts ?? []).length >= session.maxEvents
      ) {
        throw new FlowImageObservationRejectedError(
          "observation_sequence_invalid",
        );
      }
      const reduction = reduceFlowImageObservation(
        current.resultBaseline,
        current.settingsConfirmation.declaredVariantCount,
        current.resultLinks ?? [],
        parsedEvent.data,
        input.receivedAt,
      );
      const structuralKind =
        "kind" in parsedEvent.data ? parsedEvent.data.kind : null;
      const structuralObservations = structuralEvent
        ? [
            ...(current.structuralObservations ?? []),
            parsedEvent.data as import("../domain/jobs/results").FlowStructuralObservationEvent,
          ]
        : current.structuralObservations;
      if (
        structuralObservations &&
        (structuralObservations.length > 64 ||
          JSON.stringify(structuralObservations).length > 512_000)
      ) {
        throw new FlowImageObservationRejectedError(
          "observation_evidence_limit",
        );
      }
      if (reduction.outcome.status === "unknown" && !structuralEvent) {
        throw new FlowImageObservationRejectedError(
          reduction.outcome.reason ?? "observation_ambiguous",
        );
      }
      const terminalInventory =
        !structuralEvent &&
        reduction.links.length ===
          current.settingsConfirmation.declaredVariantCount &&
        reduction.links.every((link) => link.status !== "processing");
      const closeSession =
        structuralKind === "observer_lost" ||
        structuralKind === "observer_timed_out" ||
        reduction.outcome.status === "complete" ||
        reduction.outcome.status === "failed" ||
        (reduction.outcome.status === "partial_error" && terminalInventory) ||
        parsedEvent.data.sequence === session.maxEvents;
      if (parsedEvent.data.sequence === session.maxEvents) {
        reduction.outcome = {
          ...reduction.outcome,
          status: "unknown",
          reason: "event_limit_reached",
        };
      }
      const attempt: FlowImageAttemptRecord = {
        ...current,
        observationSession: {
          ...session,
          lastSequence: parsedEvent.data.sequence,
          ...(closeSession
            ? {
                status:
                  structuralKind === "observer_lost"
                    ? ("lost" as const)
                    : structuralKind === "observer_timed_out"
                      ? ("timed_out" as const)
                      : ("closed" as const),
              }
            : {}),
        },
        resultLinks: reduction.links,
        resultOutcome: reduction.outcome,
        ...(structuralEvent &&
        current.countBaseline &&
        current.settingsConfirmation.declaredVariantCount
          ? {
              countDecision: reduceFlowImageCountDecision({
                declaration: current.countBaseline,
                declaredVariantCount:
                  current.settingsConfirmation.declaredVariantCount,
                expectedCumulativeAdditions:
                  current.countBaseline.priorDeclaredAdditions +
                  current.settingsConfirmation.declaredVariantCount,
                priorMatchedAttemptIds:
                  current.countBaseline.priorMatchedAttemptIds,
                resultBaseline: current.resultBaseline,
                events: [
                  ...(current.structuralObservations ?? []),
                  ...(structuralEvent
                    ? [
                        parsedEvent.data as import("../domain/jobs/results").FlowStructuralObservationEvent,
                      ]
                    : []),
                ],
                dispatchBoundaryAt: current.countDecision?.dispatchBoundaryAt,
                previous: current.countDecision,
                now: input.receivedAt,
              }),
            }
          : {}),
        observationReceipts: [...(current.observationReceipts ?? []), receipt],
        ...(structuralObservations ? { structuralObservations } : {}),
        events: current.events,
        updatedAt: input.receivedAt,
      };
      assertValidFlowImageAttempt(attempt);
      await this.tables.flowImageAttempts.put(attempt);
      const readback = await this.tables.flowImageAttempts.get(input.attemptId);
      if (
        !readback ||
        readback.observationSession?.lastSequence !== receipt.sequence ||
        readback.observationReceipts?.at(-1)?.fingerprint !==
          receipt.fingerprint ||
        readback.resultOutcome?.status !== reduction.outcome.status ||
        readback.countDecision?.observationSequence !==
          attempt.countDecision?.observationSequence
      ) {
        throw new FlowImageAttemptValidationError();
      }
      return { status: "applied", attempt: readback };
    });
  }

  async updateFlowImageObservationSession(input: {
    attemptId: string;
    sessionId: string;
    sessionStatus?: NonNullable<
      FlowImageAttemptRecord["observationSession"]
    >["status"];
    resultOutcome?: FlowImageAttemptRecord["resultOutcome"];
    reconciliationCount?: number;
    armReceipt?: NonNullable<
      FlowImageAttemptRecord["observationSession"]
    >["armReceipt"];
    countBaseline?: FlowImageAttemptRecord["countBaseline"];
    countDecision?: FlowImageAttemptRecord["countDecision"];
    diagnosticCode?: string;
  }): Promise<FlowImageAttemptRecord> {
    return this.tables.transaction(["flowImageAttempts"], async () => {
      const current = await this.tables.flowImageAttempts.get(input.attemptId);
      if (
        !current ||
        !current.observationSession ||
        current.observationSession.sessionId !== input.sessionId
      ) {
        throw new FlowImageObservationRejectedError("session_not_found");
      }
      const updated: FlowImageAttemptRecord = {
        ...current,
        observationSession: {
          ...current.observationSession,
          ...(input.armReceipt ? { armReceipt: input.armReceipt } : {}),
          ...(input.sessionStatus ? { status: input.sessionStatus } : {}),
          ...(input.reconciliationCount !== undefined
            ? { reconciliationCount: input.reconciliationCount }
            : {}),
        },
        ...(input.resultOutcome ? { resultOutcome: input.resultOutcome } : {}),
        ...(input.countBaseline ? { countBaseline: input.countBaseline } : {}),
        ...(input.countDecision ? { countDecision: input.countDecision } : {}),
        ...(input.diagnosticCode &&
        /^[a-z0-9_]{1,64}$/.test(input.diagnosticCode)
          ? {
              events: [
                ...current.events,
                {
                  stage: "observer" as const,
                  at: input.resultOutcome?.updatedAt ?? this.now(),
                  method: "none" as const,
                  code: input.diagnosticCode,
                },
              ].slice(-100),
            }
          : {}),
        updatedAt: input.resultOutcome?.updatedAt ?? this.now(),
      };
      assertValidFlowImageAttempt(updated);
      await this.tables.flowImageAttempts.put(updated);
      const readback = await this.tables.flowImageAttempts.get(input.attemptId);
      if (
        !readback ||
        readback.observationSession?.sessionId !== input.sessionId ||
        readback.observationSession.status !==
          updated.observationSession?.status ||
        readback.resultOutcome?.status !== updated.resultOutcome?.status ||
        readback.countDecision?.status !== updated.countDecision?.status ||
        readback.countDecision?.reason !== updated.countDecision?.reason
      ) {
        throw new FlowImageAttemptValidationError();
      }
      return readback;
    });
  }

  async reconcileInterruptedFlowImageAttempts(): Promise<{
    failedBeforeDispatch: number;
    uncertain: number;
  }> {
    return this.tables.transaction(["flowImageAttempts"], async () => {
      const attempts = await this.tables.flowImageAttempts.toArray();
      let failedBeforeDispatch = 0;
      let uncertain = 0;
      for (const current of attempts) {
        const nextState =
          current.state === "preparing" || current.state === "verified"
            ? "failed-before-dispatch"
            : current.state === "dispatch-intent"
              ? "uncertain"
              : undefined;
        const activeCountObservationInterrupted = Boolean(
          current.countBaseline &&
          current.countDecision &&
          current.observationSession?.status === "active" &&
          (current.state === "dispatched" || current.state === "uncertain"),
        );
        if (!nextState && !activeCountObservationInterrupted) continue;
        const at = this.now();
        const next: FlowImageAttemptRecord = {
          ...current,
          ...(nextState ? { state: nextState } : {}),
          ...(nextState === "failed-before-dispatch"
            ? { activeKey: undefined }
            : {}),
          events: [
            ...current.events,
            {
              stage: "recovery",
              at,
              method: "none",
              code: nextState
                ? nextState === "uncertain"
                  ? "worker_restart_after_intent"
                  : "worker_restart_before_dispatch"
                : "count_observer_interrupted_by_worker_restart",
            },
          ],
          ...((nextState === "uncertain" ||
            activeCountObservationInterrupted) &&
          current.observationSession &&
          (current.observationSession.status === "arming" ||
            current.observationSession.status === "active")
            ? {
                observationSession: {
                  ...current.observationSession,
                  status:
                    current.observationSession.status === "arming"
                      ? ("closed" as const)
                      : ("lost" as const),
                },
                resultOutcome: {
                  status: "unknown" as const,
                  reason:
                    current.observationSession.status === "arming"
                      ? ("observation_not_started" as const)
                      : ("observation_lost" as const),
                  ...(current.settingsConfirmation.declaredVariantCount
                    ? {
                        declaredVariantCount:
                          current.settingsConfirmation.declaredVariantCount,
                      }
                    : {}),
                  observedSucceededCount:
                    current.resultOutcome?.observedSucceededCount ?? 0,
                  observedFailedCount:
                    current.resultOutcome?.observedFailedCount ?? 0,
                  updatedAt: at,
                },
              }
            : {}),
          ...((nextState === "uncertain" ||
            activeCountObservationInterrupted) &&
          current.countDecision
            ? {
                countDecision: {
                  ...current.countDecision,
                  status: "interrupted" as const,
                  reason: "observer_lost" as const,
                  updatedAt: at,
                },
              }
            : {}),
          updatedAt: at,
        };
        assertValidFlowImageAttempt(next);
        await this.tables.flowImageAttempts.put(next);
        if (nextState === "uncertain" || activeCountObservationInterrupted)
          uncertain += 1;
        else failedBeforeDispatch += 1;
      }
      return { failedBeforeDispatch, uncertain };
    });
  }
}

export function promptBatchId(workspaceId: string, kind: PromptKind): string {
  return `import:${workspaceId}:${kind}`;
}
