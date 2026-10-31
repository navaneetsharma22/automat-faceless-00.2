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
import type { FlowImageGenerateOncePort } from "./handlers/flow";
import {
  comparePromptReadbackSafely,
  type PromptReadbackDiagnostic,
} from "../domain/jobs/queue";

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

export type FlowEditorReadbackInspectionResult = {
  queueId: string;
  queueItemId: string;
  order: number;
  shotId?: string;
  stage: "read_only_editor_inspection";
  inspectedAt: number;
  equal: boolean;
  expectedCodeUnits: number;
  actualCodeUnits?: number;
  expectedUtf8Bytes: number;
  actualUtf8Bytes?: number;
  expectedSha256: string;
  actualSha256?: string;
  firstDifferenceOffset?: number;
  mismatchCategory?: "length" | "code-unit" | "representation";
  expectedContext?: string;
  actualContext?: string;
  readError?: string;
};

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
    throw new ImageQueueEligibilityError("image_queue_not_found");
  }
  const order =
    input.order !== undefined
      ? input.order
      : queue.items.findIndex((item) => item.itemState === "blocked");
  if (order < 0 || order >= queue.items.length) {
    throw new ImageQueueEligibilityError("image_queue_item_not_found");
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
    throw new ImageQueueEligibilityError(
      "selected_project_or_connection_changed",
    );
  }

  const pagePort =
    input.environment?.pagePort ??
    createChromeFlowImageGenerateOncePort(input.repositories);

  const editorRead = await readCurrentFlowEditorText(pagePort, selected.tabId);

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
}
