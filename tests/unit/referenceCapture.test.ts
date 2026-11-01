import { afterEach, describe, expect, it, vi } from "vitest";
import { flowReferenceCaptureInPage } from "../../src/platforms/flow/references";
import { MAX_REFERENCE_CAPTURE_BYTES } from "../../src/domain/media/references";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function imageResponse(bytes = pngBytes, contentLength = String(bytes.length)) {
  return {
    ok: true,
    status: 200,
    url: "https://flow.google.com/image/fixture",
    headers: new Headers({
      "content-type": "image/png",
      "content-length": contentLength,
    }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  } as Response;
}

describe("durable reference capture in the verified Flow document", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns bounded original bytes only after successful image decode", async () => {
    vi.stubGlobal("location", { origin: "https://flow.google.com" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse()),
    );
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 2, height: 2, close })),
    );

    const result = await flowReferenceCaptureInPage({
      action: "fetch",
      captureOperationId: "capture-success",
      sourceUrl: "https://flow.google.com/image/fixture",
      expectedOrigin: "https://flow.google.com",
    });

    expect(result).toMatchObject({
      ok: true,
      captureOperationId: "capture-success",
      mimeType: "image/png",
      width: 2,
      height: 2,
      byteLength: pngBytes.length,
      data: Buffer.from(pngBytes).toString("base64"),
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a source outside the verified document origin before fetch", async () => {
    vi.stubGlobal("location", { origin: "https://flow.google.com" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await flowReferenceCaptureInPage({
      action: "fetch",
      captureOperationId: "capture-wrong-origin",
      sourceUrl: "https://cdn.example/image",
      expectedOrigin: "https://flow.google.com",
    });
    expect(result).toMatchObject({ ok: false, code: "capture_wrong_origin" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a response above the byte cap without reading or decoding it", async () => {
    vi.stubGlobal("location", { origin: "https://flow.google.com" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        imageResponse(pngBytes, String(MAX_REFERENCE_CAPTURE_BYTES + 1)),
      ),
    );
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const result = await flowReferenceCaptureInPage({
      action: "fetch",
      captureOperationId: "capture-oversize",
      sourceUrl: "https://flow.google.com/image/fixture",
      expectedOrigin: "https://flow.google.com",
    });
    expect(result).toMatchObject({ ok: false, code: "capture_oversize" });
    expect(decode).not.toHaveBeenCalled();
  });

  it("does not return bytes when browser image decoding fails", async () => {
    vi.stubGlobal("location", { origin: "https://flow.google.com" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse()),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => Promise.reject(new Error("decode"))),
    );
    const result = await flowReferenceCaptureInPage({
      action: "fetch",
      captureOperationId: "capture-decode-failure",
      sourceUrl: "https://flow.google.com/image/fixture",
      expectedOrigin: "https://flow.google.com",
    });
    expect(result).toMatchObject({ ok: false, code: "capture_decode_failed" });
  });

  it("aborts a pending read when the matching operation is cancelled", async () => {
    vi.stubGlobal("location", { origin: "https://flow.google.com" });
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }),
    );
    const capture = flowReferenceCaptureInPage({
      action: "fetch",
      captureOperationId: "capture-cancel",
      sourceUrl: "https://flow.google.com/image/fixture",
      expectedOrigin: "https://flow.google.com",
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    const cancelled = await flowReferenceCaptureInPage({
      action: "cancel",
      captureOperationId: "capture-cancel",
      expectedOrigin: "https://flow.google.com",
    });
    expect(cancelled).toMatchObject({ ok: true, cancelled: true });
    await expect(capture).resolves.toMatchObject({
      ok: false,
      code: "capture_cancelled",
    });
  });
});
