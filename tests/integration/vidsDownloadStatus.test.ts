import { describe, expect, it } from "vitest";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import { createVidsDownloadHandler } from "../../src/background/handlers/vidsDownload";
import { createVidsDownloadManager } from "../../src/background/downloadManager";
import { parseVidsDownloadStatus } from "../../src/domain/media/combinedExport";
import { createFoundationClient } from "../../src/shared/messageClient";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import type { AppRequest, AppResponse } from "../../src/shared/schemas";
import { ChromePreferenceRepository, ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";

const extensionId = "vids-status-test-extension";
const dashboardSender = { id: extensionId, url: `chrome-extension://${extensionId}/index.html` };

function createStatusHarness(options: { storageFailure?: boolean; malformedAttempt?: boolean; registerHandler?: boolean } = {}) {
  const values: Record<string, unknown> = options.malformedAttempt
    ? { vidsDownloadAttempt: { attemptId: "attempt", state: "unknown" } }
    : {};
  const preferences = new ChromePreferenceRepository({
    get: async (key) => {
      if (options.storageFailure && key === "vidsDownloadAttempt") throw new Error("storage unavailable");
      return Object.hasOwn(values, key) ? { [key]: values[key] } : {};
    },
    set: async (items) => Object.assign(values, items),
  });
  const repositories = new ExtensionRepositories(createMemoryRepositoryDatabase());
  const manager = createVidsDownloadManager({
    preferences,
    downloads: { download: async () => 1, search: async () => [] },
  });
  const vidsDownload = createVidsDownloadHandler({
    extensionId,
    preferences,
    repositories,
    manager,
    revalidate: async () => undefined,
  });
  const listener = createConnectionMessageListener(extensionId, {
    repositories,
    preferences,
    ...(options.registerHandler === false ? {} : { vidsDownload }),
  });
  const transport = {
    sendMessage: (request: AppRequest) => new Promise<unknown>((resolve) => {
      const wireRequest = JSON.parse(JSON.stringify(request)) as AppRequest;
      listener(wireRequest, dashboardSender, (response) => {
        resolve(JSON.parse(JSON.stringify(response)) as AppResponse);
      });
    }),
  };
  return { client: createFoundationClient(transport), listener };
}

describe("Vids download status message path", () => {
  it("returns an explicit idle value through worker routing and Chrome-style JSON serialization", async () => {
    const { client } = createStatusHarness();
    const response = await client.request("vids.download.get", {});
    expect(response).toBeNull();
    expect(parseVidsDownloadStatus(response)).toBeUndefined();
  });

  it("preserves a real storage read failure with a bounded storage stage", async () => {
    const { client } = createStatusHarness({ storageFailure: true });
    await expect(client.request("vids.download.get", {})).rejects.toMatchObject({
      category: "storage_failure",
      code: "vids_download_status_read_failed",
      stage: "download_status_storage",
    });
  });

  it("does not treat a malformed persisted record as an empty status", async () => {
    const { client } = createStatusHarness({ malformedAttempt: true });
    await expect(client.request("vids.download.get", {})).rejects.toMatchObject({
      category: "storage_failure",
      code: "vids_download_status_invalid",
      stage: "download_status_parse",
    });
  });

  it("reports missing worker registration as an error rather than idle", async () => {
    const { client } = createStatusHarness({ registerHandler: false });
    await expect(client.request("vids.download.get", {})).rejects.toMatchObject({
      category: "worker_error",
      code: "vids_download_unavailable",
      stage: "worker_registration",
    });
  });

  it("keeps request validation failures distinct from an idle response", async () => {
    const { listener } = createStatusHarness();
    const client = createFoundationClient({
      sendMessage: (request) => new Promise<unknown>((resolve) => {
        listener(
          { ...request, payload: { unexpected: true } },
          dashboardSender,
          (response) => resolve(JSON.parse(JSON.stringify(response)) as AppResponse),
        );
      }),
    });
    await expect(client.request("vids.download.get", {})).rejects.toMatchObject({
      category: "invalid_request",
      code: "invalid_request",
      stage: "request_validation",
    });
  });

  it("keeps runtime transport rejection distinct from an idle response", async () => {
    const client = createFoundationClient({
      sendMessage: async () => { throw new Error("runtime unavailable"); },
    });
    await expect(client.request("vids.download.get", {})).rejects.toMatchObject({
      category: "worker_error",
      code: "worker_request_failed",
      stage: "message_transport",
    });
  });

  it("rejects an omitted data field as a response parsing failure", async () => {
    const client = createFoundationClient({
      sendMessage: async (request) => JSON.parse(JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        buildId: BUILD_ID,
        requestId: request.requestId,
        ok: true,
        data: undefined,
      })),
    });
    await expect(client.request("vids.download.get", {})).rejects.toMatchObject({
      category: "malformed_response",
      code: "malformed_response",
      stage: "response_parsing",
    });
  });

  it("accepts only explicit null as idle and rejects malformed consumer data", () => {
    expect(parseVidsDownloadStatus(null)).toBeUndefined();
    expect(() => parseVidsDownloadStatus(undefined)).toThrow("vids_download_status_invalid");
    expect(() => parseVidsDownloadStatus({ attemptId: "broken" })).toThrow("vids_download_status_invalid");
  });
});
