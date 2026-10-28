import { enterFlowPrompt } from "../../platforms/flow/promptEntry";
import type {
  FlowPromptEntryPort,
  FlowPromptEntryResult,
} from "../../platforms/flow/promptEntry";
import type { ExtensionRepositories } from "../../storage/repositories";
import { flowTabFromUrl } from "../../platforms/flow/connection";
import { sameFlowDocument } from "../../platforms/flow/connection";
import {
  activateFlowImageGenerate,
  captureFlowDocumentBinding,
  inspectFlowImageButton,
  inspectFlowImageGenerate,
  readFlowDocumentBinding,
  recheckFlowImageGenerate,
  type FlowDocumentBinding,
  type FlowGenerateDiscovery,
} from "../../platforms/flow/images";
import {
  flowImageAttemptActiveKey,
  type FlowImageAttemptRecord,
} from "../../domain/jobs/attempt";
import { flowImagePromptSnapshotId } from "../../domain/batches/flowImagePromptSnapshot";
import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import {
  ActiveFlowImageAttemptError,
  DuplicateFlowImageConfirmationError,
  FlowImageAttemptTransitionError,
  FlowImagePromptSnapshotConflictError,
  sha256Hex,
} from "../../storage/repositories";
import type { ProviderTab } from "../../platforms/shared/contracts";

type FlowSettingsConfirmation = {
  confirmationId: string;
  confirmedAt: number;
  tabId: number;
  projectId: string;
  canonicalTarget: string;
};

export type FlowImageGenerateOncePort = FlowPromptEntryPort & {
  captureFrame: (tabId: number) => Promise<FlowDocumentBinding>;
  readFrame: (tabId: number) => Promise<FlowDocumentBinding | undefined>;
  inspectGenerate: (
    tabId: number,
    prompt: string,
  ) => Promise<FlowGenerateDiscovery>;
  recheckGenerate: (
    tabId: number,
    prompt: string,
    frame: FlowDocumentBinding,
    buttonObjectId: string,
    baseline: NonNullable<FlowGenerateDiscovery["baseline"]>,
  ) => Promise<boolean>;
  buttonPosition: (
    tabId: number,
    buttonObjectId: string,
  ) => Promise<{ x: number; y: number } | undefined>;
  activate: (
    tabId: number,
    position: { x: number; y: number },
  ) => Promise<{
    complete: boolean;
    pressAttempted: boolean;
    releaseAttempted: boolean;
  }>;
};

export function createChromeFlowImageGenerateOncePort(
  repositories: ExtensionRepositories,
): FlowImageGenerateOncePort {
  const base = createChromeFlowPromptEntryPort(repositories);
  return {
    ...base,
    captureFrame: (tabId) => captureFlowDocumentBinding(base, tabId),
    readFrame: (tabId) => readFlowDocumentBinding(base, tabId),
    inspectGenerate: (tabId, prompt) =>
      inspectFlowImageGenerate(base, tabId, prompt),
    recheckGenerate: (tabId, prompt, frame, button, baseline) =>
      recheckFlowImageGenerate(base, tabId, prompt, frame, button, baseline),
    buttonPosition: (tabId, button) =>
      inspectFlowImageButton(base, tabId, button),
    activate: (tabId, position) =>
      activateFlowImageGenerate(base, tabId, position.x, position.y),
  };
}

type FlowImageGenerateOnceInput = {
  workspaceId: string;
  promptHash: string;
  settingsConfirmation: FlowSettingsConfirmation;
};

type FlowImageGenerateOnceDependencies = {
  repositories: ExtensionRepositories;
  port: FlowImageGenerateOncePort;
  fillPrompt: (
    sourceText: string,
    expectedFrame: FlowDocumentBinding,
  ) => Promise<{
    fillVerified: boolean;
    settledMatch?: boolean;
    stableReadback?: boolean;
    inputMethod: "CDP Input.insertText" | "none";
    outcome: string;
    code: string;
  }>;
  now?: () => number;
  createAttemptId?: () => string;
};

