export const FLOW_IMAGE_ATTEMPT_STATES = [
  "preparing",
  "verified",
  "dispatch-intent",
  "dispatched",
  "failed-before-dispatch",
  "uncertain",
] as const;

export type FlowImageAttemptState = (typeof FLOW_IMAGE_ATTEMPT_STATES)[number];

export type FlowImageAttemptEvent = {
  stage: "preparation" | "verification" | "dispatch" | "recovery";
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
  buildId: string;
  protocolVersion: number;
  settingsConfirmation: {
    confirmationId: string;
    confirmedAt: number;
    userAttested: true;
    tabId: number;
    projectId: string;
    canonicalTarget?: string;
  };
  state: FlowImageAttemptState;
  baseline?: FlowImageAttemptBaseline;
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

export function flowImageAttemptActiveKey(itemId: string): string {
  return `flow-image:${itemId}`;
}
