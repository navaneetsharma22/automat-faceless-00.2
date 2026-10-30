import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "./components/Button";
import { ConnectionStatus } from "./components/ConnectionStatus";
import controlStyles from "./components/controls.module.css";
import { Field } from "./components/Field";
import { Navigation, type Workspace } from "./components/Navigation";
import { SettingsConfirmation } from "./components/SettingsConfirmation";
import { ToastHost } from "./components/ToastHost";
import { BUILD_ID } from "../shared/buildInfo";
import type { FlowSettingsConfirmation } from "../shared/schemas";
import { createFoundationClient } from "../shared/messageClient";
import { flowTabFromUrl } from "../platforms/flow/connection";
import { registerDashboardFocusResponder } from "./dashboardFocus";
import { ImageImportPanel } from "./features/image-batch/ImportPanel";
import { VideoImportPanel } from "./features/video-batch/ImportPanel";
import { ImportPreviewSession } from "./features/shared/importPreviewSession";
import styles from "./Dashboard.module.css";

function Dashboard() {
  const [workspace, setWorkspace] = useState<Workspace>("Images");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [imageImportSession] = useState(
    () => new ImportPreviewSession("image"),
  );
  const [videoImportSession] = useState(
    () => new ImportPreviewSession("video"),
  );
  const [batchClient] = useState(() =>
    createFoundationClient({
      sendMessage: (message) => {
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
          return Promise.reject(
            new Error("Extension messaging is unavailable."),
          );
        }
        return chrome.runtime.sendMessage(message);
      },
    }),
  );
  const [videoWrapLines, setVideoWrapLines] = useState(false);
  const [videoEditorExpanded, setVideoEditorExpanded] = useState(false);
  const [imageSettingsConfirmation, setImageSettingsConfirmation] =
    useState<FlowSettingsConfirmation | null>(null);
  const [imageVariantCount, setImageVariantCount] = useState("");
  const [imageConfirmationPending, setImageConfirmationPending] =
    useState(false);
  const [imageConfirmationError, setImageConfirmationError] = useState<
    string | undefined
  >();
  const [videoConfirmed, setVideoConfirmed] = useState(false);
  const [destination, setDestination] = useState<"Flow" | "Vids">("Flow");

  const updateImageSettingsConfirmation = async (
    checked: boolean,
    declaredVariantCount: string,
  ) => {
    if (!checked) {
      setImageSettingsConfirmation(null);
      setImageConfirmationError(undefined);
      return;
    }
    const parsedVariantCount = Number(declaredVariantCount);
    if (
      !Number.isInteger(parsedVariantCount) ||
      parsedVariantCount < 1 ||
      parsedVariantCount > 100
    ) {
      setImageSettingsConfirmation(null);
      setImageConfirmationError(
        "Enter the variant count you manually selected in Flow (1–100).",
      );
      return;
    }
    setImageConfirmationPending(true);
    setImageConfirmationError(undefined);
    try {
      const selected = await batchClient.request("connections.getSelection", {
        provider: "Flow",
      });
      if (
        !selected ||
        typeof selected !== "object" ||
        !("tabId" in selected) ||
        typeof selected.tabId !== "number" ||
        !("canonicalTarget" in selected) ||
        typeof selected.canonicalTarget !== "string"
      ) {
        throw new Error("Select a Flow project in Connections first.");
      }
      const target = flowTabFromUrl(
        selected.tabId,
        "",
        selected.canonicalTarget,
      );
      if (!target)
        throw new Error("The selected Flow project is no longer valid.");
      setImageSettingsConfirmation({
        confirmationId: crypto.randomUUID(),
        confirmedAt: Date.now(),
        tabId: target.id,
        projectId: target.projectId,
        canonicalTarget: target.canonicalTarget,
        declaredVariantCount: parsedVariantCount,
      });
    } catch (error) {
      setImageSettingsConfirmation(null);
      setImageConfirmationError(
        error instanceof Error
          ? error.message
          : "Flow settings confirmation could not be bound to the selected project.",
      );
    } finally {
      setImageConfirmationPending(false);
    }
  };

  useEffect(
    () => () => {
      imageImportSession.cancel();
      videoImportSession.cancel();
    },
    [imageImportSession, videoImportSession],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime?.onMessage ||
      !chrome.tabs?.getCurrent ||
      !chrome.windows?.update
    ) {
      return;
    }
    return registerDashboardFocusResponder(chrome);
  }, []);

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

        <div className={`${styles.content} motion-screen-enter`}>
          <div className={styles.pageHeading}>
            <div>
              <p className={styles.kicker}>CREATIVE WORKSPACE</p>
              <h1>{workspace}</h1>
              <p className={styles.lede}>{workspaceSubtitle(workspace)}</p>
            </div>
          </div>
          <div hidden={workspace !== "Images"}>
            <ImagesView
              session={imageImportSession}
              persistenceClient={batchClient}
              settingsConfirmation={imageSettingsConfirmation}
              confirmationPending={imageConfirmationPending}
              confirmationError={imageConfirmationError}
              declaredVariantCount={imageVariantCount}
              setDeclaredVariantCount={(value) => {
                setImageVariantCount(value);
                setImageSettingsConfirmation(null);
                setImageConfirmationError(undefined);
              }}
              setSettingsConfirmation={updateImageSettingsConfirmation}
            />
          </div>
          {workspace === "References" ? <ReferencesView /> : null}
          <div hidden={workspace !== "Videos"}>
            <VideosView
              session={videoImportSession}
              persistenceClient={batchClient}
              wrapLines={videoWrapLines}
              setWrapLines={setVideoWrapLines}
              editorExpanded={videoEditorExpanded}
              setEditorExpanded={setVideoEditorExpanded}
              destination={destination}
              setDestination={setDestination}
              confirmed={videoConfirmed}
              setConfirmed={setVideoConfirmed}
            />
          </div>
          {workspace === "Downloads" ? <DownloadsView /> : null}
          <details className={styles.advanced}>
            <summary>
              Advanced details <span>Technical preview information</span>
            </summary>
            <div className={styles.advancedContent}>
              <p>
                Provider connections are checked against the currently selected
                project. Image GenerateOnce remains a separately guarded legacy
                action; batch queueing is unavailable.
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
    Images: "Import, validate, and save an image JSON source.",
    References: "Reference capture and assignment status.",
    Videos: "Prepare a video source and review destination requirements.",
    Downloads: "Check available generated results and downloads.",
  }[workspace];
}

