import { expect, test } from "@playwright/test";
import { sha256Hex } from "../../src/domain/batches/hashPrompt";
import { sha256Bytes } from "../../src/domain/media/references";
import { activateVidsGenerateInPage, enterVidsPromptInPage, transitionVidsComposerFromPreviousInPage } from "../../src/platforms/vids/video";
import { uploadVidsReferenceInPage } from "../../src/platforms/vids/references";

const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg=="), (value) => value.charCodeAt(0));
const previousPrompt = JSON.stringify({ shot_id: "1", prompt_type: "video", lines: ["first", "second"] }, null, 2);

async function install(page: import("@playwright/test").Page, collapsed = false) {
  await page.goto("http://127.0.0.1:5173/");
  await page.setContent(`<aside role="complementary" aria-labelledby="ai-name"><span id="ai-name">AI video clip</span><button role="tab" aria-labelledby="animate-name" aria-selected="true"><span id="animate-name">Animate</span></button><section role="tabpanel" aria-label="Animate" style="${collapsed ? "display:none" : ""}"><button aria-label="Add image">Add image</button><input type="file"><img alt="Uploaded image preview" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg=="><button aria-label="Remove image">Remove</button><div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video."></div><button aria-label="Generate">Generate</button></section></aside>`);
  await page.locator("input[type=file]").setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from(bytes) });
  await page.locator("input[type=file]").evaluate((input) => { const file = (input as HTMLInputElement).files![0]!; const panel = input.closest("[role=tabpanel]")!; panel.querySelector("img[alt='Uploaded image preview']")!.setAttribute("src", URL.createObjectURL(file)); input.remove(); panel.querySelector("button[aria-label='Add image']")?.remove(); });
  await page.locator("[role=textbox]").evaluate((node, text) => { node.textContent = text; }, previousPrompt);
  await page.evaluate(() => { Object.assign(window, { queueFixture: { removeClicks: 0, generateClicks: 0, unrelatedClicks: 0 } }); document.addEventListener("click", (event) => { const button = (event.target as Element | null)?.closest("button"); if (!button) return; const fixture = (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture; if (button.matches("[aria-label='Remove image']")) { fixture.removeClicks += 1; button.remove(); document.querySelector("img[alt='Uploaded image preview']")?.remove(); const panel = document.querySelector("[role=tabpanel]")!; panel.insertAdjacentHTML("afterbegin", '<button aria-label="Add image">Add image</button><input type="file">'); } else if (button.matches("[aria-label='Generate']")) fixture.generateClicks += 1; else fixture.unrelatedClicks += 1; }); });
}

test("production transition removes only exact previous content, then leaves the composer empty", async ({ page }) => {
  await install(page);
  const result = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500 });
  expect(result).toMatchObject({ ok: true, changed: true });
  expect(await page.locator("[role=textbox]").evaluate((node) => node.textContent)).toBe("");
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture)).toMatchObject({ removeClicks: 1, generateClicks: 0, unrelatedClicks: 0 });
});

test("refreshed clean composer recovery is read-only and requires settled empty Animate controls", async ({ page }) => {
  await install(page);
  await page.locator("img[alt='Uploaded image preview'], button[aria-label='Remove image']").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await page.locator("[role=textbox]").evaluate((node) => { node.textContent = ""; });
  await page.locator("[role=tabpanel]").evaluate((panel) => panel.insertAdjacentHTML("afterbegin", '<button aria-label="Add image">Add image</button><input type="file" accept="image/jpeg,image/png">'));
  await page.locator("body").evaluate((body) => body.insertAdjacentHTML("beforeend", '<button id="unrelated">Keep user control</button>'));
  const result = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500, inspectOnly: true, phase: "inspect_clean" });
  expect(result).toMatchObject({ ok: true, changed: false, diagnostics: { stage: "complete", previewCount: 0, settledPromptEmpty: true } });
  expect(await page.locator("#unrelated").count()).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture)).toMatchObject({ removeClicks: 0, generateClicks: 0, unrelatedClicks: 0 });
});

