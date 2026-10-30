import { describe, expect, it } from "vitest";
import { createFlowImageObservationHandler } from "../../src/background/handlers/observations";
import {
  flowImageResultBaselineFingerprintInput,
  reduceFlowImageObservation,
  flowStructuralSnapshotFingerprintInput,
  type FlowStructuralObservationEvent,
  type FlowImageObservationEvent,
} from "../../src/domain/jobs/results";
import { flowImageAttemptActiveKey } from "../../src/domain/jobs/attempt";
import { flowImagePromptSnapshotId } from "../../src/domain/batches/flowImagePromptSnapshot";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { sha256Hex } from "../../src/storage/repositories";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";
import type { FlowImageAttemptRecord } from "../../src/domain/jobs/attempt";
import { createConnectionLifecycleService } from "../../src/background/connectionLifecycle";
import { createChromeFlowImageGenerateOncePort } from "../../src/background/handlers/flow";
import type { ConnectionPort } from "../../src/platforms/shared/contracts";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
} from "../../src/platforms/shared/contracts";

const projectId = "fixture-project";
const tabId = 41;
const canonicalTarget = `https://flow.google.com/project/${projectId}`;
const documentId = "fixture-document";
const sessionId = "d7a5ea61-9721-4a65-8485-798f2f4e0c11";
const prompt = '{"shot_id":"01","scene":"offline fixture"}';

async function makeFixture(
  variantCount = 2,
  profileSupport:
    "fixture_supported" | "production_observation_only" = "fixture_supported",
  leaveDispatchIntent = false,
) {
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
    profileSupport,
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
  if (!leaveDispatchIntent) {
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
  }
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
    resumeObservation: async () => "resumed",
    stopObservation: async () => undefined,
  };
  const handler = createFlowImageObservationHandler({
    extensionId: "fixture-extension",
    repositories,
    port: port as never,
    now: () => 1_100,
    allowSyntheticProfile: true,
  });
  const stored = await repositories.getFlowImageAttempt(attempt.attemptId);
  return {
    repositories,
    handler,
    attempt: stored!,
    binding,
    variantCount,
    port,
  };
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
  observation: FlowImageObservationEvent | FlowStructuralObservationEvent,
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

async function structuralEvent(
  attempt: FlowImageAttemptRecord,
  sequence: number,
  kind: FlowStructuralObservationEvent["kind"] = "structural_snapshot",
): Promise<FlowStructuralObservationEvent> {
  const snapshot: FlowStructuralObservationEvent["snapshot"] = {
    completeForRenderedScope: true,
    virtualized: true,
    unidentifiedImageCount: 0,
    tiles: [{ tileToken: "tile-1", tag: "flow-image-tile", visible: true }],
    mediaCandidates: [
      {
        candidateId: "a".repeat(64),
        mediaToken: "media-1",
        tileToken: "tile-1",
        visible: true,
        complete: true,
        naturalWidth: 1376,
        naturalHeight: 768,
      },
    ],
    identityCandidates: [],
    identityCandidatesTruncated: false,
    resourceEvents: [],
    lifecycleSignals: [
      {
        markerToken: "marker-1",
        markerTag: "div",
        markerKind: "loading",
        scope: "tile",
        tileToken: "tile-1",
        visible: true,
        evidence: [{ attributeName: "data-state", signal: "loading" }],
      },
    ],
    captureGaps: [],
  };
  const sourceBaselineFingerprint = await sha256Hex(
    flowImageResultBaselineFingerprintInput(attempt.resultBaseline!),
  );
  return {
    kind,
    attemptId: attempt.attemptId,
    sessionId,
    observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    observedAt: 1_060 + sequence,
    profile: "flow_tile_candidate_structure_v1",
    binding: attempt.resultBaseline!.binding,
    sourceBaselineFingerprint,
    captureFingerprint: await sha256Hex(
      flowStructuralSnapshotFingerprintInput(snapshot),
    ),
    snapshot,
  };
}

