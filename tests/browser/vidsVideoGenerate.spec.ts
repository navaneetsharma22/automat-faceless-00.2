import { expect, test } from "@playwright/test";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { sha256Bytes } from "../../src/domain/media/references";
import { enterVidsPromptInPage, activateVidsGenerateInPage } from "../../src/platforms/vids/video";
import { uploadVidsReferenceInPage } from "../../src/platforms/vids/references";

const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg=="), (value) => value.charCodeAt(0));
const prompt = JSON.stringify({ shot_id: "1", prompt_type: "video", instructions: "Create a slow cinematic volcano reveal.", sequence: ["First line", "Second line\nwith an explicit newline"], camera: { move: "slow push in" } }, null, 2);

async function installVidsPanel(page: import("@playwright/test").Page, editorText = "") {
  await page.goto("http://127.0.0.1:5173/");
  await page.setContent(`<aside role="complementary" aria-label="AI video clip">
    <button role="tab" aria-label="Animate" aria-selected="true">Animate</button>
    <section role="tabpanel" aria-label="Animate">
      <input type="file" accept="image/png, image/jpeg">
      <img alt="Uploaded image preview" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg==">
      <button aria-label="Remove image">Remove</button>
      <div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video."></div>
      <button aria-label="Generate">Generate</button>
    </section>
  </aside>`);
  await page.locator("input[type=file]").setInputFiles({ name: "saved-reference.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await page.evaluate(() => {
    Object.assign(window, { vidsFixture: { generateClicks: 0, settingsClicks: 0, otherClicks: 0 } });
    document.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const state = (window as unknown as { vidsFixture: { generateClicks: number; settingsClicks: number; otherClicks: number } }).vidsFixture;
      if (target?.closest("button[aria-label='Generate']")) state.generateClicks += 1;
      else state.otherClicks += 1;
    });
  });
  if (editorText) await page.locator("[role=textbox]").evaluate((editor, text) => { editor.textContent = text; }, editorText);
}

async function runEntry(page: import("@playwright/test").Page) {
  const promptSha256 = await sha256Hex(prompt);
  const referenceSha256 = await sha256Bytes(png);
  return await page.evaluate(enterVidsPromptInPage, {
    prompt, expectedSha256: promptSha256, referenceSha256, referenceMimeType: "image/png", referenceByteSize: png.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 2500,
  });
}

test("P10.2 production Vids injection preserves multiline JSON, exact readback, and one Generate click", async ({ page }) => {
  await installVidsPanel(page);
  const result = await runEntry(page);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, promptState: "empty", expectedSha256: await sha256Hex(prompt), actualSha256: await sha256Hex(prompt), immediateMatch: true, settledMatch: true, stableReads: 3, generateCount: 1, generateDisabled: false });
  expect(await page.locator("[role=textbox]").evaluate((editor) => (editor as HTMLElement).innerText)).toContain("\n");
  expect(await page.locator("[role=textbox]").evaluate((editor) => (editor as HTMLElement).textContent)).not.toBe(prompt);
  expect(await page.evaluate(() => (window as unknown as { vidsFixture: { generateClicks: number } }).vidsFixture.generateClicks)).toBe(0);
  const activated = await page.evaluate(activateVidsGenerateInPage, {
    prompt, promptSha256: await sha256Hex(prompt), referenceSha256: await sha256Bytes(png), referenceMimeType: "image/png", referenceByteSize: png.length, referenceWidth: 1, referenceHeight: 1,
  });
  expect(activated).toMatchObject({ ok: true, activationAttempted: true, activationCount: 1 });
  expect(await page.evaluate(() => (window as unknown as { vidsFixture: { generateClicks: number; otherClicks: number } }).vidsFixture)).toMatchObject({ generateClicks: 1, otherClicks: 0 });
});