test("four-shot production chain verifies the immediately preceding reference at every transition", async ({ page }) => {
  const shot1Bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOo1nX+DwAD/QHrf7yFWAAAAABJRU5ErkJggg=="), (value) => value.charCodeAt(0));
  const shot1Prompt = previousPrompt;
  const shot2Prompt = JSON.stringify({ shot_id: "2", prompt_type: "video", scene: "second pair", multiline: ["line one", "line two"] }, null, 2);
  const shot3Prompt = JSON.stringify({ shot_id: "3", prompt_type: "video", scene: "third pair", multiline: ["different reference", "exact third prompt"] }, null, 2);
  const shot1Id = "10000000-0000-4000-8000-000000000001", shot2Id = "20000000-0000-4000-8000-000000000002", shot3Id = "30000000-0000-4000-8000-000000000003";
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
      if (button.matches("[aria-label='Remove image']")) { fixture.removes += 1; button.remove(); document.querySelector("img[alt='Uploaded image preview']")?.remove(); const panel = document.querySelector("[role=tabpanel]")!; panel.insertAdjacentHTML("afterbegin", '<button aria-label="Add image">Add image</button><input type="file" accept="image/jpeg,image/png">'); }
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
  const candidates = [
    { referenceId: shot1Id, sha256: await sha256Bytes(shot1Bytes), mimeType: "image/png" as const, byteSize: shot1Bytes.length, width: 1, height: 1 },
    { referenceId: shot2Id, sha256: await sha256Bytes(shot2Bytes), mimeType: "image/png" as const, byteSize: shot2Bytes.length, width: 1, height: 1 },
  ];
  const retained = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: shot1Prompt, promptSha256: shot1Hash, referenceId: shot1Id, referenceCandidates: candidates, referenceSha256: await sha256Bytes(shot1Bytes), referenceMimeType: "image/png", referenceByteSize: shot1Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000, inspectOnly: true });
  expect(retained).toMatchObject({ ok: true, changed: false, diagnostics: { promptMatches: true, referenceResult: "matched" } });
  const transition = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: shot1Prompt, promptSha256: shot1Hash, referenceId: shot1Id, referenceCandidates: candidates, referenceSha256: await sha256Bytes(shot1Bytes), referenceMimeType: "image/png", referenceByteSize: shot1Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000 });
  expect(transition).toMatchObject({ ok: true, changed: true, diagnostics: { promptMatches: true, referenceResult: "matched", referenceProofSource: "preview_blob_sha256" } });
  expect(await page.locator("[role=textbox]").textContent()).toBe("");
  expect(await page.locator("img[alt='Uploaded image preview']").count()).toBe(0);
  const secondUpload = await upload(shot2Bytes);
  expect(secondUpload.ok, JSON.stringify(secondUpload)).toBe(true);
  const shot2Hash = await sha256Hex(shot2Prompt);
  const secondEntry = await page.evaluate(enterVidsPromptInPage, { prompt: shot2Prompt, expectedSha256: shot2Hash, referenceSha256: await sha256Bytes(shot2Bytes), referenceMimeType: "image/png", referenceByteSize: shot2Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000 });
  expect(secondEntry).toMatchObject({ ok: true, immediateMatch: true, settledMatch: true, referenceProofSource: "preview_blob_sha256" });
  expect(await page.evaluate(activateVidsGenerateInPage, { prompt: shot2Prompt, promptSha256: shot2Hash, referenceSha256: await sha256Bytes(shot2Bytes), referenceMimeType: "image/png", referenceByteSize: shot2Bytes.length, referenceWidth: 1, referenceHeight: 1 })).toMatchObject({ ok: true, activationCount: 1 });
  const shot2Candidates = [...candidates, { referenceId: shot3Id, sha256: "f".repeat(64), mimeType: "image/png" as const, byteSize: 0, width: 1, height: 1 }];
  const transition2Inspection = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: shot2Prompt, promptSha256: shot2Hash, referenceId: shot2Id, referenceCandidates: shot2Candidates, referenceSha256: await sha256Bytes(shot2Bytes), referenceMimeType: "image/png", referenceByteSize: shot2Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000, inspectOnly: true });
  expect(transition2Inspection).toMatchObject({ ok: true, diagnostics: { referenceExpectedId: shot2Id, referenceActualId: shot2Id, referenceResult: "matched", referenceProofSource: "preview_blob_sha256", promptMatches: true } });
  const transition2 = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: shot2Prompt, promptSha256: shot2Hash, referenceId: shot2Id, referenceCandidates: shot2Candidates, referenceSha256: await sha256Bytes(shot2Bytes), referenceMimeType: "image/png", referenceByteSize: shot2Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000 });
  expect(transition2).toMatchObject({ ok: true, changed: true, diagnostics: { referenceExpectedId: shot2Id, referenceActualId: shot2Id, referenceResult: "matched", referenceProofSource: "preview_blob_sha256", promptMatches: true } });
  expect(await page.locator("[role=textbox]").textContent()).toBe("");
  expect(await page.locator("img[alt='Uploaded image preview']").count()).toBe(0);
  const shot3Bytes = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1; const context = canvas.getContext("2d")!; context.fillStyle = "#2864db"; context.fillRect(0, 0, 1, 1); return Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]!), (value) => value.charCodeAt(0)); });
  expect(await upload(shot3Bytes)).toMatchObject({ ok: true, submitted: true });
  const shot3Hash = await sha256Hex(shot3Prompt);
  expect(await page.evaluate(enterVidsPromptInPage, { prompt: shot3Prompt, expectedSha256: shot3Hash, referenceSha256: await sha256Bytes(shot3Bytes), referenceMimeType: "image/png", referenceByteSize: shot3Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000 })).toMatchObject({ ok: true, immediateMatch: true, settledMatch: true, referenceProofSource: "preview_blob_sha256" });
  expect(await page.evaluate(activateVidsGenerateInPage, { prompt: shot3Prompt, promptSha256: shot3Hash, referenceSha256: await sha256Bytes(shot3Bytes), referenceMimeType: "image/png", referenceByteSize: shot3Bytes.length, referenceWidth: 1, referenceHeight: 1 })).toMatchObject({ ok: true, activationCount: 1 });
  const shot4Prompt = JSON.stringify({ shot_id: "4", prompt_type: "video", scene: "fourth consecutive pair", camera: { movement: "orbit", duration: 7 } }, null, 2);
  const shot4Bytes = Uint8Array.from(shot3Bytes); shot4Bytes[shot4Bytes.length - 1] ^= 1;
  const shot3Candidates = [
    { referenceId: shot3Id, sha256: await sha256Bytes(shot3Bytes), mimeType: "image/png" as const, byteSize: shot3Bytes.length, width: 1, height: 1 },
    { referenceId: "40000000-0000-4000-8000-000000000004", sha256: await sha256Bytes(shot4Bytes), mimeType: "image/png" as const, byteSize: shot4Bytes.length, width: 1, height: 1 },
  ];
  expect(await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: shot3Prompt, promptSha256: shot3Hash, referenceId: shot3Id, referenceCandidates: shot3Candidates, referenceSha256: await sha256Bytes(shot3Bytes), referenceMimeType: "image/png", referenceByteSize: shot3Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000 })).toMatchObject({ ok: true, changed: true });
  expect(await upload(shot4Bytes)).toMatchObject({ ok: true, submitted: true });
  const shot4Hash = await sha256Hex(shot4Prompt);
  expect(await page.evaluate(enterVidsPromptInPage, { prompt: shot4Prompt, expectedSha256: shot4Hash, referenceSha256: await sha256Bytes(shot4Bytes), referenceMimeType: "image/png", referenceByteSize: shot4Bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1000 })).toMatchObject({ ok: true, immediateMatch: true, settledMatch: true });
  expect(await page.evaluate(activateVidsGenerateInPage, { prompt: shot4Prompt, promptSha256: shot4Hash, referenceSha256: await sha256Bytes(shot4Bytes), referenceMimeType: "image/png", referenceByteSize: shot4Bytes.length, referenceWidth: 1, referenceHeight: 1 })).toMatchObject({ ok: true, activationCount: 1 });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removes: number; generates: number } }).queueFixture)).toEqual({ removes: 3, generates: 4 });
});

