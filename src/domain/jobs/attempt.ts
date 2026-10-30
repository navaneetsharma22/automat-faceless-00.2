import type {
  FlowImageObservationOutcome,
  FlowImageObservationSession,
  FlowImageResultBaseline,
  FlowImageResultLink,
  FlowImageCountBaselineDeclaration,
  FlowImageCountDecision,
  FlowStructuralObservationEvent,
} from "./results";
import { sha256Hex } from "../batches/hashPrompt";

export const FLOW_IMAGE_ATTEMPT_STATES = [
  "preparing",
  "verified",
  "dispatch-intent",
  "dispatched",
  "failed-before-dispatch",
  "uncertain",
] as const;

export type FlowImageAttemptState = (typeof FLOW_IMAGE_ATTEMPT_STATES)[number];

export type FlowImageAttemptStage =
  | "preparation"
  | "preflight"
  | "observer"
  | "dispatch"
  | "storage"
  | "recovery";

export type FlowImageAttemptEvent = {
  stage: FlowImageAttemptStage | "verification";
  at: number;
  method: "none" | "CDP Input.insertText" | "CDP Input.dispatchMouseEvent";
  code?: string;
};

export type FlowImageAttemptBaseline =
  | {
      regionLabel: string;
      mediaCount: number;
      capturedAt: number;
    }
  | {
      kind: "flow_empty_workspace_ui";
      workspaceTag: "flow-project-page";
      markerPhrase: "Start creating or drop media";
      markerCount: 1;
      visibleMediaCount: 0;
      visibleResultCardCount: 0;
      loadingMarkerCount: 0;
      capturedAt: number;
    }
  | {
      kind: "flow_rendered_tile_candidates";
      workspaceTag: "flow-project-page";
      renderedTileCount: number;
      candidateIds: string[];
      qualifyingCandidateIds?: string[];
      candidateMultiplicity: Array<{
        candidateId: string;
        renderedCopies: number;
      }>;
      repeatedCandidateCount: number;
      unidentifiedImageCount: number;
      unrelatedImageCount: number;
      virtualScrollContainerCount?: number;
      virtualizationEvidence?: Array<
        | "scroll_extent_exceeds_viewport"
        | "nonzero_scroll_offset"
        | "viewport_dimensions_unavailable"
        | "scroll_observed_during_capture"
        | "tile_identity_recycled"
      >;
      virtualized: boolean;
      loadingSignalCount: number;
      captureGaps: string[];
      capturedAt: number;
    };

export type FlowImageAttemptRecord = {
  attemptId: string;
  activeKey?: string;
  confirmationKey: string;
  workspaceId: string;
  batchId: string;
  itemId: string;
  shotId?: string;
  promptHash: string;
  sourceSnapshotId: string;
  promptCodeUnits: number;
  promptUtf8Bytes: number;
  provider: "Flow";
  projectId: string;
  tabId: number;
  frameId: string;
  loaderId: string;
  documentId?: string;
  senderFrameId?: number;
  buildId: string;
  protocolVersion: number;
  settingsConfirmation: {
    confirmationId: string;
    confirmedAt: number;
    userAttested: true;
    tabId: number;
    projectId: string;
    canonicalTarget?: string;
    /** Absent on historical P04 attempts. */
    declaredVariantCount?: number;
  };
  state: FlowImageAttemptState;
  /** Monotonic durable compare-and-set revision; absent on pre-P05 records. */
  revision?: number;
  baseline?: FlowImageAttemptBaseline;
  /** Optional for compatibility with attempts written before P05.1. */
  resultBaseline?: FlowImageResultBaseline;
  observationSession?: FlowImageObservationSession;
  resultLinks?: FlowImageResultLink[];
  observationReceipts?: Array<{
    observationId: string;
    sequence: number;
    fingerprint: string;
    receivedAt: number;
  }>;
  /** Bounded page-derived structural payloads retained for read-only review. */
  structuralObservations?: FlowStructuralObservationEvent[];
  resultOutcome?: FlowImageObservationOutcome;
  countSessionId?: string;
  /** Separate heuristic bookkeeping; never upgrades provider outcome. */
  countBaseline?: FlowImageCountBaselineDeclaration;
  countDecision?: FlowImageCountDecision;
  events: FlowImageAttemptEvent[];
  createdAt: number;
  updatedAt: number;
};

const TRANSITIONS: Record<
  FlowImageAttemptState,
  readonly FlowImageAttemptState[]
> = {
  preparing: ["verified", "failed-before-dispatch"],
  verified: ["dispatch-intent", "failed-before-dispatch"],
  "dispatch-intent": ["dispatched", "uncertain", "failed-before-dispatch"],
  dispatched: [],
  "failed-before-dispatch": [],
  uncertain: [],
};

export function canTransitionFlowImageAttempt(
  from: FlowImageAttemptState,
  to: FlowImageAttemptState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isBlockingFlowImageAttempt(
  attempt: Pick<FlowImageAttemptRecord, "state">,
): boolean {
  return attempt.state !== "failed-before-dispatch";
}

export function flowImageAttemptActiveKey(
  itemId: string,
  promptHash?: string,
): string {
  return promptHash
    ? `flow-image:${itemId}:${promptHash}`
    : `flow-image:${itemId}`;
}

/** Reuse one settings attestation across prompts while deduplicating a repeated source. */
export async function flowImageAttemptConfirmationKey(
  confirmationId: string,
  promptHash: string,
): Promise<string> {
  return sha256Hex(
    `flow-image-confirmation-v1\u0000${confirmationId}\u0000${promptHash}`,
  );
}
