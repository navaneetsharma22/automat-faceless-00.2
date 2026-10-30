import { verifyPersistedTarget } from "../platforms/shared/connection";
import { createChromeConnectionPort } from "../platforms/shared/chromeConnectionPort";
import type {
  ConnectionPort,
  ProviderName,
  ProviderTab,
} from "../platforms/shared/contracts";
import type { ExtensionRepositories } from "../storage/repositories";
import type { SelectedTargetRecord } from "../storage/db";
import { BUILD_ID, PROTOCOL_VERSION } from "../shared/buildInfo";
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
  permissionRequest?: { permissions?: string[]; origins?: string[] };
};

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
      if (
        previousBinding &&
        (previousBinding.extensionBuildId !== BUILD_ID ||
          previousBinding.connectorBuildId !== BUILD_ID ||
          previousBinding.extensionProtocolVersion !== PROTOCOL_VERSION ||
          previousBinding.connectorProtocolVersion !==
            CONNECTOR_PROTOCOL_VERSION)
      ) {
        await repositories.setTargetConnectionState(
          provider,
          "stale-build",
          expectedRevision,
          true,
        );
        await repositories.recordConnectionLifecycleDiagnostic(
          provider,
          {
            kind: "revalidation_refused",
            reason: "saved_binding_build_mismatch",
            at: Date.now(),
          },
          target,
        );
        onStateChanged(provider, "stale-build", "saved_binding_build_mismatch");
        return {
          ok: false,
          state: "stale-build",
          reason: "saved_binding_build_mismatch",
        };
      }
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
            reason: result.stage,
            at: Date.now(),
          },
          target,
        );
        onStateChanged(provider, connectionState, result.stage);
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
          reason: result.stage,
          permissionRequest: result.permissionRequest,
        };
      }
      if (
        previousBinding &&
        (previousBinding.tabId !== result.tab.id ||
          previousBinding.canonicalTarget !== result.tab.canonicalTarget ||
          previousBinding.projectId !== result.tab.projectId ||
          previousBinding.documentId !== result.documentId)
      ) {
        await repositories.setTargetConnectionState(
          provider,
          "stale-document",
          expectedRevision,
          true,
        );
        await repositories.recordConnectionLifecycleDiagnostic(
          provider,
          {
            kind: "document_changed",
            reason:
              previousBinding.documentId !== result.documentId
                ? "browser_document_id_mismatch"
                : "saved_target_binding_mismatch",
            at: Date.now(),
          },
          target,
        );
        onStateChanged(
          provider,
          "stale-document",
          "saved_target_binding_mismatch",
        );
        return {
          ok: false,
          state: "stale-document",
          reason:
            previousBinding.documentId !== result.documentId
              ? "browser_document_id_mismatch"
              : "saved_target_binding_mismatch",
        };
      }
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
          reason: "same_selected_document_and_build",
          at: Date.now(),
        },
        target,
      );
      onStateChanged(provider, "verified", "same_selected_document_and_build");
      return {
        ok: true,
        state: "verified",
        reason: "verified_same_selected_target",
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
