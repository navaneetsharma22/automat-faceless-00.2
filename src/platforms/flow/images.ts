import { flowComposerRuntime, readFlowEditorRuntime } from "./composer";
import type { FlowPromptEntryPort } from "./promptEntry";
import type { FlowImageBaseline } from "./observer";
import { flowWorkspaceScopeAnalyzer } from "./workspaceScope";
import type { FlowWorkspaceScopeAnalysis } from "./workspaceScope";

export type FlowDocumentBinding = {
  frameId: string;
  loaderId: string;
  url: string;
  /** Browser document identity captured from the same top frame. */
  documentId?: string;
  senderFrameId?: number;
};

type EmptyWorkspaceInspection =
  | { state: "missing" | "ambiguous" | "unsupported" | "unstable" }
  | {
      state: "ready";
      workspace: HTMLElement;
      marker: HTMLElement;
      visibleMediaCount: 0;
      visibleCardCount: 0;
      loadingCount: 0;
    };

export type FlowGenerateDiscovery = {
  composer: "identified" | "missing" | "ambiguous" | "unsupported";
  exactPrompt: boolean;
  actualCodeUnits: number;
  generate: "identified" | "missing" | "ambiguous" | "disabled";
  observation: "ready" | "missing" | "ambiguous" | "unsupported" | "unstable";
  baseline?: FlowImageBaseline;
  buttonObjectId?: string;
  generationAvailable: false;
};

