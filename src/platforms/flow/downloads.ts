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
    assetPathFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
    assetPathFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
    assetPathFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    offsetMs: z.number().int().nonnegative(),
  })
  .strict();

export const FlowDetailMetadataFieldSchema = z
  .object({
    fieldToken: z.string().regex(/^metadata-field-(?:[1-9]|[1-3][0-9]|4[0-8])$/),
    requestToken: z.string().regex(/^metadata-request-(?:[1-9]|1[0-2])$/),
    role: z.enum(["request_body", "response_body"]),
    fieldPath: z.string().min(1).max(120),
    valueKind: z.enum(["uuid", "identifier"]),
    valueFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    routeEquality: z.boolean().optional(),
    requestResponseEquality: z.boolean().optional(),
    blobPathEquality: z.boolean().optional(),
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
    captureMode: z.enum(["gallery", "detail_clip"]).optional(),
    detailMenuBoundAtArm: z.boolean().optional(),
    detailClipSelectionStatus: z
      .enum(["not_applicable", "waiting_for_user_selection", "observed", "route_changed"])
      .optional(),
    detailDownloadCompletionStatus: z
      .enum([
        "not_observed",
        "awaiting_browser_download",
        "awaiting_chrome_match",
        "in_progress",
        "complete",
        "interrupted",
        "ambiguous",
      ])
      .optional(),
    detailTrackedDownloadId: z.number().int().nonnegative().optional(),
    detailFileResolutionStatus: z
      .enum(["not_checked", "resolved", "missing", "ambiguous", "unavailable"])
      .optional(),
    detailMetadataCaptureEnabled: z.boolean().optional(),
    detailMetadataFields: z.array(FlowDetailMetadataFieldSchema).max(48).optional(),
    detailMetadataBodiesOmitted: z.number().int().nonnegative().max(100).optional(),
    detailMetadataEligibleRequestsSeen: z.number().int().nonnegative().max(100).optional(),
    detailMetadataRequestsAdmitted: z.number().int().nonnegative().max(12).optional(),
    detailMetadataRequestsOmittedAtCap: z.number().int().nonnegative().max(100).optional(),
    detailMetadataRequestBodiesAvailable: z.number().int().nonnegative().max(100).optional(),
    detailMetadataRequestBodiesRead: z.number().int().nonnegative().max(100).optional(),
    detailMetadataResponseBodiesAttempted: z.number().int().nonnegative().max(100).optional(),
    detailMetadataResponseBodiesRead: z.number().int().nonnegative().max(100).optional(),
    detailMetadataJsonParseSucceeded: z.number().int().nonnegative().max(100).optional(),
    detailMetadataJsonParseFailed: z.number().int().nonnegative().max(100).optional(),
    detailMetadataBodiesUnavailable: z.number().int().nonnegative().max(100).optional(),
    detailMetadataBodiesFailed: z.number().int().nonnegative().max(100).optional(),
    detailMetadataBodiesUnsupported: z.number().int().nonnegative().max(100).optional(),
    detailMetadataBodiesFiltered: z.number().int().nonnegative().max(100).optional(),
    detailMetadataParsedBodiesWithoutIdentityFields: z.number().int().nonnegative().max(100).optional(),
    detailMetadataPendingRequests: z.number().int().nonnegative().max(12).optional(),
    identityCaptureEnabled: z.boolean().optional(),
    assetRoutePreflight: z
      .object({
        matchStatus: z.enum([
          "matched",
          "no_matching_edit_route",
          "not_matched",
        ]),
        assetPathFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        selectedRouteMatchStatus: z
          .enum([
            "not_checked",
            "matched",
            "changed_or_missing",
            "not_comparable",
            "not_matched",
          ])
          .optional(),
      })
      .strict()
      .optional(),
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
        assetPathFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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

/** Fingerprints the asset UUID in Flow's project-scoped detail route. */
export async function fingerprintFlowAssetPath(
  sessionId: string,
  rawUrl: unknown,
  projectId?: string,
): Promise<string | undefined> {
  if (typeof rawUrl !== "string" || rawUrl.length > 8192) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "flow.google.com" ||
    parsed.username ||
    parsed.password
  )
    return undefined;
  const match = /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/edit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
    parsed.pathname,
  );
  if (!match || (projectId !== undefined && match[1] !== projectId))
    return undefined;
  return sha256Hex(
    `${sessionId}\nflow-asset-route\n${match[2]!.toLowerCase()}`,
  );
}

