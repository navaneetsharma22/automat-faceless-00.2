/* global chrome, URL */

const pageEvents = [];
const downloads = [];
let targetTabId;

function schemeCategory(raw) {
  if (typeof raw !== "string") return "unknown";
  if (raw.trim().length === 0) return "unknown";
  try {
    const protocol = new URL(raw).protocol.slice(0, -1);
    return protocol === "https" || protocol === "http" || protocol === "blob"
      ? protocol
      : "other";
  } catch {
    const match = raw.match(/^\s*([a-z][a-z\d+.-]*):/i);
    const scheme = match?.[1]?.toLowerCase();
    return scheme === "https" || scheme === "http" || scheme === "blob"
      ? scheme
      : scheme
        ? "other"
        : "unknown";
  }
}

function summary() {
  const pageSummaries = pageEvents.map((event) => ({
    scheme: schemeCategory(event.url),
    exactDownloadIds: downloads
      .filter((item) => event.url === item.url || event.url === item.finalUrl)
      .map((item) => item.id),
  }));
  const downloadSummaries = downloads.map((item) => ({
    id: item.id,
    urlScheme: schemeCategory(item.url),
    finalUrlScheme: schemeCategory(item.finalUrl),
    eventUrlEqualsUrl: pageEvents.some((event) => event.url === item.url),
    eventUrlEqualsFinalUrl: pageEvents.some(
      (event) => event.url === item.finalUrl,
    ),
  }));
  return { pageEvents: pageSummaries, downloads: downloadSummaries };
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (
    source.tabId === targetTabId &&
    method === "Page.downloadWillBegin" &&
    pageEvents.length < 8
  ) {
    pageEvents.push({ url: params.url });
  }
});

chrome.downloads.onCreated.addListener((item) => {
  if (downloads.length < 12)
    downloads.push({ id: item.id, url: item.url, finalUrl: item.finalUrl });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "tabs") {
    chrome.tabs.query({}, (tabs) =>
      sendResponse(tabs.map((tab) => ({ id: tab.id, url: tab.url }))),
    );
    return true;
  }
  if (message?.type === "reset") {
    pageEvents.length = 0;
    downloads.length = 0;
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "snapshot") {
    sendResponse(summary());
    return;
  }
  if (message?.type === "attach") {
    targetTabId = message.tabId;
    chrome.debugger.attach({ tabId: targetTabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        if (!chrome.runtime.lastError.message?.includes("already attached")) {
          sendResponse({ ok: false });
          return;
        }
      }
      chrome.debugger.sendCommand(
        { tabId: targetTabId },
        "Page.enable",
        {},
        () => sendResponse({ ok: !chrome.runtime.lastError }),
      );
    });
    return true;
  }
});
