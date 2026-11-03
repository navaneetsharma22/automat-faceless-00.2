import { expect, test } from "@playwright/test";
import { importPromptBatch } from "../../src/domain/batches/importBatch";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";

const target = {
  provider: "Vids" as const,
  tabId: 73,
  canonicalTarget: "https://docs.google.com/videos/d/congo-project/edit",
  verification: "verified" as const,
  connectionState: "verified" as const,
  updatedAt: 100,
  verificationBinding: {
    provider: "Vids" as const,
    tabId: 73,
    canonicalTarget: "https://docs.google.com/videos/d/congo-project/edit",
    projectId: "congo-project",
    frameId: 0,
    documentId: "congo-document",
    documentToken: "congo-token",
    extensionBuildId: "pending-build",
    extensionProtocolVersion: 1,
    connectorBuildId: "pending-build",
    connectorProtocolVersion: 1,
    capability: "read-only-connection-v1",
    verifiedAt: 100,
  },
};
const imageSource = Array.from({ length: 5 }, (_, i) => `${String(i + 1).padStart(2, "0")}: ${JSON.stringify({ shot_id: String(i + 1).padStart(2, "0"), scene: `Congo image ${i + 1}` })}`).join("\n\n");
const volcanoSource = Array.from({ length: 5 }, (_, i) => `${String(i + 1).padStart(2, "0")}: ${JSON.stringify({ shot_id: String(i + 1).padStart(2, "0"), prompt_type: "video", scene: `Volcano prompt ${i + 1}` })}`).join("\n\n");
const congoSource = Array.from({ length: 5 }, (_, i) => `${String(i + 1).padStart(2, "0")}: ${JSON.stringify({ shot_id: String(i + 1).padStart(2, "0"), prompt_type: "video", scene: `Congo prompt ${i + 1}` })}`).join("\n\n");

async function promptSnapshot(sourceText: string, kind: "image" | "video", id: string) {
  const parsed = importPromptBatch(sourceText, kind);
  if (!parsed.ok) throw new Error(parsed.error.code);
  const items = await Promise.all(parsed.items.map(async (item, order) => ({
    id: `${id}:item:${order}`, batchId: id, workspaceId: "default", kind,
    order, shotId: item.shotId, identitySource: item.identitySource,
    rawJsonBody: item.rawBody, sourceSpan: item.sourceSpan,
    measurement: item.measurement, contentHash: await sha256Hex(item.rawBody), createdAt: 100 + order,
  })));
  return { batch: { id, workflowId: "default", workspaceId: "default", kind, status: "draft" as const, sourceText, sourceMode: parsed.mode, orderedItemIds: items.map((item) => item.id), total: parsed.total, updatedAt: 100 }, items };
}

async function prepared(sourceText: string, videoSourceHash: string, imageBatch: Awaited<ReturnType<typeof promptSnapshot>>, refs: Array<Record<string, unknown>>) {
  const snapshot = await promptSnapshot(sourceText, "video", `video-${videoSourceHash.slice(0, 8)}`);
  const imageHash = await sha256Hex(imageBatch.batch.sourceText);
  const parsed = importPromptBatch(sourceText, "video");
  if (!parsed.ok) throw new Error(parsed.error.code);
  return {
    id: `prepared:default:${videoSourceHash.slice(0, 32)}`, requestId: "10000000-0000-4000-8000-000000000001", workspaceId: "default", preparedAt: 100,
    videoBatchId: snapshot.batch.id, videoSourceHash, videoSourceText: sourceText, imageSourceBatchId: imageBatch.batch.id, imageSourceBatchHash: imageHash, destination: "Vids",
    target: { provider: "Vids", tabId: target.tabId, canonicalTarget: target.canonicalTarget, projectId: "congo-project", documentId: "congo-document", verification: "verified", verifiedAt: 100 },
    manualSettingsDeclaration: { confirmationId: "settings-confirmation", confirmedAt: 100, destination: "Vids", declaredDurationSeconds: 8, tabId: target.tabId, canonicalTarget: target.canonicalTarget, projectId: "congo-project", documentId: "congo-document" },
    status: "prepared", itemCount: 5, createdAt: 100, updatedAt: 100,
    items: await Promise.all(parsed.items.map(async (item, order) => {
      const ref = refs[order]!;
      return { itemId: snapshot.items[order]!.id, order, shotId: item.shotId, canonicalShotId: String(order + 1), rawJsonBody: item.rawBody, contentHash: await sha256Hex(item.rawBody), sourceSpan: item.sourceSpan, reference: { referenceId: ref.referenceId, assignmentVersion: 1, sha256: ref.sha256, mimeType: "image/png", byteSize: 68, width: 1, height: 1, capturedAt: 100 } };
    })),
  };
}

