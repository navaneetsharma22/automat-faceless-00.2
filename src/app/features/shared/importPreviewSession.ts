import {
  importPromptBatch,
  type ImportError,
} from "../../../domain/batches/importBatch";
import type { PromptKind } from "../../../domain/batches/types";

export type SuccessfulImport = Extract<
  ReturnType<typeof importPromptBatch>,
  { ok: true }
>;

export type ImportPreviewSnapshot = {
  source: string;
  revision: number;
  status: "idle" | "pending" | "success" | "error";
  validationId: number;
  result?: SuccessfulImport;
  resultRevision?: number;
  error?: ImportError;
  elapsedMs?: number;
};

type Importer = typeof importPromptBatch;
type Schedule = (callback: () => void) => ReturnType<typeof setTimeout>;

export class ImportPreviewSession {
  private snapshot: ImportPreviewSnapshot;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextValidationId = 1;

  constructor(
    readonly kind: PromptKind,
    private readonly importer: Importer = importPromptBatch,
    private readonly schedule: Schedule = (callback) => setTimeout(callback, 0),
    private readonly now: () => number = () => performance.now(),
  ) {
    this.snapshot = {
      source: "",
      revision: 0,
      status: "idle",
      validationId: 0,
    };
  }

  getSnapshot = (): ImportPreviewSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setSource(source: string): void {
    if (source === this.snapshot.source) return;
    this.invalidateScheduledValidation();
    this.snapshot = {
      ...this.snapshot,
      source,
      revision: this.snapshot.revision + 1,
      status: "idle",
      error: undefined,
      elapsedMs: undefined,
    };
    this.publish();
  }

  clear(): void {
    this.invalidateScheduledValidation();
    this.snapshot = {
      source: "",
      revision: this.snapshot.revision + 1,
      status: "idle",
      validationId: this.nextValidationId++,
      result: undefined,
      resultRevision: undefined,
      error: undefined,
      elapsedMs: undefined,
    };
    this.publish();
  }

  validate(): number {
    this.invalidateScheduledValidation();
    const validationId = this.nextValidationId++;
    const revision = this.snapshot.revision;
    const source = this.snapshot.source;
    this.snapshot = {
      ...this.snapshot,
      status: "pending",
      validationId,
      error: undefined,
      elapsedMs: undefined,
    };
    this.publish();

    this.timer = this.schedule(() => {
      if (
        this.snapshot.validationId !== validationId ||
        this.snapshot.revision !== revision
      ) {
        return;
      }
      const startedAt = this.now();
      const result = this.importer(source, this.kind);
      const elapsedMs = this.now() - startedAt;
      if (
        this.snapshot.validationId !== validationId ||
        this.snapshot.revision !== revision
      ) {
        return;
      }
      this.timer = undefined;
      if (result.ok) {
        this.snapshot = {
          ...this.snapshot,
          status: "success",
          result,
          resultRevision: revision,
          error: undefined,
          elapsedMs,
        };
      } else {
        this.snapshot = {
          ...this.snapshot,
          status: "error",
          error: result.error,
          elapsedMs,
        };
      }
      this.publish();
    });
    return validationId;
  }

  cancel(): void {
    this.invalidateScheduledValidation();
    if (this.snapshot.status === "pending") {
      this.snapshot = { ...this.snapshot, status: "idle" };
      this.publish();
    }
  }

  private invalidateScheduledValidation(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.snapshot = {
      ...this.snapshot,
      validationId: this.nextValidationId++,
    };
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}
