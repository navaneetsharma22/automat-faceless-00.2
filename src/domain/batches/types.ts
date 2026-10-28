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
