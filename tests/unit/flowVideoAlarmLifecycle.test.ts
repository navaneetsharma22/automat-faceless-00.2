import { describe, expect, it, vi } from "vitest";
import {
  createFlowVideoStartupRetryController,
  createRetryableFlowVideoReadiness,
  describeFlowVideoStartupFailure,
  FlowVideoStartupReconciliationError,
  FLOW_VIDEO_STARTUP_RETRY_ALARM_NAME,
} from "../../src/background/flowVideoAlarmLifecycle";

describe("Flow video startup alarm lifecycle", () => {
  it("reruns reconciliation after a rejected readiness attempt instead of reusing its promise", async () => {
    let calls = 0;
    const ready = createRetryableFlowVideoReadiness(Promise.resolve(), async () => {
      calls += 1;
      if (calls === 1) throw new FlowVideoStartupReconciliationError("queue_reconcile", new Error("flow_video_queue_alarm_failed"));
    });
    await expect(ready()).rejects.toMatchObject({ step: "queue_reconcile", errorCode: "flow_video_queue_alarm_failed" });
    await expect(ready()).resolves.toBeUndefined();
    await expect(ready()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it("keeps the successful readiness result once reconciliation succeeds", async () => {
    let calls = 0;
    const ready = createRetryableFlowVideoReadiness(Promise.resolve(), async () => { calls += 1; });
    await ready();
    await ready();
    expect(calls).toBe(1);
  });

  it("arms one cold-start retry and clears it only after Flow reconciliation succeeds", async () => {
    let calls = 0;
    const ready = createRetryableFlowVideoReadiness(Promise.resolve(), async () => {
      calls += 1;
      if (calls === 1) throw new FlowVideoStartupReconciliationError("queue_reconcile", new Error("flow_video_queue_invalid"));
    });
    const alarms = { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) };
    const controller = createFlowVideoStartupRetryController({ alarms, ready, now: () => 300_000, minimumDelayMs: 30_000 });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(ready()).rejects.toMatchObject({ step: "queue_reconcile", errorCode: "flow_video_queue_invalid" });
    controller.scheduleForFailure(new FlowVideoStartupReconciliationError("queue_reconcile", new Error("flow_video_queue_invalid")));
    await vi.waitFor(() => expect(alarms.create).toHaveBeenCalledWith(FLOW_VIDEO_STARTUP_RETRY_ALARM_NAME, { when: 330_000 }));
    expect(controller.handleAlarm(FLOW_VIDEO_STARTUP_RETRY_ALARM_NAME)).toBe(true);
    await vi.waitFor(() => expect(alarms.clear).toHaveBeenCalledWith(FLOW_VIDEO_STARTUP_RETRY_ALARM_NAME));
    expect(calls).toBe(2);
    expect(warning).toHaveBeenCalledWith(
      "[flow_video_queue_startup_retry]",
      expect.objectContaining({ step: "queue_reconcile", errorCode: "flow_video_queue_invalid" }),
    );
    warning.mockRestore();
  });

  it("does not claim alarms from another queue namespace", () => {
    const ready = vi.fn(async () => undefined);
    const controller = createFlowVideoStartupRetryController({
      alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
      ready,
      minimumDelayMs: 30_000,
    });
    expect(controller.handleAlarm("automat-vids-video-queue:startup-retry")).toBe(false);
    expect(controller.handleAlarm("automat-image-queue:queue-a")).toBe(false);
    expect(ready).not.toHaveBeenCalled();
  });

  it("reports bounded failure fields without exposing raw validation messages", () => {
    const error = new FlowVideoStartupReconciliationError("queue_reconcile", Object.assign(new Error("raw secret prompt body"), {
      recordIndex: 4,
      recordDigest: "a".repeat(16),
      fieldPath: "items[2].state",
      validationRule: "queue_item_state_enum",
    }));
    expect(describeFlowVideoStartupFailure(error)).toEqual({
      step: "queue_reconcile",
      errorCode: "unknown_exception",
      recordIndex: 4,
      recordDigest: "a".repeat(16),
      fieldPath: "items[2].state",
      validationRule: "queue_item_state_enum",
    });
    expect(JSON.stringify(describeFlowVideoStartupFailure(error))).not.toContain("raw secret prompt body");
  });
});
