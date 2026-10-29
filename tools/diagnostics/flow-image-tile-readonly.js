/* global document, window, location, URL, getComputedStyle, requestAnimationFrame, console, ShadowRoot, MutationObserver, copy */
// Paste once into DevTools Console for the same explicitly selected Flow project.
// Read-only against the page/provider. If DevTools copy() is available, the full
// JSON report is copied to the clipboard; otherwise the full JSON is logged.
(async () => {
  const maxDocumentElements = 30000;
  const maxTileElements = 5000;
  const maxIdentitySignalsPerTile = 160;
  const maxAncestorDepth = 80;
  const identityAttributePattern =
    /^(?:data-[a-z0-9_-]*(?:id|key|uuid|asset|result|group|variant|generation|creation|media|image|output)[a-z0-9_-]*)$/i;
  const accountAttributePattern = /account|profile|user|tier|billing|avatar/i;
  const lifecycleWords =
    /loading|generating|processing|pending|progress|spinner|complete|completed|finished|success|ready|done|error|failed|failure|blocked|rejected/i;
  const roleAllowlist = new Set([
    "main",
    "region",
    "list",
    "grid",
    "feed",
    "listitem",
    "gridcell",
    "article",
    "status",
    "alert",
    "progressbar",
    "group",
    "application",
    "presentation",
    "none",
  ]);
  const masks = new Map();
  const mask = (value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || normalized.length > 256) return null;
    if (!masks.has(normalized))
      masks.set(normalized, `identity-${masks.size + 1}`);
    return masks.get(normalized);
  };
  const tag = (element) => element.localName.toLowerCase();
  const role = (element) => {
    const value = element.getAttribute("role");
    return value === null
      ? "absent"
      : roleAllowlist.has(value)
        ? value
        : "other";
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const composedAncestors = composedPath(element).nodes;
    const hiddenByComposedAncestor = composedAncestors.some((node) =>
      node.matches("[hidden], [inert], [aria-hidden='true']"),
    );
    return {
      connected: element.isConnected,
      hiddenAttribute: element.hasAttribute("hidden"),
      hiddenAncestor:
        hiddenByComposedAncestor &&
        !element.matches("[hidden], [inert], [aria-hidden='true']"),
      displayNone: style.display === "none",
      visibilityHidden: ["hidden", "collapse"].includes(style.visibility),
      hasClientRects: element.getClientRects().length > 0,
      zeroArea: rect.width <= 0 || rect.height <= 0,
      visible:
        element.isConnected &&
        !hiddenByComposedAncestor &&
        style.display !== "none" &&
        !["hidden", "collapse"].includes(style.visibility) &&
        element.getClientRects().length > 0 &&
        rect.width > 0 &&
        rect.height > 0,
    };
  };
  const parentAcrossShadow = (element) => {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const composedPath = (element, stopAt = null) => {
    const nodes = [];
    const seen = new Set();
    let current = element;
    while (current && !seen.has(current) && nodes.length < maxAncestorDepth) {
      seen.add(current);
      nodes.push(current);
      if (current === stopAt)
        return { nodes, reachedStop: true, truncated: false };
      current = parentAcrossShadow(current);
    }
    return { nodes, reachedStop: false, truncated: Boolean(current) };
  };
  const scanRoots = (root, limit) => {
    const roots = [root];
    const hosts = [];
    const elements = [];
    let truncated = false;
    if (root.nodeType === 1 && root.shadowRoot) {
      hosts.push(root);
      roots.push(root.shadowRoot);
    }
    for (let index = 0; index < roots.length; index++) {
      for (const element of roots[index].querySelectorAll("*")) {
        if (elements.length >= limit) {
          truncated = true;
          return { roots, hosts, elements, truncated };
        }
        elements.push(element);
        if (element.shadowRoot) {
          hosts.push(element);
          roots.push(element.shadowRoot);
        }
      }
    }
    return { roots, hosts, elements, truncated };
  };
  const route = () => {
    try {
      const url = new URL(location.href);
      if (url.protocol !== "https:" || url.username || url.password)
        return { recognized: false, projectMask: null };
      let projectId = null;
      if (url.hostname === "flow.google.com")
        projectId =
          /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/?$/.exec(
            url.pathname,
          )?.[1] ?? null;
      if (url.hostname === "labs.google")
        projectId =
          /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] ??
          null;
      return {
        recognized: projectId !== null,
        projectMask: projectId ? mask(projectId) : null,
      };
    } catch {
      return { recognized: false, projectMask: null };
    }
  };
  const roleOfAncestor = (element) => ({
    tag: tag(element),
    role: role(element),
  });
  const documentScan = scanRoots(document, maxDocumentElements);
  const projectBoundaries = documentScan.elements.filter(
    (element) => tag(element) === "flow-project-page",
  );
  const composerBoundaries = documentScan.elements.filter(
    (element) => tag(element) === "flow-base-prompt-box",
  );
  const verifiedComposers = composerBoundaries.filter((boundary) => {
    const subtree = scanRoots(boundary, maxTileElements);
    const richHosts = subtree.elements.filter(
      (element) => tag(element) === "flow-rich-text-editor",
    );
    const editors = richHosts.flatMap((host) =>
      scanRoots(host, maxTileElements).elements.filter((element) =>
        element.matches('div[contenteditable="true"][role="textbox"]'),
      ),
    );
    return (
      !subtree.truncated &&
      richHosts.length === 1 &&
      editors.length === 1 &&
      visible(boundary).visible &&
      visible(editors[0]).visible &&
      !editors[0].matches("[aria-readonly='true'], [aria-disabled='true']")
    );
  });
  const uniqueProject =
    projectBoundaries.length === 1 ? projectBoundaries[0] : null;
  const uniqueComposer =
    verifiedComposers.length === 1 ? verifiedComposers[0] : null;
  const composerProjectPath =
    uniqueProject && uniqueComposer
      ? composedPath(uniqueComposer, uniqueProject)
      : null;
  const projectOwnsComposer = Boolean(composerProjectPath?.reachedStop);
  const tileElements = documentScan.elements.filter(
    (element) => tag(element) === "flow-image-tile",
  );
  const tileProjectPaths = uniqueProject
    ? new Map(
        tileElements.map((tile) => [tile, composedPath(tile, uniqueProject)]),
      )
    : new Map();
  const tilesInProject = uniqueProject
    ? tileElements.filter((tile) => tileProjectPaths.get(tile)?.reachedStop)
    : [];
  const relevantContainerTags = new Set([
    "flow-tile-container",
    "flow-grid-tile-container",
    "cdk-virtual-scroll-viewport",
  ]);
  const identityCategory = (name) => {
    if (name === "id") return "dom_element_id_not_asset_proof";
    if (
      name === "aria-labelledby" ||
      name === "aria-describedby" ||
      name === "aria-owns"
    )
      return "accessibility_reference_not_asset_proof";
    if (name === "data-testid") return "test_or_dom_identifier_not_asset_proof";
    if (/asset|media|image/i.test(name))
      return "provider_asset_identity_candidate_unverified";
    if (/variant/i.test(name))
      return "provider_variant_identity_candidate_unverified";
    if (/group|generation|creation/i.test(name))
      return "provider_group_identity_candidate_unverified";
    if (/result|output/i.test(name))
      return "provider_result_identity_candidate_unverified";
    return "other_data_identity_candidate_unverified";
  };
  const identityFields = (element, signalLimit) => {
    const signals = [];
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (accountAttributePattern.test(name)) continue;
      const relevant =
        identityAttributePattern.test(name) ||
        [
          "id",
          "data-testid",
          "aria-labelledby",
          "aria-describedby",
          "aria-owns",
        ].includes(name);
      if (!relevant) continue;
      const valueMask = mask(attribute.value);
      if (valueMask)
        signals.push({
          attributeName: name,
          category: identityCategory(name),
          valueMask,
        });
      if (signals.length >= signalLimit) break;
    }
    return signals;
  };
  const stateCounts = (elements) => {
    const counts = {
      loading: 0,
      processing: 0,
      completed: 0,
      error: 0,
      busy: 0,
      progressbar: 0,
      status: 0,
      alert: 0,
    };
    const visibleCounts = { ...counts };
    const hiddenCounts = { ...counts };
    for (const element of elements) {
      const roleValue = element.getAttribute("role") ?? "";
      const dataState = element.getAttribute("data-state") ?? "";
      const dataTestId = element.getAttribute("data-testid") ?? "";
      const classes =
        typeof element.className === "string" ? element.className : "";
      const metadata = `${dataState} ${dataTestId} ${classes}`;
      const signals = [];
      if (roleValue === "progressbar") signals.push("progressbar");
      if (roleValue === "status") signals.push("status");
      if (roleValue === "alert") signals.push("alert");
      if (element.getAttribute("aria-busy") === "true") signals.push("busy");
      if (
        lifecycleWords.test(metadata) ||
        element.getAttribute("data-loading") === "true"
      ) {
        if (
          /loading|spinner|pending|progress/i.test(metadata) ||
          element.getAttribute("data-loading") === "true"
        )
          signals.push("loading");
        if (/generating|processing/i.test(metadata)) signals.push("processing");
        if (/complete|finished|success|ready|done/i.test(metadata))
          signals.push("completed");
        if (
          /error|failed|failure|blocked|rejected/i.test(metadata) ||
          element.hasAttribute("data-error")
        )
          signals.push("error");
      }
      const target = visible(element).visible ? visibleCounts : hiddenCounts;
      for (const signal of new Set(signals)) {
        counts[signal]++;
        target[signal]++;
      }
    }
    return {
      markerCounts: counts,
      visibleMarkerCounts: visibleCounts,
      hiddenMarkerCounts: hiddenCounts,
    };
  };
  const tileReports = () =>
    tilesInProject.map((tile, tileIndex) => {
      const path = composedPath(tile, uniqueProject);
      const subtree = scanRoots(tile, maxTileElements);
      const descendants = subtree.elements;
      const scannedElements = [tile, ...descendants];
      const media = descendants.filter((element) =>
        ["img", "video", "canvas"].includes(tag(element)),
      );
      const candidateSignals = [];
      let identitySignalCount = 0;
      for (const element of scannedElements) {
        const fields = identityFields(element, maxIdentitySignalsPerTile);
        identitySignalCount += fields.length;
        for (const field of fields) {
          if (candidateSignals.length < maxIdentitySignalsPerTile)
            candidateSignals.push({ carrierTag: tag(element), ...field });
        }
      }
      const candidateSignalsTruncated =
        identitySignalCount > candidateSignals.length;
      const containers = path.nodes.filter((node) =>
        relevantContainerTags.has(tag(node)),
      );
      const containerReports = containers.map((container) => {
        const containerScan = scanRoots(container, maxTileElements);
        const containedTileCount =
          containerScan.elements.filter(
            (element) => tag(element) === "flow-image-tile",
          ).length + Number(tag(container) === "flow-image-tile");
        return {
          ...roleOfAncestor(container),
          visibility: visible(container),
          containsThisTile: composedPath(tile).nodes.includes(container),
          tileCountInRenderedDOMSubtree: containedTileCount,
          subtreeScanTruncated: containerScan.truncated,
          virtualizedContainer:
            tag(container) === "cdk-virtual-scroll-viewport",
          attributeNames: Array.from(container.attributes)
            .map((attribute) => attribute.name.toLowerCase())
            .sort(),
        };
      });
      return {
        tile: tileIndex + 1,
        tag: tag(tile),
        role: role(tile),
        visibility: visible(tile),
        ownership: {
          uniqueProjectBoundary: uniqueProject !== null,
          composedAncestryReachesProject: path.reachedStop,
          composedAncestryTruncated: path.truncated,
          sameProjectBoundaryAsVerifiedComposer: Boolean(
            path.reachedStop && projectOwnsComposer,
          ),
          outsideVerifiedComposer: uniqueComposer
            ? !composedPath(tile).nodes.includes(uniqueComposer) &&
              !uniqueComposer.contains(tile)
            : null,
          navigationOrAccountOwnershipNotInferred: true,
        },
        composedAncestorChain: path.nodes.map(roleOfAncestor),
        ancestorTraversalTruncated: path.truncated,
        relevantContainers: containerReports,
        virtualizedRendering: {
          insideCdkVirtualScrollViewport: containers.some(
            (container) => tag(container) === "cdk-virtual-scroll-viewport",
          ),
          thisIsOnlyACurrentlyRenderedDomTile: true,
          completeProjectInventoryAvailable: false,
        },
        subtree: {
          scannedElementCount: scannedElements.length,
          scanLimit: maxTileElements,
          traversalTruncated: subtree.truncated,
          openShadowRootCount: subtree.hosts.length,
          attributeNameInventory: [
            ...new Set(
              scannedElements.flatMap((element) =>
                Array.from(element.attributes).map((attribute) =>
                  attribute.name.toLowerCase(),
                ),
              ),
            ),
          ].sort(),
          identityCandidateCount: identitySignalCount,
          identityCandidates: candidateSignals,
          identityCandidateListTruncated: candidateSignalsTruncated,
          identityInterpretation:
            "data identity fields are candidates only; id/ARIA references and test identifiers are classified separately and do not prove asset ownership",
        },
        media: media.map((element) => {
          const image = tag(element) === "img";
          const video = tag(element) === "video";
          return {
            tag: tag(element),
            visibility: visible(element),
            imageLoadSignals: image
              ? {
                  complete: element.complete,
                  sourceAttributePresent:
                    element.hasAttribute("src") ||
                    element.hasAttribute("srcset"),
                  naturalWidth: element.naturalWidth,
                  naturalHeight: element.naturalHeight,
                  positiveNaturalDimensions:
                    element.naturalWidth > 0 && element.naturalHeight > 0,
                  resourceStateHint:
                    element.naturalWidth > 0 && element.naturalHeight > 0
                      ? "positive_natural_dimensions_available"
                      : !element.complete
                        ? "resource_not_complete"
                        : element.hasAttribute("src") ||
                            element.hasAttribute("srcset")
                          ? "complete_without_dimensions_ambiguous"
                          : "complete_without_source_or_dimensions",
                  errorHandlerPresent: element.onerror !== null,
                  errorEventCapturedByThisDiagnostic: false,
                  currentResourceErrorDistinguishable: false,
                  interpretation:
                    "supporting resource state only; zero dimensions do not distinguish an error from an absent/unsupported resource, and no event history is captured",
                }
              : null,
            videoDimensionSignals: video
              ? {
                  readyState: element.readyState,
                  videoWidth: element.videoWidth,
                  videoHeight: element.videoHeight,
                }
              : null,
            canvasDimensions:
              tag(element) === "canvas"
                ? { width: element.width, height: element.height }
                : null,
            rawMediaSourceReturned: false,
            altOrAccessibleTextReturned: false,
          };
        }),
        lifecycleSignals: stateCounts(scannedElements),
      };
    });
  const projectScan = uniqueProject
    ? scanRoots(uniqueProject, maxDocumentElements)
    : null;
  const projectState = () => {
    if (!uniqueProject) return null;
    const currentProjectScan = scanRoots(uniqueProject, maxDocumentElements);
    return stateCounts([uniqueProject, ...currentProjectScan.elements]);
  };
  const snapshot = () => ({
    selectedFlowRoute: route(),
    projectBoundaryCount: projectBoundaries.length,
    verifiedComposerCount: verifiedComposers.length,
    projectOwnsVerifiedComposer: projectOwnsComposer,
    composerOwnershipTraversalTruncated:
      composerProjectPath?.truncated ?? false,
    renderedTileCountInSelectedProject: tilesInProject.length,
    tileOwnershipTraversalTruncatedCount: tileElements.filter(
      (tile) => tileProjectPaths.get(tile)?.truncated,
    ).length,
    tileOutsideOrOwnershipUnresolvedCount:
      tileElements.length - tilesInProject.length,
    visibleRenderedTileCountInSelectedProject: tilesInProject.filter(
      (tile) => visible(tile).visible,
    ).length,
    tiles: tileReports(),
    projectLifecycleSignals: projectState(),
    documentTraversalTruncated: documentScan.truncated,
    projectTraversalTruncated: projectScan?.truncated ?? null,
  });
  const first = snapshot();
  const projectRoots = uniqueProject
    ? scanRoots(uniqueProject, maxDocumentElements)
    : null;
  const observedRoots =
    uniqueProject && projectRoots
      ? [
          uniqueProject,
          ...projectRoots.roots.filter((root) => root instanceof ShadowRoot),
        ]
      : [];
  let mutationCount = 0;
  const observers = observedRoots.map((root) => {
    const observer = new MutationObserver((records) => {
      mutationCount += records.length;
    });
    observer.observe(root, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    return observer;
  });
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  const second = snapshot();
  for (const observer of observers) {
    mutationCount += observer.takeRecords().length;
    observer.disconnect();
  }
  const snapshotsMatch = JSON.stringify(first) === JSON.stringify(second);
  const stabilityAssessed = observedRoots.length > 0;
  const stable = stabilityAssessed && mutationCount === 0 && snapshotsMatch;
  const selectedRoute = second.selectedFlowRoute;
  const status = !selectedRoute.recognized
    ? "not_a_recognized_flow_project_route"
    : documentScan.truncated
      ? "document_scan_truncated"
      : projectBoundaries.length !== 1
        ? projectBoundaries.length === 0
          ? "project_boundary_missing"
          : "multiple_project_boundaries"
        : verifiedComposers.length !== 1 || !projectOwnsComposer
          ? "project_composer_ownership_unresolved"
          : tilesInProject.length === 0
            ? "no_rendered_flow_image_tiles"
            : projectRoots?.truncated
              ? "project_scan_truncated"
              : !stable
                ? "workspace_unstable_or_not_assessed"
                : "tile_structure_observed_identity_unverified";
  const output = {
    diagnostic: "flow-image-tile-readonly-v1",
    status,
    scope: "current_top_document_selected_project_tiles_and_open_shadow_roots",
    topFrame: window.top === window,
    readyState: document.readyState,
    iframeCount: document.querySelectorAll("iframe").length,
    openShadowHostCount: documentScan.hosts.length,
    project: {
      boundaryCount: projectBoundaries.length,
      visibleBoundaryCount: projectBoundaries.filter(
        (boundary) => visible(boundary).visible,
      ).length,
      verifiedComposerCount: verifiedComposers.length,
      uniqueBoundaryOwnsComposer: projectOwnsComposer,
      composerOwnershipTraversalTruncated:
        composerProjectPath?.truncated ?? false,
      selectedRoute,
      renderedFlowImageTileCount: tilesInProject.length,
      tileOwnershipTraversalTruncatedCount: tileElements.filter(
        (tile) => tileProjectPaths.get(tile)?.truncated,
      ).length,
      tileOutsideOrOwnershipUnresolvedCount:
        tileElements.length - tilesInProject.length,
      visibleRenderedFlowImageTileCount: tilesInProject.filter(
        (tile) => visible(tile).visible,
      ).length,
      inventoryLimitation:
        "virtualized DOM exposes currently rendered tiles only, not a complete project inventory",
      lifecycleSignals: projectState(),
    },
    traversal: {
      documentScannedElementCount: documentScan.elements.length,
      documentScanLimit: maxDocumentElements,
      documentTruncated: documentScan.truncated,
      projectScannedElementCount: projectScan?.elements.length ?? null,
      projectTruncated: projectScan?.truncated ?? null,
      ancestorDepthLimit: maxAncestorDepth,
      tileSubtreeLimit: maxTileElements,
      identityCandidateLimitPerTile: maxIdentitySignalsPerTile,
    },
    tiles: second.tiles,
    stability: {
      assessedWithinSelectedProject: stabilityAssessed,
      stableAcrossTwoAnimationFrames: stabilityAssessed ? stable : null,
      mutationsWithinObservedRoots: mutationCount,
      snapshotsMatch,
      openShadowRootsObservedSeparately: true,
    },
    identityLimits: {
      providerAssetIdentityProven: false,
      domElementIdsAreAssetIdentity: false,
      accessibilityReferencesAreAssetIdentity: false,
      roleGroupMeansGenerationOrVariantGroup: false,
      logicalOutputVersusDuplicateThumbnailProven: false,
      virtualizedTileCountIsCompleteInventory: false,
      resultAttachedToAttempt: false,
      imageResourceSignalsProveProviderCompletion: false,
    },
    privacy: {
      rawPageTextReturned: false,
      promptBodiesReturned: false,
      accountDataOrCredentialsReturned: false,
      rawUrlsOrMediaSourcesReturned: false,
      accessibleNamesOrAltTextReturned: false,
      unmaskedIdentityValuesReturned: false,
      storageOrFrameworkPrivateStateAccessed: false,
      networkRequestsReplayed: false,
      providerPageMutated: false,
    },
  };
  const json = JSON.stringify(output, null, 2);
  let copiedToDevtoolsClipboard = false;
  if (typeof copy === "function") {
    copy(json);
    copiedToDevtoolsClipboard = true;
  }
  console.log(
    JSON.stringify(
      {
        diagnostic: output.diagnostic,
        status: output.status,
        projectBoundaryCount: output.project.boundaryCount,
        projectOwnsComposer: output.project.uniqueBoundaryOwnsComposer,
        renderedTiles: output.project.renderedFlowImageTileCount,
        visibleTiles: output.project.visibleRenderedFlowImageTileCount,
        identityCandidateCounts: second.tiles.map(
          (tile) => tile.subtree.identityCandidateCount,
        ),
        lifecycleMarkers: output.project.lifecycleSignals?.markerCounts ?? null,
        stableAcrossTwoAnimationFrames:
          output.stability.stableAcrossTwoAnimationFrames,
        traversalTruncated:
          output.traversal.documentTruncated ||
          output.traversal.projectTruncated === true ||
          second.tiles.some(
            (tile) =>
              tile.subtree.traversalTruncated ||
              tile.ancestorTraversalTruncated ||
              tile.subtree.identityCandidateListTruncated,
          ),
        fullJsonCopiedToDevtoolsClipboard: copiedToDevtoolsClipboard,
      },
      null,
      2,
    ),
  );
  if (!copiedToDevtoolsClipboard) console.log(json);
  return json;
})();
