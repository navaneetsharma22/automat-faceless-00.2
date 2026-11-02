import { defineConfig } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const localPlaywrightCache = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "ms-playwright")
  : undefined;
const installedChromium =
  localPlaywrightCache && existsSync(localPlaywrightCache)
    ? readdirSync(localPlaywrightCache, { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name),
        )
        .map((entry) =>
          join(localPlaywrightCache, entry.name, "chrome-win64", "chrome.exe"),
        )
        .find((path) => existsSync(path))
    : undefined;

export default defineConfig({
  testDir: ".",
  testMatch: [
    "flowPromptEntry.spec.ts",
    "flowGenerateOnce.spec.ts",
    "flowPopulatedResultsDiagnostic.spec.ts",
    "flowImageTileDiagnostic.spec.ts",
    "flowImageLifecycleRecorder.spec.ts",
    "flowObservationProducer.spec.ts",
    "flowObservationEndToEnd.spec.ts",
    "flowObservationReadback.spec.ts",
    "flowAttemptStorageSchema.spec.ts",
    "flowProductionArm.spec.ts",
    "connectionLifecycle.spec.ts",
    "flowReadinessProduction.spec.ts",
    "sidebarLayout.spec.ts",
    "dashboardCleanup.spec.ts",
    "imageQueueStorage.spec.ts",
    "imageQueueSequence.spec.ts",
    "imageQueuePresentation.spec.ts",
    "videoQueuePresentation.spec.ts",
    "vidsVideoReference.spec.ts",
    "vidsVideoGenerate.spec.ts",
    "vidsVideoQueue.spec.ts",
    "imageQueueCreateTransition.spec.ts",
    "referenceCaptureStorage.spec.ts",
    "flowVideoAttachmentStorage.spec.ts",
  ],
  reporter: "list",
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: installedChromium
      ? { executablePath: installedChromium }
      : {},
  },
  timeout: 30_000,
});
