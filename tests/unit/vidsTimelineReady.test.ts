import { describe, expect, it, vi } from "vitest";
import { parseExpectedDocumentId, createSubmissionGuard, readinessMatchesDocument, createVidsTimelineReadiness } from "../../src/domain/media/combinedExport";
import { createVidsTimelineReadyHandler } from "../../src/background/vidsTimelineReady";
import { ChromePreferenceRepository } from "../../src/storage/repositories";

const doc = (documentId = "vids-doc-1") => ({
  documentId,
  canonicalTarget: `https://vids.google.com/video/${documentId}/edit`,
  tabId: 22,
  sceneOrderConfirmed: true as const,
  documentSavedConfirmed: true as const,
});

describe("Vids manual timeline readiness", () => {
  it("parses accepted document IDs and Vids URL forms without retaining URL data", () => {
    expect(parseExpectedDocumentId("  vids-doc_123  ")).toEqual({ supplied: true, valid: true, fileId: "vids-doc_123" });
    expect(parseExpectedDocumentId("https://docs.google.com/videos/u/0/d/vids-doc_123/edit?x=secret")).toEqual({ supplied: true, valid: true, fileId: "vids-doc_123" });
    expect(parseExpectedDocumentId("https://vids.google.com/video/vids-doc_123/edit")).toEqual({ supplied: true, valid: true, fileId: "vids-doc_123" });
    expect(parseExpectedDocumentId("https://vids.google.com/video/your-document-id/edit")).toEqual({ supplied: true, valid: true, fileId: "your-document-id" });
    expect(parseExpectedDocumentId("http://docs.google.com/videos/d/doc/edit").valid).toBe(false);
    expect(parseExpectedDocumentId("https://example.com/videos/d/doc/edit").valid).toBe(false);
    expect(parseExpectedDocumentId("https://docs.google.com/document/d/doc/edit").valid).toBe(false);
  });

  it("rejects a declaration that differs from the currently revalidated document", async () => {
    const preferences = { setVidsTimelineReadiness: vi.fn(), getVidsTimelineReadiness: vi.fn(), clearVidsTimelineReadiness: vi.fn() };
    const selected = { provider: "Vids", verification: "verified", connectionState: "verified", tabId: 22,
      canonicalTarget: "https://vids.google.com/video/vids-doc-1/edit", verificationBinding: {
        provider: "Vids", tabId: 22, canonicalTarget: "https://vids.google.com/video/vids-doc-1/edit", projectId: "vids-doc-1",
      } };
    const handler = createVidsTimelineReadyHandler({ preferences: preferences as never,
      repositories: { getSelectedTarget: vi.fn(async () => selected) } as never,
      revalidate: async () => ({ ok: true, state: "verified", tab: { id: 22, provider: "Vids", projectId: "vids-doc-1", canonicalTarget: selected.canonicalTarget } }),
    });
    await expect(handler.declare({ ...doc("other-doc"), canonicalTarget: "https://vids.google.com/video/other-doc/edit" })).rejects.toThrow("vids_timeline_document_mismatch");
    expect(preferences.setVidsTimelineReadiness).not.toHaveBeenCalled();
  });

  it("stores only a user-attested record and invalidates it when its exact document changes", async () => {
    const values: Record<string, unknown> = {};
    const preferences = new ChromePreferenceRepository({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => Object.assign(values, items),
    });
    const record = createVidsTimelineReadiness(doc(), 1234);
    await preferences.setVidsTimelineReadiness(record);
    expect(readinessMatchesDocument(await preferences.getVidsTimelineReadiness(), "vids-doc-1")).toBe(true);
    expect(readinessMatchesDocument(record, "other-doc")).toBe(false);
    expect(await preferences.clearVidsTimelineReadiness("other-doc")).toBe(false);
    expect(await preferences.clearVidsTimelineReadiness("vids-doc-1")).toBe(true);
    expect(await preferences.getVidsTimelineReadiness()).toBeUndefined();
  });

  it("blocks repeated submissions synchronously while one request is pending", () => {
    const guard = createSubmissionGuard();
    expect(guard.begin()).toBe(true);
    expect(guard.begin()).toBe(false);
    guard.end();
    expect(guard.begin()).toBe(true);
  });

  it("rejects a duplicate declaration while its connection revalidation is pending", async () => {
    let resolveRevalidation!: (value: unknown) => void;
    const revalidation = new Promise((resolve) => { resolveRevalidation = resolve; });
    const preferences = { setVidsTimelineReadiness: vi.fn(), getVidsTimelineReadiness: vi.fn(), clearVidsTimelineReadiness: vi.fn() };
    const target = doc();
    const handler = createVidsTimelineReadyHandler({ preferences: preferences as never,
      repositories: { getSelectedTarget: vi.fn(async () => ({ provider: "Vids", verification: "verified", connectionState: "verified", tabId: target.tabId,
        canonicalTarget: target.canonicalTarget, verificationBinding: { provider: "Vids", tabId: target.tabId, canonicalTarget: target.canonicalTarget, projectId: target.documentId } })) } as never,
      revalidate: () => revalidation,
    });
    const first = handler.declare(target);
    await expect(handler.declare(target)).rejects.toThrow("vids_timeline_ready_pending");
    resolveRevalidation({ ok: true, state: "verified", tab: { id: target.tabId, provider: "Vids", projectId: target.documentId, canonicalTarget: target.canonicalTarget } });
    await expect(first).resolves.toMatchObject({ status: "user_attested", documentId: target.documentId });
  });
});
