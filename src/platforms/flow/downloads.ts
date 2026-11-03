import { z } from "zod";
import { sha256Hex } from "../../domain/batches/hashPrompt";

export const FLOW_GALLERY_DIAGNOSTIC_TTL_MS = 20 * 60 * 1000;
export const FLOW_GALLERY_DIAGNOSTIC_ALARM =
  "automat-flow-gallery-download-diagnostic-expire";
export const FLOW_GALLERY_DIAGNOSTIC_STORAGE_KEY =
  "flowGalleryDownloadDiagnosticV1";
export const FLOW_GALLERY_DIAGNOSTIC_EVENT =
  "AUTOMAT_FLOW_GALLERY_DOWNLOAD_DIAGNOSTIC_EVENT";

export const FlowDownloadCandidateSchema = z
  .object({
    downloadId: z.number().int().nonnegative(),
    filename: z.string().max(120),
    state: z.enum(["in_progress", "complete", "interrupted", "unknown"]),
    extension: z.enum(["mp4", "webm", "other"]),
    urlFingerprint: z.string().regex(/^[a-f0-9]{16}$/).optional(),
    finalUrlFingerprint: z.string().regex(/^[a-f0-9]{16}$/).optional(),
    mediaIdFingerprint: z.string().regex(/^[a-f0-9]{16}$/).optional(),
    startedOffsetMs: z.number().int().nonnegative(),
    interruptCode: z.string().regex(/^[A-Z0-9_]{1,32}$/).optional(),
  })
  .strict();

export const FlowDownloadPageEventSchema = z
  .object({
    eventToken: z.string().regex(/^page-download-[1-4]$/),
    filename: z.string().max(120),
    urlFingerprint: z.string().regex(/^[a-f0-9]{16}$/),
    mediaIdFingerprint: z.string().regex(/^[a-f0-9]{16}$/).optional(),
    frameMatched: z.boolean(),
    afterAction: z.boolean(),
    offsetMs: z.number().int().nonnegative(),
  })
  .strict();

export const FlowDownloadMediaRequestSchema = z
  .object({
    requestToken: z.string().regex(/^media-request-(?:[1-9]|1[0-6])$/),
    resourceKind: z.enum(["Media", "Fetch", "XHR"]),
    method: z.enum(["GET", "POST", "OTHER"]),
    urlFingerprint: z.string().regex(/^[a-f0-9]{16}$/),
    mediaIdFingerprint: z.string().regex(/^[a-f0-9]{16}$/).optional(),
    offsetMs: z.number().int().nonnegative(),
  })
  .strict();

export const FlowGalleryDownloadDiagnosticSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().uuid(),
    status: z.enum([
      "armed",
      "action_observed",
      "completed",
      "interrupted",
      "expired",
      "stopped",
    ]),
    startedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    tabId: z.number().int().nonnegative(),
    projectId: z.string().min(1).max(128),
    documentId: z.string().min(1).max(128),
    mainFrameId: z.string().min(1).max(128),
    actionAt: z.number().int().nonnegative().optional(),
    nativeActionObserved: z.literal(true).optional(),
    requestedQuality: z.literal("1080p_upscaled").optional(),
    selectedCard: z
      .object({
        token: z.literal("selected-card-1"),
        ownerFound: z.boolean(),
        stableIdAttributeObserved: z.boolean(),
      })
      .strict()
      .optional(),
    menuBinding: z
      .object({
        mainMenuControlResolved: z.boolean(),
        downloadRowRecognized: z.boolean(),
        qualityMenuControlResolved: z.boolean(),
        qualityOptionObserved: z.boolean(),
        qualityOptionEnabled: z.boolean(),
      })
      .strict()
      .optional(),
    mediaRequests: z.array(FlowDownloadMediaRequestSchema).max(16),
    pageDownloads: z.array(FlowDownloadPageEventSchema).max(4),
    downloads: z.array(FlowDownloadCandidateSchema).max(6),
    nonVideoDownloadCount: z.number().int().nonnegative().max(100),
    association: z.enum(["matched", "ambiguous", "unverified"]),
    associationReason: z.enum([
      "unique_action_media_and_download_chain",
      "no_quality_action",
      "no_selected_frame_download_event",
      "no_exact_url_filename_pair",
      "no_action_media_identity_link",
      "multiple_exact_download_candidates",
      "multiple_page_download_events",
    ]),
    matchedDownloadId: z.number().int().nonnegative().optional(),
  })
  .strict();

export type FlowGalleryDownloadDiagnostic = z.infer<
  typeof FlowGalleryDownloadDiagnosticSchema
