export type FlowEditorKind = "textarea" | "text-input" | "contenteditable";

export type FlowComposerState =
  | "missing"
  | "ambiguous"
  | "unsupported"
  | "empty"
  | "already-matching"
  | "conflict";

export type FlowComposerDiscovery = {
  state: FlowComposerState;
  candidateCount: number;
  editorKind?: FlowEditorKind;
  boundaryRole?: string;
  boundaryLabel?: string;
  placeholderObserved?: boolean;
  methodCompatible: boolean;
  currentText?: string;
};

const FLOW_PLACEHOLDER = "what do you want to create?";

/**
 * Runs in the selected Flow top-frame document. These semantic signals are
 * selector candidates only; they are not verified against the live provider.
 */
export function inspectFlowComposer(
  expectedText: string,
): FlowComposerDiscovery {
  const allEditors = Array.from(
    document.querySelectorAll<HTMLElement>(
      'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]',
    ),
  );
  const candidates = allEditors
    .map((editor) => ({ editor, boundary: composerBoundary(editor) }))
    .filter(
      (entry): entry is { editor: HTMLElement; boundary: HTMLElement } =>
        Boolean(entry.boundary) && isVisibleAndEnabled(entry.editor),
    )
    .filter(({ editor, boundary }) => !isSearchControl(editor, boundary))
    .filter(({ editor, boundary }) => isComposerCandidate(editor, boundary));

  if (candidates.length === 0) {
    return {
      state: "missing",
      candidateCount: 0,
      methodCompatible: false,
    };
  }
  if (candidates.length > 1) {
    return {
      state: "ambiguous",
      candidateCount: candidates.length,
      methodCompatible: false,
    };
  }

  const { editor, boundary } = candidates[0]!;
  const editorKind = kindOf(editor);
  if (!editorKind || editorKind === "contenteditable") {
    return {
      state: "unsupported",
      candidateCount: 1,
      editorKind,
      boundaryRole:
        boundary.getAttribute("role") ?? boundary.tagName.toLowerCase(),
      boundaryLabel: accessibleName(boundary),
      placeholderObserved: hasObservedPlaceholder(editor),
      methodCompatible: false,
    };
  }

  const currentText = readEditorText(editor, editorKind);
  const state = classifyFlowEditorText(
    editor,
    editorKind,
    currentText,
    expectedText,
  );
  return {
    state,
    candidateCount: 1,
    editorKind,
    boundaryRole:
      boundary.getAttribute("role") ?? boundary.tagName.toLowerCase(),
    boundaryLabel: accessibleName(boundary),
    placeholderObserved: hasObservedPlaceholder(editor),
    methodCompatible: true,
    currentText,
  };
}

/** Used by CDP Runtime.evaluate to obtain a remote reference to the unique editor. */
export function findFlowComposerEditor(): HTMLElement | null {
  const inspected = inspectFlowComposer("");
  if (inspected.candidateCount !== 1 || !inspected.methodCompatible)
    return null;
  const editor = Array.from(
    document.querySelectorAll<HTMLElement>(
      'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]',
    ),
  )
    .filter(isVisibleAndEnabled)
    .filter((candidate) => {
      const boundary = composerBoundary(candidate);
      return Boolean(
        boundary &&
        !isSearchControl(candidate, boundary) &&
        isComposerCandidate(candidate, boundary),
      );
    });
  return editor.length === 1 ? editor[0]! : null;
}

