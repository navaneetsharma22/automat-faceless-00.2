export const FLOW_WORKSPACE_SCOPE_ANALYZER_KEY =
  "__AUTOMAT_FLOW_WORKSPACE_SCOPE_ANALYZER_V1__";

export type FlowWorkspaceScopeAnalysis = {
  status:
    | "ready"
    | "not_flow_route"
    | "project_missing"
    | "project_ambiguous"
    | "composer_missing"
    | "composer_ambiguous"
    | "composer_unsupported"
    | "composer_outside_project"
    | "document_scan_truncated"
    | "project_scan_truncated"
    | "tile_scan_truncated"
    | "incomplete_capture"
    | "unsupported_baseline_profile"
    | "baseline_ambiguous"
    | "workspace_busy";
  profile:
    "empty_marker" | "populated_tiles" | "labelled_region" | "unsupported";
  project: HTMLElement | null;
  composer: HTMLElement | null;
  editor: HTMLElement | null;
  roots: Array<Document | ShadowRoot | Element>;
  projectElements: Element[];
  tiles: HTMLElement[];
  tileElements: Map<HTMLElement, Element[]>;
  candidateIds: string[];
  qualifyingCandidateIds: string[];
  candidateMultiplicity: Array<{ candidateId: string; renderedCopies: number }>;
  candidateTileRelationships: Array<{
    tileIndex: number;
    candidateId: string;
  }>;
  labelledRegionMediaCount: number;
  repeatedCandidateCount: number;
  unidentifiedImageCount: number;
  unrelatedImageCount: number;
  loadingSignalCount: number;
  virtualScrollContainerCount: number;
  virtualizationEvidence: Array<
    | "scroll_extent_exceeds_viewport"
    | "nonzero_scroll_offset"
    | "viewport_dimensions_unavailable"
  >;
  /** True only when the visible DOM demonstrates incomplete/recycled coverage. */
  virtualized: boolean;
  documentElementCount: number;
  projectElementCount: number;
  documentTruncated: boolean;
  projectTruncated: boolean;
  tileTruncated: boolean;
  captureGaps: string[];
};

/**
 * Shared strict Flow project/composer/tile scope analysis used by the P04
 * preflight resolver and the isolated production observer. When invoked with
 * install=true from chrome.scripting, it stores this same closure-free
 * function in that isolated document for the observer to reuse.
 */
