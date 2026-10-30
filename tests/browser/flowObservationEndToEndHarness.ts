import { AutomatDatabase } from "../../src/storage/db";
import {
  createDexieRepositoryDatabase,
  ExtensionRepositories,
  sha256Hex,
} from "../../src/storage/repositories";
import { flowImagePromptSnapshotId } from "../../src/domain/batches/flowImagePromptSnapshot";
import {
  flowImageResultBaselineFingerprintInput,
  reduceFlowImageCountDecision,
} from "../../src/domain/jobs/results";
import { captureFlowResultBaseline } from "../../src/platforms/flow/observer";
import { flowWorkspaceScopeAnalyzer } from "../../src/platforms/flow/workspaceScope";
import { createChromeFlowImageGenerateOncePort } from "../../src/background/handlers/flow";
import { createFlowImageObservationHandler } from "../../src/background/handlers/observations";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";

const projectId = "observation-e2e-project";
const tabId = 41;
const canonicalTarget = `https://flow.google.com/project/${projectId}`;
const documentId = "fixture-document";
const frameId = "fixture-frame";
const loaderId = "fixture-loader";
const attemptId = "attempt-observation-e2e-fixture";
const countSessionId = "290cfdaa-9655-4905-a7b0-54cff19297bb";
const observationSessionId = "6321c40c-754e-419d-a776-489d816e22c5";
const extensionId = "fixture-extension";
let activeFixture: {
  readReport: () => Promise<Record<string, unknown>>;
  markSyntheticActivationDispatched: () => Promise<void>;
  close: () => Promise<void>;
} | null = null;

