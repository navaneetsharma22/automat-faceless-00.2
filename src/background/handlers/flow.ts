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
  flowImageAttemptConfirmationKey,
  type FlowImageAttemptStage,
  type FlowImageAttemptRecord,
} from "../../domain/jobs/attempt";
import { flowImagePromptSnapshotId } from "../../domain/batches/flowImagePromptSnapshot";
import {
  flowImageResultBaselineFingerprintInput,
  FlowImageObservationArmReceiptSchema,
  reduceFlowImageCountDecision,
  evaluateFlowImageCountBaselineEligibility,
  flowResultBaselineMatchesAttempt,
  flowResultBaselineMatchesProfile,
  type FlowImageObservationArmBinding,
  type FlowImageReadinessMode,
} from "../../domain/jobs/results";
import { captureFlowResultBaseline } from "../../platforms/flow/observer";
import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import {
  ActiveFlowImageAttemptError,
  FlowCountSessionActiveError,
  DuplicateFlowImageConfirmationError,
  FlowImageAttemptTransitionError,
  FlowImageAttemptValidationError,
  FlowImagePromptSnapshotConflictError,
  sha256Hex,
} from "../../storage/repositories";
import type { ProviderTab } from "../../platforms/shared/contracts";
import { createFlowObservationInjection } from "../../platforms/flow/observationProducer";
import { flowWorkspaceScopeAnalyzer } from "../../platforms/flow/workspaceScope";

