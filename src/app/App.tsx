import { useEffect, useState } from "react";
import { Button } from "./components/Button";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { JsonEditor } from "./components/JsonEditor";
import { Navigation, type Workspace } from "./components/Navigation";
import { Notice } from "./components/Notice";
import { ProgressPanel } from "./components/ProgressPanel";
import { SettingsConfirmation } from "./components/SettingsConfirmation";
import { ToastHost, useToast } from "./components/ToastHost";
import styles from "./Dashboard.module.css";

const demoJson = `{
  "batch": "DEMO ONLY — synthetic image prompts",
  "prompts": [
${Array.from({ length: 28 }, (_, index) => `    { "shot_id": "SHOT-${String(index + 1).padStart(3, "0")}", "prompt": "Illustrative long prompt ${index + 1}: cinematic studio portrait, soft window light, natural detail, composed for a 16:9 frame." }`).join(",\n")}
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
  const [imageJson, setImageJson] = useState(demoJson);
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
        <div className={styles.sidebarFoot}>
          <span className={styles.buildMark} aria-hidden="true">
            ●
          </span>
          <span>UI preview · no provider activity</span>
        </div>
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
              <p className={styles.kicker}>
                CREATIVE WORKSPACE <span>· DEMONSTRATION DATA</span>
              </p>
              <h1>{workspace}</h1>
              <p className={styles.lede}>{workspaceSubtitle(workspace)}</p>
            </div>
            <span className={styles.demoBadge}>DEMO CONTENT</span>
          </div>
          {workspace === "Images" ? (
            <ImagesView
              imageJson={imageJson}
              setImageJson={setImageJson}
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
              destination={destination}
              setDestination={setDestination}
              confirmed={videoConfirmed}
              setConfirmed={setVideoConfirmed}
            />
          ) : null}
          {workspace === "Downloads" ? <DownloadsView /> : null}
          <details className={styles.advanced}>
            <summary>
              Advanced details <span>Technical preview information</span>
            </summary>
            <div className={styles.advancedContent}>
              <p>
                This is a visual-only P01.3 demonstration. No import parsing,
                queue, pairing, provider automation, OAuth, downloads, or scene
                splitting is active.
              </p>
              <dl>
                <div>
                  <dt>Flow</dt>
                  <dd>Not connected</dd>
                </div>
                <div>
                  <dt>Vids</dt>
                  <dd>Not connected</dd>
                </div>
                <div>
                  <dt>Build state</dt>
                  <dd>Local UI preview</dd>
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
  return (
    <div className={styles.workspaceGrid}>
      <section
        className={`${styles.panel} ${styles.editorPanel}`}
        aria-labelledby="image-input-title"
      >
        <PanelHeader
          kicker="IMAGE BATCH · EXAMPLE"
          title="Prompt input"
          id="image-input-title"
        />
        <Notice kind="info" announce={false}>
          DEMO DATA — synthetic JSON is editable here for layout review. The
          text is not parsed or submitted.
        </Notice>
        <JsonEditor
          id="image-demo-json"
          label="Example image prompt JSON"
          value={imageJson}
          onChange={setImageJson}
          rows={14}
          hint="Full example body stays visible in the editor; no import or parsing is active."
        />
        <SettingsConfirmation
          id="image-settings-confirm"
          provider="Flow"
          contextLabel="demo image batch"
          checked={confirmed}
          onChange={setConfirmed}
          hint="This demonstration checkbox only previews the confirmation state."
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
          kicker="REFERENCE LIBRARY · EXAMPLE"
          title="Shot references"
          id="references-title"
        />
        <p className={styles.muted}>
          Every card is labeled demo content. Selection is local UI state only.
        </p>
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
        <Notice kind="warning" announce={false}>
          An empty reference is shown intentionally. No image capture or
          assignment occurs in this preview.
        </Notice>
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

function VideosView({
  destination,
  setDestination,
  confirmed,
  setConfirmed,
}: {
  destination: "Flow" | "Vids";
  setDestination: (value: "Flow" | "Vids") => void;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
}) {
  return (
    <div className={styles.workspaceGrid}>
      <section className={styles.panel} aria-labelledby="video-pair-title">
        <PanelHeader
          kicker="VIDEO BATCH · EXAMPLE"
          title="Image + prompt pairs"
          id="video-pair-title"
        />
        <p className={styles.muted}>
          Pairs are illustrative and display shot-ID matching errors. No pairing
          logic runs.
        </p>
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
          hint="Confirmation is a local preview and does not inspect destination settings."
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

function DownloadsView() {
  return (
    <section
      className={`${styles.panel} ${styles.downloadsPanel}`}
      aria-labelledby="downloads-title"
    >
      <PanelHeader
        kicker="DELIVERY · EXAMPLE STATES"
        title="Downloads"
        id="downloads-title"
      />
      <p className={styles.muted}>
        Example files and progress are labeled throughout. No files are being
        downloaded.
      </p>
      <div className={styles.downloadGrid}>
        <article
          className={`${styles.downloadCard} ${styles.downloadEmpty} motion-card`}
        >
          <span className={styles.fileIcon} aria-hidden="true">
            —
          </span>
          <span className={styles.demoBadge}>EMPTY STATE</span>
          <h3>No downloads yet</h3>
          <p>Completed example files will appear here.</p>
        </article>
        <article className={`${styles.downloadCard} motion-card`}>
          <span className={styles.fileIcon} aria-hidden="true">
            MP4
          </span>
          <span className={styles.demoBadge}>DEMO FILE</span>
          <h3>SHOT-001_example.mp4</h3>
          <p>Example file · 18.4 MB</p>
          <div
            className={styles.progressTrack}
            role="img"
            aria-label="Example download progress 68 percent"
          >
            <span style={{ width: "68%" }} />
          </div>
          <strong className={styles.progressValue}>68% example progress</strong>
        </article>
        <article className={`${styles.downloadCard} motion-card`}>
          <span className={styles.fileIcon} aria-hidden="true">
            MP4
          </span>
          <span className={styles.demoBadge}>DEMO FILE</span>
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
      <div className={styles.actionRow}>
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
      <span className={styles.demoBadge}>EXAMPLE</span>
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
