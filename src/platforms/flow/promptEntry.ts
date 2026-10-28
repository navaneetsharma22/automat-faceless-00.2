import { importPromptBatch } from "../../domain/batches/importBatch";
import { sha256Hex } from "../../storage/repositories";
import { flowComposerRuntime, type FlowComposerDiscovery } from "./composer";
import { flowTabFromUrl, sameFlowDocument } from "./connection";
import type { ProviderTab } from "../shared/contracts";

export type FlowTargetSelection = {
  tabId: number;
  canonicalTarget: string;
};

export type FlowPromptEntryResult = {
  outcome:
    | "filled"
    | "already-matching"
    | "blocked"
    | "input-uncertain"
    | "readback-mismatch";
  stage:
    | "target-validation"
    | "permission-check"
    | "connector-reachability"
    | "composer-discovery"
    | "editor-preflight"
    | "entry"
    | "settled-readback"
    | "timeout";
  code: string;
  message: string;
  connectorReachable: boolean;
  composer: "identified" | "missing" | "ambiguous" | "unsupported";
  methodCompatible: boolean;
  fillVerified: boolean;
  generationAvailable: false;
  inputMethod: "CDP Input.insertText" | "none";
  expectedCodeUnits: number;
  actualCodeUnits?: number;
  expectedUtf8Bytes: number;
  actualUtf8Bytes?: number;
  expectedSha256: string;
  actualSha256?: string;
  immediateMatch?: boolean;
  settledMatch?: boolean;
  stableReadback?: boolean;
  firstDifferenceOffset?: number;
  mismatchCategory?: "length" | "code-unit" | "representation";
  editorReplaced?: boolean;
  elapsedMs: number;
};

export type FlowPromptEntryPort = {
  getSelection: () => Promise<FlowTargetSelection | undefined>;
  getTab: (tabId: number) => Promise<ProviderTab | undefined>;
  hasRequiredApis: () => boolean;
  hasDebuggerPermission: () => Promise<boolean>;
  attach: (tabId: number) => Promise<void>;
  sendCommand: (
    tabId: number,
    method: string,
    params?: object,
  ) => Promise<unknown>;
  detach: (tabId: number) => Promise<void>;
  expectedFrame?: Pick<FrameIdentity, "frameId" | "loaderId">;
  now?: () => number;
};

export type FrameIdentity = {
  frameId: string;
  loaderId?: string;
  url: string;
};

const ENTRY_DEADLINE_MS = 12_000;
const READBACK_DEADLINE_MS = 1_500;
const READBACK_INTERVAL_MS = 40;
const REQUIRED_STABLE_READS = 3;

