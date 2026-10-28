import type { ChangeEventHandler } from "react";
import styles from "./controls.module.css";

export type SettingsProvider = "Flow" | "Vids";

export type SettingsConfirmationProps = {
  id: string;
  provider: SettingsProvider;
  checked: boolean;
  onChange: (checked: boolean) => void;
  contextLabel?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
};

export function SettingsConfirmation({
  id,
  provider,
  checked,
  onChange,
  contextLabel,
  hint,
  error,
  disabled = false,
}: SettingsConfirmationProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    `${id}-description`,
    hint ? hintId : "",
    error ? errorId : "",
  ]
    .filter(Boolean)
    .join(" ");
  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    onChange(event.currentTarget.checked);
  };

  return (
    <fieldset className={styles.confirmation} disabled={disabled}>
      <legend className={styles.confirmationLegend}>
        Confirm manual {provider} settings
      </legend>
      <label className={styles.confirmationLabel} htmlFor={id}>
        <input
          className={styles.checkbox}
          id={id}
          type="checkbox"
          checked={checked}
          onChange={handleChange}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
        <span>
          I manually selected and checked the settings in {provider}
          {contextLabel ? ` for ${contextLabel}` : ""}.
        </span>
      </label>
      <p className={styles.confirmationDescription} id={`${id}-description`}>
        This only records your confirmation. Automat Faceless does not inspect
        or change provider settings.
      </p>
      {hint ? (
        <p
          className={`${styles.fieldHint} ${styles.confirmationDescription}`}
          id={hintId}
        >
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          className={`${styles.fieldError} ${styles.confirmationDescription}`}
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
