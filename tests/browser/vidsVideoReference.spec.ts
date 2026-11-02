import { expect, test } from "@playwright/test";
import { inspectVidsAiComposerInPage } from "../../src/platforms/vids/composer";
import { uploadVidsReferenceInPage } from "../../src/platforms/vids/references";
import { sha256Bytes } from "../../src/domain/media/references";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOo1nX+DwAD/QHrf7yFWAAAAABJRU5ErkJggg==";
const bytes = Uint8Array.from(atob(pngBase64), (value) => value.charCodeAt(0));
const sha256 = await sha256Bytes(bytes);

test("production Vids file-input upload binds exact bytes and leaves prompt, settings, Generate and timeline untouched", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.setContent(`
    <input id="unrelated-file" type="file">
    <div role="textbox" aria-label="Document content" contenteditable="true">Canvas content stays.</div>
    <button id="generate" aria-label="Generate">Generate</button>
    <button id="upscale">Upscale</button>
    <button id="timeline">Insert in timeline</button>
    <aside role="complementary" aria-label="AI video clip">
      <button role="tab" aria-label="Animate" aria-selected="true">Animate</button>
      <section role="tabpanel" aria-label="Animate">
        <button aria-label="Add image">Add image</button>
        <input id="vids-file" type="file" accept="image/png, image/jpeg" style="display:none">
        <div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video.">Keep this exact prompt.</div>
      </section>
    </aside>
  `);
  await page.evaluate(() => {
    const panel = document.querySelector("[role=tabpanel]")!;
    const input = panel.querySelector<HTMLInputElement>("input[type=file]")!;
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const image = document.createElement("img");
      image.alt = "Uploaded image preview";
      image.style.width = "100px";
      image.style.height = "100px";
      image.src = URL.createObjectURL(file);
      const remove = document.createElement("button");
      remove.setAttribute("aria-label", "Remove image");
      remove.textContent = "Remove image";
      panel.append(image, remove);
    });
    for (const id of ["generate", "upscale", "timeline"]) document.getElementById(id)!.addEventListener("click", () => { (window as unknown as Record<string, number>)[`${id}Clicks`] = ((window as unknown as Record<string, number>)[`${id}Clicks`] ?? 0) + 1; });
  });
  const before = await page.evaluate(() => ({ prompt: document.querySelector("[aria-label='Add your image, then describe what should happen in your video.']")?.textContent, settings: [...document.querySelectorAll("[role=tab]")].map((tab) => tab.getAttribute("aria-selected")), canvas: document.querySelector("[aria-label='Document content']")?.textContent }));
  expect(await page.evaluate(inspectVidsAiComposerInPage)).toMatchObject({ state: "ready", fileInputCount: 1, previewCount: 0 });
  const result = await page.evaluate(uploadVidsReferenceInPage, { base64: pngBase64, mimeType: "image/png", byteSize: bytes.length, width: 1, height: 1, sha256, timeoutMs: 3000 });
  expect(result).toMatchObject({ ok: true, submitted: true, previewLoaded: true, previewWidth: 1, previewHeight: 1, removalControlPresent: true });
  const after = await page.evaluate(async () => {
    const file = document.querySelector<HTMLInputElement>("[role=tabpanel] input[type=file]")?.files?.[0];
    return {
      fileName: file?.name,
      mimeType: file?.type,
      fileBytes: file ? [...new Uint8Array(await file.arrayBuffer())] : [],
      prompt: document.querySelector("[aria-label='Add your image, then describe what should happen in your video.']")?.textContent,
      settings: [...document.querySelectorAll("[role=tab]")].map((tab) => tab.getAttribute("aria-selected")),
      canvas: document.querySelector("[aria-label='Document content']")?.textContent,
      otherFileCount: document.querySelectorAll("#unrelated-file").length,
      generationClicks: (window as unknown as Record<string, number>).generateClicks ?? 0,
      upscaleClicks: (window as unknown as Record<string, number>).upscaleClicks ?? 0,
      timelineClicks: (window as unknown as Record<string, number>).timelineClicks ?? 0,
    };
  });
  expect(after.fileBytes).toEqual([...bytes]);
  expect(after.mimeType).toBe("image/png");
  expect(after.prompt).toBe(before.prompt);
  expect(after.settings).toEqual(before.settings);
  expect(after.canvas).toBe(before.canvas);
  expect(after.otherFileCount).toBe(1);
  expect(after.generationClicks).toBe(0);
  expect(after.upscaleClicks).toBe(0);
  expect(after.timelineClicks).toBe(0);
  expect(await page.locator("[role=tabpanel] img[alt='Uploaded image preview']").count()).toBe(1);
  expect(await page.locator("[role=tabpanel] button[aria-label='Remove image']").count()).toBe(1);
  expect(await page.evaluate(async () => {
    const file = document.querySelector<HTMLInputElement>("[role=tabpanel] input[type=file]")?.files?.[0];
    return file ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map((value) => value.toString(16).padStart(2, "0")).join("") : "";
  })).toBe(sha256);
});

