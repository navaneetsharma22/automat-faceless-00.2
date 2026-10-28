import { BUILD_ID } from "../../shared/buildInfo";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
  CONNECTION_PROBE_MESSAGE,
  type ConnectionFailureStage,
  type ConnectionPort,
  type ConnectionProbeRequest,
  type ConnectionProbeResponse,
  type ConnectionResult,
  type ProviderName,
  type ProviderTab,
} from "./contracts";
import { ConnectionApiUnavailableError } from "./chromeApiDiagnostics";

const attachmentTasks = new Map<string, Promise<ConnectionResult>>();

export function providerTabFromUrl(
  id: number,
  title: string,
  rawUrl: string | undefined,
): ProviderTab | undefined {
  if (!rawUrl || id < 0) return undefined;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password) {
      return undefined;
    }

    let provider: ProviderName;
    let projectId: string;
    let canonicalPath: string;
    if (url.hostname === "flow.google.com") {
      const match = /^\/project\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
      if (!match) return undefined;
      provider = "Flow";
      projectId = match[1]!;
      canonicalPath = `/project/${projectId}`;
    } else if (url.hostname === "labs.google") {
      const match = /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(
        url.pathname,
      );
      if (!match) return undefined;
      provider = "Flow";
      projectId = match[1]!;
      canonicalPath = `/fx/tools/flow/${projectId}`;
    } else if (
      url.hostname === "docs.google.com" ||
      url.hostname === "vids.google.com"
    ) {
      const match =
        url.hostname === "docs.google.com"
          ? /^\/videos\/d\/([A-Za-z0-9_-]+)\/edit\/?$/.exec(url.pathname)
          : /^\/video\/([A-Za-z0-9_-]+)\/edit\/?$/.exec(url.pathname);
      if (!match) return undefined;
      provider = "Vids";
      projectId = match[1]!;
      canonicalPath =
        url.hostname === "docs.google.com"
          ? `/videos/d/${projectId}/edit`
          : `/video/${projectId}/edit`;
    } else {
      return undefined;
    }

    return {
      id,
      title: title.trim() || `${provider} project ${projectId}`,
      url: rawUrl,
      provider,
      projectId,
      canonicalTarget: `${url.origin}${canonicalPath}`,
    };
  } catch {
    return undefined;
  }
}

export function attachToSelectedTab(
  provider: ProviderName,
  selected: ProviderTab,
  port: ConnectionPort,
): Promise<ConnectionResult> {
  const key = `${provider}:${selected.id}`;
  const active = attachmentTasks.get(key);
  if (active) return active;

  const task = attach(provider, selected, port).finally(() => {
    if (attachmentTasks.get(key) === task) attachmentTasks.delete(key);
  });
  attachmentTasks.set(key, task);
  return task;
}

