import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const helperRoot = resolve(process.cwd(), "external/vids-helper");
const helperUrl = `https://helper.test/?extensionId=${extensionId}`;
const storageKey = "automat-faceless-vids-picker-key-v1";
const fakePickerKey = "fake-picker-key-for-local-fixture-001";
const replacementPickerKey = "fake-picker-key-replacement-002";
const recoveryPickerKey = "fake-picker-key-recovery-003";
const originalPin = "test-passphrase-2468";
const replacementPin = "new-test-passphrase-1357";
const recoveryPin = "recovery-test-passphrase-9753";

type HelperFixture = {
  oauthCalls: number;
  pickerKeys: string[];
  pickerOpenCount: number;
  driveRequests: number;
  extensionMessages: string[];
  driveUrls: string[];
  expectedDocumentId?: string;
  tokenLifetimeSeconds: number;
  driveMetadataEnabled: boolean;
  selectPicker: (fileId: string) => void;
  prepareResponseMode: "unavailable" | "pending";
};

type FixtureWindow = Window & { fixture: HelperFixture };

async function installFixture(_context: BrowserContext, page: Page, expectedDocumentId?: string) {
  await page.addInitScript((initialExpectedDocumentId) => {
    const fixtureWindow = window as FixtureWindow & {
      chrome?: unknown;
      gapi?: unknown;
      google?: unknown;
    };
    fixtureWindow.fixture = {
      oauthCalls: 0,
      pickerKeys: [],
      pickerOpenCount: 0,
      driveRequests: 0,
      extensionMessages: [],
      expectedDocumentId: initialExpectedDocumentId,
      driveUrls: [],
      tokenLifetimeSeconds: 3600,
      driveMetadataEnabled: false,
      prepareResponseMode: "unavailable",
      selectPicker: () => undefined,
    };
    fixtureWindow.chrome = {
      runtime: {
        lastError: null,
        sendMessage(
          _targetId: string,
          message: { type: string },
          callback: (response: unknown) => void,
        ) {
          fixtureWindow.fixture.extensionMessages.push(JSON.stringify(message));
          if (message.type === "HOSTED_MP4_NONCE_CHALLENGE") {
            callback({ success: true, requestNonce: "n".repeat(43) });
            return;
          }
          if (message.type === "HOSTED_MP4_PREPARATION_STATUS") {
            callback({ success: true });
            return;
          }
          callback({ success: true, status: "configured", ...(fixtureWindow.fixture.expectedDocumentId ? { expectedDocumentId: fixtureWindow.fixture.expectedDocumentId } : {}) });
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
      setDeveloperKey(key: string) {
        fixtureWindow.fixture.pickerKeys.push(key);
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
        fixtureWindow.fixture.selectPicker = (fileId) => this.callback?.({ action: "picked", docs: [{ id: fileId }] });
        return this;
      }
      build() {
        return {
          setVisible(visible: boolean) {
            if (visible) fixtureWindow.fixture.pickerOpenCount += 1;
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
            requestAccessToken: () => {
              fixtureWindow.fixture.oauthCalls += 1;
              options.callback({
                access_token: "mock-account-token",
                scope: "https://www.googleapis.com/auth/drive.file",
                expires_in: fixtureWindow.fixture.tokenLifetimeSeconds,
              });
            },
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
  }, expectedDocumentId);

  await page.route("https://helper.test/**", async (route) => {
    const url = new URL(route.request().url());
    const filename = url.pathname.endsWith("/")
      ? "index.html"
      : url.pathname.split("/").at(-1)!;
    if (
      ![
        "index.html",
        "app.js",
        "logic.js",
        "saved-key.js",
        "styles.css",
        "ui.js",
      ].includes(filename)
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
  });
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  );
  await page.route("https://apis.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  );
  await page.route("https://www.googleapis.com/**", async (route) => {
    await page.evaluate(() => {
      (window as FixtureWindow).fixture.driveRequests += 1;
    });
    const url = route.request().url();
    await page.evaluate((value) => (window as FixtureWindow).fixture.driveUrls.push(value), url);
    const fixture = await fixtureState(page);
    if (fixture.driveMetadataEnabled && route.request().method() === "GET") {
      const fileId = new URL(route.request().url()).pathname.split("/").at(-1);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: fileId, mimeType: "application/vnd.google-apps.vid", capabilities: { canDownload: true } }) });
      return;
    }
    if (fixture.prepareResponseMode === "pending" && route.request().method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "operations/mock-active-attempt", done: false }) });
      return;
    }
    if (fixture.prepareResponseMode === "pending" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "operations/mock-active-attempt", done: false }) });
      return;
    }
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { status: "UNAVAILABLE" } }) });
  });
}

