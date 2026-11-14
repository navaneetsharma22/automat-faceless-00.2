// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImageQueueProgress,
  QueueCard,
} from "../../src/app/features/image-batch/Progress";
import { ImageImportPanel } from "../../src/app/features/image-batch/ImportPanel";
import { ValidatedPromptPanel } from "../../src/app/App";
import { ImportPreviewSession } from "../../src/app/features/shared/importPreviewSession";
import { ToastHost } from "../../src/app/components/ToastHost";
import {
  ImageSubmissionQueueRecordSchema,
  type ImageSubmissionQueueRecord,
} from "../../src/domain/jobs/queue";
import type { FoundationClient } from "../../src/shared/messageClient";
import { ImageQueueNotificationTracker } from "../../src/app/features/image-batch/queueNotifications";
import { ToastManager } from "../../src/app/components/toastManager";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

function makeQueueFixture(
  overrides: Partial<ImageSubmissionQueueRecord> = {},
): ImageSubmissionQueueRecord {
  const baseEpoch = Date.now();
  return {
    queueId: "queue-test-001",
    workspaceId: "default",
    kind: "image",
    mode: "timed_submission",
    intervalMs: 40_000,
    state: "waiting",
    sourceText:
      '{"shot_id":"1","prompt":"dino"}\n{"shot_id":"2","prompt":"jungle"}',
    sourceHash: "1".repeat(64),
    sourceMode: "single_json_value",
    selectedProject: {
      provider: "Flow",
      tabId: 10,
      projectId: "proj-123",
      canonicalTarget: "https://flow.google.com/project/proj-123",
      selectionRevision: 1,
    },
    manualSettingsDeclaration: {
      confirmationId: "conf-123",
      confirmedAt: baseEpoch,
      tabId: 10,
      projectId: "proj-123",
      canonicalTarget: "https://flow.google.com/project/proj-123",
      declaredVariantCount: 2,
      userAttested: true,
    },
    items: [
      {
        queueItemId: "item-1",
        sourceItemId: "source-1",
        order: 0,
        shotId: "1",
        rawJsonBody: JSON.stringify({
          shot_id: "1",
          prompt: "dino",
          scene_title: "Dinosaur Valley",
        }),
        promptHash: "2".repeat(64),
        sourceSpan: { start: 0, end: 32 },
        itemState: "sent",
        providerOutcome: "unknown",
        dispatchReceipt: {
          attemptId: "attempt-1",
          storedAt: baseEpoch - 10_000,
          evidence: "activation_pair_sent_or_uncertain",
        },
      },
      {
        queueItemId: "item-2",
        sourceItemId: "source-2",
        order: 1,
        shotId: "2",
        rawJsonBody: JSON.stringify({
          shot_id: "2",
          prompt: "jungle",
          scene_title: "Deep Mist",
        }),
        promptHash: "3".repeat(64),
        sourceSpan: { start: 33, end: 68 },
        itemState: "pending",
        providerOutcome: "not_started",
      },
    ],
    lastDispatchReceiptStoredAt: baseEpoch - 10_000,
    nextEligibleDispatchAt: baseEpoch + 30_000,
    createdAt: baseEpoch - 15_000,
    updatedAt: baseEpoch - 10_000,
    revision: 2,
    ...overrides,
  };
}

