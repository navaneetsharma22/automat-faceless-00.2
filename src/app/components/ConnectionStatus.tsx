import { useCallback, useEffect, useRef, useState } from "react";
import { createChromeFoundationClient } from "../../shared/messageClient";
import { handleWorkerRestart } from "../../platforms/shared/connectionLifecycle";
import { attachToSelectedTab } from "../../platforms/shared/connection";
import {
  createChromeConnectionPort,
  hasTabListingAccess,
  listOpenProviderTabs,
  requestTabListingAccess,
} from "../../platforms/shared/chromeConnectionPort";
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
  live?: LiveConnection;
};

const providers = ["Flow", "Vids"] as const;
const initialStates = (): Record<ProviderName, ProviderState> => ({
  Flow: { status: "disconnected", message: "Not connected" },
  Vids: { status: "disconnected", message: "Not connected" },
});

function extensionAvailable(): boolean {
  if (typeof chrome === "undefined") return false;
  const apis = chrome as unknown as {
    runtime?: { sendMessage?: unknown };
    permissions?: { request?: unknown };
    tabs?: { query?: unknown };
  };
  return (
    typeof apis.runtime?.sendMessage === "function" &&
    typeof apis.permissions?.request === "function" &&
    typeof apis.tabs?.query === "function"
  );
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
          [provider]: { status, message },
        };
      });
    },
    [states],
  );

  useEffect(() => {
    if (!extensionAvailable()) return;
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
                message: "Saved target · reconnect to verify",
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
              message: "Saved project is no longer open. Select it again.",
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
          "Tab selection is unavailable in this local preview. Open the installed extension dashboard to connect.",
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
        message: tabId ? "Selected · not connected" : "Not connected",
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
              message: "Selected · not connected",
            },
          }));
        }
      });
    selectionSaveTasks.current[provider] = saveTask;
    try {
      await saveTask;
    } catch {
      if (selectionRevision.current[provider] === revision) {
        setSelected((current) => ({ ...current, [provider]: "" }));
        setSaved((current) => ({ ...current, [provider]: undefined }));
        setStates((current) => ({
          ...current,
          [provider]: {
            status: "failed",
            message:
              "The selected target could not be saved. Reopen the extension dashboard and select it again before connecting.",
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
          message: `Select an already-open ${provider} project first.`,
        },
      }));
      return;
    }
    const port = createChromeConnectionPort();
    if (!port) {
      setStates((current) => ({
        ...current,
        [provider]: {
          status: "disconnected",
          message:
            "Not connected · open this view from the installed extension.",
        },
      }));
      return;
    }

    const wasConnected = states[provider].status === "connected";
    const attemptRevision = ++connectionRevision.current[provider];
    const previousLive = states[provider].live;
    if (previousLive) {
      await port.releaseConnector(previousLive.tab.id, previousLive.documentId);
    }
    setBusy(provider);
    setStates((current) => ({
      ...current,
      [provider]: {
        status: "pending",
        message: "Connecting to selected project…",
      },
    }));
    const result: ConnectionResult = await attachToSelectedTab(
      provider,
      tab,
      port,
    );
    setBusy(undefined);
    if (connectionRevision.current[provider] !== attemptRevision) {
      if (result.ok) {
        await port.releaseConnector(result.tab.id, result.documentId);
      }
      return;
    }
    if (!result.ok) {
      setStates((current) => ({
        ...current,
        [provider]: { status: result.state, message: result.error },
      }));
      return;
    }
    setStates((current) => ({
      ...current,
      [provider]: {
        status: "connected",
        message: `Connected · ${result.tab.title} · read-only connector`,
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
          Local preview · Chrome tab and provider APIs are unavailable here.
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
              <strong aria-live="polite">{state.message}</strong>
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
            {state.status === "connected" ? (
              <p className={styles.connectionHint}>
                Connector reachable · read-only capability · no generation
                capability.
              </p>
            ) : null}
            {state.status !== "connected" && state.status !== "disconnected" ? (
              <p className={styles.connectionError} role="alert">
                {state.status === "pending"
                  ? "Pending · "
                  : `${state.status} · `}
                {state.message}
              </p>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
