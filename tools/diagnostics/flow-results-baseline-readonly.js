/* global document, window, getComputedStyle, requestAnimationFrame, console, HTMLElement, NodeFilter, MutationObserver */
// Paste into DevTools Console on the existing Flow tab. Read-only.
// Emits fixed DOM signals only; it never reports prompt text, labels, URLs or media sources.
(async () => {
  const resultLabelPattern =
    /^(generated results|image results|results gallery)$/i;
  const generateNamePattern =
    /^(generate|generate image|create image|start generation)$/i;
  const surfaceHintPattern =
    /result|gallery|creation|generation|media|image|empty|loading|progress/i;
  const emptyPattern =
    /\b(empty|no results?|no images?|no media|no creations?|nothing to show|nothing here)\b/i;
  const loadingPattern = /\b(loading|generating|processing|please wait)\b/i;
  const maxSurfaces = 50;

  const visibleEnabled = (element) => {
    const style = getComputedStyle(element);
    return (
      element.isConnected &&
      !element.matches(":disabled, [disabled], [aria-disabled='true']") &&
      !element.closest("[hidden], [inert], [aria-hidden='true']") &&
      style.display !== "none" &&
      style.visibility === "visible" &&
      element.getClientRects().length > 0
    );
  };
  const accessibleName = (element) => {
    const direct =
      element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "";
    if (direct.trim()) return direct.trim();
    return (element.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  };
  const surfaceLabel = (element) =>
    element.getAttribute("aria-label")?.trim() ?? "";
  const roleOf = (element) => {
    const role = element.getAttribute("role");
    return [
      "main",
      "region",
      "list",
      "grid",
      "feed",
      "status",
      "alert",
      "progressbar",
      "group",
      "application",
      "presentation",
      "none",
    ].includes(role)
      ? role
      : role === null
        ? "absent"
        : "other";
  };
  const attrSignal = (element, attribute, pattern) =>
    pattern.test(element.getAttribute(attribute) ?? "");
  const statusTextSignals = (roots) => {
    let text = "";
    let inspectedCodeUnits = 0;
    let truncated = false;
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!(node.parentElement instanceof HTMLElement)) continue;
        if (node.parentElement.closest("[contenteditable], input, textarea"))
          continue;
        const chunk = node.nodeValue ?? "";
        if (inspectedCodeUnits + chunk.length > 2048) {
          truncated = true;
          break;
        }
        text += ` ${chunk}`;
        inspectedCodeUnits += chunk.length;
      }
      if (truncated) break;
    }
    return {
      emptyTextSignal: emptyPattern.test(text),
      loadingTextSignal: loadingPattern.test(text),
      textInspectionTruncated: truncated,
    };
  };
  const editorCandidates = Array.from(
    document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
  );
  const verifiedEditors = editorCandidates.filter((editor) => {
    const host = editor.closest("flow-rich-text-editor");
    const boundary = editor.closest("flow-base-prompt-box");
    const ownerName = accessibleName(editor).toLowerCase();
    return (
      visibleEnabled(editor) &&
      !editor.matches("[aria-readonly='true']") &&
      /\b(prompt|composer|create)\b/.test(ownerName) &&
      host !== null &&
      boundary !== null &&
      host.closest("flow-base-prompt-box") === boundary
    );
  });
  const boundaries = [
    ...new Set(
      verifiedEditors.map((editor) => editor.closest("flow-base-prompt-box")),
    ),
  ];
  const uniqueBoundary =
    verifiedEditors.length === 1 && boundaries.length === 1;
  const boundary = uniqueBoundary ? boundaries[0] : null;
  const controls = boundary
    ? Array.from(boundary.querySelectorAll("button, [role='button']"))
    : [];
  const generateControlReports = controls.map((control, index) => {
    const containsEditor = verifiedEditors.some((editor) =>
      control.contains(editor),
    );
    const accessibleName = containsEditor
      ? ""
      : control.getAttribute("aria-label")?.trim() ||
        control.textContent?.trim() ||
        "";
    const nameMatch = generateNamePattern.test(accessibleName);
    const nativeDisabled = control.matches(":disabled, [disabled]");
    const ariaDisabled = control.getAttribute("aria-disabled") === "true";
    const hiddenAncestor = Boolean(
      control.closest("[hidden], [inert], [aria-hidden='true']"),
    );
    const style = getComputedStyle(control);
    const cssHidden =
      style.display === "none" || style.visibility !== "visible";
    const hasClientRects = control.getClientRects().length > 0;
    const sameBoundary =
      boundary !== null && control.closest("flow-base-prompt-box") === boundary;
    const rejectionReasons = [
      containsEditor && "control_contains_editor",
      !nameMatch && "accessible_name_not_in_exact_allowlist",
      !control.isConnected && "disconnected",
      nativeDisabled && "disabled",
      ariaDisabled && "aria_disabled",
      hiddenAncestor && "hidden_ancestor",
      cssHidden && "css_hidden",
      !hasClientRects && "no_client_rects",
    ].filter(Boolean);
    return {
      candidate: index + 1,
      tag: control.tagName.toLowerCase(),
      role: roleOf(control),
      type:
        control.tagName.toLowerCase() === "button" ||
        control.tagName.toLowerCase() === "input"
          ? (control.type?.toLowerCase() ?? null)
          : null,
      ariaLabelPresent: control.hasAttribute("aria-label"),
      exactSupportedNameMatch: nameMatch,
      matchedSupportedName: nameMatch ? accessibleName.toLowerCase() : null,
      nativeDisabled,
      ariaDisabled,
      hiddenAncestor,
      cssHidden,
      hasClientRects,
      sameBoundary,
      visibleEnabled: visibleEnabled(control),
      rejectionReasons,
    };
  });
  const generateCandidates = generateControlReports.filter(
    (control) => control.exactSupportedNameMatch,
  );
  const enabledGenerateCandidates = generateCandidates.filter(
    (control) => control.visibleEnabled,
  );
  if (generateCandidates.length > 1) {
    for (const candidate of generateCandidates)
      candidate.rejectionReasons.push("multiple_exact_name_candidates");
  }

  const mainScopes = Array.from(
    document.querySelectorAll("main, [role='main']"),
  );
  const currentObserverQuery =
    'main [aria-label], [role="region"][aria-label], [role="list"][aria-label]';
  const currentObserverCandidates = Array.from(
    document.querySelectorAll(currentObserverQuery),
  );
  const surfaceQuery =
    'section, article, [role="region"], [role="list"], [role="grid"], [role="feed"], [data-result], [data-result-card], [data-testid], [aria-label]';
  const surfaceSet = new Set(currentObserverCandidates);
  for (const main of mainScopes) {
    for (const surface of main.querySelectorAll(surfaceQuery))
      surfaceSet.add(surface);
  }
  const surfaceNodes = Array.from(surfaceSet).filter((surface) => {
    const label = surfaceLabel(surface);
    const testId = surface.getAttribute("data-testid") ?? "";
    const dataResult =
      surface.hasAttribute("data-result") ||
      surface.hasAttribute("data-result-card");
    const hasStructure = surface.querySelector(
      'img, video, canvas, article, li, [role="listitem"], [role="gridcell"], [data-result-card]',
    );
    const hasEmptyOrLoading =
      emptyPattern.test(label) ||
      loadingPattern.test(label) ||
      attrSignal(surface, "data-state", /^(empty|loading|generating)$/i) ||
      attrSignal(surface, "data-testid", /empty|loading|result|gallery/i);
    return (
      resultLabelPattern.test(label) ||
      surfaceHintPattern.test(label) ||
      surfaceHintPattern.test(testId) ||
      dataResult ||
      hasStructure ||
      hasEmptyOrLoading ||
      ["region", "list", "grid", "feed"].includes(roleOf(surface))
    );
  });

  const describeSurface = (surface, index) => {
    const label = surfaceLabel(surface);
    const testId = surface.getAttribute("data-testid") ?? "";
    const state = surface.getAttribute("data-state") ?? "";
    const descendants = (selector) =>
      Number(surface.matches(selector)) +
      surface.querySelectorAll(selector).length;
    const media = Array.from(surface.querySelectorAll("img, video, canvas"));
    const visibleMediaCount = media.filter(visibleEnabled).length;
    const cardCount = descendants(
      'article, li, [role="listitem"], [role="gridcell"], [data-result-card], [data-testid*="result" i], [data-testid*="gallery-item" i]',
    );
    const emptyNodes = Array.from(
      surface.querySelectorAll(
        '[role="status"], [role="alert"], [aria-live], [data-empty-state], [data-testid*="empty" i], [data-state="empty"]',
      ),
    );
    const statusNodes = [
      ...(surface.matches(
        '[role="status"], [role="alert"], [aria-live], [data-empty-state], [data-testid*="empty" i], [data-state="empty"]',
      )
        ? [surface]
        : []),
      ...emptyNodes,
    ];
    const emptySignals = {
      labelText: emptyPattern.test(label),
      emptyStateAttribute: surface.hasAttribute("data-empty-state"),
      emptyDataState: state.toLowerCase() === "empty",
      emptyTestIdHint: /empty|no-results/i.test(testId),
      statusNodeCount: emptyNodes.length,
      statusTextHint: emptyNodes.some((node) =>
        emptyPattern.test(node.textContent ?? ""),
      ),
    };
    const loadingNodes = descendants(
      '[role="progressbar"], [aria-busy="true"], [data-loading="true"], [data-state="loading"], [data-state="generating"], [class*="spinner" i], [class*="loading" i]',
    );
    let busyAncestorCount = 0;
    let loadingAncestorCount = 0;
    for (
      let ancestor = surface.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor.getAttribute("aria-busy") === "true") busyAncestorCount++;
      if (
        /^(loading|generating)$/i.test(
          ancestor.getAttribute("data-state") ?? "",
        ) ||
        ancestor.matches(
          '[role="progressbar"], [data-loading="true"], [class*="spinner" i], [class*="loading" i]',
        )
      ) {
        loadingAncestorCount++;
      }
      if (ancestor === document.body) break;
    }
    const text = statusTextSignals(statusNodes);
    const loadingSignals = {
      ariaBusy: surface.getAttribute("aria-busy") === "true",
      loadingDataState: /^(loading|generating)$/i.test(state),
      loadingMarkerCount: loadingNodes,
      busyAncestorCount,
      loadingAncestorCount,
      loadingLabelText: loadingPattern.test(label),
      loadingStatusText: text.loadingTextSignal,
    };
    const positiveEmpty = Object.entries(emptySignals).some(
      ([key, value]) => key !== "statusNodeCount" && value === true,
    );
    const loading =
      loadingSignals.ariaBusy ||
      loadingSignals.loadingDataState ||
      loadingSignals.loadingMarkerCount > 0 ||
      loadingSignals.busyAncestorCount > 0 ||
      loadingSignals.loadingAncestorCount > 0 ||
      loadingSignals.loadingLabelText ||
      loadingSignals.loadingStatusText;
    const shown = visibleEnabled(surface);
    const stateClass = !shown
      ? "hidden_surface"
      : loading
        ? "loading"
        : cardCount > 0 || visibleMediaCount > 0
          ? "populated"
          : positiveEmpty
            ? "explicit_empty_signal"
            : "no_results_observed_empty_unverified";
    const rejectionReasons = [
      !shown && "not_visible_or_not_enabled",
      loading && "loading_or_busy",
      !resultLabelPattern.test(label) && "unsupported_current_observer_label",
      cardCount === 0 &&
        visibleMediaCount === 0 &&
        !positiveEmpty &&
        "zero_results_without_positive_empty_signal",
      text.textInspectionTruncated && "status_text_scan_truncated",
    ].filter(Boolean);
    return {
      candidate: index + 1,
      tag: surface.tagName.toLowerCase(),
      role: roleOf(surface),
      inMainScope: mainScopes.some((main) => main.contains(surface)),
      ariaLabelPresent: surface.hasAttribute("aria-label"),
      testIdPresent: surface.hasAttribute("data-testid"),
      resultLabelSignal: surfaceHintPattern.test(label),
      currentObserverLabelMatch: resultLabelPattern.test(label),
      resultTestIdSignal: surfaceHintPattern.test(testId),
      emptyDataState: state.toLowerCase() === "empty",
      loadingDataState: /^(loading|generating)$/i.test(state),
      visible: shown,
      directChildCount: surface.childElementCount,
      directChildTags: Array.from(surface.children)
        .slice(0, 8)
        .map((child) => child.tagName.toLowerCase()),
      resultCardCount: cardCount,
      scopedMediaCount: media.length,
      visibleScopedMediaCount: visibleMediaCount,
      emptySignals,
      loadingSignals,
      textSignals: {
        emptyTextHint: text.emptyTextSignal,
        loadingTextHint: text.loadingTextSignal,
        truncated: text.textInspectionTruncated,
      },
      classification: stateClass,
      rejectionReasons,
    };
  };

  const buildSnapshot = () => {
    const surfaces = surfaceNodes.slice(0, maxSurfaces).map(describeSurface);
    const currentVisible = currentObserverCandidates.filter((node) => {
      const label = surfaceLabel(node);
      return resultLabelPattern.test(label) && visibleEnabled(node);
    });
    const currentCount = currentObserverCandidates.filter((node) =>
      resultLabelPattern.test(surfaceLabel(node)),
    ).length;
    const observation =
      currentVisible.length > 1
        ? "ambiguous"
        : currentVisible.length === 0
          ? "missing"
          : "ready_under_current_resolver";
    return {
      candidateCount: surfaceNodes.length,
      plausibleResultSurfaceCount: surfaces.filter(
        (surface) =>
          surface.currentObserverLabelMatch ||
          surface.resultLabelSignal ||
          surface.resultTestIdSignal ||
          ["region", "list", "grid", "feed"].includes(surface.role),
      ).length,
      reportedCount: surfaces.length,
      truncated: surfaceNodes.length > maxSurfaces,
      currentResolver: {
        exactLabelCandidateCount: currentCount,
        visibleExactLabelCandidateCount: currentVisible.length,
        result: observation,
        note: "Current resolver treats a unique visible exact label as ready even when no results are found; that is not positive empty-state evidence.",
      },
      surfaces,
    };
  };

  const firstSnapshot = buildSnapshot();
  const mutationRoots = [
    ...mainScopes,
    ...currentObserverCandidates.filter(
      (candidate) => !mainScopes.some((main) => main.contains(candidate)),
    ),
  ];
  const uniqueMutationRoots = [...new Set(mutationRoots)];
  let mutationCount = 0;
  const observers = uniqueMutationRoots.map((root) => {
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
  const secondSnapshot = buildSnapshot();
  for (const observer of observers) {
    mutationCount += observer.takeRecords().length;
    observer.disconnect();
  }
  const signaturesMatch =
    JSON.stringify(firstSnapshot) === JSON.stringify(secondSnapshot);
  const stabilityAssessed = uniqueMutationRoots.length > 0;
  const stable = stabilityAssessed && mutationCount === 0 && signaturesMatch;
  const matchingCurrentSurfaces = secondSnapshot.surfaces.filter(
    (surface) => surface.currentObserverLabelMatch && surface.visible,
  );
  const currentSurfaceCount =
    secondSnapshot.currentResolver.visibleExactLabelCandidateCount;
  let overallResultsState;
  if (stabilityAssessed && !stable) {
    overallResultsState = "unstable_during_two_frame_sample";
  } else if (currentSurfaceCount > 1) {
    overallResultsState = "multiple_ambiguous_current_surfaces";
  } else if (currentSurfaceCount === 1) {
    const currentSurface = matchingCurrentSurfaces[0];
    if (!currentSurface) {
      overallResultsState = "surface_report_incomplete_or_truncated";
    } else if (currentSurface.classification === "loading") {
      overallResultsState = "loading";
    } else if (currentSurface.classification === "populated") {
      overallResultsState = "identified_populated_surface";
    } else if (currentSurface.classification === "explicit_empty_signal") {
      overallResultsState = "identified_empty_surface_with_positive_signal";
    } else {
      overallResultsState = "surface_identified_but_empty_unverified";
    }
  } else if (
    stabilityAssessed &&
    secondSnapshot.plausibleResultSurfaceCount > 1
  ) {
    overallResultsState = "multiple_possible_surfaces_need_review";
  } else {
    overallResultsState = "missing_or_unsupported_current_surface";
  }

  console.log(
    JSON.stringify(
      {
        diagnostic: "flow-results-baseline-readonly-v1",
        scope: "current_top_document_scoped_surface_signals",
        topFrame: window.top === window,
        readyState: document.readyState,
        iframeCount: document.querySelectorAll("iframe").length,
        openShadowHostCount: Array.from(document.querySelectorAll("*")).filter(
          (element) => element.shadowRoot,
        ).length,
        composerPreflight: {
          candidateCount: editorCandidates.length,
          verifiedEditorCount: verifiedEditors.length,
          verifiedBoundaryCount: boundaries.length,
          state:
            verifiedEditors.length === 1 && boundaries.length === 1
              ? "unique_observed_rich_text_composer"
              : verifiedEditors.length === 0
                ? "missing"
                : "ambiguous",
        },
        generatePreflight: {
          controlCandidateCount: controls.length,
          exactNameCandidateCount: generateCandidates.length,
          visibleEnabledExactNameCount: enabledGenerateCandidates.length,
          controls: generateControlReports,
          state: !uniqueBoundary
            ? "composer_not_unique"
            : generateCandidates.length > 1
              ? "ambiguous"
              : generateCandidates.length === 0
                ? "missing"
                : enabledGenerateCandidates.length === 1
                  ? "identified"
                  : "disabled_or_hidden",
        },
        resultsPreflight: {
          state: overallResultsState,
          stabilityStatus: !stabilityAssessed
            ? "not_assessed_no_scoped_root"
            : stable
              ? "stable_across_two_animation_frames"
              : "unstable_during_two_frame_sample",
          stableAcrossTwoAnimationFrames: stabilityAssessed ? stable : null,
          mutationsInObservedResultScopes: mutationCount,
          snapshotsMatch: signaturesMatch,
          currentResolver: secondSnapshot.currentResolver,
          surfaceCandidateCount: secondSnapshot.candidateCount,
          reportedSurfaceCount: secondSnapshot.reportedCount,
          surfacesTruncated: secondSnapshot.truncated,
          surfaces: secondSnapshot.surfaces,
        },
        workerOnlyChecks: {
          selectedProjectAndDocumentBinding: "requires_live_worker_preflight",
          savedSourceAndImmutableSnapshot: "requires_live_worker_preflight",
          exactPromptEquality: "not_read_by_this_diagnostic",
          manualSettingsConfirmation: "requires_live_worker_preflight",
          durableAttemptAndDuplicateState: "requires_live_worker_preflight",
        },
      },
      null,
      2,
    ),
  );
})();