async function openHelper(
  context: BrowserContext,
  page: Page,
  connectEnabled = true,
  expectedDocumentId?: string,
) {
  await installFixture(context, page, expectedDocumentId);
  await page.goto(helperUrl);
  await expect(page.locator("#extension-config-status")).toContainText(
    "configuration connected",
  );
  if (connectEnabled) await expect(page.locator("#start-proof")).toBeEnabled();
  else await expect(page.locator("#start-proof")).toBeDisabled();
}

async function saveKey(
  page: Page,
  key: string,
  pin: string,
  confirmation = pin,
) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#save-picker-key-input").fill(key);
  await page.locator("#save-picker-pin").fill(pin);
  await page.locator("#save-picker-pin-confirm").fill(confirmation);
  await page.getByRole("button", { name: "Save encrypted key" }).click();
  await expect(page.locator("#saved-key-settings-status")).toContainText(
    "Key encrypted and saved",
  );
  await expect(page.locator("#save-picker-key-input")).toHaveValue("");
  await expect(page.locator("#save-picker-pin")).toHaveValue("");
  await expect(page.locator("#save-picker-pin-confirm")).toHaveValue("");
}

async function fixtureState(page: Page) {
  return page.evaluate(() => ({ ...(window as FixtureWindow).fixture }));
}

async function storedRecord(page: Page) {
  return page.evaluate((key) => {
    const serialized = localStorage.getItem(key);
    return serialized ? JSON.parse(serialized) : null;
  }, storageKey);
}

async function wrongPin(page: Page, pin = "incorrect-fixture-pin") {
  await page.locator("#unlock-pin").fill(pin);
  await page.locator("#unlock-saved-key").click();
}

