import { BUILD_ID } from "../../shared/buildInfo";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
  CONNECTION_PROBE_MESSAGE,
  type ConnectionFailureStage,
  type ConnectionHandshakeDiagnostics,
  type ConnectionPort,
  type ConnectionProbeRequest,
  type ConnectionProbeResponse,
  type ConnectionResult,
  type ProviderName,
  type ProviderTab,
} from "./contracts";
import { ConnectionApiUnavailableError } from "./chromeApiDiagnostics";
import { parseProviderRoute } from "./providerRoute";

const attachmentTasks = new Map<string, Promise<ConnectionResult>>();

export function providerTabFromUrl(
  id: number,
  title: string,
  rawUrl: string | undefined,
): ProviderTab | undefined {
  if (!rawUrl || id < 0) return undefined;

  const route = parseProviderRoute(rawUrl);
  if (!route) return undefined;
  return {
    id,
    title: title.trim() || `${route.provider} project ${route.projectId}`,
    url: rawUrl,
    provider: route.provider,
    projectId: route.projectId,
    canonicalTarget: route.canonicalTarget,
  };
}

export function isSameProviderTargetUrl(
  selected: Pick<ProviderTab, "id" | "title" | "provider" | "canonicalTarget">,
  rawUrl: string | undefined,
): boolean {
  const current = providerTabFromUrl(selected.id, selected.title, rawUrl);
  return Boolean(
    current &&
    current.provider === selected.provider &&
    current.canonicalTarget === selected.canonicalTarget,
  );
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

export async function verifyPersistedTarget(
  provider: ProviderName,
  target: { tabId: number; canonicalTarget: string },
  port: ConnectionPort,
): Promise<ConnectionResult> {
  let selected: ProviderTab | undefined;
  try {
    selected = await port.getTab(target.tabId);
  } catch {
    return failed(
      "failed",
      "Chrome could not read the previously selected tab. The target was not changed.",
      "target_validation",
    );
  }
  if (
    !selected ||
    selected.provider !== provider ||
    selected.id !== target.tabId ||
    selected.canonicalTarget !== target.canonicalTarget
  ) {
    return failed(
      "wrong-target",
      "The previously selected tab is closed or no longer matches its saved project. Select it again to reconnect.",
      "target_validation",
    );
  }
  return attachToSelectedTab(provider, selected, port);
}

async function attach(
  provider: ProviderName,
  selected: ProviderTab,
  port: ConnectionPort,
): Promise<ConnectionResult> {
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
    const firstResponseIsStale = Boolean(
      firstResponse &&
      (firstResponse.buildId !== BUILD_ID ||
        firstResponse.protocolVersion !== CONNECTOR_PROTOCOL_VERSION),
    );
    if (firstResponseIsStale) {
      return failed(
        "stale-build",
        "The selected document is responding through a connector from another build or protocol. Revalidation is blocked; the connector was left unchanged and the provider page was not navigated.",
        "connector_ping",
      );
    }
    if (
      firstResponse?.projectId &&
      !sameReportedProject(firstResponse, selected) &&
      !firstResponseIsStale
    ) {
      return failed(
        "wrong-target",
        "The selected page responded for a different project. No connection was made.",
        "connector_ping",
      );
    }

    const responseIsCurrent = isCompatibleConnector(firstResponse, request);
    let identity;
    if (responseIsCurrent) {
      stage = "document_validation";
      identity = await port.identifyDocument(selected.id, selected);
    } else {
      // Injection is limited to a missing listener; stale identities block.
      stage = "connector_injection";
      identity = await port.injectConnector(selected.id, selected);
    }
    if (!identity || identity.frameId !== 0 || !identity.documentId) {
      return failed(
        "failed",
        "The top-frame document identity could not be confirmed. The provider page was left unchanged.",
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
    const handshakeDiagnostics = inspectHandshakeFields(
      selected,
      identity,
      request,
      response,
      responseIsCurrent ? firstResponse?.documentToken : undefined,
    );
    if (response.buildId !== BUILD_ID) {
      return failed(
        "stale-build",
        "The connector build is stale and could not be safely replaced. Reopen the extension dashboard and retry; the provider page was not refreshed.",
        "handshake_validation",
        undefined,
        handshakeDiagnostics,
      );
    }
    if (response.protocolVersion !== CONNECTOR_PROTOCOL_VERSION) {
      return failed(
        "stale-build",
        "The connector protocol is incompatible and could not be safely replaced. The provider page was not refreshed.",
        "handshake_validation",
        undefined,
        handshakeDiagnostics,
      );
    }
    if (!isCompatibleConnector(response, request) || !response.documentToken) {
      return failed(
        "wrong-target",
        "The response did not match the selected project, document, request, build, or read-only capability. No connection was recorded.",
        "handshake_validation",
        undefined,
        handshakeDiagnostics,
      );
    }
    if (handshakeDiagnostics.documentTokenContinuity === "mismatch") {
      return failed(
        "wrong-target",
        "The provider document changed during attachment. No connected state was recorded.",
        "handshake_validation",
        undefined,
        handshakeDiagnostics,
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
    hasReadOnlyCapability(response.capabilities),
  );
}

function hasReadOnlyCapability(
  capabilities: readonly string[] | undefined,
): boolean {
  return (
    Array.isArray(capabilities) &&
    capabilities.some((capability) => capability === CONNECTION_CAPABILITY)
  );
}

export function inspectHandshakeFields(
  selected: ProviderTab,
  identity: { documentId: string; frameId: number; url: string },
  request: ConnectionProbeRequest,
  response: ConnectionProbeResponse,
  firstDocumentToken?: string,
): ConnectionHandshakeDiagnostics {
  const selectedRoute = parseProviderRoute(identity.url);
  const expectedRoute = parseProviderRoute(selected.canonicalTarget);
  const responseRoute = response.canonicalTarget
    ? parseProviderRoute(response.canonicalTarget)
    : undefined;
  const check = <T>(
    actual: T | undefined,
    expected: T | undefined,
  ): ConnectionHandshakeDiagnostics["selectedProvider"] =>
    actual === undefined
      ? "missing"
      : expected !== undefined && actual === expected
        ? "match"
        : "mismatch";
  const checkPresent = (
    present: boolean | undefined,
  ): ConnectionHandshakeDiagnostics["selectedProvider"] =>
    present === undefined ? "missing" : present ? "match" : "mismatch";

  return {
    selectedProvider: check(selectedRoute?.provider, selected.provider),
    selectedOrigin: check(selectedRoute?.origin, expectedRoute?.origin),
    selectedProjectId: check(selectedRoute?.projectId, selected.projectId),
    selectedCanonicalTarget: check(
      selectedRoute?.canonicalTarget,
      selected.canonicalTarget,
    ),
    browserDocumentId: identity.documentId ? "bound" : "unbound",
    topFrame: check(identity.frameId, 0),
    responseProvider: check(response.provider, request.provider),
    responseOrigin:
      response.canonicalTarget === undefined
        ? "missing"
        : responseRoute
          ? check(responseRoute.origin, expectedRoute?.origin)
          : "mismatch",
    responseProjectId: check(response.projectId, request.projectId),
    responseCanonicalTarget: check(
      response.canonicalTarget,
      request.canonicalTarget,
    ),
    attemptCorrelation: check(response.attemptId, request.attemptId),
    protocolVersion: check(response.protocolVersion, request.protocolVersion),
    buildIdentity: check(response.buildId, request.buildId),
    readOnlyCapability: checkPresent(
      response.capabilities === undefined
        ? undefined
        : hasReadOnlyCapability(response.capabilities),
    ),
    connectorAcceptance: response.ok ? "accepted" : "rejected",
    documentToken: response.documentToken ? "present" : "missing",
    documentTokenContinuity:
      firstDocumentToken === undefined
        ? "unverified"
        : response.documentToken === firstDocumentToken
          ? "match"
          : "mismatch",
  };
}

export function formatHandshakeDiagnostics(
  diagnostics: ConnectionHandshakeDiagnostics,
): string {
  const labels: Array<[string, string]> = [
    ["selected-provider", diagnostics.selectedProvider],
    ["selected-origin", diagnostics.selectedOrigin],
    ["selected-project/document", diagnostics.selectedProjectId],
    ["selected-target", diagnostics.selectedCanonicalTarget],
    ["browser-document", diagnostics.browserDocumentId],
    ["top-frame", diagnostics.topFrame],
    ["response-provider", diagnostics.responseProvider],
    ["response-origin", diagnostics.responseOrigin],
    ["response-project/document", diagnostics.responseProjectId],
    ["response-target", diagnostics.responseCanonicalTarget],
    ["attempt-correlation", diagnostics.attemptCorrelation],
    ["protocol", diagnostics.protocolVersion],
    ["build", diagnostics.buildIdentity],
    ["read-only-capability", diagnostics.readOnlyCapability],
    ["connector-acceptance", diagnostics.connectorAcceptance],
    ["document-token", diagnostics.documentToken],
    ["document-token-continuity", diagnostics.documentTokenContinuity],
  ];
  return ` Handshake checks: ${labels.map(([field, state]) => `${field}=${state}`).join(", ")}.`;
}

function failed(
  state: Extract<ConnectionResult, { ok: false }>["state"],
  error: string,
  stage: ConnectionFailureStage = "handshake_validation",
  permissionRequest?: Extract<
    ConnectionResult,
    { ok: false }
  >["permissionRequest"],
  handshakeDiagnostics?: ConnectionHandshakeDiagnostics,
): ConnectionResult {
  return {
    ok: false,
    state,
    error,
    stage,
    ...(permissionRequest ? { permissionRequest } : {}),
    ...(handshakeDiagnostics ? { handshakeDiagnostics } : {}),
  };
}
