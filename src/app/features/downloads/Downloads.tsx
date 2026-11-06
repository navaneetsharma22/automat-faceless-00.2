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
    <div className={styles.providerWorkspace}>
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
                {name === "Vids"
                  ? "Available"
                  : provider === name
                    ? "Selected"
                    : "Choose"}
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
        className={styles.providerPanel}
      >
        <header className={styles.providerPanelHeading}>
          <p className={styles.kicker}>VIDS PROVIDER</p>
          <h2 id="vids-downloads-heading">Vids Downloads</h2>
          <p>Configure the existing hosted helper for this extension session.</p>
        </header>
        <article className={styles.hostedHelperCard}>
          <div className={styles.hostedHelperStatusGrid}>
            <div>
              <span className={styles.hostedHelperLabel}>Extension configuration</span>
              <strong>{hostedHelperUrl ? "Ready for this extension session" : "Unavailable outside the extension"}</strong>
            </div>
            <div>
              <span className={styles.hostedHelperLabel}>Hosted helper compatibility</span>
              <strong>{hostedHelperUrl ? "Source binding prepared; manual hosted compatibility check pending" : "Unavailable"}</strong>
            </div>
            <div>
              <span className={styles.hostedHelperLabel}>Google account authorization</span>
              <strong>Not checked</strong>
            </div>
          </div>
          <p>
            The helper opens at {HOSTED_PICKER_ORIGIN}{HOSTED_PICKER_PATH}. This extension supplies its current runtime ID in the launch URL, and the current local helper source validates that exact launch binding. Opening this page does not authorize a Google account. Any account authorization happens separately in the hosted helper.
          </p>
          <p className={styles.hostedHelperHint}>
            Enter any restricted Picker API key only on the hosted page. API keys and account tokens are not stored or sent by this extension configuration view.
          </p>
          {hostedHelperUrl ? (
            <a
              className={styles.hostedHelperAction}
              href={hostedHelperUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open existing helper
            </a>
          ) : (
            <Button variant="secondary" disabled>
              Open existing helper
            </Button>
          )}
        </article>
        <VidsTimelineReady client={client} />
      </section>
    </div>
  );
}
