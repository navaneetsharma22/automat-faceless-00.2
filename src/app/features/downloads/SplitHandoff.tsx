import type { VidsDownloadAttempt } from "../../../domain/media/combinedExport";
import styles from "../../Dashboard.module.css";
import { SceneManifest } from "./SceneManifest";

export function SplitHandoff({ attempt }: { attempt?: VidsDownloadAttempt }) {
  const isComplete = attempt?.state === "chrome_complete" && attempt.downloadId !== undefined;
  const summary = <summary className={styles.vidsSplitSummary}>
    <span><span className={styles.vidsStep}>STEP 4</span><strong>Split downloaded video</strong></span>
    <span className={styles.vidsSplitStatus}>{isComplete ? "Ready" : "Available after Chrome completes the MP4"}</span>
  </summary>;
  if (!isComplete || !attempt) return <section className={styles.vidsSplitUnavailable} aria-label="Split downloaded video unavailable">
    <div className={styles.vidsSplitSummary}>
      <span><span className={styles.vidsStep}>STEP 4</span><strong>Split downloaded video</strong></span>
      <span className={styles.vidsSplitStatus}>Available after Chrome completes the MP4</span>
    </div>
  </section>;
  return <details className={styles.vidsSplitSection}>
    {summary}
    <div className={styles.vidsSplitContent}>
      <dl className={styles.sceneDownloadRecord}>
        <div><dt>Combined source</dt><dd>{attempt.sourcePath ? <code>{attempt.sourcePath}</code> : "Chrome’s completed download; choose the exact combined MP4 in the companion."}</dd></div>
        <div><dt>Vids document</dt><dd><code>{attempt.documentId}</code></dd></div>
        <div><dt>Download attempt</dt><dd><code>{attempt.attemptId}</code></dd></div>
        <div><dt>Chrome download ID</dt><dd><code>{attempt.downloadId}</code></dd></div>
      </dl>
      <p className={styles.vidsDestination}>Chrome’s Downloads location is separate from the split destination you select in the Windows companion.</p>
      <SceneManifest key={`${attempt.attemptId}:${attempt.downloadId}`} source={{
        provider: "Vids",
        documentId: attempt.documentId,
        attemptId: attempt.attemptId,
        downloadId: attempt.downloadId!,
        state: "chrome_complete",
        sourcePath: attempt.sourcePath,
      }} />
      <section className={styles.sceneCompanionSteps} aria-label="Windows splitter steps">
        <h4>Run the Windows companion yourself</h4>
        <ol>
          <li>Export the split settings for duration mode or the measured boundary manifest.</li>
          <li>Launch <code>tools/local-mp4-splitter/Run-Local-Vids-Split.cmd</code> from this project folder.</li>
          <li>Select the combined MP4 for Chrome download ID <code>{attempt.downloadId}</code>, then select the manifest.</li>
          <li>Select a separate parent for split outputs. The companion creates a new folder and refuses existing output names.</li>
          <li>Review <code>verification-results.json</code> for frame count, duration, and audio verification.</li>
        </ol>
        <p>The combined source is retained. The extension does not run FFmpeg or know the output parent selected in the companion.</p>
      </section>
    </div>
  </details>;
}
