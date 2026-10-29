import type { FlowImageObservationArmBinding } from "../../domain/jobs/results";

export function createFlowObservationInjection(
  binding: FlowImageObservationArmBinding,
  command: "arm" | "activate" | "resume" | "stop",
) {
  return {
    target: {
      tabId: binding.tabId,
      documentIds: [binding.documentId],
    },
    world: "ISOLATED" as const,
    func: flowImageObservationProducer,
    args: [binding, command] as [FlowImageObservationArmBinding, typeof command],
  };
}

/** Self-contained function injected into the exact isolated browser document. */
export async function flowImageObservationProducer(
  binding: FlowImageObservationArmBinding,
  command: "arm" | "activate" | "resume" | "stop",
): Promise<unknown> {
  const stateKey = "__AUTOMAT_FLOW_IMAGE_OBSERVER_V1__";
  const globalScope = globalThis as typeof globalThis & {
    chrome?: {
      runtime?: {
        sendMessage?: (message: unknown) => Promise<unknown>;
      };
    };
    [stateKey]?: Record<string, unknown>;
  };
  const runtime = globalScope.chrome?.runtime;
  if (command === "stop") {
    const state = globalScope[stateKey] as ObserverState | undefined;
    if (!state || !sameBinding(state.binding, binding))
      return { status: "missing_or_mismatched" };
    stopState(state);
    delete globalScope[stateKey];
    return { status: "stopped" };
  }
  if (command === "arm") {
    if (!runtime?.sendMessage) return { status: "runtime_unavailable" };
    const existing = globalScope[stateKey] as ObserverState | undefined;
    if (existing) return { status: "observer_already_present" };
    if (!validBinding(binding) || window.top !== window)
      return { status: "invalid_binding_or_frame" };
    const initial = scanContext(binding);
    if (!initial.ok) return { status: "scope_refused", reason: initial.reason };
    const state: ObserverState = {
      binding,
      runtime,
      document,
      project: initial.project,
      roots: new Map(),
      nodeTokens: new WeakMap(),
      nextTile: 1,
      nextMedia: 1,
      nextMarker: 1,
      nextIdentity: 1,
      sequence: 0,
      active: false,
      stopped: false,
      armingChanged: false,
      dirty: false,
      scheduled: false,
      sending: Promise.resolve(),
      timer: 0,
      durationTimer: 0,
      lastSnapshot: null,
      lastFingerprint: "",
      captureGaps: new Set(),
      resourceEvents: [],
      onPageHide: () => undefined,
      documentObserver: null,
    };
    globalScope[stateKey] = state as unknown as Record<string, unknown>;
    try {
      attachRoots(state, initial.roots);
      state.documentObserver = new MutationObserver(() => {
        if (!state.active) state.armingChanged = true;
        schedule(state);
      });
      state.documentObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      state.onPageHide = () => void lose(state, "observer_detached");
      window.addEventListener("pagehide", state.onPageHide, true);
      const before = await captureSnapshot(state, initial);
      const pending = takeMutationRecords(state);
      const afterContext = scanContext(binding);
      if (!afterContext.ok) throw new Error("binding_changed");
      attachRoots(state, afterContext.roots);
      const after = await captureSnapshot(state, afterContext);
      if (
        pending > 0 ||
        state.armingChanged ||
        fingerprint(before) !== fingerprint(after)
      ) {
        throw new Error("baseline_changed_during_arm");
      }
      state.lastSnapshot = after;
      state.lastFingerprint = fingerprint(after);
      state.timer = window.setInterval(() => schedule(state), 500);
      state.durationTimer = window.setTimeout(
        () => void lose(state, "duration_limit_reached"),
        Math.max(0, binding.deadlineAt - Date.now()),
      );
      return {
        status: "armed",
        capturedAt: Date.now(),
        attemptId: binding.attemptId,
        sessionId: binding.sessionId,
        projectId: binding.projectId,
        tabId: binding.tabId,
        frameId: binding.frameId,
        documentId: binding.documentId,
        sourceHash: binding.sourceHash,
        sourceSnapshotId: binding.sourceSnapshotId,
        sourceBaselineFingerprint: binding.sourceBaselineFingerprint,
        buildId: binding.buildId,
        protocolVersion: binding.protocolVersion,
        captureFingerprint: await hashText(state.lastFingerprint),
        listenerRoots: state.roots.size,
        baseline: after,
      };
    } catch (error) {
      stopState(state);
      delete globalScope[stateKey];
      return {
        status: "arm_refused",
        reason:
          error instanceof Error && error.message === "baseline_changed_during_arm"
            ? "baseline_changed_during_arm"
            : "binding_or_capture_failed",
      };
    }
  }

  const state = globalScope[stateKey] as ObserverState | undefined;
  if (!state || !sameBinding(state.binding, binding))
    return { status: "missing_or_mismatched" };
  const context = scanContext(binding);
  if (!context.ok) {
    await lose(state, context.reason === "project_changed" ? "project_binding_changed" : "document_binding_changed");
    return { status: "binding_changed" };
  }
  if (command === "resume") {
    if (state.stopped || !state.active) return { status: "observer_lost" };
    attachRoots(state, context.roots);
    await drain(state);
    schedule(state);
    return { status: state.stopped ? "observer_lost" : "resumed" };
  }
  if (command !== "activate" || state.stopped || state.active)
    return { status: "invalid_state" };
  attachRoots(state, context.roots);
  const current = await captureSnapshot(state, context);
  if (
    takeMutationRecords(state) > 0 ||
    state.armingChanged ||
    fingerprint(current) !== state.lastFingerprint
  ) {
    stopState(state);
    delete globalScope[stateKey];
    return { status: "baseline_changed_before_activation" };
  }
  state.active = true;
  const accepted = await sendSnapshot(state, "structural_snapshot", current);
  if (!accepted) {
    await lose(state, "capture_failed");
    return { status: "delivery_failed" };
  }
  state.lastSnapshot = current;
  state.lastFingerprint = fingerprint(current);
  return { status: "active", sequence: state.sequence };
type ProducerRuntime = {
  sendMessage: (message: unknown) => Promise<unknown>;
};
type StructuralSnapshot = {
  completeForRenderedScope: boolean;
  virtualized: boolean;
  unidentifiedImageCount: number;
  tiles: Array<{ tileToken: string; tag: "flow-image-tile"; visible: boolean }>;
  mediaCandidates: Array<{
    candidateId: string;
    mediaToken: string;
    tileToken: string;
    visible: boolean;
    complete: boolean;
    naturalWidth: number;
    naturalHeight: number;
  }>;
  identityCandidates: Array<{
    carrierToken: string;
    carrierTag: string;
    carrierRelation: "tile" | "descendant" | "ancestor";
    attributeName: string;
    category: string;
    candidateId: string;
  }>;
  identityCandidatesTruncated: boolean;
  lifecycleSignals: Array<{
    markerToken: string;
    markerTag: string;
    markerKind: string;
    scope: "project" | "tile";
    tileToken: string | null;
    visible: boolean;
    evidence: Array<{ attributeName: string; signal: string }>;
  }>;
  captureGaps: string[];
  resourceEvents: Array<{
    mediaToken: string;
    tileToken: string | null;
    type: "load" | "error";
    complete: boolean;
    naturalWidth: number;
    naturalHeight: number;
  }>;
};
type ObserverState = {
  binding: FlowImageObservationArmBinding;
  runtime: ProducerRuntime;
  document: Document;
  project: Element;
  roots: Map<Document | ShadowRoot | Element, { observer: MutationObserver; listener: EventListener }>;
  nodeTokens: WeakMap<
    Element,
    Partial<Record<"tile" | "media" | "marker" | "identity", string>>
  >;
  nextTile: number;
  nextMedia: number;
  nextMarker: number;
  nextIdentity: number;
  sequence: number;
  active: boolean;
  stopped: boolean;
  armingChanged: boolean;
  dirty: boolean;
  scheduled: boolean;
  sending: Promise<void>;
  timer: number;
  durationTimer: number;
  lastSnapshot: StructuralSnapshot | null;
  lastFingerprint: string;
  captureGaps: Set<string>;
  resourceEvents: StructuralSnapshot["resourceEvents"];
  onPageHide: () => void;
  documentObserver: MutationObserver | null;
};

function validBinding(binding: FlowImageObservationArmBinding): boolean {
  return (
    binding.provider === "Flow" &&
    Number.isInteger(binding.tabId) &&
    binding.senderFrameId === 0 &&
    binding.frameId.length > 0 &&
    binding.loaderId.length > 0 &&
    binding.documentId.length > 0 &&
    binding.deadlineAt > Date.now() &&
    binding.maxEvents > 0 &&
    /^[0-9a-f]{64}$/.test(binding.sourceHash) &&
    /^[0-9a-f]{64}$/.test(binding.sourceBaselineFingerprint)
  );
}

function sameBinding(
  left: FlowImageObservationArmBinding,
  right: FlowImageObservationArmBinding,
): boolean {
  return Object.keys(left).every(
    (key) =>
      left[key as keyof FlowImageObservationArmBinding] ===
      right[key as keyof FlowImageObservationArmBinding],
  );
}

function composedPath(element: Element): Element[] {
  const path: Element[] = [];
  let current: Element | null = element;
  while (current && path.length < 80) {
    path.push(current);
    if (current.parentElement) current = current.parentElement;
    else {
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? root.host : null;
    }
  }
  return path;
}

function scanRoots(root: Document | ShadowRoot | Element) {
  const roots: Array<Document | ShadowRoot | Element> = [root];
  const elements: Element[] = [];
  let truncated = false;
  for (let index = 0; index < roots.length; index++) {
    const currentRoot = roots[index]!;
    for (const element of currentRoot.querySelectorAll("*")) {
      if (elements.length >= 20_000) {
        truncated = true;
        return { roots, elements, truncated };
      }
      elements.push(element);
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  return { roots, elements, truncated };
}

function routeMatches(binding: FlowImageObservationArmBinding): boolean {
  try {
    const current = new URL(location.href);
    const expected = new URL(binding.canonicalTarget);
    const match =
      current.protocol === "https:" &&
      current.origin === expected.origin &&
      current.pathname === expected.pathname &&
      !current.username &&
      !current.password;
    const project =
      current.hostname === "flow.google.com"
        ? /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/?$/.exec(
            current.pathname,
          )?.[1]
        : current.hostname === "labs.google"
          ? /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(
              current.pathname,
            )?.[1]
          : undefined;
    return match && project === binding.projectId;
  } catch {
    return false;
  }
}

function visible(element: Element): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    element.isConnected &&
    !composedPath(element).some((node) =>
      node.matches("[hidden], [inert], [aria-hidden='true']"),
    ) &&
    style.display !== "none" &&
    !["hidden", "collapse"].includes(style.visibility) &&
    element.getClientRects().length > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function scanContext(binding: FlowImageObservationArmBinding) {
  if (!routeMatches(binding)) return { ok: false as const, reason: "project_changed" };
  const documentScan = scanRoots(document);
  const projects = documentScan.elements.filter(
    (element) => element.localName === "flow-project-page",
  );
  const composers = documentScan.elements.filter((boundary) => {
    if (boundary.localName !== "flow-base-prompt-box") return false;
    const scan = scanRoots(boundary);
    const editors = scan.elements.filter(
      (element) =>
        element.localName === "div" &&
        element.getAttribute("contenteditable") === "true" &&
        element.getAttribute("role") === "textbox",
    );
    return (
      !scan.truncated &&
      scan.elements.filter((element) => element.localName === "flow-rich-text-editor").length === 1 &&
      editors.length === 1 &&
      visible(boundary) &&
      visible(editors[0]!) &&
      !editors[0]!.matches("[aria-readonly='true'], [aria-disabled='true']")
    );
  });
  if (documentScan.truncated) return { ok: false as const, reason: "document_scan_truncated" };
  if (projects.length !== 1 || composers.length !== 1)
    return { ok: false as const, reason: "scope_ambiguous" };
  const project = projects[0]!;
  if (!composedPath(composers[0]!).includes(project))
    return { ok: false as const, reason: "scope_ambiguous" };
  const projectScan = scanRoots(project);
  if (projectScan.truncated)
    return { ok: false as const, reason: "project_scan_truncated" };
  const tiles = projectScan.elements.filter(
    (element) =>
      element.localName === "flow-image-tile" &&
      composedPath(element).includes(project),
  );
  if (tiles.length > 100) return { ok: false as const, reason: "tile_limit" };
  return {
    ok: true as const,
    project,
    projectScan,
    tiles,
    roots: projectScan.roots,
  };
}

async function captureSnapshot(
  state: ObserverState,
  context: ReturnType<typeof scanContext> & { ok: true },
): Promise<StructuralSnapshot> {
  const gaps = new Set<string>();
  const tiles = context.tiles.map((tile) => ({
    tileToken: token(state, tile, "tile"),
    tag: "flow-image-tile" as const,
    visible: visible(tile),
  }));
  const tileElements = new Map(
    context.tiles.map((tile) => [tile, token(state, tile, "tile")]),
  );
  const mediaCandidates: StructuralSnapshot["mediaCandidates"] = [];
  const identityCandidates: StructuralSnapshot["identityCandidates"] = [];
  let identityCandidatesTruncated = false;
  const identityCarriers = new Set<Element>();
  for (const tile of context.tiles) {
    identityCarriers.add(tile);
    for (const element of scanRoots(tile).elements) identityCarriers.add(element);
    for (const ancestor of composedPath(tile)) {
      if (ancestor === context.project) break;
      if (ancestor !== tile) identityCarriers.add(ancestor);
    }
  }
  for (const carrier of identityCarriers) {
    const relation = context.tiles.includes(carrier)
      ? "tile"
      : context.tiles.some((tile) => composedPath(tile).includes(carrier))
        ? "ancestor"
        : "descendant";
    for (const attribute of Array.from(carrier.attributes)) {
      const name = attribute.name.toLowerCase();
      if (!isIdentityAttribute(name) || /account|profile|user|tier|billing|avatar/i.test(name)) continue;
      const value = attribute.value.trim();
      if (!value || value.length > 256 || /https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value)) {
        gaps.add("identity_candidate_excluded");
        continue;
      }
      if (identityCandidates.length >= 500) {
        identityCandidatesTruncated = true;
        gaps.add("identity_candidates_truncated");
        break;
      }
      identityCandidates.push({
        carrierToken: token(state, carrier, "identity"),
        carrierTag: carrier.localName,
        carrierRelation: relation,
        attributeName: name,
        category: identityCategory(name),
        candidateId: await hashText(value),
      });
    }
    if (identityCandidatesTruncated) break;
  }
  let unidentifiedImageCount = 0;
  for (const tile of context.tiles) {
    const tileScan = scanRoots(tile);
    if (tileScan.truncated) gaps.add("tile_scan_truncated");
    for (const image of tileScan.elements) {
      if (image.localName !== "img") continue;
      if (
        composedPath(image).find((node) => node.localName === "flow-image-tile") !== tile
      )
        continue;
      const mediaId = image.getAttribute("data-media-id")?.trim();
      if (!mediaId || mediaId.length > 256) {
        unidentifiedImageCount++;
        continue;
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(mediaId),
      );
      const candidateId = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      mediaCandidates.push({
        candidateId,
        mediaToken: token(state, image, "media"),
        tileToken: tileElements.get(tile)!,
        visible: visible(image),
        complete: (image as HTMLImageElement).complete,
        naturalWidth: (image as HTMLImageElement).naturalWidth,
        naturalHeight: (image as HTMLImageElement).naturalHeight,
      });
      if (mediaCandidates.length > 500) throw new Error("media_limit");
    }
  }
  const lifecycleSignals: StructuralSnapshot["lifecycleSignals"] = [];
  const relevantElements = [context.project, ...context.projectScan.elements];
  for (const element of relevantElements) {
    const evidence = markerEvidence(element);
    if (!evidence.length) continue;
    const kinds = markerKinds(evidence);
    const nearestTile = composedPath(element).find(
      (node) => node.localName === "flow-image-tile" && tileElements.has(node),
    );
    for (const kind of kinds) {
      lifecycleSignals.push({
        markerToken: token(state, element, "marker"),
        markerTag: element.localName,
        markerKind: kind,
        scope: nearestTile ? "tile" : "project",
        tileToken: nearestTile ? tileElements.get(nearestTile)! : null,
        visible: visible(element),
        evidence,
      });
      if (lifecycleSignals.length > 500) throw new Error("marker_limit");
    }
  }
  if (context.projectScan.truncated) gaps.add("project_scan_truncated");
  if (unidentifiedImageCount > 0) gaps.add("media_identity_missing");
  return {
    completeForRenderedScope: gaps.size === 0,
    virtualized: relevantElements.some(
      (element) => element.localName === "cdk-virtual-scroll-viewport",
    ),
    unidentifiedImageCount,
    tiles,
    mediaCandidates,
    identityCandidates,
    identityCandidatesTruncated,
    resourceEvents: state.resourceEvents.splice(0, 100),
    lifecycleSignals,
    captureGaps: [...gaps].slice(0, 16),
  };
}

function markerEvidence(
  element: Element,
): Array<{ attributeName: string; signal: string }> {
  const evidence = new Map<string, { attributeName: string; signal: string }>();
  const add = (attributeName: string, signal: string) => {
    evidence.set(`${attributeName}:${signal}`, { attributeName, signal });
  };
  const role = element.getAttribute("role");
  if (role === "progressbar" || role === "status" || role === "alert")
    add("role", role);
  if (element.getAttribute("aria-busy") === "true") add("aria-busy", "busy");
  if (element.getAttribute("data-loading") === "true") add("data-loading", "loading");
  if (element.hasAttribute("data-error")) add("data-error", "error");
  const words = [
    "loading", "spinner", "pending", "progress", "generating", "processing",
    "complete", "completed", "finished", "success", "ready", "done", "error",
    "failed", "failure", "blocked", "rejected",
  ];
  for (const name of ["data-state", "data-testid", "class"] as const) {
    const value = element.getAttribute(name) ?? "";
    for (const word of words)
      if (value.toLowerCase().includes(word)) add(name, word);
  }
  return [...evidence.values()].slice(0, 12);
}

function markerKinds(
  evidence: Array<{ attributeName: string; signal: string }>,
): string[] {
  const kinds = new Set<string>();
  for (const signal of evidence.map((entry) => entry.signal)) {
    if (["progressbar", "status", "alert", "busy", "loading"].includes(signal))
      kinds.add(signal);
    if (["generating", "processing"].includes(signal)) kinds.add("processing");
    if (["complete", "completed", "finished", "success", "ready", "done"].includes(signal))
      kinds.add("completed_candidate");
    if (["error", "failed", "failure", "blocked", "rejected"].includes(signal))
      kinds.add("error_candidate");
  }
  return [...kinds];
}

function isIdentityAttribute(name: string): boolean {
  return (
    /^(?:id|data-[a-z0-9_-]*(?:id|key|uuid|asset|result|group|variant|generation|creation|media|image|output)[a-z0-9_-]*)$/i.test(
      name,
    ) ||
    name === "data-testid" ||
    name === "aria-labelledby" ||
    name === "aria-describedby" ||
    name === "aria-owns"
  );
}

function identityCategory(name: string): string {
  if (name === "id") return "dom_element_id_not_asset_proof";
  if (["aria-labelledby", "aria-describedby", "aria-owns"].includes(name))
    return "accessibility_reference_not_asset_proof";
  if (name === "data-testid") return "test_or_dom_identifier_not_asset_proof";
  if (/asset|media|image/i.test(name))
    return "provider_asset_identity_candidate_unverified";
  if (/variant/i.test(name))
    return "provider_variant_identity_candidate_unverified";
  if (/group|generation|creation/i.test(name))
    return "provider_group_identity_candidate_unverified";
  if (/result|output/i.test(name))
    return "provider_result_identity_candidate_unverified";
  return "other_data_identity_candidate_unverified";
}

function token(
  state: ObserverState,
  element: Element,
  kind: "tile" | "media" | "marker" | "identity",
): string {
  const values = state.nodeTokens.get(element) ?? {};
  let value = values[kind];
  if (!value) {
    const index = kind === "tile"
      ? state.nextTile++
      : kind === "media"
        ? state.nextMedia++
        : kind === "marker"
          ? state.nextMarker++
          : state.nextIdentity++;
    value = `${kind}-${index}`;
    values[kind] = value;
    state.nodeTokens.set(element, values);
  }
  return value;
}

function fingerprint(snapshot: StructuralSnapshot): string {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).sort(
        ([left], [right]) => left.localeCompare(right),
      );
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return stable(snapshot);
}

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function attachRoots(
  state: ObserverState,
  roots: Array<Document | ShadowRoot | Element>,
): void {
  for (const root of roots) {
    if (state.roots.has(root)) continue;
    const observer = new MutationObserver(() => {
      state.dirty = true;
      if (!state.active) state.armingChanged = true;
      schedule(state);
    });
    observer.observe(root, { attributes: true, childList: true, subtree: true });
    const listener: EventListener = (event) => {
      const image = event.target as HTMLImageElement | null;
      if (image?.localName !== "img") return;
      state.dirty = true;
      if (!state.active) state.armingChanged = true;
      const tile = composedPath(image).find(
        (node) => node.localName === "flow-image-tile",
      );
      if (state.resourceEvents.length >= 100) {
        void lose(state, "event_limit_reached");
        return;
      }
      state.resourceEvents.push({
        mediaToken: token(state, image, "media"),
        tileToken: tile ? token(state, tile, "tile") : null,
        type: event.type === "error" ? "error" : "load",
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      });
      schedule(state);
    };
    root.addEventListener("load", listener, true);
    root.addEventListener("error", listener, true);
    state.roots.set(root, { observer, listener });
  }
}

function takeMutationRecords(state: ObserverState): number {
  let count = state.documentObserver?.takeRecords().length ?? 0;
  for (const entry of state.roots.values()) count += entry.observer.takeRecords().length;
  return count;
}

function schedule(state: ObserverState): void {
  if (state.stopped || state.scheduled) return;
  state.scheduled = true;
  queueMicrotask(() => {
    void (async () => {
      await state.sending;
      state.dirty = false;
      await reconcile(state);
      state.scheduled = false;
      if (state.dirty) schedule(state);
    })();
  });
}

async function reconcile(state: ObserverState): Promise<void> {
  if (state.stopped) return;
  if (Date.now() >= state.binding.deadlineAt) return void (await lose(state, "duration_limit_reached"));
  const context = scanContext(state.binding);
  if (!context.ok) {
    return void (await lose(
      state,
      context.reason === "project_changed" ? "project_binding_changed" : "document_binding_changed",
    ));
  }
  attachRoots(state, context.roots);
  let snapshot: StructuralSnapshot;
  try {
    snapshot = await captureSnapshot(state, context);
  } catch {
    return void (await lose(state, "capture_failed"));
  }
  const next = fingerprint(snapshot);
  if (next === state.lastFingerprint) return;
  if (!state.active) {
    state.armingChanged = true;
    return;
  }
  state.lastSnapshot = snapshot;
  state.lastFingerprint = next;
  if (state.sequence >= state.binding.maxEvents)
    return void (await lose(state, "event_limit_reached"));
  const accepted = await sendSnapshot(state, "structural_snapshot", snapshot);
  if (!accepted) await lose(state, "capture_failed");
}

async function sendSnapshot(
  state: ObserverState,
  kind: "structural_snapshot" | "observer_lost" | "observer_timed_out",
  snapshot: StructuralSnapshot,
): Promise<boolean> {
  const send = async (): Promise<boolean> => {
    if (state.sequence >= state.binding.maxEvents) return false;
    state.sequence++;
    const observation = {
    kind,
    attemptId: state.binding.attemptId,
    sessionId: state.binding.sessionId,
    observationId: crypto.randomUUID(),
    sequence: state.sequence,
    observedAt: Date.now(),
    profile: "flow_tile_candidate_structure_v1",
    binding: {
      workspaceId: state.binding.workspaceId,
      batchId: state.binding.batchId,
      itemId: state.binding.itemId,
      sourceHash: state.binding.sourceHash,
      sourceSnapshotId: state.binding.sourceSnapshotId,
      attemptId: state.binding.attemptId,
      provider: "Flow",
      projectId: state.binding.projectId,
      tabId: state.binding.tabId,
      frameId: state.binding.frameId,
      loaderId: state.binding.loaderId,
    },
    sourceBaselineFingerprint: state.binding.sourceBaselineFingerprint,
    captureFingerprint: await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(fingerprint(snapshot)))
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ),
    snapshot,
    };
    const message = {
    type: "AUTOMAT_FLOW_IMAGE_OBSERVATION",
    protocolVersion: state.binding.protocolVersion,
    buildId: state.binding.buildId,
    observation,
  };
    try {
      const response = (await state.runtime.sendMessage(message)) as {
        ok?: boolean;
        data?: { accepted?: boolean };
      };
      return response?.ok === true && response.data?.accepted === true;
    } catch {
      return false;
    }
  };
  const task = state.sending.then(send);
  state.sending = task.then(() => undefined, () => undefined);
  const accepted = await task;
  if (state.sequence >= state.binding.maxEvents) stopState(state);
  return accepted;
}

