/* global document, window, location, URL, getComputedStyle, requestAnimationFrame, console, ShadowRoot, MutationObserver, copy */
// Paste once in DevTools Console on the already-open Flow image editor.
// Read-only: no input, navigation, provider storage, page text, or media URLs.
// Route/media ID values are returned only for the requested local comparison.
// The full bounded structure report is copied with DevTools copy() when available.
(async () => {
  const MAX_DOCUMENT_ELEMENTS = 20000;
  const MAX_PROJECT_ELEMENTS = 20000;
  const MAX_IMAGES = 300;
  const MAX_ANCESTORS = 80;
  const MAX_IDENTITY_CANDIDATES = 1200;
  const identityAttributePattern =
    /^(?:id|data-[a-z0-9_-]*(?:id|key|uuid|asset|result|group|variant|generation|creation|media|image|output|project)[a-z0-9_-]*)$/i;
  const accountAttributePattern = /account|profile|user|tier|billing|avatar/i;
  const identityValuePattern = /^[A-Za-z0-9_-]{1,256}$/;
  const hints = {
    history: /history|version/i,
    thumbnail: /thumbnail|thumb/i,
    main: /main|primary|selected/i,
    editor: /editor|edit|viewer|preview|canvas/i,
  };
  const stateAttributeNames = [
    "aria-selected",
    "aria-current",
    "aria-pressed",
    "aria-checked",
    "data-selected",
    "data-active",
    "selected",
    "checked",
    "tabindex",
  ];
  const relationshipAttributeNames = [
    "aria-controls",
    "aria-owns",
    "aria-labelledby",
    "aria-describedby",
    "for",
  ];
  const nodeTokens = new WeakMap();
  let nextNodeToken = 1;
  const nodeToken = (element) => {
    if (!nodeTokens.has(element))
      nodeTokens.set(element, `node-${nextNodeToken++}`);
    return nodeTokens.get(element);
  };
  const tag = (element) => element.localName.toLowerCase();
  const role = (element) => {
    const value = element.getAttribute("role");
    return value && /^[a-z-]{1,32}$/i.test(value) ? value : "absent_or_other";
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
    while (current && !seen.has(current) && nodes.length < MAX_ANCESTORS) {
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
    const shadowHosts = [];
    const elements = [];
    let truncated = false;
    if (root.nodeType === 1 && root.shadowRoot) {
      roots.push(root.shadowRoot);
      shadowHosts.push(root);
    }
    for (let index = 0; index < roots.length; index++) {
      for (const element of roots[index].querySelectorAll("*")) {
        if (elements.length >= limit) {
          truncated = true;
          return { roots, shadowHosts, elements, truncated };
        }
        elements.push(element);
        if (element.shadowRoot) {
          roots.push(element.shadowRoot);
          shadowHosts.push(element);
        }
      }
    }
    return { roots, shadowHosts, elements, truncated };
  };
  const visible = (element, path = composedPath(element).nodes) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const hidden = path.some((node) =>
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
  const route = () => {
    try {
      const url = new URL(location.href);
      if (url.protocol !== "https:" || url.username || url.password)
        return { recognized: false, projectId: null, routeKind: "unsupported" };
      if (url.hostname === "flow.google.com") {
        const match =
          /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)(?:\/.*)?$/.exec(
            url.pathname,
          );
        return {
          recognized: Boolean(match),
          projectId: match?.[1] ?? null,
          routeKind: match
            ? "flow_project_or_subroute"
            : "unrecognized_flow_path",
        };
      }
      if (url.hostname === "labs.google") {
        const match = /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)(?:\/.*)?$/.exec(
          url.pathname,
        );
        return {
          recognized: Boolean(match),
          projectId: match?.[1] ?? null,
          routeKind: match
            ? "labs_flow_project_or_subroute"
            : "unrecognized_flow_path",
        };
      }
      return { recognized: false, projectId: null, routeKind: "not_flow_host" };
    } catch {
      return { recognized: false, projectId: null, routeKind: "invalid_url" };
    }
  };
  const markerHints = (element) => {
    const values = [
      ["tag", tag(element)],
      ["class", element.getAttribute("class") ?? ""],
      ["data-testid", element.getAttribute("data-testid") ?? ""],
      ["role", element.getAttribute("role") ?? ""],
      ["data-state", element.getAttribute("data-state") ?? ""],
      ["aria-label_keyword_only", element.getAttribute("aria-label") ?? ""],
    ];
    const found = [];
    for (const [source, value] of values) {
      for (const [kind, pattern] of Object.entries(hints)) {
        if (pattern.test(value)) found.push({ source, kind });
      }
    }
    return found;
  };
  const stateSignals = (element) => {
    const signals = [];
    for (const name of stateAttributeNames) {
      if (!element.hasAttribute(name)) continue;
      const value = element.getAttribute(name);
      signals.push({
        attributeName: name,
        value:
          value === "true" ||
          value === "false" ||
          value === "mixed" ||
          value === "page" ||
          value === "step" ||
          value === "location" ||
          value === "date" ||
          value === "time" ||
          value === "off" ||
          value === "on" ||
          value === "" ||
          (name === "tabindex" && (value === "0" || value === "-1"))
            ? value
            : "present_other",
      });
    }
    return signals;
  };
  const identityAttributes = (element, mediaIds, routeProjectId) => {
    const result = [];
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        !identityAttributePattern.test(name) ||
        accountAttributePattern.test(name)
      )
        continue;
      const rawValue = attribute.value.trim();
      if (!identityValuePattern.test(rawValue)) continue;
      const routeMatch =
        Boolean(routeProjectId) &&
        rawValue === routeProjectId &&
        (/project/i.test(name) ||
          (name === "id" && tag(element) === "flow-project-page"));
      const mediaMatch =
        name !== "data-media-id" && mediaIds.includes(rawValue);
      result.push({
        attributeName: name,
        category:
          name === "id"
            ? "dom_node_id"
            : /project/i.test(name)
              ? "project_identity_candidate"
              : /media|asset|image/i.test(name)
                ? "media_identity_candidate"
                : /version/i.test(name)
                  ? "version_identity_candidate"
                  : /group|variant|generation|result|output/i.test(name)
                    ? "result_group_or_variant_candidate"
                    : "other_identity_candidate",
        value: rawValue,
        exactValueMatch: routeMatch
          ? { matches: "route_project_id", reportedId: rawValue }
          : mediaMatch
            ? { matches: "data_media_id_candidate", reportedId: rawValue }
            : null,
      });
    }
    return result;
  };
  const routeBinding = route();
  const documentScan = scanRoots(document, MAX_DOCUMENT_ELEMENTS);
  const projectBoundaries = documentScan.elements.filter(
    (element) => tag(element) === "flow-project-page",
  );
  const project = projectBoundaries.length === 1 ? projectBoundaries[0] : null;
  const projectScan = project ? scanRoots(project, MAX_PROJECT_ELEMENTS) : null;
  const containsImage = (element) =>
    scanRoots(element, MAX_PROJECT_ELEMENTS).elements.some(
      (candidate) => tag(candidate) === "img",
    );
  const visibleDialogRoots = documentScan.elements.filter(
    (element) =>
      role(element) === "dialog" && visible(element) && containsImage(element),
  );
  const customEditorRoots = documentScan.elements.filter(
    (element) =>
      element.localName.includes("-") &&
      /(?:image|media).*(?:edit|editor|viewer)|(?:edit|editor|viewer).*(?:image|media)/i.test(
        tag(element),
      ) &&
      visible(element) &&
      containsImage(element),
  );
  const editorRootCandidates = visibleDialogRoots.length
    ? visibleDialogRoots
    : customEditorRoots;
  const editorRoot =
    editorRootCandidates.length === 1 ? editorRootCandidates[0] : null;
  const editorScan = editorRoot
    ? scanRoots(editorRoot, MAX_PROJECT_ELEMENTS)
    : null;
  const scopeElements =
    editorRoot && editorScan ? [editorRoot, ...editorScan.elements] : [];
  const imageElements = scopeElements
    .filter((element) => tag(element) === "img")
    .slice(0, MAX_IMAGES);
  const imageListTruncated =
    scopeElements.filter((element) => tag(element) === "img").length >
    MAX_IMAGES;
  const mediaIds = imageElements
    .filter((image) => image.hasAttribute("data-media-id"))
    .map((image) => image.getAttribute("data-media-id")?.trim())
    .filter((value) => Boolean(value && identityValuePattern.test(value)));
  const connectionElements = new Set(scopeElements);
  for (const image of imageElements) {
    const path = composedPath(image, project);
    if (path.reachedStop)
      for (const ancestor of path.nodes) connectionElements.add(ancestor);
  }
  const elementById = new Map(
    [...connectionElements]
      .filter((element) => element.id)
      .map((element) => [element.id, element]),
  );
  let identityCandidateCount = 0;
  const explicitValueConnections = [];
  const ariaConnections = [];
  let explicitConnectionsTruncated = false;
  let ariaConnectionsTruncated = false;
  for (const element of connectionElements) {
    const attrs = identityAttributes(element, mediaIds, routeBinding.projectId);
    identityCandidateCount += attrs.length;
    for (const attr of attrs) {
      if (!attr.exactValueMatch) continue;
      if (explicitValueConnections.length >= MAX_IDENTITY_CANDIDATES) {
        explicitConnectionsTruncated = true;
        continue;
      }
      explicitValueConnections.push({
        nodeToken: nodeToken(element),
        tag: tag(element),
        attributeName: attr.attributeName,
        category: attr.category,
        matchedIdKind: attr.exactValueMatch.matches,
        matchedId: attr.exactValueMatch.reportedId,
        composedPathToProject: composedPath(element, project).reachedStop,
      });
    }
    for (const attributeName of relationshipAttributeNames) {
      const value = element.getAttribute(attributeName);
      if (!value) continue;
      for (const referencedId of value.trim().split(/\s+/)) {
        const target = elementById.get(referencedId);
        if (!target) continue;
        if (ariaConnections.length >= MAX_IDENTITY_CANDIDATES) {
          ariaConnectionsTruncated = true;
          continue;
        }
        ariaConnections.push({
          sourceNodeToken: nodeToken(element),
          sourceTag: tag(element),
          attributeName,
          targetNodeToken: nodeToken(target),
          targetTag: tag(target),
          sourceState: stateSignals(element),
        });
      }
    }
    if (identityCandidateCount >= MAX_IDENTITY_CANDIDATES) break;
  }
  const imageReports = imageElements.map((image, index) => {
    const path = composedPath(image, project);
    const ancestorHints = path.nodes.map((node) => ({
      nodeToken: nodeToken(node),
      tag: tag(node),
      role: role(node),
      visible: visible(node, path.nodes),
      stateSignals: stateSignals(node),
      structuralHints: markerHints(node),
      identityAttributes: identityAttributes(
        node,
        mediaIds,
        routeBinding.projectId,
      ),
    }));
    const flattenedHints = ancestorHints.flatMap(
      (node) => node.structuralHints,
    );
    const historyContext = flattenedHints.some(
      ({ kind }) => kind === "history",
    );
    const thumbnailContext = flattenedHints.some(
      ({ kind }) => kind === "thumbnail",
    );
    const editorContext = flattenedHints.some(({ kind }) => kind === "editor");
    const mainContext = flattenedHints.some(({ kind }) => kind === "main");
    const imageVisible = visible(image, path.nodes);
    const classification =
      historyContext || thumbnailContext
        ? "history_thumbnail_candidate"
        : imageVisible && editorRoot && mainContext
          ? "main_editor_image_candidate"
          : "ambiguous_editor_scope_image_candidate";
    return {
      imageIndex: index + 1,
      nodeToken: nodeToken(image),
      tag: tag(image),
      visible: imageVisible,
      classification,
      classificationBasis: {
        historyContextHint: historyContext,
        thumbnailContextHint: thumbnailContext,
        editorContextHint: editorContext,
        mainContextHint: mainContext,
        containedByUniqueEditorRoot: Boolean(editorRoot),
        structuralCandidateOnly: true,
      },
      dataMediaId: identityValuePattern.test(
        image.getAttribute("data-media-id")?.trim() ?? "",
      )
        ? image.getAttribute("data-media-id")?.trim()
        : null,
      identityAttributes: identityAttributes(
        image,
        mediaIds,
        routeBinding.projectId,
      ),
      selectedStateOnComposedAncestors: ancestorHints
        .filter((node) => node.stateSignals.length)
        .map((node) => ({
          nodeToken: node.nodeToken,
          tag: node.tag,
          stateSignals: node.stateSignals,
        })),
      domOwnership: {
        uniqueProjectBoundary: project !== null,
        ancestryReachesProject: path.reachedStop,
        ancestryTruncated: path.truncated,
        nearestRelevantAncestors: ancestorHints
          .slice(0, 20)
          .map(({ nodeToken: token, tag: nodeTag, role: nodeRole }) => ({
            nodeToken: token,
            tag: nodeTag,
            role: nodeRole,
          })),
      },
    };
  });
  const observerRoots = projectScan
    ? editorRoot && editorScan
      ? [
          editorRoot,
          ...editorScan.roots.filter((root) => root instanceof ShadowRoot),
        ]
      : []
    : [];
  let mutationCount = 0;
  let stabilityWindowObserved = true;
  const observers = observerRoots.map((root) => {
    const observer = new MutationObserver((records) => {
      mutationCount += records.length;
    });
    observer.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    return observer;
  });
  try {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  } catch {
    stabilityWindowObserved = false;
  } finally {
    for (const observer of observers) {
      mutationCount += observer.takeRecords().length;
      observer.disconnect();
    }
  }
  const routeAfterCapture = route();
  const routeChangedDuringCapture =
    routeAfterCapture.projectId !== routeBinding.projectId ||
    routeAfterCapture.recognized !== routeBinding.recognized;
  const status = !routeBinding.recognized
    ? "flow_project_route_unrecognized"
    : documentScan.truncated
      ? "document_scan_truncated"
      : projectBoundaries.length !== 1
        ? projectBoundaries.length === 0
          ? "project_boundary_missing"
          : "project_boundary_ambiguous"
        : projectScan?.truncated
          ? "project_scan_truncated"
          : !editorRoot
            ? editorRootCandidates.length === 0
              ? "editor_scope_not_identified"
              : "editor_scope_ambiguous"
            : editorScan?.truncated
              ? "editor_scope_scan_truncated"
              : !composedPath(editorRoot, project).reachedStop
                ? "editor_scope_not_owned_by_selected_project"
                : imageListTruncated ||
                    identityCandidateCount >= MAX_IDENTITY_CANDIDATES
                  ? "capture_truncated"
                  : !stabilityWindowObserved
                    ? "stability_window_unavailable"
                    : routeChangedDuringCapture
                      ? "route_changed_during_capture"
                      : mutationCount > 0
                        ? "scope_changed_during_capture"
                        : "read_only_editor_structure_captured";
  const output = {
    diagnostic: "flow-image-editor-identity-readonly-v1",
    status,
    scope: "unique_visible_image_editor_root_and_its_open_shadow_roots",
    topFrame: window.top === window,
    route: {
      recognized: routeBinding.recognized,
      routeKind: routeBinding.routeKind,
      projectId: routeBinding.projectId,
      projectIdUnchangedDuringCapture: !routeChangedDuringCapture,
      rawRouteOrQueryReturned: false,
    },
    ownership: {
      projectBoundaryCount: projectBoundaries.length,
      editorScopeCandidateCount: editorRootCandidates.length,
      editorScopeRoot: editorRoot
        ? {
            nodeToken: nodeToken(editorRoot),
            tag: tag(editorRoot),
            role: role(editorRoot),
            visible: visible(editorRoot),
            structuralHints: markerHints(editorRoot),
          }
        : null,
      editorScopeCandidates: editorRootCandidates
        .slice(0, 20)
        .map((element) => ({
          nodeToken: nodeToken(element),
          tag: tag(element),
          role: role(element),
          visible: visible(element),
          structuralHints: markerHints(element),
        })),
      selectedProjectOwnsImages: Boolean(
        project &&
        imageReports.length > 0 &&
        imageReports.every(
          (image) => image.domOwnership.ancestryReachesProject,
        ),
      ),
      editorScopeOwnedBySelectedProject: Boolean(
        editorRoot && composedPath(editorRoot, project).reachedStop,
      ),
      documentScanTruncated: documentScan.truncated,
      projectScanTruncated: projectScan?.truncated ?? null,
      openShadowRootsScanned: true,
      closedShadowRootsInspected: false,
      iframeContentsInspected: false,
    },
    imageCount: imageReports.length,
    mediaIdImageCount: mediaIds.length,
    images: imageReports,
    routeMediaComparison: {
      directRouteProjectIdToDataMediaIdValueComparisonPerformed: false,
      comparisonPolicy:
        "keep route and media values separate; match route ID only against explicit project identity attributes, and match media candidates only against other identity attributes or resolved DOM reference edges",
      routeMediaRelationshipInferredFromDifferentValues: false,
    },
    explicitDomConnections: {
      exactIdentityAttributeValueMatches: explicitValueConnections.slice(
        0,
        MAX_IDENTITY_CANDIDATES,
      ),
      resolvedDomReferenceEdges: ariaConnections.slice(
        0,
        MAX_IDENTITY_CANDIDATES,
      ),
      candidateCount: identityCandidateCount,
      candidateListTruncated: identityCandidateCount >= MAX_IDENTITY_CANDIDATES,
      explicitConnectionListTruncated: explicitConnectionsTruncated,
      domReferenceListTruncated: ariaConnectionsTruncated,
      interpretation:
        "These are explicit attribute/reference matches only; they do not define asset, version, group, variant, or attempt semantics.",
    },
    stability: {
      twoAnimationFrameWindow: true,
      observedRoots: observerRoots.length,
      mutationCount,
      stabilityWindowObserved,
      stableDuringObservedWindow:
        observerRoots.length > 0 &&
        stabilityWindowObserved &&
        mutationCount === 0,
      noContinuousObserverLeftRunning: true,
    },
    findings: {
      identityMapping: "unverified_candidate_relationships_only",
      attemptAttribution: "not_assessed_by_this_static_read_only_collector",
      terminalCompletion: "not_assessed_and_unsupported",
      historyVersusMainClassification:
        "structural candidate hints only; verify using emitted ancestry and selected-state edges",
    },
    privacy: {
      promptBodiesReadOrReturned: false,
      pageTextOrAccessibleNamesReturned: false,
      mediaUrlsOrSourcesReturned: false,
      credentialsOrAccountDataReturned: false,
      storageAccessed: false,
      networkRequestsMadeOrReplayed: false,
      providerPageMutated: false,
      clicksOrInputDispatched: false,
    },
  };
  const json = JSON.stringify(output, null, 2);
  let copied = false;
  if (typeof copy === "function") {
    try {
      copy(json);
      copied = true;
    } catch {
      copied = false;
    }
  }
  console.log(
    JSON.stringify(
      {
        diagnostic: output.diagnostic,
        status: output.status,
        routeProjectId: output.route.projectId,
        projectBoundaryCount: output.ownership.projectBoundaryCount,
        imageCount: output.imageCount,
        mediaIdImageCount: output.mediaIdImageCount,
        routeMediaValuesComparedDirectly:
          output.routeMediaComparison
            .directRouteProjectIdToDataMediaIdValueComparisonPerformed,
        explicitConnectionCount:
          output.explicitDomConnections.exactIdentityAttributeValueMatches
            .length +
          output.explicitDomConnections.resolvedDomReferenceEdges.length,
        stableDuringObservedWindow: output.stability.stableDuringObservedWindow,
        fullJsonCopiedToClipboard: copied,
        fullJsonResult: copied ? "clipboard" : "console_log",
        privacy: output.privacy,
      },
      null,
      2,
    ),
  );
  if (!copied) console.log(json);
  return json;
})();
