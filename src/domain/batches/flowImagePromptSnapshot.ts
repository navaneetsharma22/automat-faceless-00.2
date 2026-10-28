export type FlowImagePromptSnapshotRecord = {
  snapshotId: string;
  workspaceId: string;
  batchId: string;
  itemId: string;
  promptHash: string;
  rawJsonBody: string;
  promptCodeUnits: number;
  promptUtf8Bytes: number;
  createdAt: number;
};

/** Content-addressed by the saved item identity and exact prompt hash. */
export function flowImagePromptSnapshotId(
  itemId: string,
  promptHash: string,
): string {
  return `flow-image-source:${itemId}:${promptHash}`;
}
