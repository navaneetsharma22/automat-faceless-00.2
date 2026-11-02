import { expect, test } from "@playwright/test";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { sha256Bytes } from "../../src/domain/media/references";
import { enterVidsPromptInPage, activateVidsGenerateInPage } from "../../src/platforms/vids/video";

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
  expect(await runEntry(page)).toMatchObject({ ok: false, reason: "reference_identity_proof_unavailable" });
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