/** Semantic fixture signals only; these have not been checked against Flow. */
export async function flowImageRuntime(
  expectedText: string,
  mode: "inspect" | "button" = "inspect",
  composerRuntime = flowComposerRuntime,
  readText = readFlowEditorRuntime,
  scopeRuntime?: () => Promise<FlowWorkspaceScopeAnalysis>,
): Promise<FlowGenerateDiscovery | HTMLElement | null> {
  const sameSharedScopeCapture = (
    first: FlowWorkspaceScopeAnalysis,
    second: FlowWorkspaceScopeAnalysis,
  ) =>
    first.status === second.status &&
    first.profile === second.profile &&
    first.project === second.project &&
    first.composer === second.composer &&
    first.editor === second.editor &&
    first.tiles.length === second.tiles.length &&
    first.tiles.every((tile, index) => tile === second.tiles[index]) &&
    JSON.stringify({
      candidateIds: first.candidateIds,
      candidateMultiplicity: first.candidateMultiplicity,
      candidateTileRelationships: first.candidateTileRelationships,
      loadingSignalCount: first.loadingSignalCount,
      virtualScrollContainerCount: first.virtualScrollContainerCount,
      virtualizationEvidence: first.virtualizationEvidence,
      virtualized: first.virtualized,
      unidentifiedImageCount: first.unidentifiedImageCount,
      captureGaps: first.captureGaps,
    }) ===
      JSON.stringify({
        candidateIds: second.candidateIds,
        candidateMultiplicity: second.candidateMultiplicity,
        candidateTileRelationships: second.candidateTileRelationships,
        loadingSignalCount: second.loadingSignalCount,
        virtualScrollContainerCount: second.virtualScrollContainerCount,
        virtualizationEvidence: second.virtualizationEvidence,
        virtualized: second.virtualized,
        unidentifiedImageCount: second.unidentifiedImageCount,
        captureGaps: second.captureGaps,
      });
  let sharedScope: FlowWorkspaceScopeAnalysis | undefined;
  if (scopeRuntime) {
    try {
      sharedScope = await scopeRuntime();
    } catch {
      sharedScope = undefined;
    }
    if (sharedScope?.status === "ready" && sharedScope.project) {
      try {
        const observer = new MutationObserver(() => undefined);
        observer.observe(sharedScope.project, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const mutated = observer.takeRecords().length > 0;
        observer.disconnect();
        const settledScope = await scopeRuntime();
        const scopeMatches = sameSharedScopeCapture(sharedScope, settledScope);
        if (mutated || !scopeMatches) {
          return {
            composer: "unsupported",
            exactPrompt: false,
            actualCodeUnits: 0,
            generate: "missing",
            observation: "unstable",
            generationAvailable: false,
          };
        }
        sharedScope = settledScope;
      } catch {
        return {
          composer: "unsupported",
          exactPrompt: false,
          actualCodeUnits: 999,
          generate: "missing",
          observation: "unstable",
          generationAvailable: false,
        };
      }
    }
  }
  const editor = sharedScope
    ? sharedScope.status === "ready" ||
      sharedScope.status === "workspace_busy" ||
      sharedScope.status === "baseline_ambiguous"
      ? sharedScope.editor
      : null
    : composerRuntime("", true, readText);
  if (sharedScope && !editor) {
    return {
      composer:
        sharedScope.status === "project_ambiguous" ||
        sharedScope.status === "composer_ambiguous"
          ? "ambiguous"
          : sharedScope.status === "project_missing" ||
              sharedScope.status === "composer_missing"
            ? "missing"
            : "unsupported",
      exactPrompt: false,
      actualCodeUnits: 0,
      generate: "missing",
      observation:
        sharedScope.status === "document_scan_truncated" ||
        sharedScope.status === "project_scan_truncated" ||
        sharedScope.status === "tile_scan_truncated"
          ? "unsupported"
          : "missing",
      generationAvailable: false,
    };
  }
  if (!(editor instanceof HTMLElement)) {
    const rawDiscovery = composerRuntime("", false, readText);
    const discovery =
      rawDiscovery && !(rawDiscovery instanceof HTMLElement)
        ? rawDiscovery
        : undefined;
    return {
      composer:
        discovery?.state === "ambiguous"
          ? "ambiguous"
          : discovery?.state === "unsupported"
            ? "unsupported"
            : "missing",
      exactPrompt: false,
      actualCodeUnits: 0,
      generate: "missing",
      observation: "missing",
      generationAvailable: false,
    };
  }
  const nativeEditor =
    editor instanceof HTMLTextAreaElement ||
    (editor instanceof HTMLInputElement && editor.type === "text");
  const richHost = editor.closest("flow-rich-text-editor");
  const richBoundary = editor.closest<HTMLElement>("flow-base-prompt-box");
  const richEditor =
    editor instanceof HTMLDivElement &&
    editor.getAttribute("contenteditable") === "true" &&
    editor.getAttribute("role") === "textbox" &&
    Boolean(
      richHost &&
      richBoundary &&
      richHost.closest("flow-base-prompt-box") === richBoundary,
    );
  if (!nativeEditor && !richEditor) {
    return {
      composer: "unsupported",
      exactPrompt: false,
      actualCodeUnits: 0,
      generate: "missing",
      observation: "missing",
      generationAvailable: false,
    };
  }
  const boundary = richEditor
    ? (sharedScope?.composer ?? richBoundary)
    : editor.closest<HTMLElement>(
        'form, [role="form"], [role="group"], [role="region"], [data-composer]',
      );
  if (!boundary) {
    return {
      composer: "unsupported",
      exactPrompt: false,
      actualCodeUnits: 0,
      generate: "missing",
      observation: "missing",
      generationAvailable: false,
    };
  }
  const composer = boundary;
  const visibleEnabled = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return (
      element.isConnected &&
      !element.matches(":disabled, [disabled], [aria-disabled='true']") &&
      !element.closest("[hidden], [inert], [aria-hidden='true']") &&
      style.display !== "none" &&
      style.visibility === "visible" &&
      element.getClientRects().length > 0
    );
  };
  const nameOf = (element: HTMLElement) =>
    (
      element.getAttribute("aria-label")?.trim() ||
      element.textContent?.trim() ||
      ""
    ).replace(/\s+/g, " ");
  const supportedGenerateName = richEditor
    ? /^(generate|generate image|create image|start generation)$/i
    : /^(generate|generate image|create image)$/i;
  const generateCandidates = Array.from(
    boundary.querySelectorAll<HTMLElement>("button, [role='button']"),
  ).filter((button) => supportedGenerateName.test(nameOf(button)));
  const enabledCandidates = generateCandidates.filter(visibleEnabled);
  if (mode === "button") {
    return enabledCandidates.length === 1 ? enabledCandidates[0]! : null;
  }

  const regionCandidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'main [aria-label], [role="region"][aria-label], [role="list"][aria-label]',
    ),
  ).filter((region) => {
    if (!visibleEnabled(region)) return false;
    const label = region.getAttribute("aria-label")?.trim() ?? "";
    return /^(generated results|image results|results gallery)$/i.test(label);
  });
  const mediaCount = (region: HTMLElement) =>
    Array.from(region.querySelectorAll<HTMLElement>("img, video")).filter(
      visibleEnabled,
    ).length;
  let generate: FlowGenerateDiscovery["generate"];
  if (generateCandidates.length > 1) generate = "ambiguous";
  else if (generateCandidates.length === 0) generate = "missing";
  else if (enabledCandidates.length === 0) generate = "disabled";
  else generate = "identified";
  let currentText: string;
  try {
    currentText = readText(editor);
  } catch {
    return {
      composer: "unsupported",
      exactPrompt: false,
      actualCodeUnits: 0,
      generate: "missing",
      observation: "missing",
      generationAvailable: false,
    };
  }
  if (sharedScope) {
    const baselineAt = Date.now();
    const baseline: FlowImageBaseline | undefined =
      sharedScope.profile === "populated_tiles"
        ? {
            kind: "flow_rendered_tile_candidates",
            workspaceTag: "flow-project-page",
            renderedTileCount: sharedScope.tiles.length,
            candidateIds: sharedScope.candidateIds,
            qualifyingCandidateIds: sharedScope.qualifyingCandidateIds,
            candidateMultiplicity: sharedScope.candidateMultiplicity,
            repeatedCandidateCount: sharedScope.repeatedCandidateCount,
            unidentifiedImageCount: sharedScope.unidentifiedImageCount,
            unrelatedImageCount: sharedScope.unrelatedImageCount,
            virtualScrollContainerCount:
              sharedScope.virtualScrollContainerCount,
            virtualizationEvidence: sharedScope.virtualizationEvidence,
            virtualized: sharedScope.virtualized,
            loadingSignalCount: sharedScope.loadingSignalCount,
            captureGaps: sharedScope.captureGaps,
            capturedAt: baselineAt,
          }
        : sharedScope.profile === "empty_marker"
          ? {
              kind: "flow_empty_workspace_ui",
              workspaceTag: "flow-project-page",
              markerPhrase: "Start creating or drop media",
              markerCount: 1,
              visibleMediaCount: 0,
              visibleResultCardCount: 0,
              loadingMarkerCount: 0,
              capturedAt: baselineAt,
            }
          : sharedScope.profile === "labelled_region"
            ? {
                regionLabel: "Generated results",
                mediaCount: sharedScope.labelledRegionMediaCount,
                capturedAt: baselineAt,
              }
            : undefined;
    return {
      composer: "identified",
      exactPrompt: currentText === expectedText,
      actualCodeUnits: currentText.length,
      generate,
      observation:
        sharedScope.status === "workspace_busy" ||
        sharedScope.status === "incomplete_capture"
          ? "unsupported"
          : sharedScope.status === "ready" && baseline
            ? "ready"
            : sharedScope.status === "project_ambiguous" ||
                sharedScope.status === "composer_ambiguous" ||
                sharedScope.status === "baseline_ambiguous"
              ? "ambiguous"
              : "unsupported",
      ...(baseline ? { baseline } : {}),
      generationAvailable: false,
    };
  }
  const markerPhrase = "Start creating or drop media";
  const workspacePages = Array.from(
    document.querySelectorAll<HTMLElement>("flow-project-page"),
  );
  const composerPages = richEditor
    ? workspacePages.filter(
        (page) => page.contains(editor) && page.contains(richBoundary),
      )
    : [];
  const markerWrappers = workspacePages.flatMap((page) =>
    Array.from(page.querySelectorAll<HTMLElement>(":scope > div > span"))
      .filter((phrase) => phrase.textContent?.trim() === markerPhrase)
      .map((phrase) => phrase.parentElement as HTMLElement),
  );
  const deduplicatedMarkers: HTMLElement[] = [];
  for (const marker of markerWrappers) {
    const nestedDuplicate = deduplicatedMarkers.some(
      (existing) =>
        existing.parentElement === marker.parentElement &&
        (existing === marker ||
          existing.contains(marker) ||
          marker.contains(existing)),
    );
    if (!nestedDuplicate) deduplicatedMarkers.push(marker);
  }
  const visibleMarkers = deduplicatedMarkers.filter(
    (marker) =>
      marker.children.length === 2 &&
      marker.children[0]?.localName === "mat-icon" &&
      marker.children[1]?.localName === "span" &&
      visibleEnabled(marker) &&
      visibleEnabled(marker.children[1] as HTMLElement),
  );
  const inspectEmptyWorkspace = (): EmptyWorkspaceInspection => {
    if (visibleMarkers.length > 1) return { state: "ambiguous" as const };
    if (visibleMarkers.length === 0) {
      const visibleMalformedPhrase = markerWrappers.some((marker) =>
        visibleEnabled(marker),
      );
      return {
        state: visibleMalformedPhrase
          ? ("unsupported" as const)
          : ("missing" as const),
      };
    }
    if (composerPages.length !== 1) {
      return {
        state:
          composerPages.length > 1
            ? ("ambiguous" as const)
            : ("unsupported" as const),
      };
    }
    const workspace = composerPages[0]!;
    const marker = visibleMarkers[0]!;
    if (
      marker.parentElement !== workspace ||
      !workspace.contains(composer) ||
      composer.contains(marker) ||
      marker.closest("nav, [role='navigation'], header")
    ) {
      return { state: "unsupported" as const };
    }
    for (let ancestor: HTMLElement | null = marker; ancestor;) {
      const signals = [
        ancestor.localName,
        ancestor.getAttribute("aria-label") ?? "",
        ancestor.getAttribute("data-testid") ?? "",
        typeof ancestor.className === "string" ? ancestor.className : "",
      ].join(" ");
      if (/account|profile|billing|avatar/i.test(signals)) {
        return { state: "unsupported" as const };
      }
      ancestor = ancestor.parentElement;
    }

    const loadingSelector =
      '[role="progressbar"], [aria-busy="true"], [data-loading="true"], [data-state="loading"], [data-state="generating"], [class*="spinner" i], [class*="loading" i]';
    const visibleLoadingCount = [
      ...(workspace.matches(loadingSelector) ? [workspace] : []),
      ...workspace.querySelectorAll<HTMLElement>(loadingSelector),
    ].filter(visibleEnabled).length;
    const statusTextLoading = Array.from(
      workspace.querySelectorAll<HTMLElement>(
        '[role="status"], [role="alert"], [aria-live]',
      ),
    ).some(
      (status) =>
        visibleEnabled(status) &&
        /\b(loading|generating|processing|please wait)\b/i.test(
          status.textContent ?? "",
        ),
    );
    const visibleMediaCount = Array.from(
      workspace.querySelectorAll<HTMLElement>("img, video, canvas"),
    ).filter(
      (media) => !composer.contains(media) && visibleEnabled(media),
    ).length;
    const cardSelector =
      'article, [role="listitem"], [role="gridcell"], [data-result-card], [data-testid*="result" i], [data-testid*="gallery-item" i]';
    const visibleCardCount = Array.from(
      workspace.querySelectorAll<HTMLElement>(cardSelector),
    ).filter((card) => !composer.contains(card) && visibleEnabled(card)).length;
    const conflictingLabelledSurface = regionCandidates.some((region) =>
      workspace.contains(region),
    );
    if (
      visibleLoadingCount > 0 ||
      statusTextLoading ||
      visibleMediaCount > 0 ||
      visibleCardCount > 0 ||
      conflictingLabelledSurface
    ) {
      return { state: "unsupported" as const };
    }
    return {
      state: "ready" as const,
      workspace,
      marker,
      visibleMediaCount: 0,
      visibleCardCount: 0,
      loadingCount: 0,
    };
  };

  let emptyWorkspace = inspectEmptyWorkspace();
  if (emptyWorkspace.state === "ready") {
    const workspace = emptyWorkspace.workspace;
    const marker = emptyWorkspace.marker;
    const observer = new MutationObserver(() => undefined);
    observer.observe(workspace, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const mutations = observer.takeRecords().length;
    observer.disconnect();
    const settled = inspectEmptyWorkspace();
    if (
      mutations > 0 ||
      settled.state !== "ready" ||
      settled.workspace !== workspace ||
      settled.marker !== marker
    ) {
      emptyWorkspace = { state: "unstable" };
    } else {
      emptyWorkspace = settled;
    }
  }

  let observation: FlowGenerateDiscovery["observation"];
  let baseline: FlowImageBaseline | undefined;
  if (emptyWorkspace.state === "ready") {
    observation = "ready";
    baseline = {
      kind: "flow_empty_workspace_ui",
      workspaceTag: "flow-project-page",
      markerPhrase,
      markerCount: 1,
      visibleMediaCount: 0,
      visibleResultCardCount: 0,
      loadingMarkerCount: 0,
      capturedAt: Date.now(),
    };
  } else if (
    emptyWorkspace.state === "ambiguous" ||
    emptyWorkspace.state === "unstable" ||
    (emptyWorkspace.state === "unsupported" && visibleMarkers.length > 0)
  ) {
    observation = emptyWorkspace.state;
  } else if (regionCandidates.length === 1) {
    observation = "ready";
    const region = regionCandidates[0]!;
    baseline = {
      regionLabel: region.getAttribute("aria-label")!.trim(),
      mediaCount: mediaCount(region),
      capturedAt: Date.now(),
    };
  } else if (regionCandidates.length > 1) {
    observation = "ambiguous";
  } else if (emptyWorkspace.state === "unsupported") {
    observation = "unsupported";
  } else {
    observation = "missing";
  }
  return {
    composer: "identified",
    exactPrompt: currentText === expectedText,
    actualCodeUnits: currentText.length,
    generate,
    observation,
    ...(baseline ? { baseline } : {}),
    generationAvailable: false,
  };
}