>;
export type FlowDownloadCandidate = z.infer<
  typeof FlowDownloadCandidateSchema
>;
export type FlowDownloadPageEvent = z.infer<
  typeof FlowDownloadPageEventSchema
>;
export type FlowDownloadMediaRequest = z.infer<
  typeof FlowDownloadMediaRequestSchema
>;

export async function fingerprintFlowMediaIdentifier(
  sessionId: string,
  value: unknown,
): Promise<string | undefined> {
  if (typeof value !== "string" || value.length > 512) return undefined;
  const candidate = value
    .match(
      /(?:^|[^a-f\d])([a-f\d]{8,64}(?:-[a-f\d]{4,8}){1,4}|[a-f\d]{8,64})(?=[^a-f\d]|$)/i,
    )?.[1]
    ?.replace(/-/g, "");
  return candidate
    ? (await sha256Hex(`${sessionId}\nmedia\n${candidate}`)).slice(0, 16)
    : undefined;
}

export const FlowGalleryDiagnosticPageMessageSchema = z.discriminatedUnion(
  "stage",
  [
    z
      .object({
        sessionId: z.string().uuid(),
        stage: z.literal("main_menu"),
        capturedAt: z.number().int().nonnegative(),
        ownerFound: z.boolean(),
        stableIdAttributeObserved: z.boolean(),
        mainMenuControlResolved: z.boolean(),
      })
      .strict(),
    z
      .object({
        sessionId: z.string().uuid(),
        stage: z.literal("download_row"),
        capturedAt: z.number().int().nonnegative(),
        downloadRowRecognized: z.boolean(),
        qualityMenuControlResolved: z.boolean(),
        qualityOptionObserved: z.boolean(),
        qualityOptionEnabled: z.boolean(),
      })
      .strict(),
    z
      .object({
        sessionId: z.string().uuid(),
        stage: z.literal("quality_action"),
        capturedAt: z.number().int().nonnegative(),
        trusted: z.literal(true),
        requestedQuality: z.literal("1080p_upscaled"),
      })
      .strict(),
  ],
);

export type FlowGalleryDiagnosticPageMessage = z.infer<
  typeof FlowGalleryDiagnosticPageMessageSchema
>;

export type FlowDownloadAssociation = {
  association: "matched" | "ambiguous" | "unverified";
  associationReason: FlowGalleryDownloadDiagnostic["associationReason"];
  matchedDownloadId?: number;
};

