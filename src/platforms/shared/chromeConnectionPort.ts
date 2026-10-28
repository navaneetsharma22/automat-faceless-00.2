import type {
  ConnectionPort,
  ConnectionProbeRequest,
  ConnectionProbeResponse,
  DocumentIdentity,
  ProviderAccessRequest,
  ProviderName,
  ProviderTab,
} from "./contracts";
import { CONNECTION_DISCONNECT_MESSAGE } from "./contracts";
import { providerTabFromUrl } from "./connection";
import {
  connectionApiDiagnostic,
  ConnectionApiUnavailableError,
  hasConnectionSetupApis,
  requireScriptingApi,
} from "./chromeApiDiagnostics";

function providerOrigin(
  provider: ProviderName,
  selected: ProviderTab,
): string | undefined {
  try {
    const origin = new URL(selected.canonicalTarget).origin;
    const permittedOrigins =
      provider === "Flow"
        ? ["https://flow.google.com", "https://labs.google"]
        : ["https://docs.google.com", "https://vids.google.com"];
    return permittedOrigins.includes(origin) ? `${origin}/*` : undefined;
  } catch {
    return undefined;
  }
}

export async function hasTabListingAccess(): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions || !chrome.tabs) {
    return false;
  }
  return chrome.permissions.contains({
    permissions: ["tabs"],
  });
}

export function requestTabListingAccess(): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions || !chrome.tabs) {
    return Promise.resolve(false);
  }
  // Call this directly from the dedicated user-click handler. Do not await
  // another extension API first: Chrome requires a user gesture for request().
  return chrome.permissions.request({ permissions: ["tabs"] });
}

export function requestProviderAccess(
  request: ProviderAccessRequest,
): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions) {
    return Promise.reject(new Error("Chrome permission API is unavailable"));
  }
  // Invoke this immediately from the provider-specific permission button.
  return chrome.permissions.request(request as chrome.permissions.Permissions);
}

export function createChromeConnectionPort(): ConnectionPort | undefined {
  if (!hasConnectionSetupApis()) return undefined;

  return {
    getMissingAccess: async (provider: ProviderName, selected: ProviderTab) => {
      const origin = providerOrigin(provider, selected);
      if (!origin || selected.provider !== provider) {
        throw new Error("Selected provider origin is unsupported");
      }
      const hasScripting = await chrome.permissions.contains({
        permissions: ["scripting"],
      });
      const hasOrigin = await chrome.permissions.contains({
        origins: [origin],
      });

      const request: ProviderAccessRequest = {};
      if (!hasScripting) request.permissions = ["scripting"];
      if (!hasOrigin) request.origins = [origin];
      return request;
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
    identifyDocument: async (tabId: number, selected: ProviderTab) => {
      const scripting = await requireScriptingApi(selected);
      const results = await scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: () => location.href,
      });
      return injectionIdentity(results[0]);
    },
    injectConnector: async (tabId: number, selected: ProviderTab) => {
      const scripting = await requireScriptingApi(selected);
      await scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["connection-probe.js"],
      });
      const results = await scripting.executeScript({
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

export type ProviderTabListing = {
  tabs: ProviderTab[];
  unsupportedProviderRoutes: number;
  unavailableUrls: number;
};

export async function listOpenProviderTabs(): Promise<ProviderTabListing> {
  if (typeof chrome === "undefined" || !chrome.tabs) {
    throw new Error("Chrome tabs API is unavailable");
  }
  const tabs = await chrome.tabs.query({});
  let unsupportedProviderRoutes = 0;
  let unavailableUrls = 0;
  const providerTabs: ProviderTab[] = [];
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url) {
      unavailableUrls += 1;
      continue;
    }
    const parsed = providerTabFromUrl(tab.id, tab.title ?? "", tab.url);
    if (parsed) {
      providerTabs.push(parsed);
      continue;
    }
    try {
      const url = new URL(tab.url);
      if (
        url.protocol === "https:" &&
        (url.hostname === "labs.google" ||
          url.hostname === "vids.google.com" ||
          (url.hostname === "docs.google.com" &&
            url.pathname.startsWith("/videos/")))
      ) {
        unsupportedProviderRoutes += 1;
      }
    } catch {
      unavailableUrls += 1;
    }
  }
  return { tabs: providerTabs, unsupportedProviderRoutes, unavailableUrls };
}

export { connectionApiDiagnostic, ConnectionApiUnavailableError };
