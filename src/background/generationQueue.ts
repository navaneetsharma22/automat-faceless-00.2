import { sha256Hex, ImageQueueEligibilityError } from "../storage/repositories";
import type { ExtensionRepositories } from "../storage/repositories";
import {
  createChromeFlowImageGenerateOncePort,
  createChromeFlowPromptEntryPort,
} from "./handlers/flow";
import { enterFlowPrompt } from "../platforms/flow/promptEntry";
import {
  activateFlowImageGenerate,
  inspectFlowImageButton,
  inspectTimedFlowGenerate,
  readCurrentFlowEditorText,
} from "../platforms/flow/images";
import { flowTabFromUrl } from "../platforms/flow/connection";
import { BUILD_ID, PROTOCOL_VERSION } from "../shared/buildInfo";
import type { TimedQueueDispatcher } from "./scheduler";
import type { FlowPromptEntryPort } from "../platforms/flow/promptEntry";
import type {
  FlowDebuggerLease,
  FlowImageGenerateOncePort,
} from "./handlers/flow";
import type { FailureCategory } from "../shared/schemas";
import {
  comparePromptReadbackSafely,
  type FlowEditorReadbackInspectionResult,
  type PromptReadbackDiagnostic,
} from "../domain/jobs/queue";

export type InspectionFailureStage =
  | "request_validation"
  | "queue_lookup"
  | "target_verification"
  | "debugger_lease"
  | "editor_readback"
  | "response_validation";

