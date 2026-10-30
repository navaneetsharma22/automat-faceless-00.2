import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../../src/app/App";
import {
  connectionDisplayAnnouncement,
  connectionWorkerFailureDetail,
  hasVerifiedBindingForSelectedTarget,
  withPendingCleanup,
} from "../../src/app/connectionAttempt";
import { ConnectionError } from "../../src/app/components/ConnectionError";
import { FoundationClientError } from "../../src/shared/messageClient";

describe("connection feedback presentation", () => {
  it("announces a preserved connection as checking instead of Connecting", () => {
    expect(
      connectionDisplayAnnouncement("connected", "Connected — checking…"),
    ).toBe("Connected — checking…");
    expect(connectionDisplayAnnouncement("pending", "Connecting…")).toBe(
      "Connecting…",
    );
    expect(
      connectionDisplayAnnouncement("pending", "Checking connection…"),
    ).toBe("Checking connection…");
    expect(connectionDisplayAnnouncement("connected", "Connected")).toBe(null);
  });

  it("preserves Connected while checking the same verified document", () => {
    const target = {
      provider: "Flow" as const,
      tabId: 41,
      canonicalTarget: "https://flow.google.com/project/selected-project",
    };
    const current = {
      ...target,
      verification: "verified" as const,
      connectionState: "checking",
      verificationBinding: {
        ...target,
        documentId: "browser-document",
        documentToken: "connector-token",
      },
    };
    expect(hasVerifiedBindingForSelectedTarget(current, target)).toBe(true);
    expect(
      hasVerifiedBindingForSelectedTarget(
        {
          ...current,
          canonicalTarget: "https://flow.google.com/project/other",
        },
        target,
      ),
    ).toBe(false);
    expect(
      hasVerifiedBindingForSelectedTarget(
        { ...current, verification: "unverified" },
        target,
      ),
    ).toBe(false);
    expect(
      hasVerifiedBindingForSelectedTarget(
        {
          ...current,
          verificationBinding: {
            ...current.verificationBinding,
            documentToken: "",
          },
        },
        target,
      ),
    ).toBe(false);
  });

  it("keeps connection ownership in the persistent shell around workspace views", () => {
    const markup = renderToStaticMarkup(createElement(App));
    const sidebarStart = markup.indexOf("<aside class=");
    const connectionIndex = markup.indexOf('id="connection-title"');
    const sidebarEnd = markup.indexOf("</aside>", sidebarStart);

    expect(sidebarStart).toBeGreaterThanOrEqual(0);
    expect(connectionIndex).toBeGreaterThan(sidebarStart);
    expect(sidebarEnd).toBeGreaterThan(connectionIndex);
    expect(markup).toContain('hidden=""');
  });

  it("renders the complete actionable error in an alert without truncation", () => {
    const detail =
      "connector_injection: Could not inject the packaged read-only connector into the selected Flow top frame. Check selected-site host access and the extension package; the page was not refreshed or navigated.";
    const markup = renderToStaticMarkup(
      createElement(ConnectionError, { detail }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(detail);
    expect(markup).not.toContain("…");
    expect(markup).not.toContain("...");
  });

  it("preserves safe worker rejection and unavailable-channel diagnostics", () => {
    const workerRejected = new FoundationClientError(
      "worker_error",
      "worker_request_failed",
      "The extension worker could not complete the request.",
    );
    const channelUnavailable = new FoundationClientError(
      "missing_receiver",
      "worker_unavailable",
      "The extension worker is unavailable. Reopen the dashboard and retry.",
    );

    expect(connectionWorkerFailureDetail(workerRejected)).toContain(
      "selection_storage/worker_error/worker_request_failed",
    );
    expect(connectionWorkerFailureDetail(channelUnavailable)).toContain(
      "selection_storage/missing_receiver/worker_unavailable",
    );
  });

  it.each([
    ["success", async () => "connected"],
    ["failure", async () => Promise.reject(new Error("probe failed"))],
  ])("clears pending state after %s", async (_label, operation) => {
    let pending = true;
    await withPendingCleanup(operation, () => {
      pending = false;
    }).catch(() => undefined);

    expect(pending).toBe(false);
  });
});