test("already exact prompt is accepted without rewriting; conflicting editor text is preserved", async ({ page }) => {
  await installVidsPanel(page, prompt);
  const exact = await runEntry(page);
  expect(exact).toMatchObject({ ok: true, promptState: "already_exact", immediateMatch: true, settledMatch: true });
  await installVidsPanel(page, "keep my text");
  const conflict = await runEntry(page);
  expect(conflict).toMatchObject({ ok: false, reason: "prompt_editor_contains_conflicting_text", promptState: "conflict" });
  expect(await page.locator("[role=textbox]").evaluate((editor) => (editor as HTMLElement).textContent)).toBe("keep my text");
  expect(await page.evaluate(() => (window as unknown as { vidsFixture: { generateClicks: number } }).vidsFixture.generateClicks)).toBe(0);
});

test("missing or changed reference identity and disabled Generate never activate", async ({ page }) => {
  await installVidsPanel(page);
  await page.locator("input[type=file]").evaluate((input) => { Object.defineProperty(input, "files", { configurable: true, value: [] }); });
  expect(await runEntry(page)).toMatchObject({ ok: false, reason: "reference_preview_blob_unavailable" });
  expect(await page.evaluate(() => (window as unknown as { vidsFixture: { generateClicks: number } }).vidsFixture.generateClicks)).toBe(0);

  await installVidsPanel(page);
  await runEntry(page);
  expect(await page.evaluate(activateVidsGenerateInPage, {
    prompt, promptSha256: await sha256Hex(prompt), referenceSha256: "0".repeat(64), referenceMimeType: "image/png", referenceByteSize: png.length, referenceWidth: 1, referenceHeight: 1,
  })).toMatchObject({ ok: false, reason: "reference_identity_mismatch", activationCount: 0 });
  expect(await page.evaluate(() => (window as unknown as { vidsFixture: { generateClicks: number } }).vidsFixture.generateClicks)).toBe(0);

  await installVidsPanel(page);
  await runEntry(page);
  await page.locator("button[aria-label=Generate]").evaluate((button) => button.insertAdjacentHTML("afterend", '<button aria-label="Generate">Generate duplicate</button>'));
  expect(await page.evaluate(activateVidsGenerateInPage, {
    prompt, promptSha256: await sha256Hex(prompt), referenceSha256: await sha256Bytes(png), referenceMimeType: "image/png", referenceByteSize: png.length, referenceWidth: 1, referenceHeight: 1,
  })).toMatchObject({ ok: false, reason: "generate_control_ambiguous", activationCount: 0 });
  expect(await page.evaluate(() => (window as unknown as { vidsFixture: { generateClicks: number } }).vidsFixture.generateClicks)).toBe(0);

  await installVidsPanel(page);
  await runEntry(page);
  await page.locator("button[aria-label=Generate]").evaluate((button) => { (button as HTMLButtonElement).disabled = true; });
  expect(await page.evaluate(activateVidsGenerateInPage, {
    prompt, promptSha256: await sha256Hex(prompt), referenceSha256: await sha256Bytes(png), referenceMimeType: "image/png", referenceByteSize: png.length, referenceWidth: 1, referenceHeight: 1,
  })).toMatchObject({ ok: false, reason: "generate_disabled", activationCount: 0 });
  expect(await page.evaluate(() => (window as unknown as { vidsFixture: { generateClicks: number } }).vidsFixture.generateClicks)).toBe(0);
});

test("entry and activation report missing selected bytes distinctly and do not click Generate", async ({ page }) => {
  await installVidsPanel(page);
  await page.locator("input[type=file]").evaluate((input) => { Object.defineProperty(input, "files", { configurable: true, value: [] }); });
  expect(await runEntry(page)).toMatchObject({ ok: false, reason: "reference_preview_blob_unavailable" });
  const result = await page.evaluate(activateVidsGenerateInPage, {
    prompt, promptSha256: await sha256Hex(prompt), referenceSha256: await sha256Bytes(png), referenceMimeType: "image/png", referenceByteSize: png.length, referenceWidth: 1, referenceHeight: 1,
  });
  expect(result).toMatchObject({ ok: false, reason: "reference_preview_blob_unavailable", activationAttempted: false, activationCount: 0 });
  expect(await page.evaluate(() => (window as unknown as { vidsFixture: { generateClicks: number } }).vidsFixture.generateClicks)).toBe(0);
});

