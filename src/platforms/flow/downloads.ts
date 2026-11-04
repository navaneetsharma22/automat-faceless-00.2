import { z } from "zod";
import { sha256Hex } from "../../domain/batches/hashPrompt";

export const FlowDownloadUrlSchemeCategorySchema = z.enum([
  "https",
  "http",
  "blob",
  "other",
  "unknown",
]);
export const FlowDownloadUrlRejectionSchema = z
  .object({
    reason: z.enum([
      "missing",
      "empty",
      "malformed",
      "unsupported_scheme",
      "policy_rejected",
    ]),
    schemeCategory: FlowDownloadUrlSchemeCategorySchema,
  })
  .strict();
const FlowSupportedDownloadUrlSchemeSchema = z.enum(["https", "http", "blob"]);

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
    extension: z.enum(["mp4", "webm", "other", "pending"]),
    urlFingerprint: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    finalUrlFingerprint: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    urlScheme: FlowSupportedDownloadUrlSchemeSchema.optional(),
    finalUrlScheme: FlowSupportedDownloadUrlSchemeSchema.optional(),
    urlRejection: FlowDownloadUrlRejectionSchema.optional(),
    finalUrlRejection: FlowDownloadUrlRejectionSchema.optional(),
    mediaIdFingerprint: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    startedOffsetMs: z.number().int().nonnegative(),
    interruptCode: z
      .string()
      .regex(/^[A-Z0-9_]{1,32}$/)
      .optional(),
  })
  .strict();

