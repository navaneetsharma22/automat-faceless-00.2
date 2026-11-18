import type { ExtensionRepositories } from "../../storage/repositories";
import type { FlowVideoAttachmentOperation } from "../../storage/db";
import {
  PreparedVideoBatchRecordSchema,
  VideoSettingsConfirmationSchema,
} from "../../shared/schemas";
import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import { CONNECTOR_PROTOCOL_VERSION } from "../../platforms/shared/contracts";
import { importPromptBatch } from "../../domain/batches/importBatch";
import { canonicalizeShotId } from "../../domain/batches/inputPolicy";
import { sha256Hex } from "../../domain/batches/hashPrompt";
import { sha256Bytes } from "../../domain/media/references";
import { ReferenceAssignmentRecordSchema } from "../../domain/media/references";
import { flowTabFromUrl } from "../../platforms/flow/connection";
import type {
  FlowPromptEntryPort,
  FlowPromptEntryResult,
  FrameIdentity,
} from "../../platforms/flow/promptEntry";
import type {
  FlowImagePagePort,
  FlowDocumentBinding,
  TimedFlowGenerateInspection,
} from "../../platforms/flow/images";
import { enterFlowVideoPrompt } from "../../platforms/flow/promptEntry";
import {
  inspectTimedFlowGenerate,
  inspectFlowImageButton,
  activateFlowImageGenerate,
} from "../../platforms/flow/images";
import {
  flowExpectedMediaIdentityKeys,
  flowMediaIdentitiesMatchExpected,
} from "../../platforms/flow/mediaIdentity";
import type { FlowDebuggerLease } from "./flow";

type ScriptingPort = {
  executeScript(input: {
    target: { tabId: number; documentIds: string[] };
    world: "ISOLATED";
    func: (...args: never[]) => unknown;
    args?: unknown[];
  }): Promise<Array<{ documentId?: string; result?: unknown }>>;
};

type GeneratePort = FlowPromptEntryPort &
  FlowImagePagePort & {
    acquireDebuggerLease?: (
      tabId: number,
      ownerId?: string,
    ) => Promise<FlowDebuggerLease>;
    releaseDebuggerLease?: (lease: FlowDebuggerLease) => Promise<void>;
    captureFrame(tabId: number): Promise<FlowDocumentBinding>;
    readFrame(
      tabId: number,
      lease?: FlowDebuggerLease,
    ): Promise<FlowDocumentBinding | undefined>;
  };

/** Read-only page probe. It does not open settings, picker, or mutate the composer. */
export function inspectFlowVideoReferenceInPage(): {
  href: string;
  composerCount: number;
  chips: Array<{ busy: string | null; urls: string[]; url?: string }>;
} {
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      element.isConnected &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };
  const roots = [
    ...document.querySelectorAll<HTMLElement>("flow-base-prompt-box"),
  ].filter(visible);
  const root = roots.length === 1 ? roots[0] : undefined;
  const bar = root ? (root.querySelector("flow-ingredient-bar") ?? root) : undefined;
  const isFrameTrigger = (el: Element) =>
    Boolean(el.closest(".frame-trigger, div.frame-trigger, [class*='frame-trigger']"));
  const components = bar
    ? [...bar.querySelectorAll<HTMLElement>(
        "flow-character-ingredient-chip, flow-video-ingredient-chip, flow-image-ingredient-chip",
      )].filter((component) => !isFrameTrigger(component))
    : [];
  const recognized = bar
    ? components
        .map((component) =>
          component.querySelector<HTMLElement>("button.chip-container, button[aria-label='Ingredient'], button"),
        )
        .filter((button): button is HTMLElement => Boolean(button))
        .filter((button) => !isFrameTrigger(button))
    : [];
  const chipButtons = recognized.length > 0
    ? recognized
    : bar
      ? [...bar.querySelectorAll<HTMLElement>("button.chip-container, button[aria-label='Ingredient']")]
        .filter((button) => !isFrameTrigger(button))
      : [];
  const chips = chipButtons
    .filter(visible)
    .map((chip) => {
      const images = [...chip.querySelectorAll<HTMLImageElement>("img")];
      const urls = images
        .map((img) => img.currentSrc || img.src || img.getAttribute("src") || "")
        .filter(Boolean);
      const primary = chip.querySelector<HTMLImageElement>(
        "img[alt='Ingredient image']",
      );
      const url =
        primary?.currentSrc ||
        primary?.src ||
        primary?.getAttribute("src") ||
        urls[0] ||
        undefined;
      return {
        busy: chip.getAttribute("aria-busy"),
        urls,
        ...(url ? { url } : {}),
      };
    });
  return { href: location.href, composerCount: roots.length, chips };
}

