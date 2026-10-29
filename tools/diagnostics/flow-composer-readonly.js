/* global document, window, getComputedStyle, NodeFilter */
// Paste into DevTools Console on the existing selected Flow tab. Read-only.
// Emits structure and fixed signal/rejection codes, never editor values or labels.
(() => {
  const currentQuery =
    'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]';
  const boundaryQuery =
    'form, [role="form"], [role="group"], [role="region"], [data-composer]';
  const placeholder = "what do you want to create?";
  const currentEditors = new Set(document.querySelectorAll(currentQuery));
  const editors = Array.from(
    document.querySelectorAll(
      `${currentQuery}, [contenteditable], [role="searchbox"]`,
    ),
  );
  const limit = 30;
  const name = (element) => {
    if (!element) return "";
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
  const ownerHint = (element) =>
    /prompt|composer|create/i.test(
      `${name(element)} ${element?.getAttribute("data-testid") ?? ""}`,
    );
  const describe = (element) => {
    const role = element.getAttribute("role");
    const editable = element.getAttribute("contenteditable");
    return {
      tag: element.tagName.toLowerCase(),
      role: [
        "textbox",
        "searchbox",
        "combobox",
        "application",
        "document",
        "generic",
        "paragraph",
        "search",
        "form",
        "group",
        "region",
        "button",
        "main",
        "banner",
        "navigation",
        "presentation",
        "none",
      ].includes(role)
        ? role
        : role === null
          ? "absent"
          : "other",
      contenteditable: ["true", "false", "plaintext-only", ""].includes(
        editable,
      )
        ? editable === ""
          ? "empty-attribute"
          : editable
        : editable === null
          ? "absent"
          : "other",
      isContentEditable: element.isContentEditable === true,
      labelAttributePresent:
        element.hasAttribute("aria-label") || element.hasAttribute("title"),
      labelledByPresent: element.hasAttribute("aria-labelledby"),
      nameSignals: ["prompt", "composer", "create", "search"].filter((word) =>
        new RegExp(`\\b${word}\\b`, "i").test(name(element)),
      ),
      testIdOwnerHint: /prompt|composer|create/i.test(
        element.getAttribute("data-testid") ?? "",
      ),
      dataComposerPresent: element.hasAttribute("data-composer"),
      slateEditorMarker: element.hasAttribute("data-slate-editor"),
      lexicalEditorMarker: element.hasAttribute("data-lexical-editor"),
      slatePlaceholderDescendant: Boolean(
        element.querySelector("[data-slate-placeholder]"),
      ),
      placeholderAttributePresent: element.hasAttribute("placeholder"),
      dataPlaceholderPresent: element.hasAttribute("data-placeholder"),
      placeholderMatches:
        (
          element.getAttribute("placeholder") ??
          element.getAttribute("data-placeholder") ??
          ""
        ).toLowerCase() === placeholder,
      directChildTags: Array.from(element.children)
        .slice(0, 5)
        .map((child) => child.tagName.toLowerCase()),
      childCount: element.childElementCount,
      buttonCount: element.querySelectorAll('button, [role="button"]').length,
    };
  };
  const candidates = editors.slice(0, limit).map((editor, index) => {
    const boundary = editor.closest(boundaryQuery);
    const ownedBoundary = boundary && ownerHint(boundary);
    const style = getComputedStyle(editor);
    const disabled = editor.matches(
      ":disabled, [disabled], [aria-disabled='true']",
    );
    const hiddenAncestor = Boolean(
      editor.closest("[hidden], [inert], [aria-hidden='true']"),
    );
    const cssHidden =
      style.display === "none" ||
      ["hidden", "collapse"].includes(style.visibility);
    const hasClientRects = editor.getClientRects().length > 0;
    const runtimeVisible =
      editor.isConnected &&
      !disabled &&
      !hiddenAncestor &&
      !cssHidden &&
      hasClientRects;
    const inputType =
      editor.tagName.toLowerCase() === "input"
        ? editor.type.toLowerCase()
        : null;
    const kind =
      editor.tagName.toLowerCase() === "textarea"
        ? "textarea"
        : inputType === "text" || inputType === "search"
          ? "text-input"
          : editor.getAttribute("contenteditable") === "true" &&
              editor.getAttribute("role") === "textbox"
            ? "contenteditable"
            : "unrecognized";
    const words =
      `${name(editor)} ${editor.getAttribute("placeholder") ?? ""} ${name(boundary)}`.toLowerCase();
    const search =
      inputType === "search" ||
      Boolean(editor.closest('[role="search"]')) ||
      /\bsearch\b/.test(words);
    const owner = /prompt|composer|create/i.test(
      `${name(editor)} ${name(boundary)} ${boundary?.getAttribute("data-testid") ?? ""}`,
    );
    const promptSignal =
      (
        editor.getAttribute("placeholder") ??
        editor.getAttribute("data-placeholder") ??
        ""
      ).toLowerCase() === placeholder || /prompt|composer/.test(words);
    const rejections = [
      !currentEditors.has(editor) && "outside_current_candidate_query",
      !boundary && "no_current_boundary",
      boundary && !ownedBoundary && "boundary_lacks_owner_signal",
      !editor.isConnected && "disconnected",
      disabled && "disabled",
      hiddenAncestor && "hidden_inert_or_aria_hidden_ancestor",
      cssHidden && "css_hidden",
      !hasClientRects && "no_client_rects",
      search && "search_control",
      kind === "unrecognized" && "unrecognized_editor_kind",
      !owner && "missing_composer_owner_signal",
      !promptSignal && "missing_prompt_signal",
    ].filter(Boolean);
    const ancestors = [];
    for (
      let parent = editor.parentElement;
      parent && ancestors.length < 5;
      parent = parent.parentElement
    ) {
      ancestors.push(describe(parent));
    }
    const rect = editor.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    return {
      candidate: index + 1,
      ...describe(editor),
      inputType:
        inputType === null || ["text", "search"].includes(inputType)
          ? inputType
          : "other",
      readOnly:
        editor.readOnly === true ||
        editor.getAttribute("aria-readonly") === "true",
      disabled,
      disabledAncestor: Boolean(
        editor.parentElement?.closest("[disabled], [aria-disabled='true']"),
      ),
      hiddenAncestor,
      cssHidden,
      hasClientRects,
      runtimeVisible,
      viewportBand:
        rect.bottom <= 0 || rect.top >= window.innerHeight
          ? "outside"
          : center < window.innerHeight / 3
            ? "top"
            : center > (window.innerHeight * 2) / 3
              ? "bottom"
              : "middle",
      currentEditorKind: kind,
      currentBoundary: boundary ? describe(boundary) : null,
      currentRuntimeWouldMatch: rejections.length === 0,
      currentRuntimeRejections: rejections,
      currentMethodBlock:
        kind === "contenteditable"
          ? "contenteditable_entry_not_implemented"
          : kind === "unrecognized"
            ? "editor_kind_unrecognized"
            : null,
      ancestors,
    };
  });
  const controlLimit = 40;
  const observedComposers = new Map();
  editors.slice(0, limit).forEach((editor, index) => {
    const report = candidates[index];
    if (!report || !report.runtimeVisible || report.disabledAncestor) return;
    if (
      editor.tagName.toLowerCase() !== "div" ||
      editor.getAttribute("contenteditable") !== "true" ||
      editor.getAttribute("role") !== "textbox"
    )
      return;
    const richHost = editor.closest("flow-rich-text-editor");
    const boundary = editor.closest("flow-base-prompt-box");
    if (
      !richHost ||
      !boundary ||
      richHost.closest("flow-base-prompt-box") !== boundary
    )
      return;
    const ownerSignal = report.nameSignals.some((signal) =>
      ["prompt", "composer", "create"].includes(signal),
    );
    if (
      !ownerSignal ||
      report.readOnly ||
      report.nameSignals.includes("search") ||
      editor.closest('[role="search"], [role="searchbox"]')
    )
      return;
    const entry = observedComposers.get(boundary) ?? [];
    entry.push({ editor, candidate: index + 1 });
    observedComposers.set(boundary, entry);
  });

  const controlDiagnostics = Array.from(
    observedComposers,
    ([boundary, entries]) => {
      const editorsInBoundary = entries.map((entry) => entry.editor);
      const controls = Array.from(
        boundary.querySelectorAll('button, [role="button"]'),
      );
      const controlReports = controls
        .slice(0, controlLimit)
        .map((control, index) => {
          const ariaLabel = control.getAttribute("aria-label") ?? "";
          const directName = ariaLabel.trim();
          let safeText = "";
          let textInspectionTruncated = false;
          if (!editorsInBoundary.some((editor) => control.contains(editor))) {
            const walker = document.createTreeWalker(
              control,
              NodeFilter.SHOW_TEXT,
            );
            while (walker.nextNode()) {
              const nodeText = walker.currentNode.nodeValue ?? "";
              if (safeText.length + nodeText.length > 512) {
                textInspectionTruncated = true;
                break;
              }
              safeText += ` ${nodeText}`;
            }
          }
          const resolverName = (directName || safeText.trim()).replace(
            /\s+/g,
            " ",
          );
          const currentResolverNameMatch =
            /^(generate|generate image|create image)$/i.test(resolverName);
          const signalText = [
            directName,
            control.getAttribute("title") ?? "",
            control.getAttribute("data-icon") ?? "",
            control.getAttribute("data-testid") ?? "",
            typeof control.className === "string" ? control.className : "",
            safeText,
            ...Array.from(
              control.querySelectorAll("svg, [data-icon]"),
              (icon) =>
                [
                  icon.getAttribute("aria-label") ?? "",
                  icon.getAttribute("title") ?? "",
                  icon.getAttribute("data-icon") ?? "",
                  typeof icon.className === "string" ? icon.className : "",
                ].join(" "),
            ),
          ].join(" ");
          const iconSignals = [
            [
              "arrow",
              /arrow|chevron|north_east|keyboard_return|trending_flat/i,
            ],
            ["send", /send|submit|forward/i],
            ["wand_or_sparkle", /wand|auto_awesome|magic|sparkle/i],
            ["add_or_plus", /(?:^|[\s_-])add(?:$|[\s_-])|plus/i],
            ["image", /image|photo|picture/i],
          ]
            .filter(([, pattern]) => pattern.test(signalText))
            .map(([signal]) => signal);
          const role = control.getAttribute("role");
          const type =
            control.tagName.toLowerCase() === "button" ||
            control.tagName.toLowerCase() === "input"
              ? (control.type?.toLowerCase() ?? null)
              : null;
          const nativeDisabled = control.matches(":disabled, [disabled]");
          const ariaDisabled = control.getAttribute("aria-disabled") === "true";
          const disabledAncestor = Boolean(
            control.parentElement?.closest(
              "[disabled], [aria-disabled='true']",
            ),
          );
          const hiddenAncestor = Boolean(
            control.closest("[hidden], [inert], [aria-hidden='true']"),
          );
          const style = getComputedStyle(control);
          const cssHidden =
            style.display === "none" ||
            ["hidden", "collapse"].includes(style.visibility);
          const hasClientRects = control.getClientRects().length > 0;
          const rect = control.getBoundingClientRect();
          const zeroArea = rect.width <= 0 || rect.height <= 0;
          const visible =
            control.isConnected &&
            !nativeDisabled &&
            !ariaDisabled &&
            !disabledAncestor &&
            !hiddenAncestor &&
            !cssHidden &&
            style.visibility === "visible" &&
            hasClientRects;
          const sameBoundary =
            control.closest("flow-base-prompt-box") === boundary;
          const containsEditor = editorsInBoundary.some((editor) =>
            control.contains(editor),
          );
          const insideEditor = editorsInBoundary.some((editor) =>
            editor.contains(control),
          );
          let boundaryDistance = null;
          for (
            let ancestor = control;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            if (ancestor === boundary) {
              boundaryDistance = 0;
              break;
            }
            if (ancestor.parentElement === boundary) {
              boundaryDistance = 1;
              break;
            }
          }
          const commonAncestor = (() => {
            const ancestors = new Set();
            for (let node = control; node; node = node.parentElement)
              ancestors.add(node);
            for (
              let node = editorsInBoundary[0];
              node;
              node = node.parentElement
            ) {
              if (ancestors.has(node)) return node;
            }
            return null;
          })();
          const rejectionReasons = [
            !sameBoundary && "not_in_same_composer_boundary",
            containsEditor && "control_contains_editor",
            insideEditor && "control_is_inside_editor",
            !currentResolverNameMatch &&
              "accessible_name_not_in_current_allowlist",
            !currentResolverNameMatch &&
              iconSignals.length > 0 &&
              "icon_signal_does_not_establish_generate_name",
            nativeDisabled && "disabled",
            ariaDisabled && "aria_disabled",
            disabledAncestor && "disabled_ancestor",
            hiddenAncestor && "hidden_ancestor",
            cssHidden && "css_hidden",
            !hasClientRects && "no_client_rects",
            zeroArea && "zero_area",
            textInspectionTruncated && "control_text_inspection_truncated",
          ].filter(Boolean);
          return {
            candidate: index + 1,
            tag: control.tagName.toLowerCase(),
            role: role ?? "absent",
            type: ["button", "submit", "reset", "image", "menu"].includes(type)
              ? type
              : type === null
                ? null
                : "other",
            signals: {
              generate: /\bgenerate\b/i.test(signalText),
              create: /\bcreate\b/i.test(signalText),
              image: /\bimage\b/i.test(signalText),
              recognizedIcons: iconSignals,
              svgDescendant: Boolean(control.querySelector("svg")),
              ariaLabelPresent: control.hasAttribute("aria-label"),
              titlePresent: control.hasAttribute("title"),
              testIdPresent: control.hasAttribute("data-testid"),
            },
            currentResolverNameMatch,
            nativeDisabled,
            ariaDisabled,
            disabledAncestor,
            hiddenAncestor,
            cssHidden,
            isConnected: control.isConnected,
            hasClientRects,
            zeroArea,
            runtimeVisibleAndEnabled: visible,
            relationship: {
              withinComposerBoundary: boundary.contains(control),
              sameComposerBoundary: sameBoundary,
              boundaryDistance,
              containsEditor,
              insideEditor,
              commonAncestorTag: commonAncestor?.tagName.toLowerCase() ?? null,
            },
            eligibleUnderCurrentResolver: currentResolverNameMatch && visible,
            rejectionReasons,
          };
        });
      const exactNameCount = controlReports.filter(
        (control) => control.currentResolverNameMatch,
      ).length;
      const enabledExactNameCount = controlReports.filter(
        (control) =>
          control.currentResolverNameMatch && control.runtimeVisibleAndEnabled,
      ).length;
      const state =
        controls.length > controlLimit
          ? "truncated_unresolved"
          : entries.length !== 1
            ? "ambiguous_editors_in_composer"
            : exactNameCount > 1
              ? "ambiguous"
              : exactNameCount === 0
                ? "missing"
                : enabledExactNameCount === 0
                  ? "disabled_or_hidden"
                  : "identified";
      if (exactNameCount > 1) {
        for (const report of controlReports) {
          if (report.currentResolverNameMatch)
            report.rejectionReasons.push("multiple_exact_name_candidates");
        }
      }
      return {
        associationProfile: "flow-base-prompt-box_with_flow-rich-text-editor",
        editorCandidates: entries.map((entry) => entry.candidate),
        editorCount: entries.length,
        boundaryTag: "flow-base-prompt-box",
        boundaryContainsEditor: editorsInBoundary.every((editor) =>
          boundary.contains(editor),
        ),
        controlCandidateCount: controls.length,
        reportedControlCount: controlReports.length,
        controlsTruncated: controls.length > controlLimit,
        exactCurrentResolverNameCount: exactNameCount,
        enabledExactCurrentResolverNameCount: enabledExactNameCount,
        currentResolverResult: state,
        controls: controlReports,
      };
    },
  );
  return JSON.stringify(
    {
      diagnostic: "flow-composer-readonly-v1",
      scope: "current_top_document_light_dom",
      topFrame: window.top === window,
      readyState: document.readyState,
      candidateCount: editors.length,
      reportedCount: candidates.length,
      truncated: editors.length > limit,
      currentRuntimeMatchesInReport: candidates.filter(
        (candidate) => candidate.currentRuntimeWouldMatch,
      ).length,
      iframeCount: document.querySelectorAll("iframe").length,
      openShadowHostCount: Array.from(document.querySelectorAll("*")).filter(
        (element) => element.shadowRoot,
      ).length,
      candidates,
      composerControls: {
        diagnostic: "flow-composer-controls-readonly-v1",
        verifiedComposerCount: controlDiagnostics.length,
        composers: controlDiagnostics,
        status:
          controlDiagnostics.length === 0
            ? "no_verified_composer_boundary"
            : controlDiagnostics.length > 1
              ? "ambiguous_composer_boundaries"
              : "controls_scoped_to_verified_composer",
      },
    },
    null,
    2,
  );
})();
