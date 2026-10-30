import { flowTabFromUrl } from "../../platforms/flow/connection";
import type { FlowImageGenerateOncePort } from "./flow";
import {
  flowImageResultBaselineFingerprintInput,
  flowStructuralSnapshotFingerprintInput,
  FlowImageObservationMessageSchema,
  flowImageObservationFingerprintInput,
  flowResultBaselineMatchesAttempt,
} from "../../domain/jobs/results";
import type { FlowImageAttemptRecord } from "../../domain/jobs/attempt";
import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import type { ExtensionRepositories } from "../../storage/repositories";
import { sha256Hex } from "../../storage/repositories";

export type FlowObservationMessageSender = {
  id?: string;
  tab?: { id?: number; url?: string };
  frameId?: number;
  documentId?: string;
};

export type FlowImageObservationResponse =
  | { accepted: true; duplicate: boolean; attemptId: string; outcome: string }
  | { accepted: false; code: string; attemptId?: string };

export type FlowImageObservationHandlerDependencies = {
  extensionId: string;
  repositories: ExtensionRepositories;
  port: FlowImageGenerateOncePort;
  now?: () => number;
  /** Enabled only by local synthetic tests until P05.3 verifies Flow's live contract. */
  allowSyntheticProfile?: boolean;
};

const MAX_RECONCILIATIONS = 3;
const safeExceptionName = (error: unknown): string => {
  const name =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(error.name)
      ? error.name.toLowerCase()
      : "unknown";
  return name.slice(0, 32);
};

