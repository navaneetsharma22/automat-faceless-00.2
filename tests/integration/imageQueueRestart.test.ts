import { describe, expect, it } from "vitest";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import {
  createTimedImageQueueScheduler,
  IMAGE_QUEUE_ALARM_PREFIX,
} from "../../src/background/scheduler";

const target = {
  provider: "Flow" as const,
  tabId: 29,
  canonicalTarget: "https://flow.google.com/project/timed-project",
};
const confirmation = {
  confirmationId: "timed-confirmation",
  confirmedAt: 800,
  tabId: 29,
  projectId: "timed-project",
  canonicalTarget: target.canonicalTarget,
  declaredVariantCount: 3,
};

async function fixture() {
  const database = createMemoryRepositoryDatabase();
  let clock = 1_000;
  const repositories = new ExtensionRepositories(database, () => clock);
  const source =
    '1: {"shot_id":"01","text":"exact first  "}\n2: {"shot_id":"02","text":"exact second"}';
  await repositories.savePromptBatch({
    workspaceId: "timed-ws",
    kind: "image",
    sourceText: source,
  });
  await repositories.recordSelectedTarget(target);
  const selected = await repositories.getSelectedTarget("Flow");
  await database.selectedTargets.put({
    ...selected!,
    verification: "verified",
    connectionState: "verified",
    verificationBinding: {
      provider: "Flow",
      tabId: 29,
      canonicalTarget: target.canonicalTarget,
      projectId: "timed-project",
      frameId: 0,
      documentId: "doc-1",
      documentToken: "token-1",
      extensionBuildId: "build",
      extensionProtocolVersion: 1,
      connectorBuildId: "build",
      connectorProtocolVersion: 1,
      capability: "read-only-connection-v1",
      verifiedAt: 900,
    },
  });
  const queue = await repositories.createTimedImageSubmissionQueue({
    workspaceId: "timed-ws",
    queueId: crypto.randomUUID(),
    settingsConfirmation: confirmation,
  });
  return {
    database,
    repositories,
    queue,
    clock: (value?: number) => (value === undefined ? clock : (clock = value)),
  };
}

function alarms() {
  const entries = new Map<string, number>();
  return {
    entries,
    api: {
      create: (name: string, info: { when?: number }) => {
        entries.set(name, info.when ?? 0);
      },
      clear: async (name: string) => entries.delete(name),
    } as never,
  };
}

