import styles from "./controls.module.css";

export type NoticeKind = "success" | "error" | "warning" | "info";

const noticeMeta: Record<NoticeKind, { label: string; icon: string }> = {
  success: { label: "Success", icon: "✓" },
  error: { label: "Error", icon: "!" },
  warning: { label: "Warning", icon: "!" },
  info: { label: "Information", icon: "i" },
};

export type NoticeProps = {
  kind: NoticeKind;
  children: string;
  urgent?: boolean;
  announce?: boolean;
  label?: string;
  className?: string;
};

export function Notice({
  kind,
  children,
  urgent = false,
  announce = true,
  label,
  className,
}: NoticeProps) {
  const meta = noticeMeta[kind];
  const role = announce
    ? kind === "error" && urgent
      ? "alert"
      : "status"
    : "group";

  return (
    <div
      className={[
        styles.notice,
        styles[`notice${kind[0].toUpperCase()}${kind.slice(1)}`],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role={role}
      aria-live={announce ? (role === "alert" ? "assertive" : "polite") : "off"}
      aria-atomic="true"
    >
      <span className={styles.noticeIcon} aria-hidden="true">
        {meta.icon}
      </span>
      <div className={styles.noticeContent}>
        <span className={styles.noticeLabel}>{label ?? meta.label}</span>
        <p className={styles.noticeMessage}>{children}</p>
      </div>
    </div>
  );
}
