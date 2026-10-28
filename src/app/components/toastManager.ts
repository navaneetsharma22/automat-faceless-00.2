import type { NoticeKind } from "./Notice";

export const TOAST_EXIT_DURATION_MS = 180;

export type ToastRequest = {
  kind: NoticeKind;
  /** Short, content-free UI copy; never pass prompt, credential, token, or URL data. */
  message: string;
  urgent?: boolean;
  actionable?: boolean;
  durationMs?: number;
};

export type ToastNotification = {
  id: string;
  kind: NoticeKind;
  message: string;
  urgent: boolean;
  actionable: boolean;
  exiting: boolean;
};

type AutoTimer = {
  handle: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  remainingMs: number;
};

export type PauseReason = "hover" | "focus";

export class ToastManager {
  private notifications: ToastNotification[] = [];
  private readonly listeners = new Set<
    (notifications: readonly ToastNotification[]) => void
  >();
  private readonly autoTimers = new Map<string, AutoTimer>();
  private readonly exitTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly pauseReasons = new Map<string, Set<PauseReason>>();
  private nextId = 1;

  constructor(private readonly maxVisible = 4) {}

  getSnapshot(): readonly ToastNotification[] {
    return this.notifications;
  }

  subscribe(
    listener: (notifications: readonly ToastNotification[]) => void,
  ): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  add(request: ToastRequest): string | null {
    const message = request.message.trim();
    if (!message) return null;

    const urgent = request.kind === "error" && request.urgent === true;
    const actionable = request.actionable === true;
    const existing = this.notifications.find(
      (notification) =>
        notification.kind === request.kind &&
        notification.message === message &&
        notification.urgent === urgent &&
        notification.actionable === actionable,
    );
    if (existing) return existing.id;

    const notification: ToastNotification = {
      id: `toast-${this.nextId++}`,
      kind: request.kind,
      message,
      urgent,
      actionable,
      exiting: false,
    };
    const limit = Math.max(1, Math.floor(this.maxVisible));
    const overflow = this.notifications.slice(limit - 1);
    for (const removed of overflow) this.removeImmediately(removed.id, false);

    this.notifications = [
      notification,
      ...this.notifications.filter((item) => item.id !== notification.id),
    ].slice(0, limit);

    const duration = this.getDuration(request);
    if (duration !== null) this.scheduleAutoDismiss(notification.id, duration);
    this.publish();
    return notification.id;
  }

  dismiss(id: string): void {
    const notification = this.notifications.find((item) => item.id === id);
    if (!notification || notification.exiting) return;

    this.clearAutoTimer(id);
    this.pauseReasons.delete(id);
    this.notifications = this.notifications.map((item) =>
      item.id === id ? { ...item, exiting: true } : item,
    );
    this.exitTimers.set(
      id,
      setTimeout(() => this.removeImmediately(id), TOAST_EXIT_DURATION_MS),
    );
    this.publish();
  }

  pause(id: string, reason: PauseReason): void {
    const timer = this.autoTimers.get(id);
    if (
      !timer ||
      !this.notifications.some((item) => item.id === id && !item.exiting)
    ) {
      return;
    }

    const reasons = this.pauseReasons.get(id) ?? new Set<PauseReason>();
    reasons.add(reason);
    this.pauseReasons.set(id, reasons);
    if (timer.handle !== null) {
      clearTimeout(timer.handle);
      timer.remainingMs = Math.max(
        0,
        timer.remainingMs - (Date.now() - timer.startedAt),
      );
      timer.handle = null;
    }
  }

  resume(id: string, reason: PauseReason): void {
    const reasons = this.pauseReasons.get(id);
    if (!reasons) return;
    reasons.delete(reason);
    if (reasons.size > 0) return;

    this.pauseReasons.delete(id);
    const timer = this.autoTimers.get(id);
    if (timer && timer.handle === null) {
      this.scheduleAutoDismiss(id, timer.remainingMs);
    }
  }

  dispose(): void {
    for (const timer of this.autoTimers.values()) {
      if (timer.handle !== null) clearTimeout(timer.handle);
    }
    for (const timer of this.exitTimers.values()) clearTimeout(timer);
    this.autoTimers.clear();
    this.exitTimers.clear();
    this.pauseReasons.clear();
    this.notifications = [];
    this.listeners.clear();
  }

  private getDuration(request: ToastRequest): number | null {
    if (request.kind === "error" || request.actionable) return null;
    if (request.durationMs !== undefined)
      return Math.max(0, request.durationMs);
    return request.kind === "warning" ? 8_000 : 5_000;
  }

  private scheduleAutoDismiss(id: string, durationMs: number): void {
    const timer: AutoTimer = {
      handle: null,
      startedAt: Date.now(),
      remainingMs: durationMs,
    };
    timer.handle = setTimeout(() => {
      this.autoTimers.delete(id);
      this.dismiss(id);
    }, durationMs);
    this.autoTimers.set(id, timer);
  }

  private clearAutoTimer(id: string): void {
    const timer = this.autoTimers.get(id);
    if (timer?.handle !== null && timer?.handle !== undefined) {
      clearTimeout(timer.handle);
    }
    this.autoTimers.delete(id);
  }

  private removeImmediately(id: string, publish = true): void {
    this.clearAutoTimer(id);
    const exitTimer = this.exitTimers.get(id);
    if (exitTimer !== undefined) clearTimeout(exitTimer);
    this.exitTimers.delete(id);
    this.pauseReasons.delete(id);
    const next = this.notifications.filter((item) => item.id !== id);
    if (next.length === this.notifications.length) return;
    this.notifications = next;
    if (publish) this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}