/** Standalone serializable function used by CDP Runtime.evaluate. */
export function flowComposerRuntime(
  expectedText: string,
  returnEditor = false,
): FlowComposerDiscovery | HTMLElement | null {
  const placeholderText = "what do you want to create?";
  const labelOf = (element: HTMLElement) => {
    const direct =
      element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "";
    if (direct.trim()) return direct.trim();
    const labelledBy = element.getAttribute("aria-labelledby");
    return labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim()
      : "";
  };
  const boundaryOf = (editor: HTMLElement) => {
    const boundary = editor.closest<HTMLElement>(
      'form, [role="form"], [role="group"], [role="region"], [data-composer]',
    );
    if (!boundary) return null;
    const role = boundary.getAttribute("role")?.toLowerCase() ?? "";
    const label = labelOf(boundary).toLowerCase();
    const testId = (boundary.getAttribute("data-testid") ?? "").toLowerCase();
    const owner = /prompt|composer|create/.test(`${label} ${testId}`);
    return owner &&
      Boolean(
        role ||
        boundary.tagName.toLowerCase() === "form" ||
        boundary.hasAttribute("data-composer"),
      )
      ? boundary
      : null;
  };
  const visible = (element: HTMLElement) => {
    if (
      !element.isConnected ||
      element.matches(":disabled, [disabled], [aria-disabled='true']") ||
      element.closest("[hidden], [inert], [aria-hidden='true']")
    )
      return false;
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      element.getClientRects().length > 0
    );
  };
  const kind = (editor: HTMLElement): FlowEditorKind | undefined => {
    const tag = editor.tagName.toLowerCase();
    if (tag === "textarea") return "textarea";
    if (tag === "input") {
      const type = (editor as HTMLInputElement).type.toLowerCase();
      return type === "text" || type === "search" ? "text-input" : undefined;
    }
    return editor.getAttribute("contenteditable") === "true" &&
      editor.getAttribute("role") === "textbox"
      ? "contenteditable"
      : undefined;
  };
  const editors = Array.from(
    document.querySelectorAll<HTMLElement>(
      'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]',
    ),
  );
  const candidates = editors.filter((editor) => {
    const boundary = boundaryOf(editor);
    if (!boundary || !visible(editor)) return false;
    const type =
      editor.tagName.toLowerCase() === "input"
        ? (editor as HTMLInputElement).type.toLowerCase()
        : "";
    const words =
      `${labelOf(editor)} ${editor.getAttribute("placeholder") ?? ""} ${labelOf(boundary)}`.toLowerCase();
    if (
      type === "search" ||
      editor.closest('[role="search"]') ||
      /\bsearch\b/.test(words)
    )
      return false;
    if (!kind(editor)) return false;
    const owner = /prompt|composer|create/.test(
      `${labelOf(editor)} ${labelOf(boundary)} ${(boundary.getAttribute("data-testid") ?? "").toLowerCase()}`,
    );
    const placeholder = (
      editor.getAttribute("placeholder") ??
      editor.getAttribute("data-placeholder") ??
      ""
    ).toLowerCase();
    return (
      owner &&
      (placeholder === placeholderText || /prompt|composer/.test(words))
    );
  });
  if (returnEditor) {
    return candidates.length === 1 ? candidates[0]! : null;
  }
  if (candidates.length === 0)
    return { state: "missing", candidateCount: 0, methodCompatible: false };
  if (candidates.length > 1)
    return {
      state: "ambiguous",
      candidateCount: candidates.length,
      methodCompatible: false,
    };
  const editor = candidates[0]!;
  const editorKind = kind(editor)!;
  if (editorKind === "contenteditable") {
    const boundary = boundaryOf(editor)!;
    return {
      state: "unsupported",
      candidateCount: 1,
      editorKind,
      boundaryRole:
        boundary.getAttribute("role") ?? boundary.tagName.toLowerCase(),
      boundaryLabel: labelOf(boundary),
      placeholderObserved:
        (
          editor.getAttribute("placeholder") ??
          editor.getAttribute("data-placeholder") ??
          ""
        ).toLowerCase() === placeholderText,
      methodCompatible: false,
    };
  }
  const currentText = (editor as HTMLInputElement | HTMLTextAreaElement).value;
  const state: FlowComposerState =
    expectedText.length === 0
      ? currentText.length === 0
        ? "empty"
        : "conflict"
      : currentText === expectedText
        ? "already-matching"
        : currentText.length === 0
          ? "empty"
          : "conflict";
  const boundary = boundaryOf(editor)!;
  return {
    state,
    candidateCount: 1,
    editorKind,
    boundaryRole:
      boundary.getAttribute("role") ?? boundary.tagName.toLowerCase(),
    boundaryLabel: labelOf(boundary),
    placeholderObserved:
      (
        editor.getAttribute("placeholder") ??
        editor.getAttribute("data-placeholder") ??
        ""
      ).toLowerCase() === placeholderText,
    methodCompatible: true,
    currentText,
  };
}

export function classifyFlowEditorText(
  editor: HTMLElement,
  kind: FlowEditorKind,
  currentText: string,
  expectedText: string,
): FlowComposerState {
  if (expectedText.length === 0) return "conflict";
  if (currentText === expectedText) return "already-matching";
  if (currentText.length === 0 || isVerifiedEmptyArtifact(editor, kind)) {
    return "empty";
  }
  return "conflict";
}

