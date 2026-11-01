import type {
  ActiveReferenceSelectionSession,
  FlowReferenceCandidateSelectedMessage,
  FlowReferencePickerCandidate,
} from "../../shared/schemas";
import { FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE } from "../../shared/schemas";
import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";

export const FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE =
  "AUTOMAT_FLOW_REFERENCE_CONTEXT_MENU_ACK" as const;
export const FLOW_REFERENCE_CONTEXT_MENU_PREFIX =
  "automat-flow-reference-session-";

export function flowReferenceContextMenuId(sessionId: string): string {
  return `${FLOW_REFERENCE_CONTEXT_MENU_PREFIX}${sessionId}`;
}

export function createFlowReferenceContextMenuProperties(
  session: ActiveReferenceSelectionSession,
) {
  return {
    id: flowReferenceContextMenuId(session.sessionId),
    title: `Use as reference for Shot ${session.shotId}`,
    contexts: ["image"] as ["image"],
    documentUrlPatterns: [
      "https://flow.google.com/project/*",
      "https://flow.google.com/u/*/project/*",
      "https://labs.google/fx/tools/flow/*",
    ],
  };
}

export const FLOW_REFERENCE_SELECTION_KEY =
  "__AUTOMAT_FLOW_REFERENCE_SELECTION_V1__";

export function createFlowReferenceSelectionInjection(
  session: ActiveReferenceSelectionSession,
  command: "start" | "cancel",
) {
  return {
    target: {
      tabId: session.tabId,
      documentIds: [session.documentId],
    },
    world: "ISOLATED" as const,
    func: flowReferenceSelectionProducer,
    args: [
      session,
      command,
      BUILD_ID,
      PROTOCOL_VERSION,
      FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
    ] as [
      ActiveReferenceSelectionSession,
      typeof command,
      string,
      number,
      typeof FLOW_REFERENCE_CONTEXT_MENU_ACK_MESSAGE,
    ],
  };
}

/**
 * Self-contained isolated content-script function injected into the target Flow document.
 * Does not acquire any debugger lease. Uses capturing click and keyboard affordances.
 */
