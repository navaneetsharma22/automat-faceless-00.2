import { expect, test } from "@playwright/test";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { sha256Bytes } from "../../src/domain/media/references";
import { activateVidsGenerateInPage, enterVidsPromptInPage, transitionVidsComposerFromPreviousInPage } from "../../src/platforms/vids/video";

const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg=="), (value) => value.charCodeAt(0));
const previousPrompt = JSON.stringify({ shot_id: "1", prompt_type: "video", lines: ["first", "second"] }, null, 2);

async function install(page: import("@playwright/test").Page, collapsed = false) {
  await page.goto("http://127.0.0.1:5173/");
  await page.setContent(`<aside role="complementary" aria-labelledby="ai-name"><span id="ai-name">AI video clip</span><button role="tab" aria-labelledby="animate-name" aria-selected="true"><span id="animate-name">Animate</span></button><section role="tabpanel" aria-label="Animate" style="${collapsed ? "display:none" : ""}"><input type="file"><img alt="Uploaded image preview" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg=="><button aria-label="Remove image">Remove</button><div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video."></div><button aria-label="Generate">Generate</button></section></aside>`);
  await page.locator("input[type=file]").setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from(bytes) });
  await page.locator("[role=textbox]").evaluate((node, text) => { node.textContent = text; }, previousPrompt);
  await page.evaluate(() => { Object.assign(window, { queueFixture: { removeClicks: 0, generateClicks: 0, unrelatedClicks: 0 } }); document.addEventListener("click", (event) => { const button = (event.target as Element | null)?.closest("button"); if (!button) return; const fixture = (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture; if (button.matches("[aria-label='Remove image']")) { fixture.removeClicks += 1; button.remove(); document.querySelector("img[alt='Uploaded image preview']")?.remove(); } else if (button.matches("[aria-label='Generate']")) fixture.generateClicks += 1; else fixture.unrelatedClicks += 1; }); });
}

test("production transition removes only exact previous content, then leaves the composer empty", async ({ page }) => {
  await install(page);
  const result = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500 });
  expect(result).toMatchObject({ ok: true, changed: true });
  expect(await page.locator("[role=textbox]").evaluate((node) => node.textContent)).toBe("");
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture)).toEqual({ removeClicks: 1, generateClicks: 0, unrelatedClicks: 0 });
});

test("a distinct second reference and long multiline prompt pass the production preflight and one-shot path", async ({ page }) => {
  await install(page);
  const transitioned = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500 });
  expect(transitioned.ok).toBe(true);
  const secondBytes = Uint8Array.from(bytes); secondBytes[secondBytes.length - 1] ^= 1;
  const secondPrompt = JSON.stringify({ shot_id: "2", prompt_type: "video", direction: "A second exact shot", camera: { movement: "slow push-in", sequence: ["start", "middle\nwith line break", "end"] }, payload: "z".repeat(2500) }, null, 2);
  await page.locator("input[type=file]").setInputFiles({ name: "shot-2.png", mimeType: "image/png", buffer: Buffer.from(secondBytes) });
  await page.locator("[role=tabpanel]").evaluate((panel) => panel.insertAdjacentHTML("afterbegin", '<img alt="Uploaded image preview" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg=="><button aria-label="Remove image">Remove</button>'));
  const secondSha = await sha256Hex(secondPrompt);
  const entry = await page.evaluate(enterVidsPromptInPage, { prompt: secondPrompt, expectedSha256: secondSha, referenceSha256: await sha256Bytes(secondBytes), referenceMimeType: "image/png", referenceByteSize: secondBytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500 });
  expect(entry).toMatchObject({ ok: true, immediateMatch: true, settledMatch: true, stableReads: 3, referenceSha256: await sha256Bytes(secondBytes) });
  expect(await page.evaluate(activateVidsGenerateInPage, { prompt: secondPrompt, promptSha256: secondSha, referenceSha256: await sha256Bytes(secondBytes), referenceMimeType: "image/png", referenceByteSize: secondBytes.length, referenceWidth: 1, referenceHeight: 1 })).toMatchObject({ ok: true, activationCount: 1 });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { generateClicks: number; removeClicks: number; unrelatedClicks: number } }).queueFixture)).toMatchObject({ generateClicks: 1, removeClicks: 1, unrelatedClicks: 0 });
});

test("conflicting text, wrong bytes, and collapsed composer are preserved without clicks", async ({ page }) => {
  await install(page);
  await page.locator("[role=textbox]").evaluate((node) => { node.textContent = "user text"; });
  const conflict = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 100 });
  expect(conflict).toMatchObject({ ok: false, reason: "vids_previous_composer_content_conflict", changed: false });
  expect(await page.locator("[role=textbox]").evaluate((node) => node.textContent)).toBe("user text");
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture.removeClicks)).toBe(0);
  await install(page, true);
  const collapsed = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 100 });
  expect(collapsed).toMatchObject({ ok: false, reason: "vids_composer_collapsed_or_changed", changed: false });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture.removeClicks)).toBe(0);
});
