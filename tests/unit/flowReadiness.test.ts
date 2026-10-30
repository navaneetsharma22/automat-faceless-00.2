import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlowImageReadinessCheck } from "../../src/background/handlers/flow";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";

const originalChrome = (globalThis as { chrome?: unknown }).chrome;
const newEmptyMode = {
  countMode: {
    mode: "new_empty_project" as const,
    countSessionId: "8ca777a9-09a4-4640-82e1-8ece47164153",
    startingImageCount: 0 as const,
  },
};
const existingMode = {
  countMode: {
    mode: "existing_project" as const,
    countSessionId: "3b7a1cd4-eeb5-441d-b9eb-142b3e8a0084",
    startingImageCount: 2,
    userConfirmed: true,
  },
};
afterEach(() => {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: originalChrome,
  });
});

function readinessHarness(finalResult: unknown) {
  const repositories = new ExtensionRepositories(
    createMemoryRepositoryDatabase(),
  );
  vi.spyOn(repositories, "getSelectedTarget").mockResolvedValue({
    provider: "Flow",
    tabId: 9,
    canonicalTarget: "https://flow.google.com/project/project-1",
    verification: "verified",
    connectionState: "verified",
    verificationBinding: {
      provider: "Flow",
      tabId: 9,
      canonicalTarget: "https://flow.google.com/project/project-1",
      projectId: "project-1",
      frameId: 0,
      documentId: "doc-1",
      documentToken: "token-1",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: 1,
      capability: "read-only-connection-v1",
      verifiedAt: 1,
    },
    reconnectEnabled: true,
    updatedAt: 1,
  });
  const executeScript = vi
    .fn()
    .mockResolvedValueOnce([
      {
        documentId: "doc-1",
        frameId: 0,
        result: {
          href: "https://flow.google.com/project/project-1",
          top: true,
        },
      },
    ])
    .mockResolvedValueOnce([
      { documentId: "doc-1", frameId: 0, result: { status: "ready" } },
    ])
    .mockResolvedValueOnce([
      { documentId: "doc-1", frameId: 0, result: finalResult },
    ]);
  const sendCommand = vi.fn();
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { scripting: { executeScript }, debugger: { sendCommand } },
  });
  return { repositories, executeScript, sendCommand };
}