/** A separate read-only scope/listener check; it creates no attempt or receipt. */
export function createFlowImageReadinessCheck(
  repositories: ExtensionRepositories,
  scriptingPort:
    | Pick<typeof chrome.scripting, "executeScript">
    | undefined = typeof chrome === "undefined" ? undefined : chrome.scripting,
): (input: { countMode: FlowImageReadinessMode }) => Promise<unknown> {
  return async ({ countMode }) => {
    const countModeEligibility = (
      status: "eligible" | "blocked" | "ambiguous",
      reason: string | null,
      detailCode: string,
    ) => ({
      mode: countMode.mode,
      startingImageCount: countMode.startingImageCount,
      userConfirmed:
        countMode.mode === "existing_project" ? countMode.userConfirmed : null,
      status,
      reason,
      detailCode,
      inventoryComplete: false,
      providerIdentityVerified: false,
      terminalSemanticsSupported: false,
    });
    const selected = await repositories.getSelectedTarget("Flow");
    const blocked = (
      reason: string,
      message: string,
      gates: Record<string, string>,
    ) => ({
      status: "blocked",
      reason,
      message,
      gates,
      selectedCountMode: {
        mode: countMode.mode,
        startingImageCount: countMode.startingImageCount,
        userConfirmed:
          countMode.mode === "existing_project"
            ? countMode.userConfirmed
            : null,
      },
      countModeEligibility: countModeEligibility("blocked", reason, reason),
      attemptsCreated: 0,
      confirmationConsumed: false,
      productionReceiptCreated: false,
    });
    if (countMode.mode === "existing_project" && !countMode.userConfirmed)
      return blocked(
        "count_declaration_unconfirmed",
        "Confirm the starting image count for this selected project before checking existing-project count eligibility. No attempt or settings confirmation was created or consumed.",
        { countMode: "starting_count_not_confirmed" },
      );
    if (!selected)
      return blocked(
        "no_selected_target",
        "Select an already open Flow project in Connections, then connect it.",
        { selectedTarget: "absent" },
      );
    const savedVerificationBinding = selected.verificationBinding;
    const savedBindingBuildStale = Boolean(
      savedVerificationBinding &&
      (savedVerificationBinding.extensionBuildId !== BUILD_ID ||
        savedVerificationBinding.connectorBuildId !== BUILD_ID),
    );
    const savedBindingProtocolStale = Boolean(
      savedVerificationBinding &&
      (savedVerificationBinding.extensionProtocolVersion !== PROTOCOL_VERSION ||
        savedVerificationBinding.connectorProtocolVersion !== 1),
    );
    if (selected.connectionState === "stale-build" || savedBindingBuildStale)
      return blocked(
        "verification_stale_build",
        "The verification came from another extension or connector build. Reconnect with the currently loaded package.",
        { verification: "stale_build" },
      );
    if (savedBindingProtocolStale)
      return blocked(
        "verification_stale_protocol",
        "The verification uses an older connection protocol. Reconnect using the current extension package.",
        { verification: "stale_protocol" },
      );
    if (
      selected.verification !== "verified" ||
      selected.connectionState !== "verified" ||
      selected.reconnectEnabled === false
    )
      return blocked(
        selected.connectionState === "stale-document"
          ? "verification_stale_document"
          : selected.connectionState === "temporarily-unreachable"
            ? "verification_transport_unavailable"
            : "saved_target_unverified",
        "The selected Flow connection is not currently verified. Recheck the same selected project in Connections before checking readiness.",
        {
          selectedTarget: selected.connectionState ?? selected.verification,
          reconnectEnabled: String(selected.reconnectEnabled !== false),
        },
      );
    const verification = selected.verificationBinding;
    if (!verification && selected.verification !== "verified")
      return blocked(
        "saved_target_unverified",
        "The Flow project is saved but has no successful connection record. Choose Connect in Connections.",
        { selectedTarget: "saved_unverified", verification: "binding_missing" },
      );
    if (!verification)
      return blocked(
        "verification_binding_missing",
        "Reconnect to Flow so the extension can save a document-bound verification.",
        { verification: "binding_missing" },
      );
    const target = flowTabFromUrl(
      selected.tabId,
      selected.canonicalTarget,
      selected.canonicalTarget,
    );
    if (!target)
      return blocked(
        "selected_target_invalid",
        "Select a supported Flow project URL in Connections, then connect it.",
        { selectedTarget: "route_unrecognized" },
      );
    if (
      verification.provider !== "Flow" ||
      verification.tabId !== selected.tabId ||
      verification.canonicalTarget !== selected.canonicalTarget ||
      verification.projectId !== target.projectId
    )
      return blocked(
        "verification_selection_mismatch",
        "The saved verification belongs to a different Flow tab or project. Select the intended project and connect again.",
        { verification: "selection_mismatch" },
      );
    if (
      verification.extensionBuildId !== BUILD_ID ||
      verification.connectorBuildId !== BUILD_ID
    )
      return blocked(
        "verification_stale_build",
        "The verification came from another extension or connector build. Reconnect with the currently loaded package.",
        { verification: "stale_build" },
      );
    if (
      verification.extensionProtocolVersion !== PROTOCOL_VERSION ||
      verification.connectorProtocolVersion !== 1
    )
      return blocked(
        "verification_stale_protocol",
        "The verification uses an older connection protocol. Reconnect using the current extension package.",
        { verification: "stale_protocol" },
      );
    if (verification.capability !== "read-only-connection-v1")
      return blocked(
        "verification_capability_missing",
        "The selected connection did not confirm the required read-only capability. Connect to a supported Flow project.",
        { verification: "capability_missing" },
      );
    if (!scriptingPort)
      return blocked(
        "readiness_capability_missing",
        "Chrome document inspection is unavailable. Open the packaged extension dashboard and check its scripting permission.",
        { capability: "scripting_unavailable" },
      );
    const url = new URL(target.canonicalTarget);
    const projectId =
      url.hostname === "flow.google.com"
        ? /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/?$/.exec(
            url.pathname,
          )?.[1]
        : /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    if (!projectId)
      return blocked(
        "selected_target_invalid",
        "Select a supported Flow project URL in Connections, then connect it.",
        { selectedTarget: "route_unrecognized" },
      );
    let bound: chrome.scripting.InjectionResult[];
    try {
      bound = await scriptingPort.executeScript({
        target: { tabId: target.id, frameIds: [0] },
        func: () => ({ href: location.href, top: window.top === window }),
      });
    } catch {
      return blocked(
        "verification_transport_unavailable",
        "Chrome could not inspect the selected Flow document. Check its access and reconnect without refreshing the provider page.",
        { transport: "document_unavailable" },
      );
    }
    const document = bound[0];
    if (
      !document?.documentId ||
      document.documentId !== verification.documentId ||
      document.frameId !== 0 ||
      document.result?.top !== true ||
      flowTabFromUrl(target.id, "", document.result.href)?.canonicalTarget !==
        target.canonicalTarget
    ) {
      return blocked(
        "verification_stale_document",
        "The Flow document changed since Connections verified it. Reconnect to the currently selected project.",
        { documentBinding: "stale_or_changed" },
      );
    }
    if (selected.verification !== "verified")
      return blocked(
        "saved_target_unverified",
        "The saved Flow connection must be freshly rechecked after worker startup. Choose Connect in Connections.",
        { selectedTarget: "saved_unverified" },
      );
    let allCountAttempts: FlowImageAttemptRecord[];
    try {
      allCountAttempts = await repositories.getAllFlowImageAttempts();
    } catch {
      return blocked(
        "count_attempt_read_failed",
        "The durable Flow count-session state could not be read. Retry readiness after storage is available; no attempt was created.",
        { countSession: "read_failed" },
      );
    }
    const sessionAttempts = allCountAttempts.filter(
      (attempt) => attempt.countSessionId === countMode.countSessionId,
    );
    if (
      sessionAttempts.some(
        (attempt) =>
          attempt.countBaseline &&
          (attempt.projectId !== target.projectId ||
            attempt.tabId !== target.id ||
            attempt.documentId !== document.documentId ||
            attempt.buildId !== BUILD_ID ||
            attempt.protocolVersion !== PROTOCOL_VERSION ||
            attempt.countBaseline.mode !== countMode.mode ||
            attempt.countBaseline.startingImageCount !==
              countMode.startingImageCount),
      )
    )
      return blocked(
        "count_session_binding_changed",
        "This count session is bound to a different Flow project, document, build, or starting-count declaration. Start a fresh read-only count session for the current selection.",
        { countSession: "binding_mismatch" },
      );
    const unresolvedForDocument = allCountAttempts.find(
      (attempt) =>
        attempt.countSessionId !== undefined &&
        attempt.projectId === target.projectId &&
        attempt.tabId === target.id &&
        attempt.documentId === document.documentId &&
        attempt.state !== "failed-before-dispatch" &&
        !(
          attempt.state === "dispatched" &&
          attempt.countDecision?.status === "count_matched"
        ),
    );
    if (unresolvedForDocument)
      return blocked(
        "count_session_paused",
        "An earlier count observation for this exact Flow document is unresolved. Inspect that durable attempt before using count mode; readiness will not bypass it.",
        { countSession: "unresolved_attempt" },
      );
    const unresolvedInSession = sessionAttempts.find(
      (attempt) =>
        attempt.state !== "failed-before-dispatch" &&
        !(
          attempt.state === "dispatched" &&
          attempt.countDecision?.status === "count_matched"
        ),
    );
    if (unresolvedInSession)
      return blocked(
        "count_session_paused",
        "A prior prompt in this count session is unresolved or ambiguous. Inspect that attempt before continuing.",
        { countSession: "unresolved_session_attempt" },
      );
    const priorMatchedAttempts = sessionAttempts.filter(
      (attempt) =>
        attempt.state === "dispatched" &&
        attempt.countDecision?.status === "count_matched",
    );
    const priorMatchedAttemptIds = priorMatchedAttempts.map(
      (attempt) => attempt.attemptId,
    );
    const priorMatchedCandidateIds = priorMatchedAttempts.flatMap(
      (attempt) => attempt.countDecision?.observedEligibleCandidateIds ?? [],
    );
    const priorDeclaredAdditions = priorMatchedAttempts.reduce(
      (total, attempt) =>
        total + (attempt.settingsConfirmation.declaredVariantCount ?? 0),
      0,
    );
    const bindingTarget = {
      tabId: target.id,
      documentIds: [document.documentId],
    };
    try {
      const installed = await scriptingPort.executeScript({
        target: bindingTarget,
        world: "ISOLATED",
        func: flowWorkspaceScopeAnalyzer,
        args: [target.canonicalTarget, projectId, true],
      });
      if (
        installed[0]?.documentId !== document.documentId ||
        installed[0]?.frameId !== 0 ||
        !installed[0]?.result
      ) {
        return blocked(
          "readiness_analyzer_unavailable",
          "The read-only Flow workspace check could not attach to the verified document. Reconnect and retry.",
          { analyzerInstall: "document_changed_or_failed" },
        );
      }
      const checked = await scriptingPort.executeScript({
        target: bindingTarget,
        world: "ISOLATED",
        func: async (canonicalTarget: string, expectedProjectId: string) => {
          const key = "__AUTOMAT_FLOW_WORKSPACE_SCOPE_ANALYZER_V1__";
          const analyzer = (
            globalThis as typeof globalThis & {
              [key]?: (
                target: string,
                projectId: string,
              ) => Promise<{
                status: string;
                reason?: string;
                profile: string;
                captureGaps: string[];
                project: Element;
                roots: Array<Document | ShadowRoot | Element>;
                tiles: HTMLElement[];
                candidateIds: string[];
                qualifyingCandidateIds: string[];
                candidateMultiplicity: Array<{
                  candidateId: string;
                  renderedCopies: number;
                }>;
                candidateTileRelationships: Array<{
                  tileIndex: number;
                  candidateId: string;
                }>;
                repeatedCandidateCount: number;
                unidentifiedImageCount: number;
                unrelatedImageCount: number;
                virtualScrollContainerCount: number;
                virtualizationEvidence: string[];
                virtualized: boolean;
                loadingSignalCount: number;
                completeForRenderedScope?: boolean;
              }>;
            }
          )[key];
          if (!analyzer)
            return { status: "blocked", reason: "analyzer_unavailable" };
          const before = await analyzer(canonicalTarget, expectedProjectId);
          if (before.status !== "ready")
            return {
              status: "blocked",
              reason: before.status,
              profile: before.profile,
              captureGaps: before.captureGaps,
              renderedTileCount: before.tiles.length,
              distinctCandidateCount: before.candidateIds.length,
              candidateIds: before.candidateIds,
              repeatedCandidateCount: before.repeatedCandidateCount,
              unidentifiedImageCount: before.unidentifiedImageCount,
              unrelatedImageCount: before.unrelatedImageCount,
              virtualized: before.virtualized,
              virtualScrollContainerCount: before.virtualScrollContainerCount,
              virtualizationEvidence: before.virtualizationEvidence,
              completeForRenderedScope:
                before.captureGaps.length === 0 &&
                before.unidentifiedImageCount === 0,
            };
          const records: MutationRecord[] = [];
          let resourceEvent = false;
          let virtualScrollChanged = false;
          const roots: Array<Document | ShadowRoot | Element> = [
            before.project,
            ...before.roots.filter((root: Node) => root instanceof ShadowRoot),
          ];
          const observers: MutationObserver[] = [];
          const onResource = (event: Event) => {
            const target = event.target;
            if (
              event.type === "scroll" &&
              target instanceof Element &&
              target.localName === "cdk-virtual-scroll-viewport"
            ) {
              virtualScrollChanged = true;
              return;
            }
            if (
              target instanceof HTMLImageElement &&
              before.tiles.some((tile: Element) => tile.contains(target))
            )
              resourceEvent = true;
          };
          try {
            for (const root of roots) {
              const observer = new MutationObserver((items) =>
                records.push(...items),
              );
              observer.observe(root, {
                subtree: true,
                childList: true,
                attributes: true,
                characterData: true,
              });
              observers.push(observer);
              root.addEventListener("load", onResource, true);
              root.addEventListener("error", onResource, true);
              root.addEventListener("scroll", onResource, true);
            }
            const second = await analyzer(canonicalTarget, expectedProjectId);
            for (const observer of observers)
              records.push(...observer.takeRecords());
            const stable =
              second.status === "ready" &&
              records.length === 0 &&
              !resourceEvent &&
              before.profile === second.profile &&
              JSON.stringify(before.candidateMultiplicity) ===
                JSON.stringify(second.candidateMultiplicity) &&
              JSON.stringify(before.candidateTileRelationships) ===
                JSON.stringify(second.candidateTileRelationships) &&
              before.tiles.length === second.tiles.length &&
              before.virtualScrollContainerCount ===
                second.virtualScrollContainerCount &&
              JSON.stringify(before.virtualizationEvidence) ===
                JSON.stringify(second.virtualizationEvidence) &&
              !virtualScrollChanged &&
              before.loadingSignalCount === second.loadingSignalCount;
            const tileOwnershipChanged =
              JSON.stringify(before.candidateTileRelationships) !==
              JSON.stringify(second.candidateTileRelationships);
            const virtualizationEvidence = [
              ...new Set([
                ...before.virtualizationEvidence,
                ...(virtualScrollChanged
                  ? ["scroll_observed_during_capture"]
                  : []),
                ...(tileOwnershipChanged ? ["tile_identity_recycled"] : []),
              ]),
            ];
            return {
              status: stable ? "ready" : "blocked",
              reason: stable
                ? null
                : virtualScrollChanged
                  ? "virtual_scroll_changed_during_readiness"
                  : tileOwnershipChanged
                    ? "tile_ownership_changed_during_readiness"
                    : second.status !== "ready"
                      ? second.status
                      : "baseline_changed_during_arm",
              profile: before.profile,
              listenerRoots: roots.length,
              listenersAttached: observers.length === roots.length,
              stableBaseline: stable,
              renderedTileCount: before.tiles.length,
              distinctCandidateCount: before.candidateIds.length,
              qualifyingCandidateCount: before.qualifyingCandidateIds.length,
              candidateIds: before.candidateIds,
              repeatedCandidateCount: before.repeatedCandidateCount,
              unidentifiedImageCount: before.unidentifiedImageCount,
              unrelatedImageCount: before.unrelatedImageCount,
              virtualScrollContainerCount: before.virtualScrollContainerCount,
              virtualizationEvidence,
              completeForRenderedScope:
                before.captureGaps.length === 0 &&
                before.unidentifiedImageCount === 0,
              virtualized:
                before.virtualized ||
                virtualScrollChanged ||
                tileOwnershipChanged,
              tileOwnershipRecycled: tileOwnershipChanged,
              loadingSignalCount: before.loadingSignalCount,
              captureGaps: before.captureGaps,
              inventoryComplete: false,
              providerIdentityVerified: false,
              terminalSemanticsSupported: false,
            };
          } catch {
            return {
              status: "blocked",
              reason: "observer_arm_failed",
              listenersAttached: false,
            };
          } finally {
            observers.forEach((observer) => observer.disconnect());
            roots.forEach((root) => {
              root.removeEventListener("load", onResource, true);
              root.removeEventListener("error", onResource, true);
              root.removeEventListener("scroll", onResource, true);
            });
          }
        },
        args: [target.canonicalTarget, projectId],
      });
      if (
        checked[0]?.documentId !== document.documentId ||
        checked[0]?.frameId !== 0
      )
        return blocked(
          "verification_stale_document",
          "The Flow document changed during readiness inspection. Reconnect and run the no-Generate check again.",
          { documentBinding: "changed_during_check" },
        );
      const currentSelection = await repositories.getSelectedTarget("Flow");
      if (
        !currentSelection ||
        currentSelection.provider !== selected.provider ||
        currentSelection.tabId !== selected.tabId ||
        currentSelection.canonicalTarget !== selected.canonicalTarget ||
        currentSelection.reconnectEnabled === false ||
        currentSelection.verification !== "verified" ||
        currentSelection.connectionState !== "verified" ||
        currentSelection.verificationBinding?.documentId !==
          verification.documentId ||
        currentSelection.verificationBinding?.documentToken !==
          verification.documentToken ||
        currentSelection.verificationBinding?.extensionBuildId !== BUILD_ID ||
        currentSelection.verificationBinding?.connectorBuildId !== BUILD_ID
      )
        return blocked(
          currentSelection?.connectionState === "stale-document"
            ? "verification_stale_document"
            : currentSelection?.connectionState === "stale-build"
              ? "verification_stale_build"
              : currentSelection?.connectionState === "temporarily-unreachable"
                ? "verification_transport_unavailable"
                : "saved_target_unverified",
          "The saved Flow connection changed during readiness inspection. Recheck the same selected project in Connections before continuing.",
          {
            selectedTarget:
              currentSelection?.connectionState ?? "selection_changed",
            verification: currentSelection?.verification ?? "unverified",
          },
        );
      const result = checked[0]?.result as Record<string, unknown> | undefined;
      const profile =
        result?.profile === "empty_marker"
          ? "flow_empty_workspace_ui"
          : result?.profile === "populated_tiles"
            ? "flow_rendered_tile_candidates"
            : result?.profile === "labelled_region"
              ? "flow_labelled_results_region"
              : "unsupported";
      const captureGaps = Array.isArray(result?.captureGaps)
        ? result.captureGaps.filter(
            (gap): gap is string => typeof gap === "string",
          )
        : [];
      const virtualizationEvidence = Array.isArray(
        result?.virtualizationEvidence,
      )
        ? result.virtualizationEvidence.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [];
      const candidateIds = Array.isArray(result?.candidateIds)
        ? result.candidateIds.filter(
            (candidate): candidate is string => typeof candidate === "string",
          )
        : [];
      const modeGate = evaluateFlowImageCountBaselineEligibility({
        mode: countMode.mode,
        startingImageCount: countMode.startingImageCount,
        profile,
        renderedTileCount:
          typeof result?.renderedTileCount === "number"
            ? result.renderedTileCount
            : 0,
        candidateIds,
        qualifyingCandidateCount:
          typeof result?.qualifyingCandidateCount === "number"
            ? result.qualifyingCandidateCount
            : undefined,
        renderedScopeComplete:
          result?.completeForRenderedScope === true &&
          result.stableBaseline === true &&
          captureGaps.length === 0 &&
          Number(result.unidentifiedImageCount ?? 0) === 0,
        captureGaps,
        unidentifiedImageCount: Number(result?.unidentifiedImageCount ?? 0),
        candidateOwnershipAmbiguous:
          result?.candidateOwnershipAmbiguous === true,
        loadingSignalCount: Number(result?.loadingSignalCount ?? 0),
        virtualized:
          result?.virtualized === true ||
          result?.tileOwnershipRecycled === true,
        virtualizationEvidence,
        virtualScrollContainerCount: Number(
          result?.virtualScrollContainerCount ?? 0,
        ),
        priorMatchedAttemptIds,
        priorMatchedCandidateIds,
        priorDeclaredAdditions,
      });
      const modeReport = countModeEligibility(
        modeGate.status,
        modeGate.reason ?? null,
        modeGate.detailCode ?? modeGate.reason ?? "eligible",
      );
      const eligible =
        result?.status === "ready" && modeGate.status === "eligible";
      const reason = eligible
        ? null
        : result?.status !== "ready"
          ? String(result?.reason ?? "readiness_capture_blocked") ||
            "readiness_capture_blocked"
          : (modeGate.detailCode ?? modeGate.reason ?? "count_mode_blocked");
      const message = eligible
        ? "The selected count mode passed its read-only baseline and listener checks. This does not authorize Generate or establish provider result identity or completion."
        : modeGate.detailCode ===
            "virtual_scroll_coverage_or_scrolling_observed"
          ? "Scrolling or viewport movement was observed during the baseline capture. Older cards may have entered the rendered scope, so existing-project count mode is ambiguous."
          : modeGate.detailCode === "virtual_scroll_measurement_inconclusive"
            ? "A visible virtual-scroll container could not be measured. Existing-project count mode stays blocked until the rendered scope can be measured completely."
            : modeGate.detailCode === "tile_identity_recycling_observed"
              ? "A rendered tile changed its owned candidate set during capture. Existing-project count mode is ambiguous because recycled DOM may represent older content."
              : modeGate.detailCode ===
                  "new_empty_mode_requires_empty_first_baseline"
                ? "New empty project mode requires the first baseline to show the exact empty-workspace profile. Choose Existing project only if its starting count is user-confirmed."
                : modeGate.detailCode ===
                    "existing_count_conflicts_with_empty_scope"
                  ? "The existing-project starting count is greater than zero, but the observed project scope is empty. Recheck the selected project and count declaration."
                  : modeGate.detailCode ===
                      "existing_count_candidate_count_mismatch"
                    ? "The user-attested starting count does not match the number of distinct visible, ready, tile-owned candidates in the stable baseline. Recheck the selected count or project."
                    : modeGate.detailCode ===
                        "baseline_qualifying_count_unavailable"
                      ? "The stable capture did not return a qualifying ready-candidate count. This measurement is unavailable, not zero; retry readiness after checking the capture path."
                      : modeGate.detailCode === "baseline_incomplete" ||
                          modeGate.detailCode === "rendered_scope_incomplete"
                        ? "The selected mode has no complete stable rendered-scope baseline. Resolve the reported capture gaps or unsupported structure."
                        : "The selected count mode is blocked by the reported workspace, session, or capture gate. Review the exact eligibility reason before continuing.";
      return {
        diagnostic: "flow-readiness-no-generate-v1",
        status: eligible ? "ready" : "blocked",
        reason,
        message,
        gates: {
          selectedTarget: "verified",
          workspaceScope: String(result?.status ?? "unavailable"),
          listenerAttachment: String(result?.listenersAttached ?? false),
          stableBaseline: String(result?.stableBaseline ?? false),
          countMode: modeGate.status,
        },
        selectedCountMode: {
          mode: countMode.mode,
          startingImageCount: countMode.startingImageCount,
          userConfirmed:
            countMode.mode === "existing_project"
              ? countMode.userConfirmed
              : null,
        },
        countModeEligibility: modeReport,
        baselineCoverageAssessment: {
          viewportOverflowObserved: virtualizationEvidence.includes(
            "scroll_extent_exceeds_viewport",
          ),
          actualScrollingObserved: virtualizationEvidence.some((evidence) =>
            [
              "nonzero_scroll_offset",
              "scroll_observed_during_capture",
            ].includes(evidence),
          ),
          candidateOwnershipAmbiguous:
            result?.candidateOwnershipAmbiguous === true ||
            virtualizationEvidence.includes("tile_identity_recycled"),
          candidateIdentityContinuity:
            result?.stableBaseline === true &&
            result?.tileOwnershipRecycled !== true
              ? "stable_during_capture"
              : "unresolved_during_capture",
          declaredExistingCountMatchesQualifyingCandidates:
            countMode.mode === "existing_project" &&
            typeof result?.qualifyingCandidateCount === "number"
              ? result.qualifyingCandidateCount === countMode.startingImageCount
              : null,
          inventoryComplete: false,
          providerIdentityVerified: false,
        },
        profile: result?.profile ?? "unsupported",
        listenerRoots: result?.listenerRoots ?? 0,
        listenersAttached: result?.listenersAttached ?? false,
        stableBaseline: result?.stableBaseline ?? false,
        renderedTileCount: result?.renderedTileCount ?? 0,
        distinctCandidateCount: result?.distinctCandidateCount ?? 0,
        qualifyingCandidateCount:
          typeof result?.qualifyingCandidateCount === "number"
            ? result.qualifyingCandidateCount
            : undefined,
        repeatedCandidateCount: result?.repeatedCandidateCount ?? 0,
        unidentifiedImageCount: result?.unidentifiedImageCount ?? 0,
        unrelatedImageCount: result?.unrelatedImageCount ?? 0,
        virtualScrollContainerCount: result?.virtualScrollContainerCount ?? 0,
        virtualizationEvidence,
        virtualized:
          result?.virtualized === true ||
          result?.tileOwnershipRecycled === true,
        viewportOverflowObserved: virtualizationEvidence.includes(
          "scroll_extent_exceeds_viewport",
        ),
        actualScrollingObserved: virtualizationEvidence.some((evidence) =>
          ["nonzero_scroll_offset", "scroll_observed_during_capture"].includes(
            evidence,
          ),
        ),
        candidateOwnershipAmbiguous:
          result?.candidateOwnershipAmbiguous === true ||
          virtualizationEvidence.includes("tile_identity_recycled"),
        candidateIdentityContinuity:
          result?.stableBaseline === true &&
          result?.tileOwnershipRecycled !== true
            ? "stable_during_capture"
            : "unresolved_during_capture",
        tileOwnershipRecycled: result?.tileOwnershipRecycled ?? false,
        loadingSignalCount: result?.loadingSignalCount ?? 0,
        captureGaps,
        inventoryComplete: false,
        providerIdentityVerified: false,
        terminalSemanticsSupported: false,
        documentBound: true,
        attemptsCreated: 0,
        confirmationConsumed: false,
        productionReceiptCreated: false,
      };
    } catch {
      return blocked(
        "readiness_transport_failed",
        "Chrome could not complete the read-only observer check. Confirm extension access, reconnect, and retry.",
        { observerTransport: "execute_script_failed" },
      );
    }
  };
}

