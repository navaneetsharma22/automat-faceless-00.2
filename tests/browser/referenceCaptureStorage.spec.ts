import { expect, test } from "@playwright/test";
import { rolldown } from "rolldown";
import { resolve } from "node:path";

test("Flow document capture fetches, decodes, and hashes original same-origin image bytes", async ({
  page,
}) => {
  await page.goto("about:blank");
  const validPng = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#4a7";
    context.fillRect(0, 0, 1, 1);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "fixture" }),
  );
  await page.route(
    "https://flow.google.com/reference-capture-fixture.png",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(validPng, "base64"),
      }),
  );
  await page.goto("https://flow.google.com/project/reference-capture-decode");
  const bundle = await rolldown({
    input: resolve(
      process.cwd(),
      "tests/browser/referenceCaptureStorageHarness.ts",
    ),
  });
  try {
    const built = await bundle.generate({
      format: "iife",
      name: "ReferenceCaptureFixture",
    });
    const chunk = built.output.find((output) => output.type === "chunk");
    if (!chunk) throw new Error("Reference capture browser harness missing");
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(() =>
      window.__ReferenceCaptureStorageFixture!.verifyDecodedImageCapture(),
    );
    expect(report).toMatchObject({
      ok: true,
      byteLength: Buffer.from(validPng, "base64").length,
      width: 1,
      height: 1,
      mimeType: "image/png",
    });
    expect(report.byteHash).toMatch(/^[0-9a-f]{64}$/);
  } finally {
    await bundle.close();
  }
});

test("production default fetcher retains its native WorkerGlobalScope receiver", async ({
  page,
}) => {
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "fixture" }),
  );
  await page.goto("https://flow.google.com/project/native-fetch-receiver");
  await page.route(
    "https://flow.google.com/native-fetch-receiver-fixture",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "native worker fetch succeeded",
      }),
  );
  const bundle = await rolldown({
    input: resolve(
      process.cwd(),
      "tests/browser/referenceFetchWorkerHarness.ts",
    ),
  });
  try {
    const built = await bundle.generate({
      format: "iife",
      name: "ReferenceFetchWorkerFixture",
    });
    const chunk = built.output.find((output) => output.type === "chunk");
    if (!chunk) throw new Error("Reference fetch worker harness missing");
    const result = await page.evaluate(async (workerSource) => {
      const workerUrl = URL.createObjectURL(
        new Blob([workerSource], { type: "text/javascript" }),
      );
      const worker = new Worker(workerUrl);
      try {
        return await new Promise((resolve, reject) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage(
            `${location.origin}/native-fetch-receiver-fixture`,
          );
        });
      } finally {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      }
    }, chunk.code);
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: "native worker fetch succeeded",
    });
  } finally {
    await bundle.close();
  }
});

test("real IndexedDB persists captured reference bytes and preserves prior assignment on rejected replacement", async ({
  page,
}) => {
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "fixture" }),
  );
  await page.goto("https://flow.google.com/project/reference-storage-fixture");
  const bundle = await rolldown({
    input: resolve(
      process.cwd(),
      "tests/browser/referenceCaptureStorageHarness.ts",
    ),
  });
  try {
    const built = await bundle.generate({
      format: "iife",
      name: "ReferenceCaptureStorageFixture",
    });
    const chunk = built.output.find((output) => output.type === "chunk");
    if (!chunk) throw new Error("Reference capture storage harness missing");
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(() =>
      window.__ReferenceCaptureStorageFixture!.verifyDurableReferenceCaptureStorage(),
    );
    expect(report).toEqual({
      savedAfterReopen: true,
      operationSaved: true,
      blobBytesMatch: true,
      duplicateOperationReadback: true,
      duplicateConcurrentOperationRejected: true,
      mismatchedReplacementRejected: true,
      oldAssignmentPreserved: true,
      rejectedOperationStillAcquiring: true,
      sourceMismatchRejected: true,
      shotMismatchRejected: true,
      projectMismatchRejected: true,
      documentMismatchRejected: true,
      cancelledCommitRejected: true,
    });
  } finally {
    await bundle.close();
  }
});

test("real IndexedDB keeps reference identity with each Shot through reorder, replacement, and reopen", async ({
  page,
}) => {
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "fixture" }),
  );
  await page.goto("https://flow.google.com/project/reference-reorder-fixture");
  const bundle = await rolldown({
    input: resolve(
      process.cwd(),
      "tests/browser/referenceCaptureStorageHarness.ts",
    ),
  });
  try {
    const built = await bundle.generate({
      format: "iife",
      name: "ReferenceAssignmentReorderFixture",
    });
    const chunk = built.output.find((output) => output.type === "chunk");
    if (!chunk) throw new Error("Reference reorder browser harness missing");
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(() =>
      window.__ReferenceCaptureStorageFixture!.verifyReferenceAssignmentReorder(),
    );
    expect(report.firstOrder).toEqual(["34", "35", "36"]);
    expect(report.firstView.map((entry) => entry.shotId)).toEqual([
      "34",
      "35",
      "36",
    ]);
    expect(report.firstView.map((entry) => entry.providerAssetId)).toEqual([
      "fixture-media-shot-34",
      "fixture-media-shot-35",
      "fixture-media-shot-36",
    ]);
    expect(report.firstView.every((entry) => entry.bytesHashVerified)).toBe(
      true,
    );
    expect(new Set(report.firstView.map((entry) => entry.sha256)).size).toBe(3);
    expect(report.unchanged34).toBe(true);
    expect(report.unchanged36).toBe(true);
    expect(report.replaced35).toBe(true);
    expect(report.persistedSourceUnchanged).toBe(true);
    expect(report.secondOrder).toEqual(["36", "34", "35"]);
    expect(report.secondView.map((entry) => entry.shotId)).toEqual([
      "36",
      "34",
      "35",
    ]);
    expect(report.secondView.map((entry) => entry.providerAssetId)).toEqual([
      "fixture-media-shot-36",
      "fixture-media-shot-34",
      "fixture-media-shot-35-jaguar-replacement",
    ]);
    expect(report.secondView.every((entry) => entry.bytesHashVerified)).toBe(
      true,
    );
    expect(
      report.secondView.map((entry) => entry.thumbnailAssociation),
    ).toEqual([
      "workspace-reorder-fixture:import:workspace-reorder-fixture:image:36",
      "workspace-reorder-fixture:import:workspace-reorder-fixture:image:34",
      "workspace-reorder-fixture:import:workspace-reorder-fixture:image:35",
    ]);
    expect(report.secondView[2]).toMatchObject({
      shotId: "35",
      providerAssetId: "fixture-media-shot-35-jaguar-replacement",
      assignmentVersion: 2,
    });
  } finally {
    await bundle.close();
  }
});