describe("Flow no-Generate readiness", () => {
  it("checks new-empty mode without creating attempts or issuing input", async () => {
    const harness = readinessHarness({
      status: "ready",
      profile: "empty_marker",
      completeForRenderedScope: true,
      listenersAttached: true,
      stableBaseline: true,
      renderedTileCount: 0,
      distinctCandidateCount: 0,
      candidateIds: [],
      repeatedCandidateCount: 0,
      unidentifiedImageCount: 0,
      unrelatedImageCount: 0,
      virtualized: false,
      virtualScrollContainerCount: 1,
      virtualizationEvidence: [],
      loadingSignalCount: 0,
      captureGaps: [],
      terminalSemanticsSupported: false,
    });
    const result = await createFlowImageReadinessCheck(harness.repositories)(
      newEmptyMode,
    );
    expect(result).toMatchObject({
      status: "ready",
      countModeEligibility: { status: "eligible", mode: "new_empty_project" },
      attemptsCreated: 0,
      confirmationConsumed: false,
      productionReceiptCreated: false,
    });
    expect(harness.executeScript).toHaveBeenCalledTimes(3);
    expect(harness.executeScript.mock.calls[0]?.[0].target.frameIds).toEqual([
      0,
    ]);
    expect(
      harness.executeScript.mock.calls
        .slice(1)
        .every(([input]) => input.target.documentIds?.[0] === "doc-1"),
    ).toBe(true);
    expect(harness.sendCommand).not.toHaveBeenCalled();
    expect(await harness.repositories.getAllFlowImageAttempts()).toEqual([]);
  });

  it("reports an unsupported profile without mutating attempt or confirmation state", async () => {
    const harness = readinessHarness({
      status: "blocked",
      reason: "unsupported_baseline_profile",
      captureGaps: [],
    });
    const result = await createFlowImageReadinessCheck(harness.repositories)(
      newEmptyMode,
    );
    expect(result).toMatchObject({
      status: "blocked",
      reason: "unsupported_baseline_profile",
      attemptsCreated: 0,
      confirmationConsumed: false,
    });
    expect(harness.sendCommand).not.toHaveBeenCalled();
    expect(await harness.repositories.getAllFlowImageAttempts()).toEqual([]);
  });

  it("accepts extent overflow when four attested images match four qualifying candidates", async () => {
    const harness = readinessHarness({
      status: "ready",
      profile: "populated_tiles",
      completeForRenderedScope: true,
      listenersAttached: true,
      stableBaseline: true,
      renderedTileCount: 4,
      distinctCandidateCount: 4,
      qualifyingCandidateCount: 4,
      candidateIds: [
        "a".repeat(64),
        "b".repeat(64),
        "c".repeat(64),
        "d".repeat(64),
      ],
      repeatedCandidateCount: 0,
      unidentifiedImageCount: 0,
      unrelatedImageCount: 0,
      virtualized: false,
      virtualScrollContainerCount: 1,
      virtualizationEvidence: ["scroll_extent_exceeds_viewport"],
      loadingSignalCount: 0,
      captureGaps: [],
    });
    const countFourMode = {
      countMode: {
        ...existingMode.countMode,
        startingImageCount: 4,
      },
    };
    const result = await createFlowImageReadinessCheck(harness.repositories)(
      countFourMode,
    );
    expect(result).toMatchObject({
      status: "ready",
      virtualScrollContainerCount: 1,
      qualifyingCandidateCount: 4,
      viewportOverflowObserved: true,
      actualScrollingObserved: false,
      candidateOwnershipAmbiguous: false,
      baselineCoverageAssessment: {
        declaredExistingCountMatchesQualifyingCandidates: true,
        inventoryComplete: false,
        providerIdentityVerified: false,
      },
      virtualized: false,
      countModeEligibility: { status: "eligible", mode: "existing_project" },
      attemptsCreated: 0,
      confirmationConsumed: false,
      productionReceiptCreated: false,
    });
    expect(harness.sendCommand).not.toHaveBeenCalled();
    expect(await harness.repositories.getAllFlowImageAttempts()).toEqual([]);
  });

  it("blocks existing-project count mode when scrolling was actually observed", async () => {
    const harness = readinessHarness({
      status: "ready",
      profile: "populated_tiles",
      completeForRenderedScope: true,
      listenersAttached: true,
      stableBaseline: true,
      renderedTileCount: 2,
      distinctCandidateCount: 2,
      qualifyingCandidateCount: 2,
      candidateIds: ["a".repeat(64), "b".repeat(64)],
      repeatedCandidateCount: 0,
      unidentifiedImageCount: 0,
      unrelatedImageCount: 0,
      virtualized: true,
      virtualScrollContainerCount: 1,
      virtualizationEvidence: ["scroll_observed_during_capture"],
      loadingSignalCount: 0,
      captureGaps: [],
    });
    const result = await createFlowImageReadinessCheck(harness.repositories)(
      existingMode,
    );
    expect(result).toMatchObject({
      status: "blocked",
      countModeEligibility: {
        status: "ambiguous",
        reason: "existing_project_virtualized",
        detailCode: "virtual_scroll_coverage_or_scrolling_observed",
      },
      reason: "virtual_scroll_coverage_or_scrolling_observed",
      message: expect.stringContaining("Scrolling or viewport movement"),
      attemptsCreated: 0,
      confirmationConsumed: false,
      productionReceiptCreated: false,
    });
    expect(harness.sendCommand).not.toHaveBeenCalled();
    expect(await harness.repositories.getAllFlowImageAttempts()).toEqual([]);
  });

  it("keeps existing-project count mode blocked when a visible virtual-scroll viewport cannot be measured", async () => {
    const harness = readinessHarness({
      status: "ready",
      profile: "populated_tiles",
      completeForRenderedScope: true,
      listenersAttached: true,
      stableBaseline: true,
      renderedTileCount: 2,
      distinctCandidateCount: 2,
      qualifyingCandidateCount: 2,
      candidateIds: ["a".repeat(64), "b".repeat(64)],
      repeatedCandidateCount: 0,
      unidentifiedImageCount: 0,
      unrelatedImageCount: 0,
      virtualized: true,
      virtualScrollContainerCount: 1,
      virtualizationEvidence: ["viewport_dimensions_unavailable"],
      loadingSignalCount: 0,
      captureGaps: [],
    });
    const result = await createFlowImageReadinessCheck(harness.repositories)(
      existingMode,
    );
    expect(result).toMatchObject({
      status: "blocked",
      reason: "virtual_scroll_measurement_inconclusive",
      message: expect.stringContaining("could not be measured"),
      countModeEligibility: {
        status: "ambiguous",
        reason: "existing_project_virtualized",
        detailCode: "virtual_scroll_measurement_inconclusive",
      },
      attemptsCreated: 0,
      confirmationConsumed: false,
      productionReceiptCreated: false,
    });
    expect(harness.sendCommand).not.toHaveBeenCalled();
    expect(await harness.repositories.getAllFlowImageAttempts()).toEqual([]);
  });

  it("reports a precise blocker when attested count exceeds qualifying owned candidates", async () => {
    const harness = readinessHarness({
      status: "ready",
      profile: "populated_tiles",
      completeForRenderedScope: true,
      listenersAttached: true,
      stableBaseline: true,
      renderedTileCount: 4,
      distinctCandidateCount: 4,
      qualifyingCandidateCount: 3,
      repeatedCandidateCount: 0,
      unidentifiedImageCount: 0,
      unrelatedImageCount: 0,
      virtualized: false,
      virtualScrollContainerCount: 1,
      virtualizationEvidence: ["scroll_extent_exceeds_viewport"],
      loadingSignalCount: 0,
      captureGaps: [],
    });
    const result = await createFlowImageReadinessCheck(harness.repositories)(
      existingMode,
    );
    expect(result).toMatchObject({
      status: "blocked",
      reason: "existing_count_candidate_count_mismatch",
      countModeEligibility: {
        status: "blocked",
        detailCode: "existing_count_candidate_count_mismatch",
      },
      baselineCoverageAssessment: {
        viewportOverflowObserved: true,
        actualScrollingObserved: false,
        declaredExistingCountMatchesQualifyingCandidates: false,
      },
      attemptsCreated: 0,
    });
    expect(harness.sendCommand).not.toHaveBeenCalled();
    expect(await harness.repositories.getAllFlowImageAttempts()).toEqual([]);
  });

  it("reports an unconfirmed existing count before document inspection or mutation", async () => {
    const harness = readinessHarness({ status: "ready" });
    const unconfirmed = {
      countMode: {
        ...existingMode.countMode,
        userConfirmed: false,
      },
    };
    const result = await createFlowImageReadinessCheck(harness.repositories)(
      unconfirmed,
    );
    expect(result).toMatchObject({
      status: "blocked",
      reason: "count_declaration_unconfirmed",
      countModeEligibility: {
        mode: "existing_project",
        status: "blocked",
        detailCode: "count_declaration_unconfirmed",
      },
      attemptsCreated: 0,
      confirmationConsumed: false,
      productionReceiptCreated: false,
    });
    expect(harness.executeScript).not.toHaveBeenCalled();
    expect(harness.sendCommand).not.toHaveBeenCalled();
    expect(await harness.repositories.getAllFlowImageAttempts()).toEqual([]);
  });

  it("blocks an absent target with a specific actionable reason without inspecting the provider", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
    );
    vi.spyOn(repositories, "getSelectedTarget").mockResolvedValue(undefined);
    const executeScript = vi.fn();
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        scripting: { executeScript },
        debugger: { sendCommand: vi.fn() },
      },
    });
    const result = (await createFlowImageReadinessCheck(repositories)(
      newEmptyMode,
    )) as Record<string, unknown>;
    expect(result).toMatchObject({
      status: "blocked",
      reason: "no_selected_target",
      message: expect.stringContaining("Select"),
      gates: { selectedTarget: "absent" },
      attemptsCreated: 0,
      confirmationConsumed: false,
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("blocks saved-unverified, stale-build, stale-document and selection-mismatch bindings before analyzer injection", async () => {
    const cases = [
      {
        verification: "unverified" as const,
        expectedReason: "saved_target_unverified",
      },
      {
        verification: "unverified" as const,
        bindingPatch: { extensionBuildId: "old-build" },
        expectedReason: "verification_stale_build",
      },
      {
        verification: "verified" as const,
        bindingPatch: { extensionBuildId: "old-build" },
        expectedReason: "verification_stale_build",
      },
      {
        verification: "verified" as const,
        bindingPatch: { connectorProtocolVersion: 99 },
        expectedReason: "verification_stale_protocol",
      },
      {
        verification: "verified" as const,
        bindingPatch: { projectId: "another-project" },
        expectedReason: "verification_selection_mismatch",
      },
      {
        verification: "verified" as const,
        bindingPatch: { capability: "unsupported" },
        expectedReason: "verification_capability_missing",
      },
    ];
    for (const entry of cases) {
      const harness = readinessHarness({ status: "ready" });
      const selectedSpy = vi.spyOn(harness.repositories, "getSelectedTarget");
      selectedSpy.mockResolvedValue({
        provider: "Flow",
        tabId: 9,
        canonicalTarget: "https://flow.google.com/project/project-1",
        verification: entry.verification,
        connectionState: "verified",
        reconnectEnabled: true,
        updatedAt: 1,
        ...(entry.bindingPatch
          ? {
              verificationBinding: {
                provider: "Flow" as const,
                tabId: 9,
                canonicalTarget: "https://flow.google.com/project/project-1",
                projectId: "project-1",
                frameId: 0 as const,
                documentId: "doc-1",
                documentToken: "token-1",
                extensionBuildId: BUILD_ID,
                extensionProtocolVersion: PROTOCOL_VERSION,
                connectorBuildId: BUILD_ID,
                connectorProtocolVersion: 1,
                capability: "read-only-connection-v1" as const,
                verifiedAt: 1,
                ...entry.bindingPatch,
              } as unknown as NonNullable<
                Awaited<
                  ReturnType<typeof harness.repositories.getSelectedTarget>
                >
              >["verificationBinding"],
            }
          : {}),
      });
      const result = (await createFlowImageReadinessCheck(harness.repositories)(
        newEmptyMode,
      )) as Record<string, unknown>;
      expect(result).toMatchObject({
        status: "blocked",
        reason: entry.expectedReason,
        message: expect.any(String),
      });
      expect(harness.executeScript).not.toHaveBeenCalled();
    }

    const staleDocument = readinessHarness({ status: "ready" });
    staleDocument.executeScript.mockReset().mockResolvedValueOnce([
      {
        documentId: "new-doc",
        frameId: 0,
        result: {
          href: "https://flow.google.com/project/project-1",
          top: true,
        },
      },
    ]);
    const result = (await createFlowImageReadinessCheck(
      staleDocument.repositories,
    )(newEmptyMode)) as Record<string, unknown>;
    expect(result).toMatchObject({
      status: "blocked",
      reason: "verification_stale_document",
      message: expect.any(String),
    });
    expect(staleDocument.executeScript).toHaveBeenCalledTimes(1);
  });
});
