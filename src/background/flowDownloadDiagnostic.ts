import type { ExtensionRepositories } from "../storage/repositories";
import { BUILD_ID, PROTOCOL_VERSION } from "../shared/buildInfo";
import { flowTabFromUrl, sameFlowDocument } from "../platforms/flow/connection";
import {
  FlowClipImportRecordSchema,
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
import {
  FLOW_GALLERY_DIAGNOSTIC_ALARM,
  FLOW_GALLERY_DIAGNOSTIC_STORAGE_KEY,
  FLOW_GALLERY_DIAGNOSTIC_TTL_MS,
  FlowGalleryDiagnosticPageMessageSchema,
  FlowGalleryDownloadDiagnosticSchema,
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
  };
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

/** One-shot Flow Gallery observation; stores only bounded, sanitized session evidence. */
export function createFlowDownloadDiagnosticManager(
  dependencies: FlowDownloadDiagnosticDependencies,
) {
  const now = dependencies.now ?? Date.now;
  const createSessionId =
    dependencies.createSessionId ?? (() => crypto.randomUUID());
  let current: FlowGalleryDownloadDiagnostic | undefined;
  let createdListenerRegistered = false;
  let changedListenerRegistered = false;
  let metadataRequestCount = 0;
  let eventQueue: Promise<void> = Promise.resolve();
  // Raw URLs are kept only in bounded worker memory for exact equality checks.
  // Persisted diagnostics contain fingerprints, allowlisted schemes, and IDs only.
  const transientPageDownloadUrls = new Map<string, string>();
  const transientChromeDownloadUrls = new Map<
    number,
    { url?: string; finalUrl?: string }
  >();
  const metadataRequests = new Map<
    string,
    {
      token: string;
      frameId: string;
      offsetMs: number;
      responseReceived: boolean;
      responseJson: boolean;
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
  ) => ({
    ...record,
    [key]: Math.min(100, ((record[key] as number | undefined) ?? 0) + amount),
  });

  const inspectMetadataBody = async (
    record: FlowGalleryDownloadDiagnostic,
    requestToken: string,
    role: "request_body" | "response_body",
    body: unknown,
    offsetMs: number,
  ) => {
    const inspection = await inspectFlowDetailMetadataBody(
      record.sessionId,
      requestToken,
      role,
      body,
      offsetMs,
    );
    let next = record;
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

  async function importCurrentClip() {
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
  ) {
    await loaded;
    return enqueue(async () => {
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
        if (!isFlow1080pProofClip(detailClipRow.clipId))
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
        ...(detailClipRow
          ? {
              detailMetadataCaptureEnabled: true,
              detailMetadataFields: [],
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
          func: installFlowGalleryDownloadObserver,
          args: [
            sessionId,
            binding.projectId,
            captureIdentityEnabled,
            captureMode,
            detailClipRow?.clipId,
            assetPathFingerprint,
          ],
        });
        const observerResult = injected[0]?.result as
          | {
              installed?: boolean;
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
      const capturedAt = now();
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
            responseJson: false,
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
        const response = params.response as { mimeType?: unknown } | undefined;
        if (context) {
          context.responseReceived = true;
          context.responseJson =
            typeof response?.mimeType === "string" &&
            /(?:json|graphql)/i.test(response.mimeType);
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
          metadataRequests.delete(requestId!);
          responseRecord = await persist(responseRecord);
          await detachCompletedWhenDrained(responseRecord);
          return;
        }
        if (!context.responseJson) {
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesUnsupported",
          );
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
          metadataRequests.delete(requestId!);
          responseRecord = await persist(responseRecord);
          await detachCompletedWhenDrained(responseRecord);
          return;
        }
        const body = bodyResult as { body?: unknown; base64Encoded?: unknown } | undefined;
        if (typeof body?.body !== "string") {
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesUnavailable",
          );
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesOmitted",
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
        if (body.base64Encoded === true) {
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesUnsupported",
          );
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesOmitted",
          );
          metadataRequests.delete(requestId!);
          responseRecord = await persist(responseRecord);
          await detachCompletedWhenDrained(responseRecord);
          return;
        }
        if (body.body.length > 64 * 1024) {
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesFiltered",
          );
          responseRecord = incrementMetadataCounter(
            responseRecord,
            "detailMetadataBodiesOmitted",
          );
          metadataRequests.delete(requestId!);
          responseRecord = await persist(responseRecord);
          await detachCompletedWhenDrained(responseRecord);
          return;
        }
        responseRecord = await inspectMetadataBody(
          responseRecord,
          context.token,
          "response_body",
          body.body,
          Math.max(0, capturedAt - responseRecord.startedAt),
        );
        metadataRequests.delete(requestId!);
        responseRecord = await persist(responseRecord);
        await detachCompletedWhenDrained(responseRecord);
        return;
      }
      if (method === "Network.loadingFailed") {
        const requestId = typeof params.requestId === "string" ? params.requestId : undefined;
        if (!requestId || !metadataRequests.has(requestId)) return;
        metadataRequests.delete(requestId);
        let failedRecord = incrementMetadataCounter(
          record,
          "detailMetadataBodiesFailed",
        );
        failedRecord = incrementMetadataCounter(
          failedRecord,
          "detailMetadataBodiesOmitted",
        );
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
            record.actionAt !== undefined && capturedAt >= record.actionAt,
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
        metadataRequests.clear();
        let expiredRecord = incrementMetadataCounter(
          current,
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
        metadataRequests.clear();
        let failedRecord = incrementMetadataCounter(
          record,
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
