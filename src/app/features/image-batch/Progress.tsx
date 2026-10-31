import { useEffect, useState, type ReactNode } from "react";
import type { FoundationClient } from "../../../shared/messageClient";
import type { FlowSettingsConfirmation } from "../../../shared/schemas";
import {
  ImageSubmissionQueueRecordSchema,
  TIMED_IMAGE_SUBMISSION_INTERVAL_MS,
  type ImageQueueItem,
  type ImageSubmissionQueueRecord,
} from "../../../domain/jobs/queue";
import { Button } from "../../components/Button";
import styles from "./Progress.module.css";

const QUEUE_READBACK_INTERVAL_MS = 5_000;

export function ImageQueueProgress({
  workspaceId,
  persistenceClient,
  sourceReady,
  savedSource,
  savedShotIds,
  settingsConfirmation,
  settingsConfirmationPending,
  settingsConfirmationError,
  settingsConfirmationControls,
  onCurrentQueueChange,
}: {
  workspaceId: string;
  persistenceClient: FoundationClient;
  sourceReady: boolean;
  savedSource?: string;
  savedShotIds: readonly string[];
  settingsConfirmation?: FlowSettingsConfirmation;
  settingsConfirmationPending: boolean;
  settingsConfirmationError?: string;
  settingsConfirmationControls: ReactNode;
  onCurrentQueueChange?: (
    queue: ImageSubmissionQueueRecord | undefined,
  ) => void;
}) {
  const [queues, setQueues] = useState<ImageSubmissionQueueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [startingQueueId, setStartingQueueId] = useState<string>();
  const [commanding, setCommanding] = useState<{
    queueId: string;
    command: "pause" | "resume" | "stop";
  }>();
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
          if (active) {
            setQueues(records);
            setError(undefined);
          }
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
    const refreshTimer = window.setInterval(
      refresh,
      QUEUE_READBACK_INTERVAL_MS,
    );
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [persistenceClient, workspaceId]);

  const startQueue = async (queueId: string) => {
    if (startingQueueId || commanding) return;
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

  const createQueue = async () => {
    if (
      disabledReason ||
      !sourceReady ||
      !savedSource ||
      !settingsConfirmation ||
      creating
    )
      return;
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
      const savedQueue = parsed.data;
      const readbackMatches =
        savedQueue.workspaceId === workspaceId &&
        savedQueue.sourceText === savedSource &&
        !queues.some((queue) => queue.queueId === savedQueue.queueId) &&
        savedQueue.state === "ready" &&
        savedQueue.nextEligibleDispatchAt === null &&
        savedQueue.lastDispatchReceiptStoredAt === null &&
        savedQueue.items.every(
          (item) =>
            item.itemState === "pending" &&
            item.providerOutcome === "not_started" &&
            !item.dispatchReceipt &&
            !item.dispatchIntent,
        ) &&
        savedQueue.items
          .map((item) => item.shotId ?? `Prompt ${item.order + 1}`)
          .join("\u0000") === savedShotIds.join("\u0000") &&
        savedQueue.manualSettingsDeclaration.confirmationId ===
          settingsConfirmation.confirmationId &&
        savedQueue.selectedProject.tabId === settingsConfirmation.tabId &&
        savedQueue.selectedProject.projectId ===
          settingsConfirmation.projectId &&
        savedQueue.selectedProject.canonicalTarget ===
          settingsConfirmation.canonicalTarget;
      if (!readbackMatches)
        throw new Error(
          "Queue creation readback did not match the current saved source, selected project, or ready state.",
        );
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

  const currentQueue =
    sourceReady && savedSource
      ? queues.find((queue) => queue.sourceText === savedSource)
      : undefined;
  const previousQueues = queues.filter((queue) => queue !== currentQueue);
  useEffect(() => {
    onCurrentQueueChange?.(currentQueue);
  }, [currentQueue, onCurrentQueueChange]);
  const blockingPreviousQueue = previousQueues.find(isQueueCreationBlocker);
  const disabledReason = loading
    ? "Reading saved queues before allowing another queue."
    : error
      ? "Saved queue status is unavailable; creation is disabled until it can be checked."
      : !sourceReady || !savedSource
        ? "Validate and save the current image source before creating a queue."
        : currentQueue
          ? "This exact saved source already belongs to a timed queue."
          : blockingPreviousQueue
            ? `A previous queue is ${queueBlockerLabel(blockingPreviousQueue)}. Resolve it before creating another queue.`
            : settingsConfirmationError
              ? "Correct the Flow settings confirmation before creating a queue."
              : settingsConfirmationPending
                ? "Binding your manual settings confirmation to the selected Flow project."
                : !settingsConfirmation
                  ? "Confirm the manually selected Flow settings for this saved batch."
                  : creating
                    ? "Queue creation is being saved and read back."
                    : undefined;

  return (
    <section className={styles.progress} aria-labelledby="image-queue-title">
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>TIMED SUBMISSION MODE</p>
          <h3 id="image-queue-title">Image queue</h3>
        </div>
        <span className={styles.interval}>40 seconds between prompts</span>
      </div>
      <p className={styles.helper}>
        Sent counts durable local dispatch receipts. Image results are not
        verified.
      </p>
      <div className={styles.createCard}>
        <div>
          <strong>Current saved image source</strong>
          <p className={styles.helper}>
            {sourceReady && savedSource
              ? `${savedShotIds.length} prompt${savedShotIds.length === 1 ? "" : "s"} saved. Queue creation copies this exact source and its current Flow project binding.`
              : "Validate and save the new image source to prepare a timed queue."}
          </p>
          {sourceReady && savedShotIds.length > 0 ? (
            <p className={styles.shotSummary}>
              {savedShotIds.map((shotId) => `Shot ${shotId}`).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className={styles.createSettings}>
          <strong>Confirm settings for this batch</strong>
          <p className={styles.helper}>
            The confirmation is bound to the selected Flow project. It must be
            made again after changing the saved source.
          </p>
          {settingsConfirmationControls}
        </div>
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
            `Ready to save ${savedShotIds.length} prompt${savedShotIds.length === 1 ? "" : "s"}. Creation does not start dispatch.`}
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
      {currentQueue ? (
        <div className={styles.currentQueueBlock}>
          <p className={styles.queueContext}>Queue for current saved batch</p>
          <QueueCard
            queue={currentQueue}
            commanding={
              commanding?.queueId === currentQueue.queueId
                ? commanding
                : undefined
            }
            starting={startingQueueId === currentQueue.queueId}
            busy={Boolean(commanding || startingQueueId)}
            onStart={() => void startQueue(currentQueue.queueId)}
            onCommand={(command) => void commandQueue(currentQueue, command)}
          />
        </div>
      ) : null}
      {previousQueues.map((queue) => (
        <div className={styles.previousQueueBlock} key={queue.queueId}>
          <p className={styles.queueContext}>{previousQueueLabel(queue)}</p>
          <QueueCard
            queue={queue}
            commanding={
              commanding?.queueId === queue.queueId ? commanding : undefined
            }
            starting={startingQueueId === queue.queueId}
            busy={Boolean(commanding || startingQueueId)}
            onStart={() => void startQueue(queue.queueId)}
            onCommand={(command) => void commandQueue(queue, command)}
          />
        </div>
      ))}
    </section>
  );
}

export function QueueCard({
  queue,
  commanding,
  starting,
  busy,
  onStart,
  onCommand,
}: {
  queue: ImageSubmissionQueueRecord;
  commanding?: { queueId: string; command: "pause" | "resume" | "stop" };
  starting: boolean;
  busy: boolean;
  onStart: () => void;
  onCommand: (command: "pause" | "resume" | "stop") => void;
}) {
  const sentCount = queue.items.filter((item) => item.dispatchReceipt).length;
  const sendingItem = queue.items.find((item) => item.itemState === "sending");
  const blockedItem = queue.items.find((item) => item.itemState === "blocked");
  const nextItem = queue.items.find((item) => item.itemState === "pending");
  const focusItem =
    sendingItem ??
    blockedItem ??
    (queue.state === "blocked" ? undefined : nextItem);
  const isComplete = sentCount === queue.items.length && queue.items.length > 0;
  const status = sendingItem
    ? "Sending"
    : queue.state === "ready"
      ? "Ready"
      : queue.state === "sent" && isComplete
        ? "Finished"
        : titleCase(queue.state);
  const currentTitle = focusItem ? getPromptTitle(focusItem) : undefined;
  const queueKicker =
    queue.state === "waiting" || sendingItem
      ? "ACTIVE QUEUE"
      : queue.state === "ready"
        ? "READY QUEUE"
        : "QUEUE SUMMARY";

  return (
    <section
      className={styles.queue}
      aria-label={`Timed image queue ${queue.queueId}`}
      data-state={queue.state}
    >
      <div className={styles.queueHeader}>
        <div>
          <p className={styles.kicker}>{queueKicker}</p>
          <h4>{status}</h4>
        </div>
        <span
          className={`${styles.stateBadge} ${styles[`state${status}`]}`}
          role="status"
          aria-live="polite"
        >
          {status}
        </span>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.sentSummary}>
          <span>Prompts sent</span>
          <strong>
            {sentCount}
            <small> / {queue.items.length}</small>
          </strong>
          <span>Local dispatch receipts</span>
        </div>
        <div className={styles.nextSummary}>
          <span>
            {sendingItem
              ? "Current prompt"
              : blockedItem
                ? "Blocked prompt"
                : queue.state === "blocked"
                  ? "Queue blocked"
                  : "Next prompt"}
          </span>
          {focusItem ? (
            <>
              <strong>{shotLabel(focusItem)}</strong>
              {currentTitle ? (
                <span className={styles.promptTitle}>{currentTitle}</span>
              ) : null}
            </>
          ) : (
            <strong>
              {isComplete
                ? "No prompts remaining"
                : queue.state === "blocked"
                  ? "Review required"
                  : "Checking next prompt…"}
            </strong>
          )}
        </div>
      </div>

      {queue.state === "waiting" &&
      queue.nextEligibleDispatchAt !== null &&
      nextItem ? (
        <WaitingClock
          deadline={queue.nextEligibleDispatchAt}
          item={nextItem}
          intervalMs={queue.intervalMs}
        />
      ) : null}
      {sendingItem ? (
        <div className={styles.sending} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <span>Sending {shotLabel(sendingItem)}…</span>
        </div>
      ) : null}
      {queue.state === "waiting" && queue.nextEligibleDispatchAt === null ? (
        <p className={styles.checking} role="status" aria-live="polite">
          Checking next prompt…
        </p>
      ) : null}

      <div className={styles.actionRow}>
        {queue.state === "ready" &&
        queue.items.every((item) => item.itemState === "pending") ? (
          <Button
            type="button"
            disabled={busy}
            loading={starting}
            loadingLabel="Starting queue…"
            onClick={onStart}
          >
            Start queue
          </Button>
        ) : null}
        {queue.state === "waiting" ? (
          <Button
            type="button"
            disabled={busy}
            loading={commanding?.command === "pause"}
            loadingLabel="Pausing…"
            onClick={() => onCommand("pause")}
          >
            Pause
          </Button>
        ) : null}
        {queue.state === "paused" ? (
          <Button
            type="button"
            disabled={busy}
            loading={commanding?.command === "resume"}
            loadingLabel="Resuming…"
            onClick={() => onCommand("resume")}
          >
            Resume
          </Button>
        ) : null}
        {queue.state === "waiting" ||
        queue.state === "paused" ||
        queue.state === "ready" ? (
          <Button
            variant="secondary"
            className={styles.stopButton}
            type="button"
            disabled={busy}
            loading={commanding?.command === "stop"}
            loadingLabel="Stopping…"
            onClick={() => onCommand("stop")}
          >
            Stop queue
          </Button>
        ) : null}
        {commanding ? (
          <span
            className={styles.commandStatus}
            role="status"
            aria-live="polite"
          >
            {commandPendingText(commanding.command)} Readback pending; saved
            status has not changed yet.
          </span>
        ) : null}
      </div>

      {isComplete ? (
        <div className={styles.complete} role="status" aria-live="polite">
          <strong>
            Batch submission finished — {sentCount}/{queue.items.length} prompts
            sent.
          </strong>
          <span>Image results are not verified.</span>
        </div>
      ) : null}
      {queue.state === "blocked" ? (
        <div className={styles.blocked} role="status">
          <strong>Blocked — review required.</strong>
          <details>
            <summary>View block reason</summary>
            <code>
              {queue.items.find((item) => item.blockReason)?.blockReason ??
                "review_required"}
            </code>
          </details>
          <span>Elapsed time does not authorize replay.</span>
        </div>
      ) : null}
      {queue.state === "paused" ? (
        <p className={styles.inactiveNotice} role="status">
          Paused. No future prompt will be dispatched until the saved target and
          settings binding are revalidated.
        </p>
      ) : null}
      {queue.state === "stopped" ? (
        <p className={styles.inactiveNotice} role="status">
          Stopped. Remaining prompts will not be sent. An authorized activation
          may have finished; provider results are not verified.
        </p>
      ) : null}

      <ol className={styles.items} aria-label="Prompt queue">
        {queue.items.map((item) => (
          <PromptRow
            key={item.queueItemId}
            item={item}
            queueState={queue.state}
            active={item === focusItem && !isComplete}
          />
        ))}
      </ol>
      <details className={styles.technicalDetails}>
        <summary>Queue and provider evidence</summary>
        <p>
          Stored interval: {TIMED_IMAGE_SUBMISSION_INTERVAL_MS.toLocaleString()}{" "}
          ms. A deadline makes the next prompt eligible for worker recheck; it
          does not mark it sent.
        </p>
        <p>
          Project and exact source are frozen in this queue snapshot. Sent means
          a local dispatch receipt exists; image results are not verified.
        </p>
      </details>
    </section>
  );
}

function WaitingClock({
  deadline,
  item,
  intervalMs,
}: {
  deadline: number;
  item: ImageQueueItem;
  intervalMs: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remainingMs = Math.max(0, deadline - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const display = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const percent = Math.max(
    0,
    Math.min(100, ((intervalMs - remainingMs) / intervalMs) * 100),
  );
  const promptTitle = getPromptTitle(item);

  return (
    <div className={styles.waitingPanel}>
      <div className={styles.clockHeader}>
        <span>Time until next prompt</span>
        <span>
          {shotLabel(item)}
          {promptTitle ? ` · ${promptTitle}` : ""}
        </span>
      </div>
      <div
        className={styles.countdown}
        role="timer"
        aria-live="off"
        aria-label={`Time until next prompt: ${display}`}
      >
        {display}
      </div>
      <div className={styles.waitingTrack} aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className={styles.clockHint}>
        {remainingMs === 0
          ? "Checking next prompt…"
          : "The saved deadline controls eligibility. Sent changes only after receipt readback."}
      </p>
    </div>
  );
}

function PromptRow({
  item,
  queueState,
  active,
}: {
  item: ImageQueueItem;
  queueState: ImageSubmissionQueueRecord["state"];
  active: boolean;
}) {
  const effectiveState =
    item.itemState === "pending" && queueState === "paused"
      ? "paused"
      : item.itemState === "pending" && queueState === "stopped"
        ? "stopped"
        : item.itemState;
  const icon = {
    pending: "○",
    sending: "◌",
    sent: "✓",
    paused: "Ⅱ",
    blocked: "!",
    stopped: "—",
  }[effectiveState];
  return (
    <li
      className={`${styles.item} ${active ? styles.itemActive : ""}`}
      data-active={active || undefined}
    >
      <span
        className={`${styles.itemIcon} ${styles[`item${titleCase(effectiveState)}`]}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className={styles.itemIdentity}>
        <strong>{shotLabel(item)}</strong>
        <span>{getPromptTitle(item) ?? `Prompt ${item.order + 1}`}</span>
      </div>
      <span
        className={`${styles.itemBadge} ${styles[`item${titleCase(effectiveState)}`]}`}
      >
        {titleCase(effectiveState)}
      </span>
      <details className={styles.sourceDetails}>
        <summary>Source &amp; evidence</summary>
        <p>
          {item.dispatchReceipt
            ? "Dispatch receipt stored. Provider outcome is unknown."
            : item.providerOutcome === "unknown"
              ? "Activation is uncertain; automatic replay is blocked."
              : "Not dispatched. Provider outcome not started."}
        </p>
        {item.blockReason ? <code>{item.blockReason}</code> : null}
        <pre>{item.rawJsonBody}</pre>
      </details>
    </li>
  );
}

function getPromptTitle(item: ImageQueueItem) {
  try {
    const body: unknown = JSON.parse(item.rawJsonBody);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return undefined;
    const fields = body as Record<string, unknown>;
    const title = fields.scene_title ?? fields.shot_title ?? fields.title;
    return typeof title === "string" && title.trim() ? title.trim() : undefined;
  } catch {
    return undefined;
  }
}

function shotLabel(item: ImageQueueItem) {
  return item.shotId ? `Shot ${item.shotId}` : `Prompt ${item.order + 1}`;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function commandPendingText(command: "pause" | "resume" | "stop") {
  return {
    pause: "Pausing queue…",
    resume: "Resuming queue…",
    stop: "Stopping queue…",
  }[command];
}

export function isQueueCreationBlocker(queue: ImageSubmissionQueueRecord) {
  return (
    ["ready", "waiting", "paused", "blocked"].includes(queue.state) ||
    queue.items.some(
      (item) =>
        item.itemState === "sending" ||
        (item.providerOutcome === "unknown" && !item.dispatchReceipt),
    )
  );
}

function queueBlockerLabel(queue: ImageSubmissionQueueRecord) {
  if (queue.state === "blocked") return "blocked or uncertain";
  if (queue.state === "paused") return "paused";
  if (queue.state === "waiting") return "active";
  if (queue.state === "ready") return "ready to start";
  return "awaiting review";
}

function previousQueueLabel(queue: ImageSubmissionQueueRecord) {
  const sent = queue.items.filter((item) => item.dispatchReceipt).length;
  return queue.state === "sent"
    ? `Previous queue — ${sent}/${queue.items.length} sent`
    : `Previous queue — ${titleCase(queue.state)}`;
}
