import { useState } from "react";
import type { VidsDownloadAttempt } from "../../../domain/media/combinedExport";
import { Button } from "../../components/Button";
import styles from "../../Dashboard.module.css";
import { SceneManifest } from "./SceneManifest";

export function SplitHandoff({ attempt }: { attempt?: VidsDownloadAttempt }) {
  const [open, setOpen] = useState(false);
  const isComplete = attempt?.state === "chrome_complete" && attempt.downloadId !== undefined;
  return <article className={styles.hostedHelperCard} aria-labelledby="vids-split-handoff-heading">
    <h3 id="vids-split-handoff-heading">Split downloaded video</h3>
    <p>Splitting is a separate, user-launched Windows step. This extension cannot run local FFmpeg and does not start the companion.</p>
    {isComplete && attempt ? <>
      <dl className={styles.sceneDownloadRecord}>
        <div><dt>Combined source</dt><dd>{attempt.sourcePath ? <code>{attempt.sourcePath}</code> : "Chrome’s completed download; choose the exact combined MP4 in the companion."}</dd></div>
        <div><dt>Vids document</dt><dd><code>{attempt.documentId}</code></dd></div>
        <div><dt>Download attempt</dt><dd><code>{attempt.attemptId}</code></dd></div>
        <div><dt>Chrome download ID</dt><dd><code>{attempt.downloadId}</code></dd></div>
      </dl>
      <p><strong>Download destination:</strong> Chrome’s configured Downloads location above. <strong>Split destination:</strong> choose a separate parent folder in the Windows companion; it creates a new unique VidsSplit folder there.</p>
      <Button variant="secondary" onClick={() => setOpen((value) => !value)}>{open ? "Close split handoff" : "Split downloaded video"}</Button>
      {open ? <>
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
            <li>Review and export the explicit boundary manifest above.</li>
            <li>Launch <code>tools/local-mp4-splitter/Run-Local-Vids-Split.cmd</code> from this project folder.</li>
            <li>Select the combined MP4 associated with Chrome download ID <code>{attempt.downloadId}</code>, then select the exported manifest.</li>
            <li>Select a separate parent for split outputs. The companion creates a new folder and refuses existing output names.</li>
            <li>Review <code>verification-results.json</code> for frame count, duration, and audio verification.</li>
          </ol>
          <p>The combined source is retained. The extension does not know the selected output parent or claim that local splitting completed until you inspect the companion results.</p>
        </section>
      </> : null}
    </> : <p role="status">Available after Chrome reports the intended whole-timeline MP4 download complete. A completed download alone does not verify playback or media properties.</p>}
  </article>;
}
