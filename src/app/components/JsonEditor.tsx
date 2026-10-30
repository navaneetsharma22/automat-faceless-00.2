import type { TextareaHTMLAttributes } from "react";
import { Field } from "./Field";
import { Button } from "./Button";
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
  wrapLines?: boolean;
  onWrapLinesChange?: (wrap: boolean) => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  showCharacterCount?: boolean;
};

export function JsonEditor({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  wrapLines = false,
  onWrapLinesChange,
  expanded = false,
  onExpandedChange,
  showCharacterCount = true,
  ...textareaProps
}: JsonEditorProps) {
  return (
    <div className={styles.editorField}>
      <div
        className={styles.editorToolbar}
        role="group"
        aria-label="JSON editor display options"
      >
        <Button
          size="compact"
          variant="secondary"
          type="button"
          aria-pressed={wrapLines}
          onClick={() => onWrapLinesChange?.(!wrapLines)}
        >
          Wrap lines
        </Button>
        <Button
          size="compact"
          variant="secondary"
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-expanded-dialog`}
          onClick={() => onExpandedChange?.(!expanded)}
        >
          {expanded ? "Editor expanded" : "Expand editor"}
        </Button>
      </div>
      {!expanded ? (
        <Field id={id} label={label} hint={hint} error={error}>
          <textarea
            {...textareaProps}
            className={`${styles.control} ${styles.editor} ${wrapLines ? styles.editorWrapped : ""}`}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            spellCheck={false}
            wrap={wrapLines ? "soft" : "off"}
          />
        </Field>
      ) : null}
      {showCharacterCount ? (
        <p className={styles.fieldMeta} aria-live="off">
          Character count: {value.length.toLocaleString()} JavaScript code units
        </p>
      ) : null}
      {expanded ? (
        <dialog
          className={`${styles.editorDialog} motion-dialog-enter`}
          id={`${id}-expanded-dialog`}
          aria-labelledby={`${id}-expanded-title`}
          ref={(dialog) => {
            if (dialog && !dialog.open) {
              dialog.showModal();
              dialog.querySelector("textarea")?.focus();
            }
          }}
          onClose={() => onExpandedChange?.(false)}
        >
          <header className={styles.editorDialogHeader}>
            <h2 id={`${id}-expanded-title`}>{label}</h2>
            <div className={styles.editorDialogActions}>
              <Button
                size="compact"
                variant="secondary"
                type="button"
                aria-pressed={wrapLines}
                onClick={() => onWrapLinesChange?.(!wrapLines)}
              >
                Wrap lines
              </Button>
              <form method="dialog">
                <Button variant="secondary" size="compact" type="submit">
                  Close editor
                </Button>
              </form>
            </div>
          </header>
          <Field id={`${id}-expanded`} label={label} hint={hint} error={error}>
            <textarea
              {...textareaProps}
              className={`${styles.control} ${styles.editor} ${styles.editorExpanded} ${wrapLines ? styles.editorWrapped : ""}`}
              value={value}
              onChange={(event) => onChange(event.currentTarget.value)}
              spellCheck={false}
              wrap={wrapLines ? "soft" : "off"}
            />
          </Field>
        </dialog>
      ) : null}
    </div>
  );
}
