import type { ExtensionRepositories } from "../storage/repositories";
import { BUILD_ID, PROTOCOL_VERSION } from "../shared/buildInfo";
import { flowTabFromUrl, sameFlowDocument } from "../platforms/flow/connection";
import {
  FlowClipImportRecordSchema,
  type FlowClipThumbnailMetadata,
  flowClipDetailIdentityFromUrl,
  flowClipImportRouteMatches,
} from "../domain/media/flowClipImport";
import {
  isFlow1080pProofClip,
} from "../domain/media/flowClipDownloadProof";
import {
  FlowClipPageMetadataSchema,
  inspectCurrentFlowClipInPage,
} from "../platforms/flow/clipImport";
import { inspectFlowClipDownloadMenuInPage } from "../platforms/flow/clipDownloadProof";
import { FlowClipAssetIdentitySchema, FlowClipDownloadPointSchema, prepareFlowClipDownloadInPage } from "../platforms/flow/clipDownload";
import {
  FlowProjectVideosImportProgressSchema,
  FlowProjectVideosPageResultSchema,
  inspectFlowProjectVideosInPage,
  sanitizeFlowProjectVideoTitle,
  type FlowProjectVideoCard,
  type FlowProjectVideosPageResult,
  type FlowProjectVideosImportProgress,
} from "../platforms/flow/projectVideos";
import { FlowClipDownloadFailureCodeSchema, type FlowClipDownloadFailureCode, type FlowClipDownloadFailureStage } from "../platforms/flow/downloads";
import {
  FLOW_GALLERY_DIAGNOSTIC_ALARM,
  FLOW_GALLERY_DIAGNOSTIC_STORAGE_KEY,
  FLOW_GALLERY_DIAGNOSTIC_TTL_MS,
  FlowGalleryDiagnosticPageMessageSchema,
  FlowGalleryDownloadDiagnosticSchema,
  classifyFlowDetailMetadataMimeCategory,
  fingerprintFlowAssetPath,
  fingerprintFlowDownloadUrl,
  fingerprintFlowAssetUrlPath,
  inspectFlowDetailMetadataBody,
  fingerprintFlowMediaIdentifier,
  flowDownloadExtension,
  installFlowGalleryDownloadObserver,
  resolveFlowDownloadDiagnosticStatus,
  sanitizeFlowDownloadFilename,
  uninstallFlowGalleryDownloadObserver,
  type FlowDownloadCandidate,
  type FlowDownloadMediaRequest,
  type FlowDownloadPageEvent,
  type FlowGalleryDownloadDiagnostic,
  type FlowGalleryDiagnosticPageMessage,
  type FlowDetailMetadataBodyDiagnostic,
  type FlowDetailMetadataMimeCategory,
} from "../platforms/flow/downloads";

type EventPort<T extends (...args: never[]) => void> = {
  available?(): boolean;
  addListener(listener: T): void;
  removeListener?(listener: T): void;
};

type ChromeDownloadItem = {
  id: number;
  filename?: string;
  state?: string;
  url?: string;
  finalUrl?: string;
  exists?: boolean;
  error?: string;
};

export type FlowDownloadDiagnosticDebuggerSource = {
  tabId?: number;
  frameId?: string;
};
export type FlowDownloadDiagnosticDebuggerEventListener = (
  source: FlowDownloadDiagnosticDebuggerSource,
  method: string,
  params: Record<string, unknown>,
) => void;
export type FlowDownloadDiagnosticDebuggerDetachListener = (
  source: FlowDownloadDiagnosticDebuggerSource,
  reason: string,
) => void;
export type FlowDownloadDiagnosticDownloadCreatedListener = (
  item: ChromeDownloadItem,
) => void;
export type FlowDownloadDiagnosticDownloadChangedListener = (delta: {
  id: number;
  state?: { current?: string };
  filename?: { current?: string };
  error?: { current?: string };
}) => void;

export type FlowDownloadDiagnosticDependencies = {
  extensionId: string;
  repositories: Pick<
    ExtensionRepositories,
    "getSelectedTarget" | "upsertFlowClipImport" | "listFlowClipImports"
  >;
  permissions: {
    contains(input: { permissions: string[] }): Promise<boolean>;
  };
  tabs: {
    get(tabId: number): Promise<{ id?: number; title?: string; url?: string }>;
    update?(tabId: number, properties: { url: string }): Promise<unknown>;
  };
  revalidateFlowConnection?(): Promise<{ ok: boolean; state?: string }>;
  wait?(milliseconds: number): Promise<void>;
  scripting: {
    executeScript(input: {
      target: { tabId: number; documentIds: string[] };
      world: "ISOLATED";
      func: (...args: never[]) => unknown;
      args: unknown[];
    }): Promise<Array<{ documentId?: string; result?: unknown }>>;
  };
  debugger: {
    attach(target: { tabId: number }, version: string): Promise<void>;
    sendCommand(
      target: { tabId: number },
      method: string,
      params?: Record<string, unknown>,
    ): Promise<unknown>;
    detach(target: { tabId: number }): Promise<void>;
    onEvent: EventPort<FlowDownloadDiagnosticDebuggerEventListener>;
    onDetach: EventPort<FlowDownloadDiagnosticDebuggerDetachListener>;
  };
  downloads: {
    onCreated: EventPort<FlowDownloadDiagnosticDownloadCreatedListener>;
    onChanged: EventPort<FlowDownloadDiagnosticDownloadChangedListener>;
    search?(query: { id: number }): Promise<ChromeDownloadItem[]>;
  };
  storage: {
    get(key: string): Promise<Record<string, unknown>>;
    set(value: Record<string, unknown>): Promise<void>;
    remove(key: string): Promise<void>;
  };
  alarms: {
    create(name: string, info: { when: number }): Promise<void> | void;
    clear(name: string): Promise<boolean> | boolean;
  };
  now?: () => number;
  createSessionId?: () => string;
};

const FLOW_PROJECT_VIDEO_IMPORT_MAX_SCROLL_STEPS = 40;
const FLOW_PROJECT_VIDEO_IMPORT_MAX_CARDS = 200;
const FLOW_PROJECT_VIDEO_DETAIL_WAIT_DEADLINE_MS = 30_000;
const FLOW_PROJECT_VIDEO_IMPORT_BOUNDARY_READS = 2;

type FlowProjectVideoImportJob = {
  progress: FlowProjectVideosImportProgress;
  oneCardCheck: boolean;
  galleryUrl: string;
  selectedTabId: number;
  canonicalTarget: string;
  cancelRequested: boolean;
  candidates: Map<string, FlowProjectVideoCard>;
  nativeCandidates: Map<string, { card: FlowProjectVideoCard; scrollTop: number; documentId: string }>;
  unresolvedKeys: Set<string>;
  unresolvedObservationSequence: number;
  resolving?: boolean;
};

function isActive(record: FlowGalleryDownloadDiagnostic | undefined) {
  return record?.status === "armed" || record?.status === "action_observed";
}

function readBrowserState(value: unknown): FlowDownloadCandidate["state"] {
  return value === "in_progress" ||
    value === "complete" ||
    value === "interrupted"
    ? value
    : "unknown";
}

function sanitizeInterruptCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const safe = value
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 32);
  return safe || undefined;
}

function pageMessage(
  raw: unknown,
): FlowGalleryDiagnosticPageMessage | undefined {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("type" in raw) ||
    raw.type !== "AUTOMAT_FLOW_GALLERY_DOWNLOAD_DIAGNOSTIC_EVENT"
  )
    return undefined;
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key !== "type") payload[key] = value;
  }
  const parsed = FlowGalleryDiagnosticPageMessageSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}

function updateAssociation(
  record: FlowGalleryDownloadDiagnostic,
  at: number,
): FlowGalleryDownloadDiagnostic {
  const withAssociation = resolveFlowDownloadDiagnosticStatus(record, at);
  if (withAssociation.captureMode !== "detail_clip") return withAssociation;
  const pageEvents = withAssociation.pageDownloads.filter(
    (event) => event.frameMatched && event.afterAction,
  );
  const linkedEvents = pageEvents.filter(
    (event) => (event.exactDownloadIds ?? []).length > 0,
  );
  const linkedIds = [
    ...new Set(linkedEvents.flatMap((event) => event.exactDownloadIds ?? [])),
  ];
  let completion: NonNullable<
    FlowGalleryDownloadDiagnostic["detailDownloadCompletionStatus"]
  > = "not_observed";
  let trackedDownloadId: number | undefined;
  if (withAssociation.detailClipSelectionStatus === "observed") {
    if (!pageEvents.length) completion = "awaiting_browser_download";
    else if (!linkedEvents.length) completion = "awaiting_chrome_match";
    else if (linkedEvents.length !== 1 || linkedIds.length !== 1)
      completion = "ambiguous";
    else {
      trackedDownloadId = linkedIds[0];
      const item = withAssociation.downloads.find(
        (download) => download.downloadId === trackedDownloadId,
      );
      completion =
        item?.state === "complete" ||
        item?.state === "interrupted" ||
        item?.state === "in_progress"
          ? item.state
          : "awaiting_chrome_match";
    }
  }
  let status = withAssociation.status;
  let interruptionReason = withAssociation.interruptionReason;
  if (status === "armed" || status === "action_observed") {
    if (completion === "complete") status = "completed";
    else if (completion === "interrupted") {
      status = "interrupted";
      interruptionReason = "matched_download_interrupted";
    }
  }
  return FlowGalleryDownloadDiagnosticSchema.parse({
    ...withAssociation,
    status,
    detailDownloadCompletionStatus: completion,
    ...(trackedDownloadId === undefined ? {} : { detailTrackedDownloadId: trackedDownloadId }),
    ...(interruptionReason ? { interruptionReason } : {}),
  });
}

function publicSnapshot(
  value: FlowGalleryDownloadDiagnostic | undefined,
): FlowGalleryDownloadDiagnostic | { status: "idle" } {
  if (!value) return { status: "idle" };
  const parsed = FlowGalleryDownloadDiagnosticSchema.safeParse(value);
  if (!parsed.success) return { status: "idle" };
  return parsed.data;
}

export class FlowClipDownloadStartError extends Error {
  readonly code: FlowClipDownloadFailureCode;
  readonly stage: FlowClipDownloadFailureStage;
  readonly inputAttempted: boolean;

  constructor(code: FlowClipDownloadFailureCode, stage: FlowClipDownloadFailureStage, inputAttempted: boolean) {
    super(code);
    this.name = "FlowClipDownloadStartError";
    this.code = code;
    this.stage = stage;
    this.inputAttempted = inputAttempted;
  }
}

