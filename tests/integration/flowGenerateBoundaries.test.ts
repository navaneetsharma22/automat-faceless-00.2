import { describe, expect, it } from "vitest";
import {
  createFlowImageGenerateOnce,
  type FlowObservationArmDiagnostic,
} from "../../src/background/handlers/flow";
import {
  flowGenerateResponseLostOutcome,
  formatFlowGenerateOutcome,
} from "../../src/app/features/shared/ImportPanel";
import { createConnectionMessageListener } from "../../src/background/handlers/connections";
import {
  flowImageAttemptActiveKey,
  type FlowImageAttemptRecord,
  type FlowImageAttemptState,
} from "../../src/domain/jobs/attempt";
import {
  flowImageResultBaselineFingerprintInput,
  flowStructuralSnapshotFingerprintInput,
  type FlowStructuralObservationEvent,
} from "../../src/domain/jobs/results";
import { flowImagePromptSnapshotId } from "../../src/domain/batches/flowImagePromptSnapshot";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { activateFlowImageGenerate } from "../../src/platforms/flow/images";
import { createFlowObservationInjection } from "../../src/platforms/flow/observationProducer";
import type { FlowPromptEntryPort } from "../../src/platforms/flow/promptEntry";
import { createFoundationClient } from "../../src/shared/messageClient";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import type { FlowSettingsConfirmation } from "../../src/shared/schemas";
import {
  ChromePreferenceRepository,
  ExtensionRepositories,
  FlowImageAttemptValidationError,
} from "../../src/storage/repositories";
import type { ProviderTab } from "../../src/platforms/shared/contracts";
import { createMemoryRepositoryDatabase } from "../unit/repositoryTestSupport";

const prompt =
  '{\r\n  "shot_id": "01",\r\n  "scene": "SYNTHETIC test image"\r\n}';
const selectedTab: ProviderTab = {
  id: 41,
  title: "Flow local fixture",
  url: "https://flow.google.com/u/1/project/project_01?pli=1",
  provider: "Flow",
  projectId: "project_01",
  canonicalTarget: "https://flow.google.com/u/1/project/project_01",
};
const frame = {
  frameId: "top-frame-1",
  loaderId: "loader-1",
  documentId: "document-1",
  senderFrameId: 0,
  url: selectedTab.url,
};
const settingsConfirmation: FlowSettingsConfirmation = {
  confirmationId: "confirm-1",
  confirmedAt: 1_000,
  tabId: selectedTab.id,
  projectId: selectedTab.projectId,
  canonicalTarget: selectedTab.canonicalTarget,
  declaredVariantCount: 2,
};

function discovery(
  overrides: Partial<{
    composer: "identified" | "missing" | "ambiguous" | "unsupported";
    exactPrompt: boolean;
    generate: "identified" | "missing" | "ambiguous" | "disabled";
    observation: "ready" | "missing" | "ambiguous";
  }> = {},
) {
  return {
    composer: "identified" as const,
    exactPrompt: true,
    actualCodeUnits: prompt.length,
    generate: "identified" as const,
    observation: "ready" as const,
    baseline: {
      kind: "flow_rendered_tile_candidates" as const,
      workspaceTag: "flow-project-page" as const,
      renderedTileCount: 2,
      candidateIds: ["a".repeat(64), "b".repeat(64)],
      qualifyingCandidateIds: ["a".repeat(64), "b".repeat(64)],
      candidateMultiplicity: [
        { candidateId: "a".repeat(64), renderedCopies: 1 },
        { candidateId: "b".repeat(64), renderedCopies: 1 },
      ],
      repeatedCandidateCount: 0,
      unidentifiedImageCount: 0,
      unrelatedImageCount: 0,
      virtualized: false,
      loadingSignalCount: 0,
      captureGaps: [],
      capturedAt: 1_010,
    },
    buttonObjectId: "generate-button",
    generationAvailable: false as const,
    ...overrides,
  };
}

