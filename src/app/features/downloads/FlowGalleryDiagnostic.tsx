import { useCallback, useEffect, useState } from "react";
import {
  diagnoseFlowRouteAssetBlobLink,
  diagnoseFlowDownloadMediaIdentity,
  type FlowGalleryDownloadDiagnostic,
} from "../../../platforms/flow/downloads";
import type { createFoundationClient } from "../../../shared/messageClient";
import { Button } from "../../components/Button";
import styles from "../../Dashboard.module.css";

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
        Flow Gallery upscale diagnostic
      </h3>
      <p>
        Observe one manually selected 1080p Upscaled action. The extension will
        not click a quality option, start an upscale, or initiate a download.
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
        For menu-only verification, open one card&apos;s More options menu and
        hover Download. Confirm the pre-click evidence below, then stop before
        selecting a quality. A controlled association run may continue with one
        manually chosen quality. Observation expires after 20 minutes.
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
              <dt>Trusted quality click</dt>
              <dd>
                {report.nativeActionObserved
                  ? "1080p Upscaled click observed"
                  : "not observed"}
              </dd>
            </div>
            <div>
              <dt>Requested quality</dt>
              <dd>{report.requestedQuality ?? "not observed"}</dd>
            </div>
            <div>
              <dt>Association</dt>
              <dd>{associationLabel(report)}</dd>
            </div>
            <div>
              <dt>Browser completion</dt>
              <dd>
                {report.matchedDownloadId === undefined
                  ? "not verified"
                  : (report.downloads.find(
                      (item) => item.downloadId === report.matchedDownloadId,
                    )?.state ?? "unknown")}
              </dd>
            </div>
            <div>
              <dt>Saved-file resolution</dt>
              <dd>not inspected</dd>
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
                    <dt>Clip route when menu opened</dt>
                    <dd>{menuStatusLabel}</dd>
                  </div>
                  {report.selectedCard ? (
                    <div>
                      <dt>Temporary route asset trace</dt>
                      <dd>
                        route -&gt; action request path ID: {identityLink.routeToOutput.replaceAll("_", " ")}; asset ID -&gt; exact page blob/download: {identityLink.outputToBlob.replaceAll("_", " ")}. This checks URL path IDs only; it does not inspect response metadata or blob bytes, and it does not change the clip association result.
                      </dd>
                    </div>
                  ) : null}
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
