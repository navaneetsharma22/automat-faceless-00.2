import type {
  ConnectionPort,
  ConnectionResult,
  ProviderName,
  ProviderTab,
} from "./contracts";

export function providerTabFromUrl(
  id: number,
  title: string,
  rawUrl: string | undefined,
): ProviderTab | undefined {
  if (!rawUrl) return undefined;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return undefined;

    let provider: ProviderName;
    if (
      url.hostname === "labs.google" &&
      url.pathname.startsWith("/fx/tools/flow")
    ) {
      provider = "Flow";
    } else if (
      url.hostname === "vids.google.com" &&
      url.pathname !== "/" &&
      url.pathname.length > 1
    ) {
      provider = "Vids";
    } else {
      return undefined;
    }

    return {
      id,
      title: title.trim() || `${provider} document`,
      url: rawUrl,
      provider,
      canonicalTarget: `${url.origin}${url.pathname}`,
    };
  } catch {
    return undefined;
  }
}

export async function attachToSelectedTab(
  provider: ProviderName,
  selectedTabId: number,
  port: ConnectionPort,
): Promise<ConnectionResult> {
  try {
    // Request any missing optional access before other awaits, directly from
    // the Connect/Reconnect gesture. This path never refreshes or navigates.
    if (!(await port.requestAccess(provider))) {
      return {
        ok: false,
        error: `Access to the selected ${provider} tab was not granted. The tab was left open and unchanged. You can retry Connect.`,
      };
    }

    const tab = await port.getTab(selectedTabId);
    if (!tab || tab.id !== selectedTabId || tab.provider !== provider) {
      return {
        ok: false,
        error: `The selected tab is no longer an open ${provider} document. Select the intended open tab and retry.`,
      };
    }

    await port.injectTopFrameProbe(tab.id);
    const response = await port.probeTopFrame(tab.id, provider);
    if (
      !response?.ok ||
      response.provider !== provider ||
      response.canonicalTarget !== tab.canonicalTarget ||
      response.adapterCapability !== "read-only-connection-v1"
    ) {
      return {
        ok: false,
        error:
          response?.error ??
          `Could not confirm a read-only ${provider} adapter on the selected document. It was not changed. Retry after confirming the document is open.`,
      };
    }

    return { ok: true, tab };
  } catch {
    return {
      ok: false,
      error: `Could not attach to the selected ${provider} tab. It was left open and unchanged. Retry when the tab is ready.`,
    };
  }
}
