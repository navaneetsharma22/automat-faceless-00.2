import { INPUT_POLICY } from "../../../domain/batches/inputPolicy";

export type ImportFileErrorCode =
  "file_too_large" | "invalid_utf8" | "read_failed";

export class ImportFileError extends Error {
  constructor(readonly code: ImportFileErrorCode) {
    super(
      code === "file_too_large"
        ? `File exceeds the ${INPUT_POLICY.maxBatchUtf8Bytes.toLocaleString()} byte total-input limit.`
        : code === "invalid_utf8"
          ? "File is not valid UTF-8 text."
          : "File could not be read.",
    );
    this.name = "ImportFileError";
  }
}

/** Checks byte metadata before reading, decodes strict UTF-8, and removes only a leading UTF-8 BOM. */
export async function readJsonSourceFile(
  file: Pick<File, "size" | "arrayBuffer">,
): Promise<string> {
  if (file.size > INPUT_POLICY.maxBatchUtf8Bytes) {
    throw new ImportFileError("file_too_large");
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new ImportFileError("read_failed");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new ImportFileError("invalid_utf8");
  }
  return decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
}
