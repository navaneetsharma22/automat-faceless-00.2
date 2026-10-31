/* global console, document, getComputedStyle, process */
import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

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

async function main() {
  const root = process.cwd();
  const tokens = await readFile(
    resolve(root, "src/app/styles/tokens.css"),
    "utf8",
  );
  const globals = await readFile(
    resolve(root, "src/app/styles/globals.css"),
    "utf8",
  );
  const dashboardCss = await readFile(
    resolve(root, "src/app/Dashboard.module.css"),
    "utf8",
  );

  const artifactsDir = resolve(root, "artifacts/scrollbar-visual");
  await mkdir(artifactsDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: installedChromium,
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--disable-features=OverlayScrollbar"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  const generateHtml = (theme) => `<!doctype html>
<html data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <style>
    ${tokens}
    ${globals}
    ${dashboardCss}
    body { margin: 0; }
    .dummyLongContent { min-height: 1800px; flex-shrink: 0; padding: 16px; }
  </style>
</head>
<body>
  <div class="appShell appShellImages">
    <aside class="sidebar">
      <div style="font-weight: bold; margin-bottom: 1rem;">Sidebar Navigation</div>
      <div class="dummyLongContent">
        <p>Sidebar scrollable content item 1</p>
        <p>Sidebar scrollable content item 2</p>
        <p>Sidebar scrollable content item 3</p>
        <p>Sidebar scrollable content item 4</p>
        <p>Sidebar scrollable content item 5</p>
        <p>Sidebar scrollable content item 6</p>
        <p>Sidebar scrollable content item 7</p>
        <p>Sidebar scrollable content item 8</p>
        <p>Sidebar scrollable content item 9</p>
        <p>Sidebar scrollable content item 10</p>
      </div>
    </aside>
    <section class="mainArea mainAreaImages">
      <header class="topbar">
        <span>Studio / Images (${theme} theme)</span>
      </header>
      <div class="content contentImages">
        <div class="pageHeading">
          <div>
            <p class="kicker">CREATIVE WORKSPACE</p>
            <h1>Images</h1>
            <p class="lede">Timed prompt submission mode</p>
          </div>
        </div>
        <div class="imagesWorkspaceShell">
          <div class="workspaceGrid">
            <section class="panel editorPanel" tabindex="0">
              <h2>Left Import Panel</h2>
              <div class="dummyLongContent">
                <p>Import prompt text and JSON editor content...</p>
                <p>Line 10</p>
                <p>Line 20</p>
                <p>Line 30</p>
                <p>Line 40</p>
                <p>Line 50</p>
              </div>
            </section>
            <div class="workspaceSideColumn" tabindex="0">
              <h2>Right Queue Column</h2>
              <div class="dummyLongContent">
                <p>Queue item cards and batch history...</p>
                <p>Batch 1</p>
                <p>Batch 2</p>
                <p>Batch 3</p>
                <p>Batch 4</p>
                <p>Batch 5</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</body>
</html>`;

  // 1. Light theme
  await page.setContent(generateHtml("light"));
  const lightStyles = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar");
    const editor = document.querySelector(".editorPanel");
    const queue = document.querySelector(".workspaceSideColumn");
    return {
      sidebar: {
        width: getComputedStyle(sidebar).scrollbarWidth,
        color: getComputedStyle(sidebar).scrollbarColor,
        clientHeight: sidebar.clientHeight,
        scrollHeight: sidebar.scrollHeight,
        overflowY: getComputedStyle(sidebar).overflowY,
      },
      editor: {
        width: getComputedStyle(editor).scrollbarWidth,
        color: getComputedStyle(editor).scrollbarColor,
        clientHeight: editor.clientHeight,
        scrollHeight: editor.scrollHeight,
        overflowY: getComputedStyle(editor).overflowY,
      },
      queue: {
        width: getComputedStyle(queue).scrollbarWidth,
        color: getComputedStyle(queue).scrollbarColor,
        clientHeight: queue.clientHeight,
        scrollHeight: queue.scrollHeight,
        overflowY: getComputedStyle(queue).overflowY,
      },
    };
  });
  console.log(
    "Light theme element metrics:",
    JSON.stringify(lightStyles, null, 2),
  );
  await page.screenshot({
    path: join(artifactsDir, "light-theme-scrollbars.png"),
    fullPage: false,
  });

  // 2. Dark theme
  await page.setContent(generateHtml("dark"));
  const darkStyles = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar");
    const editor = document.querySelector(".editorPanel");
    const queue = document.querySelector(".workspaceSideColumn");
    return {
      sidebarScrollbarWidth: getComputedStyle(sidebar).scrollbarWidth,
      sidebarScrollbarColor: getComputedStyle(sidebar).scrollbarColor,
      editorScrollbarWidth: getComputedStyle(editor).scrollbarWidth,
      editorScrollbarColor: getComputedStyle(editor).scrollbarColor,
      queueScrollbarWidth: getComputedStyle(queue).scrollbarWidth,
      queueScrollbarColor: getComputedStyle(queue).scrollbarColor,
    };
  });
  console.log(
    "Dark theme computed scrollbar styles:",
    JSON.stringify(darkStyles, null, 2),
  );
  await page.screenshot({
    path: join(artifactsDir, "dark-theme-scrollbars.png"),
    fullPage: false,
  });

  await browser.close();
  console.log(
    "Visual inspection screenshots captured successfully in:",
    artifactsDir,
  );
}

main().catch((err) => {
  console.error("Error running visual inspection:", err);
  process.exit(1);
});
