import { useEffect, useRef, useState } from "react";
import type { PreparedVideoBatchRecord } from "../../../domain/batches/types";
import type { VidsVideoGenerationOperation } from "../../../domain/jobs/vidsVideoGeneration";
import { FoundationClientError, type createFoundationClient } from "../../../shared/messageClient";
import { Button } from "../../components/Button";
import styles from "./VidsPreparedBatchReview.module.css";

type AttachmentSnapshot = {
  status: "not_started" | "action_intent" | "attached" | "uncertain" | "blocked" | "unavailable";
  reason?: string;
  stage?: string;
};
type GenerationSnapshot = {
  status: "not_started" | "retry_ready" | "dispatch_intent" | "dispatched" | "uncertain" | "blocked" | "already_dispatched" | "unavailable";
  reason?: string;
  stage?: string;
  operation?: VidsVideoGenerationOperation;
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
  const [generation, setGeneration] = useState<GenerationSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const generatingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    persistenceClient.request("vids.video.getAttachmentStatus", { preparedBatchId: preparedBatch.id, itemId })
      .then((value) => { if (!cancelled) setSnapshot(value as AttachmentSnapshot); })
      .catch(() => { if (!cancelled) setSnapshot({ status: "unavailable", reason: "operation_status_unavailable" }); });
    return () => { cancelled = true; };
  }, [itemId, persistenceClient, preparedBatch.id]);

  useEffect(() => {
    if (snapshot?.status !== "attached") { setGeneration(null); return; }
    let cancelled = false;
    persistenceClient.request("vids.video.getGenerationStatus", { preparedBatchId: preparedBatch.id, itemId })
      .then((value) => { if (!cancelled) setGeneration(value as GenerationSnapshot); })
      .catch(() => { if (!cancelled) setGeneration({ status: "unavailable", reason: "generation_status_unavailable" }); });
    return () => { cancelled = true; };
  }, [itemId, persistenceClient, preparedBatch.id, snapshot?.status]);

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

  async function generateThisShotOnce() {
    if (generatingRef.current || (generation?.status !== "not_started" && generation?.status !== "retry_ready") || snapshot?.status !== "attached") return;
    generatingRef.current = true;
    setGenerating(true);
    setGeneration({ status: "dispatch_intent" });
    try {
      const value = await persistenceClient.request("vids.video.generateOnce", { preparedBatchId: preparedBatch.id, itemId }) as GenerationSnapshot;
      setGeneration(value);
    } catch (error) {
      const reason = error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "vids_generate_delivery_uncertain";
      setGeneration({ status: "uncertain", reason });
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  async function recoverPreActivationFailure() {
    const operation = generation?.operation;
    if (recovering || generation?.status !== "blocked" || !operation || operation.status !== "blocked" ||
        operation.failureStage !== "generate_preflight" || operation.reason !== "ai_sidebar_missing" ||
        operation.activationAttempted || operation.activationCount !== 0 || operation.preActivationRecovery) return;
    setRecovering(true);
    try {
      const value = await persistenceClient.request("vids.video.recoverPreActivationFailure", { expected: operation }) as GenerationSnapshot;
      setGeneration(value);
    } catch (error) {
      const reason = error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "generation_recovery_failed";
      setGeneration({ ...generation, reason });
    } finally {
      setRecovering(false);
    }
  }

  async function copyGenerationSnapshot() {
    if (!generation?.operation) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(generation.operation, null, 2));
      setDiagnosticCopied(true);
    } catch {
      setDiagnosticCopied(false);
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
      {generation?.status === "retry_ready" ? <p role="status" aria-live="polite">The exact pre-click failure was reconciled. Generate has not been activated; submission remains a separate action.</p> : null}
      {snapshot?.status === "attached" && (generation?.status === "not_started" || generation?.status === "retry_ready") ? <div className={styles.action}>
        <Button type="button" variant="primary" disabled={generating} loading={generating} loadingLabel="Sending once" onClick={() => void generateThisShotOnce()}>Generate this shot once</Button>
        <span>Enters this Shot’s exact prepared JSON, verifies the editor and attached reference, then activates Generate once. Vids settings remain unchanged.</span>
      </div> : null}
      {generation?.status === "dispatched" || generation?.status === "already_dispatched" ? <p role="status" aria-live="polite">Generate sent for Shot {item.canonicalShotId}. Video completion is not verified here.</p> : null}
      {generation?.status === "uncertain" || generation?.status === "dispatch_intent" ? <p className={styles.error} role="alert">Generate delivery is uncertain{generation.reason ? ` (${generation.reason})` : ""}. This Shot will not be submitted again automatically.</p> : null}
      {generation?.status === "blocked" ? <p className={styles.error} role="alert">Vids generation is blocked{generation.reason ? ` (${generation.reason})` : ""}. Generate was not activated for this attempt.</p> : null}
      {generation?.status === "blocked" && generation.operation?.status === "blocked" && generation.operation.failureStage === "generate_preflight" && generation.operation.reason === "ai_sidebar_missing" && !generation.operation.activationAttempted && generation.operation.activationCount === 0 && !generation.operation.preActivationRecovery ? <div className={styles.action}>
        <Button type="button" variant="secondary" disabled={recovering} loading={recovering} loadingLabel="Checking exact operation" onClick={() => void recoverPreActivationFailure()}>Reconcile proven pre-click failure</Button>
        <span>Compares this complete operation snapshot and the attached reference. This action does not enter the prompt or click Generate.</span>
      </div> : null}
      {generation?.operation ? <details className={styles.prompt}>
        <summary>Read-only generation operation snapshot</summary>
        <p>Bounded operation fields only; no prompt text or signed resource URL is included.</p>
        <Button type="button" variant="secondary" onClick={() => void copyGenerationSnapshot()}>Copy operation snapshot</Button>
        {diagnosticCopied ? <span role="status">Operation snapshot copied.</span> : null}
        <pre>{JSON.stringify(generation.operation, null, 2)}</pre>
      </details> : null}
      {generation?.status === "unavailable" ? <p className={styles.error} role="alert">Generation status is unavailable. Reconnect to the selected Google Vids target to inspect its durable status.</p> : null}
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
