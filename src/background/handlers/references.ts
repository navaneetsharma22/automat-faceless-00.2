import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import { flowTabFromUrl } from "../../platforms/flow/connection";
import type {
  ActiveReferenceSelectionSession,
  FlowReferenceCandidateSelectedMessage,
  FlowReferencePickerCandidate,
  ReferenceCandidate,
} from "../../shared/schemas";
import {
  FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE,
  FLOW_REFERENCE_EVENT_MESSAGE,
  FlowReferenceCandidateSelectedMessageSchema,
  FlowReferencePickerCandidateSchema,
  ReferenceCandidateSchema,
} from "../../shared/schemas";
import type { ExtensionRepositories } from "../../storage/repositories";
import { sha256Hex } from "../../domain/batches/hashPrompt";
import {
  MAX_REFERENCE_CAPTURE_BYTES,
  MAX_REFERENCE_CAPTURE_PIXELS,
  ReferenceAssignmentRecordSchema,
  referenceAssignmentId,
  sha256Bytes,
  type ReferenceAssignmentRecord,
} from "../../domain/media/references";
import {
  createFlowReferenceSelectionInjection,
  createFlowReferenceCaptureResolverInjection,
  FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
  flowReferenceContextMenuId,
} from "../../platforms/flow/references";
import {
  fetchFlowReferenceBytes,
  decodeFlowReferenceImage,
  flowReferenceResource,
  resolveFlowReferenceFetcher,
  sameFlowReferenceResource,
  flowReferenceSignatureValid,
} from "../../platforms/flow/referenceResource";
import type { ExtensionMessageSender } from "./connections";

export type FlowReferenceHandlerDependencies = {
  extensionId: string;
  repositories: ExtensionRepositories;
  storageSession?: {
    get: (keys: string | string[]) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
    remove: (keys: string | string[]) => Promise<void>;
  };
  scripting?: {
    executeScript: (
      injection: unknown,
    ) => Promise<
      Array<{ documentId?: string; frameId?: number; result?: unknown }>
    >;
  };
  broadcastMessage?: (message: unknown) => Promise<unknown>;
  contextMenu?: {
    ready?: Promise<void>;
    create: (session: ActiveReferenceSelectionSession) => Promise<void>;
    remove: (sessionId: string) => Promise<void>;
  };
  sendToDocument?: (
    tabId: number,
    documentId: string,
    message: unknown,
  ) => Promise<unknown>;
  now?: () => number;
  hasMediaHostPermission?: (originPattern: string) => Promise<boolean>;
  fetchResource?: typeof fetch;
};

export type FlowReferenceContextMenuClick = {
  menuItemId: string | number;
  mediaType?: string;
  srcUrl?: string;
  pageUrl?: string;
  frameUrl?: string;
  frameId?: number;
};

export type FlowReferenceContextMenuTab = {
  id?: number;
  url?: string;
};

export class ReferenceSelectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly category:
      | "invalid_request"
      | "not_found"
      | "unauthorized_sender"
      | "context_invalidated" = "invalid_request",
  ) {
    super(message);
    this.name = "ReferenceSelectionError";
  }
}

// In-memory fallback if chrome.storage.session is not available in node/tests
class MemorySessionStorage {
  private data = new Map<string, unknown>();

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const key of keyList) {
      if (this.data.has(key)) {
        result[key] = this.data.get(key);
      }
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.data.set(key, value);
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const key of keyList) {
      this.data.delete(key);
    }
  }
}

const ACTIVE_SESSION_STORAGE_KEY = "flow_reference_active_session";
const TRANSIENT_CANDIDATES_STORAGE_KEY = "flow_reference_transient_candidates";

