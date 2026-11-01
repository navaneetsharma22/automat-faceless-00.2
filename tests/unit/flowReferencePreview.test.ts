import { afterEach, describe, expect, it, vi } from "vitest";
import { flowReferencePreviewInPage } from "../../src/platforms/flow/references";

const previewKey = "__AUTOMAT_FLOW_REFERENCE_PREVIEW_V1__";
const globals = globalThis as unknown as Record<string, unknown>;
const payload = {
  action: "fetch" as const,
  sessionId: "session-1",
  candidateId: "00000000-0000-4000-8000-000000000001",
  previewId: "00000000-0000-4000-8000-000000000002",
  sourceUrl: "https://flow.google.com/media/observed-image.webp",
  expectedOrigin: "https://flow.google.com",
};

function response({
  status = 200,
  type = "image/webp",
  size = 64,
}: { status?: number; type?: string; size?: number } = {}) {
  const bytes = new Uint8Array(size).fill(7);
  return {
    ok: status >= 200 && status < 300,
    status,
    url: payload.sourceUrl,
    headers: {
      get: (name: string) =>
        name === "content-type"
          ? type
          : name === "content-length"
            ? String(size)
            : null,
    },
    body: {
      cancel: vi.fn().mockResolvedValue(undefined),
      getReader: () => ({
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: bytes })
          .mockResolvedValue({ done: true }),
        cancel: vi.fn(),
      }),
    },
  };
}

function installDecoder() {
  globals.createImageBitmap = vi.fn(async () => ({
    width: 1200,
    height: 900,
    close: vi.fn(),
  }));
  globals.OffscreenCanvas = class {
    getContext() {
      return { drawImage: vi.fn() };
    }
    async convertToBlob() {
      return new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globals, previewKey);
  Reflect.deleteProperty(globals, "createImageBitmap");
  Reflect.deleteProperty(globals, "OffscreenCanvas");
  Reflect.deleteProperty(globals, "fetch");
  Reflect.deleteProperty(globals, "location");
});

describe("transient Flow preview transport", () => {
  it("decodes, downsizes, bounds, and returns an ephemeral image payload", async () => {
    globals.location = { origin: payload.expectedOrigin };
    globals.fetch = vi.fn(async () => response());
    installDecoder();

    const result = await flowReferencePreviewInPage(payload);

    expect(result).toMatchObject({
      ok: true,
      sessionId: payload.sessionId,
      candidateId: payload.candidateId,
      previewId: payload.previewId,
      mimeType: "image/webp",
      width: 320,
      height: 240,
      byteLength: 3,
    });
    expect(typeof result.data).toBe("string");
    expect(
      (Reflect.get(globals, previewKey) as Map<string, unknown>).size,
    ).toBe(0);
    expect(globals.fetch).toHaveBeenCalledWith(
      payload.sourceUrl,
      expect.objectContaining({
        mode: "same-origin",
        credentials: "same-origin",
      }),
    );
  });

  it("rejects a different document origin before fetching", async () => {
    globals.location = { origin: "https://other.google.com" };
    globals.fetch = vi.fn();
    await expect(flowReferencePreviewInPage(payload)).resolves.toMatchObject({
      ok: false,
      code: "preview_wrong_origin",
    });
    expect(globals.fetch).not.toHaveBeenCalled();
  });

  it("reports failed image decoding", async () => {
    globals.location = { origin: payload.expectedOrigin };
    globals.fetch = vi.fn(async () => response());
    globals.createImageBitmap = vi.fn().mockRejectedValue(new Error("decode"));
    await expect(flowReferencePreviewInPage(payload)).resolves.toMatchObject({
      ok: false,
      code: "preview_decode_failed",
    });
  });

  it("rejects oversized declared and streamed responses", async () => {
    globals.location = { origin: payload.expectedOrigin };
    globals.fetch = vi.fn(async () => response({ size: 8 * 1024 * 1024 + 1 }));
    await expect(flowReferencePreviewInPage(payload)).resolves.toMatchObject({
      ok: false,
      code: "preview_input_too_large",
    });

    globals.fetch = vi.fn(async () => {
      const oversizedReader = {
        read: vi.fn().mockResolvedValue({
          done: false,
          value: new Uint8Array(8 * 1024 * 1024 + 1),
        }),
        cancel: vi.fn(),
      };
      return {
        ...response({ size: 1 }),
        headers: {
          get: (name: string) =>
            name === "content-type" ? "image/webp" : null,
        },
        body: { getReader: () => oversizedReader },
      };
    });
    await expect(
      flowReferencePreviewInPage({
        ...payload,
        previewId: "00000000-0000-4000-8000-000000000003",
      }),
    ).resolves.toMatchObject({ ok: false, code: "preview_input_too_large" });
  });

  it("aborts a matching preview and reports cancellation", async () => {
    globals.location = { origin: payload.expectedOrigin };
    let onAbort: (() => void) | undefined;
    globals.fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          onAbort = () => reject(new DOMException("aborted", "AbortError"));
          init.signal?.addEventListener("abort", onAbort);
        }),
    );
    const pending = flowReferencePreviewInPage(payload);
    await vi.waitFor(() => expect(globals.fetch).toHaveBeenCalled());
    const cancelled = await flowReferencePreviewInPage({
      ...payload,
      action: "cancel",
      sourceUrl: undefined,
    });
    onAbort?.();
    expect(cancelled).toMatchObject({ ok: false, code: "preview_cancelled" });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: "preview_cancelled",
    });
    expect(
      (Reflect.get(globals, previewKey) as Map<string, unknown>).size,
    ).toBe(0);
  });
});