export async function setupProductionObservationFixture() {
  const database = new AutomatDatabase(
    `flow-observation-e2e-${crypto.randomUUID()}`,
  );
  await database.open();
  const repositories = new ExtensionRepositories(
    createDexieRepositoryDatabase(database),
  );
  const now = Date.now;
  const rawJsonBody = '{"shot_id":"05","scene":"synthetic fixture"}';
  const promptHash = await sha256Hex(rawJsonBody);
  const sourceSnapshotId = flowImagePromptSnapshotId("shot-05", promptHash);
  const sourceSnapshot = {
    snapshotId: sourceSnapshotId,
    workspaceId: "default",
    batchId: "fixture-batch",
    itemId: "shot-05",
    promptHash,
    rawJsonBody,
    promptCodeUnits: rawJsonBody.length,
    promptUtf8Bytes: new TextEncoder().encode(rawJsonBody).byteLength,
    createdAt: now(),
  };
  await repositories.saveFlowImagePromptSnapshot(sourceSnapshot);
  await repositories.recordSelectedTarget({
    provider: "Flow",
    tabId,
    canonicalTarget,
    verification: "unverified",
    updatedAt: now(),
  });
  const attempt = await repositories.createFlowImageAttempt({
    attemptId,
    confirmationKey: "fixture-confirmation-key",
    workspaceId: "default",
    batchId: "fixture-batch",
    itemId: "shot-05",
    shotId: "5",
    promptHash,
    sourceSnapshot,
    promptCodeUnits: sourceSnapshot.promptCodeUnits,
    promptUtf8Bytes: sourceSnapshot.promptUtf8Bytes,
    provider: "Flow",
    projectId,
    tabId,
    frameId,
    loaderId,
    documentId,
    senderFrameId: 0,
    buildId: BUILD_ID,
    protocolVersion: PROTOCOL_VERSION,
    settingsConfirmation: {
      confirmationId: "fixture-confirmation",
      confirmedAt: now(),
      userAttested: true,
      tabId,
      projectId,
      canonicalTarget,
      declaredVariantCount: 2,
    },
    countSessionId,
    state: "preparing",
    events: [
      {
        stage: "preparation",
        at: now(),
        method: "none",
        code: "preparation_persisted",
      },
    ],
    createdAt: now(),
    updatedAt: now(),
  });
  const verified = await repositories.transitionFlowImageAttempt({
    attemptId: attempt.attemptId,
    expected: "preparing",
    next: "verified",
    event: {
      stage: "verification",
      at: now(),
      method: "CDP Input.insertText",
      code: "exact_settled_readback",
    },
  });
  const oldIds = [
    await sha256Hex("synthetic-media-one"),
    await sha256Hex("synthetic-media-two"),
  ];
  const baseline = {
    kind: "flow_rendered_tile_candidates" as const,
    workspaceTag: "flow-project-page" as const,
    renderedTileCount: 2,
    candidateIds: oldIds,
    candidateMultiplicity: oldIds.map((candidateId) => ({
      candidateId,
      renderedCopies: 1,
    })),
    repeatedCandidateCount: 0,
    unidentifiedImageCount: 0,
    unrelatedImageCount: 0,
    virtualScrollContainerCount: 1,
    virtualizationEvidence: [],
    virtualized: false,
    loadingSignalCount: 0,
    captureGaps: [],
    capturedAt: now(),
  };
  const resultBaseline = captureFlowResultBaseline(
    baseline,
    {
      workspaceId: verified.workspaceId,
      batchId: verified.batchId,
      itemId: verified.itemId,
      sourceHash: verified.promptHash,
      sourceSnapshotId: verified.sourceSnapshotId,
      attemptId: verified.attemptId,
      provider: verified.provider,
      projectId: verified.projectId,
      tabId: verified.tabId,
      frameId: verified.frameId,
      loaderId: verified.loaderId,
    },
    { buildId: verified.buildId, protocolVersion: verified.protocolVersion },
    2,
  );
  const observationSession = {
    sessionId: observationSessionId,
    documentId,
    senderFrameId: 0,
    startedAt: now() - 1,
    deadlineAt: now() + 30_000,
    maxEvents: 64,
    profileSupport: "production_observation_only" as const,
    status: "arming" as const,
    lastSequence: 0,
    reconciliationCount: 0,
  };
  const dispatchIntent = await repositories.transitionFlowImageAttempt({
    attemptId,
    expected: "verified",
    next: "dispatch-intent",
    event: {
      stage: "dispatch",
      at: now(),
      method: "none",
      code: "dispatch_intent_persisted",
    },
    baseline,
    resultBaseline,
    observationSession,
    resultOutcome: {
      status: "awaiting_evidence",
      declaredVariantCount: 2,
      observedSucceededCount: 0,
      observedFailedCount: 0,
      updatedAt: now(),
    },
  });

  const fakeChrome = globalThis as typeof globalThis & {
    chrome?: Record<string, unknown>;
  };
  fakeChrome.chrome = {
    runtime: {
      sendMessage: async (message: unknown) => {
        const response = await handler.handle(message, {
          id: extensionId,
          tab: { id: tabId, url: canonicalTarget },
          frameId: 0,
          documentId,
        });
        return { ok: true, data: response };
      },
    },
    scripting: {
      executeScript: async (details: {
        func: (...args: unknown[]) => unknown;
        args?: unknown[];
      }) => [
        {
          frameId: 0,
          documentId,
          result: await details.func(...(details.args ?? [])),
        },
      ],
    },
  };
  const productionPort = createChromeFlowImageGenerateOncePort(repositories);
  const boundPort = {
    ...productionPort,
    getSelection: async () => ({ tabId }),
    getTab: async () => ({ title: "Flow project", url: canonicalTarget }),
    readFrame: async () => ({
      frameId,
      loaderId,
      documentId,
      senderFrameId: 0,
      url: canonicalTarget,
    }),
  };
  const handler = createFlowImageObservationHandler({
    extensionId,
    repositories,
    port: boundPort,
    now,
  });
  // Reinstall the message function after handler initialization to keep the
  // real production port transport routed through the real handler.
  (
    fakeChrome.chrome.runtime as {
      sendMessage: (message: unknown) => Promise<unknown>;
    }
  ).sendMessage = async (message) => {
    const response = await handler.handle(message, {
      id: extensionId,
      tab: { id: tabId, url: canonicalTarget },
      frameId: 0,
      documentId,
    });
    return { ok: true, data: response };
  };
  const binding = {
    workspaceId: verified.workspaceId,
    batchId: verified.batchId,
    itemId: verified.itemId,
    sourceHash: verified.promptHash,
    sourceSnapshotId: verified.sourceSnapshotId,
    sourceBaselineFingerprint: await sha256Hex(
      flowImageResultBaselineFingerprintInput(resultBaseline),
    ),
    attemptId,
    provider: "Flow" as const,
    projectId,
    canonicalTarget,
    tabId,
    frameId,
    loaderId,
    documentId,
    senderFrameId: 0,
    sessionId: observationSessionId,
    startedAt: observationSession.startedAt,
    deadlineAt: observationSession.deadlineAt,
    maxEvents: 64,
    buildId: BUILD_ID,
    protocolVersion: PROTOCOL_VERSION,
  };
  const armed = await productionPort.startObservation(tabId, binding);
  if (typeof armed !== "object" || armed.status !== "started")
    throw new Error("fixture_production_arm_failed");
  const countBaseline = {
    mode: "existing_project" as const,
    countSessionId,
    startingImageCount: 2,
    provenance: "user_attested_existing_image_count" as const,
    inventoryComplete: false as const,
    projectId,
    canonicalTarget,
    tabId,
    documentId,
    buildId: BUILD_ID,
    protocolVersion: PROTOCOL_VERSION,
    capturedAt: now(),
    baselineCandidateIds: armed.receipt.baseline.candidateIds,
    baselineTileTokens: armed.receipt.baseline.tileTokens,
    virtualScrollContainerCount:
      armed.receipt.baseline.virtualScrollContainerCount,
    virtualizationEvidence: armed.receipt.baseline.virtualizationEvidence,
    virtualized: armed.receipt.baseline.virtualized,
    renderedScopeComplete: armed.receipt.baseline.completeForRenderedScope,
    captureGaps: armed.receipt.baseline.captureGaps,
    priorMatchedAttemptIds: [],
    priorMatchedCandidateIds: [],
    priorDeclaredAdditions: 0,
  };
  const countDecision = reduceFlowImageCountDecision({
    declaration: countBaseline,
    declaredVariantCount: 2,
    expectedCumulativeAdditions: 2,
    priorMatchedAttemptIds: [],
    resultBaseline,
    events: [],
    now: now(),
  });
  await repositories.updateFlowImageObservationSession({
    attemptId,
    sessionId: observationSessionId,
    sessionStatus: "active",
    armReceipt: armed.receipt,
    countBaseline,
    countDecision,
  });
  const activatedObserver = await productionPort.activateObservation(
    tabId,
    binding,
  );
  if (activatedObserver !== "started")
    throw new Error("fixture_production_observer_activation_failed");
  const dispatchBoundaryAt = now();
  await repositories.recordFlowImageCountDispatchBoundary({
    attemptId,
    boundaryAt: dispatchBoundaryAt,
  });

  activeFixture = {
    markSyntheticActivationDispatched: async () => {
      await repositories.transitionFlowImageAttempt({
        attemptId,
        expected: "dispatch-intent",
        next: "dispatched",
        event: {
          stage: "dispatch",
          at: now(),
          method: "CDP Input.dispatchMouseEvent",
          code: "activation_pair_sent",
        },
      });
    },
    readReport: async () => {
      const saved = await repositories.getFlowImageAttempt(attemptId);
      if (!saved) throw new Error("fixture_attempt_missing");
      return {
        state: saved.state,
        outcome: saved.resultOutcome,
        session: saved.observationSession,
        countDecision: saved.countDecision,
        sequences: saved.structuralObservations?.map((event) => ({
          sequence: event.sequence,
          kind: event.kind,
          observedAt: event.observedAt,
          candidateIds: event.snapshot.mediaCandidates.map(
            (candidate) => candidate.candidateId,
          ),
          blockers: event.snapshot.captureGaps,
        })),
        receiptSequences: saved.observationReceipts?.map(
          (receipt) => receipt.sequence,
        ),
        diagnostics: saved.events
          .filter((event) => event.stage === "observer")
          .map((event) => event.code),
        durableBoundary: saved.countDecision?.dispatchBoundaryAt,
      };
    },
    close: async () => {
      await productionPort.stopObservation(tabId, binding);
      database.close();
      await database.delete();
      activeFixture = null;
    },
  };
  return {
    attemptId,
    binding,
    dispatchBoundaryAt,
    armReceipt: armed.receipt,
    baselineSequence: (await repositories.getFlowImageAttempt(attemptId))
      ?.observationSession?.lastSequence,
    scopeAnalyzerSource: flowWorkspaceScopeAnalyzer.toString(),
    initialAttemptState: dispatchIntent.state,
  };
}

export async function readProductionObservationFixtureReport() {
  if (!activeFixture) throw new Error("fixture_not_initialized");
  return activeFixture.readReport();
}

export async function markSyntheticActivationDispatched() {
  if (!activeFixture) throw new Error("fixture_not_initialized");
  await activeFixture.markSyntheticActivationDispatched();
}

export async function closeProductionObservationFixture() {
  await activeFixture?.close();
}
