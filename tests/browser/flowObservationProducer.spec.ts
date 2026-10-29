import { expect, test } from "@playwright/test";
import { flowImageObservationProducer } from "../../src/platforms/flow/observationProducer";
import { flowWorkspaceScopeAnalyzer } from "../../src/platforms/flow/workspaceScope";
import { flowImageRuntimeExpression } from "../../src/platforms/flow/images";
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
  await page.evaluate(
    ({ source }) => {
      const analyzer = (0, eval)(`(${source})`) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      return analyzer(
        "https://flow.google.com/project/synthetic-project",
        "synthetic-project",
        true,
      );
    },
    { source: flowWorkspaceScopeAnalyzer.toString() },
  );
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

test("shared workspace resolver records populated rendered baseline without identity claims", async ({
  page,
}) => {
  const fixture = await readFile(fixturePath, "utf8");
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  await page.goto("https://flow.google.com/project/synthetic-project");
  const source = flowWorkspaceScopeAnalyzer.toString();
  const analyze = () =>
    page.evaluate(
      async ({ source }) => {
        const analyzer = (0, eval)(`(${source})`) as (
          target?: string,
          projectId?: string,
        ) => Promise<{
          status: string;
          profile: string;
          candidateIds: string[];
          candidateMultiplicity: Array<{
            candidateId: string;
            renderedCopies: number;
          }>;
          repeatedCandidateCount: number;
          unrelatedImageCount: number;
          virtualized: boolean;
          loadingSignalCount: number;
          captureGaps: string[];
        }>;
        return analyzer(
          "https://flow.google.com/project/synthetic-project",
          "synthetic-project",
        );
      },
      { source },
    );
  await page.evaluate(() => {
    const project = document.querySelector("flow-project-page")!;
    const original = project.querySelector("flow-image-tile")!;
    project
      .querySelector("flow-tile-container")!
      .append(original.cloneNode(true));
    const unrelated = document.createElement("img");
    project.append(unrelated);
  });
  const populated = await analyze();
  expect(populated).toMatchObject({
    status: "ready",
    profile: "populated_tiles",
    repeatedCandidateCount: 1,
    unrelatedImageCount: 1,
    virtualized: true,
    captureGaps: [],
  });
  expect(
    populated.candidateMultiplicity.map((entry) => entry.renderedCopies).sort(),
  ).toEqual([1, 2]);
  expect(populated.candidateIds).toHaveLength(2);
  const discovery = await page.evaluate(async (expression) => {
    return (0, eval)(expression) as Promise<{
      observation: string;
      baseline?: {
        kind?: string;
        candidateIds?: string[];
        candidateMultiplicity?: Array<{ renderedCopies: number }>;
      };
    }>;
  }, flowImageRuntimeExpression("synthetic prompt text must not be returned"));
  expect(discovery.observation).toBe("ready");
  expect(discovery.baseline?.kind).toBe("flow_rendered_tile_candidates");
  expect(discovery.baseline?.candidateIds).toEqual(populated.candidateIds);
  expect(
    discovery.baseline?.candidateMultiplicity
      ?.map((entry) => entry.renderedCopies)
      .sort(),
  ).toEqual([1, 2]);
  await page.evaluate(() => {
    const loading = document.createElement("div");
    loading.setAttribute("data-state", "loading");
    loading.style.height = "2px";
    document.querySelector("flow-project-page")!.append(loading);
  });
  expect(await analyze()).toMatchObject({
    status: "workspace_busy",
    loadingSignalCount: 1,
  });
  await page.evaluate(() =>
    document
      .querySelector("flow-project-page")!
      .append(document.createElement("flow-project-page")),
  );
  expect(await analyze()).toMatchObject({ status: "project_ambiguous" });
});

test("shared workspace resolver distinguishes the supported empty marker and refuses a changed project route", async ({
  page,
}) => {
  const emptyFixture = `<!doctype html><style>flow-project-page,flow-base-prompt-box,flow-rich-text-editor{display:block}div[contenteditable]{height:20px}</style><flow-project-page><flow-base-prompt-box><flow-rich-text-editor><div contenteditable="true" role="textbox"></div></flow-rich-text-editor></flow-base-prompt-box><div style="height:10px">Start creating or drop media</div></flow-project-page>`;
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: emptyFixture,
    }),
  );
  await page.goto("https://flow.google.com/project/synthetic-project");
  const source = flowWorkspaceScopeAnalyzer.toString();
  const result = await page.evaluate(
    async ({ source }) => {
      const analyzer = (0, eval)(`(${source})`) as (
        target?: string,
        projectId?: string,
      ) => Promise<{ status: string; profile: string; candidateIds: string[] }>;
      return analyzer(
        "https://flow.google.com/project/synthetic-project",
        "synthetic-project",
      );
    },
    { source },
  );
  expect(result).toMatchObject({
    status: "ready",
    profile: "empty_marker",
    candidateIds: [],
  });
  const discovery = await page.evaluate(async (expression) => {
    return (0, eval)(expression) as Promise<{
      observation: string;
      baseline?: { kind?: string };
    }>;
  }, flowImageRuntimeExpression(""));
  expect(discovery).toMatchObject({
    observation: "ready",
    baseline: { kind: "flow_empty_workspace_ui" },
  });
  const changed = await page.evaluate(
    async ({ source }) => {
      history.pushState({}, "", "/project/other-project");
      const analyzer = (0, eval)(`(${source})`) as (
        target?: string,
        projectId?: string,
      ) => Promise<{ status: string }>;
      return analyzer(
        "https://flow.google.com/project/synthetic-project",
        "synthetic-project",
      );
    },
    { source },
  );
  expect(changed.status).toBe("not_flow_route");
});

test("production observer refuses an ambiguous project/composer context without emitting evidence", async ({
  page,
}) => {
  const fixture = await readFile(fixturePath, "utf8");
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  await page.goto("https://flow.google.com/project/synthetic-project");
  await page.evaluate(
    ({ source }) => {
      const analyzer = (0, eval)(`(${source})`) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      return analyzer(
        "https://flow.google.com/project/synthetic-project",
        "synthetic-project",
        true,
      );
    },
    { source: flowWorkspaceScopeAnalyzer.toString() },
  );
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
  await page.evaluate(
    ({ source }) => {
      const analyzer = (0, eval)(`(${source})`) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      return analyzer(
        "https://flow.google.com/project/synthetic-project",
        "synthetic-project",
        true,
      );
    },
    { source: flowWorkspaceScopeAnalyzer.toString() },
  );
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
      let digestCalls = 0;
      Object.defineProperty(subtle, "digest", {
        configurable: true,
        value: async (...args: Parameters<SubtleCrypto["digest"]>) => {
          const result = await digest(...args);
          digestCalls += 1;
          if (digestCalls === 3) {
            document
              .querySelector("flow-image-tile")
              ?.querySelector("img")
              ?.setAttribute("data-media-id", "recycled-candidate");
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
