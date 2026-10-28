import type {
  ConnectionPort,
  ConnectionProbeRequest,
  ConnectionProbeResponse,
  DocumentIdentity,
  ProviderName,
  ProviderTab,
} from "./contracts";
import { CONNECTION_DISCONNECT_MESSAGE } from "./contracts";
import { providerTabFromUrl } from "./connection";

const providerOrigin = (provider: ProviderName) =>
  provider === "Flow" ? "https://labs.google/*" : "https://vids.google.com/*";

export async function requestTabListingAccess(): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions || !chrome.tabs) {
    return false;
  }
  const alreadyGranted = await chrome.permissions.contains({
    permissions: ["tabs"],
  });
  if (alreadyGranted) return true;
  return await chrome.permissions.request({ permissions: ["tabs"] });
}

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
      const origin = providerOrigin(provider);
      const hasScripting = await chrome.permissions.contains({
        permissions: ["scripting"],
      });
      const hasOrigin = await chrome.permissions.contains({
        origins: [origin],
      });
      if (hasScripting && hasOrigin) return true;

      const request: chrome.permissions.Permissions = {};
      if (!hasScripting) request.permissions = ["scripting"];
      if (!hasOrigin) request.origins = [origin];
      return chrome.permissions.request(request);
    },
    getTab: async (tabId: number) => {
      const tab = await chrome.tabs.get(tabId);
      return providerTabFromUrl(tabId, tab.title ?? "", tab.url);
    },
    pingTopFrame: async (tabId: number, request: ConnectionProbeRequest) => {
      try {
        return (await chrome.tabs.sendMessage(tabId, request, {
          frameId: 0,
        })) as ConnectionProbeResponse | undefined;
      } catch {
        // A missing listener is the expected signal to inject the packaged connector.
        return undefined;
      }
    },
    identifyDocument: async (tabId: number) => {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: () => location.href,
      });
      return injectionIdentity(results[0]);
    },
    injectConnector: async (tabId: number) => {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["connection-probe.js"],
      });
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: () => location.href,
      });
      return injectionIdentity(results[0]);
    },
    probeTopFrame: async (
      tabId: number,
      documentId: string,
      request: ConnectionProbeRequest,
    ) =>
      (await chrome.tabs.sendMessage(tabId, request, {
        frameId: 0,
        documentId,
      })) as ConnectionProbeResponse | undefined,
    releaseConnector: async (tabId: number, documentId: string) => {
      try {
        await chrome.tabs.sendMessage(
          tabId,
          { type: CONNECTION_DISCONNECT_MESSAGE },
          { frameId: 0, documentId },
        );
      } catch {
        // A closed/replaced document has no listener left to release.
      }
    },
    makeAttemptId: () => crypto.randomUUID(),
  };
}

function injectionIdentity(
  result: chrome.scripting.InjectionResult<unknown> | undefined,
): DocumentIdentity | undefined {
  if (
    !result?.documentId ||
    result.frameId !== 0 ||
    typeof result.result !== "string"
  ) {
    return undefined;
  }
  return {
    documentId: result.documentId,
    frameId: result.frameId,
    url: result.result,
  };
}

export async function listOpenProviderTabs(): Promise<ProviderTab[]> {
  if (typeof chrome === "undefined" || !chrome.tabs) return [];
  const tabs = await chrome.tabs.query({});
  return tabs
    .map((tab) => providerTabFromUrl(tab.id ?? -1, tab.title ?? "", tab.url))
    .filter((tab): tab is ProviderTab => tab !== undefined);
}
