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
import {
  createFlowReferenceSelectionInjection,
  FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
  flowReferenceContextMenuId,
} from "../../platforms/flow/references";
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

      return {
        activeSession:
          activeSession && activeSession.workspaceId === workspaceId
            ? activeSession
            : null,
        candidates,
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
        await clearTransientCandidate(workspaceId, savedBatch.batch.id, shotId);
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
        if (new URL(parsedCandidate.data.sourceUrl).protocol !== "https:") {
          return { accepted: false, code: "unsupported_candidate_source" };
        }
      } catch {
        return { accepted: false, code: "unsupported_candidate_source" };
      }

      if (candidateClaims.has(active.sessionId) && !claimAlreadyHeld) {
        return { accepted: false, code: "duplicate_candidate_event" };
      }
      if (!claimAlreadyHeld) candidateClaims.add(active.sessionId);

      try {
        // 5. Mark session complete and clear active session
        await setActiveSession(null);
        await removeContextMenu(active.sessionId);

        // 6. Store candidate in transient session state
        await setTransientCandidate(
          active.workspaceId,
          active.batchId,
          active.shotId,
          parsedCandidate.data,
        );

        // 7. Broadcast candidate_selected event to dashboard (honest candidate-only state)
        await broadcast({
          type: FLOW_REFERENCE_EVENT_MESSAGE,
          event: "candidate_selected",
          sessionId: active.sessionId,
          workspaceId: active.workspaceId,
          batchId: active.batchId,
          shotId: active.shotId,
          candidate: parsedCandidate.data,
          retained: false,
          message:
            "Candidate selected — image capture and saving are not implemented in this phase.",
        });

        return { accepted: true };
      } finally {
        if (!claimAlreadyHeld) candidateClaims.delete(active.sessionId);
      }
    },
  };
}