async function attach(
  provider: ProviderName,
  selected: ProviderTab,
  port: ConnectionPort,
): Promise<ConnectionResult> {
  let replacingStaleConnector = false;
  let stage: ConnectionFailureStage = "permission_check";
  if (selected.provider !== provider) {
    return failed(
      "wrong-target",
      `Select a supported ${provider} project.`,
      "target_validation",
    );
  }

  try {
    const permissionRequest = await port.getMissingAccess(provider, selected);
    if (
      (permissionRequest.permissions?.length ?? 0) > 0 ||
      (permissionRequest.origins?.length ?? 0) > 0
    ) {
      return failed(
        "permission-needed",
        `Chrome access for ${provider} is missing. Use the provider access button below, then retry Connect.`,
        "permission_check",
        permissionRequest,
      );
    }

    stage = "target_validation";
    const before = await port.getTab(selected.id);
    if (!sameProject(before, selected)) {
      return failed(
        "wrong-target",
        `The selected ${provider} project changed or closed. Select the intended open project and retry.`,
        "target_validation",
      );
    }

    const request: ConnectionProbeRequest = {
      type: CONNECTION_PROBE_MESSAGE,
      provider,
      canonicalTarget: selected.canonicalTarget,
      projectId: selected.projectId,
      protocolVersion: CONNECTOR_PROTOCOL_VERSION,
      buildId: BUILD_ID,
      attemptId: port.makeAttemptId(),
    };

    // Ping before injection so a compatible connector can be reused.
    stage = "connector_ping";
    const firstResponse = await port.pingTopFrame(selected.id, request);
    if (
      firstResponse?.projectId &&
      !sameReportedProject(firstResponse, selected)
    ) {
      return failed(
        "wrong-target",
        "The selected page responded for a different project. No connection was made.",
        "connector_ping",
      );
    }

    const responseIsCurrent = isCompatibleConnector(firstResponse, request);
    replacingStaleConnector = Boolean(
      firstResponse &&
      (firstResponse.buildId !== BUILD_ID ||
        firstResponse.protocolVersion !== CONNECTOR_PROTOCOL_VERSION),
    );
    let identity;
    if (responseIsCurrent) {
      stage = "document_validation";
      identity = await port.identifyDocument(selected.id, selected);
    } else {
      // This also safely replaces a known stale extension-owned listener.
      stage = "connector_injection";
      identity = await port.injectConnector(selected.id, selected);
    }
    if (!identity || identity.frameId !== 0 || !identity.documentId) {
      return failed(
        replacingStaleConnector ? "stale-build" : "failed",
        replacingStaleConnector
          ? "The stale connector could not be safely replaced. Connection is blocked; the provider page was left unchanged."
          : "The top-frame document identity could not be confirmed. The provider page was left unchanged.",
        stage,
      );
    }

    stage = "document_validation";
    const identityTab = providerTabFromUrl(
      selected.id,
      selected.title,
      identity.url,
    );
    if (!sameProject(identityTab, selected)) {
      return failed(
        "wrong-target",
        "The selected document changed before attachment. Select the intended project and retry.",
        "document_validation",
      );
    }

    const immediatelyBeforeHandshake = await port.getTab(selected.id);
    if (!sameProject(immediatelyBeforeHandshake, selected)) {
      return failed(
        "wrong-target",
        "The selected project changed before the connection handshake. No connection was made.",
        "document_validation",
      );
    }

    stage = "handshake";
    const response = await port.probeTopFrame(
      selected.id,
      identity.documentId,
      request,
    );
    if (!response) {
      return failed(
        "failed",
        "The selected top-frame document returned no connector response. Check selected-site access and extension error details, then retry without refreshing or navigating the provider page.",
        "handshake",
      );
    }
    if (response.buildId !== BUILD_ID) {
      return failed(
        "stale-build",
        "The connector build is stale and could not be safely replaced. Reopen the extension dashboard and retry; the provider page was not refreshed.",
        "handshake_validation",
      );
    }
    if (response.protocolVersion !== CONNECTOR_PROTOCOL_VERSION) {
      return failed(
        "stale-build",
        "The connector protocol is incompatible and could not be safely replaced. The provider page was not refreshed.",
        "handshake_validation",
      );
    }
    if (!isCompatibleConnector(response, request) || !response.documentToken) {
      return failed(
        "wrong-target",
        "The response did not match the selected project, document, request, build, or read-only capability. No connection was recorded.",
        "handshake_validation",
      );
    }
    if (
      responseIsCurrent &&
      firstResponse?.documentToken !== response.documentToken
    ) {
      return failed(
        "wrong-target",
        "The provider document changed during attachment. No connected state was recorded.",
        "handshake_validation",
      );
    }

    stage = "document_validation";
    const afterHandshake = await port.getTab(selected.id);
    if (!sameProject(afterHandshake, selected)) {
      return failed(
        "wrong-target",
        "The selected project changed during attachment. No connected state was recorded.",
        "document_validation",
      );
    }

    return {
      ok: true,
      state: "connected",
      tab: selected,
      documentId: identity.documentId,
      documentToken: response.documentToken,
      capabilities: [CONNECTION_CAPABILITY],
    };
  } catch (error) {
    if (error instanceof ConnectionApiUnavailableError) {
      return failed("failed", error.diagnostic, error.stage);
    }
    if (
      error instanceof Error &&
      /extension context invalidated/i.test(error.message)
    ) {
      return failed(
        "failed",
        `extension_context_invalidated; stage=${stage}; runtime.id=${typeof chrome !== "undefined" && chrome.runtime?.id ? "present" : "absent"}. Reopen the extension dashboard and retry; the provider page was not changed.`,
        "extension_context",
      );
    }
    if (replacingStaleConnector) {
      return failed(
        "stale-build",
        "The stale connector could not be safely replaced. Connection is blocked; the provider page was left unchanged.",
        "connector_injection",
      );
    }
    return failed("failed", errorMessageForStage(provider, stage), stage);
  }
}

