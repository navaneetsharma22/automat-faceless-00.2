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
  stage: "sidebar" | "animate" | "editor" | "prompt" | "reference" | "ownership" | "mutation" | "prompt_clear" | "complete";
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
};

/**
 * P10.3 ownership check. Inspection mode is read-only. Transition mode can
 * expand only the unique scoped Expand control, then repeats all identity checks.
 */
export async function transitionVidsComposerFromPreviousInPage(input: {
  prompt: string; promptSha256: string; referenceSha256: string; referenceMimeType: "image/png" | "image/jpeg";
  referenceId?: string;
  referenceCandidates?: Array<{ referenceId: string; sha256: string; mimeType: "image/png" | "image/jpeg"; byteSize: number; width: number; height: number }>;
  checkpointedOwnership?: boolean;
  referenceByteSize: number; referenceWidth: number; referenceHeight: number; timeoutMs: number; inspectOnly?: boolean;
}): Promise<{ href: string; ok: boolean; reason?: string; changed: boolean; diagnostics: VidsComposerTransitionDiagnostics }> {
  const href = location.href;
  const diagnostic: VidsComposerTransitionDiagnostics = {
    stage: "sidebar", sidebar: "missing", animateTab: "missing", animatePanel: "missing", editor: "missing", previewCount: 0,
    promptExpectedSha256: input.promptSha256, referenceExpectedSha256: input.referenceSha256, referenceExpectedId: input.referenceId ?? "not_provided", referenceResult: "not_checked",
    expectedMimeType: input.referenceMimeType, expectedByteSize: input.referenceByteSize, expectedWidth: input.referenceWidth, expectedHeight: input.referenceHeight,
    operationBound: false, attachmentBound: false, targetBound: false, documentBound: false,
  };
  const blocked = (stage: VidsComposerTransitionDiagnostics["stage"], reason: string) => ({ href, ok: false, reason, changed: false, diagnostics: { ...diagnostic, stage } });
  const visible = (element: Element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"; };
  const name = (element: Element) => {
    const aria = element.getAttribute("aria-label")?.trim(); if (aria) return aria;
    const labelled = element.getAttribute("aria-labelledby")?.trim();
    if (labelled) return labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
    return element.getAttribute("title")?.trim() ?? "";
  };
  const sidebars = [...document.querySelectorAll<HTMLElement>("[role='complementary']")].filter(visible).filter((element) => name(element) === "AI video clip");
  diagnostic.sidebar = sidebars.length === 1 ? "unique" : sidebars.length ? "ambiguous" : "missing";
  if (sidebars.length !== 1) return blocked("sidebar", sidebars.length ? "ai_sidebar_ambiguous" : "ai_sidebar_missing");
  const sidebar = sidebars[0]!;
  const findTabs = () => [...sidebar.querySelectorAll<HTMLElement>("[role='tab'][aria-selected='true']")].filter(visible).filter((element) => name(element) === "Animate");
  const findPanels = () => [...sidebar.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter(visible).filter((element) => name(element) === "Animate");
  const tabs = findTabs();
  const panels = findPanels();
  diagnostic.animateTab = tabs.length === 1 ? "unique" : tabs.length ? "ambiguous" : "missing";
  diagnostic.animatePanel = panels.length === 1 ? "unique" : panels.length ? "ambiguous" : "missing";
  if (tabs.length !== 1) return blocked("animate", tabs.length ? "animate_tab_ambiguous" : "animate_tab_not_selected");
  if (panels.length !== 1 && !input.inspectOnly) {
    const expanders = [...sidebar.querySelectorAll<HTMLElement>("button[aria-expanded='false'], [role='button'][aria-expanded='false']")].filter(visible).filter((element) => name(element) === "Expand");
    if (expanders.length === 1) {
      expanders[0]!.click();
      return { href, ok: false, reason: "vids_composer_expanded_revalidate", changed: false, diagnostics: { ...diagnostic, stage: "animate" } };
    }
  }
  if (tabs.length !== 1 || panels.length !== 1) return blocked("animate", panels.length > 1 ? "animate_panel_ambiguous" : "vids_composer_collapsed_or_changed");
  const panel = panels[0]!;
  const editors = [...panel.querySelectorAll<HTMLElement>("div[role='textbox'][contenteditable='true'][aria-label='Add your image, then describe what should happen in your video.']")].filter(visible);
  diagnostic.editor = editors.length === 1 ? "unique" : editors.length ? "ambiguous" : "missing";
  if (editors.length !== 1) return blocked("editor", editors.length ? "prompt_editor_ambiguous" : "prompt_editor_changed");
  const editor = editors[0]!;
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
  const waitForEmptyComposer = async () => {
    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() < deadline) { const context = resolveFreshContext(); if (context && contextIsEmptyAndReady(context)) { diagnostic.editorRebound = true; return true; } await new Promise((resolve) => setTimeout(resolve, 50)); }
    const context = resolveFreshContext(); return Boolean(context && contextIsEmptyAndReady(context));
  };
  const clearExactPrompt = async () => {
    diagnostic.stage = "prompt_clear";
    let context = resolveFreshContext();
    if (!context) return blocked("prompt_clear", "vids_prompt_editor_rebind_failed");
    diagnostic.editorRebound = context.editor !== editor || context.panel !== panel;
    const actual = serialize(context.editor);
    const actualHash = await digest(new TextEncoder().encode(actual).buffer);
    diagnostic.promptActualSha256 = actualHash;
    diagnostic.promptTextMatches = actual === input.prompt;
    diagnostic.promptHashMatches = actualHash === input.promptSha256;
    diagnostic.promptMatches = diagnostic.promptTextMatches && diagnostic.promptHashMatches;
    const noPreview = [...context.panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible).length === 0;
    if (!diagnostic.promptMatches || !noPreview) return blocked("prompt_clear", "vids_previous_composer_content_conflict");
    if (input.inspectOnly) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, cleanupState: "reference_removed_prompt_present", stage: "complete" } };
    context.editor.focus();
    const range = document.createRange(); range.selectNodeContents(context.editor); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    let execResult = false;
    try { execResult = document.execCommand("delete"); } catch { execResult = false; }
    selection?.removeAllRanges();
    if (execResult) context.editor.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward" }));
    diagnostic.clearAttempt = "contenteditable_input";
    let deadline = Date.now() + Math.min(input.timeoutMs, 500);
    while (Date.now() < deadline) {
      context = resolveFreshContext();
      if (context && editorIsEmpty(context.editor)) { diagnostic.immediatePromptEmpty = true; if (contextIsEmptyAndReady(context)) { diagnostic.settledPromptEmpty = true; return { href, ok: true, changed: true, diagnostics: { ...diagnostic, cleanupState: "already_empty", stage: "complete" } }; } }
      else if (context && serialize(context.editor) !== input.prompt) return blocked("prompt_clear", "vids_previous_composer_content_conflict");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    context = resolveFreshContext();
    if (!context) return blocked("prompt_clear", "vids_prompt_editor_rebind_failed");
    const currentText = serialize(context.editor);
    if (editorIsEmpty(context.editor) && contextIsEmptyAndReady(context)) { diagnostic.immediatePromptEmpty = true; diagnostic.settledPromptEmpty = true; return { href, ok: true, changed: true, diagnostics: { ...diagnostic, cleanupState: "already_empty", stage: "complete" } }; }
    if (currentText !== input.prompt || await digest(new TextEncoder().encode(currentText).buffer) !== input.promptSha256) return blocked("prompt_clear", "vids_previous_composer_content_conflict");
    const clearControls = [...context.panel.querySelectorAll<HTMLElement>("button, [role='button']")].filter(visible).filter((element) => name(element) === "Clear prompt and image" || element.getAttribute("data-tooltip")?.trim() === "Clear prompt and image");
    if (clearControls.length !== 1) return blocked("prompt_clear", "vids_previous_prompt_clear_failed");
    diagnostic.clearAttempt = "native_clear";
    clearControls[0]!.click();
    deadline = Date.now() + input.timeoutMs;
    while (Date.now() < deadline) {
      context = resolveFreshContext();
      if (context && editorIsEmpty(context.editor)) { diagnostic.immediatePromptEmpty = true; if (contextIsEmptyAndReady(context)) { diagnostic.settledPromptEmpty = true; diagnostic.editorRebound = true; return { href, ok: true, changed: true, diagnostics: { ...diagnostic, cleanupState: "already_empty", stage: "complete" } }; } }
      else if (context && serialize(context.editor) !== input.prompt) return blocked("prompt_clear", "vids_previous_composer_content_conflict");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return blocked("prompt_clear", "vids_previous_prompt_clear_failed");
  };
  const digest = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
  const previews = [...panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible);
  diagnostic.previewCount = Math.min(previews.length, 1_000);
  if (previews.length === 1) {
    diagnostic.actualWidth = previews[0]!.naturalWidth;
    diagnostic.actualHeight = previews[0]!.naturalHeight;
  }
  const currentPrompt = serialize(editor);
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
    if (currentPrompt === input.prompt && diagnostic.promptHashMatches) {
      diagnostic.cleanupState = "reference_removed_prompt_present";
      if (input.inspectOnly) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, stage: "complete" } };
      diagnostic.stage = "mutation";
      const range = document.createRange(); range.selectNodeContents(editor); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      const deleted = document.execCommand("delete"); selection?.removeAllRanges();
      if (!deleted) return blocked("mutation", "vids_previous_prompt_clear_failed");
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      const until = Date.now() + input.timeoutMs;
      while (Date.now() < until) { if (emptyEditor()) { if (await waitForEmptyComposer()) return { href, ok: true, changed: true, diagnostics: { ...diagnostic, cleanupState: "already_empty", stage: "complete" } }; return blocked("mutation", "vids_empty_composer_controls_not_ready"); } await new Promise((resolve) => setTimeout(resolve, 50)); }
      return blocked("mutation", "vids_previous_prompt_clear_unconfirmed");
    }
    if (!currentPrompt || currentPrompt === "\n") {
      diagnostic.cleanupState = "already_empty";
      if (input.inspectOnly) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, stage: "complete" } };
      if (await waitForEmptyComposer()) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, stage: "complete" } };
      return blocked("mutation", "vids_empty_composer_controls_not_ready");
    }
    return blocked("prompt", "vids_previous_composer_content_conflict");
  }
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
  const remove = [...panel.querySelectorAll<HTMLButtonElement>("button[aria-label='Remove image']")].filter(visible);
  if (remove.length !== 1) return blocked("ownership", "reference_remove_control_ambiguous");
  if (input.inspectOnly) return { href, ok: true, changed: false, diagnostics: { ...diagnostic, stage: "complete" } };
  diagnostic.stage = "mutation";
  remove[0]!.click();
  const until = Date.now() + input.timeoutMs;
  while (Date.now() < until && panel.querySelectorAll("img[alt='Uploaded image preview']").length !== 0) await new Promise((resolve) => setTimeout(resolve, 50));
  if (panel.querySelectorAll("img[alt='Uploaded image preview']").length !== 0) return blocked("mutation", "vids_previous_reference_removal_unconfirmed");
  const range = document.createRange(); range.selectNodeContents(editor); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  if (!document.execCommand("delete")) { selection?.removeAllRanges(); return blocked("mutation", "vids_previous_prompt_clear_failed"); }
  selection?.removeAllRanges();
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  const promptUntil = Date.now() + input.timeoutMs;
  while (Date.now() < promptUntil) { if (emptyEditor()) { if (await waitForEmptyComposer()) return { href, ok: true, changed: true, diagnostics: { ...diagnostic, cleanupState: "already_empty", stage: "complete" } }; return blocked("mutation", "vids_empty_composer_controls_not_ready"); } await new Promise((resolve) => setTimeout(resolve, 50)); }
  return blocked("mutation", "vids_previous_prompt_clear_unconfirmed");
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
