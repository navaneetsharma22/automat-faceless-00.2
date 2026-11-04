import { expect, test, chromium, type BrowserContext, type Download, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type UrlComparisonSnapshot = {
  pageEvents: Array<{
    scheme: "https" | "http" | "blob" | "other" | "unknown";
    exactDownloadIds: number[];
  }>;
  downloads: Array<{
    id: number;
    urlScheme: "https" | "http" | "blob" | "other" | "unknown";
    finalUrlScheme: "https" | "http" | "blob" | "other" | "unknown";
    eventUrlEqualsUrl: boolean;
    eventUrlEqualsFinalUrl: boolean;
  }>;
};

const extensionPath = resolve(
  process.cwd(),
  "tests/fixtures/flow/download-url-probe",
);

async function sendControlMessage<T>(
  control: Page,
  message: Record<string, unknown>,
): Promise<T> {
  return control.evaluate(
    async (payload) =>
      (
        window as Window & {
          chrome: {
            runtime: { sendMessage(value: unknown): Promise<unknown> };
          };
        }
      ).chrome.runtime.sendMessage(payload) as Promise<T>,
    message,
  );
}

async function collectSnapshot(
  control: Page,
  expectedCount: number,
  waitMs = 3_000,
) {
  const deadline = Date.now() + waitMs;
  let current: UrlComparisonSnapshot = { pageEvents: [], downloads: [] };
  while (Date.now() < deadline) {
    current = await sendControlMessage<UrlComparisonSnapshot>(control, {
      type: "snapshot",
    });
    if (
      current.pageEvents.length >= expectedCount &&
      current.downloads.length >= expectedCount
    )
      return current;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return current;
}

test("compares Flow debugger URL events with Chrome download metadata", async () => {
  test.setTimeout(120_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "flow-download-url-probe-"));
  const profilePath = join(tempRoot, "profile");
  const downloadsPath = join(tempRoot, "downloads");
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html>" +
        "<button id='direct'>Direct HTTPS</button>" +
        "<button id='redirect'>Redirected HTTPS</button>" +
        "<button id='blob'>Page-created blob</button>" +
        "<button id='competing'>Competing downloads</button>" +
        "<script>" +
        "const origin='https://p11-download.invalid';" +
        "function startDownload(url){const a=document.createElement('a');a.href=url;a.click();a.remove();}" +
        "document.querySelector('#direct').onclick=()=>startDownload(origin+'/direct.mp4');" +
        "document.querySelector('#redirect').onclick=()=>startDownload(origin+'/redirect');" +
        "document.querySelector('#blob').onclick=()=>{const u=URL.createObjectURL(new Blob(['fixture-video-payload'],{type:'video/mp4'}));const a=document.createElement('a');a.href=u;a.download='blob-fixture.mp4';a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);};" +
        "document.querySelector('#competing').onclick=()=>{startDownload(origin+'/same-a.mp4');setTimeout(()=>startDownload(origin+'/same-b.mp4'),150);};" +
        "</script>",
    );
  });

  let context: BrowserContext | undefined;
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("fixture_server_address_unavailable");

    context = await chromium.launchPersistentContext(profilePath, {
      channel: "msedge",
      headless: false,
      acceptDownloads: true,
      downloadsPath,
      ignoreHTTPSErrors: true,
      args: [
        "--no-first-run",
        "--disable-extensions-except=" + extensionPath,
        "--load-extension=" + extensionPath,
      ],
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
    const extensionId = new URL(worker.url()).hostname;
    const control = await context.newPage();
    await control.goto("chrome-extension://" + extensionId + "/control.html");

    const fixtureOrigin = "http://127.0.0.1:" + address.port;
    const prepareFixturePage = async (name: string) => {
      const page = await context!.newPage();
      const fixtureUrl = fixtureOrigin + "/" + name;
      await page.route("https://p11-download.invalid/**", async (route) => {
        const requestPath = new URL(route.request().url()).pathname;
        if (requestPath === "/redirect") {
          await route.fulfill({
            status: 302,
            headers: {
              location: "https://p11-download.invalid/redirected.mp4",
            },
          });
          return;
        }
        const downloadName = requestPath.slice(1);
        await route.fulfill({
          status: 200,
          headers: {
            "content-type": "video/mp4",
            "content-disposition": 'attachment; filename="' + downloadName + '"',
          },
          body: Buffer.from("controlled browser fixture payload"),
        });
      });
      await page.goto(fixtureUrl);
      const tabs = await sendControlMessage<
        Array<{ id?: number; url?: string }>
      >(control, { type: "tabs" });
      const fixtureTab = tabs.find((tab) => tab.url === fixtureUrl);
      if (fixtureTab?.id === undefined)
        throw new Error("fixture_tab_not_found");
      const attached = await sendControlMessage<{ ok: boolean }>(control, {
        type: "attach",
        tabId: fixtureTab.id,
      });
      expect(attached.ok).toBe(true);
      return page;
    };

    const runDownload = async (
      page: Page,
      button: string,
      count = 1,
    ) => {
      await sendControlMessage(control, { type: "reset" });
      const completed: Download[] = [];
      const onDownload = (download: Download) => {
        completed.push(download);
      };
      page.on("download", onDownload);
      await page.locator(button).click();
      const deadline = Date.now() + 8_000;
      while (completed.length < count && Date.now() < deadline)
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      page.off("download", onDownload);
      const failures = await Promise.all(completed.map((download) => download.failure()));
      expect(failures.every((failure) => failure === null)).toBe(true);
      const snapshot = await collectSnapshot(control, count);
      return { completedCount: completed.length, snapshot };
    };

    const directPage = await prepareFixturePage("direct-fixture");
    const directRun = await runDownload(directPage, "#direct");
    expect(directRun.completedCount).toBe(1);
    const direct = directRun.snapshot;
    const safeFixtureEvidence = (
      run: { completedCount: number; snapshot: UrlComparisonSnapshot },
    ) => ({
      browserCompletionCount: run.completedCount,
      pageEventSchemes: run.snapshot.pageEvents.map((event) => event.scheme),
      downloadComparisons: run.snapshot.downloads.map((download) => ({
        urlScheme: download.urlScheme,
        finalUrlScheme: download.finalUrlScheme,
        eventUrlEqualsUrl: download.eventUrlEqualsUrl,
        eventUrlEqualsFinalUrl: download.eventUrlEqualsFinalUrl,
      })),
    });
    test.info().annotations.push({
      type: "direct-https-evidence",
      description: JSON.stringify(safeFixtureEvidence(directRun)),
    });
    expect(direct.pageEvents[0]?.scheme).toBe("https");
    expect(direct.downloads[0]?.urlScheme).toBe("https");
    expect(direct.downloads[0]?.eventUrlEqualsUrl).toBe(true);
    expect(direct.pageEvents[0]?.exactDownloadIds).toEqual([
      direct.downloads[0]?.id,
    ]);

    const redirectPage = await prepareFixturePage("redirect-fixture");
    const redirectedRun = await runDownload(redirectPage, "#redirect");
    const redirected = redirectedRun.snapshot;
    test.info().annotations.push({
      type: "redirected-https-evidence",
      description: JSON.stringify(safeFixtureEvidence(redirectedRun)),
    });
    if (
      redirectedRun.completedCount === 1 &&
      redirected.pageEvents.length === 1 &&
      redirected.downloads.length === 1
    ) {
      expect(redirected.pageEvents[0]?.scheme).toBe("https");
      expect(redirected.downloads[0]?.urlScheme).toBe("https");
      expect(redirected.downloads[0]?.finalUrlScheme).toBe("https");
      expect(
        redirected.downloads[0]?.eventUrlEqualsUrl ||
          redirected.downloads[0]?.eventUrlEqualsFinalUrl,
      ).toBe(true);
      expect(redirected.pageEvents[0]?.exactDownloadIds).toContain(
        redirected.downloads[0]?.id,
      );
    } else {
      test.info().annotations.push({
        type: "redirected-download",
        description:
          "The controlled browser did not complete the redirect fixture; URL comparison remains unverified for redirects.",
      });
    }

    const blobPage = await prepareFixturePage("blob-fixture");
    const blobRun = await runDownload(blobPage, "#blob");
    const blob = blobRun.snapshot;
    test.info().annotations.push({
      type: "blob-evidence",
      description: JSON.stringify(safeFixtureEvidence(blobRun)),
    });
    if (
      blobRun.completedCount === 1 &&
      blob.pageEvents.length === 1 &&
      blob.downloads.length === 1
    ) {
      const pageEvent = blob.pageEvents.find((event) => event.scheme === "blob");
      const item = blob.downloads.find(
        (download) =>
          download.urlScheme === "blob" || download.finalUrlScheme === "blob",
      );
      expect(Boolean(pageEvent)).toBe(true);
      expect(Boolean(item)).toBe(true);
      expect(pageEvent?.exactDownloadIds).toContain(item?.id);
      expect(
        item?.eventUrlEqualsUrl || item?.eventUrlEqualsFinalUrl,
      ).toBe(true);
    } else {
      test.info().annotations.push({
        type: "blob-download",
        description:
          "The controlled browser did not complete the blob fixture; URL comparison remains unverified for blob downloads.",
      });
    }

    const competingPage = await prepareFixturePage("competing-fixture");
    const competingRun = await runDownload(competingPage, "#competing", 2);
    expect(competingRun.completedCount).toBe(2);
    const competing = competingRun.snapshot;
    expect(competing.pageEvents.length).toBeGreaterThanOrEqual(2);
    expect(competing.downloads.length).toBeGreaterThanOrEqual(2);
    expect(
      competing.pageEvents.every((event) => event.exactDownloadIds.length === 1),
    ).toBe(true);
    expect(
      competing.downloads.filter(
        (download) => download.eventUrlEqualsUrl || download.eventUrlEqualsFinalUrl,
      ),
    ).toHaveLength(2);
    test.info().annotations.push({
      type: "competing-download-evidence",
      description: JSON.stringify(safeFixtureEvidence(competingRun)),
    });
  } finally {
    await context?.close();
    await new Promise<void>((resolveClose) =>
      server.close(() => resolveClose()),
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});
