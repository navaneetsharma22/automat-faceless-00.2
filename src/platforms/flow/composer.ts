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
  profile?: "semantic-container" | "flow-rich-text";
  textReadback?: "value" | "dom-block-lines";
  boundaryRole?: string;
  boundaryLabel?: string;
  placeholderObserved?: boolean;
  diagnostic?:
    | "no_eligible_owned_editor"
    | "multiple_eligible_editors"
    | "unverified_contenteditable"
    | "composer_media_present"
    | "editor_representation_unsupported"
    | "unverified_empty_editor";
  methodCompatible: boolean;
  currentText?: string;
};

export function inspectFlowComposer(
  expectedText: string,
): FlowComposerDiscovery {
  return flowComposerRuntime(expectedText, false) as FlowComposerDiscovery;
}

export function findFlowComposerEditor(): HTMLElement | null {
  return flowComposerRuntime("", true) as HTMLElement | null;
}

/** Fixed logical-text adapter, shared by preflight and immediate/settled reads.
 * Text nodes are untouched; each direct P/DIV line boundary represents one LF.
 * No expected source is available here. Unsupported markup fails closed. */
export function readFlowEditorRuntime(editor: HTMLElement): string {
  const tag = editor.tagName.toLowerCase();
  if (tag === "textarea" || tag === "input") {
    return (editor as HTMLInputElement | HTMLTextAreaElement).value;
  }
  let visited = 0;
  const inline = (node: Node, depth: number): string => {
    if (++visited > 10_000 || depth > 64)
      throw new Error("unsupported_editor_representation");
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
    if (
      !(node instanceof HTMLElement) ||
      node.matches(
        "[hidden], [inert], [aria-hidden='true'], [contenteditable='false']",
      )
    ) {
      throw new Error("unsupported_editor_representation");
    }
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility !== "visible")
      throw new Error("unsupported_editor_representation");
    if (node.tagName === "BR") return "\n";
    if (node.tagName !== "SPAN")
      throw new Error("unsupported_editor_representation");
    return Array.from(node.childNodes)
      .map((child) => inline(child, depth + 1))
      .join("");
  };
  const line = (node: HTMLElement): string => {
    // A sole BR is the browser's empty-line caret artifact, not a text rewrite.
    if (node.childNodes.length === 1 && node.firstChild?.nodeName === "BR")
      return "";
    return Array.from(node.childNodes)
      .map((child) => inline(child, 0))
      .join("");
  };
  const children = Array.from(editor.childNodes);
  const block = (node: Node) =>
    node instanceof HTMLElement && ["P", "DIV"].includes(node.tagName);
  if (children.some(block)) {
    if (!children.every(block))
      throw new Error("unsupported_editor_representation");
    return children
      .map((child) => {
        const element = child as HTMLElement;
        if (
          element.matches(
            "[hidden], [inert], [aria-hidden='true'], [contenteditable='false']",
          )
        )
          throw new Error("unsupported_editor_representation");
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility !== "visible")
          throw new Error("unsupported_editor_representation");
        return line(element);
      })
      .join("\n");
  }
  return line(editor);
}

/** Serializable runtime. Custom host tags derive from the user's masked DOM
 * report. Actual Flow insertion/readback remains a separate live gate. */
