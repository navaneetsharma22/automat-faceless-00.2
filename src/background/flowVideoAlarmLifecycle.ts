/** Flow startup reconciliation is isolated from Images and Vids so one queue cannot drop another queue's alarms. */
export const FLOW_VIDEO_STARTUP_RECONCILIATION_STEPS = ["startup_readiness", "queue_list", "queue_reconcile"] as const;
export type FlowVideoStartupReconciliationStep = typeof FLOW_VIDEO_STARTUP_RECONCILIATION_STEPS[number];
export type FlowVideoStartupReconciliationFailure = {
  step: FlowVideoStartupReconciliationStep;
  errorCode: string;
  recordIndex?: number;
  recordDigest?: string;
  fieldPath?: string;
  validationRule?: string;
};
export const FLOW_VIDEO_STARTUP_RETRY_ALARM_NAME = "automat-flow-video-queue:startup-retry";

export function describeFlowVideoStartupFailure(error: unknown): FlowVideoStartupReconciliationFailure {
  return error instanceof FlowVideoStartupReconciliationError
    ? {
        step: error.step,
        errorCode: error.errorCode,
        ...(error.recordIndex !== undefined ? { recordIndex: error.recordIndex } : {}),
        ...(error.recordDigest ? { recordDigest: error.recordDigest } : {}),
        ...(error.fieldPath ? { fieldPath: error.fieldPath } : {}),
        ...(error.validationRule ? { validationRule: error.validationRule } : {}),
      }
    : {
        step: "startup_readiness",
        errorCode: error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,47}Error$/.test(error.name)
          ? error.name.toLowerCase()
          : "unknown_exception",
      };
}

export class FlowVideoStartupReconciliationError extends Error {
  readonly step: FlowVideoStartupReconciliationStep;
  readonly errorCode: string;
  readonly recordIndex?: number;
  readonly recordDigest?: string;
  readonly fieldPath?: string;
  readonly validationRule?: string;
  constructor(step: FlowVideoStartupReconciliationStep, error: unknown) {
    const raw = error instanceof Error ? error.message : "";
    const code = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(raw)
      ? raw.toLowerCase()
      : error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,47}Error$/.test(error.name)
        ? error.name.toLowerCase()
        : "unknown_exception";
    super("flow_video_startup_reconciliation_failed");
    this.name = "FlowVideoStartupReconciliationError";
    this.step = step;
    this.errorCode = code;
    const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
    if (typeof details.recordIndex === "number" && Number.isInteger(details.recordIndex) && details.recordIndex >= 0 && details.recordIndex < 1_000_000) this.recordIndex = details.recordIndex;
    if (typeof details.recordDigest === "string" && /^[0-9a-f]{16}$/.test(details.recordDigest)) this.recordDigest = details.recordDigest;
    if (typeof details.fieldPath === "string" && /^[a-zA-Z0-9_.\x5b\x5d-]{1,128}$/.test(details.fieldPath)) this.fieldPath = details.fieldPath;
    if (typeof details.validationRule === "string" && /^[a-zA-Z0-9_]{1,64}$/.test(details.validationRule)) this.validationRule = details.validationRule;
  }
}

/** A rejected attempt is discarded so a later delivered alarm actually retries Flow reconciliation. */
export function createRetryableFlowVideoReadiness(targetStartupReady: Promise<unknown>, reconcile: () => Promise<unknown>) {
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

/** A cold-start Flow failure has no delivered queue alarm to rearm. Keep one bounded global retry that only reconciles and restores per-queue alarms. */
export function createFlowVideoStartupRetryController(input: {
  alarms: Pick<typeof chrome.alarms, "create" | "clear">;
  ready: () => Promise<unknown>;
  now?: () => number;
  minimumDelayMs: number;
}) {
  const now = input.now ?? Date.now;
  const retry = (error: unknown) => {
    const failure = describeFlowVideoStartupFailure(error);
    console.warn("[flow_video_queue_startup_retry]", { at: now(), ...failure });
    void input.alarms.create(FLOW_VIDEO_STARTUP_RETRY_ALARM_NAME, { when: now() + input.minimumDelayMs }).catch(() => {
      console.warn("[flow_video_queue_startup_retry_schedule_failed]", { at: now(), errorCode: "alarm_schedule_failed" });
    });
  };
  return {
    scheduleForFailure: retry,
    handleAlarm: (name: string) => {
      if (name !== FLOW_VIDEO_STARTUP_RETRY_ALARM_NAME) return false;
      void input.ready().then(() => input.alarms.clear(FLOW_VIDEO_STARTUP_RETRY_ALARM_NAME)).catch(retry);
      return true;
    },
  };
}
