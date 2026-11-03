/** Production listener boundary: receipt is recorded synchronously before startup readiness is awaited. */
export const VIDS_STARTUP_RECONCILIATION_STEPS = ["startup_readiness", "queue_list", "generation_read", "attachment_read", "queue_persist", "alarm_restore"] as const;
export type VidsStartupReconciliationStep = typeof VIDS_STARTUP_RECONCILIATION_STEPS[number];
export type VidsStartupReconciliationFailure = { step: VidsStartupReconciliationStep; errorCode: string; recordIndex?: number; recordDigest?: string; fieldPath?: string; validationRule?: string };

export class VidsStartupReconciliationError extends Error {
  readonly step: VidsStartupReconciliationStep;
  readonly errorCode: string;
  readonly recordIndex?: number;
  readonly recordDigest?: string;
  readonly fieldPath?: string;
  readonly validationRule?: string;
  constructor(step: VidsStartupReconciliationStep, error: unknown) {
    const raw = error instanceof Error ? error.message : "";
    const code = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(raw) ? raw.toLowerCase() : error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,47}Error$/.test(error.name) ? error.name.toLowerCase() : "unknown_exception";
    super("vids_startup_reconciliation_failed");
    this.name = "VidsStartupReconciliationError";
    this.step = step;
    this.errorCode = code;
    const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
    if (typeof details.recordIndex === "number" && Number.isInteger(details.recordIndex) && details.recordIndex >= 0 && details.recordIndex < 1000) this.recordIndex = details.recordIndex;
    if (typeof details.recordDigest === "string" && /^[0-9a-f]{16}$/.test(details.recordDigest)) this.recordDigest = details.recordDigest;
    if (typeof details.fieldPath === "string" && /^[a-z0-9_.\[\]-]{1,128}$/.test(details.fieldPath)) this.fieldPath = details.fieldPath;
    if (typeof details.validationRule === "string" && /^[a-z0-9_]{1,64}$/.test(details.validationRule)) this.validationRule = details.validationRule;
  }
}

/** A rejected attempt is discarded so a later delivered alarm actually retries reconciliation. */
export function createRetryableVidsReadiness(targetStartupReady: Promise<unknown>, reconcile: () => Promise<unknown>) {
  let attempt: Promise<unknown> | undefined;
  let failed = false;
  return () => {
    if (!attempt || failed) {
      failed = false;
      const nextAttempt = targetStartupReady.then(reconcile);
      attempt = nextAttempt;
      void nextAttempt.catch(() => { if (attempt === nextAttempt) failed = true; });
    }
    return attempt;
  };
}

export function createVidsAlarmLifecycle(input: {
  prefix: string;
  now?: () => number;
  ready: () => Promise<unknown>;
  recordReceived: (name: string, scheduledTime: number | undefined, receivedAt: number) => void;
  recordReconciliation: (name: string, result: "completed" | "failed", at: number, receivedAt: number, failure?: VidsStartupReconciliationFailure) => void;
  dispatch: (name: string, scheduledTime?: number) => Promise<unknown>;
}) {
  const now = input.now ?? Date.now;
  return (alarm: { name: string; scheduledTime?: number }) => {
    if (!alarm.name.startsWith(input.prefix)) return;
    const receivedAt = now();
    input.recordReceived(alarm.name, alarm.scheduledTime, receivedAt);
    void input.ready().then(() => {
      input.recordReconciliation(alarm.name, "completed", now(), receivedAt);
      void input.dispatch(alarm.name, alarm.scheduledTime).catch(() => undefined);
    }, (error: unknown) => {
      const failure: VidsStartupReconciliationFailure = error instanceof VidsStartupReconciliationError ? { step: error.step, errorCode: error.errorCode, ...(error.recordIndex !== undefined ? { recordIndex: error.recordIndex } : {}), ...(error.recordDigest ? { recordDigest: error.recordDigest } : {}), ...(error.fieldPath ? { fieldPath: error.fieldPath } : {}), ...(error.validationRule ? { validationRule: error.validationRule } : {}) } : { step: "startup_readiness", errorCode: error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,47}Error$/.test(error.name) ? error.name.toLowerCase() : "unknown_exception" };
      console.warn("[vids_queue_reconciliation_failed]", { at: now(), ...failure });
      input.recordReconciliation(alarm.name, "failed", now(), receivedAt, failure);
    });
  };
}
