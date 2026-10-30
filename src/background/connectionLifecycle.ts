import { verifyPersistedTarget } from "../platforms/shared/connection";
import { createChromeConnectionPort } from "../platforms/shared/chromeConnectionPort";
import type {
  ConnectionPort,
  ProviderName,
  ProviderTab,
} from "../platforms/shared/contracts";
import type { ExtensionRepositories } from "../storage/repositories";
import type {
  SelectedTargetRecord,
  VerificationBindingComparison,
  VerificationBindingMatch,
} from "../storage/db";
import { BUILD_ID, PROTOCOL_VERSION } from "../shared/buildInfo";
import { providerTabFromUrl } from "../platforms/shared/connection";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
} from "../platforms/shared/contracts";

export type ConnectionRevalidationResult = {
  ok: boolean;
  state:
    | "verified"
    | "disconnected"
    | "temporarily-unreachable"
    | "stale-document"
    | "stale-build"
    | "wrong-target"
    | "permission-needed";
  reason: string;
  tab?: ProviderTab;
  documentId?: string;
  documentToken?: string;
  savedBindingComparison?: VerificationBindingComparison;
  permissionRequest?: { permissions?: string[]; origins?: string[] };
};

function bindingMatch(
  savedBindingPresent: boolean,
  matches: boolean,
): VerificationBindingMatch {
  return !savedBindingPresent ? "missing" : matches ? "match" : "mismatch";
}

