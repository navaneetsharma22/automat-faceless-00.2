import { describe, expect, it } from "vitest";
import { createFlowImageObservationHandler } from "../../src/background/handlers/observations";
import {
  reduceFlowImageObservation,
  type FlowImageObservationEvent,
} from "../../src/domain/jobs/results";
import { flowImageAttemptActiveKey } from "../../src/domain/jobs/attempt";
import { flowImagePromptSnapshotId } from "../../src/domain/batches/flowImagePromptSnapshot";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { sha256Hex } from "../../src/storage/repositories";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import type { FlowImageAttemptRecord } from "../../src/domain/jobs/attempt";

const projectId = "fixture-project";
const tabId = 41;
const canonicalTarget = `https://flow.google.com/project/${projectId}`;
const documentId = "fixture-document";
const sessionId = "d7a5ea61-9721-4a65-8485-798f2f4e0c11";
const prompt = '{"shot_id":"01","scene":"offline fixture"}';

async function makeFixture(variantCount = 2) {
  const repositories = new ExtensionRepositories(
    createMemoryRepositoryDatabase(),
    () => 2_000,
  );
  const saved = await repositories.savePromptBatch({
    workspaceId: "default",
    kind: "image",
    sourceText: prompt,
  });
  const item = saved.items[0]!;
  const hash = await sha256Hex(prompt);
  await repositories.recordSelectedTarget({
    provider: "Flow",
    tabId,
    canonicalTarget,
  });
  const attempt = await repositories.createFlowImageAttempt({
    attemptId: "fixture-attempt",
    confirmationKey: "fixture-confirmation",
    workspaceId: "default",
    batchId: saved.batch.id,
    itemId: item.id,
    ...(item.shotId ? { shotId: item.shotId } : {}),
    promptHash: hash,
    sourceSnapshot: {
      snapshotId: flowImagePromptSnapshotId(item.id, hash),
      workspaceId: "default",
      batchId: saved.batch.id,
      itemId: item.id,
      promptHash: hash,
      rawJsonBody: prompt,
      promptCodeUnits: prompt.length,
      promptUtf8Bytes: new TextEncoder().encode(prompt).byteLength,
      createdAt: 1_000,
    },
    promptCodeUnits: prompt.length,
    promptUtf8Bytes: new TextEncoder().encode(prompt).byteLength,
    provider: "Flow",
    projectId,
    tabId,
    frameId: "fixture-frame",
    loaderId: "fixture-loader",
    documentId,
    senderFrameId: 0,
    buildId: BUILD_ID,
    protocolVersion: PROTOCOL_VERSION,
    settingsConfirmation: {
      confirmationId: "fixture-confirmation",
      confirmedAt: 900,
      userAttested: true,
      tabId,
      projectId,
      canonicalTarget,
      declaredVariantCount: variantCount,
    },
    state: "preparing",
    activeKey: flowImageAttemptActiveKey(item.id, hash),
    events: [{ stage: "preparation", at: 1_000, method: "none" }],
    createdAt: 1_000,
    updatedAt: 1_000,
  });
  const binding = {
    workspaceId: attempt.workspaceId,
    batchId: attempt.batchId,
    itemId: attempt.itemId,
    sourceHash: attempt.promptHash,
    sourceSnapshotId: attempt.sourceSnapshotId,
    attemptId: attempt.attemptId,
    provider: "Flow" as const,
    projectId: attempt.projectId,
    tabId: attempt.tabId,
    frameId: attempt.frameId,
    loaderId: attempt.loaderId,
  };
  const baseline = {
    schemaVersion: 1 as const,
    binding,
    capture: {
      method: "flow_image_runtime_observation" as const,
      capturedAt: 1_010,
      buildId: BUILD_ID,
      protocolVersion: PROTOCOL_VERSION,
    },
    observation: {
      profile: "flow_empty_workspace_ui" as const,
      profileVersion: 1 as const,
      workspaceTag: "flow-project-page" as const,
      markerPhrase: "Start creating or drop media" as const,
      markerCount: 1 as const,
      visibleMediaCount: 0 as const,
      visibleResultCardCount: 0 as const,
      loadingMarkerCount: 0 as const,
    },
    completeness: "complete_for_observed_empty_ui" as const,
    existingResultIdentities: [],
    excludedObservations: { count: 0, reasons: [] },
    variantDeclaration: {
      status: "declared" as const,
      count: variantCount,
      source: "validated_settings_confirmation" as const,
    },
    limitations: [
      "provider_result_identity_contract_not_live_verified" as const,
    ],
  };
  await repositories.transitionFlowImageAttempt({
    attemptId: attempt.attemptId,
    expected: "preparing",
    next: "verified",
    event: { stage: "verification", at: 1_020, method: "none" },
  });
  const session = {
    sessionId,
    documentId,
    senderFrameId: 0,
    startedAt: 1_030,
    deadlineAt: 100_000,
    maxEvents: 8,
    profileSupport: "fixture_supported" as const,
    status: "active" as const,
    lastSequence: 0,
    reconciliationCount: 0,
  };
  const awaiting = {
    status: "awaiting_evidence" as const,
    declaredVariantCount: variantCount,
    observedSucceededCount: 0,
    observedFailedCount: 0,
    updatedAt: 1_030,
  };
  await repositories.transitionFlowImageAttempt({
    attemptId: attempt.attemptId,
    expected: "verified",
    next: "dispatch-intent",
    event: { stage: "dispatch", at: 1_040, method: "none" },
    baseline: {
      kind: "flow_empty_workspace_ui",
      workspaceTag: "flow-project-page",
      markerPhrase: "Start creating or drop media",
      markerCount: 1,
      visibleMediaCount: 0,
      visibleResultCardCount: 0,
      loadingMarkerCount: 0,
      capturedAt: 1_010,
    },
    resultBaseline: baseline,
    observationSession: session,
    resultOutcome: awaiting,
  });
  await repositories.transitionFlowImageAttempt({
    attemptId: attempt.attemptId,
    expected: "dispatch-intent",
    next: "dispatched",
    event: {
      stage: "dispatch",
      at: 1_050,
      method: "CDP Input.dispatchMouseEvent",
      code: "activation_pair_sent",
    },
  });
  const port = {
    getSelection: async () => ({ tabId, canonicalTarget }),
    getTab: async () => ({
      id: tabId,
      title: "fixture",
      url: canonicalTarget,
      provider: "Flow",
      projectId,
      canonicalTarget,
    }),
    readFrame: async () => ({
      frameId: "fixture-frame",
      loaderId: "fixture-loader",
      documentId,
      senderFrameId: 0,
      url: canonicalTarget,
    }),
  };
  const handler = createFlowImageObservationHandler({
    extensionId: "fixture-extension",
    repositories,
    port: port as never,
    now: () => 1_100,
    allowSyntheticProfile: true,
  });
  const stored = await repositories.getFlowImageAttempt(attempt.attemptId);
  return { repositories, handler, attempt: stored!, binding, variantCount };
}