test("five production-injected Shots survive post-dispatch collapse and bind every click to its exact saved pair", async ({ page }) => {
  const shotPrompts = Array.from({ length: 5 }, (_, index) => JSON.stringify({ shot_id: String(index + 1), prompt_type: "video", direction: `saved shot ${index + 1}`, frames: ["opening", `detail ${index + 1}`, "closing"] }, null, 2));
  const shotBytes = await page.evaluate(() => Array.from({ length: 5 }, (_, index) => {
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext("2d")!; context.fillStyle = `rgb(${30 + index * 35},${80 + index * 17},${180 - index * 21})`; context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL("image/png").split(",")[1]!;
  }));
  const ids = shotPrompts.map((_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  await page.goto("http://127.0.0.1:5173/");
  await page.setContent(`<aside role="complementary" aria-label="AI video clip"><button role="tab" aria-label="Animate" aria-selected="true">Animate</button><section role="tabpanel" aria-label="Animate"><button aria-label="Add image">Add image</button><input type="file" accept="image/jpeg,image/png"><div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video."></div><button aria-label="Generate">Generate</button></section></aside>`);
  await page.evaluate(() => {
    Object.assign(window, { shotRun: { generateClicks: [] as Array<{ prompt: string; src: string }> } });
    document.addEventListener("change", (event) => { const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return; const panel = input.closest("[role=tabpanel]")!; const image = document.createElement("img"); image.alt = "Uploaded image preview"; image.src = URL.createObjectURL(file); const remove = document.createElement("button"); remove.setAttribute("aria-label", "Remove image"); remove.textContent = "Remove"; panel.insertBefore(image, panel.querySelector("[role=textbox]")); panel.insertBefore(remove, panel.querySelector("[role=textbox]")); panel.querySelector("button[aria-label='Add image']")?.remove(); input.remove(); });
    document.addEventListener("click", (event) => { const button = (event.target as Element | null)?.closest("button"); if (button?.matches("[aria-label='Remove image']")) { const panel = button.closest("[role=tabpanel]")!; button.remove(); panel.querySelector("img[alt='Uploaded image preview']")?.remove(); panel.insertAdjacentHTML("afterbegin", '<button aria-label="Add image">Add image</button><input type="file" accept="image/jpeg,image/png">'); } if (button?.matches("[aria-label='Generate']")) { const panel = button.closest("[role=tabpanel]")!; const editor = panel.querySelector("[role=textbox]")!; (window as unknown as { shotRun: { generateClicks: Array<{ prompt: string; src: string }> } }).shotRun.generateClicks.push({ prompt: [...editor.children].map((line) => line.textContent ?? "").join("\n"), src: panel.querySelector("img[alt='Uploaded image preview']")!.src }); } });
    const sidebar = document.querySelector("[role=complementary]")!;
    const expand = document.createElement("button"); expand.setAttribute("aria-label", "Expand"); expand.setAttribute("aria-expanded", "false"); expand.textContent = "Expand"; expand.addEventListener("click", () => { sidebar.querySelector<HTMLElement>("[role=tabpanel]")!.style.display = "block"; expand.setAttribute("aria-expanded", "true"); }); sidebar.append(expand);
  });
  const refs = await Promise.all(shotBytes.map(async (encoded) => Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0))));
  const hashes = await Promise.all(shotPrompts.map(sha256Hex));
  const refHashes = await Promise.all(refs.map(sha256Bytes));
  for (let index = 0; index < 5; index += 1) {
    if (index > 0) {
      const firstRead = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: shotPrompts[index - 1]!, promptSha256: hashes[index - 1]!, referenceSha256: refHashes[index - 1]!, referenceMimeType: "image/png", referenceByteSize: refs[index - 1]!.length, referenceWidth: 2, referenceHeight: 2, timeoutMs: 800, inspectOnly: true, phase: "inspect" });
      expect(firstRead).toMatchObject({ ok: false, reason: "vids_composer_expanded_revalidate", changed: false });
      const inspected = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: shotPrompts[index - 1]!, promptSha256: hashes[index - 1]!, referenceId: ids[index - 1]!, referenceCandidates: [{ referenceId: ids[index - 1]!, sha256: refHashes[index - 1]!, mimeType: "image/png" as const, byteSize: refs[index - 1]!.length, width: 2, height: 2 }], referenceSha256: refHashes[index - 1]!, referenceMimeType: "image/png", referenceByteSize: refs[index - 1]!.length, referenceWidth: 2, referenceHeight: 2, timeoutMs: 800, inspectOnly: true, phase: "inspect" });
      expect(inspected).toMatchObject({ ok: true, changed: false, diagnostics: { promptMatches: true, referenceResult: "matched" } });
      const cleaned = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: shotPrompts[index - 1]!, promptSha256: hashes[index - 1]!, referenceId: ids[index - 1]!, referenceCandidates: [{ referenceId: ids[index - 1]!, sha256: refHashes[index - 1]!, mimeType: "image/png" as const, byteSize: refs[index - 1]!.length, width: 2, height: 2 }], referenceSha256: refHashes[index - 1]!, referenceMimeType: "image/png", referenceByteSize: refs[index - 1]!.length, referenceWidth: 2, referenceHeight: 2, timeoutMs: 800, checkpointedOwnership: true, phase: "full" });
      expect(cleaned).toMatchObject({ ok: true, changed: true, diagnostics: { promptMatches: true, referenceResult: "matched", settledPromptEmpty: true } });
    }
    const uploaded = await page.evaluate(uploadVidsReferenceInPage, { base64: shotBytes[index]!, mimeType: "image/png", byteSize: refs[index]!.length, width: 2, height: 2, sha256: refHashes[index]!, timeoutMs: 1000 });
    expect(uploaded).toMatchObject({ ok: true, submitted: true });
    const entered = await page.evaluate(enterVidsPromptInPage, { prompt: shotPrompts[index]!, expectedSha256: hashes[index]!, referenceSha256: refHashes[index]!, referenceMimeType: "image/png", referenceByteSize: refs[index]!.length, referenceWidth: 2, referenceHeight: 2, timeoutMs: 1000 });
    expect(entered).toMatchObject({ ok: true, immediateMatch: true, settledMatch: true, stableReads: 3, referenceSha256: refHashes[index]! });
    const activated = await page.evaluate(activateVidsGenerateInPage, { prompt: shotPrompts[index]!, promptSha256: hashes[index]!, referenceSha256: refHashes[index]!, referenceMimeType: "image/png", referenceByteSize: refs[index]!.length, referenceWidth: 2, referenceHeight: 2 });
    expect(activated).toMatchObject({ ok: true, activationAttempted: true, activationCount: 1 });
    if (index < 4) await page.locator("[role=tabpanel]").evaluate((panel) => { (panel as HTMLElement).style.display = "none"; document.querySelector("button[aria-label='Expand']")?.setAttribute("aria-expanded", "false"); });
  }
  const observed = await page.evaluate(() => (window as unknown as { shotRun: { generateClicks: Array<{ prompt: string; src: string }> } }).shotRun.generateClicks);
  expect(observed.map((click) => click.prompt)).toEqual(shotPrompts);
  const clickedHashes = await page.evaluate(async (sources) => Promise.all(sources.map(async (src) => { const blob = await (await fetch(src)).blob(); const bytes = await blob.arrayBuffer(); const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); return [...digest].map((value) => value.toString(16).padStart(2, "0")).join(""); })), observed.map((click) => click.src));
  expect(clickedHashes).toEqual(refHashes);
  expect(observed).toHaveLength(5);
});

