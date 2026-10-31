import { describe, expect, it } from "vitest";
import {
  canTransitionImageQueue,
  canTransitionImageQueueItem,
  nextTimedDispatchDeadline,
  TIMED_IMAGE_SUBMISSION_INTERVAL_MS,
} from "../../src/domain/jobs/queue";
import {
  ActiveFlowImageAttemptError,
  DuplicateTimedImageQueueSourceError,
  ExtensionRepositories,
  sha256Hex,
} from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";

const settingsConfirmation = {
  confirmationId: "4de433f1-6abd-475b-8d7e-1d6f4828608d",
  confirmedAt: 123,
  tabId: 17,
  projectId: "project-17",
  canonicalTarget: "https://flow.google.com/project/project-17",
  declaredVariantCount: 3,
};

describe("timed image submission queue foundation", () => {
  it("persists exact source, ordered prompts, settings, project binding, and reads back", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 500);
    const source =
      '1: {"shot_id":"01","text":"first  \\n prompt"}\r\n2. {"shot_id":"02","text":"second value"}';
    await repositories.savePromptBatch({
      workspaceId: "image-workspace",
      kind: "image",
      sourceText: source,
    });
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: settingsConfirmation.tabId,
      canonicalTarget: settingsConfirmation.canonicalTarget,
    });

    const queue = await repositories.createTimedImageSubmissionQueue({
      workspaceId: "image-workspace",
      queueId: "3bfb0849-289e-4f83-bcbb-36a6ee54108d",
      settingsConfirmation,
    });
    const readback = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );

    expect(queue).toEqual(readback);
    expect(queue).toMatchObject({
      mode: "timed_submission",
      intervalMs: 40_000,
      sourceText: source,
      sourceHash: await sha256Hex(source),
      state: "ready",
      lastDispatchReceiptStoredAt: null,
      nextEligibleDispatchAt: null,
      manualSettingsDeclaration: {
        ...settingsConfirmation,
        userAttested: true,
      },
      selectedProject: {
        provider: "Flow",
        tabId: 17,
        projectId: "project-17",
        canonicalTarget: settingsConfirmation.canonicalTarget,
      },
    });
    expect(queue.items.map((item) => item.order)).toEqual([0, 1]);
    expect(queue.items.map((item) => item.shotId)).toEqual(["1", "2"]);
    expect(queue.items.map((item) => item.rawJsonBody)).toEqual([
      '{"shot_id":"01","text":"first  \\n prompt"}',
      '{"shot_id":"02","text":"second value"}',
    ]);
    expect(queue.items.every((item) => item.itemState === "pending")).toBe(
      true,
    );
    expect(
      queue.items.every((item) => item.providerOutcome === "not_started"),
    ).toBe(true);
  });

  it("refuses an exact source held by an unresolved historical attempt", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 500);
    const body = '{"shot_id":"01","text":"same source"}';
    await repositories.savePromptBatch({
      workspaceId: "new-workspace",
      kind: "image",
      sourceText: body,
    });
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: 17,
      canonicalTarget: settingsConfirmation.canonicalTarget,
    });
    await database.flowImageAttempts.put({
      attemptId: "historic-attempt",
      confirmationKey: "historic-confirmation",
      workspaceId: "old-workspace",
      batchId: "old-batch",
      itemId: "different-item-id",
      promptHash: await sha256Hex(body),
      sourceSnapshotId: "historic-snapshot",
      promptCodeUnits: body.length,
      promptUtf8Bytes: new TextEncoder().encode(body).byteLength,
      provider: "Flow",
      projectId: "old-project",
      tabId: 99,
      frameId: "0",
      loaderId: "old-loader",
      buildId: "historic-build",
      protocolVersion: 1,
      settingsConfirmation: {
        confirmationId: "historic-settings",
        confirmedAt: 1,
        userAttested: true,
        tabId: 99,
        projectId: "old-project",
      },
      state: "dispatched",
      events: [],
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(
      repositories.createTimedImageSubmissionQueue({
        workspaceId: "new-workspace",
        queueId: "7a1126d4-ea52-4ab5-b877-d3e75467ed76",
        settingsConfirmation,
      }),
    ).rejects.toBeInstanceOf(ActiveFlowImageAttemptError);
    expect(
      await repositories.listTimedImageSubmissionQueues("new-workspace"),
    ).toEqual([]);
  });

  it("does not allow a new queue to bypass an existing same-source queue", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 500);
    const source = '{"shot_id":"01","text":"one-time source"}';
    await repositories.savePromptBatch({
      workspaceId: "ws",
      kind: "image",
      sourceText: source,
    });
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: 17,
      canonicalTarget: settingsConfirmation.canonicalTarget,
    });
    await repositories.createTimedImageSubmissionQueue({
      workspaceId: "ws",
      queueId: "995f84c2-9f6f-4cd2-9098-c1aa8a662508",
      settingsConfirmation,
    });
    await expect(
      repositories.createTimedImageSubmissionQueue({
        workspaceId: "ws",
        queueId: "9712f340-53fe-4d0a-8a18-91fd2d48248b",
        settingsConfirmation,
      }),
    ).rejects.toBeInstanceOf(DuplicateTimedImageQueueSourceError);
  });

  it("creates a new idle queue for a newly saved distinct batch after a finished queue", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 500);
    const workspaceId = "finished-then-new";
    const oldSource =
      '8: {"shot_id":"8","scene_title":"Old eight"}\n9: {"shot_id":"9","scene_title":"Old nine"}';
    await repositories.savePromptBatch({
      workspaceId,
      kind: "image",
      sourceText: oldSource,
    });
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: settingsConfirmation.tabId,
      canonicalTarget: settingsConfirmation.canonicalTarget,
    });
    const oldQueue = await repositories.createTimedImageSubmissionQueue({
      workspaceId,
      queueId: "17fc8256-37d4-45d6-a326-f8e8a0d04538",
      settingsConfirmation,
    });
    const finishedOldQueue = {
      ...oldQueue,
      state: "sent" as const,
      items: oldQueue.items.map((item, index) => ({
        ...item,
        itemState: "sent" as const,
        providerOutcome: "unknown" as const,
        dispatchReceipt: {
          attemptId: `old-attempt-${index}`,
          storedAt: 100 + index,
          evidence: "activation_pair_sent_or_uncertain" as const,
        },
      })),
      lastDispatchReceiptStoredAt: 101,
      nextEligibleDispatchAt: null,
      updatedAt: 101,
      revision: oldQueue.revision + 1,
    };
    await database.imageSubmissionQueues.put(finishedOldQueue);

    const newSource = [10, 11, 12, 13, 14]
      .map(
        (shotId) =>
          `${shotId}: ${JSON.stringify({ shot_id: String(shotId), scene_title: `New shot ${shotId}` })}`,
      )
      .join("\n");
    await repositories.savePromptBatch({
      workspaceId,
      kind: "image",
      sourceText: newSource,
    });
    const newConfirmation = {
      ...settingsConfirmation,
      confirmationId: "new-batch-confirmation",
      confirmedAt: 250,
    };
    const newQueue = await repositories.createTimedImageSubmissionQueue({
      workspaceId,
      queueId: "db9873c8-60c1-407d-9c08-1a64cbfbdf85",
      settingsConfirmation: newConfirmation,
    });

    expect(newQueue.queueId).not.toBe(finishedOldQueue.queueId);
    expect(newQueue).toMatchObject({
      sourceText: newSource,
      state: "ready",
      selectedProject: {
        tabId: newConfirmation.tabId,
        projectId: newConfirmation.projectId,
        canonicalTarget: newConfirmation.canonicalTarget,
      },
      manualSettingsDeclaration: {
        confirmationId: "new-batch-confirmation",
      },
      lastDispatchReceiptStoredAt: null,
      nextEligibleDispatchAt: null,
    });
    expect(newQueue.items.map((item) => item.shotId)).toEqual([
      "10",
      "11",
      "12",
      "13",
      "14",
    ]);
    expect(
      newQueue.items.every(
        (item) =>
          item.itemState === "pending" &&
          item.providerOutcome === "not_started" &&
          !item.dispatchReceipt &&
          !item.dispatchIntent,
      ),
    ).toBe(true);
    expect(
      await repositories.getTimedImageSubmissionQueue(oldQueue.queueId),
    ).toEqual(finishedOldQueue);
  });

  it("serializes concurrent queue creation so only one exact source is accepted", async () => {
    const database = createMemoryRepositoryDatabase();
    const repositories = new ExtensionRepositories(database, () => 500);
    await repositories.savePromptBatch({
      workspaceId: "ws-concurrent",
      kind: "image",
      sourceText: '{"shot_id":"01","text":"concurrent source"}',
    });
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: 17,
      canonicalTarget: settingsConfirmation.canonicalTarget,
    });
    const outcomes = await Promise.allSettled([
      repositories.createTimedImageSubmissionQueue({
        workspaceId: "ws-concurrent",
        queueId: "e84251dc-15cf-4eb5-8c9b-56550e2a6de4",
        settingsConfirmation,
      }),
      repositories.createTimedImageSubmissionQueue({
        workspaceId: "ws-concurrent",
        queueId: "db077e57-1b42-40a8-9432-3a846227d86d",
        settingsConfirmation,
      }),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      await repositories.listTimedImageSubmissionQueues("ws-concurrent"),
    ).toHaveLength(1);
  });

  it("defines safe transitions and deadlines exactly forty seconds after durable receipt", () => {
    expect(TIMED_IMAGE_SUBMISSION_INTERVAL_MS).toBe(40_000);
    expect(nextTimedDispatchDeadline(100_000)).toBe(140_000);
    expect(canTransitionImageQueue("ready", "waiting")).toBe(true);
    expect(canTransitionImageQueue("waiting", "ready")).toBe(false);
    expect(canTransitionImageQueue("blocked", "ready")).toBe(false);
    expect(canTransitionImageQueueItem("pending", "sending")).toBe(true);
    expect(canTransitionImageQueueItem("sent", "pending")).toBe(false);
  });
});
