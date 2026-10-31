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
  ImageSubmissionQueueRecordSchema,
  TIMED_IMAGE_SUBMISSION_INTERVAL_MS,
  nextTimedDispatchDeadline,
  type ImageQueueManualSettingsDeclaration,
  type ImageSubmissionQueueRecord as QueueRecord,
  type PromptReadbackDiagnostic,
} from "../domain/jobs/queue";
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
import { BUILD_ID, PROTOCOL_VERSION } from "../shared/buildInfo";
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

export class DuplicateTimedImageQueueSourceError extends Error {
  constructor() {
    super("An existing timed image queue already contains this exact source.");
    this.name = "DuplicateTimedImageQueueSourceError";
  }
}

export class ImageQueueEligibilityError extends Error {
  constructor(readonly code: string) {
    super("The timed image queue could not be safely created.");
    this.name = "ImageQueueEligibilityError";
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

function flowProjectIdFromCanonicalTarget(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return;
    if (url.hostname === "flow.google.com") {
      return /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/?$/.exec(
        url.pathname,
      )?.[1];
    }
    if (url.hostname === "labs.google") {
      return /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    }
  } catch {
    return;
  }
}

async function isValidTimedQueueSnapshot(
  record: QueueRecord,
): Promise<boolean> {
  if (!ImageSubmissionQueueRecordSchema.safeParse(record).success) return false;
  if ((await sha256Hex(record.sourceText)) !== record.sourceHash) return false;
  const imported = importPromptBatch(record.sourceText, "image");
  if (
    !imported.ok ||
    imported.mode !== record.sourceMode ||
    imported.items.length !== record.items.length
  ) {
    return false;
  }
  for (let index = 0; index < record.items.length; index += 1) {
    const expected = imported.items[index]!;
    const stored = record.items[index]!;
    if (
      (await sha256Hex(stored.rawJsonBody)) !== stored.promptHash ||
      expected.rawBody !== stored.rawJsonBody ||
      expected.shotId !== stored.shotId ||
      expected.sourceSpan.start !== stored.sourceSpan.start ||
      expected.sourceSpan.end !== stored.sourceSpan.end
    ) {
      return false;
    }
  }
  return true;
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
  imageSubmissionQueues: Pick<
    Table<QueueRecord, string>,
    "add" | "get" | "put" | "toArray"
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
    imageSubmissionQueues: database.imageSubmissionQueues,
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
        case "imageSubmissionQueues":
          return database.transaction(
            "rw",
            database.imageSubmissionQueues,
            operation,
          );
        case "imageSubmissionQueues+selectedTargets":
          return database.transaction(
            "rw",
            database.imageSubmissionQueues,
            database.selectedTargets,
            operation,
          );
        case "imageSubmissionQueues+flowImageAttempts+batches+promptItems+selectedTargets":
          return database.transaction(
            "rw",
            database.imageSubmissionQueues,
            database.flowImageAttempts,
            database.batches,
            database.promptItems,
            database.selectedTargets,
            operation,
          );
        case "imageSubmissionQueues+flowImageAttempts":
          return database.transaction(
            "rw",
            database.imageSubmissionQueues,
            database.flowImageAttempts,
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

  async createTimedImageSubmissionQueue(input: {
    workspaceId: string;
    queueId: string;
    settingsConfirmation: Omit<
      ImageQueueManualSettingsDeclaration,
      "userAttested"
    >;
  }): Promise<QueueRecord> {
    const saved = await this.getPromptBatch(input.workspaceId, "image");
    if (!saved) throw new PromptBatchValidationError();
    const sourceHash = await sha256Hex(saved.batch.sourceText);
    const itemHashes = await Promise.all(
      saved.items.map((item) => sha256Hex(item.rawJsonBody)),
    );
    const now = this.now();
    let record!: QueueRecord;
    await this.tables.transaction(
      [
        "imageSubmissionQueues+flowImageAttempts+batches+promptItems+selectedTargets",
      ],
      async () => {
        const currentBatch = await this.tables.batches.get(saved.batch.id);
        const currentItems = (await this.tables.promptItems.toArray())
          .filter((item) => item.batchId === saved.batch.id)
          .sort((a, b) => a.order - b.order);
        const selected = await this.tables.selectedTargets.get("Flow");
        if (
          !currentBatch ||
          currentBatch.updatedAt !== saved.batch.updatedAt ||
          currentBatch.sourceText !== saved.batch.sourceText ||
          currentBatch.sourceMode !== saved.batch.sourceMode ||
          currentBatch.orderedItemIds.length !==
            saved.batch.orderedItemIds.length ||
          currentBatch.orderedItemIds.some(
            (id, index) => id !== saved.batch.orderedItemIds[index],
          ) ||
          currentItems.length !== saved.items.length ||
          currentItems.some(
            (item, index) =>
              item.id !== saved.items[index]?.id ||
              item.rawJsonBody !== saved.items[index]?.rawJsonBody ||
              item.contentHash !== saved.items[index]?.contentHash ||
              item.shotId !== saved.items[index]?.shotId ||
              item.identitySource !== saved.items[index]?.identitySource ||
              item.sourceSpan.start !== saved.items[index]?.sourceSpan.start ||
              item.sourceSpan.end !== saved.items[index]?.sourceSpan.end ||
              item.measurement.stringCodeUnits !==
                saved.items[index]?.measurement.stringCodeUnits ||
              item.measurement.utf8Bytes !==
                saved.items[index]?.measurement.utf8Bytes,
          )
        ) {
          throw new PromptBatchValidationError();
        }
        if (
          !selected ||
          selected.provider !== "Flow" ||
          selected.tabId !== input.settingsConfirmation.tabId ||
          selected.canonicalTarget !==
            input.settingsConfirmation.canonicalTarget ||
          flowProjectIdFromCanonicalTarget(selected.canonicalTarget) !==
            input.settingsConfirmation.projectId
        ) {
          throw new ImageQueueEligibilityError("selected_project_changed");
        }
        const attempts = await this.tables.flowImageAttempts.toArray();
        if (
          attempts.some(
            (attempt) =>
              isBlockingFlowImageAttempt(attempt) &&
              itemHashes.includes(attempt.promptHash),
          )
        ) {
          throw new ActiveFlowImageAttemptError();
        }
        const queues = await this.tables.imageSubmissionQueues.toArray();
        if (
          !(await Promise.all(queues.map(isValidTimedQueueSnapshot))).every(
            Boolean,
          )
        ) {
          throw new ImageQueueEligibilityError("existing_queue_record_invalid");
        }
        if (
          queues.some((queue) =>
            queue.items.some((item) => itemHashes.includes(item.promptHash)),
          )
        ) {
          throw new DuplicateTimedImageQueueSourceError();
        }
        const imported = importPromptBatch(saved.batch.sourceText, "image");
        if (!imported.ok) throw new PromptBatchValidationError();
        const declaration: ImageQueueManualSettingsDeclaration = {
          ...input.settingsConfirmation,
          userAttested: true,
        };
        record = {
          queueId: input.queueId,
          workspaceId: input.workspaceId,
          kind: "image",
          mode: "timed_submission",
          intervalMs: TIMED_IMAGE_SUBMISSION_INTERVAL_MS,
          state: "ready",
          sourceText: saved.batch.sourceText,
          sourceHash,
          sourceMode: saved.batch.sourceMode,
          selectedProject: {
            provider: "Flow",
            tabId: selected.tabId,
            projectId: declaration.projectId,
            canonicalTarget: selected.canonicalTarget,
            selectionRevision: selected.revision ?? null,
          },
          manualSettingsDeclaration: declaration,
          items: saved.items.map((item, order) => ({
            queueItemId: `${input.queueId}:item:${order}`,
            sourceItemId: item.id,
            order,
            ...(item.shotId === undefined ? {} : { shotId: item.shotId }),
            rawJsonBody: item.rawJsonBody,
            promptHash: itemHashes[order]!,
            sourceSpan: { ...item.sourceSpan },
            itemState: "pending",
            providerOutcome: "not_started",
          })),
          lastDispatchReceiptStoredAt: null,
          nextEligibleDispatchAt: null,
          revision: 0,
          createdAt: now,
          updatedAt: now,
        };
        if (!ImageSubmissionQueueRecordSchema.safeParse(record).success) {
          throw new ImageQueueEligibilityError(
            "queue_record_validation_failed",
          );
        }
        await this.tables.imageSubmissionQueues.add(record);
        const readback = await this.tables.imageSubmissionQueues.get(
          input.queueId,
        );
        if (
          !readback ||
          !(await isValidTimedQueueSnapshot(readback)) ||
          readback.sourceText !== saved.batch.sourceText ||
          readback.items.some(
            (item, index) =>
              item.rawJsonBody !== saved.items[index]?.rawJsonBody ||
              item.promptHash !== itemHashes[index],
          )
        ) {
          throw new ImageQueueEligibilityError("queue_readback_failed");
        }
        record = readback;
      },
    );
    return record;
  }

  async getTimedImageSubmissionQueue(
    queueId: string,
  ): Promise<QueueRecord | undefined> {
    const record = await this.tables.imageSubmissionQueues.get(queueId);
    if (record && !(await isValidTimedQueueSnapshot(record))) {
      throw new ImageQueueEligibilityError("queue_record_invalid");
    }
    return record;
  }

  async claimTimedImageQueueItem(input: {
    queueId: string;
    expectedRevision: number;
    order: number;
    attemptId: string;
    at: number;
  }): Promise<QueueRecord> {
    let result!: QueueRecord;
    await this.tables.transaction(
      ["imageSubmissionQueues+flowImageAttempts"],
      async () => {
        const queue = await this.tables.imageSubmissionQueues.get(
          input.queueId,
        );
        if (!queue || !(await isValidTimedQueueSnapshot(queue)))
          throw new ImageQueueEligibilityError("queue_record_invalid");
        if (queue.revision !== input.expectedRevision)
          throw new ImageQueueEligibilityError("queue_revision_changed");
        if (queue.state !== "ready" && queue.state !== "waiting")
          throw new ImageQueueEligibilityError("queue_not_dispatchable");
        if (
          queue.nextEligibleDispatchAt !== null &&
          input.at < queue.nextEligibleDispatchAt
        )
          throw new ImageQueueEligibilityError("dispatch_not_due");
        const item = queue.items[input.order];
        if (!item || item.order !== input.order || item.itemState !== "pending")
          throw new ImageQueueEligibilityError("queue_item_not_pending");
        const attempts = await this.tables.flowImageAttempts.toArray();
        if (
          attempts.some(
            (attempt) =>
              isBlockingFlowImageAttempt(attempt) &&
              attempt.promptHash === item.promptHash,
          )
        )
          throw new ActiveFlowImageAttemptError();
        const claimed: QueueRecord = {
          ...queue,
          state: queue.state,
          revision: queue.revision + 1,
          updatedAt: input.at,
          items: queue.items.map((entry, index) =>
            index === input.order
              ? {
                  ...entry,
                  itemState: "sending",
                  providerOutcome: "not_started",
                  dispatchIntent: {
                    attemptId: input.attemptId,
                    recordedAt: input.at,
                  },
                }
              : entry,
          ),
        };
        if (!ImageSubmissionQueueRecordSchema.safeParse(claimed).success)
          throw new ImageQueueEligibilityError("dispatch_intent_invalid");
        await this.tables.imageSubmissionQueues.put(claimed);
        const readback = await this.tables.imageSubmissionQueues.get(
          input.queueId,
        );
        if (
          !readback ||
          readback.revision !== claimed.revision ||
          readback.items[input.order]?.dispatchIntent?.attemptId !==
            input.attemptId
        )
          throw new ImageQueueEligibilityError(
            "dispatch_intent_readback_failed",
          );
        result = readback;
      },
    );
    return result;
  }

  async recordTimedImageQueueReceipt(input: {
    queueId: string;
    expectedRevision: number;
    order: number;
    attemptId: string;
    recordedAt: number;
  }): Promise<QueueRecord> {
    let result!: QueueRecord;
    await this.tables.transaction(["imageSubmissionQueues"], async () => {
      const queue = await this.tables.imageSubmissionQueues.get(input.queueId);
      const item = queue?.items[input.order];
      if (
        !queue ||
        item?.itemState !== "sending" ||
        item.dispatchIntent?.attemptId !== input.attemptId ||
        (queue.revision !== input.expectedRevision &&
          !(
            (queue.state === "paused" || queue.state === "stopped") &&
            item.dispatchIntent.activationStartedAt !== undefined
          ))
      )
        throw new ImageQueueEligibilityError(
          "dispatch_receipt_revision_changed",
        );
      const sentItems = queue.items.map((entry, index) =>
        index === input.order
          ? {
              ...entry,
              itemState: "sent" as const,
              providerOutcome: "unknown" as const,
              dispatchReceipt: {
                attemptId: input.attemptId,
                storedAt: input.recordedAt,
                evidence: "activation_pair_sent_or_uncertain" as const,
              },
            }
          : entry,
      );
      const nextIndex = input.order + 1;
      const final = nextIndex >= sentItems.length;
      const next: QueueRecord = {
        ...queue,
        items: sentItems,
        state: final
          ? "sent"
          : queue.state === "paused" || queue.state === "stopped"
            ? queue.state
            : "waiting",
        lastDispatchReceiptStoredAt: input.recordedAt,
        nextEligibleDispatchAt: final
          ? null
          : nextTimedDispatchDeadline(input.recordedAt),
        revision: queue.revision + 1,
        updatedAt: input.recordedAt,
      };
      if (!ImageSubmissionQueueRecordSchema.safeParse(next).success)
        throw new ImageQueueEligibilityError("dispatch_receipt_invalid");
      await this.tables.imageSubmissionQueues.put(next);
      const readback = await this.tables.imageSubmissionQueues.get(
        input.queueId,
      );
      if (
        !readback ||
        readback.revision !== next.revision ||
        readback.items[input.order]?.itemState !== "sent"
      )
        throw new ImageQueueEligibilityError(
          "dispatch_receipt_readback_failed",
        );
      result = readback;
    });
    return result;
  }

  async markTimedImageQueueActivationStarted(input: {
    queueId: string;
    expectedRevision: number;
    order: number;
    attemptId: string;
    at: number;
  }): Promise<QueueRecord> {
    let result!: QueueRecord;
    await this.tables.transaction(["imageSubmissionQueues"], async () => {
      const queue = await this.tables.imageSubmissionQueues.get(input.queueId);
      const item = queue?.items[input.order];
      if (
        !queue ||
        queue.revision !== input.expectedRevision ||
        (queue.state !== "ready" && queue.state !== "waiting") ||
        item?.itemState !== "sending" ||
        item.dispatchIntent?.attemptId !== input.attemptId ||
        item.dispatchIntent.activationStartedAt !== undefined
      )
        throw new ImageQueueEligibilityError(
          "activation_intent_revision_changed",
        );
      result = {
        ...queue,
        revision: queue.revision + 1,
        updatedAt: input.at,
        items: queue.items.map((entry, index) =>
          index === input.order
            ? {
                ...entry,
                providerOutcome: "unknown",
                dispatchIntent: {
                  ...entry.dispatchIntent!,
                  activationStartedAt: input.at,
                },
              }
            : entry,
        ),
      };
      if (!ImageSubmissionQueueRecordSchema.safeParse(result).success)
        throw new ImageQueueEligibilityError("activation_intent_invalid");
      await this.tables.imageSubmissionQueues.put(result);
      const readback = await this.tables.imageSubmissionQueues.get(
        input.queueId,
      );
      if (
        !readback ||
        readback.revision !== result.revision ||
        readback.items[input.order]?.dispatchIntent?.activationStartedAt !==
          input.at
      )
        throw new ImageQueueEligibilityError(
          "activation_intent_readback_failed",
        );
      result = readback;
    });
    return result;
  }

  async blockTimedImageQueue(input: {
    queueId: string;
    expectedRevision: number;
    order: number;
    at: number;
    uncertain: boolean;
    reason: string;
    diagnostic?: PromptReadbackDiagnostic;
  }): Promise<QueueRecord | undefined> {
    let result: QueueRecord | undefined;
    await this.tables.transaction(["imageSubmissionQueues"], async () => {
      const queue = await this.tables.imageSubmissionQueues.get(input.queueId);
      if (!queue || queue.revision !== input.expectedRevision) return;
      result = {
        ...queue,
        state: queue.state === "stopped" ? "stopped" : "blocked",
        revision: queue.revision + 1,
        updatedAt: input.at,
        items: queue.items.map((entry, index) =>
          index === input.order && entry.itemState === "sending"
            ? {
                ...entry,
                itemState: "blocked",
                blockReason: input.reason.slice(0, 64),
                providerOutcome:
                  input.uncertain ||
                  entry.dispatchIntent?.activationStartedAt !== undefined
                    ? "unknown"
                    : "not_started",
                ...(input.diagnostic
                  ? { readbackDiagnostic: input.diagnostic }
                  : {}),
              }
            : entry,
        ),
      };
      if (!ImageSubmissionQueueRecordSchema.safeParse(result).success) {
        if (input.diagnostic) {
          result = {
            ...result,
            items: queue.items.map((entry, index) =>
              index === input.order && entry.itemState === "sending"
                ? {
                    ...entry,
                    itemState: "blocked",
                    blockReason: input.reason.slice(0, 64),
                    providerOutcome:
                      input.uncertain ||
                      entry.dispatchIntent?.activationStartedAt !== undefined
                        ? "unknown"
                        : "not_started",
                  }
                : entry,
            ),
          };
        }
      }
      if (!ImageSubmissionQueueRecordSchema.safeParse(result).success)
        throw new ImageQueueEligibilityError("queue_block_readback_invalid");
      await this.tables.imageSubmissionQueues.put(result);
      const readback = await this.tables.imageSubmissionQueues.get(
        input.queueId,
      );
      if (!readback || readback.revision !== result.revision)
        throw new ImageQueueEligibilityError("queue_block_readback_failed");
      result = readback;
    });
    return result;
  }

  async pauseTimedImageQueue(input: {
    queueId: string;
    expectedRevision: number;
    at: number;
    reason?: string;
  }): Promise<QueueRecord> {
    return this.updateTimedImageQueueCommand(input, "pause");
  }

  async stopTimedImageQueue(input: {
    queueId: string;
    expectedRevision: number;
    at: number;
  }): Promise<QueueRecord> {
    return this.updateTimedImageQueueCommand(input, "stop");
  }

  private async updateTimedImageQueueCommand(
    input: {
      queueId: string;
      expectedRevision: number;
      at: number;
      reason?: string;
    },
    command: "pause" | "stop",
  ): Promise<QueueRecord> {
    let result!: QueueRecord;
    await this.tables.transaction(["imageSubmissionQueues"], async () => {
      const queue = await this.tables.imageSubmissionQueues.get(input.queueId);
      if (!queue || !(await isValidTimedQueueSnapshot(queue)))
        throw new ImageQueueEligibilityError("queue_record_invalid");
      if (queue.revision !== input.expectedRevision) {
        if (
          (command === "pause" && queue.state === "paused") ||
          (command === "stop" && queue.state === "stopped")
        ) {
          result = queue;
          return;
        }
        throw new ImageQueueEligibilityError("queue_revision_changed");
      }
      if (
        command === "pause" &&
        ["stopped", "sent", "blocked"].includes(queue.state)
      ) {
        result = queue;
        return;
      }
      if (command === "stop" && ["stopped", "sent"].includes(queue.state)) {
        result = queue;
        return;
      }
      const nextState = command === "pause" ? "paused" : "stopped";
      const items = queue.items.map((item) => {
        if (item.itemState === "pending")
          return command === "stop"
            ? { ...item, itemState: "stopped" as const }
            : item;
        // A claim without the authorization marker is safe to return to Pending:
        // activation is impossible until the revision-checked marker commits.
        if (
          item.itemState === "sending" &&
          item.dispatchIntent?.activationStartedAt === undefined
        ) {
          if (command === "stop")
            return { ...item, itemState: "stopped" as const };
          const { dispatchIntent, ...withoutIntent } = item;
          void dispatchIntent;
          return {
            ...withoutIntent,
            itemState: "pending" as const,
            providerOutcome: "not_started" as const,
          };
        }
        return item;
      });
      const { pauseReason: previousPauseReason, ...withoutPauseReason } = queue;
      void previousPauseReason;
      const next: QueueRecord = {
        ...withoutPauseReason,
        state: nextState,
        ...(command === "pause"
          ? { pauseReason: (input.reason ?? "user_requested").slice(0, 64) }
          : {}),
        items,
        revision: queue.revision + 1,
        updatedAt: input.at,
      };
      if (!ImageSubmissionQueueRecordSchema.safeParse(next).success)
        throw new ImageQueueEligibilityError("queue_command_invalid");
      await this.tables.imageSubmissionQueues.put(next);
      const readback = await this.tables.imageSubmissionQueues.get(
        input.queueId,
      );
      if (
        !readback ||
        readback.revision !== next.revision ||
        readback.state !== nextState
      )
        throw new ImageQueueEligibilityError("queue_command_readback_failed");
      result = readback;
    });
    return result;
  }

  async resumeTimedImageQueue(input: {
    queueId: string;
    expectedRevision: number;
    at: number;
  }): Promise<QueueRecord> {
    let result!: QueueRecord;
    await this.tables.transaction(
      ["imageSubmissionQueues+selectedTargets"],
      async () => {
        const queue = await this.tables.imageSubmissionQueues.get(
          input.queueId,
        );
        if (!queue || !(await isValidTimedQueueSnapshot(queue)))
          throw new ImageQueueEligibilityError("queue_record_invalid");
        if (queue.revision !== input.expectedRevision) {
          if (
            queue.revision === input.expectedRevision + 1 &&
            (queue.state === "ready" || queue.state === "waiting")
          ) {
            result = queue;
            return;
          }
          throw new ImageQueueEligibilityError("queue_revision_changed");
        }
        if (queue.state !== "paused") {
          result = queue;
          return;
        }
        if (
          queue.items.some(
            (item) =>
              item.itemState === "sending" ||
              (item.dispatchIntent &&
                item.itemState !== "sent" &&
                item.itemState !== "blocked"),
          )
        )
          throw new ImageQueueEligibilityError(
            "queue_unresolved_dispatch_requires_review",
          );
        const selected = await this.getSelectedTarget("Flow");
        const binding = selected?.verificationBinding;
        if (
          !selected ||
          selected.tabId !== queue.selectedProject.tabId ||
          selected.canonicalTarget !== queue.selectedProject.canonicalTarget ||
          selected.verification !== "verified" ||
          selected.connectionState !== "verified" ||
          !binding ||
          binding.projectId !== queue.selectedProject.projectId ||
          binding.tabId !== queue.selectedProject.tabId ||
          binding.canonicalTarget !== queue.selectedProject.canonicalTarget ||
          !binding.documentId
        )
          throw new ImageQueueEligibilityError(
            "selected_project_or_document_changed",
          );
        const state = queue.items.some((item) => item.itemState === "sent")
          ? "waiting"
          : "ready";
        const { pauseReason, ...withoutPauseReason } = queue;
        void pauseReason;
        const next: QueueRecord = {
          ...withoutPauseReason,
          state,
          revision: queue.revision + 1,
          updatedAt: input.at,
        };
        if (!ImageSubmissionQueueRecordSchema.safeParse(next).success)
          throw new ImageQueueEligibilityError("queue_resume_invalid");
        await this.tables.imageSubmissionQueues.put(next);
        const readback = await this.tables.imageSubmissionQueues.get(
          input.queueId,
        );
        if (
          !readback ||
          readback.revision !== next.revision ||
          readback.state !== state
        )
          throw new ImageQueueEligibilityError("queue_resume_readback_failed");
        result = readback;
      },
    );
    return result;
  }

  async retryBlockedTimedImageQueueItem(input: {
    queueId: string;
    expectedRevision: number;
    order: number;
    at: number;
    freshExactSha256: string;
  }): Promise<QueueRecord> {
    let result!: QueueRecord;
    await this.tables.transaction(
      ["imageSubmissionQueues+selectedTargets"],
      async () => {
        const queue = await this.tables.imageSubmissionQueues.get(
          input.queueId,
        );
        if (!queue || !(await isValidTimedQueueSnapshot(queue)))
          throw new ImageQueueEligibilityError("queue_record_invalid");
        if (queue.revision !== input.expectedRevision)
          throw new ImageQueueEligibilityError("queue_revision_changed");
        if (queue.state !== "blocked")
          throw new ImageQueueEligibilityError("queue_not_blocked");
        if (input.order < 0 || input.order >= queue.items.length)
          throw new ImageQueueEligibilityError("image_queue_item_not_found");

        const item = queue.items[input.order]!;
        if (item.itemState !== "blocked")
          throw new ImageQueueEligibilityError("item_not_blocked");

        // Durable proof 1: No activation authorization
        if (item.providerOutcome !== "not_started")
          throw new ImageQueueEligibilityError("incompatible_activation_state");
        if (item.dispatchIntent?.activationStartedAt !== undefined)
          throw new ImageQueueEligibilityError(
            "uncertain_activation_replay_prohibited",
          );

        // Durable proof 2: No receipt or uncertain dispatch for this or subsequent items
        if (item.dispatchReceipt !== undefined)
          throw new ImageQueueEligibilityError(
            "dispatch_receipt_already_exists",
          );
        const subsequentDispatched = queue.items
          .slice(input.order + 1)
          .some(
            (entry) =>
              entry.itemState !== "pending" ||
              entry.dispatchReceipt !== undefined,
          );
        if (subsequentDispatched)
          throw new ImageQueueEligibilityError("incompatible_queue_state");

        // Prior items (e.g. Shot 10) must be sent with valid dispatch receipt
        const priorIncomplete = queue.items
          .slice(0, input.order)
          .some(
            (entry) => entry.itemState !== "sent" || !entry.dispatchReceipt,
          );
        if (priorIncomplete)
          throw new ImageQueueEligibilityError("prior_item_not_sent");

        // Durable proof 3: Unchanged source text hash
        const sourceHashMatches =
          (await sha256Hex(item.rawJsonBody)) === item.promptHash;
        if (!sourceHashMatches)
          throw new ImageQueueEligibilityError("source_hash_mismatch");

        // Durable proof 3: Unchanged project and document binding
        const selected = await this.getSelectedTarget("Flow");
        const binding = selected?.verificationBinding;
        if (
          !selected ||
          selected.provider !== "Flow" ||
          selected.tabId !== queue.selectedProject.tabId ||
          selected.canonicalTarget !== queue.selectedProject.canonicalTarget ||
          selected.verification !== "verified" ||
          selected.connectionState !== "verified" ||
          !binding ||
          binding.projectId !== queue.selectedProject.projectId ||
          binding.tabId !== queue.selectedProject.tabId ||
          binding.canonicalTarget !== queue.selectedProject.canonicalTarget ||
          !binding.documentId ||
          binding.extensionBuildId !== BUILD_ID ||
          binding.connectorBuildId !== BUILD_ID ||
          binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
          binding.connectorProtocolVersion !== 1
        )
          throw new ImageQueueEligibilityError(
            "selected_project_or_document_changed",
          );

        // Durable proof 4: Fresh exact check
        if (input.freshExactSha256 !== item.promptHash)
          throw new ImageQueueEligibilityError("fresh_exact_check_failed");

        // Transition: Unblock only the target item to "pending", clearing dispatchIntent
        // and blockReason, while strictly preserving readbackDiagnostic and Shot 10 receipt.
        const updatedItems = queue.items.map((entry, idx) => {
          if (idx !== input.order) return entry;
          const { dispatchIntent, blockReason, ...preserved } = entry;
          void dispatchIntent;
          void blockReason;
          return {
            ...preserved,
            itemState: "pending" as const,
            providerOutcome: "not_started" as const,
          };
        });

        // The queue transitions safely to "paused" so that it does NOT automatically resume
        // and does NOT perform live Generate. The 40s scheduler timing is preserved.
        const next: QueueRecord = {
          ...queue,
          state: "paused",
          pauseReason: "guarded_retry_ready",
          items: updatedItems,
          lastDispatchReceiptStoredAt: queue.lastDispatchReceiptStoredAt,
          nextEligibleDispatchAt: queue.lastDispatchReceiptStoredAt
            ? nextTimedDispatchDeadline(queue.lastDispatchReceiptStoredAt)
            : null,
          revision: queue.revision + 1,
          updatedAt: input.at,
        };

        if (!ImageSubmissionQueueRecordSchema.safeParse(next).success)
          throw new ImageQueueEligibilityError("queue_retry_invalid");

        await this.tables.imageSubmissionQueues.put(next);
        const readback = await this.tables.imageSubmissionQueues.get(
          input.queueId,
        );
        if (
          !readback ||
          readback.revision !== next.revision ||
          readback.state !== "paused" ||
          readback.items[input.order]?.itemState !== "pending"
        )
          throw new ImageQueueEligibilityError("queue_retry_readback_failed");

        result = readback;
      },
    );
    return result;
  }

  async listTimedImageSubmissionQueues(
    workspaceId: string,
  ): Promise<QueueRecord[]> {
    const records = (await this.tables.imageSubmissionQueues.toArray()).filter(
      (record) => record.workspaceId === workspaceId,
    );
    if (
      !(await Promise.all(records.map(isValidTimedQueueSnapshot))).every(
        Boolean,
      )
    ) {
      throw new ImageQueueEligibilityError("queue_record_invalid");
    }
    return records.sort((a, b) => a.createdAt - b.createdAt);
  }

  async listAllTimedImageSubmissionQueues(): Promise<QueueRecord[]> {
    const records = await this.tables.imageSubmissionQueues.toArray();
    if (
      !(await Promise.all(records.map(isValidTimedQueueSnapshot))).every(
        Boolean,
      )
    )
      throw new ImageQueueEligibilityError("queue_record_invalid");
    return records;
  }

  async validateTimedImageQueueStart(queueId: string): Promise<QueueRecord> {
    const queue = await this.getTimedImageSubmissionQueue(queueId);
    if (!queue) throw new ImageQueueEligibilityError("queue_not_found");
    if (
      queue.state !== "ready" ||
      queue.items.some((item) => item.itemState !== "pending")
    )
      throw new ImageQueueEligibilityError(
        "queue_already_started_or_unresolved",
      );
    const selected = await this.getSelectedTarget("Flow");
    if (
      !selected ||
      selected.tabId !== queue.selectedProject.tabId ||
      selected.canonicalTarget !== queue.selectedProject.canonicalTarget ||
      selected.verification !== "verified" ||
      selected.connectionState !== "verified" ||
      selected.verificationBinding?.projectId !==
        queue.selectedProject.projectId ||
      selected.verificationBinding?.documentId === undefined
    )
      throw new ImageQueueEligibilityError(
        "selected_project_or_document_changed",
      );
    if (
      queue.manualSettingsDeclaration.confirmedAt > this.now() ||
      queue.manualSettingsDeclaration.confirmationId.length === 0
    )
      throw new ImageQueueEligibilityError("settings_confirmation_invalid");
    return queue;
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
      revision: attemptInput.revision ?? 0,
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
        revision: (current.revision ?? 0) + 1,
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
        revision: (current.revision ?? 0) + 1,
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
    expectedOldAttemptRevision: number,
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
        (old.revision ?? 0) !== expectedOldAttemptRevision ||
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
        revision: (current.revision ?? 0) + 1,
      };
      assertValidFlowImageAttempt(attempt);
      await this.tables.flowImageAttempts.put(attempt);
      const readback = await this.tables.flowImageAttempts.get(input.attemptId);
      if (
        !readback ||
        readback.revision !== attempt.revision ||
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
    expectedRevision: number;
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
      if ((current.revision ?? 0) !== input.expectedRevision)
        throw new FlowImageObservationRejectedError("attempt_revision_changed");
      const terminalSession = [
        "lost",
        "timed_out",
        "closed",
        "unsupported",
      ].includes(current.observationSession.status);
      if (
        (terminalSession &&
          (input.sessionStatus === "active" ||
            input.sessionStatus === "arming")) ||
        (input.countDecision?.status === "observing" &&
          (terminalSession ||
            current.countDecision?.status === "interrupted")) ||
        (current.countDecision?.status === "interrupted" &&
          input.countDecision !== undefined &&
          input.countDecision.status !== "interrupted")
      ) {
        throw new FlowImageObservationRejectedError(
          "terminal_observation_cannot_resume",
        );
      }
      const updated: FlowImageAttemptRecord = {
        ...current,
        revision: (current.revision ?? 0) + 1,
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
        readback.revision !== updated.revision ||
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
          revision: (current.revision ?? 0) + 1,
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
