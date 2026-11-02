export type VidsComposerInspection = {
  href: string;
  state: "ready" | "existing_preview_unbound" | "missing" | "ambiguous";
  reason?: string;
  sidebarCount: number;
  panelCount: number;
  fileInputCount: number;
  addImageCount: number;
  previewCount: number;
  removalControlCount: number;
  previewLoaded?: boolean;
  previewWidth?: number;
  previewHeight?: number;
};

/** Read only; selectors are scoped to the observed AI video clip/Animate panel. */
export function inspectVidsAiComposerInPage(): VidsComposerInspection {
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.isConnected && rect.width > 0 && rect.height > 0 &&
      style.display !== "none" && style.visibility !== "hidden";
  };
  const accessibleName = (element: Element) => {
    const ariaLabel = element.getAttribute("aria-label")?.trim();
    if (ariaLabel) return ariaLabel;
    const labelledBy = element.getAttribute("aria-labelledby")?.trim();
    if (labelledBy) return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
    return element.getAttribute("title")?.trim() ?? "";
  };
  const sidebars = [...document.querySelectorAll<HTMLElement>("[role='complementary']")]
    .filter(visible).filter((element) => accessibleName(element) === "AI video clip");
  const base = { href: location.href, sidebarCount: sidebars.length, panelCount: 0, fileInputCount: 0, addImageCount: 0, previewCount: 0, removalControlCount: 0 };
  if (!sidebars.length) return { ...base, state: "missing", reason: "ai_sidebar_missing" };
  if (sidebars.length !== 1) return { ...base, state: "ambiguous", reason: "ai_sidebar_ambiguous" };
  const sidebar = sidebars[0]!;
  const selectedTabs = [...sidebar.querySelectorAll<HTMLElement>("[role='tab'][aria-selected='true']")]
    .filter(visible).filter((tab) => accessibleName(tab) === "Animate");
  if (selectedTabs.length !== 1) return { ...base, state: selectedTabs.length ? "ambiguous" : "missing", reason: selectedTabs.length ? "animate_tab_ambiguous" : "animate_tab_not_selected" };
  const panels = [...sidebar.querySelectorAll<HTMLElement>("[role='tabpanel']")]
    .filter(visible).filter((panel) => accessibleName(panel) === "Animate");
  if (panels.length !== 1) return { ...base, panelCount: panels.length, state: panels.length ? "ambiguous" : "missing", reason: panels.length ? "animate_panel_ambiguous" : "animate_panel_missing" };
  const panel = panels[0]!;
  const fileInputs = [...panel.querySelectorAll<HTMLInputElement>("input[type='file']")];
  const addImage = [...panel.querySelectorAll<HTMLButtonElement>("button")]
    .filter(visible).filter((button) => accessibleName(button) === "Add image");
  const previews = [...panel.querySelectorAll<HTMLImageElement>("img[alt='Uploaded image preview']")].filter(visible);
  const removals = [...panel.querySelectorAll<HTMLButtonElement>("button[aria-label='Remove image']")].filter(visible);
  const result = { ...base, panelCount: panels.length, fileInputCount: fileInputs.length, addImageCount: addImage.length, previewCount: previews.length, removalControlCount: removals.length };
  if (previews.length) {
    const preview = previews[0]!;
    return { ...result, state: "existing_preview_unbound", reason: previews.length === 1 ? "existing_preview_unbound" : "preview_ambiguous", previewLoaded: preview.complete && preview.naturalWidth > 0 && preview.naturalHeight > 0, previewWidth: preview.naturalWidth, previewHeight: preview.naturalHeight };
  }
  if (fileInputs.length !== 1 || addImage.length !== 1) return { ...result, state: "missing", reason: fileInputs.length > 1 || addImage.length > 1 ? "image_input_ambiguous" : "image_input_unavailable" };
  const input = fileInputs[0]!;
  const accept = input.accept.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean).sort();
  if (input.multiple || accept.join(",") !== "image/jpeg,image/png") return { ...result, state: "missing", reason: "image_input_contract_unsupported" };
  return { ...result, state: "ready" };
}
