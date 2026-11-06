import { useEffect, useRef, useState } from "react";
import type { createFoundationClient } from "../../../shared/messageClient";
import { parseExpectedDocumentId, readinessMatchesDocument, createSubmissionGuard, type VidsDownloadAttempt, type VidsTimelineReadiness } from "../../../domain/media/combinedExport";
import { parseProviderRoute } from "../../../platforms/shared/providerRoute";
import { Button } from "../../components/Button";
import styles from "../../Dashboard.module.css";
import { SplitHandoff } from "./SplitHandoff";

type Client = ReturnType<typeof createFoundationClient>;
type DocumentBinding = { documentId: string; canonicalTarget: string; tabId: number };

export function VidsTimelineReady({ client }: { client: Client }) {
  const [fallback, setFallback] = useState("");
  const [document, setDocument] = useState<DocumentBinding>();
  const [readiness, setReadiness] = useState<VidsTimelineReadiness>();
  const [downloadAttempt, setDownloadAttempt] = useState<VidsDownloadAttempt>();
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const pendingGuard = useRef(createSubmissionGuard());

  useEffect(() => {
    let active = true;
    void client.request("vids.timelineReady.get", {}).then((value) => {
      if (active && value && typeof value === "object") setReadiness(value as VidsTimelineReadiness);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    let active = true;
    let checking = false;
    const refresh = async () => {
      if (checking) return;
      checking = true;
      try {
        const attempt = await client.request("vids.download.get", {}) as VidsDownloadAttempt | undefined;
        if (active) setDownloadAttempt(attempt);
      } catch {
        if (active) setError("Vids download status is unavailable. Reconnect before starting another attempt.");
      } finally {
        checking = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [client]);

  async function readConnectedDocument(): Promise<DocumentBinding> {
    const result = await client.request("connections.revalidate", { provider: "Vids", enableReconnect: false }) as {
      ok?: boolean; state?: string; tab?: { id?: number; canonicalTarget?: string; provider?: string; projectId?: string };
    };
    const selection = await client.request("connections.getSelection", { provider: "Vids" }) as {
      tabId?: number; canonicalTarget?: string; verification?: string; connectionState?: string;
      verificationBinding?: { provider?: string; tabId?: number; canonicalTarget?: string; projectId?: string };
    } | null;
    const route = parseProviderRoute(result?.tab?.canonicalTarget ?? "");
    const binding = selection?.verificationBinding;
    if (!result?.ok || result.state !== "verified" || !result.tab || result.tab.provider !== "Vids" ||
      !route || route.provider !== "Vids" || route.projectId !== result.tab.projectId ||
      !selection || selection.verification !== "verified" || selection.connectionState !== "verified" ||
      selection.tabId !== result.tab.id || selection.canonicalTarget !== route.canonicalTarget ||
      !binding || binding.provider !== "Vids" || binding.tabId !== result.tab.id ||
      binding.canonicalTarget !== route.canonicalTarget || binding.projectId !== route.projectId) {
      throw new Error("No currently verified Vids document is connected. Connect its Vids tab and retry.");
    }
    return { documentId: route.projectId, canonicalTarget: route.canonicalTarget, tabId: result.tab.id! };
  }

  async function selectDocument(source: "connected" | "fallback") {
    setError(undefined);
    setNotice(undefined);
    try {
      if (source === "fallback") {
        const supplied = parseExpectedDocumentId(fallback);
        if (supplied.supplied && supplied.valid && supplied.fileId &&
          supplied.fileId !== document?.documentId && readiness) {
          await client.request("vids.timelineReady.invalidate", { expectedDocumentId: readiness.documentId });
          setReadiness(undefined);
          setOrderConfirmed(false);
          setSavedConfirmed(false);
          setNotice("The previous document’s timeline readiness was cleared.");
        }
      }
      const verified = await readConnectedDocument();
      if (source === "fallback") {
        const parsed = parseExpectedDocumentId(fallback);
        if (!parsed.supplied || !parsed.valid || !parsed.fileId) throw new Error("Enter a valid HTTPS Vids document URL or document ID.");
        if (parsed.fileId !== verified.documentId) throw new Error("That document does not match the currently verified Vids connection.");
      }
      if (document && document.documentId !== verified.documentId) {
        await client.request("vids.timelineReady.invalidate", { expectedDocumentId: document.documentId });
        setReadiness(undefined);
        setOrderConfirmed(false);
        setSavedConfirmed(false);
        setNotice("The previous document’s timeline readiness was cleared.");
      } else if (readiness && !readinessMatchesDocument(readiness, verified.documentId)) {
        await client.request("vids.timelineReady.invalidate", { expectedDocumentId: readiness.documentId });
        setReadiness(undefined);
        setOrderConfirmed(false);
        setSavedConfirmed(false);
      }
      setDocument(verified);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The connected Vids document could not be verified.");
    }
  }

  async function declareReady() {
    if (!document || !orderConfirmed || !savedConfirmed || !pendingGuard.current.begin()) return;
    setPending(true);
    setError(undefined);
    try {
      const value = await client.request("vids.timelineReady.declare", {
        documentId: document.documentId,
        canonicalTarget: document.canonicalTarget,
        tabId: document.tabId,
        sceneOrderConfirmed: true,
        documentSavedConfirmed: true,
      }) as VidsTimelineReadiness;
      setReadiness(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Timeline readiness could not be recorded.");
    } finally {
      pendingGuard.current.end();
      setPending(false);
    }
  }

  async function armDownload() {
    setError(undefined);
    try {
      if (typeof chrome === "undefined" || !chrome.permissions?.request) {
        throw new Error("Chrome downloads permission is unavailable in this extension context.");
      }
      const granted = await chrome.permissions.request({ permissions: ["downloads"] });
      if (!granted) throw new Error("Chrome downloads permission was not granted; no handoff was armed.");
      const attempt = await client.request("vids.download.arm", {}) as { attempt?: VidsDownloadAttempt };
      if (attempt.attempt) setDownloadAttempt(attempt.attempt);
      setNotice("Handoff armed for this verified document. In the existing helper, use the same expected document ID and start Prepare MP4 Download. Preparation and download are separate states.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Vids download handoff could not be armed.");
    }
  }

  const isReady = Boolean(document && readinessMatchesDocument(readiness, document.documentId));
  const downloadStateLabel = !isReady ? "Timeline not ready" : downloadAttempt?.state === "preparing_mp4" ? "Preparing MP4"
    : downloadAttempt?.state === "prepared" ? "Prepared"
      : downloadAttempt?.state === "dispatching" ? "Downloading"
        : downloadAttempt?.state === "downloading" ? "Downloading"
          : downloadAttempt?.state === "chrome_complete" ? "Chrome complete"
            : downloadAttempt?.state === "interrupted" ? "Interrupted"
              : downloadAttempt?.state === "needs_review" ? "Needs review"
                : "Ready";
  const canArm = isReady && (!downloadAttempt || downloadAttempt.state === "chrome_complete");
  return <article className={styles.hostedHelperCard}>
    <h3>Prepare the Vids timeline manually</h3>
    <p>Insert the intended scenes in Vids, confirm their full timeline order, and save the document. This declaration records your attestation for the whole timeline; the extension does not verify scene isolation.</p>
    <div className={styles.actionRow}>
      <Button variant="secondary" onClick={() => void selectDocument("connected")}>Use connected Vids document</Button>
    </div>
    <label className={styles.hostedHelperLabel} htmlFor="vids-document-fallback">Vids document URL or ID</label>
    <div className={styles.actionRow}>
      <input id="vids-document-fallback" value={fallback} onChange={(event) => setFallback(event.target.value)} autoComplete="off" />
      <Button variant="secondary" onClick={() => void selectDocument("fallback")}>Validate document</Button>
    </div>
    {document ? <section aria-label="Verified Vids document">
      <h4>Current verified document</h4>
      <p>Document ID: <code>{document.documentId}</code></p>
      <a href={document.canonicalTarget} target="_blank" rel="noreferrer noopener">Open this Vids document</a>
    </section> : null}
    {document ? <div className={styles.connectionAdvancedContent}>
      <label><input type="checkbox" checked={orderConfirmed} onChange={(event) => setOrderConfirmed(event.target.checked)} /> I inserted the intended scenes and confirmed their complete timeline order.</label>
      <label><input type="checkbox" checked={savedConfirmed} onChange={(event) => setSavedConfirmed(event.target.checked)} /> I confirmed this exact Vids document is saved.</label>
      <Button onClick={() => void declareReady()} disabled={!orderConfirmed || !savedConfirmed || pending}>{pending ? "Recording…" : "Timeline ready"}</Button>
    </div> : null}
    {isReady ? <p role="status">User attested timeline readiness for document <code>{readiness!.documentId}</code> at {new Date(readiness!.attestedAt).toLocaleString()}.</p> : null}
    <section aria-label="Vids MP4 download handoff">
      <h4>Whole-timeline MP4</h4>
      <p role="status"><strong>{downloadStateLabel}</strong>{downloadAttempt ? <> · document <code>{downloadAttempt.documentId}</code> · attempt <code>{downloadAttempt.attemptId}</code>{downloadAttempt.downloadId !== undefined ? <> · Chrome download ID <code>{downloadAttempt.downloadId}</code></> : null}</> : null}</p>
      {canArm ? <Button variant="secondary" onClick={() => void armDownload()}>Arm prepared MP4 handoff</Button> : null}
      {downloadAttempt?.operationName ? <p>Existing Drive operation is recorded. Continue polling it in the helper; a timeout does not start a replacement operation.</p> : null}
      <p>After arming, prepare the MP4 in the existing hosted helper and send its validated handoff once. Chrome saves using its configured Downloads destination; collision naming uses Chrome’s uniquify behavior. No extension-owned folder picker is provided.</p>
      {downloadAttempt?.state === "chrome_complete" ? <p>Chrome reports that the download completed. Playback and media properties have not been verified.</p> : null}
      {downloadAttempt?.state === "interrupted" ? <p>Chrome reports an interrupted download. Review Chrome Downloads; this handoff will not automatically restart it.</p> : null}
      {downloadAttempt?.state === "dispatching" ? <p>Waiting for Chrome to return the exact download ID. This dispatch will not be replayed.</p> : null}
      {downloadAttempt?.state === "needs_review" ? <p>Outcome needs review. Check Chrome Downloads and the existing helper before starting another operation. No automatic replay is available.</p> : null}
    </section>
    <SplitHandoff attempt={downloadAttempt} />
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </article>;
}
