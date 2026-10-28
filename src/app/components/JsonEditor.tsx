import type { TextareaHTMLAttributes } from "react";
import { Field } from "./Field";
import styles from "./controls.module.css";

export type JsonEditorProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "children"
> & {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
};

export function JsonEditor({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  ...textareaProps
}: JsonEditorProps) {
  return (
    <div className={styles.editorField}>
      <Field id={id} label={label} hint={hint} error={error}>
        <textarea
          {...textareaProps}
          className={`${styles.control} ${styles.editor}`}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          spellCheck={false}
          wrap="off"
        />
      </Field>
      <p className={styles.fieldMeta} aria-live="off">
        Character count: {value.length.toLocaleString()}
      </p>
    </div>
  );
}
