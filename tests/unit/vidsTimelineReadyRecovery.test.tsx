// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VidsTimelineReady } from "../../src/app/features/downloads/VidsTimelineReady";
import { createVidsTimelineReadiness, type VidsDownloadAttempt } from "../../src/domain/media/combinedExport";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const documentId = "same-vids-document";
const canonicalTarget = `https://vids.google.com/video/${documentId}/edit`;
const readiness = createVidsTimelineReadiness({ documentId, canonicalTarget, tabId: 12, sceneOrderConfirmed: true, documentSavedConfirmed: true }, 100);
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Vids unknown-attempt recovery UI", () => {
  it("requires an explicit acknowledgement and requests recovery for the exact verified document", async () => {
    const old: VidsDownloadAttempt = {
      attemptId: "003d9d7e5abd68c5445fa5b0444bc151", documentId, canonicalTarget, tabId: 12,
      state: "needs_review", createdAt: 110, updatedAt: 120, reason: "operation_observation_lost",
    };
    const next = {
      attemptId: "new_attempt", documentId, canonicalTarget, tabId: 12, state: "ready", createdAt: 130, updatedAt: 130,
      priorAttempts: [{ ...old, archivedAt: 130, archiveReason: "new_attempt_after_unknown_outcome" }],
    };
    const request = vi.fn(async (type: string) => {
      if (type === "vids.timelineReady.get") return readiness;
      if (type === "vids.download.get") return old;
      if (type === "connections.revalidate") return { ok: true, state: "verified", tab: { id: 12, provider: "Vids", projectId: documentId, canonicalTarget } };
      if (type === "connections.getSelection") return {
        tabId: 12, canonicalTarget, verification: "verified", connectionState: "verified",
        verificationBinding: { provider: "Vids", tabId: 12, canonicalTarget, projectId: documentId },
      };
      if (type === "vids.download.recoverUnknown") return { attempt: next };
      return null;
    });
    vi.stubGlobal("chrome", { permissions: { request: vi.fn(async () => true) } });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(VidsTimelineReady, { client: { request } as never })); await Promise.resolve(); });

    const connect = [...host.querySelectorAll("button")].find((button) => button.textContent === "Use connected Vids document");
    expect(connect).toBeTruthy();
    await act(async () => { connect!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain("The prior attempt has no recorded Drive operation ID");
    expect(host.textContent).toContain("outcome is unknown");
    const recovery = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Preserve prior attempt"));
    expect(recovery?.disabled).toBe(true);
    expect(request).not.toHaveBeenCalledWith("vids.download.recoverUnknown", expect.anything());

    const acknowledgement = [...host.querySelectorAll("input[type=checkbox]")].find((input) =>
      input.parentElement?.textContent?.includes("I checked the existing helper")) as HTMLInputElement;
    expect(acknowledgement).toBeTruthy();
    await act(async () => { acknowledgement.click(); });
    expect(recovery?.disabled).toBe(false);
    await act(async () => { recovery!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith("vids.download.recoverUnknown", {
      expectedAttemptId: old.attemptId, expectedDocumentId: documentId,
    });
    expect(host.textContent).toContain("The previous attempt remains recorded as unknown");
    expect(host.textContent).toContain(old.attemptId);
    expect(host.textContent).toContain("new_attempt");
  });
});
