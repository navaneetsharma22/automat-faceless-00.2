/** Read only inventory of visible detail controls; does not click or fetch media. */
export function inspectFlowClipDownloadControlsInPage(): unknown {
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      element.isConnected &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.pointerEvents !== "none"
    );
  };
  const label = (element: Element) =>
    (element.getAttribute("aria-label") || element.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120)
      .toLowerCase();
  const controls = [...document.querySelectorAll<HTMLElement>(
    'button, [role="button"], [role="menuitem"]',
  )].filter(visible);
  const downloadMediaCount = controls.filter((element) =>
    /\bdownload media\b/.test(label(element)),
  ).length;
  const explicit1080pCount = controls.filter((element) =>
    /\b1080p\b/.test(label(element)),
  ).length;
  return {
    downloadMediaControlCount: Math.min(downloadMediaCount, 20),
    explicit1080pControlCount: Math.min(explicit1080pCount, 20),
  };
}