function ImagesView({
  session,
  persistenceClient,
  settingsConfirmation,
  confirmationPending,
  confirmationError,
  declaredVariantCount,
  setDeclaredVariantCount,
  setSettingsConfirmation,
}: {
  session: ImportPreviewSession;
  persistenceClient: ReturnType<typeof createFoundationClient>;
  settingsConfirmation: FlowSettingsConfirmation | null;
  confirmationPending: boolean;
  confirmationError?: string;
  declaredVariantCount: string;
  setDeclaredVariantCount: (value: string) => void;
  setSettingsConfirmation: (
    value: boolean,
    declaredVariantCount: string,
  ) => void;
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
          kicker="IMAGE IMPORT"
          title="Image prompt import"
          id="image-input-title"
        />
        <ImageImportPanel
          session={session}
          workspaceId="default"
          persistenceClient={persistenceClient}
          settingsConfirmation={settingsConfirmation ?? undefined}
          legacyFlowSetup={
            <>
              <SettingsConfirmation
                id="image-settings-confirm"
                provider="Flow"
                checked={settingsConfirmation !== null}
                contextLabel={`${declaredVariantCount || "variant count required"} variants`}
                onChange={(checked) =>
                  void setSettingsConfirmation(checked, declaredVariantCount)
                }
                disabled={confirmationPending}
                error={confirmationError}
              />
              <Field
                id="image-variant-count"
                label="Flow variants selected"
                hint="Enter the count you selected manually in Flow. This records your declaration; Automat Faceless does not inspect or change Flow settings."
                required
              >
                <input
                  id="image-variant-count"
                  className={controlStyles.control}
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  value={declaredVariantCount}
                  onChange={(event) =>
                    setDeclaredVariantCount(event.currentTarget.value)
                  }
                  aria-label="Number of Flow image variants manually selected"
                />
              </Field>
            </>
          }
          wrapLines={wrapLines}
          setWrapLines={setWrapLines}
          editorExpanded={editorExpanded}
          setEditorExpanded={setEditorExpanded}
        />
      </section>
      <ValidatedPromptPanel session={session} />
    </div>
  );
}

