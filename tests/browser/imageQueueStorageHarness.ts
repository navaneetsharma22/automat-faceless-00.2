import {
  ExtensionRepositories,
  createDexieRepositoryDatabase,
} from "../../src/storage/repositories";
import { AutomatDatabase } from "../../src/storage/db";

export async function persistTimedQueueReadback() {
  const databaseName = `image-queue-${crypto.randomUUID()}`;
  let database = new AutomatDatabase(databaseName);
  await database.open();
  try {
    const repositories = new ExtensionRepositories(
      createDexieRepositoryDatabase(database),
      () => 700,
    );
    const source =
      '4: {"shot_id":"04","text":"first  \\n prompt"}\n9. {"shot_id":"09","text":"second"}';
    await repositories.savePromptBatch({
      workspaceId: "dexie-workspace",
      kind: "image",
      sourceText: source,
    });
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: 29,
      canonicalTarget: "https://flow.google.com/project/dexie-project",
    });
    const record = await repositories.createTimedImageSubmissionQueue({
      workspaceId: "dexie-workspace",
      queueId: crypto.randomUUID(),
      settingsConfirmation: {
        confirmationId: "ed3c6967-fab3-49a3-9f29-4fcad099f53a",
        confirmedAt: 600,
        tabId: 29,
        projectId: "dexie-project",
        canonicalTarget: "https://flow.google.com/project/dexie-project",
        declaredVariantCount: 4,
      },
    });
    const readback = await repositories.getTimedImageSubmissionQueue(
      record.queueId,
    );
    const retired = await repositories.stopTimedImageQueue({
      queueId: record.queueId,
      expectedRevision: record.revision,
      at: 800,
    });
    database.close();
    database = new AutomatDatabase(databaseName);
    await database.open();
    const reopenedRepositories = new ExtensionRepositories(
      createDexieRepositoryDatabase(database),
      () => 900,
    );
    const reopened = await reopenedRepositories.getTimedImageSubmissionQueue(
      record.queueId,
    );
    let stoppedQueueRejectedFromStart = false;
    try {
      await reopenedRepositories.validateTimedImageQueueStart(record.queueId);
    } catch {
      stoppedQueueRejectedFromStart = true;
    }
    return {
      recordEqualsReadback: JSON.stringify(record) === JSON.stringify(readback),
      exactSource: readback?.sourceText === source,
      exactBodies: readback?.items.map((item) => item.rawJsonBody),
      orderedShotIds: readback?.items.map((item) => item.shotId),
      mode: readback?.mode,
      intervalMs: readback?.intervalMs,
      initialState: readback?.state,
      outcomeStates: readback?.items.map((item) => item.providerOutcome),
      noDeadlineBeforeDispatch: readback?.nextEligibleDispatchAt === null,
      stoppedRevisionReadAfterReopen:
        reopened?.state === "stopped" &&
        reopened.revision === retired.revision &&
        reopened.items.every((item) => item.itemState === "stopped"),
      stoppedQueueRejectedFromStart,
    };
  } finally {
    database.close();
    await database.delete();
  }
}

declare global {
  interface Window {
    __ImageQueueStorageFixture: {
      persistTimedQueueReadback: typeof persistTimedQueueReadback;
    };
  }
}

window.__ImageQueueStorageFixture = { persistTimedQueueReadback };
