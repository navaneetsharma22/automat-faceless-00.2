import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createVidsDownloadHandler,
  createHostedVidsDownloadListener,
} from "../../src/background/handlers/vidsDownload";
import { createHostedHelperConfigListener } from "../../src/background/handlers/hostedHelper";
import { createVidsDownloadManager } from "../../src/background/downloadManager";
import { createVidsTimelineReadiness } from "../../src/domain/media/combinedExport";
import { ChromePreferenceRepository } from "../../src/storage/repositories";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const documentId = "mocked_vids_doc_42";
const operationName = "operations/retained_before_poll_42";
const nonce = "c".repeat(64);
const helperRoot = resolve(process.cwd(), "external/vids-helper");
const screenshotRoot = resolve(process.cwd(), "artifacts/hosted-helper-ui");
const helperUrl = `https://navaneetsharma22.github.io/automat-faceless-picker/?extensionId=${extensionId}`;
const sender = {
  origin: "https://navaneetsharma22.github.io",
  url: helperUrl,
  frameId: 0,
  tab: { id: 81 },
  documentId: "helper-dom-document-81",
};

test("normal Prepare button retains the POST operation ID before a mocked poll failure", async ({
  page,
}) => {
  await page.clock.install();
  const values: Record<string, unknown> = {};
  const preferences = new ChromePreferenceRepository({
    get: async (key) => ({ [key]: values[key] }),
    set: async (items) => Object.assign(values, items),
  });
  const canonicalTarget = `https://vids.google.com/video/${documentId}/edit`;
  const readiness = createVidsTimelineReadiness(
    {
      documentId,
      canonicalTarget,
      tabId: 12,
      sceneOrderConfirmed: true,
      documentSavedConfirmed: true,
    },
    100,
  );
  await preferences.setVidsTimelineReadiness(readiness);
  const selected = {
    provider: "Vids",
    verification: "verified",
    connectionState: "verified",
    tabId: 12,
    canonicalTarget,
    verificationBinding: {
      provider: "Vids",
      tabId: 12,
      canonicalTarget,
      projectId: documentId,
    },
  };
  const repositories = { getSelectedTarget: async () => selected };
  const chromeDownloads = {
    download: async () => {
      throw new Error(
        "The mocked failure path must not start a Chrome download.",
      );
    },
    search: async () => [],
  };
  const manager = createVidsDownloadManager({
    preferences,
    downloads: chromeDownloads as never,
    now: () => 200,
  });
  const handler = createVidsDownloadHandler({
    extensionId,
    preferences,
    repositories: repositories as never,
    manager,
    revalidate: async () => ({
      ok: true,
      state: "verified",
      tab: { id: 12, provider: "Vids", projectId: documentId, canonicalTarget },
    }),
    now: () => 200,
    makeAttemptId: () => "attempt_production_click",
    makeNonce: () => nonce,
  });
  const downloadListener = createHostedVidsDownloadListener(handler);
  const configListener = createHostedHelperConfigListener(extensionId);
  const externalMessages: string[] = [];
  let driveRequests = 0;

  await handler.arm();
  await page.exposeFunction(
    "fixtureExternalMessage",
    async (targetId: string, message: { type: string }) => {
      expect(targetId).toBe(extensionId);
      externalMessages.push(message.type);
      const listener =
        message.type === "VIDS_HELPER_CONFIG_PING"
          ? configListener
          : downloadListener;
      return await new Promise((resolveMessage) => {
        const handled = listener(message, sender, resolveMessage);
        if (!handled && message.type !== "VIDS_HELPER_CONFIG_PING")
          resolveMessage({ success: false, status: "rejected" });
      });
    },
  );
  await page.addInitScript(() => {
    const fixtureWindow = window as Window & {
      chrome?: unknown;
      gapi?: unknown;
      google?: unknown;
      fixtureExternalMessage?: (
        extensionId: string,
        message: { type: string },
      ) => Promise<unknown>;
    };
    fixtureWindow.chrome = {
      runtime: {
        lastError: null,
        sendMessage(
          targetId: string,
          message: { type: string },
          callback: (response: unknown) => void,
        ) {
          void fixtureWindow.fixtureExternalMessage!(targetId, message).then(
            callback,
          );
        },
      },
    };
    fixtureWindow.gapi = {
      load: (_name: string, options: { callback: () => void }) =>
        options.callback(),
    };

    class PickerBuilder {
      callback?: (data: unknown) => void;
      addView() {
        return this;
      }
      setOAuthToken() {
        return this;
      }
      setDeveloperKey() {
        return this;
      }
      setAppId() {
        return this;
      }
      setOrigin() {
        return this;
      }
      setMaxItems() {
        return this;
      }
      setSelectableMimeTypes() {
        return this;
      }
      setCallback(callback: (data: unknown) => void) {
        this.callback = callback;
        return this;
      }
      build() {
        const callback = this.callback;
        return {
          setVisible(visible: boolean) {
            if (visible)
              callback?.({
                action: "picked",
                docs: [{ id: "mocked_vids_doc_42" }],
              });
          },
          dispose() {},
        };
      }
    }
    fixtureWindow.google = {
      accounts: {
        oauth2: {
          initTokenClient: (options: {
            callback: (response: unknown) => void;
          }) => ({
            requestAccessToken: () =>
              options.callback({
                access_token: "mock-token",
                scope: "https://www.googleapis.com/auth/drive.file",
              }),
          }),
          hasGrantedAllScopes: () => true,
        },
      },
      picker: {
        Action: { PICKED: "picked", CANCEL: "cancel", ERROR: "error" },
        Response: { ACTION: "action", DOCUMENTS: "docs" },
        Document: { ID: "id" },
        ViewId: { DOCS: "docs" },
        DocsViewMode: { LIST: "list" },
        DocsView: class {
          setMimeTypes() {
            return this;
          }
          setMode() {
            return this;
          }
        },
        PickerBuilder,
      },
    };
  });

  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  );
  await page.route("https://apis.google.com/js/api.js", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  );
  await page.route(
    "https://navaneetsharma22.github.io/automat-faceless-picker/**",
    async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const filename = pathname.endsWith("/")
        ? "index.html"
        : pathname.split("/").at(-1)!;
      if (
        !["index.html", "app.js", "logic.js", "styles.css", "ui.js"].includes(
          filename,
        )
      ) {
        await route.fulfill({ status: 404, body: "not found" });
        return;
      }
      const contentType = filename.endsWith(".js")
        ? "text/javascript"
        : filename.endsWith(".css")
          ? "text/css"
          : "text/html";
      await route.fulfill({
        status: 200,
        contentType,
        body: await readFile(resolve(helperRoot, filename), "utf8"),
      });
    },
  );

  let preparationPosts = 0;
  let operationPolls = 0;
  await page.route("https://www.googleapis.com/drive/v3/**", async (route) => {
    driveRequests += 1;
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === `/drive/v3/files/${documentId}`
    ) {
      await route.fulfill({
        json: {
          id: documentId,
          mimeType: "application/vnd.google-apps.vid",
          capabilities: { canDownload: true },
        },
      });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname === `/drive/v3/files/${documentId}/download`
    ) {
      preparationPosts += 1;
      expect(url.searchParams.get("mimeType")).toBe("video/mp4");
      await route.fulfill({ json: { name: operationName, done: false } });
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === "/drive/v3/operations/retained_before_poll_42"
    ) {
      operationPolls += 1;
      expect(await handler.get()).toMatchObject({
        state: "preparing_mp4",
        operationName,
      });
      await route.fulfill({
        status: 503,
        json: { error: { status: "UNAVAILABLE" } },
      });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { error: { status: "NOT_FOUND" } },
    });
  });

  await mkdir(screenshotRoot, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(helperUrl);
  await expect(page.locator("#extension-config-status")).toContainText(
    "configuration connected",
  );
  await expect(page.locator("#workflow-summary")).toContainText(
    "enter your Picker key",
  );
  await page.screenshot({
    path: resolve(screenshotRoot, "initial-light-desktop.png"),
    fullPage: true,
  });
  const messagesBeforeNavigation = [...externalMessages];
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Dark", { exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("automat-faceless-vids-helper-theme"),
    ),
  ).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByLabel("System", { exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("automat-faceless-vids-helper-theme"),
    ),
  ).toBe("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Dark", { exact: true }).check();
  await page.getByRole("button", { name: "Advanced" }).click();
  await expect(page.getByRole("heading", { name: "Advanced" })).toBeVisible();
  await page.getByRole("button", { name: "Download" }).click();
  await expect(
    page.getByRole("heading", { name: "Prepare your MP4" }),
  ).toBeVisible();
  expect(externalMessages).toEqual(messagesBeforeNavigation);
  expect(driveRequests).toBe(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.locator('input[name="theme-choice"][value="dark"]'),
  ).toBeChecked();
  expect(driveRequests).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: resolve(screenshotRoot, "initial-dark-narrow.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Light", { exact: true }).check();
  await page.getByRole("button", { name: "Download" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.locator("#api-key").fill("mock-picker-key");
  await page.locator("#expected-document").fill(documentId);
  await page.locator("#start-proof").click();
  await expect(page.locator("#selection-status")).toContainText(
    "Verified Google Vids metadata",
  );
  await expect(page.locator("#workflow-summary")).toContainText(
    "Document verified",
  );
  // Local state fixtures exercise the presentation for successful terminal states
  // without dispatching a Drive request or extension handoff.
  await page.evaluate(() => {
    document.querySelector("#ack-only-intended-clip")!.checked = true;
    const operation = document.querySelector("#mp4-operation-status")!;
    operation.textContent = "MP4 ready";
    const handoff = document.querySelector(
      "#send-prepared-mp4-to-extension",
    ) as HTMLButtonElement;
    handoff.hidden = false;
    handoff.disabled = false;
  });
  await expect(page.locator("#workflow-summary")).toHaveText(
    "MP4 ready. Next: send it to the extension.",
  );
  await page.screenshot({
    path: resolve(screenshotRoot, "mp4-ready-light-desktop.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.querySelector("#extension-handoff-status")!.textContent =
      "Accepted · attempt fixture-attempt · document fixture-document · Chrome download ID 42. Completion is tracked separately.";
  });
  await expect(page.locator("#workflow-summary")).toContainText(
    "Accepted · attempt fixture-attempt",
  );
  await page.screenshot({
    path: resolve(screenshotRoot, "handoff-fixture-light-desktop.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.querySelector("#ack-only-intended-clip")!.checked = false;
    document.querySelector("#mp4-operation-status")!.textContent =
      "Not prepared";
    document.querySelector("#extension-handoff-status")!.textContent =
      "No extension handoff requested";
    const handoff = document.querySelector(
      "#send-prepared-mp4-to-extension",
    ) as HTMLButtonElement;
    handoff.hidden = true;
    handoff.disabled = true;
  });
  await expect(page.locator("#workflow-summary")).toContainText(
    "Document verified",
  );
  await page.locator("#ack-only-intended-clip").check();
  await expect(page.locator("#prepare-mp4")).toBeEnabled();

  await page.locator("#prepare-mp4").click();
  await expect
    .poll(async () => (await handler.get())?.state)
    .toBe("preparing_mp4");
  await expect(page.locator("#workflow-summary")).toContainText(
    "Waiting for Drive rendering",
  );
  await expect
    .poll(async () => (await handler.get())?.operationName)
    .toBe(operationName);
  await page.clock.fastForward(10_000);
  await expect
    .poll(async () => (await handler.get())?.state)
    .toBe("needs_review");

  expect(await handler.get()).toMatchObject({
    attemptId: "attempt_production_click",
    state: "needs_review",
    reason: "operation_observation_lost",
    operationName,
  });
  expect(preparationPosts).toBe(1);
  expect(operationPolls).toBe(1);
  expect(await page.locator("#mp4-operation-status").textContent()).toContain(
    "operation could not be checked",
  );
  await expect(page.locator("#workflow-summary")).toContainText(
    "operation could not be checked",
  );
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Dark", { exact: true }).check();
  await page.getByRole("button", { name: "Download" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(screenshotRoot, "error-dark-narrow.png"),
    fullPage: true,
  });
  expect(
    await page.locator("#send-prepared-mp4-to-extension").isVisible(),
  ).toBe(false);
});
