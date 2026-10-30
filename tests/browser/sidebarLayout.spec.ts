import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("sidebar controls remain scrollable at short and narrow viewport sizes", async ({
  page,
}) => {
  const stylesheet = await readFile(
    resolve(process.cwd(), "src/app/Dashboard.module.css"),
    "utf8",
  );
  const globalStyles = await readFile(
    resolve(process.cwd(), "src/app/styles/globals.css"),
    "utf8",
  );
  await page.setViewportSize({ width: 1280, height: 470 });
  await page.setContent(`<!doctype html>
    <style>
      :root {
        --color-page:#f7f7f8; --color-text:#17202a; --color-text-muted:#59636e;
        --color-border:#c7cdd3; --color-border-strong:#89939d;
        --color-surface:#fff; --color-surface-raised:#f0f2f4;
        --color-accent:#315fdb; --color-on-accent:#fff; --color-error:#a42323;
        --color-error-surface:#fff0f0; --space-1:4px; --space-2:8px;
        --space-3:12px; --space-4:16px; --space-6:24px;
        --font-size-xs:12px; --font-size-sm:14px; --font-size-lg:20px;
        --line-height-relaxed:1.5; --line-height-tight:1.2;
        --radius-control:8px; --radius-card:12px; --control-height-compact:36px;
        --layout-gutter:16px; --layer-sticky:2; --shadow-card:0 1px 5px #0002;
      }
      ${globalStyles}
      ${globalStyles}
      ${stylesheet}
      body { margin:0; }
      .fixturePage { min-height:1400px; padding:24px; }
    </style>
    <div class="appShell">
      <aside class="sidebar" aria-label="Workspace and provider controls">
        <a class="brand" href="#workspace"><span class="brandMark">A</span><span><strong>Automat</strong><small>FACELESS STUDIO</small></span></a>
        <p class="navLabel">WORKSPACE</p>
        <nav class="navigation" aria-label="Workspace">
          <button class="navItem">Images</button><button class="navItem">Video</button>
          <button class="navItem">Downloads</button><button class="navItem">Settings</button>
        </nav>
        <section class="connection" aria-label="Connections">
          <h2>Connections</h2>
          <button class="connectionListButton">Find open projects</button>
          <section class="providerConnection">
            <div class="providerConnectionTitle"><strong>Flow</strong><span>Outdated connector</span></div>
            <label class="connectionLabel" for="flow-select">Selected Flow project</label>
            <select class="connectionSelect" id="flow-select"><option>Project A</option></select>
            <div class="connectionActions"><button>Connect</button><button>Disconnect</button></div>
            <p class="connectionError">connection_saved_binding_build_mismatch_and_a_long_diagnostic_suffix_that_must_wrap_without_widening_the_sidebar</p>
          </section>
          <section class="providerConnection">
            <div class="providerConnectionTitle"><strong>Vids</strong><span>Outdated connector</span></div>
            <label class="connectionLabel" for="vids-select">Selected Vids project</label>
            <select class="connectionSelect" id="vids-select"><option>Project B</option></select>
            <div class="connectionActions"><button id="vids-connect">Connect</button><button id="vids-disconnect">Disconnect</button></div>
            <p class="connectionError">connection_saved_binding_build_mismatch</p>
            <button id="last-control">Last provider control</button>
          </section>
        </section>
      </aside>
      <section class="mainArea" id="workspace"><header class="topbar">Studio</header><main class="fixturePage">Main content stays page-scrollable.</main></section>
    </div>`);

  const desktop = await page.locator(".sidebar").evaluate((sidebar) => {
    const element = sidebar as HTMLElement;
    return {
      height: element.clientHeight,
      viewportHeight: window.innerHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });
  expect(desktop.overflowY).toBe("auto");
  expect(desktop.height).toBe(desktop.viewportHeight);
  expect(desktop.scrollHeight).toBeGreaterThan(desktop.height);
  expect(desktop.scrollWidth).toBeLessThanOrEqual(desktop.clientWidth);
  await page.locator(".sidebar").evaluate((sidebar) => {
    (sidebar as HTMLElement).scrollTo(0, (sidebar as HTMLElement).scrollHeight);
  });
  await page.locator("#last-control").focus();
  const lastControl = await page.locator("#last-control").boundingBox();
  const sidebarBox = await page.locator(".sidebar").boundingBox();
  expect(lastControl).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(lastControl!.y + lastControl!.height).toBeLessThanOrEqual(
    sidebarBox!.y + sidebarBox!.height,
  );
  expect(lastControl!.y).toBeGreaterThanOrEqual(sidebarBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.evaluate(() => window.scrollTo(0, 220));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await page.setViewportSize({ width: 420, height: 430 });
  const narrow = await page.locator(".sidebar").evaluate((sidebar) => ({
    overflowY: getComputedStyle(sidebar).overflowY,
    height: (sidebar as HTMLElement).clientHeight,
    scrollHeight: (sidebar as HTMLElement).scrollHeight,
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: document.documentElement.clientHeight,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(narrow.overflowY).toBe("visible");
  expect(narrow.documentWidth).toBeLessThanOrEqual(narrow.viewportWidth);
  expect(narrow.documentHeight).toBeGreaterThan(narrow.viewportHeight);
  await page.locator("#vids-disconnect").focus();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(
    "vids-disconnect",
  );
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const focusedControl = await page.locator("#vids-disconnect").boundingBox();
  expect(focusedControl).not.toBeNull();
  expect(focusedControl!.y).toBeGreaterThanOrEqual(0);
  expect(focusedControl!.y + focusedControl!.height).toBeLessThanOrEqual(430);
});
