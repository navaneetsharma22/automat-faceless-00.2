import type {
  ConnectionPort,
  ConnectionProbeResponse,
  ProviderName,
  ProviderTab,
} from "./contracts";
import { CONNECTION_PROBE_MESSAGE } from "./contracts";
import { providerTabFromUrl } from "./connection";

export function createChromeConnectionPort(): ConnectionPort | undefined {
  if (
    typeof chrome === "undefined" ||
    !chrome.tabs ||
    !chrome.scripting ||
    !chrome.permissions
  ) {
    return undefined;
  }

  return {
    requestAccess: async (provider: ProviderName) => {
      const origin =
        provider === "Flow"
          ? "https://labs.google/*"
          : "https://vids.google.com/*";
      return chrome.permissions.request({
        permissions: ["scripting"],
        origins: [origin],
      });
    },
    getTab: async (tabId: number) => {
      const tab = await chrome.tabs.get(tabId);
      return providerTabFromUrl(tabId, tab.title ?? "", tab.url);
    },
    injectTopFrameProbe: async (tabId: number) => {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["connection-probe.js"],
      });
    },
    probeTopFrame: async (tabId: number, provider: ProviderName) =>
      (await chrome.tabs.sendMessage(
        tabId,
        { type: CONNECTION_PROBE_MESSAGE, provider },
        { frameId: 0 },
      )) as ConnectionProbeResponse | undefined,
  };
}

export async function listOpenProviderTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .map((tab) => providerTabFromUrl(tab.id ?? -1, tab.title ?? "", tab.url))
    .filter((tab): tab is ProviderTab => tab !== undefined && tab.id >= 0);
}