/** One-shot Flow Gallery observation; stores only bounded, sanitized session evidence. */
export function createFlowDownloadDiagnosticManager(
  dependencies: FlowDownloadDiagnosticDependencies,
) {
  const now = dependencies.now ?? Date.now;
  const createSessionId =
    dependencies.createSessionId ?? (() => crypto.randomUUID());
  let current: FlowGalleryDownloadDiagnostic | undefined;
  let projectVideoImportJob: FlowProjectVideoImportJob | undefined;
  let projectVideoImportStarting = false;
  let detailClipImportActive = false;
  let createdListenerRegistered = false;
  let changedListenerRegistered = false;
  let metadataRequestCount = 0;
  let automaticDownloadStarting = false;
  let eventQueue: Promise<void> = Promise.resolve();
  // Raw URLs are kept only in bounded worker memory for exact equality checks.
  // Persisted diagnostics contain fingerprints, allowlisted schemes, and IDs only.
  const transientPageDownloadUrls = new Map<string, string>();
  const transientChromeDownloadUrls = new Map<
    number,
    { url?: string; finalUrl?: string }
  >();
  const isGalleryImportActive = () =>
    projectVideoImportStarting ||
    projectVideoImportJob?.progress.status === "scanning";
  const isAnyClipImportActive = () =>
    detailClipImportActive || isGalleryImportActive();
  const isFlowDownloadActive = () =>
    automaticDownloadStarting ||
    isActive(current) ||
    current?.detailDownloadCompletionStatus === "in_progress" ||
    Boolean(
      current?.automaticDownload &&
        current.detailDownloadCompletionStatus !== "complete" &&
        current.detailDownloadCompletionStatus !== "interrupted",
    );
  const metadataRequests = new Map<
    string,
    {
      token: string;
      frameId: string;
      offsetMs: number;
      responseReceived: boolean;
      responseMimeCategory: FlowDetailMetadataMimeCategory;
    }
  >();
  const clearTransientUrlComparisons = () => {
    transientPageDownloadUrls.clear();
    transientChromeDownloadUrls.clear();
  };
  const exactDownloadIdsForUrl = (rawUrl: string) =>
    [...transientChromeDownloadUrls.entries()]
      .filter(([, item]) => item.url === rawUrl || item.finalUrl === rawUrl)
      .map(([downloadId]) => downloadId)
      .slice(0, 6);
  const resolveDetailFileLocation = async (
    record: FlowGalleryDownloadDiagnostic,
  ) => {
    if (record.captureMode !== "detail_clip") return record;
    const eligibleEvents = record.pageDownloads.filter(
      (event) => event.frameMatched && event.afterAction,
    );
    const exactEvents = eligibleEvents.filter(
      (event) => (event.exactDownloadIds ?? []).length > 0,
    );
    const ids = [
      ...new Set(exactEvents.flatMap((event) => event.exactDownloadIds ?? [])),
    ];
    if (exactEvents.length > 1 || ids.length > 1)
      return {
        ...record,
        detailFileResolutionStatus: "ambiguous" as const,
      };
    const downloadId = ids[0];
    if (downloadId === undefined || exactEvents.length !== 1)
      return record;
    const candidate = record.downloads.find(
      (download) => download.downloadId === downloadId,
    );
    if (!candidate || candidate.state !== "complete")
      return {
        ...record,
        detailTrackedDownloadId: downloadId,
        detailFileResolutionStatus: "not_checked" as const,
      };
    if (!dependencies.downloads.search)
      return {
        ...record,
        detailTrackedDownloadId: downloadId,
        detailFileResolutionStatus: "unavailable" as const,
      };
    try {
      const matches = await dependencies.downloads.search({ id: downloadId });
      if (matches.length !== 1)
        return {
          ...record,
          detailTrackedDownloadId: downloadId,
          detailFileResolutionStatus: matches.length ? "ambiguous" as const : "unavailable" as const,
        };
      const item = matches[0]!;
      const status: NonNullable<
        FlowGalleryDownloadDiagnostic["detailFileResolutionStatus"]
      > =
        item.state === "complete" &&
        typeof item.filename === "string" &&
        item.filename.length > 0 &&
        item.exists === true
          ? "resolved"
          : item.state === "complete" && item.exists === false
            ? "missing"
            : "unavailable";
      return {
        ...record,
        detailTrackedDownloadId: downloadId,
        detailFileResolutionStatus: status,
      };
    } catch {
      return {
        ...record,
        detailTrackedDownloadId: downloadId,
        detailFileResolutionStatus: "unavailable" as const,
      };
    }
  };
  const loaded = dependencies.storage
    .get(FLOW_GALLERY_DIAGNOSTIC_STORAGE_KEY)
    .then((stored) => {
      const parsed = FlowGalleryDownloadDiagnosticSchema.safeParse(
        stored[FLOW_GALLERY_DIAGNOSTIC_STORAGE_KEY],
      );
      current = parsed.success ? parsed.data : undefined;
    })
    .catch(() => undefined);

  const enqueue = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = eventQueue.then(operation, operation);
    eventQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const persist = async (next: FlowGalleryDownloadDiagnostic) => {
    const enriched =
      next.captureMode === "detail_clip" && next.detailMetadataCaptureEnabled
        ? {
            ...next,
            detailMetadataPendingRequests: metadataRequests.size,
            detailMetadataFields: (next.detailMetadataFields ?? []).map((field) => ({
              ...field,
              routeEquality:
                field.valueKind === "uuid" &&
                field.valueFingerprint ===
                  next.assetRoutePreflight?.assetPathFingerprint,
              requestResponseEquality: (next.detailMetadataFields ?? []).some(
                (other) =>
                  other.requestToken === field.requestToken &&
                  other.role !== field.role &&
                  other.valueFingerprint === field.valueFingerprint,
              ),
              blobPathEquality: next.pageDownloads.some(
                (event) =>
                  event.frameMatched &&
                  event.afterAction &&
                  event.assetPathFingerprint === field.valueFingerprint,
              ),
            })),
          }
        : next;
    current = FlowGalleryDownloadDiagnosticSchema.parse(enriched);
    await dependencies.storage.set({
      [FLOW_GALLERY_DIAGNOSTIC_STORAGE_KEY]: current,
    });
    return current;
  };

  const incrementMetadataCounter = (
    record: FlowGalleryDownloadDiagnostic,
    key: keyof Pick<
      FlowGalleryDownloadDiagnostic,
      | "detailMetadataEligibleRequestsSeen"
      | "detailMetadataRequestsAdmitted"
      | "detailMetadataRequestsOmittedAtCap"
      | "detailMetadataRequestBodiesAvailable"
      | "detailMetadataRequestBodiesRead"
      | "detailMetadataResponseBodiesAttempted"
      | "detailMetadataResponseBodiesRead"
      | "detailMetadataJsonParseSucceeded"
      | "detailMetadataJsonParseFailed"
      | "detailMetadataBodiesUnavailable"
      | "detailMetadataBodiesFailed"
      | "detailMetadataBodiesUnsupported"
      | "detailMetadataBodiesFiltered"
      | "detailMetadataParsedBodiesWithoutIdentityFields"
      | "detailMetadataBodiesOmitted"
    >,
    amount = 1,
  ): FlowGalleryDownloadDiagnostic => ({
    ...record,
    [key]: Math.min(100, ((record[key] as number | undefined) ?? 0) + amount),
  });

  const appendMetadataBodyDiagnostic = (
    record: FlowGalleryDownloadDiagnostic,
    diagnostic: FlowDetailMetadataBodyDiagnostic,
  ): FlowGalleryDownloadDiagnostic => ({
    ...record,
    detailMetadataBodyDiagnostics: [
      ...(record.detailMetadataBodyDiagnostics ?? []),
      diagnostic,
    ].slice(0, 24),
  });

  const appendPendingMetadataDiagnostics = (
    record: FlowGalleryDownloadDiagnostic,
  ): FlowGalleryDownloadDiagnostic => {
    let next = record;
    for (const context of metadataRequests.values()) {
      next = appendMetadataBodyDiagnostic(next, {
        stage: "response_body",
        mimeCategory: context.responseMimeCategory,
        formatCategory: "unavailable",
        parseFailureCategory: "unavailable",
      });
    }
    return next;
  };

  const inspectMetadataBody = async (
    record: FlowGalleryDownloadDiagnostic,
    requestToken: string,
    role: "request_body" | "response_body",
    body: unknown,
    offsetMs: number,
    options: {
      mimeCategory?: FlowDetailMetadataMimeCategory;
      base64Encoded?: boolean;
    } = {},
  ) => {
    const inspection = await inspectFlowDetailMetadataBody(
      record.sessionId,
      requestToken,
      role,
      body,
      offsetMs,
      options,
    );
    let next = appendMetadataBodyDiagnostic(record, inspection.diagnostic);
    if (inspection.status === "parsed") {
      next = incrementMetadataCounter(next, "detailMetadataJsonParseSucceeded");
      if (!inspection.fields.length)
        next = incrementMetadataCounter(
          next,
          "detailMetadataParsedBodiesWithoutIdentityFields",
        );
    } else if (inspection.status === "invalid_json") {
      next = incrementMetadataCounter(next, "detailMetadataJsonParseFailed");
    } else if (inspection.status === "too_large") {
      next = incrementMetadataCounter(next, "detailMetadataBodiesFiltered");
      next = incrementMetadataCounter(next, "detailMetadataBodiesOmitted");
    } else if (
      inspection.status === "unsupported_encoding" ||
      inspection.status === "unsupported_mime"
    ) {
      next = incrementMetadataCounter(next, "detailMetadataBodiesUnsupported");
      next = incrementMetadataCounter(next, "detailMetadataBodiesOmitted");
    } else {
      next = incrementMetadataCounter(next, "detailMetadataBodiesUnavailable");
      next = incrementMetadataCounter(next, "detailMetadataBodiesOmitted");
    }
    if (inspection.fields.length) {
      const fields = [...(next.detailMetadataFields ?? []), ...inspection.fields]
        .slice(0, 48)
        .map((field, index) => ({
          ...field,
          fieldToken: `metadata-field-${index + 1}` as const,
        }));
      next = { ...next, detailMetadataFields: fields };
    }
    return persist(next);
  };

  const detachCompletedWhenDrained = async (
    record: FlowGalleryDownloadDiagnostic,
  ) => {
    if (record.status === "completed" && metadataRequests.size === 0) {
      await detach(record);
      clearTransientUrlComparisons();
    }
  };

  const uninstall = async (record: FlowGalleryDownloadDiagnostic) => {
    await dependencies.scripting
      .executeScript({
        target: { tabId: record.tabId, documentIds: [record.documentId] },
        world: "ISOLATED",
        func: uninstallFlowGalleryDownloadObserver,
        args: [record.sessionId],
      })
      .catch(() => undefined);
  };

  const detach = async (record: FlowGalleryDownloadDiagnostic) => {
    await uninstall(record);
    await dependencies.debugger
      .detach({ tabId: record.tabId })
      .catch(() => undefined);
    await dependencies.alarms.clear(FLOW_GALLERY_DIAGNOSTIC_ALARM);
  };

  const finish = async (
    record: FlowGalleryDownloadDiagnostic,
    status: "completed" | "interrupted" | "expired" | "stopped",
  ) => {
    if (!isActive(record)) return record;
    let finalRecord = record;
    if (metadataRequests.size > 0) {
      const pending = metadataRequests.size;
      finalRecord = appendPendingMetadataDiagnostics(finalRecord);
      metadataRequests.clear();
      finalRecord = incrementMetadataCounter(
        finalRecord,
        "detailMetadataBodiesUnavailable",
        pending,
      );
      finalRecord = incrementMetadataCounter(
        finalRecord,
        "detailMetadataBodiesOmitted",
        pending,
      );
    }
    const next = await persist({ ...finalRecord, status });
    await detach(next);
    if (
      status !== "interrupted" ||
      next.interruptionReason !== "debugger_detached"
    )
      clearTransientUrlComparisons();
    return next;
  };

  const verifySelectedFlowTarget = async () => {
    const selected = await dependencies.repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (
      !selected ||
      selected.verification !== "verified" ||
      selected.connectionState !== "verified" ||
      !binding ||
      binding.provider !== "Flow" ||
      binding.tabId !== selected.tabId ||
      binding.canonicalTarget !== selected.canonicalTarget ||
      binding.extensionBuildId !== BUILD_ID ||
      binding.connectorBuildId !== BUILD_ID ||
      binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
      binding.connectorProtocolVersion !== 1
    )
      throw new Error("flow_target_not_currently_verified");
    const tab = await dependencies.tabs.get(selected.tabId);
    const currentTab = flowTabFromUrl(
      tab.id ?? selected.tabId,
      tab.title ?? "",
      tab.url,
    );
    if (
      !sameFlowDocument(
        {
          id: selected.tabId,
          projectId: binding.projectId,
          canonicalTarget: selected.canonicalTarget,
        },
        currentTab,
      )
    )
      throw new Error("flow_target_document_changed");
    return { selected, binding, verifiedTabUrl: tab.url };
  };

  const projectVideoImportSnapshot = (
    job = projectVideoImportJob,
  ): FlowProjectVideosImportProgress => {
    if (!job)
      return FlowProjectVideosImportProgressSchema.parse({
        status: "idle",
        discovered: 0,
        imported: 0,
        alreadyPresent: 0,
        unresolved: 0,
        scanCompleteness: "pending",
        cancelRequested: false,
        unresolvedCards: [],
      });
    return FlowProjectVideosImportProgressSchema.parse({
      ...job.progress,
      cancelRequested: job.cancelRequested,
      unresolvedCards: job.progress.unresolvedCards.slice(0, 32),
    });
  };

  const addProjectVideoUnresolved = (
    job: FlowProjectVideoImportJob,
    card: FlowProjectVideoCard,
    reason: string,
  ) => {
    const key = card.assetId
      ? `asset:${card.assetId}`
      : card.routeStatus === "unique" && card.detailRoute
        ? `clip:${card.detailRoute.clipId}`
        : undefined;
    if (key && job.unresolvedKeys.has(key)) return false;
    if (key) job.unresolvedKeys.add(key);
    else job.unresolvedObservationSequence += 1;
    const countKey = key ?? `unkeyed:${job.unresolvedObservationSequence}:${reason}`;
    job.unresolvedKeys.add(countKey);
    job.candidates.delete(card.assetId ?? "");
    if (card.nativeCardToken)
      job.nativeCandidates.delete(card.nativeCardToken);
    job.progress = {
      ...job.progress,
      discovered: Math.min(
        FLOW_PROJECT_VIDEO_IMPORT_MAX_CARDS,
        job.candidates.size + job.nativeCandidates.size + job.unresolvedKeys.size,
      ),
      unresolved: Math.min(
        FLOW_PROJECT_VIDEO_IMPORT_MAX_CARDS,
        job.unresolvedKeys.size,
      ),
      unresolvedCards: [
        ...job.progress.unresolvedCards,
        { title: card.title.slice(0, 200), reason },
      ].slice(0, 32),
    };
    return !key;
  };

  const importPageResult = async (
    job: FlowProjectVideoImportJob,
    binding: NonNullable<Awaited<ReturnType<typeof verifySelectedFlowTarget>>["binding"]>,
    action: "start" | "snapshot" | "scroll" | "restore" | "open",
    assetId?: string,
    options: { nativeCardToken?: string; scrollTop?: number } = {},
  ) => {
    const injected = await dependencies.scripting.executeScript({
      target: {
        tabId: job.selectedTabId,
        documentIds: [binding.documentId],
      },
      world: "ISOLATED",
      func: inspectFlowProjectVideosInPage,
      args: [{
        projectId: job.progress.projectId!,
        action,
        scanId: job.progress.jobId!,
        documentId: binding.documentId,
        ...(job.oneCardCheck ? { maxCards: 1 } : {}),
        ...(assetId ? { assetId } : {}),
        ...options,
      }],
    });
    if (injected[0]?.documentId !== binding.documentId)
      throw new Error("flow_project_video_import_document_changed");
    const parsed = FlowProjectVideosPageResultSchema.safeParse(
      injected[0]?.result,
    );
    if (!parsed.success) throw new Error("flow_project_video_gallery_unavailable");
    return parsed.data;
  };

  const verifyImportTarget = async (
    job: FlowProjectVideoImportJob,
    revalidate = false,
  ) => {
    if (revalidate) {
      if (!dependencies.revalidateFlowConnection)
        throw new Error("flow_project_video_import_connection_lost");
      const connection = await dependencies.revalidateFlowConnection();
      if (!connection.ok)
        throw new Error("flow_project_video_import_connection_lost");
    }
    const target = await verifySelectedFlowTarget();
    if (
      target.selected.tabId !== job.selectedTabId ||
      target.binding.projectId !== job.progress.projectId ||
      target.selected.canonicalTarget !== job.canonicalTarget
    )
      throw new Error("flow_project_video_import_navigation_changed");
    return target;
  };

  const mergeProjectVideoSnapshot = (
    job: FlowProjectVideoImportJob,
    page: FlowProjectVideosPageResult,
    documentId: string,
  ) => {
    let traversalUnavailable = false;
    let traversalAmbiguous = false;
    const byAsset = new Map<string, FlowProjectVideoCard[]>();
    const byNativeToken = new Map<string, FlowProjectVideoCard[]>();
    for (const card of job.oneCardCheck ? page.cards.slice(0, 1) : page.cards) {
      if (!card.assetId || card.assetStatus !== "unique") {
        if (!card.nativeCardToken) {
          addProjectVideoUnresolved(
            job,
            card,
            "native_traversal_evidence_unavailable",
          );
          traversalUnavailable = true;
          continue;
        }
        const group = byNativeToken.get(card.nativeCardToken) ?? [];
        group.push(card);
        byNativeToken.set(card.nativeCardToken, group);
        continue;
      }
      const grouped = byAsset.get(card.assetId) ?? [];
      grouped.push(card);
      byAsset.set(card.assetId, grouped);
    }
    for (const [assetId, grouped] of byAsset) {
      const evidenceKeys = new Set(
        grouped.map((card) => `${card.observationFingerprint ?? ""}\n${card.routeStatus}\n${card.detailRoute?.detailUrl ?? ""}`),
      );
      if (evidenceKeys.size > 1) {
        for (const card of grouped)
          addProjectVideoUnresolved(job, card, "asset_identity_ambiguous");
        throw new Error("flow_project_video_import_identity_ambiguous");
      }
      const card = grouped[0]!;
      if (card.routeStatus === "ambiguous")
        throw new Error("flow_project_video_import_identity_ambiguous");
      if (card.routeStatus === "mismatch") {
        addProjectVideoUnresolved(job, card, "detail_route_project_mismatch");
        continue;
      }
      const previous = job.candidates.get(assetId);
      if (
        previous &&
        previous.observationFingerprint &&
        card.observationFingerprint &&
        previous.observationFingerprint !== card.observationFingerprint
      )
        throw new Error("flow_project_video_import_identity_ambiguous");
      if (!job.unresolvedKeys.has(`asset:${assetId}`))
        job.candidates.set(assetId, card);
    }
    for (const [token, group] of byNativeToken) {
      if (group.length !== 1) {
        traversalAmbiguous = true;
        for (const card of group)
          addProjectVideoUnresolved(job, card, "native_traversal_ambiguous");
        continue;
      }
      if (!job.nativeCandidates.has(token))
        job.nativeCandidates.set(token, {
          card: group[0]!,
          scrollTop: page.scroll.top,
          documentId,
        });
    }
    job.progress = {
      ...job.progress,
      discovered: Math.min(
        FLOW_PROJECT_VIDEO_IMPORT_MAX_CARDS,
        job.candidates.size + job.nativeCandidates.size + job.unresolvedKeys.size,
      ),
      unresolved: Math.min(
        FLOW_PROJECT_VIDEO_IMPORT_MAX_CARDS,
        job.unresolvedKeys.size,
      ),
    };
    return { traversalUnavailable, traversalAmbiguous };
  };

  const sleepForImport = (milliseconds: number) =>
    dependencies.wait
      ? dependencies.wait(milliseconds)
      : new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  const resolveProjectVideoCandidate = async (
    job: FlowProjectVideoImportJob,
    galleryBinding: NonNullable<Awaited<ReturnType<typeof verifySelectedFlowTarget>>["binding"]>,
    card: FlowProjectVideoCard,
  ) => {
    const projectId = job.progress.projectId!;
    if (!card.assetId) throw new Error("flow_project_video_import_identity_missing");
    if (card.routeStatus === "unique" && card.detailRoute) {
      if (card.detailRoute.projectId !== projectId)
        throw new Error("flow_project_video_import_card_route_mismatch");
      return {
        projectId,
        clipId: card.detailRoute.clipId.toLowerCase(),
        detailUrl: card.detailRoute.detailUrl,
        title: card.title,
        thumbnail: card.thumbnail,
        galleryImportMethod: "source_asset" as const,
        galleryAssetId: card.assetId,
        galleryIdentityEvidence: "same_card_detail_link" as const,
      };
    }
    if (card.routeStatus !== "none")
      throw new Error("flow_project_video_import_card_route_mismatch");

    let opened: FlowProjectVideosPageResult | undefined;
    let page = await importPageResult(job, galleryBinding, "start");
    if (page.status !== "ready" || page.projectId !== projectId)
      throw new Error("flow_project_video_import_gallery_unavailable");
    for (let step = 0; step <= FLOW_PROJECT_VIDEO_IMPORT_MAX_SCROLL_STEPS; step += 1) {
      if (job.cancelRequested)
        throw new Error("flow_project_video_import_cancelled");
      const target = await verifyImportTarget(job);
      page = await importPageResult(job, target.binding, "snapshot");
      if (page.status !== "ready")
        throw new Error("flow_project_video_import_gallery_unavailable");
      const matches = page.cards.filter((candidate) => candidate.assetId === card.assetId);
      if (matches.length > 1)
        throw new Error("flow_project_video_import_identity_ambiguous");
      if (matches.length === 1) {
        const current = matches[0]!;
        if (
          current.observationFingerprint !== card.observationFingerprint ||
          current.assetStatus !== "unique" ||
          current.routeStatus !== card.routeStatus
        )
          throw new Error("flow_project_video_import_identity_ambiguous");
        opened = await importPageResult(job, target.binding, "open", card.assetId);
        break;
      }
      if (page.scroll.atBottom || !page.scroll.containerFound || step === FLOW_PROJECT_VIDEO_IMPORT_MAX_SCROLL_STEPS)
        break;
      const moved = await importPageResult(job, target.binding, "scroll");
      if (moved.status !== "ready" || !moved.scroll.moved) break;
      await sleepForImport(150);
    }
    if (!opened)
      throw new Error("flow_project_video_import_card_open_unavailable");
    if (opened.status === "blocked") {
      if (opened.reason === "card_ambiguous" || opened.reason === "route_ambiguous")
        throw new Error("flow_project_video_import_identity_ambiguous");
      throw new Error("flow_project_video_import_card_open_unavailable");
    }
    if (opened.status === "route" && opened.card?.detailRoute) {
      return {
        projectId,
        clipId: opened.card.detailRoute.clipId.toLowerCase(),
        detailUrl: opened.card.detailRoute.detailUrl,
        title: opened.card.title || card.title,
        thumbnail: opened.card.thumbnail,
        galleryImportMethod: "source_asset" as const,
        galleryAssetId: card.assetId,
        galleryIdentityEvidence: "same_card_detail_link" as const,
      };
    }
    if (opened.status !== "opened")
      throw new Error("flow_project_video_import_card_open_unavailable");

    let resolved:
      | {
          projectId: string;
          clipId: string;
          detailUrl: string;
          title: string;
          thumbnail: FlowClipThumbnailMetadata;
          galleryImportMethod: "source_asset";
          galleryAssetId: string;
          galleryIdentityEvidence: "detail_selected_asset_match";
          detailSelectedAssetId: string;
        }
      | undefined;
    let resolutionFailure = "flow_project_video_import_detail_route_not_observed";
    let detailReadCompleted = false;
    let restorationFailure: string | undefined;
    try {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (job.cancelRequested) break;
        const tab = await dependencies.tabs.get(job.selectedTabId);
        const current = flowTabFromUrl(
          tab.id ?? job.selectedTabId,
          tab.title ?? "",
          tab.url,
        );
        if (!current || current.canonicalTarget !== job.canonicalTarget)
          throw new Error("flow_project_video_import_navigation_changed");
        const identity = tab.url
          ? flowClipDetailIdentityFromUrl(tab.url)
          : undefined;
        if (identity?.projectId === projectId) {
          const detailTarget = await verifyImportTarget(job, true);
          const [metadataResult, assetResult] = await Promise.all([
            dependencies.scripting.executeScript({
              target: {
                tabId: job.selectedTabId,
                documentIds: [detailTarget.binding.documentId],
              },
              world: "ISOLATED",
              func: inspectCurrentFlowClipInPage,
              args: [],
            }),
            dependencies.scripting.executeScript({
              target: {
                tabId: job.selectedTabId,
                documentIds: [detailTarget.binding.documentId],
              },
              world: "ISOLATED",
              func: prepareFlowClipDownloadInPage,
              args: [projectId, identity.clipId, null, false, true],
            }),
          ]);
          if (
            metadataResult[0]?.documentId !== detailTarget.binding.documentId ||
            assetResult[0]?.documentId !== detailTarget.binding.documentId
          )
            throw new Error("flow_project_video_import_document_changed");
          const metadata = FlowClipPageMetadataSchema.safeParse(
            metadataResult[0]?.result,
          );
          const assetIdentity = FlowClipAssetIdentitySchema.safeParse(
            assetResult[0]?.result,
          );
          if (
            !metadata.success ||
            !assetIdentity.success ||
            metadata.data.projectId !== projectId ||
            metadata.data.clipId.toLowerCase() !== identity.clipId ||
            assetIdentity.data.assetId !== card.assetId
          ) {
            resolutionFailure = "flow_project_video_import_identity_mismatch";
          } else {
            resolved = {
              projectId,
              clipId: identity.clipId,
              detailUrl: identity.detailUrl,
              title: metadata.data.title || card.title,
              thumbnail: card.thumbnail.available
                ? card.thumbnail
                : metadata.data.thumbnail,
              galleryImportMethod: "source_asset",
              galleryAssetId: card.assetId,
              galleryIdentityEvidence: "detail_selected_asset_match",
              detailSelectedAssetId: assetIdentity.data.assetId,
            };
            detailReadCompleted = true;
          }
          break;
        }
        await sleepForImport(150);
      }
    } finally {
      const currentTab = await dependencies.tabs.get(job.selectedTabId).catch(() => undefined);
      const currentRoute = currentTab?.url
        ? flowTabFromUrl(job.selectedTabId, currentTab.title ?? "", currentTab.url)
        : undefined;
      const currentIdentity = currentTab?.url
        ? flowClipDetailIdentityFromUrl(currentTab.url)
        : undefined;
      if (detailReadCompleted && (!currentRoute || currentRoute.canonicalTarget !== job.canonicalTarget)) {
        restorationFailure = "flow_project_video_import_navigation_changed";
      } else if (detailReadCompleted && currentIdentity?.projectId === projectId) {
        try {
          if (!dependencies.tabs.update) {
            restorationFailure = "flow_project_video_import_navigation_changed";
          } else {
            await dependencies.tabs.update(job.selectedTabId, { url: job.galleryUrl });
            const restored = await verifyImportTarget(job, true);
            const gallery = await importPageResult(job, restored.binding, "start");
            if (gallery.status !== "ready" || gallery.projectId !== projectId)
              restorationFailure = "flow_project_video_import_navigation_changed";
          }
        } catch {
          restorationFailure = "flow_project_video_import_navigation_changed";
        }
      }
    }
    if (restorationFailure) throw new Error(restorationFailure);
    if (job.cancelRequested) throw new Error("flow_project_video_import_cancelled");
    if (!resolved) throw new Error(resolutionFailure);
    return resolved;
  };

  const resolveNativeNavigationCandidate = async (
    job: FlowProjectVideoImportJob,
    candidate: { card: FlowProjectVideoCard; scrollTop: number; documentId: string },
  ) => {
    const projectId = job.progress.projectId!;
    const token = candidate.card.nativeCardToken;
    if (!token)
      throw new Error("flow_project_video_import_native_traversal_unavailable");
    let resolved:
      | {
          projectId: string;
          clipId: string;
          detailUrl: string;
          title: string;
          thumbnail: FlowClipThumbnailMetadata;
          galleryImportMethod: "native_card_navigation";
          detailSelectedAssetId: string;
        }
      | undefined;
    let restorationFailure: string | undefined;
    let detailRouteObserved = false;
    let detailConnectionReady = false;
    let detailDocumentRead = false;
    let selectedDetailIdentityMissing = false;
    let detailPageMayHaveOpened = false;
    let detailReadCompleted = false;
    let detailRouteRejected = false;
    let detailConnectionRouteMismatch = false;
    try {
      const galleryTarget = await verifyImportTarget(job);
      const restoredPosition = await importPageResult(
        job,
        galleryTarget.binding,
        "restore",
        undefined,
        { scrollTop: candidate.scrollTop },
      );
      if (restoredPosition.status !== "ready" || restoredPosition.projectId !== projectId)
        throw new Error("flow_project_video_import_gallery_unavailable");
      if (galleryTarget.binding.documentId !== candidate.documentId)
        throw new Error("flow_project_video_import_native_binding_document_changed");
      const gallery = await importPageResult(job, galleryTarget.binding, "snapshot");
      if (gallery.status !== "ready" || gallery.projectId !== projectId)
        throw new Error("flow_project_video_import_gallery_unavailable");
      const matches = gallery.cards.filter(
        (card) => card.nativeCardToken === token,
      );
      // This snapshot is the required rediscovery point. A zero match means the
      // exact bound node was replaced; never substitute another same-title row.
      if (matches.length === 0)
        throw new Error("flow_project_video_import_native_binding_stale");
      if (matches.length > 1)
        throw new Error("flow_project_video_import_native_traversal_ambiguous");
      let opened: FlowProjectVideosPageResult;
      try {
        opened = await importPageResult(
          job,
          galleryTarget.binding,
          "open",
          undefined,
          { nativeCardToken: token },
        );
      } catch {
        throw new Error("flow_project_video_import_native_open_outcome_unknown");
      }
      if (opened.status !== "opened" || !opened.card) {
        if (opened.reason === "native_open_control_unavailable")
          throw new Error("flow_project_video_import_native_open_not_attempted");
        if (opened.reason === "native_binding_stale")
          throw new Error("flow_project_video_import_native_binding_stale");
        if (opened.reason === "card_ambiguous")
          throw new Error("flow_project_video_import_native_traversal_ambiguous");
        throw new Error(
          "flow_project_video_import_native_open_outcome_unknown",
        );
      }
      detailPageMayHaveOpened = true;

      let previousDetailRoute = "";
      let stableRouteReads = 0;
      let previousStableRead = "";
      let stableIdentityReads = 0;
      const detailWaitDeadline = Date.now() + FLOW_PROJECT_VIDEO_DETAIL_WAIT_DEADLINE_MS;
      for (
        let attempt = 0;
        attempt < 40 && Date.now() < detailWaitDeadline;
        attempt += 1
      ) {
        if (job.cancelRequested)
          throw new Error("flow_project_video_import_cancelled");
        const tab = await dependencies.tabs.get(job.selectedTabId);
        const current = flowTabFromUrl(
          tab.id ?? job.selectedTabId,
          tab.title ?? "",
          tab.url,
        );
        if (!current || current.canonicalTarget !== job.canonicalTarget)
          throw new Error("flow_project_video_import_navigation_changed");
        const identity = tab.url
          ? flowClipDetailIdentityFromUrl(tab.url)
          : undefined;
        if (!identity || identity.projectId !== projectId) {
          if (tab.url) {
            try {
              detailRouteRejected ||= /\/edit(?:\/|$)/i.test(new URL(tab.url).pathname);
            } catch {
              // tab.url came from Chrome; malformed values remain untrusted.
            }
          }
          previousDetailRoute = "";
          stableRouteReads = 0;
          await sleepForImport(150);
          continue;
        }
        detailRouteObserved = true;
        stableRouteReads = identity.detailUrl === previousDetailRoute
          ? stableRouteReads + 1
          : 1;
        previousDetailRoute = identity.detailUrl;
        if (stableRouteReads < 2) {
          await sleepForImport(150);
          continue;
        }

        let detailTarget: Awaited<ReturnType<typeof verifyImportTarget>>;
        try {
          detailTarget = await verifyImportTarget(job, true);
          detailConnectionReady = true;
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          if (
            code.includes("connection_lost") ||
            code.includes("target_not_currently_verified")
          ) {
            await sleepForImport(150);
            continue;
          }
          throw error;
        }

        const connectedIdentity = detailTarget.verifiedTabUrl
          ? flowClipDetailIdentityFromUrl(detailTarget.verifiedTabUrl)
          : undefined;
        if (
          !connectedIdentity ||
          connectedIdentity.projectId !== projectId ||
          connectedIdentity.detailUrl !== identity.detailUrl
        ) {
          detailConnectionRouteMismatch = true;
          detailConnectionReady = false;
          await sleepForImport(150);
          continue;
        }

        let metadataResult: Awaited<ReturnType<typeof dependencies.scripting.executeScript>>;
        let assetResult: Awaited<ReturnType<typeof dependencies.scripting.executeScript>>;
        try {
          [metadataResult, assetResult] = await Promise.all([
            dependencies.scripting.executeScript({
              target: {
                tabId: job.selectedTabId,
                documentIds: [detailTarget.binding.documentId],
              },
              world: "ISOLATED",
              func: inspectCurrentFlowClipInPage,
              args: [],
            }),
            dependencies.scripting.executeScript({
              target: {
                tabId: job.selectedTabId,
                documentIds: [detailTarget.binding.documentId],
              },
              world: "ISOLATED",
              func: prepareFlowClipDownloadInPage,
              args: [projectId, connectedIdentity.clipId, null, false, true],
            }),
          ]);
        } catch {
          detailDocumentRead = false;
          await sleepForImport(150);
          continue;
        }
        if (
          metadataResult[0]?.documentId !== detailTarget.binding.documentId ||
          assetResult[0]?.documentId !== detailTarget.binding.documentId
        ) {
          detailDocumentRead = false;
          await sleepForImport(150);
          continue;
        }
        const metadata = FlowClipPageMetadataSchema.safeParse(
          metadataResult[0]?.result,
        );
        const selectedAsset = FlowClipAssetIdentitySchema.safeParse(
          assetResult[0]?.result,
        );
        if (
          !metadata.success ||
          metadata.data.projectId !== projectId ||
          metadata.data.clipId.toLowerCase() !== connectedIdentity.clipId
        ) {
          detailDocumentRead = false;
          stableIdentityReads = 0;
          previousStableRead = "";
          await sleepForImport(150);
          continue;
        }
        if (!selectedAsset.success) {
          selectedDetailIdentityMissing = true;
          detailDocumentRead = false;
          stableIdentityReads = 0;
          previousStableRead = "";
          await sleepForImport(150);
          continue;
        }
        detailDocumentRead = true;
        const stableRead = `${connectedIdentity.detailUrl}:${connectedIdentity.clipId}:${selectedAsset.data.assetId}:${detailTarget.binding.documentId}`;
        stableIdentityReads = stableRead === previousStableRead
          ? stableIdentityReads + 1
          : 1;
        previousStableRead = stableRead;
        if (stableIdentityReads >= 2) {
          resolved = {
            projectId,
            clipId: connectedIdentity.clipId,
            detailUrl: connectedIdentity.detailUrl,
            title: metadata.data.title || candidate.card.title,
            thumbnail: metadata.data.thumbnail,
            galleryImportMethod: "native_card_navigation",
            detailSelectedAssetId: selectedAsset.data.assetId,
          };
          detailReadCompleted = true;
          break;
        }
        await sleepForImport(150);
      }
    } finally {
      if (detailPageMayHaveOpened && detailReadCompleted) {
      const currentTab = await dependencies.tabs
        .get(job.selectedTabId)
        .catch(() => undefined);
      const currentRoute = currentTab?.url
        ? flowTabFromUrl(job.selectedTabId, currentTab.title ?? "", currentTab.url)
        : undefined;
      const currentIdentity = currentTab?.url
        ? flowClipDetailIdentityFromUrl(currentTab.url)
        : undefined;
      if (!currentRoute || currentRoute.canonicalTarget !== job.canonicalTarget) {
        restorationFailure = "flow_project_video_import_navigation_changed";
      } else {
        try {
          if (currentIdentity?.projectId === projectId) {
            if (!dependencies.tabs.update) {
              restorationFailure = "flow_project_video_import_navigation_changed";
            } else {
              await dependencies.tabs.update(job.selectedTabId, { url: job.galleryUrl });
            }
          }
          let restoredGallery = false;
          for (let attempt = 0; !restorationFailure && attempt < 40; attempt += 1) {
            const restoredTarget = await verifyImportTarget(job, true);
            const position = await importPageResult(
              job,
              restoredTarget.binding,
              "restore",
              undefined,
              { scrollTop: candidate.scrollTop },
            );
            if (position.status === "ready" && position.projectId === projectId) {
              const snapshot = await importPageResult(
                job,
                restoredTarget.binding,
                "snapshot",
              );
              if (snapshot.status === "ready" && snapshot.projectId === projectId) {
                restoredGallery = true;
                break;
              }
            }
            await sleepForImport(150);
          }
          if (!restoredGallery && !restorationFailure)
            restorationFailure = "flow_project_video_import_gallery_unavailable";
        } catch (error) {
          restorationFailure = error instanceof Error &&
            error.message.includes("navigation_changed")
            ? "flow_project_video_import_navigation_changed"
            : "flow_project_video_import_gallery_unavailable";
        }
      }
      }
    }
    if (restorationFailure) throw new Error(restorationFailure);
    if (job.cancelRequested)
      throw new Error("flow_project_video_import_cancelled");
    if (!resolved) {
      if (detailRouteRejected)
        throw new Error("flow_project_video_import_detail_route_rejected");
      if (!detailRouteObserved)
        throw new Error("flow_project_video_import_detail_route_not_observed_by_deadline");
      if (detailConnectionRouteMismatch)
        throw new Error("flow_project_video_import_detail_connection_route_mismatch");
      if (!detailConnectionReady)
        throw new Error("flow_project_video_import_detail_connection_unavailable");
      if (selectedDetailIdentityMissing)
        throw new Error("flow_project_video_import_selected_detail_identity_missing");
      if (!detailDocumentRead)
        throw new Error("flow_project_video_import_detail_page_not_ready");
      throw new Error("flow_project_video_import_detail_identity_unstable");
    }
    return resolved;
  };

  const runProjectVideoImport = async (job: FlowProjectVideoImportJob) => {
    let terminal: FlowProjectVideosImportProgress["status"] = "completed";
    let stopReason: FlowProjectVideosImportProgress["reason"];
    let scanComplete = false;
    try {
      let target = await verifyImportTarget(job);
      const started = await importPageResult(job, target.binding, "start");
      if (started.status !== "ready" || started.projectId !== job.progress.projectId)
        throw new Error(`flow_project_video_import_${started.reason ?? "gallery_unavailable"}`);
      let previousBoundary = "";
      let stableBoundaryReads = 0;
      for (let step = 0; step <= FLOW_PROJECT_VIDEO_IMPORT_MAX_SCROLL_STEPS; step += 1) {
        if (job.cancelRequested) throw new Error("flow_project_video_import_cancelled");
        target = await verifyImportTarget(job);
        const page = await importPageResult(job, target.binding, "snapshot");
        if (page.status === "blocked")
          throw new Error(
            `flow_project_video_import_${page.reason ?? "gallery_unavailable"}`,
          );
        const traversal = mergeProjectVideoSnapshot(job, page, target.binding.documentId);
        if (job.oneCardCheck) {
          if (traversal.traversalUnavailable)
            stopReason = "identity_deduplication_unavailable";
          else if (traversal.traversalAmbiguous)
            stopReason = "ambiguous_identity";
          else if (job.progress.discovered > 0)
            stopReason = "one_card_check_complete";
          else
            stopReason = "coverage_unproven";
          break;
        }
        if (traversal.traversalUnavailable) {
          stopReason = "identity_deduplication_unavailable";
          break;
        }
        if (traversal.traversalAmbiguous) {
          stopReason = "ambiguous_identity";
          break;
        }
        if (page.cardsCapped || job.candidates.size + job.nativeCandidates.size + job.unresolvedKeys.size >= FLOW_PROJECT_VIDEO_IMPORT_MAX_CARDS) {
          stopReason = "bound_reached";
          break;
        }
        if (page.scroll.busy) {
          stableBoundaryReads = 0;
          await sleepForImport(200);
          continue;
        }
        if (!page.scroll.containerFound) {
          stopReason = "coverage_unproven";
          break;
        }
        if (page.scroll.atBottom) {
          const boundary = `${page.scroll.top}:${page.scroll.max}:${job.candidates.size}:${job.nativeCandidates.size}:${job.unresolvedKeys.size}`;
          if (boundary === previousBoundary) stableBoundaryReads += 1;
          else stableBoundaryReads = 1;
          previousBoundary = boundary;
          if (stableBoundaryReads >= FLOW_PROJECT_VIDEO_IMPORT_BOUNDARY_READS) {
            scanComplete = true;
            break;
          }
          await sleepForImport(250);
          continue;
        }
        stableBoundaryReads = 0;
        if (step === FLOW_PROJECT_VIDEO_IMPORT_MAX_SCROLL_STEPS) {
          stopReason = "bound_reached";
          break;
        }
        const scrolled = await importPageResult(job, target.binding, "scroll");
        if (scrolled.status !== "ready" || !scrolled.scroll.moved) {
          stopReason = "coverage_unproven";
          break;
        }
        await sleepForImport(200);
      }

      const candidates = [...job.candidates.values()];
      for (const card of candidates) {
        if (job.cancelRequested) throw new Error("flow_project_video_import_cancelled");
        target = await verifyImportTarget(job);
        let resolved: Awaited<ReturnType<typeof resolveProjectVideoCandidate>>;
        try {
          resolved = await resolveProjectVideoCandidate(job, target.binding, card);
        } catch (error) {
          if (error instanceof Error && error.message.includes("identity_ambiguous"))
            throw error;
          const code = error instanceof Error ? error.message : "";
          const reason = code.includes("identity_mismatch")
            ? "detail_asset_identity_mismatch"
            : code.includes("navigation_changed")
              ? "navigation_changed"
              : code.includes("card_open_unavailable")
                ? "card_open_not_confirmed"
                : code.includes("native_open_not_attempted")
                  ? "native_open_not_attempted"
                  : code.includes("native_open_outcome_unknown")
                    ? "native_open_outcome_unknown"
                : code.includes("detail_route_not_observed")
                  ? "detail_route_not_observed_by_deadline"
                  : code.includes("detail_route_rejected")
                    ? "detail_route_rejected"
                  : code.includes("connection_lost") || code.includes("target_not_currently_verified")
                    ? "detail_connection_unavailable"
                    : code.includes("detail_connection_route_mismatch")
                      ? "detail_connection_route_mismatch"
                    : code.includes("document_changed")
                      ? "detail_document_changed"
                      : code.includes("selected_asset")
                        ? "detail_selected_asset_missing"
                        : code.includes("detail_page")
                          ? "detail_page_not_ready"
                          : "detail_identity_unresolved";
          addProjectVideoUnresolved(job, card, reason);
          if (reason === "navigation_changed") throw error;
          continue;
        }
        const saved = await dependencies.repositories.upsertFlowClipImport({
          ...resolved,
          title: sanitizeFlowProjectVideoTitle(resolved.title),
        });
        job.progress = {
          ...job.progress,
          imported: Math.min(
            FLOW_PROJECT_VIDEO_IMPORT_MAX_CARDS,
            job.progress.imported + (saved.reimported ? 0 : 1),
          ),
          alreadyPresent: Math.min(
            FLOW_PROJECT_VIDEO_IMPORT_MAX_CARDS,
            job.progress.alreadyPresent + (saved.reimported ? 1 : 0),
          ),
        };
      }
      for (const candidate of [...job.nativeCandidates.values()]) {
        if (job.cancelRequested)
          throw new Error("flow_project_video_import_cancelled");
        try {
          const resolved = await resolveNativeNavigationCandidate(job, candidate);
          const saved = await dependencies.repositories.upsertFlowClipImport({
            ...resolved,
            title: sanitizeFlowProjectVideoTitle(resolved.title),
          });
          if (candidate.card.nativeCardToken)
            job.nativeCandidates.delete(candidate.card.nativeCardToken);
          job.progress = {
            ...job.progress,
            imported: Math.min(
              FLOW_PROJECT_VIDEO_IMPORT_MAX_CARDS,
              job.progress.imported + (saved.reimported ? 0 : 1),
            ),
            alreadyPresent: Math.min(
              FLOW_PROJECT_VIDEO_IMPORT_MAX_CARDS,
              job.progress.alreadyPresent + (saved.reimported ? 1 : 0),
            ),
          };
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          if (code.includes("cancelled") || code.includes("navigation_changed"))
            throw error;
          if (code.includes("native_traversal_ambiguous")) {
            addProjectVideoUnresolved(
              job,
              candidate.card,
              "native_card_reacquire_ambiguous",
            );
            terminal = "incomplete";
            scanComplete = false;
            stopReason = "coverage_unproven";
            break;
          }
          if (code.includes("native_binding_stale")) {
            addProjectVideoUnresolved(
              job,
              candidate.card,
              "native_card_binding_stale",
            );
            terminal = "incomplete";
            scanComplete = false;
            stopReason = "coverage_unproven";
            continue;
          }
          if (code.includes("native_binding_document_changed")) {
            for (const staleCandidate of job.nativeCandidates.values()) {
              if (staleCandidate.documentId === candidate.documentId)
                addProjectVideoUnresolved(
                  job,
                  staleCandidate.card,
                  "native_card_binding_stale",
                );
            }
            terminal = "incomplete";
            scanComplete = false;
            stopReason = "coverage_unproven";
            break;
          }
          addProjectVideoUnresolved(
            job,
            candidate.card,
            code.includes("native_open_control_unavailable")
              ? "native_open_control_unavailable"
              : code.includes("native_open_not_attempted")
                ? "native_open_not_attempted"
                : code.includes("native_open_outcome_unknown")
                  ? "native_open_outcome_unknown"
              : code.includes("card_open_unavailable")
                ? "card_open_not_confirmed"
                : code.includes("detail_route_not_observed")
                  ? "detail_route_not_observed_by_deadline"
                  : code.includes("detail_route_rejected")
                    ? "detail_route_rejected"
                  : code.includes("detail_connection_unavailable")
                    ? "detail_connection_unavailable"
                    : code.includes("detail_connection_route_mismatch")
                      ? "detail_connection_route_mismatch"
                    : code.includes("selected_detail_identity_missing")
                      ? "detail_selected_asset_missing"
                      : code.includes("detail_page_not_ready")
                        ? "detail_page_not_ready"
                        : code.includes("detail_identity_unstable")
                          ? "detail_identity_unstable"
                          : code.includes("document_changed")
                            ? "detail_document_changed"
                            : "detail_identity_unresolved",
          );
          terminal = "incomplete";
          scanComplete = false;
          stopReason = "coverage_unproven";
          break;
        }
      }
      if (job.oneCardCheck) {
        if (
          terminal === "completed" &&
          job.progress.imported + job.progress.alreadyPresent === 1 &&
          job.progress.unresolved === 0
        ) {
          scanComplete = false;
          stopReason = "one_card_check_complete";
        } else if (terminal === "completed") {
          terminal = "incomplete";
          scanComplete = false;
          stopReason = stopReason === "one_card_check_complete"
            ? "coverage_unproven"
            : stopReason ?? "coverage_unproven";
        }
      } else if (!scanComplete) terminal = "incomplete";
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const pageFailureReasons = [
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
      ] as const;
      const failureReason = pageFailureReasons.find((reason) =>
        code.endsWith(`_${reason}`),
      );
      if (failureReason)
        job.progress = { ...job.progress, failureReason };
      if (code.includes("cancelled")) {
        terminal = "cancelled";
        stopReason = "cancelled";
      } else if (code.includes("navigation_changed")) {
        terminal = "failed";
        stopReason = "navigation_changed";
      } else if (code.includes("connection_lost") || code.includes("document_changed")) {
        terminal = "failed";
        stopReason = "connection_lost";
      } else if (code.includes("identity_ambiguous") || code.includes("identity_mismatch")) {
        terminal = "failed";
        stopReason = "ambiguous_identity";
      } else if (code.includes("gallery")) {
        terminal = "failed";
        stopReason = "gallery_unavailable";
      } else {
        terminal = "failed";
        stopReason = "coverage_unproven";
      }
      scanComplete = false;
    } finally {
      job.progress = FlowProjectVideosImportProgressSchema.parse({
        ...job.progress,
        status: terminal,
        scanCompleteness: scanComplete ? "complete" : "incomplete",
        ...(stopReason ? { reason: stopReason } : {}),
        cancelRequested: job.cancelRequested,
      });
    }
  };

  async function startProjectVideoImport(options: { singleCardCheck?: boolean } = {}) {
    await loaded;
    if (isAnyClipImportActive())
      throw new Error("flow_project_video_import_already_active");
    if (isFlowDownloadActive())
      throw new Error("flow_project_video_import_download_active");
    const oneCardCheck = options.singleCardCheck === true;
    projectVideoImportStarting = true;
    try {
    const target = await verifySelectedFlowTarget();
    if (!target.verifiedTabUrl)
      throw new Error("flow_project_video_import_gallery_required");
    const galleryTab = flowTabFromUrl(
      target.selected.tabId,
      "",
      target.verifiedTabUrl,
    );
    if (
      !galleryTab ||
      galleryTab.projectId !== target.binding.projectId ||
      flowClipDetailIdentityFromUrl(target.verifiedTabUrl)
    )
      throw new Error("flow_project_video_import_gallery_required");
    if (
      !(await dependencies.permissions.contains({
        permissions: ["scripting", "tabs"],
      }))
    )
      throw new Error("flow_project_video_import_permissions_missing");
    const scanId = crypto.randomUUID();
    const failPreflight = (
      failureReason: NonNullable<FlowProjectVideosImportProgress["failureReason"]>,
    ) => {
      const failedJob: FlowProjectVideoImportJob = {
        progress: FlowProjectVideosImportProgressSchema.parse({
          jobId: scanId,
          projectId: target.binding.projectId,
          scope: oneCardCheck ? "one_card_check" : "full_gallery",
          status: "failed",
          discovered: 0,
          imported: 0,
          alreadyPresent: 0,
          unresolved: 0,
          scanCompleteness: "incomplete",
          cancelRequested: false,
          reason: "gallery_unavailable",
          failureReason,
          unresolvedCards: [],
        }),
        galleryUrl: target.verifiedTabUrl!,
        oneCardCheck,
        selectedTabId: target.selected.tabId,
        canonicalTarget: target.selected.canonicalTarget,
        cancelRequested: false,
        candidates: new Map(),
        nativeCandidates: new Map(),
        unresolvedKeys: new Set(),
        unresolvedObservationSequence: 0,
      };
      projectVideoImportJob = failedJob;
      return projectVideoImportSnapshot(failedJob);
    };
    let initialized: Awaited<ReturnType<typeof dependencies.scripting.executeScript>>;
    try {
      initialized = await dependencies.scripting.executeScript({
        target: {
          tabId: target.selected.tabId,
          documentIds: [target.binding.documentId],
        },
        world: "ISOLATED",
        func: inspectFlowProjectVideosInPage,
        args: [{
          projectId: target.binding.projectId,
          action: "start",
          scanId,
          documentId: target.binding.documentId,
          ...(oneCardCheck ? { maxCards: 1 } : {}),
        }],
      });
    } catch {
      return failPreflight("page_injection_failed");
    }
    if (initialized[0]?.documentId !== target.binding.documentId)
      return failPreflight("document_changed");
    const initial = FlowProjectVideosPageResultSchema.safeParse(
      initialized[0]?.result,
    );
    if (!initial.success) return failPreflight("page_result_invalid");
    if (initial.data.status !== "ready")
      return failPreflight(
        initial.data.status === "blocked"
          ? initial.data.reason ?? "gallery_unavailable"
          : "unexpected_page_status",
      );
    if (initial.data.projectId !== target.binding.projectId)
      return failPreflight("project_mismatch");
    const job: FlowProjectVideoImportJob = {
      progress: {
        jobId: scanId,
        projectId: target.binding.projectId,
        scope: oneCardCheck ? "one_card_check" : "full_gallery",
        status: "scanning",
        discovered: 0,
        imported: 0,
        alreadyPresent: 0,
        unresolved: 0,
        scanCompleteness: "pending",
        cancelRequested: false,
        unresolvedCards: [],
      },
      galleryUrl: target.verifiedTabUrl,
      oneCardCheck,
      selectedTabId: target.selected.tabId,
      canonicalTarget: target.selected.canonicalTarget,
      cancelRequested: false,
      candidates: new Map(),
      nativeCandidates: new Map(),
      unresolvedKeys: new Set(),
      unresolvedObservationSequence: 0,
    };
    projectVideoImportJob = job;
    projectVideoImportStarting = false;
    void runProjectVideoImport(job);
    return projectVideoImportSnapshot(job);
    } finally {
      projectVideoImportStarting = false;
    }
  }

  async function cancelProjectVideoImport() {
    const job = projectVideoImportJob;
    if (!job || job.progress.status !== "scanning")
      return projectVideoImportSnapshot(job);
    job.cancelRequested = true;
    job.progress = { ...job.progress, cancelRequested: true };
    return projectVideoImportSnapshot(job);
  }

  async function getProjectVideoImport() {
    return projectVideoImportSnapshot();
  }

  async function importCurrentClip() {
    if (isAnyClipImportActive())
      throw new Error("flow_project_video_import_active");
    detailClipImportActive = true;
    try {
      return await importCurrentClipNow();
    } finally {
      detailClipImportActive = false;
    }
  }

  async function importCurrentClipNow() {
    const { selected, binding, verifiedTabUrl } =
      await verifySelectedFlowTarget();
    const routeIdentity = verifiedTabUrl
      ? flowClipDetailIdentityFromUrl(verifiedTabUrl)
      : undefined;
    if (!routeIdentity) throw new Error("flow_clip_detail_route_required");
    if (routeIdentity.projectId !== binding.projectId)
      throw new Error("flow_clip_project_mismatch");
    const injected = await dependencies.scripting.executeScript({
      target: {
        tabId: selected.tabId,
        documentIds: [binding.documentId],
      },
      world: "ISOLATED",
      func: inspectCurrentFlowClipInPage,
      args: [],
    });
    if (injected[0]?.documentId !== binding.documentId)
      throw new Error("flow_clip_document_changed");
    const metadata = FlowClipPageMetadataSchema.safeParse(injected[0]?.result);
    if (!metadata.success) throw new Error("flow_clip_identity_missing");
    if (metadata.data.projectId !== binding.projectId)
      throw new Error("flow_clip_project_mismatch");
    if (metadata.data.clipId.toLowerCase() !== routeIdentity.clipId)
      throw new Error("flow_clip_route_identity_mismatch");
    const currentTab = await dependencies.tabs.get(selected.tabId);
    const currentRoute = currentTab.url
      ? flowClipDetailIdentityFromUrl(currentTab.url)
      : undefined;
    if (
      !currentRoute ||
      currentRoute.projectId !== routeIdentity.projectId ||
      currentRoute.clipId !== routeIdentity.clipId
    )
      throw new Error("flow_clip_document_changed");
    const saved = await dependencies.repositories.upsertFlowClipImport({
      projectId: routeIdentity.projectId,
      clipId: routeIdentity.clipId,
      title: metadata.data.title,
      detailUrl: routeIdentity.detailUrl,
      thumbnail: metadata.data.thumbnail,
    });
    return {
      status: "imported" as const,
      reimported: saved.reimported,
      routeVerified: flowClipImportRouteMatches(saved.record),
      record: saved.record,
    };
  }

  async function listImportedClips() {
    return (await dependencies.repositories.listFlowClipImports()).map(
      (record) => ({
        ...record,
        routeVerified:
          FlowClipImportRecordSchema.safeParse(record).success &&
          flowClipImportRouteMatches(record),
      }),
    );
  }

  async function inspectClipDownloadProof(recordId: string) {
    const rows = await dependencies.repositories.listFlowClipImports();
    const row = rows.find((candidate) => candidate.id === recordId);
    if (
      !row ||
      !FlowClipImportRecordSchema.safeParse(row).success ||
      !flowClipImportRouteMatches(row)
    )
      return {
        status: "blocked" as const,
        blocker: "imported_row_missing_or_unverified" as const,
        routeStatus: "not_checked" as const,
        controlStatus: "not_checked" as const,
        outputStatus: "unverified" as const,
      };
    if (!isFlow1080pProofClip(row.clipId))
      return {
        status: "blocked" as const,
        blocker: "clip_not_in_single_row_scope" as const,
        routeStatus: "not_checked" as const,
        controlStatus: "not_checked" as const,
        outputStatus: "unverified" as const,
      };

    let target: Awaited<ReturnType<typeof verifySelectedFlowTarget>>;
    try {
      target = await verifySelectedFlowTarget();
    } catch {
      return {
        status: "blocked" as const,
        blocker: "project_not_currently_verified" as const,
        routeStatus: "not_checked" as const,
        controlStatus: "not_checked" as const,
        outputStatus: "unverified" as const,
      };
    }
    if (target.binding.projectId !== row.projectId)
      return {
        status: "blocked" as const,
        blocker: "project_not_currently_verified" as const,
        routeStatus: "mismatch" as const,
        controlStatus: "not_checked" as const,
        outputStatus: "unverified" as const,
      };
    const routeIdentity = target.verifiedTabUrl
      ? flowClipDetailIdentityFromUrl(target.verifiedTabUrl)
      : undefined;
    if (
      !routeIdentity ||
      routeIdentity.projectId !== row.projectId ||
      routeIdentity.clipId !== row.clipId.toLowerCase()
    )
      return {
        status: "blocked" as const,
        blocker: "detail_route_missing_or_changed" as const,
        routeStatus: "mismatch" as const,
        controlStatus: "not_checked" as const,
        outputStatus: "unverified" as const,
      };

    const targetScript = {
      tabId: target.selected.tabId,
      documentIds: [target.binding.documentId],
    };
    const identityResult = await dependencies.scripting.executeScript({
      target: targetScript,
      world: "ISOLATED",
      func: inspectCurrentFlowClipInPage,
      args: [],
    });
    const pageIdentity = FlowClipPageMetadataSchema.safeParse(
      identityResult[0]?.result,
    );
    if (
      identityResult[0]?.documentId !== target.binding.documentId ||
      !pageIdentity.success ||
      pageIdentity.data.projectId !== row.projectId ||
      pageIdentity.data.clipId.toLowerCase() !== row.clipId.toLowerCase()
    )
      return {
        status: "blocked" as const,
        blocker: "page_clip_identity_mismatch" as const,
        routeStatus: "mismatch" as const,
        controlStatus: "not_checked" as const,
        outputStatus: "unverified" as const,
      };

    const afterInspectionTab = await dependencies.tabs.get(target.selected.tabId);
    const afterInspectionRoute = afterInspectionTab.url
      ? flowClipDetailIdentityFromUrl(afterInspectionTab.url)
      : undefined;
    if (
      !afterInspectionRoute ||
      afterInspectionRoute.projectId !== row.projectId ||
      afterInspectionRoute.clipId !== row.clipId.toLowerCase()
    )
      return {
        status: "blocked" as const,
        blocker: "detail_route_missing_or_changed" as const,
        routeStatus: "mismatch" as const,
        controlStatus: "not_checked" as const,
        outputStatus: "unverified" as const,
      };

    const menuResult = await dependencies.scripting.executeScript({
      target: targetScript,
      world: "ISOLATED",
      func: inspectFlowClipDownloadMenuInPage,
      args: [row.projectId, row.clipId],
    });
    const inspectedMenu = menuResult[0]?.result as
      | { status?: unknown; blocker?: unknown }
      | undefined;
    if (menuResult[0]?.documentId !== target.binding.documentId)
      return {
        status: "blocked" as const,
        blocker: "page_clip_identity_mismatch" as const,
        routeStatus: "mismatch" as const,
        menuRecognitionStatus: "not_checked" as const,
        qualityOptionStatus: "not_checked" as const,
        outputStatus: "unverified" as const,
      };
    const finalTab = await dependencies.tabs.get(target.selected.tabId);
    const finalRoute = finalTab.url
      ? flowClipDetailIdentityFromUrl(finalTab.url)
      : undefined;
    if (
      !finalRoute ||
      finalRoute.projectId !== row.projectId ||
      finalRoute.clipId !== row.clipId.toLowerCase()
    )
      return {
        status: "blocked" as const,
        blocker: "detail_route_missing_or_changed" as const,
        routeStatus: "mismatch" as const,
        menuRecognitionStatus: "not_checked" as const,
        qualityOptionStatus: "not_checked" as const,
        outputStatus: "unverified" as const,
      };
    const menuBlockers = new Set([
      "detail_route_missing_or_changed",
      "detail_download_control_not_found",
      "detail_download_control_ambiguous",
      "detail_menu_not_open",
      "detail_menu_binding_unresolved",
      "quality_option_not_found_in_detail_menu",
      "quality_option_ambiguous_in_detail_menu",
      "quality_option_disabled_in_detail_menu",
      "detail_menu_inspection_unavailable",
    ]);
    if (inspectedMenu?.status === "recognized")
      return {
        status: "menu_recognized" as const,
        routeStatus: "matched" as const,
        menuRecognitionStatus: "recognized" as const,
        qualityOptionStatus: "visible_enabled" as const,
        outputStatus: "unverified" as const,
      };
    const blocker =
      typeof inspectedMenu?.blocker === "string" &&
      menuBlockers.has(inspectedMenu.blocker)
        ? inspectedMenu.blocker
        : "detail_menu_inspection_unavailable";
    const menuRouteMatched = blocker !== "detail_route_missing_or_changed";
    return {
      status: "blocked" as const,
      blocker,
      routeStatus: menuRouteMatched ? "matched" as const : "mismatch" as const,
      menuRecognitionStatus: "not_recognized" as const,
      qualityOptionStatus: "not_verified" as const,
      outputStatus: "unverified" as const,
    };
  }

  async function arm(
    identityCaptureEnabled = false,
    detailClipRecordId?: string,
    automaticAssetId?: string,
  ) {
    await loaded;
    return enqueue(async () => {
      if (isGalleryImportActive())
        throw new Error("flow_project_video_import_active");
      if (
        isActive(current) ||
        (current?.status === "completed" && metadataRequests.size > 0)
      )
        throw new Error("flow_diagnostic_already_active");
      clearTransientUrlComparisons();
      metadataRequests.clear();
      metadataRequestCount = 0;
      const permissions = await dependencies.permissions.contains({
        permissions: ["debugger", "tabs", "scripting", "downloads"],
      });
      if (!permissions) throw new Error("flow_diagnostic_permissions_missing");
      if (!registerDownloadListeners())
        throw new Error("flow_downloads_api_unavailable");
      const { selected, binding, verifiedTabUrl } =
        await verifySelectedFlowTarget();
      let detailClipRow:
        | Awaited<ReturnType<typeof dependencies.repositories.listFlowClipImports>>[number]
        | undefined;
      if (detailClipRecordId) {
        detailClipRow = (await dependencies.repositories.listFlowClipImports()).find(
          (candidate) => candidate.id === detailClipRecordId,
        );
        if (
          !detailClipRow ||
          !FlowClipImportRecordSchema.safeParse(detailClipRow).success ||
          !flowClipImportRouteMatches(detailClipRow)
        )
          throw new Error("flow_clip_import_row_unverified");
        if (!automaticAssetId && !isFlow1080pProofClip(detailClipRow.clipId))
          throw new Error("flow_clip_not_in_single_row_scope");
        if (detailClipRow.projectId !== binding.projectId)
          throw new Error("flow_clip_project_mismatch");
        const detailRoute = verifiedTabUrl
          ? flowClipDetailIdentityFromUrl(verifiedTabUrl)
          : undefined;
        if (
          !detailRoute ||
          detailRoute.projectId !== detailClipRow.projectId ||
          detailRoute.clipId !== detailClipRow.clipId.toLowerCase()
        )
          throw new Error("flow_clip_detail_route_mismatch");
        const pageIdentityResult = await dependencies.scripting.executeScript({
          target: {
            tabId: selected.tabId,
            documentIds: [binding.documentId],
          },
          world: "ISOLATED",
          func: inspectCurrentFlowClipInPage,
          args: [],
        });
        const pageIdentity = FlowClipPageMetadataSchema.safeParse(
          pageIdentityResult[0]?.result,
        );
        if (
          pageIdentityResult[0]?.documentId !== binding.documentId ||
          !pageIdentity.success ||
          pageIdentity.data.projectId !== detailClipRow.projectId ||
          pageIdentity.data.clipId.toLowerCase() !==
            detailClipRow.clipId.toLowerCase()
        )
          throw new Error("flow_clip_page_identity_mismatch");
      }
      const sessionId = createSessionId();
      const captureMode = detailClipRow ? "detail_clip" : "gallery";
      const captureIdentityEnabled = identityCaptureEnabled || Boolean(detailClipRow);
      const assetPathFingerprint = captureIdentityEnabled
        ? await fingerprintFlowAssetPath(
            sessionId,
            verifiedTabUrl,
            binding.projectId,
          )
        : undefined;
      const startedAt = now();
      const expiresAt = startedAt + FLOW_GALLERY_DIAGNOSTIC_TTL_MS;
      const record = FlowGalleryDownloadDiagnosticSchema.parse({
        version: 1,
        sessionId,
        status: "armed",
        startedAt,
        expiresAt,
        tabId: selected.tabId,
        projectId: binding.projectId,
        documentId: binding.documentId,
        mainFrameId: "pending",
        identityCaptureEnabled: captureIdentityEnabled,
        captureMode,
        ...(automaticAssetId && detailClipRow ? {
          automaticDownload: {
            recordId: detailClipRow.id,
            clipId: detailClipRow.clipId,
            selectedAssetFingerprint: await fingerprintFlowAssetPath(
              sessionId,
              `https://flow.google.com/project/${binding.projectId}/edit/${automaticAssetId}`,
              binding.projectId,
            ),
            filenameMediaFingerprint: await fingerprintFlowMediaIdentifier(sessionId, automaticAssetId.split("-")[0]),
            dispatchState: "preparing",
            inputAttempted: false,
          },
        } : {}),
        ...(detailClipRow
          ? {
              detailMetadataCaptureEnabled: !automaticAssetId,
              detailMetadataFields: [],
              detailMetadataBodyDiagnostics: [],
              detailMetadataBodiesOmitted: 0,
              detailMetadataEligibleRequestsSeen: 0,
              detailMetadataRequestsAdmitted: 0,
              detailMetadataRequestsOmittedAtCap: 0,
              detailMetadataRequestBodiesAvailable: 0,
              detailMetadataRequestBodiesRead: 0,
              detailMetadataResponseBodiesAttempted: 0,
              detailMetadataResponseBodiesRead: 0,
              detailMetadataJsonParseSucceeded: 0,
              detailMetadataJsonParseFailed: 0,
              detailMetadataBodiesUnavailable: 0,
              detailMetadataBodiesFailed: 0,
              detailMetadataBodiesUnsupported: 0,
              detailMetadataBodiesFiltered: 0,
              detailMetadataParsedBodiesWithoutIdentityFields: 0,
              detailMetadataPendingRequests: 0,
            }
          : {}),
        ...(detailClipRow
          ? {
              detailMenuBoundAtArm: false,
              detailClipSelectionStatus: "waiting_for_user_selection",
              detailDownloadCompletionStatus: "not_observed",
              detailFileResolutionStatus: "not_checked",
            }
          : {}),
        ...(captureIdentityEnabled
          ? {
              assetRoutePreflight: {
                matchStatus: assetPathFingerprint
                  ? "matched"
                  : "no_matching_edit_route",
                ...(assetPathFingerprint ? { assetPathFingerprint } : {}),
                selectedRouteMatchStatus: "not_checked",
              },
            }
          : {}),
        mediaRequests: [],
        pageDownloads: [],
        downloads: [],
        nonVideoDownloadCount: 0,
        downloadCreatedEvents: 0,
        videoCandidatesOmitted: 0,
        association: "unverified",
        associationReason: "no_quality_action",
      });

      let attached = false;
      try {
        await dependencies.debugger.attach({ tabId: selected.tabId }, "1.3");
        attached = true;
        await dependencies.debugger.sendCommand(
          { tabId: selected.tabId },
          "Page.enable",
        );
        await dependencies.debugger.sendCommand(
          { tabId: selected.tabId },
          "Network.enable",
          { maxTotalBufferSize: 256 * 1024, maxResourceBufferSize: 64 * 1024 },
        );
        const frameTree = (await dependencies.debugger.sendCommand(
          { tabId: selected.tabId },
          "Page.getFrameTree",
        )) as { frameTree?: { frame?: { id?: string } } };
        const mainFrameId = frameTree.frameTree?.frame?.id;
        if (!mainFrameId) throw new Error("flow_main_frame_unavailable");
        await persist({ ...record, mainFrameId });
        const injected = await dependencies.scripting.executeScript({
          target: {
            tabId: selected.tabId,
            documentIds: [binding.documentId],
          },
          world: "ISOLATED",
          func: automaticAssetId ? prepareFlowClipDownloadInPage : installFlowGalleryDownloadObserver,
          args: automaticAssetId ? [binding.projectId, detailClipRow!.clipId, automaticAssetId, false] : [
            sessionId,
            binding.projectId,
            captureIdentityEnabled,
            captureMode,
            detailClipRow?.clipId,
            assetPathFingerprint,
          ],
        });
        const automaticPoint = automaticAssetId
          ? FlowClipDownloadPointSchema.safeParse(injected[0]?.result)
          : undefined;
        const observerResult = automaticPoint?.success
          ? { installed: true, replaced: false, menuBound: true, qualityOptionObserved: true, qualityOptionEnabled: true }
          : injected[0]?.result as
          | {
              installed?: boolean;
              replaced?: boolean;
              menuBound?: boolean;
              qualityOptionObserved?: boolean;
              qualityOptionEnabled?: boolean;
              blocker?: string;
            }
          | undefined;
        if (
          injected[0]?.documentId !== binding.documentId ||
          !observerResult?.installed ||
          (detailClipRow &&
            (!observerResult.menuBound ||
              !observerResult.qualityOptionObserved ||
              !observerResult.qualityOptionEnabled))
        )
          throw new Error(
            observerResult?.blocker === "detail_route_mismatch"
              ? "flow_clip_detail_route_mismatch"
              : "flow_detail_download_menu_not_ready",
          );
        if (detailClipRow) {
          await persist({
            ...current!,
            detailMenuBoundAtArm: true,
            detailObserverInstalledAtArm: !automaticAssetId,
            detailObserverReplacedAtArm: observerResult.replaced === true,
            detailObserverLifecycleStatus: "active",
            menuBinding: {
              mainMenuControlResolved: true,
              downloadRowRecognized: true,
              qualityMenuControlResolved: true,
              qualityOptionObserved: true,
              qualityOptionEnabled: true,
            },
          });
        }
        await dependencies.alarms.create(FLOW_GALLERY_DIAGNOSTIC_ALARM, {
          when: expiresAt,
        });
        return publicSnapshot(current);
      } catch (error) {
        clearTransientUrlComparisons();
        if (attached) {
          await dependencies.scripting
            .executeScript({
              target: {
                tabId: selected.tabId,
                documentIds: [binding.documentId],
              },
              world: "ISOLATED",
              func: uninstallFlowGalleryDownloadObserver,
              args: [sessionId],
            })
            .catch(() => undefined);
          await dependencies.debugger
            .detach({ tabId: selected.tabId })
            .catch(() => undefined);
        }
        await dependencies.storage.remove(FLOW_GALLERY_DIAGNOSTIC_STORAGE_KEY);
        current = undefined;
        throw error;
      }
    });
  }

  async function armClipDownloadProof(recordId: string) {
    return arm(true, recordId);
  }

  /** One dashboard click sends one native quality selection. Unknown delivery is never replayed. */
  async function startClipDownload(recordId: string, allowNewAttempt = false) {
    if (automaticDownloadStarting)
      throw new Error("flow_download_already_starting");
    automaticDownloadStarting = true;
    let armedSessionId: string | undefined;
    let inputAttempted = false;
    let failureStage: FlowClipDownloadFailureStage = "validation";
    try {
      await loaded;
      if (isGalleryImportActive())
        throw new Error("flow_project_video_import_active");
      if (isActive(current)) throw new Error("flow_diagnostic_already_active");
      if (
        current?.automaticDownload &&
        current.automaticDownload.dispatchState !== "preparing" &&
        current.status !== "completed" &&
        !allowNewAttempt
      )
        throw new Error("flow_download_previous_outcome_needs_review");
      const rows = await listImportedClips();
      const row = rows.find((item) => item.id === recordId);
      if (!row?.routeVerified) throw new Error("flow_clip_import_row_unverified");
      const { selected, binding, verifiedTabUrl } =
        await verifySelectedFlowTarget();
      const route = verifiedTabUrl
        ? flowClipDetailIdentityFromUrl(verifiedTabUrl)
        : undefined;
      if (
        route?.projectId !== row.projectId ||
        route.clipId !== row.clipId.toLowerCase()
      )
        throw new Error("flow_clip_detail_route_mismatch");
      if (
        !(await dependencies.permissions.contains({
          permissions: ["downloads", "scripting", "tabs", "debugger"],
        }))
      )
        throw new Error("flow_diagnostic_permissions_missing");
      failureStage = "initial_preparation";
      const prepared = await dependencies.scripting.executeScript({
        target: { tabId: selected.tabId, documentIds: [binding.documentId] },
        world: "ISOLATED",
        func: prepareFlowClipDownloadInPage,
        args: [row.projectId, row.clipId, null, true],
      });
      const point = FlowClipDownloadPointSchema.safeParse(prepared[0]?.result);
      if (prepared[0]?.documentId !== binding.documentId)
        throw new Error("flow_clip_document_changed");
      if (!point.success) {
        const blockedReason = (prepared[0]?.result as { reason?: unknown } | undefined)?.reason;
        const knownReason = FlowClipDownloadFailureCodeSchema.safeParse(blockedReason);
        throw new Error(knownReason.success ? knownReason.data : "flow_clip_download_preparation_failed");
      }
      failureStage = "arming";
      const armed = await arm(true, recordId, point.data.assetId);
      if (armed.status === "idle")
        throw new Error("flow_clip_download_arm_failed");
      armedSessionId = armed.sessionId;
      return await enqueue(async () => {
        if (
          !current ||
          current.sessionId !== armedSessionId ||
          !isActive(current)
        )
          throw new Error("flow_clip_download_arm_failed");
        // Store intent before sending any input. Restart/retry must review this receipt.
        await persist({
          ...current,
          automaticDownload: {
            ...current.automaticDownload!,
            dispatchState: "intent",
          },
        });
        failureStage = "final_preparation";
        const checked = await dependencies.scripting.executeScript({
          target: { tabId: selected.tabId, documentIds: [binding.documentId] },
          world: "ISOLATED",
          func: prepareFlowClipDownloadInPage,
          args: [row.projectId, row.clipId, point.data.assetId, false],
        });
        const finalPoint = FlowClipDownloadPointSchema.safeParse(
          checked[0]?.result,
        );
        if (checked[0]?.documentId !== binding.documentId)
          throw new Error("flow_clip_document_changed");
        if (!finalPoint.success) {
          const blockedReason = (checked[0]?.result as { reason?: unknown } | undefined)?.reason;
          const knownReason = FlowClipDownloadFailureCodeSchema.safeParse(blockedReason);
          throw new Error(knownReason.success ? knownReason.data : "flow_clip_download_preparation_failed");
        }
        const actionAt = now();
        await persist({
          ...current!,
          actionAt,
          requestedQuality: "1080p_upscaled",
          automaticDownload: {
            ...current!.automaticDownload!,
            inputAttempted: true,
          },
        });
        const { x, y } = finalPoint.data;
        inputAttempted = true;
        failureStage = "native_input";
        await dependencies.debugger.sendCommand(
          { tabId: selected.tabId },
          "Input.dispatchMouseEvent",
          {
            type: "mousePressed",
            button: "left",
            buttons: 1,
            clickCount: 1,
            x,
            y,
          },
        );
        await dependencies.debugger.sendCommand(
          { tabId: selected.tabId },
          "Input.dispatchMouseEvent",
          {
            type: "mouseReleased",
            button: "left",
            buttons: 0,
            clickCount: 1,
            x,
            y,
          },
        );
        const next = updateAssociation(
          {
            ...current!,
            status: "action_observed",
            automaticDownload: {
              ...current!.automaticDownload!,
              dispatchState: "sent",
            },
            nativeActionObserved: true,
            detailClipSelectionStatus: "observed",
            detailDownloadCompletionStatus: "awaiting_browser_download",
            assetRoutePreflight: {
              ...current!.assetRoutePreflight!,
              selectedRouteMatchStatus: "matched",
            },
          },
          now(),
        );
        await persist(next);
        return publicSnapshot(next);
      });
    } catch (error) {
      const rawCode = error instanceof Error ? error.message : "";
      const parsedCode = FlowClipDownloadFailureCodeSchema.safeParse(rawCode);
      const failureCode: FlowClipDownloadFailureCode = parsedCode.success
        ? parsedCode.data
        : inputAttempted
          ? "flow_download_dispatch_uncertain"
          : "flow_clip_download_preparation_failed";
      if (armedSessionId)
        await enqueue(async () => {
          if (!current || current.sessionId !== armedSessionId) return;
          const failed = {
            ...current,
            automaticDownload: {
              ...current.automaticDownload!,
              dispatchState: inputAttempted
                ? ("uncertain" as const)
                : ("preparing" as const),
              inputAttempted,
              failureStage,
              failureCode,
            },
            ...(inputAttempted
              ? {
                  interruptionReason:
                    "dashboard_download_dispatch_uncertain" as const,
                }
              : {}),
          };
          await finish(failed, inputAttempted ? "interrupted" : "stopped");
        });
      throw new FlowClipDownloadStartError(failureCode, failureStage, inputAttempted);
    } finally {
      automaticDownloadStarting = false;
    }
  }

  async function stop() {
    await loaded;
    return enqueue(async () => {
      if (!current || !isActive(current)) return publicSnapshot(current);
      return publicSnapshot(await finish(current, "stopped"));
    });
  }

  async function get() {
    await loaded;
    return enqueue(async () => {
      if (current && isActive(current) && now() >= current.expiresAt)
        await finish(current, "expired");
      return publicSnapshot(current);
    });
  }

  async function ingestPageEvent(
    raw: unknown,
    sender: {
      id?: string;
      tab?: { id?: number };
      frameId?: number;
      documentId?: string;
    },
  ) {
    const message = pageMessage(raw);
    if (!message || sender.id !== dependencies.extensionId) return false;
    await loaded;
    return enqueue(async () => {
      const record = current;
      if (
        !record ||
        record.sessionId !== message.sessionId ||
        !isActive(record) ||
        sender.tab?.id !== record.tabId ||
        sender.frameId !== 0 ||
        sender.documentId !== record.documentId ||
        now() >= record.expiresAt
      )
        return false;

      let next = record;
      if (message.stage === "main_menu") {
        next = {
          ...record,
          ...(record.assetRoutePreflight
            ? {
                assetRoutePreflight: {
                  ...record.assetRoutePreflight,
                  selectedRouteMatchStatus:
                    record.assetRoutePreflight.matchStatus !== "matched"
                      ? "not_comparable"
                      : message.assetPathFingerprint ===
                          record.assetRoutePreflight.assetPathFingerprint
                        ? "matched"
                        : "changed_or_missing",
                },
              }
            : {}),
          selectedCard: {
            token: "selected-card-1",
            ownerFound: message.ownerFound,
            stableIdAttributeObserved: message.stableIdAttributeObserved,
            ...(message.assetPathFingerprint
              ? { assetPathFingerprint: message.assetPathFingerprint }
              : {}),
          },
          menuBinding: {
            mainMenuControlResolved: message.mainMenuControlResolved,
            downloadRowRecognized: false,
            qualityMenuControlResolved: false,
            qualityOptionObserved: false,
            qualityOptionEnabled: false,
          },
        };
      } else if (message.stage === "download_row") {
        next = {
          ...record,
          menuBinding: {
            mainMenuControlResolved:
              record.menuBinding?.mainMenuControlResolved ?? false,
            downloadRowRecognized: message.downloadRowRecognized,
            qualityMenuControlResolved: message.qualityMenuControlResolved,
            qualityOptionObserved: message.qualityOptionObserved,
            qualityOptionEnabled: message.qualityOptionEnabled,
          },
        };
      } else if (message.stage === "quality_click_listener") {
        next = {
          ...record,
          qualityClickListenerReached: true,
          qualityClickListenerEvents: Math.min(
            100,
            (record.qualityClickListenerEvents ?? 0) + 1,
          ),
        };
      } else if (message.stage === "quality_click_rejected") {
        next = {
          ...record,
          qualityClickRejections: Math.min(
            100,
            (record.qualityClickRejections ?? 0) + 1,
          ),
          lastQualityClickRejection: message.reason,
        };
      } else if (message.stage === "quality_action_accepted_in_page") {
        next = {
          ...record,
          qualityActionAcceptedInPage: true,
          qualityActionAcceptedAt: message.capturedAt,
        };
      } else if (message.stage === "quality_action") {
        if (record.captureMode === "detail_clip") return false;
        next = {
          ...record,
          status: "action_observed",
          actionAt: message.capturedAt,
          nativeActionObserved: message.trusted,
          requestedQuality: message.requestedQuality,
          qualityActionReceivedByWorker: true,
          mediaRequestsOmittedAtCap: 0,
          // Pre-action requests cannot satisfy the association rule, so they
          // must not consume the bounded evidence slots needed after the click.
          mediaRequests: record.mediaRequests.filter(
            (request) =>
              record.startedAt + request.offsetMs >= message.capturedAt,
          ),
          pageDownloads: record.pageDownloads.map((event) => ({
            ...event,
            afterAction:
              record.startedAt + event.offsetMs >= message.capturedAt,
          })),
        };
      } else if (message.stage === "detail_clip_selection") {
        if (
          record.captureMode !== "detail_clip" ||
          !message.menuBound ||
          record.detailMenuBoundAtArm !== true
        )
          return false;
        const expectedFingerprint =
          record.assetRoutePreflight?.assetPathFingerprint;
        if (
          !expectedFingerprint ||
          message.assetPathFingerprint !== expectedFingerprint
        ) {
          next = {
            ...record,
            detailClipSelectionStatus: "route_changed",
            assetRoutePreflight: record.assetRoutePreflight
              ? {
                  ...record.assetRoutePreflight,
                  selectedRouteMatchStatus: "changed_or_missing",
                }
              : undefined,
          };
        } else {
          next = {
            ...record,
            status: "action_observed",
            detailObserverLifecycleStatus: "selection_observed",
            actionAt: message.capturedAt,
            nativeActionObserved: true,
            requestedQuality: message.requestedQuality,
            qualityActionReceivedByWorker: true,
            detailClipSelectionStatus: "observed",
            detailDownloadCompletionStatus: "awaiting_browser_download",
            detailFileResolutionStatus: "not_checked",
            assetRoutePreflight: {
              ...record.assetRoutePreflight!,
              selectedRouteMatchStatus: "matched",
            },
            menuBinding: {
              mainMenuControlResolved: true,
              downloadRowRecognized: true,
              qualityMenuControlResolved: true,
              qualityOptionObserved: true,
              qualityOptionEnabled: true,
            },
            mediaRequestsOmittedAtCap: 0,
            mediaRequests: record.mediaRequests.filter(
              (request) =>
                record.startedAt + request.offsetMs >= message.capturedAt,
            ),
            pageDownloads: record.pageDownloads.map((event) => ({
              ...event,
              afterAction:
                record.startedAt + event.offsetMs >= message.capturedAt,
            })),
          };
        }
      } else if (message.stage === "detail_clip_click_diagnostic") {
        if (record.captureMode !== "detail_clip") return false;
        next = {
          ...record,
          ...(message.decision === "accepted"
            ? { detailObserverLifecycleStatus: "selection_observed" as const }
            : {}),
          detailClipTrustedClickEvents: Math.min(
            100,
            (record.detailClipTrustedClickEvents ?? 0) + 1,
          ),
          ...(message.candidateCount > 0
            ? {
                detailClipCandidateClickEvents: Math.min(
                  100,
                  (record.detailClipCandidateClickEvents ?? 0) + 1,
                ),
              }
            : {}),
          detailClipLastClickObservation: {
            offsetMs: Math.max(0, message.capturedAt - record.startedAt),
            routeMatches: message.routeMatches,
            menuBound: message.menuBound,
            candidateCount: message.candidateCount,
            qualityOptionCount: message.qualityOptionCount,
            candidateInBoundMenu: message.candidateInBoundMenu,
            candidateEnabled: message.candidateEnabled,
            decision: message.decision,
          },
        };
      } else if (message.stage === "detail_clip_observer_lifecycle") {
        if (record.captureMode !== "detail_clip") return false;
        next = {
          ...record,
          detailObserverLifecycleStatus: message.state,
        };
      } else if (message.stage === "capture_issue") {
        next = {
          ...record,
          captureIssue: { stage: message.failedStage, reason: message.reason },
        };
      }
      next = updateAssociation(next, now());
      await persist(next);
      if (next.status === "completed")
        await detachCompletedWhenDrained(next);
      else if (next.status === "interrupted") await detach(next);
      return true;
    });
  }

  async function onDebuggerEvent(
    source: FlowDownloadDiagnosticDebuggerSource,
    method: string,
    params: Record<string, unknown>,
  ) {
    if (source.tabId === undefined) return;
    const capturedAt = now();
    const actionAtReceipt = current?.actionAt;
    await loaded;
    await enqueue(async () => {
      let record = current;
      const eventRequestId =
        typeof params.requestId === "string" ? params.requestId : undefined;
      const drainingCompletedCapture =
        record?.status === "completed" &&
        eventRequestId !== undefined &&
        metadataRequests.has(eventRequestId) &&
        (method === "Network.responseReceived" ||
          method === "Network.loadingFinished" ||
          method === "Network.loadingFailed");
      if (
        !record ||
        (!isActive(record) && !drainingCompletedCapture) ||
        now() >= record.expiresAt
      )
        return;
      if (
        method === "Page.downloadWillBegin" &&
        record.tabId !== source.tabId
      ) {
        await persist({
          ...record,
          pageDownloadEventsReceived: Math.min(
            100,
            (record.pageDownloadEventsReceived ?? 0) + 1,
          ),
          pageDownloadTargetMismatches: Math.min(
            100,
            (record.pageDownloadTargetMismatches ?? 0) + 1,
          ),
        });
        return;
      }
      if (record.tabId !== source.tabId) return;
      if (method === "Network.requestWillBeSent") {
        const type = params.type;
        if (type !== "Media" && type !== "Fetch" && type !== "XHR") return;
        if (params.frameId !== record.mainFrameId) return;
        const requestId = typeof params.requestId === "string" ? params.requestId : undefined;
        const request = params.request as
          {
            url?: unknown;
            method?: unknown;
            postData?: unknown;
            hasPostData?: unknown;
            headers?: unknown;
          } | undefined;
        const metadataEligible =
          (type === "Fetch" || type === "XHR") &&
          record.captureMode === "detail_clip" &&
          record.detailMetadataCaptureEnabled &&
          capturedAt >= record.startedAt;
        if (metadataEligible) {
          record = incrementMetadataCounter(
            record,
            "detailMetadataEligibleRequestsSeen",
          );
        }
        if (metadataEligible && requestId && metadataRequestCount < 12) {
          const requestCount = ++metadataRequestCount;
          const requestToken = `metadata-request-${requestCount}` as const;
          metadataRequests.set(requestId, {
            token: requestToken,
            frameId: record.mainFrameId,
            offsetMs: Math.max(0, capturedAt - record.startedAt),
            responseReceived: false,
            responseMimeCategory: "missing",
          });
          record = incrementMetadataCounter(
            record,
            "detailMetadataRequestsAdmitted",
          );
          await persist(record);
          const requestBodyExpected =
            typeof request?.postData === "string" ||
            request?.hasPostData === true ||
            request?.method === "POST";
          if (requestBodyExpected) {
            const headers = request?.headers;
            const requestContentType =
              headers && typeof headers === "object"
                ? Object.entries(headers as Record<string, unknown>).find(
                    ([name]) => name.toLowerCase() === "content-type",
                  )?.[1]
                : undefined;
            const requestMimeCategory =
              classifyFlowDetailMetadataMimeCategory(requestContentType);
            let postData =
              typeof request?.postData === "string"
                ? request.postData
                : undefined;
            let requestBodyReadFailed = false;
            if (postData === undefined && request?.hasPostData === true) {
              try {
                const bodyResult = (await dependencies.debugger.sendCommand(
                  { tabId: record.tabId },
                  "Network.getRequestPostData",
                  { requestId },
                )) as { postData?: unknown } | undefined;
                postData =
                  typeof bodyResult?.postData === "string"
                    ? bodyResult.postData
                    : undefined;
              } catch {
                requestBodyReadFailed = true;
                record = incrementMetadataCounter(
                  record,
                  "detailMetadataBodiesFailed",
                );
              }
            }
            if (postData !== undefined) {
              record = incrementMetadataCounter(
                record,
                "detailMetadataRequestBodiesAvailable",
              );
              record = incrementMetadataCounter(
                record,
                "detailMetadataRequestBodiesRead",
              );
              record = await inspectMetadataBody(
                record,
                requestToken,
                "request_body",
                postData,
                Math.max(0, capturedAt - record.startedAt),
                { mimeCategory: requestMimeCategory, base64Encoded: false },
              );
            } else if (requestBodyExpected) {
              if (!requestBodyReadFailed)
                record = incrementMetadataCounter(
                  record,
                  "detailMetadataBodiesUnavailable",
                );
              record = incrementMetadataCounter(
                record,
                "detailMetadataBodiesOmitted",
              );
              record = appendMetadataBodyDiagnostic(record, {
                stage: "request_body",
                mimeCategory: requestMimeCategory,
                base64Encoded: false,
                formatCategory: requestBodyReadFailed
                  ? "read_failed"
                  : "unavailable",
                parseFailureCategory: requestBodyReadFailed
                  ? "read_failed"
                  : "unavailable",
              });
            }
          }
          await persist(record);
        } else if (metadataEligible && metadataRequestCount >= 12) {
          record = incrementMetadataCounter(
            record,
            "detailMetadataRequestsOmittedAtCap",
          );
          await persist(record);
        }
        if (!record || !isActive(record)) return;
        const requestRecord = record;
        const fingerprints = await fingerprintFlowDownloadUrl(
          record.sessionId,
          request?.url,
        );
        if (!fingerprints.accepted) return;
        const assetPathFingerprint = record.identityCaptureEnabled
          ? await fingerprintFlowAssetUrlPath(record.sessionId, request?.url)
          : undefined;
        const token =
          `media-request-${record.mediaRequests.length + 1}` as const;
        const mediaRequest: FlowDownloadMediaRequest = {
          requestToken: token,
          resourceKind: type,
          method:
            request?.method === "GET" || request?.method === "POST"
              ? request.method
              : "OTHER",
          urlFingerprint: fingerprints.urlFingerprint,
          ...(assetPathFingerprint ? { assetPathFingerprint } : {}),
          ...(fingerprints.mediaIdFingerprint
            ? { mediaIdFingerprint: fingerprints.mediaIdFingerprint }
            : {}),
          offsetMs: Math.max(0, capturedAt - record.startedAt),
        };
        if (requestRecord.mediaRequests.length >= 16) {
          const actionAt = requestRecord.actionAt ?? requestRecord.qualityActionAcceptedAt;
          const matchesActionIdentity = (candidate: FlowDownloadMediaRequest) =>
            actionAt !== undefined &&
            requestRecord.startedAt + candidate.offsetMs >= actionAt &&
            requestRecord.pageDownloads.some(
              (event) =>
                event.frameMatched &&
                requestRecord.startedAt + event.offsetMs >= actionAt &&
                (candidate.urlFingerprint === event.urlFingerprint ||
                  (candidate.mediaIdFingerprint !== undefined &&
                    (candidate.mediaIdFingerprint ===
                      event.mediaIdFingerprint ||
                      event.exactDownloadIds?.some((downloadId) => {
                        const download = requestRecord.downloads.find(
                          (item) => item.downloadId === downloadId,
                        );
                        return (
                          download?.mediaIdFingerprint !== undefined &&
                          candidate.mediaIdFingerprint ===
                            download.mediaIdFingerprint
                        );
                      })))),
            );
          const incomingMatches = matchesActionIdentity(mediaRequest);
          const replaceIndex = incomingMatches
            ? record.mediaRequests.findIndex(
                (item) => !matchesActionIdentity(item),
              )
            : fingerprints.mediaIdFingerprint
              ? record.mediaRequests.findIndex(
                  (item) => item.mediaIdFingerprint === undefined,
                )
              : type === "Media"
                ? record.mediaRequests.findIndex(
                    (item) => item.resourceKind !== "Media",
                  )
                : -1;
          if (replaceIndex < 0) {
            await persist({
              ...record,
              mediaRequestsOmittedAtCap: Math.min(
                100,
                (record.mediaRequestsOmittedAtCap ?? 0) + 1,
              ),
              ...(fingerprints.mediaIdFingerprint
                ? {
                    mediaIdentityRequestsOmittedAtCap: Math.min(
                      100,
                      (record.mediaIdentityRequestsOmittedAtCap ?? 0) + 1,
                    ),
                  }
                : {}),
            });
            return;
          }
          const replaced = record.mediaRequests[replaceIndex]!;
          const mediaRequests = [...record.mediaRequests];
          mediaRequests[replaceIndex] = {
            ...mediaRequest,
            requestToken: replaced.requestToken,
          };
          await persist({
            ...record,
            mediaRequests,
            mediaRequestsOmittedAtCap: Math.min(
              100,
              (record.mediaRequestsOmittedAtCap ?? 0) + 1,
            ),
            ...(replaced.mediaIdFingerprint
              ? {
                  mediaIdentityRequestsOmittedAtCap: Math.min(
                    100,
                    (record.mediaIdentityRequestsOmittedAtCap ?? 0) + 1,
                  ),
                }
              : {}),
          });
          return;
        }
        await persist({
          ...record,
          mediaRequests: [...record.mediaRequests, mediaRequest],
        });
        return;
      }
      if (method === "Network.responseReceived") {
        const requestId = typeof params.requestId === "string" ? params.requestId : undefined;
        const context = requestId ? metadataRequests.get(requestId) : undefined;
        const response = params.response as
          | { mimeType?: unknown; headers?: unknown }
          | undefined;
        if (context) {
          context.responseReceived = true;
          const headers = response?.headers;
          const headerContentType =
            headers && typeof headers === "object"
              ? Object.entries(headers as Record<string, unknown>).find(
                  ([name]) => name.toLowerCase() === "content-type",
                )?.[1]
              : undefined;
          context.responseMimeCategory = classifyFlowDetailMetadataMimeCategory(
            response?.mimeType ?? headerContentType,
          );
        }
        return;
      }
      if (method === "Network.loadingFinished") {
        const requestId = typeof params.requestId === "string" ? params.requestId : undefined;
        const context = requestId ? metadataRequests.get(requestId) : undefined;
        if (!context) return;
        let responseRecord = record;
        if (!context.responseReceived) {
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesUnavailable",
          );
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesOmitted",
          );
          responseRecord = appendMetadataBodyDiagnostic(responseRecord, {
            stage: "response_body",
            mimeCategory: "missing",
            formatCategory: "unavailable",
            parseFailureCategory: "unavailable",
          });
          metadataRequests.delete(requestId!);
          responseRecord = await persist(responseRecord);
          await detachCompletedWhenDrained(responseRecord);
          return;
        }
        if (
          context.responseMimeCategory !== "json" &&
          context.responseMimeCategory !== "missing"
        ) {
          const inspection = await inspectFlowDetailMetadataBody(
            record.sessionId,
            context.token,
            "response_body",
            undefined,
            Math.max(0, capturedAt - record.startedAt),
            { mimeCategory: context.responseMimeCategory },
          );
          responseRecord = appendMetadataBodyDiagnostic(
            responseRecord,
            inspection.diagnostic,
          );
          responseRecord = incrementMetadataCounter(responseRecord, "detailMetadataBodiesUnsupported");
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesOmitted",
          );
          metadataRequests.delete(requestId!);
          responseRecord = await persist(responseRecord);
          await detachCompletedWhenDrained(responseRecord);
          return;
        }
        if ((record.detailMetadataFields?.length ?? 0) >= 48) {
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesFiltered",
          );
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesOmitted",
          );
          responseRecord = appendMetadataBodyDiagnostic(responseRecord, {
            stage: "response_body",
            mimeCategory: context.responseMimeCategory,
            formatCategory: "not_inspected",
            parseFailureCategory: "not_attempted",
          });
          metadataRequests.delete(requestId!);
          responseRecord = await persist(responseRecord);
          await detachCompletedWhenDrained(responseRecord);
          return;
        }
        responseRecord = incrementMetadataCounter(
          responseRecord,
          "detailMetadataResponseBodiesAttempted",
        );
        let bodyResult: unknown;
        try {
          bodyResult = await dependencies.debugger.sendCommand(
            { tabId: record.tabId },
            "Network.getResponseBody",
            { requestId },
          );
        } catch {
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesFailed",
          );
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesOmitted",
          );
          responseRecord = appendMetadataBodyDiagnostic(responseRecord, {
            stage: "response_body",
            mimeCategory: context.responseMimeCategory,
            formatCategory: "read_failed",
            parseFailureCategory: "read_failed",
          });
          metadataRequests.delete(requestId!);
          responseRecord = await persist(responseRecord);
          await detachCompletedWhenDrained(responseRecord);
          return;
        }
        const body = bodyResult as { body?: unknown; base64Encoded?: unknown } | undefined;
        if (typeof body?.body !== "string") {
          responseRecord = await inspectMetadataBody(
            responseRecord,
            context.token,
            "response_body",
            undefined,
            Math.max(0, capturedAt - responseRecord.startedAt),
            { mimeCategory: context.responseMimeCategory },
          );
          metadataRequests.delete(requestId!);
          responseRecord = await persist(responseRecord);
          await detachCompletedWhenDrained(responseRecord);
          return;
        }
        responseRecord = incrementMetadataCounter(
          responseRecord,
          "detailMetadataResponseBodiesRead",
        );
        responseRecord = await inspectMetadataBody(
          responseRecord,
          context.token,
          "response_body",
          body.body,
          Math.max(0, capturedAt - responseRecord.startedAt),
          {
            mimeCategory: context.responseMimeCategory,
            ...(typeof body.base64Encoded === "boolean"
              ? { base64Encoded: body.base64Encoded }
              : {}),
          },
        );
        metadataRequests.delete(requestId!);
        responseRecord = await persist(responseRecord);
        await detachCompletedWhenDrained(responseRecord);
        return;
      }
      if (method === "Network.loadingFailed") {
        const requestId = typeof params.requestId === "string" ? params.requestId : undefined;
        const context = requestId ? metadataRequests.get(requestId) : undefined;
        if (!requestId || !context) return;
        metadataRequests.delete(requestId);
        let failedRecord = incrementMetadataCounter(
          record,
          "detailMetadataBodiesFailed",
        );
        failedRecord = incrementMetadataCounter(
          failedRecord,
          "detailMetadataBodiesOmitted",
        );
        failedRecord = appendMetadataBodyDiagnostic(failedRecord, {
          stage: "response_body",
          mimeCategory: context.responseMimeCategory,
          formatCategory: "read_failed",
          parseFailureCategory: "read_failed",
        });
        failedRecord = await persist(failedRecord);
        await detachCompletedWhenDrained(failedRecord);
        return;
      }
      if (method === "Page.downloadWillBegin") {
        const frameId = params.frameId;
        const received = Math.min(
          100,
          (record.pageDownloadEventsReceived ?? 0) + 1,
        );
        const frameMismatches = Math.min(
          100,
          (record.pageDownloadFrameMismatches ?? 0) +
            (frameId === record.mainFrameId ? 0 : 1),
        );
        const mainFrameEvents = Math.min(
          100,
          (record.pageDownloadMainFrameEvents ?? 0) +
            (frameId === record.mainFrameId ? 1 : 0),
        );
        const observedRecord = {
          ...record,
          pageDownloadEventsReceived: received,
          pageDownloadFrameMismatches: frameMismatches,
          pageDownloadMainFrameEvents: mainFrameEvents,
        };
        if (record.pageDownloads.length >= 4) {
          await persist({
            ...observedRecord,
            pageDownloadEventsOmittedAtCap: Math.min(
              100,
              (record.pageDownloadEventsOmittedAtCap ?? 0) + 1,
            ),
          });
          return;
        }
        const fingerprints = await fingerprintFlowDownloadUrl(
          record.sessionId,
          params.url,
        );
        if (!fingerprints.accepted) {
          await persist({
            ...observedRecord,
            pageDownloadMetadataRejected: Math.min(
              100,
              (record.pageDownloadMetadataRejected ?? 0) + 1,
            ),
            lastPageDownloadUrlRejection: fingerprints.rejection,
          });
          return;
        }
        const rawPageUrl = params.url as string;
        const assetPathFingerprint = record.identityCaptureEnabled
          ? await fingerprintFlowAssetUrlPath(record.sessionId, rawPageUrl)
          : undefined;
        const filename = sanitizeFlowDownloadFilename(params.suggestedFilename);
        const filenameUnavailable = filename === "unknown-file";
        const filenameMediaId = await fingerprintFlowMediaIdentifier(
          record.sessionId,
          filename,
        );
        if (record.automaticDownload) {
          // The filename check only filters candidates. It never verifies output provenance.
          if (frameId !== record.mainFrameId || actionAtReceipt === undefined ||
              filenameMediaId !== record.automaticDownload.filenameMediaFingerprint) {
            await persist({ ...observedRecord, automaticDownload: {
              ...record.automaticDownload,
              ignoredPageEvents: Math.min(100, (record.automaticDownload.ignoredPageEvents ?? 0) + 1),
            } });
            return;
          }
          const tab = await dependencies.tabs.get(record.tabId);
          const route = tab.url ? flowClipDetailIdentityFromUrl(tab.url) : undefined;
          let identityResult: Awaited<ReturnType<typeof dependencies.scripting.executeScript>>;
          try {
            identityResult = await dependencies.scripting.executeScript({
              target: { tabId: record.tabId, documentIds: [record.documentId] },
              world: "ISOLATED", func: prepareFlowClipDownloadInPage,
              args: [record.projectId, record.automaticDownload.clipId, null, false, true],
            });
          } catch {
            await finish({
              ...observedRecord,
              automaticDownload: {
                ...record.automaticDownload,
                dispatchState: "uncertain",
                inputAttempted: true,
                failureStage: "identity_readback",
                failureCode: "flow_download_identity_readback_failed",
              },
              interruptionReason: "dashboard_download_context_changed",
            }, "interrupted");
            return;
          }
          const identity = FlowClipAssetIdentitySchema.safeParse(identityResult[0]?.result);
          const assetFingerprint = identity.success ? await fingerprintFlowAssetPath(
            record.sessionId,
            `https://flow.google.com/project/${record.projectId}/edit/${identity.data.assetId}`,
            record.projectId,
          ) : undefined;
          if (route?.projectId !== record.projectId || route.clipId !== record.automaticDownload.clipId ||
              identityResult[0]?.documentId !== record.documentId ||
              assetFingerprint !== record.automaticDownload.selectedAssetFingerprint) {
            await finish({ ...observedRecord, interruptionReason: "dashboard_download_context_changed" }, "interrupted");
            return;
          }
        }

        const pageObservedRecord = {
          ...observedRecord,
          ...(filenameUnavailable
            ? {
                pageDownloadFilenameUnavailable: Math.min(
                  100,
                  (record.pageDownloadFilenameUnavailable ?? 0) + 1,
                ),
              }
            : {}),
        };
        const pageEvent: FlowDownloadPageEvent = {
          eventToken: `page-download-${record.pageDownloads.length + 1}`,
          filename,
          urlFingerprint: fingerprints.urlFingerprint,
          ...(assetPathFingerprint ? { assetPathFingerprint } : {}),
          urlScheme: fingerprints.schemeCategory,
          exactDownloadIds: exactDownloadIdsForUrl(rawPageUrl),
          ...((fingerprints.mediaIdFingerprint ?? filenameMediaId)
            ? {
                mediaIdFingerprint:
                  fingerprints.mediaIdFingerprint ?? filenameMediaId,
              }
            : {}),
          frameMatched: frameId === record.mainFrameId,
          afterAction:
            record.actionAt !== undefined && capturedAt >= record.actionAt &&
            (!record.automaticDownload || actionAtReceipt !== undefined),
          offsetMs: Math.max(0, capturedAt - record.startedAt),
        };
        transientPageDownloadUrls.set(pageEvent.eventToken, rawPageUrl);
        const resolvedPageRecord = await resolveDetailFileLocation({
          ...pageObservedRecord,
          pageDownloads: [...record.pageDownloads, pageEvent],
        });
        const next = updateAssociation(resolvedPageRecord, now());
        await persist(next);
        if (next.status === "completed")
          await detachCompletedWhenDrained(next);
        else if (next.status === "interrupted") await detach(next);
      }
    });
  }

  async function onDownloadCreated(item: ChromeDownloadItem) {
    await loaded;
    await enqueue(async () => {
      const record = current;
      const collectingAfterDebuggerDetach =
        record?.status === "interrupted" &&
        record.interruptionReason === "debugger_detached";
      if (
        !record ||
        (!isActive(record) && !collectingAfterDebuggerDetach) ||
        now() >= record.expiresAt
      )
        return;
      const received = Math.min(100, (record.downloadCreatedEvents ?? 0) + 1);
      const filename = sanitizeFlowDownloadFilename(item.filename);
      const filenameAvailable =
        typeof item.filename === "string" && filename !== "unknown-file";
      const extension = filenameAvailable
        ? flowDownloadExtension(filename)
        : "pending";
      if (extension === "other") {
        await persist({
          ...record,
          downloadCreatedEvents: received,
          nonVideoDownloadCount: Math.min(
            100,
            record.nonVideoDownloadCount + 1,
          ),
        });
        return;
      }
      if (record.downloads.length >= 6) {
        await persist({
          ...record,
          downloadCreatedEvents: received,
          videoCandidatesOmitted: Math.min(
            100,
            (record.videoCandidatesOmitted ?? 0) + 1,
          ),
        });
        return;
      }
      const [url, finalUrl] = await Promise.all([
        fingerprintFlowDownloadUrl(record.sessionId, item.url),
        fingerprintFlowDownloadUrl(record.sessionId, item.finalUrl),
      ]);
      const assetPathFingerprint = record.identityCaptureEnabled
        ? (await fingerprintFlowAssetUrlPath(record.sessionId, item.url)) ??
          (await fingerprintFlowAssetUrlPath(record.sessionId, item.finalUrl))
        : undefined;
      const transientUrls = {
        ...(url.accepted && typeof item.url === "string"
          ? { url: item.url }
          : {}),
        ...(finalUrl.accepted && typeof item.finalUrl === "string"
          ? { finalUrl: item.finalUrl }
          : {}),
      };
      transientChromeDownloadUrls.set(item.id, transientUrls);
      while (transientChromeDownloadUrls.size > 6) {
        const oldestDownloadId = transientChromeDownloadUrls.keys().next()
          .value as number | undefined;
        if (oldestDownloadId === undefined) break;
        transientChromeDownloadUrls.delete(oldestDownloadId);
      }
      const pageDownloads = record.pageDownloads.map((event) => {
        const pageUrl = transientPageDownloadUrls.get(event.eventToken);
        if (
          pageUrl === undefined ||
          (transientUrls.url !== pageUrl && transientUrls.finalUrl !== pageUrl)
        )
          return event;
        return {
          ...event,
          exactDownloadIds: [
            ...new Set([...(event.exactDownloadIds ?? []), item.id]),
          ].slice(0, 6),
        };
      });
      const mediaIdFingerprint = await fingerprintFlowMediaIdentifier(
        record.sessionId,
        filename,
      );
      const candidate: FlowDownloadCandidate = {
        downloadId: item.id,
        filename,
        state: readBrowserState(item.state),
        extension,
        ...(url.accepted
          ? {
              urlFingerprint: url.urlFingerprint,
              urlScheme: url.schemeCategory,
            }
          : { urlRejection: url.rejection }),
        ...(finalUrl.accepted
          ? {
              finalUrlFingerprint: finalUrl.urlFingerprint,
              finalUrlScheme: finalUrl.schemeCategory,
            }
          : { finalUrlRejection: finalUrl.rejection }),
        ...(mediaIdFingerprint ? { mediaIdFingerprint } : {}),
        ...(assetPathFingerprint ? { assetPathFingerprint } : {}),
        startedOffsetMs: Math.max(0, now() - record.startedAt),
        ...(item.error
          ? { interruptCode: sanitizeInterruptCode(item.error) }
          : {}),
      };
      const resolvedDownloadRecord = await resolveDetailFileLocation({
        ...record,
        downloadCreatedEvents: received,
        pageDownloads,
        downloads: [...record.downloads, candidate],
      });
      const next = updateAssociation(resolvedDownloadRecord, now());
      await persist(next);
      if (next.status === "completed")
        await detachCompletedWhenDrained(next);
      else if (next.status === "interrupted" && !collectingAfterDebuggerDetach)
        await detach(next);
    });
  }

  async function onDownloadChanged(delta: {
    id: number;
    state?: { current?: string };
    filename?: { current?: string };
    error?: { current?: string };
  }) {
    await loaded;
    await enqueue(async () => {
      const record = current;
      const collectingAfterDebuggerDetach =
        record?.status === "interrupted" &&
        record.interruptionReason === "debugger_detached";
      if (!record || (!isActive(record) && !collectingAfterDebuggerDetach))
        return;
      const index = record.downloads.findIndex(
        (candidate) => candidate.downloadId === delta.id,
      );
      if (index < 0) return;
      const downloads = [...record.downloads];
      const prior = downloads[index]!;
      const filename = delta.filename?.current
        ? sanitizeFlowDownloadFilename(delta.filename.current)
        : prior.filename;
      const filenameAvailable =
        Boolean(delta.filename?.current) && filename !== "unknown-file";
      const extension =
        prior.extension === "pending" && filenameAvailable
          ? flowDownloadExtension(filename)
          : prior.extension;
      if (
        prior.extension === "pending" &&
        filenameAvailable &&
        extension === "other"
      ) {
        downloads.splice(index, 1);
        const next = await persist({
          ...record,
          downloads,
          nonVideoDownloadCount: Math.min(
            100,
            record.nonVideoDownloadCount + 1,
          ),
        });
        // The now-classified non-video ID is intentionally excluded from candidate association.
        if (next.status === "completed")
          await detachCompletedWhenDrained(next);
        return;
      }
      downloads[index] = {
        ...prior,
        extension,
        ...(delta.state
          ? { state: readBrowserState(delta.state.current) }
          : {}),
        filename,
        ...(delta.error?.current
          ? { interruptCode: sanitizeInterruptCode(delta.error.current) }
          : {}),
      };
      const resolvedDownloadRecord =
        downloads[index]!.state === "complete"
          ? await resolveDetailFileLocation({ ...record, downloads })
          : { ...record, downloads };
      const next = updateAssociation(resolvedDownloadRecord, now());
      await persist(next);
      if (next.status === "completed")
        await detachCompletedWhenDrained(next);
      else if (next.status === "interrupted" && !collectingAfterDebuggerDetach)
        await detach(next);
    });
  }

  async function onAlarm(name: string): Promise<boolean> {
    if (name !== FLOW_GALLERY_DIAGNOSTIC_ALARM) return false;
    await loaded;
    await enqueue(async () => {
      if (
        current?.status === "completed" &&
        metadataRequests.size > 0 &&
        now() >= current.expiresAt
      ) {
        const pending = metadataRequests.size;
        let expiredRecord = appendPendingMetadataDiagnostics(current);
        metadataRequests.clear();
        expiredRecord = incrementMetadataCounter(
          expiredRecord,
          "detailMetadataBodiesUnavailable",
          pending,
        );
        expiredRecord = incrementMetadataCounter(
          expiredRecord,
          "detailMetadataBodiesOmitted",
          pending,
        );
        expiredRecord = await persist(expiredRecord);
        await detach(expiredRecord);
        clearTransientUrlComparisons();
        return;
      }
      if (current && isActive(current) && now() >= current.expiresAt)
        await finish(current, "expired");
    });
    return true;
  }

  const pageListener: FlowDownloadDiagnosticDebuggerEventListener = (
    source,
    method,
    params,
  ) => {
    void onDebuggerEvent(source, method, params).catch(() => undefined);
  };
  const detachedListener: FlowDownloadDiagnosticDebuggerDetachListener = (
    source,
  ) => {
    void enqueue(async () => {
      const record = current;
      if (
        record?.status === "completed" &&
        record.tabId === source.tabId &&
        metadataRequests.size > 0
      ) {
        const pending = metadataRequests.size;
        let failedRecord = appendPendingMetadataDiagnostics(record);
        metadataRequests.clear();
        failedRecord = incrementMetadataCounter(
          failedRecord,
          "detailMetadataBodiesUnavailable",
          pending,
        );
        failedRecord = incrementMetadataCounter(
          failedRecord,
          "detailMetadataBodiesOmitted",
          pending,
        );
        await persist(failedRecord);
        clearTransientUrlComparisons();
        return;
      }
      if (record && isActive(record) && record.tabId === source.tabId)
        await finish(
          { ...record, interruptionReason: "debugger_detached" },
          "interrupted",
        );
    }).catch(() => undefined);
  };
  const createdListener = (item: ChromeDownloadItem) => {
    void onDownloadCreated(item).catch(() => undefined);
  };
  const changedListener = (delta: Parameters<typeof onDownloadChanged>[0]) => {
    void onDownloadChanged(delta).catch(() => undefined);
  };
  dependencies.debugger.onEvent.addListener(pageListener);
  dependencies.debugger.onDetach.addListener(detachedListener);
  const registerDownloadListeners = () => {
    if (
      dependencies.downloads.onCreated.available?.() === false ||
      dependencies.downloads.onChanged.available?.() === false
    )
      return false;
    try {
      if (!createdListenerRegistered) {
        dependencies.downloads.onCreated.addListener(createdListener);
        createdListenerRegistered = true;
      }
      if (!changedListenerRegistered) {
        dependencies.downloads.onChanged.addListener(changedListener);
        changedListenerRegistered = true;
      }
      return createdListenerRegistered && changedListenerRegistered;
    } catch {
      return false;
    }
  };
  // Register synchronously at worker startup when the optional permission is already present.
  registerDownloadListeners();

  return {
    arm,
    stop,
    get,
    importCurrentClip,
    listImportedClips,
    inspectClipDownloadProof,
    armClipDownloadProof,
    startClipDownload,
    startProjectVideoImport,
    getProjectVideoImport,
    cancelProjectVideoImport,
    ingestPageEvent,
    onAlarm,
    dispose() {
      dependencies.debugger.onEvent.removeListener?.(pageListener);
      dependencies.debugger.onDetach.removeListener?.(detachedListener);
      if (createdListenerRegistered)
        dependencies.downloads.onCreated.removeListener?.(createdListener);
      if (changedListenerRegistered)
        dependencies.downloads.onChanged.removeListener?.(changedListener);
    },
  };
}
