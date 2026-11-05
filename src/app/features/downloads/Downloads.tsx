import { useEffect, useState } from "react";
import type { createFoundationClient } from "../../../shared/messageClient";
import type { FlowGalleryDownloadDiagnostic } from "../../../platforms/flow/downloads";
import { FlowClipDownloads } from "./FlowGalleryDiagnostic";
import { Button } from "../../components/Button";
import styles from "../../Dashboard.module.css";

type Client = ReturnType<typeof createFoundationClient>;

export function ProviderDownloads({ client }: { client: Client }) {
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
                    : "Vids download tools are not available in this build yet."}
                </span>
              </span>
              <span className={styles.providerChoiceMark} aria-hidden="true">
                {name === "Vids"
                  ? "Unavailable"
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
          <p>Vids download preparation is not implemented yet.</p>
        </header>
        <article className={styles.providerUnavailable}>
          <span className={styles.fileIcon} aria-hidden="true">V</span>
          <div>
            <h3>Unavailable</h3>
            <p>This area will show Vids download options when that workflow is supported.</p>
          </div>
        </article>
      </section>
    </div>
  );
}
