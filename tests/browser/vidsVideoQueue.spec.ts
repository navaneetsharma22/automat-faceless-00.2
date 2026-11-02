import { expect, test } from "@playwright/test";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { sha256Bytes } from "../../src/domain/media/references";
import { activateVidsGenerateInPage, enterVidsPromptInPage, transitionVidsComposerFromPreviousInPage } from "../../src/platforms/vids/video";
import { uploadVidsReferenceInPage } from "../../src/platforms/vids/references";

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

test("P10.1 upload with removed input through P10.2 dispatch then safely transitions to a different Shot 2", async ({ page }) => {
  const shot1Bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOo1nX+DwAD/QHrf7yFWAAAAABJRU5ErkJggg=="), (value) => value.charCodeAt(0));
  const shot1Prompt = previousPrompt;
  const shot2Prompt = JSON.stringify({ shot_id: "2", prompt_type: "video", scene: "second pair", multiline: ["line one", "line two"] }, null, 2);
  await page.goto("http://127.0.0.1:5173/");
  const shot2Bytes = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1; const context = canvas.getContext("2d")!; context.fillStyle = "#e04b32"; context.fillRect(0, 0, 1, 1); const encoded = canvas.toDataURL("image/png").split(",")[1]!; return Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0)); });
  await page.setContent(`<aside role="complementary" aria-labelledby="sidebar-name"><span id="sidebar-name">AI video clip</span><button role="tab" aria-selected="true" aria-labelledby="tab-name"><span id="tab-name">Animate</span></button><section role="tabpanel" aria-labelledby="panel-name"><span id="panel-name">Animate</span><button aria-label="Add image">Add image</button><input type="file" accept="image/jpeg,image/png"><div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video."></div><button aria-label="Generate">Generate</button></section></aside>`);
  await page.evaluate(() => {
    Object.assign(window, { queueFixture: { removes: 0, generates: 0 } });
    document.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0]; if (!file) return;
      const panel = input.closest("[role=tabpanel]")!;
      const preview = document.createElement("img"); preview.alt = "Uploaded image preview"; preview.src = URL.createObjectURL(file);
      const remove = document.createElement("button"); remove.setAttribute("aria-label", "Remove image"); remove.textContent = "Remove";
      panel.insertBefore(preview, panel.querySelector("[role=textbox]")); panel.insertBefore(remove, panel.querySelector("[role=textbox]"));
      panel.querySelector("button[aria-label='Add image']")?.remove();
      input.remove();
    });
    document.addEventListener("click", (event) => {
      const button = (event.target as Element | null)?.closest("button"); if (!button) return;
      const fixture = (window as unknown as { queueFixture: { removes: number; generates: number } }).queueFixture;
      if (button.matches("[aria-label='Remove image']")) { fixture.removes += 1; button.remove(); document.querySelector("img[alt='Uploaded image preview']")?.remove(); }
      if (button.matches("[aria-label='Generate']")) fixture.generates += 1;
    });
  });
  const upload = async (imageBytes: Uint8Array) => page.evaluate(uploadVidsReferenceInPage, { base64: Buffer.from(imageBytes).toString("base64"), mimeType: "image/png", byteSize: imageBytes.length, width: 1, height: 1, sha256: await sha256Bytes(imageBytes), timeoutMs: 1500 });
  const firstUpload = await upload(shot1Bytes);
  expect(firstUpload).toMatchObject({ ok: true, submitted: true, previewLoaded: true });
  expect(await page.locator("input[type=file]").count()).toBe(0);
  const shot1Hash = await sha256Hex(shot1Prompt);
  const entered = await page.evaluate(enterVidsPromptInPage, { prompt: shot1Prompt, expectedSha256: shot1Hash, referenceSha256: await sha256Bytes(shot1Bytes), referenceMimeType: "image/png", referenceByteSize: shot1Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000 });
  expect(entered).toMatchObject({ ok: true, immediateMatch: true, settledMatch: true, referenceProofSource: "preview_blob_sha256" });
  expect(await page.evaluate(activateVidsGenerateInPage, { prompt: shot1Prompt, promptSha256: shot1Hash, referenceSha256: await sha256Bytes(shot1Bytes), referenceMimeType: "image/png", referenceByteSize: shot1Bytes.length, referenceWidth: 1, referenceHeight: 1 })).toMatchObject({ ok: true, activationCount: 1, referenceProofSource: "preview_blob_sha256" });
  const retained = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: shot1Prompt, promptSha256: shot1Hash, referenceSha256: await sha256Bytes(shot1Bytes), referenceMimeType: "image/png", referenceByteSize: shot1Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000, inspectOnly: true });
  expect(retained).toMatchObject({ ok: true, changed: false, diagnostics: { promptMatches: true, referenceResult: "matched" } });
  const transition = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: shot1Prompt, promptSha256: shot1Hash, referenceSha256: await sha256Bytes(shot1Bytes), referenceMimeType: "image/png", referenceByteSize: shot1Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000 });
  expect(transition).toMatchObject({ ok: true, changed: true, diagnostics: { promptMatches: true, referenceResult: "matched", referenceProofSource: "preview_blob_sha256" } });
  expect(await page.locator("[role=textbox]").textContent()).toBe("");
  expect(await page.locator("img[alt='Uploaded image preview']").count()).toBe(0);
  await page.locator("[role=tabpanel]").evaluate((panel) => panel.insertAdjacentHTML("afterbegin", '<button aria-label="Add image">Add image</button><input type="file" accept="image/jpeg,image/png">'));
  const secondUpload = await upload(shot2Bytes);
  expect(secondUpload.ok, JSON.stringify(secondUpload)).toBe(true);
  const shot2Hash = await sha256Hex(shot2Prompt);
  const secondEntry = await page.evaluate(enterVidsPromptInPage, { prompt: shot2Prompt, expectedSha256: shot2Hash, referenceSha256: await sha256Bytes(shot2Bytes), referenceMimeType: "image/png", referenceByteSize: shot2Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000 });
  expect(secondEntry).toMatchObject({ ok: true, immediateMatch: true, settledMatch: true, referenceProofSource: "preview_blob_sha256" });
  expect(await page.evaluate(activateVidsGenerateInPage, { prompt: shot2Prompt, promptSha256: shot2Hash, referenceSha256: await sha256Bytes(shot2Bytes), referenceMimeType: "image/png", referenceByteSize: shot2Bytes.length, referenceWidth: 1, referenceHeight: 1 })).toMatchObject({ ok: true, activationCount: 1 });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removes: number; generates: number } }).queueFixture)).toEqual({ removes: 1, generates: 2 });
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

