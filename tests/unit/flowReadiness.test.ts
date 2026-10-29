import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlowImageReadinessCheck } from "../../src/background/handlers/flow";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";

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
});
