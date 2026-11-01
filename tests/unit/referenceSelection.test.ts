import { describe, expect, it, vi } from "vitest";
import {
  createFlowReferenceHandler,
  ReferenceSelectionError,
} from "../../src/background/handlers/references";
import {
  createFlowReferenceSelectionInjection,
  flowReferenceSelectionProducer,
} from "../../src/platforms/flow/references";
import {
  FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE,
  FLOW_REFERENCE_EVENT_MESSAGE,
  type ActiveReferenceSelectionSession,
  type FlowReferenceCandidateSelectedMessage,
} from "../../src/shared/schemas";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";

describe("Phase 07.1 Reference Selection Sessions", () => {
  async function createFixture() {
    const database = createMemoryRepositoryDatabase();
    let clock = 10_000;
    const repositories = new ExtensionRepositories(database, () => clock);
    const broadcastEvents: unknown[] = [];
    const scriptInjections: unknown[] = [];

    const storageMap = new Map<string, unknown>();
    const storageSession = {
      get: async (keys: string | string[]) => {
        const res: Record<string, unknown> = {};
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) {
          if (storageMap.has(k)) res[k] = storageMap.get(k);
        }
        return res;
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storageMap.set(k, v);
      },
      remove: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) storageMap.delete(k);
      },
    };

    const handler = createFlowReferenceHandler({
      extensionId: "test-extension-id",
      repositories,
      storageSession,
      broadcastMessage: async (msg) => {
        broadcastEvents.push(msg);
      },
      scripting: {
        executeScript: async (injection) => {
          scriptInjections.push(injection);
          return [
            {
              documentId: "doc-flow-1",
              frameId: 0,
              result: "https://flow.google.com/project/proj-1",
            },
          ];
        },
      },
      now: () => clock,
    });

    return {
      database,
      repositories,
      handler,
      storageSession,
      broadcastEvents,
      scriptInjections,
      clock: (ms?: number) => (ms !== undefined ? (clock = ms) : clock),
    };
  }

  async function setupVerifiedFlowTarget(
    repositories: ExtensionRepositories,
    database: ReturnType<typeof createMemoryRepositoryDatabase>,
  ) {
    const target = {
      provider: "Flow" as const,
      tabId: 101,
      canonicalTarget: "https://flow.google.com/project/proj-1",
    };
    await repositories.recordSelectedTarget(target);
    const selected = await repositories.getSelectedTarget("Flow");
    await database.selectedTargets.put({
      ...selected!,
      verification: "verified",
      connectionState: "verified",
      reconnectEnabled: true,
      verificationBinding: {
        provider: "Flow",
        tabId: 101,
        canonicalTarget: target.canonicalTarget,
        projectId: "proj-1",
        frameId: 0,
        documentId: "doc-flow-1",
        documentToken: "tok-1",
        extensionBuildId: BUILD_ID,
        extensionProtocolVersion: PROTOCOL_VERSION,
        connectorBuildId: BUILD_ID,
        connectorProtocolVersion: 1,
        capability: "read-only-connection-v1",
        verifiedAt: 10_000,
      },
    });
  }

  describe("Session Initialization & Target Binding", () => {
    it("refuses selection when Flow target is not verified", async () => {
      const { handler, repositories } = await createFixture();
      await repositories.savePromptBatch({
        workspaceId: "ws-1",
        kind: "image",
        sourceText: '10: {"shot_id":"10","prompt":"Scene 10"}',
      });
      const batch = await repositories.getPromptBatch("ws-1", "image");

      await expect(
        handler.startSelection({
          workspaceId: "ws-1",
          batchId: batch!.batch.id,
          shotId: "10",
        }),
      ).rejects.toThrow(ReferenceSelectionError);
    });

    it("refuses selection when prompt batch is not found", async () => {
      const { handler, repositories, database } = await createFixture();
      await setupVerifiedFlowTarget(repositories, database);

      await expect(
        handler.startSelection({
          workspaceId: "ws-1",
          batchId: "nonexistent-batch",
          shotId: "10",
        }),
      ).rejects.toThrow("The requested saved image batch was not found.");
    });

    it("refuses selection when batch contains items without Shot IDs", async () => {
      const { handler, repositories, database } = await createFixture();
      await setupVerifiedFlowTarget(repositories, database);

      // JSON array without shot_id labels or body shot_ids
      await repositories.savePromptBatch({
        workspaceId: "ws-1",
        kind: "image",
        sourceText: '[{"prompt":"A prompt without shot id"}]',
      });
      const batch = await repositories.getPromptBatch("ws-1", "image");

      await expect(
        handler.startSelection({
          workspaceId: "ws-1",
          batchId: batch!.batch.id,
          shotId: "1",
        }),
      ).rejects.toThrow(
        "All prompts must have unambiguous Shot IDs to start reference selection.",
      );
    });

    it("refuses selection when batch contains duplicate Shot IDs", async () => {
      const { handler, repositories, database } = await createFixture();
      await setupVerifiedFlowTarget(repositories, database);

      await repositories.savePromptBatch({
        workspaceId: "ws-1",
        kind: "image",
        sourceText:
          '1: {"shot_id":"1","prompt":"A"}\n2: {"shot_id":"2","prompt":"B"}',
      });
      const validBatch = (await repositories.getPromptBatch("ws-1", "image"))!;

      vi.spyOn(repositories, "getPromptBatch").mockResolvedValueOnce({
        ...validBatch,
        items: [
          { ...validBatch.items[0]!, shotId: "12" },
          { ...validBatch.items[1]!, shotId: "12" },
        ],
      });

      await expect(
        handler.startSelection({
          workspaceId: "ws-1",
          batchId: validBatch.batch.id,
          shotId: "12",
        }),
      ).rejects.toThrow(
        "The saved image batch contains duplicate Shot IDs: 12",
      );
    });

    it("refuses selection when targeted Shot ID does not exist in batch", async () => {
      const { handler, repositories, database } = await createFixture();
      await setupVerifiedFlowTarget(repositories, database);

      await repositories.savePromptBatch({
        workspaceId: "ws-1",
        kind: "image",
        sourceText: '15: {"shot_id":"15","prompt":"Scene 15"}',
      });
      const batch = await repositories.getPromptBatch("ws-1", "image");

      await expect(
        handler.startSelection({
          workspaceId: "ws-1",
          batchId: batch!.batch.id,
          shotId: "99",
        }),
      ).rejects.toThrow("Shot 99 was not found in the saved image batch.");
    });

    it("successfully creates active session bound to verified target, document, and Shot ID", async () => {
      const {
        handler,
        repositories,
        database,
        broadcastEvents,
        scriptInjections,
      } = await createFixture();
      await setupVerifiedFlowTarget(repositories, database);

      await repositories.savePromptBatch({
        workspaceId: "ws-1",
        kind: "image",
        sourceText: '20: {"shot_id":"20","prompt":"Scene 20"}',
      });
      const batch = await repositories.getPromptBatch("ws-1", "image");

      const result = await handler.startSelection({
        workspaceId: "ws-1",
        batchId: batch!.batch.id,
        shotId: "20",
      });

      expect(result.status).toBe("started");
      expect(result.shotId).toBe("20");
      expect(result.tabId).toBe(101);
      expect(result.projectId).toBe("proj-1");

      const active = await handler.getActiveSession();
      expect(active).not.toBeNull();
      expect(active?.sessionId).toBe(result.sessionId);
      expect(active?.shotId).toBe("20");
      expect(active?.documentId).toBe("doc-flow-1");

      // Verifies broadcast
      expect(broadcastEvents).toContainEqual({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "session_started",
        sessionId: result.sessionId,
        workspaceId: "ws-1",
        shotId: "20",
      });

      // Verifies isolated world injection
      expect(scriptInjections).toHaveLength(2); // 1 for target doc probe + 1 for start selection
      const startInjection = scriptInjections[1] as {
        world: string;
        target: { tabId: number; documentIds: string[] };
      };
      expect(startInjection.world).toBe("ISOLATED");
      expect(startInjection.target.tabId).toBe(101);
      expect(startInjection.target.documentIds).toEqual(["doc-flow-1"]);
    });
  });

  describe("Session Cancellation, Replacement & Invalidation", () => {
    it("explicit cancel clears active session and broadcasts cancellation", async () => {
      const { handler, repositories, database, broadcastEvents } =
        await createFixture();
      await setupVerifiedFlowTarget(repositories, database);

      await repositories.savePromptBatch({
        workspaceId: "ws-1",
        kind: "image",
        sourceText: '25: {"shot_id":"25","prompt":"Scene 25"}',
      });
      const batch = await repositories.getPromptBatch("ws-1", "image");
      const session = await handler.startSelection({
        workspaceId: "ws-1",
        batchId: batch!.batch.id,
        shotId: "25",
      });

      const cancelResult = await handler.cancelSelection(
        session.sessionId,
        "user_cancelled",
      );
      expect(cancelResult).toEqual({ ok: true, cancelled: true });

      const active = await handler.getActiveSession();
      expect(active).toBeNull();

      expect(broadcastEvents).toContainEqual({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "session_cancelled",
        sessionId: session.sessionId,
        workspaceId: "ws-1",
        shotId: "25",
        reason: "user_cancelled",
      });
    });

    it("starting a new session replaces and cancels the prior session", async () => {
      const { handler, repositories, database, broadcastEvents } =
        await createFixture();
      await setupVerifiedFlowTarget(repositories, database);

      await repositories.savePromptBatch({
        workspaceId: "ws-1",
        kind: "image",
        sourceText:
          '30: {"shot_id":"30","prompt":"Scene 30"}\n31: {"shot_id":"31","prompt":"Scene 31"}',
      });
      const batch = await repositories.getPromptBatch("ws-1", "image");

      const session1 = await handler.startSelection({
        workspaceId: "ws-1",
        batchId: batch!.batch.id,
        shotId: "30",
      });

      const session2 = await handler.startSelection({
        workspaceId: "ws-1",
        batchId: batch!.batch.id,
        shotId: "31",
      });

      // Session 1 cancelled with session_replaced
      expect(broadcastEvents).toContainEqual({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "session_cancelled",
        sessionId: session1.sessionId,
        workspaceId: "ws-1",
        shotId: "30",
        reason: "session_replaced",
      });

      const active = await handler.getActiveSession();
      expect(active?.sessionId).toBe(session2.sessionId);
      expect(active?.shotId).toBe("31");
    });

    it("invalidateActiveSession clears active session on tab event", async () => {
      const { handler, repositories, database, broadcastEvents } =
        await createFixture();
      await setupVerifiedFlowTarget(repositories, database);

      await repositories.savePromptBatch({
        workspaceId: "ws-1",
        kind: "image",
        sourceText: '35: {"shot_id":"35","prompt":"Scene 35"}',
      });
      const batch = await repositories.getPromptBatch("ws-1", "image");

      const session = await handler.startSelection({
        workspaceId: "ws-1",
        batchId: batch!.batch.id,
        shotId: "35",
      });

      await handler.invalidateActiveSession("browser_tab_removed");

      const active = await handler.getActiveSession();
      expect(active).toBeNull();
      expect(broadcastEvents).toContainEqual({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "session_cancelled",
        sessionId: session.sessionId,
        workspaceId: "ws-1",
        shotId: "35",
        reason: "browser_tab_removed",
      });
    });
  });

  describe("Candidate Message Validation & Identity Binding", () => {
    async function setupActiveSession() {
      const fixture = await createFixture();
      await setupVerifiedFlowTarget(fixture.repositories, fixture.database);

      await fixture.repositories.savePromptBatch({
        workspaceId: "ws-1",
        kind: "image",
        sourceText: '40: {"shot_id":"40","prompt":"Scene 40"}',
      });
      const batch = (await fixture.repositories.getPromptBatch(
        "ws-1",
        "image",
      ))!;

      const session = await fixture.handler.startSelection({
        workspaceId: "ws-1",
        batchId: batch.batch.id,
        shotId: "40",
      });

      const candidatePayload: FlowReferenceCandidateSelectedMessage = {
        type: FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE,
        protocolVersion: 1,
        buildId: session.sessionId,
        sessionId: session.sessionId,
        workspaceId: "ws-1",
        batchId: batch.batch.id,
        shotId: "40",
        candidate: {
          sourceUrl: "https://flow.google.com/media/sample-card-40.jpg",
          naturalWidth: 1024,
          naturalHeight: 1024,
          displayWidth: 256,
          displayHeight: 256,
          providerAssetId: "asset-genuine-40",
          cardTag: "flow-image-tile",
          selectedAt: 10_500,
        },
      };

      const validSender = {
        id: "test-extension-id",
        frameId: 0,
        tab: { id: 101 },
        documentId: "doc-flow-1",
      };

      return { ...fixture, session, batch, candidatePayload, validSender };
    }

    it("rejects unauthorized sender extension ID", async () => {
      const { handler, candidatePayload, validSender } =
        await setupActiveSession();

      const result = await handler.handleCandidateSelected(candidatePayload, {
        ...validSender,
        id: "unauthorized-extension-id",
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe("unauthorized_sender");
    });

    it("rejects non-top frame sender", async () => {
      const { handler, candidatePayload, validSender } =
        await setupActiveSession();

      const result = await handler.handleCandidateSelected(candidatePayload, {
        ...validSender,
        frameId: 1,
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe("wrong_frame");
    });

    it("rejects candidate from wrong tab ID", async () => {
      const { handler, candidatePayload, validSender } =
        await setupActiveSession();

      const result = await handler.handleCandidateSelected(candidatePayload, {
        ...validSender,
        tab: { id: 999 },
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe("wrong_tab");
    });

    it("rejects candidate from wrong document ID", async () => {
      const { handler, candidatePayload, validSender } =
        await setupActiveSession();

      const result = await handler.handleCandidateSelected(candidatePayload, {
        ...validSender,
        documentId: "doc-different-document",
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe("wrong_document");
    });

    it("rejects late candidate events after session cancellation", async () => {
      const { handler, session, candidatePayload, validSender } =
        await setupActiveSession();

      await handler.cancelSelection(session.sessionId);

      const result = await handler.handleCandidateSelected(
        candidatePayload,
        validSender,
      );
      expect(result.accepted).toBe(false);
      expect(result.code).toBe("stale_session");
    });

    it("rejects late candidate events after session replacement", async () => {
      const { handler, batch, candidatePayload, validSender } =
        await setupActiveSession();

      // Replace with another session
      await handler.startSelection({
        workspaceId: "ws-1",
        batchId: batch.batch.id,
        shotId: "40",
      });

      // Old session payload is rejected
      const result = await handler.handleCandidateSelected(
        candidatePayload,
        validSender,
      );
      expect(result.accepted).toBe(false);
      expect(result.code).toBe("mismatched_session");
    });

    it("rejects duplicate candidate events once a candidate is already accepted", async () => {
      const { handler, candidatePayload, validSender } =
        await setupActiveSession();

      const first = await handler.handleCandidateSelected(
        candidatePayload,
        validSender,
      );
      expect(first.accepted).toBe(true);

      // Second click arriving late for same session
      const second = await handler.handleCandidateSelected(
        candidatePayload,
        validSender,
      );
      expect(second.accepted).toBe(false);
      expect(second.code).toBe("stale_session");
    });

    it("rejects candidate when verified project connection changed", async () => {
      const { handler, database, candidatePayload, validSender } =
        await setupActiveSession();

      // Mark project unverified in database
      const selected = await database.selectedTargets.get("Flow");
      await database.selectedTargets.put({
        ...selected!,
        verification: "unverified",
      });

      const result = await handler.handleCandidateSelected(
        candidatePayload,
        validSender,
      );
      expect(result.accepted).toBe(false);
      expect(result.code).toBe("project_connection_changed");
    });

    it("accepts valid candidate, stores transiently, reports honest candidate state without durable save", async () => {
      const {
        handler,
        database,
        repositories,
        session,
        candidatePayload,
        validSender,
        broadcastEvents,
      } = await setupActiveSession();

      const result = await handler.handleCandidateSelected(
        candidatePayload,
        validSender,
      );
      expect(result.accepted).toBe(true);

      // Active session is completed and cleared
      const active = await handler.getActiveSession();
      expect(active).toBeNull();

      // Candidate is stored only in transient session state
      const state = await handler.getState("ws-1");
      expect(state.candidates["40"]).toEqual(candidatePayload.candidate);

      // Broadcast confirms honest candidate-only state (retained: false)
      expect(broadcastEvents).toContainEqual({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "candidate_selected",
        sessionId: session.sessionId,
        workspaceId: "ws-1",
        batchId: candidatePayload.batchId,
        shotId: "40",
        candidate: candidatePayload.candidate,
        retained: false,
        message:
          "Candidate selected — image capture and saving are not implemented in this phase.",
      });

      // No durable database changes or prompt batch modifications occurred
      const batchAfter = (await repositories.getPromptBatch("ws-1", "image"))!;
      expect(batchAfter.batch.id).toBe(candidatePayload.batchId);
      // No reference tables created in repository database
      const allBatches = await database.batches.toArray();
      expect(allBatches).toHaveLength(1);

      // Clear candidate works
      await handler.clearCandidate("ws-1", "40");
      const stateAfterClear = await handler.getState("ws-1");
      expect(stateAfterClear.candidates["40"]).toBeUndefined();
      expect(broadcastEvents).toContainEqual({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "candidate_cleared",
        workspaceId: "ws-1",
        shotId: "40",
      });
    });
  });

  describe("Content Script Producer & DOM Selectors", () => {
    it("creates injection spec with ISOLATED world and correct target args", () => {
      const session: ActiveReferenceSelectionSession = {
        sessionId: "sess-1",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "a".repeat(64),
        shotId: "50",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-flow-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };

      const injection = createFlowReferenceSelectionInjection(session, "start");
      expect(injection.world).toBe("ISOLATED");
      expect(injection.target.tabId).toBe(101);
      expect(injection.target.documentIds).toEqual(["doc-flow-1"]);
      expect(injection.args).toEqual([
        session,
        "start",
        BUILD_ID,
        PROTOCOL_VERSION,
      ]);
    });

    class SyntheticElement {
      localName: string;
      tagName: string;
      attributes = new Map<string, string>();
      children: SyntheticElement[] = [];
      parentElement: SyntheticElement | null = null;
      isConnected = true;
      style: Record<string, string> = {};
      listeners = new Map<
        string,
        Array<{ listener: (e: unknown) => void; capture?: boolean }>
      >();
      textContent = "";
      src = "";
      currentSrc = "";
      naturalWidth = 1024;
      naturalHeight = 1024;
      clientWidth = 256;
      clientHeight = 256;

      constructor(tagName: string) {
        this.localName = tagName.toLowerCase();
        this.tagName = tagName.toUpperCase();
      }

      get id() {
        return this.attributes.get("id") ?? "";
      }
      set id(val: string) {
        this.attributes.set("id", val);
      }

      getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
      }
      hasAttribute(name: string) {
        return this.attributes.has(name);
      }
      setAttribute(name: string, val: string) {
        this.attributes.set(name, String(val));
      }
      removeAttribute(name: string) {
        this.attributes.delete(name);
      }

      appendChild(child: SyntheticElement) {
        child.parentElement = this;
        child.isConnected = true;
        this.children.push(child);
        return child;
      }

      remove() {
        if (this.parentElement) {
          const idx = this.parentElement.children.indexOf(this);
          if (idx !== -1) this.parentElement.children.splice(idx, 1);
          this.parentElement = null;
        }
        this.isConnected = false;
      }

      contains(node: SyntheticElement): boolean {
        if (node === this) return true;
        return this.children.some((c) => c.contains(node));
      }

      closest(selector: string): SyntheticElement | null {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let curr: SyntheticElement | null = this;
        while (curr) {
          if (curr.matches(selector)) return curr;
          curr = curr.parentElement;
        }
        return null;
      }

      matches(selector: string): boolean {
        if (selector === "*") return true;
        const parts = selector.split(",").map((s) => s.trim());
        return parts.some((part) => {
          if (part.startsWith("#")) {
            return this.getAttribute("id") === part.slice(1);
          }
          if (part.startsWith("[") && part.endsWith("]")) {
            const attrContent = part.slice(1, -1);
            if (attrContent.includes("=")) {
              const [k, v] = attrContent.split("=");
              const cleanV = v?.replace(/['"]/g, "");
              return this.getAttribute(k!.trim()) === cleanV;
            }
            return this.hasAttribute(attrContent);
          }
          return this.localName === part.toLowerCase();
        });
      }

      querySelectorAll(selector: string): SyntheticElement[] {
        const results: SyntheticElement[] = [];
        const walk = (node: SyntheticElement) => {
          for (const child of node.children) {
            if (child.matches(selector)) results.push(child);
            walk(child);
          }
        };
        walk(this);
        return results;
      }

      querySelector(selector: string): SyntheticElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
      }

      addEventListener(
        type: string,
        listener: (e: unknown) => void,
        options?: boolean | { capture?: boolean },
      ) {
        const capture =
          typeof options === "boolean" ? options : (options?.capture ?? false);
        const list = this.listeners.get(type) ?? [];
        list.push({ listener, capture });
        this.listeners.set(type, list);
      }

      removeEventListener(type: string, listener: (e: unknown) => void) {
        const list = this.listeners.get(type);
        if (!list) return;
        this.listeners.set(
          type,
          list.filter((l) => l.listener !== listener),
        );
      }

      getBoundingClientRect() {
        return { width: 256, height: 256, top: 0, left: 0 };
      }

      click() {
        const globalSurface = globalThis as unknown as {
          document?: object & {
            listeners?: Map<
              string,
              Array<{ listener: (e: unknown) => void; capture?: boolean }>
            >;
          };
          window?: {
            listeners?: Map<
              string,
              Array<{ listener: (e: unknown) => void; capture?: boolean }>
            >;
          };
        };
        const path: unknown[] = [];
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let current: SyntheticElement | null = this;
        while (current) {
          path.push(current);
          current = current.parentElement;
        }
        if (globalSurface.document) path.push(globalSurface.document);
        if (globalSurface.window) path.push(globalSurface.window);
        let propagationStopped = false;
        let immediateStopped = false;
        let defaultPrevented = false;
        const event = {
          target: this,
          type: "click",
          composedPath: () => path,
          get defaultPrevented() {
            return defaultPrevented;
          },
          preventDefault: () => {
            defaultPrevented = true;
          },
          stopPropagation: () => {
            propagationStopped = true;
          },
          stopImmediatePropagation: () => {
            propagationStopped = true;
            immediateStopped = true;
          },
        };
        const windowListeners =
          globalSurface.window?.listeners?.get("click") ?? [];
        for (const entry of windowListeners) {
          if (entry.capture) entry.listener(event);
          if (immediateStopped) break;
        }
        if (!propagationStopped) {
          const docListeners =
            globalSurface.document?.listeners?.get("click") ?? [];
          for (const entry of docListeners) {
            if (entry.capture) entry.listener(event);
          }
        }
        return event;
      }
    }

    function setupSyntheticFlowDom() {
      const mockBody = new SyntheticElement("body");
      const docListeners = new Map<
        string,
        Array<{ listener: (e: unknown) => void; capture?: boolean }>
      >();

      const mockDoc = {
        body: mockBody,
        getElementById: (id: string) => mockBody.querySelector(`#${id}`),
        querySelector: (s: string) => mockBody.querySelector(s),
        querySelectorAll: (s: string) => mockBody.querySelectorAll(s),
        createElement: (tag: string) => new SyntheticElement(tag),
        addEventListener: (
          t: string,
          l: (e: unknown) => void,
          o?: boolean | { capture?: boolean },
        ) => {
          const capture = typeof o === "boolean" ? o : (o?.capture ?? false);
          const list = docListeners.get(t) ?? [];
          list.push({ listener: l, capture });
          docListeners.set(t, list);
        },
        removeEventListener: (t: string, l: (e: unknown) => void) => {
          const list = docListeners.get(t);
          if (!list) return;
          docListeners.set(
            t,
            list.filter((entry) => entry.listener !== l),
          );
        },
        listeners: docListeners,
      };

      const windowListeners = new Map<
        string,
        Array<{ listener: (e: unknown) => void; capture?: boolean }>
      >();
      const mockWin = {
        top: null as unknown,
        listeners: windowListeners,
        addEventListener: (
          type: string,
          listener: (e: unknown) => void,
          options?: boolean | { capture?: boolean },
        ) => {
          const capture =
            typeof options === "boolean"
              ? options
              : (options?.capture ?? false);
          const list = windowListeners.get(type) ?? [];
          list.push({ listener, capture });
          windowListeners.set(type, list);
        },
        removeEventListener: (type: string, listener: (e: unknown) => void) => {
          const list = windowListeners.get(type);
          if (!list) return;
          windowListeners.set(
            type,
            list.filter((entry) => entry.listener !== listener),
          );
        },
      };
      mockWin.top = mockWin;

      const g = globalThis as unknown as Record<string, unknown>;
      g.window = mockWin;
      g.document = mockDoc;
      g.Element = SyntheticElement;
      g.getComputedStyle = () => ({ display: "block", visibility: "visible" });
      g.requestAnimationFrame = (cb: () => void) => {
        cb();
        return 1;
      };
      g.cancelAnimationFrame = () => {};
      g.MutationObserver = class {
        observe() {}
        disconnect() {}
      };

      return { mockDoc, mockBody, mockWin };
    }

    it("acknowledges worker acceptance and keeps the success notice briefly", async () => {
      vi.useFakeTimers();
      const { mockDoc, mockBody } = setupSyntheticFlowDom();

      // Build synthetic inspected Flow DOM structure
      const header = new SyntheticElement("header");
      header.setAttribute("role", "navigation");
      mockBody.appendChild(header);

      const project = new SyntheticElement("flow-project-page");
      mockBody.appendChild(project);

      const composer = new SyntheticElement("flow-base-prompt-box");
      const composerImg = new SyntheticElement("img");
      composerImg.src = "composer-preview.png";
      composer.appendChild(composerImg);
      project.appendChild(composer);

      const tile = new SyntheticElement("flow-image-tile");
      tile.setAttribute("data-asset-id", "card-asset-100");
      const tileImg = new SyntheticElement("img");
      tileImg.src = "https://flow.google.com/media/tile-1.jpg";
      tileImg.currentSrc = "https://flow.google.com/media/tile-1.jpg";
      tileImg.setAttribute("data-media-id", "media-100");
      tile.appendChild(tileImg);
      project.appendChild(tile);

      const session: ActiveReferenceSelectionSession = {
        sessionId: "sess-dom-1",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "b".repeat(64),
        shotId: "55",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };

      const sentMessages: unknown[] = [];
      (globalThis as unknown as { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async (msg: unknown) => {
            sentMessages.push(msg);
            if (
              msg !== null &&
              typeof msg === "object" &&
              "type" in msg &&
              msg.type === FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE
            ) {
              return {
                protocolVersion: PROTOCOL_VERSION,
                buildId: BUILD_ID,
                requestId: "flow-reference-candidate",
                ok: true,
                data: { accepted: true },
              };
            }
            return {
              protocolVersion: PROTOCOL_VERSION,
              buildId: BUILD_ID,
              requestId: "ref-state-sess-dom-1",
              ok: true,
              data: {},
            };
          },
        },
      };

      const producerResult = await flowReferenceSelectionProducer(
        session,
        "start",
        BUILD_ID,
        PROTOCOL_VERSION,
      );
      expect(producerResult.status).toBe("active");

      // Banner is injected
      const banner = mockDoc.getElementById(
        "automat-faceless-selection-banner",
      );
      expect(banner).not.toBeNull();

      // Keyboard affordance injected into eligible cards
      const tileAffordance = tile.querySelector("[data-af-reference-select]");
      expect(tileAffordance).not.toBeNull();
      expect(tileAffordance?.getAttribute("aria-label")).toBe(
        "Select for Shot 55",
      );

      // Composer prompt box should NOT have affordance
      const composerAffordance = composer.querySelector(
        "[data-af-reference-select]",
      );
      expect(composerAffordance).toBeNull();

      // Navigation header should NOT have affordance
      const navAffordance = header.querySelector("[data-af-reference-select]");
      expect(navAffordance).toBeNull();

      // Clicking eligible card triggers candidate selection
      tile.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(sentMessages).toHaveLength(1);
      const sent = sentMessages[0] as FlowReferenceCandidateSelectedMessage;
      expect(sent.type).toBe(FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE);
      expect(sent.shotId).toBe("55");
      expect(sent.candidate.sourceUrl).toBe(
        "https://flow.google.com/media/tile-1.jpg",
      );
      expect(sent.candidate.cardTag).toBe("flow-image-tile");
      expect(sent.candidate.providerAssetId).toBe("media-100");

      // Accepted state is shown before the success notice is removed.
      const status = banner?.querySelector("[role='status']");
      expect(status?.textContent).toBe(
        "✓ Candidate selected for Shot 55. Return to References.",
      );
      expect(
        mockDoc.getElementById("automat-faceless-selection-banner"),
      ).not.toBeNull();
      expect(mockDoc.querySelector("[data-af-reference-select]")).toBeNull();
      await vi.advanceTimersByTimeAsync(2500);
      expect(
        mockDoc.getElementById("automat-faceless-selection-banner"),
      ).toBeNull();
      vi.useRealTimers();
    });

    it("shows worker rejection, blocks duplicate submits, and ignores a late response after cancel", async () => {
      const { mockDoc, mockBody } = setupSyntheticFlowDom();
      const project = new SyntheticElement("flow-project-page");
      const tile = new SyntheticElement("flow-image-tile");
      const img = new SyntheticElement("img");
      img.currentSrc = "https://flow.google.com/media/opaque-token";
      tile.appendChild(img);
      project.appendChild(tile);
      mockBody.appendChild(project);

      const session: ActiveReferenceSelectionSession = {
        sessionId: "sess-reject",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "d".repeat(64),
        shotId: "56",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };
      let candidateSends = 0;
      let resolveLate: ((value: unknown) => void) | undefined;
      (globalThis as unknown as { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: (msg: unknown) => {
            if (
              msg !== null &&
              typeof msg === "object" &&
              "type" in msg &&
              msg.type === FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE
            ) {
              candidateSends += 1;
              if (candidateSends === 1) {
                return Promise.resolve({
                  protocolVersion: PROTOCOL_VERSION,
                  buildId: BUILD_ID,
                  requestId: "flow-reference-candidate",
                  ok: false,
                  error: { code: "invalid_candidate" },
                });
              }
              return new Promise((resolve) => {
                resolveLate = resolve;
              });
            }
            return Promise.resolve({
              protocolVersion: PROTOCOL_VERSION,
              buildId: BUILD_ID,
              requestId: "flow-reference-cancel",
              ok: true,
              data: {},
            });
          },
        },
      };
      await flowReferenceSelectionProducer(
        session,
        "start",
        BUILD_ID,
        PROTOCOL_VERSION,
      );
      tile.click();
      await Promise.resolve();
      await Promise.resolve();
      const banner = mockDoc.getElementById(
        "automat-faceless-selection-banner",
      );
      const status = banner?.querySelector("[role='status']");
      expect(status?.textContent).toContain("Candidate was not accepted");
      expect(
        banner?.querySelector("[data-af-diagnostic]")?.textContent,
      ).toContain("submission worker rejected");

      tile.click();
      tile.click();
      expect(candidateSends).toBe(2);
      expect(status?.textContent).toBe("Selecting candidate for Shot 56…");

      const cancel = banner?.querySelector("button") as SyntheticElement;
      cancel.click();
      resolveLate?.({
        protocolVersion: PROTOCOL_VERSION,
        buildId: BUILD_ID,
        requestId: "flow-reference-candidate",
        ok: true,
        data: { accepted: true },
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(
        mockDoc.getElementById("automat-faceless-selection-banner"),
      ).toBeNull();
    });

    it("reconciles uncertain delivery through getState before acknowledging", async () => {
      const { mockDoc, mockBody } = setupSyntheticFlowDom();
      const project = new SyntheticElement("flow-project-page");
      const tile = new SyntheticElement("flow-image-tile");
      const img = new SyntheticElement("img");
      img.currentSrc = "https://flow.google.com/media/opaque-token";
      tile.appendChild(img);
      project.appendChild(tile);
      mockBody.appendChild(project);

      const session: ActiveReferenceSelectionSession = {
        sessionId: "sess-reconcile",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "e".repeat(64),
        shotId: "57",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };
      let selectedAt = 0;
      const sentTypes: string[] = [];
      (globalThis as unknown as { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async (msg: unknown) => {
            const typed = msg as {
              type?: string;
              candidate?: { selectedAt: number };
            };
            sentTypes.push(typed.type ?? "");
            if (typed.type === FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE) {
              selectedAt = typed.candidate!.selectedAt;
              throw new Error("response channel closed after delivery");
            }
            return {
              protocolVersion: PROTOCOL_VERSION,
              buildId: BUILD_ID,
              requestId: "ref-state-sess-reconcile",
              ok: true,
              data: {
                activeSession: null,
                candidates: { "57": { selectedAt } },
              },
            };
          },
        },
      };
      await flowReferenceSelectionProducer(
        session,
        "start",
        BUILD_ID,
        PROTOCOL_VERSION,
      );
      tile.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(sentTypes).toEqual([
        FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE,
        "flow.reference.getState",
      ]);
      expect(
        mockDoc
          .getElementById("automat-faceless-selection-banner")
          ?.querySelector("[role='status']")?.textContent,
      ).toBe("✓ Candidate selected for Shot 57. Return to References.");
    });

    it("ignores a pending worker response after the selection session is replaced", async () => {
      const { mockDoc, mockBody, mockWin } = setupSyntheticFlowDom();
      const project = new SyntheticElement("flow-project-page");
      const tile = new SyntheticElement("flow-image-tile");
      const img = new SyntheticElement("img");
      img.currentSrc = "https://flow.google.com/media/opaque-token";
      tile.appendChild(img);
      project.appendChild(tile);
      mockBody.appendChild(project);

      const firstSession: ActiveReferenceSelectionSession = {
        sessionId: "sess-before-replacement",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "a".repeat(64),
        shotId: "59",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };
      const nextSession = {
        ...firstSession,
        sessionId: "sess-after-replacement",
        shotId: "60",
      };
      let resolvePending: ((value: unknown) => void) | undefined;
      (globalThis as unknown as { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async (msg: unknown) => {
            if (
              msg !== null &&
              typeof msg === "object" &&
              "type" in msg &&
              msg.type === FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE
            ) {
              return await new Promise((resolve) => {
                resolvePending = resolve;
              });
            }
            return {
              protocolVersion: PROTOCOL_VERSION,
              buildId: BUILD_ID,
              requestId: "ref-state-sess-before-replacement",
              ok: true,
              data: {},
            };
          },
        },
      };

      await flowReferenceSelectionProducer(
        firstSession,
        "start",
        BUILD_ID,
        PROTOCOL_VERSION,
      );
      tile.click();
      await Promise.resolve();
      await flowReferenceSelectionProducer(
        nextSession,
        "start",
        BUILD_ID,
        PROTOCOL_VERSION,
      );
      resolvePending?.({
        protocolVersion: PROTOCOL_VERSION,
        buildId: BUILD_ID,
        requestId: "flow-reference-candidate",
        ok: true,
        data: { accepted: true },
      });
      await Promise.resolve();
      await Promise.resolve();

      const banner = mockDoc.getElementById(
        "automat-faceless-selection-banner",
      );
      expect(banner?.querySelector("[role='status']")?.textContent).toBe("");
      expect(banner?.querySelector("strong")?.textContent).toBe(
        "Selecting reference for Shot 60",
      );
      expect(mockWin.listeners.get("click")).toHaveLength(1);
    });

    it("reports zero eligible cards and distinguishes a reached listener from card resolution", async () => {
      const { mockDoc, mockBody } = setupSyntheticFlowDom();
      mockBody.appendChild(new SyntheticElement("flow-project-page"));
      const session: ActiveReferenceSelectionSession = {
        sessionId: "sess-zero-cards",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "f".repeat(64),
        shotId: "58",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };
      (globalThis as unknown as { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async () => ({
            protocolVersion: PROTOCOL_VERSION,
            buildId: BUILD_ID,
            requestId: "ref-state-sess-zero-cards",
            ok: true,
            data: {},
          }),
        },
      };
      await flowReferenceSelectionProducer(
        session,
        "start",
        BUILD_ID,
        PROTOCOL_VERSION,
      );
      const banner = mockDoc.getElementById(
        "automat-faceless-selection-banner",
      );
      expect(banner?.querySelector("[role='status']")?.textContent).toContain(
        "No eligible gallery cards",
      );
      expect(
        banner?.querySelector("[data-af-diagnostic]")?.textContent,
      ).toContain("eligible cards 0");
      mockBody.click();
      const diagnostic = banner?.querySelector(
        "[data-af-diagnostic]",
      )?.textContent;
      expect(diagnostic).toContain("click listener reached");
      expect(diagnostic).toContain("card not resolved");
    });

    it("receives window-stopped clicks through nested overlay paths and preserves the native menu action", async () => {
      const { mockDoc, mockBody, mockWin } = setupSyntheticFlowDom();
      const project = new SyntheticElement("flow-project-page");
      const outerCard = new SyntheticElement("flow-image-tile");
      const card = new SyntheticElement("div");
      card.setAttribute("role", "listitem");
      const img = new SyntheticElement("img");
      img.currentSrc = "https://flow.google.com/media/opaque-token";
      const overlay = new SyntheticElement("div");
      const nestedLabel = new SyntheticElement("span");
      overlay.appendChild(nestedLabel);
      const nativeMenu = new SyntheticElement("button");
      nativeMenu.setAttribute("aria-label", "More options");
      card.appendChild(img);
      card.appendChild(overlay);
      card.appendChild(nativeMenu);
      outerCard.appendChild(card);
      project.appendChild(outerCard);
      mockBody.appendChild(project);

      // Model a Flow window-capture listener that stops propagation before document.
      mockWin.addEventListener(
        "click",
        (event) => (event as { stopPropagation: () => void }).stopPropagation(),
        { capture: true },
      );

      const session: ActiveReferenceSelectionSession = {
        sessionId: "sess-overlay-path",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "1".repeat(64),
        shotId: "61",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };
      const sentMessages: unknown[] = [];
      (globalThis as unknown as { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async (message: unknown) => {
            sentMessages.push(message);
            return {
              protocolVersion: PROTOCOL_VERSION,
              buildId: BUILD_ID,
              requestId: "flow-reference-candidate",
              ok: true,
              data: { accepted: true },
            };
          },
        },
      };
      await flowReferenceSelectionProducer(
        session,
        "start",
        BUILD_ID,
        PROTOCOL_VERSION,
      );

      const menuEvent = nativeMenu.click() as { defaultPrevented: boolean };
      expect(menuEvent.defaultPrevented).toBe(false);
      expect(sentMessages).toHaveLength(0);
      const banner = mockDoc.getElementById(
        "automat-faceless-selection-banner",
      );
      expect(
        banner?.querySelector("[data-af-diagnostic]")?.textContent,
      ).toContain("click listener reached; card resolved");
      expect(
        banner?.querySelector("[data-af-diagnostic]")?.textContent,
      ).toContain("eligible cards 1");

      nestedLabel.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(sentMessages).toHaveLength(1);
      expect(
        sentMessages[0] as FlowReferenceCandidateSelectedMessage,
      ).toMatchObject({ shotId: "61", candidate: { cardTag: "div" } });
    });

    it("banner cancel button cleans up and sends cancellation message", async () => {
      const { mockDoc, mockBody } = setupSyntheticFlowDom();

      const project = new SyntheticElement("flow-project-page");
      mockBody.appendChild(project);

      const tile = new SyntheticElement("flow-image-tile");
      const tileImg = new SyntheticElement("img");
      tileImg.src = "https://flow.google.com/media/tile-1.jpg";
      tileImg.currentSrc = "https://flow.google.com/media/tile-1.jpg";
      tile.appendChild(tileImg);
      project.appendChild(tile);

      const session: ActiveReferenceSelectionSession = {
        sessionId: "sess-dom-2",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "c".repeat(64),
        shotId: "60",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };

      const sentMessages: unknown[] = [];
      (globalThis as unknown as { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async (msg: unknown) => {
            sentMessages.push(msg);
          },
        },
      };

      await flowReferenceSelectionProducer(
        session,
        "start",
        BUILD_ID,
        PROTOCOL_VERSION,
      );

      const banner = mockDoc.getElementById(
        "automat-faceless-selection-banner",
      );
      const cancelBtn = banner?.querySelector("button") as SyntheticElement;
      expect(cancelBtn).not.toBeNull();
      cancelBtn.click();

      expect(sentMessages).toContainEqual({
        type: "AUTOMAT_FLOW_REFERENCE_SESSION_CANCELLED",
        sessionId: "sess-dom-2",
        shotId: "60",
      });

      expect(
        mockDoc.getElementById("automat-faceless-selection-banner"),
      ).toBeNull();
    });
  });
});