/** Read-only durable count-decision projection for the dashboard. */
export function createFlowImageCountDecisionReadback(
  repositories: ExtensionRepositories,
): (attemptId: string) => Promise<unknown> {
  return async (attemptId) => {
    const attempt = await repositories.getFlowImageAttempt(attemptId);
    if (!attempt || !attempt.countDecision)
      return {
        status: "unavailable",
        reason: "count_decision_not_recorded",
        message:
          "No durable count decision is available for this attempt. Provider outcome remains unknown.",
        providerOutcome: attempt?.resultOutcome?.status ?? "unknown",
      };
    return {
      status: "available",
      attemptId: attempt.attemptId,
      attemptState: attempt.state,
      countDecision: attempt.countDecision,
      baselineProvenance: attempt.countBaseline?.provenance ?? null,
      baselineVirtualized: attempt.countBaseline?.virtualized ?? null,
      baselineInventoryComplete: false,
      providerOutcome: attempt.resultOutcome?.status ?? "unknown",
      providerOutcomeReason: attempt.resultOutcome?.reason ?? null,
      message:
        attempt.countDecision.status === "count_matched"
          ? "The declared count matched eligible structural candidates. This is heuristic observation, not provider success or causal attribution."
          : `Count observation ${attempt.countDecision.status}${attempt.countDecision.reason ? `: ${attempt.countDecision.reason}` : ""}. Provider outcome remains unknown.`,
    };
  };
}

