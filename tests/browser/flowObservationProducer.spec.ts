import { expect, test } from "@playwright/test";
import { flowImageObservationProducer } from "../../src/platforms/flow/observationProducer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/flow/image-lifecycle-recorder.synthetic.html",
);

test("production isolated-world producer binds, records structural candidates, and loses conservatively", async ({
  page,
}) => {
  const fixture = await readFile(fixturePath, "utf8");
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  await page.goto("https://flow.google.com/project/synthetic-project");
  const binding = {
    workspaceId: "default",
    batchId: "import:default:image",
    itemId: "item-1",
    sourceHash: "a".repeat(64),
    sourceSnapshotId: "flow-image-source:item-1:" + "a".repeat(64),
    sourceBaselineFingerprint: "b".repeat(64),
    attemptId: "attempt-fixture",
    provider: "Flow",
    projectId: "synthetic-project",
    canonicalTarget: "https://flow.google.com/project/synthetic-project",
    tabId: 41,
    frameId: "frame-fixture",
    loaderId: "loader-fixture",
    documentId: "document-fixture",
    senderFrameId: 0,
    sessionId: "d7a5ea61-9721-4a65-8485-798f2f4e0c11",
    startedAt: Date.now(),
    deadlineAt: Date.now() + 30_000,
    maxEvents: 12,
    buildId: "fixture-build",
    protocolVersion: 4,
  };
  const arm = await page.evaluate(
    ({ source, binding }) => {
      const scope = window as Window & {
        chrome?: {
          runtime: { sendMessage: (message: unknown) => Promise<unknown> };
        };
        __producerMessages?: Array<Record<string, unknown>>;
      };
      scope.__producerMessages = [];
      scope.chrome = {
        runtime: {
          sendMessage: async (message) => {
            scope.__producerMessages!.push(message as Record<string, unknown>);
            return {
              ok: true,
              data: { accepted: true, duplicate: false, outcome: "unknown" },
            };
          },
        },
      };
      const producer = (0, eval)(`(${source})`) as (
        binding: typeof binding,
        command: string,
      ) => Promise<unknown>;
      return producer(binding, "arm");
    },
    { source: flowImageObservationProducer.toString(), binding },
  );
  expect(arm).toMatchObject({
    status: "armed",
    attemptId: binding.attemptId,
    sessionId: binding.sessionId,
    documentId: binding.documentId,
    sourceBaselineFingerprint: binding.sourceBaselineFingerprint,
    listenerRoots: expect.any(Number),
    captureFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
  });

  const activated = await page.evaluate(
    async ({ source, binding }) => {
      const producer = (0, eval)(`(${source})`) as (
        binding: typeof binding,
        command: string,
      ) => Promise<unknown>;
      return producer(binding, "activate");
    },
    { source: flowImageObservationProducer.toString(), binding },
  );
  expect(activated).toMatchObject({ status: "active", sequence: 1 });

  await page.evaluate(() => {
    const tile = document.createElement("flow-image-tile");
    tile.setAttribute("data-generation-group-id", "fixture-private-group-id");
    const marker = document.createElement("div");
    marker.setAttribute("data-state", "loading");
    const image = document.createElement("img");
    image.setAttribute("data-media-id", "fixture-private-media-id");
    tile.append(marker, image);
    document.querySelector("flow-tile-container")?.append(tile);
    image.dispatchEvent(new Event("load"));
  });
  await page.waitForFunction(() => {
    const messages = (
      window as Window & {
        __producerMessages?: Array<{ observation?: { sequence?: number } }>;
      }
    ).__producerMessages;
    return messages?.some(
      (message) => (message.observation?.sequence ?? 0) >= 2,
    );
  });
  const observed = await page.evaluate(
    () =>
      (
        window as Window & {
          __producerMessages: Array<{
            observation: {
              kind: string;
              snapshot: {
                mediaCandidates: Array<{
                  candidateId: string;
                  tileToken: string;
                }>;
                identityCandidates: Array<{
                  attributeName: string;
                  category: string;
                  candidateId: string;
                  carrierRelation: string;
                }>;
                resourceEvents: Array<{
                  type: string;
                  tileToken: string | null;
                }>;
                lifecycleSignals: Array<{
                  markerKind: string;
                  markerTag: string;
                  scope: string;
                  tileToken: string | null;
                  evidence: Array<{ attributeName: string; signal: string }>;
                }>;
              };
              results?: unknown;
            };
          }>;
        }
      ).__producerMessages,
  );
  const snapshots = observed.map((message) => message.observation);
  expect(snapshots[0]?.kind).toBe("structural_snapshot");
  const changed = snapshots.find(
    (event) => event.snapshot.mediaCandidates.length >= 3,
  );
  expect(changed).toBeDefined();
  expect(changed?.snapshot.lifecycleSignals).toContainEqual(
    expect.objectContaining({
      markerKind: "loading",
      markerTag: "div",
      scope: "tile",
      evidence: [{ attributeName: "data-state", signal: "loading" }],
    }),
  );
  expect(changed?.snapshot.identityCandidates).toContainEqual(
    expect.objectContaining({
      attributeName: "data-generation-group-id",
      category: "provider_group_identity_candidate_unverified",
      carrierRelation: "tile",
      candidateId: expect.stringMatching(/^[0-9a-f]{64}$/),
    }),
  );
  expect(changed?.snapshot.resourceEvents).toContainEqual(
    expect.objectContaining({ type: "load", tileToken: expect.any(String) }),
  );
  expect(JSON.stringify(changed)).not.toContain("fixture-private-media-id");
  expect(JSON.stringify(changed)).not.toContain("fixture-private-group-id");
  expect(changed).not.toHaveProperty("results");

  await page.evaluate(() =>
    history.pushState({}, "", "/project/another-project"),
  );
  await page.waitForFunction(() => {
    const messages = (
      window as Window & {
        __producerMessages?: Array<{ observation?: { kind?: string } }>;
      }
    ).__producerMessages;
    return messages?.some(
      (message) => message.observation?.kind === "observer_lost",
    );
  });
  const loss = await page.evaluate(
    () =>
      (
        window as Window & {
          __producerMessages: Array<{
            observation: { kind: string; snapshot: { captureGaps: string[] } };
          }>;
        }
      ).__producerMessages.find(
        (message) => message.observation.kind === "observer_lost",
      )?.observation,
  );
  expect(loss?.snapshot.captureGaps).toContain("project_binding_changed");
});