type PreparedFixture = Awaited<ReturnType<typeof prepared>>;
type QueueItemFixture = { itemId: string; order: number; shotId: string; referenceId: string; referenceSha256: string; promptHash: string; state: string; attemptId?: string; dispatchReceipt?: { attemptId: string; storedAt: number } };
type QueueFixture = { queueId: string; preparedBatchId: string; state: string; items: QueueItemFixture[]; revision: number; createdAt: number; updatedAt: number; lastDispatchAt: number | null; cooldownDeadlineAt: number | null; readinessDeadlineAt: number | null; readinessStartedAt: number | null; nextActionAt: number | null; runId: string };
type FixtureRequest = { type: string; payload: Record<string, unknown>; requestId: string; protocolVersion: number; buildId: string };
type FixtureState = { videoSource?: string; prepared: Record<string, PreparedFixture>; latestId?: string; queues: Record<string, QueueFixture>; requests: Array<{ type: string; payload: Record<string, unknown> }>; starts: Array<Record<string, unknown>> };
type FixtureWindow = Window & { __vidsBatchIdentityRead: () => FixtureState };

test("normal Videos preparation opens a fresh Congo queue, keeps Volcano history, and reopens Congo idempotently after reload", async ({ page }) => {
  const image = await promptSnapshot(imageSource, "image", "congo-image-source");
  const imageHash = await sha256Hex(imageSource);
  const refs = Array.from({ length: 5 }, (_, i) => ({
    assignmentId: `default:ref:${i + 1}`, referenceId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    captureOperationId: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, workspaceId: "default", batchId: image.batch.id,
    batchSourceHash: imageHash, shotId: String(i + 1), promptHash: "b".repeat(64), selectionVersion: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    assignmentVersion: 1, flowProjectId: "image-project", tabId: 73, canonicalTarget: target.canonicalTarget, documentId: "congo-document",
    providerAssetId: `asset-${i + 1}`, observedSourceSha256: String(i + 1).repeat(64), mimeType: "image/png", byteSize: 68, sha256: String(i + 1).repeat(64), width: 1, height: 1, capturedAt: 100,
    acquisitionProvenance: "verified_flow_document_same_origin_fetch", qualityProvenance: "observed_resource_original_bytes_no_upscale",
  }));
  const volcanoHash = await sha256Hex(volcanoSource);
  const congoHash = await sha256Hex(congoSource);
  const volcano = await prepared(volcanoSource, volcanoHash, image, refs);
  const congo = await prepared(congoSource, congoHash, image, refs);
  const volcanoVideo = await promptSnapshot(volcanoSource, "video", "volcano-video-source");
  const congoVideo = await promptSnapshot(congoSource, "video", "congo-video-source");
  const referencePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg==";
  await page.addInitScript(({ image, refs, target, volcano, congo, volcanoVideo, congoVideo, volcanoSource, congoSource, volcanoHash, congoHash, referencePng }) => {
    const storeKey = "vids-batch-identity-fixture";
    type State = FixtureState;
    const read = (): State => JSON.parse(localStorage.getItem(storeKey) ?? JSON.stringify({ prepared: {}, queues: {}, requests: [], starts: [] }));
    const write = (state: State) => localStorage.setItem(storeKey, JSON.stringify(state));
    const noEvent = { addListener: () => undefined, removeListener: () => undefined };
    const respond = (request: FixtureRequest, data: unknown) => ({ ok: true, protocolVersion: request.protocolVersion, buildId: request.buildId, requestId: request.requestId, data });
    const runtime = {
      onMessage: noEvent,
      sendMessage: async (request: FixtureRequest) => {
        const state = read();
        state.requests.push({ type: request.type, payload: request.payload });
        let data: unknown = null;
        if (request.type === "connections.getSelection") {
          target.verificationBinding.extensionBuildId = request.buildId;
          target.verificationBinding.connectorBuildId = request.buildId;
          target.verificationBinding.extensionProtocolVersion = request.protocolVersion;
          target.verificationBinding.connectorProtocolVersion = 1;
          data = request.payload.provider === "Vids" ? target : null;
        }
        if (request.type === "videoBatch.getPrepared") data = state.latestId ? state.prepared[state.latestId] : null;
        if (request.type === "promptBatch.get" && request.payload.kind === "image") data = image;
        if (request.type === "promptBatch.get" && request.payload.kind === "video") {
          const source = state.videoSource ?? volcanoSource;
          data = source === congoSource ? congoVideo : volcanoVideo;
        }
        if (request.type === "promptBatch.put") {
          state.videoSource = String(request.payload.sourceText);
          data = state.videoSource === congoSource ? congoVideo : volcanoVideo;
        }
        if (request.type === "flow.reference.getState") data = { savedReferences: refs };
        if (request.type === "flow.reference.getSavedReference") data = { data: referencePng, reference: refs.find((ref) => ref.referenceId === request.payload.referenceId) };
        if (request.type === "videoBatch.prepare") {
          const template = request.payload.expectedVideoSourceHash === congoHash ? congo : volcano;
          const existing = Object.values(state.prepared).find((batch) => batch.requestId === request.payload.requestId);
          const batch = existing ?? { ...template, requestId: String(request.payload.requestId), id: `prepared:default:${String(request.payload.requestId)}` };
          state.prepared[batch.id] = batch;
          state.latestId = batch.id;
          data = batch;
        }
        if (request.type === "vids.videoQueue.get") data = state.queues[request.payload.preparedBatchId] ?? null;
        if (request.type === "vids.videoQueue.start") {
          const batch = state.prepared[request.payload.preparedBatchId];
          if (batch) {
            state.starts.push({ preparedBatchId: batch.id, prompt: batch.items[0].rawJsonBody, promptHash: batch.items[0].contentHash, referenceId: batch.items[0].reference.referenceId, referenceSha256: batch.items[0].reference.sha256 });
            const isVolcano = batch.videoSourceHash === volcanoHash;
            const items: QueueItemFixture[] = batch.items.map((item, order) => ({ itemId: item.itemId, order, shotId: item.canonicalShotId, referenceId: item.reference.referenceId, referenceSha256: item.reference.sha256, promptHash: item.contentHash, state: isVolcano ? "sent" : order === 0 ? "sent" : "pending", ...(isVolcano || order === 0 ? { attemptId: `attempt-${batch.id}-${order}`, dispatchReceipt: { attemptId: `attempt-${batch.id}-${order}`, storedAt: 1000 + order } } : {}) }));
            data = { queueId: `vids-video:${batch.id}`, preparedBatchId: batch.id, state: isVolcano ? "all_sent" : "cooldown", items, revision: 1, createdAt: 1, updatedAt: 1000, lastDispatchAt: 1000, cooldownDeadlineAt: 51000, readinessDeadlineAt: null, readinessStartedAt: null, nextActionAt: isVolcano ? null : 51000, runId: `run-${batch.id}` };
            state.queues[batch.id] = data;
          }
        }
        if (request.type === "vids.video.getAttachmentStatus") data = { status: "not_started" };
        write(state);
        return respond(request, data);
      },
    };
    Object.defineProperty(window.chrome, "runtime", { configurable: true, value: runtime });
    Object.defineProperty(window.chrome, "tabs", { configurable: true, value: { onRemoved: noEvent, onUpdated: noEvent } });
    Object.defineProperty(window.chrome, "windows", { configurable: true, value: {} });
    Object.defineProperty(window, "__vidsBatchIdentityRead", { value: read });
  }, { image, refs, target, volcano, congo, volcanoVideo, congoVideo, volcanoSource, congoSource, volcanoHash, congoHash, referencePng });

  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Videos" }).click();
  await page.locator("#video-import-source").fill(volcanoSource);
  await page.getByRole("button", { name: "Validate & Preview" }).click();
  await page.getByRole("button", { name: "Save validated batch" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pair with this Image Source" }).click();
  await page.getByRole("radio", { name: /Vids/ }).check();
  await expect(page.getByText("Verified connection", { exact: true })).toBeVisible();
  await page.locator("#video-settings-confirm").check({ timeout: 3000 });
  await page.getByRole("button", { name: "Prepare video batch" }).click({ timeout: 3000 });
  const volcanoReview = page.getByRole("region", { name: "Google Vids timed submission queue" });
  await expect(volcanoReview.getByRole("button", { name: "Start Vids queue" })).toBeVisible();
  await page.getByRole("button", { name: "Start Vids queue" }).click();
  await expect(volcanoReview.getByRole("heading", { name: "All 5 image–prompt pairs sent to Google Vids" })).toBeVisible();
  const volcanoId = await page.evaluate(() => (window as unknown as FixtureWindow).__vidsBatchIdentityRead().latestId!);

  await page.locator("#video-import-source").fill(congoSource);
  await page.getByRole("button", { name: "Validate & Preview" }).click();
  await page.getByRole("button", { name: "Save validated batch" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.locator("#video-settings-confirm").check();
  await page.getByRole("button", { name: "Start new batch" }).click();
  const congoReview = page.getByRole("region", { name: "Google Vids timed submission queue" });
  await expect(congoReview.getByText("0 of 5 prompts sent")).toBeVisible();
  await expect(congoReview.getByText("Ready", { exact: true })).toBeVisible();
  await expect(congoReview.getByRole("button", { name: "Start Vids queue" })).toBeVisible();
  const congoId = await page.evaluate(() => {
    const state = (window as unknown as FixtureWindow).__vidsBatchIdentityRead();
    return state.latestId as string;
  });
  expect(congoId).not.toBe(volcano.id);
  await page.getByRole("button", { name: "Start new batch" }).click();
  await expect(congoReview.getByText("0 of 5 prompts sent")).toBeVisible();
  expect(await page.evaluate(() => Object.keys((window as unknown as FixtureWindow).__vidsBatchIdentityRead().prepared).length)).toBe(2);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Videos" }).click();
  const reloadedReview = page.getByRole("region", { name: "Google Vids timed submission queue" });
  await expect(reloadedReview.getByText("0 of 5 prompts sent")).toBeVisible();
  await expect(reloadedReview.getByText("Ready", { exact: true })).toBeVisible();
  await expect(reloadedReview.getByRole("button", { name: "Start Vids queue" })).toBeVisible();
  await reloadedReview.getByRole("button", { name: "Start Vids queue" }).click();
  const evidence = await page.evaluate(() => (window as unknown as FixtureWindow).__vidsBatchIdentityRead());
  expect(evidence.queues[volcanoId]!.items.every((item) => item.state === "sent" && item.dispatchReceipt)).toBe(true);
  expect(evidence.starts.at(-1)).toMatchObject({ preparedBatchId: congoId, prompt: congo.items[0]!.rawJsonBody, promptHash: congo.items[0]!.contentHash, referenceId: congo.items[0]!.reference.referenceId, referenceSha256: congo.items[0]!.reference.sha256 });
  expect(evidence.queues[congoId]!.items.slice(1).every((item) => item.state === "pending")).toBe(true);
});