export function flowImageRuntimeExpression(
  expectedText: string,
  mode: "inspect" | "button" = "inspect",
): string {
  return `(${flowImageRuntime.toString()})(${JSON.stringify(expectedText)},${JSON.stringify(mode)},(${flowComposerRuntime.toString()}),(${readFlowEditorRuntime.toString()}),async()=>(${flowWorkspaceScopeAnalyzer.toString()})())`;
}

function sameFlowImageBaseline(
  current: FlowImageBaseline | undefined,
  expected: FlowImageBaseline,
): boolean {
  if (!current) return false;
  if ("kind" in current || "kind" in expected) {
    if (
      !("kind" in current && "kind" in expected) ||
      current.kind !== expected.kind
    )
      return false;
    if (
      current.kind === "flow_empty_workspace_ui" &&
      expected.kind === current.kind
    ) {
      return (
        current.workspaceTag === expected.workspaceTag &&
        current.markerPhrase === expected.markerPhrase &&
        current.markerCount === expected.markerCount &&
        current.visibleMediaCount === expected.visibleMediaCount &&
        current.visibleResultCardCount === expected.visibleResultCardCount &&
        current.loadingMarkerCount === expected.loadingMarkerCount
      );
    }
    if (
      current.kind === "flow_rendered_tile_candidates" &&
      expected.kind === current.kind
    ) {
      const sorted = (
        entries: Array<{ candidateId: string; renderedCopies: number }>,
      ) =>
        [...entries]
          .sort((left, right) =>
            left.candidateId.localeCompare(right.candidateId),
          )
          .map((entry) => `${entry.candidateId}:${entry.renderedCopies}`)
          .join("|");
      return (
        current.renderedTileCount === expected.renderedTileCount &&
        current.repeatedCandidateCount === expected.repeatedCandidateCount &&
        current.unidentifiedImageCount === expected.unidentifiedImageCount &&
        current.unrelatedImageCount === expected.unrelatedImageCount &&
        current.virtualized === expected.virtualized &&
        current.loadingSignalCount === expected.loadingSignalCount &&
        current.captureGaps.join("|") === expected.captureGaps.join("|") &&
        sorted(current.candidateMultiplicity) ===
          sorted(expected.candidateMultiplicity)
      );
    }
    return false;
  }
  return (
    current.regionLabel === expected.regionLabel &&
    current.mediaCount === expected.mediaCount
  );
}

