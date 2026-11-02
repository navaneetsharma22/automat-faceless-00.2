import { useEffect, useRef, useState } from "react";
import type { PreparedVideoBatchRecord } from "../../../domain/batches/types";
import type { VidsVideoGenerationOperation } from "../../../domain/jobs/vidsVideoGeneration";
import type { VidsVideoQueueRecord } from "../../../domain/jobs/vidsVideoQueue";
import { FoundationClientError, type createFoundationClient } from "../../../shared/messageClient";
import { Button } from "../../components/Button";
import styles from "./VidsPreparedBatchReview.module.css";
import { useOptionalToast } from "../../components/ToastHost";

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
type VidsQueueSnapshot = VidsVideoQueueRecord;
type TransitionDiagnostic = {
  stage?: string; operationBound?: boolean; attachmentBound?: boolean; targetBound?: boolean; documentBound?: boolean;
  sidebar?: string; animateTab?: string; animatePanel?: string; editor?: string; previewCount?: number;
  promptExpectedSha256?: string; promptActualSha256?: string; promptMatches?: boolean; promptTextMatches?: boolean; promptHashMatches?: boolean;
  referenceExpectedSha256?: string; referenceActualSha256?: string; referenceProofSource?: string;
  referenceResult?: string; referenceReason?: string; expectedMimeType?: string; actualMimeType?: string;
  expectedByteSize?: number; actualByteSize?: number; expectedWidth?: number; expectedHeight?: number; actualWidth?: number; actualHeight?: number;
};
type TransitionInspection = { status: string; reason?: string; diagnostics?: TransitionDiagnostic };