test("production observer refuses an ambiguous project/composer context without emitting evidence", async ({
  page,
}) => {
  const fixture = await readFile(fixturePath, "utf8");
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  await page.goto("https://flow.google.com/project/synthetic-project");
  const binding = {
    workspaceId: "default",
    batchId: "import:default:image",
    itemId: "item-1",
    sourceHash: "a".repeat(64),
    sourceSnapshotId: "flow-image-source:item-1:" + "a".repeat(64),
    sourceBaselineFingerprint: "b".repeat(64),
    attemptId: "attempt-fixture",
    provider: "Flow",
    projectId: "wrong-project",
    canonicalTarget: "https://flow.google.com/project/wrong-project",
    tabId: 41,
    frameId: "frame-fixture",
    loaderId: "loader-fixture",
    documentId: "document-fixture",
    senderFrameId: 0,
    sessionId: "d7a5ea61-9721-4a65-8485-798f2f4e0c11",
    startedAt: Date.now(),
    deadlineAt: Date.now() + 30_000,
    maxEvents: 12,
    buildId: "fixture-build",
    protocolVersion: 4,
  };
  const result = await page.evaluate(
    ({ source, binding }) => {
      (window as Window & { chrome?: unknown }).chrome = {
        runtime: {
          sendMessage: async () => ({ ok: true, data: { accepted: true } }),
        },
      };
      const producer = (0, eval)(`(${source})`) as (
        binding: typeof binding,
        command: string,
      ) => Promise<unknown>;
      return producer(binding, "arm");
    },
    { source: flowImageObservationProducer.toString(), binding },
  );
  expect(result).toMatchObject({
    status: "scope_refused",
    reason: "project_changed",
  });
});

test("production observer refuses a baseline that mutates while listeners are arming", async ({
  page,
}) => {
  const fixture = await readFile(fixturePath, "utf8");
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  await page.goto("https://flow.google.com/project/synthetic-project");
  const binding = {
    workspaceId: "default",
    batchId: "import:default:image",
    itemId: "item-1",
    sourceHash: "a".repeat(64),
    sourceSnapshotId: "flow-image-source:item-1:" + "a".repeat(64),
    sourceBaselineFingerprint: "b".repeat(64),
    attemptId: "attempt-fixture",
    provider: "Flow",
    projectId: "synthetic-project",
    canonicalTarget: "https://flow.google.com/project/synthetic-project",
    tabId: 41,
    frameId: "frame-fixture",
    loaderId: "loader-fixture",
    documentId: "document-fixture",
    senderFrameId: 0,
    sessionId: "d7a5ea61-9721-4a65-8485-798f2f4e0c11",
    startedAt: Date.now(),
    deadlineAt: Date.now() + 30_000,
    maxEvents: 12,
    buildId: "fixture-build",
    protocolVersion: 4,
  };
  const result = await page.evaluate(
    async ({ source, binding }) => {
      const scope = window as Window & {
        chrome?: unknown;
        __producerMessages?: unknown[];
      };
      scope.__producerMessages = [];
      scope.chrome = {
        runtime: {
          sendMessage: async (message: unknown) => {
            scope.__producerMessages!.push(message);
            return { ok: true, data: { accepted: true } };
          },
        },
      };
      const subtle = crypto.subtle;
      const digest = subtle.digest.bind(subtle);
      let mutated = false;
      Object.defineProperty(subtle, "digest", {
        configurable: true,
        value: async (...args: Parameters<SubtleCrypto["digest"]>) => {
          const result = await digest(...args);
          if (!mutated) {
            mutated = true;
            document
              .querySelector("flow-image-tile")
              ?.setAttribute("data-state", "loading");
          }
          return result;
        },
      });
      const producer = (0, eval)(`(${source})`) as (
        binding: Record<string, unknown>,
        command: string,
      ) => Promise<unknown>;
      const response = await producer(binding, "arm");
      return {
        response,
        messages: scope.__producerMessages,
      };
    },
    { source: flowImageObservationProducer.toString(), binding },
  );
  expect(result.response).toMatchObject({
    status: "arm_refused",
    reason: "baseline_changed_during_arm",
  });
  expect(result.messages).toEqual([]);
});
