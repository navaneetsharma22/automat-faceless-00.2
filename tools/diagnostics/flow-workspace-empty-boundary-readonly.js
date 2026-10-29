/* global document, window, getComputedStyle, requestAnimationFrame, console, HTMLElement, NodeFilter, MutationObserver, ShadowRoot */
// Paste into DevTools Console on the existing Flow tab. Read-only.
// The known empty-state phrase is an investigation anchor, never proof of an empty project.
(async () => {
  const knownPhrase = "Start creating or drop media";
  const workspacePattern =
    /workspace|project|canvas|studio|gallery|results|generation/i;
  const accountPattern = /account|profile|user|tier|billing|avatar/i;
  const loadingTextPattern = /\b(loading|generating|processing|please wait)\b/i;
  const emptyStatePattern = /\b(empty|no media|no results|nothing to show)\b/i;
  const maxAncestors = 14;
  const maxScopeSummaries = 10;
  const maxCustomTags = 24;
  const ignoredTextTags = new Set([
    "script",
    "style",
    "noscript",
    "template",
    "title",
  ]);

  const normalize = (value) => value.replace(/\s+/g, " ").trim();
  const isExactKnownPhrase = (value) =>
    normalize(value).toLowerCase() === normalize(knownPhrase).toLowerCase();
  const hasKnownPhrase = (value) =>
    normalize(value)
      .toLowerCase()
      .includes(normalize(knownPhrase).toLowerCase());
  const roleOf = (element) => {
    const role = element.getAttribute("role");
    return [
      "main",
      "navigation",
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
  const accessibleEditorName = (element) => {
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
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      isConnected: element.isConnected,
      hiddenAttribute: element.hasAttribute("hidden"),
      hiddenAncestor: Boolean(
        element.parentElement?.closest(
          "[hidden], [inert], [aria-hidden='true']",
        ),
      ),
      cssHidden:
        style.display === "none" ||
        ["hidden", "collapse"].includes(style.visibility),
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
  const relevantAttributes = (element) =>
    [
      element.tagName.toLowerCase(),
      element.getAttribute("role") ?? "",
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("data-testid") ?? "",
      typeof element.className === "string" ? element.className : "",
      element.getAttribute("data-state") ?? "",
      element.getAttribute("data-loading") ?? "",
      element.getAttribute("data-empty-state") ?? "",
    ].join(" ");
  const tagHint = (element, pattern) =>
    pattern.test(relevantAttributes(element));
  const textMarkerSignals = (root) => {
    const roots = [
      ...(root.matches(
        '[role="status"], [role="alert"], [aria-live], [data-empty-state], [data-testid*="empty" i], [data-state="empty"], [data-loading="true"], [data-state="loading"], [data-state="generating"]',
      )
        ? [root]
        : []),
      ...root.querySelectorAll(
        '[role="status"], [role="alert"], [aria-live], [data-empty-state], [data-testid*="empty" i], [data-state="empty"], [data-loading="true"], [data-state="loading"], [data-state="generating"]',
      ),
    ];
    let joined = "";
    let truncated = false;
    for (const statusRoot of roots) {
      const walker = document.createTreeWalker(
        statusRoot,
        NodeFilter.SHOW_TEXT,
      );
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!(node.parentElement instanceof HTMLElement)) continue;
        if (node.parentElement.closest("[contenteditable], input, textarea"))
          continue;
        const tag = node.parentElement.tagName.toLowerCase();
        if (ignoredTextTags.has(tag)) continue;
        const chunk = node.nodeValue ?? "";
        if (joined.length + chunk.length > 2048) {
          truncated = true;
          break;
        }
        joined += ` ${chunk}`;
      }
      if (truncated) break;
    }
    return {
      emptyStatusTextHint: emptyStatePattern.test(joined),
      loadingStatusTextHint: loadingTextPattern.test(joined),
      statusTextScanTruncated: truncated,
    };
  };
  const parentElementAcrossShadow = (element) => {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const ancestry = (element, limit = maxAncestors) => {
    const path = [];
    const seen = new Set();
    for (
      let current = element;
      current && path.length < limit && !seen.has(current);
      current = parentElementAcrossShadow(current)
    ) {
      seen.add(current);
      path.push(current);
    }
    return path;
  };
  const allDocumentAndOpenShadowRoots = () => {
    const roots = [document];
    const hosts = [];
    for (let index = 0; index < roots.length; index++) {
      const root = roots[index];
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) {
          hosts.push(element);
          roots.push(element.shadowRoot);
        }
      }
    }
    return { roots, hosts };
  };
  const editorCandidates = Array.from(
    document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
  );
  const verifiedEditors = editorCandidates.filter((editor) => {
    const host = editor.closest("flow-rich-text-editor");
    const boundary = editor.closest("flow-base-prompt-box");
    const label = `${accessibleEditorName(editor)} ${editor.getAttribute("data-testid") ?? ""}`;
    return (
      editor.isConnected &&
      visible(editor).visible &&
      !editor.matches(
        "[disabled], [aria-disabled='true'], [aria-readonly='true']",
      ) &&
      /\b(prompt|composer|create)\b/i.test(label) &&
      host !== null &&
      boundary !== null &&
      host.closest("flow-base-prompt-box") === boundary
    );
  });
  const composerBoundaries = [
    ...new Set(
      verifiedEditors.map((editor) => editor.closest("flow-base-prompt-box")),
    ),
  ];
  const uniqueComposer =
    verifiedEditors.length === 1 && composerBoundaries.length === 1;
  const composer = uniqueComposer ? composerBoundaries[0] : null;
  const shadow = allDocumentAndOpenShadowRoots();
  const anchors = new Map();
  let scannedTextNodes = 0;
  let textScanTruncated = false;
  const textNodeLimit = 50000;
  for (const root of shadow.roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      scannedTextNodes++;
      if (scannedTextNodes > textNodeLimit) {
        textScanTruncated = true;
        break;
      }
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || parent.closest("[contenteditable], input, textarea"))
        continue;
      if (ignoredTextTags.has(parent.tagName.toLowerCase())) continue;
      const nodeText = normalize(node.nodeValue ?? "");
      const path = ancestry(parent, 8);
      let matchElement = null;
      let matchMode = null;
      if (isExactKnownPhrase(nodeText)) {
        matchElement = parent;
        matchMode = "exact_text_node";
      } else {
        for (const candidate of path) {
          if (candidate.querySelector("[contenteditable], input, textarea"))
            continue;
          const candidateText = normalize(candidate.textContent ?? "");
          if (isExactKnownPhrase(candidateText)) {
            matchElement = candidate;
            matchMode = "exact_element_text";
            break;
          }
          if (hasKnownPhrase(candidateText)) {
            matchElement = candidate;
            matchMode = "phrase_within_element_text";
            break;
          }
        }
      }
      if (matchElement) {
        const list = anchors.get(matchElement) ?? new Set();
        list.add(matchMode);
        anchors.set(matchElement, list);
      }
    }
    if (textScanTruncated) break;
  }

  const summarizeScope = (scope, anchor, index) => {
    const media = Array.from(scope.querySelectorAll("img, video, canvas"));
    const mediaSelector = "img, video, canvas";
    const cardSelector =
      'article, li, [role="listitem"], [role="gridcell"], [data-result-card], [data-testid*="card" i], [data-testid*="asset" i], [data-testid*="media" i]';
    const cards = Array.from(scope.querySelectorAll(cardSelector));
    const loadingSelector =
      '[role="progressbar"], [aria-busy="true"], [data-loading="true"], [data-state="loading"], [data-state="generating"], [class*="spinner" i], [class*="loading" i]';
    const loadingNodes =
      Number(scope.matches(loadingSelector)) +
      Array.from(scope.querySelectorAll(loadingSelector)).length;
    const emptyNodes = Array.from(
      scope.querySelectorAll(
        '[data-empty-state], [data-state="empty"], [data-testid*="empty" i], [role="status"], [role="alert"], [aria-live]',
      ),
    );
    const customTags = Array.from(scope.querySelectorAll("*"))
      .filter((node) => node.localName.includes("-"))
      .map((node) => node.localName);
    const uniqueCustomTags = [...new Set(customTags)];
    const excludedAccountTags = uniqueCustomTags.filter((tag) =>
      accountPattern.test(tag),
    );
    const relevantCustomTags = uniqueCustomTags
      .filter((tag) => !accountPattern.test(tag))
      .filter((tag) =>
        /flow|workspace|project|canvas|gallery|result|media|asset|generation|creation/i.test(
          tag,
        ),
      )
      .slice(0, maxCustomTags);
    const filterControls = scope.querySelectorAll(
      'input[type="search"], [role="searchbox"], [aria-pressed="true"], [aria-selected="true"], [data-filter], [data-testid*="filter" i]',
    ).length;
    const workspaceHint = tagHint(scope, workspacePattern);
    const navAccountHint =
      Boolean(scope.closest("nav, [role='navigation'], header")) ||
      tagHint(scope, accountPattern) ||
      uniqueCustomTags.some((tag) => accountPattern.test(tag));
    const phraseVisible = visible(anchor).visible;
    const statusSignals = textMarkerSignals(scope);
    const mediaCount = Number(scope.matches(mediaSelector)) + media.length;
    const cardCount = Number(scope.matches(cardSelector)) + cards.length;
    const stateAssessment =
      loadingNodes > 0 || statusSignals.loadingStatusTextHint
        ? "loading_or_processing_signal"
        : mediaCount > 0 || cardCount > 0
          ? filterControls > 0
            ? "populated_or_filtered_scope"
            : "populated_scope"
          : emptyNodes.length > 0 || statusSignals.emptyStatusTextHint
            ? "empty_marker_present_not_project_zero_proof"
            : "no_scoped_cards_observed_empty_unverified";
    return {
      scopeCandidate: index + 1,
      tag: scope.tagName.toLowerCase(),
      role: roleOf(scope),
      visibility: visible(scope),
      workspaceBoundaryHint: workspaceHint,
      containsPhraseAnchor: scope === anchor || scope.contains(anchor),
      containsVerifiedComposer: Boolean(
        composer && (scope === composer || scope.contains(composer)),
      ),
      sameFlowBasePromptBoxAsComposer: Boolean(
        composer && scope.closest("flow-base-prompt-box") === composer,
      ),
      phraseVisible,
      mediaNodeCount: mediaCount,
      visibleMediaNodeCount: media.filter((node) => visible(node).visible)
        .length,
      resultCardNodeCount: cardCount,
      hiddenResultCardCount: cards.filter((node) => !visible(node).visible)
        .length,
      loadingMarkerCount: loadingNodes,
      busySelf: scope.getAttribute("aria-busy") === "true",
      emptyMarkerCount: emptyNodes.length,
      emptyDataState: scope.getAttribute("data-state") === "empty",
      emptyStatusTextHint: statusSignals.emptyStatusTextHint,
      loadingStatusTextHint: statusSignals.loadingStatusTextHint,
      searchOrSelectedFilterSignalCount: filterControls,
      filteredStateHint: filterControls > 0,
      stateAssessment,
      relevantCustomElementTags: relevantCustomTags,
      accountLikeCustomElementCount: excludedAccountTags.length,
      directChildCount: scope.childElementCount,
      directChildTags: Array.from(scope.children)
        .slice(0, 10)
        .map((child) => child.localName),
      candidateRole: roleOf(scope),
      rejectionReasons: [
        !workspaceHint && "workspace_boundary_not_semantically_marked",
        navAccountHint && "navigation_or_account_context_hint",
        !phraseVisible && "phrase_anchor_hidden",
        mediaCount === 0 &&
          cardCount === 0 &&
          "no_scoped_media_or_result_card_nodes",
        emptyNodes.length > 0 && "empty_marker_is_not_project_zero_proof",
      ].filter(Boolean),
    };
  };

  const buildSnapshot = () => {
    const anchorReports = [...anchors.entries()].map(
      ([anchor, modes], index) => {
        const path = ancestry(anchor);
        const workspaceAncestors = path.filter(
          (element) =>
            tagHint(element, workspacePattern) ||
            element.localName === "main" ||
            element.getAttribute("role") === "main",
        );
        const navAncestor = path.find((element) =>
          element.matches("nav, [role='navigation'], header"),
        );
        const accountAncestor = path.find((element) =>
          tagHint(element, accountPattern),
        );
        const phraseMain = path.find(
          (element) =>
            element.localName === "main" ||
            element.getAttribute("role") === "main",
        );
        const composerMain = composer
          ? ancestry(composer).find(
              (element) =>
                element.localName === "main" ||
                element.getAttribute("role") === "main",
            )
          : null;
        const scopeSet = new Set([
          anchor,
          ...workspaceAncestors,
          ...path
            .filter((element) =>
              ["div", "section", "article"].includes(element.localName),
            )
            .slice(0, 5),
        ]);
        const scopes = [...scopeSet].slice(0, maxScopeSummaries);
        const scopedStructure = scopes.map((scope, index) =>
          summarizeScope(scope, anchor, index),
        );
        return {
          anchor: index + 1,
          tag: anchor.tagName.toLowerCase(),
          role: roleOf(anchor),
          customElement: anchor.localName.includes("-"),
          matchModes: [...modes],
          exactKnownPhraseDetected: true,
          phraseIsInvestigationAnchorOnly: true,
          wholeProjectZeroResultsProven: false,
          visibility: visible(anchor),
          ariaLabelPresent: anchor.hasAttribute("aria-label"),
          labelledByPresent: anchor.hasAttribute("aria-labelledby"),
          testIdPresent: anchor.hasAttribute("data-testid"),
          workspaceBoundaryCandidateCountOnPath: workspaceAncestors.length,
          multipleWorkspaceBoundaryHints: workspaceAncestors.length > 1,
          workspaceBoundaryCandidates: workspaceAncestors.map((element) => ({
            tag: element.tagName.toLowerCase(),
            role: roleOf(element),
            customElement: element.localName.includes("-"),
            visibility: visible(element),
            ariaLabelPresent: element.hasAttribute("aria-label"),
            testIdPresent: element.hasAttribute("data-testid"),
            containsComposer: Boolean(
              composer && (element === composer || element.contains(composer)),
            ),
          })),
          relationshipToComposer: {
            verifiedComposerCount: verifiedEditors.length,
            composerBoundaryCount: composerBoundaries.length,
            phraseInsideComposer: Boolean(composer?.contains(anchor)),
            phraseAndComposerShareMainScope: Boolean(
              phraseMain && composerMain && phraseMain === composerMain,
            ),
            phraseMainRole: phraseMain ? roleOf(phraseMain) : "absent",
            composerMainRole: composerMain ? roleOf(composerMain) : "absent",
            navigationAncestorPresent: Boolean(navAncestor),
            accountContextAncestorPresent: Boolean(accountAncestor),
          },
          nearestWorkspaceBoundaryCandidate:
            workspaceAncestors.length > 0
              ? {
                  tag: workspaceAncestors[0].tagName.toLowerCase(),
                  role: roleOf(workspaceAncestors[0]),
                  visibility: visible(workspaceAncestors[0]),
                }
              : null,
          ancestorStructure: path.map((element, depth) => ({
            depth,
            tag: element.tagName.toLowerCase(),
            role: roleOf(element),
            customElement: element.localName.includes("-"),
            workspaceBoundaryHint: tagHint(element, workspacePattern),
            navigationHint: element.matches("nav, [role='navigation'], header"),
            accountContextHint: tagHint(element, accountPattern),
            ariaLabelPresent: element.hasAttribute("aria-label"),
            testIdPresent: element.hasAttribute("data-testid"),
          })),
          scopedStructure,
          scopeCandidateCount: scopedStructure.length,
        };
      },
    );
    return {
      phraseAnchorCount: anchorReports.length,
      visiblePhraseAnchorCount: anchorReports.filter(
        (anchor) => anchor.visibility.visible,
      ).length,
      hiddenPhraseAnchorCount: anchorReports.filter(
        (anchor) => !anchor.visibility.visible,
      ).length,
      phraseScanTruncated: textScanTruncated,
      scannedTextNodeCount: Math.min(scannedTextNodes, textNodeLimit),
      anchors: anchorReports,
    };
  };

  const firstSnapshot = buildSnapshot();
  const workspaceRoots = new Set();
  for (const anchor of anchors.keys()) {
    for (const element of ancestry(anchor)) {
      if (
        tagHint(element, workspacePattern) ||
        element.localName === "main" ||
        element.getAttribute("role") === "main"
      ) {
        workspaceRoots.add(element);
      }
    }
  }
  const mutationRoots = [...workspaceRoots].filter(
    (root) =>
      ![...workspaceRoots].some(
        (other) => other !== root && other.contains(root),
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
  const secondSnapshot = buildSnapshot();
  for (const observer of observers) {
    mutationCount += observer.takeRecords().length;
    observer.disconnect();
  }
  const snapshotsMatch =
    JSON.stringify(firstSnapshot) === JSON.stringify(secondSnapshot);
  const stabilityAssessed = mutationRoots.length > 0;
  const stable = stabilityAssessed && mutationCount === 0 && snapshotsMatch;
  const assessment = !stabilityAssessed
    ? "not_assessed_no_workspace_scope"
    : !stable
      ? "unstable_during_two_frame_sample"
      : secondSnapshot.phraseAnchorCount === 0
        ? "phrase_not_found_in_scanned_document_and_open_shadow_roots"
        : secondSnapshot.phraseAnchorCount > 1
          ? "multiple_phrase_anchors_require_review"
          : secondSnapshot.anchors[0].relationshipToComposer
                .navigationAncestorPresent ||
              secondSnapshot.anchors[0].relationshipToComposer
                .accountContextAncestorPresent
            ? "phrase_anchor_in_navigation_or_account_context"
            : "phrase_anchor_context_reported_scope_only";
  console.log(
    JSON.stringify(
      {
        diagnostic: "flow-workspace-empty-boundary-readonly-v1",
        scope: "current_top_document_and_open_shadow_roots",
        investigationPhraseMatched: true,
        topFrame: window.top === window,
        readyState: document.readyState,
        iframeCount: document.querySelectorAll("iframe").length,
        openShadowHostCount: shadow.hosts.length,
        composerPreflight: {
          candidateCount: editorCandidates.length,
          verifiedEditorCount: verifiedEditors.length,
          verifiedBoundaryCount: composerBoundaries.length,
          uniqueObservedComposer: uniqueComposer,
        },
        phraseSearch: {
          exactPhraseConfigured: true,
          phraseNotIncludedInOutput: true,
          excludesEditableContent: true,
          textScanLimit: textNodeLimit,
          textScanTruncated,
        },
        workspaceAssessment: assessment,
        stability: {
          assessedWithinWorkspaceScopes: stabilityAssessed,
          stableAcrossTwoAnimationFrames: stabilityAssessed ? stable : null,
          mutationsInObservedWorkspaceScopes: mutationCount,
          signaturesMatch: snapshotsMatch,
        },
        phraseAnchors: secondSnapshot,
        interpretationLimits: {
          phraseAloneProvesProjectEmpty: false,
          zeroScopedMediaProvesProjectEmpty: false,
          countsAreScopedToReportedAncestorCandidates: true,
          rawPageTextReturned: false,
          rawLabelsReturned: false,
          urlsOrMediaSourcesReturned: false,
          accountDataOrCredentialsReturned: false,
          shadowRootsClosedOrCrossOriginFramesInspected: false,
        },
      },
      null,
      2,
    ),
  );
})();
