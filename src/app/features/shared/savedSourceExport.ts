import { importPromptBatch } from "../../../domain/batches/importBatch";
import type { PromptKind } from "../../../domain/batches/types";
import { PromptBatchSnapshotSchema } from "../../../shared/schemas";
import type { FoundationClient } from "../../../shared/messageClient";

export type SavedSourceExportDetails = {
  fileName: string;
  codeUnits: number;
  byteCount: number;
  sha256: string;
};

export type DownloadPort = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  clickDownload: (url: string, fileName: string) => void;
  schedule: (callback: () => void, delayMs: number) => unknown;
};

const browserDownloadPort: DownloadPort = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  clickDownload: (url, fileName) => {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  },
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
};

/** Reads the validated saved batch source and downloads its unmodified UTF-8 bytes. */
export async function exportSavedPromptSource(
  client: FoundationClient,
  workspaceId: string,
  kind: PromptKind,
  download: (bytes: Uint8Array, fileName: string) => void = downloadUtf8Source,
): Promise<SavedSourceExportDetails> {
  const response = await client.request("promptBatch.get", {
    workspaceId,
    kind,
  });
  const parsed = PromptBatchSnapshotSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The extension returned an invalid saved batch.");
  }

  const { batch, items } = parsed.data;
  if (
    batch.workspaceId !== workspaceId ||
    batch.workflowId !== workspaceId ||
    batch.kind !== kind ||
    batch.id !== `import:${workspaceId}:${kind}` ||
    batch.orderedItemIds.length !== items.length ||
    items.some(
      (item, order) =>
        item.id !== batch.orderedItemIds[order] ||
        item.batchId !== batch.id ||
        item.workspaceId !== workspaceId ||
        item.kind !== kind ||
        item.order !== order,
    )
  ) {
    throw new Error(
      "The saved prompt batch did not match this workspace and kind.",
    );
  }

  const imported = importPromptBatch(batch.sourceText, kind);
  if (
    !imported.ok ||
    imported.mode !== batch.sourceMode ||
    imported.items.length !== items.length ||
    imported.total.stringCodeUnits !== batch.total.stringCodeUnits ||
    imported.total.utf8Bytes !== batch.total.utf8Bytes ||
    imported.items.some((expected, index) => {
      const saved = items[index]!;
      return (
        expected.rawBody !== saved.rawJsonBody ||
        expected.sourceSpan.start !== saved.sourceSpan.start ||
        expected.sourceSpan.end !== saved.sourceSpan.end ||
        expected.measurement.stringCodeUnits !==
          saved.measurement.stringCodeUnits ||
        expected.measurement.utf8Bytes !== saved.measurement.utf8Bytes ||
        expected.shotId !== saved.shotId ||
        expected.identitySource !== saved.identitySource
      );
    })
  ) {
    throw new Error("The saved source failed integrity verification.");
  }

  const source = batch.sourceText;
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const safeWorkspace = workspaceId.replace(/[^A-Za-z0-9._-]/g, "_");
  const fileName = `automat-faceless-${safeWorkspace}-${kind}-saved-source.json`;

  download(bytes, fileName);
  return {
    fileName,
    codeUnits: source.length,
    byteCount: bytes.byteLength,
    sha256,
  };
}

export function downloadUtf8Source(
  bytes: Uint8Array,
  fileName: string,
  port: DownloadPort = browserDownloadPort,
): void {
  const exactBytes = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([exactBytes], {
    type: "application/json;charset=utf-8",
  });
  const url = port.createObjectURL(blob);
  try {
    port.clickDownload(url, fileName);
  } catch (error) {
    port.revokeObjectURL(url);
    throw error;
  }
  try {
    port.schedule(() => port.revokeObjectURL(url), 1_000);
  } catch {
    port.revokeObjectURL(url);
  }
}