test("wrong reference bytes and a prompt changed before activation produce zero Generate clicks", async ({ page }) => {
  await install(page);
  await page.locator("[role=tabpanel]").evaluate((panel) => { const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1; canvas.getContext("2d")!.fillRect(0, 0, 1, 1); const image = panel.querySelector("img[alt='Uploaded image preview']")!; canvas.toBlob((blob) => { if (blob) image.src = URL.createObjectURL(blob); }, "image/png"); });
  await expect.poll(() => page.locator("img[alt='Uploaded image preview']").evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 1)).toBe(true);
  const wrongReference = await page.evaluate(enterVidsPromptInPage, { prompt: previousPrompt, expectedSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 300 });
  expect(wrongReference).toMatchObject({ ok: false, reason: "reference_preview_blob_metadata_mismatch" });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { generateClicks: number } }).queueFixture.generateClicks)).toBe(0);

  await install(page);
  const entered = await page.evaluate(enterVidsPromptInPage, { prompt: previousPrompt, expectedSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500 });
  expect(entered.ok).toBe(true);
  await page.locator("[role=textbox]").evaluate((editor) => { editor.textContent = "changed after settled readback"; });
  const activation = await page.evaluate(activateVidsGenerateInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1 });
  expect(activation).toMatchObject({ ok: false, reason: "prompt_readback_changed", activationAttempted: false, activationCount: 0 });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { generateClicks: number } }).queueFixture.generateClicks)).toBe(0);
});

