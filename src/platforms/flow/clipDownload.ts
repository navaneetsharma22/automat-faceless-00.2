import { z } from "zod";

export const FlowClipAssetIdentitySchema = z
  .object({
    status: z.literal("identity"),
    assetId: z.string().uuid(),
  })
  .strict();

export const FlowClipDownloadPointSchema = z
  .object({
    status: z.literal("ready"),
    assetId: z.string().uuid(),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
  })
  .strict();

/** Runs in the verified document. Only opening the native menu mutates the page. */
export async function prepareFlowClipDownloadInPage(
  projectId: string,
  clipId: string,
  expectedAssetId: string | null = null,
  openMenu = false,
  identityOnly = false,
): Promise<unknown> {
  const blocked = (reason: string) => ({ status: "blocked", reason });
  const routeMatches = () => {
    const url = new URL(location.href);
    const route = /^\/(?:u\/\d+\/)?project\/([^/]+)\/edit\/([^/]+)\/?$/.exec(
      url.pathname,
    );
    return (
      url.origin === "https://flow.google.com" &&
      route?.[1] === projectId &&
      route[2]?.toLowerCase() === clipId.toLowerCase()
    );
  };
  const visible = (element: Element) => {
    if (
      !element.isConnected ||
      element.closest('[hidden],[aria-hidden="true"]')
    )
      return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };
  const selectedAsset = (): { assetId?: string; reason?: string } => {
    const buttons = [
      ...document.querySelectorAll(
        'flow-navigation-rail-thumbnail button[aria-current="true"]',
      ),
    ].filter(visible);
    if (!buttons.length)
      return { reason: "flow_clip_selected_rail_missing" as const };
    if (buttons.length !== 1)
      return { reason: "flow_clip_selected_rail_ambiguous" as const };
    const images = [...buttons[0]!.querySelectorAll<HTMLImageElement>("img")];
    if (!images.length)
      return { reason: "flow_clip_selected_thumbnail_missing" as const };
    if (images.length !== 1)
      return { reason: "flow_clip_selected_thumbnail_ambiguous" as const };
    try {
      const imageUrl = new URL(images[0]!.currentSrc || images[0]!.src);
      if (
        imageUrl.protocol !== "https:" ||
        imageUrl.username ||
        imageUrl.password
      )
        return { reason: "flow_clip_selected_asset_source_invalid" as const };
      if (
        !["storage.googleapis.com", "flow-content.google"].includes(
          imageUrl.hostname,
        )
      )
        return { reason: "flow_clip_selected_asset_source_invalid" };
      const ids = [
        ...new Set(
          imageUrl.pathname
            .match(
              /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
            )
            ?.map((id) => id.toLowerCase()) ?? [],
        ),
      ];
      if (!ids.length)
        return { reason: "flow_clip_selected_asset_id_missing" as const };
      if (ids.length !== 1)
        return { reason: "flow_clip_selected_asset_id_ambiguous" as const };
      return { assetId: ids[0]! };
    } catch {
      return { reason: "flow_clip_selected_asset_source_invalid" as const };
    }
  };
  if (!routeMatches()) return blocked("flow_clip_detail_route_mismatch");
  const selected = selectedAsset();
  if (!selected.assetId)
    return blocked(
      identityOnly
        ? selected.reason ?? "flow_clip_selected_asset_unavailable"
        : "flow_clip_selected_asset_unavailable",
    );
  const assetId = selected.assetId;
  if (expectedAssetId && assetId !== expectedAssetId)
    return blocked("flow_clip_selected_asset_changed");

  if (identityOnly) return { status: "identity", assetId };

  const controls = [
    ...document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Download media"]',
    ),
  ].filter(visible);
  if (controls.length !== 1 || controls[0]!.disabled)
    return blocked("flow_clip_download_control_unavailable");
  const trigger = controls[0]!;
  if (openMenu && trigger.getAttribute("aria-expanded") !== "true")
    trigger.click();

  const findPoint = () => {
    if (!routeMatches() || selectedAsset().assetId !== assetId)
      return blocked("flow_clip_selected_asset_changed");
    if (
      !trigger.isConnected ||
      trigger.getAttribute("aria-expanded") !== "true"
    )
      return undefined;
    const ids = (trigger.getAttribute("aria-controls") ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length !== 1) return undefined;
    const menus = [...document.querySelectorAll('[role="menu"][id]')].filter(
      (element) => element.id === ids[0] && visible(element),
    );
    if (menus.length !== 1) return undefined;
    const options = [
      ...menus[0]!.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].filter(
      (element) =>
        element.textContent?.replace(/\s+/g, " ").trim().toLowerCase() ===
        "1080p upscaled",
    );
    if (options.length !== 1) return undefined;
    const option = options[0]!;
    if (
      !visible(option) ||
      option.matches(":disabled") ||
      option.getAttribute("aria-disabled") === "true"
    )
      return blocked("flow_clip_1080p_unavailable");
    const rect = option.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (
      x < 0 ||
      y < 0 ||
      x >= innerWidth ||
      y >= innerHeight ||
      !hit ||
      !option.contains(hit)
    )
      return blocked("flow_clip_quality_obscured");
    return { status: "ready", assetId, x, y };
  };
  const ready = findPoint();
  if (ready || !openMenu)
    return ready ?? blocked("flow_detail_download_menu_not_ready");
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const point = findPoint();
      if (point) {
        observer.disconnect();
        clearTimeout(timeout);
        resolve(point);
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      resolve(blocked("flow_detail_download_menu_not_ready"));
    }, 2000);
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
}
