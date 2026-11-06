import { useEffect, useState } from "react";
import type { createFoundationClient } from "../../../shared/messageClient";
import type { FlowGalleryDownloadDiagnostic } from "../../../platforms/flow/downloads";
import { FlowClipDownloads } from "./FlowGalleryDiagnostic";
import { Button } from "../../components/Button";
import styles from "../../Dashboard.module.css";
import {
  createHostedPickerUrl,
  HOSTED_PICKER_ORIGIN,
  HOSTED_PICKER_PATH,
} from "../../../shared/utils/hostedMp4Handoff";
import { VidsTimelineReady } from "./VidsTimelineReady";

type Client = ReturnType<typeof createFoundationClient>;

export function ProviderDownloads({
  client,
  extensionId = typeof chrome === "undefined" ? undefined : chrome.runtime?.id,
}: { client: Client; extensionId?: string }) {
  const [provider, setProvider] = useState<"Flow" | "Vids">("Flow");
  const [report, setReport] = useState<FlowGalleryDownloadDiagnostic>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let mounted = true;
    const read = async () => {
      try {
        const next = (await client.request(
          "flow.downloadDiagnostic.get",
          {},
        )) as FlowGalleryDownloadDiagnostic | { status: "idle" };
        if (mounted) {
          setReport(next.status === "idle" ? undefined : next);
          setError(undefined);
        }
      } catch {
        if (mounted)
          setError(
            "Flow download status is unavailable. Reconnect the extension before starting another attempt.",
          );
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 1000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [client]);
  const active =
    report?.status === "armed" || report?.status === "action_observed";
  const hostedHelperUrl = extensionId
    ? createHostedPickerUrl(extensionId)
    : undefined;
  return (
    <div className={styles.providerWorkspace} data-active-provider={provider}>
      <fieldset className={styles.providerChoiceGroup}>
        <legend>Choose a download provider</legend>
        <div className={styles.providerChoices}>
          {(["Flow", "Vids"] as const).map((name) => (
            <label
              className={styles.providerChoice}
              data-selected={provider === name}
              key={name}
            >
              <input
                type="radio"
                name="download-provider"
                value={name}
                checked={provider === name}
                onChange={() => setProvider(name)}
              />
              <span className={styles.providerChoiceCopy}>
                <span className={styles.providerChoiceEyebrow}>
                  {provider === name ? "Selected provider" : "Provider"}
                </span>
                <span className={styles.providerChoiceTitle}>
                  {name} Downloads
                </span>
                <span className={styles.providerChoiceDescription}>
                  {name === "Flow"
                    ? "Download imported clips from their exact verified Flow detail route."
                    : "Configure the existing helper and declare the manually prepared Vids timeline ready."}
                </span>
              </span>
              <span className={styles.providerChoiceMark} aria-hidden="true">
                {provider === name ? "Selected" : "Choose"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <section
        id="downloads-panel-flow"
        aria-labelledby="flow-downloads-heading"
        hidden={provider !== "Flow"}
        className={styles.providerPanel}
      >
        {error ? <p role="alert">{error}</p> : null}
        <FlowClipDownloads
          persistenceClient={client}
          report={report}
          downloadMode
        />
        {active ? (
          <div className={styles.actionRow}>
            <Button
              variant="secondary"
              onClick={() => {
                void client
                  .request("flow.downloadDiagnostic.stop", {})
                  .catch(() => setError("Monitoring could not be stopped."));
              }}
            >
              Stop monitoring
            </Button>
            <p className={styles.disabledReason}>
              Stopping monitoring does not stop a Flow job or Chrome download.
            </p>
          </div>
        ) : null}
      </section>
      <section
        id="downloads-panel-vids"
        aria-labelledby="vids-downloads-heading"
        hidden={provider !== "Vids"}
        className={`${styles.providerPanel} ${styles.vidsProviderPanel}`}
      >
        <header className={styles.providerPanelHeading}>
          <p className={styles.kicker}>VIDS PROVIDER</p>
          <h2 id="vids-downloads-heading">Vids Downloads</h2>
          <p>Connect the helper, choose the prepared document, then download its MP4.</p>
        </header>
        <article className={`${styles.hostedHelperCard} ${styles.vidsConnectCard}`}>
          <div className={styles.vidsSectionHeading}>
            <div>
              <span className={styles.vidsStep}>STEP 1</span>
              <h3>Connect helper</h3>
            </div>
            <a
              className={styles.hostedHelperAction}
              href={hostedHelperUrl ?? undefined}
              target="_blank"
              rel="noreferrer noopener"
              aria-disabled={!hostedHelperUrl}
              onClick={(event) => { if (!hostedHelperUrl) event.preventDefault(); }}
            >
              Open existing helper
            </a>
          </div>
          <div className={styles.vidsConnectionStatuses} aria-label="Connection status">
            <div className={styles.vidsStatusItem}>
              <span>Extension</span>
              <strong data-status={hostedHelperUrl ? "ready" : "unavailable"}>{hostedHelperUrl ? "Ready" : "Unavailable"}</strong>
            </div>
            <div className={styles.vidsStatusItem}>
              <span>Helper compatibility</span>
              <strong data-status={hostedHelperUrl ? "pending" : "unavailable"}>{hostedHelperUrl ? "Pending live check" : "Unavailable"}</strong>
            </div>
            <div className={styles.vidsStatusItem}>
              <span>Google account authorization</span>
              <strong data-status="neutral">Not checked</strong>
            </div>
          </div>
          <p className={styles.vidsConnectSummary}>Google authorization happens in the helper. This dashboard only shows extension configuration readiness.</p>
          <details className={styles.vidsConnectionDetails}>
            <summary>Connection details</summary>
            <div>
              <p>Helper: <code>{HOSTED_PICKER_ORIGIN}{HOSTED_PICKER_PATH}</code></p>
              <p>Launch extension ID: <code>{extensionId ?? "Unavailable"}</code></p>
              <p>The current local helper reads this launch ID and validates the exact origin, path, and query. A hosted compatibility handshake has not yet been checked.</p>
              <p>Enter any restricted Picker API key only on the hosted page. This extension view does not store or send API keys or account tokens.</p>
            </div>
          </details>
        </article>
        <VidsTimelineReady client={client} />
      </section>
    </div>
  );
}