export function flowComposerRuntime(
  expectedText: string,
  returnEditor = false,
  readText = readFlowEditorRuntime,
  allowedReferenceMediaId?: string,
  allowedReferenceAsbToken?: string,
): FlowComposerDiscovery | HTMLElement | null {
  const placeholderText = "what do you want to create?";
  const labelOf = (element: HTMLElement) => {
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
  const richBoundary = (editor: HTMLElement) => {
    if (
      editor.tagName.toLowerCase() !== "div" ||
      editor.getAttribute("contenteditable") !== "true" ||
      editor.getAttribute("role") !== "textbox"
    )
      return null;
    const rich = editor.closest("flow-rich-text-editor");
    const box = editor.closest<HTMLElement>("flow-base-prompt-box");
    return rich && box && rich.closest("flow-base-prompt-box") === box
      ? box
      : null;
  };
  const boundaryOf = (editor: HTMLElement) => {
    const rich = richBoundary(editor);
    if (rich) return rich;
    const boundary = editor.closest<HTMLElement>(
      'form, [role="form"], [role="group"], [role="region"], [data-composer]',
    );
    if (!boundary) return null;
    return /prompt|composer|create/i.test(
      `${labelOf(boundary)} ${boundary.getAttribute("data-testid") ?? ""}`,
    )
      ? boundary
      : null;
  };
  const visibleEnabled = (editor: HTMLElement) => {
    if (
      !editor.isConnected ||
      editor.matches(":disabled, [disabled], [readonly]") ||
      editor.closest(
        "[hidden], [inert], [aria-hidden='true'], [aria-disabled='true'], [aria-readonly='true'], [disabled]",
      ) ||
      ((editor.tagName.toLowerCase() === "input" ||
        editor.tagName.toLowerCase() === "textarea") &&
        (editor as HTMLInputElement | HTMLTextAreaElement).readOnly)
    )
      return false;
    for (
      let ancestor: HTMLElement | null = editor;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      ) {
        return false;
      }
    }
    return editor.getClientRects().length > 0;
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
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]',
    ),
  ).filter((editor) => {
    const boundary = boundaryOf(editor);
    if (!boundary || !visibleEnabled(editor) || !kind(editor)) return false;
    const words =
      `${labelOf(editor)} ${editor.getAttribute("placeholder") ?? ""} ${labelOf(boundary)}`.toLowerCase();
    if (
      (editor.tagName.toLowerCase() === "input" &&
        (editor as HTMLInputElement).type === "search") ||
      editor.closest(
        '[role="search"], flow-search-bar, flow-navigation-header',
      ) ||
      /\bsearch\b/.test(words)
    )
      return false;
    if (richBoundary(editor))
      return /prompt|composer|create/i.test(labelOf(editor));
    const owner = /prompt|composer|create/i.test(
      `${labelOf(editor)} ${labelOf(boundary)} ${boundary.getAttribute("data-testid") ?? ""}`,
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
  if (candidates.length !== 1) {
    if (returnEditor) return null;
    return {
      state: candidates.length === 0 ? "missing" : "ambiguous",
      candidateCount: candidates.length,
      diagnostic:
        candidates.length === 0
          ? "no_eligible_owned_editor"
          : "multiple_eligible_editors",
      methodCompatible: false,
    };
  }
  const editor = candidates[0]!;
  const editorKind = kind(editor)!;
  const boundary = boundaryOf(editor)!;
  const profile = richBoundary(editor)
    ? "flow-rich-text"
    : "semantic-container";
  const mediaElements = Array.from(
    boundary.querySelectorAll("img, video, audio, canvas, iframe, object, embed"),
  ).filter((element) => !element.closest(".frame-trigger"));
  const ingredientChips = (scope: ParentNode) => {
    const el = scope as Element;
    const bar = el.querySelector?.("flow-ingredient-bar") ?? scope;
    const isFrame = (target: Element) =>
      Boolean(target.closest?.(".frame-trigger, div.frame-trigger, [class*='frame-trigger']"));
    const components = [...bar.querySelectorAll<HTMLElement>(
      "flow-character-ingredient-chip, flow-video-ingredient-chip, flow-image-ingredient-chip",
    )].filter((component) => !isFrame(component));
    const buttons = components
      .map((c) =>
        c.querySelector<HTMLButtonElement>("button.chip-container, button[aria-label='Ingredient'], button"),
      )
      .filter((b): b is HTMLButtonElement => Boolean(b))
      .filter((b) => !isFrame(b));
    if (buttons.length > 0) return buttons;
    return [...bar.querySelectorAll<HTMLButtonElement>("button.chip-container, button[aria-label='Ingredient']")]
      .filter((chip) => !isFrame(chip));
  };
  const soleMatchingReadyReference = (element: Element) => {
    if ((!allowedReferenceMediaId && !allowedReferenceAsbToken) || element.tagName !== "IMG")
      return false;
    const image = element as HTMLImageElement;
    const chip = image.closest<HTMLButtonElement>(
      "button[aria-label='Ingredient'], button.chip-container",
    );
    if (
      !chip ||
      chip.closest(".frame-trigger, div.frame-trigger, [class*='frame-trigger']") ||
      chip.getAttribute("aria-busy") !== "false" ||
      !chip.isConnected ||
      chip.getClientRects().length === 0 ||
      ingredientChips(boundary).length !== 1 ||
      chip.querySelectorAll("img[alt='Ingredient image']").length !== 1 ||
      chip.querySelector("img[alt='Ingredient image']") !== image
    )
      return false;
    try {
      const raw = image.currentSrc || image.src || image.getAttribute("src") || "";
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
      if (
        allowedReferenceMediaId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(allowedReferenceMediaId) &&
        url.hostname === "flow-content.google"
      ) {
        const id = /^\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(url.pathname)?.[1];
        if (id && id.toLowerCase() === allowedReferenceMediaId.toLowerCase()) return true;
      }
      let pathname = url.pathname;
      const acctMatch = /^\/u\/\d+(\/.*)$/.exec(pathname);
      if (acctMatch) pathname = acctMatch[1]!;
      if (
        allowedReferenceAsbToken &&
        url.hostname === "flow.google.com" &&
        pathname.startsWith("/asb/")
      ) {
        const rest = pathname.slice("/asb/".length);
        if (rest && !rest.includes("/")) {
          const eq = rest.indexOf("=");
          const token = eq === -1 ? rest : rest.slice(0, eq);
          const suffix = eq === -1 ? "" : rest.slice(eq);
          if (
            token &&
            token.length <= 2048 &&
            /^[A-Za-z0-9_-]+$/.test(token) &&
            (!suffix || /^=s\d+(-rw)?$/.test(suffix)) &&
            token === allowedReferenceAsbToken
          ) {
            return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  };
  let mediaPresent: boolean;
  if (!allowedReferenceMediaId) {
    mediaPresent =
      mediaElements.length > 0 &&
      !(mediaElements.length === 1 && soleMatchingReadyReference(mediaElements[0]!));
  } else if (mediaElements.length === 0) {
    mediaPresent = false;
  } else {
    const readyRef = mediaElements.find(soleMatchingReadyReference);
    const chip = readyRef?.closest("button[aria-label='Ingredient']");
    mediaPresent =
      !readyRef ||
      !chip ||
      mediaElements.some((media) => !chip.contains(media));
  }
  if (
    (editorKind === "contenteditable" && profile !== "flow-rich-text") ||
    mediaPresent
  ) {
    if (returnEditor) return null;
    return {
      state: "unsupported",
      candidateCount: 1,
      editorKind,
      profile,
      diagnostic: mediaPresent
        ? "composer_media_present"
        : "unverified_contenteditable",
      methodCompatible: false,
    };
  }
  let currentText: string;
  try {
    currentText = readText(editor);
  } catch {
    if (returnEditor) return null;
    return {
      state: "unsupported",
      candidateCount: 1,
      editorKind,
      profile,
      diagnostic: "editor_representation_unsupported",
      methodCompatible: false,
    };
  }
  const paragraph = editor.firstElementChild;
  if (
    profile === "flow-rich-text" &&
    currentText === "" &&
    !(
      editor.childNodes.length === 1 &&
      paragraph?.tagName === "P" &&
      paragraph.childNodes.length === 1 &&
      paragraph.firstChild?.nodeName === "BR"
    )
  ) {
    if (returnEditor) return null;
    return {
      state: "unsupported",
      candidateCount: 1,
      editorKind,
      profile,
      diagnostic: "unverified_empty_editor",
      methodCompatible: false,
    };
  }
  if (returnEditor) return editor;
  return {
    state:
      currentText === expectedText && expectedText.length > 0
        ? "already-matching"
        : currentText.length === 0
          ? "empty"
          : "conflict",
    candidateCount: 1,
    editorKind,
    profile,
    textReadback:
      editorKind === "contenteditable" ? "dom-block-lines" : "value",
    boundaryRole:
      profile === "flow-rich-text"
        ? "flow-base-prompt-box"
        : (boundary.getAttribute("role") ?? boundary.tagName.toLowerCase()),
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

export function flowComposerRuntimeExpression(
  expectedText: string,
  returnEditor = false,
  allowedReferenceMediaId?: string,
  allowedReferenceAsbToken?: string,
): string {
  // Pass dependencies positionally: production minification may rename bindings.
  return `(${flowComposerRuntime.toString()})(${JSON.stringify(expectedText)},${returnEditor},(${readFlowEditorRuntime.toString()}),${JSON.stringify(allowedReferenceMediaId)},${JSON.stringify(allowedReferenceAsbToken)})`;
}

export function classifyFlowEditorText(
  _editor: HTMLElement,
  _kind: FlowEditorKind,
  currentText: string,
  expectedText: string,
): FlowComposerState {
  if (expectedText.length === 0) return "conflict";
  if (currentText === expectedText) return "already-matching";
  return currentText.length === 0 ? "empty" : "conflict";
}

export function readEditorText(
  editor: HTMLElement,
  kind: FlowEditorKind,
): string {
  return kind === "contenteditable"
    ? readFlowEditorRuntime(editor)
    : (editor as HTMLInputElement | HTMLTextAreaElement).value;
}

export function kindOf(editor: HTMLElement): FlowEditorKind | undefined {
  const tag = editor.tagName.toLowerCase();
  if (tag === "textarea") return "textarea";
  if (tag === "input")
    return ["text", "search"].includes(
      (editor as HTMLInputElement).type.toLowerCase(),
    )
      ? "text-input"
      : undefined;
  return editor.getAttribute("contenteditable") === "true" &&
    editor.getAttribute("role") === "textbox"
    ? "contenteditable"
    : undefined;
}
