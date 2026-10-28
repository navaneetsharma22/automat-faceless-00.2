import { describe, expect, it, vi } from "vitest";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { createFoundationClient } from "../../src/shared/messageClient";
import { makeRequest } from "../../src/shared/messages";
import type { AppRequest, AppResponse } from "../../src/shared/schemas";
import {
  ChromePreferenceRepository,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import { syntheticPromptBodies } from "../fixtures/syntheticPromptBodies";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";

const extensionId = "foundation-test-extension";
const dashboardSender = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/index.html`,
};

function createHarness() {
  const repositories = new ExtensionRepositories(
    createMemoryRepositoryDatabase(),
    () => 1234,
  );
  const values: Record<string, unknown> = { theme: "light" };
  const preferences = new ChromePreferenceRepository({
    get: async (key) => (key in values ? { [key]: values[key] } : {}),
    set: async (items) => Object.assign(values, items),
  });
  const listener = createConnectionMessageListener(extensionId, {
    repositories,
    preferences,
  });
  const transport = {
    sendMessage: (request: AppRequest) =>
      new Promise<unknown>((resolve) => {
        // Mirror Chrome's JSON-serializable message envelope; rawText remains an opaque string.
        const wireRequest = JSON.parse(JSON.stringify(request)) as AppRequest;
        listener(wireRequest, dashboardSender, (response) =>
          resolve(JSON.parse(JSON.stringify(response)) as AppResponse),
        );
      }),
  };
  return { repositories, preferences, listener, transport };
}

describe("extension message protocol", () => {
  it("correlates concurrent asynchronous responses by request ID", async () => {
    const { repositories, transport } = createHarness();
    vi.spyOn(repositories, "savePromptDraft").mockImplementation(
      async (input) => {
        await new Promise((resolve) =>
          setTimeout(resolve, input.id === "slower" ? 12 : 1),
        );
        return { ...input, updatedAt: 1234 };
      },
    );
    let nextId = 0;
    const pending: string[] = [];
    const client = createFoundationClient(transport, {
      makeRequestId: () => `request-${++nextId}`,
      onPending: (id) => pending.push(id),
    });
    const sendMessage = transport.sendMessage;
    vi.spyOn(transport, "sendMessage").mockImplementation((request) => {
      expect(pending).toHaveLength(nextId);
      return sendMessage(request);
    });

    const [slower, faster] = await Promise.all([
      client.request("promptDraft.put", {
        id: "slower",
        kind: "image",
        rawText: "raw a",
      }),
      client.request("promptDraft.put", {
        id: "faster",
        kind: "video",
        rawText: "raw b",
      }),
    ]);

    expect(slower).toMatchObject({ id: "slower", characterCount: 5 });
    expect(faster).toMatchObject({ id: "faster", characterCount: 5 });
    expect(pending).toEqual(["request-1", "request-2"]);
  });

  it("returns explicit failures for malformed requests and unauthorized contexts", () => {
    const { listener } = createHarness();
    const responses: AppResponse[] = [];

    listener({ type: "unknown" }, dashboardSender, (response) =>
      responses.push(response),
    );
    listener(
      makeRequest("foundation.ping", {}, "bad-sender"),
      { id: extensionId, url: "https://vids.google.com/video/1" },
      (response) => responses.push(response),
    );

    expect(responses.map((response) => response.ok && response.data)).toEqual([
      false,
      false,
    ]);
    expect(responses[0]).toMatchObject({
      ok: false,
      error: { category: "invalid_request" },
    });
    expect(responses[1]).toMatchObject({
      ok: false,
      error: { category: "unauthorized_sender" },
    });
  });

  it("rejects protocol and build mismatches before dispatch", () => {
    const { listener } = createHarness();
    const responses: AppResponse[] = [];
    const current = makeRequest("foundation.ping", {}, "req");

    listener(
      { ...current, protocolVersion: PROTOCOL_VERSION + 1 },
      dashboardSender,
      (response) => responses.push(response),
    );
    listener(
      { ...current, requestId: "old-build", buildId: "old-build" },
      dashboardSender,
      (response) => responses.push(response),
    );

    expect(responses).toMatchObject([
      { ok: false, error: { category: "protocol_mismatch" } },
      { ok: false, error: { category: "build_mismatch" } },
    ]);
    expect(BUILD_ID).toMatch(/^automat-faceless-0\.1\.0-/);
  });

  it("reports missing drafts and repository failures as separate categories", async () => {
    const { repositories, transport } = createHarness();
    const client = createFoundationClient(transport);

    await expect(
      client.request("promptDraft.get", { id: "missing" }),
    ).rejects.toMatchObject({ category: "not_found" });
    vi.spyOn(repositories, "getPromptDraft").mockRejectedValue(
      new Error("private storage detail"),
    );
    await expect(
      client.request("promptDraft.get", { id: "failed" }),
    ).rejects.toMatchObject({
      category: "storage_failure",
      message: "The extension could not complete this local operation.",
    });
  });

  it("rejects a concurrent duplicate request ID", async () => {
    const { listener, repositories } = createHarness();
    let release!: (record: {
      id: string;
      kind: "image";
      rawText: string;
      updatedAt: number;
    }) => void;
    vi.spyOn(repositories, "savePromptDraft").mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    const request = makeRequest(
      "promptDraft.put",
      { id: "duplicate", kind: "image", rawText: "demo" },
      "same-request-id",
    );
    const responses: AppResponse[] = [];
    const sendResponse = (response: AppResponse) => responses.push(response);

    expect(listener(request, dashboardSender, sendResponse)).toBe(true);
    listener(request, dashboardSender, sendResponse);
    expect(responses[0]).toMatchObject({
      ok: false,
      error: { category: "duplicate_request" },
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release({ ...request.payload, updatedAt: 1234 });
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    expect(responses[1]).toMatchObject({
      ok: true,
      requestId: "same-request-id",
    });
    listener(request, dashboardSender, sendResponse);
    expect(responses[2]).toMatchObject({
      ok: false,
      error: { category: "duplicate_request" },
    });
  });

  it("maps missing receivers, worker failures, malformed replies, and timeouts", async () => {
    const request = async (
      sendMessage: (message: AppRequest) => Promise<unknown>,
      timeoutMs = 100,
    ) =>
      createFoundationClient(
        { sendMessage },
        { timeoutMs: { "foundation.ping": timeoutMs } },
      ).request("foundation.ping", {});

    await expect(
      request(async () => {
        throw new Error(
          "Could not establish connection. Receiving end does not exist.",
        );
      }),
    ).rejects.toMatchObject({ category: "missing_receiver" });
    await expect(
      request(async () => Promise.reject(new Error("worker crashed"))),
    ).rejects.toMatchObject({
      category: "worker_error",
    });
    await expect(
      request(async () => ({ ok: true, requestId: "wrong" })),
    ).rejects.toMatchObject({
      category: "malformed_response",
    });

    let deliverLate!: (response: unknown) => void;
    const lateRequest = request(
      () => new Promise((resolve) => (deliverLate = resolve)),
      5,
    );
    await expect(lateRequest).rejects.toMatchObject({ category: "timeout" });
    deliverLate({
      protocolVersion: PROTOCOL_VERSION,
      buildId: BUILD_ID,
      requestId: "late",
      ok: true,
      data: { state: "ready" },
    });
  });

  it("rejects valid-shaped but miscorrelated, protocol-mismatched, and stale-build replies", async () => {
    const cases = [
      ["mis-correlation", { requestId: "wrong-id" }, "malformed_response"],
      [
        "protocol mismatch",
        { protocolVersion: PROTOCOL_VERSION + 1 },
        "protocol_mismatch",
      ],
      ["stale build", { buildId: "old-build" }, "build_mismatch"],
    ] as const;

    for (const [label, override, category] of cases) {
      const client = createFoundationClient(
        {
          sendMessage: async () => ({
            protocolVersion: PROTOCOL_VERSION,
            buildId: BUILD_ID,
            requestId: "fixed-request",
            ok: true,
            data: { state: "ready" },
            ...override,
          }),
        },
        { makeRequestId: () => "fixed-request" },
      );
      await expect(
        client.request("foundation.ping", {}),
        label,
      ).rejects.toMatchObject({
        category,
      });
    }
  });
});

describe("synthetic long-text transport round trip", () => {
  it.each(Object.entries(syntheticPromptBodies))(
    "preserves the %s body through the message handler and repository boundary",
    async (caseName, rawText) => {
      const { transport } = createHarness();
      const client = createFoundationClient(transport);
      const id = `synthetic-${caseName}`;
      const byteLength = new TextEncoder().encode(rawText).byteLength;

      expect(rawText.length).toBeGreaterThan(12_000);
      const saved = await client.request("promptDraft.put", {
        id,
        kind: "image",
        rawText,
      });
      expect(saved).toMatchObject({ id, characterCount: rawText.length });
      const restored = await client.request("promptDraft.get", { id });

      expect(restored).toMatchObject({ id, rawText });
      expect((restored as { rawText: string }).rawText).toBe(rawText);
      if (caseName === "long") expect(byteLength).toBeGreaterThan(1_000_000);
    },
  );
});