test("transition rejects different current bytes and reports the uniquely matching prepared reference ID", async ({ page }) => {
  await install(page);
  await page.locator("[role=tabpanel]").evaluate((panel) => panel.insertAdjacentHTML("afterbegin", '<input type="file">'));
  const other = Uint8Array.from(bytes); other[other.length - 2] ^= 1;
  await page.locator("input[type=file]").setInputFiles({ name: "other.png", mimeType: "image/png", buffer: Buffer.from(other) });
  const otherId = "40000000-0000-4000-8000-000000000004";
  const candidates = [{ referenceId: otherId, sha256: await sha256Bytes(other), mimeType: "image/png" as const, byteSize: other.length, width: 1, height: 1 }];
  const result = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceId: "50000000-0000-4000-8000-000000000005", referenceCandidates: candidates, referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500, inspectOnly: true });
  expect(result).toMatchObject({ ok: false, reason: "vids_previous_reference_identity_mismatch", changed: false, diagnostics: { referenceExpectedId: "50000000-0000-4000-8000-000000000005", referenceActualId: otherId, referenceResult: "mismatched", referenceProofSource: "selected_file_sha256" } });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture.removeClicks)).toBe(0);
});

test("interrupted cleanup resumes from the removed-image boundary only for the exact prior prompt", async ({ page }) => {
  await install(page);
  await page.locator("img[alt='Uploaded image preview']").evaluate((preview) => preview.remove());
  await page.locator("button[aria-label='Remove image']").evaluate((button) => button.remove());
  await page.locator("[role=tabpanel]").evaluate((panel) => panel.insertAdjacentHTML("afterbegin", '<button aria-label="Add image">Add image</button><input type="file">'));
  const resumed = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceId: "60000000-0000-4000-8000-000000000006", referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500, checkpointedOwnership: true, phase: "clear_prompt" });
  expect(resumed).toMatchObject({ ok: true, changed: true, diagnostics: { cleanupState: "already_empty", referenceResult: "not_checked", promptMatches: true } });
  expect(await page.locator("[role=textbox]").textContent()).toBe("");
  expect(await page.locator("button[aria-label='Add image']").count()).toBe(1);
  expect(await page.locator("input[type=file]").count()).toBe(1);
  await install(page);
  await page.locator("img[alt='Uploaded image preview']").evaluate((preview) => preview.remove());
  await page.locator("button[aria-label='Remove image']").evaluate((button) => button.remove());
  await page.locator("[role=textbox]").evaluate((editor) => { editor.textContent = "unrelated user edit"; });
  const preserved = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500, checkpointedOwnership: true, phase: "clear_prompt" });
  expect(preserved).toMatchObject({ ok: false, reason: "vids_previous_composer_content_conflict", changed: false });
  expect(await page.locator("[role=textbox]").textContent()).toBe("unrelated user edit");
});

