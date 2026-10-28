import styles from "./Toast.module.css";
import type {
  PauseReason,
  ToastNotification,
  ToastManager,
} from "./toastManager";

const toastMeta = {
  success: { label: "Success", icon: "✓" },
  error: { label: "Error", icon: "!" },
  warning: { label: "Warning", icon: "!" },
  info: { label: "Information", icon: "i" },
} as const;

export type ToastProps = {
  notification: ToastNotification;
  manager?: ToastManager;
  announce?: boolean;
  onDismiss?: () => void;
};

export function Toast({
  notification,
  manager,
  announce = true,
  onDismiss,
}: ToastProps) {
  const meta = toastMeta[notification.kind];
  const urgent = notification.kind === "error" && notification.urgent;
  const role = announce ? (urgent ? "alert" : "status") : "group";
  const ariaLive = announce ? (urgent ? "assertive" : "polite") : "off";
  const pause = (reason: PauseReason) =>
    manager?.pause(notification.id, reason);
  const resume = (reason: PauseReason) =>
    manager?.resume(notification.id, reason);

  return (
    <article
      className={[
        styles.toast,
        styles[notification.kind],
        notification.exiting ? "motion-toast-exit" : "motion-toast-enter",
      ].join(" ")}
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      data-toast-kind={notification.kind}
      onMouseEnter={() => pause("hover")}
      onMouseLeave={() => resume("hover")}
      onFocusCapture={(event) => {
        const target = event.relatedTarget as Node | null;
        if (!target || !event.currentTarget.contains(target)) pause("focus");
      }}
      onBlurCapture={(event) => {
        const target = event.relatedTarget as Node | null;
        if (!target || !event.currentTarget.contains(target)) resume("focus");
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        {meta.icon}
      </span>
      <div className={styles.content}>
        <span className={styles.label}>{meta.label}</span>
        <p className={styles.message}>{notification.message}</p>
      </div>
      <button
        className={`${styles.dismiss} motion-control`}
        type="button"
        aria-label={`Dismiss ${meta.label.toLowerCase()} notification`}
        onClick={onDismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
    </article>
  );
}
