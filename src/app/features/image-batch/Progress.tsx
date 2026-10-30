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
  const [startingQueueId, setStartingQueueId] = useState<string>();
  const [commanding, setCommanding] = useState<{
    queueId: string;
    command: "pause" | "resume" | "stop";
  }>();
  const [, setClockTick] = useState(0);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    const refresh = () =>
      persistenceClient
        .request("imageQueue.list", { workspaceId })
        .then((value) => {
          if (!Array.isArray(value))
            throw new Error("The queue list was invalid.");
          const records = value.map((entry) => {
            const parsed = ImageSubmissionQueueRecordSchema.safeParse(entry);
            if (!parsed.success)
              throw new Error("A saved queue failed validation.");
            return parsed.data;
          });
          if (active) setQueues(records);
        })
        .catch((cause: unknown) => {
          if (active)
            setError(
              cause instanceof Error
                ? cause.message
                : "Saved queues could not be read.",
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    void refresh();
    const refreshTimer = window.setInterval(() => {
      setClockTick((tick) => tick + 1);
      void refresh();
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [persistenceClient, workspaceId]);

  const startQueue = async (queueId: string) => {
    if (startingQueueId) return;
    setStartingQueueId(queueId);
    setError(undefined);
    try {
      const record = await persistenceClient.request("imageQueue.start", {
        queueId,
      });
      const parsed = ImageSubmissionQueueRecordSchema.safeParse(record);
      if (!parsed.success)
        throw new Error("The queue start readback was invalid.");
      setQueues((current) =>
        current.map((queue) =>
          queue.queueId === queueId ? parsed.data : queue,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The timed queue could not start.",
      );
    } finally {
      setStartingQueueId(undefined);
    }
  };

  const commandQueue = async (
    queue: ImageSubmissionQueueRecord,
    command: "pause" | "resume" | "stop",
  ) => {
    if (commanding || startingQueueId) return;
    setCommanding({ queueId: queue.queueId, command });
    setError(undefined);
    try {
      const record = await persistenceClient.request(`imageQueue.${command}`, {
        queueId: queue.queueId,
        expectedRevision: queue.revision,
      });
      const parsed = ImageSubmissionQueueRecordSchema.safeParse(record);
      if (!parsed.success)
        throw new Error("Queue lifecycle readback was invalid.");
      setQueues((current) =>
        current.map((entry) =>
          entry.queueId === queue.queueId ? parsed.data : entry,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : `Queue ${command} failed.`,
      );
    } finally {
      setCommanding(undefined);
    }
  };

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
      if (!parsed.success)
        throw new Error("The saved queue failed readback validation.");
      setQueues((current) => [...current, parsed.data]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The timed queue could not be saved.",
      );
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
        Each saved prompt is one submission. The manually declared variant count
        is recorded as settings context; it does not multiply Generate actions.
      </p>
      <p className={styles.helper}>
        Start sends each exact saved prompt once. Provider results remain
        unknown.
      </p>
      <div className={styles.actionRow}>
        <Button
          type="button"
          disabled={Boolean(disabledReason)}
          loading={creating}
          loadingLabel="Saving queue…"
          onClick={() => void createQueue()}
        >
          Create timed queue
        </Button>
        <span className={styles.helper} role="status">
          {disabledReason ??
            "Ready to persist after source and settings checks."}
        </span>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {error && !loading ? (
        <p className={styles.helper} role="status">
          Saved queue status unavailable. No empty-state conclusion can be made.
        </p>
      ) : null}
      {loading ? (
        <p className={styles.helper} role="status">
          Reading saved queues…
        </p>
      ) : null}
      {!loading && !error && queues.length === 0 ? (
        <p className={styles.empty}>
          No timed queue saved. No provider submission has started.
        </p>
      ) : null}
      {queues.map((queue) => (
        <section
          className={styles.queue}
          key={queue.queueId}
          aria-label={`Timed image queue ${queue.queueId}`}
        >
          <div className={styles.queueHeader}>
            <strong>
              {queue.items.length} saved prompt
              {queue.items.length === 1 ? "" : "s"}
            </strong>
            <span>
              {queue.items.some((item) => item.itemState === "sending")
                ? "Sending"
                : queue.state === "ready"
                  ? "Saved · not started"
                  : queue.state}
            </span>
          </div>
          <p className={styles.helper}>
            Project and exact source are frozen in this queue snapshot.
          </p>
          <p className={styles.helper} role="status">
            {queue.items.filter((item) => item.itemState === "sent").length}{" "}
            Sent ·{" "}
            {queue.items.filter((item) => item.itemState === "pending").length}{" "}
            Pending
            {queue.items.some((item) => item.itemState === "sending")
              ? ` · Current: Prompt ${(queue.items.find((item) => item.itemState === "sending")?.order ?? 0) + 1}`
              : ""}
          </p>
          {queue.state === "ready" &&
          queue.items.every((item) => item.itemState === "pending") ? (
            <Button
              type="button"
              disabled={Boolean(startingQueueId)}
              loading={startingQueueId === queue.queueId}
              loadingLabel="Starting queue…"
              onClick={() => void startQueue(queue.queueId)}
            >
              Start timed queue
            </Button>
          ) : null}
          {queue.state === "ready" || queue.state === "waiting" ? (
            <div className={styles.actionRow}>
              <Button
                type="button"
                disabled={Boolean(commanding || startingQueueId)}
                loading={
                  commanding?.queueId === queue.queueId &&
                  commanding.command === "pause"
                }
                loadingLabel="Pausing…"
                onClick={() => void commandQueue(queue, "pause")}
              >
                Pause
              </Button>
              <Button
                type="button"
                disabled={Boolean(commanding || startingQueueId)}
                loading={
                  commanding?.queueId === queue.queueId &&
                  commanding.command === "stop"
                }
                loadingLabel="Stopping…"
                onClick={() => void commandQueue(queue, "stop")}
              >
                Stop
              </Button>
            </div>
          ) : null}
          {queue.state === "paused" ? (
            <div className={styles.actionRow}>
              <Button
                type="button"
                disabled={Boolean(commanding || startingQueueId)}
                loading={
                  commanding?.queueId === queue.queueId &&
                  commanding.command === "resume"
                }
                loadingLabel="Revalidating and resuming…"
                onClick={() => void commandQueue(queue, "resume")}
              >
                Resume
              </Button>
              <Button
                type="button"
                disabled={Boolean(commanding || startingQueueId)}
                loading={
                  commanding?.queueId === queue.queueId &&
                  commanding.command === "stop"
                }
                loadingLabel="Stopping…"
                onClick={() => void commandQueue(queue, "stop")}
              >
                Stop
              </Button>
            </div>
          ) : null}
          {queue.state === "waiting" &&
          queue.nextEligibleDispatchAt !== null ? (
            <p className={styles.helper} role="status">
              {Date.now() < queue.nextEligibleDispatchAt
                ? `Next dispatch eligible in ${Math.ceil((queue.nextEligibleDispatchAt - Date.now()) / 1000)}s.`
                : "Dispatch deadline reached; the worker must recheck saved state before dispatch."}
            </p>
          ) : null}
          {queue.state === "sent" &&
          queue.items.every((item) => item.itemState === "sent") ? (
            <p className={styles.helper} role="status">
              All prompts sent; results not verified.
            </p>
          ) : null}
          {queue.state === "blocked" ? (
            <p className={styles.error} role="alert">
              Queue blocked:{" "}
              {queue.items.find((item) => item.blockReason)?.blockReason ??
                "review_required"}
              . No automatic replay is available.
            </p>
          ) : null}
          {queue.state === "paused" ? (
            <p className={styles.helper} role="status">
              Paused: {queue.pauseReason ?? "user_requested"}. No future prompt
              will be dispatched until the saved target and settings binding are
              revalidated.
            </p>
          ) : null}
          {queue.state === "stopped" ? (
            <p className={styles.helper} role="status">
              Stopped. Remaining prompts will not be sent. An activation already
              authorized may have finished; provider results are not verified.
            </p>
          ) : null}
          <ol className={styles.items}>
            {queue.items.map((item) => (
              <li key={item.queueItemId}>
                <div>
                  <strong>Prompt {item.order + 1}</strong>
                  <span>
                    {item.shotId ? `Shot ${item.shotId}` : "No shot ID"}
                  </span>
                </div>
                <span>
                  {item.itemState.charAt(0).toUpperCase() +
                    item.itemState.slice(1)}
                </span>
                <details>
                  <summary>View exact prompt source</summary>
                  <pre>{item.rawJsonBody}</pre>
                </details>
                {item.itemState === "sent" && item.dispatchReceipt ? (
                  <small>
                    Dispatch evidence stored; provider outcome unknown.
                  </small>
                ) : item.providerOutcome === "unknown" ? (
                  <small>
                    Activation is uncertain; provider outcome unknown. Automatic
                    replay is blocked.
                  </small>
                ) : (
                  <small>Not dispatched. Provider outcome not started.</small>
                )}
              </li>
            ))}
          </ol>
          <small>
            Stored interval:{" "}
            {TIMED_IMAGE_SUBMISSION_INTERVAL_MS.toLocaleString()} ms. No
            countdown reflects the saved dispatch deadline.
          </small>
        </section>
      ))}
    </section>
  );
}
