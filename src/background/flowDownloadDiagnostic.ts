import type { ExtensionRepositories } from "../storage/repositories";
import { BUILD_ID, PROTOCOL_VERSION } from "../shared/buildInfo";
import { flowTabFromUrl, sameFlowDocument } from "../platforms/flow/connection";
import {
  FLOW_GALLERY_DIAGNOSTIC_ALARM,
  FLOW_GALLERY_DIAGNOSTIC_STORAGE_KEY,
  FLOW_GALLERY_DIAGNOSTIC_TTL_MS,
  FlowGalleryDiagnosticPageMessageSchema,
  FlowGalleryDownloadDiagnosticSchema,
  fingerprintFlowDownloadUrl,
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
  repositories: Pick<ExtensionRepositories, "getSelectedTarget">;
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
  return resolveFlowDownloadDiagnosticStatus(record, at);
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
  let eventQueue: Promise<void> = Promise.resolve();
  // Raw URLs are kept only in bounded worker memory for exact equality checks.
  // Persisted diagnostics contain fingerprints, allowlisted schemes, and IDs only.
  const transientPageDownloadUrls = new Map<string, string>();
  const transientChromeDownloadUrls = new Map<
    number,
    { url?: string; finalUrl?: string }
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
    current = FlowGalleryDownloadDiagnosticSchema.parse(next);
    await dependencies.storage.set({
      [FLOW_GALLERY_DIAGNOSTIC_STORAGE_KEY]: current,
    });
    return current;
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
    const next = await persist({ ...record, status });
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
    return { selected, binding };
  };

  async function arm() {
    await loaded;
    return enqueue(async () => {
      if (isActive(current)) throw new Error("flow_diagnostic_already_active");
      clearTransientUrlComparisons();
      const permissions = await dependencies.permissions.contains({
        permissions: ["debugger", "tabs", "scripting", "downloads"],
      });
      if (!permissions) throw new Error("flow_diagnostic_permissions_missing");
      if (!registerDownloadListeners())
        throw new Error("flow_downloads_api_unavailable");
      const { selected, binding } = await verifySelectedFlowTarget();
      const sessionId = createSessionId();
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
          { maxTotalBufferSize: 0, maxResourceBufferSize: 0 },
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
          args: [sessionId],
        });
        if (
          injected[0]?.documentId !== binding.documentId ||
          !(injected[0]?.result as { installed?: boolean } | undefined)
            ?.installed
        )
          throw new Error("flow_diagnostic_observer_install_failed");
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
          selectedCard: {
            token: "selected-card-1",
            ownerFound: message.ownerFound,
            stableIdAttributeObserved: message.stableIdAttributeObserved,
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
      } else if (message.stage === "capture_issue") {
        next = {
          ...record,
          captureIssue: { stage: message.failedStage, reason: message.reason },
        };
      }
      next = updateAssociation(next, now());
      await persist(next);
      if (next.status === "completed" || next.status === "interrupted")
        await detach(next);
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
      const record = current;
      if (!record || !isActive(record) || now() >= record.expiresAt) return;
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
        const request = params.request as
          { url?: unknown; method?: unknown } | undefined;
        const fingerprints = await fingerprintFlowDownloadUrl(
          record.sessionId,
          request?.url,
        );
        if (!fingerprints.accepted) return;
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
          ...(fingerprints.mediaIdFingerprint
            ? { mediaIdFingerprint: fingerprints.mediaIdFingerprint }
            : {}),
          offsetMs: Math.max(0, capturedAt - record.startedAt),
        };
        if (record.mediaRequests.length >= 16) {
          const actionAt = record.actionAt ?? record.qualityActionAcceptedAt;
          const matchesActionIdentity = (candidate: FlowDownloadMediaRequest) =>
            actionAt !== undefined &&
            record.startedAt + candidate.offsetMs >= actionAt &&
            record.pageDownloads.some(
              (event) =>
                event.frameMatched &&
                record.startedAt + event.offsetMs >= actionAt &&
                (candidate.urlFingerprint === event.urlFingerprint ||
                  (candidate.mediaIdFingerprint !== undefined &&
                    (candidate.mediaIdFingerprint ===
                      event.mediaIdFingerprint ||
                      event.exactDownloadIds?.some((downloadId) => {
                        const download = record.downloads.find(
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
        const next = updateAssociation(
          {
            ...pageObservedRecord,
            pageDownloads: [...record.pageDownloads, pageEvent],
          },
          now(),
        );
        await persist(next);
        if (next.status === "completed" || next.status === "interrupted")
          await detach(next);
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
        startedOffsetMs: Math.max(0, now() - record.startedAt),
        ...(item.error
          ? { interruptCode: sanitizeInterruptCode(item.error) }
          : {}),
      };
      const next = updateAssociation(
        {
          ...record,
          downloadCreatedEvents: received,
          pageDownloads,
          downloads: [...record.downloads, candidate],
        },
        now(),
      );
      await persist(next);
      if (
        next.status === "completed" ||
        (next.status === "interrupted" && !collectingAfterDebuggerDetach)
      )
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
        if (next.status === "completed") await detach(next);
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
      const next = updateAssociation({ ...record, downloads }, now());
      await persist(next);
      if (
        next.status === "completed" ||
        (next.status === "interrupted" && !collectingAfterDebuggerDetach)
      )
        await detach(next);
    });
  }

  async function onAlarm(name: string): Promise<boolean> {
    if (name !== FLOW_GALLERY_DIAGNOSTIC_ALARM) return false;
    await loaded;
    await enqueue(async () => {
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