function event(
  attempt: FlowImageAttemptRecord,
  sequence: number,
  results: FlowImageObservationEvent["results"],
  overrides: Partial<FlowImageObservationEvent> = {},
): FlowImageObservationEvent {
  const binding = attempt.resultBaseline!.binding;
  return {
    attemptId: attempt.attemptId,
    sessionId,
    observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    observedAt: 1_060 + sequence,
    profile: "flow_result_lifecycle_v1",
    binding,
    results,
    ...overrides,
  };
}

function result(
  attempt: FlowImageAttemptRecord,
  id: string,
  status: "processing" | "succeeded" | "failed",
  variantId?: string,
): FlowImageObservationEvent["results"][number] {
  return {
    identity: {
      kind: "result_id",
      projectId,
      resultId: id,
      ...(variantId ? { variantId } : {}),
    },
    status,
    ...(status === "succeeded"
      ? { terminalEvidence: "provider_success_marker" as const }
      : status === "failed"
        ? { terminalEvidence: "provider_error_marker" as const }
        : {}),
    attributionProof: {
      source: "provider_attempt_metadata",
      attemptId: attempt.attemptId,
      sourceSnapshotId: attempt.sourceSnapshotId,
    },
  };
}

async function send(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  observation: FlowImageObservationEvent,
) {
  return fixture.handler.handle(
    {
      type: "AUTOMAT_FLOW_IMAGE_OBSERVATION",
      protocolVersion: PROTOCOL_VERSION,
      buildId: BUILD_ID,
      observation,
    },
    {
      id: "fixture-extension",
      tab: { id: tabId },
      frameId: 0,
      documentId,
    },
  );
}

