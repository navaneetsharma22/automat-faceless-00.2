type MenuInspectionBlocker =
  | "detail_route_missing_or_changed"
  | "detail_download_control_not_found"
  | "detail_download_control_ambiguous"
  | "detail_menu_not_open"
  | "detail_menu_binding_unresolved"
  | "quality_option_not_found_in_detail_menu"
  | "quality_option_ambiguous_in_detail_menu"
  | "quality_option_disabled_in_detail_menu";

/** Recognize the quality item only through the open menu controlled by this page's Download media control. */
export function inspectFlowClipDownloadMenuInPage(
  expectedProjectId: string,
  expectedClipId: string,
  currentHref = location.href,
): unknown {
  const blocked = (blocker: MenuInspectionBlocker) => ({
    status: "blocked" as const,
    blocker,
  });
  let route: URL;
  try {
    route = new URL(currentHref);
  } catch {
    return blocked("detail_route_missing_or_changed");
  }
  const match =
    route.protocol === "https:" &&
    route.hostname === "flow.google.com" &&
    !route.username &&
    !route.password
      ? /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/edit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
          route.pathname,
        )
      : null;
  if (
    !match ||
    match[1] !== expectedProjectId ||
    match[2]!.toLowerCase() !== expectedClipId.toLowerCase()
  )
    return blocked("detail_route_missing_or_changed");

  const visible = (element: Element) => {
    if (!element.isConnected) return false;
    let current: Element | null = element;
    while (current) {
      if (
        (current as HTMLElement).hidden ||
        current.getAttribute("aria-hidden") === "true"
      )
        return false;
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
      current = current.parentElement;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const normalized = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const accessibleText = (element: HTMLElement) =>
    normalized(
      `${element.getAttribute("aria-label") ?? ""} ${element.innerText ?? element.textContent ?? ""}`,
    );
  const downloadControls = [
    ...document.querySelectorAll<HTMLElement>(
      'button, [role="button"], [role="menuitem"]',
    ),
  ].filter(
    (element) =>
      visible(element) && accessibleText(element).includes("downloadmedia"),
  );
  if (!downloadControls.length)
    return blocked("detail_download_control_not_found");
  if (downloadControls.length !== 1)
    return blocked("detail_download_control_ambiguous");

  const trigger = downloadControls[0]!;
  const controlledIds = (trigger.getAttribute("aria-controls") ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (controlledIds.length !== 1)
    return blocked("detail_menu_binding_unresolved");
  if (trigger.getAttribute("aria-expanded") === "false")
    return blocked("detail_menu_not_open");
  const controlledMenus = [
    ...document.querySelectorAll<HTMLElement>("[id]"),
  ].filter((element) => element.id === controlledIds[0]);
  if (controlledMenus.length !== 1)
    return blocked("detail_menu_binding_unresolved");
  const menu = controlledMenus[0]!;
  if (!visible(menu)) return blocked("detail_menu_not_open");

  const qualityOptions = [
    ...menu.querySelectorAll<HTMLElement>(
      'button, [role="button"], [role="menuitem"]',
    ),
  ].filter((element) => accessibleText(element).includes("1080pupscaled"));
  if (!qualityOptions.length)
    return blocked("quality_option_not_found_in_detail_menu");
  if (qualityOptions.length !== 1)
    return blocked("quality_option_ambiguous_in_detail_menu");
  const option = qualityOptions[0]!;
  const enabled =
    !option.matches(":disabled") &&
    option.getAttribute("aria-disabled") !== "true";
  if (!enabled) return blocked("quality_option_disabled_in_detail_menu");

  return {
    status: "recognized" as const,
    menuBoundToDownloadMedia: true,
    qualityOptionObserved: true,
    qualityOptionEnabled: true,
  };
}
