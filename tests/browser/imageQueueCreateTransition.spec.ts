import { expect, test } from "@playwright/test";
import { importPromptBatch } from "../../src/domain/batches/importBatch";
import type { ImageSubmissionQueueRecord } from "../../src/domain/jobs/queue";
import { sha256Hex } from "../../src/storage/repositories";

const workspaceId = "default";
const project = {
  provider: "Flow" as const,
  tabId: 17,
  projectId: "project-17",
  canonicalTarget: "https://flow.google.com/project/project-17",
  selectionRevision: 7,
};

const oldSource = [8, 9]
  .map(
    (shotId) =>
      `${shotId}: ${JSON.stringify({ shot_id: String(shotId), scene_title: `Old shot ${shotId}` })}`,
  )
  .join("\n");
const newSource = [10, 11, 12, 13, 14]
  .map(
    (shotId) =>
      `${shotId}: ${JSON.stringify({ shot_id: String(shotId), scene_title: `New shot ${shotId}` })}`,
  )
  .join("\n");

async function batchSnapshot(sourceText: string, batchId: string) {
  const parsed = importPromptBatch(sourceText, "image");
  if (!parsed.ok)
    throw new Error(`Invalid fixture source: ${parsed.error.code}`);
  const items = await Promise.all(
    parsed.items.map(async (item, order) => ({
      id: `${batchId}:item:${order}`,
      batchId,
      workspaceId,
      kind: "image" as const,
      order,
      shotId: item.shotId,
      identitySource: item.identitySource,
      rawJsonBody: item.rawBody,
      sourceSpan: item.sourceSpan,
      measurement: item.measurement,
      contentHash: await sha256Hex(item.rawBody),
      createdAt: 100 + order,
    })),
  );
  return {
    batch: {
      id: batchId,
      workflowId: workspaceId,
      workspaceId,
      kind: "image" as const,
      status: "draft" as const,
      sourceText,
      sourceMode: parsed.mode,
      orderedItemIds: items.map((item) => item.id),
      total: parsed.total,
      updatedAt: 100,
    },
    items,
  };
}

async function queueFixture(
  sourceText: string,
  queueId: string,
  state: "sent" | "ready",
  declaration: ImageSubmissionQueueRecord["manualSettingsDeclaration"],
): Promise<ImageSubmissionQueueRecord> {
  const snapshot = await batchSnapshot(sourceText, `batch-${queueId}`);
  const receiptAt = 1_000;
  return {
    queueId,
    workspaceId,
    kind: "image",
    mode: "timed_submission",
    intervalMs: 40_000,
    state,
    sourceText,
    sourceHash: await sha256Hex(sourceText),
    sourceMode: snapshot.batch.sourceMode,
    selectedProject: project,
    manualSettingsDeclaration: declaration,
    items: snapshot.items.map((item, order) => ({
      queueItemId: `${queueId}:item:${order}`,
      sourceItemId: item.id,
      order,
      shotId: item.shotId,
      rawJsonBody: item.rawJsonBody,
      promptHash: item.contentHash,
      sourceSpan: item.sourceSpan,
      itemState: state === "sent" ? "sent" : "pending",
      providerOutcome: state === "sent" ? "unknown" : "not_started",
      ...(state === "sent"
        ? {
            dispatchReceipt: {
              attemptId: `${queueId}:receipt:${order}`,
              storedAt: receiptAt + order,
              evidence: "activation_pair_sent_or_uncertain" as const,
            },
          }
        : {}),
    })),
    lastDispatchReceiptStoredAt:
      state === "sent" ? receiptAt + snapshot.items.length - 1 : null,
    nextEligibleDispatchAt: null,
    createdAt: 1,
    updatedAt: receiptAt + snapshot.items.length,
    revision: 2,
  };
}