test("read-only transition diagnostics distinguish prompt conflict from matched preview bytes", async ({ page }) => {
  await install(page);
  await page.locator("[role=textbox]").evaluate((node) => { node.textContent = "unrelated user text"; });
  const result = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 100, inspectOnly: true });
  expect(result).toMatchObject({ ok: false, reason: "vids_previous_composer_content_conflict", changed: false, diagnostics: { stage: "prompt", promptMatches: false, referenceResult: "matched", referenceProofSource: "selected_file_sha256" } });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture)).toEqual({ removeClicks: 0, generateClicks: 0, unrelatedClicks: 0 });
});

test("a uniquely scoped Expand control opens Animate, then the transition repeats identity checks", async ({ page }) => {
  await install(page, true);
  await page.locator("[role=complementary]").evaluate((sidebar) => {
    const expand = document.createElement("button"); expand.setAttribute("aria-label", "Expand"); expand.setAttribute("aria-expanded", "false"); expand.textContent = "Expand";
    expand.addEventListener("click", () => { const panel = sidebar.querySelector<HTMLElement>("[role=tabpanel]"); if (panel) panel.style.display = "block"; });
    sidebar.append(expand);
  });
  const expanded = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500 });
  expect(expanded).toMatchObject({ ok: false, reason: "vids_composer_expanded_revalidate", changed: false });
  const result = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500 });
  expect(result).toMatchObject({ ok: true, changed: true, diagnostics: { animatePanel: "unique", promptMatches: true, referenceResult: "matched" } });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture)).toEqual({ removeClicks: 1, generateClicks: 0, unrelatedClicks: 1 });
});
