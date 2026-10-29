import { flowTabFromUrl } from "../../platforms/flow/connection";
import type { FlowImageGenerateOncePort } from "./flow";
import {
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
    });
  };

  const freshBindingMatches = async (
    attempt: FlowImageAttemptRecord,
  ): Promise<boolean> => {
    if (!attempt.documentId || attempt.senderFrameId !== 0) return false;
    const selected = await dependencies.repositories.getSelectedTarget("Flow");
    if (
      !selected ||
      selected.tabId !== attempt.tabId ||
      selected.canonicalTarget !==
        attempt.settingsConfirmation.canonicalTarget ||
      (await dependencies.port.getSelection())?.tabId !== attempt.tabId
    ) {
      return false;
    }
    const tab = await dependencies.port.getTab(attempt.tabId);
    const parsed = flowTabFromUrl(attempt.tabId, tab?.title ?? "", tab?.url);
    if (
      !parsed ||
      parsed.projectId !== attempt.projectId ||
      parsed.canonicalTarget !== selected.canonicalTarget
    ) {
      return false;
    }
    const frame = await dependencies.port.readFrame(attempt.tabId);
    if (
      !frame ||
      frame.frameId !== attempt.frameId ||
      frame.loaderId !== attempt.loaderId ||
      frame.documentId !== attempt.documentId ||
      frame.senderFrameId !== attempt.senderFrameId ||
      flowTabFromUrl(attempt.tabId, "", frame.url)?.canonicalTarget !==
        selected.canonicalTarget ||
      !flowResultBaselineMatchesAttempt(attempt.resultBaseline, attempt)
    ) {
      return false;
    }
    const source = await dependencies.repositories.getFlowImagePromptSnapshot(
      attempt.sourceSnapshotId,
    );
    return Boolean(
      source &&
      source.workspaceId === attempt.workspaceId &&
      source.batchId === attempt.batchId &&
      source.itemId === attempt.itemId &&
      source.promptHash === attempt.promptHash &&
      source.snapshotId === attempt.sourceSnapshotId &&
      (await sha256Hex(source.rawJsonBody)) === attempt.promptHash,
    );
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
        !session ||
        session.status !== "active" ||
        session.profileSupport !== "fixture_supported" ||
        (attempt.state !== "dispatched" && attempt.state !== "uncertain")
      ) {
        continue;
      }
      if (now() >= session.deadlineAt) {
        await setUnknown(attempt, "observation_timeout");
        unknown += 1;
        continue;
      }
      if (
        session.reconciliationCount >= MAX_RECONCILIATIONS ||
        !(await freshBindingMatches(attempt))
      ) {
        await setUnknown(
          attempt,
          session.reconciliationCount >= MAX_RECONCILIATIONS
            ? "event_limit_reached"
            : "binding_changed",
        );
        unknown += 1;
        continue;
      }
      try {
        await dependencies.repositories.updateFlowImageObservationSession({
          attemptId: attempt.attemptId,
          sessionId: session.sessionId,
          reconciliationCount: session.reconciliationCount + 1,
        });
        resumed += 1;
      } catch {
        await setUnknown(attempt, "observation_lost");
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
    if (
      !session ||
      session.status !== "active" ||
      session.profileSupport !== "fixture_supported" ||
      !dependencies.allowSyntheticProfile
    ) {
      return {
        accepted: false,
        code: "live_observation_profile_unsupported",
        attemptId: attempt.attemptId,
      };
    }
    if (
      sender.tab?.id !== attempt.tabId ||
      sender.frameId !== session.senderFrameId ||
      sender.documentId !== session.documentId ||
      event.sessionId !== session.sessionId
    ) {
      return {
        accepted: false,
        code: "observation_sender_binding_mismatch",
        attemptId: attempt.attemptId,
      };
    }
    if (now() >= session.deadlineAt) {
      await setUnknown(attempt, "observation_timeout");
      return {
        accepted: false,
        code: "observation_timeout",
        attemptId: attempt.attemptId,
      };
    }
    let fresh: boolean;
    try {
      fresh = await freshBindingMatches(attempt);
    } catch {
      fresh = false;
    }
    if (!fresh) {
      await setUnknown(attempt, "binding_changed");
      return {
        accepted: false,
        code: "observation_binding_changed",
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
        await setUnknown(attempt, "observation_lost");
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