test("file-read failure is distinct from missing selection and stays before Generate", async ({ page }) => {
  await installVidsPanel(page);
  await page.locator("input[type=file]").evaluate((input) => {
    const file = (input as HTMLInputElement).files![0]!;
    Object.defineProperty(file, "arrayBuffer", { configurable: true, value: () => Promise.reject(new Error("fixture read failure")) });
  });
  expect(await runEntry(page)).toMatchObject({ ok: false, reason: "reference_file_read_failed" });
  const activation = await page.evaluate(activateVidsGenerateInPage, {
    prompt, promptSha256: await sha256Hex(prompt), referenceSha256: await sha256Bytes(png), referenceMimeType: "image/png", referenceByteSize: png.length, referenceWidth: 1, referenceHeight: 1,
  });
  expect(activation).toMatchObject({ ok: false, reason: "reference_file_read_failed", activationAttempted: false, activationCount: 0 });
  expect(await page.evaluate(() => (window as unknown as { vidsFixture: { generateClicks: number } }).vidsFixture.generateClicks)).toBe(0);
});

test("P10.1 upload remains provable after provider removes input using exact current blob bytes", async ({ page }) => {
  const uploadBytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOo1nX+DwAD/QHrf7yFWAAAAABJRU5ErkJggg=="), (value) => value.charCodeAt(0));
  await page.goto("http://127.0.0.1:5173/");
  await page.setContent(`<aside role="complementary" aria-label="AI video clip">
    <button role="tab" aria-label="Animate" aria-selected="true">Animate</button>
    <section role="tabpanel" aria-label="Animate">
      <button aria-label="Add image">Add image</button><input type="file" accept="image/png, image/jpeg">
      <div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video."></div>
      <button aria-label="Generate">Generate</button>
    </section></aside>`);
  await page.evaluate(() => {
    const panel = document.querySelector("[role=tabpanel]")!;
    const input = panel.querySelector("input[type=file]")!;
    input.addEventListener("change", () => {
      const file = (input as HTMLInputElement).files![0]!;
      const preview = document.createElement("img");
      preview.alt = "Uploaded image preview";
      preview.src = URL.createObjectURL(file);
      const remove = document.createElement("button");
      remove.setAttribute("aria-label", "Remove image");
      panel.append(preview, remove);
      panel.querySelector("button[aria-label='Add image']")?.remove();
      input.remove();
    });
    Object.assign(window, { vidsFixture: { generateClicks: 0 } });
    panel.querySelector("button[aria-label='Generate']")!.addEventListener("click", () => {
      (window as unknown as { vidsFixture: { generateClicks: number } }).vidsFixture.generateClicks += 1;
    });
  });
  const base64 = Buffer.from(uploadBytes).toString("base64");
  const upload = await page.evaluate(uploadVidsReferenceInPage, {
    base64, mimeType: "image/png", byteSize: uploadBytes.length, width: 1, height: 1, sha256: await sha256Bytes(uploadBytes), timeoutMs: 2500,
  });
  expect(upload, JSON.stringify(upload)).toMatchObject({ ok: true, submitted: true, previewLoaded: true, previewWidth: 1, previewHeight: 1, removalControlPresent: true });
  expect(await page.locator("input[type=file]").count()).toBe(0);
  expect(await page.locator("button[aria-label='Add image']").count()).toBe(0);
  expect(await page.locator("img[alt='Uploaded image preview']").getAttribute("src")).toMatch(/^blob:/);

  const entry = await page.evaluate(enterVidsPromptInPage, {
    prompt, expectedSha256: await sha256Hex(prompt), referenceSha256: await sha256Bytes(uploadBytes), referenceMimeType: "image/png", referenceByteSize: uploadBytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 2500,
  });
  expect(entry).toMatchObject({ ok: true, referenceSha256: await sha256Bytes(uploadBytes), referenceProofSource: "preview_blob_sha256" });
  const activation = await page.evaluate(activateVidsGenerateInPage, {
    prompt, promptSha256: await sha256Hex(prompt), referenceSha256: await sha256Bytes(uploadBytes), referenceMimeType: "image/png", referenceByteSize: uploadBytes.length, referenceWidth: 1, referenceHeight: 1,
  });
  expect(activation).toMatchObject({ ok: true, activationAttempted: true, activationCount: 1, referenceProofSource: "preview_blob_sha256" });
  expect(await page.evaluate(() => (window as unknown as { vidsFixture: { generateClicks: number } }).vidsFixture.generateClicks)).toBe(1);
});

