import { chromium, expect, test } from "@playwright/test";
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
        sendMessage: (message) => {
          target.diagnosticMessages!.push(message);
          return Promise.resolve(undefined);
        },
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

  await page.click("#other-quality-menuitem");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & {
            diagnosticMessages?: Array<Record<string, unknown>>;
          }
        ).diagnosticMessages?.some(
          (message) =>
            message.stage === "quality_click_rejected" &&
            message.reason === "quality_option_not_found",
        ),
      ),
    )
    .toBe(true);
  await expect(page.locator("#quality-menu")).toHaveCount(1);

  await page.click("#quality-label");
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
  const clickStages = await page.evaluate(() =>
    (
      window as Window & {
        diagnosticMessages?: Array<Record<string, unknown>>;
      }
    ).diagnosticMessages
      ?.map((message) => message.stage)
      .filter((stage) =>
        [
          "quality_click_listener",
          "quality_click_rejected",
          "quality_action_accepted_in_page",
          "quality_action",
        ].includes(String(stage)),
      ),
  );
  expect(clickStages).toEqual([
    "quality_click_listener",
    "quality_click_rejected",
    "quality_click_listener",
    "quality_action_accepted_in_page",
    "quality_action",
  ]);
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

test("recognizes the verified Flow video tile and captures both menus before quality selection", async ({
  page,
}) => {
  await page.setContent(`
    <style>
      flow-grid-tile-container, flow-video-tile { display: block; }
      flow-grid-tile-container { padding: 20px; }
      #download-row, #quality-menu [role="menuitem"] { padding: 10px; }
    </style>
    <flow-grid-tile-container role="group">
      <div><div>
        <flow-video-tile>
          <div><div><div><div><div><div>
            <button aria-label="More options"><mat-icon>more_vert</mat-icon></button>
          </div></div></div></div></div></div>
        </flow-video-tile>
      </div></div>
    </flow-grid-tile-container>
  `);
  await page.evaluate((observerSource) => {
    const target = window as Window & {
      chrome?: { runtime?: { sendMessage?: (message: unknown) => void } };
      diagnosticMessages?: Array<Record<string, unknown>>;
    };
    target.diagnosticMessages = [];
    target.chrome = {
      runtime: {
        sendMessage: (message) => {
          target.diagnosticMessages!.push(message as Record<string, unknown>);
          return Promise.resolve(undefined);
        },
      },
    };
    const trigger = document.querySelector("flow-video-tile button")!;
    trigger.addEventListener("click", () => {
      window.setTimeout(() => {
        trigger.setAttribute("aria-controls", "live-main-menu");
        const menu = document.createElement("div");
        menu.id = "live-main-menu";
        menu.setAttribute("role", "menu");
        menu.innerHTML = `<div id="download-row" role="menuitem">downloadDownload</div>`;
        document.body.append(menu);
        menu.querySelector("#download-row")!.addEventListener(
          "pointerover",
          () => {
            const row = menu.querySelector<HTMLElement>("#download-row")!;
            window.setTimeout(() => {
              row.setAttribute("aria-controls", "live-quality-menu");
              const quality = document.createElement("div");
              quality.id = "live-quality-menu";
              quality.setAttribute("role", "menu");
              quality.innerHTML = `<div role="menuitem" aria-disabled="false">1080p Upscaled</div>`;
              document.body.append(quality);
            }, 40);
          },
          { once: true },
        );
      }, 40);
    });
    const install = (0, eval)(`(${observerSource})`) as (
      sessionId: string,
    ) => unknown;
    install("33333333-3333-4333-8333-333333333333");
  }, installFlowGalleryDownloadObserver.toString());

  expect(await page.locator("video").count()).toBe(0);
  await page.locator("flow-video-tile").locator("mat-icon").click();
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
  const main = await page.evaluate(() =>
    (
      window as Window & {
        diagnosticMessages?: Array<Record<string, unknown>>;
      }
    ).diagnosticMessages?.find((message) => message.stage === "main_menu"),
  );
  expect(main).toMatchObject({
    stage: "main_menu",
    ownerFound: true,
    stableIdAttributeObserved: false,
    mainMenuControlResolved: true,
  });

  await page.locator("#download-row").hover();
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
  const menuOnlyEvidence = await page.evaluate(() => {
    const messages =
      (
        window as Window & {
          diagnosticMessages?: Array<Record<string, unknown>>;
        }
      ).diagnosticMessages ?? [];
    return {
      messages,
      trustedQualityClickObserved: messages.some(
        (message) => message.stage === "quality_action",
      ),
    };
  });
  expect(menuOnlyEvidence.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        stage: "main_menu",
        ownerFound: true,
        mainMenuControlResolved: true,
      }),
      expect.objectContaining({
        stage: "download_row",
        downloadRowRecognized: true,
        qualityMenuControlResolved: true,
        qualityOptionObserved: true,
        qualityOptionEnabled: true,
      }),
    ]),
  );
  expect(menuOnlyEvidence.trustedQualityClickObserved).toBe(false);
  expect(
    menuOnlyEvidence.messages.every((message) => !("association" in message)),
  ).toBe(true);
});

