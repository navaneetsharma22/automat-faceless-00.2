import { describe, expect, it, vi } from "vitest";
import {
  createFlowReferenceHandler,
  ReferenceSelectionError,
} from "../../src/background/handlers/references";
import {
  FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
  createFlowReferenceContextMenuProperties,
  createFlowReferenceSelectionInjection,
  flowReferencePreviewInPage,
  flowReferenceCaptureResolver,
  flowReferenceContextMenuId,
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
import { referenceAssignmentId, sha256Bytes, type ReferenceAssignmentRecord } from "../../src/domain/media/references";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";

describe("Phase 07.1 Reference Selection Sessions", () => {
  async function createFixture() {
    const database = createMemoryRepositoryDatabase();
    let clock = 10_000;
    const repositories = new ExtensionRepositories(database, () => clock);
    const broadcastEvents: unknown[] = [];
    const scriptInjections: unknown[] = [];
    const contextMenuSessions: ActiveReferenceSelectionSession[] = [];
    const removedContextMenuSessions: string[] = [];
    const documentMessages: Array<{
      tabId: number;
      documentId: string;
      message: unknown;
    }> = [];
    let documentReply: unknown;
    let mediaFetcher: typeof fetch = async (url) => {
      const response = new Response(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
        {
          headers: { "content-type": "image/webp" },
        },
      );
      Object.defineProperty(response, "url", { value: String(url) });
      return response;
    };
    let currentDocumentId = "doc-flow-1";
    let failContextMenu = false;

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
      hasMediaHostPermission: async () => true,
      fetchResource: (url, init) => mediaFetcher(url, init),
      storageSession,
      broadcastMessage: async (msg) => {
        broadcastEvents.push(msg);
      },
      contextMenu: {
        ready: Promise.resolve(),
        create: async (session) => {
          if (failContextMenu) throw new Error("Context menu unavailable");
          contextMenuSessions.push(session);
        },
        remove: async (sessionId) => {
          removedContextMenuSessions.push(sessionId);
        },
      },
      sendToDocument: async (tabId, documentId, message) => {
        documentMessages.push({ tabId, documentId, message });
        return documentReply;
      },
      scripting: {
        executeScript: async (injection) => {
          scriptInjections.push(injection);
          if (
            (injection as { func?: unknown }).func ===
            flowReferenceCaptureResolver
          ) {
            const args = (
              injection as { args?: Array<Record<string, unknown>> }
            ).args?.[0];
            return [
              {
                documentId: currentDocumentId,
                frameId: 0,
                result: {
                  ok: true,
                  candidate: {
                    ...args,
                    sourceUrl: typeof args?.sourceUrl === "string"
                      ? args.sourceUrl
                      : "https://lh3.googleusercontent.com/media/sample-card-40.jpg?token=live",
                    providerAssetId: typeof args?.providerAssetId === "string"
                      ? args.providerAssetId
                      : "asset-genuine-40",
                    cardTag: "flow-image-tile",
                    naturalWidth: 1024,
                    naturalHeight: 1024,
                  },
                },
              },
            ];
          }
          if (
            (injection as { func?: unknown }).func ===
            flowReferencePreviewInPage
          ) {
            const args = (
              injection as {
                args?: Array<{
                  sessionId: string;
                  candidateId: string;
                  previewId: string;
                }>;
              }
            ).args?.[0];
            return [
              {
                documentId: currentDocumentId,
                frameId: 0,
                result: {
                  ok: true,
                  ...args,
                  mimeType: "image/webp",
                  width: 1,
                  height: 1,
                  byteLength: 3,
                  data: "AQID",
                },
              },
            ];
          }
          return [
            {
              documentId: currentDocumentId,
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
      contextMenuSessions,
      removedContextMenuSessions,
      documentMessages,
      failContextMenu: () => {
        failContextMenu = true;
      },
      setDocumentReply: (reply: unknown) => {
        documentReply = reply;
      },
      setMediaFetcher: (fetcher: typeof fetch) => {
        mediaFetcher = fetcher;
      },
      setCurrentDocumentId: (documentId: string) => {
        currentDocumentId = documentId;
      },
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
      expect(broadcastEvents).toContainEqual(expect.objectContaining({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "session_started",
        sessionId: result.sessionId,
        workspaceId: "ws-1",
        batchId: batch!.batch.id,
        batchSourceHash: active?.sourceHash,
        shotId: "20",
      }));

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

      expect(broadcastEvents).toContainEqual(
        expect.objectContaining({
          type: FLOW_REFERENCE_EVENT_MESSAGE,
          event: "session_cancelled",
          sessionId: session.sessionId,
          workspaceId: "ws-1",
          shotId: "25",
          reason: "user_cancelled",
        }),
      );
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
        protocolVersion: PROTOCOL_VERSION,
        buildId: BUILD_ID,
        sessionId: session.sessionId,
        workspaceId: "ws-1",
        batchId: batch.batch.id,
        shotId: "40",
        candidate: {
          sourceUrl:
            "https://lh3.googleusercontent.com/media/sample-card-40.jpg?token=test",
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

    function contextMenuEvent(sessionId: string) {
      return {
        info: {
          menuItemId: flowReferenceContextMenuId(sessionId),
          mediaType: "image",
          srcUrl: "https://lh3.googleusercontent.com/flow-result-token",
          pageUrl: "https://flow.google.com/project/proj-1",
          frameUrl: "https://flow.google.com/project/proj-1",
          frameId: 0,
        },
        tab: {
          id: 101,
          url: "https://flow.google.com/project/proj-1",
        },
      };
    }

    it("lists and revalidates one candidate in the bound Flow document before accepting it", async () => {
      const { handler, documentMessages, setDocumentReply, broadcastEvents } =
        await setupActiveSession();
      const active = (await handler.getActiveSession())!;
      const candidateId = "00000000-0000-4000-8000-000000000001";
      const candidate = {
        candidateId,
        sourceUrl: "https://lh3.googleusercontent.com/flow-image-token",
        naturalWidth: 1024,
        naturalHeight: 768,
        displayWidth: 256,
        displayHeight: 192,
        providerAssetId: "stable-flow-asset-40",
        cardTag: "flow-image-tile",
        selectedAt: 10_000,
      };
      setDocumentReply({
        ok: true,
        buildId: BUILD_ID,
        sessionId: active.sessionId,
        candidates: [candidate],
        ambiguousCount: 0,
        unsupportedCount: 0,
      });

      const list = await handler.listCandidates(active.sessionId);
      expect(list.candidates).toEqual([candidate]);
      expect(documentMessages[0]).toMatchObject({
        tabId: active.tabId,
        documentId: active.documentId,
        message: { action: "list", sessionId: active.sessionId },
      });

      setDocumentReply({
        ok: true,
        buildId: BUILD_ID,
        sessionId: active.sessionId,
        candidate,
      });
      const result = await handler.chooseCandidate(
        active.sessionId,
        candidateId,
      );
      expect(result.accepted).toBe(true);
      expect(documentMessages[1]).toMatchObject({
        tabId: active.tabId,
        documentId: active.documentId,
        message: { action: "resolve", candidateId },
      });
      expect(broadcastEvents).toContainEqual(
        expect.objectContaining({
          event: "candidate_selected",
          retained: false,
          candidate: expect.objectContaining({
            sourceUrl: candidate.sourceUrl,
            providerAssetId: candidate.providerAssetId,
          }),
        }),
      );
      expect(documentMessages[2].message).toMatchObject({
        type: FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
        sessionId: active.sessionId,
        shotId: active.shotId,
      });
    });

    it("rejects a preview request from a stale or wrong session before document access", async () => {
      const { handler, documentMessages, scriptInjections } =
        await setupActiveSession();
      const priorInjectionCount = scriptInjections.length;
      await expect(
        handler.getPreview(
          "not-the-active-session",
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
        ),
      ).rejects.toMatchObject({ code: "stale_session" });
      expect(documentMessages).toHaveLength(0);
      expect(scriptInjections).toHaveLength(priorInjectionCount);
    });

    it("requests a compact preview by candidate ID and fetches the observed approved media URL in the worker", async () => {
      const { handler, setDocumentReply, scriptInjections } =
        await setupActiveSession();
      vi.stubGlobal("createImageBitmap", async () => ({
        width: 900,
        height: 600,
        close() {},
      }));
      vi.stubGlobal(
        "OffscreenCanvas",
        class {
          width: number;
          height: number;
          constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
          }
          getContext() {
            return { drawImage() {} };
          }
          async convertToBlob() {
            return new Blob([new Uint8Array([1, 2, 3])], {
              type: "image/webp",
            });
          }
        },
      );
      const active = (await handler.getActiveSession())!;
      const candidateId = "00000000-0000-4000-8000-000000000004";
      const previewId = "00000000-0000-4000-8000-000000000005";
      const candidate = {
        candidateId,
        sourceUrl:
          "https://lh3.googleusercontent.com/media/observed-image.webp?signature=private",
        naturalWidth: 900,
        naturalHeight: 600,
        displayWidth: 300,
        displayHeight: 200,
        cardTag: "flow-image-tile",
        selectedAt: 10,
      };
      setDocumentReply({
        ok: true,
        buildId: BUILD_ID,
        sessionId: active.sessionId,
        candidate,
      });

      const result = await handler.getPreview(
        active.sessionId,
        candidateId,
        previewId,
      );

      expect(result).toMatchObject({
        ok: true,
        sessionId: active.sessionId,
        candidateId,
        previewId,
        mimeType: "image/webp",
        byteLength: 3,
      });
      expect(
        scriptInjections.find(
          (entry) =>
            (entry as { func?: unknown }).func === flowReferencePreviewInPage,
        ),
      ).toBeUndefined();
      vi.unstubAllGlobals();
    });

    it("rejects a Flow content image whose re-resolved gallery media ID changes during preview acquisition", async () => {
      const fixture = await setupActiveSession();
      const { handler, setDocumentReply, setMediaFetcher } = fixture;
      vi.stubGlobal("createImageBitmap", async () => ({
        width: 1376,
        height: 768,
        close() {},
      }));
      vi.stubGlobal(
        "OffscreenCanvas",
        class {
          width: number;
          height: number;
          constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
          }
          getContext() {
            return { drawImage() {} };
          }
          async convertToBlob() {
            return new Blob([new Uint8Array([1])], { type: "image/webp" });
          }
        },
      );
      const active = (await handler.getActiveSession())!;
      const mediaId = "5a836a9f-197d-4400-aa12-2d4c7492a444";
      const otherMediaId = "00000000-0000-4000-8000-000000000001";
      const candidateId = "00000000-0000-4000-8000-000000000088";
      const pickerCandidate = {
        candidateId,
        sourceUrl: `https://flow-content.google/image/${mediaId}?sig=ephemeral`,
        providerAssetId: mediaId,
        naturalWidth: 1376,
        naturalHeight: 768,
        displayWidth: 300,
        displayHeight: 168,
        cardTag: "flow-image-tile",
        selectedAt: 10000,
      };
      setDocumentReply({
        ok: true,
        buildId: BUILD_ID,
        sessionId: active.sessionId,
        candidate: pickerCandidate,
      });
      setMediaFetcher(async (url) => {
        setDocumentReply({
          ok: true,
          buildId: BUILD_ID,
          sessionId: active.sessionId,
          candidate: {
            ...pickerCandidate,
            sourceUrl: `https://flow-content.google/image/${otherMediaId}?sig=changed`,
            providerAssetId: otherMediaId,
          },
        });
        const response = new Response(
          new Uint8Array([
            0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
          ]),
          { headers: { "content-type": "image/webp" } },
        );
        Object.defineProperty(response, "url", { value: String(url) });
        return response;
      });
      await expect(
        handler.getPreview(
          active.sessionId,
          candidateId,
          "00000000-0000-4000-8000-000000000089",
        ),
      ).rejects.toMatchObject({ code: "candidate_missing_or_changed" });
      vi.unstubAllGlobals();
    });

    it("rejects a resolver response for a different opaque token", async () => {
      const { handler, setDocumentReply, broadcastEvents } =
        await setupActiveSession();
      const active = (await handler.getActiveSession())!;
      setDocumentReply({
        ok: true,
        buildId: BUILD_ID,
        sessionId: active.sessionId,
        candidate: {
          candidateId: "00000000-0000-4000-8000-000000000009",
          sourceUrl: "https://lh3.googleusercontent.com/other-image",
          naturalWidth: 1024,
          naturalHeight: 768,
          displayWidth: 256,
          displayHeight: 192,
          cardTag: "flow-image-tile",
          selectedAt: 10000,
        },
      });
      await expect(
        handler.chooseCandidate(
          active.sessionId,
          "00000000-0000-4000-8000-000000000008",
        ),
      ).rejects.toMatchObject({ code: "candidate_missing_or_changed" });
      expect(await handler.getActiveSession()).not.toBeNull();
      expect(broadcastEvents).not.toContainEqual(
        expect.objectContaining({ event: "candidate_selected" }),
      );
    });

    it("starts the independent picker even when native context-menu setup fails", async () => {
      const fixture = await setupActiveSession();
      const original = (await fixture.handler.getActiveSession())!;
      fixture.failContextMenu();
      const result = await fixture.handler.startSelection({
        workspaceId: original.workspaceId,
        batchId: original.batchId,
        shotId: original.shotId,
      });
      expect(result.status).toBe("started");
      expect((await fixture.handler.getActiveSession())?.sessionId).toBe(
        result.sessionId,
      );
    });

    it("rejects a missing or changed picker candidate without accepting a substitute", async () => {
      const { handler, setDocumentReply, broadcastEvents } =
        await setupActiveSession();
      const active = (await handler.getActiveSession())!;
      setDocumentReply({
        ok: false,
        code: "candidate_missing_or_changed",
        buildId: BUILD_ID,
        sessionId: active.sessionId,
      });

      await expect(
        handler.chooseCandidate(
          active.sessionId,
          "00000000-0000-4000-8000-000000000002",
        ),
      ).rejects.toMatchObject({ code: "candidate_missing_or_changed" });
      expect(broadcastEvents).not.toContainEqual(
        expect.objectContaining({ event: "candidate_selected" }),
      );
    });

    it("refuses to list candidates after the verified document identity changes", async () => {
      const { handler, setCurrentDocumentId, documentMessages } =
        await setupActiveSession();
      const active = (await handler.getActiveSession())!;
      setCurrentDocumentId("replacement-document");

      await expect(
        handler.listCandidates(active.sessionId),
      ).rejects.toMatchObject({ code: "wrong_document" });
      expect(documentMessages).toHaveLength(0);
    });

    it("allows only one concurrent picker choice for an active session", async () => {
      const { handler, setDocumentReply, broadcastEvents } =
        await setupActiveSession();
      const active = (await handler.getActiveSession())!;
      const candidateId = "00000000-0000-4000-8000-000000000003";
      setDocumentReply({
        ok: true,
        buildId: BUILD_ID,
        sessionId: active.sessionId,
        candidate: {
          candidateId,
          sourceUrl: "https://lh3.googleusercontent.com/unique-image",
          naturalWidth: 1280,
          naturalHeight: 720,
          displayWidth: 256,
          displayHeight: 144,
          cardTag: "flow-image-tile",
          selectedAt: 10_000,
        },
      });

      const results = await Promise.allSettled([
        handler.chooseCandidate(active.sessionId, candidateId),
        handler.chooseCandidate(active.sessionId, candidateId),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect(
        broadcastEvents.filter(
          (event) =>
            event !== null &&
            typeof event === "object" &&
            "event" in event &&
            event.event === "candidate_selected",
        ),
      ).toHaveLength(1);
    });

    it("restores the menu only for the still-verified active session", async () => {
      const { handler, contextMenuSessions } = await setupActiveSession();
      contextMenuSessions.length = 0;

      await expect(handler.restoreActiveContextMenu()).resolves.toBe(true);
      expect(contextMenuSessions).toHaveLength(1);
      expect(contextMenuSessions[0]).toMatchObject({
        status: "active",
        shotId: "40",
      });
    });

    it("limits the menu to image contexts on supported Flow routes", () => {
      const session: ActiveReferenceSelectionSession = {
        sessionId: "selection-session-1",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "batch-1",
        shotId: "40",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-flow-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };

      expect(createFlowReferenceContextMenuProperties(session)).toEqual({
        id: flowReferenceContextMenuId(session.sessionId),
        title: "Use as reference for Shot 40",
        contexts: ["image"],
        documentUrlPatterns: [
          "https://flow.google.com/project/*",
          "https://flow.google.com/u/*/project/*",
          "https://labs.google/fx/tools/flow/*",
        ],
      });
    });

    it("accepts an image context-menu event through the existing transient candidate path", async () => {
      const { handler, broadcastEvents, removedContextMenuSessions } =
        await setupActiveSession();
      const active = (await handler.getActiveSession())!;
      const { info, tab } = contextMenuEvent(active.sessionId);

      const result = await handler.handleContextMenu(info, tab);

      expect(result).toEqual({ accepted: true, session: active });
      const state = await handler.getState(active.workspaceId);
      expect(state.candidates[active.shotId]).toMatchObject({
        sourceUrl: info.srcUrl,
        naturalWidth: 0,
        naturalHeight: 0,
        cardTag: "context-menu-image",
      });
      expect(broadcastEvents).toContainEqual(
        expect.objectContaining({
          type: FLOW_REFERENCE_EVENT_MESSAGE,
          event: "candidate_selected",
          sessionId: active.sessionId,
          shotId: active.shotId,
          retained: false,
          message: expect.stringContaining(
            "Save reference to capture and keep image bytes.",
          ),
        }),
      );
      expect(removedContextMenuSessions).toContain(active.sessionId);
    });

    it("rejects context-menu events from the wrong target and frame", async () => {
      const { handler } = await setupActiveSession();
      const active = (await handler.getActiveSession())!;
      const event = contextMenuEvent(active.sessionId);

      const wrongTab = await handler.handleContextMenu(event.info, {
        ...event.tab,
        id: 999,
      });
      const wrongFrame = await handler.handleContextMenu(
        { ...event.info, frameId: 2 },
        event.tab,
      );

      expect(wrongTab).toEqual({ accepted: false, code: "wrong_tab" });
      expect(wrongFrame).toEqual({ accepted: false, code: "wrong_frame" });
      expect(await handler.getActiveSession()).toMatchObject({
        sessionId: active.sessionId,
      });
    });

    it("rejects a context-menu event after cancellation", async () => {
      const { handler } = await setupActiveSession();
      const active = (await handler.getActiveSession())!;
      await handler.cancelSelection(active.sessionId);

      const event = contextMenuEvent(active.sessionId);
      const result = await handler.handleContextMenu(event.info, event.tab);

      expect(result).toEqual({ accepted: false, code: "stale_session" });
    });

    it("allows only one of two duplicate context-menu events to claim the session", async () => {
      const { handler } = await setupActiveSession();
      const active = (await handler.getActiveSession())!;
      const event = contextMenuEvent(active.sessionId);

      const results = await Promise.all([
        handler.handleContextMenu(event.info, event.tab),
        handler.handleContextMenu(event.info, event.tab),
      ]);

      expect(results.filter((result) => result.accepted)).toHaveLength(1);
      expect(results.filter((result) => !result.accepted)).toHaveLength(1);
      const state = await handler.getState(active.workspaceId);
      expect(state.candidates[active.shotId]?.sourceUrl).toBe(
        event.info.srcUrl,
      );
    });

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
      expect(state.candidates["40"]).toMatchObject({
        sourceUrl: "https://lh3.googleusercontent.com/media/sample-card-40.jpg",
        providerAssetId: candidatePayload.candidate.providerAssetId,
        selectionVersion: expect.any(String),
        workspaceId: "ws-1",
        batchId: candidatePayload.batchId,
        shotId: "40",
        documentId: "doc-flow-1",
      });

      // Broadcast confirms honest candidate-only state (retained: false)
      expect(broadcastEvents).toContainEqual(
        expect.objectContaining({
          type: FLOW_REFERENCE_EVENT_MESSAGE,
          event: "candidate_selected",
          sessionId: session.sessionId,
          workspaceId: "ws-1",
          batchId: candidatePayload.batchId,
          shotId: "40",
          candidate: expect.objectContaining({
            sourceUrl:
              "https://lh3.googleusercontent.com/media/sample-card-40.jpg",
            selectionVersion: expect.any(String),
            documentId: "doc-flow-1",
          }),
          retained: false,
          message: expect.stringContaining(
            "Save reference to capture and keep image bytes.",
          ),
        }),
      );

      // No durable database changes or prompt batch modifications occurred
      const batchAfter = (await repositories.getPromptBatch("ws-1", "image"))!;
      expect(batchAfter.batch.id).toBe(candidatePayload.batchId);
      // No reference tables created in repository database
      const allBatches = await database.batches.toArray();
      expect(allBatches).toHaveLength(1);
      expect(
        await repositories.listReferenceAssignments(
          "ws-1",
          candidatePayload.batchId,
        ),
      ).toEqual([]);

      // Clear candidate works
      await handler.clearCandidate("ws-1", "40");
      const stateAfterClear = await handler.getState("ws-1");
      expect(stateAfterClear.candidates["40"]).toBeUndefined();
      expect(broadcastEvents).toContainEqual(expect.objectContaining({
        type: FLOW_REFERENCE_EVENT_MESSAGE,
        event: "candidate_cleared",
        workspaceId: "ws-1",
        batchId: candidatePayload.batchId,
        batchSourceHash: state.batchSourceHash,
        shotId: "40",
      }));
    });

    it("persists the exact original cross-origin response bytes and their SHA-256", async () => {
      const { handler, candidatePayload, validSender, repositories } =
        await setupActiveSession();
      vi.stubGlobal("createImageBitmap", async () => ({
        width: 1024,
        height: 1024,
        close() {},
      }));
      const accepted = await handler.handleCandidateSelected(
        candidatePayload,
        validSender,
      );
      expect(accepted.accepted).toBe(true);
      const state = await handler.getState("ws-1");
      const candidate = state.candidates["40"]!;
      const captureOperationId = "00000000-0000-4000-8000-000000000077";
      const result = await handler.captureReference({
        workspaceId: "ws-1",
        batchId: candidate.batchId,
        shotId: "40",
        selectionVersion: candidate.selectionVersion!,
        expectedAssignmentVersion: 0,
        captureOperationId,
      });
      const stored = await repositories.getReferenceAssignment(
        "ws-1",
        candidate.batchId,
        "40",
        candidate.batchSourceHash,
      );
      const original = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ]);
      expect(result.saved).toBe(true);
      expect(stored?.bytes).toBeInstanceOf(Blob);
      expect(new Uint8Array(await stored!.bytes.arrayBuffer())).toEqual(
        original,
      );
      expect(stored?.sha256).toBe(await sha256Bytes(original));
      expect(stored?.acquisitionProvenance).toBe(
        "verified_flow_document_extension_fetch",
      );
      expect(candidate.sourceUrl).not.toContain("token=");
      vi.unstubAllGlobals();
    });

    it("keeps reused Shot 01 references isolated by image source hash across reimport and capture", async () => {
      const fixture = await createFixture();
      await setupVerifiedFlowTarget(fixture.repositories, fixture.database);
      vi.stubGlobal("createImageBitmap", async () => ({ width: 1024, height: 1024, close() {} }));
      const sourceFor = (scene: string) => `01: {"shot_id":"01","prompt":"${scene}"}`;
      const dinosaurSource = sourceFor("dinosaur in forest");
      const dinosaurBatch = await fixture.repositories.savePromptBatch({ workspaceId: "ws-1", kind: "image", sourceText: dinosaurSource });

      const selectAndSave = async (batchSource: typeof dinosaurBatch, sourceLabel: string) => {
        const session = await fixture.handler.startSelection({ workspaceId: "ws-1", batchId: batchSource.batch.id, shotId: "1" });
        const candidatePayload: FlowReferenceCandidateSelectedMessage = {
          type: FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE,
          protocolVersion: PROTOCOL_VERSION,
          buildId: BUILD_ID,
          sessionId: session.sessionId,
          workspaceId: "ws-1",
          batchId: batchSource.batch.id,
          shotId: "1",
          candidate: {
            sourceUrl: `https://lh3.googleusercontent.com/${sourceLabel}-shot-01`,
            naturalWidth: 1024,
            naturalHeight: 1024,
            displayWidth: 256,
            displayHeight: 256,
            providerAssetId: `${sourceLabel}-asset-01`,
            cardTag: "flow-image-tile",
            selectedAt: fixture.clock(),
          },
        };
        const sender = { id: "test-extension-id", frameId: 0, tab: { id: 101 }, documentId: "doc-flow-1" };
        expect((await fixture.handler.handleCandidateSelected(candidatePayload, sender)).accepted).toBe(true);
        const state = await fixture.handler.getState("ws-1");
        const candidate = state.candidates["1"]!;
        expect(candidate.batchSourceHash).toBe(await sha256Hex(batchSource.batch.sourceText));
        expect((await fixture.handler.captureReference({
          workspaceId: "ws-1", batchId: batchSource.batch.id, shotId: "1",
          selectionVersion: candidate.selectionVersion!, expectedAssignmentVersion: 0,
          captureOperationId: crypto.randomUUID(),
        })).saved).toBe(true);
        return state.batchSourceHash as string;
      };

      const dinosaurHash = await sha256Hex(dinosaurBatch.batch.sourceText);
      const dinosaurBytes = new Uint8Array([1, 2, 3, 4]);
      const dinosaurReference: ReferenceAssignmentRecord = {
        assignmentId: referenceAssignmentId("ws-1", dinosaurBatch.batch.id, "1"),
        referenceId: crypto.randomUUID(),
        captureOperationId: crypto.randomUUID(),
        workspaceId: "ws-1",
        batchId: dinosaurBatch.batch.id,
        batchSourceHash: dinosaurHash,
        shotId: "1",
        promptHash: dinosaurBatch.items[0]!.contentHash,
        selectionVersion: crypto.randomUUID(),
        assignmentVersion: 1,
        flowProjectId: "proj-1",
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-flow-1",
        providerAssetId: "dinosaur-asset-01",
        observedSourceSha256: await sha256Hex("dinosaur-image-source"),
        bytes: new Blob([dinosaurBytes], { type: "image/png" }),
        mimeType: "image/png",
        byteSize: dinosaurBytes.byteLength,
        sha256: await sha256Bytes(dinosaurBytes),
        width: 2,
        height: 2,
        capturedAt: fixture.clock(),
        acquisitionProvenance: "verified_flow_document_same_origin_fetch",
        qualityProvenance: "observed_resource_original_bytes_no_upscale",
      };
      await fixture.database.referenceAssignments.put(dinosaurReference);

      const volcanoSource = sourceFor("volcano at dawn");
      const volcanoBatch = await fixture.repositories.savePromptBatch({ workspaceId: "ws-1", kind: "image", sourceText: volcanoSource });
      expect(volcanoBatch.batch.id).toBe(dinosaurBatch.batch.id);
      expect(volcanoBatch.items[0]!.id).toBe(dinosaurBatch.items[0]!.id);
      expect(volcanoBatch.items[0]!.shotId).toBe(dinosaurBatch.items[0]!.shotId);
      const beforeVolcanoSave = await fixture.handler.getState("ws-1");
      expect(beforeVolcanoSave.batchSourceHash).not.toBe(dinosaurHash);
      expect(beforeVolcanoSave.savedReferences).toEqual([]);
      expect(beforeVolcanoSave.candidates["1"]).toBeUndefined();

      const volcanoHash = await selectAndSave(volcanoBatch, "volcano");
      const volcanoReference = await fixture.repositories.getReferenceAssignment("ws-1", volcanoBatch.batch.id, "1", volcanoHash);
      const dinosaurAfter = await fixture.repositories.getReferenceAssignment("ws-1", dinosaurBatch.batch.id, "1", dinosaurHash);
      expect(volcanoReference?.referenceId).not.toBe(dinosaurReference?.referenceId);
      expect(volcanoReference?.assignmentId).not.toBe(dinosaurReference?.assignmentId);
      expect(dinosaurAfter?.referenceId).toBe(dinosaurReference?.referenceId);
      expect(await fixture.repositories.listReferenceAssignments("ws-1", dinosaurBatch.batch.id, dinosaurHash)).toHaveLength(1);
      expect(await fixture.repositories.listReferenceAssignments("ws-1", volcanoBatch.batch.id, volcanoHash)).toHaveLength(1);
      vi.unstubAllGlobals();
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
        FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
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

    it("shows the context-menu acknowledgement only for its matching active session", async () => {
      vi.useFakeTimers();
      const { mockDoc, mockBody } = setupSyntheticFlowDom();
      const project = new SyntheticElement("flow-project-page");
      const card = new SyntheticElement("flow-image-tile");
      const image = new SyntheticElement("img");
      image.currentSrc = "https://flow.google.com/media/selected";
      card.appendChild(image);
      project.appendChild(card);
      mockBody.appendChild(project);
      const session: ActiveReferenceSelectionSession = {
        sessionId: "sess-context-menu-ack",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "3".repeat(64),
        shotId: "63",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };
      const runtimeListeners: Array<(message: unknown) => void> = [];
      (globalThis as unknown as { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async () => undefined,
          onMessage: {
            addListener: (listener: (message: unknown) => void) => {
              runtimeListeners.push(listener);
            },
            removeListener: (listener: (message: unknown) => void) => {
              const index = runtimeListeners.indexOf(listener);
              if (index >= 0) runtimeListeners.splice(index, 1);
            },
          },
        },
      };
      await flowReferenceSelectionProducer(
        session,
        "start",
        BUILD_ID,
        PROTOCOL_VERSION,
        FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
      );
      const status = mockDoc
        .getElementById("automat-faceless-selection-banner")
        ?.querySelector("[role='status']");

      runtimeListeners[1]?.({
        type: FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
        sessionId: "old-session",
        shotId: "63",
      });
      expect(status?.textContent).toBe("");

      runtimeListeners[1]?.({
        type: FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
        sessionId: session.sessionId,
        shotId: session.shotId,
      });
      expect(status?.textContent).toBe(
        "✓ Candidate selected for Shot 63. Return to References.",
      );
      expect(runtimeListeners).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2500);
      vi.useRealTimers();
    });

    it("lists only unique eligible images and refuses a changed candidate token", async () => {
      const { mockBody } = setupSyntheticFlowDom();
      const project = new SyntheticElement("flow-project-page");
      const eligibleCard = new SyntheticElement("flow-image-tile");
      const eligibleImage = new SyntheticElement("img");
      eligibleImage.currentSrc = "https://flow.google.com/media/owned-image";
      eligibleCard.setAttribute("data-asset-id", "asset-one");
      eligibleCard.appendChild(eligibleImage);
      project.appendChild(eligibleCard);

      const ambiguousCard = new SyntheticElement("flow-image-tile");
      const first = new SyntheticElement("img");
      first.currentSrc = "https://flow.google.com/media/ambiguous-one";
      const second = new SyntheticElement("img");
      second.currentSrc = "https://flow.google.com/media/ambiguous-two";
      ambiguousCard.appendChild(first);
      ambiguousCard.appendChild(second);
      project.appendChild(ambiguousCard);

      const unrelatedImage = new SyntheticElement("img");
      unrelatedImage.currentSrc = "https://flow.google.com/media/unrelated";
      mockBody.appendChild(project);
      mockBody.appendChild(unrelatedImage);

      const session: ActiveReferenceSelectionSession = {
        sessionId: "sess-picker-discovery",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "4".repeat(64),
        shotId: "64",
        tabId: 101,
        projectId: "proj-1",
        canonicalTarget: "https://flow.google.com/project/proj-1",
        documentId: "doc-1",
        frameId: 0,
        startedAt: 10_000,
        status: "active",
      };
      const listeners: Array<
        (
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => void
      > = [];
      (globalThis as unknown as { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async () => undefined,
          onMessage: {
            addListener: (listener: (message: unknown) => void) => {
              listeners.push(listener as (typeof listeners)[number]);
            },
            removeListener: (listener: (message: unknown) => void) => {
              const index = listeners.indexOf(
                listener as (typeof listeners)[number],
              );
              if (index >= 0) listeners.splice(index, 1);
            },
          },
        },
      };
      await flowReferenceSelectionProducer(session, "start", BUILD_ID);

      let listResponse: unknown;
      listeners[0]?.(
        {
          type: "AUTOMAT_FLOW_REFERENCE_PICKER_REQUEST",
          action: "list",
          buildId: BUILD_ID,
          sessionId: session.sessionId,
        },
        {},
        (response) => (listResponse = response),
      );
      expect(listResponse).toMatchObject({
        ok: true,
        sessionId: session.sessionId,
        candidates: [
          {
            sourceUrl: eligibleImage.currentSrc,
            providerAssetId: "asset-one",
          },
        ],
        ambiguousCount: 1,
      });
      expect(JSON.stringify(listResponse)).not.toContain("unrelated");

      const candidateId = (
        listResponse as { candidates: Array<{ candidateId: string }> }
      ).candidates[0]!.candidateId;
      eligibleImage.clientWidth = 400;
      eligibleImage.clientHeight = 300;
      let resizedResponse: unknown;
      listeners[0]?.(
        {
          type: "AUTOMAT_FLOW_REFERENCE_PICKER_REQUEST",
          action: "resolve",
          buildId: BUILD_ID,
          sessionId: session.sessionId,
          candidateId,
        },
        {},
        (response) => (resizedResponse = response),
      );
      expect(resizedResponse).toMatchObject({
        ok: true,
        candidate: {
          sourceUrl: eligibleImage.currentSrc,
          displayWidth: 400,
          displayHeight: 300,
        },
      });
      eligibleImage.currentSrc = "https://flow.google.com/media/replaced";
      let resolveResponse: unknown;
      listeners[0]?.(
        {
          type: "AUTOMAT_FLOW_REFERENCE_PICKER_REQUEST",
          action: "resolve",
          buildId: BUILD_ID,
          sessionId: session.sessionId,
          candidateId,
        },
        {},
        (response) => (resolveResponse = response),
      );
      expect(resolveResponse).toMatchObject({
        ok: false,
        code: "candidate_missing_or_changed",
      });

      eligibleImage.currentSrc = "https://flow.google.com/media/owned-image";
      const duplicateCard = new SyntheticElement("flow-image-tile");
      const duplicateImage = new SyntheticElement("img");
      duplicateImage.currentSrc = eligibleImage.currentSrc;
      duplicateCard.setAttribute("data-asset-id", "asset-one");
      duplicateCard.appendChild(duplicateImage);
      project.appendChild(duplicateCard);
      let ambiguousResponse: unknown;
      listeners[0]?.(
        {
          type: "AUTOMAT_FLOW_REFERENCE_PICKER_REQUEST",
          action: "resolve",
          buildId: BUILD_ID,
          sessionId: session.sessionId,
          candidateId,
        },
        {},
        (response) => (ambiguousResponse = response),
      );
      expect(ambiguousResponse).toMatchObject({
        ok: false,
        code: "candidate_ambiguous",
      });
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
      expect(
        banner?.querySelector("[data-af-diagnostic]")?.textContent,
      ).toContain("submission selection_already_pending");

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
      expect(
        banner?.querySelector("[data-af-diagnostic]")?.textContent,
      ).toContain("submission native_action_ignored");

      nestedLabel.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(sentMessages).toHaveLength(1);
      expect(
        sentMessages[0] as FlowReferenceCandidateSelectedMessage,
      ).toMatchObject({ shotId: "61", candidate: { cardTag: "div" } });
    });

    it("selects an image inside an interactive wrapper and reports ambiguous card images", async () => {
      const { mockDoc, mockBody } = setupSyntheticFlowDom();
      const project = new SyntheticElement("flow-project-page");
      const ambiguousCard = new SyntheticElement("div");
      ambiguousCard.setAttribute("role", "listitem");
      const firstImage = new SyntheticElement("img");
      firstImage.currentSrc = "https://flow.google.com/media/one";
      const secondImage = new SyntheticElement("img");
      secondImage.currentSrc = "https://flow.google.com/media/two";
      const overlay = new SyntheticElement("div");
      const overlayTarget = new SyntheticElement("span");
      overlay.appendChild(overlayTarget);
      ambiguousCard.appendChild(firstImage);
      ambiguousCard.appendChild(secondImage);
      ambiguousCard.appendChild(overlay);

      const imageCard = new SyntheticElement("flow-image-tile");
      const imageButton = new SyntheticElement("button");
      imageButton.setAttribute("role", "button");
      imageButton.setAttribute("aria-label", "View image");
      const ownedImage = new SyntheticElement("img");
      ownedImage.currentSrc = "https://flow.google.com/media/owned";
      imageButton.appendChild(ownedImage);
      imageCard.appendChild(imageButton);
      project.appendChild(ambiguousCard);
      project.appendChild(imageCard);
      mockBody.appendChild(project);

      const session: ActiveReferenceSelectionSession = {
        sessionId: "sess-image-ownership",
        workspaceId: "ws-1",
        batchId: "batch-1",
        sourceHash: "2".repeat(64),
        shotId: "62",
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

      overlayTarget.click();
      const banner = mockDoc.getElementById(
        "automat-faceless-selection-banner",
      );
      expect(
        banner?.querySelector("[data-af-diagnostic]")?.textContent,
      ).toContain("submission image_missing_or_ambiguous");
      expect(sentMessages).toHaveLength(0);

      imageButton.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(sentMessages).toHaveLength(1);
      expect(
        sentMessages[0] as FlowReferenceCandidateSelectedMessage,
      ).toMatchObject({
        shotId: "62",
        candidate: { sourceUrl: "https://flow.google.com/media/owned" },
      });
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