test("same-size same-dimension transformed preview bytes fail exact reference proof", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.setContent(`<aside role="complementary" aria-label="AI video clip"><button role="tab" aria-label="Animate" aria-selected="true">Animate</button><section role="tabpanel" aria-label="Animate"><img alt="Uploaded image preview"><button aria-label="Remove image">Remove</button><div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video."></div><button aria-label="Generate">Generate</button></section></aside>`);
  const transformed = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOo1nX+DwAD/QHrf7yFWAAAAABJRU5ErkJggg=="), (value) => value.charCodeAt(0));
  await page.locator("img[alt='Uploaded image preview']").evaluate((image, encoded) => { (image as HTMLImageElement).src = URL.createObjectURL(new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type: "image/png" })); }, Buffer.from(transformed).toString("base64"));
  await page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>("img[alt='Uploaded image preview']"); return !!image?.complete && image.naturalWidth === 1 && image.naturalHeight === 1; });
  const result = await runEntry(page);
  expect(result).toMatchObject({ ok: false, reason: "reference_identity_mismatch" });
});

test("final activation uses the same scoped accessible-name resolution as prompt entry", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.setContent(`<aside role="complementary" aria-labelledby="sidebar-name">
    <h2 id="sidebar-name">AI video clip</h2>
    <button role="tab" aria-selected="true" aria-labelledby="animate-tab-name"><span id="animate-tab-name">Animate</span></button>
    <section role="tabpanel" aria-labelledby="animate-panel-name">
      <h3 id="animate-panel-name">Animate</h3><input type="file" accept="image/png, image/jpeg">
      <img alt="Uploaded image preview" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOo1nX+DwAD/QHrf7yFWAAAAABJRU5ErkJggg==">
      <button aria-label="Remove image">Remove</button>
      <div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video."></div>
      <button aria-label="Generate">Generate</button>
    </section></aside>`);
  await page.locator("input[type=file]").setInputFiles({ name: "saved-reference.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await page.locator("[role=textbox]").evaluate((editor, text) => { editor.textContent = text; }, prompt);
  const entry = await runEntry(page);
  expect(entry).toMatchObject({ ok: true, promptState: "already_exact", settledMatch: true });
  const activation = await page.evaluate(activateVidsGenerateInPage, {
    prompt, promptSha256: await sha256Hex(prompt), referenceSha256: await sha256Bytes(png), referenceMimeType: "image/png", referenceByteSize: png.length, referenceWidth: 1, referenceHeight: 1,
  });
  expect(activation).toMatchObject({ ok: true, activationAttempted: true, activationCount: 1 });
});

test("activation still rejects a sidebar outside the exact Vids accessible name", async ({ page }) => {
  await installVidsPanel(page);
  await page.locator("[role=complementary]").evaluate((sidebar) => sidebar.setAttribute("aria-label", "Other tool"));
  expect(await page.evaluate(activateVidsGenerateInPage, {
    prompt, promptSha256: await sha256Hex(prompt), referenceSha256: await sha256Bytes(png), referenceMimeType: "image/png", referenceByteSize: png.length, referenceWidth: 1, referenceHeight: 1,
  })).toMatchObject({ ok: false, reason: "ai_sidebar_missing", activationAttempted: false, activationCount: 0 });
});
