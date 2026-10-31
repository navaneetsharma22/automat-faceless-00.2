import { describe, expect, it } from "vitest";
import {
  inspectTimedFlowGenerate,
  inspectFlowImageButton,
  type FlowImagePagePort,
} from "../../src/platforms/flow/images";
import {
  createFlowTimedQueueDispatcher,
  type FlowTimedDispatchEnvironment,
} from "../../src/background/generationQueue";
import {
  ExtensionRepositories,
  sha256Hex,
} from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import type { FlowImageGenerateOncePort } from "../../src/platforms/flow/images";
import type { FlowPromptEntryPort } from "../../src/platforms/flow/promptEntry";

const promptShot13 = JSON.stringify({
  shot_id: "13",
  scene_title: "Shot 13 Production Scene",
  prompt: "A".repeat(3840),
});

describe("timed pre-activation inspection and button ownership revalidation", () => {
  describe("inspectTimedFlowGenerate unit behavior", () => {
    it("captures comparison outcome and actual text from the SAME editor sample without DOM mutation", async () => {
      const mockCalls: Array<{ method: string; params?: unknown }> = [];
      const port: FlowImagePagePort = {
        attach: async () => undefined,
        detach: async () => undefined,
        now: () => 1_000,
        sendCommand: async (_tabId, method, params) => {
          mockCalls.push({ method, params });
          if (method === "Runtime.evaluate") {
            return {
              result: {
                objectId: "wrapper-obj-1",
                type: "object",
              },
            };
          }
          if (method === "Runtime.callFunctionOn") {
            const p = params as {
              objectId?: string;
              functionDeclaration?: string;
            };
            if (
              p.functionDeclaration?.includes("hasButton:Boolean(this.button)")
            ) {
              return {
                result: {
                  value: {
                    composer: "identified",
                    exactPrompt: true,
                    generate: "identified",
                    actualText: promptShot13,
                    hasButton: true,
                  },
                },
              };
            }
            if (p.functionDeclaration?.includes("return this.button")) {
              return {
                result: {
                  objectId: "remote-button-node-1",
                  subtype: "node",
                },
              };
            }
          }
          if (method === "Runtime.releaseObject") {
            return {};
          }
          return {};
        },
      };

      const result = await inspectTimedFlowGenerate(port, 42, promptShot13);
      expect(result.exactPrompt).toBe(true);
      expect(result.generate).toBe("identified");
      expect(result.actualText).toBe(promptShot13);
      expect(result.buttonObjectId).toBe("remote-button-node-1");

      // Verify wrapper object is released
      expect(mockCalls.some((c) => c.method === "Runtime.releaseObject")).toBe(
        true,
      );
    });

    it("does not corrupt exactPrompt to false when the button is disabled", async () => {
      const port: FlowImagePagePort = {
        attach: async () => undefined,
        detach: async () => undefined,
        now: () => 1_000,
        sendCommand: async (_tabId, method) => {
          if (method === "Runtime.evaluate") {
            return {
              result: {
                objectId: "wrapper-obj-disabled",
                type: "object",
              },
            };
          }
          if (method === "Runtime.callFunctionOn") {
            return {
              result: {
                value: {
                  composer: "identified",
                  exactPrompt: true, // Text matches exactly
                  generate: "disabled", // But button is disabled
                  actualText: promptShot13,
                  hasButton: false,
                },
              },
            };
          }
          return {};
        },
      };

      const result = await inspectTimedFlowGenerate(port, 42, promptShot13);
      expect(result.exactPrompt).toBe(true);
      expect(result.generate).toBe("disabled");
      expect(result.buttonObjectId).toBeUndefined();
    });
  });

  describe("inspectFlowImageButton ownership revalidation", () => {
    it("returns coordinates when button is valid, connected, and belongs to composer boundary", async () => {
      const port: FlowImagePagePort = {
        attach: async () => undefined,
        detach: async () => undefined,
        now: () => 1_000,
        sendCommand: async (_tabId, method) => {
          if (method === "Runtime.callFunctionOn") {
            return {
              result: {
                value: { x: 500, y: 300 },
              },
            };
          }
          return {};
        },
      };

      const pos = await inspectFlowImageButton(port, 42, "button-valid-1");
      expect(pos).toEqual({ x: 500, y: 300 });
    });

    it("returns undefined when DOM/button is replaced between round trips", async () => {
      const port: FlowImagePagePort = {
        attach: async () => undefined,
        detach: async () => undefined,
        now: () => 1_000,
        sendCommand: async (_tabId, method) => {
          if (method === "Runtime.callFunctionOn") {
            // Revalidation function returned null because enabled[0] !== button (replaced node)
            return {
              result: {
                value: null,
              },
            };
          }
          return {};
        },
      };

      const pos = await inspectFlowImageButton(
        port,
        42,
        "button-stale-replaced",
      );
      expect(pos).toBeUndefined();
    });
  });

  describe("dispatcher integration regressions", () => {
    async function createTestQueueFixture() {
      const database = createMemoryRepositoryDatabase();
      const clock = 1_000;
      const repositories = new ExtensionRepositories(database, () => clock);
      const promptHash = await sha256Hex(promptShot13);
      const source = `13: ${promptShot13}`;

      await repositories.savePromptBatch({
        workspaceId: "test-ws",
        kind: "image",
        sourceText: source,
      });

      const target = {
        provider: "Flow" as const,
        tabId: 42,
        canonicalTarget: "https://flow.google.com/project/shot-13-test",
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
          tabId: 42,
          canonicalTarget: target.canonicalTarget,
          projectId: "shot-13-test",
          frameId: 0,
          documentId: "doc-shot-13",
          documentToken: "token-shot-13",
          extensionBuildId: BUILD_ID,
          extensionProtocolVersion: PROTOCOL_VERSION,
          connectorBuildId: BUILD_ID,
          connectorProtocolVersion: 1,
          capability: "read-only-connection-v1",
          verifiedAt: 900,
        },
      });

      const queue = await repositories.createTimedImageSubmissionQueue({
        workspaceId: "test-ws",
        queueId: "4cad6e62-e5bc-4892-8de6-d909772b7530",
        settingsConfirmation: {
          confirmationId: "conf-13",
          confirmedAt: 900,
          tabId: 42,
          projectId: "shot-13-test",
          canonicalTarget: target.canonicalTarget,
          declaredVariantCount: 1,
        },
      });

      // Claim item 0 into sending state
      const claimedQueue = await repositories.claimTimedImageQueueItem({
        queueId: queue.queueId,
        expectedRevision: queue.revision,
        order: 0,
        attemptId: "attempt-shot-13",
        at: clock,
      });

      return { database, repositories, queue: claimedQueue, clock, promptHash };
    }

    function createMockEnvironment(options: {
      inDispatchSampleText: string;
      laterDiagnosticText?: string;
      generateState?: "identified" | "disabled" | "missing" | "ambiguous";
      buttonReplaced?: boolean;
    }): {
      environment: FlowTimedDispatchEnvironment;
      mouseEventsSent: Array<{ type: string; x: number; y: number }>;
    } {
      const mouseEventsSent: Array<{ type: string; x: number; y: number }> = [];
      let editorCurrentText = "";
      const promptPort: FlowPromptEntryPort = {
        getSelection: async () => ({
          tabId: 42,
          canonicalTarget: "https://flow.google.com/project/shot-13-test",
        }),
        getTab: async () => ({
          id: 42,
          title: "Flow Shot 13",
          url: "https://flow.google.com/project/shot-13-test",
        }),
        hasRequiredApis: () => true,
        hasDebuggerPermission: async () => true,
        attach: async () => undefined,
        detach: async () => undefined,
        sendCommand: async () => ({}),
      };

      const pagePort: FlowImageGenerateOncePort = {
        ...promptPort,
        acquireDebuggerLease: async (tabId: number) => ({
          tabId,
          token: Symbol("lease-shot-13"),
        }),
        releaseDebuggerLease: async () => undefined,
        readFrame: async () => ({
          frameId: "top-frame",
          loaderId: "loader-13",
          url: "https://flow.google.com/project/shot-13-test",
          documentId: "doc-shot-13",
          senderFrameId: 0,
        }),
        captureFrame: async () => {
          throw new Error("not_used");
        },
        inspectGenerate: async () => {
          throw new Error("not_used");
        },
        recheckGenerate: async () => false,
        buttonPosition: async () => undefined,
        activate: async () => ({
          complete: false,
          pressAttempted: false,
          releaseAttempted: false,
        }),
        startObservation: async () => {
          throw new Error("not_used");
        },
        stopObservation: async () => undefined,
        activateObservation: async () => {
          throw new Error("not_used");
        },
        resumeObservation: async () => {
          throw new Error("not_used");
        },
        sendCommand: async (_tabId, method, params) => {
          if (method === "Page.enable" || method === "Runtime.enable") {
            return {};
          }
          if (method === "Page.getFrameTree") {
            return {
              frameTree: {
                frame: {
                  id: "top-frame",
                  loaderId: "loader-13",
                  url: "https://flow.google.com/project/shot-13-test",
                },
              },
            };
          }
          if (method === "Input.insertText") {
            editorCurrentText = (params as { text: string }).text;
            return {};
          }
          if (method === "Runtime.evaluate") {
            const p = params as {
              expression?: string;
              returnByValue?: boolean;
            };
            // Used by readCurrentFlowEditorText for later diagnostic sample
            if (p.expression?.includes("found: true")) {
              return {
                result: {
                  value: {
                    found: true,
                    text:
                      options.laterDiagnosticText ??
                      options.inDispatchSampleText,
                  },
                },
              };
            }
            // Used by enterFlowPrompt
            if (p.expression?.includes("flowComposerRuntime")) {
              if (p.returnByValue === false) {
                return { result: { objectId: "editor-node", subtype: "node" } };
              }
              return {
                result: {
                  value: {
                    state: "empty",
                    candidateCount: 1,
                    editorKind: "contenteditable",
                    methodCompatible: true,
                  },
                },
              };
            }
            // Return wrapper object for flowTimedGenerateRuntime
            return {
              result: {
                objectId: "timed-wrapper-obj",
                type: "object",
              },
            };
          }
          if (method === "Runtime.callFunctionOn") {
            const p = params as {
              functionDeclaration?: string;
              objectId?: string;
            };
            // Focus call during enterFlowPrompt
            if (p.functionDeclaration?.includes("this.focus()")) {
              return { result: { value: true } };
            }
            // Prompt entry text verification read
            if (
              p.functionDeclaration?.includes("this.isConnected") &&
              p.objectId === "editor-node"
            ) {
              return {
                result: {
                  value: {
                    connected: true,
                    text: editorCurrentText,
                  },
                },
              };
            }
            // Extraction of data from timed wrapper
            if (
              p.functionDeclaration?.includes("hasButton:Boolean(this.button)")
            ) {
              const exact = options.inDispatchSampleText === promptShot13;
              const gen = options.generateState ?? "identified";
              return {
                result: {
                  value: {
                    composer: "identified",
                    exactPrompt: exact,
                    generate: gen,
                    actualText: options.inDispatchSampleText,
                    hasButton: gen === "identified",
                  },
                },
              };
            }
            if (p.functionDeclaration?.includes("return this.button")) {
              return {
                result: {
                  objectId: "button-remote-id",
                  subtype: "node",
                },
              };
            }
            // Button revalidation
            if (
              p.functionDeclaration?.includes(
                "revalidateAndInspectButtonRuntime",
              )
            ) {
              if (options.buttonReplaced) {
                return { result: { value: null } };
              }
              return { result: { value: { x: 500, y: 300 } } };
            }
          }
          if (method === "Runtime.releaseObject") {
            return {};
          }
          if (method === "Input.dispatchMouseEvent") {
            const p = params as { type: string; x: number; y: number };
            mouseEventsSent.push({ type: p.type, x: p.x, y: p.y });
            return {};
          }
          return {};
        },
      };

      const environment: FlowTimedDispatchEnvironment = {
        promptPort,
        pagePort,
        getTab: async () => ({
          id: 42,
          title: "Flow Shot 13",
          url: "https://flow.google.com/project/shot-13-test",
        }),
        getDocument: async () => ({
          documentId: "doc-shot-13",
          frameId: 0,
          result: "https://flow.google.com/project/shot-13-test",
        }),
      };

      return { environment, mouseEventsSent };
    }

    it("identical text must pass and proceed to activation", async () => {
      const { repositories, queue, clock } = await createTestQueueFixture();
      const { environment, mouseEventsSent } = createMockEnvironment({
        inDispatchSampleText: promptShot13,
      });

      let authorizationCalled = false;
      const dispatcher = createFlowTimedQueueDispatcher(
        repositories,
        () => clock,
        environment,
      );

      const result = await dispatcher({
        queue,
        order: 0,
        attemptId: "attempt-shot-13",
        authorizeActivation: async () => {
          authorizationCalled = true;
        },
      });

      expect(result.status).toBe("activated");
      expect(authorizationCalled).toBe(true);
      expect(mouseEventsSent).toEqual([
        { type: "mousePressed", x: 500, y: 300 },
        { type: "mouseReleased", x: 500, y: 300 },
      ]);
    });

    it("a one-character difference must block and accurately report mismatch diagnostics", async () => {
      const { repositories, queue, clock, promptHash } =
        await createTestQueueFixture();
      // Single character truncated at the end
      const oneCharShort = promptShot13.slice(0, -1);
      const { environment, mouseEventsSent } = createMockEnvironment({
        inDispatchSampleText: oneCharShort,
        laterDiagnosticText: oneCharShort,
      });

      let authorizationCalled = false;
      const dispatcher = createFlowTimedQueueDispatcher(
        repositories,
        () => clock,
        environment,
      );

      const result = await dispatcher({
        queue,
        order: 0,
        attemptId: "attempt-shot-13",
        authorizeActivation: async () => {
          authorizationCalled = true;
        },
      });

      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("editor_exact_readback_mismatch");
      expect(authorizationCalled).toBe(false);
      expect(mouseEventsSent).toHaveLength(0);

      // Diagnostic must reflect the single-character length mismatch
      const diag = (result as { diagnostic?: Record<string, unknown> })
        .diagnostic;
      expect(diag).toBeDefined();
      expect(diag?.expectedCodeUnits).toBe(promptShot13.length);
      expect(diag?.actualCodeUnits).toBe(promptShot13.length - 1);
      expect(diag?.expectedSha256).toBe(promptHash);
      expect(diag?.actualSha256).toBe(await sha256Hex(oneCharShort));
      expect(diag?.firstDifferenceOffset).toBe(promptShot13.length - 1);
      expect(diag?.mismatchCategory).toBe("length");
    });

    it("DOM/button replacement between CDP round trips must block without dispatching mouse events", async () => {
      const { repositories, queue, clock } = await createTestQueueFixture();
      const { environment, mouseEventsSent } = createMockEnvironment({
        inDispatchSampleText: promptShot13,
        buttonReplaced: true, // Simulates DOM replacement between inspectTimedFlowGenerate and inspectFlowImageButton
      });

      let authorizationCalled = false;
      const dispatcher = createFlowTimedQueueDispatcher(
        repositories,
        () => clock,
        environment,
      );

      const result = await dispatcher({
        queue,
        order: 0,
        attemptId: "attempt-shot-13",
        authorizeActivation: async () => {
          authorizationCalled = true;
        },
      });

      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("generate_control_not_enabled");
      expect(authorizationCalled).toBe(false);
      expect(mouseEventsSent).toHaveLength(0);
    });

    it("first sample mismatches but a later diagnostic sample matches: reports samples separately and does not bypass exact equality", async () => {
      const { repositories, queue, clock, promptHash } =
        await createTestQueueFixture();
      // First sample (in-dispatch evaluation): truncated / transient 1-char difference
      const transientMismatch = promptShot13.slice(0, -1);
      // Later sample (readCurrentFlowEditorText): settled and exactly matches
      const settledMatch = promptShot13;

      const { environment, mouseEventsSent } = createMockEnvironment({
        inDispatchSampleText: transientMismatch,
        laterDiagnosticText: settledMatch,
      });

      let authorizationCalled = false;
      const dispatcher = createFlowTimedQueueDispatcher(
        repositories,
        () => clock,
        environment,
      );

      const result = await dispatcher({
        queue,
        order: 0,
        attemptId: "attempt-shot-13",
        authorizeActivation: async () => {
          authorizationCalled = true;
        },
      });

      // 1. Exact equality is NOT bypassed merely because the later sample matches
      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("editor_exact_readback_mismatch");
      expect(authorizationCalled).toBe(false);
      expect(mouseEventsSent).toHaveLength(0);

      // 2. Samples are reported separately rather than implying one contradictory comparison
      const diag = (result as { diagnostic?: Record<string, unknown> })
        .diagnostic;
      expect(diag).toBeDefined();

      // Sample 1 (the sample that caused the block)
      expect(diag?.expectedCodeUnits).toBe(promptShot13.length);
      expect(diag?.actualCodeUnits).toBe(promptShot13.length - 1);
      expect(diag?.expectedSha256).toBe(promptHash);
      expect(diag?.actualSha256).toBe(await sha256Hex(transientMismatch));
      expect(diag?.firstDifferenceOffset).toBe(promptShot13.length - 1);
      expect(diag?.mismatchCategory).toBe("length");

      // Sample 2 (settled diagnostic sample, recorded separately)
      expect(diag?.settledEqual).toBe(true);
      expect(diag?.settledActualCodeUnits).toBe(promptShot13.length);
      expect(diag?.settledActualSha256).toBe(promptHash);
      expect(diag?.settledDifferenceOffset).toBeUndefined();
    });

    it("disabled button with matching text blocks as generate_disabled without falsely claiming readback mismatch", async () => {
      const { repositories, queue, clock } = await createTestQueueFixture();
      const { environment, mouseEventsSent } = createMockEnvironment({
        inDispatchSampleText: promptShot13,
        generateState: "disabled",
      });

      let authorizationCalled = false;
      const dispatcher = createFlowTimedQueueDispatcher(
        repositories,
        () => clock,
        environment,
      );

      const result = await dispatcher({
        queue,
        order: 0,
        attemptId: "attempt-shot-13",
        authorizeActivation: async () => {
          authorizationCalled = true;
        },
      });

      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("generate_disabled");
      expect(authorizationCalled).toBe(false);
      expect(mouseEventsSent).toHaveLength(0);
      expect((result as { diagnostic?: unknown }).diagnostic).toBeUndefined();
    });
  });
});