export function sanitizeFlowDownloadFilename(value: unknown): string {
  if (typeof value !== "string") return "unknown-file";
  const basename = value.split(/[\\/]/).pop()?.split(/[?#]/, 1)[0] ?? "";
  const safe = basename
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .replace(/[^a-zA-Z0-9 ._()-]/g, "_")
    .trim()
    .slice(0, 120);
  return safe || "unknown-file";
}

export function flowDownloadExtension(filename: string): "mp4" | "webm" | "other" {
  const ext = filename.toLowerCase().split(".").pop();
  return ext === "mp4" || ext === "webm" ? ext : "other";
}

/** URL values are hashed in memory with a per-observation scope; raw URLs are never returned. */
export async function fingerprintFlowDownloadUrl(
  sessionId: string,
  rawUrl: unknown,
): Promise<{ urlFingerprint: string; mediaIdFingerprint?: string } | undefined> {
  if (typeof rawUrl !== "string" || rawUrl.length > 8192) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    return undefined;
  const urlFingerprint = (await sha256Hex(`${sessionId}\n${rawUrl}`)).slice(0, 16);
  const pathId = parsed.pathname
    .match(
      /(?:^\/|\/)([a-f\d]{8,64}(?:-[a-f\d]{4,8}){1,4}|[a-f\d]{8,64})(?=\/|$)/i,
    )?.[1]
    ?.replace(/-/g, "");
  const mediaIdFingerprint = pathId
    ? (await sha256Hex(`${sessionId}\nmedia\n${pathId}`)).slice(0, 16)
    : undefined;
  return { urlFingerprint, ...(mediaIdFingerprint ? { mediaIdFingerprint } : {}) };
}

export function classifyFlowDownloadAssociation(
  input: Pick<
    FlowGalleryDownloadDiagnostic,
    | "startedAt"
    | "actionAt"
    | "nativeActionObserved"
    | "selectedCard"
    | "menuBinding"
    | "pageDownloads"
    | "mediaRequests"
    | "downloads"
  >,
): FlowDownloadAssociation {
  if (
    input.actionAt === undefined ||
    input.nativeActionObserved !== true ||
    !input.selectedCard?.ownerFound ||
    !input.menuBinding?.mainMenuControlResolved ||
    !input.menuBinding.downloadRowRecognized ||
    !input.menuBinding.qualityMenuControlResolved ||
    !input.menuBinding.qualityOptionObserved ||
    !input.menuBinding.qualityOptionEnabled
  ) {
    return { association: "unverified", associationReason: "no_quality_action" };
  }
  const pageEvents = input.pageDownloads.filter(
    (event) => event.frameMatched && event.afterAction,
  );
  if (!pageEvents.length) {
    return {
      association: "unverified",
      associationReason: "no_selected_frame_download_event",
    };
  }

  const exactPairs = pageEvents.flatMap((event) =>
    input.downloads
      .filter(
        (download) =>
          (download.urlFingerprint === event.urlFingerprint ||
            download.finalUrlFingerprint === event.urlFingerprint) &&
          download.filename === event.filename,
      )
      .map((download) => ({ event, download })),
  );
  const actionMediaPairs = exactPairs.filter(({ event, download }) =>
    input.mediaRequests.some(
      (request) =>
        input.actionAt !== undefined &&
        input.startedAt + request.offsetMs >= input.actionAt &&
        (request.urlFingerprint === event.urlFingerprint ||
          (request.mediaIdFingerprint !== undefined &&
            (request.mediaIdFingerprint === event.mediaIdFingerprint ||
              request.mediaIdFingerprint === download.mediaIdFingerprint))),
    ),
  );
  if (actionMediaPairs.length === 1) {
    return {
      association: "matched",
      associationReason: "unique_action_media_and_download_chain",
      matchedDownloadId: actionMediaPairs[0]!.download.downloadId,
    };
  }
  if (actionMediaPairs.length > 1) {
    return {
      association: "ambiguous",
      associationReason: "multiple_exact_download_candidates",
    };
  }
  if (pageEvents.length > 1) {
    return {
      association: "ambiguous",
      associationReason: "multiple_page_download_events",
    };
  }
  if (exactPairs.length) {
    return {
      association: "unverified",
      associationReason: "no_action_media_identity_link",
    };
  }
  return {
    association: "unverified",
    associationReason: "no_exact_url_filename_pair",
  };
}

export function resolveFlowDownloadDiagnosticStatus(
  record: FlowGalleryDownloadDiagnostic,
  now: number,
): FlowGalleryDownloadDiagnostic {
  const association = classifyFlowDownloadAssociation(record);
  const matchingDownload = association.matchedDownloadId === undefined
    ? undefined
    : record.downloads.find(
        (candidate) => candidate.downloadId === association.matchedDownloadId,
      );
  let status = record.status;
  if (status === "armed" || status === "action_observed") {
    if (now >= record.expiresAt) status = "expired";
    else if (matchingDownload?.state === "complete") status = "completed";
    else if (matchingDownload?.state === "interrupted") status = "interrupted";
  }
  return FlowGalleryDownloadDiagnosticSchema.parse({
    ...record,
    ...association,
    status,
  });
}

/** Passive, one-shot DOM observer. It never prevents, changes, or synthesizes provider input. */
export function installFlowGalleryDownloadObserver(
  sessionId: string,
): { installed: boolean; replaced: boolean } {
  const scope = globalThis as typeof globalThis & {
    __AUTOMAT_FLOW_GALLERY_DOWNLOAD_OBSERVER_V1__?: {
      sessionId: string;
      stop: () => void;
    };
    chrome?: {
      runtime?: { sendMessage?: (message: unknown) => Promise<unknown> };
    };
  };
  const previous = scope.__AUTOMAT_FLOW_GALLERY_DOWNLOAD_OBSERVER_V1__;
  previous?.stop();
  let stage: "main_menu" | "download_row" | "quality_option" | "done" =
    "main_menu";
  let selectedCard: HTMLElement | undefined;
  let mainControlId: string | undefined;
  let downloadControlId: string | undefined;
  let stopped = false;

  const normalized = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const clickablePath = (event: Event): HTMLElement[] =>
    event
      .composedPath()
      .filter(
        (entry): entry is HTMLElement =>
          entry instanceof HTMLElement &&
          (entry.matches("button,[role='button'],[role='menuitem']") ||
            entry.hasAttribute("aria-controls")),
      );
  const textFor = (element: HTMLElement) =>
    normalized(
      `${element.getAttribute("aria-label") ?? ""} ${element.innerText ?? element.textContent ?? ""}`,
    );
  const stableCardIdObserved = (owner: HTMLElement | undefined) =>
    Boolean(
      owner &&
        (owner.id ||
          owner.hasAttribute("data-id") ||
          owner.hasAttribute("data-video-id") ||
          owner.hasAttribute("data-asset-id")),
    );
  const send = (message: FlowGalleryDiagnosticPageMessage) => {
    void scope.chrome?.runtime?.sendMessage?.({
      type: "AUTOMAT_FLOW_GALLERY_DOWNLOAD_DIAGNOSTIC_EVENT",
      ...message,
    }).catch(() => undefined);
  };
  const onClick = (event: MouseEvent) => {
    if (stopped || stage === "done" || !event.isTrusted) return;
    const path = clickablePath(event);
    const target = path[0];
    if (!target) return;

    if (stage === "main_menu") {
      const label = textFor(target);
      if (!label.includes("moreoptions")) return;
      if (!target.hasAttribute("aria-controls")) return;
      selectedCard = target.closest<HTMLElement>(
        "article,[role='listitem'],li,[data-testid*='video-card' i],[class*='videoCard' i]",
      ) ?? target.parentElement ?? undefined;
      mainControlId = target.getAttribute("aria-controls")?.trim().split(/\s+/)[0];
      stage = "download_row";
      queueMicrotask(() => {
        const owner = selectedCard;
        const mainMenu = mainControlId
          ? document.getElementById(mainControlId)
          : null;
        send({
          sessionId,
          stage: "main_menu",
          capturedAt: Date.now(),
          ownerFound: Boolean(owner),
          stableIdAttributeObserved: stableCardIdObserved(owner),
          mainMenuControlResolved: Boolean(mainMenu?.isConnected),
        });
      });
      return;
    }

    if (stage === "download_row") {
      const row = path.find((entry) => textFor(entry).includes("download"));
      if (!row) return;
      downloadControlId = row
        .getAttribute("aria-controls")
        ?.trim()
        .split(/\s+/)[0];
      stage = "quality_option";
      queueMicrotask(() => {
        const menu = downloadControlId
          ? document.getElementById(downloadControlId)
          : null;
        const qualityOptionObserved = Boolean(
          menu &&
            [...menu.querySelectorAll<HTMLElement>(
              "button,[role='button'],[role='menuitem']",
            )].some((option) => textFor(option).includes("1080pupscaled")),
        );
        const qualityOptionEnabled = Boolean(
          menu &&
            [...menu.querySelectorAll<HTMLElement>(
              "button,[role='button'],[role='menuitem']",
            )].some(
              (option) =>
                textFor(option).includes("1080pupscaled") &&
                !option.matches(":disabled") &&
                option.getAttribute("aria-disabled") !== "true",
            ),
        );
        send({
          sessionId,
          stage: "download_row",
          capturedAt: Date.now(),
          downloadRowRecognized: true,
          qualityMenuControlResolved: Boolean(menu?.isConnected),
          qualityOptionObserved,
          qualityOptionEnabled,
        });
      });
      return;
    }

    if (stage === "quality_option") {
      const qualityOption = path.find((entry) =>
        textFor(entry).includes("1080pupscaled"),
      );
      if (!qualityOption) return;
      stage = "done";
      send({
        sessionId,
        stage: "quality_action",
        capturedAt: Date.now(),
        trusted: true,
        requestedQuality: "1080p_upscaled",
      });
    }
  };
  const stop = () => {
    stopped = true;
    document.removeEventListener("click", onClick, true);
  };
  document.addEventListener("click", onClick, { capture: true, passive: true });
  scope.__AUTOMAT_FLOW_GALLERY_DOWNLOAD_OBSERVER_V1__ = { sessionId, stop };
  return { installed: true, replaced: Boolean(previous) };
}

export function uninstallFlowGalleryDownloadObserver(
  sessionId: string,
): { removed: boolean } {
  const scope = globalThis as typeof globalThis & {
    __AUTOMAT_FLOW_GALLERY_DOWNLOAD_OBSERVER_V1__?: {
      sessionId: string;
      stop: () => void;
    };
  };
  const current = scope.__AUTOMAT_FLOW_GALLERY_DOWNLOAD_OBSERVER_V1__;
  if (current?.sessionId !== sessionId) return { removed: false };
  current.stop();
  delete scope.__AUTOMAT_FLOW_GALLERY_DOWNLOAD_OBSERVER_V1__;
  return { removed: true };
}