export function createConnectionLifecycleService(
  repositories: ExtensionRepositories,
  portFactory: () => ConnectionPort | undefined = createChromeConnectionPort,
  onStateChanged: (
    provider: ProviderName,
    state: NonNullable<SelectedTargetRecord["connectionState"]>,
    reason: string,
  ) => void = () => undefined,
) {
  const inFlight = new Map<
    ProviderName,
    Promise<ConnectionRevalidationResult>
  >();

  const revalidate = (
    provider: ProviderName,
    enableReconnect = false,
  ): Promise<ConnectionRevalidationResult> => {
    if (enableReconnect) {
      return repositories
        .setReconnectIntent(provider, true)
        .then((updated) =>
          updated
            ? revalidate(provider)
            : { ok: false, state: "disconnected", reason: "target_missing" },
        );
    }
    const active = inFlight.get(provider);
    if (active)
      return active.then((result) =>
        result.reason === "selection_or_disconnect_changed_during_handshake"
          ? revalidate(provider)
          : result,
      );
    const task = (async (): Promise<ConnectionRevalidationResult> => {
      const target = await repositories.getSelectedTarget(provider);
      if (!target)
        return { ok: false, state: "disconnected", reason: "target_missing" };
      if (!target.reconnectEnabled)
        return {
          ok: false,
          state: "disconnected",
          reason: "manual_disconnect",
        };

      const expectedRevision = target.revision ?? 0;
      const previousBinding = target.verificationBinding;
      const selectedRoute = providerTabFromUrl(
        target.tabId,
        "",
        target.canonicalTarget,
      );
      const previousBindingMatchesSelectedTarget = Boolean(
        previousBinding &&
        previousBinding.provider === provider &&
        previousBinding.tabId === target.tabId &&
        previousBinding.canonicalTarget === target.canonicalTarget &&
        previousBinding.projectId === selectedRoute?.projectId,
      );
      await repositories.setTargetConnectionState(
        provider,
        "checking",
        expectedRevision,
      );
      onStateChanged(provider, "checking", "bounded_read_only_handshake");
      await repositories.recordConnectionLifecycleDiagnostic(
        provider,
        {
          kind: "revalidation_started",
          reason: "bounded_read_only_handshake",
          at: Date.now(),
        },
        target,
      );
      const port = portFactory();
      if (!port) {
        await repositories.setTargetConnectionState(
          provider,
          "temporarily-unreachable",
          expectedRevision,
        );
        await repositories.recordConnectionLifecycleDiagnostic(
          provider,
          {
            kind: "transport_unavailable",
            reason: "connection_api_unavailable",
            at: Date.now(),
          },
          target,
        );
        onStateChanged(
          provider,
          "temporarily-unreachable",
          "connection_api_unavailable",
        );
        return {
          ok: false,
          state: "temporarily-unreachable",
          reason: "connection_api_unavailable",
        };
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        verifyPersistedTarget(
          provider,
          { tabId: target.tabId, canonicalTarget: target.canonicalTarget },
          port,
          {
            // A saved document ID is a guard only when that old verification
            // belongs to the currently selected target. Obsolete verification
            // metadata must not veto a fresh explicit Connect handshake.
            expectedDocumentId: previousBindingMatchesSelectedTarget
              ? previousBinding?.documentId
              : undefined,
            decideStaleConnectorReplacement: async () => {
              if (provider !== "Flow")
                return {
                  allowed: true,
                  reasonCode: "stale_connector_active_observation" as const,
                };
              try {
                const attempts = await repositories.getAllFlowImageAttempts();
                const activeObservation = attempts.some(
                  (attempt) =>
                    attempt.provider === "Flow" &&
                    attempt.tabId === target.tabId &&
                    attempt.projectId === selectedRoute?.projectId &&
                    (attempt.observationSession?.status === "arming" ||
                      attempt.observationSession?.status === "active"),
                );
                return {
                  allowed: !activeObservation,
                  reasonCode: "stale_connector_active_observation" as const,
                };
              } catch {
                return {
                  allowed: false,
                  reasonCode: "stale_connector_state_unavailable" as const,
                };
              }
            },
          },
        ),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 8_000);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (!result) {
        await repositories.setTargetConnectionState(
          provider,
          "temporarily-unreachable",
          expectedRevision,
          true,
        );
        await repositories.recordConnectionLifecycleDiagnostic(
          provider,
          {
            kind: "transport_unavailable",
            reason: "revalidation_deadline_exceeded",
            at: Date.now(),
          },
          target,
        );
        onStateChanged(
          provider,
          "temporarily-unreachable",
          "revalidation_deadline_exceeded",
        );
        return {
          ok: false,
          state: "temporarily-unreachable",
          reason: "revalidation_deadline_exceeded",
        };
      }
      if (!result.ok) {
        const documentChanged =
          result.state === "wrong-target" ||
          result.stage === "document_validation";
        const connectionState =
          result.state === "stale-build"
            ? "stale-build"
            : documentChanged
              ? "stale-document"
              : "temporarily-unreachable";
        await repositories.setTargetConnectionState(
          provider,
          connectionState,
          expectedRevision,
          documentChanged || result.state === "stale-build",
        );
        await repositories.recordConnectionLifecycleDiagnostic(
          provider,
          {
            kind: documentChanged ? "document_changed" : "revalidation_refused",
            reason: result.reasonCode ?? result.stage,
            at: Date.now(),
          },
          target,
        );
        onStateChanged(
          provider,
          connectionState,
          result.reasonCode ?? result.stage,
        );
        return {
          ok: false,
          state:
            result.state === "stale-build"
              ? "stale-build"
              : result.state === "permission-needed"
                ? "permission-needed"
                : documentChanged
                  ? "stale-document"
                  : "temporarily-unreachable",
          reason: result.reasonCode ?? result.stage,
          permissionRequest: result.permissionRequest,
        };
      }
      const savedBindingComparison: VerificationBindingComparison = {
        savedBindingPresent: previousBinding !== undefined,
        selectedTabId: bindingMatch(
          previousBinding !== undefined,
          previousBinding?.tabId === result.tab.id,
        ),
        selectedProjectId: bindingMatch(
          previousBinding !== undefined,
          previousBinding?.projectId === result.tab.projectId,
        ),
        selectedCanonicalTarget: bindingMatch(
          previousBinding !== undefined,
          previousBinding?.canonicalTarget === result.tab.canonicalTarget,
        ),
        browserDocumentId: bindingMatch(
          previousBinding !== undefined,
          previousBinding?.documentId === result.documentId,
        ),
        connectorDocumentToken: bindingMatch(
          previousBinding !== undefined,
          previousBinding?.documentToken === result.documentToken,
        ),
        savedExtensionBuild: bindingMatch(
          previousBinding !== undefined,
          previousBinding?.extensionBuildId === BUILD_ID,
        ),
        savedConnectorBuild: bindingMatch(
          previousBinding !== undefined,
          previousBinding?.connectorBuildId === BUILD_ID,
        ),
        savedExtensionProtocol: bindingMatch(
          previousBinding !== undefined,
          previousBinding?.extensionProtocolVersion === PROTOCOL_VERSION,
        ),
        savedConnectorProtocol: bindingMatch(
          previousBinding !== undefined,
          previousBinding?.connectorProtocolVersion ===
            CONNECTOR_PROTOCOL_VERSION,
        ),
        liveConnectorBuild: "current",
        liveConnectorProtocol: "current",
      };
      const savedBindingMismatch = Object.entries(savedBindingComparison).some(
        ([field, match]) =>
          field !== "savedBindingPresent" && match === "mismatch",
      );
      const binding = {
        provider,
        tabId: result.tab.id,
        canonicalTarget: result.tab.canonicalTarget,
        projectId: result.tab.projectId,
        frameId: 0 as const,
        documentId: result.documentId,
        documentToken: result.documentToken,
        extensionBuildId: BUILD_ID,
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: BUILD_ID,
        connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
        capability: CONNECTION_CAPABILITY,
        verifiedAt: Date.now(),
      };
      const recorded = await repositories.recordTargetVerification(
        binding,
        expectedRevision,
      );
      if (!recorded) {
        await repositories.recordConnectionLifecycleDiagnostic(
          provider,
          {
            kind: "revalidation_refused",
            reason: "selection_or_disconnect_changed_during_handshake",
            at: Date.now(),
          },
          target,
        );
        onStateChanged(
          provider,
          "disconnected",
          "selection_or_disconnect_changed_during_handshake",
        );
        return {
          ok: false,
          state: "disconnected",
          reason: "selection_or_disconnect_changed_during_handshake",
        };
      }
      await repositories.recordConnectionLifecycleDiagnostic(
        provider,
        {
          kind: "revalidation_verified",
          reason: savedBindingMismatch
            ? "saved_verification_binding_refreshed"
            : "same_selected_document_and_build",
          ...(previousBinding
            ? { bindingComparison: savedBindingComparison }
            : {}),
          at: Date.now(),
        },
        target,
      );
      onStateChanged(
        provider,
        "verified",
        savedBindingMismatch
          ? "saved_verification_binding_refreshed"
          : "same_selected_document_and_build",
      );
      return {
        ok: true,
        state: "verified",
        reason: "verified_same_selected_target",
        savedBindingComparison,
        tab: result.tab,
        documentId: result.documentId,
        documentToken: result.documentToken,
      };
    })().finally(() => {
      if (inFlight.get(provider) === task) inFlight.delete(provider);
    });
    inFlight.set(provider, task);
    return task;
  };

  return { revalidate };
}

export function createReadinessAfterConnectionRevalidation<TInput>(
  revalidate: (provider: ProviderName) => Promise<ConnectionRevalidationResult>,
  readinessCheck: (input: TInput) => Promise<unknown>,
): (input: TInput) => Promise<unknown> {
  return async (input) => {
    const connection = await revalidate("Flow");
    if (!connection.ok) {
      return {
        status: "blocked",
        reason: `connection_${connection.state.replaceAll("-", "_")}`,
        message:
          connection.state === "stale-document"
            ? "The selected Flow document or project changed. Reconnect to that same project before checking readiness."
            : connection.state === "stale-build"
              ? "The selected Flow connector build is stale. Reconnect with the current package before checking readiness."
              : connection.state === "disconnected"
                ? "Flow is manually disconnected. Choose Connect for the selected project before checking readiness."
                : "The selected Flow document could not be revalidated. Check provider access and retry without refreshing the tab.",
        gates: { connection: connection.reason },
        attemptsCreated: 0,
        confirmationConsumed: false,
        productionReceiptCreated: false,
      };
    }
    return readinessCheck(input);
  };
}