export function createFlowImageObservationHandler(
  dependencies: FlowImageObservationHandlerDependencies,
) {
  const now = dependencies.now ?? Date.now;

  const setUnknown = async (
    attempt: FlowImageAttemptRecord,
    reason:
      | "observation_lost"
      | "observation_timeout"
      | "binding_changed"
      | "event_limit_reached",
    diagnosticCode: string,
  ) => {
    const declaredVariantCount =
      attempt.settingsConfirmation.declaredVariantCount;
    if (!attempt.observationSession) return;
    await dependencies.repositories.updateFlowImageObservationSession({
      attemptId: attempt.attemptId,
      sessionId: attempt.observationSession.sessionId,
      sessionStatus:
        reason === "observation_timeout"
          ? "timed_out"
          : reason === "observation_lost" || reason === "binding_changed"
            ? "lost"
            : "closed",
      resultOutcome: {
        status: "unknown",
        reason,
        ...(declaredVariantCount ? { declaredVariantCount } : {}),
        observedSucceededCount:
          attempt.resultOutcome?.observedSucceededCount ?? 0,
        observedFailedCount: attempt.resultOutcome?.observedFailedCount ?? 0,
        updatedAt: now(),
      },
      ...(attempt.countDecision?.status === "observing"
        ? {
            countDecision: {
              ...attempt.countDecision,
              status: "interrupted" as const,
              reason:
                reason === "observation_timeout"
                  ? ("observer_timeout" as const)
                  : reason === "binding_changed"
                    ? ("binding_changed" as const)
                    : reason === "event_limit_reached"
                      ? ("event_limit_reached" as const)
                      : ("observer_lost" as const),
              updatedAt: now(),
            },
          }
        : {}),
      diagnosticCode,
    });
  };

  const freshBindingMatches = async (
    attempt: FlowImageAttemptRecord,
  ): Promise<string | null> => {
    if (!attempt.documentId) return "binding_document_id_missing";
    if (attempt.senderFrameId !== 0) return "binding_sender_frame_id_mismatch";
    const selected = await dependencies.repositories.getSelectedTarget("Flow");
    if (!selected) return "binding_selected_target_missing";
    if (selected.tabId !== attempt.tabId)
      return "binding_selected_tab_id_mismatch";
    if (
      selected.canonicalTarget !== attempt.settingsConfirmation.canonicalTarget
    )
      return "binding_selected_canonical_target_mismatch";
    const activeSelection = await dependencies.port.getSelection();
    if (!activeSelection) return "binding_active_selection_missing";
    if (activeSelection.tabId !== attempt.tabId)
      return "binding_active_selection_tab_id_mismatch";
    const tab = await dependencies.port.getTab(attempt.tabId);
    if (!tab) return "binding_tab_unavailable";
    const parsed = flowTabFromUrl(attempt.tabId, tab?.title ?? "", tab?.url);
    if (!parsed) return "binding_tab_route_unrecognized";
    if (parsed.projectId !== attempt.projectId)
      return "binding_tab_project_id_mismatch";
    if (parsed.canonicalTarget !== selected.canonicalTarget)
      return "binding_tab_canonical_target_mismatch";
    const frame = await dependencies.port.readFrame(attempt.tabId);
    if (!frame) return "binding_frame_unavailable";
    if (frame.frameId !== attempt.frameId) return "binding_frame_id_mismatch";
    if (frame.loaderId !== attempt.loaderId)
      return "binding_loader_id_mismatch";
    if (frame.documentId !== attempt.documentId)
      return "binding_document_id_mismatch";
    if (frame.senderFrameId !== attempt.senderFrameId)
      return "binding_sender_frame_id_mismatch";
    if (
      flowTabFromUrl(attempt.tabId, "", frame.url)?.canonicalTarget !==
      selected.canonicalTarget
    )
      return "binding_frame_canonical_target_mismatch";
    if (!flowResultBaselineMatchesAttempt(attempt.resultBaseline, attempt))
      return "binding_result_baseline_mismatch";
    const source = await dependencies.repositories.getFlowImagePromptSnapshot(
      attempt.sourceSnapshotId,
    );
    if (!source) return "binding_source_snapshot_missing";
    if (
      source.workspaceId !== attempt.workspaceId ||
      source.batchId !== attempt.batchId ||
      source.itemId !== attempt.itemId ||
      source.promptHash !== attempt.promptHash ||
      source.snapshotId !== attempt.sourceSnapshotId
    )
      return "binding_source_snapshot_identity_mismatch";
    if ((await sha256Hex(source.rawJsonBody)) !== attempt.promptHash)
      return "binding_source_snapshot_hash_mismatch";
    return null;
  };

  const resumeReadOnlyAfterWorkerRestart = async (): Promise<{
    resumed: number;
    unknown: number;
  }> => {
    const attempts = await dependencies.repositories.getAllFlowImageAttempts();
    let resumed = 0;
    let unknown = 0;
    for (const attempt of attempts) {
      const session = attempt.observationSession;
      if (
        session?.status === "lost" &&
        attempt.state === "uncertain" &&
        attempt.resultOutcome?.reason === "observation_lost" &&
        session.profileSupport === "production_observation_only"
      ) {
        try {
          await dependencies.port.stopObservation(
            attempt.tabId,
            await observationArmBinding(attempt),
          );
        } catch {
          // The durable outcome stays unknown when the old document is gone.
        }
        unknown += 1;
        continue;
      }
      if (
        !session ||
        session.status !== "active" ||
        session.profileSupport === "unsupported" ||
        (attempt.state !== "dispatched" && attempt.state !== "uncertain")
      ) {
        continue;
      }
      if (now() >= session.deadlineAt) {
        await setUnknown(
          attempt,
          "observation_timeout",
          "observer_deadline_reached",
        );
        unknown += 1;
        continue;
      }
      let bindingDiagnostic: string | null;
      try {
        bindingDiagnostic = await freshBindingMatches(attempt);
      } catch (error) {
        bindingDiagnostic = `binding_check_exception_${safeExceptionName(error)}`;
      }
      if (
        session.reconciliationCount >= MAX_RECONCILIATIONS ||
        bindingDiagnostic
      ) {
        await setUnknown(
          attempt,
          session.reconciliationCount >= MAX_RECONCILIATIONS
            ? "event_limit_reached"
            : "binding_changed",
          session.reconciliationCount >= MAX_RECONCILIATIONS
            ? "observer_reconciliation_limit_reached"
            : bindingDiagnostic!,
        );
        unknown += 1;
        continue;
      }
      try {
        if (session.profileSupport === "production_observation_only") {
          const binding = await observationArmBinding(attempt);
          const resumed = await dependencies.port.resumeObservation(
            attempt.tabId,
            binding,
          );
          if (resumed !== "resumed") {
            await setUnknown(
              attempt,
              "observation_lost",
              "observer_resume_refused",
            );
            unknown += 1;
            continue;
          }
        }
        await dependencies.repositories.updateFlowImageObservationSession({
          attemptId: attempt.attemptId,
          sessionId: session.sessionId,
          reconciliationCount: session.reconciliationCount + 1,
        });
        resumed += 1;
      } catch {
        await setUnknown(
          attempt,
          "observation_lost",
          "observer_resume_exception",
        );
        unknown += 1;
      }
    }
    return { resumed, unknown };
  };

  const handle = async (
    rawMessage: unknown,
    sender: FlowObservationMessageSender,
  ): Promise<FlowImageObservationResponse> => {
    const parsed = FlowImageObservationMessageSchema.safeParse(rawMessage);
    if (!parsed.success)
      return { accepted: false, code: "invalid_observation" };
    const message = parsed.data;
    const event = message.observation;
    if (
      message.protocolVersion !== PROTOCOL_VERSION ||
      message.buildId !== BUILD_ID
    ) {
      return {
        accepted: false,
        code:
          message.protocolVersion !== PROTOCOL_VERSION
            ? "protocol_mismatch"
            : "build_mismatch",
        attemptId: event.attemptId,
      };
    }
    if (sender.id !== dependencies.extensionId) {
      return {
        accepted: false,
        code: "unauthorized_sender",
        attemptId: event.attemptId,
      };
    }
    const attempt = await dependencies.repositories.getFlowImageAttempt(
      event.attemptId,
    );
    if (!attempt)
      return {
        accepted: false,
        code: "attempt_missing",
        attemptId: event.attemptId,
      };
    const session = attempt.observationSession;
    const structural = "kind" in event;
    if (
      !session ||
      session.status !== "active" ||
      (session.profileSupport === "fixture_supported" &&
        (!dependencies.allowSyntheticProfile || structural)) ||
      (session.profileSupport === "production_observation_only" &&
        !structural) ||
      session.profileSupport === "unsupported"
    ) {
      return {
        accepted: false,
        code: "live_observation_profile_unsupported",
        attemptId: attempt.attemptId,
      };
    }
    if (
      attempt.buildId !== message.buildId ||
      attempt.protocolVersion !== message.protocolVersion
    ) {
      return {
        accepted: false,
        code: "attempt_build_binding_mismatch",
        attemptId: attempt.attemptId,
      };
    }
    if (sender.tab?.id !== attempt.tabId) {
      return {
        accepted: false,
        code: "observation_sender_tab_binding_mismatch",
        attemptId: attempt.attemptId,
      };
    }
    if (
      sender.frameId !== session.senderFrameId ||
      sender.documentId !== session.documentId
    ) {
      await setUnknown(
        attempt,
        "binding_changed",
        "observation_sender_document_binding_mismatch",
      );
      return {
        accepted: false,
        code: "observation_sender_document_binding_mismatch",
        attemptId: attempt.attemptId,
      };
    }
    if (event.sessionId !== session.sessionId) {
      await setUnknown(
        attempt,
        "binding_changed",
        "observation_session_id_mismatch",
      );
      return {
        accepted: false,
        code: "observation_session_id_mismatch",
        attemptId: attempt.attemptId,
      };
    }
    if (
      structural &&
      (!attempt.resultBaseline ||
        event.sourceBaselineFingerprint !==
          (await sha256Hex(
            flowImageResultBaselineFingerprintInput(attempt.resultBaseline),
          )) ||
        event.captureFingerprint !==
          (await sha256Hex(
            flowStructuralSnapshotFingerprintInput(event.snapshot),
          )))
    ) {
      await setUnknown(
        attempt,
        "binding_changed",
        "observation_source_baseline_or_capture_fingerprint_mismatch",
      );
      return {
        accepted: false,
        code: "observation_source_baseline_mismatch",
        attemptId: attempt.attemptId,
      };
    }
    if (structural && attempt.resultBaseline) {
      const bindingMismatch = Object.entries(
        attempt.resultBaseline.binding,
      ).find(
        ([key, value]) =>
          event.binding[key as keyof typeof event.binding] !== value,
      )?.[0];
      if (bindingMismatch) {
        const fieldNames: Record<string, string> = {
          workspaceId: "workspace_id",
          batchId: "batch_id",
          itemId: "item_id",
          sourceHash: "source_hash",
          sourceSnapshotId: "source_snapshot_id",
          attemptId: "attempt_id",
          provider: "provider",
          projectId: "project_id",
          tabId: "tab_id",
          frameId: "frame_id",
          loaderId: "loader_id",
        };
        const field = fieldNames[bindingMismatch] ?? "unknown";
        const diagnosticCode = `observation_event_binding_${field}_mismatch`;
        await setUnknown(attempt, "binding_changed", diagnosticCode);
        return {
          accepted: false,
          code: diagnosticCode,
          attemptId: attempt.attemptId,
        };
      }
    }
    if (now() >= session.deadlineAt) {
      await setUnknown(
        attempt,
        "observation_timeout",
        "observer_deadline_reached",
      );
      return {
        accepted: false,
        code: "observation_timeout",
        attemptId: attempt.attemptId,
      };
    }
    if (
      event.observedAt < session.startedAt ||
      event.observedAt > now() + 5_000
    ) {
      return {
        accepted: false,
        code: "observation_time_out_of_range",
        attemptId: attempt.attemptId,
      };
    }
    let bindingDiagnostic: string | null;
    try {
      bindingDiagnostic = await freshBindingMatches(attempt);
    } catch (error) {
      bindingDiagnostic = `binding_check_exception_${safeExceptionName(error)}`;
    }
    if (bindingDiagnostic) {
      await setUnknown(attempt, "binding_changed", bindingDiagnostic);
      return {
        accepted: false,
        code: bindingDiagnostic,
        attemptId: attempt.attemptId,
      };
    }
    const fingerprint = await sha256Hex(
      flowImageObservationFingerprintInput(event),
    );
    try {
      const stored = await dependencies.repositories.recordFlowImageObservation(
        {
          attemptId: attempt.attemptId,
          event,
          fingerprint,
          receivedAt: now(),
        },
      );
      return {
        accepted: true,
        duplicate: stored.status === "duplicate",
        attemptId: attempt.attemptId,
        outcome: stored.attempt.resultOutcome?.status ?? "unknown",
      };
    } catch {
      try {
        await setUnknown(
          attempt,
          "observation_lost",
          "observation_persistence_or_validation_failed",
        );
      } catch {
        // A second storage failure leaves the prior durable outcome intact.
      }
      return {
        accepted: false,
        code: "observation_persistence_or_validation_failed",
        attemptId: attempt.attemptId,
      };
    }
  };

  return { handle, resumeReadOnlyAfterWorkerRestart };
}

