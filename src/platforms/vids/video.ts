export type VidsVideoPromptEntryResult = {
  href: string;
  ok: boolean;
  reason?: string;
  promptState?: "empty" | "already_exact" | "conflict" | "unsupported";
  expectedSha256?: string;
  actualSha256?: string;
  immediateMatch?: boolean;
  settledMatch?: boolean;
  stableReads?: number;
  referenceSha256?: string;
  referenceProofSource?: "selected_file_sha256" | "preview_blob_sha256";
  referenceByteSize?: number;
  previewLoaded?: boolean;
  previewWidth?: number;
  previewHeight?: number;
  generateCount?: number;
  generateDisabled?: boolean;
};
type VidsComposerToggleLabel = "Expand" | "Collapse" | "missing" | "ambiguous" | "unknown";

/**
 * Runs in the bound Vids document. All selectors are scoped to its unique
 * active AI video clip / Animate panel. Vids renders multiline text into
 * block elements; `textContent` drops those separators and `innerText` may expose
 * layout NBSPs for indentation. This serializer preserves DOM text-node bytes
 * and restores only explicit block/BR line boundaries.
 */
export async function enterVidsPromptInPage(input: {
  prompt: string;
  expectedSha256: string;
  referenceSha256: string;
  referenceMimeType: "image/png" | "image/jpeg";
  referenceByteSize: number;
  referenceWidth: number;
  referenceHeight: number;
  timeoutMs: number;
}): Promise<VidsVideoPromptEntryResult> {
  const href = location.href;
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const name = (element: Element) => {
    const aria = element.getAttribute("aria-label")?.trim();
    if (aria) return aria;
    const labelled = element.getAttribute("aria-labelledby")?.trim();
    if (labelled) return labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
    return element.getAttribute("title")?.trim() ?? "";
  };
  const failure = (reason: string, promptState?: VidsVideoPromptEntryResult["promptState"]): VidsVideoPromptEntryResult => ({ href, ok: false, reason, promptState });
  const digest = async (text: string) => {
    const bytes = new TextEncoder().encode(text);
    const result = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...result].map((value) => value.toString(16).padStart(2, "0")).join("");
  };
  const proveReference = async (panel: HTMLElement, preview: HTMLImageElement): Promise<{ sha256: string; byteSize: number; source: "selected_file_sha256" | "preview_blob_sha256" } | { reason: string }> => {
    const inputs = [...panel.querySelectorAll<HTMLInputElement>("input[type='file']")];
    if (inputs.length > 1) return { reason: "reference_file_input_ambiguous" };
    const files = inputs[0]?.files;
    if (inputs.length === 1 && !files) return { reason: "reference_file_list_unavailable" };
    if (files && files.length > 1) return { reason: "reference_file_selection_ambiguous" };
    let bytes: ArrayBuffer;
    let mimeType: string;
    let byteSize: number;
    let source: "selected_file_sha256" | "preview_blob_sha256";
    const file = files?.[0];
    if (file) {
      mimeType = file.type;
      byteSize = file.size;
      if (byteSize !== input.referenceByteSize || mimeType !== input.referenceMimeType) return { reason: "reference_file_metadata_mismatch" };
      try { bytes = await file.arrayBuffer(); }
      catch { return { reason: "reference_file_read_failed" }; }
      source = "selected_file_sha256";
    } else {
      let previewUrl: URL;
      try { previewUrl = new URL(preview.currentSrc || preview.src); }
      catch { return { reason: "reference_preview_blob_url_invalid" }; }
      if (previewUrl.protocol !== "blob:" || previewUrl.origin !== location.origin) return { reason: "reference_preview_blob_unavailable" };
      let response: Response;
      try { response = await fetch(previewUrl.href); }
      catch { return { reason: "reference_preview_blob_unreadable" }; }
      if (!response.ok) return { reason: "reference_preview_blob_unreadable" };
      let blob: Blob;
      try { blob = await response.blob(); bytes = await blob.arrayBuffer(); }
      catch { return { reason: "reference_preview_blob_read_failed" }; }
      mimeType = blob.type;
      byteSize = blob.size;
      if (byteSize !== input.referenceByteSize || mimeType !== input.referenceMimeType) return { reason: "reference_preview_blob_metadata_mismatch" };
      source = "preview_blob_sha256";
    }
    try {
      const result = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const sha256 = [...result].map((value) => value.toString(16).padStart(2, "0")).join("");
      return { sha256, byteSize, source };
    } catch { return { reason: "reference_hash_unavailable" }; }
  };
  const serializeEditor = (root: HTMLElement): string => {
    const blockTags = new Set(["DIV", "P"]);
    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const element = node as HTMLElement;
      if (element.tagName === "BR") return "\n";
      const children = [...element.childNodes];
      let output = "";
      let hasContent = false;
      for (const child of children) {
        const isBlock = child.nodeType === Node.ELEMENT_NODE && blockTags.has((child as Element).tagName);
        if (isBlock && hasContent && !output.endsWith("\n")) output += "\n";
        const value = walk(child);
        output += value;
        if (value.length > 0) hasContent = true;
      }
      return output;
    };
    let output = "";
    for (const child of [...root.childNodes]) {
      const isBlock = child.nodeType === Node.ELEMENT_NODE && blockTags.has((child as Element).tagName);
      if (isBlock && output.length > 0 && !output.endsWith("\n")) output += "\n";
      output += walk(child);
    }
    return output;
  };
  const sidebars = [...document.querySelectorAll<HTMLElement>("[role='complementary']")].filter(visible).filter((element) => name(element) === "AI video clip");
  if (sidebars.length !== 1) return failure(sidebars.length ? "ai_sidebar_ambiguous" : "ai_sidebar_missing");
  const sidebar = sidebars[0]!;
  const tabs = [...sidebar.querySelectorAll<HTMLElement>("[role='tab'][aria-selected='true']")].filter(visible).filter((element) => name(element) === "Animate");
  if (tabs.length !== 1) return failure(tabs.length ? "animate_tab_ambiguous" : "animate_tab_not_selected");
  const panels = [...sidebar.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter(visible).filter((element) => name(element) === "Animate");
  if (panels.length !== 1) return failure(panels.length ? "animate_panel_ambiguous" : "animate_panel_missing");
  const panel = panels[0]!;
  const previews = [...panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible);
  const removals = [...panel.querySelectorAll<HTMLButtonElement>("button[aria-label='Remove image']")].filter(visible);
  if (previews.length !== 1 || removals.length !== 1) return failure(previews.length > 1 || removals.length > 1 ? "reference_preview_ambiguous" : "reference_preview_missing");
  const preview = previews[0]!;
  if (!preview.complete || preview.naturalWidth < 1 || preview.naturalHeight < 1) return failure("reference_preview_not_ready");
  if (preview.naturalWidth !== input.referenceWidth || preview.naturalHeight !== input.referenceHeight) return failure("reference_preview_dimensions_mismatch");
  const referenceProof = await proveReference(panel, preview);
  if ("reason" in referenceProof) return failure(referenceProof.reason);
  const actualReferenceSha256 = referenceProof.sha256;
  if (actualReferenceSha256 !== input.referenceSha256) return failure("reference_identity_mismatch");

  const editors = [...panel.querySelectorAll<HTMLElement>("div[role='textbox'][contenteditable='true'][aria-label='Add your image, then describe what should happen in your video.']")].filter(visible);
  if (editors.length !== 1) return failure(editors.length ? "prompt_editor_ambiguous" : "prompt_editor_missing");
  const editor = editors[0]!;
  const expectedSha256 = await digest(input.prompt);
  if (expectedSha256 !== input.expectedSha256) return failure("prepared_prompt_hash_mismatch");
  let promptState: VidsVideoPromptEntryResult["promptState"];
  let actual = serializeEditor(editor);
  if (actual === input.prompt) {
    promptState = "already_exact";
  } else {
    const structurallyEmpty = editor.textContent === null || editor.textContent.length === 0;
    if (!structurallyEmpty) return failure("prompt_editor_contains_conflicting_text", "conflict");
    promptState = "empty";
    try {
      editor.focus();
      const beforeInput = new InputEvent("beforeinput", { bubbles: true, composed: true, cancelable: true, inputType: "insertText", data: input.prompt });
      editor.dispatchEvent(beforeInput);
      if (beforeInput.defaultPrevented) return failure("prompt_insert_rejected", promptState);
      const lines = input.prompt.split("\n");
      editor.replaceChildren(...lines.map((line) => {
        const block = document.createElement("div");
        block.append(document.createTextNode(line));
        return block;
      }));
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: input.prompt }));
    } catch { return failure("prompt_insert_failed", promptState); }
    actual = serializeEditor(editor);
    if (actual !== input.prompt) return { ...failure("prompt_immediate_readback_mismatch", promptState), expectedSha256, actualSha256: await digest(actual), immediateMatch: false };
  }
  const immediateMatch = actual === input.prompt;
  if (!immediateMatch) return { ...failure("prompt_immediate_readback_mismatch", promptState), expectedSha256, actualSha256: await digest(actual), immediateMatch: false };
  const deadline = Date.now() + Math.max(500, Math.min(input.timeoutMs, 5_000));
  let stableReads = 0;
  let previous = "";
  while (Date.now() < deadline && stableReads < 3) {
    const current = serializeEditor(editor);
    if (current !== input.prompt) return { ...failure("prompt_settled_readback_mismatch", promptState), expectedSha256, actualSha256: await digest(current), immediateMatch: true, settledMatch: false, stableReads };
    if (current === previous) stableReads += 1; else stableReads = 1;
    previous = current;
    if (stableReads < 3) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (stableReads < 3) return { ...failure("prompt_settled_readback_timeout", promptState), expectedSha256, actualSha256: await digest(serializeEditor(editor)), immediateMatch: true, settledMatch: false, stableReads };
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button[aria-label='Generate']")].filter(visible);
  return {
    href, ok: true, promptState, expectedSha256, actualSha256: await digest(serializeEditor(editor)),
    immediateMatch: true, settledMatch: true, stableReads,
    referenceSha256: actualReferenceSha256, referenceByteSize: referenceProof.byteSize, referenceProofSource: referenceProof.source,
    previewLoaded: true, previewWidth: preview.naturalWidth, previewHeight: preview.naturalHeight,
    generateCount: buttons.length, generateDisabled: buttons.length === 1 ? buttons[0]!.disabled || buttons[0]!.getAttribute("aria-disabled") === "true" : undefined,
  };
}