export function VidsPreparedBatchReview({ preparedBatch, persistenceClient }: {
  preparedBatch: PreparedVideoBatchRecord;
  persistenceClient: ReturnType<typeof createFoundationClient>;
}) {
  const [queue, setQueue] = useState<VidsQueueSnapshot | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [transitionInspection, setTransitionInspection] = useState<{ itemId: string; result: TransitionInspection } | null>(null);
  const [inspectingItemId, setInspectingItemId] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const toast = useOptionalToast();
  const priorAllSent = useRef<{ id: string; allSent: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => persistenceClient.request("vids.videoQueue.get", { preparedBatchId: preparedBatch.id })
      .then((value) => { if (!cancelled) setQueue(value as VidsQueueSnapshot | null); }).catch(() => undefined);
    void load();
    const poll = window.setInterval(() => void load(), 2500);
    return () => { cancelled = true; window.clearInterval(poll); };
  }, [persistenceClient, preparedBatch.id]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const allSent = Boolean(queue?.items.length && queue.items.every((item) => item.state === "sent" && item.dispatchReceipt));
  useEffect(() => {
    if (!queue) return;
    const previous = priorAllSent.current;
    if (previous?.id === queue.queueId && !previous.allSent && allSent)
      toast?.add({ kind: "success", message: `All ${queue.items.length} prompts sent successfully to Google Vids.` });
    priorAllSent.current = { id: queue.queueId, allSent };
  }, [allSent, queue, toast]);
  const queueAction = async (action: "start" | "pause" | "resume" | "stop") => {
    if (queueBusy) return;
    setQueueBusy(true);
    setQueueError(null);
    try {
      const type = `vids.videoQueue.${action}` as const;
      const payload = action === "start" ? { preparedBatchId: preparedBatch.id } : { preparedBatchId: preparedBatch.id, expectedRevision: queue?.revision ?? 0 };
      const value = await persistenceClient.request(type, payload) as VidsQueueSnapshot;
      if (value) setQueue(value);
    } catch (error) {
      setQueueError(error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "vids_queue_action_failed");
    } finally { setQueueBusy(false); }
  };
  const inspectTransition = async (itemId: string) => {
    if (queueBusy) return;
    setQueueBusy(true); setInspectingItemId(itemId); setQueueError(null); setTransitionInspection(null);
    try {
      const result = await persistenceClient.request("vids.videoQueue.inspectTransition", { preparedBatchId: preparedBatch.id, itemId }) as TransitionInspection;
      setTransitionInspection({ itemId, result });
    } catch (error) {
      setQueueError(error instanceof FoundationClientError && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "vids_transition_inspection_failed");
    } finally { setInspectingItemId(null); setQueueBusy(false); }
  };
  const queueItem = (itemId: string) => queue?.items.find((item) => item.itemId === itemId);
  const sentCount = queue?.items.filter((item) => item.state === "sent" && item.dispatchReceipt).length ?? 0;
  const nextQueueItem = queue?.items.find((item) => item.state !== "sent");
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
      <p className={styles.note}>Queue submission pairs each saved reference with its exact prepared prompt and sends Generate once. Provider settings remain user-controlled.</p>

      <section className={styles.queue} aria-label="Google Vids timed submission queue">
        <div className={styles.queueHeading}><div><p className={styles.eyebrow}>Timed submission</p><h4>{allSent ? `All ${queue?.items.length ?? 0} image–prompt pairs sent to Google Vids` : `Google Vids queue · ${sentCount} of ${preparedBatch.items.length} prompts sent`}</h4></div><span className={styles.status} data-status={queue?.state ?? "ready"}>{queue ? queueStateLabel(queue.state) : "Ready"}</span></div>
        <div className={styles.progressSummary} role="progressbar" aria-label="Vids prompt dispatch progress" aria-valuemin={0} aria-valuemax={preparedBatch.items.length} aria-valuenow={sentCount} aria-valuetext={`${sentCount} of ${preparedBatch.items.length} prompts sent`}><span style={{ width: `${preparedBatch.items.length ? sentCount / preparedBatch.items.length * 100 : 0}%` }} /></div>
        {!allSent ? <p className={styles.queueItem}>Current/next Shot: <strong>{nextQueueItem ? `Shot ${nextQueueItem.shotId}` : "None"}</strong><span>{nextQueueItem ? queueItemLabel(nextQueueItem.state) : "Waiting to start"}</span>{queue?.nextActionAt ? <span>Next check: {new Date(queue.nextActionAt).toLocaleTimeString()}</span> : null}</p> : null}
        {allSent ? <p className={styles.note}>Video completion can be checked in Google Vids.</p> : null}
        {queue && !["paused", "stopped", "blocked", "all_sent"].includes(queue.state) ? <QueueClock queue={queue} now={clockNow} /> : null}
        {queue?.pauseReason && ["paused", "stopped", "blocked"].includes(queue.state) ? <p className={queue.state === "blocked" ? styles.error : styles.note} role="status">{queueStateLabel(queue.state)} · {queue.pauseReason.replaceAll("_", " ")}{queue.pauseReason === "vids_composer_collapsed_or_changed" ? " — open the same Vids target’s Animate composer, then use Resume. The queue will only replace content that still exactly matches the previously sent Shot." : queue.pauseReason === "vids_previous_composer_content_conflict" ? " — review the current composer text and image in Vids; the queue preserved them. Resolve the conflict, then use Resume." : ""}</p> : null}
        {queueError ? <p className={styles.error} role="alert">Vids queue action failed: <code>{queueError}</code></p> : null}
        <div className={styles.action}>
          {!queue ? <Button variant="primary" disabled={queueBusy} loading={queueBusy} loadingLabel="Starting queue" onClick={() => void queueAction("start")}>Start Vids queue</Button> : null}
          {queue?.state === "ready" ? <Button variant="primary" disabled={queueBusy} loading={queueBusy} loadingLabel="Starting queue" onClick={() => void queueAction("start")}>Start Vids queue</Button> : null}
          {queue && ["ready", "cooldown", "preparing", "checking_generate"].includes(queue.state) ? <><Button variant="secondary" disabled={queueBusy} loading={queueBusy} loadingLabel="Pausing" onClick={() => void queueAction("pause")}>Pause</Button><Button variant="quiet" disabled={queueBusy} onClick={() => void queueAction("stop")}>Stop queue</Button></> : null}
          {queue?.state === "paused" ? <><Button variant="primary" disabled={queueBusy} loading={queueBusy} loadingLabel="Resuming" onClick={() => void queueAction("resume")}>Resume</Button><Button variant="quiet" disabled={queueBusy} onClick={() => void queueAction("stop")}>Stop queue</Button></> : null}
          {queue?.state === "stopped" ? <span>The queue is stopped. Sent items remain protected from replay.</span> : null}
        </div>
        {queue?.items.map((entry) => <div key={entry.itemId}>
          <p className={styles.queueItem}><strong>Shot {entry.shotId}</strong><span>{queueItemLabel(entry.state)}</span>{entry.reason ? <details><summary>Details</summary><code>{entry.reason}</code></details> : null}</p>
          {queue.state === "paused" && entry.state === "blocked" && entry.reason === "vids_previous_composer_content_conflict" ? <div className={styles.action}>
            <Button variant="secondary" disabled={queueBusy} loading={inspectingItemId === entry.itemId} loadingLabel="Inspecting read-only" onClick={() => void inspectTransition(entry.itemId)}>Inspect transition (read-only)</Button>
            {transitionInspection?.itemId === entry.itemId ? <details open className={styles.prompt}>
              <summary>Bounded transition diagnostics</summary>
              {transitionInspection.result.reason ? <p>{transitionInspection.result.reason.replaceAll("_", " ")}</p> : null}
              {transitionInspection.result.diagnostics ? <dl className={styles.diagnostics}>
                <div><dt>Failing stage</dt><dd>{transitionInspection.result.diagnostics.stage ?? "unknown"}</dd></div>
                <div><dt>Previous operation / attachment / target / document bound</dt><dd>{[transitionInspection.result.diagnostics.operationBound, transitionInspection.result.diagnostics.attachmentBound, transitionInspection.result.diagnostics.targetBound, transitionInspection.result.diagnostics.documentBound].map((value) => value === undefined ? "not checked" : value ? "matched" : "mismatch").join(" / ")}</dd></div>
                <div><dt>Prompt expected / current SHA-256</dt><dd><code>{transitionInspection.result.diagnostics.promptExpectedSha256 ?? "not checked"}</code><br /><code>{transitionInspection.result.diagnostics.promptActualSha256 ?? "not available"}</code></dd></div>
                <div><dt>Prompt text / hash match</dt><dd>{[transitionInspection.result.diagnostics.promptTextMatches, transitionInspection.result.diagnostics.promptHashMatches].map((value) => value === undefined ? "not checked" : value ? "yes" : "no").join(" / ")}</dd></div>
                <div><dt>Reference expected / current SHA-256</dt><dd><code>{transitionInspection.result.diagnostics.referenceExpectedSha256 ?? "not checked"}</code><br /><code>{transitionInspection.result.diagnostics.referenceActualSha256 ?? "not available"}</code></dd></div>
                <div><dt>Reference proof</dt><dd>{transitionInspection.result.diagnostics.referenceResult ?? "not checked"}{transitionInspection.result.diagnostics.referenceProofSource ? ` · ${transitionInspection.result.diagnostics.referenceProofSource}` : ""}{transitionInspection.result.diagnostics.referenceReason ? ` · ${transitionInspection.result.diagnostics.referenceReason}` : ""}</dd></div>
                <div><dt>Current media metadata</dt><dd>{transitionInspection.result.diagnostics.actualMimeType ?? "unknown"}, {transitionInspection.result.diagnostics.actualByteSize ?? "unknown"} bytes, {transitionInspection.result.diagnostics.actualWidth ?? "?"}×{transitionInspection.result.diagnostics.actualHeight ?? "?"}</dd></div>
                <div><dt>Scoped DOM</dt><dd>Sidebar {transitionInspection.result.diagnostics.sidebar ?? "not checked"}; Animate {transitionInspection.result.diagnostics.animateTab ?? "not checked"}/{transitionInspection.result.diagnostics.animatePanel ?? "not checked"}; editor {transitionInspection.result.diagnostics.editor ?? "not checked"}; previews {transitionInspection.result.diagnostics.previewCount ?? "not checked"}</dd></div>
              </dl> : null}
              <p>No picker, attachment, prompt, Generate, queue, or operation state was changed by this inspection.</p>
            </details> : null}
          </div> : null}
        </div>)}
      </section>

      <ol className={styles.items} aria-label="Google Vids prepared shots">
        {preparedBatch.items.map((item) => (
          <VidsItemCard key={item.itemId} preparedBatch={preparedBatch} itemId={item.itemId} persistenceClient={persistenceClient} queueOwnsBatch={!!queue} queueState={queueItem(item.itemId)?.state} />
        ))}
      </ol>
    </section>
  );
}

