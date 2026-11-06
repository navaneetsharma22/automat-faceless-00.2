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
  const [selectionError, setSelectionError] = useState<string>();
  const [selectionNotice, setSelectionNotice] = useState<string>();
  const [downloadError, setDownloadError] = useState<string>();
  const [downloadNotice, setDownloadNotice] = useState<string>();
  const [statusError, setStatusError] = useState<string>();
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
        if (active) {
          setDownloadAttempt(attempt);
          setStatusError(undefined);
        }
      } catch {
        if (active) setStatusError("Vids download status is unavailable. Reconnect before starting another attempt.");
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
    setSelectionError(undefined);
    setSelectionNotice(undefined);
    try {
      if (source === "fallback") {
        const supplied = parseExpectedDocumentId(fallback);
        if (supplied.supplied && supplied.valid && supplied.fileId &&
          supplied.fileId !== document?.documentId && readiness) {
          await client.request("vids.timelineReady.invalidate", { expectedDocumentId: readiness.documentId });
          setReadiness(undefined);
          setOrderConfirmed(false);
          setSavedConfirmed(false);
          setSelectionNotice("The previous document’s timeline readiness was cleared.");
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
        setSelectionNotice("The previous document’s timeline readiness was cleared.");
      } else if (readiness && !readinessMatchesDocument(readiness, verified.documentId)) {
        await client.request("vids.timelineReady.invalidate", { expectedDocumentId: readiness.documentId });
        setReadiness(undefined);
        setOrderConfirmed(false);
        setSavedConfirmed(false);
      }
      setDocument(verified);
    } catch (cause) {
      setSelectionError(cause instanceof Error ? cause.message : "The connected Vids document could not be verified.");
    }
  }

  async function declareReady() {
    if (!document || !orderConfirmed || !savedConfirmed || !pendingGuard.current.begin()) return;
    setPending(true);
    setSelectionError(undefined);
    try {
      const value = await client.request("vids.timelineReady.declare", {
        documentId: document.documentId,
        canonicalTarget: document.canonicalTarget,
        tabId: document.tabId,
        sceneOrderConfirmed: true,
        documentSavedConfirmed: true,
      }) as VidsTimelineReadiness;
      setReadiness(value);
      setSelectionNotice("Timeline readiness recorded for this verified Vids document.");
    } catch (cause) {
      setSelectionError(cause instanceof Error ? cause.message : "Timeline readiness could not be recorded.");
    } finally {
      pendingGuard.current.end();
      setPending(false);
    }
  }

  async function armDownload() {
    setDownloadError(undefined);
    setDownloadNotice(undefined);
    try {
      if (typeof chrome === "undefined" || !chrome.permissions?.request) {
        throw new Error("Chrome downloads permission is unavailable in this extension context.");
      }
      const granted = await chrome.permissions.request({ permissions: ["downloads"] });
      if (!granted) throw new Error("Chrome downloads permission was not granted; no handoff was armed.");
      const attempt = await client.request("vids.download.arm", {}) as { attempt?: VidsDownloadAttempt };
      if (attempt.attempt) setDownloadAttempt(attempt.attempt);
      setDownloadNotice("Handoff armed. In the helper, select this same document and prepare its whole-timeline MP4.");
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : "The Vids download handoff could not be armed.");
    }
  }

  const isReady = Boolean(document && readinessMatchesDocument(readiness, document.documentId));
  const attemptState = downloadAttempt?.state;
  const downloadStateLabel = attemptState === "needs_review" ? "Needs review"
    : attemptState === "interrupted" ? "Interrupted"
      : attemptState === "dispatching" || attemptState === "downloading" ? "Downloading"
        : attemptState === "chrome_complete" ? "Chrome complete"
          : attemptState === "preparing_mp4" ? "Preparing MP4"
            : attemptState === "prepared" ? "Prepared"
              : !document ? "Choose a document" : !isReady ? "Timeline not ready" : "Ready";
  const canArm = isReady && (!downloadAttempt || downloadAttempt.state === "chrome_complete");
  const statusHelp = attemptState === "needs_review" ? "Check the helper and Chrome Downloads before taking another action. This attempt will not be replayed."
    : attemptState === "interrupted" ? "Chrome reports an interrupted download. It will not be restarted automatically."
      : attemptState === "dispatching" ? "Waiting for Chrome to return the exact download ID. This dispatch will not be replayed."
        : attemptState === "downloading" ? "Chrome is downloading the whole-timeline MP4."
          : attemptState === "chrome_complete" ? "Chrome reports completion. Playback and media properties have not been checked."
            : attemptState === "preparing_mp4" ? "The helper is preparing the whole document."
              : attemptState === "prepared" ? "The MP4 is prepared. Send its handoff once from the helper."
                : !document ? "Choose the connected document to continue."
                  : !isReady ? "Confirm the actual timeline order and saved state to enable download setup."
                    : "Ready after timeline attestation.";
  return <>
    <div className={styles.vidsWorkflowGrid}>
      <section className={`${styles.hostedHelperCard} ${styles.vidsDocumentCard}`} aria-labelledby="vids-document-heading">
        <header className={styles.vidsSectionHeading}>
          <div><span className={styles.vidsStep}>STEP 2</span><h3 id="vids-document-heading">Choose your Vids document</h3></div>
        </header>
        <p className={styles.vidsCardIntro}>Select the connected document or validate an ID against that same verified Vids connection.</p>
        <div className={styles.vidsDocumentActions}>
          <Button variant="secondary" onClick={() => void selectDocument("connected")}>Use connected Vids document</Button>
        </div>
        <div className={styles.vidsFallback}>
          <label className={styles.hostedHelperLabel} htmlFor="vids-document-fallback">Vids document URL or ID</label>
          <div className={styles.vidsFallbackRow}>
            <input id="vids-document-fallback" className={styles.vidsDocumentInput} value={fallback} onChange={(event) => setFallback(event.target.value)} autoComplete="url" placeholder="https://vids.google.com/video/your-document-id/edit" />
            <Button variant="secondary" onClick={() => void selectDocument("fallback")}>Validate document</Button>
          </div>
        </div>
        {document ? <section className={styles.vidsVerifiedDocument} aria-label="Verified Vids document">
          <div><span className={styles.hostedHelperLabel}>Verified document ID</span><code>{document.documentId}</code></div>
          <a href={document.canonicalTarget} target="_blank" rel="noreferrer noopener">Open Vids document</a>
        </section> : null}
        {document ? <div className={styles.vidsReadiness}>
          <div className={styles.vidsCardSubheading}><h4>Timeline readiness</h4><span>{isReady ? "User attested" : "Confirmation needed"}</span></div>
          <label><input type="checkbox" checked={orderConfirmed} onChange={(event) => setOrderConfirmed(event.target.checked)} /> I inserted the intended scenes and confirmed their complete timeline order.</label>
          <label><input type="checkbox" checked={savedConfirmed} onChange={(event) => setSavedConfirmed(event.target.checked)} /> I confirmed this exact Vids document is saved.</label>
          <div className={styles.vidsActionRow}><Button onClick={() => void declareReady()} disabled={!orderConfirmed || !savedConfirmed || pending}>{pending ? "Recording…" : "Timeline ready"}</Button></div>
          <p className={styles.vidsDisclosure}>This is your attestation for the whole timeline. The extension does not verify scene isolation.</p>
        </div> : null}
        {selectionNotice ? <p className={styles.vidsInlineNotice} role="status">{selectionNotice}</p> : null}
        {selectionError ? <p className={styles.vidsInlineError} role="alert">{selectionError}</p> : null}
      </section>

      <section className={`${styles.hostedHelperCard} ${styles.vidsDownloadCard}`} aria-labelledby="vids-download-heading">
        <header className={styles.vidsSectionHeading}>
          <div><span className={styles.vidsStep}>STEP 3</span><h3 id="vids-download-heading">Download MP4</h3></div>
          <span className={styles.vidsStateBadge} data-state={downloadStateLabel.toLowerCase().replaceAll(" ", "-")}>{downloadStateLabel}</span>
        </header>
        <p className={styles.vidsCardIntro} role="status">{statusHelp}</p>
        {downloadAttempt ? <dl className={styles.vidsDownloadFacts}>
          <div><dt>Attempt document</dt><dd><code>{downloadAttempt.documentId}</code></dd></div>
          <div><dt>Attempt ID</dt><dd><code>{downloadAttempt.attemptId}</code></dd></div>
          {downloadAttempt.downloadId !== undefined ? <div><dt>Chrome download ID</dt><dd><code>{downloadAttempt.downloadId}</code></dd></div> : null}
        </dl> : <p className={styles.vidsEmptyState}>No download attempt yet.</p>}
        {canArm ? <div className={styles.vidsActionRow}><Button onClick={() => void armDownload()}>Arm MP4 download</Button></div> : null}
        {downloadAttempt?.operationName ? <p className={styles.vidsInlineNotice} role="status">An existing Drive operation is recorded. Continue polling that operation in the helper; a timeout does not start another.</p> : null}
        {downloadAttempt?.state === "chrome_complete" ? <p className={styles.vidsCompletionNote}>Chrome completion is separate from playback and media-property verification.</p> : null}
        {downloadNotice ? <p className={styles.vidsInlineNotice} role="status">{downloadNotice}</p> : null}
        {statusError ? <p className={styles.vidsInlineError} role="alert">{statusError}</p> : null}
        {downloadError ? <p className={styles.vidsInlineError} role="alert">{downloadError}</p> : null}
        <p className={styles.vidsDestination}>Destination: Chrome’s configured Downloads location.</p>
      </section>
    </div>
    <SplitHandoff attempt={downloadAttempt} />
  </>;
}
