import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installFlowGalleryDownloadObserver } from "../src/platforms/flow/downloads";

const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/flow/gallery-download-diagnostic.synthetic.html",
);

test("binds menus after trigger updates aria-controls and reports before quality click", async ({
  page,
}) => {
  const fixture = await readFile(fixturePath, "utf8");
  await page.setContent(fixture);
  await page.evaluate((observerSource) => {
    const target = window as Window & {
      chrome?: { runtime?: { sendMessage?: (message: unknown) => void } };
      diagnosticMessages?: unknown[];
      preClickControls?: Array<string | null>;
    };
    target.diagnosticMessages = [];
    target.preClickControls = [];
    target.chrome = {
      runtime: {
        sendMessage: (message) => target.diagnosticMessages!.push(message),
      },
    };
    document.addEventListener(
      "click",
      (event) => {
        if ((event.target as HTMLElement).id === "more")
          target.preClickControls!.push(
            (event.target as HTMLElement).getAttribute("aria-controls"),
          );
      },
      true,
    );
    const install = (0, eval)(`(${observerSource})`) as (
      sessionId: string,
    ) => unknown;
    install("33333333-3333-4333-8333-333333333333");
  }, installFlowGalleryDownloadObserver.toString());

  await page.hover("article");
  await expect(page.locator("#more")).toBeVisible();
  await page.click("#more");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & {
            diagnosticMessages?: Array<Record<string, unknown>>;
          }
        ).diagnosticMessages?.some((message) => message.stage === "main_menu"),
      ),
    )
    .toBe(true);

  const mainEvidence = await page.evaluate(() => {
    const target = window as Window & {
      diagnosticMessages?: Array<Record<string, unknown>>;
      preClickControls?: Array<string | null>;
    };
    return {
      preClickControls: target.preClickControls,
      messages: target.diagnosticMessages,
    };
  });
  expect(mainEvidence.preClickControls).toEqual([null]);
  expect(mainEvidence.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        stage: "main_menu",
        ownerFound: true,
        mainMenuControlResolved: true,
      }),
    ]),
  );

  await page.hover("#download-row");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & {
            diagnosticMessages?: Array<Record<string, unknown>>;
          }
        ).diagnosticMessages?.some(
          (message) => message.stage === "download_row",
        ),
      ),
    )
    .toBe(true);
  const preQualityEvidence = await page.evaluate(() => {
    const messages =
      (
        window as Window & {
          diagnosticMessages?: Array<Record<string, unknown>>;
        }
      ).diagnosticMessages ?? [];
    return {
      menu: messages.find((message) => message.stage === "main_menu"),
      submenu: messages.find((message) => message.stage === "download_row"),
      qualityAction: messages.some(
        (message) => message.stage === "quality_action",
      ),
    };
  });
  expect(preQualityEvidence.menu).toMatchObject({
    ownerFound: true,
    mainMenuControlResolved: true,
  });
  expect(preQualityEvidence.submenu).toMatchObject({
    downloadRowRecognized: true,
    qualityMenuControlResolved: true,
    qualityOptionObserved: true,
    qualityOptionEnabled: true,
  });
  expect(preQualityEvidence.qualityAction).toBe(false);

  await page.click("#quality");
  await expect(page.locator("#quality-menu")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & {
            diagnosticMessages?: Array<Record<string, unknown>>;
          }
        ).diagnosticMessages?.some(
          (message) => message.stage === "quality_action",
        ),
      ),
    )
    .toBe(true);
});

