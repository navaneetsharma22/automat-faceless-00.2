import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectionWorkerFailureDetail,
  withPendingCleanup,
} from "../connectionAttempt";
import { ConnectionError } from "./ConnectionError";
import { createChromeFoundationClient } from "../../shared/messageClient";
import { handleWorkerRestart } from "../../platforms/shared/connectionLifecycle";
import { attachToSelectedTab } from "../../platforms/shared/connection";
import {
  createChromeConnectionPort,
  connectionApiDiagnostic,
  hasTabListingAccess,
  listOpenProviderTabs,
  requestProviderAccess,
  requestTabListingAccess,
} from "../../platforms/shared/chromeConnectionPort";
import {
  getChromeExecutionContext,
  hasDiscoveryApis,
  hasWorkerMessagingApi,
} from "../../platforms/shared/chromeApiDiagnostics";
import type {
  ConnectionResult,
  ConnectionStateName,
  ProviderName,
  ProviderTab,
} from "../../platforms/shared/contracts";
import { useToast } from "./ToastHost";
import styles from "../Dashboard.module.css";

type TargetMetadata = { tabId: number; canonicalTarget: string };
type LiveConnection = {
  tab: ProviderTab;
  documentId: string;
  documentToken: string;
};
type ProviderState = {
  status: ConnectionStateName;
  message: string;
  detail?: string;
  permissionRequest?: Extract<
    ConnectionResult,
    { ok: false }
  >["permissionRequest"];
  live?: LiveConnection;
};

const providers = ["Flow", "Vids"] as const;
function connectionStatusLabel(status: ConnectionStateName): string {
  switch (status) {
    case "pending":
      return "Connecting";
    case "connected":
      return "Connected";
    case "permission-needed":
      return "Permission needed";
    case "wrong-target":
      return "Wrong target";
    case "stale-build":
      return "Outdated connector";
    case "failed":
      return "Not connected";
    case "disconnected":
      return "Not connected";
  }
}

const initialStates = (): Record<ProviderName, ProviderState> => ({
  Flow: { status: "disconnected", message: "Not connected" },
  Vids: { status: "disconnected", message: "Not connected" },
});

function extensionAvailable(): boolean {
  return hasDiscoveryApis();
}

