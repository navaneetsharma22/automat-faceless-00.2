import { describe, expect, it, vi } from "vitest";
import { createRetryableVidsReadiness, createVidsAlarmLifecycle, createVidsStartupRetryController, VidsStartupReconciliationError, VIDS_STARTUP_RETRY_ALARM_NAME } from "../../src/background/vidsAlarmLifecycle";

describe("production Vids alarm listener boundary", () => {
  it("records a cold-start alarm before waiting for reconciliation, then dispatches", async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const events: string[] = [];
    const listener = createVidsAlarmLifecycle({
      prefix: "automat-vids-video-queue:", now: () => 150_000,
      ready: () => ready,
      recordReceived: (_name, scheduledAt, receivedAt) => events.push(`received:${scheduledAt}:${receivedAt}`),
      recordReconciliation: (_name, result) => events.push(`reconciliation:${result}`),
      dispatch: async () => { events.push("dispatch"); },
    });

    listener({ name: "automat-vids-video-queue:batch-a", scheduledTime: 120_000 });
    expect(events).toEqual(["received:120000:150000"]);
    resolveReady();
    await vi.waitFor(() => expect(events).toEqual(["received:120000:150000", "reconciliation:completed", "dispatch"]));
  });

  it("records startup reconciliation failure and never dispatches the alarm", async () => {
    const events: string[] = [];
    const reconciliationFailure = new VidsStartupReconciliationError("alarm_restore", new Error("vids_alarm_schedule_failed"));
    const listener = createVidsAlarmLifecycle({
      prefix: "automat-vids-video-queue:", now: () => 200_000,
      ready: async () => { throw reconciliationFailure; },
      recordReceived: () => events.push("received"),
      recordReconciliation: (_name, result, _at, _receivedAt, failure) => events.push(`reconciliation:${result}:${failure?.step}:${failure?.errorCode}`),
      dispatch: async () => { events.push("dispatch"); },
    });
    listener({ name: "automat-vids-video-queue:batch-b", scheduledTime: 180_000 });
    await vi.waitFor(() => expect(events).toEqual(["received", "reconciliation:failed:alarm_restore:vids_alarm_schedule_failed"]));
    expect(events).not.toContain("dispatch");
  });

  it("reruns reconciliation after a rejected readiness attempt instead of reusing its promise", async () => {
    let calls = 0;
    const ready = createRetryableVidsReadiness(Promise.resolve(), async () => {
      calls += 1;
      if (calls === 1) throw new VidsStartupReconciliationError("queue_list", new Error("unexpected startup failure"));
    });
    await expect(ready()).rejects.toMatchObject({ step: "queue_list", errorCode: "unknown_exception" });
    await expect(ready()).resolves.toBeUndefined();
    await expect(ready()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it("arms a cold-start retry when queue_list fails before per-queue alarm restoration, then clears it after reconciliation succeeds", async () => {
    let calls = 0;
    const ready = createRetryableVidsReadiness(Promise.resolve(), async () => {
      calls += 1;
      if (calls === 1) throw new VidsStartupReconciliationError("queue_list", new Error("vids_video_queue_invalid"));
    });
    const alarms = { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) };
    const controller = createVidsStartupRetryController({ alarms, ready, now: () => 300_000, minimumDelayMs: 30_000 });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(ready()).rejects.toMatchObject({ step: "queue_list", errorCode: "vids_video_queue_invalid" });
    controller.scheduleForFailure(new VidsStartupReconciliationError("queue_list", new Error("vids_video_queue_invalid")));
    await vi.waitFor(() => expect(alarms.create).toHaveBeenCalledWith(VIDS_STARTUP_RETRY_ALARM_NAME, { when: 330_000 }));
    expect(controller.handleAlarm(VIDS_STARTUP_RETRY_ALARM_NAME)).toBe(true);
    await vi.waitFor(() => expect(alarms.clear).toHaveBeenCalledWith(VIDS_STARTUP_RETRY_ALARM_NAME));
    expect(calls).toBe(2);
    expect(warning).toHaveBeenCalledWith("[vids_queue_startup_retry]", expect.objectContaining({ step: "queue_list", errorCode: "vids_video_queue_invalid" }));
    warning.mockRestore();
  });

  it("dispatches after Vids reconciliation even when an unrelated queue reconciliation failed", async () => {
    const unrelatedQueueReady = Promise.reject(new Error("Flow startup reconciliation failed"));
    void unrelatedQueueReady.catch(() => undefined);
    const events: string[] = [];
    const vidsReady = Promise.resolve();
    const listener = createVidsAlarmLifecycle({
      prefix: "automat-vids-video-queue:", now: () => 210_000,
      ready: () => vidsReady,
      recordReceived: () => events.push("received"),
      recordReconciliation: (_name, result) => events.push(`reconciliation:${result}`),
      dispatch: async () => { events.push("dispatch"); },
    });
    listener({ name: "automat-vids-video-queue:batch-c" });
    await vi.waitFor(() => expect(events).toEqual(["received", "reconciliation:completed", "dispatch"]));
  });

  it("ignores alarms outside the Vids namespace", () => {
    const received = vi.fn();
    const listener = createVidsAlarmLifecycle({ prefix: "automat-vids-video-queue:", ready: async () => undefined, recordReceived: received, recordReconciliation: vi.fn(), dispatch: vi.fn(async () => undefined) });
    listener({ name: "automat-flow-video-queue:batch" });
    expect(received).not.toHaveBeenCalled();
  });
});