test("cleanup rebinds a replaced Animate panel and editor after image removal", async ({ page }) => {
  await install(page);
  await page.evaluate((prompt) => {
    const sidebar = document.querySelector("[role=complementary]")!;
    document.addEventListener("click", (event) => {
      const button = (event.target as Element | null)?.closest("button[aria-label='Remove image']");
      if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const oldPanel = sidebar.querySelector("[role=tabpanel]")!;
      const replacement = document.createElement("section"); replacement.setAttribute("role", "tabpanel"); replacement.setAttribute("aria-label", "Animate");
      replacement.innerHTML = `<button aria-label="Add image">Add image</button><input type="file"><div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video."></div><button aria-label="Generate">Generate</button>`;
      replacement.querySelector("[role=textbox]")!.textContent = prompt;
      oldPanel.replaceWith(replacement);
      Object.assign(window, { replacedPanel: true });
    }, true);
  }, previousPrompt);
  const result = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 700 });
  expect(result).toMatchObject({ ok: true, diagnostics: { editorRebound: true, panelRebound: true, settledPromptEmpty: true } });
  expect(await page.locator("[role=textbox]").textContent()).toBe("");
});

test("native Clear fallback waits for delayed settled-empty state and reports bounded diagnostics", async ({ page }) => {
  await install(page);
  await page.locator("[role=tabpanel]").evaluate((panel) => {
    const clear = document.createElement("button"); clear.setAttribute("aria-label", "Clear prompt and image"); clear.textContent = "Clear";
    clear.addEventListener("click", () => setTimeout(() => { const editor = document.querySelector("[role=textbox]")!; editor.replaceChildren(); }, 175));
    panel.append(clear);
  });
  await page.evaluate(() => { document.execCommand = () => false; });
  const result = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 900 });
  expect(result).toMatchObject({ ok: true, diagnostics: { clearAttempt: "native_clear", settledPromptEmpty: true } });
  expect(result.diagnostics).toMatchObject({ expectedPromptLength: previousPrompt.length, actualPromptLength: previousPrompt.length, clearAvailable: "unique", fileInputCount: 1, previewCount: 0 });
});