export function ValidatedPromptPanel({
  session,
}: {
  session: ImportPreviewSession;
}) {
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const validated =
    snapshot.status === "success" &&
    snapshot.result !== undefined &&
    snapshot.resultRevision === snapshot.revision;
  const items = validated ? (snapshot.result?.items ?? []) : [];

  return (
    <section
      className={`${styles.panel} ${styles.sourceSummary} ${items.length ? "" : styles.sourceSummaryEmpty}`}
      aria-labelledby="image-source-summary-title"
    >
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.kicker}>SOURCE SUMMARY</p>
          <h2 id="image-source-summary-title">
            {items.length
              ? `${items.length} validated prompt${items.length === 1 ? "" : "s"}`
              : "No validated prompts"}
          </h2>
        </div>
      </div>
      {items.length ? (
        <>
          <p className={styles.sourceStatus}>Validated · Not sent to Flow</p>
          <ol className={styles.sourcePromptList}>
            {items.map((item, index) => (
              <li
                className={styles.sourcePrompt}
                key={`${item.shotId ?? "prompt"}:${item.sourceSpan.start}`}
              >
                <strong>{item.shotId ?? `Prompt ${index + 1}`}</strong>
                <span>Not sent</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className={styles.sourceEmpty}>
          Validate a source to see its prompts here. Nothing is sent to Flow.
        </p>
      )}
    </section>
  );
}

function ReferencesView() {
  return (
    <div className={styles.workspaceGrid}>
      <section className={styles.panel} aria-labelledby="references-title">
        <PanelHeader
          kicker="REFERENCES"
          title="Shot references"
          id="references-title"
        />
        <p className={styles.sourceEmpty}>
          No captured references are available. Reference capture and assignment
          are not implemented yet.
        </p>
        <div className={styles.actionRow}>
          <Button disabled aria-describedby="reference-disabled-reason">
            Confirm references
          </Button>
          <p id="reference-disabled-reason" className={styles.disabledReason}>
            Unavailable: reference capture and assignment are not implemented.
          </p>
        </div>
      </section>
    </div>
  );
}

export function VideosView({
  session,
  persistenceClient,
  wrapLines,
  setWrapLines,
  editorExpanded,
  setEditorExpanded,
  destination,
  setDestination,
  confirmed,
  setConfirmed,
}: {
  session: ImportPreviewSession;
  persistenceClient: ReturnType<typeof createFoundationClient>;
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
      <section
        className={`${styles.panel} ${styles.editorPanel}`}
        aria-labelledby="video-input-title"
      >
        <PanelHeader
          kicker="VIDEO IMPORT"
          title="Video prompt import"
          id="video-input-title"
        />
        <VideoImportPanel
          session={session}
          workspaceId="default"
          persistenceClient={persistenceClient}
          wrapLines={wrapLines}
          setWrapLines={setWrapLines}
          editorExpanded={editorExpanded}
          setEditorExpanded={setEditorExpanded}
        />
        <p className={styles.sourceEmpty}>
          No saved image/video pairing is available. Shot matching uses stable
          IDs from validated sources; no gallery-position matching is shown.
        </p>
        <fieldset className={styles.destinationGroup}>
          <legend>Video destination</legend>
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
                  <small>See Connections for current project status.</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <SettingsConfirmation
          id="video-settings-confirm"
          provider={destination}
          contextLabel="current video source"
          checked={confirmed}
          onChange={setConfirmed}
        />
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
    </div>
  );
}

export function DownloadsView() {
  return (
    <section
      className={`${styles.panel} ${styles.downloadsPanel}`}
      aria-labelledby="downloads-title"
    >
      <PanelHeader kicker="DELIVERY" title="Downloads" id="downloads-title" />
      <article className={`${styles.downloadCard} ${styles.downloadEmpty}`}>
        <span className={styles.fileIcon} aria-hidden="true">
          —
        </span>
        <h3>No eligible downloads</h3>
        <p>Generated results and a download workflow are not available yet.</p>
      </article>
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
