/* global document, window, location, URL, getComputedStyle, performance, setInterval, clearInterval, setTimeout, clearTimeout, console, ShadowRoot, MutationObserver, copy */
// Arm in DevTools Console on the existing selected Flow project BEFORE a
// separately authorized test. It never clicks or dispatches provider actions.
// Stop with: window.__FLOW_P053_LIFECYCLE_RECORDER__.stop()
// The completed JSON is available as window.__FLOW_P053_LIFECYCLE_RESULT__.
(() => {
  const HANDLE = "__FLOW_P053_LIFECYCLE_RECORDER__";
  const RESULT = "__FLOW_P053_LIFECYCLE_RESULT__";
  const MAX_DURATION_MS = 5 * 60 * 1000;
  const RECONCILE_INTERVAL_MS = 500;
  const MAX_DOCUMENT_ELEMENTS = 20000;
  const MAX_TILE_ELEMENTS = 4000;
  const MAX_TILES = 300;
  const MAX_BASELINE_MEDIA = 1000;
  const MAX_EVENTS = 1200;
  const MAX_ANCESTORS = 80;

  const identityMasks = new Map();
  const nodeTokens = new WeakMap();
  const mediaTokens = new WeakMap();
  let nextNodeToken = 1;
  let nextMediaToken = 1;
  const nodeToken = (element) => {
    if (!nodeTokens.has(element))
      nodeTokens.set(element, `node-${nextNodeToken++}`);
    return nodeTokens.get(element);
  };
  const mediaToken = (element) => {
    if (!mediaTokens.has(element))
      mediaTokens.set(element, `media-node-${nextMediaToken++}`);
    return mediaTokens.get(element);
  };
  const maskIdentity = (value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || normalized.length > 256) return null;
    if (!identityMasks.has(normalized))
      identityMasks.set(normalized, `media-${identityMasks.size + 1}`);
    return identityMasks.get(normalized);
  };
  const tag = (element) => element.localName.toLowerCase();
  const parentAcrossShadow = (element) => {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const composedPath = (element, stopAt = null) => {
    const nodes = [];
    const seen = new Set();
    let current = element;
    while (current && !seen.has(current) && nodes.length < MAX_ANCESTORS) {
      seen.add(current);
      nodes.push(current);
      if (current === stopAt)
        return { nodes, reachedStop: true, truncated: false };
      current = parentAcrossShadow(current);
    }
    return { nodes, reachedStop: false, truncated: Boolean(current) };
  };
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const hidden = composedPath(element).nodes.some((node) =>
      node.matches("[hidden], [inert], [aria-hidden='true']"),
    );
    return (
      element.isConnected &&
      !hidden &&
      style.display !== "none" &&
      !["hidden", "collapse"].includes(style.visibility) &&
      element.getClientRects().length > 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  const scanRoots = (root, limit) => {
    const roots = [root];
    const shadowHosts = [];
    const elements = [];
    let truncated = false;
    if (root.nodeType === 1 && root.shadowRoot) {
      shadowHosts.push(root);
      roots.push(root.shadowRoot);
    }
    for (let index = 0; index < roots.length; index++) {
      for (const element of roots[index].querySelectorAll("*")) {
        if (elements.length >= limit) {
          truncated = true;
          return { roots, shadowHosts, elements, truncated };
        }
        elements.push(element);
        if (element.shadowRoot) {
          shadowHosts.push(element);
          roots.push(element.shadowRoot);
        }
      }
    }
    return { roots, shadowHosts, elements, truncated };
  };
  const route = () => {
    try {
      const url = new URL(location.href);
      if (url.protocol !== "https:" || url.username || url.password)
        return { recognized: false, projectKey: null };
      let projectKey = null;
      if (url.hostname === "flow.google.com")
        projectKey =
          /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/?$/.exec(
            url.pathname,
          )?.[1] ?? null;
      if (url.hostname === "labs.google")
        projectKey =
          /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] ??
          null;
      return { recognized: projectKey !== null, projectKey };
    } catch {
      return { recognized: false, projectKey: null };
    }
  };
  const scanContext = () => {
    const documentScan = scanRoots(document, MAX_DOCUMENT_ELEMENTS);
    const projects = documentScan.elements.filter(
      (element) => tag(element) === "flow-project-page",
    );
    const composerBoundaries = documentScan.elements.filter(
      (element) => tag(element) === "flow-base-prompt-box",
    );
    const verifiedComposers = composerBoundaries.filter((boundary) => {
      const scan = scanRoots(boundary, MAX_TILE_ELEMENTS);
      const richHosts = scan.elements.filter(
        (element) => tag(element) === "flow-rich-text-editor",
      );
      const editors = richHosts.flatMap((host) =>
        scanRoots(host, MAX_TILE_ELEMENTS).elements.filter((element) =>
          element.matches('div[contenteditable="true"][role="textbox"]'),
        ),
      );
      return (
        !scan.truncated &&
        richHosts.length === 1 &&
        editors.length === 1 &&
        isVisible(boundary) &&
        isVisible(editors[0]) &&
        !editors[0].matches("[aria-readonly='true'], [aria-disabled='true']")
      );
    });
    const project = projects.length === 1 ? projects[0] : null;
    const composer =
      verifiedComposers.length === 1 ? verifiedComposers[0] : null;
    const composerPath =
      project && composer ? composedPath(composer, project) : null;
    const projectScan = project
      ? scanRoots(project, MAX_DOCUMENT_ELEMENTS)
      : null;
    const tiles =
      project && projectScan
        ? projectScan.elements.filter(
            (element) =>
              tag(element) === "flow-image-tile" &&
              composedPath(element, project).reachedStop,
          )
        : [];
    return {
      route: route(),
      projectCount: projects.length,
      composerCount: verifiedComposers.length,
      project,
      composer,
      ownsComposer: Boolean(composerPath?.reachedStop),
      composerPathTruncated: composerPath?.truncated ?? false,
      documentScan,
      projectScan,
      tiles,
    };
  };

  const startedAt = performance.now();
  const startedWallClock = new Date().toISOString();
  const sessionToken = `capture-${Math.random().toString(36).slice(2, 10)}`;
  const events = [];
  const captureGaps = [];
  const gapCodes = new Set();
  const baseline = {
    captured: false,
    completeForScopedCandidates: false,
    mediaCandidates: [],
    tileCount: 0,
    unidentifiedTileImageCount: 0,
    repeatedIdentityMasks: [],
    lifecycleMarkers: null,
    tileRelationships: [],
    scanTruncated: false,
  };
  let state = "arming";
  let stopReason = null;
  let stoppedAt = null;
  let observerLoss = false;
  let eventLimitReached = false;
  let previousDocumentHidden = document.hidden;
  let lastContext = null;
  let previousMedia = new Map();
  let previousTiles = new Map();
  let previousMarkers = new Map();
  let previousIdentityCounts = new Map();
  let previousTileRelationships = [];
  let tileSubtreeTruncatedObserved = false;
  let reconcileTimer = null;
  let durationTimer = null;
  let pollTimer = null;
  let documentObserver = null;
  const observedRoots = new Map();
  const closedOverDocument = document;

  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
  const addGap = (code) => {
    if (gapCodes.has(code)) return;
    gapCodes.add(code);
    captureGaps.push({ code, elapsedMs: elapsed() });
  };
  const cleanDetails = (details) => details;
  const record = (type, details = {}) => {
    if (state === "stopped") return;
    if (events.length >= MAX_EVENTS - 1) {
      eventLimitReached = true;
      addGap("event_limit_reached");
      finalize("event_limit_reached", true);
      return;
    }
    events.push({
      sequence: events.length + 1,
      elapsedMs: elapsed(),
      type,
      ...cleanDetails(details),
    });
  };
  const outputBase = () => ({
    diagnostic: "flow-image-lifecycle-recorder-readonly-v1",
    sessionToken,
    startedAt: startedWallClock,
    stoppedAt,
    elapsedMs: elapsed(),
    stopReason,
    observerStatus:
      state === "stopped"
        ? observerLoss
          ? "lost_or_guard_stopped"
          : "stopped"
        : "recording",
    observerLoss,
    eventLimitReached,
    durationLimitMs: MAX_DURATION_MS,
    reconciliationIntervalMs: RECONCILE_INTERVAL_MS,
    selectedProject: lastContext
      ? {
          routeRecognized: lastContext.route.recognized,
          projectMask: lastContext.route.projectKey
            ? maskIdentity(lastContext.route.projectKey)
            : null,
          uniqueBoundaryOwnedComposer: lastContext.ownsComposer,
        }
      : null,
    documentBinding: {
      topFrame: window.top === window,
      localDocumentToken: "document-1",
      browserDocumentIdAvailableToPageScript: false,
      iframeCount: closedOverDocument.querySelectorAll("iframe").length,
      unloadObserved: observerLoss && stopReason === "pagehide",
    },
    preArmLifecycleHistoryCaptured: false,
    baseline: { ...baseline },
    currentSummary: state === "stopped" ? finalSummary : getSummarySafe(),
    captureGaps: [...captureGaps],
    truncation: {
      maxDocumentElements: MAX_DOCUMENT_ELEMENTS,
      maxTileElements: MAX_TILE_ELEMENTS,
      maxTiles: MAX_TILES,
      maxBaselineMedia: MAX_BASELINE_MEDIA,
      maxEvents: MAX_EVENTS,
      eventCount: events.length,
      documentScanTruncated: Boolean(lastContext?.documentScan?.truncated),
      projectScanTruncated: Boolean(lastContext?.projectScan?.truncated),
      tileListTruncated: Boolean(lastContext?.tiles?.length > MAX_TILES),
      tileSubtreeTruncatedObserved,
      baselineMediaTruncated:
        baseline.scanTruncated &&
        baseline.mediaCandidates.length >= MAX_BASELINE_MEDIA,
      eventListTruncated: eventLimitReached,
    },
    events: [...events],
    scopeLimitations: {
      openShadowRootsObserved: true,
      closedShadowRootsInspectable: false,
      crossOriginFramesInspected: false,
      browserDocumentIdAvailableToPageScript: false,
      eventHistoryBeforeRecorderArmAvailable: false,
      mutationObserverDropCanBeProvenAbsent: false,
    },
    interpretationLimits: {
      mediaIdSemanticsVerified: false,
      repeatedMediaIdMeansSameLogicalOutput: false,
      DOMReplacementMeansNewVariant: false,
      imageLoadOrErrorProvesProviderOutcome: false,
      postDispatchAppearanceProvesOwnership: false,
      variantCountInferred: false,
      attemptAttributionProven: false,
      providerSuccessOrFailureInferred: false,
    },
    privacy: {
      promptTextReadOrReturned: false,
      pageTextOrLabelsReturned: false,
      rawMediaUrlsReturned: false,
      accountDataOrCredentialsReturned: false,
      storageAccessed: false,
      networkReplayed: false,
      clicksOrProviderActionsPerformed: false,
      frameworkPrivateStateAccessed: false,
    },
  });
  let finalSummary = null;
  const getSummarySafe = () => {
    try {
      const context = scanContext();
      const scan = context.project
        ? scanRoots(context.project, MAX_DOCUMENT_ELEMENTS)
        : null;
      const images = context.tiles.flatMap((tile) =>
        scanRoots(tile, MAX_TILE_ELEMENTS).elements.filter(
          (element) =>
            tag(element) === "img" && element.hasAttribute("data-media-id"),
        ),
      );
      const identities = new Map();
      for (const image of images) {
        const id = maskIdentity(image.getAttribute("data-media-id"));
        if (id) identities.set(id, (identities.get(id) ?? 0) + 1);
      }
      return {
        projectBoundaryCount: context.projectCount,
        verifiedComposerCount: context.composerCount,
        projectOwnsComposer: context.ownsComposer,
        renderedTileCount: context.tiles.length,
        identifiedImageCount: images.length,
        repeatedIdentityMasks: [...identities]
          .filter(([, count]) => count > 1)
          .map(([identityMask, count]) => ({
            identityMask,
            renderedNodeCount: count,
          })),
        projectScanTruncated: scan?.truncated ?? null,
      };
    } catch {
      return { status: "summary_unavailable" };
    }
  };
  const buildMarkers = (context) => {
    const markers = new Map();
    if (!context.project || !context.projectScan) return markers;
    const tileSet = new Set(context.tiles);
    const elements = [context.project, ...context.projectScan.elements];
    for (const element of elements) {
      const kinds = new Set();
      const roleValue = element.getAttribute("role") ?? "";
      const stateValue = element.getAttribute("data-state") ?? "";
      const testId = element.getAttribute("data-testid") ?? "";
      const classValue =
        typeof element.className === "string" ? element.className : "";
      const metadata = `${stateValue} ${testId} ${classValue}`;
      if (roleValue === "progressbar") kinds.add("progressbar");
      if (roleValue === "status") kinds.add("status");
      if (roleValue === "alert") kinds.add("alert");
      if (element.getAttribute("aria-busy") === "true") kinds.add("busy");
      if (
        /loading|spinner|pending|progress/i.test(metadata) ||
        element.getAttribute("data-loading") === "true"
      )
        kinds.add("loading");
      if (/generating|processing/i.test(metadata)) kinds.add("processing");
      if (/complete|completed|finished|success|ready|done/i.test(metadata))
        kinds.add("completed");
      if (
        /error|failed|failure|blocked|rejected/i.test(metadata) ||
        element.hasAttribute("data-error")
      )
        kinds.add("error");
      const nearestTile = composedPath(element).nodes.find(
        (node) => tag(node) === "flow-image-tile" && tileSet.has(node),
      );
      for (const kind of kinds)
        markers.set(`${nodeToken(element)}:${kind}`, {
          node: nodeToken(element),
          tag: tag(element),
          kind,
          visible: isVisible(element),
          scope: nearestTile ? "tile" : "project",
          tileNode: nearestTile ? nodeToken(nearestTile) : null,
        });
    }
    return markers;
  };
  const summarizeMarkers = (markers) => {
    const summary = {
      total: 0,
      visible: 0,
      hiddenOrNonRendered: 0,
      byKind: {},
      byScope: { project: 0, tile: 0 },
      byTile: {},
    };
    for (const marker of markers.values()) {
      summary.total++;
      if (marker.visible) summary.visible++;
      else summary.hiddenOrNonRendered++;
      summary.byKind[marker.kind] = (summary.byKind[marker.kind] ?? 0) + 1;
      summary.byScope[marker.scope]++;
      if (marker.tileNode) {
        const tileSummary = (summary.byTile[marker.tileNode] ??= {
          markerCount: 0,
          byKind: {},
        });
        tileSummary.markerCount++;
        tileSummary.byKind[marker.kind] =
          (tileSummary.byKind[marker.kind] ?? 0) + 1;
      }
    }
    return summary;
  };
  const buildTileRelationships = (current, markers) => {
    const byTile = new Map();
    for (const tile of current.tiles.values()) {
      byTile.set(tile.id, {
        tileNode: tile.id,
        visible: tile.visible,
        mediaCandidates: [],
        lifecycleMarkers: [],
      });
    }
    for (const media of current.media.values()) {
      byTile.get(media.tileId)?.mediaCandidates.push({
        mediaNode: media.id,
        identityMask: media.identity,
        visible: media.visible,
        complete: media.complete,
        naturalWidth: media.naturalWidth,
        naturalHeight: media.naturalHeight,
      });
    }
    for (const marker of markers.values()) {
      if (!marker.tileNode) continue;
      byTile.get(marker.tileNode)?.lifecycleMarkers.push({
        markerNode: marker.node,
        markerTag: marker.tag,
        markerKind: marker.kind,
        visible: marker.visible,
      });
    }
    return [...byTile.values()];
  };
  const scanCurrent = (context) => {
    const tiles = new Map();
    const media = new Map();
    let unidentifiedTileImageCount = 0;
    let tileListTruncated = context.tiles.length > MAX_TILES;
    let tileSubtreeTruncated = false;
    const boundedTiles = context.tiles.slice(0, MAX_TILES);
    for (const tile of boundedTiles) {
      const tileId = nodeToken(tile);
      tiles.set(tileId, { id: tileId, visible: isVisible(tile) });
      const scan = scanRoots(tile, MAX_TILE_ELEMENTS);
      if (scan.truncated) {
        tileSubtreeTruncated = true;
        tileSubtreeTruncatedObserved = true;
        addGap("tile_subtree_scan_truncated");
      }
      for (const element of scan.elements) {
        if (tag(element) !== "img") continue;
        const nearestTile = composedPath(element).nodes.find(
          (node) => tag(node) === "flow-image-tile",
        );
        if (nearestTile !== tile) continue;
        if (!element.hasAttribute("data-media-id")) {
          unidentifiedTileImageCount++;
          continue;
        }
        const rawIdentity = element.getAttribute("data-media-id");
        const identity = maskIdentity(rawIdentity);
        if (!identity) {
          addGap("media_identity_missing_or_over_limit");
          continue;
        }
        const id = mediaToken(element);
        media.set(id, {
          id,
          identity,
          rawIdentity,
          tileId,
          visible: isVisible(element),
          complete: element.complete,
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
          sourceAttributePresent:
            element.hasAttribute("src") || element.hasAttribute("srcset"),
        });
      }
    }
    if (tileListTruncated) addGap("tile_list_truncated");
    if (context.documentScan.truncated) addGap("document_scan_truncated");
    if (context.projectScan?.truncated) addGap("project_scan_truncated");
    return {
      tiles,
      media,
      unidentifiedTileImageCount,
      tileListTruncated,
      tileSubtreeTruncated,
    };
  };
  const attachRoot = (root) => {
    if (observedRoots.has(root)) return;
    const observer = new MutationObserver(() => scheduleReconcile("mutation"));
    observer.observe(root, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    const onImageEvent = (event) => {
      try {
        const element = event.target;
        if (!element || tag(element) !== "img") return;
        const path = composedPath(element, lastContext?.project ?? null);
        if (!path.reachedStop) return;
        if (!element.hasAttribute("data-media-id")) {
          addGap("image_event_without_media_identity");
          record(
            event.type === "error"
              ? "unidentified_image_error_event"
              : "unidentified_image_load_event",
            {
              mediaNode: mediaToken(element),
              identityMask: null,
              attributionUnavailable: true,
            },
          );
          return;
        }
        const mediaId = maskIdentity(element.getAttribute("data-media-id"));
        if (!mediaId)
          return addGap("image_event_identity_missing_or_over_limit");
        record(
          event.type === "error" ? "image_error_event" : "image_load_event",
          {
            mediaNode: mediaToken(element),
            identityMask: mediaId,
            complete: element.complete,
            naturalWidth: element.naturalWidth,
            naturalHeight: element.naturalHeight,
            positiveNaturalDimensions:
              element.naturalWidth > 0 && element.naturalHeight > 0,
            eventIsSupportingResourceEvidenceOnly: true,
          },
        );
      } catch {
        addGap("image_event_capture_failed");
      }
    };
    root.addEventListener("load", onImageEvent, true);
    root.addEventListener("error", onImageEvent, true);
    observedRoots.set(root, { observer, onImageEvent });
  };
  const disconnectRoots = () => {
    for (const [root, entry] of observedRoots) {
      entry.observer.disconnect();
      root.removeEventListener("load", entry.onImageEvent, true);
      root.removeEventListener("error", entry.onImageEvent, true);
    }
    observedRoots.clear();
  };
  const syncObservedRoots = (context) => {
    const desired = new Set(
      context.project && context.projectScan
        ? [
            context.project,
            ...context.projectScan.roots.filter(
              (root) => root instanceof ShadowRoot,
            ),
          ]
        : [],
    );
    for (const [root, entry] of observedRoots) {
      if (desired.has(root)) continue;
      entry.observer.disconnect();
      root.removeEventListener("load", entry.onImageEvent, true);
      root.removeEventListener("error", entry.onImageEvent, true);
      observedRoots.delete(root);
    }
    for (const root of desired) attachRoot(root);
  };
  const finalize = (reason, automatic = false) => {
    if (state === "stopped") return window[RESULT];
    if (!automatic) record("recording_stopped", { reason });
    state = "stopped";
    stopReason = reason;
    stoppedAt = new Date().toISOString();
    if (reconcileTimer !== null) clearTimeout(reconcileTimer);
    if (durationTimer !== null) clearTimeout(durationTimer);
    if (pollTimer !== null) clearInterval(pollTimer);
    if (documentObserver) documentObserver.disconnect();
    window.removeEventListener("pagehide", onPageHide, true);
    window.removeEventListener("popstate", onRouteEvent, true);
    window.removeEventListener("hashchange", onRouteEvent, true);
    disconnectRoots();
    finalSummary = getSummarySafe();
    const output = outputBase();
    const json = JSON.stringify(output, null, 2);
    window[RESULT] = output;
    window[HANDLE] = { state: "stopped", resultName: RESULT, stop: () => json };
    let copiedToDevtoolsClipboard = false;
    if (typeof copy === "function") {
      try {
        copy(json);
        copiedToDevtoolsClipboard = true;
      } catch {
        copiedToDevtoolsClipboard = false;
      }
    }
    console.log(
      JSON.stringify(
        {
          diagnostic: output.diagnostic,
          state: "stopped",
          stopReason,
          elapsedMs: output.elapsedMs,
          eventCount: events.length,
          baselineCandidates: baseline.mediaCandidates.length,
          captureGapCount: captureGaps.length,
          observerLoss,
          resultName: RESULT,
          fullJsonCopiedToDevtoolsClipboard: copiedToDevtoolsClipboard,
          fullJsonResultName: `window.${RESULT}`,
          manualCopyCommand: `copy(JSON.stringify(window.${RESULT}, null, 2))`,
        },
        null,
        2,
      ),
    );
    if (!copiedToDevtoolsClipboard) console.log(json);
    return json;
  };
  const onPageHide = () => {
    observerLoss = true;
    addGap("document_pagehide_observation_loss");
    record("observer_lost", { reason: "pagehide" });
    finalize("pagehide", true);
  };
  const onRouteEvent = () => scheduleReconcile("route_event");
  let reconcileQueued = false;
  const scheduleReconcile = (trigger) => {
    if (state !== "recording" || reconcileQueued) return;
    reconcileQueued = true;
    reconcileTimer = setTimeout(() => {
      reconcileQueued = false;
      reconcile(trigger);
    }, 0);
  };
  const validateContext = (next) => {
    if (closedOverDocument !== document || !closedOverDocument.isConnected) {
      observerLoss = true;
      addGap("browser_document_changed_or_unavailable");
      record("observer_lost", { reason: "document_context_unavailable" });
      finalize("document_context_unavailable", true);
      return false;
    }
    const projectChanged =
      next.project !== lastContext.project ||
      next.projectCount !== 1 ||
      next.composer !== lastContext.composer ||
      !next.ownsComposer;
    const routeChanged =
      next.route.recognized !== lastContext.route.recognized ||
      next.route.projectKey !== lastContext.route.projectKey;
    if (projectChanged || routeChanged) {
      observerLoss = true;
      addGap(
        projectChanged
          ? "project_or_composer_binding_changed"
          : "selected_project_route_changed",
      );
      record("project_or_document_binding_changed", {
        projectChanged,
        routeChanged,
        currentProjectMask: next.route.projectKey
          ? maskIdentity(next.route.projectKey)
          : null,
      });
      record("observer_lost", {
        reason: "project_or_document_binding_changed",
      });
      finalize("project_or_document_binding_changed", true);
      return false;
    }
    if (next.documentScan.truncated || next.projectScan?.truncated) {
      observerLoss = true;
      addGap(
        next.documentScan.truncated
          ? "document_scan_truncated"
          : "project_scan_truncated",
      );
      record("observer_lost", { reason: "bounded_scan_incomplete" });
      finalize("bounded_scan_incomplete", true);
      return false;
    }
    return true;
  };
  const reconcile = (trigger) => {
    if (state !== "recording") return;
    try {
      const next = scanContext();
      if (!validateContext(next)) return;
      syncObservedRoots(next);
      const current = scanCurrent(next);
      const newMarkers = buildMarkers(next);
      const tileRelationships = buildTileRelationships(current, newMarkers);
      const tileAdded = [...current.tiles.keys()].filter(
        (id) => !previousTiles.has(id),
      );
      const tileRemoved = [...previousTiles.keys()].filter(
        (id) => !current.tiles.has(id),
      );
      for (const id of tileAdded)
        record("tile_added", {
          tileNode: id,
          visible: current.tiles.get(id).visible,
          trigger,
        });
      for (const id of tileRemoved)
        record("tile_removed", { tileNode: id, trigger });
      for (const [id, media] of current.media) {
        const previous = previousMedia.get(id);
        if (!previous)
          record("media_candidate_added", {
            mediaNode: id,
            identityMask: media.identity,
            tileNode: media.tileId,
            visible: media.visible,
            trigger,
          });
        else {
          if (previous.identity !== media.identity)
            record("media_identity_changed", {
              mediaNode: id,
              previousIdentityMask: previous.identity,
              identityMask: media.identity,
              tileNode: media.tileId,
            });
          if (previous.tileId !== media.tileId)
            record("media_tile_ownership_changed", {
              mediaNode: id,
              previousTileNode: previous.tileId,
              tileNode: media.tileId,
            });
          if (
            previous.complete !== media.complete ||
            previous.naturalWidth !== media.naturalWidth ||
            previous.naturalHeight !== media.naturalHeight
          )
            record("image_resource_state_changed", {
              mediaNode: id,
              identityMask: media.identity,
              complete: media.complete,
              naturalWidth: media.naturalWidth,
              naturalHeight: media.naturalHeight,
              supportingEvidenceOnly: true,
            });
        }
      }
      for (const [id, media] of previousMedia)
        if (!current.media.has(id))
          record("media_candidate_removed", {
            mediaNode: id,
            identityMask: media.identity,
            previousTileNode: media.tileId,
            trigger,
          });
      const oldByIdentity = new Map();
      const newByIdentity = new Map();
      for (const media of previousMedia.values())
        oldByIdentity.set(media.identity, [
          ...(oldByIdentity.get(media.identity) ?? []),
          media.id,
        ]);
      for (const media of current.media.values())
        newByIdentity.set(media.identity, [
          ...(newByIdentity.get(media.identity) ?? []),
          media.id,
        ]);
      const allMasks = new Set([
        ...oldByIdentity.keys(),
        ...newByIdentity.keys(),
      ]);
      for (const identity of allMasks) {
        const oldNodes = oldByIdentity.get(identity) ?? [];
        const newNodes = newByIdentity.get(identity) ?? [];
        if (
          newNodes.length > 1 &&
          previousIdentityCounts.get(identity) !== newNodes.length
        )
          record("repeated_identity_count_changed", {
            identityMask: identity,
            renderedNodeCount: newNodes.length,
            noLogicalGroupingInferred: true,
          });
        const removedCount = oldNodes.filter(
          (id) => !current.media.has(id),
        ).length;
        const addedCount = newNodes.filter(
          (id) => !previousMedia.has(id),
        ).length;
        if (removedCount > 0 && addedCount > 0)
          record("same_mask_dom_replacement_observed", {
            identityMask: identity,
            removedNodeCount: removedCount,
            addedNodeCount: addedCount,
            noVariantInference: true,
          });
      }
      for (const [key, marker] of newMarkers)
        if (!previousMarkers.has(key))
          record("lifecycle_marker_added", {
            markerNode: marker.node,
            markerTag: marker.tag,
            markerKind: marker.kind,
            visible: marker.visible,
            scope: marker.scope,
            tileNode: marker.tileNode,
            trigger,
          });
      for (const [key, marker] of previousMarkers)
        if (!newMarkers.has(key))
          record("lifecycle_marker_removed", {
            markerNode: marker.node,
            markerTag: marker.tag,
            markerKind: marker.kind,
            scope: marker.scope,
            tileNode: marker.tileNode,
            trigger,
          });
      if (
        JSON.stringify(tileRelationships) !==
        JSON.stringify(previousTileRelationships)
      )
        record("tile_scoped_relationships_observed", {
          relationships: tileRelationships,
          relationshipOnly: true,
        });
      if (
        current.unidentifiedTileImageCount !==
        baseline.unidentifiedTileImageCount
      )
        record("unidentified_tile_image_count_changed", {
          count: current.unidentifiedTileImageCount,
        });
      if (document.hidden !== previousDocumentHidden) {
        previousDocumentHidden = document.hidden;
        record("document_visibility_changed", {
          hidden: previousDocumentHidden,
          visibilityOnly: true,
        });
      }
      previousMedia = current.media;
      previousTiles = current.tiles;
      previousMarkers = newMarkers;
      previousTileRelationships = tileRelationships;
      previousIdentityCounts = new Map(
        [...newByIdentity].map(([identity, nodes]) => [identity, nodes.length]),
      );
      lastContext = next;
    } catch {
      observerLoss = true;
      addGap("observer_reconciliation_failed");
      record("observer_lost", { reason: "reconciliation_exception" });
      finalize("reconciliation_failed", true);
    }
  };

  if (window[HANDLE] && window[HANDLE].state === "recording") {
    console.log(
      JSON.stringify({
        diagnostic: "flow-image-lifecycle-recorder-readonly-v1",
        status: "existing_recording_present",
        action: "use_existing_named_handle",
      }),
    );
    return null;
  }
  let initial;
  try {
    initial = scanContext();
  } catch {
    console.log(
      JSON.stringify({
        diagnostic: "flow-image-lifecycle-recorder-readonly-v1",
        status: "preflight_failed",
        reason: "initial_scan_failed",
      }),
    );
    return null;
  }
  const refusal =
    !window.top || window.top !== window
      ? "not_top_frame"
      : !initial.route.recognized
        ? "selected_flow_project_route_unrecognized"
        : initial.documentScan.truncated
          ? "document_scan_truncated"
          : initial.projectCount !== 1
            ? "project_boundary_not_unique"
            : initial.composerCount !== 1 || !initial.ownsComposer
              ? "verified_project_composer_ownership_missing"
              : initial.projectScan?.truncated
                ? "project_scan_truncated"
                : initial.tiles.length > MAX_TILES
                  ? "tile_count_over_limit"
                  : null;
  if (refusal) {
    window[RESULT] = {
      diagnostic: "flow-image-lifecycle-recorder-readonly-v1",
      status: "not_armed",
      reason: refusal,
      noProviderActionPerformed: true,
    };
    console.log(JSON.stringify(window[RESULT], null, 2));
    return null;
  }
  lastContext = initial;
  const initialScan = scanCurrent(initial);
  baseline.captured = true;
  baseline.tileCount = initialScan.tiles.size;
  baseline.unidentifiedTileImageCount = initialScan.unidentifiedTileImageCount;
  baseline.scanTruncated =
    initialScan.tileListTruncated ||
    initialScan.tileSubtreeTruncated ||
    initialScan.media.size > MAX_BASELINE_MEDIA;
  baseline.mediaCandidates = [...initialScan.media.values()]
    .slice(0, MAX_BASELINE_MEDIA)
    .map((media) => ({
      mediaNode: media.id,
      identityMask: media.identity,
      tileNode: media.tileId,
      visible: media.visible,
      complete: media.complete,
      naturalWidth: media.naturalWidth,
      naturalHeight: media.naturalHeight,
      positiveNaturalDimensions:
        media.naturalWidth > 0 && media.naturalHeight > 0,
    }));
  const initialIdentityCounts = new Map();
  for (const media of initialScan.media.values())
    initialIdentityCounts.set(
      media.identity,
      (initialIdentityCounts.get(media.identity) ?? 0) + 1,
    );
  baseline.repeatedIdentityMasks = [...initialIdentityCounts]
    .filter(([, count]) => count > 1)
    .map(([identityMask, renderedNodeCount]) => ({
      identityMask,
      renderedNodeCount,
      groupingInferred: false,
    }));
  baseline.completeForScopedCandidates =
    !baseline.scanTruncated &&
    baseline.unidentifiedTileImageCount === 0 &&
    initial.projectScan?.truncated === false;
  if (!baseline.completeForScopedCandidates)
    addGap("initial_candidate_baseline_incomplete");
  previousMedia = initialScan.media;
  previousTiles = initialScan.tiles;
  previousMarkers = buildMarkers(initial);
  baseline.lifecycleMarkers = summarizeMarkers(previousMarkers);
  previousTileRelationships = buildTileRelationships(
    initialScan,
    previousMarkers,
  );
  baseline.tileRelationships = previousTileRelationships;
  previousIdentityCounts = initialIdentityCounts;
  record("baseline_captured_before_dispatch", {
    tileCount: baseline.tileCount,
    identifiedImageCandidateCount: baseline.mediaCandidates.length,
    unidentifiedTileImageCount: baseline.unidentifiedTileImageCount,
    repeatedIdentityMaskCount: baseline.repeatedIdentityMasks.length,
    baselineCompleteForScopedCandidates: baseline.completeForScopedCandidates,
    projectMask: maskIdentity(initial.route.projectKey),
  });
  record("baseline_lifecycle_markers_captured", baseline.lifecycleMarkers);
  record("baseline_tile_scoped_relationships_captured", {
    relationships: baseline.tileRelationships,
    relationshipOnly: true,
  });
  syncObservedRoots(initial);
  documentObserver = new MutationObserver(() =>
    scheduleReconcile("document_structure"),
  );
  if (document.documentElement)
    documentObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  window.addEventListener("pagehide", onPageHide, true);
  window.addEventListener("popstate", onRouteEvent, true);
  window.addEventListener("hashchange", onRouteEvent, true);
  state = "recording";
  pollTimer = setInterval(
    () => reconcile("bounded_reconciliation"),
    RECONCILE_INTERVAL_MS,
  );
  durationTimer = setTimeout(() => {
    record("duration_limit_reached", { durationLimitMs: MAX_DURATION_MS });
    finalize("duration_limit_reached", true);
  }, MAX_DURATION_MS);
  const api = {
    state: "recording",
    sessionToken,
    baselineCandidateCount: baseline.mediaCandidates.length,
    maxDurationMs: MAX_DURATION_MS,
    markDispatchBoundary() {
      if (state !== "recording") return null;
      record("operator_marked_dispatch_boundary", {
        operatorMarkerOnly: true,
        notWorkerDispatchProof: true,
      });
      return events.at(-1)?.sequence ?? null;
    },
    stop() {
      return finalize("stopped_by_user", false);
    },
    getResult() {
      return window[RESULT] ?? outputBase();
    },
  };
  window[HANDLE] = api;
  console.log(
    JSON.stringify(
      {
        diagnostic: "flow-image-lifecycle-recorder-readonly-v1",
        status: "recording_armed",
        baselineCandidateCount: baseline.mediaCandidates.length,
        tileCount: baseline.tileCount,
        baselineCompleteForScopedCandidates:
          baseline.completeForScopedCandidates,
        maxDurationMs: MAX_DURATION_MS,
        reconcileEveryMs: RECONCILE_INTERVAL_MS,
        stopCommand: `window.${HANDLE}.stop()`,
        dispatchBoundaryCommand: `window.${HANDLE}.markDispatchBoundary()`,
        resultName: `window.${RESULT}`,
        noProviderActionPerformed: true,
      },
      null,
      2,
    ),
  );
  return api;
})();