export function readEditorText(
  editor: HTMLElement,
  kind: FlowEditorKind,
): string {
  if (kind === "textarea" || kind === "text-input") {
    return (editor as HTMLInputElement | HTMLTextAreaElement).value;
  }
  return editor.textContent ?? "";
}

export function kindOf(editor: HTMLElement): FlowEditorKind | undefined {
  const tagName = editor.tagName.toLowerCase();
  if (tagName === "textarea") return "textarea";
  if (tagName === "input") {
    const inputType = (editor as HTMLInputElement).type.toLowerCase();
    if (inputType === "text" || inputType === "search") return "text-input";
    return undefined;
  }
  if (
    editor.getAttribute("contenteditable") === "true" &&
    editor.getAttribute("role") === "textbox"
  ) {
    return "contenteditable";
  }
  return undefined;
}

function composerBoundary(editor: HTMLElement): HTMLElement | null {
  const boundary = editor.closest<HTMLElement>(
    'form, [role="form"], [role="group"], [role="region"], [data-composer]',
  );
  if (!boundary) return null;
  const role = boundary.getAttribute("role")?.toLowerCase() ?? "";
  const label = accessibleName(boundary).toLowerCase();
  const testId = (boundary.getAttribute("data-testid") ?? "").toLowerCase();
  const stableOwner = /prompt|composer|create/.test(`${label} ${testId}`);
  const semanticContainer =
    role === "form" ||
    role === "group" ||
    role === "region" ||
    boundary.tagName.toLowerCase() === "form" ||
    boundary.hasAttribute("data-composer");
  return stableOwner && semanticContainer ? boundary : null;
}

function accessibleName(element: HTMLElement): string {
  const direct =
    element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "";
  if (direct.trim()) return direct.trim();
  const labelledBy = element.getAttribute("aria-labelledby");
  if (!labelledBy) return "";
  return labelledBy
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

function isComposerCandidate(
  editor: HTMLElement,
  boundary: HTMLElement,
): boolean {
  const name =
    `${accessibleName(editor)} ${accessibleName(boundary)}`.toLowerCase();
  const placeholder = (editor.getAttribute("placeholder") ?? "").toLowerCase();
  const dataPlaceholder = (
    editor.getAttribute("data-placeholder") ?? ""
  ).toLowerCase();
  const hasComposerSemantics = /prompt|composer|create/.test(name);
  const hasObservedPlaceholder =
    placeholder === FLOW_PLACEHOLDER || dataPlaceholder === FLOW_PLACEHOLDER;
  // The screenshot placeholder is a corroborating signal, never the sole one.
  return (
    hasComposerSemantics &&
    (hasObservedPlaceholder || /prompt|composer/.test(name))
  );
}

function hasObservedPlaceholder(editor: HTMLElement): boolean {
  return (
    (editor.getAttribute("placeholder") ?? "").toLowerCase() ===
      FLOW_PLACEHOLDER ||
    (editor.getAttribute("data-placeholder") ?? "").toLowerCase() ===
      FLOW_PLACEHOLDER
  );
}

function isSearchControl(editor: HTMLElement, boundary: HTMLElement): boolean {
  const inputType =
    editor.tagName.toLowerCase() === "input"
      ? (editor as HTMLInputElement).type.toLowerCase()
      : "";
  const searchOwner = editor.closest('[role="search"], form[role="search"]');
  const words =
    `${accessibleName(editor)} ${editor.getAttribute("placeholder") ?? ""} ${accessibleName(boundary)}`.toLowerCase();
  return (
    inputType === "search" || Boolean(searchOwner) || /\bsearch\b/.test(words)
  );
}

function isVisibleAndEnabled(editor: HTMLElement): boolean {
  if (
    !editor.isConnected ||
    editor.matches(":disabled, [disabled], [aria-disabled='true']") ||
    editor.closest("[hidden], [inert], [aria-hidden='true']")
  ) {
    return false;
  }
  const style = getComputedStyle(editor);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse" &&
    editor.getClientRects().length > 0
  );
}

function isVerifiedEmptyArtifact(
  editor: HTMLElement,
  kind: FlowEditorKind,
): boolean {
  if (kind !== "contenteditable") return false;
  if (editor.textContent?.trim()) return false;
  const children = Array.from(editor.children);
  if (children.length === 0) return true;
  return children.every((child) => {
    if (child.tagName.toLowerCase() === "br") return true;
    if (child.textContent?.trim()) return false;
    return Array.from(child.children).every(
      (nested) => nested.tagName.toLowerCase() === "br",
    );
  });
}
