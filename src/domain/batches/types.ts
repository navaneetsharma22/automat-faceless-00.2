export type PromptKind = "image" | "video";
export type PromptInputMode =
  "single_json_value" | "numbered_json_blocks" | "versioned_envelope";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonPrompt = JsonValue[] | { [key: string]: JsonValue };

/** Supported schemaVersion 1 envelope input shape for the pure P03.2 importer. */
export type ExplicitPromptEnvelope = {
  schemaVersion: 1;
  kind: PromptKind;
  items: Array<{ shotId: string; prompt: JsonPrompt }>;
};

/** Decimal shot identity after removal of leading zeroes. Kept as text. */
export type CanonicalShotId = string;

export type ShotIdentitySource = {
  source: "outer_label" | "envelope" | "body_shot_id";
  value: string;
};

export type PromptIdentity = {
  workspaceId: string;
  shotId?: CanonicalShotId;
  identitySource?: ShotIdentitySource["source"];
};

export type IdentityResolution =
  | {
      ok: true;
      shotId?: CanonicalShotId;
      identitySource?: ShotIdentitySource["source"];
      kind: "explicit" | "unlabelled_single";
    }
  | {
      ok: false;
      reason:
        | "invalid_identity"
        | "conflicting_identity"
        | "unlabelled_multiple_prompts";
    };

export type PromptMeasurement = {
  stringCodeUnits: number;
  utf8Bytes: number;
};

export type BatchBudgetIssue =
  | "empty_batch"
  | "too_many_items"
  | "prompt_code_units_exceeded"
  | "prompt_utf8_bytes_exceeded"
  | "batch_code_units_exceeded"
  | "batch_utf8_bytes_exceeded";

export type BatchBudgetAssessment = {
  accepted: boolean;
  itemCount: number;
  total: PromptMeasurement;
  prompts: PromptMeasurement[];
  issues: BatchBudgetIssue[];
};

export type VideoDestination = "Flow" | "Vids";

export type VideoBatchManualSettingsDeclaration = {
  readonly confirmationId: string;
  readonly confirmedAt: number;
  readonly destination: VideoDestination;
  readonly declaredDurationSeconds: number;
  readonly tabId: number;
  readonly canonicalTarget: string;
  readonly projectId?: string;
  readonly documentId?: string;
  readonly userAttested: true;
};

export type PreparedVideoBatchItem = {
  readonly itemId: string;
  readonly order: number;
  readonly shotId?: string;
  readonly canonicalShotId: string;
  readonly rawJsonBody: string;
  readonly contentHash: string;
  readonly sourceSpan: { readonly start: number; readonly end: number };
  readonly reference: {
    readonly referenceId: string;
    readonly assignmentVersion: number;
    readonly sha256: string;
    readonly mimeType: string;
    readonly byteSize: number;
    readonly width: number;
    readonly height: number;
    readonly capturedAt: number;
  };
};

export type PreparedVideoBatchRecord = {
  readonly id: string;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly preparedAt: number;
  readonly videoBatchId: string;
  readonly videoSourceHash: string;
  readonly videoSourceText: string;
  readonly imageSourceBatchId: string;
  readonly imageSourceBatchHash: string;
  readonly destination: VideoDestination;
  readonly target: {
    readonly provider: VideoDestination;
    readonly tabId: number;
    readonly canonicalTarget: string;
    readonly projectId?: string;
    readonly documentId?: string;
    readonly verification: "verified";
    readonly verifiedAt: number;
  };
  readonly manualSettingsDeclaration: {
    readonly confirmationId: string;
    readonly confirmedAt: number;
    readonly destination: VideoDestination;
    readonly declaredDurationSeconds: number;
    readonly tabId: number;
    readonly canonicalTarget: string;
    readonly projectId?: string;
    readonly documentId?: string;
  };
  readonly status: "prepared";
  readonly itemCount: number;
  readonly items: readonly PreparedVideoBatchItem[];
  readonly createdAt: number;
  readonly updatedAt: number;
};