export function ConnectionStatus() {
  const [tabs, setTabs] = useState<ProviderTab[]>([]);
  const [selected, setSelected] = useState<Record<ProviderName, string>>({
    Flow: "",
    Vids: "",
  });
  const [saved, setSaved] = useState<
    Partial<Record<ProviderName, TargetMetadata>>
  >({});
  const [selectionSaved, setSelectionSaved] = useState<
    Record<ProviderName, boolean>
  >({ Flow: false, Vids: false });
  const selectionRevision = useRef<Record<ProviderName, number>>({
    Flow: 0,
    Vids: 0,
  });
  const selectionSaveTasks = useRef<
    Partial<Record<ProviderName, Promise<void>>>
  >({});
  const connectionRevision = useRef<Record<ProviderName, number>>({
    Flow: 0,
    Vids: 0,
  });
  const [states, setStates] = useState(initialStates);
  const [listError, setListError] = useState("");
  const [needsTabListingAccess, setNeedsTabListingAccess] = useState(false);
  const [busy, setBusy] = useState<ProviderName | undefined>();
  const toast = useToast();

  const invalidate = useCallback(
    (
      provider: ProviderName,
      message: string,
      status: "disconnected" | "wrong-target" | "stale-build" = "disconnected",
    ) => {
      connectionRevision.current[provider] += 1;
      const live = states[provider].live;
      if (live) {
        void createChromeConnectionPort()?.releaseConnector(
          live.tab.id,
          live.documentId,
        );
      }
      setStates((current) => {
        return {
          ...current,
          [provider]: {
            status,
            message: connectionStatusLabel(status),
            detail: message,
          },
        };
      });
    },
    [states],
  );

  useEffect(() => {
    if (!hasWorkerMessagingApi()) return;
    const client = createChromeFoundationClient();
    let active = true;
    void Promise.all(
      providers.map(async (provider) => {
        try {
          const result = (await client.request("connections.getSelection", {
            provider,
          })) as TargetMetadata | null;
          if (active && result) {
            setSaved((current) => ({ ...current, [provider]: result }));
            // Persisted selection is metadata, never proof of a live connection.
            setStates((current) => ({
              ...current,
              [provider]: {
                status: "disconnected",
                message: "Not connected",
                detail:
                  "Saved target · reconnect to verify its current identity.",
              },
            }));
          }
        } catch {
          // Local preview or a stopped worker remains a recoverable disconnected state.
        }
      }),
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.tabs) return;
    const onRemoved = (tabId: number) => {
      for (const provider of providers) {
        if (states[provider].live?.tab.id === tabId) {
          invalidate(provider, "Disconnected · selected tab closed");
        }
      }
    };
    const onUpdated = (tabId: number, changeInfo: { url?: string }) => {
      if (!changeInfo.url) return;
      for (const provider of providers) {
        const live = states[provider].live;
        if (live?.tab.id === tabId && changeInfo.url !== live.tab.url) {
          invalidate(
            provider,
            "Wrong target · the selected project or document changed. Reconnect to verify it.",
            "wrong-target",
          );
        }
      }
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onUpdated.addListener(onUpdated);
    const onRuntimeMessage = (message: unknown) =>
      handleWorkerRestart(message, (provider, status, detail) =>
        invalidate(provider, detail, status),
      );
    chrome.runtime?.onMessage.addListener(onRuntimeMessage);
    return () => {
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime?.onMessage.removeListener(onRuntimeMessage);
    };
  }, [invalidate, states]);

  const applyTabListing = (
    listing: Awaited<ReturnType<typeof listOpenProviderTabs>>,
  ) => {
    const openTabs = listing.tabs;
    setTabs(openTabs);
    for (const provider of providers) {
      const existing = saved[provider];
      const match = openTabs.find(
        (tab) =>
          tab.id === existing?.tabId &&
          tab.canonicalTarget === existing?.canonicalTarget,
      );
      if (match) {
        setSelected((current) => ({
          ...current,
          [provider]: String(match.id),
        }));
        setSelectionSaved((current) => ({ ...current, [provider]: true }));
      } else {
        setSelected((current) => ({ ...current, [provider]: "" }));
        setSelectionSaved((current) => ({ ...current, [provider]: false }));
        if (existing) {
          setStates((current) => ({
            ...current,
            [provider]: {
              status: "wrong-target",
              message: "Wrong target",
              detail: "Saved project is no longer open. Select it again.",
            },
          }));
        }
      }
    }
    if (openTabs.length === 0 && listing.unsupportedProviderRoutes > 0) {
      setListError(
        "Flow or Vids tabs were found, but their editor/project route is unsupported. No project was inferred from the tab title.",
      );
    } else if (openTabs.length === 0 && listing.unavailableUrls > 0) {
      setListError(
        "Some tab URLs were unavailable, so they could not be checked for Flow or Vids projects. No project was inferred from tab titles.",
      );
    } else if (openTabs.length === 0) {
      setListError(
        "No matching Flow or Vids project tabs were found. Open the intended project and retry.",
      );
    } else if (listing.unsupportedProviderRoutes > 0) {
      setListError(
        "Some Flow or Vids tabs use unsupported editor/project routes and were not listed.",
      );
    } else if (listing.unavailableUrls > 0) {
      setListError(
        "Some tab URLs were unavailable and could not be assessed; supported projects are listed below.",
      );
    }
  };

  const queryOpenTabs = async () => {
    try {
      applyTabListing(await listOpenProviderTabs());
    } catch {
      setListError(
        "Tab query failed. Chrome could not return the open tab list; retry discovery or inspect the extension error details.",
      );
    }
  };

  const findOpenTabs = async () => {
    setListError("");
    setNeedsTabListingAccess(false);
    try {
      if (!extensionAvailable()) {
        setListError(
          `Tab discovery is unavailable in this context (${getChromeExecutionContext()}). Open the packaged dashboard to list projects.`,
        );
        return;
      }
      if (!(await hasTabListingAccess())) {
        setNeedsTabListingAccess(true);
        setListError(
          "Permission required · tab access is needed to read URLs and identify Flow/Vids project routes. No tabs were queried.",
        );
        return;
      }
    } catch {
      setListError(
        "Could not check tab access. No tabs were queried; retry the access check.",
      );
      return;
    }
    await queryOpenTabs();
  };

  const allowTabListingAccess = async () => {
    setListError("");
    try {
      // This is the first asynchronous API call in this click handler so the
      // optional-permission request retains Chrome's user-gesture context.
      const granted = await requestTabListingAccess();
      if (!granted) {
        setNeedsTabListingAccess(true);
        setListError(
          "Permission denied · tab access was not granted. Allow it to discover open project URLs, then retry.",
        );
        return;
      }
      setNeedsTabListingAccess(false);
      await queryOpenTabs();
    } catch {
      setNeedsTabListingAccess(true);
      setListError(
        "Permission request failed. No tabs were queried; retry the tab-access step.",
      );
    }
  };

  const chooseTarget = async (provider: ProviderName, tabId: string) => {
    connectionRevision.current[provider] += 1;
    const revision = ++selectionRevision.current[provider];
    const previousLive = states[provider].live;
    if (previousLive) {
      void createChromeConnectionPort()?.releaseConnector(
        previousLive.tab.id,
        previousLive.documentId,
      );
    }
    setSelected((current) => ({ ...current, [provider]: tabId }));
    setStates((current) => ({
      ...current,
      [provider]: {
        status: "disconnected",
        message: "Not connected",
        detail: tabId ? "Selected · not connected" : undefined,
        permissionRequest: undefined,
      },
    }));
    setSelectionSaved((current) => ({ ...current, [provider]: false }));
    if (!tabId) return;
    const tab = tabs.find((candidate) => candidate.id === Number(tabId));
    if (!tab || tab.provider !== provider) return;
    const metadata = { tabId: tab.id, canonicalTarget: tab.canonicalTarget };
    setSaved((current) => ({ ...current, [provider]: metadata }));
    const previousSave = selectionSaveTasks.current[provider];
    const saveTask = (previousSave ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (selectionRevision.current[provider] !== revision) return;
        await createChromeFoundationClient().request(
          "connections.recordSelection",
          {
            provider,
            tabId: tab.id,
            canonicalTarget: tab.canonicalTarget,
          },
        );
        if (selectionRevision.current[provider] === revision) {
          setSelectionSaved((current) => ({ ...current, [provider]: true }));
          setStates((current) => ({
            ...current,
            [provider]: {
              status: "disconnected",
              message: "Not connected",
              detail: "Selected · not connected",
            },
          }));
        }
      });
    selectionSaveTasks.current[provider] = saveTask;
    try {
      await saveTask;
    } catch (error) {
      if (selectionRevision.current[provider] === revision) {
        setSelected((current) => ({ ...current, [provider]: "" }));
        setSaved((current) => ({ ...current, [provider]: undefined }));
        setStates((current) => ({
          ...current,
          [provider]: {
            status: "failed",
            message: "Not connected",
            detail: connectionWorkerFailureDetail(error),
          },
        }));
      }
    }
  };

  const connect = async (provider: ProviderName) => {
    const tab = tabs.find(
      (candidate) => candidate.id === Number(selected[provider]),
    );
    if (!tab || tab.provider !== provider) {
      setStates((current) => ({
        ...current,
        [provider]: {
          status: "wrong-target",
          message: "Wrong target",
          detail: `Select an already-open ${provider} project first.`,
        },
      }));
      return;
    }
    const port = createChromeConnectionPort();
    if (!port) {
      setBusy(provider);
      setStates((current) => ({
        ...current,
        [provider]: {
          status: "pending",
          message: "Checking extension access",
          detail: "Checking dashboard context and connection APIsâ€¦",
        },
      }));
      await withPendingCleanup(
        async () => {
          const diagnostic = await connectionApiDiagnostic(
            "connection_setup",
            tab,
          );
          const contextInvalidated = diagnostic.startsWith(
            "extension_context_invalidated",
          );
          setStates((current) => ({
            ...current,
            [provider]: {
              status: "failed",
              message: "Not connected",
              detail: contextInvalidated
                ? `${diagnostic}. Reopen the extension dashboard and retry.`
                : `${diagnostic}. Open the packaged extension dashboard to connect.`,
            },
          }));
        },
        () => setBusy(undefined),
      );
      return;
    }

    const wasConnected = states[provider].status === "connected";
    const attemptRevision = ++connectionRevision.current[provider];
    const previousLive = states[provider].live;
    setBusy(provider);
    setStates((current) => ({
      ...current,
      [provider]: {
        status: "pending",
        message: "Connecting",
        detail: "Validating the selected project and read-only connector…",
      },
    }));

    try {
      await withPendingCleanup(
        async () => {
          if (previousLive) {
            await port.releaseConnector(
              previousLive.tab.id,
              previousLive.documentId,
            );
          }
          const result: ConnectionResult = await attachToSelectedTab(
            provider,
            tab,
            port,
          );
          if (connectionRevision.current[provider] !== attemptRevision) {
            if (result.ok) {
              await port.releaseConnector(result.tab.id, result.documentId);
            }
            return;
          }
          if (!result.ok) {
            setStates((current) => ({
              ...current,
              [provider]: {
                status: result.state,
                message: connectionStatusLabel(result.state),
                detail: `${result.stage}: ${result.error}`,
                permissionRequest: result.permissionRequest,
              },
            }));
            return;
          }
          setStates((current) => ({
            ...current,
            [provider]: {
              status: "connected",
              message: "Connected",
              live: {
                tab: result.tab,
                documentId: result.documentId,
                documentToken: result.documentToken,
              },
            },
          }));
          if (!wasConnected) {
            toast.add({
              kind: "success",
              message: `${provider} read-only connection confirmed. Generation remains unavailable.`,
              urgent: false,
              actionable: false,
            });
          }
        },
        () => setBusy(undefined),
      );
    } catch {
      if (connectionRevision.current[provider] === attemptRevision) {
        setStates((current) => ({
          ...current,
          [provider]: {
            status: "failed",
            message: "Not connected",
            detail: `connect_orchestration: The ${provider} connection could not finish. Check extension errors and retry without refreshing the provider page.`,
          },
        }));
      }
    }
  };

  const allowProviderAccess = (provider: ProviderName) => {
    const request = states[provider].permissionRequest;
    if (!request) return;

    setBusy(provider);
    setStates((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        status: "pending",
        message: "Requesting access",
        detail: "Waiting for Chrome's permission decision…",
      },
    }));

    // Invoke the optional permission request directly from this user click.
    let permissionResult: Promise<boolean>;
    try {
      permissionResult = requestProviderAccess(request);
    } catch {
      permissionResult = Promise.reject(new Error("request failed"));
    }
    void permissionResult
      .then((granted) => {
        setStates((current) => ({
          ...current,
          [provider]: granted
            ? {
                status: "disconnected",
                message: "Not connected",
                detail:
                  "Access granted. Click Connect to verify the selected project.",
              }
            : {
                ...current[provider],
                status: "permission-needed",
                message: "Permission needed",
                detail:
                  "permission_denied: Chrome did not grant the requested access. Grant it in the browser prompt, then retry this access step.",
              },
        }));
      })
      .catch(() => {
        setStates((current) => ({
          ...current,
          [provider]: {
            ...current[provider],
            status: "failed",
            message: "Not connected",
            detail:
              "permission_request: Chrome rejected the permission request before returning a decision. Check this extension's site access and retry the access step.",
          },
        }));
      })
      .finally(() => setBusy(undefined));
  };

  const disconnect = (provider: ProviderName) => {
    connectionRevision.current[provider] += 1;
    const live = states[provider].live;
    if (live) {
      void createChromeConnectionPort()?.releaseConnector(
        live.tab.id,
        live.documentId,
      );
    }
    setStates((current) => ({
      ...current,
      [provider]: { status: "disconnected", message: "Not connected" },
    }));
  };

  return (
    <section className={styles.connection} aria-labelledby="connection-title">
      <div className={styles.connectionHeading}>
        <span className={styles.statusDot} aria-hidden="true" />
        <h2 id="connection-title">Connections</h2>
      </div>
      <p className={styles.connectionHint}>
        Select a project explicitly. Connection checks are read-only; generation
        is unavailable.
      </p>
      <button
        className={`${styles.connectionListButton} motion-control`}
        type="button"
        disabled={!extensionAvailable() || busy !== undefined}
        onClick={() => void findOpenTabs()}
      >
        Find open projects
      </button>
      {needsTabListingAccess && extensionAvailable() ? (
        <button
          className={`${styles.connectionListButton} motion-control`}
          type="button"
          disabled={busy !== undefined}
          onClick={() => void allowTabListingAccess()}
        >
          Allow tab access for discovery
        </button>
      ) : null}
      {!extensionAvailable() ? (
        <p className={styles.connectionHint}>
          {getChromeExecutionContext() === "localhost_preview"
            ? "Local preview · Chrome tab and provider APIs are unavailable here."
            : `Extension APIs unavailable · context=${getChromeExecutionContext()}.`}
        </p>
      ) : null}
      {listError ? (
        <p className={styles.connectionError} role="alert">
          {listError}
        </p>
      ) : null}
      {providers.map((provider) => {
        const options = tabs.filter((tab) => tab.provider === provider);
        const state = states[provider];
        const selectedId = selected[provider];
        return (
          <div className={styles.providerConnection} key={provider}>
            <div className={styles.providerConnectionTitle}>
              <span>{provider}</span>
              <strong aria-live="polite">
                {connectionStatusLabel(state.status)}
              </strong>
            </div>
            <label
              className={styles.connectionLabel}
              htmlFor={`selected-${provider.toLowerCase()}-tab`}
            >
              Already-open {provider} project
            </label>
            <select
              className={styles.connectionSelect}
              id={`selected-${provider.toLowerCase()}-tab`}
              value={selectedId}
              disabled={busy !== undefined}
              onChange={(event) =>
                void chooseTarget(provider, event.currentTarget.value)
              }
            >
              <option value="">Select an open {provider} project</option>
              {options.map((tab) => (
                <option key={`${tab.id}:${tab.canonicalTarget}`} value={tab.id}>
                  {tab.title} · {tab.projectId} · tab {tab.id}
                </option>
              ))}
            </select>
            <div className={styles.connectionActions}>
              <button
                className={`${styles.connectionListButton} motion-control`}
                type="button"
                disabled={
                  busy !== undefined || !selectedId || !selectionSaved[provider]
                }
                onClick={() => void connect(provider)}
              >
                {busy === provider
                  ? "Connecting…"
                  : state.status === "connected"
                    ? "Reconnect"
                    : "Connect"}
              </button>
              {state.status === "connected" ? (
                <button
                  className={`${styles.connectionListButton} motion-control`}
                  type="button"
                  disabled={busy !== undefined}
                  onClick={() => disconnect(provider)}
                >
                  Disconnect
                </button>
              ) : null}
            </div>
            {state.permissionRequest ? (
              <button
                className={`${styles.connectionListButton} motion-control`}
                type="button"
                disabled={busy !== undefined}
                onClick={() => allowProviderAccess(provider)}
              >
                Allow requested {provider} access
              </button>
            ) : null}
            {state.status === "connected" ? (
              <p className={styles.connectionHint}>
                Connector reachable · read-only capability · no generation
                capability.
              </p>
            ) : null}
            {state.detail && state.status === "pending" ? (
              <p className={styles.connectionHint} role="status">
                {state.detail}
              </p>
            ) : null}
            {state.detail && state.status !== "pending" ? (
              <ConnectionError detail={state.detail} />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