type FlowSettingsConfirmation = {
  confirmationId: string;
  confirmedAt: number;
  tabId: number;
  projectId: string;
  canonicalTarget: string;
  declaredVariantCount: number;
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
  startObservation: (
    tabId: number,
    binding: FlowImageObservationArmBinding,
  ) => Promise<
    | {
        status: "started";
        receipt: import("../../domain/jobs/results").FlowImageObservationArmReceipt;
      }
    | { status: "unsupported"; diagnostic?: FlowObservationArmDiagnostic }
    | "started"
    | "unsupported"
  >;
  stopObservation: (
    tabId: number,
    binding: FlowImageObservationArmBinding,
  ) => Promise<void>;
  activateObservation: (
    tabId: number,
    binding: FlowImageObservationArmBinding,
  ) => Promise<"started" | "unsupported">;
  resumeObservation: (
    tabId: number,
    binding: FlowImageObservationArmBinding,
  ) => Promise<"resumed" | "unsupported">;
  productionObservationSupported?: boolean;
};

/** Fixed, privacy-safe arm diagnostics. Never include exception messages or page data. */
export type FlowObservationArmDiagnostic = {
  phase: "scope_install" | "arm_injection" | "receipt_validation";
  reason:
    | "wrong_tab"
    | "scripting_unavailable"
    | "injection_exception"
    | "result_missing"
    | "document_mismatch"
    | "frame_mismatch"
    | "scope_not_ready"
    | "scope_capture_gaps"
    | "producer_refused_scope"
    | "producer_refused_baseline_changed"
    | "producer_refused_capture"
    | "producer_runtime_unavailable"
    | "producer_already_present"
    | "producer_invalid_binding"
    | "producer_unexpected_status"
    | "receipt_binding_mismatch"
    | "receipt_schema_invalid"
    | "receipt_incomplete";
  exceptionName?:
    | "Error"
    | "TypeError"
    | "ReferenceError"
    | "SecurityError"
    | "NotAllowedError"
    | "UnknownError";
};

const flowDebuggerOwnedTabs = new Set<number>();
let flowDebuggerDetachEventSource: unknown;

function trackFlowDebuggerOwnership(): void {
  if (
    typeof chrome === "undefined" ||
    !chrome.debugger?.onDetach ||
    flowDebuggerDetachEventSource === chrome.debugger
  )
    return;
  flowDebuggerDetachEventSource = chrome.debugger;
  chrome.debugger.onDetach.addListener((source) => {
    if (typeof source.tabId === "number")
      flowDebuggerOwnedTabs.delete(source.tabId);
  });
}

const flowArmExceptionName = (
  error: unknown,
): NonNullable<FlowObservationArmDiagnostic["exceptionName"]> => {
  const name = error instanceof Error ? error.name : "";
  return (
    (
      [
        "Error",
        "TypeError",
        "ReferenceError",
        "SecurityError",
        "NotAllowedError",
        "UnknownError",
      ] as const
    ).find((candidate) => candidate === name) ?? "UnknownError"
  );
};

