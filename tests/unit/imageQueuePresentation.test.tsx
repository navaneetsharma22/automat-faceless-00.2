import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ImageSubmissionQueueRecord } from "../../src/domain/jobs/queue";
import {
  isQueueCreationBlocker,
  QueueCard,
} from "../../src/app/features/image-batch/Progress";

const baseItem = {
  queueItemId: "item-1",
  sourceItemId: "source-1",
  order: 0,
  shotId: "1",
  rawJsonBody: JSON.stringify({ scene_title: "Dinosaur at the valley" }),
  promptHash: "a".repeat(64),
  sourceSpan: { start: 0, end: 50 },
  itemState: "pending" as const,
  providerOutcome: "not_started" as const,
};

function queue(
  state: ImageSubmissionQueueRecord["state"],
  itemState: ImageSubmissionQueueRecord["items"][number]["itemState"],
): ImageSubmissionQueueRecord {
  const item = { ...baseItem, itemState };
  const withReceipt = {
    ...item,
    itemState: "sent" as const,
    providerOutcome: "unknown" as const,
    dispatchReceipt: {
      attemptId: "attempt-1",
      storedAt: 1_000_000,
      evidence: "activation_pair_sent_or_uncertain" as const,
    },
  };
  const items =
    state === "sent"
      ? [withReceipt]
      : state === "waiting"
        ? [
            withReceipt,
            {
              ...baseItem,
              queueItemId: "item-2",
              sourceItemId: "source-2",
              order: 1,
              shotId: "2",
            },
          ]
        : [
            {
              ...item,
              ...(state === "blocked"
                ? { blockReason: "review_required" }
                : {}),
            },
          ];
  return {
    queueId: `queue-${state}`,
    workspaceId: "default",
    kind: "image",
    mode: "timed_submission",
    intervalMs: 40_000,
    state,
    sourceText: "{}",
    sourceHash: "b".repeat(64),
    sourceMode: "single_json_value",
    selectedProject: {
      provider: "Flow",
      tabId: 7,
      projectId: "project-7",
      canonicalTarget: "https://flow.google.com/project/project-7",
      selectionRevision: 1,
    },
    manualSettingsDeclaration: {
      confirmationId: "confirmation-1",
      confirmedAt: 1,
      tabId: 7,
      projectId: "project-7",
      canonicalTarget: "https://flow.google.com/project/project-7",
      declaredVariantCount: 1,
      userAttested: true,
    },
    items,
    lastDispatchReceiptStoredAt: state === "waiting" ? 1_000_000 : null,
    nextEligibleDispatchAt: state === "waiting" ? 1_040_000 : null,
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
  };
}

function render(
  state: ImageSubmissionQueueRecord["state"],
  itemState: ImageSubmissionQueueRecord["items"][number]["itemState"],
) {
  return renderRecord(queue(state, itemState));
}

function renderRecord(record: ImageSubmissionQueueRecord) {
  return renderToStaticMarkup(
    createElement(QueueCard, {
      queue: record,
      starting: false,
      busy: false,
      onStart: () => undefined,
      onCommand: () => undefined,
    }),
  );
}