test("saves a versioned encrypted key and uses it only after explicit Connect", async ({
  context,
  page,
}) => {
  await openHelper(context, page);
  await expect(page.locator("#manual-key-entry")).toBeVisible();
  await expect(page.locator("#saved-key-download")).toBeHidden();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Dark", { exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page
      .locator("html")
      .evaluate((root) =>
        getComputedStyle(root).getPropertyValue("--color-accent").trim(),
      ),
  ).toBe("#9bec00");
  await expect
    .poll(() =>
      page
        .locator("#save-picker-key-form button")
        .evaluate((button) => getComputedStyle(button).backgroundColor),
    )
    .toBe("rgb(155, 236, 0)");
  expect(
    await page
      .locator("#save-picker-key-form button")
      .evaluate((button) => getComputedStyle(button).color),
  ).toBe("rgb(8, 33, 25)");
  await page.getByLabel("Light", { exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page
      .locator("html")
      .evaluate((root) =>
        getComputedStyle(root).getPropertyValue("--color-accent").trim(),
      ),
  ).toBe("#731d3e");
  await expect
    .poll(() =>
      page
        .locator("#save-picker-key-form button")
        .evaluate((button) => getComputedStyle(button).backgroundColor),
    )
    .toBe("rgb(115, 29, 62)");
  expect(
    await page
      .locator("#save-picker-key-form button")
      .evaluate((button) => getComputedStyle(button).color),
  ).toBe("rgb(255, 255, 255)");

  await page.locator("#save-picker-key-input").fill(fakePickerKey);
  await page.locator("#save-picker-pin").fill(originalPin);
  await page.locator("#save-picker-pin-confirm").fill(originalPin);
  await page.getByRole("button", { name: "Save encrypted key" }).click();
  await expect(page.locator("#saved-key-settings-status")).toContainText(
    "Key encrypted and saved",
  );
  await expect(page.locator("#save-picker-key-input")).toHaveValue("");
  await expect(page.locator("#save-picker-pin")).toHaveValue("");
  await expect(page.locator("#save-picker-pin-confirm")).toHaveValue("");
  await expect(page.locator("#save-picker-key-form")).toBeHidden();

  const record = await storedRecord(page);
  expect(record).toMatchObject({
    version: 1,
    cipher: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: 600_000,
    failedAttempts: 0,
  });
  expect(await page.evaluate((key) => atob(key).length, record.salt)).toBe(16);
  expect(await page.evaluate((iv) => atob(iv).length, record.iv)).toBe(12);
  expect(JSON.stringify(record)).not.toContain(fakePickerKey);
  expect(JSON.stringify(record)).not.toContain(originalPin);
  const initialSalt = record.salt;
  const initialIv = record.iv;

  const beforeConnect = await fixtureState(page);
  expect(beforeConnect.oauthCalls).toBe(0);
  expect(beforeConnect.pickerOpenCount).toBe(0);
  expect(beforeConnect.driveRequests).toBe(0);
  await expect(page.locator("#api-key")).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator("#api-key")
        .evaluate((input) => (input as HTMLInputElement).required),
    )
    .toBe(false);
  await page.getByRole("button", { name: "Download" }).click();
  await expect(page.locator("#saved-key-download")).toBeVisible();
  await expect(page.locator("#saved-key-download-status")).toContainText(
    "unlocked in this tab",
  );
  await expect(page.locator("#unlock-pin")).toBeHidden();
  await page.locator("#expected-document").fill("mocked_vids_document");
  await page
    .getByRole("button", { name: "Connect / Select Vids Document" })
    .click();
  await expect
    .poll(async () => (await fixtureState(page)).pickerOpenCount)
    .toBe(1);
  expect((await fixtureState(page)).pickerKeys).toEqual([fakePickerKey]);
  const afterConnect = await fixtureState(page);
  expect(afterConnect.oauthCalls).toBe(1);
  expect(afterConnect.driveRequests).toBe(0);
  expect(page.url()).not.toContain(fakePickerKey);
  expect(afterConnect.extensionMessages.join(" ")).not.toContain(fakePickerKey);
  expect(afterConnect.extensionMessages.join(" ")).not.toContain(originalPin);

  await page.reload();
  await expect(page.locator("#saved-key-download-status")).toContainText(
    "Enter your PIN to unlock",
  );
  await expect(page.locator("#unlock-attempts")).toHaveText(
    "3 attempts remaining",
  );
  await expect(page.locator("#start-proof")).toBeDisabled();
  const reloadedRecord = await storedRecord(page);
  expect(reloadedRecord.salt).toBe(initialSalt);
  expect(reloadedRecord.iv).toBe(initialIv);
  expect((await fixtureState(page)).pickerOpenCount).toBe(0);
});

