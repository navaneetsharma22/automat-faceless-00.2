import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("image import is source-faithful and the cleaned dashboard fits review viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Images", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Validate a source to see its prompts here. Nothing is sent to Flow.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/SHOT-001|DEMO PROGRESS|PREVIEW MODE/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start image batch" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Start image batch", { exact: true }),
  ).toHaveCount(0);

  const screenshotDir = "artifacts/dashboard-cleanup";
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: `${screenshotDir}/desktop-empty.png`,
    fullPage: true,
  });

  const inputToolbar = page.locator("[class*=sourceToolbar]");
  await expect(
    inputToolbar.getByRole("button", { name: "Load saved batch" }),
  ).toBeVisible();
  await expect(
    inputToolbar.getByRole("button", { name: "Export saved source" }),
  ).toBeVisible();
  await expect(inputToolbar.getByLabel("Choose image JSON file")).toBeVisible();
  const sourceHelper = page.locator("#image-json-file-hint");
  await expect(sourceHelper).toBeVisible();
  expect(
    await sourceHelper.evaluate((element) =>
      element.closest('[class*="sourceToolbar"]'),
    ),
  ).toBeNull();
  const filePickerBounds = await inputToolbar
    .getByLabel("Choose image JSON file")
    .boundingBox();
  const loadButtonBounds = await inputToolbar
    .getByRole("button", { name: "Load saved batch" })
    .boundingBox();
  const exportButtonBounds = await inputToolbar
    .getByRole("button", { name: "Export saved source" })
    .boundingBox();
  expect(filePickerBounds).not.toBeNull();
  expect(loadButtonBounds).not.toBeNull();
  expect(exportButtonBounds).not.toBeNull();
  expect(
    Math.abs(
      filePickerBounds!.y +
        filePickerBounds!.height -
        (loadButtonBounds!.y + loadButtonBounds!.height),
    ),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(
      loadButtonBounds!.y +
        loadButtonBounds!.height -
        (exportButtonBounds!.y + exportButtonBounds!.height),
    ),
  ).toBeLessThanOrEqual(2);

  const rawSource = '{"shot_id":"7"}\n';
  const editor = page.locator("#image-import-source");
  await editor.fill(rawSource);
  await page.getByRole("button", { name: "Wrap lines" }).click();
  await expect(editor).toHaveAttribute("wrap", "soft");
  await expect(editor).toHaveValue(rawSource);
  await page.getByRole("button", { name: "Expand editor" }).click();
  const dialog = page.getByRole("dialog", { name: "Image prompt source" });
  const expandedEditor = dialog.locator("textarea");
  await expect(expandedEditor).toHaveValue(rawSource);
  await expandedEditor.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(editor).toHaveValue(rawSource);

  await page.getByRole("button", { name: "Validate & Preview" }).click();
  await expect(
    page.getByText("Validated preview. Nothing has been sent to a provider."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "1 validated prompt" }),
  ).toBeVisible();
  await expect(page.getByText("7").last()).toBeVisible();
  await expect(page.getByText("Not sent to Flow")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save validated batch" }),
  ).toBeEnabled();
  await expect(page.locator('details[class*="legacyTools"][open]')).toHaveCount(
    0,
  );
  await expect(page.locator("[class*=technicalDetails][open]")).toHaveCount(0);

  const legacyTools = page.locator('details[class*="legacyTools"]');
  await legacyTools.locator("summary").click();
  const variantInput = page.locator("#image-variant-count");
  await expect(variantInput).toBeVisible();
  const countMode = page.locator("#flow-count-mode");
  await countMode.selectOption("existing_project");
  const startingCount = page.locator("#flow-starting-image-count");
  await expect(startingCount).toBeVisible();
  const sharedControlStyles = await Promise.all(
    [variantInput, countMode, startingCount].map((control) =>
      control.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          minHeight: style.minHeight,
          padding: style.padding,
          borderRadius: style.borderRadius,
        };
      }),
    ),
  );
  expect(sharedControlStyles[1]).toEqual(sharedControlStyles[0]);
  expect(sharedControlStyles[2]).toEqual(sharedControlStyles[0]);
  await legacyTools.locator("summary").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(variantInput).toBeFocused();
  expect(
    await variantInput.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    ),
  ).toBe("solid");
  await legacyTools.locator("summary").click();

  const dismissSuccess = page.getByRole("button", {
    name: "Dismiss success notification",
  });
  if (await dismissSuccess.count()) {
    await dismissSuccess.click();
    await expect(page.locator('[data-toast-kind="success"]')).toHaveCount(0);
  }
  await page.screenshot({
    path: `${screenshotDir}/desktop-light.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.screenshot({
    path: `${screenshotDir}/desktop-dark.png`,
    fullPage: true,
  });

  await page.setViewportSize({ width: 1280, height: 520 });
  const sidebar = page.locator('[class*="sidebar"]');
  const sidebarMetrics = await sidebar.evaluate((element) => ({
    height: (element as HTMLElement).clientHeight,
    scrollHeight: (element as HTMLElement).scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(sidebarMetrics.overflowY).toBe("auto");
  expect(sidebarMetrics.scrollHeight).toBeGreaterThan(sidebarMetrics.height);
  await page.locator("#selected-vids-tab").focus();
  const vidsBounds = await page.locator("#selected-vids-tab").boundingBox();
  const sidebarBounds = await sidebar.boundingBox();
  expect(vidsBounds).not.toBeNull();
  expect(sidebarBounds).not.toBeNull();
  expect(vidsBounds!.y).toBeGreaterThanOrEqual(sidebarBounds!.y);
  expect(vidsBounds!.y + vidsBounds!.height).toBeLessThanOrEqual(
    sidebarBounds!.y + sidebarBounds!.height,
  );
  await page.screenshot({ path: `${screenshotDir}/short-laptop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWidths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(mobileWidths.page).toBeLessThanOrEqual(mobileWidths.viewport);
  const mobileToolbarButtons = await inputToolbar
    .locator("[class*=sourceToolbarButtons] button:visible")
    .all();
  const mobileButtonBounds = await Promise.all(
    mobileToolbarButtons.map((button) => button.boundingBox()),
  );
  expect(mobileButtonBounds).toHaveLength(2);
  expect(mobileButtonBounds[0]).not.toBeNull();
  expect(mobileButtonBounds[1]).not.toBeNull();
  expect(mobileButtonBounds[0]!.y).toBe(mobileButtonBounds[1]!.y);
  await page.screenshot({
    path: `${screenshotDir}/narrow-mobile.png`,
    fullPage: true,
  });
});
