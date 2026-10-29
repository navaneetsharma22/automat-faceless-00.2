/* global document, window, location, URL, getComputedStyle, requestAnimationFrame, console, NodeFilter, ShadowRoot, MutationObserver */
// Paste into DevTools Console in the user's existing, explicitly selected
// Flow project tab. Read-only: no click, input, navigation, or storage access.
// Identity-looking attribute values are consistently masked; text/URLs are never emitted.
(async () => {
  const maxElements = 30000;
  const maxReports = 60;
  const maxIdentitySignals = 12;
  const maxIdentityCandidates = 1000;
  const maxStateElements = 2000;
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
  const identityAttributePattern =
    /^(?:id|data-[a-z0-9_-]*(?:id|key|uuid|asset|result|group|variant|generation|creation|media|image|output)[a-z0-9_-]*)$/i;
  const structuralHintPattern =
    /result|gallery|generation|creation|asset|media|image|output|variant/i;
  const accountHintPattern = /account|profile|user|tier|billing|avatar/i;
  const loadingWordPattern =
    /loading|generating|processing|pending|progress|spinner/i;
  const completionWordPattern =
    /complete|completed|finished|success|ready|done/i;
  const errorWordPattern = /error|failed|failure|blocked|rejected/i;
  const identityMasks = new Map();
  const identityMask = (value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || normalized.length > 256) return null;
    if (!identityMasks.has(normalized))
      identityMasks.set(normalized, `identity-${identityMasks.size + 1}`);
    return identityMasks.get(normalized);
  };
  const safeRole = (element) => {
    const role = element.getAttribute("role");
    return role === null ? "absent" : roleAllowlist.has(role) ? role : "other";
  };
  const tag = (element) => element.localName.toLowerCase();
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      connected: element.isConnected,
      hiddenAttribute: element.hasAttribute("hidden"),
      hiddenAncestor: Boolean(
        element.closest("[hidden], [inert], [aria-hidden='true']"),
      ),
      displayNone: style.display === "none",
      visibilityHidden: ["hidden", "collapse"].includes(style.visibility),
      hasClientRects: element.getClientRects().length > 0,
      zeroArea: rect.width <= 0 || rect.height <= 0,
      visible:
        element.isConnected &&
        !element.closest("[hidden], [inert], [aria-hidden='true']") &&
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
  const ancestry = (element, limit = 16) => {
    const path = [];
    const seen = new Set();
    for (
      let current = element;
      current && path.length < limit && !seen.has(current);
      current = parentAcrossShadow(current)
    ) {
      seen.add(current);
      path.push(current);
    }
    return path;
  };
  const collectRoots = () => {
    const roots = [document];
    const hosts = [];
    let scanned = 0;
    let truncated = false;
    for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
      for (const element of roots[rootIndex].querySelectorAll("*")) {
        scanned++;
        if (scanned > maxElements) {
          truncated = true;
          return { roots, hosts, scanned: maxElements, truncated };
        }
        if (element.shadowRoot) {
          hosts.push(element);
          roots.push(element.shadowRoot);
        }
      }
    }
    return { roots, hosts, scanned, truncated };
  };
  const rootInventory = collectRoots();
  const allElements = rootInventory.roots.flatMap((root) =>
    Array.from(root.querySelectorAll("*")),
  );
  const projectBoundaries = allElements.filter(
    (element) => tag(element) === "flow-project-page",
  );
  const composerHosts = allElements.filter(
    (element) => tag(element) === "flow-base-prompt-box",
  );
  const verifiedComposers = composerHosts.filter((boundary) => {
    const richHosts = Array.from(
      boundary.querySelectorAll("flow-rich-text-editor"),
    );
    const editors = richHosts.flatMap((host) =>
      Array.from(
        host.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
      ),
    );
    return (
      editors.length === 1 &&
      richHosts.length === 1 &&
      visible(boundary).visible &&
      visible(editors[0]).visible &&
      !editors[0].matches("[aria-readonly='true'], [aria-disabled='true']")
    );
  });
  const uniqueComposer =
    verifiedComposers.length === 1 ? verifiedComposers[0] : null;
  const uniqueProject =
    projectBoundaries.length === 1 ? projectBoundaries[0] : null;
  const selectedProjectOwnedComposer = Boolean(
    uniqueProject && uniqueComposer && uniqueProject.contains(uniqueComposer),
  );

  const mediaSelector = "img, video, canvas";
  const semanticCard = (element) => {
    if (
      ["article", "li"].includes(tag(element)) ||
      ["listitem", "gridcell"].includes(element.getAttribute("role")) ||
      element.hasAttribute("data-result") ||
      element.hasAttribute("data-result-card")
    )
      return true;
    const attrs = Array.from(element.attributes);
    const valueHints = attrs
      .filter((attr) =>
        [
          "data-testid",
          "data-type",
          "data-kind",
          "data-state",
          "role",
        ].includes(attr.name.toLowerCase()),
      )
      .some((attr) => structuralHintPattern.test(attr.value));
    return (
      valueHints ||
      (/^flow-[a-z0-9-]+$/.test(tag(element)) &&
        structuralHintPattern.test(tag(element)))
    );
  };
  const isAccountOrNavigation = (element) => {
    const path = ancestry(element, 8);
    return path.some((node) => {
      const attrs = Array.from(node.attributes)
        .filter((attr) =>
          ["aria-label", "data-testid", "class"].includes(
            attr.name.toLowerCase(),
          ),
        )
        .map((attr) => attr.value)
        .join(" ");
      return (
        node.matches("nav, header, [role='navigation']") ||
        accountHintPattern.test(`${tag(node)} ${attrs}`)
      );
    });
  };
  const candidates = new Map();
  const addCandidate = (element, source) => {
    if (
      !element ||
      tag(element) === "flow-project-page" ||
      tag(element) === "flow-base-prompt-box" ||
      isAccountOrNavigation(element)
    )
      return;
    const current = candidates.get(element) ?? new Set();
    current.add(source);
    candidates.set(element, current);
  };
  for (const element of allElements) {
    if (semanticCard(element))
      addCandidate(element, "semantic_structure_or_hint");
  }
  for (const root of rootInventory.roots) {
    for (const media of root.querySelectorAll(mediaSelector)) {
      let selected = null;
      for (
        let ancestor = parentAcrossShadow(media);
        ancestor && tag(ancestor) !== "flow-project-page";
        ancestor = parentAcrossShadow(ancestor)
      ) {
        if (semanticCard(ancestor)) {
          selected = ancestor;
          break;
        }
      }
      addCandidate(
        selected ?? parentAcrossShadow(media),
        selected ? "nearest_semantic_card_ancestor" : "media_parent_fallback",
      );
    }
  }
  const candidateElements = [...candidates.keys()];
  const truncatedCandidates = candidateElements.length > maxReports;
  const reportedCandidates = candidateElements.slice(0, maxReports);
  const identityCandidates = candidateElements.slice(0, maxIdentityCandidates);
  const identityCandidateScanTruncated =
    candidateElements.length > identityCandidates.length;

  const getIdentitySignals = (candidate) => {
    const path = ancestry(candidate, 8);
    const signals = [];
    for (const carrier of path) {
      if (tag(carrier) === "flow-project-page") break;
      for (const attribute of Array.from(carrier.attributes)) {
        if (!identityAttributePattern.test(attribute.name)) continue;
        const valueMask = identityMask(attribute.value);
        if (!valueMask) continue;
        signals.push({
          carrierTag: tag(carrier),
          attributeName: attribute.name,
          valueMask,
        });
        if (signals.length >= maxIdentitySignals) return signals;
      }
    }
    return signals;
  };
  const identitySignalsByCandidate = new Map();
  const identityFamilyCounts = new Map();
  for (const candidate of identityCandidates) {
    const signals = getIdentitySignals(candidate);
    identitySignalsByCandidate.set(candidate, signals);
    for (const signal of signals) {
      const familyKey = JSON.stringify([
        signal.attributeName,
        signal.valueMask,
      ]);
      identityFamilyCounts.set(
        familyKey,
        (identityFamilyCounts.get(familyKey) ?? 0) + 1,
      );
    }
  }
  const stateSignals = (scope) => {
    const elements = [scope];
    let stateScanTruncated = false;
    for (const element of scope.querySelectorAll("*")) {
      if (elements.length >= maxStateElements) {
        stateScanTruncated = true;
        break;
      }
      elements.push(element);
    }
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
    let textLoadingSignal = false;
    let textCompletionSignal = false;
    let textErrorSignal = false;
    for (const element of elements) {
      const role = element.getAttribute("role") ?? "";
      const signals = [];
      if (role === "progressbar") signals.push("progressbar");
      if (role === "status") signals.push("status");
      if (role === "alert") signals.push("alert");
      if (element.getAttribute("aria-busy") === "true") signals.push("busy");
      const state = element.getAttribute("data-state") ?? "";
      const testId = element.getAttribute("data-testid") ?? "";
      const classValue =
        typeof element.className === "string" ? element.className : "";
      const stateMetadata = `${state} ${testId} ${classValue}`;
      if (
        loadingWordPattern.test(stateMetadata) ||
        element.getAttribute("data-loading") === "true"
      )
        signals.push("loading");
      if (/processing|generating/i.test(stateMetadata))
        signals.push("processing");
      if (completionWordPattern.test(stateMetadata)) signals.push("completed");
      if (
        errorWordPattern.test(stateMetadata) ||
        element.hasAttribute("data-error")
      )
        signals.push("error");
      if (signals.length > 0) {
        const visibilityCounts = visible(element).visible
          ? visibleCounts
          : hiddenCounts;
        for (const signal of signals) {
          counts[signal]++;
          visibilityCounts[signal]++;
        }
      }
    }
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let inspected = 0;
    let truncated = false;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (
        !parent ||
        parent.closest("[contenteditable], input, textarea, nav, header")
      )
        continue;
      inspected += (node.nodeValue ?? "").length;
      if (inspected > 2048) {
        truncated = true;
        break;
      }
      const text = node.nodeValue ?? "";
      textLoadingSignal ||= loadingWordPattern.test(text);
      textCompletionSignal ||= completionWordPattern.test(text);
      textErrorSignal ||= errorWordPattern.test(text);
    }
    return {
      markerCounts: counts,
      visibleMarkerCounts: visibleCounts,
      hiddenMarkerCounts: hiddenCounts,
      markerScanTruncated: stateScanTruncated,
      statusTextSignals: {
        loading: textLoadingSignal,
        completed: textCompletionSignal,
        error: textErrorSignal,
        scanTruncated: truncated,
      },
    };
  };
  const describeCandidate = (element, index) => {
    const path = ancestry(element, 16);
    const projectOwners = path.filter(
      (node) => tag(node) === "flow-project-page",
    );
    const containingProject = projectOwners[0] ?? null;
    const media = Array.from(element.querySelectorAll(mediaSelector));
    if (element.matches(mediaSelector)) media.unshift(element);
    const visibleMediaCount = media.filter(
      (node) => visible(node).visible,
    ).length;
    const ownAttributeNames = Array.from(element.attributes)
      .map((attribute) => attribute.name)
      .filter((name) => /^(?:data-|aria-|role$|id$|class$)/i.test(name))
      .sort();
    const identifierNames = ownAttributeNames.filter((name) =>
      identityAttributePattern.test(name),
    );
    const identitySignals = identitySignalsByCandidate.get(element) ?? [];
    const duplicateIdentityCandidateCount = identitySignals.reduce(
      (count, signal) => {
        const matches =
          identityFamilyCounts.get(
            JSON.stringify([signal.attributeName, signal.valueMask]),
          ) ?? 0;
        return Math.max(count, matches);
      },
      0,
    );
    const state = stateSignals(element);
    const relationshipPath = [];
    for (const node of path) {
      if (node === containingProject) break;
      relationshipPath.push({ tag: tag(node), role: safeRole(node) });
    }
    return {
      candidate: index + 1,
      tag: tag(element),
      role: safeRole(element),
      discoveredBy: [...(candidates.get(element) ?? [])],
      visibility: visible(element),
      owner: {
        withinFlowProjectBoundary: containingProject !== null,
        projectBoundaryTag: containingProject ? tag(containingProject) : null,
        projectBoundaryVisible: containingProject
          ? visible(containingProject).visible
          : null,
        sameProjectBoundaryAsVerifiedComposer: Boolean(
          containingProject &&
          uniqueComposer &&
          containingProject.contains(uniqueComposer),
        ),
        outsideComposer: uniqueComposer
          ? !uniqueComposer.contains(element)
          : null,
        navigationOrAccountAncestryPresent: isAccountOrNavigation(element),
      },
      structuralRelationshipToProjectBoundary: relationshipPath,
      ownRelevantAttributeNames: ownAttributeNames,
      ownIdentityAttributeNames: identifierNames,
      identitySignalsAlongAncestors: identitySignals,
      media: {
        descendantNodeCount: media.length,
        visibleNodeCount: visibleMediaCount,
        hiddenOrNonRenderedNodeCount: media.length - visibleMediaCount,
        imageNodeCount: media.filter((node) => tag(node) === "img").length,
        videoNodeCount: media.filter((node) => tag(node) === "video").length,
        canvasNodeCount: media.filter((node) => tag(node) === "canvas").length,
      },
      identityMultiplicity: {
        candidatesWithSameAttributeAndMaskedValue:
          duplicateIdentityCandidateCount,
        possibleRepeatedThumbnailOrRerenderSignal:
          duplicateIdentityCandidateCount > 1 || media.length > 1,
        interpretation:
          "shared identity signal or multiple media nodes is a structural clue only; it does not prove logical output identity",
      },
      state,
    };
  };
  const describeProjectBoundary = (boundary, index) => {
    const mediaNodes = Array.from(boundary.querySelectorAll(mediaSelector));
    const media = mediaNodes.length;
    const cardCandidates = candidateElements.filter((candidate) =>
      boundary.contains(candidate),
    ).length;
    const relevantCustomTags = [
      ...new Set(
        Array.from(boundary.querySelectorAll("*"))
          .filter((element) => tag(element).includes("-"))
          .map(tag)
          .filter((name) => structuralHintPattern.test(name))
          .slice(0, 32),
      ),
    ];
    return {
      boundary: index + 1,
      tag: tag(boundary),
      role: safeRole(boundary),
      visibility: visible(boundary),
      containsVerifiedComposer: Boolean(
        uniqueComposer && boundary.contains(uniqueComposer),
      ),
      candidateCountWithinBoundary: cardCandidates,
      scopedMediaNodeCount: media,
      visibleScopedMediaNodeCount: mediaNodes.filter(
        (node) => visible(node).visible,
      ).length,
      hiddenOrNonRenderedScopedMediaNodeCount: mediaNodes.filter(
        (node) => !visible(node).visible,
      ).length,
      relevantCustomElementTags: relevantCustomTags,
      state: stateSignals(boundary),
      rawTextReturned: false,
    };
  };
  const parseRoute = () => {
    try {
      const url = new URL(location.href);
      if (url.protocol !== "https:" || url.username || url.password)
        return { recognized: false, projectMask: null };
      let projectId = null;
      if (url.hostname === "flow.google.com") {
        projectId =
          /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/?$/.exec(
            url.pathname,
          )?.[1] ?? null;
      } else if (url.hostname === "labs.google") {
        projectId =
          /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] ??
          null;
      }
      return {
        recognized: projectId !== null,
        projectMask: projectId ? identityMask(projectId) : null,
      };
    } catch {
      return { recognized: false, projectMask: null };
    }
  };
  const buildSnapshot = () => ({
    selectedFlowRoute: parseRoute(),
    projectBoundaryCount: projectBoundaries.length,
    visibleProjectBoundaryCount: projectBoundaries.filter(
      (boundary) => visible(boundary).visible,
    ).length,
    verifiedComposerCount: verifiedComposers.length,
    projectComposerOwnership:
      projectBoundaries.length !== 1 || verifiedComposers.length !== 1
        ? "unresolved"
        : selectedProjectOwnedComposer
          ? "unique_project_boundary_contains_verified_composer"
          : "composer_outside_project_boundary",
    projectBoundaries: projectBoundaries
      .slice(0, 10)
      .map(describeProjectBoundary),
    candidateCount: candidateElements.length,
    identityCandidateCount: identityCandidates.length,
    identityCandidateScanTruncated,
    reportedCandidateCount: reportedCandidates.length,
    candidateListTruncated: truncatedCandidates,
    candidates: reportedCandidates.map(describeCandidate),
    identityMaskCount: identityMasks.size,
  });

  const first = buildSnapshot();
  const mutationRoots = projectBoundaries.filter(
    (boundary) =>
      !projectBoundaries.some(
        (other) => other !== boundary && other.contains(boundary),
      ),
  );
  let mutationCount = 0;
  const observers = mutationRoots.map((root) => {
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
  const second = buildSnapshot();
  for (const observer of observers) {
    mutationCount += observer.takeRecords().length;
    observer.disconnect();
  }
  const snapshotsMatch = JSON.stringify(first) === JSON.stringify(second);
  const stabilityAssessed = mutationRoots.length > 0;
  const stable = stabilityAssessed && mutationCount === 0 && snapshotsMatch;
  const route = second.selectedFlowRoute;
  const status = !route.recognized
    ? "not_a_recognized_flow_project_route"
    : rootInventory.truncated
      ? "dom_scan_truncated"
      : second.projectBoundaryCount !== 1
        ? second.projectBoundaryCount === 0
          ? "project_boundary_missing"
          : "multiple_project_boundaries"
        : second.verifiedComposerCount !== 1 || !selectedProjectOwnedComposer
          ? "project_composer_ownership_unresolved"
          : !stabilityAssessed
            ? "project_scope_not_stability_assessed"
            : !stable
              ? "unstable_during_two_frame_sample"
              : second.candidateCount === 0
                ? "no_result_candidates_observed"
                : "read_only_structure_observed_unclassified";
  const output = {
    diagnostic: "flow-populated-results-readonly-v1",
    scope: "current_top_document_and_open_shadow_roots",
    status,
    topFrame: window.top === window,
    readyState: document.readyState,
    frameCount: document.querySelectorAll("iframe").length,
    openShadowHostCount: rootInventory.hosts.length,
    scannedElementCount: rootInventory.scanned,
    domScanTruncated: rootInventory.truncated,
    observation: second,
    stability: {
      assessedWithinProjectBoundary: stabilityAssessed,
      stableAcrossTwoAnimationFrames: stabilityAssessed ? stable : null,
      mutationsWithinObservedProjectBoundary: mutationCount,
      snapshotsMatch,
    },
    interpretation: {
      actualAssetSemanticsProven: false,
      logicalOutputVersusThumbnailSemanticsProven: false,
      currentAttemptOwnershipProven: false,
      variantMeaningProven: false,
      terminalLifecycleOrErrorContractProven: false,
      candidateIdValuesConsistentlyMasked: true,
      candidateValuesAreStableAcrossSessions: false,
      resultsAreNotAttachedToAnyAttempt: true,
    },
    privacy: {
      rawPageTextReturned: false,
      promptBodiesReturned: false,
      labelsReturned: false,
      rawUrlsOrMediaSourcesReturned: false,
      credentialsOrAccountDataReturned: false,
      identifierValuesReturned: false,
      storageAccessed: false,
      pageMutated: false,
    },
  };
  console.log(JSON.stringify(output, null, 2));
  return JSON.stringify(output, null, 2);
})();