export type VidsGenerateActivationResult = { href: string; ok: boolean; reason?: string; activationAttempted: boolean; activationCount: 0 | 1; referenceProofSource?: "selected_file_sha256" | "preview_blob_sha256" };

export type VidsComposerTransitionDiagnostics = {
  stage: "sidebar" | "readiness" | "animate" | "editor" | "prompt" | "reference" | "ownership" | "mutation" | "reference_remove" | "prompt_clear" | "settlement" | "complete";
  sidebar: "unique" | "missing" | "ambiguous";
  animateTab: "unique" | "missing" | "ambiguous";
  animatePanel: "unique" | "missing" | "ambiguous";
  editor: "unique" | "missing" | "ambiguous";
  previewCount: number;
  promptExpectedSha256: string;
  promptActualSha256?: string;
  promptMatches?: boolean;
  promptTextMatches?: boolean;
  promptHashMatches?: boolean;
  referenceExpectedSha256: string;
  referenceActualSha256?: string;
  referenceExpectedId: string;
  referenceActualId?: string;
  referenceProofSource?: "selected_file_sha256" | "preview_blob_sha256";
  referenceResult: "not_checked" | "matched" | "mismatched" | "unavailable";
  referenceReason?: string;
  cleanupState?: "previous_pair_present" | "reference_removed_prompt_present" | "already_empty";
  editorRebound?: boolean;
  panelRebound?: boolean;
  panelStateBeforeExpansion?: "collapsed" | "expanded" | "unknown";
  panelStateAfterExpansion?: "settled" | "missing" | "unstable" | "not_attempted";
  freshPreviewDetection?: "present" | "absent_after_settle" | "delayed_then_present" | "unknown";
  fileInputCount?: number;
  expectedPromptLength?: number;
  actualPromptLength?: number;
  clearAvailable?: "unique" | "missing" | "ambiguous" | "not_checked";
  clearAttempt?: "contenteditable_input" | "native_clear";
  immediatePromptEmpty?: boolean;
  settledPromptEmpty?: boolean;
  expectedMimeType: "image/png" | "image/jpeg";
  actualMimeType?: string;
  expectedByteSize: number;
  actualByteSize?: number;
  expectedWidth: number;
  expectedHeight: number;
  actualWidth?: number;
  actualHeight?: number;
  operationBound: boolean;
  attachmentBound: boolean;
  targetBound: boolean;
  documentBound: boolean;
  handoffTrace?: {
    triggerSource?: "automatic_start" | "automatic_alarm" | "manual_resume" | "visibility_wakeup" | "unknown";
    elapsedSinceReceiptToFirstReadMs?: number;
    visibilityStart?: "visible" | "hidden" | "prerender" | "unloaded" | "unknown";
    visibilityEnd?: "visible" | "hidden" | "prerender" | "unloaded" | "unknown";
    visibilityChanges?: Array<{ inspection: number; atMs: number; state: "visible" | "hidden" | "prerender" | "unloaded" | "unknown" }>;
    initialAnimateState?: "collapsed" | "expanded" | "missing" | "ambiguous" | "unknown";
    finalAnimateState?: "collapsed" | "expanded" | "missing" | "ambiguous" | "unknown";
    composerToggleLabelBefore?: VidsComposerToggleLabel;
    composerToggleLabelAfter?: VidsComposerToggleLabel;
    composerToggleClickAttempted?: boolean;
    composerToggleOutcome?: "already_expanded" | "expanded" | "missing" | "ambiguous" | "disabled" | "label_unrecognized" | "settlement_failed";
    composerReadinessWaitMs?: number;
    composerReadinessOutcome?: "ready" | "timeout_hidden" | "timeout_visible";
    composerEditorReady?: boolean;
    composerToggleScope?: "panel" | "tabpanel_sibling" | "composer_container" | "missing" | "ambiguous" | "unknown";
    composerToggleObservations?: Array<{ atMs: number; label: VidsComposerToggleLabel; scope: "panel" | "tabpanel_sibling" | "composer_container" | "missing" | "ambiguous" | "unknown"; candidateCount: number; panelCount: number; editorCount: number; visibility: "visible" | "hidden" | "prerender" | "unloaded" | "unknown" }>;
    expansionAttempted?: boolean; panelReplaced?: boolean; editorReplaced?: boolean;
    previewObservations?: Array<{ inspection: number; atMs: number; selectorMatches: number; visibleMatches: number; loadedMatches: number; composerToggleLabel?: VidsComposerToggleLabel }>;
  };
};

/**
 * P10.3 ownership check. Inspection can only expand the unique scoped Animate
 * control; callers must rebind and inspect again before cleanup is authorized.
 */