async function observationArmBinding(
  attempt: FlowImageAttemptRecord,
): Promise<import("../../domain/jobs/results").FlowImageObservationArmBinding> {
  const baseline = attempt.resultBaseline;
  if (!baseline || !attempt.documentId || attempt.senderFrameId === undefined)
    throw new Error("observation_binding_missing");
  return {
    workspaceId: attempt.workspaceId,
    batchId: attempt.batchId,
    itemId: attempt.itemId,
    sourceHash: attempt.promptHash,
    sourceSnapshotId: attempt.sourceSnapshotId,
    sourceBaselineFingerprint: await sha256Hex(
      flowImageResultBaselineFingerprintInput(baseline),
    ),
    attemptId: attempt.attemptId,
    provider: "Flow",
    projectId: attempt.projectId,
    canonicalTarget: attempt.settingsConfirmation.canonicalTarget ?? "",
    tabId: attempt.tabId,
    frameId: attempt.frameId,
    loaderId: attempt.loaderId,
    documentId: attempt.documentId,
    senderFrameId: attempt.senderFrameId,
    sessionId: attempt.observationSession!.sessionId,
    startedAt: attempt.observationSession!.startedAt,
    deadlineAt: attempt.observationSession!.deadlineAt,
    maxEvents: attempt.observationSession!.maxEvents,
    buildId: attempt.buildId,
    protocolVersion: attempt.protocolVersion,
  };
}
