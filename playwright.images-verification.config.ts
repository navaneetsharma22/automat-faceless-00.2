import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "imagesPart4Verification.spec.ts",
  reporter: "list",
  webServer: {
    command: "npx vite preview --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath:
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  timeout: 60_000,
});
