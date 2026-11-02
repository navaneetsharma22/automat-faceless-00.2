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
  referenceByteSize?: number;
  previewLoaded?: boolean;
  previewWidth?: number;
  previewHeight?: number;
  generateCount?: number;
  generateDisabled?: boolean;
};

/**
 * Runs in the bound Vids document. All selectors are scoped to its unique
 * active AI video clip / Animate panel; innerText is the observed multiline
 * serialization for this editor (textContent omits block boundaries).
 */
export async function enterVidsPromptInPage(input: {
  prompt: string;
  expectedSha256: string;
  referenceSha256: string;
  referenceByteSize: number;
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
  const files = [...panel.querySelectorAll<HTMLInputElement>("input[type='file']")];
  if (files.length !== 1 || files[0]!.files?.length !== 1) return failure(files.length > 1 ? "reference_file_input_ambiguous" : "reference_identity_proof_unavailable");
  const file = files[0]!.files![0]!;
  if (file.size !== input.referenceByteSize || file.type !== "image/png" && file.type !== "image/jpeg") return failure("reference_file_metadata_mismatch");
  let actualReferenceSha256: string;
  try {
    const referenceBytes = await file.arrayBuffer();
    const result = new Uint8Array(await crypto.subtle.digest("SHA-256", referenceBytes));
    actualReferenceSha256 = [...result].map((value) => value.toString(16).padStart(2, "0")).join("");
  } catch { return failure("reference_identity_proof_unavailable"); }
  if (actualReferenceSha256 !== input.referenceSha256) return failure("reference_identity_mismatch");

  const editors = [...panel.querySelectorAll<HTMLElement>("div[role='textbox'][contenteditable='true'][aria-label='Add your image, then describe what should happen in your video.']")].filter(visible);
  if (editors.length !== 1) return failure(editors.length ? "prompt_editor_ambiguous" : "prompt_editor_missing");
  const editor = editors[0]!;
  const expectedSha256 = await digest(input.prompt);
  if (expectedSha256 !== input.expectedSha256) return failure("prepared_prompt_hash_mismatch");
  let promptState: VidsVideoPromptEntryResult["promptState"];
  let actual = editor.innerText;
  if (actual === input.prompt) {
    promptState = "already_exact";
  } else {
    const structurallyEmpty = editor.textContent === null || editor.textContent.length === 0;
    if (!structurallyEmpty) return failure("prompt_editor_contains_conflicting_text", "conflict");
    promptState = "empty";
    editor.focus();
    try {
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const inserted = document.execCommand("insertText", false, input.prompt);
      if (!inserted && editor.innerText !== input.prompt) return failure("prompt_insert_rejected", promptState);
    } catch { return failure("prompt_insert_failed", promptState); }
    actual = editor.innerText;
    if (actual !== input.prompt) return { ...failure("prompt_immediate_readback_mismatch", promptState), expectedSha256, actualSha256: await digest(actual), immediateMatch: false };
  }
  const immediateMatch = actual === input.prompt;
  if (!immediateMatch) return { ...failure("prompt_immediate_readback_mismatch", promptState), expectedSha256, actualSha256: await digest(actual), immediateMatch: false };
  const deadline = Date.now() + Math.max(500, Math.min(input.timeoutMs, 5_000));
  let stableReads = 0;
  let previous = "";
  while (Date.now() < deadline && stableReads < 3) {
    const current = editor.innerText;
    if (current !== input.prompt) return { ...failure("prompt_settled_readback_mismatch", promptState), expectedSha256, actualSha256: await digest(current), immediateMatch: true, settledMatch: false, stableReads };
    if (current === previous) stableReads += 1; else stableReads = 1;
    previous = current;
    if (stableReads < 3) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (stableReads < 3) return { ...failure("prompt_settled_readback_timeout", promptState), expectedSha256, actualSha256: await digest(editor.innerText), immediateMatch: true, settledMatch: false, stableReads };
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button[aria-label='Generate']")].filter(visible);
  return {
    href, ok: true, promptState, expectedSha256, actualSha256: await digest(editor.innerText),
    immediateMatch: true, settledMatch: true, stableReads,
    referenceSha256: actualReferenceSha256, referenceByteSize: file.size,
    previewLoaded: true, previewWidth: preview.naturalWidth, previewHeight: preview.naturalHeight,
    generateCount: buttons.length, generateDisabled: buttons.length === 1 ? buttons[0]!.disabled || buttons[0]!.getAttribute("aria-disabled") === "true" : undefined,
  };
}

export type VidsGenerateActivationResult = { href: string; ok: boolean; reason?: string; activationAttempted: boolean; activationCount: 0 | 1 };

/** Final exact prompt/reference/control check and at most one Generate click. */
export async function activateVidsGenerateInPage(input: {
  prompt: string;
  promptSha256: string;
  referenceSha256: string;
  referenceByteSize: number;
}): Promise<VidsGenerateActivationResult> {
  const href = location.href;
  const blocked = (reason: string): VidsGenerateActivationResult => ({ href, ok: false, reason, activationAttempted: false, activationCount: 0 });
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const name = (element: Element) => element.getAttribute("aria-label")?.trim() ?? "";
  const sidebars = [...document.querySelectorAll<HTMLElement>("[role='complementary']")].filter(visible).filter((element) => name(element) === "AI video clip");
  if (sidebars.length !== 1) return blocked(sidebars.length ? "ai_sidebar_ambiguous" : "ai_sidebar_missing");
  const sidebar = sidebars[0]!;
  const tabs = [...sidebar.querySelectorAll<HTMLElement>("[role='tab'][aria-selected='true']")].filter(visible).filter((element) => name(element) === "Animate");
  const panels = [...sidebar.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter(visible).filter((element) => name(element) === "Animate");
  if (tabs.length !== 1 || panels.length !== 1) return blocked("animate_panel_changed");
  const panel = panels[0]!;
  const previews = [...panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible);
  const removals = [...panel.querySelectorAll<HTMLButtonElement>("button[aria-label='Remove image']")].filter(visible);
  const inputs = [...panel.querySelectorAll<HTMLInputElement>("input[type='file']")];
  const editors = [...panel.querySelectorAll<HTMLElement>("div[role='textbox'][contenteditable='true'][aria-label='Add your image, then describe what should happen in your video.']")].filter(visible);
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button[aria-label='Generate']")].filter(visible);
  if (previews.length !== 1 || removals.length !== 1 || !previews[0]!.complete || previews[0]!.naturalWidth < 1) return blocked("reference_preview_changed");
  if (inputs.length !== 1 || inputs[0]!.files?.length !== 1) return blocked("reference_identity_proof_unavailable");
  const file = inputs[0]!.files![0]!;
  if (file.size !== input.referenceByteSize) return blocked("reference_file_metadata_mismatch");
  let referenceHash: string;
  try {
    const bytes = await file.arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    referenceHash = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  } catch { return blocked("reference_identity_proof_unavailable"); }
  if (referenceHash !== input.referenceSha256) return blocked("reference_identity_mismatch");
  if (editors.length !== 1) return blocked("prompt_editor_changed");
  const prompt = editors[0]!.innerText;
  if (prompt !== input.prompt) return blocked("prompt_readback_changed");
  const encoded = new TextEncoder().encode(prompt);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  const actualPromptHash = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actualPromptHash !== input.promptSha256) return blocked("prompt_hash_changed");
  if (buttons.length !== 1) return blocked(buttons.length ? "generate_control_ambiguous" : "generate_control_missing");
  const button = buttons[0]!;
  if (button.disabled || button.getAttribute("aria-disabled") === "true") return blocked("generate_disabled");
  let activationAttempted = true;
  try {
    button.click();
    return { href, ok: true, activationAttempted, activationCount: 1 };
  } catch {
    return { href, ok: false, reason: "generate_activation_delivery_uncertain", activationAttempted, activationCount: 1 };
  }
}