function makePort(
  options: {
    permission?: boolean;
    target?: ProviderTab;
    selection?: { tabId: number; canonicalTarget: string };
    frame?: typeof frame;
    generated?: ReturnType<typeof discovery>;
    recheck?: boolean;
    baselineChangesDuringRecheck?: boolean;
    position?: { x: number; y: number } | undefined;
    activation?: {
      complete: boolean;
      pressAttempted: boolean;
      releaseAttempted: boolean;
    };
    postDispatchReadFailure?: boolean;
    observationArm?: "started" | "unsupported" | "failed";
    observationArmDiagnostic?: FlowObservationArmDiagnostic;
    observationProfileSupported?: boolean;
    productionObservationSupported?: boolean;
    omitProductionArmReceipt?: boolean;
    productionArmSourceBaselineMismatch?: boolean;
    productionArmListenerRoots?: number;
    productionArmBaselineOverrides?: {
      completeForRenderedScope?: boolean;
      unidentifiedImageCount?: number;
      identityCandidatesTruncated?: boolean;
      captureGaps?: string[];
    };
  } = {},
) {
  const productionObservationSupported =
    options.productionObservationSupported ?? true;
  const selected = options.selection ?? {
    tabId: selectedTab.id,
    canonicalTarget: selectedTab.canonicalTarget,
  };
  const tab = options.target ?? selectedTab;
  const liveFrame = options.frame ?? frame;
  const calls: string[] = [];
  const lifecycle: string[] = [];
  const observationBindings: unknown[] = [];
  let activations = 0;
  let activationReturned = false;
  const port = {
    getSelection: async () => selected,
    getTab: async () => tab,
    hasRequiredApis: () => true,
    hasDebuggerPermission: async () => options.permission ?? true,
    attach: async () => undefined,
    detach: async () => undefined,
    sendCommand: async (_tabId: number, method: string) => {
      calls.push(method);
      return {};
    },
    captureFrame: async () => liveFrame,
    readFrame: async () => {
      if (activationReturned && options.postDispatchReadFailure)
        throw new Error("fixture observation unavailable");
      return liveFrame;
    },
    inspectGenerate: async () => options.generated ?? discovery(),
    recheckGenerate: async () =>
      options.baselineChangesDuringRecheck ? false : (options.recheck ?? true),
    buttonPosition: async () => options.position ?? { x: 10, y: 20 },
    activate: async () => {
      lifecycle.push("activate");
      activations += 1;
      activationReturned = true;
      return (
        options.activation ?? {
          complete: true,
          pressAttempted: true,
          releaseAttempted: true,
        }
      );
    },
    startObservation: async (_tabId: number, binding: unknown) => {
      lifecycle.push("start_observation");
      observationBindings.push(binding);
      if (options.observationArm === "failed")
        throw new Error("fixture observer start failed");
      if (options.observationArm === "unsupported")
        return options.observationArmDiagnostic
          ? {
              status: "unsupported",
              diagnostic: options.observationArmDiagnostic,
            }
          : "unsupported";
      if (productionObservationSupported) {
        if (options.omitProductionArmReceipt) return "started";
        return {
          status: "started",
          receipt: {
            capturedAt: 1_050,
            sourceBaselineFingerprint:
              options.productionArmSourceBaselineMismatch
                ? "c".repeat(64)
                : (binding as { sourceBaselineFingerprint: string })
                    .sourceBaselineFingerprint,
            captureFingerprint: "a".repeat(64),
            listenerRootCount: options.productionArmListenerRoots ?? 1,
            baseline: {
              completeForRenderedScope: true,
              virtualized: false,
              tileCount: 2,
              mediaCandidateCount: 2,
              identityCandidateCount: 0,
              identityCandidatesTruncated: false,
              unidentifiedImageCount: 0,
              lifecycleSignalCount: 0,
              resourceEventCount: 0,
              captureGaps: [],
              candidateIds: ["a".repeat(64), "b".repeat(64)],
              qualifyingCandidateIds: ["a".repeat(64), "b".repeat(64)],
              tileTokens: ["tile-1", "tile-2"],
              candidateTileRelationships: [
                { candidateId: "a".repeat(64), tileToken: "tile-1" },
                { candidateId: "b".repeat(64), tileToken: "tile-2" },
              ],
              ...options.productionArmBaselineOverrides,
            },
          },
        };
      }
      return {
        status: "started",
        receipt: {
          capturedAt: 1_050,
          sourceBaselineFingerprint: (
            binding as { sourceBaselineFingerprint: string }
          ).sourceBaselineFingerprint,
          captureFingerprint: "a".repeat(64),
          listenerRootCount: 1,
          baseline: {
            completeForRenderedScope: true,
            virtualized: false,
            tileCount: 2,
            mediaCandidateCount: 2,
            identityCandidateCount: 0,
            identityCandidatesTruncated: false,
            unidentifiedImageCount: 0,
            lifecycleSignalCount: 0,
            resourceEventCount: 0,
            captureGaps: [],
            candidateIds: ["a".repeat(64), "b".repeat(64)],
            qualifyingCandidateIds: ["a".repeat(64), "b".repeat(64)],
            tileTokens: ["tile-1", "tile-2"],
            candidateTileRelationships: [
              { candidateId: "a".repeat(64), tileToken: "tile-1" },
              { candidateId: "b".repeat(64), tileToken: "tile-2" },
            ],
          },
        },
      };
    },
    stopObservation: async () => {
      lifecycle.push("stop_observation");
    },
    activateObservation: async () => {
      lifecycle.push("activate_observation");
      return "started";
    },
    resumeObservation: async () => "resumed",
    productionObservationSupported,
  } as unknown as FlowPromptEntryPort & {
    captureFrame: () => Promise<typeof frame>;
    readFrame: () => Promise<typeof frame>;
    inspectGenerate: () => Promise<ReturnType<typeof discovery>>;
    recheckGenerate: () => Promise<boolean>;
    buttonPosition: () => Promise<{ x: number; y: number } | undefined>;
    activate: () => Promise<{
      complete: boolean;
      pressAttempted: boolean;
      releaseAttempted: boolean;
    }>;
    startObservation: (tabId: number, binding: unknown) => Promise<string>;
    stopObservation: () => Promise<void>;
  };
  return {
    port,
    calls,
    get activations() {
      return activations;
    },
    lifecycle,
    observationBindings,
    observationProfileSupported: options.observationProfileSupported,
  };
}

async function setup(options: Parameters<typeof makePort>[0] = {}) {
  const repositories = new ExtensionRepositories(
    createMemoryRepositoryDatabase(),
    () => 1_100,
  );
  const saved = await repositories.savePromptBatch({
    workspaceId: "default",
    kind: "image",
    sourceText: prompt,
  });
  await repositories.recordSelectedTarget({
    provider: "Flow",
    tabId: selectedTab.id,
    canonicalTarget: selectedTab.canonicalTarget,
  });
  await repositories.setReconnectIntent("Flow", true);
  const selected = await repositories.getSelectedTarget("Flow");
  if (!selected) throw new Error("Flow selection fixture missing");
  await repositories.recordTargetVerification(
    {
      provider: "Flow",
      tabId: selectedTab.id,
      canonicalTarget: selectedTab.canonicalTarget,
      projectId: selectedTab.projectId,
      frameId: 0,
      documentId: frame.documentId,
      documentToken: "fixture-connector-document-token",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: 1,
      capability: "read-only-connection-v1",
      verifiedAt: 1_000,
    },
    selected.revision,
  );
  const fixture = makePort(options);
  let id = 0;
  const fillCalls: Array<{ sourceText: string; expectedFrame: unknown }> = [];
  const fillPrompt = async (sourceText: string, expectedFrame: unknown) => {
    fillCalls.push({ sourceText, expectedFrame });
    return {
      fillVerified: true,
      settledMatch: true,
      stableReadback: true,
      inputMethod: "CDP Input.insertText" as const,
      outcome: "filled",
      code: "fill_verified",
    };
  };
  const generate = createFlowImageGenerateOnce({
    repositories,
    port: fixture.port as never,
    fillPrompt,
    now: () => 1_100,
    createAttemptId: () => `attempt-${++id}`,
    observationProfileSupported: fixture.observationProfileSupported,
  });
  const preferences = new ChromePreferenceRepository({
    get: async () => ({}),
    set: async () => undefined,
  });
  const listener = createConnectionMessageListener("test-extension", {
    repositories,
    preferences,
    flowImageGenerateOnce: generate,
  });
  const client = createFoundationClient({
    sendMessage: (request) =>
      new Promise((resolve) =>
        listener(
          request,
          {
            id: "test-extension",
            url: "chrome-extension://test-extension/index.html",
          },
          resolve,
        ),
      ),
  });
  const payload = {
    workspaceId: "default",
    promptHash: await sha256Hex(prompt),
    settingsConfirmation,
    countMode: {
      mode: "existing_project" as const,
      countSessionId: "8ca777a9-09a4-4640-82e1-8ece47164153",
      startingImageCount: 2,
      userConfirmed: true as const,
    },
  };
  return {
    repositories,
    saved,
    fixture,
    fillCalls,
    generate,
    client,
    payload,
  };
}