export type FlowImagePagePort = Pick<
  FlowPromptEntryPort,
  "sendCommand" | "attach" | "detach" | "now"
>;

export async function captureFlowDocumentBinding(
  port: FlowImagePagePort,
  tabId: number,
): Promise<FlowDocumentBinding> {
  await port.attach(tabId);
  try {
    await port.sendCommand(tabId, "Page.enable");
    const response = (await port.sendCommand(tabId, "Page.getFrameTree")) as {
      frameTree?: {
        frame?: { id?: string; loaderId?: string; url?: string };
      };
    };
    const frame = response.frameTree?.frame;
    if (!frame?.id || !frame.loaderId || !frame.url) {
      throw new Error("flow_document_binding_unavailable");
    }
    return { frameId: frame.id, loaderId: frame.loaderId, url: frame.url };
  } finally {
    await port.detach(tabId).catch(() => undefined);
  }
}

export async function readFlowDocumentBinding(
  port: FlowImagePagePort,
  tabId: number,
): Promise<FlowDocumentBinding | undefined> {
  const response = (await port.sendCommand(tabId, "Page.getFrameTree")) as {
    frameTree?: { frame?: { id?: string; loaderId?: string; url?: string } };
  };
  const frame = response.frameTree?.frame;
  if (!frame?.id || !frame.loaderId || !frame.url) return undefined;
  return { frameId: frame.id, loaderId: frame.loaderId, url: frame.url };
}