export type FlowVideoGenerateResult = {
  status: "dispatched" | "uncertain" | "blocked" | "already_dispatched";
  reason?: string;
  attemptId?: string;
  activationCount?: number;
  pressAttempted?: boolean;
  releaseAttempted?: boolean;
};

export function createFlowVideoGenerateHandler(deps: {
  repositories: ExtensionRepositories;
  scripting: ScriptingPort;
  getTab: (tabId: number) => Promise<{ id?: number; url?: string }>;
  revalidate: () => Promise<unknown>;
  promptPort: GeneratePort;
  enterPrompt?: (
    text: string,
    frame: FrameIdentity,
    verifiedReferenceMediaId: string,
    allowedReferenceAsbToken?: string,
  ) => Promise<FlowPromptEntryResult>;
  inspectGenerate?: (
    tabId: number,
    text: string,
    verifiedReferenceMediaId: string,
    allowedReferenceAsbToken?: string,
  ) => Promise<TimedFlowGenerateInspection>;
  buttonPosition?: (
    tabId: number,
    buttonId: string,
    verifiedReferenceMediaId: string,
    allowedReferenceAsbToken?: string,
  ) => Promise<{ x: number; y: number } | undefined>;
  activate?: (
    tabId: number,
    position: { x: number; y: number },
  ) => Promise<{
    complete: boolean;
    pressAttempted: boolean;
    releaseAttempted: boolean;
  }>;
  now?: () => number;
  createAttemptId?: () => string;
}) {
  const now = deps.now ?? Date.now;
  const enter =
    deps.enterPrompt ??
    ((text, frame, mediaId, asbToken) =>
      enterFlowVideoPrompt(text, { ...deps.promptPort, expectedFrame: frame }, mediaId, asbToken));
  const inspect =
    deps.inspectGenerate ??
    ((tabId, text, mediaId, asbToken) =>
      inspectTimedFlowGenerate(deps.promptPort, tabId, text, mediaId, asbToken));
  const position =
    deps.buttonPosition ??
    ((tabId, id, mediaId, asbToken) =>
      inspectFlowImageButton(deps.promptPort, tabId, id, mediaId, asbToken));
  const activate =
    deps.activate ??
    ((tabId, point) =>
      activateFlowImageGenerate(deps.promptPort, tabId, point.x, point.y));

  async function selectedBinding(
    batch: ReturnType<typeof PreparedVideoBatchRecordSchema.parse>,
  ) {
    await deps.revalidate();
    const selected = await deps.repositories.getSelectedTarget("Flow");
    const queueRecord = await deps.repositories.getFlowVideoQueue(`flow-video:${batch.id}`);
    const rebound = queueRecord?.executionDocumentRebind;
    const expectedTabId = rebound?.toTabId ?? batch.target.tabId;
    const expectedDocumentId = rebound?.toDocumentId ?? batch.target.documentId;
    if (
      rebound &&
      (rebound.fromDocumentId !== batch.target.documentId ||
        rebound.projectId !== batch.target.projectId ||
        rebound.canonicalTarget !== batch.target.canonicalTarget)
    )
      return undefined;

    const binding = selected?.verificationBinding;
    if (
      !selected ||
      selected.verification !== "verified" ||
      !binding ||
      selected.tabId !== expectedTabId ||
      selected.canonicalTarget !== batch.target.canonicalTarget ||
      selected.tabId !== batch.manualSettingsDeclaration.tabId ||
      selected.canonicalTarget !==
        batch.manualSettingsDeclaration.canonicalTarget ||
      binding.provider !== "Flow" ||
      binding.tabId !== selected.tabId ||
      binding.canonicalTarget !== selected.canonicalTarget ||
      binding.projectId !== batch.target.projectId ||
      binding.documentId !== expectedDocumentId ||
      binding.extensionBuildId !== BUILD_ID ||
      binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
      binding.connectorBuildId !== BUILD_ID ||
      binding.connectorProtocolVersion !== CONNECTOR_PROTOCOL_VERSION
    )
      return undefined;
    const tab = await deps.getTab(selected.tabId);
    const route = flowTabFromUrl(selected.tabId, "Flow", tab.url);
    if (
      !route ||
      route.projectId !== binding.projectId ||
      route.canonicalTarget !== selected.canonicalTarget
    )
      return undefined;
    return { selected, binding, tab };
  }

  async function readReference(
    batch: ReturnType<typeof PreparedVideoBatchRecordSchema.parse>,
    item: ReturnType<
      typeof PreparedVideoBatchRecordSchema.parse
    >["items"][number],
  ) {
    const operationId = `${batch.id}:${item.itemId}`;
    const operation =
      await deps.repositories.getFlowVideoAttachmentOperation(operationId);
    const pinned = await deps.repositories.getReferenceById(
      item.reference.referenceId,
    );
    if (
      operation?.status !== "attached" ||
      operation.referenceId !== item.reference.referenceId ||
      !pinned ||
      !ReferenceAssignmentRecordSchema.safeParse(pinned).success ||
      pinned.referenceId !== item.reference.referenceId ||
      pinned.assignmentVersion !== item.reference.assignmentVersion ||
      pinned.sha256 !== item.reference.sha256 ||
      pinned.byteSize !== item.reference.byteSize ||
      pinned.mimeType !== item.reference.mimeType ||
      pinned.width !== item.reference.width ||
      pinned.height !== item.reference.height ||
      !pinned.providerAssetId
    )
      return undefined;

    if (
      !operation.verifiedAttachment ||
      operation.verifiedAttachment.mediaId !== pinned.providerAssetId
    )
      return undefined;

    if (
      operation.observedAsbToken &&
      operation.verifiedAttachment.asbToken &&
      operation.observedAsbToken !== operation.verifiedAttachment.asbToken
    )
      return undefined;

    const asbToken =
      operation.observedAsbToken ?? operation.verifiedAttachment.asbToken;
    const expectedKeys = flowExpectedMediaIdentityKeys({
      mediaId: pinned.providerAssetId,
      asbToken,
    });

    const bytes = new Uint8Array(await pinned.bytes.arrayBuffer());
    if (
      bytes.byteLength !== item.reference.byteSize ||
      (await sha256Bytes(bytes)) !== item.reference.sha256
    )
      return undefined;
    const selected = await selectedBinding(batch);
    // A Flow reload may change the document ID while the tab/project and
    // pinned media identity stay the same. The exact chip media ID below
    // remains the current-document binding check.
    if (
      !selected ||
      pinned.tabId !== selected.selected.tabId ||
      pinned.flowProjectId !== selected.binding.projectId ||
      pinned.canonicalTarget !== selected.selected.canonicalTarget
    )
      return undefined;
    const target = {
      tabId: selected.selected.tabId,
      documentIds: [selected.binding.documentId],
    };
    const result = await deps.scripting.executeScript({
      target,
      world: "ISOLATED",
      func: inspectFlowVideoReferenceInPage,
    });
    const readback = result[0]?.result as
      ReturnType<typeof inspectFlowVideoReferenceInPage> | undefined;
    const chip = readback?.chips?.[0];
    const rawUrls = chip?.urls ?? (chip?.url ? [chip.url] : []);
    const match = chip
      ? flowMediaIdentitiesMatchExpected(rawUrls, expectedKeys)
      : { ok: false };
    if (
      result[0]?.documentId !== selected.binding.documentId ||
      flowTabFromUrl(selected.selected.tabId, "Flow", readback?.href)
        ?.projectId !== selected.binding.projectId ||
      readback?.composerCount !== 1 ||
      readback.chips.length !== 1 ||
      chip?.busy !== "false" ||
      !match.ok
    )
      return undefined;
    return {
      operation,
      pinned,
      selected: selected.selected,
      binding: selected.binding,
      target,
      mediaId: pinned.providerAssetId,
      asbToken,
    };
  }

  async function generateOnce(
    preparedBatchId: string,
    itemId: string,
  ): Promise<FlowVideoGenerateResult> {
    const operationId = `${preparedBatchId}:${itemId}`;
    const currentOperation =
      await deps.repositories.getFlowVideoAttachmentOperation(operationId);
    if (currentOperation?.videoGeneration) {
      const previous = currentOperation.videoGeneration;
      return {
        status:
          previous.state === "dispatched"
            ? "already_dispatched"
            : previous.state === "blocked"
              ? "blocked"
              : "uncertain",
        reason: previous.reason ?? "prior_generation_intent",
        attemptId: previous.attemptId,
      };
    }
    if (currentOperation?.status !== "attached")
      return { status: "blocked", reason: "reference_not_attached" };
    const rawBatch =
      await deps.repositories.getPreparedVideoBatchById(preparedBatchId);
    const parsed = PreparedVideoBatchRecordSchema.safeParse(rawBatch);
    if (
      !parsed.success ||
      parsed.data.id !== preparedBatchId ||
      parsed.data.destination !== "Flow"
    )
      return { status: "blocked", reason: "prepared_flow_batch_invalid" };
    const batch = parsed.data;
    const confirmation = VideoSettingsConfirmationSchema.safeParse(
      batch.manualSettingsDeclaration,
    );
    const queueRecord = await deps.repositories.getFlowVideoQueue(`flow-video:${batch.id}`);
    const rebound = queueRecord?.executionDocumentRebind;
    const declarationDocId = rebound ? rebound.fromDocumentId : batch.target.documentId;
    if (
      !confirmation.success ||
      confirmation.data.destination !== "Flow" ||
      confirmation.data.tabId !== batch.target.tabId ||
      confirmation.data.canonicalTarget !== batch.target.canonicalTarget ||
      confirmation.data.projectId !== batch.target.projectId ||
      confirmation.data.documentId !== declarationDocId
    )
      return {
        status: "blocked",
        reason: "manual_settings_confirmation_binding_mismatch",
      };
    if ((await sha256Hex(batch.videoSourceText)) !== batch.videoSourceHash)
      return {
        status: "blocked",
        reason: "prepared_video_source_hash_mismatch",
      };
    const imported = importPromptBatch(batch.videoSourceText, "video");
    const item = batch.items.find((candidate) => candidate.itemId === itemId);
    if (
      !item ||
      !imported.ok ||
      imported.items[item.order]?.rawBody !== item.rawJsonBody ||
      imported.items[item.order]?.shotId !== item.shotId ||
      canonicalizeShotId(imported.items[item.order]?.shotId) !==
        item.canonicalShotId ||
      (await sha256Hex(item.rawJsonBody)) !== item.contentHash
    )
      return {
        status: "blocked",
        reason: "prepared_item_pairing_or_hash_mismatch",
      };
    const ref = await readReference(batch, item);
    if (!ref)
      return { status: "blocked", reason: "matching_ready_reference_required" };
    const frame = await deps.promptPort.captureFrame(ref.selected.tabId);
    const frameRoute = flowTabFromUrl(ref.selected.tabId, "Flow", frame.url);
    if (
      !frameRoute ||
      frameRoute.projectId !== ref.binding.projectId ||
      frameRoute.canonicalTarget !== ref.selected.canonicalTarget
    )
      return { status: "blocked", reason: "prompt_document_changed" };
    const filled = await enter(item.rawJsonBody, frame, ref.mediaId, ref.asbToken);
    if (
      !filled.fillVerified ||
      !filled.immediateMatch ||
      !filled.settledMatch ||
      !filled.stableReadback
    )
      return {
        status: filled.outcome === "input-uncertain" ? "uncertain" : "blocked",
        reason: "exact_prompt_readback_failed",
      };
    const attemptId = deps.createAttemptId?.() ?? crypto.randomUUID();
    let debuggerLease: FlowDebuggerLease | undefined;
    let legacyDebuggerAttached = false;
    let intentPersisted = false;
    try {
      if (deps.promptPort.acquireDebuggerLease)
        debuggerLease = await deps.promptPort.acquireDebuggerLease(
          ref.selected.tabId,
          attemptId,
        );
      else {
        await deps.promptPort.attach(ref.selected.tabId);
        legacyDebuggerAttached = true;
      }
      await deps.promptPort.sendCommand(ref.selected.tabId, "Page.enable");
      await deps.promptPort.sendCommand(ref.selected.tabId, "Runtime.enable");
      const afterFillFrame = await deps.promptPort.readFrame(
        ref.selected.tabId,
        debuggerLease,
      );
      const afterFillReference = await readReference(batch, item);
      const afterFillRoute = flowTabFromUrl(
        ref.selected.tabId,
        "Flow",
        afterFillFrame?.url,
      );
      if (
        !afterFillFrame ||
        afterFillFrame.frameId !== frame.frameId ||
        afterFillFrame.loaderId !== frame.loaderId ||
        afterFillRoute?.projectId !== ref.binding.projectId ||
        afterFillRoute.canonicalTarget !== ref.selected.canonicalTarget ||
        !afterFillReference ||
        afterFillReference.binding.documentId !== ref.binding.documentId
      )
        return {
          status: "blocked",
          reason: "target_or_reference_changed_after_prompt",
        };
      const generate = await inspect(ref.selected.tabId, item.rawJsonBody, ref.mediaId, ref.asbToken);
      if (
        generate.composer !== "identified" ||
        !generate.exactPrompt
      )
        return {
          status: "blocked",
          reason: "generate_control_or_prompt_preflight_failed",
        };
      // This is a read-only pre-intent result. The timed queue may wait and
      // retry readiness without creating a generation intent or activating.
      if (generate.generate === "disabled")
        return { status: "blocked", reason: "generate_disabled" };
      if (generate.generate !== "identified" || !generate.buttonObjectId)
        return { status: "blocked", reason: "generate_control_or_prompt_preflight_failed" };
      const point = await position(ref.selected.tabId, generate.buttonObjectId, ref.mediaId, ref.asbToken);
      if (!point)
        return { status: "blocked", reason: "generate_control_changed" };
      const createdAt = now();
      const intent: NonNullable<
        FlowVideoAttachmentOperation["videoGeneration"]
      > = {
        attemptId,
        preparedBatchId,
        itemId,
        canonicalShotId: item.canonicalShotId,
        promptHash: item.contentHash,
        referenceId: item.reference.referenceId,
        tabId: ref.selected.tabId,
        projectId: ref.binding.projectId,
        canonicalTarget: ref.selected.canonicalTarget,
        documentId: ref.binding.documentId,
        state: "dispatch_intent",
        createdAt,
        updatedAt: createdAt,
      };
      if (
        !(await deps.repositories.claimFlowVideoGenerationIntent({
          expected: currentOperation,
          intent,
        }))
      )
        return {
          status: "blocked",
          reason: "generation_operation_already_claimed",
        };
      intentPersisted = true;

      // Final read-only target/reference and exact prompt/control check occurs after durable intent and immediately before activation.
      const finalRef = await readReference(batch, item);
      const finalFrame = await deps.promptPort.readFrame(
        ref.selected.tabId,
        debuggerLease,
      );
      const finalRoute = flowTabFromUrl(
        ref.selected.tabId,
        "Flow",
        finalFrame?.url,
      );
      const finalGenerate = await inspect(ref.selected.tabId, item.rawJsonBody, ref.mediaId, ref.asbToken);
      const finalPoint = finalGenerate.buttonObjectId
        ? await position(ref.selected.tabId, finalGenerate.buttonObjectId, ref.mediaId, ref.asbToken)
        : undefined;
      if (
        !finalRef ||
        finalRef.binding.documentId !== ref.binding.documentId ||
        !finalFrame ||
        finalFrame.frameId !== frame.frameId ||
        finalFrame.loaderId !== frame.loaderId ||
        finalRoute?.projectId !== ref.binding.projectId ||
        finalRoute.canonicalTarget !== ref.selected.canonicalTarget ||
        finalGenerate.composer !== "identified" ||
        !finalGenerate.exactPrompt ||
        finalGenerate.generate !== "identified" ||
        !finalPoint
      ) {
        await deps.repositories.updateFlowVideoGeneration({
          operationId,
          attemptId,
          expectedState: "dispatch_intent",
          state: "blocked",
          reason: "final_pre_activation_check_failed",
          updatedAt: now(),
        });
        return {
          status: "blocked",
          reason: "final_pre_activation_check_failed",
          attemptId,
        };
      }
      try {
        const activation = await activate(ref.selected.tabId, finalPoint);
        const state = activation.complete ? "dispatched" : "uncertain";
        const updated = await deps.repositories.updateFlowVideoGeneration({
          operationId,
          attemptId,
          expectedState: "dispatch_intent",
          state,
          ...(activation.complete
            ? {}
            : { reason: "generate_delivery_uncertain" }),
          pressAttempted: activation.pressAttempted,
          releaseAttempted: activation.releaseAttempted,
          updatedAt: now(),
        });
        return updated
          ? {
              status: activation.complete ? "dispatched" : "uncertain",
              attemptId,
              activationCount: 1,
              pressAttempted: activation.pressAttempted,
              releaseAttempted: activation.releaseAttempted,
              ...(!activation.complete
                ? { reason: "generate_delivery_uncertain" }
                : {}),
            }
          : {
              status: "uncertain",
              reason: "generation_result_persistence_uncertain",
              attemptId,
              activationCount: 1,
            };
      } catch {
        await deps.repositories.updateFlowVideoGeneration({
          operationId,
          attemptId,
          expectedState: "dispatch_intent",
          state: "uncertain",
          reason: "generate_delivery_uncertain",
          pressAttempted: true,
          updatedAt: now(),
        });
        return {
          status: "uncertain",
          reason: "generate_delivery_uncertain",
          attemptId,
          activationCount: 1,
          pressAttempted: true,
        };
      }
    } catch {
      if (intentPersisted) {
        await deps.repositories
          .updateFlowVideoGeneration({
            operationId,
            attemptId,
            expectedState: "dispatch_intent",
            state: "blocked",
            reason: "pre_activation_check_failed",
            updatedAt: now(),
          })
          .catch(() => false);
        return {
          status: "blocked",
          reason: "pre_activation_check_failed",
          attemptId,
        };
      }
      return { status: "blocked", reason: "generation_preflight_failed" };
    } finally {
      if (debuggerLease)
        await deps.promptPort
          .releaseDebuggerLease?.(debuggerLease)
          .catch(() => undefined);
      else if (legacyDebuggerAttached)
        await deps.promptPort.detach(ref.selected.tabId).catch(() => undefined);
    }
  }
  return { generateOnce };
}
