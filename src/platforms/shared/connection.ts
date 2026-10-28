import { BUILD_ID } from "../../shared/buildInfo";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
  CONNECTION_PROBE_MESSAGE,
  type ConnectionPort,
  type ConnectionProbeRequest,
  type ConnectionProbeResponse,
  type ConnectionResult,
  type ProviderName,
  type ProviderTab,
} from "./contracts";

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
    if (url.hostname === "labs.google") {
      const match = /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(
        url.pathname,
      );
      if (!match) return undefined;
      provider = "Flow";
      projectId = match[1]!;
      canonicalPath = `/fx/tools/flow/${projectId}`;
    } else if (url.hostname === "vids.google.com") {
      const match = /^\/video\/([A-Za-z0-9_-]+)\/edit\/?$/.exec(url.pathname);
      if (!match) return undefined;
      provider = "Vids";
      projectId = match[1]!;
      canonicalPath = `/video/${projectId}/edit`;
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
  if (selected.provider !== provider) {
    return failed("wrong-target", `Select a supported ${provider} project.`);
  }

  try {
    // Permission prompts must originate from the explicit Connect gesture.
    if (!(await port.requestAccess(provider))) {
      return failed(
        "permission-needed",
        `Access for ${provider} was not granted. Grant access in the browser prompt, then retry Connect.`,
      );
    }

    const before = await port.getTab(selected.id);
    if (!sameProject(before, selected)) {
      return failed(
        "wrong-target",
        `The selected ${provider} project changed or closed. Select the intended open project and retry.`,
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
    const firstResponse = await port.pingTopFrame(selected.id, request);
    if (
      firstResponse?.projectId &&
      !sameReportedProject(firstResponse, selected)
    ) {
      return failed(
        "wrong-target",
        "The selected page responded for a different project. No connection was made.",
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
      identity = await port.identifyDocument(selected.id);
    } else {
      // This also safely replaces a known stale extension-owned listener.
      identity = await port.injectConnector(selected.id);
    }
    if (!identity || identity.frameId !== 0 || !identity.documentId) {
      return failed(
        replacingStaleConnector ? "stale-build" : "failed",
        replacingStaleConnector
          ? "The stale connector could not be safely replaced. Connection is blocked; the provider page was left unchanged."
          : "The top-frame document identity could not be confirmed. The provider page was left unchanged.",
      );
    }

    const identityTab = providerTabFromUrl(
      selected.id,
      selected.title,
      identity.url,
    );
    if (!sameProject(identityTab, selected)) {
      return failed(
        "wrong-target",
        "The selected document changed before attachment. Select the intended project and retry.",
      );
    }

    const immediatelyBeforeHandshake = await port.getTab(selected.id);
    if (!sameProject(immediatelyBeforeHandshake, selected)) {
      return failed(
        "wrong-target",
        "The selected project changed before the connection handshake. No connection was made.",
      );
    }

    const response = await port.probeTopFrame(
      selected.id,
      identity.documentId,
      request,
    );
    if (!response) {
      return failed(
        "failed",
        "The selected document did not respond. It was not refreshed or navigated; retry when it is ready.",
      );
    }
    if (response.buildId !== BUILD_ID) {
      return failed(
        "stale-build",
        "The connector build is stale and could not be safely replaced. Reopen the extension dashboard and retry; the provider page was not refreshed.",
      );
    }
    if (response.protocolVersion !== CONNECTOR_PROTOCOL_VERSION) {
      return failed(
        "stale-build",
        "The connector protocol is incompatible and could not be safely replaced. The provider page was not refreshed.",
      );
    }
    if (!isCompatibleConnector(response, request) || !response.documentToken) {
      return failed(
        "wrong-target",
        response.error ??
          "The document, project, or connector capability did not match the selected target.",
      );
    }
    if (
      responseIsCurrent &&
      firstResponse?.documentToken !== response.documentToken
    ) {
      return failed(
        "wrong-target",
        "The provider document changed during attachment. No connected state was recorded.",
      );
    }

    const afterHandshake = await port.getTab(selected.id);
    if (!sameProject(afterHandshake, selected)) {
      return failed(
        "wrong-target",
        "The selected project changed during attachment. No connected state was recorded.",
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
    if (replacingStaleConnector) {
      return failed(
        "stale-build",
        "The stale connector could not be safely replaced. Connection is blocked; the provider page was left unchanged.",
      );
    }
    const text = error instanceof Error ? error.message : "";
    if (/permission|not granted|access denied/i.test(text)) {
      return failed(
        "permission-needed",
        `Browser access for ${provider} is required. Grant access to the selected site and retry.`,
      );
    }
    if (/build|protocol|stale/i.test(text)) {
      return failed(
        "stale-build",
        "The selected document has an incompatible connector build. It was not refreshed; retry after the extension package is updated.",
      );
    }
    return failed(
      "failed",
      `Could not attach to the selected ${provider} project. The tab was left open and unchanged. Retry without refreshing it.`,
    );
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
): ConnectionResult {
  return { ok: false, state, error };
}