export async function enterFlowPrompt(
  rawJsonBody: string,
  port: FlowPromptEntryPort,
): Promise<FlowPromptEntryResult> {
  const now = port.now ?? Date.now;
  const startedAt = now();
  const expectedBytes = new TextEncoder().encode(rawJsonBody).byteLength;
  const expectedSha256 = await sha256Hex(rawJsonBody);
  const result = (
    overrides: Partial<FlowPromptEntryResult>,
  ): FlowPromptEntryResult => ({
    outcome: "blocked",
    stage: "target-validation",
    code: "preflight_blocked",
    message: "Flow prompt entry was blocked before input.",
    connectorReachable: false,
    composer: "missing",
    methodCompatible: false,
    fillVerified: false,
    generationAvailable: false,
    inputMethod: "none",
    expectedCodeUnits: rawJsonBody.length,
    expectedUtf8Bytes: expectedBytes,
    expectedSha256,
    elapsedMs: Math.max(0, now() - startedAt),
    ...overrides,
  });

  if (rawJsonBody.length === 0) {
    return result({
      code: "empty_prompt",
      message: "The image prompt is empty.",
    });
  }
  const parsed = importPromptBatch(rawJsonBody, "image");
  if (
    !parsed.ok ||
    parsed.items.length !== 1 ||
    parsed.items[0]!.rawBody !== rawJsonBody
  ) {
    return result({
      code: "invalid_single_prompt",
      message:
        "Provide exactly one complete image JSON body from the current validated preview.",
    });
  }
  if (!port.hasRequiredApis()) {
    return result({
      stage: "permission-check",
      code: "debugger_api_unavailable",
      message:
        "Chrome debugger access is unavailable. No provider input was sent.",
    });
  }
  if (!(await port.hasDebuggerPermission())) {
    return result({
      stage: "permission-check",
      code: "debugger_permission_missing",
      message:
        "The required Chrome debugger permission is unavailable. No provider input was sent.",
    });
  }
  const selected = await port.getSelection();
  if (!selected || selected.tabId < 0) {
    return result({
      code: "flow_target_not_selected",
      message: "Select the intended Flow project in Connections first.",
    });
  }
  const initialTab = await port.getTab(selected.tabId);
  const selectedParsed = flowTabFromUrl(
    selected.tabId,
    initialTab?.title ?? "",
    initialTab?.url,
  );
  if (
    !initialTab ||
    !selectedParsed ||
    selectedParsed.canonicalTarget !== selected.canonicalTarget
  ) {
    return result({
      code: "flow_target_changed",
      message:
        "The explicitly selected Flow tab no longer matches its saved project. No provider input was sent.",
    });
  }
  const target: ProviderTab = { ...selectedParsed, url: initialTab.url };
  const deadline = startedAt + ENTRY_DEADLINE_MS;
  let attached = false;
  let connectorReachable = false;
  let frame: FrameIdentity | undefined;
  let editorObjectId: string | undefined;
  let insertionAttempted = false;

  try {
    await withDeadline(port.attach(target.id), deadline, now);
    attached = true;
    connectorReachable = true;
    await command(port, target.id, "Page.enable", undefined, deadline, now);
    await command(port, target.id, "Runtime.enable", undefined, deadline, now);
    frame = await readTopFrame(port, target.id, deadline, now);
    if (
      port.expectedFrame &&
      (frame.frameId !== port.expectedFrame.frameId ||
        frame.loaderId !== port.expectedFrame.loaderId)
    ) {
      return result({
        stage: "target-validation",
        code: "document_binding_changed",
        message:
          "The selected Flow document changed after attempt preparation. No prompt input was sent.",
        connectorReachable,
      });
    }
    if (!(await targetAndFrameCurrent(port, target, frame, deadline, now))) {
      return result({
        stage: "target-validation",
        code: "document_binding_changed",
        message:
          "The selected Flow document changed during preflight. No input was sent.",
        connectorReachable,
      });
    }

    const inspected = await evaluate<FlowComposerDiscovery>(
      port,
      target.id,
      runtimeExpression("", false),
      deadline,
      now,
    );
    const composer =
      inspected.state === "missing"
        ? "missing"
        : inspected.state === "ambiguous"
          ? "ambiguous"
          : inspected.state === "unsupported"
            ? "unsupported"
            : "identified";
    if (composer !== "identified" || !inspected.methodCompatible) {
      return result({
        stage: "composer-discovery",
        code: `composer_${composer}`,
        message:
          composer === "missing"
            ? "A supported Flow prompt composer was not found."
            : composer === "ambiguous"
              ? "More than one Flow prompt composer matched; choose a supported composer before filling."
              : "The Flow prompt editor does not support the implemented entry method.",
        connectorReachable,
        composer,
      });
    }

    const currentText = inspected.currentText ?? "";
    if (currentText === rawJsonBody) {
      inspected.state = "already-matching";
    }
    if (inspected.state === "conflict") {
      const conflictComparison = await compareText(rawJsonBody, currentText);
      return result({
        stage: "editor-preflight",
        code: "editor_has_different_text",
        message:
          "The Flow prompt editor already contains different text. It was left unchanged.",
        connectorReachable,
        composer: "identified",
        methodCompatible: inspected.methodCompatible,
        actualCodeUnits: currentText.length,
        actualUtf8Bytes: new TextEncoder().encode(currentText).byteLength,
        actualSha256: await sha256Hex(currentText),
        immediateMatch: false,
        settledMatch: false,
        firstDifferenceOffset: conflictComparison.firstDifferenceOffset,
        mismatchCategory: conflictComparison.mismatchCategory,
      });
    }
    if (inspected.state !== "empty" && inspected.state !== "already-matching") {
      return result({
        stage: "editor-preflight",
        code: "editor_preflight_unavailable",
        message:
          "The Flow prompt editor could not be safely read. No input was sent.",
        connectorReachable,
        composer: "identified",
      });
    }

    const remote = (await command(
      port,
      target.id,
      "Runtime.evaluate",
      {
        expression: runtimeExpression("", true),
        returnByValue: false,
        awaitPromise: false,
        userGesture: false,
      },
      deadline,
      now,
    )) as { result?: { objectId?: string; subtype?: string; value?: unknown } };
    editorObjectId = remote.result?.objectId;
    if (!editorObjectId || remote.result?.subtype !== "node") {
      return result({
        stage: "editor-preflight",
        code: "editor_binding_failed",
        message:
          "The unique Flow editor binding could not be secured. No input was sent.",
        connectorReachable,
        composer: "identified",
      });
    }

    if (inspected.state === "already-matching") {
      const settled = await readStableEditor(
        port,
        target.id,
        editorObjectId,
        deadline,
        now,
      );
      const comparison = await compareText(rawJsonBody, settled.text);
      return result({
        outcome: comparison.equal ? "already-matching" : "readback-mismatch",
        stage: "settled-readback",
        code: comparison.equal
          ? "already_matching_verified"
          : "already_matching_changed",
        message: comparison.equal
          ? "The Flow editor already contained this exact prompt and remained stable. No text was inserted."
          : "The Flow editor changed during settled readback; no text was inserted.",
        connectorReachable,
        composer: "identified",
        methodCompatible: true,
        fillVerified: comparison.equal,
        inputMethod: "none",
        actualCodeUnits: settled.text.length,
        actualUtf8Bytes: new TextEncoder().encode(settled.text).byteLength,
        actualSha256: await sha256Hex(settled.text),
        immediateMatch: comparison.equal,
        settledMatch: comparison.equal,
        firstDifferenceOffset: comparison.firstDifferenceOffset,
        mismatchCategory: comparison.mismatchCategory,
        editorReplaced: false,
        elapsedMs: Math.max(0, now() - startedAt),
      });
    }

    if (!(await targetAndFrameCurrent(port, target, frame, deadline, now))) {
      return result({
        stage: "target-validation",
        code: "document_binding_changed",
        message:
          "The selected Flow document changed before text input. No input was sent.",
        connectorReachable,
        composer: "identified",
      });
    }
    const focused = (await command(
      port,
      target.id,
      "Runtime.callFunctionOn",
      {
        objectId: editorObjectId,
        functionDeclaration:
          "function(){ if (!this.isConnected) return false; this.focus(); return this.isConnected && document.activeElement === this; }",
        returnByValue: true,
        awaitPromise: false,
      },
      deadline,
      now,
    )) as { result?: { value?: unknown } };
    if (focused.result?.value !== true) {
      return result({
        stage: "editor-preflight",
        code: "editor_lost_before_input",
        message:
          "The selected Flow editor was replaced or lost focus before input. No input was sent.",
        connectorReachable,
        composer: "identified",
      });
    }
    const freshText = await readEditorObject(
      port,
      target.id,
      editorObjectId,
      deadline,
      now,
    );
    if (freshText !== "") {
      return result({
        stage: "editor-preflight",
        code: "editor_changed_before_input",
        message:
          "The Flow editor changed after preflight. It was left unchanged.",
        connectorReachable,
        composer: "identified",
      });
    }
    if (!(await targetAndFrameCurrent(port, target, frame, deadline, now))) {
      return result({
        stage: "target-validation",
        code: "document_binding_changed",
        message:
          "The selected Flow document changed immediately before text input. No input was sent.",
        connectorReachable,
        composer: "identified",
      });
    }
    insertionAttempted = true;
    await withDeadline(
      command(
        port,
        target.id,
        "Input.insertText",
        { text: rawJsonBody },
        deadline,
        now,
      ),
      deadline,
      now,
    );
    const immediateText = await readEditorObject(
      port,
      target.id,
      editorObjectId,
      deadline,
      now,
    );
    const immediate = await compareText(rawJsonBody, immediateText);
    const settled = await readStableEditor(
      port,
      target.id,
      editorObjectId,
      deadline,
      now,
    );
    const comparison = await compareText(rawJsonBody, settled.text);
    const actualSha256 = await sha256Hex(settled.text);
    if (!(await targetAndFrameCurrent(port, target, frame, deadline, now))) {
      return result({
        outcome: "input-uncertain",
        stage: "target-validation",
        code: "document_changed_after_input",
        message:
          "The selected Flow document changed after text input. The outcome is uncertain; do not retry automatically.",
        connectorReachable,
        composer: "identified",
        methodCompatible: true,
        inputMethod: "CDP Input.insertText",
        actualCodeUnits: settled.text.length,
        actualUtf8Bytes: new TextEncoder().encode(settled.text).byteLength,
        actualSha256,
        immediateMatch: immediate.equal,
        settledMatch: comparison.equal,
        stableReadback: settled.stable,
        firstDifferenceOffset: comparison.firstDifferenceOffset,
        mismatchCategory: comparison.mismatchCategory,
        editorReplaced: settled.replaced,
      });
    }
    const replaced = settled.replaced;
    return result({
      outcome: comparison.equal ? "filled" : "readback-mismatch",
      stage: "settled-readback",
      code: comparison.equal ? "fill_verified" : "readback_mismatch",
      message: comparison.equal
        ? "Flow accepted the text and settled readback matched exactly. Generate remains unavailable."
        : "The editor text did not match the submitted prompt exactly. Do not retry automatically.",
      connectorReachable,
      composer: "identified",
      methodCompatible: true,
      fillVerified: comparison.equal,
      inputMethod: "CDP Input.insertText",
      actualCodeUnits: settled.text.length,
      actualUtf8Bytes: new TextEncoder().encode(settled.text).byteLength,
      actualSha256,
      immediateMatch: immediate.equal,
      settledMatch: comparison.equal,
      stableReadback: settled.stable,
      firstDifferenceOffset: comparison.firstDifferenceOffset,
      mismatchCategory: comparison.mismatchCategory,
      editorReplaced: replaced,
      elapsedMs: Math.max(0, now() - startedAt),
    });
  } catch (error) {
    let actualText: string | undefined;
    if (insertionAttempted && attached && editorObjectId) {
      try {
        actualText = await readEditorObject(
          port,
          target.id,
          editorObjectId,
          startedAt + ENTRY_DEADLINE_MS,
          now,
        );
      } catch {
        actualText = undefined;
      }
    }
    const timedOut =
      error instanceof Error && error.message === "flow_entry_timeout";
    const comparison =
      actualText === undefined
        ? undefined
        : await compareText(rawJsonBody, actualText);
    return result({
      outcome: insertionAttempted ? "input-uncertain" : "blocked",
      stage: timedOut
        ? "timeout"
        : insertionAttempted
          ? "entry"
          : "connector-reachability",
      code: timedOut
        ? "flow_operation_timeout"
        : insertionAttempted
          ? "input_result_uncertain"
          : "flow_entry_failed",
      message: insertionAttempted
        ? "Text input may have partially completed. The extension did not retry or activate Generate; inspect the selected editor before taking another action."
        : safeErrorMessage(error),
      connectorReachable,
      composer: editorObjectId ? "identified" : "missing",
      methodCompatible: Boolean(editorObjectId),
      inputMethod: insertionAttempted ? "CDP Input.insertText" : "none",
      ...(actualText === undefined
        ? {}
        : {
            actualCodeUnits: actualText.length,
            actualUtf8Bytes: new TextEncoder().encode(actualText).byteLength,
            actualSha256: await sha256Hex(actualText),
            immediateMatch: comparison?.equal,
            settledMatch: comparison?.equal,
            firstDifferenceOffset: comparison?.firstDifferenceOffset,
            mismatchCategory: comparison?.mismatchCategory,
          }),
    });
  } finally {
    if (attached) {
      try {
        await port.detach(target.id);
      } catch {
        // The result already carries the operation outcome; no further input is attempted.
      }
    }
  }
}