type FlowImageGenerateOnceResult = {
  state: "dispatched" | "failed-before-dispatch" | "uncertain" | "blocked";
  attemptId?: string;
  code: string;
  message: string;
  pressAttempted: boolean;
  releaseAttempted: boolean;
  activationCount: number;
  generationAvailable: true;
};

export function createFlowImageGenerateOnce(
  dependencies: FlowImageGenerateOnceDependencies,
): (input: FlowImageGenerateOnceInput) => Promise<FlowImageGenerateOnceResult> {
  return async (input) => {
    const now = dependencies.now ?? Date.now;
    const makeId = dependencies.createAttemptId ?? (() => crypto.randomUUID());
    const port = dependencies.port;
    let attempt: FlowImageAttemptRecord | undefined;
    let attached = false;
    let attachedTabId: number | undefined;
    let activationStarted = false;
    let pressAttempted = false;
    let releaseAttempted = false;

    const response = (
      state: FlowImageGenerateOnceResult["state"],
      code: string,
      message: string,
    ): FlowImageGenerateOnceResult => ({
      state,
      ...(attempt ? { attemptId: attempt.attemptId } : {}),
      code,
      message,
      pressAttempted,
      releaseAttempted,
      activationCount: pressAttempted ? 1 : 0,
      generationAvailable: true,
    });

    const failBefore = async (
      code: string,
      message: string,
    ): Promise<FlowImageGenerateOnceResult> => {
      if (attempt && !activationStarted) {
        const expected = attempt.state;
        if (
          expected === "preparing" ||
          expected === "verified" ||
          expected === "dispatch-intent"
        ) {
          try {
            attempt =
              await dependencies.repositories.transitionFlowImageAttempt({
                attemptId: attempt.attemptId,
                expected,
                next: "failed-before-dispatch",
                event: { stage: "dispatch", at: now(), method: "none", code },
              });
          } catch {
            // Keeping an active persisted state blocks replay if storage failed.
          }
        }
      }
      return response("failed-before-dispatch", code, message);
    };

    const markUncertain = async (code: string) => {
      if (!attempt || attempt.state !== "dispatch-intent") return;
      try {
        attempt = await dependencies.repositories.transitionFlowImageAttempt({
          attemptId: attempt.attemptId,
          expected: "dispatch-intent",
          next: "uncertain",
          event: {
            stage: "dispatch",
            at: now(),
            method: "CDP Input.dispatchMouseEvent",
            code,
          },
        });
      } catch {
        // The durable dispatch-intent remains active and restart reconciliation
        // will move it to uncertain. It can never authorize replay.
      }
    };

    try {
      if (!port.hasRequiredApis() || !(await port.hasDebuggerPermission())) {
        return response(
          "blocked",
          "debugger_permission_missing",
          "Required debugger access is unavailable. Generate was not activated.",
        );
      }
      const selected = await port.getSelection();
      if (!selected || selected.tabId < 0) {
        return response(
          "blocked",
          "flow_target_missing",
          "Select a Flow project before generating.",
        );
      }
      const selectedRecord =
        await dependencies.repositories.getSelectedTarget("Flow");
      if (
        !selectedRecord ||
        selectedRecord.tabId !== selected.tabId ||
        selectedRecord.canonicalTarget !== selected.canonicalTarget
      ) {
        return response(
          "blocked",
          "flow_target_changed",
          "The selected Flow target changed. Reconfirm settings before generating.",
        );
      }
      const tab = await port.getTab(selected.tabId);
      const target = flowTabFromUrl(selected.tabId, tab?.title ?? "", tab?.url);
      if (
        !tab ||
        !target ||
        target.canonicalTarget !== selected.canonicalTarget
      ) {
        return response(
          "blocked",
          "flow_document_changed",
          "The selected Flow document no longer matches the saved project.",
        );
      }
      if (
        input.settingsConfirmation.tabId !== target.id ||
        input.settingsConfirmation.projectId !== target.projectId ||
        input.settingsConfirmation.canonicalTarget !== target.canonicalTarget ||
        input.settingsConfirmation.confirmedAt > now()
      ) {
        return response(
          "blocked",
          "settings_confirmation_stale",
          "Confirm manual image settings again for the currently selected Flow project.",
        );
      }
      const snapshot = await dependencies.repositories.getPromptBatch(
        input.workspaceId,
        "image",
      );
      if (!snapshot || snapshot.items.length !== 1) {
        return response(
          "blocked",
          "single_saved_prompt_required",
          "Save one validated image prompt before using Generate once.",
        );
      }
      const item = snapshot.items[0]!;
      if (
        item.workspaceId !== input.workspaceId ||
        item.kind !== "image" ||
        item.contentHash !== input.promptHash ||
        item.rawJsonBody.length !== item.measurement.stringCodeUnits ||
        (await sha256Hex(item.rawJsonBody)) !== input.promptHash
      ) {
        return response(
          "blocked",
          "saved_prompt_changed",
          "The current validated prompt does not match the saved prompt. Save and validate it again.",
        );
      }
      const frame = await port.captureFrame(target.id);
      const frameTarget = flowTabFromUrl(target.id, "", frame.url);
      if (
        !frameTarget ||
        frameTarget.canonicalTarget !== selected.canonicalTarget
      ) {
        return response(
          "blocked",
          "frame_target_changed",
          "The selected tab's browser document does not match the chosen Flow project.",
        );
      }
      if (!(await currentFlowTarget(port, selected, target))) {
        return response(
          "blocked",
          "document_binding_changed",
          "The selected Flow document changed during preparation.",
        );
      }
      const at = now();
      const sourceSnapshot = {
        snapshotId: flowImagePromptSnapshotId(item.id, item.contentHash),
        workspaceId: item.workspaceId,
        batchId: item.batchId,
        itemId: item.id,
        promptHash: item.contentHash,
        rawJsonBody: item.rawJsonBody,
        promptCodeUnits: item.measurement.stringCodeUnits,
        promptUtf8Bytes: item.measurement.utf8Bytes,
        createdAt: at,
      };
      try {
        attempt = await dependencies.repositories.createFlowImageAttempt({
          attemptId: makeId(),
          confirmationKey: input.settingsConfirmation.confirmationId,
          workspaceId: input.workspaceId,
          batchId: snapshot.batch.id,
          itemId: item.id,
          ...(item.shotId ? { shotId: item.shotId } : {}),
          promptHash: item.contentHash,
          sourceSnapshot,
          promptCodeUnits: item.measurement.stringCodeUnits,
          promptUtf8Bytes: item.measurement.utf8Bytes,
          provider: "Flow",
          projectId: target.projectId,
          tabId: target.id,
          frameId: frame.frameId,
          loaderId: frame.loaderId,
          buildId: BUILD_ID,
          protocolVersion: PROTOCOL_VERSION,
          settingsConfirmation: {
            confirmationId: input.settingsConfirmation.confirmationId,
            confirmedAt: input.settingsConfirmation.confirmedAt,
            userAttested: true,
            tabId: input.settingsConfirmation.tabId,
            projectId: input.settingsConfirmation.projectId,
            canonicalTarget: input.settingsConfirmation.canonicalTarget,
          },
          state: "preparing",
          activeKey: flowImageAttemptActiveKey(item.id),
          events: [
            {
              stage: "preparation",
              at,
              method: "none",
              code: "preparation_persisted",
            },
          ],
          createdAt: at,
          updatedAt: at,
        });
      } catch (error) {
        if (error instanceof ActiveFlowImageAttemptError) {
          return response(
            "blocked",
            "attempt_already_active",
            "This image prompt already has an active, dispatched, or uncertain attempt. It will not be replayed.",
          );
        }
        if (error instanceof DuplicateFlowImageConfirmationError) {
          return response(
            "blocked",
            "duplicate_generate_click",
            "This settings confirmation was already used. Reconfirm settings before another attempt.",
          );
        }
        if (error instanceof FlowImagePromptSnapshotConflictError) {
          return response(
            "blocked",
            "source_snapshot_conflict",
            "The immutable saved-prompt snapshot conflicted with an existing revision. Generate was not activated.",
          );
        }
        return response(
          "blocked",
          "preparation_persist_failed",
          "The preparation intent could not be stored. Generate was not activated.",
        );
      }

      let promptSource: string;
      try {
        const persistedSource =
          await dependencies.repositories.getFlowImagePromptSnapshot(
            attempt.sourceSnapshotId,
          );
        if (
          !persistedSource ||
          persistedSource.snapshotId !== attempt.sourceSnapshotId ||
          persistedSource.workspaceId !== attempt.workspaceId ||
          persistedSource.batchId !== attempt.batchId ||
          persistedSource.itemId !== attempt.itemId ||
          persistedSource.promptHash !== attempt.promptHash ||
          persistedSource.promptCodeUnits !== attempt.promptCodeUnits ||
          persistedSource.promptUtf8Bytes !== attempt.promptUtf8Bytes ||
          persistedSource.rawJsonBody !== item.rawJsonBody ||
          (await sha256Hex(persistedSource.rawJsonBody)) !== attempt.promptHash
        ) {
          return failBefore(
            "source_snapshot_mismatch",
            "The immutable saved-prompt snapshot is missing or mismatched. Generate was not activated.",
          );
        }
        promptSource = persistedSource.rawJsonBody;
      } catch {
        return failBefore(
          "source_snapshot_unavailable",
          "The immutable saved-prompt snapshot could not be verified. Generate was not activated.",
        );
      }

      const filled = await dependencies.fillPrompt(promptSource, frame);
      if (
        !filled.fillVerified ||
        !filled.settledMatch ||
        !filled.stableReadback
      ) {
        return failBefore(
          filled.code || "prompt_readback_unverified",
          "Exact settled prompt readback was not verified. Generate was not activated; inspect the editor before continuing.",
        );
      }
      attempt = await dependencies.repositories.transitionFlowImageAttempt({
        attemptId: attempt.attemptId,
        expected: "preparing",
        next: "verified",
        event: {
          stage: "verification",
          at: now(),
          method: filled.inputMethod,
          code: "exact_settled_readback",
        },
      });

      await port.attach(target.id);
      attached = true;
      attachedTabId = target.id;
      await port.sendCommand(target.id, "Page.enable");
      await port.sendCommand(target.id, "Runtime.enable");
      if (!(await currentFlowBinding(port, selected, target, frame))) {
        return failBefore(
          "document_binding_changed",
          "The selected Flow document changed after prompt verification. Generate was not activated.",
        );
      }
      const discovery = await port.inspectGenerate(target.id, promptSource);
      const preflightError = discoveryFailure(discovery);
      if (preflightError) {
        return failBefore(preflightError.code, preflightError.message);
      }
      const baseline = discovery.baseline!;
      const buttonId = discovery.buttonObjectId!;
      if (!(await currentFlowBinding(port, selected, target, frame))) {
        return failBefore(
          "document_binding_changed",
          "The selected Flow document changed during final preflight. Generate was not activated.",
        );
      }
      if (
        !(await port.recheckGenerate(
          target.id,
          promptSource,
          frame,
          buttonId,
          baseline,
        ))
      ) {
        return failBefore(
          "final_preflight_changed",
          "Prompt readback, Generate control, or observation baseline changed. Generate was not activated.",
        );
      }
      const position = await port.buttonPosition(target.id, buttonId);
      if (
        !position ||
        !(await currentFlowBinding(port, selected, target, frame))
      ) {
        return failBefore(
          "generate_binding_lost",
          "The verified Generate control or document binding was lost. Generate was not activated.",
        );
      }

      attempt = await dependencies.repositories.transitionFlowImageAttempt({
        attemptId: attempt.attemptId,
        expected: "verified",
        next: "dispatch-intent",
        event: {
          stage: "dispatch",
          at: now(),
          method: "none",
          code: "dispatch_intent_persisted",
        },
        baseline,
      });

      if (
        !(await currentFlowBinding(port, selected, target, frame)) ||
        !(await port.recheckGenerate(
          target.id,
          promptSource,
          frame,
          buttonId,
          baseline,
        ))
      ) {
        return failBefore(
          "post_intent_preflight_changed",
          "The final preflight changed after intent persistence. No Generate input was sent.",
        );
      }
      const finalPosition = await port.buttonPosition(target.id, buttonId);
      if (!finalPosition) {
        return failBefore(
          "generate_control_lost",
          "The Generate control was lost before activation. No Generate input was sent.",
        );
      }

      activationStarted = true;
      const activation = await port.activate(target.id, finalPosition);
      pressAttempted = activation.pressAttempted;
      releaseAttempted = activation.releaseAttempted;
      if (!activation.complete) {
        await markUncertain("activation_response_unknown");
        return response(
          "uncertain",
          "activation_response_unknown",
          "Generate input may have partially completed. The attempt is preserved as uncertain and will not be replayed.",
        );
      }
      try {
        attempt = await dependencies.repositories.transitionFlowImageAttempt({
          attemptId: attempt.attemptId,
          expected: "dispatch-intent",
          next: "dispatched",
          event: {
            stage: "dispatch",
            at: now(),
            method: "CDP Input.dispatchMouseEvent",
            code: "activation_pair_sent",
          },
        });
      } catch {
        await markUncertain("post_dispatch_persistence_failed");
        return response(
          "uncertain",
          "post_dispatch_persistence_failed",
          "Generate input was sent, but its dispatched state could not be saved. The attempt remains blocked from replay.",
        );
      }
      return response(
        "dispatched",
        "activation_pair_sent",
        "One Generate activation pair was dispatched. Provider acceptance and results are not verified.",
      );
    } catch (error) {
      if (activationStarted) {
        await markUncertain("activation_result_unknown");
        return response(
          "uncertain",
          "activation_result_unknown",
          "Generate delivery is uncertain. The attempt will not be replayed.",
        );
      }
      return failBefore(
        error instanceof FlowImageAttemptTransitionError
          ? "attempt_transition_failed"
          : "pre_dispatch_failed",
        "A pre-dispatch check or storage operation failed. Generate was not activated.",
      );
    } finally {
      if (attached) {
        await port.detach(attachedTabId!).catch(() => undefined);
      }
    }
  };
}