test("failed prompt clear exposes stage and bounded hashes without prompt or URL content", async ({ page }) => {
  await install(page);
  await page.evaluate(() => { document.execCommand = () => false; });
  const result = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 300 });
  expect(result).toMatchObject({ ok: false, reason: "vids_previous_prompt_clear_failed", diagnostics: { stage: "prompt_clear", clearAvailable: "missing", previewCount: 0, fileInputCount: 1 } });
  expect(result.diagnostics).toMatchObject({ promptExpectedSha256: await sha256Hex(previousPrompt), promptActualSha256: await sha256Hex(previousPrompt), expectedPromptLength: previousPrompt.length, actualPromptLength: previousPrompt.length });
  expect(JSON.stringify(result)).not.toContain(previousPrompt);
  expect(JSON.stringify(result)).not.toContain("blob:");
});

test("cleanup resumes at each persisted mutation boundary and refuses uncheckpointed removed images", async ({ page }) => {
  await install(page);
  const promptSha256 = await sha256Hex(previousPrompt), referenceSha256 = await sha256Bytes(bytes);
  const ownership = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256, referenceSha256, referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500, phase: "inspect", inspectOnly: true });
  expect(ownership.ok).toBe(true);
  const beforeRemove = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256, referenceSha256, referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500, phase: "remove_reference" });
  expect(beforeRemove.ok).toBe(true);
  const afterRemove = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256, referenceSha256, referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500, phase: "clear_prompt", checkpointedOwnership: true });
  expect(afterRemove.ok).toBe(true);
  const afterClearBeforeCheckpoint = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256, referenceSha256, referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1200, phase: "verify_empty", checkpointedOwnership: true });
  expect(afterClearBeforeCheckpoint).toMatchObject({ ok: true, diagnostics: { settledPromptEmpty: true } });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture)).toMatchObject({ removeClicks: 1, generateClicks: 0, unrelatedClicks: 0 });
  await install(page);
  await page.locator("img[alt='Uploaded image preview']").evaluate((preview) => preview.remove());
  const uncheckpointed = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256, referenceSha256, referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 300, phase: "clear_prompt" });
  expect(uncheckpointed).toMatchObject({ ok: false, reason: "vids_cleanup_checkpoint_required" });
  expect(await page.locator("[role=textbox]").textContent()).toBe(previousPrompt);
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
  expect(result).toMatchObject({ ok: false, reason: "vids_previous_composer_content_conflict", changed: false, diagnostics: { stage: "prompt", promptMatches: false, referenceResult: "matched", referenceProofSource: "preview_blob_sha256" } });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture)).toMatchObject({ removeClicks: 0, generateClicks: 0, unrelatedClicks: 0 });
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
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture)).toMatchObject({ removeClicks: 1, generateClicks: 0, unrelatedClicks: 1 });
});