function runtimeExpression(
  expectedText: string,
  returnEditor: boolean,
): string {
  return `(${flowComposerRuntime.toString()})(${JSON.stringify(expectedText)}, ${returnEditor})`;
}

async function readTopFrame(
  port: FlowPromptEntryPort,
  tabId: number,
  deadline: number,
  now: () => number,
): Promise<FrameIdentity> {
  const response = (await command(
    port,
    tabId,
    "Page.getFrameTree",
    undefined,
    deadline,
    now,
  )) as {
    frameTree?: { frame?: { id?: string; loaderId?: string; url?: string } };
  };
  const frame = response.frameTree?.frame;
  if (!frame?.id || !frame.url) throw new Error("top_frame_unavailable");
  return { frameId: frame.id, loaderId: frame.loaderId, url: frame.url };
}

async function targetAndFrameCurrent(
  port: FlowPromptEntryPort,
  target: ProviderTab,
  expectedFrame: FrameIdentity,
  deadline: number,
  now: () => number,
): Promise<boolean> {
  const selection = await port.getSelection();
  if (
    selection?.tabId !== target.id ||
    selection.canonicalTarget !== target.canonicalTarget
  ) {
    return false;
  }
  const tab = await port.getTab(target.id);
  const parsed = flowTabFromUrl(target.id, tab?.title ?? "", tab?.url);
  if (
    !sameFlowDocument(target, parsed) ||
    parsed?.canonicalTarget !== target.canonicalTarget
  )
    return false;
  const frame = await readTopFrame(port, target.id, deadline, now);
  return (
    frame.frameId === expectedFrame.frameId &&
    frame.loaderId === expectedFrame.loaderId &&
    frame.url === expectedFrame.url
  );
}