describe("P05.2 attempt-bound Flow observation", () => {
  it("keeps a declared x1 pending through processing and completes on one terminal identity", async () => {
    const fixture = await makeFixture(1);
    expect(
      (
        await send(
          fixture,
          event(fixture.attempt, 1, [
            result(fixture.attempt, "r1", "processing"),
          ]),
        )
      ).accepted,
    ).toBe(true);
    const accepted = await send(
      fixture,
      event(fixture.attempt, 2, [result(fixture.attempt, "r1", "succeeded")]),
    );
    expect(accepted).toMatchObject({ accepted: true, outcome: "complete" });
    const saved = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    expect(saved).toMatchObject({
      state: "dispatched",
      resultOutcome: {
        status: "complete",
        declaredVariantCount: 1,
        observedSucceededCount: 1,
      },
      resultLinks: [{ status: "succeeded" }],
    });
  });

  it("keeps x2 partial progress pending and requires two distinct variant identities", async () => {
    const fixture = await makeFixture(2);
    await send(
      fixture,
      event(fixture.attempt, 1, [
        result(fixture.attempt, "group", "succeeded", "v1"),
      ]),
    );
    expect(
      (
        await fixture.repositories.getFlowImageAttempt(
          fixture.attempt.attemptId,
        )
      )?.resultOutcome?.status,
    ).toBe("awaiting_evidence");
    const accepted = await send(
      fixture,
      event(fixture.attempt, 2, [
        result(fixture.attempt, "group", "succeeded", "v2"),
      ]),
    );
    expect(accepted).toMatchObject({ accepted: true, outcome: "complete" });
  });

  it("records attributable mixed terminal errors as partial_error, never complete", async () => {
    const fixture = await makeFixture(2);
    const accepted = await send(
      fixture,
      event(fixture.attempt, 1, [
        result(fixture.attempt, "r1", "succeeded"),
        result(fixture.attempt, "r2", "failed"),
      ]),
    );
    expect(accepted).toMatchObject({
      accepted: true,
      outcome: "partial_error",
    });
    expect(
      (
        await fixture.repositories.getFlowImageAttempt(
          fixture.attempt.attemptId,
        )
      )?.resultLinks,
    ).toHaveLength(2);
  });

  it("deduplicates repeated thumbnails and redelivery, but rejects stale sequence and sender/document", async () => {
    const fixture = await makeFixture(2);
    const duplicateThumbnail = result(
      fixture.attempt,
      "same-asset",
      "processing",
    );
    const observation = event(fixture.attempt, 1, [
      duplicateThumbnail,
      duplicateThumbnail,
    ]);
    expect(await send(fixture, observation)).toMatchObject({
      accepted: true,
      duplicate: false,
    });
    expect(await send(fixture, observation)).toMatchObject({
      accepted: true,
      duplicate: true,
    });
    const saved = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    expect(saved?.resultLinks).toHaveLength(1);
    expect(
      await send(
        fixture,
        event(fixture.attempt, 2, [duplicateThumbnail], {
          sessionId: "b1729ecb-938f-4f6d-85d4-9d46d933a355",
        }),
      ),
    ).toMatchObject({
      accepted: false,
      code: "observation_sender_binding_mismatch",
    });
    expect(
      await fixture.handler.handle(
        {
          type: "AUTOMAT_FLOW_IMAGE_OBSERVATION",
          protocolVersion: PROTOCOL_VERSION,
          buildId: BUILD_ID,
          observation: event(fixture.attempt, 2, [duplicateThumbnail]),
        },
        {
          id: "fixture-extension",
          tab: { id: tabId },
          frameId: 0,
          documentId: "stale-document",
        },
      ),
    ).toMatchObject({
      accepted: false,
      code: "observation_sender_binding_mismatch",
    });
    expect(
      await send(fixture, event(fixture.attempt, 3, [duplicateThumbnail])),
    ).toMatchObject({
      accepted: false,
      code: "observation_persistence_or_validation_failed",
    });
  });

  it("rejects wrong project/source ownership and refuses an incomplete baseline", async () => {
    const fixture = await makeFixture(1);
    const wrongProject = event(fixture.attempt, 1, [
      {
        ...result(fixture.attempt, "r1", "succeeded"),
        identity: {
          kind: "result_id",
          projectId: "other-project",
          resultId: "r1",
        },
      },
    ]);
    expect(await send(fixture, wrongProject)).toMatchObject({
      accepted: false,
    });
    const wrongSource = event(
      fixture.attempt,
      1,
      [result(fixture.attempt, "r1", "succeeded")],
      { binding: { ...fixture.binding, sourceHash: "f".repeat(64) } },
    );
    expect(await send(fixture, wrongSource)).toMatchObject({ accepted: false });
  });

  it("retains unknown after timeout, observation loss, restart binding change and storage failure", async () => {
    const fixture = await makeFixture(1);
    const attempt = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    await fixture.repositories.updateFlowImageObservationSession({
      attemptId: attempt!.attemptId,
      sessionId,
      sessionStatus: "timed_out",
      resultOutcome: {
        status: "unknown",
        reason: "observation_timeout",
        declaredVariantCount: 1,
        observedSucceededCount: 0,
        observedFailedCount: 0,
        updatedAt: 1_100,
      },
    });
    expect(
      (
        await fixture.repositories.getFlowImageAttempt(
          fixture.attempt.attemptId,
        )
      )?.resultOutcome?.reason,
    ).toBe("observation_timeout");

    const restartFixture = await makeFixture(1);
    const lost = createFlowImageObservationHandler({
      extensionId: "fixture-extension",
      repositories: restartFixture.repositories,
      port: {
        ...({} as object),
        getSelection: async () => ({ tabId, canonicalTarget }),
        getTab: async () => ({
          id: tabId,
          title: "fixture",
          url: canonicalTarget,
          provider: "Flow",
          projectId,
          canonicalTarget,
        }),
        readFrame: async () => ({
          frameId: "changed",
          loaderId: "fixture-loader",
          documentId,
          senderFrameId: 0,
          url: canonicalTarget,
        }),
      } as never,
      now: () => 1_100,
      allowSyntheticProfile: true,
    });
    expect(await lost.resumeReadOnlyAfterWorkerRestart()).toMatchObject({
      resumed: 0,
      unknown: 1,
    });
    expect(
      (
        await restartFixture.repositories.getFlowImageAttempt(
          restartFixture.attempt.attemptId,
        )
      )?.resultOutcome?.reason,
    ).toBe("binding_changed");

    const storageFixture = await makeFixture(1);
    const table = storageFixture.repositories.tables.flowImageAttempts;
    const originalPut = table.put;
    table.put = async () => {
      throw new Error("fixture storage failure");
    };
    expect(
      await send(
        storageFixture,
        event(storageFixture.attempt, 1, [
          result(storageFixture.attempt, "r1", "succeeded"),
        ]),
      ),
    ).toMatchObject({ accepted: false });
    table.put = originalPut;
    expect(
      (
        await storageFixture.repositories.getFlowImageAttempt(
          storageFixture.attempt.attemptId,
        )
      )?.resultOutcome?.status,
    ).not.toBe("complete");
  });

  it("keeps historical attempts without a declaration unknown and does not infer x1", async () => {
    const fixture = await makeFixture(1);
    const attempt = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    const baseline = {
      ...attempt!.resultBaseline!,
      variantDeclaration: { status: "absent" as const },
    };
    const reduction = reduceFlowImageObservation(
      baseline,
      undefined,
      [],
      event(attempt!, 1, [resultForAttempt(attempt!, "r1")]),
      1_100,
    );
    expect(reduction.outcome).toMatchObject({
      status: "unknown",
      reason: "variant_declaration_missing",
    });
  });
});

function resultForAttempt(attempt: FlowImageAttemptRecord, id: string) {
  return result(attempt, id, "succeeded");
}
