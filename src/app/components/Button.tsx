import type { ButtonHTMLAttributes, MouseEventHandler, ReactNode } from "react";
import styles from "./controls.module.css";

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet";
  size?: "regular" | "compact";
  loading?: boolean;
  loadingLabel?: string;
};

export function Button({
  children,
  variant = "primary",
  size = "regular",
  loading = false,
  loadingLabel = "Loading…",
  disabled = false,
  type = "button",
  className,
  onClick,
  ...buttonProps
}: ButtonProps) {
  const blocked = disabled || loading;
  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (blocked) {
      event.preventDefault();
      return;
    }

    onClick?.(event);
  };

  const classes = [
    styles.button,
    styles[`button${variant[0].toUpperCase()}${variant.slice(1)}`],
    size === "compact" ? styles.buttonCompact : "",
    loading ? styles.buttonLoading : "",
    "motion-control",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...buttonProps}
      type={type}
      className={classes}
      disabled={blocked}
      aria-busy={loading || undefined}
      onClick={handleClick}
    >
      {loading ? loadingLabel : children}
    </button>
  );
}
