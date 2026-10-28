import { useEffect, useState } from "react";
import { Button } from "./components/Button";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { JsonEditor } from "./components/JsonEditor";
import { Navigation, type Workspace } from "./components/Navigation";
import { Notice } from "./components/Notice";
import { ProgressPanel } from "./components/ProgressPanel";
import { SettingsConfirmation } from "./components/SettingsConfirmation";
import { ToastHost, useToast } from "./components/ToastHost";
import { BUILD_ID } from "../shared/buildInfo";
import styles from "./Dashboard.module.css";
import {
  type DownloadPreviewState,
  type PromptDrafts,
  updatePromptDrafts,
} from "./previewState";

const demoJson = `{
  "batch": "DEMO ONLY — synthetic image prompts",
  "prompts": [
${Array.from({ length: 28 }, (_, index) => `    { "shot_id": "SHOT-${String(index + 1).padStart(3, "0")}", "prompt": "Illustrative long prompt ${index + 1}: cinematic studio portrait, soft window light, natural detail, composed for a 16:9 frame." }`).join(",\n")}
  ]
}`;

const demoVideoJson = `{
  "batch": "DEMO ONLY — synthetic video prompts",
  "prompts": [
${Array.from({ length: 18 }, (_, index) => `    { "shot_id": "SHOT-${String(index + 1).padStart(3, "0")}", "prompt": "Independent example video prompt ${index + 1}: slow cinematic camera drift, natural motion, soft environmental light, preserve subject identity." }`).join(",\n")}
  ]
}`;

const demoRows = [
  { label: "SHOT-001", detail: "Example · ready", value: 100 },
  { label: "SHOT-002", detail: "Example · in progress", value: 62 },
  { label: "SHOT-003", detail: "Example · waiting", value: 0 },
];

const referenceCards = [
  { id: "SHOT-001", title: "Studio portrait", tone: "warm" },
  { id: "SHOT-002", title: "Rainy street", tone: "cool" },
  { id: "SHOT-004", title: "Empty reference", tone: "empty" },
];

