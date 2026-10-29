import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlowImageReadinessCheck } from "../../src/background/handlers/flow";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";

const originalChrome = (globalThis as { chrome?: unknown }).chrome;
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
    reconnectEnabled: false,
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
  it("captures a sanitized point-in-time result without creating attempts or issuing input", async () => {
    const harness = readinessHarness({
      status: "ready",
      profile: "populated_tiles",
      listenersAttached: true,
      stableBaseline: true,
      renderedTileCount: 2,
      distinctCandidateCount: 2,
      repeatedCandidateCount: 1,
      unidentifiedImageCount: 0,
      unrelatedImageCount: 0,
      virtualized: true,
      loadingSignalCount: 0,
      captureGaps: [],
      terminalSemanticsSupported: false,
    });
    const result = await createFlowImageReadinessCheck(harness.repositories)();
    expect(result).toMatchObject({
      status: "ready",
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
    const result = await createFlowImageReadinessCheck(harness.repositories)();
    expect(result).toMatchObject({
      status: "blocked",
      reason: "unsupported_baseline_profile",
      attemptsCreated: 0,
      confirmationConsumed: false,
    });
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
    const result = (await createFlowImageReadinessCheck(
      repositories,
    )()) as Record<string, unknown>;
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
        reconnectEnabled: false,
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
      const result = (await createFlowImageReadinessCheck(
        harness.repositories,
      )()) as Record<string, unknown>;
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
    )()) as Record<string, unknown>;
    expect(result).toMatchObject({
      status: "blocked",
      reason: "verification_stale_document",
      message: expect.any(String),
    });
    expect(staleDocument.executeScript).toHaveBeenCalledTimes(1);
  });
});