function VidsItemCard({ preparedBatch, itemId, persistenceClient, queueOwnsBatch = false, queueState }: {
  preparedBatch: PreparedVideoBatchRecord;
  itemId: string;
  persistenceClient: ReturnType<typeof createFoundationClient>;
  queueOwnsBatch?: boolean;
  queueState?: string;
}) {
  const item = preparedBatch.items.find((candidate) => candidate.itemId === itemId)!;
  const [snapshot, setSnapshot] = useState<AttachmentSnapshot | null>(null);
  const [generation, setGeneration] = useState<GenerationSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const generatingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    persistenceClient.request("vids.video.getAttachmentStatus", { preparedBatchId: preparedBatch.id, itemId })
      .then((value) => { if (!cancelled) setSnapshot(value as AttachmentSnapshot); })
      .catch(() => { if (!cancelled) setSnapshot({ status: "unavailable", reason: "operation_status_unavailable" }); });
    return () => { cancelled = true; };
  }, [itemId, persistenceClient, preparedBatch.id]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    persistenceClient.request("vids.video.getReferencePreview", { preparedBatchId: preparedBatch.id, itemId })
      .then((value) => {
        const result = value as { referenceId?: string; sha256?: string; mimeType?: string; byteSize?: number; base64?: string } | null;
        if (!result || result.referenceId !== item.reference.referenceId || result.sha256 !== item.reference.sha256 || result.mimeType !== item.reference.mimeType || result.byteSize !== item.reference.byteSize || !result.base64 || cancelled) return;
        const binary = atob(result.base64);
        if (binary.length !== result.byteSize) return;
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
        setThumbnailUrl(objectUrl);
      }).catch(() => undefined);
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item.reference.byteSize, item.reference.mimeType, item.reference.referenceId, item.reference.sha256, itemId, persistenceClient, preparedBatch.id]);

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
  const displayStatus = queueOwnsBatch && queueState ? queueItemLabel(queueState) : statusLabel(status);
  return (
    <li className={styles.card}>
      {thumbnailUrl ? <img className={styles.thumbnail} src={thumbnailUrl} alt={`Saved reference for Shot ${item.canonicalShotId}`} /> : <div className={styles.thumbnailPlaceholder} role="img" aria-label={`Saved reference preview unavailable for Shot ${item.canonicalShotId}`}>Reference preview</div>}
      <div className={styles.cardHeading}>
        <div><h4>Shot {item.canonicalShotId}</h4><span className={styles.status} data-status={queueOwnsBatch ? queueState : status}>{displayStatus}</span></div>
        <span className={styles.reference}>{item.reference.width}×{item.reference.height} · {item.reference.mimeType} · v{item.reference.assignmentVersion}</span>
      </div>
      {snapshot?.status === "attached" ? <p role="status" aria-live="polite">Reference uploaded and bound to the verified Google Vids document.</p> : null}
      {generation?.status === "retry_ready" ? <p role="status" aria-live="polite">The exact pre-click failure was reconciled. Generate has not been activated; submission remains a separate action.</p> : null}
      {queueOwnsBatch ? <p className={styles.queueItem}>Queue status · {queueState ? queueItemLabel(queueState) : "Queued"}. Per-Shot actions are disabled while the persisted Vids queue owns this batch.</p> : null}
      {snapshot?.status === "attached" && (generation?.status === "not_started" || generation?.status === "retry_ready") && !queueOwnsBatch ? <div className={styles.action}>
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
      {snapshot?.status === "not_started" && !queueOwnsBatch ? <div className={styles.action}>
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

function QueueClock({ queue, now }: { queue: VidsQueueSnapshot; now: number }) {
  const cooldown = queue.state === "cooldown" && queue.lastDispatchAt !== null;
  const readiness = queue.state === "checking_generate" && queue.readinessDeadlineAt !== null;
  if (!cooldown && !readiness) return <p className={styles.queueClock} role="status">{queue.state === "preparing" ? "Preparing next shot" : "Starting queue"}</p>;
  const start = cooldown ? queue.lastDispatchAt! : queue.readinessStartedAt ?? now;
  const deadline = cooldown ? start + 50_000 : queue.readinessDeadlineAt!;
  const duration = deadline - start;
  const remaining = Math.max(0, deadline - now);
  const elapsedPercent = Math.min(100, Math.max(0, ((duration - remaining) / duration) * 100));
  const formatted = `${String(Math.floor(remaining / 60_000)).padStart(2, "0")}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}`;
  return <div className={styles.clock}>
    <div className={styles.clockLabel}><span>{remaining === 0 ? (cooldown ? "Preparing next shot" : "Checking Generate availability") : `${cooldown ? "Next prompt in" : "Waiting for Generate"} ${formatted}`}</span><strong>{formatted}</strong></div>
    <div className={styles.progressTrack} role="progressbar" aria-label={cooldown ? "50-second dispatch interval" : "Generate readiness window"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(elapsedPercent)}><span style={{ width: `${elapsedPercent}%` }} /></div>
  </div>;
}

function queueStateLabel(state: string): string {
  switch (state) {
    case "ready": return "Ready";
    case "cooldown": return "Waiting for next shot";
    case "preparing": return "Preparing next shot";
    case "checking_generate": return "Checking Generate";
    case "paused": return "Paused";
    case "stopped": return "Stopped";
    case "blocked": return "Needs attention";
    case "all_sent": return "All prompts sent";
    default: return "Checking";
  }
}

function queueItemLabel(state: string): string {
  switch (state) {
    case "pending": return "Pending";
    case "transitioning": return "Preparing previous composer content";
    case "attaching": return "Attaching reference";
    case "entering_prompt": return "Entering prompt";
    case "checking_generate": return "Waiting for Generate";
    case "sending": return "Sending";
    case "sent": return "Sent";
    case "uncertain": return "Uncertain · no replay";
    case "blocked": return "Blocked";
    default: return state;
  }
}