export function createChromeFlowImageGenerateOncePort(
  repositories: ExtensionRepositories,
): FlowImageGenerateOncePort {
  const base = createChromeFlowPromptEntryPort(repositories);
  // Chrome permits a debugger session only after the extension has attached.
  // Track attachments created by this adapter so GenerateOnce can share its
  // lease with in-handler checks, while later observation messages acquire a
  // short, owned lease of their own. Acquisition is the ownership proof:
  // getTargets() reports attachment, not which client owns it.
  const attachDebugger = async (tabId: number) => {
    try {
      await base.attach(tabId);
    } catch {
      const error = new Error("flow_debugger_attach_refused");
      error.name = "FlowDebuggerAttachError";
      throw error;
    }
  };
  const detachDebugger = async (tabId: number) => {
    if (!flowDebuggerOwnedTabs.has(tabId)) return;
    try {
      await base.detach(tabId);
    } catch {
      const error = new Error("flow_debugger_detach_failed");
      error.name = "FlowDebuggerDetachError";
      throw error;
    }
  };
  const bindBrowserDocument = async (
    tabId: number,
    frame: FlowDocumentBinding | undefined,
  ): Promise<FlowDocumentBinding | undefined> => {
    if (!frame || typeof chrome === "undefined" || !chrome.scripting) {
      return undefined;
    }
    const injections = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => location.href,
    });
    const document = injections[0];
    if (
      !document?.documentId ||
      document.frameId !== 0 ||
      typeof document.result !== "string" ||
      flowTabFromUrl(tabId, "", document.result)?.canonicalTarget !==
        flowTabFromUrl(tabId, "", frame.url)?.canonicalTarget
    ) {
      return undefined;
    }
    return {
      ...frame,
      documentId: document.documentId,
      senderFrameId: document.frameId,
    };
  };
  const captureBoundFrame = async (tabId: number) => {
    const bound = await bindBrowserDocument(
      tabId,
      await captureFlowDocumentBinding(base, tabId),
    );
    if (!bound) throw new Error("flow_document_identity_unavailable");
    return bound;
  };
  const readBoundFrame = async (tabId: number) => {
    let frame: FlowDocumentBinding | undefined;
    const acquiredHere = !flowDebuggerOwnedTabs.has(tabId);
    try {
      if (acquiredHere) await attachDebugger(tabId);
      frame = await readFlowDocumentBinding(base, tabId);
    } catch (cause) {
      const causeName = cause instanceof Error ? cause.name : "";
      if (causeName === "FlowDebuggerAttachError") throw cause;
      const error = new Error("flow_frame_tree_read_failed");
      error.name = "FlowFrameTreeReadError";
      throw error;
    } finally {
      if (acquiredHere && flowDebuggerOwnedTabs.has(tabId)) {
        await detachDebugger(tabId);
      }
    }
    try {
      return await bindBrowserDocument(tabId, frame);
    } catch {
      const error = new Error("flow_browser_document_probe_failed");
      error.name = "FlowDocumentProbeError";
      throw error;
    }
  };
  const installScopeAnalyzer = async (
    tabId: number,
    binding: FlowImageObservationArmBinding,
  ): Promise<FlowObservationArmDiagnostic | undefined> => {
    if (!chrome.scripting?.executeScript)
      return { phase: "scope_install", reason: "scripting_unavailable" };
    const results = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [binding.documentId] },
      world: "ISOLATED",
      func: flowWorkspaceScopeAnalyzer,
      args: [binding.canonicalTarget, binding.projectId, true],
    });
    const result = results[0];
    const diagnostic = result?.result as
      { status?: string; captureGaps?: string[] } | undefined;
    if (!result) return { phase: "scope_install", reason: "result_missing" };
    if (result.documentId !== binding.documentId)
      return { phase: "scope_install", reason: "document_mismatch" };
    if (result.frameId !== binding.senderFrameId)
      return { phase: "scope_install", reason: "frame_mismatch" };
    if (diagnostic?.status !== "ready")
      return { phase: "scope_install", reason: "scope_not_ready" };
    if (diagnostic.captureGaps?.length)
      return { phase: "scope_install", reason: "scope_capture_gaps" };
    return undefined;
  };
  const parseArmReceipt = (
    result: chrome.scripting.InjectionResult<unknown> | undefined,
    binding: FlowImageObservationArmBinding,
  ): {
    receipt?: import("../../domain/jobs/results").FlowImageObservationArmReceipt;
    diagnostic?: FlowObservationArmDiagnostic;
  } => {
    const receipt = result?.result as Record<string, unknown> | undefined;
    if (!result)
      return {
        diagnostic: { phase: "receipt_validation", reason: "result_missing" },
      };
    if (result.documentId !== binding.documentId)
      return {
        diagnostic: {
          phase: "receipt_validation",
          reason: "document_mismatch",
        },
      };
    if (result.frameId !== binding.senderFrameId)
      return {
        diagnostic: { phase: "receipt_validation", reason: "frame_mismatch" },
      };
    if (!receipt)
      return {
        diagnostic: { phase: "receipt_validation", reason: "result_missing" },
      };
    const validBinding = Boolean(
      result.documentId === binding.documentId &&
      result.frameId === binding.senderFrameId &&
      receipt.status === "armed" &&
      receipt.attemptId === binding.attemptId &&
      receipt.sessionId === binding.sessionId &&
      receipt.projectId === binding.projectId &&
      receipt.tabId === binding.tabId &&
      receipt.frameId === binding.frameId &&
      receipt.documentId === binding.documentId &&
      receipt.sourceHash === binding.sourceHash &&
      receipt.sourceSnapshotId === binding.sourceSnapshotId &&
      receipt.sourceBaselineFingerprint === binding.sourceBaselineFingerprint &&
      receipt.buildId === binding.buildId &&
      receipt.protocolVersion === binding.protocolVersion &&
      typeof receipt.captureFingerprint === "string" &&
      /^[0-9a-f]{64}$/.test(receipt.captureFingerprint) &&
      typeof receipt.listenerRoots === "number" &&
      receipt.listenerRoots > 0 &&
      receipt.baseline !== null &&
      typeof receipt.baseline === "object",
    );
    if (!validBinding)
      return {
        diagnostic: {
          phase: "receipt_validation",
          reason: "receipt_binding_mismatch",
        },
      };
    if (typeof receipt.capturedAt !== "number")
      return {
        diagnostic: {
          phase: "receipt_validation",
          reason: "receipt_schema_invalid",
        },
      };
    const armReceipt = FlowImageObservationArmReceiptSchema.safeParse({
      capturedAt: receipt.capturedAt,
      sourceBaselineFingerprint: receipt.sourceBaselineFingerprint,
      captureFingerprint: receipt.captureFingerprint,
      listenerRootCount: receipt.listenerRoots,
      baseline: receipt.baseline,
    });
    if (!armReceipt.success)
      return {
        diagnostic: {
          phase: "receipt_validation",
          reason: "receipt_schema_invalid",
        },
      };
    const capturedBaseline = armReceipt.data.baseline;
    if (
      !capturedBaseline.completeForRenderedScope ||
      capturedBaseline.captureGaps.length > 0 ||
      capturedBaseline.unidentifiedImageCount > 0 ||
      capturedBaseline.identityCandidatesTruncated
    )
      return {
        diagnostic: {
          phase: "receipt_validation",
          reason: "receipt_incomplete",
        },
      };
    return { receipt: armReceipt.data };
  };
  return {
    ...base,
    attach: attachDebugger,
    detach: detachDebugger,
    captureFrame: captureBoundFrame,
    readFrame: readBoundFrame,
    inspectGenerate: (tabId, prompt) =>
      inspectFlowImageGenerate(base, tabId, prompt),
    recheckGenerate: (tabId, prompt, frame, button, baseline) =>
      recheckFlowImageGenerate(base, tabId, prompt, frame, button, baseline),
    buttonPosition: (tabId, button) =>
      inspectFlowImageButton(base, tabId, button),
    activate: (tabId, position) =>
      activateFlowImageGenerate(base, tabId, position.x, position.y),
    productionObservationSupported: true,
    startObservation: async (tabId, binding) => {
      if (tabId !== binding.tabId)
        return {
          status: "unsupported",
          diagnostic: { phase: "scope_install", reason: "wrong_tab" },
        };
      if (!chrome.scripting?.executeScript)
        return {
          status: "unsupported",
          diagnostic: {
            phase: "scope_install",
            reason: "scripting_unavailable",
          },
        };
      let phase: FlowObservationArmDiagnostic["phase"] = "scope_install";
      try {
        const scopeDiagnostic = await installScopeAnalyzer(tabId, binding);
        if (scopeDiagnostic)
          return { status: "unsupported", diagnostic: scopeDiagnostic };
        phase = "arm_injection";
        const results = await chrome.scripting.executeScript(
          createFlowObservationInjection(binding, "arm"),
        );
        const armResult = results[0];
        const parsed = parseArmReceipt(armResult, binding);
        if (parsed.receipt)
          return { status: "started", receipt: parsed.receipt };
        if (
          (armResult?.result as { status?: string } | undefined)?.status ===
          "armed"
        ) {
          await chrome.scripting.executeScript(
            createFlowObservationInjection(binding, "stop"),
          );
        }
        const armStatus = armResult?.result as
          { status?: string; reason?: string } | undefined;
        const refusalReason: FlowObservationArmDiagnostic["reason"] =
          armStatus?.status === "arm_refused"
            ? armStatus.reason === "baseline_changed_during_arm"
              ? "producer_refused_baseline_changed"
              : armStatus.reason === "scope_refused"
                ? "producer_refused_scope"
                : "producer_refused_capture"
            : armStatus?.status === "runtime_unavailable"
              ? "producer_runtime_unavailable"
              : armStatus?.status === "observer_already_present"
                ? "producer_already_present"
                : armStatus?.status === "invalid_binding_or_frame"
                  ? "producer_invalid_binding"
                  : armStatus?.status
                    ? "producer_unexpected_status"
                    : (parsed.diagnostic?.reason ?? "result_missing");
        return {
          status: "unsupported",
          diagnostic: {
            phase: armStatus?.status
              ? "arm_injection"
              : (parsed.diagnostic?.phase ?? phase),
            reason: refusalReason,
          },
        };
      } catch (error) {
        return {
          status: "unsupported",
          diagnostic: {
            phase,
            reason: "injection_exception",
            exceptionName: flowArmExceptionName(error),
          },
        };
      }
    },
    activateObservation: async (tabId, binding) => {
      if (tabId !== binding.tabId || !chrome.scripting?.executeScript)
        return "unsupported";
      try {
        const results = await chrome.scripting.executeScript(
          createFlowObservationInjection(binding, "activate"),
        );
        const result = results[0];
        return result?.documentId === binding.documentId &&
          result.frameId === binding.senderFrameId &&
          (result.result as { status?: string; sequence?: number } | undefined)
            ?.status === "active" &&
          (result.result as { sequence?: number } | undefined)?.sequence === 1
          ? "started"
          : "unsupported";
      } catch {
        return "unsupported";
      }
    },
    resumeObservation: async (tabId, binding) => {
      if (tabId !== binding.tabId || !chrome.scripting?.executeScript)
        return "unsupported";
      try {
        const results = await chrome.scripting.executeScript(
          createFlowObservationInjection(binding, "resume"),
        );
        const result = results[0];
        return result?.documentId === binding.documentId &&
          result.frameId === binding.senderFrameId &&
          (result.result as { status?: string } | undefined)?.status ===
            "resumed"
          ? "resumed"
          : "unsupported";
      } catch {
        return "unsupported";
      }
    },
    stopObservation: async (tabId, binding) => {
      if (tabId !== binding.tabId || !chrome.scripting?.executeScript) return;
      await chrome.scripting
        .executeScript(createFlowObservationInjection(binding, "stop"))
        .catch(() => undefined);
    },
  };
}

type FlowImageGenerateOnceInput = {
  workspaceId: string;
  promptHash: string;
  settingsConfirmation: FlowSettingsConfirmation;
  countMode: import("../../domain/jobs/results").FlowImageCountModeRequest;
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
  createObservationSessionId?: () => string;
  /** Synthetic-only switch for offline lifecycle fixtures. Worker default stays unsupported. */
  observationProfileSupported?: boolean;
};

type FlowImageGenerateOnceResult = {
  state: "dispatched" | "failed-before-dispatch" | "uncertain" | "blocked";
  failureStage?: FlowImageAttemptStage;
  providerOutcome: "not_started" | "unknown" | "unverified";
  attemptId?: string;
  code: string;
  message: string;
  pressAttempted?: boolean;
  releaseAttempted?: boolean;
  activationCount?: number;
  storageFailure?: {
    operation: string;
    exceptionClass: string;
    schemaIssuePaths?: string[];
    schemaIssueCodes?: string[];
    attemptStateBeforeFailure?: FlowImageAttemptRecord["state"];
    failedWriteOutcome?: "validation_rejected_before_put" | "unknown";
    failureRecordPersistence?:
      "confirmed" | "not_applicable" | "not_attempted" | "failed";
  };
  generationAvailable: true;
};

