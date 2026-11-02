import { useEffect, useState } from "react";
import type { PreparedVideoBatchRecord } from "../../../domain/batches/types";
import { FoundationClientError, type createFoundationClient } from "../../../shared/messageClient";
import { Button } from "../../components/Button";
import styles from "./VidsPreparedBatchReview.module.css";

type AttachmentSnapshot = {
  status: "not_started" | "action_intent" | "attached" | "uncertain" | "blocked" | "unavailable";
  reason?: string;
  stage?: string;
};

export function VidsPreparedBatchReview({ preparedBatch, persistenceClient }: {
  preparedBatch: PreparedVideoBatchRecord;
  persistenceClient: ReturnType<typeof createFoundationClient>;
}) {
  return (
    <section className={styles.container} aria-labelledby="vids-review-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Google Vids</p>
          <h3 id="vids-review-title">Google Vids prepared batch</h3>
          <p>Review the exact paired references and prompts for this Vids target. Settings remain user-controlled.</p>
        </div>
        <span className={styles.badge}>Vids · {preparedBatch.itemCount} shots</span>
      </header>

      <dl className={styles.target}>
        <div><dt>Selected Vids target</dt><dd>{preparedBatch.target.canonicalTarget}</dd></div>
        <div><dt>Tab</dt><dd>{preparedBatch.target.tabId}</dd></div>
        <div><dt>Declared duration</dt><dd>{preparedBatch.manualSettingsDeclaration.declaredDurationSeconds}s · user-declared metadata</dd></div>
        <div><dt>Settings confirmation</dt><dd>{preparedBatch.manualSettingsDeclaration.destination === "Vids" && preparedBatch.manualSettingsDeclaration.tabId === preparedBatch.target.tabId && preparedBatch.manualSettingsDeclaration.canonicalTarget === preparedBatch.target.canonicalTarget ? "Confirmed for this Vids batch and target" : "Not confirmed for this Vids target"}</dd></div>
      </dl>
      <p className={styles.note}>This Google Vids action uploads only the paired saved reference. It does not insert the prompt or change Vids settings.</p>

      <ol className={styles.items} aria-label="Google Vids prepared shots">
        {preparedBatch.items.map((item) => (
          <VidsItemCard key={item.itemId} preparedBatch={preparedBatch} itemId={item.itemId} persistenceClient={persistenceClient} />
        ))}
      </ol>
    </section>
  );
}

function VidsItemCard({ preparedBatch, itemId, persistenceClient }: {
  preparedBatch: PreparedVideoBatchRecord;
  itemId: string;
  persistenceClient: ReturnType<typeof createFoundationClient>;
}) {
  const item = preparedBatch.items.find((candidate) => candidate.itemId === itemId)!;
  const [snapshot, setSnapshot] = useState<AttachmentSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    persistenceClient.request("vids.video.getAttachmentStatus", { preparedBatchId: preparedBatch.id, itemId })
      .then((value) => { if (!cancelled) setSnapshot(value as AttachmentSnapshot); })
      .catch(() => { if (!cancelled) setSnapshot({ status: "unavailable", reason: "operation_status_unavailable" }); });
    return () => { cancelled = true; };
  }, [itemId, persistenceClient, preparedBatch.id]);

  async function attachReference() {
    if (busy || snapshot?.status !== "not_started") return;
    setBusy(true);
    setSnapshot({ status: "action_intent" });
    try {
      const value = await persistenceClient.request("vids.video.attachReference", { preparedBatchId: preparedBatch.id, itemId }) as AttachmentSnapshot;
      setSnapshot(value);
    } catch (error) {
      const reason = error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "vids_upload_delivery_uncertain";
      setSnapshot({ status: "uncertain", reason });
    } finally {
      setBusy(false);
    }
  }

  const status = snapshot?.status ?? "checking";
  return (
    <li className={styles.card}>
      <div className={styles.cardHeading}>
        <div><h4>Shot {item.canonicalShotId}</h4><span className={styles.status} data-status={status}>{statusLabel(status)}</span></div>
        <span className={styles.reference}>{item.reference.width}×{item.reference.height} · {item.reference.mimeType} · v{item.reference.assignmentVersion}</span>
      </div>
      {snapshot?.status === "attached" ? <p role="status" aria-live="polite">Reference uploaded and bound to the verified Google Vids document.</p> : null}
      {snapshot?.status === "uncertain" || snapshot?.status === "action_intent" ? <p className={styles.error} role="alert">Upload delivery is uncertain{snapshot.reason ? ` (${snapshot.reason})` : ""}. This reference will not be uploaded again automatically.</p> : null}
      {snapshot?.status === "unavailable" ? <p className={styles.error} role="alert">Vids attachment status is unavailable. Reconnect to the selected Google Vids target before continuing.</p> : null}
      {snapshot?.status === "blocked" ? <p className={styles.error} role="alert">Vids preflight blocked file selection: <code>{snapshot.reason ?? "preflight_failed"}</code></p> : null}
      {snapshot?.status === "not_started" ? <div className={styles.action}>
        <Button type="button" variant="secondary" disabled={busy} loading={busy} loadingLabel="Uploading" onClick={() => void attachReference()}>Attach reference</Button>
        <span>Uploads the saved bytes paired to Shot {item.canonicalShotId}; prompt text and settings remain unchanged.</span>
      </div> : null}
      <details className={styles.prompt}>
        <summary>Exact prepared video prompt JSON · SHA-256 {item.contentHash.slice(0, 12)}…</summary>
        <p>SHA-256: <code>{item.contentHash}</code></p>
        <pre>{item.rawJsonBody}</pre>
      </details>
    </li>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "not_started": return "Ready to attach";
    case "action_intent": return "Upload in progress";
    case "attached": return "Reference attached";
    case "uncertain": return "Review required";
    case "blocked": return "Blocked";
    case "unavailable": return "Status unavailable";
    default: return "Checking";
  }
}
