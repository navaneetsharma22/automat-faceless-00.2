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
    "flowObservationReadback.spec.ts",
    "flowAttemptStorageSchema.spec.ts",
  ],
  reporter: "list",
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: installedChromium
      ? { executablePath: installedChromium }
      : {},
  },
  timeout: 30_000,
});