export async function flowReferenceSelectionProducer(
  session: ActiveReferenceSelectionSession,
  command: "start" | "cancel",
  buildId = session.sessionId,
  protocolVersion = 1,
  contextMenuAckType = "AUTOMAT_FLOW_REFERENCE_CONTEXT_MENU_ACK",
): Promise<{ status: string; reason?: string }> {
  const stateKey = "__AUTOMAT_FLOW_REFERENCE_SELECTION_V1__";
  const globalScope = globalThis as typeof globalThis & {
    chrome?: {
      runtime?: {
        sendMessage?: (message: unknown) => Promise<unknown>;
        onMessage?: {
          addListener: (
            listener: (
              message: unknown,
              sender: unknown,
              sendResponse: (response: unknown) => void,
            ) => void,
          ) => void;
          removeListener: (
            listener: (
              message: unknown,
              sender: unknown,
              sendResponse: (response: unknown) => void,
            ) => void,
          ) => void;
        };
      };
    };
    [stateKey]?: {
      session: ActiveReferenceSelectionSession;
      cleanup: () => void;
      cancelled?: boolean;
    };
  };

  const runtime = globalScope.chrome?.runtime;

  // Cleanup helper
  const existing = globalScope[stateKey];
  if (existing) {
    try {
      existing.cleanup();
    } catch {
      // ignore cleanup errors
    }
    delete globalScope[stateKey];
  }

  if (command === "cancel") {
    return { status: "cancelled" };
  }

  if (!runtime?.sendMessage) {
    return { status: "refused", reason: "runtime_unavailable" };
  }

  if (window.top !== window || !document || !document.body) {
    return { status: "refused", reason: "not_top_frame" };
  }

  // 1. Identify Flow Project Boundary
  const projects = Array.from(
    document.querySelectorAll("flow-project-page"),
  ) as HTMLElement[];
  if (projects.length === 0) {
    return { status: "refused", reason: "project_missing" };
  }
  if (projects.length > 1) {
    return { status: "refused", reason: "project_ambiguous" };
  }
  const project = projects[0]!;

  const tag = (element: Element) => element.localName.toLowerCase();

  const isVisible = (element: Element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      element.isConnected &&
      style.display !== "none" &&
      !["hidden", "collapse"].includes(style.visibility) &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  const isExcluded = (element: Element): boolean => {
    // Exclude composer, nav, dialogs, account/avatars
    const excludedAncestors = element.closest(
      "flow-base-prompt-box, nav, header, [role='navigation'], [role='dialog'], dialog, [aria-modal='true'], [class*='avatar' i], [class*='profile' i], [class*='account' i]",
    );
    return excludedAncestors !== null;
  };

  const isEligibleCard = (element: Element): boolean => {
    if (!element.isConnected || !project.contains(element)) return false;
    if (isExcluded(element)) return false;

    const t = tag(element);
    if (t === "flow-image-tile") return true;

    // Semantic card attributes
    const role = element.getAttribute("role");
    if (role === "listitem" || role === "gridcell") return true;
    if (
      element.hasAttribute("data-result") ||
      element.hasAttribute("data-result-card")
    ) {
      return true;
    }

    if (t.startsWith("flow-") && /result|tile|gallery|media/i.test(t)) {
      return true;
    }

    return false;
  };

  const findEligibleCard = (start: Element | null): HTMLElement | null => {
    let curr: Element | null = start;
    while (curr && curr !== project && curr !== document.body) {
      if (isEligibleCard(curr)) {
        return curr as HTMLElement;
      }
      curr = curr.parentElement;
    }
    return null;
  };

  const composedElements = (event: Event): Element[] => {
    const path =
      typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.filter((entry): entry is Element => entry instanceof Element);
  };

  const findEligibleCardFromPath = (
    elements: Element[],
    target: Element | null,
  ): HTMLElement | null => {
    for (const element of elements) {
      if (element === project || element === document.body) break;
      if (banner.contains(element)) return null;
      if (isEligibleCard(element)) return element as HTMLElement;
    }
    return elements.length === 0 ? findEligibleCard(target) : null;
  };

  const isKnownNativeAction = (
    elements: Element[],
    card: HTMLElement,
  ): boolean => {
    const nativeActionName =
      /(?:favorite|favourite|like|heart|menu|more options|more actions|download|share|delete|remove)/i;
    for (const element of elements) {
      if (element.hasAttribute("data-af-reference-select")) return false;
      const isControl =
        ["button", "a", "input"].includes(tag(element)) ||
        element.getAttribute("role") === "button";
      if (!isControl) continue;
      const name = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.textContent,
      ]
        .filter(Boolean)
        .join(" ");
      if (nativeActionName.test(name)) return true;
      if (element === card) break;
    }
    return false;
  };

  const resolveImageForCard = (
    elements: Element[],
    card: HTMLElement,
  ):
    | { image: HTMLImageElement; reason?: never }
    | {
        image?: never;
        reason: "image_missing_or_ambiguous" | "image_not_visible";
      } => {
    const cardIndex = elements.indexOf(card);
    const pathImages = elements
      .slice(0, Math.max(0, cardIndex))
      .filter(
        (element): element is HTMLImageElement =>
          tag(element) === "img" && !isExcluded(element),
      );
    if (pathImages.length > 1) {
      return { reason: "image_missing_or_ambiguous" };
    }
    if (pathImages.length === 1) {
      const image = pathImages[0]!;
      return isVisible(image) ? { image } : { reason: "image_not_visible" };
    }

    const ownedImages = Array.from(card.querySelectorAll("img")).filter(
      (img) => !isExcluded(img) && findEligibleCard(img) === card,
    );
    const visibleImages = ownedImages.filter(isVisible);
    if (visibleImages.length === 1) return { image: visibleImages[0]! };
    if (visibleImages.length > 1 || ownedImages.length === 0) {
      return { reason: "image_missing_or_ambiguous" };
    }
    return { reason: "image_not_visible" };
  };

  // 2. Create and inject accessible selection banner
  const bannerId = "automat-faceless-selection-banner";
  const oldBanner = document.getElementById(bannerId);
  if (oldBanner) oldBanner.remove();

  const banner = document.createElement("div");
  banner.id = bannerId;
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "Automat Faceless Reference Selection");
  banner.setAttribute("data-af-selection-ui", "true");

  Object.assign(banner.style, {
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483640",
    backgroundColor: "#161b22",
    color: "#f0f6fc",
    border: "1px solid #30363d",
    borderRadius: "10px",
    padding: "10px 16px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
    display: "flex",
    alignItems: "center",
    gap: "14px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "13px",
    pointerEvents: "auto",
  });

  const bannerText = document.createElement("div");
  bannerText.style.display = "flex";
  bannerText.style.flexDirection = "column";
  bannerText.style.gap = "2px";

  const bannerTitle = document.createElement("strong");
  bannerTitle.textContent = `Selecting reference for Shot ${session.shotId}`;
  bannerTitle.style.color = "#58a6ff";

  const bannerSubtext = document.createElement("span");
  bannerSubtext.textContent =
    "Click a gallery image or press Enter on 'Select for Shot'. Native viewer is suppressed for selected card.";
  bannerSubtext.style.color = "#8b949e";
  bannerSubtext.style.fontSize = "11px";

  const bannerStatus = document.createElement("span");
  bannerStatus.setAttribute("role", "status");
  bannerStatus.setAttribute("aria-live", "polite");
  bannerStatus.setAttribute("aria-atomic", "true");
  bannerStatus.style.color = "#f0f6fc";
  bannerStatus.style.fontSize = "12px";

  const diagnosticStatus = document.createElement("span");
  diagnosticStatus.setAttribute("data-af-diagnostic", "true");
  diagnosticStatus.style.color = "#8b949e";
  diagnosticStatus.style.fontSize = "10px";

  bannerText.appendChild(bannerTitle);
  bannerText.appendChild(bannerSubtext);
  bannerText.appendChild(bannerStatus);
  bannerText.appendChild(diagnosticStatus);
  banner.appendChild(bannerText);

  const bannerCancelBtn = document.createElement("button");
  bannerCancelBtn.type = "button";
  bannerCancelBtn.textContent = "Cancel selection";
  bannerCancelBtn.setAttribute("data-af-selection-ui", "true");
  Object.assign(bannerCancelBtn.style, {
    backgroundColor: "#21262d",
    color: "#c9d1d9",
    border: "1px solid #30363d",
    borderRadius: "6px",
    padding: "5px 12px",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    outline: "none",
  });
  bannerCancelBtn.addEventListener("mouseenter", () => {
    bannerCancelBtn.style.backgroundColor = "#30363d";
  });
  bannerCancelBtn.addEventListener("mouseleave", () => {
    bannerCancelBtn.style.backgroundColor = "#21262d";
  });
  banner.appendChild(bannerCancelBtn);

  document.body.appendChild(banner);

  // 3. Inject keyboard affordances into eligible gallery cards
  const injectedButtons = new Set<HTMLElement>();

  const attachCardAffordance = (card: HTMLElement) => {
    if (card.querySelector("[data-af-reference-select]")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-af-reference-select", "true");
    btn.setAttribute("data-af-selection-ui", "true");
    btn.setAttribute("aria-label", `Select for Shot ${session.shotId}`);
    btn.textContent = `Select for Shot ${session.shotId}`;

    Object.assign(btn.style, {
      display: "inline-block",
      position: "relative",
      margin: "4px",
      padding: "4px 8px",
      fontSize: "11px",
      fontWeight: "bold",
      color: "#ffffff",
      backgroundColor: "#1f6feb",
      border: "1px solid rgba(255, 255, 255, 0.2)",
      borderRadius: "4px",
      cursor: "pointer",
      zIndex: "100",
    });

    card.appendChild(btn);
    injectedButtons.add(btn);
  };

  const refreshAffordances = () => {
    const tiles = project.querySelectorAll(
      "flow-image-tile, [role='listitem'], [role='gridcell']",
    );
    for (const tile of tiles) {
      if (isEligibleCard(tile)) {
        attachCardAffordance(tile as HTMLElement);
      }
    }
  };

  refreshAffordances();

  // 4. Batch MutationObserver for dynamically loaded tiles
  let observerAnimationFrame: number | null = null;
  const observer = new MutationObserver((mutations) => {
    const hasNewExternalNodes = mutations.some((mutation) =>
      Array.from(mutation.addedNodes).some(
        (node) =>
          node instanceof HTMLElement &&
          !node.hasAttribute("data-af-selection-ui") &&
          !node.querySelector("[data-af-selection-ui]"),
      ),
    );
    if (!hasNewExternalNodes) return;

    if (observerAnimationFrame !== null)
      cancelAnimationFrame(observerAnimationFrame);
    observerAnimationFrame = requestAnimationFrame(() => {
      observerAnimationFrame = null;
      refreshAffordances();
    });
  });

  observer.observe(project, {
    childList: true,
    subtree: true,
  });

  let submissionPending = false;
  let interactionActive = true;
  let clickReached = false;
  let cardResolved = false;
  let submissionStage = "not attempted";
  const countEligibleCards = () => {
    const cards = Array.from(project.querySelectorAll("*")).filter(
      isEligibleCard,
    );
    return cards.filter((card) =>
      Array.from(card.querySelectorAll("img")).some(
        (img) => isVisible(img) && findEligibleCard(img) === card,
      ),
    ).length;
  };
  const updateDiagnostics = () => {
    diagnosticStatus.textContent = `Diagnostics: build ${buildId}; session ${session.sessionId}; eligible cards ${countEligibleCards()}; click listener ${clickReached ? "reached" : "not reached"}; card ${cardResolved ? "resolved" : "not resolved"}; submission ${submissionStage}.`;
  };
  const setDiagnosticReason = (reason: string) => {
    submissionStage = reason.slice(0, 64);
    updateDiagnostics();
  };
  updateDiagnostics();
  if (countEligibleCards() === 0) {
    bannerStatus.textContent =
      "No eligible gallery cards were detected. Keep this Shot selected and retry after the gallery is visible.";
  }

  const isCurrentSession = () =>
    interactionActive &&
    !globalScope[stateKey]?.cancelled &&
    globalScope[stateKey]?.session.sessionId === session.sessionId;

  const candidateTokens = new Map<string, FlowReferencePickerCandidate>();
  const collectPickerCandidates = () => {
    const discovered: Array<Omit<FlowReferencePickerCandidate, "candidateId">> =
      [];
    let ambiguousCount = 0;
    let unsupportedCount = 0;
    const cards = Array.from(project.querySelectorAll("*")).filter(
      isEligibleCard,
    );
    for (const card of cards) {
      const ownedImages = Array.from(card.querySelectorAll("img")).filter(
        (img) => !isExcluded(img) && findEligibleCard(img) === card,
      );
      if (ownedImages.length !== 1) {
        if (ownedImages.length > 1) ambiguousCount += 1;
        continue;
      }
      const img = ownedImages[0]!;
      if (!isVisible(img)) continue;
      const sourceUrl = img.currentSrc || img.src;
      let source: URL;
      try {
        source = new URL(sourceUrl);
      } catch {
        unsupportedCount += 1;
        continue;
      }
      if (source.protocol !== "https:" || sourceUrl.length > 4096) {
        unsupportedCount += 1;
        continue;
      }
      const providerAssetId =
        img.getAttribute("data-media-id")?.trim() ||
        card.getAttribute("data-asset-id")?.trim() ||
        img.getAttribute("data-asset-id")?.trim() ||
        undefined;
      discovered.push({
        sourceUrl,
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        displayWidth: Math.round(img.clientWidth || 0),
        displayHeight: Math.round(img.clientHeight || 0),
        ...(providerAssetId ? { providerAssetId } : {}),
        cardTag: tag(card),
        selectedAt: Date.now(),
      });
    }

    const identityKey = (
      candidate: Omit<FlowReferencePickerCandidate, "candidateId">,
    ) =>
      JSON.stringify([candidate.sourceUrl, candidate.providerAssetId ?? null]);
    const signature = (
      candidate: Omit<FlowReferencePickerCandidate, "candidateId">,
    ) =>
      JSON.stringify([
        candidate.sourceUrl,
        candidate.providerAssetId ?? null,
        candidate.cardTag,
        candidate.naturalWidth,
        candidate.naturalHeight,
      ]);
    const counts = new Map<string, number>();
    for (const candidate of discovered) {
      const key = identityKey(candidate);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const ambiguousIdentities = new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([key]) => key),
    );
    const unique = discovered.filter(
      (candidate) => counts.get(identityKey(candidate)) === 1,
    );
    ambiguousCount += discovered.length - unique.length;
    return {
      // Bound message size and per-document token storage. DOM order is display
      // order only; opaque tokens and the observed source establish identity.
      candidates: unique.slice(0, 300).map((candidate) => ({
        ...candidate,
        candidateId: crypto.randomUUID(),
      })),
      ambiguousCount,
      unsupportedCount,
      signature,
      ambiguousIdentities,
      identityKey,
    };
  };

  const onRuntimeMessage = (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: unknown) => void,
  ) => {
    if (
      message !== null &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "AUTOMAT_FLOW_REFERENCE_PICKER_REQUEST" &&
      "buildId" in message &&
      message.buildId === buildId &&
      "sessionId" in message &&
      message.sessionId === session.sessionId &&
      "action" in message &&
      isCurrentSession()
    ) {
      if (message.action === "list") {
        candidateTokens.clear();
        const result = collectPickerCandidates();
        for (const candidate of result.candidates) {
          candidateTokens.set(candidate.candidateId, candidate);
        }
        sendResponse({
          ok: true,
          buildId,
          sessionId: session.sessionId,
          candidates: result.candidates,
          ambiguousCount: result.ambiguousCount,
          unsupportedCount: result.unsupportedCount,
        });
      } else if (
        message.action === "resolve" &&
        "candidateId" in message &&
        typeof message.candidateId === "string"
      ) {
        const observed = candidateTokens.get(message.candidateId);
        if (!observed) {
          sendResponse({
            ok: false,
            code: "candidate_missing_or_changed",
            buildId,
            sessionId: session.sessionId,
          });
          return;
        }
        const fresh = collectPickerCandidates();
        const observedSignature = fresh.signature(observed);
        const observedIdentity = fresh.identityKey(observed);
        const matches = fresh.candidates.filter(
          (candidate) => fresh.signature(candidate) === observedSignature,
        );
        if (matches.length !== 1) {
          sendResponse({
            ok: false,
            code:
              matches.length > 1 ||
              fresh.ambiguousIdentities.has(observedIdentity)
                ? "candidate_ambiguous"
                : "candidate_missing_or_changed",
            buildId,
            sessionId: session.sessionId,
          });
          return;
        }
        sendResponse({
          ok: true,
          buildId,
          sessionId: session.sessionId,
          candidate: matches[0],
        });
      }
    }
  };

  const stopInteraction = () => {
    if (!interactionActive) return;
    interactionActive = false;
    window.removeEventListener("click", onSelectionClick, { capture: true });
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    runtime?.onMessage?.removeListener(onRuntimeMessage);
    runtime?.onMessage?.removeListener(onRuntimeAcknowledgement as never);
    observer.disconnect();
    if (observerAnimationFrame !== null) {
      cancelAnimationFrame(observerAnimationFrame);
    }
    for (const btn of injectedButtons) btn.remove();
    injectedButtons.clear();
  };

  const cleanup = () => {
    stopInteraction();
    banner.remove();
    if (globalScope[stateKey]?.session.sessionId === session.sessionId) {
      delete globalScope[stateKey];
    }
  };

  const setFailure = (message: string, stage: string) => {
    submissionPending = false;
    submissionStage = stage;
    bannerStatus.textContent = message.slice(0, 180);
    bannerStatus.style.color = "#ffb4a9";
    updateDiagnostics();
  };

  const hasValidResponseEnvelope = (
    response: unknown,
    requestId: string,
  ): response is Record<string, unknown> =>
    response !== null &&
    typeof response === "object" &&
    "protocolVersion" in response &&
    response.protocolVersion === protocolVersion &&
    "buildId" in response &&
    response.buildId === buildId &&
    "requestId" in response &&
    response.requestId === requestId;

  const reconcileUncertainDelivery = async (
    candidate: FlowReferenceCandidateSelectedMessage["candidate"],
  ) => {
    try {
      const response = (await runtime.sendMessage({
        protocolVersion,
        buildId,
        requestId: `ref-state-${session.sessionId}`,
        type: "flow.reference.getState",
        payload: { workspaceId: session.workspaceId },
      })) as {
        ok?: boolean;
        data?: {
          activeSession?: ActiveReferenceSelectionSession | null;
          candidates?: Record<
            string,
            FlowReferenceCandidateSelectedMessage["candidate"]
          >;
        };
      } | null;
      const stateData =
        hasValidResponseEnvelope(response, `ref-state-${session.sessionId}`) &&
        response.ok === true &&
        "data" in response &&
        response.data !== null &&
        typeof response.data === "object"
          ? (response.data as {
              activeSession?: ActiveReferenceSelectionSession | null;
              candidates?: Record<
                string,
                FlowReferenceCandidateSelectedMessage["candidate"]
              >;
            })
          : undefined;
      if (
        stateData?.candidates?.[session.shotId]?.selectedAt ===
        candidate.selectedAt
      ) {
        return "accepted" as const;
      }
      if (stateData?.activeSession?.sessionId === session.sessionId) {
        return "still_active" as const;
      }
    } catch {
      // An unreadable state remains uncertain; it must never imply success.
    }
    return "unknown" as const;
  };

  const showAccepted = () => {
    submissionPending = false;
    submissionStage = "worker accepted";
    bannerStatus.textContent = `✓ Candidate selected for Shot ${session.shotId}. Return to References.`;
    bannerStatus.style.color = "#7ee787";
    bannerCancelBtn.remove();
    updateDiagnostics();
    stopInteraction();
    setTimeout(() => {
      if (globalScope[stateKey]?.session.sessionId === session.sessionId) {
        cleanup();
      }
    }, 2500);
  };

  const onRuntimeAcknowledgement = (message: unknown) => {
    if (
      message !== null &&
      typeof message === "object" &&
      "type" in message &&
      message.type === contextMenuAckType &&
      "sessionId" in message &&
      message.sessionId === session.sessionId &&
      "shotId" in message &&
      message.shotId === session.shotId &&
      isCurrentSession()
    ) {
      showAccepted();
    }
  };

  const submitCandidate = async (
    message: FlowReferenceCandidateSelectedMessage,
  ) => {
    submissionPending = true;
    bannerStatus.textContent = `Selecting candidate for Shot ${session.shotId}…`;
    bannerStatus.style.color = "#58a6ff";
    submissionStage = "submitting";
    updateDiagnostics();

    let response: unknown;
    try {
      response = await runtime.sendMessage(message);
    } catch {
      response = undefined;
    }
    if (!isCurrentSession()) return;

    if (
      hasValidResponseEnvelope(response, "flow-reference-candidate") &&
      response.ok === true &&
      "data" in response &&
      response.data !== null &&
      typeof response.data === "object" &&
      "accepted" in response.data &&
      response.data.accepted === true
    ) {
      showAccepted();
      return;
    }

    if (
      hasValidResponseEnvelope(response, "flow-reference-candidate") &&
      response.ok === false
    ) {
      const error = "error" in response ? response.error : undefined;
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? String(error.code).slice(0, 64)
          : "candidate_rejected";
      setFailure(
        `Candidate was not accepted (${code}). Try this Shot again or choose another image.`,
        "worker rejected",
      );
      return;
    }

    submissionStage = "delivery uncertain; reconciling";
    updateDiagnostics();
    const reconciled = await reconcileUncertainDelivery(message.candidate);
    if (!isCurrentSession()) return;
    if (reconciled === "accepted") {
      showAccepted();
    } else if (reconciled === "still_active") {
      setFailure(
        "The worker has not recorded this candidate. Retry the same Shot or choose another image.",
        "state confirms not recorded",
      );
    } else {
      setFailure(
        "Delivery is uncertain and session state could not confirm acceptance. Reopen References to reconcile before retrying.",
        "state reconciliation uncertain",
      );
      submissionPending = true;
    }
  };

  const performSelection = (card: HTMLElement, img: HTMLImageElement) => {
    if (submissionPending) {
      setDiagnosticReason("selection_already_pending");
      return;
    }
    if (!isCurrentSession()) {
      setDiagnosticReason("session_inactive");
      return;
    }
    if (!isVisible(img)) {
      setDiagnosticReason("image_not_visible");
      return;
    }

    const sourceUrl = img.currentSrc || img.src;
    let source: URL;
    try {
      source = new URL(sourceUrl);
    } catch {
      setFailure(
        "The selected image source is unavailable. Choose another image in this Shot.",
        "source_unavailable_or_unsupported",
      );
      return;
    }
    if (source.protocol !== "https:") {
      setFailure(
        "This image source type is unsupported. Choose another image in this Shot.",
        "source_unavailable_or_unsupported",
      );
      return;
    }

    const genuineId =
      img.getAttribute("data-media-id")?.trim() ||
      card.getAttribute("data-asset-id")?.trim() ||
      img.getAttribute("data-asset-id")?.trim() ||
      undefined;
    const message: FlowReferenceCandidateSelectedMessage = {
      type: FLOW_REFERENCE_CANDIDATE_SELECTED_MESSAGE,
      protocolVersion,
      buildId,
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      batchId: session.batchId,
      shotId: session.shotId,
      candidate: {
        sourceUrl,
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        displayWidth: Math.round(img.clientWidth || 0),
        displayHeight: Math.round(img.clientHeight || 0),
        ...(genuineId ? { providerAssetId: genuineId } : {}),
        cardTag: tag(card),
        selectedAt: Date.now(),
      },
    };
    void submitCandidate(message);
  };

  // 5. Capturing Click Interceptor
  const onSelectionClick = (event: MouseEvent) => {
    clickReached = true;
    updateDiagnostics();
    const pathElements = composedElements(event);
    const target =
      event.target instanceof Element
        ? event.target
        : (pathElements[0] ?? null);
    if (!target) {
      setDiagnosticReason("click_target_missing");
      return;
    }

    // Banner cancel button
    if (target === bannerCancelBtn || bannerCancelBtn.contains(target)) {
      setDiagnosticReason("selection_cancelled");
      event.preventDefault();
      event.stopPropagation();
      cleanup();
      void runtime
        .sendMessage({
          type: "AUTOMAT_FLOW_REFERENCE_SESSION_CANCELLED",
          sessionId: session.sessionId,
          shotId: session.shotId,
        })
        .catch(() => undefined);
      return;
    }

    // Click inside banner: ignore
    if (banner.contains(target)) {
      setDiagnosticReason("banner_interaction_ignored");
      return;
    }

    if (submissionPending) {
      setDiagnosticReason("selection_already_pending");
      const pendingCard = findEligibleCardFromPath(pathElements, target);
      if (pendingCard) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      return;
    }

    // Keyboard affordance button clicked
    const selectionAffordance =
      pathElements.some((element) =>
        element.hasAttribute("data-af-reference-select"),
      ) || target.hasAttribute("data-af-reference-select");
    if (selectionAffordance) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const card = findEligibleCardFromPath(pathElements, target);
      cardResolved = card !== null;
      updateDiagnostics();
      if (!card) {
        setDiagnosticReason("card_unresolved");
        return;
      }
      if (isKnownNativeAction(pathElements, card)) {
        setDiagnosticReason("native_action_ignored");
        return;
      }
      const resolved = resolveImageForCard(pathElements, card);
      if (!resolved.image) {
        setDiagnosticReason(resolved.reason);
        return;
      }
      performSelection(card, resolved.image);
      return;
    }

    // Click on or inside an eligible card
    const card = findEligibleCardFromPath(pathElements, target);
    cardResolved = card !== null;
    updateDiagnostics();
    if (!card) {
      setDiagnosticReason("card_unresolved");
      return;
    }
    if (isKnownNativeAction(pathElements, card)) {
      setDiagnosticReason("native_action_ignored");
      return;
    }
    const resolved = resolveImageForCard(pathElements, card);
    if (!resolved.image) {
      setDiagnosticReason(resolved.reason);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    performSelection(card, resolved.image);

    // Outside eligible cards: normal Flow interactions preserved
  };

  // 6. Keyboard listener
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      cleanup();
      void runtime
        .sendMessage({
          type: "AUTOMAT_FLOW_REFERENCE_SESSION_CANCELLED",
          sessionId: session.sessionId,
          shotId: session.shotId,
        })
        .catch(() => undefined);
    }
  };

  // Run before document capture so window-level stopPropagation cannot hide the click.
  window.addEventListener("click", onSelectionClick, { capture: true });
  window.addEventListener("keydown", onKeyDown, { capture: true });
  runtime.onMessage?.addListener(onRuntimeMessage);
  runtime.onMessage?.addListener(onRuntimeAcknowledgement as never);

  globalScope[stateKey] = {
    session,
    cleanup,
  };

  return { status: "active" };
}
