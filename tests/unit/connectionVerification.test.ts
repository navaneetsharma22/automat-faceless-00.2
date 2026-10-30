import { describe, expect, it } from "vitest";
import { ExtensionRepositories } from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";

const binding = {
  provider: "Flow" as const,
  tabId: 9,
  canonicalTarget: "https://flow.google.com/project/project-1",
  projectId: "project-1",
  frameId: 0 as const,
  documentId: "document-1",
  documentToken: "token-1",
  extensionBuildId: "build-current",
  extensionProtocolVersion: 4,
  connectorBuildId: "build-current",
  connectorProtocolVersion: 1,
  capability: "read-only-connection-v1" as const,
  verifiedAt: 100,
};

describe("persisted connection verification", () => {
  it("records a strict handshake binding only for the matching selected target", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
      () => 101,
    );
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: binding.tabId,
      canonicalTarget: binding.canonicalTarget,
    });
    await repositories.setReconnectIntent("Flow", true);

    expect(await repositories.recordTargetVerification(binding)).toBe(true);
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "verified",
      verificationBinding: binding,
    });
  });

  it("rejects a stale selection and invalidates verification on worker restart", async () => {
    const repositories = new ExtensionRepositories(
      createMemoryRepositoryDatabase(),
      () => 101,
    );
    await repositories.recordSelectedTarget({
      provider: "Flow",
      tabId: binding.tabId,
      canonicalTarget: binding.canonicalTarget,
    });
    await repositories.setReconnectIntent("Flow", true);
    expect(
      await repositories.recordTargetVerification({ ...binding, tabId: 10 }),
    ).toBe(false);
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "unverified",
    });

    expect(await repositories.recordTargetVerification(binding)).toBe(true);
    await repositories.markTargetsUnverified();
    expect(await repositories.getSelectedTarget("Flow")).toMatchObject({
      verification: "unverified",
      verificationBinding: binding,
    });
  });
});
