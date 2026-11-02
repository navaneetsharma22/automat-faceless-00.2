import { describe, expect, it, vi } from "vitest";
import {
  fetchFlowReferenceBytes,
  flowReferenceResource,
  flowReferenceSignatureValid,
  resolveFlowReferenceFetcher,
  sameFlowReferenceResource,
} from "../../src/platforms/flow/referenceResource";

const approved = "https://lh3.googleusercontent.com/gallery/image?token=secret";
const flowContentId = "5a836a9f-197d-4400-aa12-2d4c7492a444";
const flowContentUrl = `https://flow-content.google/image/${flowContentId}?signed=private`;
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
function response(
  url: string,
  bytes = webp,
  status = 200,
  type = "image/webp",
) {
  const result = new Response(bytes, {
    status,
    headers: { "content-type": type },
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
const allowed = async () => true;

describe("Flow reference media acquisition policy", () => {
  it("preserves an explicitly injected custom fetcher", () => {
    const customFetcher = vi.fn<typeof fetch>();
    expect(resolveFlowReferenceFetcher(customFetcher)).toBe(customFetcher);
  });

  it("accepts only HTTPS approved host URLs without credentials and strips query from durable identity", () => {
    expect(flowReferenceResource(approved)).toMatchObject({
      fetchUrl: approved,
      resourceKey: "https://lh3.googleusercontent.com/gallery/image",
      permission: "https://lh3.googleusercontent.com/*",
    });
    expect(
      sameFlowReferenceResource(
        approved,
        "https://lh3.googleusercontent.com/gallery/image?new-token=other",
      ),
    ).toBe(true);
    for (const url of [
      "http://lh3.googleusercontent.com/image",
      "https://user:pass@lh3.googleusercontent.com/image",
      "https://evil.example/image",
      "https://lh3.googleusercontent.com.evil.example/image",
    ])
      expect(() => flowReferenceResource(url)).toThrow();
  });

  it("accepts the exact Flow content image path only when its UUID matches the re-resolved media ID", () => {
    expect(flowReferenceResource(flowContentUrl, flowContentId)).toEqual({
      fetchUrl: flowContentUrl,
      resourceKey: `https://flow-content.google/image/${flowContentId}`,
      permission: "https://flow-content.google/*",
      mediaId: flowContentId,
    });
    expect(() =>
      flowReferenceResource(
        flowContentUrl,
        "00000000-0000-4000-8000-000000000000",
      ),
    ).toThrow("reference_media_id_mismatch");
    expect(() =>
      flowReferenceResource(
        `https://flow-content.google.evil.test/image/${flowContentId}`,
        flowContentId,
      ),
    ).toThrow("reference_origin_unsupported");
    expect(() =>
      flowReferenceResource(
        `https://flow-content.google/media/${flowContentId}`,
        flowContentId,
      ),
    ).toThrow("reference_media_id_missing_or_path_invalid");
  });

  it("fetches approved cross-origin bytes exactly and requires permission", async () => {
    const fetcher = vi.fn(async () => response(approved, webp));
    const result = await fetchFlowReferenceBytes({
      url: approved,
      signal: new AbortController().signal,
      hasPermission: allowed,
      fetcher,
    });
    expect(result.bytes).toEqual(webp);
    expect(result.mimeType).toBe("image/webp");
    expect(flowReferenceSignatureValid(result.mimeType, result.bytes)).toBe(
      true,
    );
    expect(
      flowReferenceSignatureValid(result.mimeType, new Uint8Array([1, 2, 3])),
    ).toBe(false);
    expect(fetcher).toHaveBeenCalledWith(
      approved,
      expect.objectContaining({
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("distinguishes missing and rejected permission inspection", async () => {
    await expect(
      fetchFlowReferenceBytes({
        url: approved,
        signal: new AbortController().signal,
        hasPermission: async () => false,
        fetcher: vi.fn(),
      }),
    ).rejects.toThrow("reference_media_permission_needed");
    await expect(
      fetchFlowReferenceBytes({
        url: approved,
        signal: new AbortController().signal,
        hasPermission: async () => {
          throw new Error();
        },
        fetcher: vi.fn(),
      }),
    ).rejects.toThrow("reference_permission_inspection_failed");
  });

  it("checks the exact Flow content host permission while fetching the complete signed URL", async () => {
    const hasPermission = vi.fn(async () => true);
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      response(String(url)),
    );
    await fetchFlowReferenceBytes({
      url: flowContentUrl,
      mediaId: flowContentId,
      signal: new AbortController().signal,
      hasPermission,
      fetcher,
    });
    expect(hasPermission).toHaveBeenCalledWith("https://flow-content.google/*");
    expect(fetcher).toHaveBeenCalledWith(flowContentUrl, expect.anything());
    await expect(
      fetchFlowReferenceBytes({
        url: flowContentUrl,
        mediaId: flowContentId,
        signal: new AbortController().signal,
        hasPermission: async () => false,
        fetcher,
      }),
    ).rejects.toThrow("reference_media_permission_needed");
  });

  it("rejects redirect destinations outside the approved host and reports expired signed URLs", async () => {
    await expect(
      fetchFlowReferenceBytes({
        url: approved,
        signal: new AbortController().signal,
        hasPermission: allowed,
        fetcher: async () => response("https://evil.example/redirect"),
      }),
    ).rejects.toThrow("reference_redirect_unsupported");
    await expect(
      fetchFlowReferenceBytes({
        url: approved,
        signal: new AbortController().signal,
        hasPermission: allowed,
        fetcher: async () => response(approved, webp, 403),
      }),
    ).rejects.toThrow("reference_resource_expired");
  });

  it("rejects invalid or oversized responses and honors cancellation", async () => {
    await expect(
      fetchFlowReferenceBytes({
        url: approved,
        signal: new AbortController().signal,
        hasPermission: allowed,
        fetcher: async () => response(approved, webp, 200, "text/html"),
      }),
    ).rejects.toThrow("reference_format_unsupported");
    await expect(
      fetchFlowReferenceBytes({
        url: approved,
        signal: new AbortController().signal,
        hasPermission: allowed,
        fetcher: async () =>
          response(approved, new Uint8Array(32), 200, "image/webp"),
        maxBytes: 16,
      }),
    ).rejects.toThrow("reference_resource_oversized");
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchFlowReferenceBytes({
        url: approved,
        signal: controller.signal,
        hasPermission: allowed,
        fetcher: vi.fn(),
      }),
    ).rejects.toThrow("reference_capture_cancelled");
    const reading = new AbortController();
    let started!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hangingFetcher = async () => {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          started();
        },
      });
      const result = new Response(body, {
        headers: { "content-type": "image/webp" },
      });
      Object.defineProperty(result, "url", { value: approved });
      return result;
    };
    const pending = fetchFlowReferenceBytes({
      url: approved,
      signal: reading.signal,
      hasPermission: allowed,
      fetcher: hangingFetcher,
    });
    await bodyStarted;
    reading.abort();
    await expect(pending).rejects.toThrow("reference_capture_cancelled");
  });
});
