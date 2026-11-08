import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import styles from "./ClearQueueAction.module.css";

export function ClearQueueAction({
  disabled,
  onConfirm,
}: {
  disabled: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const confirm = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      if (await onConfirm()) setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="quiet"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        Clear existing prompt
      </Button>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="clear-video-queue-title"
        aria-describedby="clear-video-queue-message"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <h2 id="clear-video-queue-title">Clear this blocked batch?</h2>
        <p id="clear-video-queue-message">
          This removes the blocked batch from the active queue. Shots already
          sent stay in history.
        </p>
        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || disabled}
            loading={busy}
            loadingLabel="Clearing…"
            onClick={() => void confirm()}
          >
            Clear existing prompt
          </Button>
        </div>
      </dialog>
    </>
  );
}