export class ImageQueueInspectionError extends ImageQueueEligibilityError {
  constructor(
    readonly stage: InspectionFailureStage,
    code: string,
    message: string,
    readonly category: FailureCategory = "worker_error",
    cause?: unknown,
  ) {
    super(code);
    this.name = "ImageQueueInspectionError";
    this.message = message;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export type FlowTimedDispatchEnvironment = {
  promptPort: FlowPromptEntryPort;
  pagePort: FlowImageGenerateOncePort;
  getTab: (
    tabId: number,
  ) => Promise<{ id: number; title?: string; url?: string }>;
  getDocument: (
    tabId: number,
  ) => Promise<
    { documentId?: string; frameId?: number; result?: string } | undefined
  >;
};

export function createFlowTimedQueueDispatcher(
  repositories: ExtensionRepositories,
  now: () => number = Date.now,
  environment?: FlowTimedDispatchEnvironment,
): TimedQueueDispatcher {
  const promptPort =
    environment?.promptPort ?? createChromeFlowPromptEntryPort(repositories);
  const pagePort =
    environment?.pagePort ??
    createChromeFlowImageGenerateOncePort(repositories);
  return async ({ queue, order, attemptId, authorizeActivation }) => {
    let activationAttempted = false;
    let lease:
      | Awaited<ReturnType<NonNullable<typeof pagePort.acquireDebuggerLease>>>
      | undefined;
    try {
      const item = queue.items[order];
      if (
        !item ||
        item.itemState !== "sending" ||
        item.dispatchIntent?.attemptId !== attemptId
      )
        return {
          status: "blocked",
          reason: "dispatch_intent_mismatch",
          uncertain: false,
        };
      if ((await sha256Hex(item.rawJsonBody)) !== item.promptHash)
        return {
          status: "blocked",
          reason: "source_hash_mismatch",
          uncertain: false,
        };
      const selected = await repositories.getSelectedTarget("Flow");
      const confirmation = queue.manualSettingsDeclaration;
      const binding = selected?.verificationBinding;
      if (
        !selected ||
        selected.provider !== "Flow" ||
        selected.tabId !== queue.selectedProject.tabId ||
        selected.canonicalTarget !== queue.selectedProject.canonicalTarget ||
        selected.verification !== "verified" ||
        selected.connectionState !== "verified" ||
        selected.reconnectEnabled === false ||
        !binding ||
        binding.tabId !== selected.tabId ||
        binding.canonicalTarget !== selected.canonicalTarget ||
        binding.projectId !== queue.selectedProject.projectId ||
        binding.extensionBuildId !== BUILD_ID ||
        binding.connectorBuildId !== BUILD_ID ||
        binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
        binding.connectorProtocolVersion !== 1 ||
        confirmation.tabId !== selected.tabId ||
        confirmation.projectId !== binding.projectId ||
        confirmation.canonicalTarget !== selected.canonicalTarget
      )
        return {
          status: "blocked",
          reason: "selected_project_or_connection_changed",
          uncertain: false,
        };
      const tab = await (environment?.getTab(selected.tabId) ??
        chrome.tabs.get(selected.tabId));
      const parsedTab = flowTabFromUrl(
        selected.tabId,
        tab.title ?? "",
        tab.url,
      );
      if (!parsedTab || parsedTab.canonicalTarget !== selected.canonicalTarget)
        return {
          status: "blocked",
          reason: "selected_tab_project_mismatch",
          uncertain: false,
        };
      const document = environment
        ? await environment.getDocument(selected.tabId)
        : (
            await chrome.scripting.executeScript({
              target: { tabId: selected.tabId, frameIds: [0] },
              func: () => location.href,
            })
          )[0];
      if (
        !document?.documentId ||
        document.frameId !== 0 ||
        document.documentId !== binding.documentId ||
        flowTabFromUrl(selected.tabId, "", document.result as string)
          ?.canonicalTarget !== selected.canonicalTarget
      )
        return {
          status: "blocked",
          reason: "selected_document_changed",
          uncertain: false,
        };

      const owner = `timed-image-queue:${queue.queueId}:${order}`;
      lease = await pagePort.acquireDebuggerLease!(selected.tabId, owner);
      await pagePort.sendCommand(selected.tabId, "Page.enable");
      await pagePort.sendCommand(selected.tabId, "Runtime.enable");
      const frame = await pagePort.readFrame(selected.tabId, lease);
      if (!frame)
        return {
          status: "blocked",
          reason: "frame_binding_unavailable",
          uncertain: false,
        };
      if (
        frame.documentId !== binding.documentId ||
        frame.senderFrameId !== 0 ||
        flowTabFromUrl(selected.tabId, "", frame.url)?.canonicalTarget !==
          selected.canonicalTarget
      )
        return {
          status: "blocked",
          reason: "frame_binding_changed",
          uncertain: false,
        };
      // The acquired lease serializes this complete operation and proves debugger
      // ownership. Prompt-entry reuses it through the scoped adapter; it does not
      // attach, borrow, or detach another owner's session.
      const leasedPromptPort = {
        ...promptPort,
        attach: async () => undefined,
        detach: async () => undefined,
        sendCommand: (tabId: number, method: string, params?: object) =>
          pagePort.sendCommand(tabId, method, params),
        expectedFrame: { frameId: frame.frameId, loaderId: frame.loaderId },
      };
      const fill = await enterFlowPrompt(item.rawJsonBody, leasedPromptPort);
      if (
        !fill.fillVerified ||
        !fill.immediateMatch ||
        !fill.settledMatch ||
        !fill.stableReadback
      )
        return {
          status: "blocked",
          reason: fill.code || "exact_editor_readback_failed",
          uncertain: false,
        };

      const afterFill = environment
        ? await environment.getDocument(selected.tabId)
        : (
            await chrome.scripting.executeScript({
              target: { tabId: selected.tabId, frameIds: [0] },
              func: () => location.href,
            })
          )[0];
      if (
        afterFill?.documentId !== binding.documentId ||
        afterFill?.frameId !== 0
      )
        return {
          status: "blocked",
          reason: "document_changed_after_fill",
          uncertain: false,
        };
      const freshFrame = await pagePort.readFrame(selected.tabId, lease);
      if (
        !freshFrame ||
        freshFrame.frameId !== frame.frameId ||
        freshFrame.loaderId !== frame.loaderId ||
        freshFrame.documentId !== binding.documentId ||
        freshFrame.senderFrameId !== 0
      )
        return {
          status: "blocked",
          reason: "frame_binding_changed_before_dispatch",
          uncertain: false,
        };
      const inspection = await inspectTimedFlowGenerate(
        pagePort,
        selected.tabId,
        item.rawJsonBody,
      );
      if (
        !inspection.exactPrompt ||
        inspection.generate !== "identified" ||
        !inspection.buttonObjectId
      ) {
        if (!inspection.exactPrompt) {
          let diagnostic: PromptReadbackDiagnostic | undefined;
          try {
            const editorRead = await readCurrentFlowEditorText(
              pagePort,
              selected.tabId,
            );
            if (editorRead.text !== undefined) {
              const comparison = await comparePromptReadbackSafely({
                expectedText: item.rawJsonBody,
                actualText: editorRead.text,
                expectedSha256: item.promptHash,
              });
              diagnostic = {
                queueId: queue.queueId,
                queueItemId: item.queueItemId,
                order,
                ...(item.shotId ? { shotId: item.shotId } : {}),
                stage: "pre_activation_inspection",
                recordedAt: now(),
                expectedCodeUnits: comparison.expectedCodeUnits,
                actualCodeUnits: comparison.actualCodeUnits,
                expectedUtf8Bytes: comparison.expectedUtf8Bytes,
                actualUtf8Bytes: comparison.actualUtf8Bytes,
                expectedSha256: comparison.expectedSha256,
                actualSha256: comparison.actualSha256,
                firstDifferenceOffset: comparison.firstDifferenceOffset,
                mismatchCategory: comparison.mismatchCategory,
                expectedContext: comparison.expectedContext,
                actualContext: comparison.actualContext,
              };
            } else {
              diagnostic = {
                queueId: queue.queueId,
                queueItemId: item.queueItemId,
                order,
                ...(item.shotId ? { shotId: item.shotId } : {}),
                stage: "pre_activation_inspection",
                recordedAt: now(),
                expectedCodeUnits: item.rawJsonBody.length,
                expectedUtf8Bytes: new TextEncoder().encode(item.rawJsonBody)
                  .byteLength,
                expectedSha256: item.promptHash,
                readError:
                  editorRead.error ??
                  (editorRead.found ? "empty_editor_read" : "editor_not_found"),
              };
            }
          } catch {
            // Diagnostic failure must not mask the mismatch or allow activation
          }
          return {
            status: "blocked",
            reason: "editor_exact_readback_mismatch",
            uncertain: false,
            diagnostic,
          };
        }
        return {
          status: "blocked",
          reason: `generate_${inspection.generate}`,
          uncertain: false,
        };
      }
      const position = await inspectFlowImageButton(
        pagePort,
        selected.tabId,
        inspection.buttonObjectId,
      );
      if (!position)
        return {
          status: "blocked",
          reason: "generate_control_not_enabled",
          uncertain: false,
        };
      const lastFrame = await pagePort.readFrame(selected.tabId, lease);
      if (
        !lastFrame ||
        lastFrame.frameId !== frame.frameId ||
        lastFrame.loaderId !== frame.loaderId ||
        lastFrame.documentId !== binding.documentId
      )
        return {
          status: "blocked",
          reason: "binding_changed_at_activation",
          uncertain: false,
        };
      await authorizeActivation();
      activationAttempted = true;
      const activation = await activateFlowImageGenerate(
        pagePort,
        selected.tabId,
        position.x,
        position.y,
      );
      if (
        !activation.complete ||
        !activation.pressAttempted ||
        !activation.releaseAttempted
      )
        return {
          status: "blocked",
          reason: "activation_evidence_uncertain",
          uncertain: true,
        };
      return { status: "activated", at: now() };
    } catch {
      return {
        status: "blocked",
        reason: activationAttempted
          ? "activation_evidence_uncertain"
          : "timed_dispatch_preflight_failed",
        uncertain: activationAttempted,
      };
    } finally {
      if (lease)
        await pagePort.releaseDebuggerLease?.(lease).catch(() => undefined);
    }
  };
}

export type { FlowEditorReadbackInspectionResult } from "../domain/jobs/queue";

/** Explicit read-only inspection that compares the current Flow editor
 * with a blocked timed queue item without inserting text, activating Generate,
 * mutating queue state, or authorizing replay. */
export async function inspectFlowEditorAgainstQueueItem(input: {
  repositories: ExtensionRepositories;
  queueId: string;
  order?: number;
  now?: () => number;
  environment?: Pick<
    FlowTimedDispatchEnvironment,
    "pagePort" | "getTab" | "getDocument"
  >;
}): Promise<FlowEditorReadbackInspectionResult> {
  const now = input.now ?? Date.now;
  const queue = await input.repositories.getTimedImageSubmissionQueue(
    input.queueId,
  );
  if (!queue) {
    throw new ImageQueueInspectionError(
      "queue_lookup",
      "image_queue_not_found",
      "The requested timed queue was not found.",
      "not_found",
    );
  }
  const order =
    input.order !== undefined
      ? input.order
      : queue.items.findIndex((item) => item.itemState === "blocked");
  if (order < 0 || order >= queue.items.length) {
    throw new ImageQueueInspectionError(
      "queue_lookup",
      "image_queue_item_not_found",
      "The requested queue item was not found.",
      "not_found",
    );
  }
  const item = queue.items[order]!;

  const selected = await input.repositories.getSelectedTarget("Flow");
  const binding = selected?.verificationBinding;
  if (
    !selected ||
    selected.provider !== "Flow" ||
    selected.tabId !== queue.selectedProject.tabId ||
    selected.canonicalTarget !== queue.selectedProject.canonicalTarget ||
    !binding ||
    binding.tabId !== selected.tabId ||
    binding.canonicalTarget !== selected.canonicalTarget ||
    binding.projectId !== queue.selectedProject.projectId
  ) {
    throw new ImageQueueInspectionError(
      "target_verification",
      "selected_project_or_connection_changed",
      "The selected Flow target or project changed and no longer matches the queue.",
      "invalid_request",
    );
  }

  if (input.environment?.getTab) {
    const liveTab = await input.environment.getTab(selected.tabId);
    if (!liveTab) {
      throw new ImageQueueInspectionError(
        "target_verification",
        "selected_target_unavailable",
        "The target browser tab is closed or unavailable.",
        "invalid_request",
      );
    }
    if (liveTab.url) {
      const parsedTab = flowTabFromUrl(
        selected.tabId,
        liveTab.title ?? "",
        liveTab.url,
      );
      if (
        !parsedTab ||
        parsedTab.canonicalTarget !== selected.canonicalTarget
      ) {
        throw new ImageQueueInspectionError(
          "target_verification",
          "selected_project_or_connection_changed",
          "The target tab is no longer available or its project changed.",
          "invalid_request",
        );
      }
    }
  } else if (typeof chrome !== "undefined" && chrome.tabs?.get) {
    try {
      const tab = await chrome.tabs.get(selected.tabId);
      if (!tab) {
        throw new Error("target_tab_missing");
      }
    } catch (cause) {
      throw new ImageQueueInspectionError(
        "target_verification",
        "selected_target_unavailable",
        "The target browser tab is closed or unavailable.",
        "invalid_request",
        cause,
      );
    }
  }

  if (input.environment?.getDocument) {
    const doc = await input.environment.getDocument(selected.tabId);
    if (doc?.documentId && doc.documentId !== binding.documentId) {
      throw new ImageQueueInspectionError(
        "target_verification",
        "selected_document_project_mismatch",
        "The active browser document no longer matches the verified project binding.",
        "invalid_request",
      );
    }
  }

  const pagePort =
    input.environment?.pagePort ??
    createChromeFlowImageGenerateOncePort(input.repositories);

  let lease: FlowDebuggerLease | undefined;
  if (pagePort.acquireDebuggerLease) {
    try {
      lease = await pagePort.acquireDebuggerLease(
        selected.tabId,
        `timed-image-queue-inspect:${queue.queueId}:${order}`,
      );
    } catch (cause) {
      throw new ImageQueueInspectionError(
        "debugger_lease",
        "debugger_lease_acquisition_failed",
        "Debugger lease could not be acquired for read-only inspection.",
        "worker_error",
        cause,
      );
    }
  }

  try {
    let editorRead: { found: boolean; text?: string; error?: string };
    try {
      await pagePort
        .sendCommand(selected.tabId, "Page.enable")
        .catch(() => undefined);
      editorRead = await readCurrentFlowEditorText(pagePort, selected.tabId);
    } catch (cause) {
      throw new ImageQueueInspectionError(
        "editor_readback",
        "editor_readback_failed",
        "Failed to read editor text from target page.",
        "worker_error",
        cause,
      );
    }

    if (editorRead.text !== undefined) {
      const comparison = await comparePromptReadbackSafely({
        expectedText: item.rawJsonBody,
        actualText: editorRead.text,
        expectedSha256: item.promptHash,
      });
      return {
        queueId: queue.queueId,
        queueItemId: item.queueItemId,
        order,
        ...(item.shotId ? { shotId: item.shotId } : {}),
        stage: "read_only_editor_inspection",
        inspectedAt: now(),
        equal: comparison.equal,
        expectedCodeUnits: comparison.expectedCodeUnits,
        actualCodeUnits: comparison.actualCodeUnits,
        expectedUtf8Bytes: comparison.expectedUtf8Bytes,
        actualUtf8Bytes: comparison.actualUtf8Bytes,
        expectedSha256: comparison.expectedSha256,
        actualSha256: comparison.actualSha256,
        firstDifferenceOffset: comparison.firstDifferenceOffset,
        mismatchCategory: comparison.mismatchCategory,
        expectedContext: comparison.expectedContext,
        actualContext: comparison.actualContext,
      };
    }

    return {
      queueId: queue.queueId,
      queueItemId: item.queueItemId,
      order,
      ...(item.shotId ? { shotId: item.shotId } : {}),
      stage: "read_only_editor_inspection",
      inspectedAt: now(),
      equal: false,
      expectedCodeUnits: item.rawJsonBody.length,
      expectedUtf8Bytes: new TextEncoder().encode(item.rawJsonBody).byteLength,
      expectedSha256: item.promptHash,
      readError:
        editorRead.error ??
        (editorRead.found ? "empty_editor_read" : "editor_not_found"),
    };
  } finally {
    if (lease && pagePort.releaseDebuggerLease) {
      await pagePort.releaseDebuggerLease(lease).catch(() => undefined);
    }
  }
}