export function createFlowReferenceHandler(
  dependencies: FlowReferenceHandlerDependencies,
) {
  const now = dependencies.now ?? Date.now;
  const fetcher = resolveFlowReferenceFetcher(dependencies.fetchResource);
  const storage =
    dependencies.storageSession ??
    (typeof chrome !== "undefined" && chrome.storage?.session
      ? chrome.storage.session
      : new MemorySessionStorage());

  const scripting =
    dependencies.scripting ??
    (typeof chrome !== "undefined" && chrome.scripting
      ? chrome.scripting
      : undefined);

  const broadcast =
    dependencies.broadcastMessage ??
    ((msg: unknown) =>
      typeof chrome !== "undefined" && chrome.runtime?.sendMessage
        ? chrome.runtime.sendMessage(msg).catch(() => undefined)
        : Promise.resolve());

  const removeContextMenu = async (sessionId: string) => {
    try {
      await dependencies.contextMenu?.remove(sessionId);
    } catch {
      // Stale menu entries are harmless: their session IDs are rejected below.
    }
  };
  const candidateClaims = new Set<string>();
  const captureClaims = new Set<string>();
  const activeCaptures = new Map<string, ActiveReferenceSelectionSession>();
  const captureControllers = new Map<string, AbortController>();
  const shotLocks = new Map<string, Promise<void>>();

  const withShotLock = async <T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    const previous = shotLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    shotLocks.set(key, current);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (shotLocks.get(key) === current) shotLocks.delete(key);
    }
  };
  const previewClaims = new Map<
    string,
    {
      sessionId: string;
      candidateId: string;
      active: ActiveReferenceSelectionSession;
      controller: AbortController;
    }
  >();

  const resolvePickerCandidate = async (
    active: ActiveReferenceSelectionSession,
    candidateId: string,
  ): Promise<FlowReferencePickerCandidate> => {
    const raw = await dependencies.sendToDocument!(
      active.tabId,
      active.documentId,
      {
        type: "AUTOMAT_FLOW_REFERENCE_PICKER_REQUEST",
        action: "resolve",
        buildId: BUILD_ID,
        sessionId: active.sessionId,
        candidateId,
      },
    );
    if (
      !raw ||
      typeof raw !== "object" ||
      !("ok" in raw) ||
      raw.ok !== true ||
      !("buildId" in raw) ||
      raw.buildId !== BUILD_ID ||
      !("sessionId" in raw) ||
      raw.sessionId !== active.sessionId ||
      !("candidate" in raw) ||
      !raw.candidate ||
      typeof raw.candidate !== "object" ||
      !("candidateId" in raw.candidate) ||
      raw.candidate.candidateId !== candidateId
    ) {
      const code =
        raw !== null &&
        typeof raw === "object" &&
        "code" in raw &&
        typeof raw.code === "string"
          ? raw.code
          : "candidate_missing_or_changed";
      throw new ReferenceSelectionError(
        code,
        "This image changed or disappeared from the verified Flow document. Refresh the picker and choose again.",
      );
    }
    const parsed = FlowReferencePickerCandidateSchema.safeParse(raw.candidate);
    if (!parsed.success)
      throw new ReferenceSelectionError(
        "candidate_invalid",
        "Flow returned invalid image evidence. Refresh the picker and retry.",
      );
    return parsed.data;
  };
  const abortSessionPreviews = async (sessionId: string) => {
    for (const claim of previewClaims.values())
      if (claim.sessionId === sessionId) claim.controller.abort();
  };

  const getActiveSession =
    async (): Promise<ActiveReferenceSelectionSession | null> => {
      const records = await storage.get(ACTIVE_SESSION_STORAGE_KEY);
      return (
        (records[
          ACTIVE_SESSION_STORAGE_KEY
        ] as ActiveReferenceSelectionSession) ?? null
      );
    };

  const setActiveSession = async (
    session: ActiveReferenceSelectionSession | null,
  ): Promise<void> => {
    if (session) {
      await storage.set({ [ACTIVE_SESSION_STORAGE_KEY]: session });
    } else {
      await storage.remove(ACTIVE_SESSION_STORAGE_KEY);
    }
  };

  const getTransientCandidatesMap = async (
    workspaceId: string,
    batchId: string,
  ): Promise<Record<string, ReferenceCandidate>> => {
    const key = `${TRANSIENT_CANDIDATES_STORAGE_KEY}:${workspaceId}:${batchId}`;
    const records = await storage.get(key);
    return (records[key] as Record<string, ReferenceCandidate>) ?? {};
  };

  const setTransientCandidate = async (
    workspaceId: string,
    batchId: string,
    shotId: string,
    candidate: ReferenceCandidate,
  ): Promise<void> => {
    const key = `${TRANSIENT_CANDIDATES_STORAGE_KEY}:${workspaceId}:${batchId}`;
    const current = await getTransientCandidatesMap(workspaceId, batchId);
    await storage.set({
      [key]: {
        ...current,
        [shotId]: candidate,
      },
    });
  };

  const clearTransientCandidate = async (
    workspaceId: string,
    batchId: string,
    shotId: string,
  ): Promise<void> => {
    const key = `${TRANSIENT_CANDIDATES_STORAGE_KEY}:${workspaceId}:${batchId}`;
    const current = await getTransientCandidatesMap(workspaceId, batchId);
    const updated = { ...current };
    delete updated[shotId];
    await storage.set({ [key]: updated });
  };

  const clearAllTransientCandidates = async (
    workspaceId: string,
    batchId: string,
  ): Promise<void> => {
    const key = `${TRANSIENT_CANDIDATES_STORAGE_KEY}:${workspaceId}:${batchId}`;
    await storage.remove(key);
  };

  const validatePickerSession = async (sessionId: string) => {
    const active = await getActiveSession();
    if (
      !active ||
      active.status !== "active" ||
      active.sessionId !== sessionId
    ) {
      throw new ReferenceSelectionError(
        "stale_session",
        "This Flow image picker session is no longer active. Reopen Browse Flow images for the selected Shot.",
      );
    }
    const selected = await dependencies.repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (
      !selected ||
      selected.verification !== "verified" ||
      selected.connectionState !== "verified" ||
      selected.tabId !== active.tabId ||
      selected.canonicalTarget !== active.canonicalTarget ||
      binding?.projectId !== active.projectId ||
      binding.documentId !== active.documentId ||
      binding.frameId !== 0 ||
      binding.extensionBuildId !== BUILD_ID ||
      binding.connectorBuildId !== BUILD_ID ||
      binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
      binding.connectorProtocolVersion !== 1
    ) {
      throw new ReferenceSelectionError(
        "project_connection_changed",
        "The verified Flow project or document changed. Reconnect Flow and reopen the picker.",
      );
    }
    const savedBatch = await dependencies.repositories.getPromptBatch(
      active.workspaceId,
      "image",
    );
    if (
      !savedBatch ||
      savedBatch.batch.id !== active.batchId ||
      active.sourceHash !== active.batchId ||
      savedBatch.items.filter((item) => item.shotId === active.shotId)
        .length !== 1
    ) {
      throw new ReferenceSelectionError(
        "batch_or_shot_changed",
        "The saved batch or Shot binding changed. Reload References and retry.",
      );
    }
    if (!scripting?.executeScript || !dependencies.sendToDocument) {
      throw new ReferenceSelectionError(
        "picker_unavailable",
        "The verified Flow document cannot provide image candidates in this worker context.",
        "context_invalidated",
      );
    }
    try {
      const [document] = await scripting.executeScript({
        target: { tabId: active.tabId, frameIds: [0] },
        func: () => location.href,
      });
      const currentPage = flowTabFromUrl(
        active.tabId,
        "",
        document?.result as string,
      );
      if (
        document?.documentId !== active.documentId ||
        document.frameId !== 0 ||
        !currentPage ||
        currentPage.canonicalTarget !== active.canonicalTarget
      ) {
        throw new ReferenceSelectionError(
          "wrong_document",
          "The Flow tab no longer shows the verified project document. Reconnect and reopen the picker.",
        );
      }
    } catch (error) {
      if (error instanceof ReferenceSelectionError) throw error;
      throw new ReferenceSelectionError(
        "document_unavailable",
        "The verified Flow document is unavailable. Keep the project open and retry.",
        "context_invalidated",
      );
    }
    return active;
  };

  const captureShotKey = (
    workspaceId: string,
    batchId: string,
    shotId: string,
  ) => `${workspaceId}:${batchId}:${shotId}`;
  const referenceMetadata = (record: ReferenceAssignmentRecord) => {
    return Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== "bytes"),
    ) as Omit<ReferenceAssignmentRecord, "bytes">;
  };
  const validateCaptureContext = async (input: {
    workspaceId: string;
    batchId: string;
    shotId: string;
    selectionVersion: string;
  }) => {
    const candidates = await getTransientCandidatesMap(
      input.workspaceId,
      input.batchId,
    );
    const candidate = candidates[input.shotId];
    if (
      !candidate ||
      candidate.selectionVersion !== input.selectionVersion ||
      candidate.workspaceId !== input.workspaceId ||
      candidate.batchId !== input.batchId ||
      candidate.shotId !== input.shotId ||
      !candidate.promptHash ||
      !candidate.batchSourceHash ||
      !candidate.flowProjectId ||
      !candidate.canonicalTarget ||
      !candidate.documentId ||
      !candidate.observedSourceSha256
    ) {
      throw new ReferenceSelectionError(
        "candidate_replaced_or_missing",
        "The accepted candidate changed or was cleared. Select the intended Flow image again before saving.",
      );
    }
    const savedBatch = await dependencies.repositories.getPromptBatch(
      input.workspaceId,
      "image",
    );
    const matchingItems =
      savedBatch?.items.filter((item) => item.shotId === input.shotId) ?? [];
    if (
      !savedBatch ||
      savedBatch.batch.id !== input.batchId ||
      matchingItems.length !== 1 ||
      (await sha256Hex(savedBatch.batch.sourceText)) !==
        candidate.batchSourceHash ||
      (await sha256Hex(matchingItems[0]!.rawJsonBody)) !== candidate.promptHash
    ) {
      throw new ReferenceSelectionError(
        "capture_source_changed",
        "The saved image source or Shot prompt changed after selection. Reload References and select again.",
      );
    }
    const selected = await dependencies.repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (
      !selected ||
      selected.verification !== "verified" ||
      selected.connectionState !== "verified" ||
      selected.tabId !== candidate.tabId ||
      selected.canonicalTarget !== candidate.canonicalTarget ||
      binding?.projectId !== candidate.flowProjectId ||
      binding.documentId !== candidate.documentId ||
      binding.frameId !== 0 ||
      binding.extensionBuildId !== BUILD_ID ||
      binding.connectorBuildId !== BUILD_ID ||
      binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
      binding.connectorProtocolVersion !== 1
    ) {
      throw new ReferenceSelectionError(
        "capture_project_or_document_changed",
        "Reconnect the same verified Flow project and document before saving this reference.",
      );
    }
    try {
      const [document] = await scripting!.executeScript({
        target: { tabId: selected.tabId, frameIds: [0] },
        func: () => location.href,
      });
      const route = flowTabFromUrl(
        selected.tabId,
        "",
        document?.result as string,
      );
      if (
        document?.documentId !== candidate.documentId ||
        document.frameId !== 0 ||
        !route ||
        route.canonicalTarget !== candidate.canonicalTarget
      )
        throw new Error("document_changed");
    } catch {
      throw new ReferenceSelectionError(
        "capture_document_changed",
        "The verified Flow project document changed or is unavailable. Reconnect before saving.",
        "context_invalidated",
      );
    }
    return { candidate, savedBatch, item: matchingItems[0]!, selected };
  };
  const resolveCaptureCandidateInDocument = async (
    session: ActiveReferenceSelectionSession,
    candidate: ReferenceCandidate,
  ) => {
    const [result] = await scripting!.executeScript(
      createFlowReferenceCaptureResolverInjection({
        tabId: session.tabId,
        documentId: session.documentId,
        expected: {
          sourceUrl: candidate.sourceUrl,
          ...(candidate.providerAssetId
            ? { providerAssetId: candidate.providerAssetId }
            : {}),
          cardTag: candidate.cardTag,
          naturalWidth: candidate.naturalWidth,
          naturalHeight: candidate.naturalHeight,
        },
      }),
    );
    if (
      result?.documentId !== session.documentId ||
      result.frameId !== 0 ||
      !result.result ||
      typeof result.result !== "object" ||
      !("ok" in result.result) ||
      result.result.ok !== true ||
      !("candidate" in result.result) ||
      !result.result.candidate ||
      typeof result.result.candidate !== "object"
    ) {
      const code =
        result?.result &&
        typeof result.result === "object" &&
        "code" in result.result &&
        typeof result.result.code === "string"
          ? result.result.code.slice(0, 64)
          : "capture_candidate_unverified";
      throw new ReferenceSelectionError(
        code,
        "The exact accepted image is missing, changed, or ambiguous in the verified Flow document. Refresh Flow images and select it again.",
      );
    }
    return result.result.candidate as Record<string, unknown>;
  };
  const cancelCaptureInPage = async (captureOperationId: string) => {
    captureControllers.get(captureOperationId)?.abort();
  };
  const cancelCapturesForShot = async (
    workspaceId: string,
    batchId: string,
    shotId: string,
  ) => {
    const operationIds =
      await dependencies.repositories.cancelReferenceCapturesForShot(
        workspaceId,
        batchId,
        shotId,
        now(),
      );
    await Promise.all(operationIds.map(cancelCaptureInPage));
  };

  const captureReference = async (input: {
    workspaceId: string;
    batchId: string;
    shotId: string;
    selectionVersion: string;
    expectedAssignmentVersion: number;
    captureOperationId: string;
  }): Promise<{
    saved: true;
    reference: Omit<ReferenceAssignmentRecord, "bytes">;
  }> => {
    const existingAssignment =
      await dependencies.repositories.getReferenceByOperation(
        input.captureOperationId,
      );
    if (existingAssignment) {
      if (
        existingAssignment.workspaceId !== input.workspaceId ||
        existingAssignment.batchId !== input.batchId ||
        existingAssignment.shotId !== input.shotId ||
        existingAssignment.selectionVersion !== input.selectionVersion
      )
        throw new ReferenceSelectionError(
          "capture_operation_id_conflict",
          "This operation ID belongs to another saved reference.",
        );
      return { saved: true, reference: referenceMetadata(existingAssignment) };
    }
    const existingOperation =
      await dependencies.repositories.getReferenceCaptureOperation(
        input.captureOperationId,
      );
    if (existingOperation)
      throw new ReferenceSelectionError(
        existingOperation.status === "acquiring"
          ? "capture_outcome_uncertain"
          : (existingOperation.reason ?? "capture_operation_closed"),
        existingOperation.status === "acquiring"
          ? "This capture operation has already started. Check its status; it will not be repeated automatically."
          : "This capture operation is closed. Review the current selection before starting a new save.",
      );
    if (captureClaims.has(input.captureOperationId))
      throw new ReferenceSelectionError(
        "capture_already_running",
        "This reference capture is already running.",
      );
    if (captureClaims.size >= 2)
      throw new ReferenceSelectionError(
        "capture_concurrency_limit",
        "Two reference captures are already running. Wait for one to finish before saving another.",
      );
    captureClaims.add(input.captureOperationId);
    let operationStarted = false;
    let flowSession: ActiveReferenceSelectionSession | undefined;
    try {
      const context = await validateCaptureContext(input);
      const { candidate, savedBatch, item, selected } = context;
      if (
        !candidate.selectionSessionId ||
        !candidate.selectionVersion ||
        !candidate.acceptedAt ||
        !candidate.tabId
      )
        throw new ReferenceSelectionError(
          "candidate_binding_missing",
          "This candidate lacks a complete accepted-selection binding. Select it again.",
        );
      const assignmentId = referenceAssignmentId(
        input.workspaceId,
        input.batchId,
        input.shotId,
      );
      const currentAssignment =
        await dependencies.repositories.getReferenceAssignment(
          input.workspaceId,
          input.batchId,
          input.shotId,
        );
      if (
        (currentAssignment?.assignmentVersion ?? 0) !==
        input.expectedAssignmentVersion
      )
        throw new ReferenceSelectionError(
          "reference_assignment_replaced",
          "The saved reference changed. Review it before replacing it.",
        );
      flowSession = {
        sessionId: candidate.selectionSessionId,
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        sourceHash: candidate.batchSourceHash!,
        shotId: input.shotId,
        tabId: selected.tabId,
        projectId: candidate.flowProjectId!,
        canonicalTarget: candidate.canonicalTarget!,
        documentId: candidate.documentId!,
        frameId: 0,
        startedAt: candidate.acceptedAt,
        status: "completed",
      };
      await dependencies.repositories.beginReferenceCapture({
        captureOperationId: input.captureOperationId,
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        batchSourceHash: candidate.batchSourceHash!,
        shotId: input.shotId,
        promptHash: candidate.promptHash!,
        selectionVersion: input.selectionVersion,
        expectedAssignmentVersion: input.expectedAssignmentVersion,
        flowProjectId: candidate.flowProjectId!,
        tabId: selected.tabId,
        canonicalTarget: candidate.canonicalTarget!,
        documentId: candidate.documentId!,
        observedSourceSha256: candidate.observedSourceSha256!,
        status: "acquiring",
        startedAt: now(),
      });
      operationStarted = true;
      activeCaptures.set(input.captureOperationId, flowSession);
      await broadcast({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "capture_progress",
        captureOperationId: input.captureOperationId,
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        shotId: input.shotId,
        stage: "capturing",
      });
      const resolved = await resolveCaptureCandidateInDocument(
        flowSession,
        candidate,
      );
      if (
        !sameFlowReferenceResource(
          resolved.sourceUrl as string,
          candidate.sourceUrl,
          candidate.providerAssetId,
        ) ||
        (candidate.cardTag !== "context-menu-image" &&
          resolved.providerAssetId !== candidate.providerAssetId) ||
        (candidate.cardTag !== "context-menu-image" &&
          resolved.cardTag !== candidate.cardTag) ||
        (candidate.naturalWidth > 0 &&
          resolved.naturalWidth !== candidate.naturalWidth) ||
        (candidate.naturalHeight > 0 &&
          resolved.naturalHeight !== candidate.naturalHeight)
      )
        throw new ReferenceSelectionError(
          "capture_candidate_changed",
          "The accepted image no longer matches the selected Flow card. Select it again.",
        );
      const controller = new AbortController();
      captureControllers.set(input.captureOperationId, controller);
      const hasPermission =
        dependencies.hasMediaHostPermission ??
        (async (permission: string) => {
          if (typeof chrome === "undefined" || !chrome.permissions?.contains)
            throw new Error("permission_api_unavailable");
          return chrome.permissions.contains({ origins: [permission] });
        });
      const fetched = await fetchFlowReferenceBytes({
        url: resolved.sourceUrl as string,
        mediaId: resolved.providerAssetId as string | undefined,
        signal: controller.signal,
        hasPermission,
        fetcher,
      }).catch((error: unknown) => {
        const code =
          error instanceof Error
            ? error.message
            : "reference_resource_transport_failed";
        throw new ReferenceSelectionError(
          code,
          `Reference capture failed (${code}). Nothing was saved.`,
        );
      });
      let bitmap: ImageBitmap;
      try {
        bitmap = await decodeFlowReferenceImage(
          fetched.bytes,
          fetched.mimeType,
          controller.signal,
        );
      } catch (error) {
        const code =
          error instanceof Error ? error.message : "capture_decode_failed";
        throw new ReferenceSelectionError(
          code,
          "The fetched image could not be decoded or capture was interrupted. Nothing was saved.",
        );
      }
      const result = {
        captureOperationId: input.captureOperationId,
        mimeType: fetched.mimeType,
        byteLength: fetched.bytes.byteLength,
        width: bitmap.width,
        height: bitmap.height,
      };
      bitmap.close();
      if (
        !("captureOperationId" in result) ||
        result.captureOperationId !== input.captureOperationId ||
        !("mimeType" in result) ||
        typeof result.mimeType !== "string" ||
        !("byteLength" in result) ||
        typeof result.byteLength !== "number" ||
        result.byteLength < 1 ||
        result.byteLength > MAX_REFERENCE_CAPTURE_BYTES ||
        !("width" in result) ||
        typeof result.width !== "number" ||
        result.width < 1 ||
        !("height" in result) ||
        typeof result.height !== "number" ||
        result.height < 1 ||
        result.width * result.height > MAX_REFERENCE_CAPTURE_PIXELS
      )
        throw new ReferenceSelectionError(
          "capture_response_invalid",
          "The Flow document returned invalid or oversized image data.",
        );
      const bytes = fetched.bytes;
      const mimeType = result.mimeType;
      if (!flowReferenceSignatureValid(mimeType, bytes))
        throw new ReferenceSelectionError(
          "capture_signature_mismatch",
          "The image bytes do not match the reported file format. Nothing was saved.",
        );
      const capturedAt = now();
      const assignment: ReferenceAssignmentRecord = {
        assignmentId,
        referenceId: crypto.randomUUID(),
        captureOperationId: input.captureOperationId,
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        batchSourceHash: candidate.batchSourceHash!,
        shotId: input.shotId,
        promptHash: item.contentHash,
        selectionVersion: input.selectionVersion,
        assignmentVersion: input.expectedAssignmentVersion + 1,
        flowProjectId: candidate.flowProjectId!,
        tabId: selected.tabId,
        canonicalTarget: candidate.canonicalTarget!,
        documentId: candidate.documentId!,
        ...(candidate.providerAssetId
          ? { providerAssetId: candidate.providerAssetId }
          : {}),
        observedSourceSha256: candidate.observedSourceSha256!,
        bytes: new Blob([bytes.slice().buffer as ArrayBuffer], {
          type: mimeType,
        }),
        mimeType: mimeType as ReferenceAssignmentRecord["mimeType"],
        byteSize: bytes.byteLength,
        sha256: await sha256Bytes(bytes),
        width: result.width,
        height: result.height,
        capturedAt,
        acquisitionProvenance: "verified_flow_document_extension_fetch",
        qualityProvenance: "observed_resource_original_bytes_no_upscale",
      };
      if (!ReferenceAssignmentRecordSchema.safeParse(assignment).success)
        throw new ReferenceSelectionError(
          "capture_metadata_invalid",
          "The image metadata failed validation. Nothing was saved.",
        );
      await broadcast({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "capture_progress",
        captureOperationId: input.captureOperationId,
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        shotId: input.shotId,
        stage: "saving",
      });
      const saved = await withShotLock(
        captureShotKey(input.workspaceId, input.batchId, input.shotId),
        async () => {
          const latest = await validateCaptureContext(input);
          const current = await resolveCaptureCandidateInDocument(
            flowSession!,
            latest.candidate,
          );
          if (
            latest.candidate.selectionVersion !== input.selectionVersion ||
            !sameFlowReferenceResource(
              current.sourceUrl as string,
              candidate.sourceUrl,
              candidate.providerAssetId,
            ) ||
            (candidate.cardTag !== "context-menu-image" &&
              current.providerAssetId !== candidate.providerAssetId) ||
            (candidate.cardTag !== "context-menu-image" &&
              current.cardTag !== candidate.cardTag)
          )
            throw new ReferenceSelectionError(
              "candidate_replaced_or_missing",
              "The selected image changed during capture; the previous saved reference was kept.",
            );
          return dependencies.repositories.commitReferenceCapture({
            assignment,
            expectedSourceText: savedBatch.batch.sourceText,
            expectedPromptBody: item.rawJsonBody,
          });
        },
      );
      await broadcast({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "reference_saved",
        captureOperationId: input.captureOperationId,
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        shotId: input.shotId,
        referenceId: saved.referenceId,
      });
      return { saved: true, reference: referenceMetadata(saved) };
    } catch (error) {
      if (operationStarted) {
        const reason =
          error instanceof ReferenceSelectionError
            ? error.code
            : "capture_storage_or_transport_failed";
        await dependencies.repositories
          .updateReferenceCaptureOperation(
            input.captureOperationId,
            "failed",
            reason,
            now(),
          )
          .catch(() => undefined);
      }
      if (error instanceof ReferenceSelectionError) throw error;
      throw new ReferenceSelectionError(
        "reference_capture_failed",
        "Capture or save failed. Any prior saved reference remains unchanged; check the Flow document and available storage before retrying.",
        "context_invalidated",
      );
    } finally {
      activeCaptures.delete(input.captureOperationId);
      captureControllers.delete(input.captureOperationId);
      captureClaims.delete(input.captureOperationId);
    }
  };

  const getCaptureStatus = async (captureOperationId: string) => {
    const saved =
      await dependencies.repositories.getReferenceByOperation(
        captureOperationId,
      );
    if (saved) return { status: "saved", reference: referenceMetadata(saved) };
    const operation =
      await dependencies.repositories.getReferenceCaptureOperation(
        captureOperationId,
      );
    return operation
      ? { status: operation.status, reason: operation.reason }
      : { status: "not_found" };
  };

  return {
    getActiveSession,
    getTransientCandidatesMap,
    clearAllTransientCandidates,

    async restoreActiveContextMenu(): Promise<boolean> {
      await dependencies.contextMenu?.ready;
      const active = await getActiveSession();
      if (!active || active.status !== "active") return false;
      const selected =
        await dependencies.repositories.getSelectedTarget("Flow");
      const binding = selected?.verificationBinding;
      const savedBatch = await dependencies.repositories.getPromptBatch(
        active.workspaceId,
        "image",
      );
      const matchingShots = savedBatch?.items.filter(
        (item) => item.shotId === active.shotId,
      );
      if (
        !dependencies.contextMenu ||
        !selected ||
        selected.verification !== "verified" ||
        selected.connectionState !== "verified" ||
        selected.tabId !== active.tabId ||
        selected.canonicalTarget !== active.canonicalTarget ||
        binding?.projectId !== active.projectId ||
        binding.documentId !== active.documentId ||
        binding.frameId !== 0 ||
        binding.extensionBuildId !== BUILD_ID ||
        binding.connectorBuildId !== BUILD_ID ||
        binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
        binding.connectorProtocolVersion !== 1 ||
        savedBatch?.batch.id !== active.batchId ||
        active.sourceHash !== active.batchId ||
        matchingShots?.length !== 1 ||
        !scripting?.executeScript
      ) {
        return false;
      }
      try {
        const [document] = await scripting.executeScript({
          target: { tabId: active.tabId, frameIds: [0] },
          func: () => location.href,
        });
        const currentPage = flowTabFromUrl(
          active.tabId,
          "",
          document?.result as string,
        );
        if (
          document?.documentId !== active.documentId ||
          document.frameId !== 0 ||
          !currentPage ||
          currentPage.canonicalTarget !== active.canonicalTarget
        ) {
          return false;
        }
        await dependencies.contextMenu.create(active);
        return true;
      } catch {
        return false;
      }
    },

    async startSelection(input: {
      workspaceId: string;
      batchId: string;
      shotId: string;
    }) {
      // 1. Verify Flow target
      const selected =
        await dependencies.repositories.getSelectedTarget("Flow");
      const binding = selected?.verificationBinding;
      if (
        !selected ||
        selected.verification !== "verified" ||
        selected.connectionState !== "verified" ||
        !binding ||
        binding.extensionBuildId !== BUILD_ID ||
        binding.connectorBuildId !== BUILD_ID ||
        binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
        binding.connectorProtocolVersion !== 1
      ) {
        throw new ReferenceSelectionError(
          "unverified_flow_target",
          "A verified Flow project connection is required to start reference selection.",
          "invalid_request",
        );
      }

      // 2. Load and validate saved image batch
      const savedBatch = await dependencies.repositories.getPromptBatch(
        input.workspaceId,
        "image",
      );
      if (!savedBatch || savedBatch.batch.id !== input.batchId) {
        throw new ReferenceSelectionError(
          "batch_not_found",
          "The requested saved image batch was not found.",
          "not_found",
        );
      }

      // 3. Verify unambiguous Shot IDs
      const items = savedBatch.items;
      const missingShotItem = items.find((item) => !item.shotId);
      if (missingShotItem) {
        throw new ReferenceSelectionError(
          "ambiguous_shot_missing",
          "The saved image batch contains prompts without Shot IDs. All prompts must have unambiguous Shot IDs to start reference selection.",
          "invalid_request",
        );
      }

      const shotIdCounts = new Map<string, number>();
      for (const item of items) {
        const id = item.shotId!;
        shotIdCounts.set(id, (shotIdCounts.get(id) ?? 0) + 1);
      }
      const duplicateShots = Array.from(shotIdCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([id]) => id);

      if (duplicateShots.length > 0) {
        throw new ReferenceSelectionError(
          "ambiguous_shot_duplicate",
          `The saved image batch contains duplicate Shot IDs: ${duplicateShots.join(", ")}. Each prompt must have a unique Shot ID.`,
          "invalid_request",
        );
      }

      const targetedItem = items.find((item) => item.shotId === input.shotId);
      if (!targetedItem) {
        throw new ReferenceSelectionError(
          "shot_not_in_batch",
          `Shot ${input.shotId} was not found in the saved image batch.`,
          "not_found",
        );
      }

      // 4. Verify document identity in tab
      const tabDocumentId = binding.documentId;
      if (scripting?.executeScript) {
        try {
          const [doc] = await scripting.executeScript({
            target: { tabId: selected.tabId, frameIds: [0] },
            func: () => location.href,
          });
          if (
            !doc?.documentId ||
            doc.documentId !== binding.documentId ||
            doc.frameId !== 0
          ) {
            throw new ReferenceSelectionError(
              "document_changed",
              "The selected Flow document has changed. Revalidate connection in Connections.",
              "context_invalidated",
            );
          }
          const tabBinding = flowTabFromUrl(
            selected.tabId,
            "",
            doc.result as string,
          );
          if (
            !tabBinding ||
            tabBinding.canonicalTarget !== selected.canonicalTarget
          ) {
            throw new ReferenceSelectionError(
              "project_route_mismatch",
              "The current Flow page does not match the connected project.",
              "context_invalidated",
            );
          }
        } catch (err) {
          if (err instanceof ReferenceSelectionError) throw err;
          throw new ReferenceSelectionError(
            "target_check_failed",
            "Could not inspect the connected Flow tab.",
            "context_invalidated",
          );
        }
      }

      // Invalidate any existing selection session
      const existing = await getActiveSession();
      if (existing) {
        await abortSessionPreviews(existing.sessionId);
        await setActiveSession(null);
        await removeContextMenu(existing.sessionId);
        if (scripting?.executeScript) {
          await scripting
            .executeScript(
              createFlowReferenceSelectionInjection(existing, "cancel"),
            )
            .catch(() => undefined);
        }
        await broadcast({
          type: FLOW_REFERENCE_EVENT_MESSAGE,
          event: "session_cancelled",
          sessionId: existing.sessionId,
          workspaceId: existing.workspaceId,
          shotId: existing.shotId,
          reason: "session_replaced",
        });
      }

      // 5. Create new session bound to verified target, document, and shot
      const sessionId = crypto.randomUUID();
      const session: ActiveReferenceSelectionSession = {
        sessionId,
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        sourceHash: savedBatch.batch.id, // validated batch identity
        shotId: input.shotId,
        tabId: selected.tabId,
        projectId: binding.projectId,
        canonicalTarget: selected.canonicalTarget,
        documentId: tabDocumentId,
        frameId: 0,
        startedAt: now(),
        status: "active",
      };

      await setActiveSession(session);

      if (dependencies.contextMenu) {
        try {
          await dependencies.contextMenu.ready;
          await dependencies.contextMenu.create(session);
        } catch {
          // A browser context-menu failure must not disable the independent
          // References picker. Flow may suppress the native menu entirely.
          await removeContextMenu(session.sessionId);
        }
      }

      // 6. Inject selection mode script into the verified Flow tab (world: ISOLATED)
      if (scripting?.executeScript) {
        await scripting.executeScript(
          createFlowReferenceSelectionInjection(session, "start"),
        );
      }

      await broadcast({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "session_started",
        sessionId,
        workspaceId: input.workspaceId,
        shotId: input.shotId,
      });

      // Promptly acknowledge initialization
      return {
        sessionId,
        tabId: selected.tabId,
        projectId: binding.projectId,
        canonicalTarget: selected.canonicalTarget,
        shotId: input.shotId,
        status: "started",
      };
    },

    async cancelSelection(sessionId: string, reason = "user_cancelled") {
      const current = await getActiveSession();
      if (!current || current.sessionId !== sessionId) {
        return { ok: true, cancelled: false };
      }

      await abortSessionPreviews(current.sessionId);
      await setActiveSession(null);
      await removeContextMenu(current.sessionId);

      if (scripting?.executeScript) {
        await scripting
          .executeScript(
            createFlowReferenceSelectionInjection(current, "cancel"),
          )
          .catch(() => undefined);
      }

      await broadcast({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "session_cancelled",
        sessionId: current.sessionId,
        workspaceId: current.workspaceId,
        shotId: current.shotId,
        reason,
      });

      return { ok: true, cancelled: true };
    },

    async invalidateActiveSession(reason: string) {
      const current = await getActiveSession();
      if (!current) return;
      await abortSessionPreviews(current.sessionId);
      await setActiveSession(null);
      await removeContextMenu(current.sessionId);
      if (scripting?.executeScript) {
        await scripting
          .executeScript(
            createFlowReferenceSelectionInjection(current, "cancel"),
          )
          .catch(() => undefined);
      }
      await broadcast({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "session_cancelled",
        sessionId: current.sessionId,
        workspaceId: current.workspaceId,
        shotId: current.shotId,
        reason,
      });
    },

    async getState(workspaceId: string) {
      const activeSession = await getActiveSession();
      const savedBatch = await dependencies.repositories.getPromptBatch(
        workspaceId,
        "image",
      );
      const candidates = savedBatch
        ? await getTransientCandidatesMap(workspaceId, savedBatch.batch.id)
        : {};
      const savedReferences = savedBatch
        ? (
            await dependencies.repositories.listReferenceAssignments(
              workspaceId,
              savedBatch.batch.id,
            )
          ).map(referenceMetadata)
        : [];
      const captureOperations = savedBatch
        ? await dependencies.repositories.listReferenceCaptureOperations(
            workspaceId,
            savedBatch.batch.id,
          )
        : [];

      return {
        activeSession:
          activeSession && activeSession.workspaceId === workspaceId
            ? activeSession
            : null,
        candidates,
        savedReferences,
        captureOperations: captureOperations
          .filter((operation) => operation.status === "acquiring")
          .map((operation) => ({
            captureOperationId: operation.captureOperationId,
            shotId: operation.shotId,
            status: operation.status,
            reason: operation.reason,
          })),
      };
    },

    async listCandidates(sessionId: string): Promise<{
      sessionId: string;
      candidates: FlowReferencePickerCandidate[];
      ambiguousCount: number;
      unsupportedCount: number;
    }> {
      const active = await validatePickerSession(sessionId);
      let raw: unknown;
      try {
        raw = await dependencies.sendToDocument!(
          active.tabId,
          active.documentId,
          {
            type: "AUTOMAT_FLOW_REFERENCE_PICKER_REQUEST",
            action: "list",
            buildId: BUILD_ID,
            sessionId: active.sessionId,
          },
        );
      } catch {
        throw new ReferenceSelectionError(
          "candidate_list_unavailable",
          "The verified Flow document did not answer the image picker. Reopen selection for this Shot and retry.",
          "context_invalidated",
        );
      }
      await validatePickerSession(sessionId);
      if (
        !raw ||
        typeof raw !== "object" ||
        !("ok" in raw) ||
        raw.ok !== true ||
        !("buildId" in raw) ||
        raw.buildId !== BUILD_ID ||
        !("sessionId" in raw) ||
        raw.sessionId !== active.sessionId ||
        !("candidates" in raw) ||
        !Array.isArray(raw.candidates)
      ) {
        throw new ReferenceSelectionError(
          "candidate_list_unavailable",
          "Flow did not return a valid image candidate list. Keep this Shot selected and retry Browse Flow images.",
          "context_invalidated",
        );
      }
      const candidates: FlowReferencePickerCandidate[] = [];
      for (const rawCandidate of raw.candidates.slice(0, 300)) {
        const parsed =
          FlowReferencePickerCandidateSchema.safeParse(rawCandidate);
        if (parsed.success) candidates.push(parsed.data);
      }
      return {
        sessionId: active.sessionId,
        candidates,
        ambiguousCount:
          "ambiguousCount" in raw && typeof raw.ambiguousCount === "number"
            ? Math.max(0, Math.min(1000, Math.trunc(raw.ambiguousCount)))
            : 0,
        unsupportedCount:
          "unsupportedCount" in raw && typeof raw.unsupportedCount === "number"
            ? Math.max(0, Math.min(1000, Math.trunc(raw.unsupportedCount)))
            : 0,
      };
    },

    captureReference,

    async cancelCapture(captureOperationId: string) {
      const operation =
        await dependencies.repositories.updateReferenceCaptureOperation(
          captureOperationId,
          "cancelled",
          "user_cancelled",
          now(),
        );
      if (operation?.status === "cancelled")
        await cancelCaptureInPage(captureOperationId);
      return {
        cancelled: operation?.status === "cancelled",
        status: operation?.status ?? "not_found",
      };
    },

    getCaptureStatus,

    async getSavedReference(referenceId: string) {
      const saved =
        await dependencies.repositories.getReferenceById(referenceId);
      if (!saved || saved.byteSize > MAX_REFERENCE_CAPTURE_BYTES)
        throw new ReferenceSelectionError(
          "saved_reference_missing",
          "This saved reference is unavailable. Refresh References and try again.",
          "not_found",
        );
      const bytes = new Uint8Array(await saved.bytes.arrayBuffer());
      if (
        bytes.byteLength !== saved.byteSize ||
        (await sha256Bytes(bytes)) !== saved.sha256
      )
        throw new ReferenceSelectionError(
          "saved_reference_corrupt",
          "Stored image bytes failed integrity validation. The reference was not displayed.",
        );
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      return { reference: referenceMetadata(saved), data: btoa(binary) };
    },

    async getPreview(
      sessionId: string,
      candidateId: string,
      previewId: string,
    ) {
      if (previewClaims.size >= 2)
        throw new ReferenceSelectionError(
          "preview_concurrency_limit",
          "Two previews are already loading. Wait for one to finish.",
        );
      const active = await validatePickerSession(sessionId);
      const candidate = await resolvePickerCandidate(active, candidateId);
      try {
        flowReferenceResource(candidate.sourceUrl, candidate.providerAssetId);
      } catch (error) {
        const code =
          error instanceof Error ? error.message : "reference_source_invalid";
        throw new ReferenceSelectionError(
          code,
          `Preview unavailable (${code}).`,
        );
      }
      if (previewClaims.has(previewId))
        throw new ReferenceSelectionError(
          "duplicate_preview",
          "This preview is already being requested.",
        );
      const controller = new AbortController();
      previewClaims.set(previewId, {
        sessionId,
        candidateId,
        active,
        controller,
      });
      try {
        const hasPermission =
          dependencies.hasMediaHostPermission ??
          (async (permission: string) => {
            if (typeof chrome === "undefined" || !chrome.permissions?.contains)
              throw new Error("permission_api_unavailable");
            return chrome.permissions.contains({ origins: [permission] });
          });
        const fetched = await fetchFlowReferenceBytes({
          url: candidate.sourceUrl,
          mediaId: candidate.providerAssetId,
          signal: controller.signal,
          hasPermission,
          fetcher,
          maxBytes: 8 * 1024 * 1024,
        }).catch((error: unknown) => {
          const code =
            error instanceof Error
              ? error.message
              : "reference_resource_transport_failed";
          throw new ReferenceSelectionError(
            code,
            `Preview unavailable (${code}).`,
          );
        });
        let bitmap: ImageBitmap;
        try {
          bitmap = await decodeFlowReferenceImage(
            fetched.bytes,
            fetched.mimeType,
            controller.signal,
          );
        } catch (error) {
          const code =
            error instanceof Error ? error.message : "preview_decode_failed";
          throw new ReferenceSelectionError(
            code,
            "The selected image could not be decoded or preview was interrupted.",
          );
        }
        if (bitmap.width * bitmap.height > 16_000_000) {
          bitmap.close();
          throw new ReferenceSelectionError(
            "preview_image_oversized",
            "The selected image exceeds the preview decode limit.",
          );
        }
        const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
        const canvas = new OffscreenCanvas(
          Math.max(1, Math.round(bitmap.width * scale)),
          Math.max(1, Math.round(bitmap.height * scale)),
        );
        const context = canvas.getContext("2d");
        if (!context) {
          bitmap.close();
          throw new ReferenceSelectionError(
            "preview_canvas_unavailable",
            "Preview rendering is unavailable.",
          );
        }
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await canvas.convertToBlob({
          type: "image/webp",
          quality: 0.78,
        });
        if (!blob.size || blob.size > 96 * 1024)
          throw new ReferenceSelectionError(
            "preview_oversized",
            "The resized preview exceeds its size limit.",
          );
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000)
          binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 0x8000),
          );
        const fresh = await validatePickerSession(sessionId);
        const confirmed = await resolvePickerCandidate(fresh, candidateId);
        if (
          !sameFlowReferenceResource(
            confirmed.sourceUrl,
            candidate.sourceUrl,
            candidate.providerAssetId,
          ) ||
          confirmed.providerAssetId !== candidate.providerAssetId ||
          confirmed.cardTag !== candidate.cardTag ||
          confirmed.naturalWidth !== candidate.naturalWidth ||
          confirmed.naturalHeight !== candidate.naturalHeight
        )
          throw new ReferenceSelectionError(
            "candidate_missing_or_changed",
            "The candidate changed while its preview was loading. Refresh the picker.",
          );
        if (controller.signal.aborted)
          throw new ReferenceSelectionError(
            "reference_capture_cancelled",
            "Preview cancelled.",
          );
        return {
          ok: true,
          sessionId,
          candidateId,
          previewId,
          data: btoa(binary),
          mimeType: "image/webp",
          byteLength: bytes.length,
          width: canvas.width,
          height: canvas.height,
        };
      } finally {
        previewClaims.delete(previewId);
      }
    },
    async cancelPreview(sessionId: string, previewId: string) {
      const claim = previewClaims.get(previewId);
      if (!claim || claim.sessionId !== sessionId)
        return { ok: true, cancelled: false };
      claim.controller.abort();
      return { ok: true, cancelled: true };
    },

    async chooseCandidate(
      sessionId: string,
      candidateId: string,
    ): Promise<{ accepted: true; candidate: ReferenceCandidate }> {
      if (candidateClaims.has(sessionId)) {
        throw new ReferenceSelectionError(
          "duplicate_candidate_event",
          "A candidate is already being submitted for this Shot. Wait for it to finish.",
        );
      }
      candidateClaims.add(sessionId);
      try {
        let active = await validatePickerSession(sessionId);
        let raw: unknown;
        try {
          raw = await dependencies.sendToDocument!(
            active.tabId,
            active.documentId,
            {
              type: "AUTOMAT_FLOW_REFERENCE_PICKER_REQUEST",
              action: "resolve",
              buildId: BUILD_ID,
              sessionId: active.sessionId,
              candidateId,
            },
          );
        } catch {
          throw new ReferenceSelectionError(
            "candidate_missing_or_changed",
            "The verified Flow document did not confirm this image. Refresh the picker and choose again.",
            "context_invalidated",
          );
        }
        if (
          !raw ||
          typeof raw !== "object" ||
          !("ok" in raw) ||
          raw.ok !== true ||
          !("buildId" in raw) ||
          raw.buildId !== BUILD_ID ||
          !("sessionId" in raw) ||
          raw.sessionId !== active.sessionId ||
          !("candidate" in raw) ||
          !raw.candidate ||
          typeof raw.candidate !== "object" ||
          !("candidateId" in raw.candidate) ||
          raw.candidate.candidateId !== candidateId
        ) {
          const code =
            raw !== null &&
            typeof raw === "object" &&
            "code" in raw &&
            typeof raw.code === "string"
              ? raw.code
              : "candidate_missing_or_changed";
          throw new ReferenceSelectionError(
            code,
            code === "candidate_ambiguous"
              ? "This image now matches more than one Flow card. Refresh the picker and choose an unambiguous image."
              : "This image changed or disappeared from the verified Flow document. Refresh the picker and choose again.",
          );
        }
        const candidateFields = {
          ...(raw.candidate as Record<string, unknown>),
        };
        delete candidateFields.candidateId;
        const parsed = ReferenceCandidateSchema.safeParse({
          ...candidateFields,
          selectedAt: now(),
        });
        if (!parsed.success) {
          throw new ReferenceSelectionError(
            "invalid_candidate",
            "Flow returned incomplete image evidence. Refresh the picker and choose another image.",
          );
        }
        active = await validatePickerSession(sessionId);
        const result = await this.handleCandidateSelected(
          {
            type: FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE,
            protocolVersion: PROTOCOL_VERSION,
            buildId: BUILD_ID,
            sessionId: active.sessionId,
            workspaceId: active.workspaceId,
            batchId: active.batchId,
            shotId: active.shotId,
            candidate: parsed.data,
          },
          {
            id: dependencies.extensionId,
            frameId: 0,
            tab: { id: active.tabId },
            documentId: active.documentId,
          },
          true,
        );
        if (!result.accepted) {
          throw new ReferenceSelectionError(
            result.code ?? "candidate_rejected",
            "The candidate failed final session or project validation. Refresh References and retry.",
          );
        }
        try {
          await dependencies.sendToDocument!(active.tabId, active.documentId, {
            type: FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
            sessionId: active.sessionId,
            shotId: active.shotId,
          });
        } catch {
          // The dashboard event and session-scoped candidate state are authoritative.
        }
        return { accepted: true, candidate: parsed.data };
      } finally {
        candidateClaims.delete(sessionId);
      }
    },

    async clearCandidate(workspaceId: string, shotId: string) {
      const savedBatch = await dependencies.repositories.getPromptBatch(
        workspaceId,
        "image",
      );
      if (savedBatch) {
        await withShotLock(
          captureShotKey(workspaceId, savedBatch.batch.id, shotId),
          async () => {
            await cancelCapturesForShot(
              workspaceId,
              savedBatch.batch.id,
              shotId,
            );
            await clearTransientCandidate(
              workspaceId,
              savedBatch.batch.id,
              shotId,
            );
          },
        );
      }
      await broadcast({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "candidate_cleared",
        workspaceId,
        shotId,
      });
      return { ok: true };
    },

    async handleContextMenu(
      info: FlowReferenceContextMenuClick,
      tab: FlowReferenceContextMenuTab | undefined,
    ): Promise<{
      accepted: boolean;
      code?: string;
      session?: ActiveReferenceSelectionSession;
    }> {
      const active = await getActiveSession();
      if (!active || active.status !== "active") {
        return { accepted: false, code: "stale_session" };
      }
      if (info.menuItemId !== flowReferenceContextMenuId(active.sessionId)) {
        return { accepted: false, code: "stale_session" };
      }
      if (candidateClaims.has(active.sessionId)) {
        return { accepted: false, code: "duplicate_candidate_event" };
      }
      candidateClaims.add(active.sessionId);
      try {
        if (info.frameId !== 0) {
          return { accepted: false, code: "wrong_frame" };
        }
        if (tab?.id !== active.tabId) {
          return { accepted: false, code: "wrong_tab" };
        }
        if (
          info.mediaType !== "image" ||
          !info.srcUrl ||
          info.srcUrl.length > 4096
        ) {
          return { accepted: false, code: "unsupported_image_event" };
        }
        let sourceUrl: URL;
        try {
          sourceUrl = new URL(info.srcUrl);
        } catch {
          return { accepted: false, code: "unsupported_image_source" };
        }
        if (sourceUrl.protocol !== "https:") {
          return { accepted: false, code: "unsupported_image_source" };
        }

        const selected =
          await dependencies.repositories.getSelectedTarget("Flow");
        const binding = selected?.verificationBinding;
        if (
          !selected ||
          selected.verification !== "verified" ||
          selected.connectionState !== "verified" ||
          !binding ||
          selected.tabId !== active.tabId ||
          selected.canonicalTarget !== active.canonicalTarget ||
          binding.projectId !== active.projectId ||
          binding.documentId !== active.documentId ||
          binding.frameId !== 0 ||
          binding.extensionBuildId !== BUILD_ID ||
          binding.connectorBuildId !== BUILD_ID ||
          binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
          binding.connectorProtocolVersion !== 1
        ) {
          return { accepted: false, code: "project_connection_changed" };
        }

        const page = flowTabFromUrl(active.tabId, "", info.pageUrl);
        const tabPage = flowTabFromUrl(tab.id, "", tab.url);
        const framePage = info.frameUrl
          ? flowTabFromUrl(active.tabId, "", info.frameUrl)
          : undefined;
        if (
          !page ||
          page.canonicalTarget !== active.canonicalTarget ||
          !tabPage ||
          tabPage.canonicalTarget !== active.canonicalTarget ||
          (info.frameUrl &&
            (!framePage ||
              framePage.canonicalTarget !== active.canonicalTarget))
        ) {
          return { accepted: false, code: "unsupported_or_wrong_page" };
        }

        if (!scripting?.executeScript) {
          return { accepted: false, code: "document_unavailable" };
        }
        try {
          const [document] = await scripting.executeScript({
            target: { tabId: active.tabId, frameIds: [0] },
            func: () => location.href,
          });
          const currentPage = flowTabFromUrl(
            active.tabId,
            "",
            document?.result as string,
          );
          if (
            !document?.documentId ||
            document.documentId !== active.documentId ||
            document.frameId !== 0 ||
            !currentPage ||
            currentPage.canonicalTarget !== active.canonicalTarget
          ) {
            return { accepted: false, code: "wrong_document" };
          }
        } catch {
          return { accepted: false, code: "document_unavailable" };
        }

        const savedBatch = await dependencies.repositories.getPromptBatch(
          active.workspaceId,
          "image",
        );
        const matchingShots = savedBatch?.items.filter(
          (item) => item.shotId === active.shotId,
        );
        if (
          !savedBatch ||
          savedBatch.batch.id !== active.batchId ||
          active.sourceHash !== active.batchId ||
          matchingShots?.length !== 1
        ) {
          return { accepted: false, code: "batch_or_shot_changed" };
        }

        const result = await this.handleCandidateSelected(
          {
            type: FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE,
            protocolVersion: PROTOCOL_VERSION,
            buildId: BUILD_ID,
            sessionId: active.sessionId,
            workspaceId: active.workspaceId,
            batchId: active.batchId,
            shotId: active.shotId,
            candidate: {
              sourceUrl: info.srcUrl,
              naturalWidth: 0,
              naturalHeight: 0,
              displayWidth: 0,
              displayHeight: 0,
              cardTag: "context-menu-image",
              selectedAt: now(),
            },
          },
          {
            id: dependencies.extensionId,
            frameId: 0,
            tab: { id: active.tabId },
            documentId: active.documentId,
          },
          true,
        );
        return result.accepted
          ? { accepted: true, session: active }
          : { accepted: false, code: result.code };
      } finally {
        candidateClaims.delete(active.sessionId);
      }
    },

    async handleCandidateSelected(
      rawMessage: unknown,
      sender: ExtensionMessageSender,
      claimAlreadyHeld = false,
    ): Promise<{ accepted: boolean; code?: string }> {
      // 1. Sender validation
      if (sender.id !== dependencies.extensionId) {
        return { accepted: false, code: "unauthorized_sender" };
      }
      if (sender.frameId !== 0) {
        return { accepted: false, code: "wrong_frame" };
      }

      const active = await getActiveSession();
      if (!active || active.status !== "active") {
        return { accepted: false, code: "stale_session" };
      }

      if (sender.tab?.id !== active.tabId) {
        return { accepted: false, code: "wrong_tab" };
      }

      if (sender.documentId !== active.documentId) {
        return { accepted: false, code: "wrong_document" };
      }

      // 2. Flow verified target project revalidation
      const selected =
        await dependencies.repositories.getSelectedTarget("Flow");
      const binding = selected?.verificationBinding;
      if (
        !selected ||
        selected.verification !== "verified" ||
        selected.connectionState !== "verified" ||
        !binding ||
        selected.tabId !== active.tabId ||
        binding.projectId !== active.projectId ||
        binding.frameId !== 0 ||
        selected.canonicalTarget !== active.canonicalTarget ||
        binding.documentId !== active.documentId ||
        binding.extensionBuildId !== BUILD_ID ||
        binding.connectorBuildId !== BUILD_ID ||
        binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
        binding.connectorProtocolVersion !== 1
      ) {
        return { accepted: false, code: "project_connection_changed" };
      }

      // 3. Saved source / Shot identity validation
      const savedBatch = await dependencies.repositories.getPromptBatch(
        active.workspaceId,
        "image",
      );
      if (
        !savedBatch ||
        savedBatch.batch.id !== active.batchId ||
        active.sourceHash !== active.batchId ||
        savedBatch.items.filter((item) => item.shotId === active.shotId)
          .length !== 1
      ) {
        return { accepted: false, code: "batch_or_shot_changed" };
      }
      const promptItem = savedBatch.items.find(
        (item) => item.shotId === active.shotId,
      )!;

      // 4. Validate payload
      const parsedMessage =
        FlowReferenceCandidateSelectedMessageSchema.safeParse(rawMessage);
      if (!parsedMessage.success) {
        return { accepted: false, code: "invalid_candidate_message" };
      }
      const msg: FlowReferenceCandidateSelectedMessage = parsedMessage.data;
      if (
        msg.protocolVersion !== PROTOCOL_VERSION ||
        msg.buildId !== BUILD_ID ||
        msg.sessionId !== active.sessionId ||
        msg.shotId !== active.shotId ||
        msg.workspaceId !== active.workspaceId ||
        msg.batchId !== active.batchId
      ) {
        return { accepted: false, code: "mismatched_session" };
      }

      const parsedCandidate = ReferenceCandidateSchema.safeParse(msg.candidate);
      if (!parsedCandidate.success) {
        return { accepted: false, code: "invalid_candidate" };
      }
      try {
        flowReferenceResource(
          parsedCandidate.data.sourceUrl,
          parsedCandidate.data.providerAssetId,
        );
      } catch {
        return { accepted: false, code: "unsupported_candidate_source" };
      }

      if (candidateClaims.has(active.sessionId) && !claimAlreadyHeld) {
        return { accepted: false, code: "duplicate_candidate_event" };
      }
      if (!claimAlreadyHeld) candidateClaims.add(active.sessionId);

      try {
        const sourceResource = flowReferenceResource(
          parsedCandidate.data.sourceUrl,
          parsedCandidate.data.providerAssetId,
        );
        const acceptedCandidate = ReferenceCandidateSchema.parse({
          ...parsedCandidate.data,
          sourceUrl: sourceResource.resourceKey,
          selectionVersion: crypto.randomUUID(),
          workspaceId: active.workspaceId,
          batchId: active.batchId,
          shotId: active.shotId,
          batchSourceHash: await sha256Hex(savedBatch.batch.sourceText),
          promptHash: promptItem.contentHash,
          flowProjectId: active.projectId,
          tabId: active.tabId,
          canonicalTarget: active.canonicalTarget,
          documentId: active.documentId,
          selectionSessionId: active.sessionId,
          acceptedAt: now(),
          observedSourceSha256: await sha256Hex(sourceResource.resourceKey),
        });
        await withShotLock(
          captureShotKey(active.workspaceId, active.batchId, active.shotId),
          async () => {
            await cancelCapturesForShot(
              active.workspaceId,
              active.batchId,
              active.shotId,
            );
            await setActiveSession(null);
            await removeContextMenu(active.sessionId);
            await setTransientCandidate(
              active.workspaceId,
              active.batchId,
              active.shotId,
              acceptedCandidate,
            );
          },
        );

        // 7. Broadcast candidate_selected event to dashboard (honest candidate-only state)
        await broadcast({
          type: FLOW_REFERENCE_EVENT_MESSAGE,
          event: "candidate_selected",
          sessionId: active.sessionId,
          workspaceId: active.workspaceId,
          batchId: active.batchId,
          shotId: active.shotId,
          candidate: acceptedCandidate,
          retained: false,
          message:
            "Candidate selected — not saved. Save reference to capture and keep image bytes.",
        });

        return { accepted: true };
      } finally {
        if (!claimAlreadyHeld) candidateClaims.delete(active.sessionId);
      }
    },
  };
}
