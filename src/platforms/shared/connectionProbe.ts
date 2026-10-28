const BUILD_ID = __AUTOMAT_BUILD_ID__;
const CONNECTION_CAPABILITY = "read-only-connection-v1" as const;
const CONNECTION_DISCONNECT_MESSAGE =
  "AUTOMAT_FACELESS_CONNECTION_DISCONNECT" as const;
const CONNECTION_PROBE_MESSAGE = "AUTOMAT_FACELESS_CONNECTION_PROBE" as const;
const CONNECTOR_PROTOCOL_VERSION = 1 as const;
type ProviderName = "Flow" | "Vids";
type ConnectionProbeRequest = {
  type: typeof CONNECTION_PROBE_MESSAGE;
  provider: ProviderName;
  canonicalTarget: string;
  projectId: string;
  protocolVersion: number;
  buildId: string;
  attemptId: string;
};
type ConnectionProbeResponse = {
  ok: boolean;
  provider?: ProviderName;
  canonicalTarget?: string;
  projectId?: string;
  protocolVersion?: number;
  buildId?: string;
  attemptId?: string;
  documentToken?: string;
  capabilities?: readonly string[];
  error?: string;
};

type InstalledConnector = {
  buildId: string;
  listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => boolean;
  documentToken: string;
};

type ConnectorScope = typeof globalThis & {
  __automatFacelessConnector?: InstalledConnector;
  __automatFacelessConnectionProbeInstalled?: boolean;
};

function projectFromUrl(
  rawUrl: string,
):
  | { provider: ProviderName; projectId: string; canonicalTarget: string }
  | undefined {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    if (url.hostname === "flow.google.com") {
      const match = /^\/project\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
      if (!match) return undefined;
      return {
        provider: "Flow",
        projectId: match[1]!,
        canonicalTarget: `${url.origin}/project/${match[1]}`,
      };
    }
    if (url.hostname === "labs.google") {
      const match = /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(
        url.pathname,
      );
      if (!match) return undefined;
      return {
        provider: "Flow",
        projectId: match[1]!,
        canonicalTarget: `${url.origin}/fx/tools/flow/${match[1]}`,
      };
    }
    if (url.hostname === "vids.google.com") {
      const match = /^\/video\/([A-Za-z0-9_-]+)\/edit\/?$/.exec(url.pathname);
      if (!match) return undefined;
      return {
        provider: "Vids",
        projectId: match[1]!,
        canonicalTarget: `${url.origin}/video/${match[1]}/edit`,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function makeDocumentToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const runtime = globalThis.chrome?.runtime;
const scope = globalThis as ConnectorScope;
const hasUnmanagedLegacyConnector =
  scope.__automatFacelessConnectionProbeInstalled === true &&
  !scope.__automatFacelessConnector;

if (
  runtime?.onMessage &&
  typeof document !== "undefined" &&
  window.top === window &&
  !hasUnmanagedLegacyConnector
) {
  const previous = scope.__automatFacelessConnector;
  if (previous) {
    // Only remove the exact extension-owned listener registered in this isolated world.
    runtime.onMessage.removeListener(previous.listener);
  }

  const installed: InstalledConnector = {
    buildId: BUILD_ID,
    documentToken: makeDocumentToken(),
    listener: () => false,
  };
  installed.listener = (rawMessage, sender, sendResponse) => {
    if (sender.id !== runtime.id) return false;
    if (
      rawMessage &&
      typeof rawMessage === "object" &&
      "type" in rawMessage &&
      rawMessage.type === CONNECTION_DISCONNECT_MESSAGE
    ) {
      runtime.onMessage.removeListener(installed.listener);
      if (scope.__automatFacelessConnector === installed) {
        delete scope.__automatFacelessConnector;
      }
      sendResponse({ ok: true });
      return false;
    }
    if (
      !rawMessage ||
      typeof rawMessage !== "object" ||
      !("type" in rawMessage) ||
      rawMessage.type !== CONNECTION_PROBE_MESSAGE
    ) {
      return false;
    }

    const request = rawMessage as ConnectionProbeRequest;
    const project = projectFromUrl(location.href);
    const expected =
      project?.provider === request.provider &&
      project.projectId === request.projectId &&
      project.canonicalTarget === request.canonicalTarget;
    const response: ConnectionProbeResponse = {
      ok:
        expected &&
        request.protocolVersion === CONNECTOR_PROTOCOL_VERSION &&
        request.buildId === installed.buildId,
      provider: project?.provider,
      projectId: project?.projectId,
      canonicalTarget: project?.canonicalTarget,
      protocolVersion: CONNECTOR_PROTOCOL_VERSION,
      buildId: installed.buildId,
      attemptId: request.attemptId,
      documentToken: installed.documentToken,
      capabilities: [CONNECTION_CAPABILITY],
      ...(!expected
        ? { error: "The current document does not match the selected project." }
        : request.protocolVersion !== CONNECTOR_PROTOCOL_VERSION
          ? { error: "The connector protocol version is stale." }
          : request.buildId !== installed.buildId
            ? { error: "The connector build is stale." }
            : {}),
    };
    sendResponse(response);
    return false;
  };

  // Re-injection replaces a stale instance and leaves one listener in this document.
  scope.__automatFacelessConnector = installed;
  runtime.onMessage.addListener(installed.listener);
}
