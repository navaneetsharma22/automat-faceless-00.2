import { useState } from "react";
import { attachToSelectedTab } from "../../platforms/shared/connection";
import {
  createChromeConnectionPort,
  listOpenProviderTabs,
} from "../../platforms/shared/chromeConnectionPort";
import type {
  ProviderName,
  ProviderTab,
} from "../../platforms/shared/contracts";
import styles from "../Dashboard.module.css";

export function ConnectionStatus() {
  const [tabs, setTabs] = useState<ProviderTab[]>([]);
  const [selected, setSelected] = useState<Record<ProviderName, string>>({
    Flow: "",
    Vids: "",
  });
  const [connected, setConnected] = useState<
    Partial<Record<ProviderName, ProviderTab>>
  >({});
  const [errors, setErrors] = useState<Partial<Record<ProviderName, string>>>(
    {},
  );
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState<ProviderName | undefined>();

  const findOpenTabs = async () => {
    setListError("");
    try {
      if (typeof chrome === "undefined" || !chrome.permissions) {
        throw new Error(
          "Tab selection is available in the installed extension.",
        );
      }
      const granted = await chrome.permissions.request({
        permissions: ["tabs"],
      });
      if (!granted) {
        throw new Error(
          "Tab-list access was not granted. You can retry when ready.",
        );
      }
      const openTabs = await listOpenProviderTabs();
      setTabs(openTabs);
      // Never preselect the first match: the user explicitly chooses each tab.
      setSelected({ Flow: "", Vids: "" });
      if (openTabs.length === 0) {
        setListError(
          "No open Flow or Vids document tabs were found. Open the intended document and retry.",
        );
      }
    } catch (error) {
      setListError(
        error instanceof Error
          ? error.message
          : "Could not list open provider tabs.",
      );
    }
  };

  const connect = async (provider: ProviderName) => {
    setErrors((current) => ({ ...current, [provider]: undefined }));
    setConnected((current) => ({ ...current, [provider]: undefined }));
    const tabId = Number(selected[provider]);
    if (!Number.isInteger(tabId) || tabId < 0) {
      setErrors((current) => ({
        ...current,
        [provider]: `Select an already-open ${provider} document first.`,
      }));
      return;
    }
    const port = createChromeConnectionPort();
    if (!port) {
      setErrors((current) => ({
        ...current,
        [provider]:
          "Connection is available from the installed extension dashboard.",
      }));
      return;
    }

    setBusy(provider);
    try {
      const result = await attachToSelectedTab(provider, tabId, port);
      if (result.ok) {
        setConnected((current) => ({ ...current, [provider]: result.tab }));
        setErrors((current) => ({ ...current, [provider]: undefined }));
      } else {
        setErrors((current) => ({ ...current, [provider]: result.error }));
      }
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className={styles.connection} aria-labelledby="connection-title">
      <div className={styles.connectionHeading}>
        <span className={styles.statusDot} aria-hidden="true" />
        <h2 id="connection-title">Connections</h2>
      </div>
      <p className={styles.connectionHint}>
        Attach to an already-open document. The page will not be refreshed or
        navigated.
      </p>
      <button
        className={`${styles.connectionListButton} motion-control`}
        type="button"
        onClick={() => void findOpenTabs()}
      >
        Find open tabs
      </button>
      {listError ? (
        <p className={styles.connectionError} role="alert">
          {listError}
        </p>
      ) : null}
      {(["Flow", "Vids"] as const).map((provider) => {
        const options = tabs.filter((tab) => tab.provider === provider);
        const isConnected =
          connected[provider]?.id.toString() === selected[provider];
        return (
          <div className={styles.providerConnection} key={provider}>
            <div className={styles.providerConnectionTitle}>
              <span>{provider}</span>
              <strong>
                {isConnected
                  ? `Connected · ${connected[provider]?.title}`
                  : "Not connected"}
              </strong>
            </div>
            <label
              className={styles.connectionLabel}
              htmlFor={`selected-${provider.toLowerCase()}-tab`}
            >
              Already-open {provider} tab
            </label>
            <select
              className={styles.connectionSelect}
              id={`selected-${provider.toLowerCase()}-tab`}
              value={selected[provider]}
              onChange={(event) =>
                setSelected((current) => ({
                  ...current,
                  [provider]: event.currentTarget.value,
                }))
              }
            >
              <option value="">Select an open {provider} document</option>
              {options.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.title} — {new URL(tab.url).host} · tab {tab.id}
                </option>
              ))}
            </select>
            <button
              className={`${styles.connectionListButton} motion-control`}
              type="button"
              disabled={busy !== undefined}
              onClick={() => void connect(provider)}
            >
              {busy === provider
                ? "Connecting…"
                : isConnected
                  ? "Reconnect"
                  : "Connect"}
            </button>
            {errors[provider] ? (
              <p className={styles.connectionError} role="alert">
                {errors[provider]}
              </p>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
