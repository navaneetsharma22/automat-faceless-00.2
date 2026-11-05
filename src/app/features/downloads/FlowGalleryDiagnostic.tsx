import { useCallback, useEffect, useState } from "react";
import {
  diagnoseFlowRouteAssetBlobLink,
  diagnoseFlowDownloadMediaIdentity,
  type FlowGalleryDownloadDiagnostic,
} from "../../../platforms/flow/downloads";
import type { createFoundationClient } from "../../../shared/messageClient";
import { isFlow1080pProofClip } from "../../../domain/media/flowClipDownloadProof";
import { Button } from "../../components/Button";
import styles from "../../Dashboard.module.css";
import type { FlowProjectVideosImportProgress } from "../../../platforms/flow/projectVideos";

type DiagnosticSnapshot = FlowGalleryDownloadDiagnostic | { status: "idle" };
type Client = ReturnType<typeof createFoundationClient>;

function isActive(snapshot: DiagnosticSnapshot) {
  return snapshot.status === "armed" || snapshot.status === "action_observed";
}

function associationLabel(snapshot: FlowGalleryDownloadDiagnostic) {
  if (snapshot.association === "matched")
    return `Matched to Chrome download ${snapshot.matchedDownloadId}.`;
  if (snapshot.association === "ambiguous")
    return "Ambiguous: multiple exact download candidates were observed.";
  switch (snapshot.associationReason) {
    case "no_quality_action":
      return "Unverified: no 1080p Upscaled action was observed.";
    case "no_selected_frame_download_event":
      return "Unverified: no download event was tied to the selected Flow frame.";
    case "no_exact_url_filename_pair":
      return "Unverified: the Flow download event did not exactly match a Chrome download.";
    case "multiple_exact_download_candidates":
      return "Ambiguous: more than one Chrome download matched the Flow event.";
    case "multiple_page_download_events":
      return "Ambiguous: more than one Flow page download event was observed.";
    case "unique_action_media_and_download_chain":
      return "Matched.";
    case "no_action_media_identity_link":
      return "Unverified: no media request identity linked the action to the download event.";
  }
}

function mediaIdentityLabel(snapshot: FlowGalleryDownloadDiagnostic) {
  switch (diagnoseFlowDownloadMediaIdentity(snapshot)) {
    case "not_evaluated":
      return "not evaluated yet";
    case "identity_not_extracted":
      return "identity not extracted from retained action-time requests";
    case "identity_extracted_no_match":
      return "identity extracted, but it did not match the event/download";
    case "matching_request_retained":
      return "matching request identity retained";
    case "identity_request_dropped_at_cap":
      return "identity-bearing request omitted at the buffer cap; relevance unknown";
  }
}

