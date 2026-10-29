/* global document, window, getComputedStyle */
// Paste into DevTools Console on the existing Flow tab. Read-only.
// Reports only the action label for the uniquely matched composer submit control.
(() => {
  const visibleEnabled = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      element.isConnected &&
      !element.matches(":disabled, [disabled], [aria-disabled='true']") &&
      !element.closest("[hidden], [inert], [aria-hidden='true']") &&
      style.display !== "none" &&
      style.visibility === "visible" &&
      element.getClientRects().length > 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  const name = (element) => {
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
  const nameSignals = (element) => {
    const label = name(element);
    return ["prompt", "composer", "create"].filter((word) =>
      new RegExp(`\\b${word}\\b`, "i").test(label),
    );
  };
  const editors = Array.from(
    document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
  ).filter((editor) => {
    const host = editor.closest("flow-rich-text-editor");
    const boundary = editor.closest("flow-base-prompt-box");
    return (
      visibleEnabled(editor) &&
      !editor.matches("[aria-readonly='true']") &&
      nameSignals(editor).length > 0 &&
      host !== null &&
      boundary !== null &&
      host.closest("flow-base-prompt-box") === boundary
    );
  });
  const boundaries = [
    ...new Set(editors.map((editor) => editor.closest("flow-base-prompt-box"))),
  ];
  if (editors.length !== 1 || boundaries.length !== 1) {
    return JSON.stringify(
      {
        diagnostic: "flow-generate-action-label-readonly-v1",
        scope: "verified_flow_rich_text_composer_only",
        topFrame: window.top === window,
        verifiedEditorCount: editors.length,
        verifiedBoundaryCount: boundaries.length,
        status: "composer_not_unique",
      },
      null,
      2,
    );
  }

  const editor = editors[0];
  const boundary = boundaries[0];
  const controls = Array.from(
    boundary.querySelectorAll("button[type='submit']"),
  );
  const matches = controls.filter((control) => {
    if (!visibleEnabled(control) || control.contains(editor)) return false;
    const descendants = Array.from(
      control.querySelectorAll("svg, [data-icon]"),
    );
    const actionMetadata = [
      control.getAttribute("aria-label") ?? "",
      control.getAttribute("title") ?? "",
      control.getAttribute("data-icon") ?? "",
      control.getAttribute("data-testid") ?? "",
      typeof control.className === "string" ? control.className : "",
      control.textContent ?? "",
      ...descendants.map((node) =>
        [
          node.getAttribute("aria-label") ?? "",
          node.getAttribute("title") ?? "",
          node.getAttribute("data-icon") ?? "",
          typeof node.className === "string" ? node.className : "",
        ].join(" "),
      ),
    ].join(" ");
    const hasGenerateSignal = /\bgenerate\b/i.test(actionMetadata);
    const hasArrowSignal =
      /arrow|chevron|north_east|keyboard_return|trending_flat/i.test(
        actionMetadata,
      );
    const hasSendSignal = /send|submit|forward/i.test(actionMetadata);
    return hasGenerateSignal && hasArrowSignal && hasSendSignal;
  });
  const result = {
    diagnostic: "flow-generate-action-label-readonly-v1",
    scope: "verified_flow_rich_text_composer_only",
    topFrame: window.top === window,
    verifiedEditorCount: editors.length,
    verifiedBoundaryCount: boundaries.length,
    enabledSubmitControlCount: controls.filter(visibleEnabled).length,
    observedGenerateArrowSendMatchCount: matches.length,
    status: matches.length === 1 ? "unique_target_label" : "target_not_unique",
  };
  if (matches.length === 1) {
    const target = matches[0];
    const ariaLabel = target.getAttribute("aria-label")?.trim() ?? "";
    const text = target.textContent?.trim() ?? "";
    result.control = {
      tag: target.tagName.toLowerCase(),
      role: target.getAttribute("role") ?? "absent",
      type: target.type,
      ariaLabelPresent: target.hasAttribute("aria-label"),
      textPresent: text.length > 0,
      resolverNameSource: ariaLabel ? "aria-label" : "text-content",
      resolverAccessibleName: (ariaLabel || text).replace(/\s+/g, " "),
    };
  }
  return JSON.stringify(result, null, 2);
})();
