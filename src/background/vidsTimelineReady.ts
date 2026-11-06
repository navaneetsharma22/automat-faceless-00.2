import { createVidsTimelineReadiness, type VidsTimelineReadiness } from "../domain/media/combinedExport";
import type { ChromePreferenceRepository, ExtensionRepositories } from "../storage/repositories";
import { parseProviderRoute } from "../platforms/shared/providerRoute";

export function createVidsTimelineReadyHandler(input: {
  preferences: ChromePreferenceRepository;
  repositories: ExtensionRepositories;
  revalidate: () => Promise<unknown>;
}) {
  const pending = new Set<string>();
  return {
    get: () => input.preferences.getVidsTimelineReadiness(),
    invalidate: (expectedDocumentId?: string) =>
      input.preferences.clearVidsTimelineReadiness(expectedDocumentId),
    async declare(declaration: {
      documentId: string;
      canonicalTarget: string;
      tabId: number;
      sceneOrderConfirmed: true;
      documentSavedConfirmed: true;
    }): Promise<VidsTimelineReadiness> {
      const key = `${declaration.tabId}:${declaration.documentId}`;
      if (pending.has(key)) throw new Error("vids_timeline_ready_pending");
      pending.add(key);
      try {
        const current = await input.revalidate() as {
          ok?: boolean; state?: string; tab?: { id?: number; provider?: string; projectId?: string; canonicalTarget?: string };
        };
        const route = parseProviderRoute(current?.tab?.canonicalTarget ?? "");
        if (!current?.ok || current.state !== "verified" || !current.tab ||
          current.tab.provider !== "Vids" || current.tab.id !== declaration.tabId ||
          !route || route.provider !== "Vids" || route.projectId !== declaration.documentId ||
          route.canonicalTarget !== declaration.canonicalTarget ||
          current.tab.canonicalTarget !== declaration.canonicalTarget) {
          throw new Error("vids_timeline_document_mismatch");
        }
        const selected = await input.repositories.getSelectedTarget("Vids");
        const binding = selected?.verificationBinding;
        if (!selected || selected.verification !== "verified" || selected.connectionState !== "verified" ||
          selected.tabId !== declaration.tabId || selected.canonicalTarget !== declaration.canonicalTarget ||
          !binding || binding.provider !== "Vids" || binding.tabId !== declaration.tabId ||
          binding.canonicalTarget !== declaration.canonicalTarget || binding.projectId !== declaration.documentId) {
          throw new Error("vids_timeline_document_mismatch");
        }
        const record = createVidsTimelineReadiness({
          documentId: declaration.documentId,
          canonicalTarget: declaration.canonicalTarget,
          tabId: declaration.tabId,
          sceneOrderConfirmed: true,
          documentSavedConfirmed: true,
        });
        await input.preferences.setVidsTimelineReadiness(record);
        return record;
      } finally {
        pending.delete(key);
      }
    },
  };
}