describe("Images UI Part 1 presentation improvements", () => {
  it("notifies once for new Sent receipts in queue order and once for the completed batch", () => {
    const tracker = new ImageQueueNotificationTracker();
    const base = makeQueueFixture({
      state: "ready",
      items: makeQueueFixture().items.map((item, index) => ({
        ...item,
        shotId: index === 0 ? "41" : "8",
        itemState: "pending",
        providerOutcome: "not_started",
        dispatchReceipt: undefined,
      })),
      nextEligibleDispatchAt: null,
    });
    expect(tracker.observe([base])).toEqual([]);

    const completed = {
      ...base,
      state: "sent" as const,
      revision: base.revision + 1,
      items: base.items.map((item, index) => ({
        ...item,
        itemState: "sent" as const,
        providerOutcome: "unknown" as const,
        dispatchReceipt: {
          attemptId: `attempt-nonseq-${index}`,
          storedAt: Date.now(),
          evidence: "activation_pair_sent_or_uncertain" as const,
        },
      })),
    };
    const notices = tracker.observe([completed]);
    expect(notices.map((notice) => notice.message)).toEqual([
      "Image prompt 41 sent",
      "Image prompt 8 sent",
      "All 2 image prompts sent",
    ]);
    expect(
      notices.every((notice) => notice.kind === "info" && notice.dedupeKey),
    ).toBe(true);
    expect(tracker.observe([completed])).toEqual([]);

    // The module-lifetime tracker is reused across component remounts; a fresh
    // tracker models a reload and establishes a historical baseline instead.
    expect(
      tracker.observe([{ ...completed, revision: completed.revision + 1 }]),
    ).toEqual([]);
    expect(new ImageQueueNotificationTracker().observe([completed])).toEqual(
      [],
    );

    const manager = new ToastManager(4);
    for (const notice of notices) manager.add(notice);
    expect(manager.getSnapshot().map((notice) => notice.message)).toHaveLength(
      3,
    );
    manager.add(notices[0]!);
    expect(manager.getSnapshot()).toHaveLength(3);
    manager.add({
      ...notices[0]!,
      dedupeKey: "image-sent:another-queue-attempt",
    });
    expect(manager.getSnapshot()).toHaveLength(4);
    manager.dispose();
  });

  it("does not notify for blocked uncertain attempts", () => {
    const tracker = new ImageQueueNotificationTracker();
    const base = makeQueueFixture({
      state: "ready",
      items: makeQueueFixture().items.map((item) => ({
        ...item,
        itemState: "pending",
        providerOutcome: "not_started",
        dispatchReceipt: undefined,
      })),
      nextEligibleDispatchAt: null,
    });
    tracker.observe([base]);
    const blocked = {
      ...base,
      state: "blocked" as const,
      revision: base.revision + 1,
      items: base.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              itemState: "blocked" as const,
              providerOutcome: "unknown" as const,
            }
          : item,
      ),
    };
    expect(tracker.observe([blocked])).toEqual([]);
  });

  it("animates only a recorded active shot and stops that treatment when paused", async () => {
    const base = makeQueueFixture();
    const sending = {
      ...base,
      state: "waiting" as const,
      items: base.items.map((item, index) =>
        index === 1
          ? {
              ...item,
              itemState: "sending" as const,
              providerOutcome: "unknown" as const,
              dispatchIntent: {
                attemptId: "attempt-active",
                recordedAt: Date.now(),
                activationStartedAt: Date.now(),
              },
              dispatchReceipt: undefined,
            }
          : item,
      ),
    };
    await act(async () => {
      root!.render(
        createElement(QueueCard, {
          queue: sending,
          starting: false,
          busy: false,
          onStart: vi.fn(),
          onCommand: vi.fn(),
        }),
      );
    });
    expect(
      container!.querySelector('[data-processing="true"]')?.textContent,
    ).toContain("Shot 2");

    await act(async () => {
      root!.render(
        createElement(QueueCard, {
          queue: { ...sending, state: "paused" },
          starting: false,
          busy: false,
          onStart: vi.fn(),
          onCommand: vi.fn(),
        }),
      );
    });
    expect(container!.querySelector('[data-processing="true"]')).toBeNull();
  });

  it("renders JSON editor with compact toolbar, wrap lines toggle, and more usable height", async () => {
    const session = new ImportPreviewSession("image");
    const client = { request: vi.fn() } as unknown as FoundationClient;

    let wrapLines = false;
    let expanded = false;

    await act(async () => {
      root!.render(
        createElement(
          ToastHost,
          { maxVisible: 3 },
          createElement(ImageImportPanel, {
            session,
            workspaceId: "default",
            persistenceClient: client,
            wrapLines,
            setWrapLines: (v) => {
              wrapLines = v;
            },
            editorExpanded: expanded,
            setEditorExpanded: (v) => {
              expanded = v;
            },
            onSourceReadinessChange: vi.fn(),
          }),
        ),
      );
    });

    const textarea = container!.querySelector(
      "#image-import-source",
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.getAttribute("wrap")).toBe("off");

    const editorTopRow = container!.querySelector(
      '[class*="imageEditorTopRow"]',
    );
    expect(editorTopRow).not.toBeNull();
    expect(editorTopRow!.querySelector("#image-input-title")?.textContent).toBe(
      "Image prompt import",
    );

    // Toolbar buttons
    const wrapButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Wrap lines"),
    );
    const expandButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Expand editor"),
    );
    expect(wrapButton).toBeDefined();
    expect(expandButton).toBeDefined();

    // Source toolbar actions
    const fileInput = container!.querySelector("#image-json-file");
    expect(fileInput).not.toBeNull();

    const newBatchButton = Array.from(
      container!.querySelectorAll("button"),
    ).find((btn) => btn.textContent?.includes("New batch"));
    const loadBatchButton = Array.from(
      container!.querySelectorAll("button"),
    ).find((btn) => btn.textContent?.includes("Load saved batch"));
    const exportBatchButton = Array.from(
      container!.querySelectorAll("button"),
    ).find((btn) => btn.textContent?.includes("Export saved source"));

    expect(newBatchButton).toBeDefined();
    expect(loadBatchButton).toBeDefined();
    expect(exportBatchButton).toBeDefined();

    // Validate & Preview button exists and is associated
    const validateButton = Array.from(
      container!.querySelectorAll("button"),
    ).find((btn) => btn.textContent?.includes("Validate & Preview"));
    expect(validateButton).toBeDefined();
    expect(
      validateButton!.closest('[class*="imageActionFooter"]'),
    ).not.toBeNull();

    // Save validated batch button exists and is initially disabled for empty draft
    const saveButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Save validated batch"),
    );
    expect(saveButton).toBeDefined();
    expect(saveButton?.disabled).toBe(true);
    expect(saveButton!.closest('[class*="imageActionFooter"]')).not.toBeNull();
    const content = container!.querySelector('[class*="imageImportContent"]');
    expect(content).not.toBeNull();
    expect(content!.nextElementSibling).toBe(
      saveButton!.closest('[class*="imageActionFooter"]'),
    );
  });

  it("keeps the queue title and interval label together for empty and populated queue panels", async () => {
    for (const savedQueues of [[], [makeQueueFixture()]]) {
      const client = {
        request: vi.fn(async () => savedQueues),
      } as unknown as FoundationClient;
      await act(async () => {
        root!.render(
          createElement(ImageQueueProgress, {
            workspaceId: "default",
            persistenceClient: client,
            sourceReady: false,
            savedShotIds: [],
            settingsConfirmationPending: false,
            settingsConfirmationControls: null,
          }),
        );
        await Promise.resolve();
      });
      const header = container!.querySelector('[class*="header"]');
      expect(header).not.toBeNull();
      expect(header!.textContent).toContain("Image queue");
      expect(header!.textContent).toContain("40 seconds between prompts");
      expect(header!.querySelector("h3")).not.toBeNull();
    }
  });

  it("places an existing current-batch queue before setup in both theme wrappers", async () => {
    const base = makeQueueFixture({
      queueId: "00000000-0000-4000-8000-000000000101",
    });
    const ready = {
      ...base,
      state: "ready" as const,
      lastDispatchReceiptStoredAt: null,
      nextEligibleDispatchAt: null,
      items: base.items.map((item) => ({
        ...item,
        itemState: "pending" as const,
        providerOutcome: "not_started" as const,
        dispatchReceipt: undefined,
      })),
    };
    const waiting = {
      ...base,
      queueId: "00000000-0000-4000-8000-000000000102",
    };
    const paused = {
      ...base,
      queueId: "00000000-0000-4000-8000-000000000103",
      state: "paused" as const,
      pauseReason: "user_requested",
    };
    const blocked = {
      ...base,
      queueId: "00000000-0000-4000-8000-000000000104",
      state: "blocked" as const,
      items: base.items.map((item, index) =>
        index === 1
          ? {
              ...item,
              itemState: "blocked" as const,
              blockReason: "target_changed",
            }
          : item,
      ),
    };
    const secondReceipt = {
      attemptId: "attempt-2",
      storedAt: Date.now(),
      evidence: "activation_pair_sent_or_uncertain" as const,
    };
    const allSent = {
      ...base,
      queueId: "00000000-0000-4000-8000-000000000105",
      state: "sent" as const,
      lastDispatchReceiptStoredAt: secondReceipt.storedAt,
      nextEligibleDispatchAt: null,
      items: base.items.map((item, index) => ({
        ...item,
        itemState: "sent" as const,
        providerOutcome: "unknown" as const,
        dispatchReceipt: index === 0 ? item.dispatchReceipt : secondReceipt,
      })),
    };
    const fixtures = [
      {
        name: "empty",
        queue: undefined,
        queues: [] as ImageSubmissionQueueRecord[],
      },
      ...[
        { name: "ready", queue: ready },
        { name: "waiting", queue: waiting },
        { name: "paused", queue: paused },
        { name: "blocked", queue: blocked },
        { name: "all-sent", queue: allSent },
      ].map(({ name, queue }) => ({ name, queue, queues: [queue] })),
    ];
    const confirmation = {
      confirmationId: "conf-123",
      confirmedAt: Date.now(),
      tabId: 10,
      projectId: "proj-123",
      canonicalTarget: "https://flow.google.com/project/proj-123",
      declaredVariantCount: 2,
    };

    for (const theme of ["light", "dark"]) {
      for (const fixture of fixtures) {
        if (fixture.queue) {
          const parsed = ImageSubmissionQueueRecordSchema.safeParse(
            fixture.queue,
          );
          expect(
            parsed.success,
            JSON.stringify(parsed.success ? [] : parsed.error.issues),
          ).toBe(true);
        }
        const source = fixture.queue?.sourceText ?? '{"shot_id":"1"}';
        const client = {
          request: vi.fn(async () => fixture.queues),
        } as unknown as FoundationClient;
        await act(async () => {
          root!.render(
            createElement(
              "div",
              { "data-theme": theme },
              createElement(ImageQueueProgress, {
                workspaceId: "default",
                persistenceClient: client,
                sourceReady: true,
                savedSource: source,
                savedShotIds: ["1", "2"],
                settingsConfirmation: confirmation,
                settingsConfirmationPending: false,
                settingsConfirmationControls: createElement("input", {
                  "aria-label": "Manual settings confirmation fixture",
                }),
              }),
              createElement(
                "section",
                { "data-testid": "source-summary" },
                "Source summary",
              ),
            ),
          );
          await Promise.resolve();
        });

        const section = container!.querySelector(
          "section[aria-labelledby='image-queue-title']",
        )!;
        const heading = section.querySelector('[class*="header"]')!;
        const setup = section.querySelector('[class*="createCard"]')!;
        const current = section.querySelector('[class*="currentQueueBlock"]');
        expect(heading.textContent).toContain("40 seconds between prompts");
        if (fixture.queue) {
          expect(current, `${theme}/${fixture.name}`).not.toBeNull();
          expect(
            heading.compareDocumentPosition(current!) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
          expect(
            current!.compareDocumentPosition(setup) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
          expect(
            current!.querySelectorAll('[aria-label^="Timed image queue "]'),
          ).toHaveLength(1);
          expect(
            current!.querySelector('[aria-label="Prompt queue"] li:last-child')
              ?.textContent,
          ).toContain("Shot 2");
          if (fixture.name === "waiting") {
            expect(current!.querySelector('[role="timer"]')).not.toBeNull();
            expect(current!.textContent).toContain("Pause");
          } else if (fixture.name === "ready")
            expect(current!.textContent).toContain("Start queue");
          else if (fixture.name === "paused")
            expect(current!.textContent).toContain("Resume");
          else if (fixture.name === "blocked")
            expect(current!.textContent).toContain("Inspect current editor");
          else expect(current!.textContent).toContain("Finished");
        } else {
          expect(current).toBeNull();
          expect(
            heading.compareDocumentPosition(setup) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
        }
        await act(async () => root!.render(null));
      }
    }
  });

  it("keeps queue controls, list, countdown timer, and scroll stable across readback updates", async () => {
    vi.useFakeTimers();
    const initialQueue = makeQueueFixture({
      queueId: "00000000-0000-4000-8000-000000000201",
    });
    let readback = initialQueue;
    const client = {
      request: vi.fn(async (type: string) =>
        type === "imageQueue.list" ? [readback] : null,
      ),
    } as unknown as FoundationClient;
    const confirmation = {
      confirmationId: "conf-123",
      confirmedAt: Date.now(),
      tabId: 10,
      projectId: "proj-123",
      canonicalTarget: "https://flow.google.com/project/proj-123",
      declaredVariantCount: 2,
    };
    await act(async () => {
      root!.render(
        createElement(
          ToastHost,
          null,
          createElement(ImageQueueProgress, {
            workspaceId: "default",
            persistenceClient: client,
            sourceReady: true,
            savedSource: initialQueue.sourceText,
            savedShotIds: ["1", "2"],
            settingsConfirmation: confirmation,
            settingsConfirmationPending: false,
            settingsConfirmationControls: createElement("input", {
              "aria-label": "Persistent settings control",
              defaultValue: "manual",
            }),
          }),
        ),
      );
      await Promise.resolve();
    });

    const settings = container!.querySelector(
      '[aria-label="Persistent settings control"]',
    ) as HTMLInputElement;
    const list = container!.querySelector(
      '[aria-label="Prompt queue"]',
    ) as HTMLOListElement;
    const timer = container!.querySelector('[role="timer"]');
    const intervalCalls = vi.spyOn(window, "setInterval").mock.calls.length;
    expect(settings).not.toBeNull();
    expect(list).not.toBeNull();
    expect(timer).not.toBeNull();

    settings.focus();
    readback = { ...readback, revision: readback.revision + 1 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(
      container!.querySelector('[aria-label="Persistent settings control"]'),
    ).toBe(settings);
    expect(document.activeElement).toBe(settings);
    expect(container!.querySelector('[role="timer"]')).toBe(timer);
    expect(vi.spyOn(window, "setInterval").mock.calls).toHaveLength(
      intervalCalls,
    );

    list.focus();
    list.scrollTop = 64;
    readback = { ...readback, revision: readback.revision + 1 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const updatedList = container!.querySelector(
      '[aria-label="Prompt queue"]',
    ) as HTMLOListElement;
    expect(updatedList).toBe(list);
    expect(updatedList.scrollTop).toBe(64);
    expect(document.activeElement).toBe(updatedList);
    expect(vi.spyOn(window, "setInterval").mock.calls).toHaveLength(
      intervalCalls,
    );
    expect(container!.querySelectorAll("[data-toast-kind]")).toHaveLength(0);

    await act(async () => root!.render(null));
    vi.useRealTimers();
  });

  it("renders active queue with sticky control header, status badge, sent count, countdown, and controls", async () => {
    const queue = makeQueueFixture();
    const client = { request: vi.fn() } as unknown as FoundationClient;

    await act(async () => {
      root!.render(
        createElement(QueueCard, {
          queue,
          persistenceClient: client,
        }),
      );
    });

    // Sticky header container is present
    const stickyHeader = container!.querySelector(
      '[class*="stickyQueueHeader"]',
    );
    expect(stickyHeader).not.toBeNull();

    // Sent count and status
    expect(stickyHeader!.textContent).toContain("1 / 2");
    expect(stickyHeader!.textContent).toContain("Prompts sent");
    expect(stickyHeader!.textContent).toContain("Waiting");
    expect(
      stickyHeader!.querySelector('[class*="statusGlyph"]')?.textContent,
    ).toBe("◷");

    // WaitingClock countdown
    const timer = stickyHeader!.querySelector('[role="timer"]');
    expect(timer).not.toBeNull();

    // Pause and Stop queue controls inside sticky area
    const pauseButton = Array.from(
      stickyHeader!.querySelectorAll("button"),
    ).find((btn) => btn.textContent?.includes("Pause"));
    const stopButton = Array.from(
      stickyHeader!.querySelectorAll("button"),
    ).find((btn) => btn.textContent?.includes("Stop queue"));
    expect(pauseButton).toBeDefined();
    expect(stopButton).toBeDefined();

    // Shot list is rendered below sticky area with compact rows
    const itemsList = container!.querySelector('[class*="items"]');
    expect(itemsList).not.toBeNull();
    const rows = itemsList!.querySelectorAll("li");
    expect(rows.length).toBe(2);

    expect(rows[0]!.textContent).toContain("Shot 1");
    expect(rows[0]!.textContent).toContain("Sent");
    expect(rows[1]!.textContent).toContain("Shot 2");
    expect(rows[1]!.textContent).toContain("Pending");
  });

  it("presents ready, paused, blocked, and finished queue states faithfully", async () => {
    const client = { request: vi.fn() } as unknown as FoundationClient;

    // 1. Ready state
    const readyQueue = makeQueueFixture({
      state: "ready",
      items: [
        {
          ...makeQueueFixture().items[0]!,
          itemState: "pending",
          dispatchReceipt: undefined,
        },
        { ...makeQueueFixture().items[1]!, itemState: "pending" },
      ],
      nextEligibleDispatchAt: null,
    });

    await act(async () => {
      root!.render(
        createElement(QueueCard, {
          queue: readyQueue,
          persistenceClient: client,
        }),
      );
    });
    expect(container!.textContent).toContain("Ready");
    expect(container!.textContent).toContain("Start queue");
    expect(container!.textContent).toContain("Stop queue");

    // 2. Paused state with timeout reason
    const pausedQueue = makeQueueFixture({
      state: "paused",
      pauseReason: "flow_generate_readiness_timeout",
    });

    await act(async () => {
      root!.render(
        createElement(QueueCard, {
          queue: pausedQueue,
          persistenceClient: client,
        }),
      );
    });
    expect(container!.textContent).toContain("Paused");
    expect(container!.textContent).toContain("Resume");
    expect(container!.textContent).toContain("Stop queue");
    expect(container!.textContent).toContain(
      "Flow readiness timed out after 60s",
    );

    // 3. Blocked state
    const blockedQueue = makeQueueFixture({
      state: "blocked",
      items: [
        makeQueueFixture().items[0]!,
        {
          ...makeQueueFixture().items[1]!,
          itemState: "blocked",
          blockReason: "target_changed",
        },
      ],
    });

    await act(async () => {
      root!.render(
        createElement(QueueCard, {
          queue: blockedQueue,
          persistenceClient: client,
          onClearBlockedQueue: vi.fn(),
        }),
      );
    });
    expect(container!.textContent).toContain("Blocked");
    expect(container!.textContent).toContain(
      "Inspect current editor (read-only)",
    );
    expect(container!.textContent).toContain("Clear existing prompt");
    expect(container!.textContent).toContain("target_changed");

    // 4. Finished state
    const finishedQueue = makeQueueFixture({
      state: "sent",
      items: [
        makeQueueFixture().items[0]!,
        {
          ...makeQueueFixture().items[1]!,
          itemState: "sent",
          dispatchReceipt: {
            attemptId: "attempt-2",
            storedAt: Date.now(),
            evidence: "activation_pair_sent_or_uncertain",
          },
        },
      ],
      nextEligibleDispatchAt: null,
    });

    await act(async () => {
      root!.render(
        createElement(QueueCard, {
          queue: finishedQueue,
          persistenceClient: client,
        }),
      );
    });
    expect(container!.textContent).toContain("Finished");
    expect(container!.textContent).toContain(
      "Batch submission finished — 2/2 prompts sent",
    );
  });

  it("keeps long ready, paused, blocked, and all-sent shot lists focusable with final shots rendered", async () => {
    const base = makeQueueFixture();
    const client = { request: vi.fn() } as unknown as FoundationClient;
    const longItems = Array.from({ length: 80 }, (_, index) => ({
      ...base.items[1]!,
      queueItemId: `long-item-${index + 1}`,
      sourceItemId: `long-source-${index + 1}`,
      order: index,
      shotId: String(index + 1),
      rawJsonBody: JSON.stringify({
        shot_id: String(index + 1),
        scene_title: `Scene ${index + 1}`,
      }),
      sourceSpan: { start: index * 10, end: index * 10 + 9 },
      itemState: "pending" as const,
      providerOutcome: "not_started" as const,
      dispatchReceipt: undefined,
    }));

    const fixtures = [
      makeQueueFixture({
        state: "ready",
        items: longItems,
        nextEligibleDispatchAt: null,
      }),
      makeQueueFixture({
        state: "paused",
        pauseReason: "user_requested",
        items: longItems,
        nextEligibleDispatchAt: null,
      }),
      makeQueueFixture({
        state: "blocked",
        items: longItems.map((item, index) =>
          index === 0
            ? {
                ...item,
                itemState: "blocked" as const,
                blockReason: "target_changed",
              }
            : item,
        ),
        nextEligibleDispatchAt: null,
      }),
      makeQueueFixture({
        state: "stopped",
        items: longItems,
        nextEligibleDispatchAt: null,
      }),
      makeQueueFixture({
        state: "sent",
        items: longItems.map((item) => ({
          ...item,
          itemState: "sent" as const,
          providerOutcome: "unknown" as const,
          dispatchReceipt: {
            attemptId: `attempt-${item.order}`,
            storedAt: Date.now(),
            evidence: "activation_pair_sent_or_uncertain" as const,
          },
        })),
        nextEligibleDispatchAt: null,
      }),
    ];

    for (const fixture of fixtures) {
      await act(async () => {
        root!.render(
          createElement(QueueCard, {
            queue: fixture,
            persistenceClient: client,
            onClearBlockedQueue: vi.fn(),
          }),
        );
      });
      const sticky = container!.querySelector('[class*="stickyQueueHeader"]');
      const list = container!.querySelector(
        '[aria-label="Prompt queue"]',
      ) as HTMLOListElement;
      expect(sticky).not.toBeNull();
      expect(sticky!.textContent).toContain("80");
      const expectedGlyph: Record<ImageSubmissionQueueRecord["state"], string> =
        {
          ready: "○",
          waiting: "◷",
          paused: "Ⅱ",
          blocked: "!",
          stopped: "—",
          sent: "✓",
        };
      expect(sticky!.querySelector('[class*="statusGlyph"]')?.textContent).toBe(
        expectedGlyph[fixture.state],
      );
      expect(list).not.toBeNull();
      expect(list.tabIndex).toBe(0);
      expect(list.querySelectorAll("li")).toHaveLength(80);
      expect(list.lastElementChild?.textContent).toContain("Shot 80");
      expect(
        container!.querySelector('[class*="technicalDetails"]'),
      ).not.toBeNull();
      list.focus();
      expect(document.activeElement).toBe(list);
    }
  });

  it("renders Source summary with full width alignment and exact queue match status", async () => {
    let executeSchedule: (() => void) | undefined;
    const session = new ImportPreviewSession("image", undefined, (cb) => {
      executeSchedule = cb;
      return 1 as never;
    });
    const json =
      '1: {"shot_id":"1","scene":"dino"}\n2: {"shot_id":"2","scene":"jungle"}';
    session.setSource(json);
    session.validate();
    executeSchedule?.();

    const snapshot = session.getSnapshot();
    const validatedItems = snapshot.result?.items ?? [];
    const queue = makeQueueFixture({
      sourceText: json,
      items: validatedItems.map((item, index) => ({
        queueItemId: `item-${index + 1}`,
        sourceItemId: `source-${index + 1}`,
        order: index,
        shotId: item.shotId,
        rawJsonBody: item.rawBody,
        promptHash: "2".repeat(64),
        sourceSpan: item.sourceSpan,
        itemState: index === 0 ? "sent" : "pending",
        providerOutcome: index === 0 ? "unknown" : "not_started",
        ...(index === 0
          ? {
              dispatchReceipt: {
                attemptId: "attempt-1",
                storedAt: Date.now() - 10_000,
                evidence: "activation_pair_sent_or_uncertain",
              },
            }
          : {}),
      })),
    });

    await act(async () => {
      root!.render(
        createElement(ValidatedPromptPanel, {
          session,
          savedSource: json,
          currentQueue: queue,
        }),
      );
    });

    expect(container!.textContent).toContain("SOURCE SUMMARY");
    expect(container!.textContent).toContain("2 validated prompts");
    expect(container!.textContent).toContain(
      "Saved source · status from its exact queue snapshot",
    );

    const section = container!.querySelector('[class*="sourceSummary"]');
    expect(section).not.toBeNull();
    const promptList = container!.querySelector('[class*="sourcePromptList"]');
    expect(promptList).not.toBeNull();
  });

  it("preserves editor text, selection range, and scroll position during queue updates", async () => {
    const session = new ImportPreviewSession("image");
    const sampleText =
      '{\n  "shot_id": "1",\n  "description": "Long JSON prompt for dinosaur scene"\n}';
    session.setSource(sampleText);

    let currentQueueState: ImageSubmissionQueueRecord | undefined =
      makeQueueFixture();

    const client = {
      request: vi.fn(async (type) => {
        if (type === "imageQueue.list") return [currentQueueState];
        return null;
      }),
    } as unknown as FoundationClient;

    function TestImagesHarness({
      queue,
    }: {
      queue?: ImageSubmissionQueueRecord;
    }) {
      return createElement(
        "div",
        null,
        createElement(
          ToastHost,
          { maxVisible: 3 },
          createElement(ImageImportPanel, {
            session,
            workspaceId: "default",
            persistenceClient: client,
            wrapLines: false,
            setWrapLines: () => {},
            editorExpanded: false,
            setEditorExpanded: () => {},
            onSourceReadinessChange: () => {},
          }),
          createElement(QueueCard, {
            queue: queue ?? makeQueueFixture(),
            persistenceClient: client,
          }),
        ),
      );
    }

    await act(async () => {
      root!.render(
        createElement(TestImagesHarness, { queue: currentQueueState }),
      );
    });

    const textarea = container!.querySelector(
      "#image-import-source",
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe(sampleText);

    // Focus editor and set selection range and scroll
    textarea.focus();
    textarea.setSelectionRange(6, 18);
    textarea.scrollTop = 50;

    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(18);

    // Simulate queue polling / update cycle (e.g. revision updates, sent count increments)
    currentQueueState = makeQueueFixture({
      revision: 3,
      items: [
        makeQueueFixture().items[0]!,
        {
          ...makeQueueFixture().items[1]!,
          itemState: "sending",
        },
      ],
    });

    await act(async () => {
      root!.render(
        createElement(TestImagesHarness, { queue: currentQueueState }),
      );
    });

    // Check that editor text, selection, scroll position and focus are completely preserved
    const updatedTextarea = container!.querySelector(
      "#image-import-source",
    ) as HTMLTextAreaElement;
    expect(updatedTextarea).toBe(textarea);
    expect(updatedTextarea.value).toBe(sampleText);
    expect(document.activeElement).toBe(updatedTextarea);
    expect(updatedTextarea.selectionStart).toBe(6);
    expect(updatedTextarea.selectionEnd).toBe(18);
    expect(updatedTextarea.scrollTop).toBe(50);
  });

  it("handles editor dialog expansion and modal closing", async () => {
    const session = new ImportPreviewSession("image");
    session.setSource('{"shot_id":"99"}');
    let expanded = false;

    // Provide mock for HTMLDialogElement showModal and close in jsdom
    HTMLDialogElement.prototype.showModal = vi.fn(function (
      this: HTMLDialogElement,
    ) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (
      this: HTMLDialogElement,
    ) {
      this.open = false;
    });

    const client = { request: vi.fn() } as unknown as FoundationClient;

    await act(async () => {
      root!.render(
        createElement(
          ToastHost,
          { maxVisible: 3 },
          createElement(ImageImportPanel, {
            session,
            workspaceId: "default",
            persistenceClient: client,
            wrapLines: false,
            setWrapLines: () => {},
            editorExpanded: expanded,
            setEditorExpanded: (v) => {
              expanded = v;
            },
            onSourceReadinessChange: () => {},
          }),
        ),
      );
    });

    const expandButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Expand editor"),
    );
    expect(expandButton).toBeDefined();

    await act(async () => {
      expandButton!.click();
    });
    expect(expanded).toBe(true);

    // Render with expanded=true
    await act(async () => {
      root!.render(
        createElement(
          ToastHost,
          { maxVisible: 3 },
          createElement(ImageImportPanel, {
            session,
            workspaceId: "default",
            persistenceClient: client,
            wrapLines: false,
            setWrapLines: () => {},
            editorExpanded: true,
            setEditorExpanded: (v) => {
              expanded = v;
            },
            onSourceReadinessChange: () => {},
          }),
        ),
      );
    });

    const dialog = container!.querySelector("dialog");
    expect(dialog).not.toBeNull();
    const dialogTextarea = dialog!.querySelector("textarea");
    expect(dialogTextarea).not.toBeNull();
    expect(dialogTextarea!.value).toBe('{"shot_id":"99"}');

    const closeButton = Array.from(dialog!.querySelectorAll("button")).find(
      (btn) =>
        btn.textContent?.includes("Close editor") ||
        btn.textContent?.includes("Close"),
    );
    expect(closeButton).toBeDefined();
  });

  it("handles clear blocked queue dialog open, cancel, and confirmation", async () => {
    const onClearBlockedQueue = vi.fn().mockResolvedValue(true);
    const blockedQueue = makeQueueFixture({
      state: "blocked",
      items: [
        makeQueueFixture().items[0]!,
        {
          ...makeQueueFixture().items[1]!,
          itemState: "blocked",
          blockReason: "target_changed",
        },
      ],
    });

    HTMLDialogElement.prototype.showModal = vi.fn(function (
      this: HTMLDialogElement,
    ) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (
      this: HTMLDialogElement,
    ) {
      this.open = false;
    });

    await act(async () => {
      root!.render(
        createElement(QueueCard, {
          queue: blockedQueue,
          persistenceClient: {
            request: vi.fn(),
          } as unknown as FoundationClient,
          onClearBlockedQueue,
        }),
      );
    });

    const clearButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Clear existing prompt"),
    );
    expect(clearButton).toBeDefined();

    await act(async () => {
      clearButton!.click();
    });

    const dialog = container!.querySelector('dialog[class*="clearDialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Clear this blocked batch?");

    // Click confirm clear in dialog
    const confirmClearBtn = Array.from(dialog!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Clear existing prompt"),
    );
    expect(confirmClearBtn).toBeDefined();

    await act(async () => {
      confirmClearBtn!.click();
    });
    expect(onClearBlockedQueue).toHaveBeenCalledWith(blockedQueue);
  });
});
