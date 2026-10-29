/* global document, window, getComputedStyle */
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
    },
    null,
    2,
  );
})();