test("counts wrong PINs across tabs, serializes concurrent attempts, and persists lockout", async ({
  context,
  page,
}) => {
  await openHelper(context, page);
  await saveKey(page, fakePickerKey, originalPin);
  await page.getByRole("button", { name: "Lock now" }).click();
  await page.getByRole("button", { name: "Download" }).click();

  const secondTab = await context.newPage();
  await openHelper(context, secondTab, false);
  await expect(secondTab.locator("#unlock-attempts")).toHaveText(
    "3 attempts remaining",
  );
  await expect(secondTab.locator("#manual-key-entry")).toBeHidden();

  await wrongPin(page);
  await expect(page.locator("#unlock-attempts")).toHaveText(
    "2 attempts remaining",
  );
  await expect(secondTab.locator("#unlock-attempts")).toHaveText(
    "2 attempts remaining",
  );
  await expect(page.locator("#saved-key-download-status")).toContainText(
    "Incorrect PIN. 2 attempts remaining.",
  );

  await wrongPin(secondTab);
  await expect(secondTab.locator("#unlock-attempts")).toHaveText(
    "1 attempt remaining",
  );
  await expect(page.locator("#unlock-attempts")).toHaveText(
    "1 attempt remaining",
  );
  await expect(secondTab.locator("#saved-key-download-status")).toContainText(
    "Incorrect PIN. 1 attempt remaining.",
  );

  // Two tabs race at the last available attempt. Only one may increment at a
  // time; after the third failure the queued action must see the locked record.
  await Promise.all(
    [page, secondTab].map(async (tab) =>
      tab.evaluate(() => {
        const pin = document.querySelector<HTMLInputElement>("#unlock-pin")!;
        const button =
          document.querySelector<HTMLButtonElement>("#unlock-saved-key")!;
        pin.value = "incorrect-fixture-pin";
        button.disabled = false;
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }),
    ),
  );
  await expect(page.locator("#unlock-attempts")).toHaveText(
    "Locked after 3 incorrect attempts",
  );
  await expect(secondTab.locator("#unlock-attempts")).toHaveText(
    "Locked after 3 incorrect attempts",
  );
  await expect(page.locator("#unlock-saved-key")).toBeDisabled();
  await expect(secondTab.locator("#unlock-saved-key")).toBeDisabled();
  expect((await storedRecord(page)).failedAttempts).toBe(3);

  await page.reload();
  await expect(page.locator("#saved-key-download-status")).toContainText(
    "Locked after 3 incorrect attempts",
  );
  await expect(page.locator("#manual-key-entry")).toBeHidden();
  await expect(page.locator("#start-proof")).toBeDisabled();
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#api-key")!;
    input.value = "fake-manual-bypass-key";
    document.querySelector<HTMLFormElement>("#proof-form")!.requestSubmit();
  });
  await expect.poll(async () => (await fixtureState(page)).oauthCalls).toBe(0);
  expect((await fixtureState(page)).pickerOpenCount).toBe(0);
  expect((await fixtureState(secondTab)).pickerOpenCount).toBe(0);
});