export async function transitionVidsComposerFromPreviousInPage(input: {
  prompt: string; promptSha256: string; referenceSha256: string; referenceMimeType: "image/png" | "image/jpeg";
  referenceId?: string;
  referenceCandidates?: Array<{ referenceId: string; sha256: string; mimeType: "image/png" | "image/jpeg"; byteSize: number; width: number; height: number }>;
  checkpointedOwnership?: boolean;
  phase?: "inspect" | "inspect_clean" | "remove_reference" | "clear_prompt" | "verify_empty" | "full";
  referenceByteSize: number; referenceWidth: number; referenceHeight: number; timeoutMs: number; inspectOnly?: boolean;
  readinessDeadlineAt?: number;
  traceContext?: { triggerSource: "automatic_start" | "automatic_alarm" | "manual_resume" | "visibility_wakeup" | "unknown"; elapsedSinceReceiptToFirstReadMs: number; readinessDeadlineAt?: number; priorTrace?: VidsComposerTransitionDiagnostics["handoffTrace"] };
}): Promise<{ href: string; ok: boolean; reason?: string; changed: boolean; diagnostics: VidsComposerTransitionDiagnostics }> {
  const href = location.href;
  const diagnostic: VidsComposerTransitionDiagnostics = {
    stage: "sidebar", sidebar: "missing", animateTab: "missing", animatePanel: "missing", editor: "missing", previewCount: 0,
    promptExpectedSha256: input.promptSha256, referenceExpectedSha256: input.referenceSha256, referenceExpectedId: input.referenceId ?? "not_provided", referenceResult: "not_checked",
    expectedMimeType: input.referenceMimeType, expectedByteSize: input.referenceByteSize, expectedWidth: input.referenceWidth, expectedHeight: input.referenceHeight,
    operationBound: false, attachmentBound: false, targetBound: false, documentBound: false,
  };
  let tracePanel: HTMLElement | undefined;
  let finishTrace: (panel?: HTMLElement, animateState?: NonNullable<VidsComposerTransitionDiagnostics["handoffTrace"]>["finalAnimateState"]) => void = () => undefined;
  const blocked = (stage: VidsComposerTransitionDiagnostics["stage"], reason: string) => { finishTrace(); return { href, ok: false, reason, changed: false, diagnostics: { ...diagnostic, stage } }; };
  const visible = (element: Element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"; };
  const name = (element: Element) => {
    const aria = element.getAttribute("aria-label")?.trim(); if (aria) return aria;
    const labelled = element.getAttribute("aria-labelledby")?.trim();
    if (labelled) return labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
    return element.getAttribute("title")?.trim() ?? "";
  };
  const toggleForPanel = (panel?: HTMLElement, selectedTab?: HTMLElement, sidebar?: HTMLElement) => {
    if (!panel) return { label: "missing" as const, scope: "missing" as const, control: undefined as HTMLButtonElement | undefined, disabled: false, candidateCount: 0 };
    const inPanel = [...panel.querySelectorAll<HTMLButtonElement>("button.collapsiblePromptBoxToggleExpansionButton")].filter(visible);
    const siblings = panel.parentElement ? [...panel.parentElement.children].filter((element): element is HTMLButtonElement => element instanceof HTMLButtonElement && element.matches("button.collapsiblePromptBoxToggleExpansionButton") && visible(element)) : [];
    // Vids can place its toggle beside a nested composer wrapper rather than
    // inside the tabpanel or as its direct sibling. Search only the nearest
    // ancestor shared by the selected Animate tab and active tabpanel. Ignore
    // candidates belonging to any other tabpanel and fail closed on multiples.
    let commonContainer: HTMLElement | undefined;
    if (selectedTab && sidebar?.contains(selectedTab)) {
      let ancestor: HTMLElement | null = panel;
      while (ancestor && sidebar.contains(ancestor)) {
        if (ancestor.contains(selectedTab)) { commonContainer = ancestor; break; }
        ancestor = ancestor.parentElement;
      }
    }
    const commonCandidates = commonContainer ? [...commonContainer.querySelectorAll<HTMLButtonElement>("button.collapsiblePromptBoxToggleExpansionButton")].filter(visible).filter((candidate) => {
      const owningPanel = candidate.closest<HTMLElement>("[role='tabpanel']");
      return owningPanel === null || owningPanel === panel;
    }) : [];
    const candidates = commonContainer ? commonCandidates : inPanel.length ? inPanel : siblings;
    const uniqueScope = candidates.length === 1 ? panel.contains(candidates[0]!) ? "panel" as const : candidates[0]!.parentElement === panel.parentElement ? "tabpanel_sibling" as const : "composer_container" as const : undefined;
    const scope = candidates.length > 1 ? "ambiguous" as const : uniqueScope ?? "missing" as const;
    if (!candidates.length) return { label: "missing" as const, scope, control: undefined as HTMLButtonElement | undefined, disabled: false, candidateCount: 0 };
    if (candidates.length !== 1) return { label: "ambiguous" as const, scope: "ambiguous" as const, control: undefined as HTMLButtonElement | undefined, disabled: false, candidateCount: Math.min(10, candidates.length) };
    const control = candidates[0]!;
    const raw = control.getAttribute("aria-label")?.trim();
    const label: VidsComposerToggleLabel = raw === "Expand" || raw === "Collapse" ? raw as VidsComposerToggleLabel : "unknown";
    return { label, scope, control, disabled: control.disabled || control.getAttribute("aria-disabled") === "true", candidateCount: 1 };
  };
  let traceTab: HTMLElement | undefined;
  let traceSidebar: HTMLElement | undefined;
  const toggleLabelForPanel = (panel?: HTMLElement): VidsComposerToggleLabel => toggleForPanel(panel, traceTab, traceSidebar).label;
  const priorTrace = input.traceContext?.priorTrace;
  const trace: NonNullable<VidsComposerTransitionDiagnostics["handoffTrace"]> = {
    ...(priorTrace ?? {}),
    ...(input.traceContext ? { triggerSource: priorTrace?.triggerSource ?? input.traceContext.triggerSource, elapsedSinceReceiptToFirstReadMs: priorTrace?.elapsedSinceReceiptToFirstReadMs ?? input.traceContext.elapsedSinceReceiptToFirstReadMs } : {}),
    visibilityChanges: [...(priorTrace?.visibilityChanges ?? [])], previewObservations: [...(priorTrace?.previewObservations ?? [])],
  };
  trace.expansionAttempted ??= false;
  trace.panelReplaced ??= false;
  trace.editorReplaced ??= false;
  trace.composerToggleClickAttempted ??= false;
  const inspection = Math.min(20, Math.max(0, ...trace.previewObservations!.map((entry) => entry.inspection), ...trace.visibilityChanges!.map((entry) => entry.inspection)) + (trace.previewObservations!.length || trace.visibilityChanges!.length ? 1 : 0));
  const inspectionStartedAt = performance.now();
  let lastVisibility = trace.visibilityEnd ?? trace.visibilityStart;
  const visibility = (): NonNullable<typeof trace.visibilityStart> => document.visibilityState === "visible" || document.visibilityState === "hidden" || document.visibilityState === "prerender" || document.visibilityState === "unloaded" ? document.visibilityState : "unknown";
  const sampleVisibility = (force = false) => {
    const state = visibility();
    if (!trace.visibilityStart) trace.visibilityStart = state;
    if (lastVisibility !== undefined && state !== lastVisibility && trace.visibilityChanges!.length < 8) trace.visibilityChanges!.push({ inspection, atMs: Math.min(10_000_000, Math.max(0, Math.trunc(performance.now() - inspectionStartedAt))), state });
    lastVisibility = state;
    if (force || !trace.visibilityEnd) trace.visibilityEnd = state;
  };
  let lastPreviewSignature = "";
  const recordPreviews = (panel?: HTMLElement, force = false) => {
    sampleVisibility();
    const matches = panel ? [...panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")] : [];
    const visibleMatches = matches.filter(visible);
    const loadedMatches = visibleMatches.filter((preview) => preview.complete && preview.naturalWidth > 0 && preview.naturalHeight > 0);
    const composerToggleLabel = toggleLabelForPanel(panel);
    const entry = { inspection, atMs: Math.min(10_000_000, Math.max(0, Math.trunc(performance.now() - inspectionStartedAt))), selectorMatches: Math.min(10, matches.length), visibleMatches: Math.min(10, visibleMatches.length), loadedMatches: Math.min(10, loadedMatches.length), composerToggleLabel };
    const signature = `${entry.selectorMatches}:${entry.visibleMatches}:${entry.loadedMatches}:${composerToggleLabel}`;
    if (force || !lastPreviewSignature || signature !== lastPreviewSignature) {
      if (trace.previewObservations!.length >= 8) trace.previewObservations!.splice(1, 1);
      trace.previewObservations!.push(entry);
      lastPreviewSignature = signature;
    }
  };
  finishTrace = (panel: HTMLElement | undefined = tracePanel, animateState?: NonNullable<typeof trace.finalAnimateState>) => {
    sampleVisibility(true);
    if (panel) recordPreviews(panel, true);
    if (animateState) trace.finalAnimateState = animateState;
    diagnostic.handoffTrace = trace;
  };
  const resolveFreshComposer = () => {
    const freshSidebars = [...document.querySelectorAll<HTMLElement>("[role='complementary']")].filter(visible).filter((element) => name(element) === "AI video clip");
    if (freshSidebars.length !== 1) return { sidebarCount: freshSidebars.length, tabCount: 0, panelCount: 0, editorCount: 0, panel: undefined, editor: undefined, editorCandidate: undefined, toggle: undefined };
    const freshSidebar = freshSidebars[0]!;
    const freshTabs = [...freshSidebar.querySelectorAll<HTMLElement>("[role='tab'][aria-selected='true']")].filter(visible).filter((element) => name(element) === "Animate");
    const namedPanels = [...freshSidebar.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter((element) => name(element) === "Animate");
    const controlledIds = freshTabs.length === 1 ? freshTabs[0]!.getAttribute("aria-controls")?.trim().split(/\s+/).filter(Boolean) ?? [] : [];
    const controlledPanels = controlledIds.map((id) => document.getElementById(id)).filter((element): element is HTMLElement => element instanceof HTMLElement && freshSidebar.contains(element) && element.getAttribute("role") === "tabpanel");
    const activePanels = controlledPanels.length ? controlledPanels : namedPanels.filter(visible).length ? namedPanels.filter(visible) : namedPanels.filter((element) => element.getAttribute("aria-hidden") !== "true");
    const freshPanels = activePanels;
    const freshPanel = freshPanels.length === 1 ? freshPanels[0] : undefined;
    const editorSelector = "div[role='textbox'][contenteditable='true'][aria-label='Add your image, then describe what should happen in your video.']";
    const editorCandidates = freshPanel ? [...freshPanel.querySelectorAll<HTMLElement>(editorSelector)] : [];
    const freshEditors = editorCandidates.filter(visible);
    return { sidebarCount: freshSidebars.length, tabCount: freshTabs.length, panelCount: freshPanels.length, editorCount: freshEditors.length, sidebar: freshSidebar, tab: freshTabs.length === 1 ? freshTabs[0] : undefined, panel: freshPanel, editor: freshEditors.length === 1 ? freshEditors[0] : undefined, editorCandidate: editorCandidates.length === 1 ? editorCandidates[0] : undefined, toggle: freshPanel ? toggleForPanel(freshPanel, freshTabs.length === 1 ? freshTabs[0] : undefined, freshSidebar) : undefined };
  };
  const startedAt = performance.now();
  const readinessElapsedBefore = trace.composerReadinessWaitMs ?? 0;
  const deadline = Math.min(input.readinessDeadlineAt ?? Date.now() + Math.min(30_000, Math.max(2_000, input.timeoutMs)), Date.now() + 30_000);
  const initialComposer = resolveFreshComposer();
  let fresh = resolveFreshComposer();
  let priorPanel: HTMLElement | undefined;
  let priorEditor: HTMLElement | undefined;
  let stableReads = 0;
  let expandClicked = false;
  let observedMissingPreview = false;
  let observedLoadedPreview = false;
  let firstLabel: VidsComposerToggleLabel | undefined;
  const observe = (current: typeof fresh) => {
    const label = current.toggle?.label ?? (current.panelCount > 1 ? "ambiguous" : "missing");
    const scope = current.toggle?.scope ?? "missing";
    trace.composerToggleObservations ??= [];
    const observation = { atMs: Math.min(30_000, Math.max(0, Math.trunc(performance.now() - startedAt))), label, scope, candidateCount: Math.min(10, current.toggle?.candidateCount ?? 0), panelCount: Math.min(10, current.panelCount), editorCount: Math.min(10, current.editorCount), visibility: visibility() };
    const last = trace.composerToggleObservations.at(-1);
    if (!last || last.label !== label || last.scope !== scope || last.panelCount !== observation.panelCount || last.editorCount !== observation.editorCount || last.visibility !== observation.visibility || observation.atMs === 0) {
      if (trace.composerToggleObservations.length >= 8) trace.composerToggleObservations.splice(1, 1);
      trace.composerToggleObservations.push(observation);
    }
    tracePanel = current.panel;
    traceTab = current.tab;
    traceSidebar = current.sidebar;
    recordPreviews(current.panel);
    if (!current.panel || ![...current.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].some(visible)) observedMissingPreview = true;
    if (current.panel && [...current.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].some((preview) => visible(preview) && preview.complete && preview.naturalWidth > 0 && preview.naturalHeight > 0)) observedLoadedPreview = true;
    if (current.panel) diagnostic.previewCount = Math.min(1000, [...current.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible).length);
    if (initialComposer.panel && current.panel && current.panel !== initialComposer.panel) { trace.panelReplaced = true; diagnostic.panelRebound = true; }
    if (initialComposer.editorCandidate && current.editor && current.editor !== initialComposer.editorCandidate) { trace.editorReplaced = true; diagnostic.editorRebound = true; }
  };
  let ready = false;
  while (Date.now() < deadline) {
    sampleVisibility();
    fresh = resolveFreshComposer();
    const toggle = fresh.toggle;
    firstLabel ??= trace.composerToggleLabelBefore ?? toggle?.label ?? (fresh.panelCount > 1 ? "ambiguous" : "missing");
    trace.composerToggleLabelBefore ??= toggle?.label ?? (fresh.panelCount > 1 ? "ambiguous" : "missing");
    trace.composerToggleLabelAfter = toggle?.label ?? (fresh.panelCount > 1 ? "ambiguous" : "missing");
    trace.initialAnimateState ??= toggle?.label === "Collapse" ? "expanded" : toggle?.label === "Expand" ? "collapsed" : toggle?.label === "ambiguous" ? "ambiguous" : "missing";
    trace.composerToggleScope = toggle?.scope ?? "missing";
    trace.initialAnimateState ??= toggle?.label === "Collapse" ? "expanded" : toggle?.label === "Expand" ? "collapsed" : "unknown";
    diagnostic.sidebar = fresh.sidebarCount === 1 ? "unique" : fresh.sidebarCount ? "ambiguous" : "missing";
    diagnostic.animateTab = fresh.tabCount === 1 ? "unique" : fresh.tabCount ? "ambiguous" : "missing";
    diagnostic.animatePanel = fresh.panelCount === 1 ? "unique" : fresh.panelCount ? "ambiguous" : "missing";
    observe(fresh);
    const panelBound = fresh.sidebarCount === 1 && fresh.tabCount === 1 && fresh.panelCount === 1 && !!fresh.panel;
    if (panelBound && toggle?.control && !toggle.disabled && (toggle.label === "Expand" || toggle.label === "Collapse")) {
      if (toggle.label === "Expand" && !expandClicked) {
        expandClicked = true;
        trace.composerToggleClickAttempted = true;
        trace.expansionAttempted = true;
        trace.composerToggleOutcome = "expanded";
        toggle.control.click();
        stableReads = 0;
        priorPanel = undefined;
        priorEditor = undefined;
      } else if (toggle.label === "Collapse" && fresh.editorCount === 1 && fresh.editor) {
        stableReads = fresh.panel === priorPanel && fresh.editor === priorEditor ? stableReads + 1 : 1;
        priorPanel = fresh.panel;
        priorEditor = fresh.editor;
        if (stableReads >= 3) { ready = true; break; }
      } else stableReads = 0;
    } else stableReads = 0;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  trace.composerReadinessWaitMs = Math.min(30_000, readinessElapsedBefore + Math.max(0, Math.trunc(performance.now() - startedAt)));
  if (!ready) {
    const hidden = visibility() === "hidden";
    const label = fresh.toggle?.label ?? (fresh.panelCount > 1 ? "ambiguous" : "missing");
    trace.composerReadinessOutcome = hidden ? "timeout_hidden" : "timeout_visible";
    trace.composerEditorReady = false;
    trace.composerToggleLabelAfter = label;
    trace.composerToggleOutcome ??= label === "ambiguous" ? "ambiguous" : fresh.toggle?.disabled ? "disabled" : label === "unknown" ? "label_unrecognized" : expandClicked ? "settlement_failed" : "missing";
    trace.finalAnimateState = label === "Expand" ? "collapsed" : label === "Collapse" ? "expanded" : label === "ambiguous" ? "ambiguous" : "missing";
    diagnostic.panelStateBeforeExpansion = firstLabel === "Expand" ? "collapsed" : firstLabel === "Collapse" ? "expanded" : "unknown";
    diagnostic.panelStateAfterExpansion = expandClicked ? "unstable" : "not_attempted";
    finishTrace(fresh.panel, trace.finalAnimateState);
    const reason = hidden ? "vids_composer_waiting_for_tab" : trace.composerToggleOutcome === "ambiguous" ? "vids_composer_toggle_ambiguous" : trace.composerToggleOutcome === "disabled" ? "vids_composer_toggle_disabled" : trace.composerToggleOutcome === "label_unrecognized" ? "vids_composer_toggle_label_unrecognized" : expandClicked ? "vids_composer_toggle_settlement_failed" : "vids_composer_readiness_timeout";
    return { href, ok: false, reason, changed: false, diagnostics: { ...diagnostic, stage: "readiness" } };
  }
  trace.composerReadinessOutcome = "ready";
  trace.composerEditorReady = true;
  trace.composerToggleLabelAfter = "Collapse";
  trace.composerToggleOutcome ??= expandClicked ? "expanded" : "already_expanded";
  trace.finalAnimateState = "expanded";
  diagnostic.panelStateBeforeExpansion = firstLabel === "Expand" ? "collapsed" : firstLabel === "Collapse" ? "expanded" : "unknown";
  diagnostic.panelStateAfterExpansion = expandClicked ? "settled" : "not_attempted";
  diagnostic.freshPreviewDetection = observedLoadedPreview ? (observedMissingPreview ? "delayed_then_present" : "present") : "absent_after_settle";
  if (expandClicked) {
    finishTrace(fresh.panel, "expanded");
    return { href, ok: false, reason: "vids_composer_expanded_revalidate", changed: false, diagnostics: { ...diagnostic, stage: "readiness" } };
  }
  if (!fresh.panel || !fresh.editor) return blocked("editor", "prompt_editor_changed");
  let panel = fresh.panel;
  tracePanel = panel;
  diagnostic.editor = "unique";
  let editor = fresh.editor;
  const blocks = new Set(["DIV", "P"]);
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as HTMLElement; if (element.tagName === "BR") return "\n";
    let output = "", content = false;
    for (const child of [...element.childNodes]) { const block = child.nodeType === Node.ELEMENT_NODE && blocks.has((child as Element).tagName); if (block && content && !output.endsWith("\n")) output += "\n"; const value = walk(child); output += value; if (value.length) content = true; }
    return output;
  };
  const serialize = (root: HTMLElement) => {
    let output = "";
    for (const child of [...root.childNodes]) { const block = child.nodeType === Node.ELEMENT_NODE && blocks.has((child as Element).tagName); if (block && output.length && !output.endsWith("\n")) output += "\n"; output += walk(child); }
    return output;
  };
  const resolveFreshContext = () => {
    const currentSidebars = [...document.querySelectorAll<HTMLElement>("[role='complementary']")].filter(visible).filter((element) => name(element) === "AI video clip");
    if (currentSidebars.length !== 1) return undefined;
    const currentTabs = [...currentSidebars[0]!.querySelectorAll<HTMLElement>("[role='tab'][aria-selected='true']")].filter(visible).filter((element) => name(element) === "Animate");
    const currentPanels = [...currentSidebars[0]!.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter(visible).filter((element) => name(element) === "Animate");
    if (currentTabs.length !== 1 || currentPanels.length !== 1) return undefined;
    const currentEditors = [...currentPanels[0]!.querySelectorAll<HTMLElement>("div[role='textbox'][contenteditable='true'][aria-label='Add your image, then describe what should happen in your video.']")].filter(visible);
    if (currentEditors.length !== 1) return undefined;
    return { sidebar: currentSidebars[0]!, panel: currentPanels[0]!, editor: currentEditors[0]! };
  };
  const editorIsEmpty = (currentEditor: HTMLElement) => { const text = serialize(currentEditor); return !text || text === "\n"; };
  const contextIsEmptyAndReady = (context: NonNullable<ReturnType<typeof resolveFreshContext>>) => {
    const addControls = [...context.panel.querySelectorAll<HTMLElement>("button, [role='button']")].filter(visible).filter((element) => name(element) === "Add image");
    const fileInputs = [...context.panel.querySelectorAll<HTMLInputElement>("input[type='file']")];
    const currentPreviews = [...context.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible);
    return currentPreviews.length === 0 && editorIsEmpty(context.editor) && addControls.length === 1 && fileInputs.length === 1;
  };
  if (input.phase === "inspect_clean") {
    const initial = resolveFreshContext();
    if (!initial) return blocked("editor", "vids_refreshed_composer_not_clean");
    diagnostic.previewCount = Math.min(1000, [...initial.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible).length);
    diagnostic.fileInputCount = Math.min(1000, initial.panel.querySelectorAll("input[type='file']").length);
    diagnostic.expectedPromptLength = 0;
    diagnostic.actualPromptLength = Math.min(serialize(initial.editor).length, 10_000_000);
    const hashText = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    diagnostic.promptExpectedSha256 = await hashText("");
    diagnostic.promptActualSha256 = await hashText(serialize(initial.editor));
    diagnostic.clearAvailable = "not_checked";
    if (!contextIsEmptyAndReady(initial)) return blocked("ownership", "vids_refreshed_composer_not_clean");
    let stableReads = 0;
    let stableSince = 0;
    let last: NonNullable<ReturnType<typeof resolveFreshContext>> | undefined;
    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() < deadline && (stableReads < 3 || Date.now() - stableSince < 500)) {
      const current = resolveFreshContext();
      if (current && contextIsEmptyAndReady(current)) {
        if (stableReads === 0) stableSince = Date.now();
        stableReads += 1;
        diagnostic.editorRebound = diagnostic.editorRebound === true || current.editor !== initial.editor;
        diagnostic.panelRebound = diagnostic.panelRebound === true || current.panel !== initial.panel;
        last = current;
      } else { stableReads = 0; stableSince = 0; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (stableReads < 3 || Date.now() - stableSince < 500 || !last) return blocked("settlement", "vids_refreshed_composer_not_clean");
    return { href, ok: true, changed: false, diagnostics: { ...diagnostic, stage: "complete", settledPromptEmpty: true, cleanupState: "already_empty" } };
  }
  const waitForEmptyComposer = async () => {
    const deadline = Date.now() + input.timeoutMs;
    let stableReads = 0, stableSince = 0;
    let previousPanel: HTMLElement | undefined, previousEditor: HTMLElement | undefined;
    while (Date.now() < deadline) {
      const context = resolveFreshContext();
      if (context && contextIsEmptyAndReady(context)) {
        if (context.panel === previousPanel && context.editor === previousEditor) stableReads += 1;
        else { stableReads = 1; stableSince = Date.now(); }
        previousPanel = context.panel; previousEditor = context.editor;
        diagnostic.editorRebound = context.editor !== editor;
        diagnostic.panelRebound = context.panel !== panel;
        if (stableReads >= 3 && Date.now() - stableSince >= 500) return true;
      } else { stableReads = 0; stableSince = 0; previousPanel = undefined; previousEditor = undefined; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  };
  const clearExactPrompt = async (): Promise<{ href: string; ok: boolean; reason?: string; changed: boolean; diagnostics: VidsComposerTransitionDiagnostics }> => {
    diagnostic.stage = "prompt_clear";
    let context = resolveFreshContext();
    if (!context) return blocked("prompt_clear", "vids_prompt_editor_rebind_failed");
    diagnostic.editorRebound = context.editor !== editor || context.panel !== panel;
    const actual = serialize(context.editor);
    const actualHash = await digest(new TextEncoder().encode(actual).buffer);
    diagnostic.promptActualSha256 = actualHash;
    diagnostic.expectedPromptLength = Math.min(input.prompt.length, 10_000_000);
    diagnostic.actualPromptLength = Math.min(actual.length, 10_000_000);
    diagnostic.promptTextMatches = actual === input.prompt;
    diagnostic.promptHashMatches = actualHash === input.promptSha256;
    diagnostic.promptMatches = diagnostic.promptTextMatches && diagnostic.promptHashMatches;
    const noPreview = [...context.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible).length === 0;
    diagnostic.previewCount = Math.min(1000, [...context.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible).length);
    diagnostic.fileInputCount = Math.min(1000, context.panel.querySelectorAll("input[type='file']").length);
    const initialClearControls = [...context.panel.querySelectorAll<HTMLElement>("button, [role='button']")].filter(visible).filter((element) => name(element) === "Clear prompt and image" || element.getAttribute("data-tooltip")?.trim() === "Clear prompt and image");
    diagnostic.clearAvailable = initialClearControls.length === 1 ? "unique" : initialClearControls.length ? "ambiguous" : "missing";
    if (!diagnostic.promptMatches || !noPreview) return blocked("prompt_clear", "vids_previous_composer_content_conflict");
    if (input.inspectOnly) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, cleanupState: "reference_removed_prompt_present", stage: "complete" as const } };
    context.editor.focus();
    const range = document.createRange(); range.selectNodeContents(context.editor); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    let execResult: boolean;
    try { execResult = document.execCommand("delete"); } catch { execResult = false; /* Fall through to the uniquely scoped native Clear control. */ }
    selection?.removeAllRanges();
    if (execResult) context.editor.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward" }));
    diagnostic.clearAttempt = "contenteditable_input";
    let deadline = Date.now() + Math.min(input.timeoutMs, 500);
    while (Date.now() < deadline) {
      context = resolveFreshContext();
      if (context && editorIsEmpty(context.editor)) { diagnostic.immediatePromptEmpty = true; if (contextIsEmptyAndReady(context)) { diagnostic.settledPromptEmpty = true; finishTrace(context.panel, "expanded"); return { href, ok: true, changed: true, diagnostics: { ...diagnostic, handoffTrace: trace, cleanupState: "already_empty" as const, stage: "complete" as const } }; } }
      else if (context && serialize(context.editor) !== input.prompt) return blocked("prompt_clear", "vids_previous_composer_content_conflict");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    context = resolveFreshContext();
    if (!context) return blocked("prompt_clear", "vids_prompt_editor_rebind_failed");
    diagnostic.editorRebound ||= context.editor !== editor;
    diagnostic.panelRebound = context.panel !== panel;
    const currentText = serialize(context.editor);
    diagnostic.previewCount = Math.min(1000, [...context.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible).length);
    diagnostic.fileInputCount = Math.min(1000, context.panel.querySelectorAll("input[type='file']").length);
    diagnostic.actualPromptLength = Math.min(currentText.length, 10_000_000);
    const currentHash = await digest(new TextEncoder().encode(currentText).buffer);
    diagnostic.promptActualSha256 = currentHash;
    const fallbackClearControls = [...context.panel.querySelectorAll<HTMLElement>("button, [role='button']")].filter(visible).filter((element) => name(element) === "Clear prompt and image" || element.getAttribute("data-tooltip")?.trim() === "Clear prompt and image");
    diagnostic.clearAvailable = fallbackClearControls.length === 1 ? "unique" : fallbackClearControls.length ? "ambiguous" : "missing";
    if (editorIsEmpty(context.editor) && contextIsEmptyAndReady(context)) { diagnostic.immediatePromptEmpty = true; diagnostic.settledPromptEmpty = true; finishTrace(context.panel, "expanded"); return { href, ok: true, changed: true, diagnostics: { ...diagnostic, handoffTrace: trace, cleanupState: "already_empty" as const, stage: "complete" as const } }; }
    if (currentText !== input.prompt || currentHash !== input.promptSha256) return blocked("prompt_clear", "vids_previous_composer_content_conflict");
    if (fallbackClearControls.length !== 1) return blocked("prompt_clear", "vids_previous_prompt_clear_failed");
    diagnostic.clearAttempt = "native_clear";
    fallbackClearControls[0]!.click();
    diagnostic.stage = "settlement";
    deadline = Date.now() + input.timeoutMs;
    while (Date.now() < deadline) {
      context = resolveFreshContext();
      if (context && editorIsEmpty(context.editor)) { diagnostic.immediatePromptEmpty = true; if (contextIsEmptyAndReady(context)) { diagnostic.settledPromptEmpty = true; diagnostic.editorRebound = true; finishTrace(context.panel, "expanded"); return { href, ok: true, changed: true, diagnostics: { ...diagnostic, handoffTrace: trace, cleanupState: "already_empty", stage: "complete" } }; } }
      else if (context && serialize(context.editor) !== input.prompt) return blocked("prompt_clear", "vids_previous_composer_content_conflict");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return blocked("prompt_clear", "vids_previous_prompt_clear_failed");
  };
  const digest = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
  diagnostic.panelStateAfterExpansion = "not_attempted";
  let previews = [...panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible);
  diagnostic.freshPreviewDetection = previews.length ? "present" : "unknown";
  if ((!previews.length || (previews.length === 1 && (!previews[0]!.complete || previews[0]!.naturalWidth < 1))) && !input.checkpointedOwnership) {
    let lastPanel: HTMLElement | undefined;
    let lastEditor: HTMLElement | undefined;
    let stableReads = 0;
    let sawMissingPreview = previews.length === 0;
    let settled = false;
    const deadline = Date.now() + Math.max(500, Math.min(input.timeoutMs, 5_000));
    while (Date.now() < deadline) {
      const current = resolveFreshContext();
      if (current) {
        const currentPreviews = [...current.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible);
        tracePanel = current.panel;
        recordPreviews(current.panel);
        const sameContext = current.panel === lastPanel && current.editor === lastEditor;
        if (currentPreviews.length === 0) sawMissingPreview = true;
        const ready = currentPreviews.length === 1 && currentPreviews[0]!.complete && currentPreviews[0]!.naturalWidth > 0 && currentPreviews[0]!.naturalHeight > 0;
        stableReads = sameContext && ready ? stableReads + 1 : ready ? 1 : 0;
        lastPanel = current.panel; lastEditor = current.editor;
        trace.panelReplaced ||= current.panel !== panel;
        trace.editorReplaced ||= current.editor !== editor;
        trace.finalAnimateState = "expanded";
        diagnostic.panelRebound = current.panel !== panel;
        diagnostic.editorRebound = current.editor !== editor;
        diagnostic.previewCount = Math.min(1000, currentPreviews.length);
        if (ready && stableReads >= 3) {
          panel = current.panel; editor = current.editor; previews = currentPreviews; settled = true;
          diagnostic.panelStateAfterExpansion = "settled";
          diagnostic.freshPreviewDetection = sawMissingPreview ? "delayed_then_present" : "present";
          break;
        }
      } else { stableReads = 0; lastPanel = undefined; lastEditor = undefined; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!settled) {
      const current = resolveFreshContext();
      if (current && lastPanel === current.panel && lastEditor === current.editor && stableReads === 0 && !current.panel.querySelector("img[alt='Uploaded image preview']")) {
        panel = current.panel; editor = current.editor; previews = [];
        tracePanel = current.panel;
        recordPreviews(current.panel, true);
        trace.panelReplaced ||= current.panel !== panel;
        trace.editorReplaced ||= current.editor !== editor;
        trace.finalAnimateState = "expanded";
        diagnostic.panelRebound = current.panel !== panel;
        diagnostic.editorRebound = true;
        diagnostic.previewCount = 0;
        diagnostic.panelStateAfterExpansion = "settled";
        diagnostic.freshPreviewDetection = "absent_after_settle";
      } else {
        diagnostic.panelStateAfterExpansion = current ? "unstable" : "missing";
        diagnostic.freshPreviewDetection = current ? "unknown" : "unknown";
        return blocked("settlement", "vids_composer_settlement_failed");
      }
    }
  }
  diagnostic.previewCount = Math.min(previews.length, 1_000);
  if (previews.length === 1) {
    diagnostic.actualWidth = previews[0]!.naturalWidth;
    diagnostic.actualHeight = previews[0]!.naturalHeight;
  }
  const currentPrompt = serialize(editor);
  diagnostic.expectedPromptLength = Math.min(input.prompt.length, 10_000_000);
  diagnostic.actualPromptLength = Math.min(currentPrompt.length, 10_000_000);
  diagnostic.fileInputCount = Math.min(1000, panel.querySelectorAll("input[type='file']").length);
  diagnostic.stage = "prompt";
  try { diagnostic.promptActualSha256 = await digest(new TextEncoder().encode(currentPrompt).buffer); }
  catch { return blocked("prompt", "vids_previous_prompt_hash_unavailable"); }
  diagnostic.promptTextMatches = currentPrompt === input.prompt;
  diagnostic.promptHashMatches = diagnostic.promptActualSha256 === input.promptSha256;
  diagnostic.promptMatches = diagnostic.promptTextMatches && diagnostic.promptHashMatches;

  // A worker may restart after the verified Remove-image click but before the
  // exact prior prompt is cleared. Resume may finish only that owned boundary,
  // or continue from an already-empty composer; conflicting text is untouched.
  if (previews.length === 0) {
    if (!input.checkpointedOwnership) return blocked("ownership", "vids_cleanup_checkpoint_required");
    if (input.phase === "remove_reference" && currentPrompt === input.prompt && diagnostic.promptHashMatches)
      return { href, ok: true, changed: false, diagnostics: { ...diagnostic, cleanupState: "reference_removed_prompt_present", stage: "complete" } };
    if (input.phase === "remove_reference" && currentPrompt === input.prompt && diagnostic.promptHashMatches)
      return { href, ok: true, changed: false, diagnostics: { ...diagnostic, cleanupState: "reference_removed_prompt_present", stage: "complete" } };
    if (input.phase === "verify_empty") {
      if ((!currentPrompt || currentPrompt === "\n") && await waitForEmptyComposer()) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, settledPromptEmpty: true, cleanupState: "already_empty", stage: "complete" } };
      return blocked("prompt_clear", "vids_cleanup_completion_changed");
    }
    if (input.phase === "clear_prompt" && currentPrompt === input.prompt && diagnostic.promptHashMatches) return clearExactPrompt();
    if (currentPrompt === input.prompt && diagnostic.promptHashMatches) {
      diagnostic.cleanupState = "reference_removed_prompt_present";
      if (input.inspectOnly) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, stage: "complete" } };
      if (input.phase === "remove_reference") return { href, ok: true, changed: false, diagnostics: { ...diagnostic, cleanupState: "reference_removed_prompt_present", stage: "complete" } };
      return clearExactPrompt();
    }
    if (!currentPrompt || currentPrompt === "\n") {
      diagnostic.cleanupState = "already_empty";
      if (input.phase === "clear_prompt") {
        if (await waitForEmptyComposer()) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, settledPromptEmpty: true, stage: "complete" } };
        return blocked("prompt_clear", "vids_empty_composer_controls_not_ready");
      }
      if (!input.checkpointedOwnership) return blocked("ownership", "vids_cleanup_checkpoint_required");
      if (input.inspectOnly) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, stage: "complete" } };
      if (await waitForEmptyComposer()) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, stage: "complete" } };
      return blocked("mutation", "vids_empty_composer_controls_not_ready");
    }
    return blocked("prompt", "vids_previous_composer_content_conflict");
  }
  if (input.phase === "verify_empty") return blocked("prompt_clear", "vids_cleanup_completion_changed");
  diagnostic.cleanupState = "previous_pair_present";

  diagnostic.stage = "reference";
  if (previews.length !== 1 || !previews[0]!.complete || previews[0]!.naturalWidth !== input.referenceWidth || previews[0]!.naturalHeight !== input.referenceHeight) {
    diagnostic.referenceResult = "unavailable";
    diagnostic.referenceReason = previews.length !== 1 ? "reference_preview_count_mismatch" : !previews[0]!.complete ? "reference_preview_not_ready" : "reference_preview_dimensions_mismatch";
  } else {
    const inputs = [...panel.querySelectorAll<HTMLInputElement>("input[type='file']")];
    const file = inputs.length === 1 ? inputs[0]!.files?.[0] : undefined;
    let bytes: ArrayBuffer | undefined;
    try {
      if (inputs.length > 1 || (inputs.length === 1 && !inputs[0]!.files)) throw new Error("reference_file_input_ambiguous");
      if (file) {
        bytes = await file.arrayBuffer(); diagnostic.actualMimeType = file.type === "image/png" || file.type === "image/jpeg" ? file.type : "unsupported"; diagnostic.actualByteSize = Math.min(file.size, Number.MAX_SAFE_INTEGER); diagnostic.referenceProofSource = "selected_file_sha256";
      } else {
        const url = new URL(previews[0]!.currentSrc || previews[0]!.src);
        if (url.protocol !== "blob:" || url.origin !== location.origin) throw new Error("reference_preview_blob_unavailable");
        const response = await fetch(url.href); if (!response.ok) throw new Error("reference_preview_blob_unreadable");
        const blob = await response.blob(); bytes = await blob.arrayBuffer(); diagnostic.actualMimeType = blob.type === "image/png" || blob.type === "image/jpeg" ? blob.type : "unsupported"; diagnostic.actualByteSize = Math.min(blob.size, Number.MAX_SAFE_INTEGER); diagnostic.referenceProofSource = "preview_blob_sha256";
      }
      const actual = await digest(bytes!);
      diagnostic.referenceActualSha256 = actual;
      const matches = (input.referenceCandidates ?? []).filter((candidate) => candidate.sha256 === actual && candidate.mimeType === diagnostic.actualMimeType && candidate.byteSize === diagnostic.actualByteSize && candidate.width === diagnostic.actualWidth && candidate.height === diagnostic.actualHeight);
      if (matches.length === 1) diagnostic.referenceActualId = matches[0]!.referenceId;
      diagnostic.referenceResult = diagnostic.actualMimeType === input.referenceMimeType && diagnostic.actualByteSize === input.referenceByteSize && actual === input.referenceSha256 ? "matched" : "mismatched";
      if (diagnostic.referenceResult === "mismatched") diagnostic.referenceReason = "reference_identity_or_metadata_mismatch";
    } catch (error) {
      diagnostic.referenceResult = "unavailable";
      diagnostic.referenceReason = error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : "reference_identity_proof_unavailable";
    }
  }
  if (!diagnostic.promptTextMatches) return blocked("prompt", "vids_previous_composer_content_conflict");
  if (!diagnostic.promptHashMatches) return blocked("prompt", "vids_previous_prompt_hash_mismatch");
  if (diagnostic.referenceResult !== "matched") return blocked("reference", "vids_previous_reference_identity_mismatch");
  if (input.phase === "clear_prompt") return blocked("ownership", "vids_cleanup_stage_mismatch");
  if (input.phase === "inspect") { finishTrace(panel, "expanded"); return { href, ok: true, changed: false, diagnostics: { ...diagnostic, stage: "complete" } }; }
  const remove = [...panel.querySelectorAll<HTMLButtonElement>("button[aria-label='Remove image']")].filter(visible);
  if (remove.length !== 1) return blocked("ownership", "reference_remove_control_ambiguous");
  if (input.inspectOnly) { finishTrace(panel, "expanded"); return { href, ok: true, changed: false, diagnostics: { ...diagnostic, stage: "complete" } }; }
  diagnostic.stage = "reference_remove";
  remove[0]!.click();
  const until = Date.now() + input.timeoutMs;
  while (Date.now() < until) {
    const rebound = resolveFreshContext();
    if (rebound && [...rebound.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible).length === 0) {
      diagnostic.editorRebound = rebound.editor !== editor || rebound.panel !== panel;
      diagnostic.panelRebound = rebound.panel !== panel;
      if (input.phase === "remove_reference") return { href, ok: true, changed: true, diagnostics: { ...diagnostic, cleanupState: "reference_removed_prompt_present", stage: "complete" } };
      return clearExactPrompt();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return blocked("mutation", "vids_previous_reference_removal_unconfirmed");
}

/** Final exact prompt/reference/control check and at most one Generate click. */
export async function activateVidsGenerateInPage(input: {
  prompt: string;
  promptSha256: string;
  referenceSha256: string;
  referenceMimeType: "image/png" | "image/jpeg";
  referenceByteSize: number;
  referenceWidth: number;
  referenceHeight: number;
}): Promise<VidsGenerateActivationResult> {
  const href = location.href;
  const blocked = (reason: string): VidsGenerateActivationResult => ({ href, ok: false, reason, activationAttempted: false, activationCount: 0 });
  const proveReference = async (panel: HTMLElement, preview: HTMLImageElement): Promise<{ sha256: string; source: "selected_file_sha256" | "preview_blob_sha256" } | { reason: string }> => {
    const inputs = [...panel.querySelectorAll<HTMLInputElement>("input[type='file']")];
    if (inputs.length > 1) return { reason: "reference_file_input_ambiguous" };
    const files = inputs[0]?.files;
    if (inputs.length === 1 && !files) return { reason: "reference_file_list_unavailable" };
    if (files && files.length > 1) return { reason: "reference_file_selection_ambiguous" };
    let bytes: ArrayBuffer;
    let mimeType: string;
    let byteSize: number;
    let source: "selected_file_sha256" | "preview_blob_sha256";
    const file = files?.[0];
    if (file) {
      mimeType = file.type;
      byteSize = file.size;
      if (byteSize !== input.referenceByteSize || mimeType !== input.referenceMimeType) return { reason: "reference_file_metadata_mismatch" };
      try { bytes = await file.arrayBuffer(); }
      catch { return { reason: "reference_file_read_failed" }; }
      source = "selected_file_sha256";
    } else {
      let previewUrl: URL;
      try { previewUrl = new URL(preview.currentSrc || preview.src); }
      catch { return { reason: "reference_preview_blob_url_invalid" }; }
      if (previewUrl.protocol !== "blob:" || previewUrl.origin !== location.origin) return { reason: "reference_preview_blob_unavailable" };
      let response: Response;
      try { response = await fetch(previewUrl.href); }
      catch { return { reason: "reference_preview_blob_unreadable" }; }
      if (!response.ok) return { reason: "reference_preview_blob_unreadable" };
      let blob: Blob;
      try { blob = await response.blob(); bytes = await blob.arrayBuffer(); }
      catch { return { reason: "reference_preview_blob_read_failed" }; }
      mimeType = blob.type;
      byteSize = blob.size;
      if (byteSize !== input.referenceByteSize || mimeType !== input.referenceMimeType) return { reason: "reference_preview_blob_metadata_mismatch" };
      source = "preview_blob_sha256";
    }
    try {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      return { sha256: [...digest].map((value) => value.toString(16).padStart(2, "0")).join(""), source };
    } catch { return { reason: "reference_hash_unavailable" }; }
  };
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const name = (element: Element) => {
    const aria = element.getAttribute("aria-label")?.trim();
    if (aria) return aria;
    const labelled = element.getAttribute("aria-labelledby")?.trim();
    if (labelled) return labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
    return element.getAttribute("title")?.trim() ?? "";
  };
  const serializeEditor = (root: HTMLElement): string => {
    const blockTags = new Set(["DIV", "P"]);
    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const element = node as HTMLElement;
      if (element.tagName === "BR") return "\n";
      let output = "";
      let hasContent = false;
      for (const child of [...element.childNodes]) {
        const isBlock = child.nodeType === Node.ELEMENT_NODE && blockTags.has((child as Element).tagName);
        if (isBlock && hasContent && !output.endsWith("\n")) output += "\n";
        const value = walk(child);
        output += value;
        if (value.length > 0) hasContent = true;
      }
      return output;
    };
    let output = "";
    for (const child of [...root.childNodes]) {
      const isBlock = child.nodeType === Node.ELEMENT_NODE && blockTags.has((child as Element).tagName);
      if (isBlock && output.length > 0 && !output.endsWith("\n")) output += "\n";
      output += walk(child);
    }
    return output;
  };
  const sidebars = [...document.querySelectorAll<HTMLElement>("[role='complementary']")].filter(visible).filter((element) => name(element) === "AI video clip");
  if (sidebars.length !== 1) return blocked(sidebars.length ? "ai_sidebar_ambiguous" : "ai_sidebar_missing");
  const sidebar = sidebars[0]!;
  const tabs = [...sidebar.querySelectorAll<HTMLElement>("[role='tab'][aria-selected='true']")].filter(visible).filter((element) => name(element) === "Animate");
  const panels = [...sidebar.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter(visible).filter((element) => name(element) === "Animate");
  if (tabs.length !== 1 || panels.length !== 1) return blocked("animate_panel_changed");
  const panel = panels[0]!;
  const previews = [...panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible);
  const removals = [...panel.querySelectorAll<HTMLButtonElement>("button[aria-label='Remove image']")].filter(visible);
  const editors = [...panel.querySelectorAll<HTMLElement>("div[role='textbox'][contenteditable='true'][aria-label='Add your image, then describe what should happen in your video.']")].filter(visible);
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button[aria-label='Generate']")].filter(visible);
  if (previews.length !== 1 || removals.length !== 1 || !previews[0]!.complete || previews[0]!.naturalWidth < 1 || previews[0]!.naturalHeight < 1) return blocked("reference_preview_changed");
  if (previews[0]!.naturalWidth !== input.referenceWidth || previews[0]!.naturalHeight !== input.referenceHeight) return blocked("reference_preview_dimensions_mismatch");
  const referenceProof = await proveReference(panel, previews[0]!);
  if ("reason" in referenceProof) return blocked(referenceProof.reason);
  if (referenceProof.sha256 !== input.referenceSha256) return blocked("reference_identity_mismatch");
  if (editors.length !== 1) return blocked("prompt_editor_changed");
  const prompt = serializeEditor(editors[0]!);
  if (prompt !== input.prompt) return blocked("prompt_readback_changed");
  const encoded = new TextEncoder().encode(prompt);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  const actualPromptHash = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actualPromptHash !== input.promptSha256) return blocked("prompt_hash_changed");
  if (buttons.length !== 1) return blocked(buttons.length ? "generate_control_ambiguous" : "generate_control_missing");
  const button = buttons[0]!;
  if (button.disabled || button.getAttribute("aria-disabled") === "true") return blocked("generate_disabled");
  const activationAttempted = true;
  try {
    button.click();
    return { href, ok: true, activationAttempted, activationCount: 1, referenceProofSource: referenceProof.source };
  } catch {
    return { href, ok: false, reason: "generate_activation_delivery_uncertain", activationAttempted, activationCount: 1 };
  }
}