async function currentFlowBinding(
  port: FlowImageGenerateOncePort,
  selected: { tabId: number; canonicalTarget: string },
  target: ProviderTab,
  frame: FlowDocumentBinding,
): Promise<boolean> {
  if (!(await currentFlowTarget(port, selected, target))) return false;
  const liveFrame = await port.readFrame(target.id);
  return Boolean(
    liveFrame?.frameId === frame.frameId &&
    liveFrame.loaderId === frame.loaderId &&
    flowTabFromUrl(target.id, "", liveFrame.url)?.canonicalTarget ===
      selected.canonicalTarget,
  );
}

async function currentFlowTarget(
  port: FlowImageGenerateOncePort,
  selected: { tabId: number; canonicalTarget: string },
  target: ProviderTab,
): Promise<boolean> {
  const selection = await port.getSelection();
  if (
    selection?.tabId !== target.id ||
    selection.canonicalTarget !== selected.canonicalTarget
  ) {
    return false;
  }
  const current = await port.getTab(target.id);
  const parsed = flowTabFromUrl(target.id, current?.title ?? "", current?.url);
  if (
    !sameFlowDocument(target, parsed) ||
    parsed.canonicalTarget !== selected.canonicalTarget
  ) {
    return false;
  }
  return true;
}

function discoveryFailure(
  discovery: FlowGenerateDiscovery,
): { code: string; message: string } | undefined {
  if (discovery.composer !== "identified") {
    return {
      code: `composer_${discovery.composer}`,
      message:
        "A unique supported image composer was not verified. Generate was not activated.",
    };
  }
  if (!discovery.exactPrompt) {
    return {
      code: "prompt_readback_mismatch",
      message:
        "The prompt no longer matches the exact saved source. Generate was not activated.",
    };
  }
  if (discovery.generate !== "identified") {
    return {
      code: `generate_${discovery.generate}`,
      message:
        "A unique enabled Generate control was not verified in the image composer.",
    };
  }
  if (discovery.observation !== "ready" || !discovery.baseline) {
    return {
      code: `observation_${discovery.observation}`,
      message:
        "Pre-dispatch results observation is unavailable or ambiguous. Generate was not activated.",
    };
  }
  if (!discovery.buttonObjectId) {
    return {
      code: "generate_binding_missing",
      message:
        "The verified Generate control could not be bound. Generate was not activated.",
    };
  }
  return undefined;
}

