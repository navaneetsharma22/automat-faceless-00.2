import {
  Children,
  cloneElement,
  type AriaAttributes,
  type ReactElement,
} from "react";
import styles from "./controls.module.css";

type DescribedControlProps = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

export type FieldProps = {
  id: string;
  label: string;
  children: ReactElement<DescribedControlProps>;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
};

export function Field({
  id,
  label,
  children,
  hint,
  error,
  required = false,
  className,
}: FieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    children.props["aria-describedby"],
    hint ? hintId : "",
    error ? errorId : "",
  ]
    .filter(Boolean)
    .join(" ");
  const control = cloneElement(Children.only(children), {
    id: children.props.id ?? id,
    required: children.props.required ?? required,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? true : children.props["aria-invalid"],
  });

  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.requiredMark} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {control}
      {hint ? (
        <p className={styles.fieldHint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className={styles.fieldError} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