async function evaluate<T>(
  port: FlowPromptEntryPort,
  tabId: number,
  expression: string,
  deadline: number,
  now: () => number,
): Promise<T> {
  const response = (await command(
    port,
    tabId,
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: false,
      userGesture: false,
    },
    deadline,
    now,
  )) as { result?: { value?: T; subtype?: string } };
  if (
    response.result?.subtype === "error" ||
    response.result?.value === undefined
  ) {
    throw new Error("composer_inspection_failed");
  }
  return response.result.value;
}

async function readEditorObject(
  port: FlowPromptEntryPort,
  tabId: number,
  objectId: string,
  deadline: number,
  now: () => number,
): Promise<string> {
  const response = (await command(
    port,
    tabId,
    "Runtime.callFunctionOn",
    {
      objectId,
      functionDeclaration:
        "function(){ if (!this.isConnected) return { connected:false, text:'' }; const tag=this.tagName.toLowerCase(); return { connected:true, text:tag==='textarea'||tag==='input'?this.value:(this.textContent||'') }; }",
      returnByValue: true,
      awaitPromise: false,
    },
    deadline,
    now,
  )) as { result?: { value?: { connected?: boolean; text?: string } } };
  if (!response.result?.value?.connected)
    throw new Error("editor_binding_lost");
  return response.result.value.text ?? "";
}

