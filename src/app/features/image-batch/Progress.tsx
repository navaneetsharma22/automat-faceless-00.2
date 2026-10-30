import { useEffect, useState } from "react";
import type { FoundationClient } from "../../../shared/messageClient";
import type { FlowSettingsConfirmation } from "../../../shared/schemas";
import {
  ImageSubmissionQueueRecordSchema,
  TIMED_IMAGE_SUBMISSION_INTERVAL_MS,
  type ImageSubmissionQueueRecord,
} from "../../../domain/jobs/queue";
import { Button } from "../../components/Button";
import styles from "./Progress.module.css";

export function ImageQueueProgress({
  workspaceId,
  persistenceClient,
  sourceReady,
  settingsConfirmation,
}: {
  workspaceId: string;
  persistenceClient: FoundationClient;
  sourceReady: boolean;
  settingsConfirmation?: FlowSettingsConfirmation;
}) {
  const [queues, setQueues] = useState<ImageSubmissionQueueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void persistenceClient
      .request("imageQueue.list", { workspaceId })
      .then((value) => {
        if (!Array.isArray(value)) throw new Error("The queue list was invalid.");
        const records = value.map((entry) => {
          const parsed = ImageSubmissionQueueRecordSchema.safeParse(entry);
          if (!parsed.success) throw new Error("A saved queue failed validation.");
          return parsed.data;
        });
        if (active) setQueues(records);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Saved queues could not be read.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [persistenceClient, workspaceId]);

  const disabledReason = !sourceReady
    ? "Validate and save the current image source before creating a queue."
    : !settingsConfirmation
      ? "Confirm the manually selected Flow project settings before creating a queue."
      : creating
        ? "Queue creation is being saved and read back."
        : undefined;

  const createQueue = async () => {
    if (!sourceReady || !settingsConfirmation || creating) return;
    setCreating(true);
    setError(undefined);
    try {
      const record = await persistenceClient.request("imageQueue.createTimed", {
        workspaceId,
        queueId: crypto.randomUUID(),
        settingsConfirmation,
      });
      const parsed = ImageSubmissionQueueRecordSchema.safeParse(record);
      if (!parsed.success) throw new Error("The saved queue failed readback validation.");
      setQueues((current) => [...current, parsed.data]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The timed queue could not be saved.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className={styles.progress} aria-labelledby="image-queue-title">
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>TIMED SUBMISSION MODE</p>
          <h3 id="image-queue-title">Image queue</h3>
        </div>
        <span className={styles.interval}>40 seconds between dispatches</span>
      </div>
      <p className={styles.helper}>
        Each saved prompt is one submission. The manually declared variant count is recorded as settings context; it does not multiply Generate actions.
      </p>
      <p className={styles.helper}>
        P06.1 saves the ordered queue only. Provider submission and countdown scheduling are unavailable; nothing is sent to Flow.
      </p>
      <div className={styles.actionRow}>
        <Button type="button" disabled={Boolean(disabledReason)} loading={creating} loadingLabel="Saving queue…" onClick={() => void createQueue()}>
          Create timed queue
        </Button>
        <span className={styles.helper} role="status">{disabledReason ?? "Ready to persist after source and settings checks."}</span>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {loading ? <p className={styles.helper} role="status">Reading saved queues…</p> : null}
      {!loading && queues.length === 0 ? (
        <p className={styles.empty}>No timed queue saved. No provider submission has started.</p>
      ) : null}
      {queues.map((queue) => (
        <section className={styles.queue} key={queue.queueId} aria-label={`Timed image queue ${queue.queueId}`}>
          <div className={styles.queueHeader}>
            <strong>{queue.items.length} saved prompt{queue.items.length === 1 ? "" : "s"}</strong>
            <span>{queue.state === "ready" ? "Saved · not started" : queue.state}</span>
          </div>
          <p className={styles.helper}>Project binding captured for review. Execution is unavailable in P06.1.</p>
          <ol className={styles.items}>
            {queue.items.map((item) => (
              <li key={item.queueItemId}>
                <div><strong>Prompt {item.order + 1}</strong><span>{item.shotId ? `Shot ${item.shotId}` : "No shot ID"}</span></div>
                <span>{item.itemState === "pending" ? "Pending" : item.itemState}</span>
                <details><summary>View exact prompt source</summary><pre>{item.rawJsonBody}</pre></details>
                {item.providerOutcome === "unknown" ? <small>Dispatch evidence stored; provider outcome unknown.</small> : <small>Not dispatched. Provider outcome not started.</small>}
              </li>
            ))}
          </ol>
          <small>Stored interval: {TIMED_IMAGE_SUBMISSION_INTERVAL_MS.toLocaleString()} ms. No countdown is running.</small>
        </section>
      ))}
    </section>
  );
}