function errorMessageForStage(
  provider: ProviderName,
  stage: ConnectionFailureStage,
): string {
  switch (stage) {
    case "permission_check":
      return `Could not inspect Chrome access for ${provider}. No connector was injected. Retry Connect or check this extension's permission status.`;
    case "permission_request":
      return `Chrome rejected the ${provider} access request before returning a grant decision. Check the extension's site access, then retry the permission step.`;
    case "target_validation":
      return `Could not validate the selected ${provider} tab. Confirm it is still open on the same project and retry.`;
    case "connector_ping":
      return `Could not check the selected ${provider} document for a compatible connector. No provider content was changed.`;
    case "connector_injection":
      return `Could not inject the packaged read-only connector into the selected ${provider} top frame. Check the selected site's host access and the extension package; the page was not refreshed or navigated.`;
    case "document_validation":
      return `Could not confirm the selected ${provider} project/document identity. No connection was recorded and the page was left unchanged.`;
    case "handshake":
      return `The selected ${provider} document did not complete the read-only connector handshake. Check extension errors and selected-site access, then retry without refreshing the provider page.`;
    case "handshake_validation":
      return `The selected ${provider} document returned an invalid or mismatched connector response. No connection was recorded.`;
    case "extension_context":
      return `The extension execution context was invalidated during the ${provider} connection attempt. Reopen the packaged dashboard and retry; the provider page was left unchanged.`;
  }
}

function sameProject(
  current: ProviderTab | undefined,
  expected: ProviderTab,
): current is ProviderTab {
  return Boolean(
    current &&
    current.id === expected.id &&
    current.provider === expected.provider &&
    current.projectId === expected.projectId &&
    current.canonicalTarget === expected.canonicalTarget,
  );
}

function sameReportedProject(
  response: ConnectionProbeResponse,
  expected: ProviderTab,
): boolean {
  return (
    response.provider === expected.provider &&
    response.projectId === expected.projectId &&
    response.canonicalTarget === expected.canonicalTarget
  );
}

function isCompatibleConnector(
  response: ConnectionProbeResponse | undefined,
  request: ConnectionProbeRequest,
): response is ConnectionProbeResponse & { documentToken: string } {
  return Boolean(
    response?.ok &&
    response.provider === request.provider &&
    response.projectId === request.projectId &&
    response.canonicalTarget === request.canonicalTarget &&
    response.protocolVersion === request.protocolVersion &&
    response.buildId === request.buildId &&
    response.attemptId === request.attemptId &&
    response.documentToken &&
    response.capabilities?.includes(CONNECTION_CAPABILITY),
  );
}

function failed(
  state: Extract<ConnectionResult, { ok: false }>["state"],
  error: string,
  stage: ConnectionFailureStage = "handshake_validation",
  permissionRequest?: Extract<
    ConnectionResult,
    { ok: false }
  >["permissionRequest"],
): ConnectionResult {
  return {
    ok: false,
    state,
    error,
    stage,
    ...(permissionRequest ? { permissionRequest } : {}),
  };
}