/** Fingerprints UUID path components on captured Flow media/download URLs. */
export async function fingerprintFlowAssetUrlPath(
  sessionId: string,
  rawUrl: unknown,
): Promise<string | undefined> {
  if (typeof rawUrl !== "string" || rawUrl.length > 8192) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (
    parsed.username ||
    parsed.password ||
    !["https:", "http:", "blob:"].includes(parsed.protocol)
  )
    return undefined;
  const match = /(?:^|\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/i.exec(
    parsed.pathname,
  );
  return match
    ? sha256Hex(
        `${sessionId}\nflow-asset-route\n${match[1]!.toLowerCase()}`,
      )
    : undefined;
}

export type FlowDetailMetadataBodyInspection = {
  status: "parsed" | "invalid_json" | "unavailable" | "too_large";
  fields: Array<z.infer<typeof FlowDetailMetadataFieldSchema>>;
};

/** Parses a bounded JSON body and retains only scoped fingerprints of ID-like scalar fields. */
export async function inspectFlowDetailMetadataBody(
  sessionId: string,
  requestToken: string,
  role: "request_body" | "response_body",
  rawJson: unknown,
  offsetMs: number,
): Promise<FlowDetailMetadataBodyInspection> {
  if (typeof rawJson !== "string") return { status: "unavailable", fields: [] };
  if (rawJson.length > 64 * 1024) return { status: "too_large", fields: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { status: "invalid_json", fields: [] };
  }
  const found: Array<z.infer<typeof FlowDetailMetadataFieldSchema>> = [];
  const idKey = /(id|uuid|asset|job|result|clip|media)(?:id)?$/i;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const visit = async (value: unknown, path: string[], depth: number) => {
    if (found.length >= 48 || depth > 8) return;
    if (Array.isArray(value)) {
      for (let index = 0; index < Math.min(value.length, 16); index++)
        await visit(value[index], [...path, String(index)], depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (found.length >= 48) break;
      const safeKey = key
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig, "uuid")
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 32) || "field";
      const nextPath = [...path, safeKey];
      if (typeof nested === "string" || typeof nested === "number") {
        const scalar = String(nested);
        if (scalar.length > 128) continue;
        const isUuid = uuidPattern.test(scalar);
        if (!isUuid && !idKey.test(key)) continue;
        const normalized = isUuid ? scalar.toLowerCase() : scalar;
        const fingerprint = await sha256Hex(
          isUuid
            ? `${sessionId}\nflow-asset-route\n${normalized}`
            : `${sessionId}\nflow-metadata-id\n${normalized}`,
        );
        found.push({
          fieldToken: `metadata-field-${found.length + 1}`,
          requestToken,
          role,
          fieldPath: nextPath.join(".").slice(0, 120),
          valueKind: isUuid ? "uuid" : "identifier",
          valueFingerprint: fingerprint,
          offsetMs,
        });
      } else {
        await visit(nested, nextPath, depth + 1);
      }
    }
  };
  await visit(parsed, [], 0);
  return { status: "parsed", fields: found };
}

/** Backward-compatible helper for focused fingerprint tests. */
export async function fingerprintFlowDetailMetadataFields(
  sessionId: string,
  requestToken: string,
  role: "request_body" | "response_body",
  rawJson: unknown,
  offsetMs: number,
) {
  return (
    await inspectFlowDetailMetadataBody(
      sessionId,
      requestToken,
      role,
      rawJson,
      offsetMs,
    )
  ).fields;
}

