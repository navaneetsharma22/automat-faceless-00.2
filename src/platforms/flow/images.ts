import { flowComposerRuntime } from "./composer";
import type { FlowPromptEntryPort } from "./promptEntry";

export type FlowDocumentBinding = {
  frameId: string;
  loaderId: string;
  url: string;
};

export type FlowImageBaseline = {
  regionLabel: string;
  mediaCount: number;
  capturedAt: number;
};

export type FlowGenerateDiscovery = {
  composer: "identified" | "missing" | "ambiguous" | "unsupported";
  exactPrompt: boolean;
  actualCodeUnits: number;
  generate: "identified" | "missing" | "ambiguous" | "disabled";
  observation: "ready" | "missing" | "ambiguous";
  baseline?: FlowImageBaseline;
  buttonObjectId?: string;
  generationAvailable: false;
};

/** Semantic fixture signals only; these have not been checked against Flow. */
export function flowImageRuntime(
  expectedText: string,
  mode: "inspect" | "button" = "inspect",
): FlowGenerateDiscovery | HTMLElement | null {
  const editor = flowComposerRuntime("", true);
  if (!(editor instanceof HTMLElement)) {
    const rawDiscovery = flowComposerRuntime("", false);
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
  if (
    !(
      editor instanceof HTMLInputElement ||
      editor instanceof HTMLTextAreaElement
    ) ||
    (editor instanceof HTMLInputElement && editor.type !== "text")
  ) {
    return {
      composer: "unsupported",
      exactPrompt: false,
      actualCodeUnits: 0,
      generate: "missing",
      observation: "missing",
      generationAvailable: false,
    };
  }
  const boundary = editor.closest<HTMLElement>(
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
  const generateCandidates = Array.from(
    boundary.querySelectorAll<HTMLElement>("button, [role='button']"),
  ).filter((button) =>
    /^(generate|generate image|create image)$/i.test(nameOf(button)),
  );
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
  const observation: FlowGenerateDiscovery["observation"] =
    regionCandidates.length === 0
      ? "missing"
      : regionCandidates.length > 1
        ? "ambiguous"
        : "ready";
  const region =
    regionCandidates.length === 1 ? regionCandidates[0]! : undefined;
  const currentText =
    editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement
      ? editor.value
      : "";
  return {
    composer: "identified",
    exactPrompt: currentText === expectedText,
    actualCodeUnits: currentText.length,
    generate,
    observation,
    ...(region
      ? {
          baseline: {
            regionLabel: region.getAttribute("aria-label")!.trim(),
            mediaCount: mediaCount(region),
            capturedAt: Date.now(),
          },
        }
      : {}),
    generationAvailable: false,
  };
}

export function flowImageRuntimeExpression(
  expectedText: string,
  mode: "inspect" | "button" = "inspect",
): string {
  return `(${flowImageRuntime.toString()})(${JSON.stringify(expectedText)}, ${JSON.stringify(mode)})`;
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
    awaitPromise: false,
  })) as { result?: { value?: FlowGenerateDiscovery } };
  const discovery = response.result?.value;
  if (!discovery) throw new Error("flow_generate_inspection_failed");
  if (discovery.generate === "identified") {
    const button = (await port.sendCommand(tabId, "Runtime.evaluate", {
      expression: flowImageRuntimeExpression(expectedText, "button"),
      returnByValue: false,
      awaitPromise: false,
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
    latest.baseline?.regionLabel !== baseline.regionLabel ||
    latest.baseline?.mediaCount !== baseline.mediaCount
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
