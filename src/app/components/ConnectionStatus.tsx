import { useEffect, useRef, useState } from "react";
import { connectionWorkerFailureDetail } from "../connectionAttempt";
import { ConnectionError } from "./ConnectionError";
import { createChromeFoundationClient } from "../../shared/messageClient";
import {
  isCurrentConnectionAttempt,
  isCurrentWorkerStart,
  providerDocumentNeedsReverification,
  readConnectionStateChangedEvent,
  readWorkerStartEvent,
  workerStartAction,
} from "../../platforms/shared/connectionLifecycle";
import { providerTabFromUrl } from "../../platforms/shared/connection";
import {
  createChromeConnectionPort,
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
import styles from "../Dashboard.module.css";

type TargetMetadata = {
  tabId: number;
  canonicalTarget: string;
  reconnectEnabled: boolean;
};
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
      return "Stale document / wrong target";
    case "stale-build":
      return "Outdated connector";
    case "failed":
      return "Temporarily unreachable";
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
  const statesRef = useRef(states);
  const savedRef = useRef(saved);
  const reconnectEnabledRef = useRef<Record<ProviderName, boolean>>({
    Flow: false,
    Vids: false,
  });
  const workerInstanceIdsRef = useRef(new Set<string>());
  const verificationTasksRef = useRef<
    Partial<
      Record<
        ProviderName,
        {
          key: string;
          trigger: string;
          enableReconnect: boolean;
          task: Promise<void>;
        }
      >
    >
  >({});
  const verifySavedRef = useRef<
    (
      provider: ProviderName,
      target: TargetMetadata,
      trigger: string,
    ) => Promise<void>
  >(async () => undefined);
  statesRef.current = states;
  savedRef.current = saved;

  const invalidate = (
    provider: ProviderName,
    message: string,
    status: "disconnected" | "wrong-target" | "stale-build" = "disconnected",
  ) => {
    connectionRevision.current[provider] += 1;
    const live = statesRef.current[provider].live;
    if (live) {
      void createChromeConnectionPort()?.releaseConnector(
        live.tab.id,
        live.documentId,
      );
    }
    setStates((current) => ({
      ...current,
      [provider]: {
        status,
        message: connectionStatusLabel(status),
        detail: message,
      },
    }));
  };

  const verifySavedConnection = async (
    provider: ProviderName,
    target: TargetMetadata,
    trigger: string,
    enableReconnect = false,
  ): Promise<void> => {
    if (!reconnectEnabledRef.current[provider] && !enableReconnect) return;
    const key = `${target.tabId}:${target.canonicalTarget}`;
    const active = verificationTasksRef.current[provider];
    if (active?.key === key && (!enableReconnect || active.enableReconnect))
      return active.task;

    const attemptRevision = ++connectionRevision.current[provider];
    setBusy(provider);
    setStates((current) => ({
      ...current,
      [provider]: {
        status: "pending",
        message: "Checking connection...",
        detail:
          "Verifying the previously selected project with the worker's read-only handshake.",
      },
    }));

    const task = (async () => {
      try {
        const result = (await createChromeFoundationClient().request(
          "connections.revalidate",
          { provider, enableReconnect },
        )) as {
          ok: boolean;
          state: string;
          reason: string;
          tab?: ProviderTab;
          documentId?: string;
          documentToken?: string;
          permissionRequest?: Extract<
            ConnectionResult,
            { ok: false }
          >["permissionRequest"];
        };
        if (
          !isCurrentConnectionAttempt(
            connectionRevision.current[provider],
            attemptRevision,
            reconnectEnabledRef.current[provider] || enableReconnect,
          )
        )
          return;
        if (!result.ok) {
          const status: ConnectionStateName =
            result.state === "permission-needed"
              ? "permission-needed"
              : result.state === "stale-build"
                ? "stale-build"
                : result.state === "stale-document" ||
                    result.state === "wrong-target"
                  ? "wrong-target"
                  : result.state === "disconnected"
                    ? "disconnected"
                    : "failed";
          setStates((current) => ({
            ...current,
            [provider]: {
              status,
              message:
                status === "failed"
                  ? "Temporarily unreachable"
                  : connectionStatusLabel(status),
              detail: `revalidation_${result.reason}: ${
                status === "wrong-target"
                  ? "The selected project or document changed. Select the same intended project and verify it again."
                  : status === "stale-build"
                    ? result.reason === "stale_connector_active_observation"
                      ? "The connector is outdated while a Flow observation is active. It was left untouched; inspect or wait for that attempt before reconnecting."
                      : result.reason === "stale_connector_state_unavailable"
                        ? "The connector is outdated, but durable observation state could not be checked. Retry Connect when storage is available."
                        : "A live connector version mismatch was detected. The worker attempted only the guarded same-document replacement; verify again after the current package handshake completes."
                    : status === "permission-needed"
                      ? "Grant the requested provider access, then retry verification."
                      : status === "disconnected"
                        ? "This target is manually disconnected. Choose Connect to verify it again."
                        : "The selected document could not be reached. Retry the bounded check without refreshing the provider tab."
              }`,
              permissionRequest: result.permissionRequest,
            },
          }));
          return;
        }
        if (!result.tab || !result.documentId || !result.documentToken) {
          setStates((current) => ({
            ...current,
            [provider]: {
              status: "failed",
              message: "Temporarily unreachable",
              detail: "revalidation_response_incomplete",
            },
          }));
          return;
        }
        reconnectEnabledRef.current[provider] = true;
        const live = {
          tab: result.tab,
          documentId: result.documentId,
          documentToken: result.documentToken,
        };
        setTabs((current) => [
          ...current.filter((tab) => tab.id !== result.tab!.id),
          result.tab!,
        ]);
        setSaved((current) => ({
          ...current,
          [provider]: { ...target, reconnectEnabled: true },
        }));
        setSelected((current) => ({
          ...current,
          [provider]: String(target.tabId),
        }));
        setSelectionSaved((current) => ({ ...current, [provider]: true }));
        setStates((current) => ({
          ...current,
          [provider]: { status: "connected", message: "Connected", live },
        }));
      } catch (error) {
        if (connectionRevision.current[provider] === attemptRevision) {
          setStates((current) => ({
            ...current,
            [provider]: {
              status: "failed",
              message: "Temporarily unreachable",
              detail: connectionWorkerFailureDetail(error),
            },
          }));
        }
      } finally {
        if (connectionRevision.current[provider] === attemptRevision)
          setBusy(undefined);
      }
    })();
    verificationTasksRef.current[provider] = {
      key,
      trigger,
      enableReconnect,
      task,
    };
    try {
      await task;
    } finally {
      if (verificationTasksRef.current[provider]?.task === task)
        delete verificationTasksRef.current[provider];
    }
  };
  verifySavedRef.current = verifySavedConnection;

  useEffect(() => {
    if (!hasWorkerMessagingApi()) return;
    const client = createChromeFoundationClient();
    let active = true;
    void Promise.all(
      providers.map(async (provider) => {
        try {
          const result = (await client.request("connections.getSelection", {
            provider,
          })) as (TargetMetadata & { reconnectEnabled?: boolean }) | null;
          return { provider, result };
        } catch {
          return { provider, result: null };
        }
      }),
    ).then(async (selections) => {
      if (!active) return;
      for (const { provider, result } of selections) {
        if (!result) continue;
        const target = {
          tabId: result.tabId,
          canonicalTarget: result.canonicalTarget,
          reconnectEnabled: result.reconnectEnabled !== false,
        };
        reconnectEnabledRef.current[provider] = target.reconnectEnabled;
        setSaved((current) => ({ ...current, [provider]: target }));
        setSelected((current) => ({
          ...current,
          [provider]: String(target.tabId),
        }));
        setSelectionSaved((current) => ({ ...current, [provider]: true }));
        if (target.reconnectEnabled) {
          await verifySavedRef.current(provider, target, "dashboard-open");
        } else {
          setStates((current) => ({
            ...current,
            [provider]: {
              status: "disconnected",
              message: "Not connected",
              detail:
                "Manual disconnect is active. Choose Connect to verify this target again.",
            },
          }));
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined") return;
    const onRemoved = (tabId: number) => {
      for (const provider of providers) {
        if (statesRef.current[provider].live?.tab.id === tabId) {
          invalidate(provider, "Disconnected · selected tab closed");
        }
      }
    };
    const onUpdated = (
      tabId: number,
      changeInfo: { url?: string; status?: string },
    ) => {
      if (!changeInfo.url && changeInfo.status !== "loading") return;
      for (const provider of providers) {
        const live = statesRef.current[provider].live;
        if (
          live?.tab.id === tabId &&
          providerDocumentNeedsReverification(live.tab, changeInfo)
        ) {
          invalidate(
            provider,
            "The selected browser document is navigating or its project route changed. Reconnect to verify it again.",
            "wrong-target",
          );
        }
      }
    };
    chrome.tabs?.onRemoved.addListener(onRemoved);
    chrome.tabs?.onUpdated.addListener(onUpdated);
    const onRuntimeMessage = (message: unknown) => {
      const stateChange = readConnectionStateChangedEvent(message);
      if (stateChange) {
        const provider = stateChange.provider;
        void createChromeFoundationClient()
          .request("connections.getSelection", { provider })
          .then((value) => {
            const current = value as {
              tabId: number;
              canonicalTarget: string;
              reconnectEnabled?: boolean;
              verification: "unverified" | "verified";
              connectionState?: string;
              verificationBinding?: {
                documentId: string;
                documentToken: string;
              };
            } | null;
            const intended = savedRef.current[provider];
            if (
              !current ||
              !intended ||
              current.tabId !== intended.tabId ||
              current.canonicalTarget !== intended.canonicalTarget
            )
              return;
            const reconnectEnabled = current.reconnectEnabled !== false;
            reconnectEnabledRef.current[provider] = reconnectEnabled;
            if (
              current.connectionState === "verified" &&
              current.verification === "verified" &&
              current.verificationBinding?.documentId &&
              current.verificationBinding.documentToken
            ) {
              const tab =
                tabs.find(
                  (candidate) =>
                    candidate.id === current.tabId &&
                    candidate.canonicalTarget === current.canonicalTarget,
                ) ??
                providerTabFromUrl(current.tabId, "", current.canonicalTarget);
              if (tab) {
                setStates((statesNow) => ({
                  ...statesNow,
                  [provider]: {
                    status: "connected",
                    message: "Connected",
                    live: {
                      tab,
                      documentId: current.verificationBinding!.documentId,
                      documentToken: current.verificationBinding!.documentToken,
                    },
                  },
                }));
                return;
              }
            }
            const state = current.connectionState ?? "disconnected";
            const status: ConnectionStateName =
              state === "checking"
                ? "pending"
                : state === "stale-build"
                  ? "stale-build"
                  : state === "stale-document"
                    ? "wrong-target"
                    : state === "temporarily-unreachable"
                      ? "failed"
                      : "disconnected";
            setStates((statesNow) => ({
              ...statesNow,
              [provider]: {
                status,
                message:
                  status === "failed"
                    ? "Temporarily unreachable"
                    : connectionStatusLabel(status),
                detail: `connection_${stateChange.reason}: ${
                  state === "stale-document"
                    ? "The saved document binding no longer matches the selected tab. Verify the same intended project explicitly."
                    : state === "stale-build"
                      ? "The saved connector build is stale. Select the intended project and reconnect with the current package."
                      : state === "temporarily-unreachable"
                        ? "The selected project could not be reached by a bounded check. Retry when it is available."
                        : state === "checking"
                          ? "A bounded read-only verification is in progress."
                          : "This target is manually disconnected. Choose Connect to verify it again."
                }`,
              },
            }));
          })
          .catch(() => undefined);
        return;
      }
      const event = readWorkerStartEvent(message);
      if (!event || workerInstanceIdsRef.current.has(event.workerInstanceId)) {
        return;
      }
      workerInstanceIdsRef.current.add(event.workerInstanceId);
      if (workerInstanceIdsRef.current.size > 32) {
        const oldest = workerInstanceIdsRef.current.values().next().value;
        if (oldest) workerInstanceIdsRef.current.delete(oldest);
      }
      if (!isCurrentWorkerStart(event)) {
        for (const provider of providers) {
          if (!reconnectEnabledRef.current[provider]) continue;
          connectionRevision.current[provider] += 1;
          setStates((current) => ({
            ...current,
            [provider]: {
              status: "stale-build",
              message: "Outdated connector",
              detail:
                "The extension worker build or protocol changed. Reopen the dashboard before verifying this target.",
            },
          }));
        }
        return;
      }
      void (async () => {
        for (const provider of providers) {
          const target = savedRef.current[provider];
          const action = workerStartAction(
            Boolean(target),
            reconnectEnabledRef.current[provider],
          );
          if (action === "verify" && target) {
            await verifySavedRef.current(
              provider,
              target,
              event.workerInstanceId,
            );
          }
        }
      })();
    };
    chrome.runtime?.onMessage.addListener(onRuntimeMessage);
    return () => {
      chrome.tabs?.onRemoved.removeListener(onRemoved);
      chrome.tabs?.onUpdated.removeListener(onUpdated);
      chrome.runtime?.onMessage.removeListener(onRuntimeMessage);
    };
  }, []);

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
    reconnectEnabledRef.current[provider] = false;
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
    savedRef.current = { ...savedRef.current, [provider]: metadata };
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
          const selectedTarget = {
            ...metadata,
            reconnectEnabled: false,
          };
          reconnectEnabledRef.current[provider] = false;
          savedRef.current = {
            ...savedRef.current,
            [provider]: selectedTarget,
          };
          setSaved((current) => ({ ...current, [provider]: selectedTarget }));
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
        reconnectEnabledRef.current[provider] = false;
        savedRef.current = { ...savedRef.current, [provider]: undefined };
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
    const target = {
      tabId: tab.id,
      canonicalTarget: tab.canonicalTarget,
      reconnectEnabled: true,
    };
    reconnectEnabledRef.current[provider] = true;
    savedRef.current = { ...savedRef.current, [provider]: target };
    setSaved((current) => ({ ...current, [provider]: target }));
    await verifySavedConnection(provider, target, "user-connect", true);
  };
  const allowProviderAccess = (provider: ProviderName) => {
    const request = states[provider].permissionRequest;
    if (!request) return;

    const permissionRevision = ++connectionRevision.current[provider];
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
        if (connectionRevision.current[provider] !== permissionRevision) return;
        const savedTarget = savedRef.current[provider];
        if (granted && savedTarget && reconnectEnabledRef.current[provider]) {
          void verifySavedRef.current(
            provider,
            savedTarget,
            `permission-granted-${permissionRevision}`,
          );
          return;
        }
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
        if (connectionRevision.current[provider] !== permissionRevision) return;
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
      .finally(() => {
        if (connectionRevision.current[provider] === permissionRevision) {
          setBusy(undefined);
        }
      });
  };

  const disconnect = (provider: ProviderName) => {
    connectionRevision.current[provider] += 1;
    const disconnectRevision = connectionRevision.current[provider];
    reconnectEnabledRef.current[provider] = false;
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
    void createChromeFoundationClient()
      .request("connections.setReconnectIntent", { provider, enabled: false })
      .then((value) => {
        if (
          connectionRevision.current[provider] !== disconnectRevision ||
          (value as { updated?: boolean }).updated
        ) {
          return;
        }
        setStates((current) => ({
          ...current,
          [provider]: {
            status: "disconnected",
            message: "Not connected",
            detail:
              "Manual disconnect is active, but could not be saved for dashboard reopen.",
          },
        }));
      })
      .catch(() => {
        if (connectionRevision.current[provider] !== disconnectRevision) return;
        setStates((current) => ({
          ...current,
          [provider]: {
            status: "disconnected",
            message: "Not connected",
            detail:
              "Manual disconnect is active in this dashboard, but could not be saved for dashboard reopen.",
          },
        }));
      });
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
                {state.status === "pending"
                  ? state.message
                  : connectionStatusLabel(state.status)}
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
                  ? state.status === "pending" &&
                    state.message === "Checking connection…"
                    ? "Checking connection…"
                    : "Connecting…"
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
