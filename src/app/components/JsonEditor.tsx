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
  imageLayout?: boolean;
  toolbarHeading?: { kicker: string; title: string; id: string };
  editorRef?: React.Ref<HTMLTextAreaElement>;
};

export function JsonEditor({
  id,
  label,
  value,
  onChange,
  editorRef,
  hint,
  error,
  wrapLines = false,
  onWrapLinesChange,
  expanded = false,
  onExpandedChange,
  showCharacterCount = true,
  imageLayout = false,
  toolbarHeading,
  ...textareaProps
}: JsonEditorProps) {
  return (
    <div className={`${styles.editorField} ${imageLayout ? styles.imageEditorField : ""}`}>
      <div className={imageLayout ? styles.imageEditorTopRow : undefined}>
        {toolbarHeading ? (
          <div className={styles.imageEditorHeading}>
            <p>{toolbarHeading.kicker}</p>
            <h2 id={toolbarHeading.id}>{toolbarHeading.title}</h2>
          </div>
        ) : null}
        <div
          className={`${styles.editorToolbar} ${imageLayout ? styles.imageEditorToolbar : ""}`}
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
      </div>
      {!expanded ? (
        <Field id={id} label={label} hint={hint} error={error}>
          <textarea
            {...textareaProps}
            ref={editorRef}
            id={id}
            className={`${styles.control} ${styles.editor} ${imageLayout ? styles.imageEditor : ""} ${wrapLines ? styles.editorWrapped : ""}`}
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
              ref={editorRef}
              className={`${styles.control} ${styles.editor} ${styles.editorExpanded} ${imageLayout ? styles.imageEditor : ""} ${wrapLines ? styles.editorWrapped : ""}`}
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