describe("P05.2 attempt-bound Flow observation", () => {
  it("durably records production structural observations as unknown without result links", async () => {
    const fixture = await makeFixture(2, "production_observation_only", true);
    const observation = await structuralEvent(fixture.attempt, 1);
    const accepted = await send(fixture, observation);
    expect(accepted).toMatchObject({
      accepted: true,
      duplicate: false,
      outcome: "unknown",
    });
    const stored = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    expect(stored?.observationReceipts).toHaveLength(1);
    expect(stored?.structuralObservations).toHaveLength(1);
    expect(
      stored?.structuralObservations?.[0]?.snapshot.mediaCandidates,
    ).toHaveLength(1);
    expect(
      stored?.structuralObservations?.[0]?.snapshot.lifecycleSignals[0],
    ).toMatchObject({
      scope: "tile",
      tileToken: "tile-1",
      evidence: [{ attributeName: "data-state", signal: "loading" }],
    });
    expect(stored?.resultLinks).toEqual([]);
    expect(stored?.resultOutcome).toMatchObject({
      status: "unknown",
      reason: "ownership_ambiguous",
      declaredVariantCount: 2,
    });
    expect(stored?.state).toBe("dispatch-intent");
    expect(await send(fixture, observation)).toMatchObject({
      accepted: true,
      duplicate: true,
    });
  });

  it("classifies delayed binding-check transport exceptions as observer loss, not a proven binding change", async () => {
    const fixture = await makeFixture(2, "production_observation_only", true);
    const first = await send(
      fixture,
      await structuralEvent(fixture.attempt, 1),
    );
    expect(first).toMatchObject({ accepted: true });

    const originalGetTab = fixture.port.getTab;
    fixture.port.getTab = async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      throw new Error("transport rejected after delay");
    };
    const next = await send(fixture, await structuralEvent(fixture.attempt, 2));
    fixture.port.getTab = originalGetTab;

    expect(next).toMatchObject({
      accepted: false,
      code: "binding_check_exception_tab_read_error",
    });
    const saved = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    expect(saved?.observationSession?.status).toBe("lost");
    expect(saved?.resultOutcome).toMatchObject({
      status: "unknown",
      reason: "observation_lost",
    });
    expect(saved?.events.at(-1)?.code).toBe(
      "binding_check_exception_tab_read_error",
    );
    expect(saved?.observationReceipts).toHaveLength(1);
    expect(saved?.structuralObservations).toHaveLength(1);
  });

  it.each([
    ["selected_target_read", "selected-target repository", "selectedTarget"],
    ["selection_read", "selection port", "getSelection"],
    ["tab_read", "tab inspection", "getTab"],
    ["frame_inspection", "frame/document inspection", "readFrame"],
    [
      "source_snapshot_read",
      "source repository validation",
      "getFlowImagePromptSnapshot",
    ],
  ])(
    "records a bounded substage for %s exceptions (%s)",
    async (stage, _label, dependency) => {
      const fixture = await makeFixture(1, "production_observation_only", true);
      const observation = await structuralEvent(fixture.attempt, 1);
      const failing = new Error(
        "fixture dependency failure with private details",
      );
      if (dependency === "selectedTarget") {
        fixture.repositories.getSelectedTarget = async () => {
          throw failing;
        };
      } else if (dependency === "getSelection") {
        fixture.port.getSelection = async () => {
          throw failing;
        };
      } else if (dependency === "getTab") {
        fixture.port.getTab = async () => {
          throw failing;
        };
      } else if (dependency === "readFrame") {
        fixture.port.readFrame = async () => {
          throw failing;
        };
      } else {
        fixture.repositories.getFlowImagePromptSnapshot = async () => {
          throw failing;
        };
      }
      const response = await send(fixture, observation);
      expect(response).toMatchObject({
        accepted: false,
        code: `binding_check_exception_${stage}_error`,
      });
      expect(
        (
          await fixture.repositories.getFlowImageAttempt(
            fixture.attempt.attemptId,
          )
        )?.resultOutcome,
      ).toMatchObject({ status: "unknown", reason: "observation_lost" });
    },
  );

  it.each([
    [
      "debugger",
      "binding_check_exception_frame_inspection_cdp_transport_error",
    ],
    [
      "scripting",
      "binding_check_exception_frame_inspection_document_probe_error",
    ],
  ])(
    "classifies delayed Chrome %s transport failures through the production frame port",
    async (failingApi, expectedCode) => {
      const fixture = await makeFixture(1, "production_observation_only", true);
      const originalChrome = (globalThis as { chrome?: unknown }).chrome;
      const chromeStub = {
        tabs: {
          get: async () => ({ title: "fixture", url: canonicalTarget }),
        },
        debugger: {
          sendCommand: async (_target: unknown, method: string) => {
            if (failingApi === "debugger" && method === "Page.getFrameTree") {
              await new Promise((resolve) => setTimeout(resolve, 15));
              throw new Error("transport detail excluded from diagnostics");
            }
            return {
              frameTree: {
                frame: {
                  id: "fixture-frame",
                  loaderId: "fixture-loader",
                  url: canonicalTarget,
                },
              },
            };
          },
        },
        scripting: {
          executeScript: async () => {
            if (failingApi === "scripting") {
              await new Promise((resolve) => setTimeout(resolve, 15));
              throw new Error("probe detail excluded from diagnostics");
            }
            return [
              {
                documentId,
                frameId: 0,
                result: canonicalTarget,
              },
            ];
          },
        },
      };
      Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: chromeStub,
      });
      try {
        const port = createChromeFlowImageGenerateOncePort(
          fixture.repositories,
        );
        const handler = createFlowImageObservationHandler({
          extensionId: "fixture-extension",
          repositories: fixture.repositories,
          port,
          now: () => 1_100,
        });
        const response = await handler.handle(
          {
            type: "AUTOMAT_FLOW_IMAGE_OBSERVATION",
            protocolVersion: PROTOCOL_VERSION,
            buildId: BUILD_ID,
            observation: await structuralEvent(fixture.attempt, 1),
          },
          {
            id: "fixture-extension",
            tab: { id: tabId },
            frameId: 0,
            documentId,
          },
        );
        expect(response).toMatchObject({
          accepted: false,
          code: expectedCode,
        });
        expect(
          (
            await fixture.repositories.getFlowImageAttempt(
              fixture.attempt.attemptId,
            )
          )?.resultOutcome,
        ).toMatchObject({ status: "unknown", reason: "observation_lost" });
      } finally {
        if (originalChrome === undefined)
          delete (globalThis as { chrome?: unknown }).chrome;
        else
          Object.defineProperty(globalThis, "chrome", {
            configurable: true,
            value: originalChrome,
          });
      }
    },
  );

  it("turns production observer detach and timeout into explicit unknown outcomes", async () => {
    const detached = await makeFixture(1, "production_observation_only");
    expect(
      await send(
        detached,
        await structuralEvent(detached.attempt, 1, "observer_lost"),
      ),
    ).toMatchObject({ accepted: true, outcome: "unknown" });
    expect(
      (
        await detached.repositories.getFlowImageAttempt(
          detached.attempt.attemptId,
        )
      )?.observationSession?.status,
    ).toBe("lost");

    const timedOut = await makeFixture(1, "production_observation_only");
    expect(
      await send(
        timedOut,
        await structuralEvent(timedOut.attempt, 1, "observer_timed_out"),
      ),
    ).toMatchObject({ accepted: true, outcome: "unknown" });
    expect(
      (
        await timedOut.repositories.getFlowImageAttempt(
          timedOut.attempt.attemptId,
        )
      )?.observationSession?.status,
    ).toBe("timed_out");
    expect(
      (
        await timedOut.repositories.getFlowImageAttempt(
          timedOut.attempt.attemptId,
        )
      )?.resultOutcome,
    ).toMatchObject({ status: "unknown", reason: "observation_timeout" });
  });

  it("rejects a structural receipt for a different durable source baseline", async () => {
    const fixture = await makeFixture(1, "production_observation_only");
    const observation = await structuralEvent(fixture.attempt, 1);
    observation.sourceBaselineFingerprint = "c".repeat(64);
    expect(await send(fixture, observation)).toMatchObject({
      accepted: false,
      code: "observation_source_baseline_mismatch",
    });
    expect(
      (
        await fixture.repositories.getFlowImageAttempt(
          fixture.attempt.attemptId,
        )
      )?.resultOutcome,
    ).toMatchObject({ status: "unknown", reason: "binding_changed" });
  });

  it("classifies the real repository's invalid saved-source hash as source validation failure", async () => {
    const fixture = await makeFixture(1, "production_observation_only", true);
    const sourceTable = fixture.repositories.tables.flowImagePromptSnapshots;
    const originalGet = sourceTable.get;
    sourceTable.get = async (snapshotId) => {
      const source = await originalGet(snapshotId);
      return source
        ? { ...source, rawJsonBody: `${source.rawJsonBody} ` }
        : source;
    };
    const response = await send(
      fixture,
      await structuralEvent(fixture.attempt, 1),
    );
    sourceTable.get = originalGet;

    expect(response).toMatchObject({
      accepted: false,
      code: "binding_check_exception_source_snapshot_read_validation_error",
    });
    const saved = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    expect(saved?.resultOutcome).toMatchObject({
      status: "unknown",
      reason: "observation_lost",
    });
    expect(saved?.observationReceipts ?? []).toHaveLength(0);
  });

  it.each([
    ["document binding", "binding_document_id_mismatch"],
    ["project binding", "binding_tab_project_id_mismatch"],
  ])(
    "records a bounded diagnostic when the %s changes",
    async (_label, diagnostic) => {
      const fixture = await makeFixture(1, "production_observation_only");
      const changedPort = {
        ...fixture.port,
        ...(diagnostic === "binding_document_id_mismatch"
          ? {
              readFrame: async () => ({
                frameId: "fixture-frame",
                loaderId: "fixture-loader",
                documentId: "changed-document",
                senderFrameId: 0,
                url: canonicalTarget,
              }),
            }
          : {
              getTab: async () => ({
                id: tabId,
                title: "fixture",
                url: `https://flow.google.com/project/changed-project`,
                provider: "Flow" as const,
                projectId: "changed-project",
                canonicalTarget: `https://flow.google.com/project/changed-project`,
              }),
            }),
      };
      const handler = createFlowImageObservationHandler({
        extensionId: "fixture-extension",
        repositories: fixture.repositories,
        port: changedPort as never,
        now: () => 1_100,
        allowSyntheticProfile: true,
      });
      const accepted = await handler.handle(
        {
          type: "AUTOMAT_FLOW_IMAGE_OBSERVATION",
          protocolVersion: PROTOCOL_VERSION,
          buildId: BUILD_ID,
          observation: await structuralEvent(fixture.attempt, 1),
        },
        {
          id: "fixture-extension",
          tab: { id: tabId },
          frameId: 0,
          documentId,
        },
      );
      expect(accepted).toMatchObject({ accepted: false, code: diagnostic });
      const saved = await fixture.repositories.getFlowImageAttempt(
        fixture.attempt.attemptId,
      );
      expect(saved?.resultOutcome).toMatchObject({
        status: "unknown",
        reason: "binding_changed",
      });
      expect(saved?.observationSession?.status).toBe("lost");
      expect(saved?.observationReceipts ?? []).toHaveLength(0);
      expect(saved?.events.at(-1)?.code).toBe(diagnostic);
      expect(JSON.stringify(saved?.events.at(-1))).not.toContain(
        "changed-project",
      );
      expect(JSON.stringify(saved?.events.at(-1))).not.toContain(
        "changed-document",
      );
    },
  );

  it("blocks and diagnoses an observation from a different session", async () => {
    const fixture = await makeFixture(1, "production_observation_only");
    const observation = await structuralEvent(fixture.attempt, 1);
    observation.sessionId = "b1729ecb-938f-4f6d-85d4-9d46d933a355";
    expect(await send(fixture, observation)).toMatchObject({
      accepted: false,
      code: "observation_session_id_mismatch",
    });
    const saved = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    expect(saved?.observationSession?.status).toBe("lost");
    expect(saved?.resultOutcome).toMatchObject({
      status: "unknown",
      reason: "binding_changed",
    });
    expect(saved?.observationReceipts ?? []).toHaveLength(0);
    expect(saved?.events.at(-1)?.code).toBe("observation_session_id_mismatch");
  });

  it("blocks and diagnoses a mismatched project field in an otherwise valid event", async () => {
    const fixture = await makeFixture(1, "production_observation_only");
    const observation = await structuralEvent(fixture.attempt, 1);
    observation.binding = {
      ...observation.binding,
      projectId: "changed-project",
    };
    expect(await send(fixture, observation)).toMatchObject({
      accepted: false,
      code: "observation_event_binding_project_id_mismatch",
    });
    const saved = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    expect(saved?.observationSession?.status).toBe("lost");
    expect(saved?.resultOutcome).toMatchObject({
      status: "unknown",
      reason: "binding_changed",
    });
    expect(saved?.observationReceipts ?? []).toHaveLength(0);
    expect(saved?.events.at(-1)?.code).toBe(
      "observation_event_binding_project_id_mismatch",
    );
    expect(JSON.stringify(saved?.events.at(-1))).not.toContain(
      "changed-project",
    );
  });

  it("keeps an active observer's immutable binding intact during same-target verification", async () => {
    const fixture = await makeFixture(1, "production_observation_only");
    await fixture.repositories.setReconnectIntent("Flow", true);
    const selected = await fixture.repositories.getSelectedTarget("Flow");
    if (!selected) throw new Error("Flow target fixture missing");
    await fixture.repositories.recordTargetVerification(
      {
        provider: "Flow",
        tabId,
        canonicalTarget,
        projectId,
        frameId: 0,
        documentId,
        documentToken: "fixture-connector-token",
        extensionBuildId: BUILD_ID,
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: BUILD_ID,
        connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
        capability: CONNECTION_CAPABILITY,
        verifiedAt: 1_040,
      },
      selected.revision,
    );
    const selectedTab = {
      id: tabId,
      title: "fixture",
      url: canonicalTarget,
      provider: "Flow" as const,
      projectId,
      canonicalTarget,
    };
    let injectionCount = 0;
    const connectionPort: ConnectionPort = {
      getMissingAccess: async () => ({}),
      getTab: async () => selectedTab,
      pingTopFrame: async (_id, request) => ({
        ok: true,
        provider: "Flow",
        canonicalTarget,
        projectId,
        protocolVersion: CONNECTOR_PROTOCOL_VERSION,
        buildId: BUILD_ID,
        attemptId: request.attemptId,
        documentToken: "fixture-connector-token",
        capabilities: [CONNECTION_CAPABILITY],
      }),
      identifyDocument: async () => ({
        documentId,
        frameId: 0,
        url: canonicalTarget,
      }),
      injectConnector: async () => {
        injectionCount += 1;
        throw new Error("current_connector_must_not_be_replaced");
      },
      probeTopFrame: async (_id, _documentId, request) => ({
        ok: true,
        provider: "Flow",
        canonicalTarget,
        projectId,
        protocolVersion: CONNECTOR_PROTOCOL_VERSION,
        buildId: BUILD_ID,
        attemptId: request.attemptId,
        documentToken: "fixture-connector-token",
        capabilities: [CONNECTION_CAPABILITY],
      }),
      releaseConnector: async () => undefined,
      makeAttemptId: () => "fixture-readonly-check",
    };
    const service = createConnectionLifecycleService(
      fixture.repositories,
      () => connectionPort,
    );
    const before = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    const immutableSessionBinding = (
      session: typeof before extends undefined
        ? never
        : NonNullable<typeof before>["observationSession"],
    ) => {
      if (!session) return null;
      const { lastSequence: _lastSequence, ...binding } = session;
      void _lastSequence;
      return binding;
    };
    const beforeImmutable = {
      attemptId: before?.attemptId,
      projectId: before?.projectId,
      tabId: before?.tabId,
      frameId: before?.frameId,
      loaderId: before?.loaderId,
      documentId: before?.documentId,
      senderFrameId: before?.senderFrameId,
      buildId: before?.buildId,
      protocolVersion: before?.protocolVersion,
      session: immutableSessionBinding(before?.observationSession),
      baselineBinding: before?.resultBaseline?.binding,
    };

    const observation = await structuralEvent(
      fixture.attempt,
      1,
      "structural_snapshot",
    );
    const [revalidation, accepted] = await Promise.all([
      service.revalidate("Flow"),
      send(fixture, observation),
    ]);
    expect(revalidation).toMatchObject({
      ok: true,
      state: "verified",
      savedBindingComparison: {
        browserDocumentId: "match",
        liveConnectorBuild: "current",
        liveConnectorProtocol: "current",
      },
    });
    const after = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    expect({
      attemptId: after?.attemptId,
      projectId: after?.projectId,
      tabId: after?.tabId,
      frameId: after?.frameId,
      loaderId: after?.loaderId,
      documentId: after?.documentId,
      senderFrameId: after?.senderFrameId,
      buildId: after?.buildId,
      protocolVersion: after?.protocolVersion,
      session: immutableSessionBinding(after?.observationSession),
      baselineBinding: after?.resultBaseline?.binding,
    }).toEqual(beforeImmutable);
    expect(injectionCount).toBe(0);
    expect(after?.observationSession?.status).toBe("active");
    expect(after?.observationSession?.lastSequence).toBe(1);

    expect(accepted).toMatchObject({ accepted: true, duplicate: false });
    const afterReceipt = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    expect(
      afterReceipt?.observationReceipts?.map((receipt) => receipt.sequence),
    ).toEqual([1]);
    expect(afterReceipt?.resultOutcome?.reason).not.toBe("binding_changed");
  });

  it("resumes an existing production observation after restart without activation", async () => {
    const fixture = await makeFixture(1, "production_observation_only");
    const result = await fixture.handler.resumeReadOnlyAfterWorkerRestart();
    expect(result).toEqual({ resumed: 1, unknown: 0 });
    expect(
      (
        await fixture.repositories.getFlowImageAttempt(
          fixture.attempt.attemptId,
        )
      )?.observationSession,
    ).toMatchObject({ status: "active", reconciliationCount: 1 });
  });

  it("keeps restart binding-check exceptions distinct from confirmed binding changes", async () => {
    const fixture = await makeFixture(1, "production_observation_only");
    const handler = createFlowImageObservationHandler({
      extensionId: "fixture-extension",
      repositories: fixture.repositories,
      port: {
        ...fixture.port,
        getTab: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          throw new Error("temporary tab transport failure");
        },
      },
      now: () => 1_100,
    });
    expect(await handler.resumeReadOnlyAfterWorkerRestart()).toEqual({
      resumed: 0,
      unknown: 1,
    });
    const saved = await fixture.repositories.getFlowImageAttempt(
      fixture.attempt.attemptId,
    );
    expect(saved?.resultOutcome).toMatchObject({
      status: "unknown",
      reason: "observation_lost",
    });
    expect(saved?.events.at(-1)?.code).toBe(
      "binding_check_exception_tab_read_error",
    );
  });

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
    const sessionMismatchFixture = await makeFixture(1);
    expect(
      await send(
        sessionMismatchFixture,
        event(sessionMismatchFixture.attempt, 1, [duplicateThumbnail], {
          sessionId: "b1729ecb-938f-4f6d-85d4-9d46d933a355",
        }),
      ),
    ).toMatchObject({
      accepted: false,
      code: "observation_session_id_mismatch",
    });
    const documentMismatchFixture = await makeFixture(1);
    expect(
      await documentMismatchFixture.handler.handle(
        {
          type: "AUTOMAT_FLOW_IMAGE_OBSERVATION",
          protocolVersion: PROTOCOL_VERSION,
          buildId: BUILD_ID,
          observation: event(documentMismatchFixture.attempt, 1, [
            duplicateThumbnail,
          ]),
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
      code: "observation_sender_document_binding_mismatch",
    });
    expect(
      (
        await documentMismatchFixture.repositories.getFlowImageAttempt(
          documentMismatchFixture.attempt.attemptId,
        )
      )?.observationSession?.status,
    ).toBe("lost");
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
