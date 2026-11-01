import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import { flowTabFromUrl } from "../../platforms/flow/connection";
import type {
  ActiveReferenceSelectionSession,
  FlowReferenceCandidateSelectedMessage,
  ReferenceCandidate,
} from "../../shared/schemas";
import {
  FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE,
  FLOW_REFERENCE_EVENT_MESSAGE,
  ReferenceCandidateSchema,
} from "../../shared/schemas";
import type { ExtensionRepositories } from "../../storage/repositories";
import { createFlowReferenceSelectionInjection } from "../../platforms/flow/references";
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
  now?: () => number;
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

  return {
    getActiveSession,
    getTransientCandidatesMap,
    clearAllTransientCandidates,

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

    async handleCandidateSelected(
      rawMessage: unknown,
      sender: ExtensionMessageSender,
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

      if (sender.documentId && sender.documentId !== active.documentId) {
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
        selected.canonicalTarget !== active.canonicalTarget ||
        binding.documentId !== active.documentId
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
        !savedBatch.items.some((item) => item.shotId === active.shotId)
      ) {
        return { accepted: false, code: "batch_or_shot_changed" };
      }

      // 4. Validate payload
      const msg = rawMessage as FlowReferenceCandidateSelectedMessage;
      if (
        !msg ||
        msg.type !== FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE ||
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

      // 5. Mark session complete and clear active session
      await setActiveSession(null);

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
    },
  };
}