export async function inspectFlowImageGenerate(
  port: FlowImagePagePort,
  tabId: number,
  expectedText: string,
): Promise<FlowGenerateDiscovery> {
  const response = (await port.sendCommand(tabId, "Runtime.evaluate", {
    expression: flowImageRuntimeExpression(expectedText),
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: FlowGenerateDiscovery } };
  const discovery = response.result?.value;
  if (!discovery) throw new Error("flow_generate_inspection_failed");
  if (discovery.generate === "identified") {
    const button = (await port.sendCommand(tabId, "Runtime.evaluate", {
      expression: flowImageRuntimeExpression(expectedText, "button"),
      returnByValue: false,
      awaitPromise: true,
    })) as { result?: { objectId?: string; subtype?: string } };
    if (button.result?.objectId && button.result.subtype === "node") {
      discovery.buttonObjectId = button.result.objectId;
    } else {
      discovery.generate = "missing";
    }
  }
  return discovery;
}

/** Read-only inspection of the current Flow editor text without inserting text or mutating state. */
export async function readCurrentFlowEditorText(
  port: Pick<FlowImagePagePort, "sendCommand">,
  tabId: number,
): Promise<{ found: boolean; text?: string; error?: string }> {
  const expression = `(() => {
    try {
      const getEditor = (${flowComposerRuntime.toString()});
      const readText = (${readFlowEditorRuntime.toString()});
      const editor = getEditor("", true, readText);
      if (!(editor instanceof HTMLElement)) return { found: false };
      return { found: true, text: readText(editor) };
    } catch (err) {
      return {
        found: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  })()`;
  const response = (await port.sendCommand(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: false,
  })) as {
    result?: {
      value?: { found?: boolean; text?: string; error?: string };
    };
  };
  const val = response.result?.value;
  return {
    found: Boolean(val?.found),
    text: typeof val?.text === "string" ? val.text : undefined,
    error: typeof val?.error === "string" ? val.error : undefined,
  };
}