describe("timed queue presentation", () => {
  it.each(["ready", "waiting", "paused", "blocked"] as const)(
    "keeps new-source creation blocked by a previous %s queue",
    (state) => {
      expect(isQueueCreationBlocker(queue(state, "pending"))).toBe(true);
    },
  );

  it("keeps stopped queues with unresolved sending work blocked", () => {
    expect(isQueueCreationBlocker(queue("stopped", "sending"))).toBe(true);
  });

  it("allows a new distinct source after a completed queue", () => {
    expect(isQueueCreationBlocker(queue("sent", "sent"))).toBe(false);
  });

  it("highlights the failed prompt and leaves untouched later prompts pending", () => {
    const base = queue("blocked", "blocked");
    const sent = {
      ...baseItem,
      queueItemId: "sent-10",
      sourceItemId: "source-10",
      order: 0,
      shotId: "10",
      itemState: "sent" as const,
      providerOutcome: "unknown" as const,
      dispatchReceipt: {
        attemptId: "attempt-10",
        storedAt: 1_000,
        evidence: "activation_pair_sent_or_uncertain" as const,
      },
    };
    const blocked = {
      ...baseItem,
      queueItemId: "blocked-11",
      sourceItemId: "source-11",
      order: 1,
      shotId: "11",
      itemState: "blocked" as const,
      blockReason: "editor_exact_readback_mismatch",
    };
    const later = [12, 13, 14].map((shotId, index) => ({
      ...baseItem,
      queueItemId: `pending-${shotId}`,
      sourceItemId: `source-${shotId}`,
      order: index + 2,
      shotId: String(shotId),
    }));
    const blockedQueue = { ...base, items: [sent, blocked, ...later] };
    const markup = renderRecord(blockedQueue);
    const activeRow = markup.match(
      /<li[^>]*data-active="true"[^>]*>([\s\S]*?)<\/li>/,
    )?.[1];

    expect(markup).toContain("Blocked prompt");
    expect(markup).toContain("Shot 11");
    expect(activeRow).toContain("Shot 11");
    expect(activeRow).toContain("editor_exact_readback_mismatch");
    expect(activeRow).toContain(
      "Not dispatched. Provider outcome not started.",
    );
    expect(markup.match(/>Pending<\/span>/g)).toHaveLength(3);
    expect(activeRow).not.toContain("Shot 12");
    expect(markup).toContain("Inspect current editor (read-only)");
    expect(markup).toContain("Queue ID: <code>queue-blocked</code>");
  });

  it("shows a deadline-derived timer and actual next shot while waiting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_020_000);
    const markup = render("waiting", "pending");
    expect(markup).toContain('role="timer"');
    expect(markup).toContain("00:20");
    expect(markup).toContain("Time until next prompt");
    expect(markup).toContain("Shot 2");
    expect(markup).toContain("Dinosaur at the valley");
    expect(markup).toContain(">Sent</span>");
    vi.useRealTimers();
  });

  it("shows zero as checking eligibility without changing the item to Sending", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_040_000);
    const markup = render("waiting", "pending");
    expect(markup).toContain("00:00");
    expect(markup).toContain("Checking next prompt…");
    expect(markup).not.toContain("Sending Shot 2");
    vi.useRealTimers();
  });

  it.each([
    ["sending", "sending", "Sending"],
    ["paused", "pending", "Paused"],
    ["blocked", "pending", "Blocked"],
    ["stopped", "stopped", "Stopped"],
    ["sent", "sent", "Batch submission finished — 1/1 prompts sent."],
  ] as const)(
    "presents %s without an active countdown",
    (state, itemState, label) => {
      const markup = render(state, itemState);
      expect(markup).toContain(label);
      expect(markup).not.toContain('role="timer"');
      if (state === "sent") {
        expect(markup).toContain("Image results are not verified.");
        expect(markup).not.toContain("Next prompt in");
      }
    },
  );

  it("targets Shot 11 in a blocked queue when onInspectReadback is provided", () => {
    const base = queue("blocked", "blocked");
    const sent = {
      ...baseItem,
      queueItemId: "sent-10",
      order: 0,
      shotId: "10",
      itemState: "sent" as const,
      dispatchReceipt: {
        attemptId: "attempt-10",
        storedAt: 1_000,
        evidence: "activation_pair_sent_or_uncertain" as const,
      },
    };
    const blocked = {
      ...baseItem,
      queueItemId: "blocked-11",
      order: 1,
      shotId: "11",
      itemState: "blocked" as const,
      blockReason: "editor_exact_readback_mismatch",
    };
    const blockedQueue = {
      ...base,
      queueId: "queue-shot-11-test",
      items: [sent, blocked],
    };
    const inspectMock = vi.fn().mockResolvedValue({
      queueId: "queue-shot-11-test",
      queueItemId: "blocked-11",
      order: 1,
      shotId: "11",
      stage: "read_only_editor_inspection" as const,
      inspectedAt: 1000,
      equal: false,
      expectedCodeUnits: 3874,
      actualCodeUnits: 3875,
      expectedUtf8Bytes: 3874,
      actualUtf8Bytes: 3875,
      expectedSha256: "hash-expected",
      actualSha256: "hash-actual",
      firstDifferenceOffset: 3874,
      mismatchCategory: "length" as const,
      expectedContext: '"end"}',
      actualContext: '"end"} ',
    });

    const element = createElement(QueueCard, {
      queue: blockedQueue,
      starting: false,
      busy: false,
      onStart: () => undefined,
      onCommand: () => undefined,
      onInspectReadback: inspectMock,
    });

    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("Inspect current editor (read-only)");
    expect(markup).toContain("Queue ID: <code>queue-shot-11-test</code>");
    expect(markup).toContain("Blocked prompt");
    expect(markup).toContain("Shot 11");
  });

  it("presents the guarded retry pause notice explaining preserved 40-second interval", () => {
    const paused = queue("paused", "pending");
    const guardedPaused = {
      ...paused,
      pauseReason: "guarded_retry_ready",
      lastDispatchReceiptStoredAt: 1_000_000,
      nextEligibleDispatchAt: 1_040_000,
    };
    const element = createElement(QueueCard, {
      queue: guardedPaused,
      starting: false,
      busy: false,
      onStart: () => undefined,
      onCommand: () => undefined,
    });
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("Paused — guarded retry ready");
    expect(markup).toContain(
      "40-second interval from previous dispatch receipt is preserved",
    );
    expect(markup).toContain("Resume");
  });
});