async function drain(state: ObserverState): Promise<void> {
  await state.sending;
}

async function lose(state: ObserverState, reason: string): Promise<void> {
  if (state.stopped) return;
  state.captureGaps.add(reason);
  if (state.active && state.lastSnapshot && state.sequence < state.binding.maxEvents) {
    const timedOut = reason === "duration_limit_reached";
    const reasonCode = [
      "duration_limit_reached",
      "event_limit_reached",
      "observer_detached",
      "document_binding_changed",
      "project_binding_changed",
      "capture_failed",
    ].includes(reason)
      ? reason
      : "capture_failed";
    await sendSnapshot(state, timedOut ? "observer_timed_out" : "observer_lost", {
      ...state.lastSnapshot,
      completeForRenderedScope: false,
      captureGaps: [...new Set([...state.lastSnapshot.captureGaps, reasonCode])].slice(0, 16),
    });
  }
  stopState(state);
}

function stopState(state: ObserverState): void {
  if (state.stopped) return;
  state.stopped = true;
  window.clearInterval(state.timer);
  window.clearTimeout(state.durationTimer);
  state.documentObserver?.disconnect();
  window.removeEventListener("pagehide", state.onPageHide, true);
  for (const [root, entry] of state.roots) {
    entry.observer.disconnect();
    root.removeEventListener("load", entry.listener, true);
    root.removeEventListener("error", entry.listener, true);
  }
  state.roots.clear();
}
}