/** Timed mode inspects only the uniquely owned composer and its Generate control.
 * It deliberately does not inspect result tiles, image counts, or observer state. */
export async function inspectTimedFlowGenerate(
  port: FlowImagePagePort,
  tabId: number,
  expectedText: string,
): Promise<{
  exactPrompt: boolean;
  generate: "identified" | "missing" | "ambiguous" | "disabled";
  buttonObjectId?: string;
}> {
  const expression = `(${flowTimedGenerateRuntime.toString()})(${JSON.stringify(expectedText)},(${flowComposerRuntime.toString()}),(${readFlowEditorRuntime.toString()}))`;
  const response = (await port.sendCommand(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: false,
    awaitPromise: false,
  })) as {
    result?: {
      objectId?: string;
      subtype?: string;
      description?: string;
      value?: unknown;
    };
  };
  const buttonObjectId = response.result?.objectId;
  if (!buttonObjectId || response.result?.subtype !== "node")
    return { exactPrompt: false, generate: "missing" };
  const metadata = (await port.sendCommand(tabId, "Runtime.callFunctionOn", {
    objectId: buttonObjectId,
    functionDeclaration:
      "function(){return {exact:this.dataset.afExact==='true',state:this.dataset.afState, count:Number(this.dataset.afCount)}}",
    returnByValue: true,
    awaitPromise: false,
  })) as {
    result?: { value?: { exact?: boolean; state?: string; count?: number } };
  };
  const value = metadata.result?.value;
  return {
    exactPrompt: value?.exact === true,
    generate:
      value?.state === "ambiguous"
        ? "ambiguous"
        : value?.state === "disabled"
          ? "disabled"
          : value?.state === "identified"
            ? "identified"
            : "missing",
    ...(value?.state === "identified" ? { buttonObjectId } : {}),
  };
}

