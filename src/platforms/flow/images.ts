import { flowComposerRuntime, readFlowEditorRuntime } from "./composer";
import type { FlowPromptEntryPort } from "./promptEntry";
import type { FlowImageBaseline } from "./observer";

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
): Promise<FlowGenerateDiscovery | HTMLElement | null> {
  const editor = composerRuntime("", true, readText);
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
    ? richBoundary
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
  return `(${flowImageRuntime.toString()})(${JSON.stringify(expectedText)},${JSON.stringify(mode)},(${flowComposerRuntime.toString()}),(${readFlowEditorRuntime.toString()}))`;
}

function sameFlowImageBaseline(
  current: FlowImageBaseline | undefined,
  expected: FlowImageBaseline,
): boolean {
  if (!current) return false;
  if ("kind" in current || "kind" in expected) {
    return (
      "kind" in current &&
      "kind" in expected &&
      current.kind === expected.kind &&
      current.workspaceTag === expected.workspaceTag &&
      current.markerPhrase === expected.markerPhrase &&
      current.markerCount === expected.markerCount &&
      current.visibleMediaCount === expected.visibleMediaCount &&
      current.visibleResultCardCount === expected.visibleResultCardCount &&
      current.loadingMarkerCount === expected.loadingMarkerCount
    );
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
