import { FoundationClientError } from "../shared/messageClient";

export async function withPendingCleanup<T>(
  operation: () => Promise<T>,
  clearPending: () => void,
): Promise<T> {
  try {
    return await operation();
  } finally {
    clearPending();
  }
}

export function connectionWorkerFailureDetail(error: unknown): string {
  if (error instanceof FoundationClientError) {
    return `selection_storage/${error.category}/${error.code}: ${error.message}`;
  }
  return "selection_storage/worker_error: The selected target could not be saved by the extension worker. Reopen the packaged dashboard and select it again.";
}
