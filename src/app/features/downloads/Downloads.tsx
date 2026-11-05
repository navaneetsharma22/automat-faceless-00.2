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
    <>
      <div
        className={styles.actionRow}
        role="tablist"
        aria-label="Download provider"
      >
        {(["Flow", "Vids"] as const).map((name) => (
          <Button
            key={name}
            role="tab"
            id={`downloads-tab-${name.toLowerCase()}`}
            aria-selected={provider === name}
            aria-controls={`downloads-panel-${name.toLowerCase()}`}
            variant={provider === name ? "primary" : "secondary"}
            onClick={() => setProvider(name)}
          >
            {name} Downloads
          </Button>
        ))}
      </div>
      <section
        role="tabpanel"
        id="downloads-panel-flow"
        aria-labelledby="downloads-tab-flow"
        hidden={provider !== "Flow"}
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
              Stopping monitoring leaves any Flow upscale or Chrome download
              running.
            </p>
          </div>
        ) : null}
      </section>
      <section
        role="tabpanel"
        id="downloads-panel-vids"
        aria-labelledby="downloads-tab-vids"
        hidden={provider !== "Vids"}
      >
        <h3>Vids Downloads</h3>
        <p>Vids download preparation is pending.</p>
      </section>
    </>
  );
}
