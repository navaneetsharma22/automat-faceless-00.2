import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { rolldown } from "rolldown";

test("worker connect and repeated Flow readiness preserve the durable binding without touching a Vids editor", async ({
  page,
}) => {
  await page.route("https://flow.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Synthetic Flow</title>",
    }),
  );
  await page.goto(
    "https://flow.google.com/project/connection-lifecycle-fixture",
  );
  await page.setContent(
    '<textarea id="vids-editor">unsaved synthetic scene notes</textarea>',
  );
  await page.evaluate(() => {
    (window as Window & { __vidsInputEvents?: number }).__vidsInputEvents = 0;
    document.querySelector("#vids-editor")?.addEventListener("input", () => {
      const current = window as Window & { __vidsInputEvents?: number };
      current.__vidsInputEvents = (current.__vidsInputEvents ?? 0) + 1;
    });
  });
  const editorBefore = await page.locator("#vids-editor").inputValue();
  const bundle = await rolldown({
    input: resolve(
      process.cwd(),
      "tests/browser/connectionLifecycleHarness.ts",
    ),
    plugins: [
      {
        name: "fixture-build-id",
        transform(code: string) {
          return code.replaceAll(
            "__AUTOMAT_BUILD_ID__",
            JSON.stringify("connection-lifecycle-fixture-build"),
          );
        },
      },
    ],
  });
  try {
    const built = await bundle.generate({
      format: "iife",
      name: "ConnectionLifecycleFixture",
    });
    const chunk = built.output.find((entry) => entry.type === "chunk");
    if (!chunk) throw new Error("Connection lifecycle harness bundle missing");
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(async () => {
      const fixture = window as Window & {
        ConnectionLifecycleFixture?: {
          runConnectionLifecycleRegression: () => Promise<
            Record<string, unknown>
          >;
        };
      };
      if (!fixture.ConnectionLifecycleFixture)
        throw new Error("Connection lifecycle fixture export missing");
      return fixture.ConnectionLifecycleFixture.runConnectionLifecycleRegression();
    });
    expect(report).toMatchObject({
      connected: { ok: true, data: { ok: true, state: "verified" } },
      concurrent: [
        { ok: true, data: { ok: true, state: "verified" } },
        { ok: true, data: { ok: true, state: "verified" } },
      ],
      firstReadiness: { ok: true, data: { status: "ready" } },
      secondReadiness: { ok: true, data: { status: "ready" } },
      restartReadiness: { ok: true, data: { status: "ready" } },
      beforeReadiness: {
        verification: "verified",
        connectionState: "verified",
        tabId: 41,
        canonicalTarget:
          "https://flow.google.com/project/connection-lifecycle-fixture",
        documentId: "fixture-browser-document",
      },
      afterReadiness: {
        verification: "verified",
        connectionState: "verified",
        tabId: 41,
        canonicalTarget:
          "https://flow.google.com/project/connection-lifecycle-fixture",
        documentId: "fixture-browser-document",
      },
      afterWorkerRestart: {
        verification: "unverified",
        connectionState: "checking",
        documentId: "fixture-browser-document",
      },
      scriptCall: 9,
      tabCounts: { reload: 0, update: 0, create: 0, remove: 0 },
      debuggerCommands: 0,
      providerInputCalls: 0,
      connectorReleaseCalls: 0,
      persistedAttempts: [],
    });
    expect(report.lifecycleDiagnostics).toContainEqual({
      kind: "revalidation_started",
      reason: "bounded_read_only_handshake",
    });
    expect(report.lifecycleDiagnostics).toContainEqual({
      kind: "revalidation_verified",
      reason: "same_selected_document_and_build",
    });
    expect(
      (report.lifecycleDiagnostics as unknown[]).length,
    ).toBeLessThanOrEqual(32);
    expect(await page.locator("#vids-editor").inputValue()).toBe(editorBefore);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __vidsInputEvents?: number }).__vidsInputEvents,
      ),
    ).toBe(0);
    expect(page.url()).toBe(
      "https://flow.google.com/project/connection-lifecycle-fixture",
    );
  } finally {
    await bundle.close();
  }
});
