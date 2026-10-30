import { FoundationClientError } from "../shared/messageClient";
import type { ProviderName } from "../platforms/shared/contracts";

export function hasVerifiedBindingForSelectedTarget(
  current: {
    provider: ProviderName;
    tabId: number;
    canonicalTarget: string;
    verification: "unverified" | "verified";
    connectionState?: string;
    verificationBinding?: {
      provider: ProviderName;
      tabId: number;
      canonicalTarget: string;
      documentId: string;
      documentToken: string;
    };
  } | null,
  target: { provider: ProviderName; tabId: number; canonicalTarget: string },
): boolean {
  const binding = current?.verificationBinding;
  return Boolean(
    current &&
    binding &&
    current.provider === target.provider &&
    current.tabId === target.tabId &&
    current.canonicalTarget === target.canonicalTarget &&
    current.verification === "verified" &&
    ["checking", "verified"].includes(current.connectionState ?? "") &&
    binding.provider === target.provider &&
    binding.tabId === target.tabId &&
    binding.canonicalTarget === target.canonicalTarget &&
    binding.documentId &&
    binding.documentToken,
  );
}

export function connectionDisplayAnnouncement(
  status: string,
  message: string,
): string | null {
  if (status === "pending") return message;
  if (status === "connected" && message === "Connected — checking…")
    return message;
  return null;
}

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
