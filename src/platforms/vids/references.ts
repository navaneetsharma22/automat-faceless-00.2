export type VidsUploadInPageResult = {
  ok: boolean;
  submitted?: boolean;
  reason?: string;
  href: string;
  previewLoaded?: boolean;
  previewWidth?: number;
  previewHeight?: number;
  removalControlPresent?: boolean;
};

/**
 * Exact-byte file-input upload. This function is self-contained because Chrome
 * serializes it into the verified Vids document with scripting.executeScript.
 * It never reads provider settings, prompt content, or any unrelated editor.
 */
export async function uploadVidsReferenceInPage(input: {
  base64: string;
  mimeType: "image/png" | "image/jpeg";
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  timeoutMs: number;
}): Promise<VidsUploadInPageResult> {
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
  const sidebars = [...document.querySelectorAll<HTMLElement>("[role='complementary']")].filter(visible).filter((element) => name(element) === "AI video clip");
  if (sidebars.length !== 1) return { ok: false, reason: sidebars.length ? "ai_sidebar_ambiguous" : "ai_sidebar_missing", href };
  const sidebar = sidebars[0]!;
  const tabs = [...sidebar.querySelectorAll<HTMLElement>("[role='tab'][aria-selected='true']")].filter(visible).filter((element) => name(element) === "Animate");
  if (tabs.length !== 1) return { ok: false, reason: tabs.length ? "animate_tab_ambiguous" : "animate_tab_not_selected", href };
  const panels = [...sidebar.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter(visible).filter((element) => name(element) === "Animate");
  if (panels.length !== 1) return { ok: false, reason: panels.length ? "animate_panel_ambiguous" : "animate_panel_missing", href };
  const panel = panels[0]!;
  const previews = [...panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible);
  if (previews.length) return { ok: false, reason: previews.length === 1 ? "existing_preview_unbound" : "preview_ambiguous", href };
  const inputs = [...panel.querySelectorAll<HTMLInputElement>("input[type='file']")];
  const addButtons = [...panel.querySelectorAll<HTMLButtonElement>("button")].filter(visible).filter((button) => name(button) === "Add image");
  if (inputs.length !== 1 || addButtons.length !== 1) return { ok: false, reason: inputs.length > 1 || addButtons.length > 1 ? "image_input_ambiguous" : "image_input_unavailable", href };
  const fileInput = inputs[0]!;
  const accepted = fileInput.accept.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean).sort().join(",");
  if (fileInput.multiple || accepted !== "image/jpeg,image/png" || !["image/png", "image/jpeg"].includes(input.mimeType) || input.byteSize < 1 || input.byteSize > 12 * 1024 * 1024) return { ok: false, reason: "image_input_contract_unsupported", href };
  let bytes: Uint8Array;
  try {
    const binary = atob(input.base64);
    if (binary.length !== input.byteSize) return { ok: false, reason: "reference_payload_invalid", href };
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return { ok: false, reason: "reference_payload_invalid", href };
  }
  const signatureOk = input.mimeType === "image/png"
    ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!signatureOk) return { ok: false, reason: "reference_format_invalid", href };
  const exactBytes = bytes.slice().buffer as ArrayBuffer;
  try {
    const image = await createImageBitmap(new Blob([exactBytes], { type: input.mimeType }));
    const dimensionsMatch = image.width === input.width && image.height === input.height && image.width * image.height <= 40_000_000;
    image.close();
    if (!dimensionsMatch) return { ok: false, reason: "reference_dimensions_mismatch", href };
  } catch {
    return { ok: false, reason: "reference_decode_failed", href };
  }
  let file: File;
  let transfer: DataTransfer;
  try {
    file = new File([exactBytes], input.mimeType === "image/png" ? "prepared-reference.png" : "prepared-reference.jpg", { type: input.mimeType, lastModified: 0 });
    transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
  } catch {
    return { ok: false, reason: "file_input_assignment_unsupported", href };
  }
  if (fileInput.files?.length !== 1 || fileInput.files[0]?.size !== input.byteSize || fileInput.files[0]?.type !== input.mimeType) return { ok: false, reason: "file_input_assignment_failed", href };
  try {
    const fileBytes = await fileInput.files[0]!.arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes));
    const fileSha256 = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
    if (fileSha256 !== input.sha256) return { ok: false, reason: "file_input_hash_mismatch", href };
  } catch {
    return { ok: false, reason: "file_input_hash_unavailable", href };
  }
  try {
    fileInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  } catch {
    return { ok: false, submitted: true, reason: "upload_event_delivery_uncertain", href };
  }
  const deadline = Date.now() + Math.max(1_000, Math.min(input.timeoutMs, 30_000));
  while (Date.now() < deadline) {
    const currentSidebars = [...document.querySelectorAll<HTMLElement>("[role='complementary']")].filter(visible).filter((element) => name(element) === "AI video clip");
    if (currentSidebars.length !== 1) return { ok: false, submitted: true, reason: "ai_sidebar_changed_after_upload", href };
    const currentPanels = [...currentSidebars[0]!.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter(visible).filter((element) => name(element) === "Animate");
    if (currentPanels.length !== 1) return { ok: false, submitted: true, reason: "animate_panel_changed_after_upload", href };
    const currentPanel = currentPanels[0]!;
    const alerts = [...currentPanel.querySelectorAll<HTMLElement>("[role='alert']")].filter(visible);
    if (alerts.length) return { ok: false, submitted: true, reason: "upload_error", href };
    const currentPreviews = [...currentPanel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible);
    if (currentPreviews.length > 1) return { ok: false, submitted: true, reason: "preview_ambiguous", href };
    if (currentPreviews.length === 1) {
      const preview = currentPreviews[0]!;
      const removals = [...currentPanel.querySelectorAll<HTMLButtonElement>("button[aria-label='Remove image']")].filter(visible);
      if (preview.complete && preview.naturalWidth > 0 && preview.naturalHeight > 0 && removals.length === 1) {
        if (preview.naturalWidth !== input.width || preview.naturalHeight !== input.height)
          return { ok: false, submitted: true, reason: "uploaded_preview_dimensions_mismatch", href };
        return { ok: true, submitted: true, href, previewLoaded: true, previewWidth: preview.naturalWidth, previewHeight: preview.naturalHeight, removalControlPresent: true };
      }
      if (removals.length > 1) return { ok: false, submitted: true, reason: "remove_control_ambiguous", href };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { ok: false, submitted: true, reason: "uploaded_preview_timeout", href };
}
