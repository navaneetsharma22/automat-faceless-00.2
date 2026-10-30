import { AutomatDatabase } from "../../src/storage/db";
import {
  createDexieRepositoryDatabase,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import { flowImagePromptSnapshotId } from "../../src/domain/batches/flowImagePromptSnapshot";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { captureFlowResultBaseline } from "../../src/platforms/flow/observer";
import type { FlowImageBaseline } from "../../src/platforms/flow/observer";
import {
  createFlowCountBlockerInspection,
  createFlowCountRebaseline,
  createFlowImageCountDecisionReadback,
  createFlowImageReadinessCheck,
} from "../../src/background/handlers/flow";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { flowImageAttemptActiveKey } from "../../src/domain/jobs/attempt";
import {
  flowImageObservationFingerprintInput,
  flowImageResultBaselineFingerprintInput,
  flowStructuralSnapshotFingerprintInput,
} from "../../src/domain/jobs/results";

export async function transitionPersistedIntermediateAttempt() {
  const database = new AutomatDatabase(
    `flow-attempt-schema-regression-${crypto.randomUUID()}`,
  );
  await database.open();
  const repositories = new ExtensionRepositories(
    createDexieRepositoryDatabase(database),
    () => 1_100,
  );
  const rawJsonBody = '{"shot_id":"05","scene":"synthetic fixture"}';
  const promptHash = await sha256Hex(rawJsonBody);
  const snapshotId = flowImagePromptSnapshotId("fixture-item", promptHash);
  const snapshot = {
    snapshotId,
    workspaceId: "default",
    batchId: "fixture-batch",
    itemId: "fixture-item",
    promptHash,
    rawJsonBody,
    promptCodeUnits: rawJsonBody.length,
    promptUtf8Bytes: new TextEncoder().encode(rawJsonBody).byteLength,
    createdAt: 1_000,
  };
  const attemptInput = {
    attemptId: "attempt-storage-schema-fixture",
    confirmationKey: "fixture-confirmation-key",
    workspaceId: "default",
    batchId: "fixture-batch",
    itemId: "fixture-item",
    shotId: "5",
    promptHash,
    sourceSnapshot: snapshot,
    promptCodeUnits: snapshot.promptCodeUnits,
    promptUtf8Bytes: snapshot.promptUtf8Bytes,
    provider: "Flow" as const,
    projectId: "synthetic-project",
    tabId: 41,
    frameId: "fixture-frame",
    loaderId: "fixture-loader",
    documentId: "fixture-document",
    senderFrameId: 0,
    buildId: "automat-faceless-0.1.0-fixture",
    protocolVersion: 4,
    settingsConfirmation: {
      confirmationId: "fixture-confirmation",
      confirmedAt: 900,
      userAttested: true as const,
      tabId: 41,
      projectId: "synthetic-project",
      canonicalTarget: "https://flow.google.com/u/1/project/synthetic-project",
      declaredVariantCount: 2,
    },
    countSessionId: "b5f0a805-5c0b-4ba8-b3f8-20d2adf4470c",
    state: "preparing" as const,
    events: [
      {
        stage: "preparation" as const,
        at: 1_000,
        method: "none" as const,
        code: "preparation_persisted",
      },
    ],
    createdAt: 1_000,
    updatedAt: 1_000,
  };

  try {
    const preparing = await repositories.createFlowImageAttempt(attemptInput);
    const verified = await repositories.transitionFlowImageAttempt({
      attemptId: preparing.attemptId,
      expected: "preparing",
      next: "verified",
      event: {
        stage: "verification",
        at: 1_050,
        method: "CDP Input.insertText",
        code: "exact_settled_readback",
      },
    });
    const baseline: FlowImageBaseline = {
      kind: "flow_rendered_tile_candidates",
      workspaceTag: "flow-project-page",
      renderedTileCount: 2,
      candidateIds: ["a".repeat(64), "b".repeat(64)],
      candidateMultiplicity: [
        { candidateId: "a".repeat(64), renderedCopies: 1 },
        { candidateId: "b".repeat(64), renderedCopies: 1 },
      ],
      repeatedCandidateCount: 0,
      unidentifiedImageCount: 0,
      unrelatedImageCount: 0,
      virtualScrollContainerCount: 1,
      virtualizationEvidence: [],
      virtualized: false,
      loadingSignalCount: 0,
      captureGaps: [],
      capturedAt: 1_060,
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
      verified.settingsConfirmation.declaredVariantCount,
    );
    const observationSession = {
      sessionId: "01d62101-123a-447b-91a5-1d74a38c81ce",
      documentId: verified.documentId!,
      senderFrameId: verified.senderFrameId!,
      startedAt: 1_070,
      deadlineAt: 301_070,
      maxEvents: 64,
      profileSupport: "production_observation_only" as const,
      status: "arming" as const,
      lastSequence: 0,
      reconciliationCount: 0,
    };
    const resultOutcome = {
      status: "awaiting_evidence" as const,
      declaredVariantCount: 2,
      observedSucceededCount: 0,
      observedFailedCount: 0,
      updatedAt: 1_070,
    };

    const transitioned = await repositories.transitionFlowImageAttempt({
      attemptId: verified.attemptId,
      expected: "verified",
      next: "dispatch-intent",
      event: {
        stage: "dispatch",
        at: 1_080,
        method: "none",
        code: "dispatch_intent_persisted",
      },
      baseline,
      resultBaseline,
      observationSession,
      resultOutcome,
    });
    const readback = await repositories.getFlowImageAttempt(
      transitioned.attemptId,
    );
    const sourceReadback = await repositories.getFlowImagePromptSnapshot(
      transitioned.sourceSnapshotId,
    );
    return {
      persistedPreparing: preparing.state === "preparing",
      persistedVerified: verified.state === "verified",
      state: readback?.state ?? null,
      hasResultBaseline: Boolean(readback?.resultBaseline),
      hasObservationSession: Boolean(readback?.observationSession),
      baselineRetainsVirtualScrollContainerCount:
        "virtualScrollContainerCount" in (readback?.baseline ?? {}) &&
        readback?.baseline?.virtualScrollContainerCount === 1,
      baselineRetainsVirtualizationEvidence:
        "virtualizationEvidence" in (readback?.baseline ?? {}) &&
        JSON.stringify(readback?.baseline?.virtualizationEvidence) === "[]",
      sourceSnapshotIntegrityVerified:
        sourceReadback?.snapshotId === transitioned.sourceSnapshotId &&
        sourceReadback.promptHash === transitioned.promptHash &&
        sourceReadback.rawJsonBody === rawJsonBody,
      countSessionBindingMatches:
        readback?.countSessionId === attemptInput.countSessionId,
      declarationBindingMatches:
        readback?.resultBaseline?.variantDeclaration.status === "declared" &&
        readback.resultBaseline.variantDeclaration.count ===
          readback.settingsConfirmation.declaredVariantCount,
      countBaselineNotApplicable:
        readback?.countBaseline === undefined &&
        readback?.countDecision === undefined,
      lastEventCode: readback?.events.at(-1)?.code ?? null,
    };
  } finally {
    database.close();
    await database.delete();
  }
}

export async function inspectAndRecoverInterruptedDexieAttempt() {
  const database = new AutomatDatabase(
    `flow-count-recovery-dexie-${crypto.randomUUID()}`,
  );
  await database.open();
  const repositories = new ExtensionRepositories(
    createDexieRepositoryDatabase(database),
    () => 2_000,
  );
  const attemptId = "86e721b7-7cc9-4c1d-a476-f2fc2d30f9ec";
  const priorCountSessionId = "f34c53b9-89ad-4c4a-a2b2-945b09348a83";
  const recoveryCountSessionId = "2367a1a1-5206-48f2-8e40-337e75b76f18";
  const tabId = 41;
  const projectId = "recovery-dexie-fixture";
  const canonicalTarget = `https://flow.google.com/project/${projectId}`;
  const documentId = "recovery-dexie-document";
  const frameId = "recovery-dexie-frame";
  const loaderId = "recovery-dexie-loader";
  const rawJsonBody = '{"shot_id":"06","scene":"historical fixture"}';
  const candidateId = "a".repeat(64);
  const newPrompt = '{"shot_id":"07","scene":"distinct saved fixture"}';
  try {
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId,
      canonicalTarget,
    });
    await repositories.setReconnectIntent("Flow", true);
    await repositories.recordTargetVerification({
      provider: "Flow",
      tabId,
      canonicalTarget,
      projectId,
      frameId: 0,
      documentId,
      documentToken: "fixture-document-token",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: 1,
      capability: "read-only-connection-v1",
      verifiedAt: 1_200,
    });

    const oldSource = await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: rawJsonBody,
    });
    const oldItem = oldSource.items[0]!;
    const oldHash = await sha256Hex(rawJsonBody);
    await repositories.createFlowImageAttempt({
      attemptId,
      confirmationKey: "recovery-dexie-old-confirmation",
      workspaceId: "default",
      batchId: oldSource.batch.id,
      itemId: oldItem.id,
      ...(oldItem.shotId ? { shotId: oldItem.shotId } : {}),
      promptHash: oldHash,
      sourceSnapshot: {
        snapshotId: flowImagePromptSnapshotId(oldItem.id, oldHash),
        workspaceId: "default",
        batchId: oldSource.batch.id,
        itemId: oldItem.id,
        promptHash: oldHash,
        rawJsonBody,
        promptCodeUnits: rawJsonBody.length,
        promptUtf8Bytes: new TextEncoder().encode(rawJsonBody).byteLength,
        createdAt: 1_000,
      },
      promptCodeUnits: rawJsonBody.length,
      promptUtf8Bytes: new TextEncoder().encode(rawJsonBody).byteLength,
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
        confirmationId: "recovery-dexie-old-confirmation",
        confirmedAt: 900,
        userAttested: true,
        tabId,
        projectId,
        canonicalTarget,
        declaredVariantCount: 2,
      },
      countSessionId: priorCountSessionId,
      activeKey: flowImageAttemptActiveKey(oldItem.id, oldHash),
      state: "preparing",
      events: [{ stage: "preparation", at: 1_000, method: "none" }],
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    const verified = await repositories.transitionFlowImageAttempt({
      attemptId,
      expected: "preparing",
      next: "verified",
      event: { stage: "verification", at: 1_020, method: "none" },
    });
    const resultBaselineInput: FlowImageBaseline = {
      kind: "flow_rendered_tile_candidates",
      workspaceTag: "flow-project-page",
      renderedTileCount: 1,
      candidateIds: [candidateId],
      qualifyingCandidateIds: [candidateId],
      candidateMultiplicity: [{ candidateId, renderedCopies: 1 }],
      repeatedCandidateCount: 0,
      unidentifiedImageCount: 0,
      unrelatedImageCount: 0,
      virtualScrollContainerCount: 0,
      virtualizationEvidence: [],
      virtualized: false,
      loadingSignalCount: 0,
      captureGaps: [],
      capturedAt: 1_030,
    };
    const resultBaseline = captureFlowResultBaseline(
      resultBaselineInput,
      {
        workspaceId: verified.workspaceId,
        batchId: verified.batchId,
        itemId: verified.itemId,
        sourceHash: verified.promptHash,
        sourceSnapshotId: verified.sourceSnapshotId,
        attemptId,
        provider: "Flow",
        projectId,
        tabId,
        frameId,
        loaderId,
      },
      { buildId: BUILD_ID, protocolVersion: PROTOCOL_VERSION },
      2,
    );
    const observationSession = {
      sessionId: "d7a5ea61-9721-4a65-8485-798f2f4e0c11",
      documentId,
      senderFrameId: 0,
      startedAt: 1_040,
      deadlineAt: 100_000,
      maxEvents: 8,
      profileSupport: "fixture_supported" as const,
      status: "arming" as const,
      lastSequence: 0,
      reconciliationCount: 0,
    };
    const countBaseline = {
      mode: "existing_project" as const,
      countSessionId: priorCountSessionId,
      startingImageCount: 1,
      provenance: "user_attested_existing_image_count" as const,
      inventoryComplete: false as const,
      projectId,
      canonicalTarget,
      tabId,
      documentId,
      buildId: BUILD_ID,
      protocolVersion: PROTOCOL_VERSION,
      capturedAt: 1_030,
      baselineCandidateIds: [candidateId],
      qualifyingBaselineCandidateIds: [candidateId],
      baselineTileTokens: ["tile-1"],
      virtualized: false,
      renderedScopeComplete: true,
      captureGaps: [],
      priorMatchedAttemptIds: [],
      priorMatchedCandidateIds: [],
      priorDeclaredAdditions: 0,
    };
    const countDecision = {
      schemaVersion: 1 as const,
      status: "observing" as const,
      countSessionId: priorCountSessionId,
      mode: "existing_project" as const,
      startingImageCount: 1,
      declaredVariantCount: 2,
      expectedCumulativeAdditions: 2,
      expectedTotal: 3,
      priorMatchedAttemptIds: [],
      observedEligibleCandidateIds: [],
      observationSequence: 0,
      updatedAt: 1_040,
    };
    await repositories.transitionFlowImageAttempt({
      attemptId,
      expected: "verified",
      next: "dispatch-intent",
      event: { stage: "dispatch", at: 1_050, method: "none" },
      resultBaseline,
      observationSession,
      resultOutcome: {
        status: "awaiting_evidence",
        declaredVariantCount: 2,
        observedSucceededCount: 0,
        observedFailedCount: 0,
        updatedAt: 1_040,
      },
      countBaseline,
      countDecision,
    });
    const dispatchIntentRow = await repositories.getFlowImageAttempt(attemptId);
    await repositories.updateFlowImageObservationSession({
      attemptId,
      sessionId: observationSession.sessionId,
      expectedRevision: dispatchIntentRow!.revision ?? 0,
      sessionStatus: "active",
    });
    await repositories.recordFlowImageCountDispatchBoundary({
      attemptId,
      boundaryAt: 1_055,
    });
    await repositories.transitionFlowImageAttempt({
      attemptId,
      expected: "dispatch-intent",
      next: "dispatched",
      event: {
        stage: "dispatch",
        at: 1_060,
        method: "CDP Input.dispatchMouseEvent",
        code: "fixture_dispatched",
      },
    });
    const activeBeforeObservation =
      await repositories.getFlowImageAttempt(attemptId);
    const observedAt = 1_061;
    const structuralSnapshot = {
      completeForRenderedScope: true,
      virtualized: false,
      unidentifiedImageCount: 0,
      tiles: [
        { tileToken: "tile-1", tag: "flow-image-tile" as const, visible: true },
      ],
      mediaCandidates: [],
      identityCandidates: [],
      identityCandidatesTruncated: false,
      resourceEvents: [],
      lifecycleSignals: [
        {
          markerToken: "marker-1",
          markerTag: "div",
          markerKind: "loading" as const,
          scope: "tile" as const,
          tileToken: "tile-1",
          visible: true,
          evidence: [{ attributeName: "data-state", signal: "loading" }],
        },
      ],
      captureGaps: [],
    };
    const structuralEvent = {
      kind: "structural_snapshot" as const,
      attemptId,
      sessionId: observationSession.sessionId,
      observationId: "00000000-0000-4000-8000-000000000001",
      sequence: 1,
      observedAt,
      profile: "flow_tile_candidate_structure_v1" as const,
      binding: activeBeforeObservation!.resultBaseline!.binding,
      sourceBaselineFingerprint: await sha256Hex(
        flowImageResultBaselineFingerprintInput(
          activeBeforeObservation!.resultBaseline!,
        ),
      ),
      captureFingerprint: await sha256Hex(
        flowStructuralSnapshotFingerprintInput(structuralSnapshot),
      ),
      snapshot: structuralSnapshot,
    };
    await repositories.recordFlowImageObservation({
      attemptId,
      event: structuralEvent,
      fingerprint: await sha256Hex(
        flowImageObservationFingerprintInput(structuralEvent),
      ),
      receivedAt: observedAt,
    });
    const active = await repositories.getFlowImageAttempt(attemptId);
    await repositories.updateFlowImageObservationSession({
      attemptId,
      sessionId: observationSession.sessionId,
      expectedRevision: active!.revision ?? 0,
      sessionStatus: "lost",
      resultOutcome: {
        status: "unknown",
        reason: "binding_changed",
        declaredVariantCount: 2,
        observedSucceededCount: 0,
        observedFailedCount: 0,
        updatedAt: 1_070,
      },
      countDecision: {
        ...active!.countDecision!,
        status: "interrupted",
        reason: "binding_changed",
        updatedAt: 1_070,
      },
    });
    let staleSnapshotWriteRejected = false;
    try {
      await repositories.updateFlowImageObservationSession({
        attemptId,
        sessionId: observationSession.sessionId,
        expectedRevision: activeBeforeObservation!.revision ?? 0,
        sessionStatus: "active",
        countDecision: {
          ...activeBeforeObservation!.countDecision!,
          status: "observing",
        },
      });
    } catch (error) {
      staleSnapshotWriteRejected =
        (error as { code?: string }).code === "attempt_revision_changed";
    }
    let terminalTransitionRejected = false;
    const lostRow = await repositories.getFlowImageAttempt(attemptId);
    try {
      await repositories.updateFlowImageObservationSession({
        attemptId,
        sessionId: observationSession.sessionId,
        expectedRevision: lostRow!.revision ?? 0,
        sessionStatus: "active",
        countDecision: {
          ...lostRow!.countDecision!,
          status: "observing",
        },
      });
    } catch (error) {
      terminalTransitionRejected =
        (error as { code?: string }).code ===
        "terminal_observation_cannot_resume";
    }

    await repositories.savePromptBatch({
      workspaceId: "default",
      kind: "image",
      sourceText: newPrompt,
    });
    const newHash = await sha256Hex(newPrompt);
    const scriptingPort = {
      executeScript: async (details: { args?: unknown[] }) => {
        if (!details.args)
          return [
            {
              documentId,
              frameId: 0,
              result: { href: canonicalTarget, top: true },
            },
          ];
        if (details.args[2] === "producer")
          return [
            {
              documentId,
              frameId: 0,
              result: { available: true, status: "absent" },
            },
          ];
        if (details.args.length === 4 && details.args[2] === true)
          return [{ documentId, frameId: 0, result: { installed: true } }];
        return [
          {
            documentId,
            frameId: 0,
            result: {
              status: "ready",
              candidateIds: [candidateId],
              qualifyingCandidateIds: [candidateId],
              tileTokens: ["tile-1"],
              captureGaps: [],
              virtualized: false,
              unidentifiedImageCount: 0,
              loadingSignalCount: 0,
            },
          },
        ];
      },
    };
    const inspect = createFlowCountBlockerInspection(
      repositories,
      scriptingPort as never,
    );
    const recover = createFlowCountRebaseline(
      repositories,
      scriptingPort as never,
    );
    const readDecision = createFlowImageCountDecisionReadback(repositories);
    const readiness = createFlowImageReadinessCheck(
      repositories,
      scriptingPort as never,
    );
    const before = await repositories.getFlowImageAttempt(attemptId);
    const inspectionBefore = (await inspect()) as {
      blockers: Array<Record<string, unknown>>;
    };
    const blockerBefore = inspectionBefore.blockers.find(
      (blocker) => blocker.attemptId === attemptId,
    );
    const [
      recovery,
      readback,
      reconciliation,
      inspectionAfter,
      readinessResult,
    ] = await Promise.all([
      recover({
        oldAttemptId: attemptId,
        workspaceId: "default",
        promptHash: newHash,
        countSessionId: recoveryCountSessionId,
        startingImageCount: 1,
        userConfirmed: true,
      }),
      readDecision(attemptId),
      repositories.reconcileInterruptedFlowImageAttempts(),
      inspect(),
      readiness({
        countMode: {
          mode: "existing_project",
          countSessionId: priorCountSessionId,
          startingImageCount: 1,
          userConfirmed: true,
        },
      }),
    ]);
    const after = await repositories.getFlowImageAttempt(attemptId);
    const recoveries = await repositories.getFlowCountRecoveries();
    const blockerAfter = (
      inspectionAfter as { blockers: Array<Record<string, unknown>> }
    ).blockers.find((blocker) => blocker.attemptId === attemptId);
    return {
      inspectionAttemptId: blockerBefore?.attemptId ?? null,
      recoveryAttemptId: (recovery as { oldAttemptId?: string }).oldAttemptId,
      beforeInspection: {
        state: blockerBefore?.state,
        observationStatus: blockerBefore?.observationStatus,
        providerOutcomePersistedStatus:
          blockerBefore?.providerOutcomePersistedStatus,
        countDecision: blockerBefore?.countDecision,
        recoveryEligible: blockerBefore?.recoveryEligible,
      },
      readbackDecision:
        (readback as { countDecision?: { status?: string } }).countDecision
          ?.status ?? null,
      recoveryStatus: (recovery as { status?: string }).status,
      recoveryReason: (recovery as { reason?: string }).reason,
      recoveryDetailReason: (recovery as { detailReason?: string })
        .detailReason,
      recoveryCurrentDecisionStatus: (
        recovery as { currentCountDecisionStatus?: string }
      ).currentCountDecisionStatus,
      recoveryOldAttemptId: (recovery as { oldAttemptId?: string })
        .oldAttemptId,
      readinessReason: (readinessResult as { reason?: string }).reason,
      reconciliation,
      afterInspection: {
        state: blockerAfter?.state,
        observationStatus: blockerAfter?.observationStatus,
        providerOutcomePersistedStatus:
          blockerAfter?.providerOutcomePersistedStatus,
        countDecision: blockerAfter?.countDecision,
        recoveryEligible: blockerAfter?.recoveryEligible,
      },
      oldRowUnchanged: JSON.stringify(before) === JSON.stringify(after),
      oldLockPreserved: after?.activeKey === before?.activeKey,
      structuralObservationCount: after?.structuralObservations?.length ?? 0,
      observationReceiptCount: after?.observationReceipts?.length ?? 0,
      observationsPreserved:
        JSON.stringify(before?.structuralObservations) ===
          JSON.stringify(after?.structuralObservations) &&
        JSON.stringify(before?.observationReceipts) ===
          JSON.stringify(after?.observationReceipts),
      staleSnapshotWriteRejected,
      terminalTransitionRejected,
      recoveryCount: recoveries.length,
      recoveryOldAttemptId: recoveries[0]?.oldAttemptId ?? null,
    };
  } finally {
    database.close();
    await database.delete();
  }
}

Object.assign(globalThis, {
  __FlowAttemptStorageFixture: {
    transitionPersistedIntermediateAttempt,
    inspectAndRecoverInterruptedDexieAttempt,
  },
});