export async function flowWorkspaceScopeAnalyzer(
  canonicalTarget?: string,
  expectedProjectId?: string,
  install = false,
  requireComposer = true,
): Promise<FlowWorkspaceScopeAnalysis | Record<string, unknown>> {
  const analyzerKey = "__AUTOMAT_FLOW_WORKSPACE_SCOPE_ANALYZER_V1__";
  if (install) {
    const isolatedGlobal = globalThis as typeof globalThis & {
      [analyzerKey]?: typeof flowWorkspaceScopeAnalyzer;
    };
    isolatedGlobal[analyzerKey] = flowWorkspaceScopeAnalyzer;
  }
  const maxDocumentElements = 20_000;
  const maxTileElements = 4_000;
  const tag = (element: Element) => element.localName.toLowerCase();
  const parentAcrossShadow = (element: Element): Element | null => {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const composedPath = (element: Element, limit = 80) => {
    const nodes: Element[] = [];
    const seen = new Set<Element>();
    let current: Element | null = element;
    while (current && !seen.has(current) && nodes.length < limit) {
      seen.add(current);
      nodes.push(current);
      current = parentAcrossShadow(current);
    }
    return { nodes, truncated: current !== null };
  };
  const scanRoots = (root: Document | ShadowRoot | Element, limit: number) => {
    const roots: Array<Document | ShadowRoot | Element> = [root];
    const elements: Element[] = [];
    let truncated = false;
    for (let index = 0; index < roots.length; index++) {
      const currentRoot = roots[index]!;
      for (const element of currentRoot.querySelectorAll("*")) {
        if (elements.length >= limit) {
          truncated = true;
          return { roots, elements, truncated };
        }
        elements.push(element);
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    return { roots, elements, truncated };
  };
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      element.isConnected &&
      !composedPath(element).nodes.some((node) =>
        node.matches("[hidden], [inert], [aria-hidden='true']"),
      ) &&
      style.display !== "none" &&
      !["hidden", "collapse"].includes(style.visibility) &&
      element.getClientRects().length > 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  const empty = (
    status: FlowWorkspaceScopeAnalysis["status"],
    documentElementCount = 0,
    documentTruncated = false,
  ): FlowWorkspaceScopeAnalysis => ({
    status,
    profile: "unsupported",
    project: null,
    composer: null,
    editor: null,
    roots: [document],
    projectElements: [],
    tiles: [],
    tileElements: new Map(),
    candidateIds: [],
    qualifyingCandidateIds: [],
    candidateMultiplicity: [],
    candidateTileRelationships: [],
    labelledRegionMediaCount: 0,
    repeatedCandidateCount: 0,
    unidentifiedImageCount: 0,
    unrelatedImageCount: 0,
    loadingSignalCount: 0,
    virtualScrollContainerCount: 0,
    virtualizationEvidence: [],
    virtualized: false,
    documentElementCount,
    projectElementCount: 0,
    documentTruncated,
    projectTruncated: false,
    tileTruncated: false,
    captureGaps: documentTruncated ? ["document_scan_truncated"] : [],
  });

  const currentUrl = new URL(location.href);
  if (
    currentUrl.protocol !== "https:" ||
    currentUrl.username ||
    currentUrl.password ||
    !["flow.google.com", "labs.google"].includes(currentUrl.hostname)
  )
    return empty("not_flow_route");
  const routeProjectId =
    currentUrl.hostname === "flow.google.com"
      ? /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/?$/.exec(
          currentUrl.pathname,
        )?.[1]
      : /^\/fx\/tools\/flow\/([A-Za-z0-9_-]+)\/?$/.exec(
          currentUrl.pathname,
        )?.[1];
  if (
    !routeProjectId ||
    (expectedProjectId && routeProjectId !== expectedProjectId)
  )
    return empty("not_flow_route");
  if (canonicalTarget) {
    const expected = new URL(canonicalTarget);
    if (
      expected.protocol !== "https:" ||
      expected.origin !== currentUrl.origin ||
      expected.pathname !== currentUrl.pathname
    )
      return empty("not_flow_route");
  }

  const documentScan = scanRoots(document, maxDocumentElements);
  const projects = documentScan.elements.filter(
    (element) => tag(element) === "flow-project-page",
  ) as HTMLElement[];
  const baseComposers = documentScan.elements.filter(
    (element) => tag(element) === "flow-base-prompt-box",
  ) as HTMLElement[];
  const verified = baseComposers.flatMap((composer) => {
    const scan = scanRoots(composer, maxTileElements);
    const richEditors = scan.elements.filter(
      (element) => tag(element) === "flow-rich-text-editor",
    );
    const editors = richEditors.flatMap((rich) =>
      scanRoots(rich, maxTileElements).elements.filter(
        (element) =>
          tag(element) === "div" &&
          element.getAttribute("contenteditable") === "true" &&
          element.getAttribute("role") === "textbox",
      ),
    );
    const editor = editors[0] as HTMLElement | undefined;
    return !scan.truncated &&
      richEditors.length === 1 &&
      editors.length === 1 &&
      visible(composer) &&
      Boolean(editor && visible(editor)) &&
      !editor?.matches("[aria-readonly='true'], [aria-disabled='true']")
      ? [{ composer, editor: editor! }]
      : [];
  });
  if (documentScan.truncated)
    return empty("document_scan_truncated", documentScan.elements.length, true);
  if (projects.length === 0)
    return empty("project_missing", documentScan.elements.length);
  if (projects.length !== 1)
    return empty("project_ambiguous", documentScan.elements.length);
  const project = projects[0]!;
  let composer: HTMLElement | null = null;
  let editor: HTMLElement | null = null;
  if (requireComposer) {
    if (baseComposers.length === 0)
      return empty("composer_missing", documentScan.elements.length);
    if (baseComposers.length > 1 || verified.length > 1)
      return empty("composer_ambiguous", documentScan.elements.length);
    if (verified.length !== 1)
      return empty("composer_unsupported", documentScan.elements.length);
    composer = verified[0]!.composer;
    editor = verified[0]!.editor;
    if (!composedPath(composer).nodes.includes(project))
      return empty("composer_outside_project", documentScan.elements.length);
  }
  const projectScan = scanRoots(project, maxDocumentElements);
  if (projectScan.truncated)
    return {
      ...empty("project_scan_truncated", documentScan.elements.length),
      project,
      composer,
      editor,
      projectTruncated: true,
      projectElementCount: projectScan.elements.length,
      captureGaps: ["project_scan_truncated"],
    };
  const tiles = projectScan.elements.filter(
    (element) =>
      tag(element) === "flow-image-tile" &&
      composedPath(element).nodes.includes(project),
  ) as HTMLElement[];
  const tileElements = new Map<HTMLElement, Element[]>();
  const gaps = new Set<string>();
  const multiplicity = new Map<string, number>();
  const qualifyingCandidates = new Set<string>();
  const candidateTileRelationships: Array<{
    tileIndex: number;
    candidateId: string;
  }> = [];
  const imagesWithinTiles = new Set<Element>();
  let tileTruncated = false;
  let unidentifiedImageCount = 0;
  for (const tile of tiles.slice(0, 100)) {
    const tileIndex = tiles.indexOf(tile);
    const tileScan = scanRoots(tile, maxTileElements);
    if (tileScan.truncated) {
      tileTruncated = true;
      gaps.add("tile_scan_truncated");
    }
    tileElements.set(tile, tileScan.elements);
    for (const image of tileScan.elements) {
      if (tag(image) !== "img") continue;
      if (
        composedPath(image).nodes.find(
          (ancestor) => tag(ancestor) === "flow-image-tile",
        ) !== tile
      )
        continue;
      imagesWithinTiles.add(image);
      const value = image.getAttribute("data-media-id")?.trim() ?? "";
      if (!value || value.length > 256) {
        unidentifiedImageCount++;
        gaps.add("media_identity_missing");
        continue;
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value),
      );
      const candidateId = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (!multiplicity.has(candidateId) && multiplicity.size >= 500) {
        gaps.add("media_candidates_truncated");
        continue;
      }
      multiplicity.set(candidateId, (multiplicity.get(candidateId) ?? 0) + 1);
      candidateTileRelationships.push({ tileIndex, candidateId });
      const media = image as HTMLImageElement;
      if (
        visible(tile) &&
        visible(image) &&
        media.complete &&
        media.naturalWidth > 0 &&
        media.naturalHeight > 0
      )
        qualifyingCandidates.add(candidateId);
    }
  }
  if (tiles.length > 100) gaps.add("tile_list_truncated");
  const candidateMultiplicity = [...multiplicity].map(
    ([candidateId, renderedCopies]) => ({ candidateId, renderedCopies }),
  );
  const unrelatedImageCount = projectScan.elements.filter(
    (element) =>
      ["img", "video", "canvas"].includes(tag(element)) &&
      !imagesWithinTiles.has(element) &&
      (!composer || !composedPath(element).nodes.includes(composer)),
  ).length;
  const virtualScrollViewports = projectScan.elements.filter(
    (element) =>
      tag(element) === "cdk-virtual-scroll-viewport" && visible(element),
  );
  const virtualizationEvidence = new Set<
    | "scroll_extent_exceeds_viewport"
    | "nonzero_scroll_offset"
    | "viewport_dimensions_unavailable"
  >();
  for (const viewport of virtualScrollViewports) {
    const metrics = viewport as HTMLElement;
    if (metrics.clientWidth <= 0 || metrics.clientHeight <= 0)
      virtualizationEvidence.add("viewport_dimensions_unavailable");
    if (
      metrics.scrollHeight > metrics.clientHeight + 1 ||
      metrics.scrollWidth > metrics.clientWidth + 1
    )
      virtualizationEvidence.add("scroll_extent_exceeds_viewport");
    if (metrics.scrollTop > 0 || metrics.scrollLeft > 0)
      virtualizationEvidence.add("nonzero_scroll_offset");
  }
  // Extent overflow describes possible virtual scrolling; it does not prove
  // that the viewport moved or recycled a rendered tile.
  const virtualized = virtualizationEvidence.has("nonzero_scroll_offset");
  const loadingSelector =
    '[role="progressbar"], [aria-busy="true"], [data-loading="true"], [data-state="loading"], [data-state="generating"], [class*="spinner" i], [class*="loading" i]';
  const loadingSignalCount = projectScan.elements.filter(
    (element) => element.matches(loadingSelector) && visible(element),
  ).length;
  const markerPhrase = "Start creating or drop media";
  const emptyMarkerCount = projectScan.elements.filter(
    (element) =>
      element.textContent?.trim() === markerPhrase && visible(element),
  ).length;
  const hasEmptyMarker = emptyMarkerCount > 0;
  const labelledRegions = projectScan.elements.filter((element) => {
    const label = element.getAttribute("aria-label")?.trim() ?? "";
    return (
      /^(generated results|image results|results gallery)$/i.test(label) &&
      visible(element)
    );
  });
  const labelledRegion = labelledRegions.length > 0;
  const labelledRegionMediaCount =
    labelledRegions.length === 1
      ? Array.from(labelledRegions[0]!.querySelectorAll("img, video")).filter(
          visible,
        ).length
      : 0;
  const profile: FlowWorkspaceScopeAnalysis["profile"] = tiles.length
    ? "populated_tiles"
    : hasEmptyMarker
      ? "empty_marker"
      : labelledRegion
        ? "labelled_region"
        : "unsupported";
  const status: FlowWorkspaceScopeAnalysis["status"] =
    tileTruncated || tiles.length > 100
      ? "tile_scan_truncated"
      : tiles.length === 0 &&
          (labelledRegions.length > 1 ||
            (hasEmptyMarker && labelledRegions.length > 0) ||
            emptyMarkerCount > 1)
        ? "baseline_ambiguous"
        : profile === "unsupported"
          ? "unsupported_baseline_profile"
          : gaps.size > 0
            ? "incomplete_capture"
            : loadingSignalCount > 0
              ? "workspace_busy"
              : "ready";
  const analysis: FlowWorkspaceScopeAnalysis = {
    status,
    profile,
    project,
    composer,
    editor,
    roots: projectScan.roots,
    projectElements: projectScan.elements,
    tiles: tiles.slice(0, 100),
    tileElements,
    candidateIds: candidateMultiplicity.map((entry) => entry.candidateId),
    qualifyingCandidateIds: [...qualifyingCandidates],
    candidateMultiplicity,
    candidateTileRelationships,
    labelledRegionMediaCount,
    repeatedCandidateCount: [...multiplicity.values()].reduce(
      (total, count) => total + Math.max(0, count - 1),
      0,
    ),
    unidentifiedImageCount,
    unrelatedImageCount,
    loadingSignalCount,
    virtualScrollContainerCount: virtualScrollViewports.length,
    virtualizationEvidence: [...virtualizationEvidence],
    virtualized,
    documentElementCount: documentScan.elements.length,
    projectElementCount: projectScan.elements.length,
    documentTruncated: false,
    projectTruncated: false,
    tileTruncated,
    captureGaps: [...gaps].slice(0, 16),
  };
  if (!install) return analysis;
  return {
    status: analysis.status,
    profile: analysis.profile,
    projectBoundaryCount: 1,
    verifiedComposerCount: 1,
    renderedTileCount: analysis.tiles.length,
    distinctCandidateCount: analysis.candidateIds.length,
    qualifyingCandidateCount: analysis.qualifyingCandidateIds.length,
    labelledRegionMediaCount: analysis.labelledRegionMediaCount,
    repeatedCandidateCount: analysis.repeatedCandidateCount,
    unidentifiedImageCount: analysis.unidentifiedImageCount,
    unrelatedImageCount: analysis.unrelatedImageCount,
    virtualized: analysis.virtualized,
    virtualScrollContainerCount: analysis.virtualScrollContainerCount,
    virtualizationEvidence: analysis.virtualizationEvidence,
    loadingSignalCount: analysis.loadingSignalCount,
    captureGaps: analysis.captureGaps,
    completeForRenderedScope: analysis.captureGaps.length === 0,
  };
}
