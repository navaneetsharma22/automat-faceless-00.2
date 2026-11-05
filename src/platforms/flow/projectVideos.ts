import { z } from "zod";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FlowProjectVideoCardSchema = z
  .object({
    observationFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    /** In-memory traversal handle only; never used as a clip identity or persisted. */
    nativeTraversalFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
  assetId?: string;
  nativeTraversalFingerprint?: string;
  scrollTop?: number;
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

  const excluded = (element: Element) =>
    element.closest(
      "nav,header,[role='navigation'],[role='dialog'],dialog,[aria-modal='true'],flow-base-prompt-box,[class*='avatar' i],[class*='profile' i],[class*='account' i]",
    ) !== null;
  const observedVideoCardOwner = (element: Element) =>
    element.matches('flow-grid-tile-container[role="group"]') &&
    Boolean(element.querySelector("flow-video-tile"));
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
  const cards = observedGroupOwners.length ? nativeVideoCardOwners : fallbackCards;
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
    const traversalPaths = rawMediaUrls.flatMap((rawUrl) => {
      if (!rawUrl) return [];
      try {
        const url = new URL(rawUrl);
        return ["https:", "http:"].includes(url.protocol) &&
          !url.username && !url.password
          ? [`${url.origin}${url.pathname}`]
          : [];
      } catch {
        return [];
      }
    });
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
    const traversalSource = [...new Set(traversalPaths)].sort().join("\n");
    const traversalScroller = project.closest<HTMLElement>(
      ".cdk-virtual-scrollable.page-container",
    );
    const ownerRect = card.getBoundingClientRect();
    const scrollRect = traversalScroller?.getBoundingClientRect();
    const transientOwnerOffset = traversalScroller && scrollRect
      ? `${Math.round(ownerRect.top - scrollRect.top + traversalScroller.scrollTop)}:${Math.round(ownerRect.left - scrollRect.left)}`
      : "no-observed-scroll-offset";
    const nativeTraversalFingerprint = traversalSource
      ? await digest(`native-traversal\n${traversalSource}\n${transientOwnerOffset}`)
      : undefined;
    const thumbnailFingerprint = thumbnailSourceKey
      ? await digest(`thumbnail\n${thumbnailSourceKey}`)
      : undefined;
    return {
      ...(observationFingerprint ? { observationFingerprint } : {}),
      ...(assetIds.length !== 1 && nativeTraversalFingerprint
        ? { nativeTraversalFingerprint }
        : {}),
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
    const nativeTraversal = Boolean(input.nativeTraversalFingerprint);
    if (
      nativeTraversal
        ? !/^[a-f0-9]{64}$/i.test(input.nativeTraversalFingerprint ?? "")
        : !input.assetId || !uuidPattern.test(input.assetId)
    )
      return blocked("asset_identity_missing", snapshots);
    const matches = snapshots.filter((card) => nativeTraversal
      ? card.nativeTraversalFingerprint === input.nativeTraversalFingerprint
      : card.assetId === input.assetId);
    if (!matches.length) return blocked("card_missing", snapshots);
    if (matches.length !== 1)
      return blocked("card_ambiguous", snapshots);
    const card = matches[0]!;
    if (card.routeStatus === "ambiguous")
      return blocked("route_ambiguous", snapshots);
    if (card.routeStatus === "mismatch")
      return blocked("route_project_mismatch", snapshots);
    if (!nativeTraversal && card.routeStatus === "unique")
      return {
        status: "route",
        projectId: input.projectId,
        cards: snapshots.slice(0, 200),
        cardsCapped: snapshots.length > 200,
        scroll: { containerFound: Boolean(scrollTarget), top, max, moved, atBottom: Boolean(scrollTarget && top >= max), busy },
        card,
      };
    const cardElement = cards[snapshots.indexOf(card)]!;
    if (observedVideoCardOwner(cardElement)) {
      (cardElement as HTMLElement).click();
      return {
        status: "opened",
        projectId: input.projectId,
        cards: snapshots.slice(0, 200),
        cardsCapped: snapshots.length > 200,
        scroll: { containerFound: Boolean(scrollTarget), top, max, moved, atBottom: Boolean(scrollTarget && top >= max), busy },
        card,
      };
    }
    if (nativeTraversal)
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
