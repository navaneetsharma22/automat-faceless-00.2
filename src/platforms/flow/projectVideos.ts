import { z } from "zod";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FlowProjectVideoCardSchema = z
  .object({
    observationFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    /** Exact DOM-owner binding for one scan/document; never persisted as clip identity. */
    nativeCardToken: z.string().uuid().optional(),
    assetId: z.string().uuid().optional(),
    assetStatus: z.enum(["unique", "missing", "ambiguous"]),
    title: z.string().max(200),
    thumbnail: z
      .object({
        available: z.boolean(),
        width: z.number().int().nonnegative().max(100_000).optional(),
        height: z.number().int().nonnegative().max(100_000).optional(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      })
      .strict(),
    routeStatus: z.enum(["none", "unique", "ambiguous", "mismatch"]),
    detailRoute: z
      .object({
        projectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        clipId: z.string().uuid(),
        detailUrl: z.string().url().max(2048),
      })
      .strict()
      .optional(),
  })
  .strict();

export const FlowProjectVideosPageResultSchema = z
  .object({
    status: z.enum(["ready", "blocked", "opened", "route"]),
    reason: z
      .enum([
        "project_missing",
        "project_ambiguous",
        "project_mismatch",
        "videos_section_not_selected",
        "gallery_unavailable",
        "card_missing",
        "card_ambiguous",
        "asset_identity_missing",
        "asset_identity_ambiguous",
        "route_ambiguous",
        "route_project_mismatch",
        "native_open_control_unavailable",
        "native_binding_stale",
      ])
      .optional(),
    projectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    cards: z.array(FlowProjectVideoCardSchema).max(200),
    cardsCapped: z.boolean(),
    scroll: z
      .object({
        containerFound: z.boolean(),
        top: z.number().int().nonnegative(),
        max: z.number().int().nonnegative(),
        moved: z.boolean(),
        atBottom: z.boolean(),
        busy: z.boolean(),
      })
      .strict(),
    card: FlowProjectVideoCardSchema.optional(),
  })
  .strict();

export type FlowProjectVideoCard = z.infer<typeof FlowProjectVideoCardSchema>;
export type FlowProjectVideosPageResult = z.infer<
  typeof FlowProjectVideosPageResultSchema
>;

export const FlowProjectVideosImportProgressSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    projectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
    scope: z.enum(["full_gallery", "one_card_check"]).optional(),
    status: z.enum([
      "idle",
      "scanning",
      "completed",
      "incomplete",
      "cancelled",
      "failed",
      "stopped",
    ]),
    discovered: z.number().int().nonnegative().max(200),
    imported: z.number().int().nonnegative().max(200),
    alreadyPresent: z.number().int().nonnegative().max(200),
    unresolved: z.number().int().nonnegative().max(200),
    scanCompleteness: z.enum(["pending", "complete", "incomplete"]),
    cancelRequested: z.boolean(),
    reason: z
      .enum([
        "bound_reached",
        "coverage_unproven",
        "identity_deduplication_unavailable",
        "one_card_check_complete",
        "cancelled",
        "connection_lost",
        "navigation_changed",
        "ambiguous_identity",
        "gallery_unavailable",
        "download_active",
      ])
      .optional(),
    failureReason: z
      .enum([
        "project_missing",
        "project_ambiguous",
        "project_mismatch",
        "videos_section_not_selected",
        "gallery_unavailable",
        "card_missing",
        "card_ambiguous",
        "asset_identity_missing",
        "asset_identity_ambiguous",
        "route_ambiguous",
        "route_project_mismatch",
        "native_open_control_unavailable",
        "native_binding_stale",
        "page_result_invalid",
        "page_injection_failed",
        "unexpected_page_status",
        "document_changed",
      ])
      .optional(),
    unresolvedCards: z
      .array(
        z
          .object({
            title: z.string().max(200),
            reason: z.string().regex(/^[a-z0-9_]{1,64}$/),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();

export type FlowProjectVideosImportProgress = z.infer<
  typeof FlowProjectVideosImportProgressSchema
>;

export function sanitizeFlowProjectVideoTitle(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (/https?:\/\/|[?&](?:token|signature|auth|key)=/i.test(normalized))
    return "";
  return normalized.slice(0, 200);
}

/** Reads loaded gallery cards and optionally scrolls one bounded viewport or opens one exact asset card. */
export async function inspectFlowProjectVideosInPage(input: {
  projectId: string;
  action: "start" | "snapshot" | "scroll" | "restore" | "open";
  scanId?: string;
  documentId?: string;
  assetId?: string;
  nativeCardToken?: string;
  scrollTop?: number;
  maxCards?: number;
}): Promise<unknown> {
  const blocked = (
    reason: NonNullable<FlowProjectVideosPageResult["reason"]>,
    cards: FlowProjectVideoCard[] = [],
  ) => ({
    status: "blocked",
    reason,
    projectId: input.projectId,
    cards: cards.slice(0, 200),
    cardsCapped: cards.length > 200,
    scroll: {
      containerFound: false,
      top: 0,
      max: 0,
      moved: false,
      atBottom: false,
      busy: false,
    },
  });
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
      style.visibility !== "hidden" &&
      style.visibility !== "collapse"
    );
  };
  const routeFromHref = (rawHref: string) => {
    try {
      const url = new URL(rawHref, location.href);
      if (url.hostname !== "flow.google.com") return undefined;
      if (url.protocol !== "https:" || url.username || url.password)
        return { kind: "mismatch" as const };
      const match =
        /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/edit\/(%?[0-9a-f-]+)\/?$/i.exec(
          url.pathname,
        );
      if (!match || !uuidPattern.test(decodeURIComponent(match[2]!)))
        return undefined;
      const projectId = match[1]!;
      if (projectId !== input.projectId)
        return { kind: "mismatch" as const };
      const clipId = decodeURIComponent(match[2]!).toLowerCase();
      return {
        kind: "route" as const,
        value: {
          projectId,
          clipId,
          detailUrl: `${url.origin}${url.pathname}`,
        },
      };
    } catch {
      return undefined;
    }
  };
  const projects = [...document.querySelectorAll<HTMLElement>("flow-project-page")].filter(visible);
  if (!projects.length) return blocked("project_missing");
  if (projects.length !== 1) return blocked("project_ambiguous");
  const project = projects[0]!;
  // Gallery actions are valid only on the project root, never on /edit/ detail routes.
  const projectRoute = /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/?$/i.exec(
    location.pathname,
  );
  if (!projectRoute || projectRoute[1] !== input.projectId)
    return blocked("project_mismatch");
  const initialLocation = location.href;
  const normalizedText = (value: string | null | undefined) =>
    (value ?? "").replace(/\s+/g, " ").trim();
  const accessibleName = (element: Element) => {
    const labelledBy = normalizedText(element.getAttribute("aria-labelledby"))
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    return normalizedText(element.getAttribute("aria-label") || labelledBy).toLowerCase();
  };
  const projectNavigation = () => {
    const roots = [...document.querySelectorAll<HTMLElement>('nav,[role="navigation"]')]
      .filter((root) => visible(root) && accessibleName(root) === "project navigation");
    return roots.length === 1 ? roots[0] : undefined;
  };
  const controlLabel = (control: HTMLElement) => {
    const ariaLabel = normalizedText(control.getAttribute("aria-label"));
    if (/^videos?$/i.test(ariaLabel)) return "videos";
    const nestedLabels = [...control.querySelectorAll<HTMLElement>("*")]
      .filter((child) => {
        if (!visible(child) || child.localName === "mat-icon") return false;
        return ![...child.classList].some((name) =>
          /^(?:material-icons|material-symbols(?:-outlined|-rounded|-sharp|-two-tone)?|mat-icon)$/i.test(name),
        );
      })
      .map((child) => normalizedText(child.textContent).toLowerCase())
      .filter((label) => label === "videos");
    if (nestedLabels.length) return "videos";
    const rendered = normalizedText(
      (control as HTMLElement & { innerText?: string }).innerText ?? control.textContent,
    ).toLowerCase();
    // Flow renders a ligature as visible text before the nested Videos label.
    return /^(?:videocam|movie|video_library)\s+videos?$/.test(rendered) || /^videos?$/.test(rendered)
      ? "videos"
      : "";
  };
  const resolveVideosNavigation = () => {
    const root = projectNavigation();
    if (!root) return { root: undefined, button: undefined, selected: false, ambiguous: false };
    const owners = new Set(
      [...root.querySelectorAll<HTMLElement>('button,[role="button"],[role="tab"],a')]
        .filter((control) => visible(control) && controlLabel(control) === "videos")
        .map((control) => control.closest<HTMLElement>('button,[role="button"],[role="tab"],a') ?? control),
    );
    if (owners.size !== 1)
      return { root, button: undefined, selected: false, ambiguous: owners.size > 1 };
    const button = [...owners][0]!;
    const ariaSelected =
      button.getAttribute("aria-current") === "page" ||
      button.getAttribute("aria-current") === "true" ||
      button.getAttribute("aria-selected") === "true" ||
      button.getAttribute("aria-pressed") === "true";
    return {
      root,
      button,
      selected: ariaSelected ||
        (button.localName === "button" && button.classList.contains("mdc-list-item--activated")),
      ambiguous: false,
    };
  };
  const galleryReady = () => {
    const scroller = project.closest<HTMLElement>(".cdk-virtual-scrollable.page-container");
    return Boolean(
      (scroller && visible(scroller)) ||
      project.querySelector("flow-gallery,flow-grid-tile-container,flow-video-tile"),
    );
  };
  const navigationFailure = async () => {
    const initialHref = location.href;
    let navigation = resolveVideosNavigation();
    if (!navigation.root || !navigation.button || navigation.ambiguous)
      return "videos_section_not_selected" as const;
    if (!navigation.selected) {
      if (navigation.button.localName !== "button")
        return "videos_section_not_selected" as const;
      navigation.button.click();
    }
    let stableReadyReads = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (location.href !== initialHref || !project.isConnected)
        return "project_mismatch" as const;
      navigation = resolveVideosNavigation();
      if (!navigation.root || !navigation.button || navigation.ambiguous)
        return "videos_section_not_selected" as const;
      if (navigation.selected && galleryReady()) stableReadyReads += 1;
      else stableReadyReads = 0;
      if (stableReadyReads >= 2) return undefined;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    return navigation.selected ? "gallery_unavailable" as const : "videos_section_not_selected" as const;
  };
  const shouldRestoreVideos = input.action === "start" || input.action === "restore";
  if (shouldRestoreVideos) {
    const failure = await navigationFailure();
    if (failure) return blocked(failure);
  }
  const selectedNavigation = resolveVideosNavigation();
  if (!selectedNavigation.root || !selectedNavigation.button || !selectedNavigation.selected)
    return blocked("videos_section_not_selected");

  type NativeBindingRegistry = {
    scope: string;
    byOwner: WeakMap<Element, string>;
    byToken: Map<string, Element>;
  };
  const expectedBindingScope = input.scanId && input.documentId
    ? `${input.scanId}:${input.documentId}`
    : undefined;
  const isolatedGlobal = globalThis as typeof globalThis & {
    __automatFlowNativeCardBindings?: NativeBindingRegistry;
  };
  let nativeBindings = isolatedGlobal.__automatFlowNativeCardBindings;
  if (
    !expectedBindingScope ||
    !nativeBindings ||
    nativeBindings.scope !== expectedBindingScope ||
    input.action === "start"
  ) {
    nativeBindings = expectedBindingScope
      ? {
          scope: expectedBindingScope,
          byOwner: new WeakMap<Element, string>(),
          byToken: new Map<string, Element>(),
        }
      : undefined;
    isolatedGlobal.__automatFlowNativeCardBindings = nativeBindings;
  }
  const bindNativeOwner = (owner: Element) => {
    const bindings = nativeBindings;
    if (!bindings) return undefined;
    const existing = bindings.byOwner.get(owner);
    if (existing) return existing;
    const token = crypto.randomUUID();
    bindings.byOwner.set(owner, token);
    bindings.byToken.set(token, owner);
    return token;
  };

  const excluded = (element: Element) =>
    element.closest(
      "nav,header,[role='navigation'],[role='dialog'],dialog,[aria-modal='true'],flow-base-prompt-box,[class*='avatar' i],[class*='profile' i],[class*='account' i]",
    ) !== null;
  const observedVideoCardOwner = (element: Element) =>
    element.matches('flow-grid-tile-container[role="group"]') &&
    Boolean(element.querySelector("flow-video-tile"));
  const safeCardClickTarget = (owner: Element) => {
    if (typeof document.elementFromPoint !== "function") return undefined;
    const rect = owner.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    const fractions = [0.5, 0.35, 0.65];
    for (const yFraction of fractions) {
      for (const xFraction of fractions) {
        const hit = document.elementFromPoint(
          rect.left + rect.width * xFraction,
          rect.top + rect.height * yFraction,
        );
        if (!hit || !owner.contains(hit)) continue;
        const nestedAction = hit.closest(
          "button,a,[role='button'],[role='menuitem'],[data-card-action]",
        );
        if (nestedAction && nestedAction !== owner) continue;
        if (excluded(hit)) continue;
        return hit as HTMLElement;
      }
    }
    return undefined;
  };
  const eligible = (element: Element) => {
    if (!project.contains(element) || !element.isConnected || excluded(element))
      return false;
    if (observedVideoCardOwner(element)) return true;
    const observedOwner = element.parentElement?.closest(
      'flow-grid-tile-container[role="group"]',
    );
    if (observedOwner && observedVideoCardOwner(observedOwner)) return false;
    const tag = element.localName.toLowerCase();
    return (
      tag === "flow-image-tile" ||
      ["listitem", "gridcell"].includes(element.getAttribute("role") ?? "") ||
      element.hasAttribute("data-result") ||
      element.hasAttribute("data-result-card") ||
      (tag.startsWith("flow-") && /result|tile|gallery|media/i.test(tag))
    );
  };
  const findCard = (element: Element | null): Element | undefined => {
    let current = element;
    while (current && current !== project) {
      if (eligible(current)) return current;
      current = current.parentElement;
    }
    return undefined;
  };
  const observedGroupOwners = [
    ...project.querySelectorAll('flow-grid-tile-container[role="group"]'),
  ];
  const verifiedVideoOwners = observedGroupOwners.filter(observedVideoCardOwner);
  const nativeVideoCardOwners = verifiedVideoOwners.filter(
    (owner) =>
      !verifiedVideoOwners.some(
        (nested) => nested !== owner && owner.contains(nested),
      ),
  );
  const fallbackCards = [...project.querySelectorAll("*")]
    .filter(eligible)
    .filter((card) => ![...card.querySelectorAll("*")].some(eligible));
  const cardOwners = observedGroupOwners.length ? nativeVideoCardOwners : fallbackCards;
  const cards = input.maxCards === 1 ? cardOwners.slice(0, 1) : cardOwners;
  const digest = async (value: string) => {
    try {
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`flow-project-video\n${input.projectId}\n${value}`),
      );
      return Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    } catch {
      return undefined;
    }
  };
  const readCard = async (card: Element): Promise<FlowProjectVideoCard> => {
    const images = [...card.querySelectorAll<HTMLImageElement>("img")].filter(
      (image) => !excluded(image) && findCard(image) === card,
    );
    const image = images.length === 1 && visible(images[0]!) ? images[0] : undefined;
    const media = [...card.querySelectorAll<HTMLElement>("img,video")].filter(
      (candidate) => !excluded(candidate) && findCard(candidate) === card,
    );
    const rawMediaUrls = media.flatMap((candidate) => {
      if (!visible(candidate)) return [];
      return candidate.localName === "video"
        ? [
            (candidate as HTMLVideoElement).currentSrc,
            (candidate as HTMLVideoElement).src,
            ...[...(candidate as HTMLVideoElement).querySelectorAll("source")].map(
              (source) => source.src,
            ),
          ]
        : [
            (candidate as HTMLImageElement).currentSrc,
            (candidate as HTMLImageElement).src,
          ];
    });
    const safeMediaPaths = rawMediaUrls.flatMap((rawUrl) => {
        if (!rawUrl) return [];
        try {
          const url = new URL(rawUrl);
          return url.protocol === "https:" &&
            ["flow-content.google", "storage.googleapis.com"].includes(url.hostname) &&
            !url.username && !url.password
            ? [`${url.origin}${url.pathname}`]
            : [];
        } catch {
          return [];
        }
    });
    // This hash is only a short-lived traversal handle. It is neither persisted
    // nor trusted as a clip or Gallery asset identity; query strings are omitted.
    const observationSource = [...new Set(safeMediaPaths)].sort().join("\n");
    let thumbnailSourceKey = "";
    let width: number | undefined;
    let height: number | undefined;
    if (image) {
      try {
        const url = new URL(image.currentSrc || image.src);
        if (
          url.protocol === "https:" &&
          ["flow-content.google", "storage.googleapis.com"].includes(url.hostname) &&
          !url.username &&
          !url.password
        ) {
          thumbnailSourceKey = `${url.origin}${url.pathname}`;
          width = Math.max(0, Math.round(image.naturalWidth || image.clientWidth));
          height = Math.max(0, Math.round(image.naturalHeight || image.clientHeight));
        }
      } catch {
        thumbnailSourceKey = "";
      }
    }
    const assetIds = [
      ...new Set(
        safeMediaPaths.flatMap(
          (path) =>
            path.match(
              /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
            )?.map((id) => id.toLowerCase()) ?? [],
        ),
      ),
    ];
    const routes = [...card.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .filter((anchor) => !excluded(anchor) && visible(anchor))
      .map((anchor) => routeFromHref(anchor.href))
      .filter((route): route is NonNullable<typeof route> => Boolean(route));
    const uniqueRoutes = new Map(
      routes
        .filter((route) => route.kind === "route")
        .map((route) => [route.value.detailUrl, route.value]),
    );
    const routeMismatch = routes.some((route) => route.kind === "mismatch");
    const routeStatus = routeMismatch
      ? "mismatch"
      : uniqueRoutes.size > 1
        ? "ambiguous"
        : uniqueRoutes.size === 1
          ? "unique"
          : "none";
    const heading = card.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6");
    const rawTitle = card.getAttribute("aria-label") || heading?.textContent || "";
    const normalizedTitle = rawTitle.replace(/\s+/g, " ").trim();
    const title = /https?:\/\/|[?&](?:token|signature|auth|key)=/i.test(normalizedTitle)
      ? ""
      : normalizedTitle.slice(0, 200);
    const observationFingerprint = observationSource
      ? await digest(observationSource)
      : undefined;
    const nativeCardToken = assetIds.length !== 1
      ? bindNativeOwner(card)
      : undefined;
    const thumbnailFingerprint = thumbnailSourceKey
      ? await digest(`thumbnail\n${thumbnailSourceKey}`)
      : undefined;
    return {
      ...(observationFingerprint ? { observationFingerprint } : {}),
      ...(nativeCardToken ? { nativeCardToken } : {}),
      ...(assetIds.length === 1 ? { assetId: assetIds[0] } : {}),
      assetStatus:
        assetIds.length === 1
          ? "unique"
          : assetIds.length > 1
            ? "ambiguous"
            : "missing",
      title,
      thumbnail: {
        available: Boolean(image && thumbnailSourceKey),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(thumbnailFingerprint ? { fingerprint: thumbnailFingerprint } : {}),
      },
      routeStatus,
      ...(uniqueRoutes.size === 1
        ? { detailRoute: [...uniqueRoutes.values()][0] }
        : {}),
    };
  };
  const snapshots = await Promise.all(cards.map(readCard));
  if (location.href !== initialLocation || !project.isConnected)
    return blocked("project_mismatch", snapshots);
  const selectedNavigationAfterRead = resolveVideosNavigation();
  if (
    !selectedNavigationAfterRead.root ||
    !selectedNavigationAfterRead.button ||
    !selectedNavigationAfterRead.selected ||
    cards.some((card) => !card.isConnected || findCard(card) !== card)
  )
    return blocked("videos_section_not_selected", snapshots);
  const observedScrollAncestor = project.closest<HTMLElement>(
    ".cdk-virtual-scrollable.page-container",
  );
  const scrollables = [
    document.scrollingElement,
    observedScrollAncestor,
    ...project.querySelectorAll<HTMLElement>("*"),
  ].filter((element): element is HTMLElement => {
    if (
      !element ||
      (!project.contains(element) &&
        element !== document.scrollingElement &&
        element !== observedScrollAncestor)
    )
      return false;
    const style = getComputedStyle(element);
    return (
      element.scrollHeight > element.clientHeight + 2 &&
      ["auto", "scroll", "overlay"].includes(style.overflowY)
    );
  });
  const scrollTarget = observedScrollAncestor &&
    scrollables.includes(observedScrollAncestor)
      ? observedScrollAncestor
      : scrollables.sort(
          (left, right) => right.scrollHeight - left.scrollHeight,
        )[0];
  const topBefore = scrollTarget?.scrollTop ?? 0;
  const maxBefore = scrollTarget
    ? Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight)
    : 0;
  let moved = false;
  if (input.action === "start" && scrollTarget && topBefore > 0) {
    scrollTarget.scrollTop = 0;
    moved = scrollTarget.scrollTop < topBefore;
  }
  if (input.action === "scroll" && scrollTarget && topBefore < maxBefore) {
    scrollTarget.scrollTop = Math.min(
      maxBefore,
      topBefore + Math.max(240, Math.floor(scrollTarget.clientHeight * 0.75)),
    );
    moved = scrollTarget.scrollTop > topBefore;
  }
  if (input.action === "restore") {
    if (!scrollTarget || !Number.isFinite(input.scrollTop) || input.scrollTop! < 0)
      return blocked("gallery_unavailable", snapshots);
    scrollTarget.scrollTop = Math.min(maxBefore, Math.floor(input.scrollTop!));
    moved = scrollTarget.scrollTop !== topBefore;
  }
  const top = scrollTarget?.scrollTop ?? 0;
  const max = scrollTarget
    ? Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight)
    : 0;
  const busy = Boolean(
    project.querySelector('[aria-busy="true"], [role="progressbar"]'),
  );
  if (input.action === "open") {
    const nativeNavigation = Boolean(input.nativeCardToken);
    if (
      nativeNavigation
        ? !uuidPattern.test(input.nativeCardToken ?? "")
        : !input.assetId || !uuidPattern.test(input.assetId)
    )
      return blocked("asset_identity_missing", snapshots);
    const matches = snapshots.filter((card) => nativeNavigation
      ? card.nativeCardToken === input.nativeCardToken
      : card.assetId === input.assetId);
    if (!matches.length)
      return blocked(nativeNavigation ? "native_binding_stale" : "card_missing", snapshots);
    if (matches.length !== 1)
      return blocked("card_ambiguous", snapshots);
    const card = matches[0]!;
    if (card.routeStatus === "ambiguous")
      return blocked("route_ambiguous", snapshots);
    if (card.routeStatus === "mismatch")
      return blocked("route_project_mismatch", snapshots);
    if (!nativeNavigation && card.routeStatus === "unique")
      return {
        status: "route",
        projectId: input.projectId,
        cards: snapshots.slice(0, 200),
        cardsCapped: snapshots.length > 200,
        scroll: { containerFound: Boolean(scrollTarget), top, max, moved, atBottom: Boolean(scrollTarget && top >= max), busy },
        card,
      };
    const bindingsForOpen = nativeBindings;
    let boundOwner: Element | undefined;
    if (
      nativeNavigation &&
      bindingsForOpen &&
      bindingsForOpen.scope === expectedBindingScope
    )
      boundOwner = bindingsForOpen.byToken.get(input.nativeCardToken!);
    if (
      nativeNavigation &&
      (!boundOwner ||
        !boundOwner.isConnected ||
        !project.contains(boundOwner) ||
        !observedVideoCardOwner(boundOwner) ||
        findCard(boundOwner) !== boundOwner)
    )
      return blocked("native_binding_stale", snapshots);
    const cardElement = nativeNavigation
      ? boundOwner!
      : cards[snapshots.indexOf(card)]!;
    if (observedVideoCardOwner(cardElement)) {
      const clickTarget = nativeNavigation
        ? safeCardClickTarget(cardElement)
        : cardElement as HTMLElement;
      if (!clickTarget)
        return blocked("native_open_control_unavailable", snapshots);
      if (
        nativeNavigation &&
        (!cardElement.isConnected ||
          !project.contains(cardElement) ||
          findCard(cardElement) !== cardElement)
      )
        return blocked("native_binding_stale", snapshots);
      clickTarget.click();
      return {
        status: "opened",
        projectId: input.projectId,
        cards: snapshots.slice(0, 200),
        cardsCapped: snapshots.length > 200,
        scroll: { containerFound: Boolean(scrollTarget), top, max, moved, atBottom: Boolean(scrollTarget && top >= max), busy },
        card,
      };
    }
    if (nativeNavigation)
      return blocked("native_open_control_unavailable", snapshots);
    const controls = [
      ...(cardElement.matches("button,[role='button']") ? [cardElement] : []),
      ...cardElement.querySelectorAll<HTMLElement>("button,[role='button']"),
      ...cardElement.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ].filter((control) => {
      if (!visible(control) || excluded(control)) return false;
      const name = [
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.textContent,
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (/(download|delete|remove|share|favorite|favourite|more options|more actions|menu)/i.test(name))
        return false;
      if (/^(open|view|play)(?:\s|$)/i.test(name)) return true;
      return (
        control === cardElement &&
        (control.localName === "button" || control.getAttribute("role") === "button")
      );
    });
    const uniqueControls = [...new Set(controls)];
    if (uniqueControls.length !== 1)
      return blocked("native_open_control_unavailable", snapshots);
    (uniqueControls[0] as HTMLElement).click();
    return {
      status: "opened",
      projectId: input.projectId,
      cards: snapshots.slice(0, 200),
      cardsCapped: snapshots.length > 200,
      scroll: { containerFound: Boolean(scrollTarget), top, max, moved, atBottom: Boolean(scrollTarget && top >= max), busy },
      card,
    };
  }
  return {
    status: "ready",
    projectId: input.projectId,
    cards: snapshots.slice(0, 200),
    cardsCapped: snapshots.length > 200,
    scroll: {
      containerFound: Boolean(scrollTarget),
      top,
      max,
      moved,
      atBottom: Boolean(scrollTarget && top >= max),
      busy,
    },
  };
}
