import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";
import { ToastManager, type ToastNotification } from "./toastManager";

afterEach(() => {
  vi.useRealTimers();
});

describe("ToastManager", () => {
  it("deduplicates identical notifications and keeps a bounded newest-first stack", () => {
    vi.useFakeTimers();
    const manager = new ToastManager(2);
    const firstId = manager.add({ kind: "success", message: "Saved" });
    const duplicateId = manager.add({ kind: "success", message: "Saved" });
    const secondId = manager.add({ kind: "info", message: "Ready" });
    const thirdId = manager.add({ kind: "warning", message: "Review this" });

    expect(duplicateId).toBe(firstId);
    expect(manager.getSnapshot().map((item) => item.id)).toEqual([
      thirdId,
      secondId,
    ]);
    expect(vi.getTimerCount()).toBe(2);
    manager.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps errors and actionable notices persistent until manually dismissed", () => {
    vi.useFakeTimers();
    const manager = new ToastManager();
    const id = manager.add({
      kind: "error",
      message: "Action needed",
      urgent: true,
      actionable: true,
    });

    vi.advanceTimersByTime(60_000);
    expect(manager.getSnapshot()[0]?.id).toBe(id);
    expect(manager.getSnapshot()[0]?.urgent).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    manager.dispose();
  });

  it("uses brief success/info and longer warning auto-dismiss windows", () => {
    vi.useFakeTimers();
    const manager = new ToastManager();
    const successId = manager.add({ kind: "success", message: "Done" });
    const warningId = manager.add({ kind: "warning", message: "Review" });

    vi.advanceTimersByTime(5_000);
    expect(
      manager.getSnapshot().find((item) => item.id === successId)?.exiting,
    ).toBe(true);
    expect(
      manager.getSnapshot().find((item) => item.id === warningId)?.exiting,
    ).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(
      manager.getSnapshot().find((item) => item.id === warningId)?.exiting,
    ).toBe(true);
    vi.advanceTimersByTime(180);
    expect(manager.getSnapshot()).toHaveLength(0);
    manager.dispose();
  });

  it("runs exit dismissal and clears timers when removed or disposed", () => {
    vi.useFakeTimers();
    const manager = new ToastManager();
    const id = manager.add({
      kind: "success",
      message: "Saved",
      durationMs: 10_000,
    });
    expect(id).not.toBeNull();
    expect(vi.getTimerCount()).toBe(1);

    manager.dismiss(id!);
    expect(manager.getSnapshot()[0]?.exiting).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(180);
    expect(manager.getSnapshot()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    manager.add({ kind: "warning", message: "Review", durationMs: 10_000 });
    expect(vi.getTimerCount()).toBe(1);
    manager.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses remaining auto-dismiss time across hover and keyboard focus", () => {
    vi.useFakeTimers();
    const manager = new ToastManager();
    const id = manager.add({
      kind: "info",
      message: "Still visible",
      durationMs: 5_000,
    });
    const notification = manager.getSnapshot()[0] as ToastNotification;
    const tree = Toast({ notification, manager });
    const article = tree as React.ReactElement<Record<string, unknown>>;
    const mouseEnter = article.props.onMouseEnter as () => void;
    const mouseLeave = article.props.onMouseLeave as () => void;
    const focus = article.props.onFocusCapture as (event: unknown) => void;
    const blur = article.props.onBlurCapture as (event: unknown) => void;
    const focusOutside = {
      relatedTarget: null,
      currentTarget: { contains: () => false },
    };

    vi.advanceTimersByTime(2_000);
    mouseEnter();
    vi.advanceTimersByTime(10_000);
    expect(manager.getSnapshot()[0]?.exiting).toBe(false);

    focus(focusOutside);
    mouseLeave();
    vi.advanceTimersByTime(10_000);
    expect(manager.getSnapshot()[0]?.exiting).toBe(false);

    blur(focusOutside);
    vi.advanceTimersByTime(2_999);
    expect(manager.getSnapshot()[0]?.exiting).toBe(false);
    vi.advanceTimersByTime(1);
    expect(manager.getSnapshot()[0]?.exiting).toBe(true);
    vi.advanceTimersByTime(180);
    expect(manager.getSnapshot()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(id).toBe(notification.id);
    manager.dispose();
  });
});
