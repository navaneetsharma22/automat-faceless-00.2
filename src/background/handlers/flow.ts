import { enterFlowPrompt } from "../../platforms/flow/promptEntry";
import type { FlowPromptEntryPort } from "../../platforms/flow/promptEntry";
import type { ExtensionRepositories } from "../../storage/repositories";
import { flowTabFromUrl } from "../../platforms/flow/connection";

export function createChromeFlowPromptEntryPort(
  repositories: ExtensionRepositories,
): FlowPromptEntryPort {
  return {
    getSelection: async () => {
      const selected = await repositories.getSelectedTarget("Flow");
      return selected
        ? { tabId: selected.tabId, canonicalTarget: selected.canonicalTarget }
        : undefined;
    },
    getTab: async (tabId) => {
      const tab = await chrome.tabs.get(tabId);
      return flowTabFromUrl(tabId, tab.title ?? "", tab.url);
    },
    hasRequiredApis: () =>
      typeof chrome !== "undefined" &&
      typeof chrome.tabs?.get === "function" &&
      typeof chrome.debugger?.attach === "function" &&
      typeof chrome.debugger?.sendCommand === "function" &&
      typeof chrome.debugger?.detach === "function",
    hasDebuggerPermission: async () => {
      if (typeof chrome === "undefined" || !chrome.permissions?.contains) {
        return false;
      }
      return chrome.permissions.contains({ permissions: ["debugger", "tabs"] });
    },
    attach: (tabId) => chrome.debugger.attach({ tabId }, "1.3"),
    sendCommand: (tabId, method, params) =>
      chrome.debugger.sendCommand({ tabId }, method, params),
    detach: async (tabId) => {
      if (chrome.debugger.getTargets) {
        const targets = await chrome.debugger.getTargets();
        if (
          !targets.some((target) => target.tabId === tabId && target.attached)
        ) {
          return;
        }
      }
      await chrome.debugger.detach({ tabId });
    },
  };
}

export function createFlowPromptEntry(
  repositories: ExtensionRepositories,
  port: FlowPromptEntryPort,
): (sourceText: string) => Promise<unknown> {
  return async (sourceText) => {
    // The selected tab ID is explicit metadata. A fresh route and CDP frame
    // identity are checked by enterFlowPrompt before input and readback.
    await repositories.getSelectedTarget("Flow");
    return enterFlowPrompt(sourceText, port);
  };
}
