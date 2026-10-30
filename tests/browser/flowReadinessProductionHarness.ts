import { AutomatDatabase } from "../../src/storage/db";
import {
  createDexieRepositoryDatabase,
  ExtensionRepositories,
} from "../../src/storage/repositories";
import { createFlowImageReadinessCheck } from "../../src/background/handlers/flow";
import { BUILD_ID, PROTOCOL_VERSION } from "../../src/shared/buildInfo";
import {
  CONNECTION_CAPABILITY,
  CONNECTOR_PROTOCOL_VERSION,
} from "../../src/platforms/shared/contracts";

const canonicalTarget = "https://flow.google.com/project/readiness-fixture";
const documentId = "production-readiness-fixture-document";
const makeDatabaseName = () =>
  `flow-readiness-production-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function runProductionReadinessFixture() {
  const database = new AutomatDatabase(makeDatabaseName());
  await database.open();
  const repositories = new ExtensionRepositories(
    createDexieRepositoryDatabase(database),
  );
  const selected = await repositories.recordSelectedTarget({
    provider: "Flow",
    tabId: 74,
    canonicalTarget,
  });
  await repositories.setReconnectIntent("Flow", true);
  const current = await repositories.getSelectedTarget("Flow");
  if (!current) throw new Error("readiness fixture target missing");
  const verified = await repositories.recordTargetVerification(
    {
      provider: "Flow",
      tabId: 74,
      canonicalTarget,
      projectId: "readiness-fixture",
      frameId: 0,
      documentId,
      documentToken: "readiness-fixture-document-token",
      extensionBuildId: BUILD_ID,
      extensionProtocolVersion: PROTOCOL_VERSION,
      connectorBuildId: BUILD_ID,
      connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
      capability: CONNECTION_CAPABILITY,
      verifiedAt: Date.now(),
    },
    current.revision,
  );
  if (!verified) throw new Error("readiness fixture verification failed");

  const scriptingPort = {
    executeScript: async (input: {
      func: (...args: unknown[]) => unknown;
      args?: unknown[];
    }) => {
      const result = await input.func(...(input.args ?? []));
      return [{ documentId, frameId: 0, result }];
    },
  } as unknown as Pick<typeof chrome.scripting, "executeScript">;
  const readiness = createFlowImageReadinessCheck(repositories, scriptingPort);
  const report = await readiness({
    countMode: {
      mode: "existing_project",
      countSessionId: "0f0ea52e-b649-41b8-8a63-0a23ef01ad25",
      startingImageCount: 4,
      userConfirmed: true,
    },
  });
  const selectedAfter = await repositories.getSelectedTarget("Flow");
  const attempts = await repositories.getAllFlowImageAttempts();
  database.close();
  return {
    report,
    selectedVerified: selectedAfter?.verification === "verified",
    attemptsCreated: attempts.length,
    fixtureSelectionRevision: selected.revision,
  };
}