function Dashboard() {
  const [workspace, setWorkspace] = useState<Workspace>("Images");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [promptDrafts, setPromptDrafts] = useState<PromptDrafts>({
    images: demoJson,
    videos: demoVideoJson,
  });
  const [videoWrapLines, setVideoWrapLines] = useState(false);
  const [videoEditorExpanded, setVideoEditorExpanded] = useState(false);
  const [downloadPreview, setDownloadPreview] =
    useState<DownloadPreviewState>("empty");
  const [imageConfirmed, setImageConfirmed] = useState(false);
  const [videoConfirmed, setVideoConfirmed] = useState(false);
  const [destination, setDestination] = useState<"Flow" | "Vids">("Flow");
  const [selectedReferences, setSelectedReferences] = useState<string[]>([
    "SHOT-001",
  ]);
  const toast = useToast();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleReference = (id: string) => {
    setSelectedReferences((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    toast.add({
      kind: "info",
      message:
        "Demo reference selection updated. No image was captured or assigned.",
      urgent: false,
      actionable: false,
    });
  };

  const updatePrompt = (workspace: keyof PromptDrafts, value: string) => {
    setPromptDrafts((current) => updatePromptDrafts(current, workspace, value));
  };

  return (
    <main className={styles.appShell}>
      <aside className={styles.sidebar}>
        <a
          className={styles.brand}
          href="#workspace"
          aria-label="Automat Faceless home"
        >
          <span className={styles.brandMark} aria-hidden="true">
            A
          </span>
          <span>
            <strong>Automat</strong>
            <small>FACELESS STUDIO</small>
          </span>
        </a>
        <p className={styles.navLabel}>WORKSPACE</p>
        <Navigation active={workspace} onSelect={setWorkspace} />
        <ConnectionStatus />
      </aside>

      <section className={styles.mainArea} id="workspace">
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            <span>Studio</span>
            <span aria-hidden="true">/</span>
            <strong>{workspace}</strong>
          </div>
          <div className={styles.topActions}>
            <span className={styles.previewLabel}>
              <span aria-hidden="true">●</span> PREVIEW MODE
            </span>
            <button
              className={`${styles.themeToggle} motion-control`}
              type="button"
              onClick={() =>
                setTheme((current) => (current === "light" ? "dark" : "light"))
              }
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            >
              <span aria-hidden="true">{theme === "light" ? "◐" : "☼"}</span>
              {theme === "light" ? "Dark" : "Light"}
            </button>
          </div>
        </header>

        <div
          className={`${styles.content} motion-screen-enter`}
          key={workspace}
        >
          <div className={styles.pageHeading}>
            <div>
              <p className={styles.kicker}>CREATIVE WORKSPACE</p>
              <h1>{workspace}</h1>
              <p className={styles.lede}>{workspaceSubtitle(workspace)}</p>
            </div>
          </div>
          {workspace === "Images" ? (
            <ImagesView
              imageJson={promptDrafts.images}
              setImageJson={(value) => updatePrompt("images", value)}
              confirmed={imageConfirmed}
              setConfirmed={setImageConfirmed}
            />
          ) : null}
          {workspace === "References" ? (
            <ReferencesView
              selected={selectedReferences}
              onToggle={toggleReference}
            />
          ) : null}
          {workspace === "Videos" ? (
            <VideosView
              videoJson={promptDrafts.videos}
              setVideoJson={(value) => updatePrompt("videos", value)}
              wrapLines={videoWrapLines}
              setWrapLines={setVideoWrapLines}
              editorExpanded={videoEditorExpanded}
              setEditorExpanded={setVideoEditorExpanded}
              destination={destination}
              setDestination={setDestination}
              confirmed={videoConfirmed}
              setConfirmed={setVideoConfirmed}
            />
          ) : null}
          {workspace === "Downloads" ? (
            <DownloadsView
              state={downloadPreview}
              onStateChange={setDownloadPreview}
            />
          ) : null}
          <details className={styles.advanced}>
            <summary>
              Advanced details <span>Technical preview information</span>
            </summary>
            <div className={styles.advancedContent}>
              <p>
                Workspace assets and progress remain P01.3 demo data. The
                connection panel is the source of current read-only target
                status; it does not indicate generation capability.
              </p>
              <dl>
                <div>
                  <dt>Build state</dt>
                  <dd>{BUILD_ID}</dd>
                </div>
                <div>
                  <dt>Provider actions</dt>
                  <dd>Generation unavailable</dd>
                </div>
              </dl>
            </div>
          </details>
        </div>
      </section>
    </main>
  );
}

function workspaceSubtitle(workspace: Workspace) {
  return {
    Images: "Prepare an image prompt batch and review its example progress.",
    References: "Review example image selections by their stable shot IDs.",
    Videos: "Inspect example image-to-video pairs and destination choices.",
    Downloads: "Review example delivery states in one calm workspace.",
  }[workspace];
}

function ImagesView({
  imageJson,
  setImageJson,
  confirmed,
  setConfirmed,
}: {
  imageJson: string;
  setImageJson: (value: string) => void;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
}) {
  const [wrapLines, setWrapLines] = useState(false);
  const [editorExpanded, setEditorExpanded] = useState(false);

  return (
    <div className={styles.workspaceGrid}>
      <section
        className={`${styles.panel} ${styles.editorPanel}`}
        aria-labelledby="image-input-title"
      >
        <PanelHeader
          kicker="IMAGE BATCH · DEMO"
          title="Prompt input"
          id="image-input-title"
        />
        <JsonEditor
          id="image-demo-json"
          label="Image prompt JSON"
          value={imageJson}
          onChange={setImageJson}
          rows={6}
          wrapLines={wrapLines}
          onWrapLinesChange={setWrapLines}
          expanded={editorExpanded}
          onExpandedChange={setEditorExpanded}
        />
        <SettingsConfirmation
          id="image-settings-confirm"
          provider="Flow"
          contextLabel="demo image batch"
          checked={confirmed}
          onChange={setConfirmed}
        />
        <div className={styles.actionRow}>
          <Button disabled aria-describedby="image-disabled-reason">
            Start image batch
          </Button>
          <p id="image-disabled-reason" className={styles.disabledReason}>
            Unavailable: provider connection and image workflow are not
            implemented.
          </p>
        </div>
      </section>
      <ProgressPanel items={demoRows} />
    </div>
  );
}

function ReferencesView({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className={styles.workspaceGrid}>
      <section className={styles.panel} aria-labelledby="references-title">
        <PanelHeader
          kicker="REFERENCE LIBRARY · DEMO"
          title="Shot references"
          id="references-title"
        />
        <div className={styles.referenceGrid}>
          {referenceCards.map((card) => {
            const isSelected = selected.includes(card.id);
            return (
              <button
                key={card.id}
                type="button"
                className={`${styles.referenceCard} ${styles[`reference${card.tone[0].toUpperCase()}${card.tone.slice(1)}`]} ${isSelected ? styles.referenceSelected : ""} motion-card`}
                aria-pressed={isSelected}
                onClick={() => onToggle(card.id)}
              >
                <span className={styles.referenceImage} aria-hidden="true">
                  {card.tone === "empty"
                    ? "+"
                    : card.tone === "warm"
                      ? "01"
                      : "02"}
                </span>
                <span className={styles.shotId}>{card.id}</span>
                <strong>{card.title}</strong>
                <span className={styles.referenceState}>
                  {isSelected
                    ? "Selected · demo"
                    : card.tone === "empty"
                      ? "No image · demo"
                      : "Available · demo"}
                </span>
              </button>
            );
          })}
        </div>
        <div className={styles.actionRow}>
          <Button disabled aria-describedby="reference-disabled-reason">
            Confirm references
          </Button>
          <p id="reference-disabled-reason" className={styles.disabledReason}>
            Unavailable: reference capture and assignment are not implemented.
          </p>
        </div>
      </section>
      <ProgressPanel
        items={[
          { label: "SHOT-001", detail: "Example · selected", value: 100 },
          { label: "SHOT-002", detail: "Example · available", value: 0 },
        ]}
      />
    </div>
  );
}

export function VideosView({
  videoJson,
  setVideoJson,
  wrapLines,
  setWrapLines,
  editorExpanded,
  setEditorExpanded,
  destination,
  setDestination,
  confirmed,
  setConfirmed,
}: {
  videoJson: string;
  setVideoJson: (value: string) => void;
  wrapLines: boolean;
  setWrapLines: (wrap: boolean) => void;
  editorExpanded: boolean;
  setEditorExpanded: (expanded: boolean) => void;
  destination: "Flow" | "Vids";
  setDestination: (value: "Flow" | "Vids") => void;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
}) {
  return (
    <div className={styles.workspaceGrid}>
      <section className={styles.panel} aria-labelledby="video-pair-title">
        <PanelHeader
          kicker="VIDEO BATCH · DEMO"
          title="Video prompt JSON"
          id="video-input-title"
        />
        <JsonEditor
          id="video-demo-json"
          label="Video prompt JSON"
          value={videoJson}
          onChange={setVideoJson}
          rows={6}
          wrapLines={wrapLines}
          onWrapLinesChange={setWrapLines}
          expanded={editorExpanded}
          onExpandedChange={setEditorExpanded}
        />
        <Notice kind="info" announce={false}>
          UI preview only. Editing does not parse, pair, submit, or generate
          anything.
        </Notice>
        <section
          className={styles.pairPreview}
          aria-labelledby="video-pairs-demo-title"
        >
          <div className={styles.pairPreviewHeading}>
            <p className={styles.kicker}>INDEPENDENT DEMO DATA</p>
            <h3 id="video-pairs-demo-title">Pairing examples</h3>
          </div>
          <div className={styles.pairList}>
            <PairRow
              id="SHOT-001"
              image="Image SHOT-001 · demo"
              prompt="Video prompt SHOT-001 · demo"
              state="Matched example"
            />
            <PairRow
              id="SHOT-002"
              image="Image SHOT-003 · demo"
              prompt="Video prompt SHOT-002 · demo"
              state="Shot ID mismatch · demo error"
              error
            />
            <PairRow
              id="SHOT-003"
              image="No image · demo"
              prompt="Video prompt SHOT-003 · demo"
              state="Missing image · demo error"
              error
            />
          </div>
        </section>
        <fieldset className={styles.destinationGroup}>
          <legend>
            Video destination <span>Choose one for this demo</span>
          </legend>
          <div className={styles.destinationOptions}>
            {(["Flow", "Vids"] as const).map((item) => (
              <label
                className={`${styles.destinationOption} ${destination === item ? styles.destinationSelected : ""} motion-card`}
                key={item}
              >
                <input
                  type="radio"
                  name="video-destination"
                  value={item}
                  checked={destination === item}
                  onChange={() => setDestination(item)}
                />
                <span>
                  <strong>{item}</strong>
                  <small>
                    {item === "Flow" ? "Not connected" : "Not connected"}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <SettingsConfirmation
          id="video-settings-confirm"
          provider={destination}
          contextLabel="demo video batch"
          checked={confirmed}
          onChange={setConfirmed}
        />
        <Notice kind="error" announce={false}>
          Example pairing errors remain visible. Resolve shot IDs before a real
          batch can be available.
        </Notice>
        <div className={styles.actionRow}>
          <Button disabled aria-describedby="video-disabled-reason">
            Start video batch
          </Button>
          <p id="video-disabled-reason" className={styles.disabledReason}>
            Unavailable: video pairing and provider workflows are not
            implemented.
          </p>
        </div>
      </section>
      <ProgressPanel
        items={[
          { label: "SHOT-001", detail: "Example · pair matched", value: 100 },
          { label: "SHOT-002", detail: "Example · ID mismatch", value: 0 },
          { label: "SHOT-003", detail: "Example · missing image", value: 0 },
        ]}
      />
    </div>
  );
}

function PairRow({
  id,
  image,
  prompt,
  state,
  error = false,
}: {
  id: string;
  image: string;
  prompt: string;
  state: string;
  error?: boolean;
}) {
  return (
    <article className={`${styles.pairRow} ${error ? styles.pairError : ""}`}>
      <span className={styles.shotId}>{id}</span>
      <div className={styles.pairSides}>
        <span>{image}</span>
        <span>{prompt}</span>
      </div>
      <strong className={error ? styles.errorText : styles.successText}>
        {state}
      </strong>
    </article>
  );
}

export function DownloadsView({
  state,
  onStateChange,
}: {
  state: DownloadPreviewState;
  onStateChange: (state: DownloadPreviewState) => void;
}) {
  return (
    <section
      className={`${styles.panel} ${styles.downloadsPanel}`}
      aria-labelledby="downloads-title"
    >
      <PanelHeader
        kicker="DELIVERY · DEMO"
        title="Downloads"
        id="downloads-title"
      />
      <fieldset className={styles.downloadStateSelector}>
        <legend>Preview state</legend>
        <label className={styles.downloadStateOption}>
          <input
            type="radio"
            name="download-preview-state"
            value="empty"
            checked={state === "empty"}
            onChange={() => onStateChange("empty")}
          />
          <span>Empty</span>
        </label>
        <label className={styles.downloadStateOption}>
          <input
            type="radio"
            name="download-preview-state"
            value="examples"
            checked={state === "examples"}
            onChange={() => onStateChange("examples")}
          />
          <span>Example downloads</span>
        </label>
      </fieldset>
      {state === "empty" ? (
        <article className={`${styles.downloadCard} ${styles.downloadEmpty}`}>
          <span className={styles.fileIcon} aria-hidden="true">
            —
          </span>
          <h3>No downloads yet</h3>
          <p>Nothing is being downloaded in this preview.</p>
        </article>
      ) : (
        <div className={styles.downloadGrid} aria-label="Example downloads">
          <article className={`${styles.downloadCard} motion-card`}>
            <span className={styles.fileIcon} aria-hidden="true">
              MP4
            </span>
            <h3>SHOT-001_example.mp4</h3>
            <p>Example file · 18.4 MB</p>
            <div
              className={styles.progressTrack}
              role="img"
              aria-label="Example download progress 68 percent"
            >
              <span style={{ width: "68%" }} />
            </div>
            <strong className={styles.progressValue}>
              68% example progress
            </strong>
          </article>
          <article className={`${styles.downloadCard} motion-card`}>
            <span className={styles.fileIcon} aria-hidden="true">
              MP4
            </span>
            <h3>SHOT-002_example.mp4</h3>
            <p>Example file · waiting</p>
            <div
              className={styles.progressTrack}
              role="img"
              aria-label="Example download progress 0 percent"
            >
              <span style={{ width: "0%" }} />
            </div>
            <strong className={styles.progressValue}>
              Not started · example
            </strong>
          </article>
        </div>
      )}
      <div className={`${styles.actionRow} ${styles.downloadActionRow}`}>
        <Button disabled aria-describedby="download-disabled-reason">
          Download selected files
        </Button>
        <p id="download-disabled-reason" className={styles.disabledReason}>
          Unavailable: no real generated results or download workflow are
          present.
        </p>
      </div>
    </section>
  );
}

function PanelHeader({
  kicker,
  title,
  id,
}: {
  kicker: string;
  title: string;
  id: string;
}) {
  return (
    <div className={styles.panelHeading}>
      <div>
        <p className={styles.kicker}>{kicker}</p>
        <h2 id={id}>{title}</h2>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastHost maxVisible={4}>
      <Dashboard />
    </ToastHost>
  );
}