test("finished old queue stays historical while a new saved batch creates an idle distinct queue", async ({
  page,
}) => {
  const oldQueueId = "3018bddb-72f6-4823-bfcf-f690cb4206cd";
  const oldDeclaration = {
    confirmationId: "old-confirmation",
    confirmedAt: 1,
    tabId: project.tabId,
    projectId: project.projectId,
    canonicalTarget: project.canonicalTarget,
    declaredVariantCount: 2,
    userAttested: true as const,
  };
  const oldQueue = await queueFixture(
    oldSource,
    oldQueueId,
    "sent",
    oldDeclaration,
  );
  const newBatch = await batchSnapshot(newSource, "batch-new-shots-10-14");
  const newSourceHash = await sha256Hex(newSource);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.addInitScript(
    ({ oldQueue, newBatch, newSource, newSourceHash, project }) => {
      const queues = [oldQueue] as Record<string, unknown>[];
      const requests: Array<{
        type: string;
        payload: Record<string, unknown>;
      }> = [];
      Object.defineProperty(window, "__createTransitionQueues", {
        value: queues,
      });
      Object.defineProperty(window, "__createTransitionRequests", {
        value: requests,
      });
      const noEvent = {
        addListener: () => undefined,
        removeListener: () => undefined,
      };
      const reply = (
        request: {
          requestId: string;
          protocolVersion: number;
          buildId: string;
        },
        data: unknown,
      ) => ({
        ok: true,
        protocolVersion: request.protocolVersion,
        buildId: request.buildId,
        requestId: request.requestId,
        data,
      });
      Object.defineProperty(window.chrome, "runtime", {
        configurable: true,
        value: {
          onMessage: noEvent,
          sendMessage: async (request: {
            type: string;
            payload: Record<string, unknown>;
            requestId: string;
            protocolVersion: number;
            buildId: string;
          }) => {
            requests.push({ type: request.type, payload: request.payload });
            if (request.type === "imageQueue.list")
              return reply(request, [...queues]);
            if (request.type === "promptBatch.put")
              return reply(request, newBatch);
            if (request.type === "connections.getSelection")
              return reply(request, project);
            if (request.type === "imageQueue.createTimed") {
              const settingsConfirmation = request.payload
                .settingsConfirmation as Record<string, unknown>;
              const queueId = String(request.payload.queueId);
              const created = {
                queueId,
                workspaceId: "default",
                kind: "image",
                mode: "timed_submission",
                intervalMs: 40_000,
                state: "ready",
                sourceText: newSource,
                sourceHash: newSourceHash,
                sourceMode: newBatch.batch.sourceMode,
                selectedProject: project,
                manualSettingsDeclaration: {
                  ...settingsConfirmation,
                  userAttested: true,
                },
                items: newBatch.items.map((item, order) => ({
                  queueItemId: `${queueId}:item:${order}`,
                  sourceItemId: item.id,
                  order,
                  shotId: item.shotId,
                  rawJsonBody: item.rawJsonBody,
                  promptHash: item.contentHash,
                  sourceSpan: item.sourceSpan,
                  itemState: "pending",
                  providerOutcome: "not_started",
                })),
                lastDispatchReceiptStoredAt: null,
                nextEligibleDispatchAt: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                revision: 1,
              };
              queues.push(created);
              return reply(request, created);
            }
            return reply(request, null);
          },
        },
      });
      Object.defineProperty(window.chrome, "tabs", {
        configurable: true,
        value: { onRemoved: noEvent, onUpdated: noEvent },
      });
    },
    { oldQueue, newBatch, newSource, newSourceHash, project },
  );

  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await expect(page.getByText("Previous queue — 2/2 sent")).toBeVisible();

  const sourceInput = page.getByRole("textbox", {
    name: "Image prompt source",
  });
  await sourceInput.fill(newSource);
  await page.getByRole("button", { name: "Validate & Preview" }).click();
  await expect(
    page.getByRole("heading", { name: "5 validated prompts" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save validated batch" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Shot 10 · Shot 11 · Shot 12 · Shot 13 · Shot 14"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create timed queue" }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Confirm the manually selected Flow settings for this saved batch.",
    ),
  ).toBeVisible();

  await page
    .getByLabel("Number of Flow image variants manually selected")
    .fill("2");
  await page.locator("#image-settings-confirm").check();
  await expect(page.locator("#image-settings-confirm")).toBeChecked();
  const createButton = page.getByRole("button", { name: "Create timed queue" });
  await expect(createButton).toBeEnabled();
  await createButton.click();

  await expect(page.getByText("Queue for current saved batch")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
  await expect(page.getByText("Previous queue — 2/2 sent")).toBeVisible();
  await expect(page.getByText("Current saved image source")).toBeVisible();
  await expect(createButton).toBeDisabled();
  await expect(
    page.getByText("This exact saved source already belongs to a timed queue."),
  ).toBeVisible();

  const evidence = await page.evaluate(() => ({
    queues: (
      window as unknown as {
        __createTransitionQueues: Record<string, unknown>[];
      }
    ).__createTransitionQueues,
    requests: (
      window as unknown as {
        __createTransitionRequests: {
          type: string;
          payload: Record<string, unknown>;
        }[];
      }
    ).__createTransitionRequests,
  }));
  expect(evidence.queues).toHaveLength(2);
  expect(evidence.queues[0]).toMatchObject({
    queueId: oldQueueId,
    sourceText: oldSource,
    state: "sent",
  });
  expect(evidence.queues[1]).toMatchObject({
    sourceText: newSource,
    state: "ready",
    lastDispatchReceiptStoredAt: null,
    nextEligibleDispatchAt: null,
  });
  expect(
    (
      evidence.queues[1]!.items as Array<{ shotId?: string; itemState: string }>
    ).map((item) => [item.shotId, item.itemState]),
  ).toEqual([
    ["10", "pending"],
    ["11", "pending"],
    ["12", "pending"],
    ["13", "pending"],
    ["14", "pending"],
  ]);
  expect(
    evidence.requests.filter(
      (request) => request.type === "imageQueue.createTimed",
    ),
  ).toHaveLength(1);
  expect(
    evidence.requests.some((request) => request.type === "imageQueue.start"),
  ).toBe(false);
  expect(
    evidence.requests.some(
      (request) => request.type === "flow.image.generateOnce",
    ),
  ).toBe(false);
});