export function FlowGalleryDiagnostic({
  persistenceClient,
}: {
  persistenceClient: Client;
}) {
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>({
    status: "idle",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [identityCaptureEnabled, setIdentityCaptureEnabled] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = (await persistenceClient.request(
        "flow.downloadDiagnostic.get",
        {},
      )) as DiagnosticSnapshot;
      setSnapshot(next);
      setError(undefined);
    } catch {
      setError(
        "Diagnostic status could not be read from the extension worker.",
      );
    }
  }, [persistenceClient]);

  useEffect(() => {
    let current = true;
    const read = async () => {
      if (!current) return;
      try {
        const next = (await persistenceClient.request(
          "flow.downloadDiagnostic.get",
          {},
        )) as DiagnosticSnapshot;
        if (current) setSnapshot(next);
      } catch {
        if (current)
          setError(
            "Diagnostic status could not be read from the extension worker.",
          );
      }
    };
    void read();
    const interval = window.setInterval(
      () => void read(),
      snapshot.status === "armed" || snapshot.status === "action_observed"
        ? 1_000
        : 5_000,
    );
    return () => {
      current = false;
      window.clearInterval(interval);
    };
  }, [persistenceClient, snapshot.status]);

  const arm = async () => {
    setPending(true);
    setError(undefined);
    try {
      if (typeof chrome === "undefined" || !chrome.permissions?.request) {
        setError(
          "Chrome permission requests are unavailable in this dashboard.",
        );
        return;
      }
      // Invoke the optional permission request directly from the operator's click.
      const granted = await chrome.permissions.request({
        permissions: ["downloads"],
      });
      if (!granted) {
        setError(
          "Chrome downloads permission was not granted; no observation was armed.",
        );
        return;
      }
      const next = (await persistenceClient.request(
        "flow.downloadDiagnostic.arm",
        { identityCaptureEnabled },
      )) as DiagnosticSnapshot;
      setSnapshot(next);
    } catch {
      setError(
        "The Flow diagnostic could not arm. Confirm the Flow tab is selected and currently connected, then inspect the error before retrying.",
      );
    } finally {
      setPending(false);
    }
  };

  const stop = async () => {
    setPending(true);
    setError(undefined);
    try {
      const next = (await persistenceClient.request(
        "flow.downloadDiagnostic.stop",
        {},
      )) as DiagnosticSnapshot;
      setSnapshot(next);
    } catch {
      setError("The observation could not be stopped from this dashboard.");
    } finally {
      setPending(false);
    }
  };

  const active = isActive(snapshot);
  const report = snapshot.status === "idle" ? undefined : snapshot;
  return (
    <article
      className={styles.downloadCard}
      aria-labelledby="flow-download-diagnostic-title"
    >
      <span className={styles.fileIcon} aria-hidden="true">
        F
      </span>
      <h3 id="flow-download-diagnostic-title">
        Flow download diagnostic
      </h3>
      <FlowClipDownloads persistenceClient={persistenceClient} report={report} />
      <p>
        {report?.automaticDownload
          ? "This report tracks the 1080p download requested from Flow Downloads."
          : "Observe one manually selected 1080p Upscaled action using the passive diagnostic."}
      </p>
      <p className={styles.disabledReason}>
        Optional Chrome downloads permission exposes local download IDs,
        basenames, and completion or interruption state. The diagnostic does not
        call Chrome&apos;s download-start API. Raw URLs and query tokens are
        discarded after in-memory fingerprinting.
      </p>
      <div className={styles.actionRow}>
        {active ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => void stop()}
          >
            {pending ? "Stopping…" : "Stop observation"}
          </Button>
        ) : (
          <Button
            disabled={pending}
            loading={pending}
            onClick={() => void arm()}
          >
            Arm one observation
          </Button>
        )}
        <span role="status" aria-live="polite">
          {pending
            ? "Working"
            : snapshot.status === "armed"
              ? "Armed"
              : snapshot.status.replaceAll("_", " ")}
        </span>
      </div>
      {!active ? (
        <label className={styles.disabledReason}>
          <input
            type="checkbox"
            checked={identityCaptureEnabled}
            onChange={(event) =>
              setIdentityCaptureEnabled(event.currentTarget.checked)
            }
          />{" "}
          Capture sanitized /edit asset path identity for one manual action
          (experimental; does not affect association)
        </label>
      ) : null}
      <p className={styles.disabledReason}>
        {report?.captureMode === "detail_clip"
          ? "For the single-row detail capture, the observer is armed on the verified clip and its Download media menu. Make one user-initiated 1080p Upscaled selection, then let Chrome finish or stop the observation. The observer expires after 20 minutes."
          : "For Gallery menu-only verification, open one card's More options menu and hover Download. Confirm the pre-click evidence below, then stop before selecting a quality. Observation expires after 20 minutes."}
      </p>
      {error ? (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
      {report ? (
        <div className={styles.flowDiagnosticReport}>
          <dl>
            <div>
              <dt>State</dt>
              <dd>{report.status.replaceAll("_", " ")}</dd>
            </div>
            {report.interruptionReason ? (
              <div>
                <dt>Interruption cause</dt>
                <dd>{report.interruptionReason.replaceAll("_", " ")}</dd>
              </div>
            ) : null}
            <div>
              <dt>Selected tab</dt>
              <dd>{report.tabId}</dd>
            </div>
            <div>
              <dt>
                {report.captureMode === "detail_clip"
                  ? "Detail-menu selection"
                  : "Trusted quality click"}
              </dt>
              <dd>
                {report.captureMode === "detail_clip"
                  ? report.detailClipSelectionStatus === "observed"
                    ? report.automaticDownload
                      ? "Dashboard 1080p selection sent through the verified native menu"
                      : "User-initiated 1080p Upscaled selection observed inside the bound menu"
                    : report.detailClipSelectionStatus === "route_changed"
                      ? "Selection rejected: route changed or no longer matched"
                      : "Waiting for one user-initiated selection"
                  : report.nativeActionObserved
                    ? "1080p Upscaled click observed"
                    : "not observed"}
              </dd>
            </div>
            <div>
              <dt>Requested quality</dt>
              <dd>{report.requestedQuality ?? "not observed"}</dd>
            </div>
            <div>
              <dt>
                {report.captureMode === "detail_clip"
                  ? "Clip association"
                  : "Association"}
              </dt>
              <dd>
                {report.captureMode === "detail_clip"
                  ? "Unverified: a matching route path does not identify the Flow output asset. Existing Gallery-card association rules are unchanged."
                  : associationLabel(report)}
              </dd>
            </div>
            <div>
              <dt>
                {report.captureMode === "detail_clip"
                  ? "Download completion"
                  : "Browser completion"}
              </dt>
              <dd>
                {report.captureMode === "detail_clip"
                  ? (report.detailDownloadCompletionStatus ?? "not observed").replaceAll("_", " ")
                  : report.matchedDownloadId === undefined
                    ? "not verified"
                    : (report.downloads.find(
                        (item) => item.downloadId === report.matchedDownloadId,
                      )?.state ?? "unknown")}
              </dd>
            </div>
            <div>
              <dt>
                {report.captureMode === "detail_clip"
                  ? "Chrome file-exists check"
                  : "Saved-file resolution"}
              </dt>
              <dd>
                {report.captureMode === "detail_clip"
                  ? `${(report.detailFileResolutionStatus ?? "not_checked").replaceAll("_", " ")}; based on Chrome's file-exists metadata only; media bytes not decoded`
                  : "not inspected"}
              </dd>
            </div>
            <div>
              <dt>Chrome download events</dt>
              <dd>
                {report.downloadCreatedEvents ?? 0} received;{" "}
                {report.nonVideoDownloadCount} non-video;{" "}
                {report.videoCandidatesOmitted ?? 0} video candidates omitted at
                capacity
              </dd>
            </div>
            <div>
              <dt>Flow download events</dt>
              <dd>
                {report.pageDownloadEventsReceived ?? 0} received across
                debugger targets; {report.pageDownloadTargetMismatches ?? 0}{" "}
                target mismatches; {report.pageDownloadMainFrameEvents ?? 0}{" "}
                selected tab main-frame events;{" "}
                {report.pageDownloadFrameMismatches ?? 0}
                selected tab non-main-frame events;{" "}
                {report.pageDownloads.length} retained;{" "}
                {
                  report.pageDownloads.filter(
                    (event) => event.frameMatched && event.afterAction,
                  ).length
                }{" "}
                retained after-action main-frame events;{" "}
                {report.pageDownloadMetadataRejected ?? 0} rejected for unusable
                URL metadata; {report.pageDownloadFilenameUnavailable ?? 0}
                without a usable filename;{" "}
                {report.pageDownloadEventsOmittedAtCap ?? 0} page events omitted
                at capacity
              </dd>
            </div>
            <div>
              <dt>Action-time request evidence</dt>
              <dd>
                {report.mediaRequests.length} retained;{" "}
                {report.mediaRequestsOmittedAtCap ?? 0} omitted at the 16-entry
                cap
              </dd>
            </div>
            <div>
              <dt>Media identity bridge</dt>
              <dd>
                {mediaIdentityLabel(report)};{" "}
                {report.mediaIdentityRequestsOmittedAtCap ?? "not recorded"}{" "}
                identity-bearing request(s) omitted at capacity during this
                session.
              </dd>
            </div>
            {report.identityCaptureEnabled ? (() => {
              const identityLink = diagnoseFlowRouteAssetBlobLink(report);
              const armStatus =
                report.assetRoutePreflight?.matchStatus === "matched"
                  ? "Match"
                  : report.assetRoutePreflight?.matchStatus ===
                      "no_matching_edit_route"
                    ? "No matching /edit/ UUID"
                    : "No match";
              const menuStatus =
                report.assetRoutePreflight?.selectedRouteMatchStatus ??
                "not checked";
              const menuStatusLabel =
                menuStatus === "matched"
                  ? "Match"
                  : menuStatus === "changed_or_missing"
                    ? "Changed or missing"
                    : menuStatus === "not_comparable"
                      ? "Not comparable (no matching /edit/ UUID at arm time)"
                      : menuStatus === "not_checked"
                        ? "Not checked"
                        : "No match";
              return (
                <>
                  <div>
                    <dt>Clip route at arm</dt>
                    <dd>{armStatus}</dd>
                  </div>
                  <div>
                    <dt>
                      {report.captureMode === "detail_clip"
                        ? "Clip route at selection"
                        : "Clip route when menu opened"}
                    </dt>
                    <dd>{menuStatusLabel}</dd>
                  </div>
                  {report.selectedCard || report.captureMode === "detail_clip" ? (
                    <div>
                      <dt>
                        {report.captureMode === "detail_clip"
                          ? "Clip-to-output path evidence"
                          : "Temporary route asset trace"}
                      </dt>
                      <dd>
                        route -&gt; action request path ID: {identityLink.routeToOutput.replaceAll("_", " ")}; asset ID -&gt; exact page blob/download: {identityLink.outputToBlob.replaceAll("_", " ")}. URL path IDs alone do not identify a Flow job/result; see the metadata trace below. Media bytes are not inspected, and this path trace alone does not establish clip association.
                      </dd>
                    </div>
                  ) : null}
                  {report.captureMode === "detail_clip" && report.detailMetadataCaptureEnabled ? (() => {
                    const fields = report.detailMetadataFields ?? [];
                    const bodyDiagnostics = report.detailMetadataBodyDiagnostics ?? [];
                    const routeMatches = fields.filter((field) => field.routeEquality).length;
                    const requestResponseMatches = fields.filter((field) => field.requestResponseEquality).length / 2;
                    const blobMatches = fields.filter((field) => field.blobPathEquality).length;
                    return (
                      <div>
                        <dt>Request/response metadata trace</dt>
                        <dd>
                          Eligible Fetch/XHR requests since arm: {report.detailMetadataEligibleRequestsSeen ?? 0}; admitted: {report.detailMetadataRequestsAdmitted ?? 0}; omitted at request cap: {report.detailMetadataRequestsOmittedAtCap ?? 0}. Request bodies available/read: {report.detailMetadataRequestBodiesAvailable ?? 0}/{report.detailMetadataRequestBodiesRead ?? 0}; response bodies attempted/read: {report.detailMetadataResponseBodiesAttempted ?? 0}/{report.detailMetadataResponseBodiesRead ?? 0}. JSON parses succeeded/failed: {report.detailMetadataJsonParseSucceeded ?? 0}/{report.detailMetadataJsonParseFailed ?? 0}; parsed bodies with zero accepted identity fields: {report.detailMetadataParsedBodiesWithoutIdentityFields ?? 0}. Bodies unavailable/failed/unsupported/filtered: {report.detailMetadataBodiesUnavailable ?? 0}/{report.detailMetadataBodiesFailed ?? 0}/{report.detailMetadataBodiesUnsupported ?? 0}/{report.detailMetadataBodiesFiltered ?? 0}; pending requests: {report.detailMetadataPendingRequests ?? 0}. Accepted fields: {fields.length}; route UUID equalities: {routeMatches}; same-request cross-role equalities: {requestResponseMatches}; blob-path UUID equalities: {blobMatches}. Body formats: {bodyDiagnostics.length ? bodyDiagnostics.map((item) => item.stage + " / " + item.mimeCategory + " / base64=" + (item.base64Encoded === undefined ? "unknown" : item.base64Encoded) + " / bytes=" + (item.byteLength ?? "unknown") + " / " + item.formatCategory + " / parse=" + item.parseFailureCategory).join("; ") : "none observed"}. Field paths/roles and equality flags only: {fields.length ? fields.map((field) => field.requestToken + " " + field.role + "." + field.fieldPath + " [route=" + field.routeEquality + ", request-response=" + field.requestResponseEquality + ", blob-path=" + field.blobPathEquality + "]").join("; ") : "none observed"}. These equality observations do not prove an output-to-blob relationship; an opaque blob URL needs separate direct provenance.
                        </dd>
                      </div>
                    );
                  })() : null}
                </>
              );
            })() : null}
            {report.lastPageDownloadUrlRejection ? (
              <div>
                <dt>Last rejected Flow event URL</dt>
                <dd>
                  {report.lastPageDownloadUrlRejection.reason} /{" "}
                  {report.lastPageDownloadUrlRejection.schemeCategory}
                </dd>
              </div>
            ) : null}
          </dl>
          {report.captureIssue ? (
            <p className={styles.disabledReason}>
              Last Gallery capture issue:{" "}
              {report.captureIssue.stage.replaceAll("_", " ")} /{" "}
              {report.captureIssue.reason.replaceAll("_", " ")}.
            </p>
          ) : null}
          {report.captureMode === "detail_clip" ? (
            <section aria-label="Verified detail menu evidence">
              <strong>Verified detail menu at arm</strong>
              <p className={styles.disabledReason}>
                Download media binding: {report.detailMenuBoundAtArm ? "resolved" : "not resolved"}; 1080p Upscaled option: {report.menuBinding?.qualityOptionObserved ? report.menuBinding.qualityOptionEnabled ? "visible and enabled" : "visible but disabled" : "not observed"}. The page observer only reports a later trusted selection from this bound menu.
              </p>
            </section>
          ) : (
          <section aria-label="Pre-click Gallery menu evidence">
            <strong>Pre-click menu evidence</strong>
            <p className={styles.disabledReason}>
              Card owner:{" "}
              {report.selectedCard?.ownerFound ? "confirmed" : "not confirmed"};
              stable ID attribute:{" "}
              {report.selectedCard?.stableIdAttributeObserved
                ? "observed"
                : "not observed"}
              . Main menu binding:{" "}
              {report.menuBinding?.mainMenuControlResolved
                ? "resolved"
                : "not resolved"}
              . Download row:{" "}
              {report.menuBinding?.downloadRowRecognized
                ? "recognized"
                : "not recognized"}
              . Quality submenu binding:{" "}
              {report.menuBinding?.qualityMenuControlResolved
                ? "resolved"
                : "not resolved"}
              . 1080p Upscaled option:{" "}
              {report.menuBinding?.qualityOptionObserved
                ? report.menuBinding.qualityOptionEnabled
                  ? "visible and enabled"
                  : "visible but disabled"
                : "not observed"}
              .
            </p>
            <p className={styles.disabledReason}>
              These menu checks are recorded before a quality click; they do not
              establish an action or download association.
            </p>
          </section>
          )}
          {report.automaticDownload ? (
            <section aria-label="Dashboard download dispatch">
              <strong>Dashboard download dispatch</strong>
              <p className={styles.disabledReason}>
                Native menu input {report.automaticDownload.dispatchState}. Selected asset fingerprint captured.
                {report.automaticDownload.ignoredPageEvents ? ` ${report.automaticDownload.ignoredPageEvents} unrelated or unverified page download events ignored.` : ""}
              </p>
            </section>
          ) : report.captureMode === "detail_clip" ? (
            <section aria-label="Detail selection listener diagnostic">
              <strong>Detail selection listener diagnostic</strong>
              <p className={styles.disabledReason}>
                Observer installed at arm: {report.detailObserverInstalledAtArm ? "yes" : "not confirmed"}; prior observer replaced at arm: {report.detailObserverReplacedAtArm === undefined ? "unknown" : report.detailObserverReplacedAtArm ? "yes" : "no"}; lifecycle: {report.detailObserverLifecycleStatus ?? "unknown"}. Trusted click events reaching the detail listener: {report.detailClipTrustedClickEvents ?? 0}; 1080p Upscaled candidate clicks: {report.detailClipCandidateClickEvents ?? 0}. {report.detailClipLastClickObservation ? `Last listener event +${report.detailClipLastClickObservation.offsetMs}ms: ${report.detailClipLastClickObservation.decision.replaceAll("_", " ")}; route ${report.detailClipLastClickObservation.routeMatches ? "matched" : "mismatched"}; current menu ${report.detailClipLastClickObservation.menuBound ? "resolved" : "unresolved"}; current menu quality options ${report.detailClipLastClickObservation.qualityOptionCount}; candidate count ${report.detailClipLastClickObservation.candidateCount}; candidate inside current bound menu ${report.detailClipLastClickObservation.candidateInBoundMenu ? "yes" : "no"}; enabled ${report.detailClipLastClickObservation.candidateEnabled ? "yes" : "no"}.` : "No trusted click event reached the detail listener."} Page selection accepted by worker: {report.qualityActionReceivedByWorker ? "yes" : "no"}.
              </p>
            </section>
          ) : (
            <section aria-label="Quality click diagnostic">
              <strong>Quality click diagnostic</strong>
              <p className={styles.disabledReason}>
                Click listener:{" "}
                {report.qualityClickListenerReached
                  ? `reached (${report.qualityClickListenerEvents ?? 0} event${report.qualityClickListenerEvents === 1 ? "" : "s"} received)`
                  : "not reached / no listener event received"}
                ; candidate:{" "}
                {report.lastQualityClickRejection
                  ? `rejected (${report.lastQualityClickRejection.replaceAll("_", " ")}; ${report.qualityClickRejections ?? 0} rejection${report.qualityClickRejections === 1 ? "" : "s"})`
                  : report.qualityActionAcceptedInPage
                    ? "accepted"
                    : "no rejection recorded"}
                ; action accepted in page:{" "}
                {report.qualityActionAcceptedInPage ? "yes" : "no"}; action
                received by worker:{" "}
                {report.qualityActionReceivedByWorker ? "yes" : "no"}.
              </p>
            </section>
          )}
          {report.mediaRequests.length ? (
            <ul aria-label="Sanitized media requests">
              {report.mediaRequests.map((request) => (
                <li key={request.requestToken}>
                  {request.requestToken}: {request.resourceKind},{" "}
                  {request.method}, URL fingerprint {request.urlFingerprint}
                  {request.mediaIdFingerprint
                    ? `, media ID fingerprint ${request.mediaIdFingerprint}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {report.pageDownloads.length ? (
            <ul aria-label="Sanitized Flow download events">
              {report.pageDownloads.map((event) => (
                <li key={event.eventToken}>
                  {event.eventToken}: {event.filename}; URL scheme{" "}
                  {event.urlScheme ?? "unknown"}; selected main frame{" "}
                  {event.frameMatched ? "yes" : "no"}; after quality click{" "}
                  {event.afterAction ? "yes" : "no"};{" "}
                  {event.exactDownloadIds?.length
                    ? `exact URL equality to Chrome download ID${event.exactDownloadIds.length === 1 ? "" : "s"} ${event.exactDownloadIds.join(", ")}`
                    : "no exact URL equality to a Chrome download ID"}
                </li>
              ))}
            </ul>
          ) : null}
          {report.downloads.length ? (
            <ul aria-label="Candidate Chrome downloads">
              {report.downloads.map((download) => (
                <li key={download.downloadId}>
                  ID {download.downloadId}: {download.filename} —{" "}
                  {download.state}
                  {download.urlScheme
                    ? `; URL scheme ${download.urlScheme}`
                    : download.urlRejection
                      ? `; URL rejected: ${download.urlRejection.reason} / ${download.urlRejection.schemeCategory}`
                      : ""}
                  {download.finalUrlScheme
                    ? `; final URL scheme ${download.finalUrlScheme}`
                    : download.finalUrlRejection
                      ? `; final URL rejected: ${download.finalUrlRejection.reason} / ${download.finalUrlRejection.schemeCategory}`
                      : ""}
                  {download.interruptCode ? ` (${download.interruptCode})` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.disabledReason}>
              No candidate MP4/WebM downloads observed.
            </p>
          )}
          <p className={styles.disabledReason}>
            Completed browser downloads do not verify the saved file&apos;s
            actual resolution. An unverified or ambiguous association requires a
            separate evidence review; it does not authorize another upscale.
          </p>
        </div>
      ) : null}
      <Button
        variant="quiet"
        size="compact"
        disabled={pending}
        onClick={() => void refresh()}
      >
        Refresh diagnostic status
      </Button>
    </article>
  );
}

type FlowClipImportRow = {
  id: string;
  projectId: string;
  clipId: string;
  title: string;
  detailUrl: string;
  galleryImportMethod?: "source_asset" | "native_card_navigation";
  galleryAssetId?: string;
  galleryIdentityEvidence?: "same_card_detail_link" | "detail_selected_asset_match";
  detailSelectedAssetId?: string;
  thumbnail: {
    available: boolean;
    width?: number;
    height?: number;
    fingerprint?: string;
  };
  importedAt: number;
  updatedAt: number;
  routeVerified: boolean;
};

type FlowClipDownloadProofResult = {
  status: "armed" | "action_observed" | "completed" | "interrupted" | "expired" | "stopped";
  detailClipSelectionStatus?: string;
  detailMenuBoundAtArm?: boolean;
};

function displayClipTitle(row: FlowClipImportRow) {
  const title = row.title.trim();
  if (!title || /^Google Flow\s*[-–—]\s*AI Creative Studio/i.test(title))
    return `Video · ${row.clipId.slice(0, 8)}`;
  return title;
}

function hasGenericFlowTitle(row: FlowClipImportRow) {
  return !row.title.trim() || /^Google Flow\s*[-–—]\s*AI Creative Studio/i.test(row.title.trim());
}

function attemptStatus(
  report: FlowGalleryDownloadDiagnostic | undefined,
  rowId: string,
) {
  const attempt = report?.automaticDownload;
  if (!report || attempt?.recordId !== rowId)
    return { label: "Not started", state: "neutral" };
  if (report.status === "completed" || report.detailDownloadCompletionStatus === "complete")
    return { label: "Chrome download complete", state: "complete" };
  if (report.detailDownloadCompletionStatus === "interrupted")
    return { label: "Chrome download interrupted", state: "error" };
  if (attempt.dispatchState === "uncertain")
    return { label: "Uncertain · review before retrying", state: "warning" };
  if (attempt.dispatchState === "preparing" && report.status === "stopped")
    return { label: "Preparation failed before quality input", state: "error" };
  if (report.status === "interrupted")
    return { label: "Monitoring interrupted · review Flow and Chrome", state: "warning" };
  if (report.status === "expired" || report.status === "stopped")
    return { label: "Monitoring stopped · download may continue", state: "warning" };
  if (report.detailDownloadCompletionStatus === "in_progress")
    return { label: "Chrome download in progress", state: "working" };
  if (attempt.dispatchState === "intent")
    return { label: "Download preparation in progress", state: "working" };
  if (attempt.dispatchState === "sent")
    return { label: "1080p selection sent · waiting for Chrome", state: "working" };
  return { label: "Preparing download", state: "working" };
}

function chromeCompletionLabel(report: FlowGalleryDownloadDiagnostic) {
  const download = report.downloads.find(
    (item) => item.downloadId === report.detailTrackedDownloadId,
  );
  if (download)
    return `${download.state.replaceAll("_", " ")} · ID ${download.downloadId}`;
  const status = report.detailDownloadCompletionStatus ?? "not_observed";
  const labels: Record<string, string> = {
    not_observed: "Not observed",
    awaiting_browser_download: "Waiting for Flow download event",
    awaiting_chrome_match: "Waiting for a matching Chrome download",
    in_progress: "In progress",
    complete: "Complete",
    interrupted: "Interrupted",
    ambiguous: "Ambiguous",
  };
  return labels[status] ?? "Unknown";
}

function fileExistsLabel(status: string | undefined) {
  const labels: Record<string, string> = {
    not_checked: "Not checked",
    resolved: "File exists (Chrome metadata; media not decoded)",
    missing: "File missing",
    ambiguous: "Ambiguous",
    unavailable: "Unavailable",
  };
  return labels[status ?? "not_checked"] ?? "Not checked";
}

function galleryFailureLabel(
  reason: FlowProjectVideosImportProgress["failureReason"],
) {
  const messages: Record<
    NonNullable<FlowProjectVideosImportProgress["failureReason"]>,
    string
  > = {
    project_missing: "The Flow project content root was not found in this page.",
    project_ambiguous: "More than one visible Flow project root was found.",
    project_mismatch: "The page route did not match the verified Flow project.",
    videos_section_not_selected: "The selected Videos navigation control could not be verified.",
    gallery_unavailable: "The Videos gallery container could not be identified.",
    card_missing: "The target video card was no longer present.",
    card_ambiguous: "More than one card matched the target asset.",
    asset_identity_missing: "The card did not expose a reliable asset UUID.",
    asset_identity_ambiguous: "The card exposed ambiguous asset identity.",
    route_ambiguous: "The card exposed more than one detail route.",
    route_project_mismatch: "The card's detail route belonged to another project.",
    native_open_control_unavailable: "The exact card had no unique safe open control.",
    page_result_invalid: "The Gallery page returned an unsupported inspection result.",
    page_injection_failed: "The Gallery page could not be inspected in the verified document.",
    unexpected_page_status: "The Gallery page returned an unexpected inspection state.",
    document_changed: "The verified Flow document changed during Gallery preflight.",
  };
  return reason ? messages[reason] : undefined;
}

export function FlowClipDownloads({
  persistenceClient,
  report,
  downloadMode = false,
}: {
  persistenceClient: Client;
  report?: FlowGalleryDownloadDiagnostic;
  downloadMode?: boolean;
}) {
  const [rows, setRows] = useState<FlowClipImportRow[]>([]);
  const [rowsLoaded, setRowsLoaded] = useState(false);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({});
  const [downloadProofPending, setDownloadProofPending] = useState(false);
  const [galleryImport, setGalleryImport] = useState<FlowProjectVideosImportProgress>();
  const [galleryImportPending, setGalleryImportPending] = useState(false);
  const [lastStartedDownload, setLastStartedDownload] = useState<FlowGalleryDownloadDiagnostic>();
  const downloadReport = report && (!lastStartedDownload || report.startedAt >= lastStartedDownload.startedAt)
    ? report : lastStartedDownload;
  const downloadActive = Boolean(
    downloadReport?.status === "armed" ||
      downloadReport?.status === "action_observed" ||
      downloadReport?.detailDownloadCompletionStatus === "in_progress" ||
      (downloadReport?.automaticDownload &&
        downloadReport.detailDownloadCompletionStatus !== "complete" &&
        downloadReport.detailDownloadCompletionStatus !== "interrupted"),
  );
  const [downloadProofs, setDownloadProofs] = useState<
    Record<string, FlowClipDownloadProofResult | undefined>
  >({});

  const refresh = useCallback(async () => {
    setRowsLoading(true);
    try {
      const result = (await persistenceClient.request(
        "flow.clipImport.list",
        {},
      )) as FlowClipImportRow[];
      setRows(result);
      setRowsLoaded(true);
      setError(undefined);
    } catch {
      setError("Imported Flow clips could not be read from local storage.");
    } finally {
      setRowsLoading(false);
    }
  }, [persistenceClient]);

  useEffect(() => {
    void refresh();
    let current = true;
    void persistenceClient.request("flow.projectVideos.import.get", {}).then(
      (result) => {
        if (current) setGalleryImport(result as FlowProjectVideosImportProgress);
      },
    );
    return () => {
      current = false;
    };
  }, [persistenceClient, refresh]);

  useEffect(() => {
    if (galleryImport?.status !== "scanning") return;
    let current = true;
    const read = async () => {
      try {
        const next = (await persistenceClient.request(
          "flow.projectVideos.import.get",
          {},
        )) as FlowProjectVideosImportProgress;
        if (current) {
          setGalleryImport(next);
          if (next.status !== "scanning") await refresh();
        }
      } catch {
        if (current) setError("Gallery import progress could not be read.");
      }
    };
    const timer = window.setInterval(() => void read(), 500);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [galleryImport?.status, persistenceClient, refresh]);

  const importProjectVideos = async () => {
    setGalleryImportPending(true);
    setError(undefined);
    try {
      const progress = (await persistenceClient.request(
        "flow.projectVideos.import.start",
        {},
      )) as FlowProjectVideosImportProgress;
      setGalleryImport(progress);
    } catch (caught) {
      const code = caught instanceof Error && "code" in caught
        ? String((caught as Error & { code?: unknown }).code ?? "")
        : caught instanceof Error ? caught.message : "";
      setError(
        code.includes("flow_project_video_import_download_active")
          ? "Import cannot run while a Flow download is active."
          : code.includes("flow_project_video_import_gallery_required")
            ? "Open the Videos section of the verified Flow project before importing project videos."
            : code.includes("flow_project_video_import_gallery_unavailable")
              ? "The Videos gallery could not be safely identified; no guessed clips were imported."
              : code.includes("flow_project_video_import_already_active")
                ? "A project video import is already running."
                : "Project videos could not be imported from the selected Flow tab.",
      );
      try {
        const progress = (await persistenceClient.request(
          "flow.projectVideos.import.get",
          {},
        )) as FlowProjectVideosImportProgress;
        setGalleryImport(progress);
      } catch {
        setGalleryImport(undefined);
        setError("The Gallery import failed, and its latest status could not be read.");
      }
    } finally {
      setGalleryImportPending(false);
    }
  };

  const cancelProjectVideoImport = async () => {
    setGalleryImportPending(true);
    try {
      const progress = (await persistenceClient.request(
        "flow.projectVideos.import.cancel",
        {},
      )) as FlowProjectVideosImportProgress;
      setGalleryImport(progress);
    } catch {
      setError("The Gallery import could not be cancelled from this dashboard.");
    } finally {
      setGalleryImportPending(false);
    }
  };

  const importCurrent = async () => {
    setPending(true);
    setMessage(undefined);
    setError(undefined);
    try {
      const result = (await persistenceClient.request(
        "flow.clipImport.importCurrent",
        {},
      )) as {
        status: "imported";
        reimported: boolean;
        routeVerified: boolean;
        record: FlowClipImportRow;
      };
      await refresh();
      setMessage(
        result.reimported
          ? "Clip reimported; the existing project and clip row was updated."
          : "Clip imported and its exact Flow route verified.",
      );
      if (!result.routeVerified)
        setError("The imported row did not pass exact route verification.");
    } catch (caught) {
      const code =
        caught instanceof Error && "code" in caught
          ? String((caught as Error & { code?: unknown }).code ?? "")
          : caught instanceof Error
            ? caught.message
            : "";
      setError(
        code.includes("flow_clip_project_mismatch")
          ? "Import blocked: the detail route belongs to a different Flow project."
          : code.includes("flow_clip_identity_missing")
            ? "Import blocked: the current detail page did not expose a clip UUID."
            : code.includes("flow_clip_route_identity_mismatch")
              ? "Import blocked: the page clip UUID did not match its detail route."
              : code.includes("flow_clip_document_changed")
                ? "Import blocked: the verified Flow document or clip changed during inspection."
                : code.includes("flow_target_document_changed")
                  ? "Import blocked: the selected Flow page no longer matches its verified project."
                  : code.includes("flow_clip_detail_route_required")
                    ? "Open a verified Flow /edit/ detail view before importing a clip."
                    : "Flow clip import failed; no row was added unless readback confirms it.",
      );
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const download1080p = async (row: FlowClipImportRow) => {
    setDownloadProofPending(true);
    setError(undefined);
    setDownloadErrors((previous) => ({ ...previous, [row.id]: "" }));
    setMessage(undefined);
    try {
      const granted = await chrome.permissions.request({
        permissions: ["downloads"],
      });
      if (!granted) {
        setDownloadErrors((previous) => ({
          ...previous,
          [row.id]: "Allow Chrome downloads access to track this file.",
        }));
        return;
      }
      const previous = downloadReport?.automaticDownload;
      const result = (await persistenceClient.request("flow.clipDownload.start", {
        recordId: row.id,
        allowNewAttempt: Boolean(
          previous?.recordId === row.id && previous.dispatchState !== "preparing",
        ),
      })) as FlowGalleryDownloadDiagnostic;
      setLastStartedDownload(result);
    } catch (caught) {
      setDownloadErrors((previous) => ({
        ...previous,
        [row.id]:
        caught instanceof Error
          ? caught.message
          : "Download could not be started. Review Flow and Chrome downloads before another attempt.",
      }));
    } finally {
      setDownloadProofPending(false);
    }
  };

  const armDownload1080p = async (row: FlowClipImportRow) => {
    setDownloadProofPending(true);
    setDownloadProofs((previous) => ({ ...previous, [row.id]: undefined }));
    setError(undefined);
    try {
      if (typeof chrome === "undefined" || !chrome.permissions?.request) {
        setError("Chrome permission requests are unavailable in this dashboard.");
        return;
      }
      const granted = await chrome.permissions.request({
        permissions: ["downloads"],
      });
      if (!granted) {
        setError("Chrome downloads permission was not granted; no diagnostic was armed.");
        return;
      }
      const result = (await persistenceClient.request(
        "flow.clipDownloadProof.arm",
        { recordId: row.id },
      )) as FlowClipDownloadProofResult;
      setDownloadProofs((previous) => ({ ...previous, [row.id]: result }));
    } catch (caught) {
      const code =
        caught instanceof Error && "code" in caught
          ? String((caught as Error & { code?: unknown }).code ?? "")
          : caught instanceof Error
            ? caught.message
            : "";
      setError(
        code.includes("flow_detail_download_menu_not_ready")
          ? "Capture blocked: open the target detail page's Download media menu with 1080p Upscaled visible and enabled, then arm."
          : code.includes("flow_clip_detail_route_mismatch")
            ? "Capture blocked: the selected Flow tab is not on the imported target clip's exact detail route."
            : code.includes("flow_clip_not_in_single_row_scope")
              ? "Capture blocked: this row is outside the one-clip diagnostic scope."
              : "The one-shot Flow diagnostic could not arm; no quality selection was made.",
      );
    } finally {
      setDownloadProofPending(false);
    }
  };

  return (
    <section className={styles.clipManager} aria-label="Imported Flow clips">
      {downloadMode ? (
        <>
          <div className={styles.clipToolbar}>
            <div className={styles.clipToolbarTitle}>
              <h2 id="flow-downloads-heading" className={styles.clipListHeading}>
                Flow Downloads
              </h2>
              <span className={styles.clipCount}>
                {rowsLoaded
                  ? `${rows.length} imported ${rows.length === 1 ? "clip" : "clips"}`
                  : "Imported clip count unavailable"}
              </span>
            </div>
            <div className={styles.clipToolbarActions}>
              <Button
                variant="secondary"
                disabled={pending || galleryImport?.status === "scanning" || downloadActive}
                loading={pending}
                aria-describedby="flow-clip-workflow"
                onClick={() => void importCurrent()}
              >
                Import open clip
              </Button>
              <Button
                disabled={pending || galleryImportPending || galleryImport?.status === "scanning" || downloadActive || downloadProofPending}
                loading={galleryImportPending}
                aria-describedby="flow-clip-workflow"
                onClick={() => void importProjectVideos()}
              >
                Import project videos
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                aria-describedby="flow-clip-workflow"
                onClick={() => void refresh()}
              >
                Refresh list
              </Button>
            </div>
          </div>
          <p id="flow-clip-workflow" className={styles.clipWorkflow}>
            Import the clip open in the verified Flow tab, then open it or request its 1080p download. Status reflects only the current attempt; previous downloads are not tracked here.
          </p>
        </>
      ) : (
        <>
          <h4 id="flow-clip-import-title">Flow video clip import · proof of concept</h4>
          <p className={styles.disabledReason}>
            On a verified Flow /edit/ detail view, import its route identity, title, and thumbnail metadata already present in the page. Same-title clips remain separate by project and clip ID.
          </p>
          <p className={styles.disabledReason}>
            Open the clip's Download media menu in the verified detail tab, then arm a one-shot capture. The capture waits for your trusted 1080p Upscaled selection; it never selects a quality.
          </p>
          <div className={styles.clipToolbarActions}>
            <Button disabled={pending} loading={pending} onClick={() => void importCurrent()}>
              Import open clip
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => void refresh()}>
              Refresh list
            </Button>
          </div>
        </>
      )}
      {message ? <p className={styles.clipMessage} role="status">{message}</p> : null}
      {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
      {downloadMode && galleryImport ? (
        <section className={styles.galleryImportProgress} aria-label="Project video import progress" aria-live="polite">
          <div className={styles.galleryImportProgressHeader}>
            <strong>
              {galleryImport.status === "scanning"
                ? "Scanning Flow Videos gallery"
                : galleryImport.status === "completed"
                  ? "Gallery scan complete"
                  : galleryImport.status === "incomplete"
                    ? "Gallery scan incomplete"
                  : galleryImport.status === "cancelled"
                    ? "Gallery scan cancelled"
                    : galleryImport.status === "failed"
                      ? "Gallery scan failed"
                    : galleryImport.status === "stopped"
                      ? "Gallery scan stopped"
                      : "Gallery scan"}
            </strong>
            {galleryImport.status === "scanning" ? (
              <Button variant="quiet" size="compact" disabled={galleryImportPending} onClick={() => void cancelProjectVideoImport()}>
                Cancel
              </Button>
            ) : null}
          </div>
          <p className={styles.clipMessage}>
            Discovered {galleryImport.discovered} · Imported {galleryImport.imported} · Already present {galleryImport.alreadyPresent} · Unresolved {galleryImport.unresolved} · Scan {galleryImport.scanCompleteness === "pending" ? "in progress" : galleryImport.scanCompleteness}
          </p>
          {galleryImport.failureReason ? (
            <p className={styles.clipMessage}>
              Preflight failure: {galleryFailureLabel(galleryImport.failureReason)}
            </p>
          ) : null}
          {galleryImport.reason && !galleryImport.failureReason ? (
            <p className={styles.clipMessage}>
              {galleryImport.reason === "bound_reached"
                ? "The configured scan bound was reached."
                : galleryImport.reason === "identity_deduplication_unavailable"
                  ? "Some cards lacked stable identities, so Gallery coverage could not be safely deduplicated."
                : galleryImport.reason === "coverage_unproven"
                  ? "Gallery coverage could not be established."
                  : galleryImport.reason === "cancelled"
                    ? "Import stopped at your request."
                    : galleryImport.reason === "connection_lost"
                      ? "The verified Flow connection was lost."
                      : galleryImport.reason === "navigation_changed"
                        ? "The selected Flow page changed during scanning."
                        : galleryImport.reason === "ambiguous_identity"
                          ? "Import stopped because a card identity was ambiguous."
                          : galleryImport.reason === "gallery_unavailable"
                            ? "The Videos gallery could not be safely read."
                            : "Import stopped because a Flow download is active."}
            </p>
          ) : null}
          {galleryImport.unresolvedCards.length ? (
            <ul className={styles.galleryImportUnresolved} aria-label="Unresolved project video cards">
              {galleryImport.unresolvedCards.map((card, index) => (
                <li key={`${card.reason}-${index}`}>
                  {card.title || "Untitled video"} · {card.reason.replaceAll("_", " ")}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {rows.length ? (
        <ul className={styles.clipList} aria-label="Imported Flow clips">
          {rows.map((row) => {
            const currentReport = downloadReport?.automaticDownload?.recordId === row.id
              ? downloadReport
              : undefined;
            const status = downloadMode
              ? attemptStatus(currentReport, row.id)
              : { label: row.routeVerified ? "Route verified" : "Route not verified", state: row.routeVerified ? "complete" : "warning" };
            const allowDownloadAgain = Boolean(
              currentReport?.automaticDownload &&
              currentReport.automaticDownload.dispatchState !== "preparing" &&
              !downloadActive,
            );
            return (
              <li className={styles.clipCard} key={row.id}>
                <div className={styles.clipPlaceholder} aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M8 5.8c0-.78.85-1.26 1.52-.86l9.2 5.49a1 1 0 0 1 0 1.72l-9.2 5.49A1 1 0 0 1 8 16.78V5.8Z" />
                  </svg>
                </div>
                <div className={styles.clipCardBody}>
                  <div className={styles.clipCardTitleRow}>
                    <div>
                      <h4 className={styles.clipTitle}>{displayClipTitle(row)}</h4>
                      {!hasGenericFlowTitle(row) ? (
                        <p className={styles.clipShortId}>Clip · {row.clipId.slice(0, 8)}</p>
                      ) : null}
                    </div>
                    <span
                      className={styles.clipStatus}
                      data-state={status.state}
                      aria-label={`Current attempt: ${status.label}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  {downloadMode ? (
                    <>
                      <div className={styles.clipActions}>
                        <a className={styles.secondaryAction} href={row.detailUrl} target="_blank" rel="noreferrer">
                          Open in Flow
                        </a>
                        <Button
                          disabled={pending || downloadProofPending || downloadActive || !row.routeVerified}
                          loading={downloadProofPending}
                          onClick={() => void download1080p(row)}
                        >
                          {allowDownloadAgain ? "Download again" : "Download 1080p"}
                        </Button>
                      </div>
                      {downloadErrors[row.id] ? (
                        <p className={styles.fieldError} role="alert">{downloadErrors[row.id]}</p>
                      ) : null}
                      {currentReport ? (
                        <div className={styles.clipAttemptStatus} role="status" aria-live="polite">
                          <p><strong>Chrome download</strong><span>{chromeCompletionLabel(currentReport)}</span></p>
                          <p><strong>Clip association</strong><span>Unverified</span></p>
                          <p><strong>Chrome file-exists check</strong><span>{fileExistsLabel(currentReport.detailFileResolutionStatus)}</span></p>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className={styles.clipRouteStatus}>
                        {row.routeVerified ? "Exact detail route verified" : "Route not verified"}
                      </p>
                      {isFlow1080pProofClip(row.clipId) ? (
                        <div className={styles.clipActions}>
                          <Button
                            variant="secondary"
                            disabled={downloadProofPending || !row.routeVerified}
                            loading={downloadProofPending}
                            onClick={() => void armDownload1080p(row)}
                          >
                            Arm one-shot 1080p capture
                          </Button>
                          {downloadProofs[row.id] ? (
                            <p className={styles.clipCount} role="status">
                              {downloadProofs[row.id]!.status === "armed"
                                ? "Capture armed; make one user-initiated 1080p Upscaled selection."
                                : "Capture is no longer armed; review the diagnostic above."}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                  <details className={styles.clipDetails}>
                    <summary>Details</summary>
                    <dl>
                      <div><dt>Project UUID</dt><dd><code>{row.projectId}</code></dd></div>
                      <div><dt>Clip UUID</dt><dd><code>{row.clipId}</code></dd></div>
                      <div><dt>Imported route</dt><dd>{row.routeVerified ? "Verified for this imported row" : "Not verified"}</dd></div>
                      {row.galleryImportMethod ? <div><dt>Gallery import method</dt><dd>{row.galleryImportMethod === "native_card_navigation" ? "Native card navigation; source Gallery asset unavailable" : "Source Gallery asset evidence"}</dd></div> : null}
                      <div><dt>Gallery asset UUID</dt><dd>{row.galleryAssetId ? <code>{row.galleryAssetId}</code> : "Not captured from Gallery"}</dd></div>
                      {row.detailSelectedAssetId ? <div><dt>Detail selected asset UUID</dt><dd><code>{row.detailSelectedAssetId}</code></dd></div> : null}
                      {row.galleryIdentityEvidence ? <div><dt>Gallery mapping evidence</dt><dd>{row.galleryIdentityEvidence === "same_card_detail_link" ? "Detail link observed on the same Gallery card" : "Detail selected asset matched the source card"}</dd></div> : null}
                      <div><dt>Thumbnail metadata</dt><dd>{row.thumbnail.available
                        ? `${row.thumbnail.width ?? "Unknown"} × ${row.thumbnail.height ?? "Unknown"}; ${row.thumbnail.fingerprint ? `fingerprint ${row.thumbnail.fingerprint}` : "no fingerprint"}`
                        : "Not available"}</dd></div>
                      {currentReport?.automaticDownload ? (
                        <>
                          <div><dt>Attempt stage</dt><dd>{currentReport.automaticDownload.failureStage ?? currentReport.automaticDownload.dispatchState}</dd></div>
                          <div><dt>Native input attempted</dt><dd>{currentReport.automaticDownload.inputAttempted === undefined ? "Not recorded" : currentReport.automaticDownload.inputAttempted ? "Yes" : "No"}</dd></div>
                          <div><dt>Selected asset fingerprint</dt><dd><code>{currentReport.automaticDownload.selectedAssetFingerprint}</code></dd></div>
                          {currentReport.automaticDownload.failureCode ? <div><dt>Failure code</dt><dd>{currentReport.automaticDownload.failureCode}</dd></div> : null}
                        </>
                      ) : null}
                    </dl>
                    {currentReport ? (
                      <p className={styles.clipCount}>
                        Chrome's file-exists metadata does not decode the media. The selected thumbnail asset does not establish clip-to-output or output-to-blob provenance.
                      </p>
                    ) : null}
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.disabledReason}>
          {rowsLoaded
            ? "No Flow clips imported yet."
            : rowsLoading
              ? "Imported Flow clips are loading."
              : "Imported Flow clips could not be loaded."}
        </p>
      )}
    </section>
  );
}
