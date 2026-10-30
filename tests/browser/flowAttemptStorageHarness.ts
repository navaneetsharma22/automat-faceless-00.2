import { AutomatDatabase } from "../../src/storage/db";
import {
  createDexieRepositoryDatabase,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import { flowImagePromptSnapshotId } from "../../src/domain/batches/flowImagePromptSnapshot";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { captureFlowResultBaseline } from "../../src/platforms/flow/observer";
import type { FlowImageBaseline } from "../../src/platforms/flow/observer";

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