export function createChromeFlowPromptEntryPort(
  repositories: ExtensionRepositories,
): FlowPromptEntryPort {
  return {
    getSelection: async () => {
      const selected = await repositories.getSelectedTarget("Flow");
      return selected
        ? { tabId: selected.tabId, canonicalTarget: selected.canonicalTarget }
        : undefined;
    },
    getTab: async (tabId) => {
      const tab = await chrome.tabs.get(tabId);
      return flowTabFromUrl(tabId, tab.title ?? "", tab.url);
    },
    hasRequiredApis: () =>
      typeof chrome !== "undefined" &&
      typeof chrome.tabs?.get === "function" &&
      typeof chrome.debugger?.attach === "function" &&
      typeof chrome.debugger?.sendCommand === "function" &&
      typeof chrome.debugger?.detach === "function",
    hasDebuggerPermission: async () => {
      if (typeof chrome === "undefined" || !chrome.permissions?.contains) {
        return false;
      }
      return chrome.permissions.contains({ permissions: ["debugger", "tabs"] });
    },
    attach: (tabId) => chrome.debugger.attach({ tabId }, "1.3"),
    sendCommand: (tabId, method, params) =>
      chrome.debugger.sendCommand({ tabId }, method, params),
    detach: async (tabId) => {
      if (chrome.debugger.getTargets) {
        const targets = await chrome.debugger.getTargets();
        if (
          !targets.some((target) => target.tabId === tabId && target.attached)
        ) {
          return;
        }
      }
      await chrome.debugger.detach({ tabId });
    },
  };
}

export function createFlowPromptEntry(
  port: FlowPromptEntryPort,
): (
  sourceText: string,
  expectedFrame?: FlowDocumentBinding,
) => Promise<FlowPromptEntryResult> {
  return async (sourceText, expectedFrame) => {
    // The selected tab ID is explicit metadata. A fresh route and CDP frame
    // identity are checked by enterFlowPrompt before input and readback.
    return enterFlowPrompt(
      sourceText,
      expectedFrame ? { ...port, expectedFrame } : port,
    );
  };
}

export function createFlowImageGenerateOnceForWorker(
  repositories: ExtensionRepositories,
): (input: FlowImageGenerateOnceInput) => Promise<FlowImageGenerateOnceResult> {
  const port = createChromeFlowImageGenerateOncePort(repositories);
  return createFlowImageGenerateOnce({
    repositories,
    port,
    fillPrompt: createFlowPromptEntry(port),
  });
}