export const FlowDownloadPageEventSchema = z
  .object({
    eventToken: z.string().regex(/^page-download-[1-4]$/),
    filename: z.string().max(120),
    urlFingerprint: z.string().regex(/^[a-f0-9]{16}$/),
    urlScheme: FlowSupportedDownloadUrlSchemeSchema.optional(),
    exactDownloadIds: z.array(z.number().int().nonnegative()).max(6).optional(),
    mediaIdFingerprint: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
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
    mediaIdFingerprint: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
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
    qualityActionAcceptedAt: z.number().int().nonnegative().optional(),
    nativeActionObserved: z.literal(true).optional(),
    requestedQuality: z.literal("1080p_upscaled").optional(),
    qualityClickListenerReached: z.boolean().optional(),
    qualityClickListenerEvents: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .optional(),
    qualityClickRejections: z.number().int().nonnegative().max(100).optional(),
    lastQualityClickRejection: z
      .enum([
        "outside_bound_submenu",
        "quality_option_not_found",
        "quality_option_ambiguous",
        "quality_option_disabled",
      ])
      .optional(),
    qualityActionAcceptedInPage: z.boolean().optional(),
    qualityActionReceivedByWorker: z.boolean().optional(),
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
    pageDownloadEventsReceived: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .optional(),
    pageDownloadTargetMismatches: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .optional(),
    pageDownloadFrameMismatches: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .optional(),
    pageDownloadMainFrameEvents: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .optional(),
    pageDownloadMetadataRejected: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .optional(),
    pageDownloadFilenameUnavailable: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .optional(),
    pageDownloadEventsOmittedAtCap: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .optional(),
    lastPageDownloadUrlRejection: FlowDownloadUrlRejectionSchema.optional(),
    mediaRequestsOmittedAtCap: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .optional(),
    mediaIdentityRequestsOmittedAtCap: z
      .number()
      .int()
      .nonnegative()
      .max(100)
      .optional(),
    nonVideoDownloadCount: z.number().int().nonnegative().max(100),
    downloadCreatedEvents: z.number().int().nonnegative().max(100).optional(),
    videoCandidatesOmitted: z.number().int().nonnegative().max(100).optional(),
    interruptionReason: z
      .enum(["debugger_detached", "matched_download_interrupted"])
      .optional(),
    captureIssue: z
      .object({
        stage: z.enum(["main_menu", "download_row", "quality_option"]),
        reason: z.enum([
          "click_target_not_recognized",
          "control_missing",
          "owner_missing",
          "menu_unresolved",
          "quality_option_unresolved",
        ]),
      })
      .strict()
      .optional(),
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
export type FlowDownloadCandidate = z.infer<typeof FlowDownloadCandidateSchema>;
export type FlowDownloadPageEvent = z.infer<typeof FlowDownloadPageEventSchema>;
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
        stage: z.literal("capture_issue"),
        capturedAt: z.number().int().nonnegative(),
        failedStage: z.enum(["main_menu", "download_row", "quality_option"]),
        reason: z.enum([
          "click_target_not_recognized",
          "control_missing",
          "owner_missing",
          "menu_unresolved",
          "quality_option_unresolved",
        ]),
      })
      .strict(),
    z
      .object({
        sessionId: z.string().uuid(),
        stage: z.literal("quality_click_listener"),
        capturedAt: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        sessionId: z.string().uuid(),
        stage: z.literal("quality_click_rejected"),
        capturedAt: z.number().int().nonnegative(),
        reason: z.enum([
          "outside_bound_submenu",
          "quality_option_not_found",
          "quality_option_ambiguous",
          "quality_option_disabled",
        ]),
      })
      .strict(),
    z
      .object({
        sessionId: z.string().uuid(),
        stage: z.literal("quality_action_accepted_in_page"),
        capturedAt: z.number().int().nonnegative(),
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

export type FlowDownloadMediaIdentityStatus =
  | "not_evaluated"
  | "identity_not_extracted"
  | "identity_extracted_no_match"
  | "matching_request_retained"
  | "identity_request_dropped_at_cap";

export function diagnoseFlowDownloadMediaIdentity(
  input: Pick<
    FlowGalleryDownloadDiagnostic,
    | "startedAt"
    | "actionAt"
    | "nativeActionObserved"
    | "pageDownloads"
    | "mediaRequests"
    | "downloads"
    | "mediaIdentityRequestsOmittedAtCap"
  >,
): FlowDownloadMediaIdentityStatus {
  if (input.actionAt === undefined || input.nativeActionObserved !== true)
    return "not_evaluated";
  const pageEvents = input.pageDownloads.filter(
    (event) => event.frameMatched && event.afterAction,
  );
  if (!pageEvents.length) return "not_evaluated";
  const exactPairs = pageEvents.flatMap((event) =>
    input.downloads
      .filter(
        (download) =>
          (event.exactDownloadIds ?? []).includes(download.downloadId) &&
          (download.urlFingerprint === event.urlFingerprint ||
            download.finalUrlFingerprint === event.urlFingerprint) &&
          download.filename === event.filename,
      )
      .map((download) => ({ event, download })),
  );
  if (!exactPairs.length) return "not_evaluated";

  const actionRequests = input.mediaRequests.filter(
    (request) => input.startedAt + request.offsetMs >= input.actionAt!,
  );
  const requestMatchesPair = (
    request: FlowDownloadMediaRequest,
    event: FlowDownloadPageEvent,
    download: FlowDownloadCandidate,
  ) =>
    request.urlFingerprint === event.urlFingerprint ||
    (request.mediaIdFingerprint !== undefined &&
      (request.mediaIdFingerprint === event.mediaIdFingerprint ||
        request.mediaIdFingerprint === download.mediaIdFingerprint));
  if (
    exactPairs.some(({ event, download }) =>
      actionRequests.some((request) =>
        requestMatchesPair(request, event, download),
      ),
    )
  )
    return "matching_request_retained";
  if (
    actionRequests.some((request) => request.mediaIdFingerprint !== undefined)
  )
    return "identity_extracted_no_match";
  if ((input.mediaIdentityRequestsOmittedAtCap ?? 0) > 0)
    return "identity_request_dropped_at_cap";
  return "identity_not_extracted";
}

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

export function flowDownloadExtension(
  filename: string,
): "mp4" | "webm" | "other" {
  const ext = filename.toLowerCase().split(".").pop();
  return ext === "mp4" || ext === "webm" ? ext : "other";
}

/** URL values are hashed in memory with a per-observation scope; raw URLs are never returned. */
export type FlowDownloadUrlSchemeCategory = z.infer<
  typeof FlowDownloadUrlSchemeCategorySchema
>;
export type FlowDownloadUrlRejection = z.infer<
  typeof FlowDownloadUrlRejectionSchema
>;
export type FlowDownloadUrlFingerprint =
  | {
      accepted: true;
      schemeCategory: "https" | "http" | "blob";
      urlFingerprint: string;
      mediaIdFingerprint?: string;
    }
  | { accepted: false; rejection: FlowDownloadUrlRejection };

function rawUrlSchemeCategory(rawUrl: string): FlowDownloadUrlSchemeCategory {
  const match = rawUrl.match(/^\s*([a-z][a-z\d+.-]*):/i);
  const scheme = match?.[1]?.toLowerCase();
  return scheme === "https" || scheme === "http" || scheme === "blob"
    ? scheme
    : scheme
      ? "other"
      : "unknown";
}

export async function fingerprintFlowDownloadUrl(
  sessionId: string,
  rawUrl: unknown,
): Promise<FlowDownloadUrlFingerprint> {
  if (typeof rawUrl !== "string")
    return {
      accepted: false,
      rejection: { reason: "missing", schemeCategory: "unknown" },
    };
  if (rawUrl.trim().length === 0)
    return {
      accepted: false,
      rejection: { reason: "empty", schemeCategory: "unknown" },
    };
  const rawScheme = rawUrlSchemeCategory(rawUrl);
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      accepted: false,
      rejection: { reason: "malformed", schemeCategory: rawScheme },
    };
  }
  const schemeCategory = rawUrlSchemeCategory(rawUrl);
  if (
    schemeCategory !== "https" &&
    schemeCategory !== "http" &&
    schemeCategory !== "blob"
  )
    return {
      accepted: false,
      rejection: { reason: "unsupported_scheme", schemeCategory },
    };
  if (
    rawUrl.length > 8192 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  )
    return {
      accepted: false,
      rejection: { reason: "policy_rejected", schemeCategory },
    };
  const urlFingerprint = (await sha256Hex(`${sessionId}\n${rawUrl}`)).slice(
    0,
    16,
  );
  const pathId = parsed.pathname
    .match(
      /(?:^\/|\/)([a-f\d]{8,64}(?:-[a-f\d]{4,8}){1,4}|[a-f\d]{8,64})(?=\/|$)/i,
    )?.[1]
    ?.replace(/-/g, "");
  const mediaIdFingerprint = pathId
    ? (await sha256Hex(`${sessionId}\nmedia\n${pathId}`)).slice(0, 16)
    : undefined;
  return {
    accepted: true,
    schemeCategory,
    urlFingerprint,
    ...(mediaIdFingerprint ? { mediaIdFingerprint } : {}),
  };
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
    return {
      association: "unverified",
      associationReason: "no_quality_action",
    };
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
          (event.exactDownloadIds ?? []).includes(download.downloadId) &&
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
  const matchingDownload =
    association.matchedDownloadId === undefined
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
  const interruptionReason =
    status === "interrupted" && matchingDownload?.state === "interrupted"
      ? "matched_download_interrupted"
      : record.interruptionReason;
  return FlowGalleryDownloadDiagnosticSchema.parse({
    ...record,
    ...association,
    status,
    ...(interruptionReason ? { interruptionReason } : {}),
  });
}