test("an existing unbound preview is left untouched", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.setContent(`<aside role="complementary" aria-label="AI video clip"><button role="tab" aria-label="Animate" aria-selected="true">Animate</button><section role="tabpanel" aria-label="Animate"><button aria-label="Add image">Add image</button><input type="file" accept="image/png, image/jpeg"><img alt="Uploaded image preview" width="10" height="10" src="data:image/png;base64,${pngBase64}"><button aria-label="Remove image">Remove image</button></section></aside>`);
  const result = await page.evaluate(uploadVidsReferenceInPage, { base64: pngBase64, mimeType: "image/png", byteSize: bytes.length, width: 1, height: 1, sha256, timeoutMs: 1000 });
  expect(result).toMatchObject({ ok: false, reason: "existing_preview_unbound" });
  expect(await page.locator("[role=tabpanel] img[alt='Uploaded image preview']").count()).toBe(1);
  expect(await page.locator("[role=tabpanel] button[aria-label='Remove image']").count()).toBe(1);
  expect(await page.locator("[role=tabpanel] input[type=file]").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
});

test("production upload waits for failures and rejects ambiguous preview state", async ({ page }) => {
  for (const mode of ["error", "ambiguous"] as const) {
    await page.goto("http://127.0.0.1:5173/");
    await page.setContent(`<aside role="complementary" aria-label="AI video clip"><button role="tab" aria-label="Animate" aria-selected="true">Animate</button><section role="tabpanel" aria-label="Animate"><button aria-label="Add image">Add image</button><input type="file" accept="image/png, image/jpeg"></section></aside>`);
    await page.evaluate(({ currentMode, encodedPng }) => {
      const panel = document.querySelector("[role=tabpanel]")!;
      const input = panel.querySelector<HTMLInputElement>("input[type=file]")!;
      input.addEventListener("change", () => setTimeout(() => {
        if (currentMode === "error") {
          const alert = document.createElement("div");
          alert.setAttribute("role", "alert");
          alert.textContent = "Upload failed";
          panel.append(alert);
          return;
        }
        for (let index = 0; index < 2; index++) {
          const image = document.createElement("img");
          image.alt = "Uploaded image preview";
          image.style.width = "10px";
          image.style.height = "10px";
          image.src = `data:image/png;base64,${encodedPng}`;
          panel.append(image);
        }
      }, 25));
    }, { currentMode: mode, encodedPng: pngBase64 });
    const result = await page.evaluate(uploadVidsReferenceInPage, { base64: pngBase64, mimeType: "image/png", byteSize: bytes.length, width: 1, height: 1, sha256, timeoutMs: 1000 });
    expect(result).toMatchObject({ ok: false, submitted: true, reason: mode === "error" ? "upload_error" : "preview_ambiguous" });
  }
});

test("production upload rejects unsupported MIME, wrong dimensions and oversized media before file selection", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.setContent(`<aside role="complementary" aria-label="AI video clip"><button role="tab" aria-label="Animate" aria-selected="true">Animate</button><section role="tabpanel" aria-label="Animate"><button aria-label="Add image">Add image</button><input type="file" accept="image/png, image/jpeg"></section></aside>`);
  const base = { base64: pngBase64, mimeType: "image/png" as const, byteSize: bytes.length, width: 1, height: 1, sha256, timeoutMs: 1000 };
  const wrongMime = await page.evaluate(uploadVidsReferenceInPage, { ...base, mimeType: "image/jpeg" as const });
  expect(wrongMime).toMatchObject({ ok: false, reason: "reference_format_invalid" });
  const wrongDimensions = await page.evaluate(uploadVidsReferenceInPage, { ...base, width: 2 });
  expect(wrongDimensions).toMatchObject({ ok: false, reason: "reference_dimensions_mismatch" });
  const oversized = await page.evaluate(uploadVidsReferenceInPage, { ...base, byteSize: 12 * 1024 * 1024 + 1 });
  expect(oversized).toMatchObject({ ok: false, reason: "image_input_contract_unsupported" });
  expect(await page.locator("[role=tabpanel] input[type=file]").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
  expect(await page.locator("[role=tabpanel] img").count()).toBe(0);
});