test("rejects a duplicated aria-controls target instead of guessing a menu", async ({
  page,
}) => {
  const fixture = await readFile(fixturePath, "utf8");
  await page.setContent(fixture);
  await page.evaluate((observerSource) => {
    const target = window as Window & {
      chrome?: { runtime?: { sendMessage?: (message: unknown) => void } };
      diagnosticMessages?: unknown[];
    };
    target.diagnosticMessages = [];
    target.chrome = {
      runtime: {
        sendMessage: (message) => target.diagnosticMessages!.push(message),
      },
    };
    const duplicate = document.createElement("div");
    duplicate.id = "main-menu";
    document.body.append(duplicate);
    const install = (0, eval)(`(${observerSource})`) as (
      sessionId: string,
    ) => unknown;
    install("33333333-3333-4333-8333-333333333333");
  }, installFlowGalleryDownloadObserver.toString());
  await page.hover("article");
  await page.click("#more");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & {
            diagnosticMessages?: Array<Record<string, unknown>>;
          }
        ).diagnosticMessages?.some(
          (message) => message.stage === "capture_issue",
        ),
      ),
    )
    .toBe(true);
  await expect(
    page.evaluate(
      () =>
        (
          window as Window & {
            diagnosticMessages?: Array<Record<string, unknown>>;
          }
        ).diagnosticMessages,
    ),
  ).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        stage: "capture_issue",
        failedStage: "main_menu",
        reason: "menu_unresolved",
      }),
    ]),
  );
});

test("finds the card owner on the composed path across a shadow boundary", async ({
  page,
}) => {
  await page.setContent(
    `<article id="gallery-card"><flow-video-tile></flow-video-tile></article>`,
  );
  await page.evaluate((observerSource) => {
    const target = window as Window & {
      chrome?: { runtime?: { sendMessage?: (message: unknown) => void } };
      diagnosticMessages?: unknown[];
      ownerProbe?: {
        closestOwnerFound: boolean;
        composedOwnerTag: string | null;
      };
    };
    target.diagnosticMessages = [];
    target.chrome = {
      runtime: {
        sendMessage: (message) => target.diagnosticMessages!.push(message),
      },
    };
    const host = document.querySelector("flow-video-tile")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button aria-label="More options">⋮</button>`;
    const trigger = shadow.querySelector("button")!;
    trigger.addEventListener("click", () => {
      trigger.setAttribute("aria-controls", "shadow-card-menu");
      const menu = document.createElement("div");
      menu.id = "shadow-card-menu";
      menu.setAttribute("role", "menu");
      document.body.append(menu);
    });
    document.addEventListener(
      "click",
      (event) => {
        const path = event.composedPath();
        const button = path.find(
          (entry): entry is HTMLButtonElement =>
            entry instanceof HTMLButtonElement &&
            entry.getAttribute("aria-label") === "More options",
        );
        const pathOwner = path.find(
          (entry): entry is HTMLElement =>
            entry instanceof HTMLElement && entry.matches("article"),
        );
        target.ownerProbe = {
          closestOwnerFound: Boolean(button?.closest("article")),
          composedOwnerTag: pathOwner?.tagName.toLowerCase() ?? null,
        };
      },
      true,
    );
    const install = (0, eval)(`(${observerSource})`) as (
      sessionId: string,
    ) => unknown;
    install("33333333-3333-4333-8333-333333333333");
  }, installFlowGalleryDownloadObserver.toString());

  await page.locator("flow-video-tile").locator("button").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & {
            diagnosticMessages?: Array<Record<string, unknown>>;
          }
        ).diagnosticMessages?.some((message) => message.stage === "main_menu"),
      ),
    )
    .toBe(true);
  const evidence = await page.evaluate(() => {
    const target = window as Window & {
      diagnosticMessages?: Array<Record<string, unknown>>;
      ownerProbe?: {
        closestOwnerFound: boolean;
        composedOwnerTag: string | null;
      };
    };
    return {
      ownerProbe: target.ownerProbe,
      mainMenu: target.diagnosticMessages?.find(
        (message) => message.stage === "main_menu",
      ),
    };
  });
  expect(evidence.ownerProbe).toEqual({
    closestOwnerFound: false,
    composedOwnerTag: "article",
  });
  expect(evidence.mainMenu).toMatchObject({
    stage: "main_menu",
    ownerFound: true,
    mainMenuControlResolved: true,
  });
});