/** Passive, one-shot DOM observer. It never prevents, changes, or synthesizes provider input. */
export function installFlowGalleryDownloadObserver(sessionId: string): {
  installed: boolean;
  replaced: boolean;
} {
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
    void scope.chrome?.runtime
      ?.sendMessage?.({
        type: "AUTOMAT_FLOW_GALLERY_DOWNLOAD_DIAGNOSTIC_EVENT",
        ...message,
      })
      .catch(() => undefined);
  };
  const issue = (
    failedStage: "main_menu" | "download_row" | "quality_option",
    reason:
      | "click_target_not_recognized"
      | "control_missing"
      | "owner_missing"
      | "menu_unresolved"
      | "quality_option_unresolved",
  ) =>
    send({
      sessionId,
      stage: "capture_issue",
      capturedAt: Date.now(),
      failedStage,
      reason,
    });
  const menuAvailable = (menu: HTMLElement) => {
    if (!menu.isConnected) return false;
    let current: HTMLElement | null = menu;
    while (current) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true")
        return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
      current = current.parentElement;
    }
    return true;
  };
  const composedContains = (owner: HTMLElement, target: HTMLElement) => {
    let current: Node | null = target;
    while (current) {
      if (current === owner) return true;
      current =
        current.parentNode ??
        (current instanceof ShadowRoot ? current.host : null);
    }
    return false;
  };
  const inBoundMenu = (path: HTMLElement[], controlId: string | undefined) => {
    const matches = controlId
      ? [...document.querySelectorAll<HTMLElement>("[id]")].filter(
          (element) => element.id === controlId,
        )
      : [];
    const menu = matches.length === 1 ? matches[0] : null;
    return Boolean(
      menu &&
      menuAvailable(menu) &&
      path.some((entry) => entry === menu || menu.contains(entry)),
    );
  };
  const waitForUniqueControlledMenu = (
    trigger: HTMLElement,
    owner: HTMLElement,
    onResolved: (controlId: string, menu: HTMLElement) => void,
    onFailed: (
      reason: "control_missing" | "menu_unresolved" | "owner_missing",
    ) => void,
    requireTriggerInsideOwner = true,
  ) => {
    let finished = false;
    let sawControl = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      window.clearTimeout(timeout);
    };
    const resolve = () => {
      if (finished) return;
      if (
        !owner.isConnected ||
        !trigger.isConnected ||
        (requireTriggerInsideOwner && !composedContains(owner, trigger))
      ) {
        finish();
        onFailed("owner_missing");
        return;
      }
      const ids = (trigger.getAttribute("aria-controls") ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (!ids.length) return;
      sawControl = true;
      if (ids.length !== 1) {
        finish();
        onFailed("menu_unresolved");
        return;
      }
      const matches = [
        ...document.querySelectorAll<HTMLElement>("[id]"),
      ].filter((element) => element.id === ids[0]);
      if (matches.length > 1) {
        finish();
        onFailed("menu_unresolved");
        return;
      }
      const menu = matches[0];
      if (!menu || !menuAvailable(menu)) return;
      finish();
      onResolved(ids[0]!, menu);
    };
    const observer = new MutationObserver(resolve);
    const timeout = window.setTimeout(() => {
      finish();
      onFailed(sawControl ? "menu_unresolved" : "control_missing");
    }, 2_000);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "aria-controls",
        "id",
        "hidden",
        "aria-hidden",
        "class",
        "style",
      ],
    });
    queueMicrotask(resolve);
  };
  const qualityEvidence = (menu: HTMLElement) => {
    const options = [
      ...menu.querySelectorAll<HTMLElement>(
        "button,[role='button'],[role='menuitem']",
      ),
    ].filter((option) => textFor(option).includes("1080pupscaled"));
    return {
      observed: options.length === 1,
      enabled:
        options.length === 1 &&
        !options[0]!.matches(":disabled") &&
        options[0]!.getAttribute("aria-disabled") !== "true",
    };
  };
  let bindingPending = false;
  const onClick = (event: MouseEvent) => {
    if (stopped || stage === "done" || !event.isTrusted) return;
    const path = clickablePath(event);
    if (stage === "main_menu") {
      // Ignore unrelated page clicks. Only a recognized Gallery action is diagnostic evidence.
      const target = path.find((entry) =>
        textFor(entry).includes("moreoptions"),
      );
      if (!target || bindingPending) return;
      const cardSelector =
        "flow-video-tile,article,[role='listitem'],li,[data-testid*='video-card' i],[class*='videoCard' i]";
      const pathOwner = event
        .composedPath()
        .find(
          (entry): entry is HTMLElement =>
            entry instanceof HTMLElement && entry.matches(cardSelector),
        );
      selectedCard =
        pathOwner ?? target.closest<HTMLElement>(cardSelector) ?? undefined;
      if (!selectedCard) {
        issue("main_menu", "owner_missing");
        return;
      }
      bindingPending = true;
      const owner = selectedCard;
      waitForUniqueControlledMenu(
        target,
        owner,
        (controlId) => {
          mainControlId = controlId;
          stage = "download_row";
          bindingPending = false;
          // This is menu-only evidence. It does not mean the quality action occurred.
          send({
            sessionId,
            stage: "main_menu",
            capturedAt: Date.now(),
            ownerFound: true,
            stableIdAttributeObserved: stableCardIdObserved(owner),
            mainMenuControlResolved: true,
          });
        },
        (reason) => {
          bindingPending = false;
          issue("main_menu", reason);
        },
      );
      return;
    }

    if (stage === "quality_option") {
      send({
        sessionId,
        stage: "quality_click_listener",
        capturedAt: Date.now(),
      });
      const reject = (
        reason:
          | "outside_bound_submenu"
          | "quality_option_not_found"
          | "quality_option_ambiguous"
          | "quality_option_disabled",
      ) =>
        send({
          sessionId,
          stage: "quality_click_rejected",
          capturedAt: Date.now(),
          reason,
        });
      if (!inBoundMenu(path, downloadControlId)) {
        reject("outside_bound_submenu");
        return;
      }
      const qualityOptions = path.filter((entry) =>
        textFor(entry).includes("1080pupscaled"),
      );
      if (!qualityOptions.length) {
        reject("quality_option_not_found");
        return;
      }
      if (qualityOptions.length !== 1) {
        reject("quality_option_ambiguous");
        return;
      }
      const qualityOption = qualityOptions[0]!;
      if (
        qualityOption.matches(":disabled") ||
        qualityOption.getAttribute("aria-disabled") === "true"
      ) {
        reject("quality_option_disabled");
        return;
      }
      stage = "done";
      const capturedAt = Date.now();
      send({
        sessionId,
        stage: "quality_action_accepted_in_page",
        capturedAt,
      });
      send({
        sessionId,
        stage: "quality_action",
        capturedAt,
        trusted: true,
        requestedQuality: "1080p_upscaled",
      });
    }
  };
  const onPointerOver = (event: PointerEvent) => {
    if (
      stopped ||
      stage !== "download_row" ||
      bindingPending ||
      !event.isTrusted
    )
      return;
    const path = clickablePath(event);
    if (!inBoundMenu(path, mainControlId)) return;
    const row = path.find((entry) => textFor(entry).includes("download"));
    if (!row) return;
    const owner = selectedCard;
    if (!owner) {
      issue("download_row", "owner_missing");
      return;
    }
    bindingPending = true;
    waitForUniqueControlledMenu(
      row,
      owner,
      (controlId, menu) => {
        downloadControlId = controlId;
        stage = "quality_option";
        bindingPending = false;
        const quality = qualityEvidence(menu);
        send({
          sessionId,
          stage: "download_row",
          capturedAt: Date.now(),
          downloadRowRecognized: true,
          qualityMenuControlResolved: true,
          qualityOptionObserved: quality.observed,
          qualityOptionEnabled: quality.enabled,
        });
        if (!quality.observed)
          issue("download_row", "quality_option_unresolved");
      },
      (reason) => {
        bindingPending = false;
        issue("download_row", reason);
      },
      false,
    );
  };
  const stop = () => {
    stopped = true;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerover", onPointerOver, true);
  };
  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("pointerover", onPointerOver, {
    capture: true,
    passive: true,
  });
  scope.__AUTOMAT_FLOW_GALLERY_DOWNLOAD_OBSERVER_V1__ = { sessionId, stop };
  return { installed: true, replaced: Boolean(previous) };
}

export function uninstallFlowGalleryDownloadObserver(sessionId: string): {
  removed: boolean;
} {
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