describe("P04 durable Flow image Generate attempt", () => {
  it("targets the exact browser document and isolated frame for observation injection", () => {
    const injection = createFlowObservationInjection(
      {
        workspaceId: "default",
        batchId: "batch-1",
        itemId: "item-1",
        sourceHash: "a".repeat(64),
        sourceSnapshotId: "snapshot-1",
        sourceBaselineFingerprint: "b".repeat(64),
        attemptId: "attempt-1",
        provider: "Flow",
        projectId: selectedTab.projectId,
        canonicalTarget: selectedTab.canonicalTarget,
        tabId: selectedTab.id,
        frameId: "frame-1",
        loaderId: "loader-1",
        documentId: "browser-document-1",
        senderFrameId: 0,
        sessionId: "d7a5ea61-9721-4a65-8485-798f2f4e0c11",
        startedAt: 10,
        deadlineAt: 20,
        maxEvents: 64,
        buildId: BUILD_ID,
        protocolVersion: PROTOCOL_VERSION,
      },
      "arm",
    );
    expect(injection.target).toEqual({
      tabId: selectedTab.id,
      documentIds: ["browser-document-1"],
    });
    expect(injection.world).toBe("ISOLATED");
    expect(injection.args[1]).toBe("arm");
  });

  it("persists context, verifies exact fill, and dispatches one mouse pair", async () => {
    const test = await setup();
    const result = (await test.client.request(
      "flow.image.generateOnce",
      test.payload,
    )) as { state: string; activationCount: number; attemptId: string };
    const attempts = await test.repositories.getAllFlowImageAttempts();
    expect(result).toMatchObject({
      state: "dispatched",
      activationCount: 1,
      attemptId: "attempt-1",
    });
    expect(test.fixture.activations).toBe(1);
    expect(test.fillCalls).toHaveLength(1);
    expect(test.fillCalls[0]?.sourceText).toBe(prompt);
    expect(test.fillCalls[0]?.expectedFrame).toMatchObject({
      frameId: frame.frameId,
      loaderId: frame.loaderId,
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      workspaceId: "default",
      batchId: test.saved.batch.id,
      itemId: test.saved.items[0]?.id,
      sourceSnapshotId: flowImagePromptSnapshotId(
        test.saved.items[0]!.id,
        await sha256Hex(prompt),
      ),
      shotId: "1",
      promptHash: await sha256Hex(prompt),
      projectId: "project_01",
      tabId: selectedTab.id,
      frameId: frame.frameId,
      loaderId: frame.loaderId,
      state: "dispatched",
      settingsConfirmation: {
        userAttested: true,
        projectId: "project_01",
        canonicalTarget: selectedTab.canonicalTarget,
      },
      baseline: {
        kind: "flow_rendered_tile_candidates",
        renderedTileCount: 2,
        candidateIds: ["a".repeat(64), "b".repeat(64)],
      },
      resultBaseline: {
        schemaVersion: 1,
        binding: {
          workspaceId: "default",
          batchId: test.saved.batch.id,
          itemId: test.saved.items[0]?.id,
          sourceHash: await sha256Hex(prompt),
          sourceSnapshotId: flowImagePromptSnapshotId(
            test.saved.items[0]!.id,
            await sha256Hex(prompt),
          ),
          attemptId: "attempt-1",
          provider: "Flow",
          projectId: "project_01",
          tabId: selectedTab.id,
          frameId: frame.frameId,
          loaderId: frame.loaderId,
        },
        observation: {
          profile: "flow_rendered_tile_candidates",
          profileVersion: 1,
          renderedTileCount: 2,
          candidateIds: ["a".repeat(64), "b".repeat(64)],
          candidateMultiplicity: [
            { candidateId: "a".repeat(64), renderedCopies: 1 },
            { candidateId: "b".repeat(64), renderedCopies: 1 },
          ],
          repeatedCandidateCount: 0,
          unidentifiedImageCount: 0,
          unrelatedImageCount: 0,
          virtualized: false,
          loadingSignalCount: 0,
          captureGaps: [],
        },
        completeness: "incomplete",
        variantDeclaration: {
          status: "declared",
          count: 2,
          source: "validated_settings_confirmation",
        },
        existingResultIdentities: [],
      },
    });
    expect(attempts[0]?.resultBaseline?.excludedObservations.count).toBe(2);
    expect("prompt" in attempts[0]!).toBe(false);
    expect(
      (await test.repositories.getPromptBatch("default", "image"))?.items[0]
        ?.rawJsonBody,
    ).toBe(prompt);
    expect(
      await test.repositories.getFlowImagePromptSnapshot(
        attempts[0]!.sourceSnapshotId,
      ),
    ).toMatchObject({
      rawJsonBody: prompt,
      promptHash: await sha256Hex(prompt),
    });
  });

  it("has the bound result baseline durably stored before the activation call", async () => {
    const test = await setup({ observationProfileSupported: true });
    const activate = test.fixture.port.activate.bind(test.fixture.port);
    let stateAtActivation: string | undefined;
    let resultBaselineAtActivation: unknown;
    let sessionStatusAtActivation: string | undefined;
    test.fixture.port.activate = async (...args) => {
      const attempt = (await test.repositories.getAllFlowImageAttempts())[0];
      stateAtActivation = attempt?.state;
      resultBaselineAtActivation = attempt?.resultBaseline;
      sessionStatusAtActivation = attempt?.observationSession?.status;
      return activate(...args);
    };

    const result = await test.generate(test.payload);
    expect(result.state).toBe("dispatched");
    expect(stateAtActivation).toBe("dispatch-intent");
    expect(sessionStatusAtActivation).toBe("active");
    expect(test.fixture.lifecycle.indexOf("start_observation")).toBeLessThan(
      test.fixture.lifecycle.indexOf("activate"),
    );
    expect(test.fixture.observationBindings[0]).toMatchObject({
      workspaceId: "default",
      batchId: test.saved.batch.id,
      itemId: test.saved.items[0]?.id,
      sourceHash: await sha256Hex(prompt),
      sourceSnapshotId: flowImagePromptSnapshotId(
        test.saved.items[0]!.id,
        await sha256Hex(prompt),
      ),
      attemptId: "attempt-1",
      provider: "Flow",
      projectId: selectedTab.projectId,
      tabId: selectedTab.id,
      frameId: frame.frameId,
      loaderId: frame.loaderId,
      documentId: frame.documentId,
      senderFrameId: frame.senderFrameId,
      sessionId: expect.any(String),
    });
    expect(resultBaselineAtActivation).toMatchObject({
      binding: {
        attemptId: "attempt-1",
        sourceSnapshotId: flowImagePromptSnapshotId(
          test.saved.items[0]!.id,
          await sha256Hex(prompt),
        ),
        projectId: selectedTab.projectId,
        tabId: selectedTab.id,
        frameId: frame.frameId,
        loaderId: frame.loaderId,
      },
      variantDeclaration: {
        status: "declared",
        count: 2,
        source: "validated_settings_confirmation",
      },
    });
  });

  it("fails closed before activation when the bound observer cannot arm", async () => {
    const test = await setup({
      observationProfileSupported: true,
      observationArm: "unsupported",
      observationArmDiagnostic: {
        phase: "arm_injection",
        reason: "injection_exception",
        exceptionName: "Error",
      },
    });

    const result = await test.generate(test.payload);
    const [attempt] = await test.repositories.getAllFlowImageAttempts();

    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      failureStage: "observer",
      code: "observation_start_unsupported",
      activationCount: 0,
    });
    expect(test.fixture.activations).toBe(0);
    expect(attempt?.state).toBe("failed-before-dispatch");
    expect(attempt?.events.at(-1)?.code).toBe(
      "observer_arm_injection_injection_exception",
    );
    expect(attempt?.observationSession?.status).toBe("closed");
    expect(attempt?.resultOutcome).toMatchObject({
      status: "unknown",
      reason: "observation_not_started",
    });
  });

  it("arms the production observation-only profile before input and binds it to the immutable baseline", async () => {
    const test = await setup({ productionObservationSupported: true });
    const result = await test.generate(test.payload);
    expect(result.state).toBe("dispatched");
    const [attempt] = await test.repositories.getAllFlowImageAttempts();
    expect(attempt?.observationSession?.armReceipt).toMatchObject({
      capturedAt: 1_050,
      sourceBaselineFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      captureFingerprint: "a".repeat(64),
      listenerRootCount: 1,
      baseline: { completeForRenderedScope: true, tileCount: 2 },
    });
    expect(test.fixture.lifecycle.indexOf("start_observation")).toBeLessThan(
      test.fixture.lifecycle.indexOf("activate_observation"),
    );
    expect(test.fixture.lifecycle.indexOf("activate_observation")).toBeLessThan(
      test.fixture.lifecycle.indexOf("activate"),
    );
    expect(test.fixture.observationBindings[0]).toMatchObject({
      attemptId: "attempt-1",
      projectId: selectedTab.projectId,
      canonicalTarget: selectedTab.canonicalTarget,
      tabId: selectedTab.id,
      frameId: frame.frameId,
      documentId: frame.documentId,
      senderFrameId: 0,
      sourceHash: await sha256Hex(prompt),
      sourceSnapshotId: flowImagePromptSnapshotId(
        test.saved.items[0]!.id,
        await sha256Hex(prompt),
      ),
      sessionId: expect.any(String),
      sourceBaselineFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      buildId: BUILD_ID,
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it("allows a second prompt with the same settings attestation only after durable count match", async () => {
    const test = await setup();
    const first = await test.generate(test.payload);
    expect(first.state).toBe("dispatched");
    const firstAttempt = (
      await test.repositories.getAllFlowImageAttempts()
    )[0]!;
    const snapshot: FlowStructuralObservationEvent["snapshot"] = {
      completeForRenderedScope: true,
      virtualized: false,
      unidentifiedImageCount: 0,
      tiles: [
        { tileToken: "tile-3", tag: "flow-image-tile", visible: true },
        { tileToken: "tile-4", tag: "flow-image-tile", visible: true },
      ],
      mediaCandidates: [
        {
          candidateId: "c".repeat(64),
          mediaToken: "media-3",
          tileToken: "tile-3",
          visible: true,
          complete: true,
          naturalWidth: 100,
          naturalHeight: 100,
        },
        {
          candidateId: "d".repeat(64),
          mediaToken: "media-4",
          tileToken: "tile-4",
          visible: true,
          complete: true,
          naturalWidth: 100,
          naturalHeight: 100,
        },
      ],
      identityCandidates: [],
      identityCandidatesTruncated: false,
      resourceEvents: [],
      lifecycleSignals: [],
      captureGaps: [],
    };
    const observation: FlowStructuralObservationEvent = {
      kind: "structural_snapshot",
      attemptId: firstAttempt.attemptId,
      sessionId: firstAttempt.observationSession!.sessionId,
      observationId: "00000000-0000-4000-8000-000000000010",
      sequence: 1,
      observedAt: 1_200,
      profile: "flow_tile_candidate_structure_v1",
      binding: firstAttempt.resultBaseline!.binding,
      sourceBaselineFingerprint: await sha256Hex(
        flowImageResultBaselineFingerprintInput(firstAttempt.resultBaseline!),
      ),
      captureFingerprint: await sha256Hex(
        flowStructuralSnapshotFingerprintInput(snapshot),
      ),
      snapshot,
    };
    await test.repositories.recordFlowImageObservation({
      attemptId: firstAttempt.attemptId,
      event: observation,
      fingerprint: await sha256Hex(JSON.stringify(observation)),
      receivedAt: 1_201,
    });
    const matched = await test.repositories.getFlowImageAttempt(
      firstAttempt.attemptId,
    );
    expect(matched?.countDecision).toMatchObject({
      status: "count_matched",
      expectedCumulativeAdditions: 2,
      expectedTotal: 4,
      observedEligibleCandidateIds: ["c".repeat(64), "d".repeat(64)],
    });
    expect(matched?.resultOutcome?.status).toBe("unknown");

    const replacement = '{"shot_id":"02","scene":"SYNTHETIC next prompt"}';
    await test.repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: replacement,
    });
    const second = await test.generate({
      workspaceId: "default",
      promptHash: await sha256Hex(replacement),
      settingsConfirmation,
      countMode: test.payload.countMode,
    });
    expect(second).toMatchObject({ state: "dispatched", activationCount: 1 });
    const attempts = await test.repositories.getAllFlowImageAttempts();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.settingsConfirmation.confirmationId).toBe(
      attempts[0]?.settingsConfirmation.confirmationId,
    );
    expect(attempts[1]?.settingsConfirmation.declaredVariantCount).toBe(2);
    expect(attempts[1]?.countDecision).toMatchObject({
      expectedCumulativeAdditions: 4,
      expectedTotal: 6,
      priorMatchedAttemptIds: [firstAttempt.attemptId],
    });
  });

  it("refuses production activation when an observer arm receipt is missing", async () => {
    const test = await setup({
      productionObservationSupported: true,
      omitProductionArmReceipt: true,
    });
    const result = await test.generate(test.payload);
    const [attempt] = await test.repositories.getAllFlowImageAttempts();
    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      code: "observation_start_unsupported",
      activationCount: 0,
    });
    expect(test.fixture.activations).toBe(0);
    expect(attempt?.observationSession?.armReceipt).toBeUndefined();
    expect(test.fixture.lifecycle).toContain("stop_observation");
  });

  it.each([
    ["incomplete rendered baseline", { completeForRenderedScope: false }],
    ["baseline capture gaps", { captureGaps: ["project_scan_truncated"] }],
    ["unidentified images", { unidentifiedImageCount: 1 }],
    ["truncated identity candidates", { identityCandidatesTruncated: true }],
  ])(
    "refuses production activation with %s in the arm receipt",
    async (_label, baselineOverrides) => {
      const test = await setup({
        productionObservationSupported: true,
        productionArmBaselineOverrides: baselineOverrides,
      });

      const result = await test.generate(test.payload);
      const [attempt] = await test.repositories.getAllFlowImageAttempts();

      expect(result).toMatchObject({
        state: "failed-before-dispatch",
        failureStage: "observer",
        code: "observation_start_unsupported",
        activationCount: 0,
      });
      expect(test.fixture.activations).toBe(0);
      expect(attempt?.state).toBe("failed-before-dispatch");
      expect(attempt?.observationSession?.armReceipt).toBeUndefined();
      expect(test.fixture.lifecycle).not.toContain("activate");
      expect(test.fixture.lifecycle).toContain("stop_observation");
    },
  );

  it("refuses production activation when the arm receipt reports no attached listeners", async () => {
    const test = await setup({
      productionObservationSupported: true,
      productionArmListenerRoots: 0,
    });

    const result = await test.generate(test.payload);
    const [attempt] = await test.repositories.getAllFlowImageAttempts();

    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      code: "observation_start_unsupported",
      activationCount: 0,
    });
    expect(test.fixture.activations).toBe(0);
    expect(attempt?.state).toBe("failed-before-dispatch");
    expect(test.fixture.lifecycle).toContain("stop_observation");
  });

  it("refuses production activation when the arm receipt source baseline does not match the attempt", async () => {
    const test = await setup({
      productionObservationSupported: true,
      productionArmSourceBaselineMismatch: true,
    });

    const result = await test.generate(test.payload);
    const [attempt] = await test.repositories.getAllFlowImageAttempts();

    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      failureStage: "observer",
      code: "observation_start_unsupported",
      activationCount: 0,
    });
    expect(test.fixture.activations).toBe(0);
    expect(attempt?.state).toBe("failed-before-dispatch");
    expect(test.fixture.lifecycle).toContain("stop_observation");
  });

  it("leaves a changed baseline before dispatch failed closed with no baseline-bound intent", async () => {
    const test = await setup({ baselineChangesDuringRecheck: true });
    const result = await test.generate(test.payload);
    const [attempt] = await test.repositories.getAllFlowImageAttempts();

    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      code: "final_preflight_changed",
      activationCount: 0,
    });
    expect(attempt?.state).toBe("failed-before-dispatch");
    expect(attempt).not.toHaveProperty("resultBaseline");
    expect(test.fixture.activations).toBe(0);
  });

  it("keeps the attempted source immutable when the latest saved batch is replaced", async () => {
    const test = await setup();
    const createAttempt = test.repositories.createFlowImageAttempt.bind(
      test.repositories,
    );
    const replacement = '{"shot_id":"02","scene":"SYNTHETIC later save"}';
    test.repositories.createFlowImageAttempt = async (input) => {
      const record = await createAttempt(input);
      await test.repositories.savePromptBatch({
        workspaceId: "default",
        kind: "image",
        sourceText: replacement,
      });
      return record;
    };

    const result = await test.generate(test.payload);
    const attempt = (await test.repositories.getAllFlowImageAttempts())[0]!;
    const immutableSource = await test.repositories.getFlowImagePromptSnapshot(
      attempt.sourceSnapshotId,
    );
    const currentBatch = await test.repositories.getPromptBatch(
      "default",
      "image",
    );

    expect(result.state).toBe("dispatched");
    expect(test.fillCalls[0]?.sourceText).toBe(prompt);
    expect(immutableSource?.rawJsonBody).toBe(prompt);
    expect(currentBatch?.items[0]?.rawJsonBody).toBe(replacement);
    expect(attempt.promptHash).toBe(await sha256Hex(prompt));
    expect(attempt.promptHash).not.toBe(await sha256Hex(replacement));
  });

  it("pauses before another prompt while the prior count decision is unresolved", async () => {
    const test = await setup();
    const first = await test.generate(test.payload);
    const replacement = '{"shot_id":"02","scene":"SYNTHETIC shot two"}';
    const replaced = await test.repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: replacement,
    });
    const replacementHash = await sha256Hex(replacement);
    const replacementPayload = {
      workspaceId: "default",
      promptHash: replacementHash,
      settingsConfirmation: {
        ...settingsConfirmation,
        confirmationId: "confirm-shot-two",
      },
      countMode: test.payload.countMode,
    };

    expect(first.state).toBe("dispatched");
    expect(replaced.items[0]?.id).toBe(test.saved.items[0]?.id);
    expect(replaced.items[0]?.shotId).toBe("2");
    expect(replaced.items[0]?.contentHash).toBe(replacementHash);

    const second = await test.generate(replacementPayload);
    const attempts = await test.repositories.getAllFlowImageAttempts();
    expect(second).toMatchObject({
      state: "blocked",
      code: "count_session_paused",
      activationCount: 0,
    });
    expect(test.fixture.activations).toBe(1);
    expect(attempts).toHaveLength(1);
  });

  it("does not allow a fresh count session to bypass an unresolved attempt on the same document", async () => {
    const test = await setup();
    expect((await test.generate(test.payload)).state).toBe("dispatched");
    const replacement = '{"shot_id":"02","scene":"SYNTHETIC second shot"}';
    await test.repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: replacement,
    });
    const second = await test.generate({
      workspaceId: "default",
      promptHash: await sha256Hex(replacement),
      settingsConfirmation: {
        ...settingsConfirmation,
        confirmationId: "confirm-second-session",
      },
      countMode: {
        mode: "existing_project",
        countSessionId: "a7d4a5c2-f2f2-4fb6-9c51-4cf1777c99c1",
        startingImageCount: 2,
        userConfirmed: true,
      },
    });
    expect(second).toMatchObject({
      state: "blocked",
      code: "count_session_paused",
      activationCount: 0,
    });
    expect(test.fixture.activations).toBe(1);
    expect(await test.repositories.getAllFlowImageAttempts()).toHaveLength(1);
  });

  it("blocks Generate when the attempt's immutable source snapshot is unavailable", async () => {
    const test = await setup();
    test.repositories.getFlowImagePromptSnapshot = async () => undefined;

    const result = await test.generate(test.payload);

    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      code: "source_snapshot_mismatch",
    });
    expect(test.fixture.activations).toBe(0);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "failed-before-dispatch",
    );
  });

  it("blocks Generate when the attempt's immutable source snapshot mismatches", async () => {
    const test = await setup();
    const item = test.saved.items[0]!;
    test.repositories.getFlowImagePromptSnapshot = async (snapshotId) => ({
      snapshotId,
      workspaceId: "default",
      batchId: test.saved.batch.id,
      itemId: item.id,
      promptHash: await sha256Hex(prompt),
      rawJsonBody: "{}",
      promptCodeUnits: 2,
      promptUtf8Bytes: 2,
      createdAt: 1_100,
    });

    const result = await test.generate(test.payload);

    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      code: "source_snapshot_mismatch",
    });
    expect(test.fixture.activations).toBe(0);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "failed-before-dispatch",
    );
  });

  it("sends one CDP press/release pair and never repeats a failed press", async () => {
    const commands: Array<{ method: string; type?: string }> = [];
    const port = {
      attach: async () => undefined,
      detach: async () => undefined,
      sendCommand: async (
        _tabId: number,
        method: string,
        params?: { type?: string },
      ) => {
        commands.push({ method, type: params?.type });
        return {};
      },
    } as unknown as FlowPromptEntryPort;
    const complete = await activateFlowImageGenerate(
      port,
      selectedTab.id,
      10,
      20,
    );
    expect(complete).toEqual({
      complete: true,
      pressAttempted: true,
      releaseAttempted: true,
    });
    expect(commands).toEqual([
      { method: "Input.dispatchMouseEvent", type: "mousePressed" },
      { method: "Input.dispatchMouseEvent", type: "mouseReleased" },
    ]);

    commands.length = 0;
    const failingPort = {
      ...port,
      sendCommand: async (
        _tabId: number,
        method: string,
        params?: { type?: string },
      ) => {
        commands.push({ method, type: params?.type });
        if (params?.type === "mousePressed") throw new Error("unknown result");
        return {};
      },
    } as unknown as FlowPromptEntryPort;
    const partial = await activateFlowImageGenerate(
      failingPort,
      selectedTab.id,
      10,
      20,
    );
    expect(partial).toEqual({
      complete: false,
      pressAttempted: true,
      releaseAttempted: true,
    });
    expect(commands.map((command) => command.type)).toEqual([
      "mousePressed",
      "mouseReleased",
    ]);
  });

  it("blocks concurrent clicks durably across distinct request IDs", async () => {
    const test = await setup();
    let releaseFill!: () => void;
    const pendingFill = new Promise<void>((resolve) => {
      releaseFill = resolve;
    });
    test.generate = createFlowImageGenerateOnce({
      repositories: test.repositories,
      port: test.fixture.port as never,
      fillPrompt: async () => {
        await pendingFill;
        return {
          fillVerified: true,
          settledMatch: true,
          stableReadback: true,
          inputMethod: "CDP Input.insertText",
          outcome: "filled",
          code: "fill_verified",
        };
      },
      now: () => 1_100,
      createAttemptId: () => "concurrent-attempt",
    });
    const first = test.generate(test.payload);
    while ((await test.repositories.getAllFlowImageAttempts()).length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const second = await test.generate(test.payload);
    releaseFill();
    const firstResult = await first;
    expect(second.code).toBe("attempt_already_active");
    expect(firstResult.state).toBe("dispatched");
    expect(test.fixture.activations).toBe(1);
    expect(await test.repositories.getAllFlowImageAttempts()).toHaveLength(1);
  });

  it("requires a fresh attestation after a definite pre-dispatch failure", async () => {
    const test = await setup({ recheck: false });
    const first = await test.generate(test.payload);
    expect(first.state).toBe("failed-before-dispatch");
    expect(test.fixture.activations).toBe(0);
    const repeated = await test.generate(test.payload);
    expect(repeated.code).toBe("duplicate_generate_click");
    expect(test.fixture.activations).toBe(0);
    expect(await test.repositories.getAllFlowImageAttempts()).toHaveLength(1);
  });

  it.each([
    ["permission", { permission: false }, "debugger_permission_missing"],
    [
      "disabled Generate",
      { generated: discovery({ generate: "disabled" }) },
      "generate_disabled",
    ],
    [
      "ambiguous Generate",
      { generated: discovery({ generate: "ambiguous" }) },
      "generate_ambiguous",
    ],
    [
      "missing observation",
      { generated: discovery({ observation: "missing" }) },
      "observation_missing",
    ],
    [
      "wrong readback",
      { generated: discovery({ exactPrompt: false }) },
      "prompt_readback_mismatch",
    ],
    ["binding loss", { recheck: false }, "final_preflight_changed"],
  ] as const)("issues zero activation for %s", async (_name, options, code) => {
    const test = await setup(options);
    if (options.generated?.exactPrompt === false) {
      test.generate = createFlowImageGenerateOnce({
        repositories: test.repositories,
        port: test.fixture.port as never,
        fillPrompt: async () => ({
          fillVerified: true,
          settledMatch: true,
          stableReadback: true,
          inputMethod: "none",
          outcome: "already-matching",
          code: "already_matching_verified",
        }),
        now: () => 1_100,
        createAttemptId: () => "no-readback",
      });
    }
    const result = await test.generate(test.payload);
    expect(result.code).toBe(code);
    expect(result.activationCount).toBe(0);
    expect(test.fixture.activations).toBe(0);
  });

  it("blocks source hash, target, and settings-context changes", async () => {
    const badHash = await setup();
    expect(
      (
        await badHash.generate({
          ...badHash.payload,
          promptHash: "0".repeat(64),
        })
      ).code,
    ).toBe("saved_prompt_changed");

    const wrongTarget = await setup({
      target: {
        ...selectedTab,
        projectId: "project_02",
        canonicalTarget: "https://flow.google.com/u/1/project/project_02",
        url: "https://flow.google.com/u/1/project/project_02",
      },
    });
    expect((await wrongTarget.generate(wrongTarget.payload)).code).toBe(
      "flow_document_changed",
    );

    const wrongAttestation = await setup();
    expect(
      (
        await wrongAttestation.generate({
          ...wrongAttestation.payload,
          settingsConfirmation: {
            ...settingsConfirmation,
            projectId: "another-project",
          },
        })
      ).code,
    ).toBe("settings_confirmation_stale");
    const accountRouteChangedAttestation = await setup();
    expect(
      (
        await accountRouteChangedAttestation.generate({
          ...accountRouteChangedAttestation.payload,
          settingsConfirmation: {
            ...settingsConfirmation,
            canonicalTarget: "https://flow.google.com/u/2/project/project_01",
          },
        })
      ).code,
    ).toBe("settings_confirmation_stale");
    expect(
      badHash.fixture.activations +
        wrongTarget.fixture.activations +
        wrongAttestation.fixture.activations +
        accountRouteChangedAttestation.fixture.activations,
    ).toBe(0);
  });

  it("preserves uncertain delivery after a partial press/release result", async () => {
    const test = await setup({
      activation: {
        complete: false,
        pressAttempted: true,
        releaseAttempted: false,
      },
    });
    const result = await test.generate(test.payload);
    expect(result).toMatchObject({
      state: "uncertain",
      activationCount: 1,
      pressAttempted: true,
      releaseAttempted: false,
    });
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "uncertain",
    );
    expect((await test.generate(test.payload)).code).toBe(
      "attempt_already_active",
    );
  });

  it("keeps dispatch intent active if post-input persistence cannot settle", async () => {
    const test = await setup();
    const transition = test.repositories.transitionFlowImageAttempt.bind(
      test.repositories,
    );
    test.repositories.transitionFlowImageAttempt = async (input) => {
      if (input.next === "dispatched" || input.next === "uncertain") {
        throw new Error("controlled storage failure");
      }
      return transition(input);
    };
    const result = await test.generate(test.payload);
    expect(result).toMatchObject({
      state: "uncertain",
      failureStage: "storage",
      providerOutcome: "unknown",
    });
    expect(result.activationCount).toBe(1);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "dispatch-intent",
    );
    test.repositories.transitionFlowImageAttempt = transition;
    const recovered =
      await test.repositories.reconcileInterruptedFlowImageAttempts();
    expect(recovered.uncertain).toBe(1);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "uncertain",
    );
  });

  it("marks a failed dispatch-intent write before activation", async () => {
    const test = await setup();
    const transition = test.repositories.transitionFlowImageAttempt.bind(
      test.repositories,
    );
    test.repositories.transitionFlowImageAttempt = async (input) => {
      if (input.next === "dispatch-intent")
        throw new Error("intent write failed");
      return transition(input);
    };
    const result = await test.generate(test.payload);
    expect(result.state).toBe("failed-before-dispatch");
    expect(test.fixture.activations).toBe(0);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "failed-before-dispatch",
    );
  });

  it("reconciles worker restart boundaries without replaying Generate", async () => {
    const test = await setup();
    const states: FlowImageAttemptState[] = [
      "preparing",
      "verified",
      "dispatch-intent",
      "dispatched",
      "uncertain",
    ];
    for (const [index, state] of states.entries()) {
      const at = 1_200 + index;
      const record: Omit<FlowImageAttemptRecord, "sourceSnapshotId"> = {
        attemptId: `restart-${state}`,
        confirmationKey: `restart-confirm-${state}`,
        ...(state === "failed-before-dispatch"
          ? {}
          : { activeKey: flowImageAttemptActiveKey(`restart-item-${state}`) }),
        workspaceId: "default",
        batchId: "batch-restart",
        itemId: `restart-item-${state}`,
        promptHash: await sha256Hex(prompt),
        promptCodeUnits: prompt.length,
        promptUtf8Bytes: new TextEncoder().encode(prompt).byteLength,
        provider: "Flow",
        projectId: "project_01",
        tabId: selectedTab.id,
        frameId: frame.frameId,
        loaderId: frame.loaderId,
        ...(state === "dispatch-intent"
          ? {
              documentId: "restart-document",
              senderFrameId: 0,
              observationSession: {
                sessionId: "9b80278c-4d61-4b30-8589-6f76c34115e4",
                documentId: "restart-document",
                senderFrameId: 0,
                startedAt: at,
                deadlineAt: at + 60_000,
                maxEvents: 64,
                profileSupport: "fixture_supported" as const,
                status: "arming" as const,
                lastSequence: 0,
                reconciliationCount: 0,
              },
              resultOutcome: {
                status: "awaiting_evidence" as const,
                observedSucceededCount: 0,
                observedFailedCount: 0,
                updatedAt: at,
              },
            }
          : {}),
        buildId: "test-build",
        protocolVersion: 4,
        settingsConfirmation: {
          confirmationId: `restart-confirm-${state}`,
          confirmedAt: at,
          userAttested: true,
          tabId: selectedTab.id,
          projectId: "project_01",
          canonicalTarget: selectedTab.canonicalTarget,
        },
        state,
        events: [{ stage: "preparation", at, method: "none" }],
        createdAt: at,
        updatedAt: at,
      };
      await test.repositories.createFlowImageAttempt({
        ...record,
        sourceSnapshot: {
          snapshotId: flowImagePromptSnapshotId(
            record.itemId,
            record.promptHash,
          ),
          workspaceId: record.workspaceId,
          batchId: record.batchId,
          itemId: record.itemId,
          promptHash: record.promptHash,
          rawJsonBody: prompt,
          promptCodeUnits: prompt.length,
          promptUtf8Bytes: new TextEncoder().encode(prompt).byteLength,
          createdAt: at,
        },
      });
    }
    const recovery =
      await test.repositories.reconcileInterruptedFlowImageAttempts();
    expect(recovery).toEqual({ failedBeforeDispatch: 2, uncertain: 1 });
    const records = await test.repositories.getAllFlowImageAttempts();
    expect(
      records.find((a) => a.attemptId === "restart-preparing")?.state,
    ).toBe("failed-before-dispatch");
    expect(records.find((a) => a.attemptId === "restart-verified")?.state).toBe(
      "failed-before-dispatch",
    );
    expect(
      records.find((a) => a.attemptId === "restart-dispatch-intent")?.state,
    ).toBe("uncertain");
    expect(
      records.find((a) => a.attemptId === "restart-dispatch-intent")
        ?.observationSession?.status,
    ).toBe("closed");
    expect(
      records.find((a) => a.attemptId === "restart-dispatch-intent")
        ?.resultOutcome,
    ).toMatchObject({ status: "unknown", reason: "observation_not_started" });
    expect(
      records.find((a) => a.attemptId === "restart-dispatched")?.state,
    ).toBe("dispatched");
    expect(
      records.find((a) => a.attemptId === "restart-uncertain")?.state,
    ).toBe("uncertain");
    expect(test.fixture.activations).toBe(0);
  });

  it("allows LF only when fill and settled readback remain exact", async () => {
    const test = await setup();
    const generate = createFlowImageGenerateOnce({
      repositories: test.repositories,
      port: test.fixture.port as never,
      fillPrompt: async () => ({
        fillVerified: false,
        settledMatch: false,
        stableReadback: true,
        inputMethod: "CDP Input.insertText",
        outcome: "readback-mismatch",
        code: "readback_mismatch",
      }),
      now: () => 1_100,
      createAttemptId: () => "lf-mismatch",
    });
    const result = await generate(test.payload);
    expect(result.state).toBe("failed-before-dispatch");
    expect(test.fixture.activations).toBe(0);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "failed-before-dispatch",
    );
    expect(
      (await test.repositories.getAllFlowImageAttempts())[0]?.events.at(-1)
        ?.method,
    ).toBe("none");
  });

  it("keeps preparation, preflight, and observer failures distinct with zero activation", async () => {
    const prep = await setup();
    const prepGenerate = createFlowImageGenerateOnce({
      repositories: prep.repositories,
      port: prep.fixture.port as never,
      fillPrompt: async () => {
        throw new Error("private fixture failure detail");
      },
      now: () => 1_100,
      createAttemptId: () => "prep-failure",
    });
    const prepResult = await prepGenerate(prep.payload);
    expect(prepResult).toMatchObject({
      state: "failed-before-dispatch",
      failureStage: "preparation",
      providerOutcome: "not_started",
      code: "preparation_failed",
      activationCount: 0,
    });
    expect(prepResult.message).not.toContain("private fixture");
    expect(prep.fixture.activations).toBe(0);

    const preflight = await setup({
      generated: discovery({ composer: "missing" }),
    });
    const preflightResult = await preflight.generate(preflight.payload);
    expect(preflightResult).toMatchObject({
      state: "failed-before-dispatch",
      failureStage: "preflight",
      code: "composer_missing",
      activationCount: 0,
    });
    expect(preflight.fixture.activations).toBe(0);

    const observer = await setup({
      generated: discovery({ observation: "missing" }),
    });
    const observerResult = await observer.generate(observer.payload);
    expect(observerResult).toMatchObject({
      state: "failed-before-dispatch",
      failureStage: "observer",
      code: "observation_missing",
      activationCount: 0,
    });
    expect(observer.fixture.activations).toBe(0);
    const stored = await observer.repositories.getAllFlowImageAttempts();
    expect(stored[0]?.state).toBe("failed-before-dispatch");
    expect(stored[0]?.events.at(-1)?.stage).toBe("observer");
  });

  it("classifies dispatch-intent persistence failure as storage before input", async () => {
    const test = await setup();
    const transition = test.repositories.transitionFlowImageAttempt.bind(
      test.repositories,
    );
    test.repositories.transitionFlowImageAttempt = async (input) => {
      if (input.next === "dispatch-intent")
        throw new FlowImageAttemptValidationError([
          {
            code: "unrecognized_keys",
            path: ["baseline"],
          },
        ]);
      return transition(input);
    };
    const result = await test.generate(test.payload);
    expect(result).toMatchObject({
      state: "failed-before-dispatch",
      failureStage: "storage",
      providerOutcome: "not_started",
      activationCount: 0,
      storageFailure: {
        operation: "transition_verified_to_dispatch_intent",
        exceptionClass: "FlowImageAttemptValidationError",
        schemaIssuePaths: ["baseline"],
        schemaIssueCodes: ["unrecognized_keys"],
        attemptStateBeforeFailure: "verified",
        failedWriteOutcome: "validation_rejected_before_put",
        failureRecordPersistence: "confirmed",
      },
    });
    expect(formatFlowGenerateOutcome(result)).toContain(
      "Storage operation: transition_verified_to_dispatch_intent; exception: FlowImageAttemptValidationError",
    );
    expect(test.fixture.activations).toBe(0);
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "failed-before-dispatch",
    );
  });

  it("keeps partial input and lost CDP acknowledgement uncertain with absent evidence", async () => {
    const partial = await setup({
      activation: {
        complete: false,
        pressAttempted: true,
        releaseAttempted: false,
      },
    });
    const partialResult = await partial.generate(partial.payload);
    expect(partialResult).toMatchObject({
      state: "uncertain",
      failureStage: "dispatch",
      providerOutcome: "unknown",
      activationCount: 1,
      pressAttempted: true,
      releaseAttempted: false,
    });

    const lost = await setup();
    const port = lost.fixture.port as unknown as {
      activate: () => Promise<unknown>;
    };
    port.activate = async () => {
      throw new Error("CDP channel closed");
    };
    const lostResult = await lost.generate(lost.payload);
    expect(lostResult).toMatchObject({
      state: "uncertain",
      failureStage: "dispatch",
      providerOutcome: "unknown",
      code: "activation_result_unknown",
    });
    expect(lostResult).not.toHaveProperty("activationCount");
    expect(lostResult).not.toHaveProperty("pressAttempted");
    expect(lostResult).not.toHaveProperty("releaseAttempted");
    expect((await lost.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "uncertain",
    );
    const visible = formatFlowGenerateOutcome(lostResult);
    expect(visible).toContain("Provider outcome: unknown");
    expect(visible).toContain("Activation-pair attempts: unknown");
    expect(visible).toContain("Press: unknown; release: unknown");
  });

  it("retains sent input as uncertain when post-dispatch observation is unavailable", async () => {
    const test = await setup({ postDispatchReadFailure: true });
    const result = await test.generate(test.payload);
    expect(result).toMatchObject({
      state: "uncertain",
      failureStage: "observer",
      providerOutcome: "unknown",
      code: "post_dispatch_observation_unavailable",
      activationCount: 1,
      pressAttempted: true,
      releaseAttempted: true,
    });
    const stored = (await test.repositories.getAllFlowImageAttempts())[0];
    expect(stored?.state).toBe("uncertain");
    expect(stored?.events.at(-1)?.stage).toBe("observer");
    expect(test.fixture.activations).toBe(1);
    const visible = formatFlowGenerateOutcome(result);
    expect(visible).toContain("Provider outcome: unknown");
    expect(visible).toContain("Action state: uncertain");
  });

  it("reports response loss as unknown while durable dispatched state remains non-replayable", async () => {
    const test = await setup();
    const workerResult = await test.generate(test.payload);
    const responseLostClient = createFoundationClient(
      { sendMessage: async () => Promise.reject(new Error("channel closed")) },
      { timeoutMs: { "flow.image.generateOnce": 5 } },
    );
    await expect(
      responseLostClient.request("flow.image.generateOnce", test.payload),
    ).rejects.toMatchObject({ code: "worker_request_failed" });

    const uiOutcome = flowGenerateResponseLostOutcome();
    expect(uiOutcome).toMatchObject({
      state: "uncertain",
      failureStage: "dispatch",
      providerOutcome: "unknown",
      code: "response_unknown",
    });
    expect(formatFlowGenerateOutcome(uiOutcome)).toContain(
      "Activation-pair attempts: unknown",
    );
    expect((await test.repositories.getAllFlowImageAttempts())[0]?.state).toBe(
      "dispatched",
    );
    expect(workerResult).toMatchObject({
      state: "dispatched",
      providerOutcome: "unverified",
      activationCount: 1,
    });
    expect(test.fixture.activations).toBe(1);
    expect((await test.generate(test.payload)).code).toBe(
      "attempt_already_active",
    );
    expect(test.fixture.activations).toBe(1);
  });
});