export function createFlowImageGenerateOnce(
  dependencies: FlowImageGenerateOnceDependencies,
): (input: FlowImageGenerateOnceInput) => Promise<FlowImageGenerateOnceResult> {
  return async (input) => {
    const now = dependencies.now ?? Date.now;
    const makeId = dependencies.createAttemptId ?? (() => crypto.randomUUID());
    const makeObservationSessionId =
      dependencies.createObservationSessionId ?? (() => crypto.randomUUID());
    const port = dependencies.port;
    let attempt: FlowImageAttemptRecord | undefined;
    let attached = false;
    let attachedTabId: number | undefined;
    let activationStarted = false;
    let activationObserved = false;
    let pressAttempted = false;
    let releaseAttempted = false;
    let currentStage: FlowImageAttemptStage = "preparation";
    let observationArmed = false;
    let observationArmBinding: FlowImageObservationArmBinding | undefined;
    let observationArmDiagnostic: FlowObservationArmDiagnostic | undefined;
    let storageOperation = "unclassified_storage_operation";
    let storageFailure: FlowImageGenerateOnceResult["storageFailure"];
    let failureRecordPersistence: NonNullable<
      FlowImageGenerateOnceResult["storageFailure"]
    >["failureRecordPersistence"] = "not_applicable";

    const captureStorageFailure = (error: unknown) => {
      if (storageFailure) return;
      const exceptionClass =
        error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
          ? error.name
          : "Error";
      const validationError =
        error instanceof FlowImageAttemptValidationError ? error : undefined;
      storageFailure = {
        operation: storageOperation,
        exceptionClass,
        ...(validationError?.schemaIssuePaths.length
          ? { schemaIssuePaths: validationError.schemaIssuePaths.slice(0, 16) }
          : {}),
        ...(validationError?.schemaIssueCodes.length
          ? { schemaIssueCodes: validationError.schemaIssueCodes.slice(0, 16) }
          : {}),
        ...(attempt ? { attemptStateBeforeFailure: attempt.state } : {}),
        ...(validationError?.schemaIssuePaths.length
          ? { failedWriteOutcome: "validation_rejected_before_put" as const }
          : { failedWriteOutcome: "unknown" as const }),
      };
    };

    const response = (
      state: FlowImageGenerateOnceResult["state"],
      code: string,
      message: string,
      failureStage = currentStage,
    ): FlowImageGenerateOnceResult => ({
      state,
      ...(state === "dispatched" ? {} : { failureStage }),
      providerOutcome:
        state === "dispatched"
          ? "unverified"
          : state === "uncertain"
            ? "unknown"
            : "not_started",
      ...(attempt ? { attemptId: attempt.attemptId } : {}),
      ...(storageFailure
        ? { storageFailure: { ...storageFailure, failureRecordPersistence } }
        : {}),
      code,
      message,
      ...(!activationStarted
        ? { pressAttempted: false, releaseAttempted: false, activationCount: 0 }
        : activationObserved
          ? {
              pressAttempted,
              releaseAttempted,
              activationCount: pressAttempted ? 1 : 0,
            }
          : {}),
      generationAvailable: true,
    });

    const failBefore = async (
      code: string,
      message: string,
      failureStage = currentStage,
    ): Promise<FlowImageGenerateOnceResult> => {
      if (observationArmed && attempt && observationArmBinding) {
        await port
          .stopObservation(attempt.tabId, observationArmBinding)
          .catch(() => undefined);
        observationArmed = false;
      }
      let failureRecordPersisted = !attempt;
      if (!attempt) failureRecordPersistence = "not_attempted";
      if (attempt && !activationStarted) {
        const expected = attempt.state;
        if (
          expected === "preparing" ||
          expected === "verified" ||
          expected === "dispatch-intent"
        ) {
          try {
            storageOperation = "persist_pre_dispatch_failure_state";
            attempt =
              await dependencies.repositories.transitionFlowImageAttempt({
                attemptId: attempt.attemptId,
                expected,
                next: "failed-before-dispatch",
                event: {
                  stage: failureStage,
                  at: now(),
                  method: "none",
                  code:
                    code === "observation_start_unsupported" &&
                    observationArmDiagnostic
                      ? `observer_${observationArmDiagnostic.phase}_${observationArmDiagnostic.reason}`
                      : code,
                },
                ...(attempt.observationSession &&
                (attempt.observationSession.status === "arming" ||
                  attempt.observationSession.status === "active")
                  ? {
                      observationSession: {
                        ...attempt.observationSession,
                        status: "closed" as const,
                      },
                      resultOutcome: {
                        status: "unknown" as const,
                        reason: "observation_not_started" as const,
                        declaredVariantCount:
                          attempt.settingsConfirmation.declaredVariantCount,
                        observedSucceededCount: 0,
                        observedFailedCount: 0,
                        updatedAt: now(),
                      },
                    }
                  : {}),
              });
            failureRecordPersisted = true;
            failureRecordPersistence = "confirmed";
          } catch (error) {
            // Keeping an active persisted state blocks replay if storage failed.
            failureRecordPersistence = "failed";
            captureStorageFailure(error);
          }
        }
      }
      if (!failureRecordPersisted) {
        return response(
          "blocked",
          "pre_dispatch_failure_record_failed",
          "No Generate input was sent, but the failure could not be durably recorded. The existing attempt remains blocking; inspect its durable status before continuing.",
          "storage",
        );
      }
      return response("failed-before-dispatch", code, message, failureStage);
    };

    const markUncertain = async (code: string) => {
      if (!attempt || attempt.state !== "dispatch-intent") return;
      try {
        storageOperation = "persist_uncertain_attempt_state";
        attempt = await dependencies.repositories.transitionFlowImageAttempt({
          attemptId: attempt.attemptId,
          expected: "dispatch-intent",
          next: "uncertain",
          event: {
            stage: currentStage,
            at: now(),
            method: "CDP Input.dispatchMouseEvent",
            code,
          },
          resultOutcome: {
            status: "unknown",
            reason: "observation_lost",
            declaredVariantCount:
              attempt.settingsConfirmation.declaredVariantCount,
            observedSucceededCount:
              attempt.resultOutcome?.observedSucceededCount ?? 0,
            observedFailedCount:
              attempt.resultOutcome?.observedFailedCount ?? 0,
            updatedAt: now(),
          },
          observationSession: attempt.observationSession
            ? { ...attempt.observationSession, status: "lost" }
            : undefined,
        });
      } catch (error) {
        // The durable dispatch-intent remains active and restart reconciliation
        // will move it to uncertain. It can never authorize replay.
        captureStorageFailure(error);
      }
    };

    try {
      if (
        !Number.isInteger(input.settingsConfirmation.declaredVariantCount) ||
        input.settingsConfirmation.declaredVariantCount < 1 ||
        input.settingsConfirmation.declaredVariantCount > 100
      ) {
        return response(
          "blocked",
          "variant_declaration_missing",
          "Enter and confirm the variant count you manually selected in Flow before generating.",
        );
      }
      if (
        !input.countMode ||
        !/^[0-9a-f-]{36}$/i.test(input.countMode.countSessionId) ||
        (input.countMode.mode === "existing_project" &&
          input.countMode.userConfirmed !== true)
      ) {
        return response(
          "blocked",
          "count_baseline_declaration_invalid",
          "Choose New empty project or confirm the existing project image count before Generate.",
        );
      }
      currentStage = "preflight";
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
      currentStage = "storage";
      storageOperation = "read_selected_flow_target";
      const selectedRecord =
        await dependencies.repositories.getSelectedTarget("Flow");
      currentStage = "preflight";
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
      const connectionBinding = selectedRecord.verificationBinding;
      if (
        selectedRecord.verification !== "verified" ||
        selectedRecord.connectionState !== "verified" ||
        selectedRecord.reconnectEnabled === false ||
        !connectionBinding ||
        connectionBinding.provider !== "Flow" ||
        connectionBinding.tabId !== selected.tabId ||
        connectionBinding.canonicalTarget !== selected.canonicalTarget ||
        connectionBinding.extensionBuildId !== BUILD_ID ||
        connectionBinding.connectorBuildId !== BUILD_ID ||
        connectionBinding.extensionProtocolVersion !== PROTOCOL_VERSION ||
        connectionBinding.connectorProtocolVersion !== 1
      ) {
        return response(
          "blocked",
          "flow_connection_unverified",
          "The selected Flow connection is not verified for this extension build. Recheck the same selected project before generating.",
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
      currentStage = "storage";
      storageOperation = "read_saved_image_batch";
      const snapshot = await dependencies.repositories.getPromptBatch(
        input.workspaceId,
        "image",
      );
      currentStage = "preflight";
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
      if (!frame.documentId || frame.senderFrameId !== 0) {
        return response(
          "blocked",
          "browser_document_identity_unavailable",
          "The selected Flow document identity could not be verified. Generate was not activated.",
          "observer",
        );
      }
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
      storageOperation = "read_count_session_attempts";
      const allCountAttempts =
        await dependencies.repositories.getAllFlowImageAttempts();
      const priorCountAttempts = allCountAttempts.filter(
        (candidate) =>
          candidate.countSessionId === input.countMode.countSessionId,
      );
      const duplicateInProgress = priorCountAttempts.find(
        (candidate) =>
          candidate.itemId === item.id &&
          candidate.promptHash === item.contentHash &&
          candidate.state !== "failed-before-dispatch",
      );
      if (duplicateInProgress) {
        return response(
          "blocked",
          "attempt_already_active",
          "This exact saved image source already has an active or dispatched attempt. Inspect it; this action will not replay Generate.",
        );
      }
      const unresolvedProjectCountAttempt = allCountAttempts.find(
        (candidate) =>
          candidate.countSessionId !== undefined &&
          candidate.projectId === target.projectId &&
          candidate.tabId === target.id &&
          candidate.documentId === frame.documentId &&
          candidate.state !== "failed-before-dispatch" &&
          !(
            candidate.state === "dispatched" &&
            candidate.countDecision?.status === "count_matched"
          ),
      );
      if (unresolvedProjectCountAttempt) {
        return response(
          "blocked",
          "count_session_paused",
          "An earlier count observation for this exact Flow document is unresolved. Inspect that durable attempt before starting another count session; this action will not replay or bypass it.",
        );
      }
      if (
        priorCountAttempts.some(
          (candidate) =>
            candidate.countBaseline !== undefined &&
            (candidate.projectId !== target.projectId ||
              candidate.tabId !== target.id ||
              candidate.documentId !== frame.documentId ||
              candidate.buildId !== BUILD_ID ||
              candidate.protocolVersion !== PROTOCOL_VERSION ||
              candidate.countBaseline.mode !== input.countMode.mode ||
              candidate.countBaseline.startingImageCount !==
                input.countMode.startingImageCount),
        )
      ) {
        return response(
          "blocked",
          "count_session_binding_changed",
          "This count session belongs to another project or document. Start a fresh count session using the current project baseline.",
        );
      }
      const unresolvedCountAttempt = priorCountAttempts.find(
        (candidate) =>
          candidate.state !== "failed-before-dispatch" &&
          !(
            candidate.state === "dispatched" &&
            candidate.countDecision?.status === "count_matched"
          ),
      );
      if (unresolvedCountAttempt) {
        return response(
          "blocked",
          "count_session_paused",
          "A prior prompt in this count session is unresolved or ambiguous. Inspect that attempt; this action will not dispatch another prompt.",
        );
      }
      const priorMatchedAttempts = priorCountAttempts.filter(
        (candidate) =>
          candidate.state === "dispatched" &&
          candidate.countDecision?.status === "count_matched",
      );
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
      currentStage = "storage";
      storageOperation = "create_attempt_and_source_snapshot";
      try {
        attempt = await dependencies.repositories.createFlowImageAttempt({
          attemptId: makeId(),
          confirmationKey: await flowImageAttemptConfirmationKey(
            input.settingsConfirmation.confirmationId,
            item.contentHash,
          ),
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
          documentId: frame.documentId,
          senderFrameId: frame.senderFrameId,
          buildId: BUILD_ID,
          protocolVersion: PROTOCOL_VERSION,
          settingsConfirmation: {
            confirmationId: input.settingsConfirmation.confirmationId,
            confirmedAt: input.settingsConfirmation.confirmedAt,
            userAttested: true,
            tabId: input.settingsConfirmation.tabId,
            projectId: input.settingsConfirmation.projectId,
            canonicalTarget: input.settingsConfirmation.canonicalTarget,
            declaredVariantCount:
              input.settingsConfirmation.declaredVariantCount,
          },
          countSessionId: input.countMode.countSessionId,
          state: "preparing",
          activeKey: flowImageAttemptActiveKey(item.id, item.contentHash),
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
        if (error instanceof FlowCountSessionActiveError) {
          return response(
            "blocked",
            "count_session_paused",
            "A prior prompt in this count session is unresolved. Inspect its durable count decision; Generate was not activated.",
          );
        }
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
        captureStorageFailure(error);
        return response(
          "blocked",
          "preparation_persist_failed",
          "The preparation intent could not be stored. Generate was not activated.",
        );
      }

      let promptSource: string;
      currentStage = "preparation";
      try {
        currentStage = "storage";
        storageOperation = "read_immutable_source_snapshot";
        const persistedSource =
          await dependencies.repositories.getFlowImagePromptSnapshot(
            attempt.sourceSnapshotId,
          );
        currentStage = "preparation";
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
      } catch (error) {
        captureStorageFailure(error);
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
      currentStage = "storage";
      storageOperation = "transition_preparing_to_verified";
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

      currentStage = "preflight";
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
      currentStage = "observer";
      const discovery = await port.inspectGenerate(target.id, promptSource);
      const preflightError = discoveryFailure(discovery);
      if (preflightError) {
        return failBefore(
          preflightError.code,
          preflightError.message,
          preflightError.failureStage,
        );
      }
      const baseline = discovery.baseline!;
      const baselineIsEmpty =
        "kind" in baseline && baseline.kind === "flow_empty_workspace_ui";
      if (
        input.countMode.mode === "new_empty_project" &&
        priorMatchedAttempts.length === 0 &&
        !baselineIsEmpty
      ) {
        return failBefore(
          "new_empty_project_baseline_mismatch",
          "New empty project mode requires the supported observed empty UI. Choose Existing project and attest its starting image count, or select an empty Flow project.",
        );
      }
      const resultBaseline = captureFlowResultBaseline(
        baseline,
        {
          workspaceId: attempt.workspaceId,
          batchId: attempt.batchId,
          itemId: attempt.itemId,
          sourceHash: attempt.promptHash,
          sourceSnapshotId: attempt.sourceSnapshotId,
          attemptId: attempt.attemptId,
          provider: attempt.provider,
          projectId: attempt.projectId,
          tabId: attempt.tabId,
          frameId: attempt.frameId,
          loaderId: attempt.loaderId,
        },
        {
          buildId: attempt.buildId,
          protocolVersion: attempt.protocolVersion,
        },
        input.settingsConfirmation.declaredVariantCount,
      );
      const observationProfileSupport = dependencies.observationProfileSupported
        ? ("fixture_supported" as const)
        : port.productionObservationSupported
          ? ("production_observation_only" as const)
          : ("unsupported" as const);
      const observationSession = {
        sessionId: makeObservationSessionId(),
        documentId: frame.documentId,
        senderFrameId: frame.senderFrameId,
        startedAt: now(),
        deadlineAt: now() + 5 * 60_000,
        maxEvents: 64,
        profileSupport: observationProfileSupport,
        status:
          observationProfileSupport !== "unsupported"
            ? ("arming" as const)
            : ("unsupported" as const),
        lastSequence: 0,
        reconciliationCount: 0,
      };
      const resultOutcome =
        observationProfileSupport !== "unsupported"
          ? {
              status: "awaiting_evidence" as const,
              declaredVariantCount:
                input.settingsConfirmation.declaredVariantCount,
              observedSucceededCount: 0,
              observedFailedCount: 0,
              updatedAt: now(),
            }
          : {
              status: "unknown" as const,
              reason: "live_profile_unsupported" as const,
              declaredVariantCount:
                input.settingsConfirmation.declaredVariantCount,
              observedSucceededCount: 0,
              observedFailedCount: 0,
              updatedAt: now(),
            };
      const buttonId = discovery.buttonObjectId!;
      currentStage = "preflight";
      if (!(await currentFlowBinding(port, selected, target, frame))) {
        return failBefore(
          "document_binding_changed",
          "The selected Flow document changed during final preflight. Generate was not activated.",
        );
      }
      currentStage = "observer";
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
      currentStage = "preflight";
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

      currentStage = "storage";
      storageOperation = "transition_verified_to_dispatch_intent";
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
        resultBaseline,
        observationSession,
        resultOutcome,
      });
      if (
        !flowResultBaselineMatchesAttempt(attempt.resultBaseline, attempt) ||
        !flowResultBaselineMatchesProfile(attempt.resultBaseline, baseline)
      ) {
        return failBefore(
          "result_baseline_binding_mismatch",
          "The persisted result baseline no longer matches this attempt and observation profile. No Generate input was sent.",
        );
      }

      if (observationSession.profileSupport !== "unsupported") {
        currentStage = "observer";
        const sourceBaselineFingerprint = await sha256Hex(
          flowImageResultBaselineFingerprintInput(attempt.resultBaseline!),
        );
        const armBinding: FlowImageObservationArmBinding = {
          workspaceId: attempt.workspaceId,
          batchId: attempt.batchId,
          itemId: attempt.itemId,
          sourceHash: attempt.promptHash,
          sourceSnapshotId: attempt.sourceSnapshotId,
          sourceBaselineFingerprint,
          attemptId: attempt.attemptId,
          provider: attempt.provider,
          projectId: attempt.projectId,
          canonicalTarget:
            attempt.settingsConfirmation.canonicalTarget ??
            selected.canonicalTarget,
          tabId: attempt.tabId,
          frameId: attempt.frameId,
          loaderId: attempt.loaderId,
          documentId: attempt.documentId!,
          senderFrameId: attempt.senderFrameId!,
          sessionId: observationSession.sessionId,
          startedAt: observationSession.startedAt,
          deadlineAt: observationSession.deadlineAt,
          maxEvents: observationSession.maxEvents,
          buildId: attempt.buildId,
          protocolVersion: attempt.protocolVersion,
        };
        observationArmBinding = armBinding;
        const armed = await port.startObservation(attempt.tabId, armBinding);
        const armReceiptResult =
          typeof armed === "object" && armed.status === "started"
            ? FlowImageObservationArmReceiptSchema.safeParse(armed.receipt)
            : undefined;
        const armReceipt =
          armReceiptResult?.success === true
            ? armReceiptResult.data
            : undefined;
        const armReceiptMatchesAttempt = Boolean(
          armReceipt &&
          armReceipt.sourceBaselineFingerprint ===
            armBinding.sourceBaselineFingerprint &&
          armReceipt.listenerRootCount > 0 &&
          armReceipt.baseline.completeForRenderedScope &&
          armReceipt.baseline.captureGaps.length === 0 &&
          armReceipt.baseline.unidentifiedImageCount === 0 &&
          !armReceipt.baseline.identityCandidatesTruncated &&
          (input.countMode.mode !== "existing_project" ||
            Array.isArray(armReceipt.baseline.qualifyingCandidateIds)),
        );
        observationArmed =
          armed === "started" ||
          (typeof armed === "object" && armed.status === "started");
        if (
          (armed !== "started" &&
            !(typeof armed === "object" && armed.status === "started")) ||
          (observationSession.profileSupport ===
            "production_observation_only" &&
            !armReceiptMatchesAttempt)
        ) {
          observationArmDiagnostic =
            typeof armed === "object" && armed.status === "unsupported"
              ? armed.diagnostic
              : typeof armed === "object" && armed.status === "started"
                ? {
                    phase: "receipt_validation",
                    reason: !armReceipt
                      ? "receipt_schema_invalid"
                      : armReceipt.sourceBaselineFingerprint !==
                          armBinding.sourceBaselineFingerprint
                        ? "receipt_binding_mismatch"
                        : "receipt_incomplete",
                  }
                : undefined;
          return failBefore(
            "observation_start_unsupported",
            "The bound Flow observer could not start. Generate was not activated.",
          );
        }
        if (!armReceipt) {
          return failBefore(
            "count_baseline_capture_missing",
            "The bound observer did not return its scoped candidate and tile baseline. Generate was not activated.",
          );
        }
        const countBaseline: NonNullable<
          FlowImageAttemptRecord["countBaseline"]
        > = {
          ...(input.countMode.mode === "new_empty_project"
            ? {
                mode: "new_empty_project" as const,
                countSessionId: input.countMode.countSessionId,
                startingImageCount: 0 as const,
                provenance: "observed_empty_ui_scope" as const,
              }
            : {
                mode: "existing_project" as const,
                countSessionId: input.countMode.countSessionId,
                startingImageCount: input.countMode.startingImageCount,
                provenance: "user_attested_existing_image_count" as const,
                inventoryComplete: false as const,
              }),
          projectId: target.projectId,
          canonicalTarget: target.canonicalTarget,
          tabId: target.id,
          documentId: frame.documentId,
          buildId: BUILD_ID,
          protocolVersion: PROTOCOL_VERSION,
          capturedAt: armReceipt.capturedAt,
          baselineCandidateIds: armReceipt.baseline.candidateIds,
          qualifyingBaselineCandidateIds:
            armReceipt.baseline.qualifyingCandidateIds,
          baselineTileTokens: armReceipt.baseline.tileTokens,
          virtualScrollContainerCount:
            armReceipt.baseline.virtualScrollContainerCount ?? 0,
          virtualizationEvidence:
            armReceipt.baseline.virtualizationEvidence ?? [],
          virtualized: armReceipt.baseline.virtualized,
          renderedScopeComplete: armReceipt.baseline.completeForRenderedScope,
          captureGaps: armReceipt.baseline.captureGaps,
          priorMatchedAttemptIds: priorMatchedAttempts.map(
            (candidate) => candidate.attemptId,
          ),
          priorMatchedCandidateIds: priorMatchedAttempts.flatMap(
            (candidate) =>
              candidate.countDecision?.observedEligibleCandidateIds ?? [],
          ),
          priorDeclaredAdditions: priorMatchedAttempts.reduce(
            (sum, candidate) =>
              sum + (candidate.settingsConfirmation.declaredVariantCount ?? 0),
            0,
          ),
        };
        const initialCountDecision = reduceFlowImageCountDecision({
          declaration: countBaseline,
          declaredVariantCount: input.settingsConfirmation.declaredVariantCount,
          expectedCumulativeAdditions:
            countBaseline.priorDeclaredAdditions +
            input.settingsConfirmation.declaredVariantCount,
          priorMatchedAttemptIds: countBaseline.priorMatchedAttemptIds,
          resultBaseline: attempt.resultBaseline!,
          events: [],
          now: now(),
        });
        if (
          initialCountDecision.status === "blocked" ||
          initialCountDecision.status === "ambiguous"
        ) {
          return failBefore(
            initialCountDecision.reason ?? "count_baseline_ambiguous",
            initialCountDecision.reason === "existing_project_virtualized"
              ? "The baseline shows actual scrolling or candidate ownership continuity is unresolved. Count mode is paused; Generate was not activated."
              : initialCountDecision.reason ===
                  "existing_count_candidate_count_mismatch"
                ? "The user-attested starting count does not match the number of distinct visible, ready, tile-owned baseline candidates. Recheck the count or project before continuing."
                : "The selected project does not have a complete supported count baseline. Generate was not activated.",
          );
        }
        storageOperation = "persist_observation_session_and_count_baseline";
        attempt =
          await dependencies.repositories.updateFlowImageObservationSession({
            attemptId: attempt.attemptId,
            sessionId: observationSession.sessionId,
            sessionStatus: "active",
            ...(armReceipt ? { armReceipt } : {}),
            countBaseline,
            countDecision: initialCountDecision,
          });
        const activated = await port.activateObservation(
          attempt.tabId,
          armBinding,
        );
        if (activated !== "started") {
          return failBefore(
            "observation_activation_unsupported",
            "The bound Flow observer could not deliver its baseline. Generate was not activated.",
          );
        }
      }

      currentStage = "observer";
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
      currentStage = "preflight";
      const finalPosition = await port.buttonPosition(target.id, buttonId);
      if (!finalPosition) {
        return failBefore(
          "generate_control_lost",
          "The Generate control was lost before activation. No Generate input was sent.",
        );
      }
      if (
        !flowResultBaselineMatchesAttempt(attempt.resultBaseline, attempt) ||
        !flowResultBaselineMatchesProfile(attempt.resultBaseline, baseline)
      ) {
        return failBefore(
          "result_baseline_binding_mismatch",
          "The result baseline binding changed before activation. No Generate input was sent.",
        );
      }

      currentStage = "storage";
      storageOperation = "persist_count_dispatch_boundary";
      attempt =
        await dependencies.repositories.recordFlowImageCountDispatchBoundary({
          attemptId: attempt.attemptId,
          boundaryAt: now(),
        });

      currentStage = "dispatch";
      activationStarted = true;
      const activation = await port.activate(target.id, finalPosition);
      activationObserved = true;
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
      currentStage = "observer";
      let postDispatchBinding: boolean;
      try {
        postDispatchBinding = await currentFlowBinding(
          port,
          selected,
          target,
          frame,
        );
      } catch {
        postDispatchBinding = false;
      }
      if (!postDispatchBinding) {
        await markUncertain("post_dispatch_observation_unavailable");
        return response(
          "uncertain",
          "post_dispatch_observation_unavailable",
          "The activation pair was sent, but the selected document could not be re-observed. Provider outcome is unknown; do not replay this attempt.",
          "observer",
        );
      }
      currentStage = "storage";
      storageOperation = "transition_dispatch_intent_to_dispatched";
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
      } catch (error) {
        captureStorageFailure(error);
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
      if (currentStage === "storage") captureStorageFailure(error);
      if (activationStarted) {
        currentStage =
          error instanceof FlowImageAttemptTransitionError
            ? "storage"
            : currentStage;
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
          : `${currentStage}_failed`,
        currentStage === "preparation"
          ? "Prompt preparation failed before dispatch. Generate was not activated."
          : currentStage === "preflight"
            ? "A selected-project or Generate preflight check failed. Generate was not activated."
            : currentStage === "observer"
              ? "A Flow observation could not be verified. Generate was not activated."
              : "Attempt storage failed before dispatch. Generate was not activated.",
        error instanceof FlowImageAttemptTransitionError
          ? "storage"
          : currentStage,
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
    liveFrame.documentId === frame.documentId &&
    liveFrame.senderFrameId === frame.senderFrameId &&
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
):
  | { code: string; message: string; failureStage: FlowImageAttemptStage }
  | undefined {
  if (discovery.composer !== "identified") {
    return {
      code: `composer_${discovery.composer}`,
      failureStage: "preflight",
      message:
        "A unique supported image composer was not verified. Generate was not activated.",
    };
  }
  if (!discovery.exactPrompt) {
    return {
      code: "prompt_readback_mismatch",
      failureStage: "preflight",
      message:
        "The prompt no longer matches the exact saved source. Generate was not activated.",
    };
  }
  if (discovery.generate !== "identified") {
    return {
      code: `generate_${discovery.generate}`,
      failureStage: "preflight",
      message:
        "A unique enabled Generate control was not verified in the image composer.",
    };
  }
  if (discovery.observation !== "ready" || !discovery.baseline) {
    return {
      code: `observation_${discovery.observation}`,
      failureStage: "observer",
      message:
        "Pre-dispatch results observation is unavailable or ambiguous. Generate was not activated.",
    };
  }
  if (!discovery.buttonObjectId) {
    return {
      code: "generate_binding_missing",
      failureStage: "preflight",
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

export function createSavedFlowPromptEntry(
  repositories: ExtensionRepositories,
  port = createChromeFlowPromptEntryPort(repositories),
): (input: {
  workspaceId: string;
  promptHash: string;
}) => Promise<FlowPromptEntryResult> {
  return async ({ workspaceId, promptHash }) => {
    const selected = await repositories.getSelectedTarget("Flow");
    const binding = selected?.verificationBinding;
    if (
      !selected ||
      selected.verification !== "verified" ||
      selected.connectionState !== "verified" ||
      selected.reconnectEnabled === false ||
      !binding ||
      binding.provider !== "Flow" ||
      binding.tabId !== selected.tabId ||
      binding.canonicalTarget !== selected.canonicalTarget ||
      binding.extensionBuildId !== BUILD_ID ||
      binding.connectorBuildId !== BUILD_ID ||
      binding.extensionProtocolVersion !== PROTOCOL_VERSION ||
      binding.connectorProtocolVersion !== 1
    ) {
      throw new Error("flow_connection_unverified");
    }
    const batch = await repositories.getPromptBatch(workspaceId, "image");
    if (!batch || batch.items.length !== 1) {
      throw new Error("flow_saved_single_prompt_required");
    }
    const item = batch.items[0]!;
    if (
      item.workspaceId !== workspaceId ||
      item.batchId !== batch.batch.id ||
      item.kind !== "image" ||
      item.contentHash !== promptHash ||
      item.rawJsonBody.length !== item.measurement.stringCodeUnits ||
      new TextEncoder().encode(item.rawJsonBody).byteLength !==
        item.measurement.utf8Bytes ||
      (await sha256Hex(item.rawJsonBody)) !== promptHash
    ) {
      throw new Error("flow_saved_prompt_changed");
    }
    const snapshot = {
      snapshotId: flowImagePromptSnapshotId(item.id, promptHash),
      workspaceId,
      batchId: batch.batch.id,
      itemId: item.id,
      promptHash,
      rawJsonBody: item.rawJsonBody,
      promptCodeUnits: item.measurement.stringCodeUnits,
      promptUtf8Bytes: item.measurement.utf8Bytes,
      createdAt: Date.now(),
    };
    await repositories.saveFlowImagePromptSnapshot(snapshot);
    const saved = await repositories.getFlowImagePromptSnapshot(
      snapshot.snapshotId,
    );
    if (
      !saved ||
      saved.workspaceId !== workspaceId ||
      saved.batchId !== batch.batch.id ||
      saved.itemId !== item.id ||
      saved.promptHash !== promptHash ||
      saved.promptCodeUnits !== item.measurement.stringCodeUnits ||
      saved.promptUtf8Bytes !== item.measurement.utf8Bytes ||
      saved.rawJsonBody !== item.rawJsonBody
    ) {
      throw new Error("flow_immutable_source_unavailable");
    }
    return enterFlowPrompt(saved.rawJsonBody, port);
  };
}

export function createFlowImageGenerateOnceForWorker(
  repositories: ExtensionRepositories,
  port = createChromeFlowImageGenerateOncePort(repositories),
): (input: FlowImageGenerateOnceInput) => Promise<FlowImageGenerateOnceResult> {
  return createFlowImageGenerateOnce({
    repositories,
    port,
    fillPrompt: createFlowPromptEntry(port),
  });
}