test("correct PIN resets attempts; replacement and forget require explicit recovery", async ({
  context,
  page,
}) => {
  await openHelper(context, page);
  await saveKey(page, fakePickerKey, originalPin);
  const originalRecord = await storedRecord(page);
  await page.getByRole("button", { name: "Lock now" }).click();
  await page.getByRole("button", { name: "Download" }).click();
  await wrongPin(page);
  await expect(page.locator("#unlock-attempts")).toHaveText(
    "2 attempts remaining",
  );

  const secondTab = await context.newPage();
  await openHelper(context, secondTab, false);
  await secondTab.locator("#unlock-pin").fill(originalPin);
  await secondTab.locator("#unlock-saved-key").click();
  await expect(secondTab.locator("#saved-key-download-status")).toContainText(
    "unlocked in this tab",
  );
  await expect
    .poll(async () => (await storedRecord(page)).failedAttempts)
    .toBe(0);
  await expect(page.locator("#unlock-attempts")).toHaveText(
    "3 attempts remaining",
  );
  expect((await fixtureState(secondTab)).oauthCalls).toBe(0);
  expect((await fixtureState(secondTab)).pickerOpenCount).toBe(0);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Replace saved key" }).click();
  await page.locator("#replace-current-pin").fill("incorrect-fixture-pin");
  await page.locator("#replace-picker-key-input").fill(replacementPickerKey);
  await page.locator("#replace-picker-pin").fill(replacementPin);
  await page.locator("#replace-picker-pin-confirm").fill(replacementPin);
  await page.getByRole("button", { name: "Confirm replacement" }).click();
  await expect(page.locator("#saved-key-settings-status")).toContainText(
    "Current PIN is incorrect. 2 attempts remaining.",
  );
  await expect(page.locator("#replace-current-pin")).toHaveValue("");

  await page.locator("#replace-current-pin").fill(originalPin);
  await page.locator("#replace-picker-key-input").fill(replacementPickerKey);
  await page.locator("#replace-picker-pin").fill(replacementPin);
  await page.locator("#replace-picker-pin-confirm").fill(replacementPin);
  await page.getByRole("button", { name: "Confirm replacement" }).click();
  await expect(page.locator("#saved-key-settings-status")).toContainText(
    "Saved key replaced and encrypted",
  );
  const replacementRecord = await storedRecord(page);
  expect(replacementRecord.failedAttempts).toBe(0);
  expect(replacementRecord.salt).not.toBe(originalRecord.salt);
  expect(replacementRecord.iv).not.toBe(originalRecord.iv);
  expect(replacementRecord.ciphertext).not.toContain(replacementPickerKey);
  await expect(page.locator("#replace-current-pin")).toHaveValue("");

  await page.getByRole("button", { name: "Download" }).click();
  await page.locator("#expected-document").fill("mocked_vids_document");
  await page
    .getByRole("button", { name: "Connect / Select Vids Document" })
    .click();
  await expect
    .poll(async () => (await fixtureState(page)).pickerOpenCount)
    .toBe(1);
  expect((await fixtureState(page)).pickerKeys).toEqual([replacementPickerKey]);

  await page.reload();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Forget saved key" }).click();
  await expect(page.locator("#saved-key-settings-status")).toContainText(
    "Saved key forgotten",
  );
  expect(await storedRecord(page)).toBeNull();
  await page.getByRole("button", { name: "Download" }).click();
  await expect(page.locator("#manual-key-entry")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#save-picker-key-form")).toBeVisible();

  await page.locator("#save-picker-key-input").fill(recoveryPickerKey);
  await page.locator("#save-picker-pin").fill(recoveryPin);
  await page.locator("#save-picker-pin-confirm").fill(recoveryPin);
  await page.getByRole("button", { name: "Save encrypted key" }).click();
  await expect(page.locator("#saved-key-settings-status")).toContainText(
    "Key encrypted and saved",
  );
  const recoveryRecord = await storedRecord(page);
  expect(recoveryRecord.failedAttempts).toBe(0);
  expect(recoveryRecord.salt).not.toBe(replacementRecord.salt);
  await page.getByRole("button", { name: "Download" }).click();
  await page.locator("#expected-document").fill("mocked_vids_document");
  await page
    .getByRole("button", { name: "Connect / Select Vids Document" })
    .click();
  await expect
    .poll(async () => (await fixtureState(page)).pickerOpenCount)
    .toBe(1);
  expect((await fixtureState(page)).pickerKeys).toEqual([recoveryPickerKey]);
  expect((await fixtureState(page)).driveRequests).toBe(0);
});

test("fills only a verified extension document and keeps direct-open manual entry available", async ({ context, page }) => {
  await openHelper(context, page, true, "verified-vids-01");
  await expect(page.locator("#expected-document")).toHaveValue("verified-vids-01");
  await expect(page.locator("#expected-document-source")).toHaveText("Filled from extension");
  await expect(page.locator("#manual-key-entry")).toBeVisible();

  const direct = await context.newPage();
  await installFixture(context, direct);
  await direct.goto("https://helper.test/");
  await expect(direct.locator("#extension-config-status")).toContainText("open this helper from the extension");
  await expect(direct.locator("#expected-document")).toHaveValue("");
  await expect(direct.locator("#expected-document-source")).toBeHidden();
  await expect(direct.locator("#manual-key-entry")).toBeVisible();
  await direct.setViewportSize({ width: 390, height: 844 });
  await expect(direct.locator("#switch-google-account")).toBeVisible();
  expect(await direct.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("requires the Picker result to match the autofilled exact document ID", async ({ context, page }) => {
  await openHelper(context, page, true, "verified-vids-expected");
  await page.evaluate(() => { (window as FixtureWindow).fixture.driveMetadataEnabled = true; });
  await page.locator("#api-key").fill(fakePickerKey);
  await page.locator("#start-proof").click();
  await expect.poll(async () => (await fixtureState(page)).pickerOpenCount).toBe(1);
  await page.evaluate(() => (window as FixtureWindow).fixture.selectPicker("different-picker-document"));
  await expect(page.locator("#selection-status")).toContainText("does not match the expected document");
  await expect(page.locator("#prepare-mp4")).toBeDisabled();
  expect((await fixtureState(page)).driveUrls.join(" ")).toContain("different-picker-document");
  expect((await fixtureState(page)).driveUrls.join(" ")).not.toContain("/files/verified-vids-expected");
});

test("preserves an active MP4 attempt for its original document when the expected ID changes", async ({ context, page }) => {
  await openHelper(context, page, true, "attempt-document-original");
  await page.evaluate(() => {
    const fixture = (window as FixtureWindow).fixture;
    fixture.driveMetadataEnabled = true;
    fixture.prepareResponseMode = "pending";
  });
  await page.locator("#api-key").fill(fakePickerKey);
  await page.locator("#start-proof").click();
  await expect.poll(async () => (await fixtureState(page)).pickerOpenCount).toBe(1);
  await page.evaluate(() => (window as FixtureWindow).fixture.selectPicker("attempt-document-original"));
  await expect(page.locator("#selection-status")).toContainText("Verified Google Vids metadata");
  await page.locator("#ack-only-intended-clip").check();
  await page.locator("#prepare-mp4").click();
  await expect.poll(async () => (await fixtureState(page)).driveUrls.some((url) => url.includes("/files/attempt-document-original/download"))).toBe(true);

  await page.locator("#expected-document").fill("attempt-document-new");
  await expect(page.locator("#ack-only-intended-clip")).not.toBeChecked();
  await expect(page.locator("#selected-file-id")).toHaveText("—");
  await expect(page.locator("#authorization-status")).toContainText("active attempt remains bound to document attempt-document-original");
  await page.locator("#api-key").fill(fakePickerKey);
  await page.locator("#start-proof").click();
  await expect(page.locator("#authorization-status")).toContainText("active attempt is still bound to its original document");
  expect((await fixtureState(page)).pickerOpenCount).toBe(1);
  expect((await fixtureState(page)).driveUrls.every((url) => !url.includes("/files/attempt-document-new/"))).toBe(true);
});

test("reuses a valid same-tab authorization and asks again after expiry or account switch", async ({ context, page }) => {
  await openHelper(context, page);
  await page.evaluate(() => { (window as FixtureWindow).fixture.driveMetadataEnabled = true; });
  await page.locator("#expected-document").fill("session-document");
  await page.locator("#api-key").fill(fakePickerKey);
  await page.locator("#start-proof").click();
  await expect.poll(async () => (await fixtureState(page)).pickerOpenCount).toBe(1);
  await page.evaluate(() => (window as FixtureWindow).fixture.selectPicker("session-document"));
  await expect(page.locator("#selection-status")).toContainText("Verified Google Vids metadata");

  await page.locator("#api-key").fill(fakePickerKey);
  await page.locator("#start-proof").click();
  await expect.poll(async () => (await fixtureState(page)).pickerOpenCount).toBe(2);
  await expect(page.locator("#authorization-status")).toContainText("Reusing the authorized Google account");
  expect((await fixtureState(page)).oauthCalls).toBe(1);
  await page.evaluate(() => (window as FixtureWindow).fixture.selectPicker("session-document"));
  await expect(page.locator("#selection-status")).toContainText("Verified Google Vids metadata");
  await page.evaluate(() => {
    const originalNow = Date.now;
    Date.now = () => originalNow() + 3600 * 1000;
  });
  await page.locator("#api-key").fill(fakePickerKey);
  await page.locator("#start-proof").click();
  await expect.poll(async () => (await fixtureState(page)).oauthCalls).toBe(2);
  await expect.poll(async () => (await fixtureState(page)).pickerOpenCount).toBe(3);
  await page.evaluate(() => (window as FixtureWindow).fixture.selectPicker("session-document"));
  await expect(page.locator("#selection-status")).toContainText("Verified Google Vids metadata");
  await page.locator("#api-key").fill(fakePickerKey);
  await page.getByRole("button", { name: "Switch Google account" }).click();
  await expect.poll(async () => (await fixtureState(page)).oauthCalls).toBe(3);
});