test("read-only worker inspection expands a verified Animate panel and rechecks before cleanup", async ({ page }) => {
  await install(page, true);
  await page.locator("[role=complementary]").evaluate((sidebar) => {
    const expand = document.createElement("button"); expand.setAttribute("aria-label", "Expand"); expand.setAttribute("aria-expanded", "false"); expand.textContent = "Expand";
    expand.addEventListener("click", () => { sidebar.querySelector<HTMLElement>("[role=tabpanel]")!.style.display = "block"; }); sidebar.append(expand);
  });
  const args = { prompt: previousPrompt, promptSha256: await sha256Hex(previousPrompt), referenceSha256: await sha256Bytes(bytes), referenceMimeType: "image/png" as const, referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500, inspectOnly: true, phase: "inspect" as const };
  const expanded = await page.evaluate(transitionVidsComposerFromPreviousInPage, args);
  expect(expanded).toMatchObject({ ok: false, reason: "vids_composer_expanded_revalidate", changed: false });
  const inspected = await page.evaluate(transitionVidsComposerFromPreviousInPage, args);
  expect(inspected).toMatchObject({ ok: true, changed: false, diagnostics: { promptMatches: true, referenceResult: "matched" } });
  expect(await page.locator("[role=textbox]").textContent()).toBe(previousPrompt);
  expect(await page.locator("img[alt='Uploaded image preview']").count()).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number; unrelatedClicks: number } }).queueFixture)).toMatchObject({ removeClicks: 0, generateClicks: 0 });
});

test("automatic inspection waits for preview delivery after Animate expands and the editor rerenders", async ({ page }) => {
  await install(page, true);
  const promptSha256 = await sha256Hex(previousPrompt), referenceSha256 = await sha256Bytes(bytes);
  const referenceId = "60000000-0000-4000-8000-000000000006";
  await page.locator("[role=complementary]").evaluate((sidebar, args) => {
    const expand = document.createElement("button"); expand.setAttribute("aria-label", "Expand"); expand.setAttribute("aria-expanded", "false"); expand.textContent = "Expand";
    expand.addEventListener("click", () => {
      setTimeout(() => {
        const old = sidebar.querySelector("[role=tabpanel]")!;
        const panel = document.createElement("section"); panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-label", "Animate");
        panel.innerHTML = `<div role="textbox" contenteditable="true" aria-label="Add your image, then describe what should happen in your video."></div><button aria-label="Generate">Generate</button>`;
        panel.querySelector("[role=textbox]")!.replaceChildren(...args.prompt.split("\n").map((line) => { const block = document.createElement("div"); block.textContent = line; return block; }));
        old.replaceWith(panel);
        setTimeout(() => {
          const preview = document.createElement("img"); preview.alt = "Uploaded image preview"; preview.src = URL.createObjectURL(new Blob([args.base64Bytes], { type: "image/png" }));
          const remove = document.createElement("button"); remove.setAttribute("aria-label", "Remove image"); remove.textContent = "Remove";
          panel.insertBefore(preview, panel.querySelector("[role=textbox]")); panel.insertBefore(remove, panel.querySelector("[role=textbox]"));
        }, 280);
      }, 70);
    });
    sidebar.append(expand);
  }, { prompt: previousPrompt, base64Bytes: bytes });
  const expanded = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256, referenceSha256, referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 1200, inspectOnly: true, phase: "inspect" });
  expect(expanded).toMatchObject({ ok: false, reason: "vids_composer_expanded_revalidate", changed: false, diagnostics: { panelStateBeforeExpansion: "collapsed", panelStateAfterExpansion: "settled", panelRebound: true, editorRebound: true, freshPreviewDetection: "delayed_then_present", previewCount: 1 } });
  const referenceCandidates = [{ referenceId, sha256: referenceSha256, mimeType: "image/png" as const, byteSize: bytes.length, width: 1, height: 1 }];
  const inspected = await page.evaluate(transitionVidsComposerFromPreviousInPage, { prompt: previousPrompt, promptSha256, referenceId, referenceCandidates, referenceSha256, referenceMimeType: "image/png", referenceByteSize: bytes.length, referenceWidth: 1, referenceHeight: 1, timeoutMs: 500, inspectOnly: true, phase: "inspect" });
  expect(inspected).toMatchObject({ ok: true, changed: false, diagnostics: { promptMatches: true, referenceResult: "matched" } });
  expect(await page.evaluate(() => (window as unknown as { queueFixture: { removeClicks: number; generateClicks: number } }).queueFixture)).toMatchObject({ removeClicks: 0, generateClicks: 0 });
});