/** Separate evidence-only route/output/blob trace; never used by matching. */
export function diagnoseFlowRouteAssetBlobLink(
  record: Pick<
    FlowGalleryDownloadDiagnostic,
    | "identityCaptureEnabled"
    | "captureMode"
    | "detailClipSelectionStatus"
    | "assetRoutePreflight"
    | "startedAt"
    | "actionAt"
    | "selectedCard"
    | "mediaRequests"
    | "pageDownloads"
    | "downloads"
  >,
): {
  routeToOutput:
    | "off"
    | "route_not_observed"
    | "route_id_not_in_action_request"
    | "route_id_on_action_request"
    | "ambiguous_action_requests";
  outputToBlob:
    | "off"
    | "route_not_observed"
    | "route_id_not_in_action_request"
    | "blob_id_not_observed"
    | "blob_id_matches_exact_chrome_download"
    | "ambiguous_blob_matches";
} {
  if (!record.identityCaptureEnabled)
    return { routeToOutput: "off", outputToBlob: "off" };
  const routeFingerprint =
    record.captureMode === "detail_clip"
      ? record.detailClipSelectionStatus === "observed"
        ? record.assetRoutePreflight?.assetPathFingerprint
        : undefined
      : record.selectedCard?.assetPathFingerprint;
  const preflight = record.assetRoutePreflight;
  if (
    !preflight ||
    preflight.matchStatus !== "matched" ||
    !preflight.assetPathFingerprint ||
    ["not_matched", "changed_or_missing", "not_comparable"].includes(
      preflight.selectedRouteMatchStatus ?? "",
    ) ||
    routeFingerprint !== preflight.assetPathFingerprint
  )
    return {
      routeToOutput: "route_not_observed",
      outputToBlob: "route_not_observed",
    };
  if (record.actionAt === undefined)
    return {
      routeToOutput: "route_id_not_in_action_request",
      outputToBlob: "route_id_not_in_action_request",
    };
  const assetRequests = record.mediaRequests.filter(
    (request) =>
      record.startedAt + request.offsetMs >= record.actionAt! &&
      request.assetPathFingerprint === routeFingerprint,
  );
  if (assetRequests.length > 1)
    return {
      routeToOutput: "ambiguous_action_requests",
      outputToBlob: "route_id_not_in_action_request",
    };
  if (!assetRequests.length)
    return {
      routeToOutput: "route_id_not_in_action_request",
      outputToBlob: "route_id_not_in_action_request",
    };
  const exactBlobPairs = record.pageDownloads.flatMap((event) => {
    if (
      event.urlScheme !== "blob" ||
      !event.frameMatched ||
      !event.afterAction ||
      event.assetPathFingerprint !== routeFingerprint
    )
      return [];
    return record.downloads
      .filter(
        (download) =>
          (event.exactDownloadIds ?? []).includes(download.downloadId) &&
          (download.urlFingerprint === event.urlFingerprint ||
            download.finalUrlFingerprint === event.urlFingerprint),
      )
      .map((download) => ({ event, download }));
  });
  if (exactBlobPairs.length > 1)
    return {
      routeToOutput: "route_id_on_action_request",
      outputToBlob: "ambiguous_blob_matches",
    };
  return {
    routeToOutput: "route_id_on_action_request",
    outputToBlob: exactBlobPairs.length
      ? "blob_id_matches_exact_chrome_download"
      : "blob_id_not_observed",
  };
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
        assetPathFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
    z
      .object({
        sessionId: z.string().uuid(),
        stage: z.literal("detail_clip_selection"),
        capturedAt: z.number().int().nonnegative(),
        trusted: z.literal(true),
        requestedQuality: z.literal("1080p_upscaled"),
        menuBound: z.literal(true),
        assetPathFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
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
export function installFlowGalleryDownloadObserver(
  sessionId: string,
  projectId?: string,
  identityCaptureEnabled = false,
  captureMode: "gallery" | "detail_clip" = "gallery",
  expectedClipId?: string,
  expectedAssetPathFingerprint?: string,
): {
  installed: boolean;
  replaced: boolean;
  menuBound?: boolean;
  qualityOptionObserved?: boolean;
  qualityOptionEnabled?: boolean;
  blocker?: string;
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
  let detailClickHandler: ((event: MouseEvent) => void) | undefined;

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
  const onClick = async (event: MouseEvent) => {
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
      let assetPathFingerprint: string | undefined;
      if (identityCaptureEnabled) {
        try {
          const route = new URL(scope.location.href);
          const match = /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/edit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
            route.pathname,
          );
          if (match && (!projectId || match[1] === projectId)) {
            const digest = await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(
                `${sessionId}\nflow-asset-route\n${match[2]!.toLowerCase()}`,
              ),
            );
            assetPathFingerprint = Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join("");
          }
        } catch {
          assetPathFingerprint = undefined;
        }
      }
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
            ...(assetPathFingerprint ? { assetPathFingerprint } : {}),
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
    if (detailClickHandler)
      document.removeEventListener("click", detailClickHandler, true);
  };

  if (captureMode === "detail_clip") {
    const expectedId = expectedClipId?.toLowerCase();
    const currentRouteMatches = () => {
      if (!projectId || !expectedId) return false;
      try {
        const route = new URL(scope.location.href);
        const routeMatch =
          route.protocol === "https:" &&
          route.hostname === "flow.google.com" &&
          !route.username &&
          !route.password
            ? /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/edit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
                route.pathname,
              )
            : null;
        return Boolean(
          routeMatch &&
            routeMatch[1] === projectId &&
            routeMatch[2]!.toLowerCase() === expectedId,
        );
      } catch {
        return false;
      }
    };
    const visible = (element: HTMLElement) => {
      if (!element.isConnected) return false;
      let current: HTMLElement | null = element;
      while (current) {
        if (current.hidden || current.getAttribute("aria-hidden") === "true")
          return false;
        const style = window.getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden")
          return false;
        current = current.parentElement;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const resolveDetailMenu = () => {
      if (!currentRouteMatches()) return undefined;
      const triggers = [
        ...document.querySelectorAll<HTMLElement>(
          "button,[role='button'],[role='menuitem']",
        ),
      ].filter((entry) => visible(entry) && textFor(entry).includes("downloadmedia"));
      if (triggers.length !== 1) return undefined;
      const trigger = triggers[0]!;
      if (trigger.getAttribute("aria-expanded") === "false") return undefined;
      const ids = (trigger.getAttribute("aria-controls") ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (ids.length !== 1) return undefined;
      const menus = [...document.querySelectorAll<HTMLElement>("[id]")].filter(
        (entry) => entry.id === ids[0],
      );
      if (menus.length !== 1 || !visible(menus[0]!)) return undefined;
      const quality = qualityEvidence(menus[0]!);
      return { menu: menus[0]!, quality };
    };
    if (!currentRouteMatches())
      return { installed: false, replaced: Boolean(previous), blocker: "detail_route_mismatch" };
    const preflightMenu = resolveDetailMenu();
    if (!preflightMenu)
      return { installed: false, replaced: Boolean(previous), blocker: "detail_menu_unbound" };
    if (!preflightMenu.quality.observed || !preflightMenu.quality.enabled)
      return { installed: false, replaced: Boolean(previous), blocker: "quality_option_not_ready" };
    detailClickHandler = (event: MouseEvent) => {
      if (stopped || !event.isTrusted) return;
      const path = clickablePath(event);
      const menuContext = resolveDetailMenu();
      if (!menuContext) return;
      const selectedOptions = path.filter((entry) =>
        textFor(entry).includes("1080pupscaled"),
      );
      if (
        selectedOptions.length !== 1 ||
        !menuContext.menu.contains(selectedOptions[0]!) ||
        selectedOptions[0]!.matches(":disabled") ||
        selectedOptions[0]!.getAttribute("aria-disabled") === "true"
      )
        return;
      const routeFingerprint = expectedAssetPathFingerprint;
      if (!routeFingerprint || !/^[a-f0-9]{64}$/.test(routeFingerprint)) return;
      if (!currentRouteMatches()) return;
      stopped = true;
      document.removeEventListener("click", detailClickHandler!, true);
      send({
        sessionId,
        stage: "detail_clip_selection",
        capturedAt: Date.now(),
        trusted: true,
        requestedQuality: "1080p_upscaled",
        menuBound: true,
        assetPathFingerprint: routeFingerprint,
      });
    };
    document.addEventListener("click", detailClickHandler, {
      capture: true,
      passive: true,
    });
    scope.__AUTOMAT_FLOW_GALLERY_DOWNLOAD_OBSERVER_V1__ = { sessionId, stop };
    return {
      installed: true,
      replaced: Boolean(previous),
      menuBound: true,
      qualityOptionObserved: preflightMenu.quality.observed,
      qualityOptionEnabled: preflightMenu.quality.enabled,
    };
  }

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