function flowTimedGenerateRuntime(
  expectedText: string,
  composerRuntime: typeof flowComposerRuntime,
  readText: typeof readFlowEditorRuntime,
): HTMLElement | null {
  const editor = composerRuntime("", true, readText);
  if (!(editor instanceof HTMLElement)) return null;
  const rich = editor.closest("flow-rich-text-editor");
  const boundary = rich
    ? editor.closest<HTMLElement>("flow-base-prompt-box")
    : editor.closest<HTMLElement>(
        'form, [role="form"], [role="group"], [role="region"], [data-composer]',
      );
  if (!boundary) return null;
  let actual: string;
  try {
    actual = readText(editor);
  } catch {
    return null;
  }
  const name = (element: HTMLElement) =>
    (
      element.getAttribute("aria-label")?.trim() ||
      element.textContent?.trim() ||
      ""
    ).replace(/\s+/g, " ");
  const candidates = Array.from(
    boundary.querySelectorAll<HTMLElement>("button, [role='button']"),
  ).filter((button) =>
    /^(generate|generate image|create image|start generation)$/i.test(
      name(button),
    ),
  );
  const enabled = candidates.filter((button) => {
    const style = getComputedStyle(button);
    return (
      button.isConnected &&
      !button.matches(":disabled, [disabled], [aria-disabled='true']") &&
      !button.closest("[hidden], [inert], [aria-hidden='true']") &&
      style.display !== "none" &&
      style.visibility === "visible" &&
      button.getClientRects().length > 0
    );
  });
  if (candidates.length !== 1 || enabled.length !== 1) {
    const marker = document.createElement("span");
    marker.dataset.afState =
      candidates.length > 1
        ? "ambiguous"
        : candidates.length === 1
          ? "disabled"
          : "missing";
    return marker;
  }
  const button = enabled[0]!;
  button.dataset.afExact = String(actual === expectedText);
  button.dataset.afState = "identified";
  button.dataset.afCount = String(candidates.length);
  return button;
}

export async function inspectFlowImageButton(
  port: FlowImagePagePort,
  tabId: number,
  buttonObjectId: string,
): Promise<{ x: number; y: number } | undefined> {
  const response = (await port.sendCommand(tabId, "Runtime.callFunctionOn", {
    objectId: buttonObjectId,
    functionDeclaration:
      "function(){ if(!this.isConnected || this.matches(':disabled,[disabled],[aria-disabled=true]')) return null; const r=this.getBoundingClientRect(); if(!r.width||!r.height) return null; return {x:r.left+r.width/2,y:r.top+r.height/2}; }",
    returnByValue: true,
    awaitPromise: false,
  })) as { result?: { value?: { x?: number; y?: number } | null } };
  const position = response.result?.value;
  return typeof position?.x === "number" && typeof position?.y === "number"
    ? { x: position.x, y: position.y }
    : undefined;
}

export async function recheckFlowImageGenerate(
  port: FlowImagePagePort,
  tabId: number,
  expectedText: string,
  expectedFrame: FlowDocumentBinding,
  buttonObjectId: string,
  baseline: FlowImageBaseline,
): Promise<boolean> {
  const frame = await readFlowDocumentBinding(port, tabId);
  if (
    !frame ||
    frame.frameId !== expectedFrame.frameId ||
    frame.loaderId !== expectedFrame.loaderId
  ) {
    return false;
  }
  const latest = await inspectFlowImageGenerate(port, tabId, expectedText);
  if (
    latest.composer !== "identified" ||
    !latest.exactPrompt ||
    latest.generate !== "identified" ||
    latest.observation !== "ready" ||
    !sameFlowImageBaseline(latest.baseline, baseline)
  ) {
    return false;
  }
  const position = await inspectFlowImageButton(port, tabId, buttonObjectId);
  return Boolean(position);
}

export async function activateFlowImageGenerate(
  port: FlowImagePagePort,
  tabId: number,
  x: number,
  y: number,
): Promise<{
  complete: boolean;
  pressAttempted: boolean;
  releaseAttempted: boolean;
}> {
  let pressAttempted = false;
  let releaseAttempted = false;
  let complete = false;
  try {
    pressAttempted = true;
    await port.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    releaseAttempted = true;
    await port.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    complete = true;
  } catch {
    if (pressAttempted && !releaseAttempted) {
      releaseAttempted = true;
      await port
        .sendCommand(tabId, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          buttons: 0,
          clickCount: 1,
        })
        .catch(() => undefined);
    }
  }
  return { complete, pressAttempted, releaseAttempted };
}
