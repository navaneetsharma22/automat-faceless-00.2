import { providerTabFromUrl } from "../shared/connection";
import type { ProviderTab } from "../shared/contracts";

/** Parse a supported Flow URL without rewriting the URL stored for the tab. */
export function flowTabFromUrl(
  id: number,
  title: string,
  rawUrl: string | undefined,
): ProviderTab | undefined {
  const tab = providerTabFromUrl(id, title, rawUrl);
  return tab?.provider === "Flow" ? tab : undefined;
}

export function sameFlowDocument(
  selected: Pick<ProviderTab, "id" | "projectId" | "canonicalTarget">,
  current: ProviderTab | undefined,
): current is ProviderTab {
  return Boolean(
    current &&
    current.provider === "Flow" &&
    current.id === selected.id &&
    current.projectId === selected.projectId &&
    current.canonicalTarget === selected.canonicalTarget,
  );
}