async function readStableEditor(
  port: FlowPromptEntryPort,
  tabId: number,
  originalObjectId: string,
  operationDeadline: number,
  now: () => number,
): Promise<{ text: string; replaced: boolean; stable: boolean }> {
  const readDeadline = Math.min(
    operationDeadline,
    now() + READBACK_DEADLINE_MS,
  );
  let objectId = originalObjectId;
  let previous: string | undefined;
  let stableReads = 0;
  let replaced = false;
  while (now() < readDeadline) {
    try {
      const sample = await readEditorObject(
        port,
        tabId,
        objectId,
        readDeadline,
        now,
      );
      if (sample === previous) stableReads += 1;
      else stableReads = 1;
      previous = sample;
      if (stableReads >= REQUIRED_STABLE_READS) {
        return { text: sample, replaced, stable: true };
      }
    } catch {
      if (replaced) throw new Error("editor_binding_lost");
      const rebound = (await command(
        port,
        tabId,
        "Runtime.evaluate",
        {
          expression: runtimeExpression("", true),
          returnByValue: false,
          awaitPromise: false,
          userGesture: false,
        },
        readDeadline,
        now,
      )) as { result?: { objectId?: string; subtype?: string } };
      if (!rebound.result?.objectId || rebound.result.subtype !== "node") {
        throw new Error("editor_replacement_not_found");
      }
      objectId = rebound.result.objectId;
      replaced = true;
      previous = undefined;
      stableReads = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, READBACK_INTERVAL_MS));
  }
  const finalText = await readEditorObject(
    port,
    tabId,
    objectId,
    operationDeadline,
    now,
  );
  return { text: finalText, replaced, stable: false };
}

async function command(
  port: FlowPromptEntryPort,
  tabId: number,
  method: string,
  params: object | undefined,
  deadline: number,
  now: () => number,
): Promise<unknown> {
  return withDeadline(port.sendCommand(tabId, method, params), deadline, now);
}

function withDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  now: () => number,
): Promise<T> {
  const remaining = deadline - now();
  if (remaining <= 0) return Promise.reject(new Error("flow_entry_timeout"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("flow_entry_timeout")),
        remaining,
      );
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function compareText(
  expected: string,
  actual: string,
): Promise<{
  equal: boolean;
  firstDifferenceOffset?: number;
  mismatchCategory?: "length" | "code-unit" | "representation";
}> {
  if (expected === actual) return { equal: true };
  const limit = Math.min(expected.length, actual.length);
  let firstDifferenceOffset = 0;
  while (
    firstDifferenceOffset < limit &&
    expected[firstDifferenceOffset] === actual[firstDifferenceOffset]
  ) {
    firstDifferenceOffset += 1;
  }
  const mismatchCategory =
    expected.length === actual.length
      ? "code-unit"
      : firstDifferenceOffset === limit
        ? "length"
        : "representation";
  return { equal: false, firstDifferenceOffset, mismatchCategory };
}

function safeErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    /debugger|permission|attach/i.test(error.message)
  ) {
    return "Chrome debugger attachment failed. Check the required extension permission; no text was sent.";
  }
  if (error instanceof Error && error.message === "flow_entry_timeout") {
    return "Flow prompt preflight timed out before input. No text was sent.";
  }
  return "Flow prompt entry could not be completed. No text was sent.";
}
