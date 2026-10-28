import type { ProviderName, ProviderTab } from "./contracts";

export type ChromeApiStage =
  | "discovery"
  | "permission_request"
  | "connection_setup"
  | "worker_messaging"
  | "connector_injection";

export type ChromeExecutionContext =
  | "packaged_extension"
  | "localhost_preview"
  | "invalid_extension_context"
  | "invalidated_extension_context";

export function getChromeExecutionContext(): ChromeExecutionContext {
  const runtimeId =
    typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  const pageProtocol = typeof location === "undefined" ? "" : location.protocol;
  const pageHost = typeof location === "undefined" ? "" : location.hostname;

  if (pageProtocol === "chrome-extension:" && runtimeId) {
    return "packaged_extension";
  }
  if (pageProtocol === "chrome-extension:" && !runtimeId) {
    return "invalidated_extension_context";
  }
  if (
    (pageHost === "localhost" || pageHost === "127.0.0.1") &&
    (pageProtocol === "http:" || pageProtocol === "https:")
  ) {
    return "localhost_preview";
  }
  return "invalid_extension_context";
}

export function hasWorkerMessagingApi(): boolean {
  return Boolean(
    getChromeExecutionContext() === "packaged_extension" &&
    typeof chrome.runtime?.sendMessage === "function",
  );
}

export function hasDiscoveryApis(): boolean {
  return Boolean(
    getChromeExecutionContext() === "packaged_extension" &&
    typeof chrome.tabs?.query === "function" &&
    typeof chrome.permissions?.contains === "function" &&
    typeof chrome.permissions?.request === "function",
  );
}

export function hasConnectionSetupApis(): boolean {
  return Boolean(
    getChromeExecutionContext() === "packaged_extension" &&
    typeof chrome.tabs?.get === "function" &&
    typeof chrome.tabs?.sendMessage === "function" &&
    typeof chrome.permissions?.contains === "function" &&
    typeof chrome.permissions?.request === "function",
  );
}

export class ConnectionApiUnavailableError extends Error {
  constructor(
    readonly stage: "connector_injection",
    readonly diagnostic: string,
  ) {
    super(diagnostic);
    this.name = "ConnectionApiUnavailableError";
  }
}

export async function connectionApiDiagnostic(
  stage: ChromeApiStage,
  selected?: ProviderTab,
): Promise<string> {
  const context = getChromeExecutionContext();
  const runtimeIdPresent =
    typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  const missingApis = missingApisForStage(stage);
  const scriptingPermission = await permissionStatus({
    permissions: ["scripting"],
  });
  const sitePermission = selected
    ? await permissionStatus({
        origins: [providerOrigin(selected.provider, selected)],
      })
    : "not_checked";

  return [
    context === "invalidated_extension_context"
      ? "extension_context_invalidated"
      : "connection_api_unavailable",
    `context=${context}`,
    `stage=${stage}`,
    `missing_api=${missingApis.length > 0 ? missingApis.join(",") : "none"}`,
    `runtime.id=${runtimeIdPresent ? "present" : "absent"}`,
    `permission.scripting=${scriptingPermission}`,
    `permission.selected_host=${sitePermission}`,
  ].join("; ");
}

export async function requireScriptingApi(
  selected: ProviderTab,
): Promise<typeof chrome.scripting> {
  if (
    typeof chrome !== "undefined" &&
    typeof chrome.scripting?.executeScript === "function"
  ) {
    return chrome.scripting;
  }
  throw new ConnectionApiUnavailableError(
    "connector_injection",
    await connectionApiDiagnostic("connector_injection", selected),
  );
}

function missingApisForStage(stage: ChromeApiStage): string[] {
  const missing: string[] = [];
  const context = getChromeExecutionContext();
  if (context !== "packaged_extension") missing.push("chrome.runtime.id");

  if (typeof chrome === "undefined") return missing;
  if (stage === "discovery") {
    if (typeof chrome.tabs?.query !== "function") {
      missing.push("chrome.tabs.query");
    }
    if (typeof chrome.permissions?.contains !== "function") {
      missing.push("chrome.permissions.contains");
    }
    if (typeof chrome.permissions?.request !== "function") {
      missing.push("chrome.permissions.request");
    }
  } else if (stage === "permission_request") {
    if (typeof chrome.permissions?.request !== "function") {
      missing.push("chrome.permissions.request");
    }
  } else if (stage === "connection_setup") {
    if (typeof chrome.tabs?.get !== "function") missing.push("chrome.tabs.get");
    if (typeof chrome.tabs?.sendMessage !== "function") {
      missing.push("chrome.tabs.sendMessage");
    }
    if (typeof chrome.permissions?.contains !== "function") {
      missing.push("chrome.permissions.contains");
    }
    if (typeof chrome.permissions?.request !== "function") {
      missing.push("chrome.permissions.request");
    }
  } else if (stage === "worker_messaging") {
    if (typeof chrome.runtime?.sendMessage !== "function") {
      missing.push("chrome.runtime.sendMessage");
    }
  } else if (typeof chrome.scripting?.executeScript !== "function") {
    missing.push("chrome.scripting.executeScript");
  }
  return missing;
}

async function permissionStatus(
  permission: chrome.permissions.Permissions,
): Promise<
  "granted" | "not_granted" | "unavailable" | "unknown" | "not_checked"
> {
  if (typeof chrome === "undefined" || !chrome.permissions?.contains) {
    return "unavailable";
  }
  try {
    return (await chrome.permissions.contains(permission))
      ? "granted"
      : "not_granted";
  } catch {
    return "unknown";
  }
}

function providerOrigin(provider: ProviderName, selected: ProviderTab): string {
  const origin = new URL(selected.canonicalTarget).origin;
  const allowed =
    provider === "Flow"
      ? ["https://flow.google.com", "https://labs.google"]
      : ["https://docs.google.com", "https://vids.google.com"];
  return allowed.includes(origin)
    ? `${origin}/*`
    : "unsupported_selected_origin";
}
