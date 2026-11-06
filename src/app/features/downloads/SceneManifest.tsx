import { useState } from "react";
import type { SceneBoundaryClip, SceneBoundaryDownloadRecord, SceneBoundaryManifest } from "../../../domain/media/sceneManifest";
import { createSceneBoundaryManifest, serializeSceneBoundaryManifest } from "../../../domain/media/sceneManifest";
import { Button } from "../../components/Button";
import styles from "../../Dashboard.module.css";

type Entry = { key: string; name: string; startFrameIndex: string; endFrameIndexExclusive: string; startSeconds: string; endSeconds: string };

function emptyEntry(): Entry {
  return { key: crypto.randomUUID(), name: "", startFrameIndex: "", endFrameIndexExclusive: "", startSeconds: "", endSeconds: "" };
}

function parseEntry(entry: Entry): SceneBoundaryClip | undefined {
  if (!entry.name.trim() || [entry.startFrameIndex, entry.endFrameIndexExclusive, entry.startSeconds, entry.endSeconds].some((value) => !value.trim())) return undefined;
  const startFrameIndex = Number(entry.startFrameIndex);
  const endFrameIndexExclusive = Number(entry.endFrameIndexExclusive);
  const startSeconds = Number(entry.startSeconds);
  const endSeconds = Number(entry.endSeconds);
  if (![startFrameIndex, endFrameIndexExclusive].every(Number.isInteger) || ![startSeconds, endSeconds].every(Number.isFinite)) return undefined;
  return { name: entry.name.trim(), startFrameIndex, endFrameIndexExclusive, startSeconds, endSeconds };
}

export function SceneManifest({ source }: { source: SceneBoundaryDownloadRecord }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [timelineAttested, setTimelineAttested] = useState(false);
  const [timestampsAttested, setTimestampsAttested] = useState(false);
  const [error, setError] = useState<string>();

  function updateEntry(key: string, field: keyof Omit<Entry, "key">, value: string) {
    setEntries((current) => current.map((entry) => entry.key === key ? { ...entry, [field]: value } : entry));
  }

  function moveEntry(index: number, offset: number) {
    setEntries((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function makeManifest(): SceneBoundaryManifest {
    if (entries.length === 0) throw new Error("Add each intended scene in actual edited timeline order.");
    const clips = entries.map(parseEntry);
    if (clips.some((clip) => !clip)) throw new Error("Fill in a name, start/end source frame indices, and start/end source timestamps for every scene.");
    return createSceneBoundaryManifest(source, clips as SceneBoundaryClip[], {
      actualTimelineOrder: timelineAttested,
      sourceFrameTimestamps: timestampsAttested,
    });
  }

  function exportManifest() {
    setError(undefined);
    try {
      const manifest = makeManifest();
      const blob = new Blob([serializeSceneBoundaryManifest(manifest)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `vids-scene-boundaries-${source.documentId}-${source.attemptId}.json`;
      anchor.rel = "noopener noreferrer";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The scene-boundary manifest could not be exported.");
    }
  }

  return <section aria-label="Scene boundary manifest" className={styles.sceneManifest}>
    <h4>Scene boundary manifest</h4>
    <p>Enter every boundary from the actual edited timeline and source MP4 frame timestamps. Frame indices are zero-based; each range includes its start frame and excludes its end frame. Gaps are allowed. The companion checks the timestamp/frame match against the selected MP4 before encoding.</p>
    <p>Each scene entry requires an output name, start frame index, exclusive end frame index, start timestamp, and end timestamp.</p>
    <p>Manifest source: document <code>{source.documentId}</code> · attempt <code>{source.attemptId}</code> · Chrome download ID <code>{source.downloadId}</code>{source.sourcePath ? <> · source path <code>{source.sourcePath}</code></> : null}</p>
    {entries.map((entry, index) => <fieldset className={styles.sceneBoundaryRow} key={entry.key}>
      <legend>Edited timeline scene {index + 1}</legend>
      <label className={styles.sceneBoundaryField}>Output name
        <input value={entry.name} maxLength={64} onChange={(event) => updateEntry(entry.key, "name", event.target.value)} autoComplete="off" placeholder="Scene file name" />
      </label>
      <label className={styles.sceneBoundaryField}>Start frame index
        <input type="number" min="0" step="1" value={entry.startFrameIndex} onChange={(event) => updateEntry(entry.key, "startFrameIndex", event.target.value)} />
      </label>
      <label className={styles.sceneBoundaryField}>End frame index (exclusive)
        <input type="number" min="1" step="1" value={entry.endFrameIndexExclusive} onChange={(event) => updateEntry(entry.key, "endFrameIndexExclusive", event.target.value)} />
      </label>
      <label className={styles.sceneBoundaryField}>Start timestamp (seconds)
        <input type="number" min="0" step="any" value={entry.startSeconds} onChange={(event) => updateEntry(entry.key, "startSeconds", event.target.value)} />
      </label>
      <label className={styles.sceneBoundaryField}>End timestamp (seconds)
        <input type="number" min="0" step="any" value={entry.endSeconds} onChange={(event) => updateEntry(entry.key, "endSeconds", event.target.value)} />
      </label>
      <div className={styles.sceneBoundaryActions}>
        <Button variant="quiet" size="compact" disabled={index === 0} onClick={() => moveEntry(index, -1)}>Move earlier</Button>
        <Button variant="quiet" size="compact" disabled={index === entries.length - 1} onClick={() => moveEntry(index, 1)}>Move later</Button>
        <Button variant="quiet" size="compact" onClick={() => setEntries((current) => current.filter((candidate) => candidate.key !== entry.key))}>Remove scene</Button>
      </div>
    </fieldset>)}
    <div className={styles.actionRow}>
      <Button variant="secondary" onClick={() => setEntries((current) => [...current, emptyEntry()])}>Add scene boundary</Button>
      <Button onClick={exportManifest} disabled={!timelineAttested || !timestampsAttested || entries.length === 0}>Export boundary manifest</Button>
    </div>
    <div className={styles.sceneManifestAttestations}>
      <label><input type="checkbox" checked={timelineAttested} onChange={(event) => setTimelineAttested(event.target.checked)} /> I checked these scenes against the actual edited Vids timeline and entered them in that order.</label>
      <label><input type="checkbox" checked={timestampsAttested} onChange={(event) => setTimestampsAttested(event.target.checked)} /> I measured each boundary from source MP4 frame timestamps, not prompt count or an assumed scene duration.</label>
    </div>
    <p>Exporting downloads only the JSON manifest to Chrome’s configured Downloads destination. The companion’s split output parent is selected separately.</p>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