test("recognizes the live Download button when hover assigns the submenu binding", async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
  await page.setContent(`
    <style>
      flow-grid-tile-container, flow-video-tile { display: block; }
      [role="menu"] { display: block; padding: 8px; }
      #download-row, #quality-menu [role="menuitem"] { display: block; padding: 8px; }
    </style>
    <flow-grid-tile-container role="group">
      <flow-video-tile><button id="more" aria-label="More options">More</button></flow-video-tile>
    </flow-grid-tile-container>
  `);
  await page.evaluate((observerSource) => {
    const target = window as Window & {
      chrome?: { runtime?: { sendMessage?: (message: unknown) => void } };
      diagnosticMessages?: Array<Record<string, unknown>>;
    };
    target.diagnosticMessages = [];
    target.chrome = {
      runtime: {
        sendMessage: (message) => {
          target.diagnosticMessages!.push(message as Record<string, unknown>);
          return Promise.resolve(undefined);
        },
      },
    };
    const trigger = document.querySelector<HTMLButtonElement>("#more")!;
    trigger.addEventListener("click", () => {
      trigger.setAttribute("aria-controls", "live-main-menu");
      const mainMenu = document.createElement("div");
      mainMenu.id = "live-main-menu";
      mainMenu.setAttribute("role", "menu");
      mainMenu.innerHTML =
        '<button id="download-row" role="menuitem" aria-haspopup="menu" aria-expanded="false"><mat-icon aria-hidden="true">download</mat-icon><span class="label">Download</span></button>';
      document.body.append(mainMenu);
      const row = mainMenu.querySelector<HTMLButtonElement>("#download-row")!;
      row.addEventListener("pointerover", () => {
        window.setTimeout(() => {
          row.setAttribute("aria-expanded", "true");
          row.setAttribute("aria-controls", "live-quality-menu");
          const qualityMenu = document.createElement("div");
          qualityMenu.id = "live-quality-menu";
          qualityMenu.setAttribute("role", "menu");
          qualityMenu.innerHTML =
            '<button id="live-quality-option" role="menuitem" aria-disabled="false"><span id="live-quality-label">1080p Upscaled</span></button><button id="live-other-option" role="menuitem">Settings</button>';
          document.body.append(qualityMenu);
          qualityMenu
            .querySelector("#live-quality-option")
            ?.addEventListener("click", () => qualityMenu.remove());
        }, 50);
      }, { once: true });
    });
    const install = (0, eval)(`(${observerSource})`) as (
      sessionId: string,
    ) => unknown;
    install("33333333-3333-4333-8333-333333333333");
  }, installFlowGalleryDownloadObserver.toString());

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
  const beforeHover = await page.locator("#download-row").evaluate((row) => ({
    tag: row.localName,
    role: row.getAttribute("role"),
    hasAriaLabel: row.hasAttribute("aria-label"),
    ariaHaspopup: row.getAttribute("aria-haspopup"),
    textContent: row.textContent,
    iconAriaHidden: row.querySelector("mat-icon")?.getAttribute("aria-hidden"),
    labelText: row.querySelector("span.label")?.textContent,
    expanded: row.getAttribute("aria-expanded"),
    controls: row.getAttribute("aria-controls"),
  }));
  expect(beforeHover).toEqual({
    tag: "button",
    role: "menuitem",
    hasAriaLabel: false,
    ariaHaspopup: "menu",
    textContent: "downloadDownload",
    iconAriaHidden: "true",
    labelText: "Download",
    expanded: "false",
    controls: null,
  });

  await page.locator("#download-row").hover();
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
  await expect(page.locator("#live-quality-menu[role='menu']")).toBeVisible();
  const evidence = await page.evaluate(() => {
    const target = window as Window & {
      diagnosticMessages?: Array<Record<string, unknown>>;
    };
    const row = document.querySelector<HTMLButtonElement>("#download-row")!;
    const linkedMenu = document.querySelector("#live-quality-menu");
    const messages = target.diagnosticMessages ?? [];
    return {
      rowExpanded: row.getAttribute("aria-expanded"),
      rowControlsTargetCount: document.querySelectorAll(
        `#${row.getAttribute("aria-controls")}`,
      ).length,
      linkedMenuRole: linkedMenu?.getAttribute("role"),
      linkedMenuVisible: Boolean(
        linkedMenu && linkedMenu.getBoundingClientRect().height > 0,
      ),
      mainMenuEvidence: messages.find(
        (message) => message.stage === "main_menu",
      ),
      downloadRowEvidence: messages.find(
        (message) => message.stage === "download_row",
      ),
      qualityActionObserved: messages.some(
        (message) => message.stage === "quality_action",
      ),
      associationEvidence: messages.some((message) => "association" in message),
    };
  });
  expect(evidence.rowExpanded).toBe("true");
  expect(evidence.rowControlsTargetCount).toBe(1);
  expect(evidence.linkedMenuRole).toBe("menu");
  expect(evidence.linkedMenuVisible).toBe(true);
  expect(evidence.mainMenuEvidence).toMatchObject({
    ownerFound: true,
    mainMenuControlResolved: true,
  });
  expect(evidence.downloadRowEvidence).toMatchObject({
    downloadRowRecognized: true,
    qualityMenuControlResolved: true,
    qualityOptionObserved: true,
    qualityOptionEnabled: true,
  });
  expect(evidence.qualityActionObserved).toBe(false);
  expect(evidence.associationEvidence).toBe(false);

  await page.click("#live-other-option");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & {
            diagnosticMessages?: Array<Record<string, unknown>>;
          }
        ).diagnosticMessages?.some(
          (message) =>
            message.stage === "quality_click_rejected" &&
            message.reason === "quality_option_not_found",
        ),
      ),
    )
    .toBe(true);
  await page.click("#live-quality-label");
  await expect(page.locator("#live-quality-menu")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const messages =
          (
            window as Window & {
              diagnosticMessages?: Array<Record<string, unknown>>;
            }
          ).diagnosticMessages ?? [];
        return messages.some(
          (message) => message.stage === "quality_action_accepted_in_page",
        ) && messages.some((message) => message.stage === "quality_action");
      }),
    )
    .toBe(true);
  } finally {
    await browser.close();
  }
});
