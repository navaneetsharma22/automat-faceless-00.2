import { describe, expect, it } from "vitest";
import { importPromptBatch } from "../../src/domain/batches/importBatch";
import { INPUT_POLICY } from "../../src/domain/batches/inputPolicy";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import { createFoundationClient } from "../../src/shared/messageClient";
import {
  PromptBatchInputSchema,
  PromptBatchSnapshotSchema,
} from "../../src/shared/schemas";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import type { AppRequest, AppResponse } from "../../src/shared/schemas";
import {
  ChromePreferenceRepository,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import {
  promptSizeFixtures,
  representativeCases,
} from "../fixtures/prompts/promptFixtures";
import { syntheticPromptBodies } from "../fixtures/syntheticPromptBodies";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";

const extensionId = "prompt-preservation-extension";
const dashboardSender = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/index.html`,
};

function createHarness(database = createMemoryRepositoryDatabase()) {
  const repositories = new ExtensionRepositories(database, () => 321);
  const preferences = new ChromePreferenceRepository({
    get: async () => ({}),
    set: async () => undefined,
  });
  const listener = createConnectionMessageListener(extensionId, {
    repositories,
    preferences,
  });
  const transport = {
    sendMessage: (request: AppRequest) =>
      new Promise<unknown>((resolve) => {
        const wireRequest = JSON.parse(JSON.stringify(request)) as AppRequest;
        listener(wireRequest, dashboardSender, (response) => {
          resolve(JSON.parse(JSON.stringify(response)) as AppResponse);
        });
      }),
  };
  return {
    database,
    repositories,
    listener,
    transport,
    client: createFoundationClient(transport),
  };
}

async function putBatch(
  client: ReturnType<typeof createFoundationClient>,
  workspaceId: string,
  kind: "image" | "video",
  sourceText: string,
) {
  const response = await client.request("promptBatch.put", {
    workspaceId,
    kind,
    sourceText,
  });
  return PromptBatchSnapshotSchema.parse(response);
}

async function getBatch(
  client: ReturnType<typeof createFoundationClient>,
  workspaceId: string,
  kind: "image" | "video",
) {
  return PromptBatchSnapshotSchema.parse(
    await client.request("promptBatch.get", { workspaceId, kind }),
  );
}

describe("P03.4 prompt preservation through schema, repository, and worker message", () => {
  it.each(promptSizeFixtures)(
    "preserves the complete $name fixture unchanged through save and readback",
    async (fixture) => {
      const { client } = createHarness();
      const workspaceId = `fixture-${fixture.name.toLowerCase()}`;
      const imported = importPromptBatch(fixture.rawBody, fixture.kind);
      expect(imported.ok).toBe(true);
      if (!imported.ok) return;

      const saved = await putBatch(
        client,
        workspaceId,
        fixture.kind,
        fixture.rawBody,
      );
      const restored = await getBatch(client, workspaceId, fixture.kind);

      expect(saved.batch.sourceText).toBe(fixture.rawBody);
      expect(restored.batch.sourceText).toBe(fixture.rawBody);
      expect(restored.items).toHaveLength(1);
      expect(restored.items[0]!.rawJsonBody).toBe(fixture.rawBody);
      expect(restored.items[0]!.sourceSpan).toEqual({
        start: 0,
        end: fixture.rawBody.length,
      });
      expect(restored.items[0]!.measurement.stringCodeUnits).toBe(
        fixture.rawBody.length,
      );
      expect(restored.items[0]!.measurement.utf8Bytes).toBe(
        new TextEncoder().encode(fixture.rawBody).byteLength,
      );
      expect(restored.items[0]!.shotId).toBe(imported.items[0]!.shotId);
      expect(restored.items[0]!.identitySource).toBe(
        imported.items[0]!.identitySource,
      );
    },
  );

  it.each(["image", "video"] as const)(
    "round-trips the historical 1.26M-code-unit body for %s without a legacy cap",
    async (kind) => {
      const { client } = createHarness();
      expect(syntheticPromptBodies.long.length).toBe(1_260_163);
      const workspaceId = `historical-long-${kind}`;
      const saved = await putBatch(
        client,
        workspaceId,
        kind,
        syntheticPromptBodies.long,
      );
      const restored = await getBatch(client, workspaceId, kind);

      expect(restored.items[0]!.rawJsonBody).toBe(syntheticPromptBodies.long);
      expect(restored.batch.sourceText).toBe(syntheticPromptBodies.long);
      expect(restored.items[0]!.rawJsonBody.length).toBe(
        saved.items[0]!.measurement.stringCodeUnits,
      );
    },
  );

  it.each(["image", "video"] as const)(
    "preserves single arrays, numbered blocks, and explicit envelopes for %s",
    async (kind) => {
      const envelopeSource =
        representativeCases.explicitEnvelope.source.replace(
          '"kind": "image"',
          `"kind": "${kind}"`,
        );
      const sources = [
        {
          name: "top-level array",
          source: representativeCases.topLevelArray.source,
          expected: [representativeCases.topLevelArray.source],
          ids: [undefined],
        },
        {
          name: "numbered blocks",
          source: representativeCases.numberedTwoBodies.source,
          expected: representativeCases.numberedTwoBodies.validBodies,
          ids: ["1", "2"],
        },
        {
          name: "versioned envelope",
          source: envelopeSource,
          expected: ['{"scene": "SYNTHETIC envelope"}'],
          ids: ["1"],
        },
      ];

      const { client } = createHarness();
      for (const [index, entry] of sources.entries()) {
        const workspaceId = `${kind}-forms-${index}`;
        const imported = importPromptBatch(entry.source, kind);
        expect(imported.ok, entry.name).toBe(true);
        if (!imported.ok) continue;
        const saved = await putBatch(client, workspaceId, kind, entry.source);
        const restored = await getBatch(client, workspaceId, kind);
        expect(restored.items.map((item) => item.rawJsonBody)).toEqual(
          entry.expected,
        );
        expect(restored.items.map((item) => item.shotId)).toEqual(entry.ids);
        expect(restored.items.map((item) => item.order)).toEqual(
          entry.expected.map((_body, order) => order),
        );
        expect(restored.batch.orderedItemIds).toEqual(
          saved.items.map((item) => item.id),
        );
      }
    },
  );

  it("keeps image/video and separate workspace batches isolated", async () => {
    const { client, repositories } = createHarness();
    const image = promptSizeFixtures.find(
      (fixture) => fixture.name === "IMAGE_10K",
    )!;
    const video = promptSizeFixtures.find(
      (fixture) => fixture.name === "VIDEO_10K",
    )!;
    const otherWorkspace = '{"shot_id":"9","scene":"other workspace"}';

    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: 41,
      canonicalTarget: "https://labs.google/fx/tools/flow/project-image",
    });
    await repositories.recordSelectedTarget({
      provider: "Vids",
      tabId: 42,
      canonicalTarget: "https://docs.google.com/videos/d/video-target/edit",
    });

    await putBatch(client, "workspace-a", "image", image.rawBody);
    await putBatch(client, "workspace-a", "video", video.rawBody);
    await putBatch(client, "workspace-b", "image", otherWorkspace);

    expect(
      (await getBatch(client, "workspace-a", "image")).items[0]!.rawJsonBody,
    ).toBe(image.rawBody);
    expect(
      (await getBatch(client, "workspace-a", "video")).items[0]!.rawJsonBody,
    ).toBe(video.rawBody);
    expect(
      (await getBatch(client, "workspace-b", "image")).items[0]!.rawJsonBody,
    ).toBe(otherWorkspace);
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      tabId: 41,
      reconnectEnabled: false,
    });
    expect(await repositories.getSelectedTarget("Vids")).toMatchObject({
      tabId: 42,
      reconnectEnabled: false,
    });
  });

  it("rejects an invalid complete batch without replacing the previous saved batch", async () => {
    const { client } = createHarness();
    const original = '{"shot_id":"4","scene":"saved valid body"}';
    await putBatch(client, "workspace-atomic", "image", original);

    await expect(
      client.request("promptBatch.put", {
        workspaceId: "workspace-atomic",
        kind: "image",
        sourceText: '{"scene":"complete"}\nnot a supported label',
      }),
    ).rejects.toMatchObject({ category: "invalid_request" });
    expect(
      (await getBatch(client, "workspace-atomic", "image")).items[0]!
        .rawJsonBody,
    ).toBe(original);
  });

  it("rolls back a partial item write and keeps the prior batch intact", async () => {
    const database = createMemoryRepositoryDatabase();
    const { client } = createHarness(database);
    const original = '{"shot_id":"1","scene":"old"}';
    await putBatch(client, "workspace-rollback", "video", original);
    const bulkPut = database.promptItems.bulkPut.bind(database.promptItems);
    database.promptItems.bulkPut = async (items) => {
      await bulkPut(items.slice(0, 1));
      throw new Error("simulated storage failure");
    };

    await expect(
      client.request("promptBatch.put", {
        workspaceId: "workspace-rollback",
        kind: "video",
        sourceText: representativeCases.numberedTwoBodies.source,
      }),
    ).rejects.toMatchObject({ category: "storage_failure" });
    database.promptItems.bulkPut = bulkPut;

    const restored = await getBatch(client, "workspace-rollback", "video");
    expect(restored.items).toHaveLength(1);
    expect(restored.items[0]!.rawJsonBody).toBe(original);
  });

  it("rejects schema-valid storage corruption on the repository read boundary", async () => {
    const database = createMemoryRepositoryDatabase();
    const { client, repositories } = createHarness(database);
    const source = '{"shot_id":"5","scene":"original"}';
    const saved = await putBatch(
      client,
      "workspace-integrity",
      "image",
      source,
    );
    const stored = saved.items[0]!;
    await database.promptItems.bulkPut([
      { ...stored, rawJsonBody: '{"shot_id":"5","scene":"tampered"}' },
    ]);

    await expect(
      repositories.getPromptBatch("workspace-integrity", "image"),
    ).rejects.toMatchObject({ name: "PromptBatchValidationError" });
    await expect(
      client.request("promptBatch.get", {
        workspaceId: "workspace-integrity",
        kind: "image",
      }),
    ).rejects.toMatchObject({ category: "storage_failure" });
  });

  it("keeps a saved batch unchanged when extension messaging fails before dispatch", async () => {
    const { client, transport } = createHarness();
    const original = '{"shot_id":"6","scene":"already saved"}';
    await putBatch(client, "workspace-message-failure", "video", original);
    const failingClient = createFoundationClient({
      sendMessage: (request) =>
        request.type === "promptBatch.put"
          ? Promise.reject(new Error("worker crashed"))
          : transport.sendMessage(request),
    });

    await expect(
      failingClient.request("promptBatch.put", {
        workspaceId: "workspace-message-failure",
        kind: "video",
        sourceText: '{"shot_id":"7","scene":"not dispatched"}',
      }),
    ).rejects.toMatchObject({ category: "worker_error" });
    expect(
      (await getBatch(client, "workspace-message-failure", "video")).items[0]!
        .rawJsonBody,
    ).toBe(original);
  });

  it("rejects invalid request schemas and unauthorized message senders", async () => {
    const { listener } = createHarness();
    const responses: AppResponse[] = [];
    listener(
      {
        protocolVersion: PROTOCOL_VERSION,
        buildId: BUILD_ID,
        requestId: "unauthorized-batch-read",
        type: "promptBatch.get",
        payload: { workspaceId: "default", kind: "image" },
      },
      { id: extensionId, url: "https://example.invalid/" },
      (response) => responses.push(response),
    );
    listener(
      {
        protocolVersion: PROTOCOL_VERSION,
        buildId: BUILD_ID,
        requestId: "invalid-batch-workspace",
        type: "promptBatch.get",
        payload: { workspaceId: "not a valid workspace", kind: "image" },
      },
      dashboardSender,
      (response) => responses.push(response),
    );
    expect(responses[0]).toMatchObject({
      ok: false,
      error: { category: "unauthorized_sender" },
    });
    expect(responses[1]).toMatchObject({
      ok: false,
      error: { category: "invalid_request" },
    });
  });

  it("uses centralized schema size limits without a stale 12,000-character cap", () => {
    const longSource = "x".repeat(12_001);
    expect(
      PromptBatchInputSchema.safeParse({
        workspaceId: "default",
        kind: "image",
        sourceText: longSource,
      }).success,
    ).toBe(true);
    expect(INPUT_POLICY.maxBatchCodeUnits).toBe(5_000_000);
    expect(
      PromptBatchInputSchema.safeParse({
        workspaceId: "default",
        kind: "image",
        sourceText: "x".repeat(INPUT_POLICY.maxBatchCodeUnits + 1),
      }).success,
    ).toBe(false);

    const exactByteLimit = `${"अ".repeat(3_333_333)}a`;
    expect(new TextEncoder().encode(exactByteLimit).byteLength).toBe(
      INPUT_POLICY.maxBatchUtf8Bytes,
    );
    expect(
      PromptBatchInputSchema.safeParse({
        workspaceId: "default",
        kind: "video",
        sourceText: exactByteLimit,
      }).success,
    ).toBe(true);
    expect(
      PromptBatchInputSchema.safeParse({
        workspaceId: "default",
        kind: "video",
        sourceText: `${exactByteLimit}अ`,
      }).success,
    ).toBe(false);
  });
});