describe("timed queue pause, stop, restart and lost response", () => {
  it("Pause wins before activation authorization and a stale task cannot activate", async () => {
    const { repositories, queue, clock } = await fixture();
    const saved = await repositories.claimTimedImageQueueItem({
      queueId: queue.queueId,
      expectedRevision: queue.revision,
      order: 0,
      attemptId: "attempt-one",
      at: clock(),
    });
    const authorize = () =>
      repositories
        .markTimedImageQueueActivationStarted({
          queueId: queue.queueId,
          expectedRevision: saved.revision,
          order: 0,
          attemptId: "attempt-one",
          at: clock(),
        })
        .then(() => undefined);
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      alarms: alarms().api,
      now: clock,
      dispatch: async () => ({
        status: "blocked",
        reason: "unused",
        uncertain: false,
      }),
    });
    await repositories.pauseTimedImageQueue({
      queueId: queue.queueId,
      expectedRevision: saved.revision,
      at: clock(),
    });
    await expect(authorize()).rejects.toMatchObject({
      code: "activation_intent_revision_changed",
    });
    await scheduler.reconcileStartup();
    const current = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(current?.state).toBe("paused");
    expect(current?.items[0]).toMatchObject({
      itemState: "pending",
      providerOutcome: "not_started",
    });
    expect(current?.items[0]?.dispatchIntent).toBeUndefined();
  });

  it("Pause during authorized input stores the receipt and preserves the deadline without an alarm", async () => {
    const { repositories, queue, clock } = await fixture();
    const alarmsFixture = alarms();
    let inputAuthorized!: () => void;
    let finish!: () => void;
    const authorized = new Promise<void>((resolve) => {
      inputAuthorized = resolve;
    });
    const finishInput = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      alarms: alarmsFixture.api,
      now: clock,
      dispatch: async ({ authorizeActivation }) => {
        await authorizeActivation();
        inputAuthorized();
        await finishInput;
        return { status: "activated", at: clock() };
      },
    });
    const running = scheduler.start(queue.queueId);
    await authorized;
    const sending = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    const paused = await scheduler.pause(queue.queueId, sending!.revision);
    expect(paused.state).toBe("paused");
    finish();
    const result = await running;
    expect(result.state).toBe("paused");
    expect(result.items[0]).toMatchObject({
      itemState: "sent",
      providerOutcome: "unknown",
    });
    expect(result.nextEligibleDispatchAt).toBe(41_000);
    expect(alarmsFixture.entries.size).toBe(0);
  });

  it("Stop during authorized input keeps that receipt and permanently stops remaining items", async () => {
    const { repositories, queue, clock } = await fixture();
    let authorized!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      authorized = resolve;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      alarms: alarms().api,
      now: clock,
      dispatch: async ({ authorizeActivation }) => {
        await authorizeActivation();
        authorized();
        await done;
        return { status: "activated", at: clock() };
      },
    });
    const running = scheduler.start(queue.queueId);
    await ready;
    const sending = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    await scheduler.stop(queue.queueId, sending!.revision);
    finish();
    const stopped = await running;
    expect(stopped.state).toBe("stopped");
    expect(stopped.items.map((item) => item.itemState)).toEqual([
      "sent",
      "stopped",
    ]);
    expect(stopped.items[0]?.dispatchReceipt).toBeDefined();
    expect(
      (await scheduler.stop(queue.queueId, stopped.revision)).revision,
    ).toBe(stopped.revision);
  });

  it("Resume preserves the saved deadline, handles overdue work once, and duplicate commands are idempotent", async () => {
    const { repositories, queue, clock } = await fixture();
    const alarmsFixture = alarms();
    let dispatches = 0;
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      alarms: alarmsFixture.api,
      now: clock,
      verifyTargetForContinuation: async () => undefined,
      dispatch: async ({ authorizeActivation }) => {
        await authorizeActivation();
        dispatches += 1;
        return { status: "activated", at: clock() };
      },
    });
    await scheduler.start(queue.queueId);
    let current = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(dispatches).toBe(1);
    expect(current?.nextEligibleDispatchAt).toBe(41_000);
    const paused = await scheduler.pause(queue.queueId, current!.revision);
    expect(
      (await scheduler.pause(queue.queueId, current!.revision)).revision,
    ).toBe(paused.revision);
    clock(40_999);
    const resumed = await scheduler.resume(queue.queueId, paused.revision);
    expect(resumed.state).toBe("waiting");
    expect(resumed.nextEligibleDispatchAt).toBe(41_000);
    expect(dispatches).toBe(1);
    await scheduler.pause(queue.queueId, resumed.revision);
    current = await repositories.getTimedImageSubmissionQueue(queue.queueId);
    clock(100_000);
    const overdue = await scheduler.resume(queue.queueId, current!.revision);
    expect(overdue.state).toBe("sent");
    expect(dispatches).toBe(2);
    expect(overdue.items.map((item) => item.dispatchReceipt?.storedAt)).toEqual(
      [1_000, 100_000],
    );
    expect(
      overdue.items.every((item) => item.providerOutcome === "unknown"),
    ).toBe(true);
  });

  it("worker restart blocks unresolved intent and never replays; durable receipt survives a lost UI reply", async () => {
    const { repositories, queue, clock } = await fixture();
    const alarmsFixture = alarms();
    let dispatches = 0;
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      alarms: alarmsFixture.api,
      now: clock,
      dispatch: async () => {
        dispatches += 1;
        return { status: "activated", at: clock() };
      },
    });
    const claim = await repositories.claimTimedImageQueueItem({
      queueId: queue.queueId,
      expectedRevision: queue.revision,
      order: 0,
      attemptId: "crashed-before-activation",
      at: clock(),
    });
    await scheduler.reconcileStartup();
    const blocked = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(blocked?.state).toBe("blocked");
    expect(blocked?.items[0]).toMatchObject({
      itemState: "blocked",
      providerOutcome: "not_started",
      dispatchIntent: { attemptId: "crashed-before-activation" },
    });
    expect(dispatches).toBe(0);
    expect(claim.items[0]?.dispatchIntent).toBeDefined();

    const afterInput = await fixture();
    const intent = await afterInput.repositories.claimTimedImageQueueItem({
      queueId: afterInput.queue.queueId,
      expectedRevision: afterInput.queue.revision,
      order: 0,
      attemptId: "crashed-after-authorization",
      at: afterInput.clock(),
    });
    await afterInput.repositories.markTimedImageQueueActivationStarted({
      queueId: afterInput.queue.queueId,
      expectedRevision: intent.revision,
      order: 0,
      attemptId: "crashed-after-authorization",
      at: afterInput.clock(),
    });
    const restartedAfterInput = createTimedImageQueueScheduler({
      repositories: afterInput.repositories,
      alarms: alarmsFixture.api,
      now: afterInput.clock,
      dispatch: async () => {
        dispatches += 1;
        return { status: "activated", at: afterInput.clock() };
      },
    });
    await restartedAfterInput.reconcileStartup();
    const uncertain =
      await afterInput.repositories.getTimedImageSubmissionQueue(
        afterInput.queue.queueId,
      );
    expect(uncertain?.state).toBe("blocked");
    expect(uncertain?.items[0]).toMatchObject({
      itemState: "blocked",
      providerOutcome: "unknown",
      dispatchIntent: { attemptId: "crashed-after-authorization" },
    });
    expect(dispatches).toBe(0);

    const second = await fixture();
    const scheduler2 = createTimedImageQueueScheduler({
      repositories: second.repositories,
      alarms: alarmsFixture.api,
      now: second.clock,
      dispatch: async ({ authorizeActivation }) => {
        await authorizeActivation();
        return { status: "activated", at: second.clock() };
      },
    });
    const durable = await scheduler2.start(second.queue.queueId);
    // Simulate a vanished reply by discarding the returned object and reading after reconnect.
    const reloaded = await second.repositories.getTimedImageSubmissionQueue(
      second.queue.queueId,
    );
    expect(durable.items[0]?.dispatchReceipt?.attemptId).toBe(
      reloaded?.items[0]?.dispatchReceipt?.attemptId,
    );
    expect(reloaded?.items[0]?.providerOutcome).toBe("unknown");
  });

  it("restart and resume pause on a changed or unavailable target", async () => {
    const { repositories, queue, clock } = await fixture();
    const currentSelected = await repositories.getSelectedTarget("Flow");
    await repositories.recordTargetVerification({
      ...currentSelected!.verificationBinding!,
      documentId: "doc-changed",
      verifiedAt: clock(),
    });
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      alarms: alarms().api,
      now: clock,
      verifyTargetForContinuation: async () => "selected_document_changed",
      dispatch: async () => ({ status: "activated", at: clock() }),
    });
    const sent = await scheduler.start(queue.queueId);
    const paused = await repositories.pauseTimedImageQueue({
      queueId: queue.queueId,
      expectedRevision: sent.revision,
      at: clock(),
    });
    const resumed = await scheduler.resume(queue.queueId, paused.revision);
    expect(resumed.state).toBe("paused");
    expect(resumed.pauseReason).toBe("selected_document_changed");
    expect(resumed.items[0]?.itemState).toBe("sent");
  });

  it("late duplicate alarms do not bypass pause or stop", async () => {
    const { repositories, queue, clock } = await fixture();
    let dispatches = 0;
    const scheduler = createTimedImageQueueScheduler({
      repositories,
      alarms: alarms().api,
      now: clock,
      dispatch: async () => {
        dispatches += 1;
        return { status: "activated", at: clock() };
      },
    });
    await scheduler.start(queue.queueId);
    const current = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    await scheduler.pause(queue.queueId, current!.revision);
    clock(500_000);
    await Promise.all([
      scheduler.onAlarm(`${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`),
      scheduler.onAlarm(`${IMAGE_QUEUE_ALARM_PREFIX}${queue.queueId}`),
    ]);
    expect(dispatches).toBe(1);
    const paused = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    expect(paused?.state).toBe("paused");
  });

  it("two independent schedulers racing an overdue Resume dispatch only once", async () => {
    const { repositories, queue, clock } = await fixture();
    const alarmApi = alarms().api;
    let dispatches = 0;
    const makeScheduler = () =>
      createTimedImageQueueScheduler({
        repositories,
        alarms: alarmApi,
        now: clock,
        verifyTargetForContinuation: async () => undefined,
        dispatch: async ({ authorizeActivation }) => {
          await authorizeActivation();
          dispatches += 1;
          return { status: "activated", at: clock() };
        },
      });
    const firstWorker = makeScheduler();
    await firstWorker.start(queue.queueId);
    let current = await repositories.getTimedImageSubmissionQueue(
      queue.queueId,
    );
    const paused = await firstWorker.pause(queue.queueId, current!.revision);
    clock(100_000);
    const secondWorker = makeScheduler();
    const results = await Promise.allSettled([
      firstWorker.resume(queue.queueId, paused.revision),
      secondWorker.resume(queue.queueId, paused.revision),
    ]);
    current = await repositories.getTimedImageSubmissionQueue(queue.queueId);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(dispatches).toBe(2);
    expect(
      current?.items.filter((item) => item.itemState === "sent"),
    ).toHaveLength(2);
    expect(
      current?.items.every((item) => item.providerOutcome === "unknown"),
    ).toBe(true);
  });
});
