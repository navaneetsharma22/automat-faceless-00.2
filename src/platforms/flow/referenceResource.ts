/** Narrow media-resource policy for Flow gallery references. */
export const FLOW_REFERENCE_MEDIA_HOST = "lh3.googleusercontent.com";
export const FLOW_REFERENCE_MEDIA_PERMISSION = `https://${FLOW_REFERENCE_MEDIA_HOST}/*`;
export const FLOW_CONTENT_MEDIA_HOST = "flow-content.google";
export const FLOW_CONTENT_MEDIA_PERMISSION = `https://${FLOW_CONTENT_MEDIA_HOST}/*`;
export const FLOW_REFERENCE_MEDIA_MAX_BYTES = 12 * 1024 * 1024;

export function flowReferenceSignatureValid(
  mimeType: string,
  bytes: Uint8Array,
): boolean {
  return mimeType === "image/jpeg"
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === "image/png"
      ? bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
      : mimeType === "image/webp"
        ? String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
        : mimeType === "image/gif"
          ? ["GIF87a", "GIF89a"].includes(
              String.fromCharCode(...bytes.subarray(0, 6)),
            )
          : mimeType === "image/avif"
            ? String.fromCharCode(...bytes.subarray(4, 12)).includes("ftyp") &&
              String.fromCharCode(...bytes.subarray(8, 16)).includes("avif")
            : false;
}

export type FlowReferenceResource = {
  fetchUrl: string;
  resourceKey: string;
  permission: string;
  mediaId?: string;
};

/** Preserve the platform fetch receiver when production passes fetch as a value. */
export function resolveFlowReferenceFetcher(
  customFetcher?: typeof fetch,
): typeof fetch {
  return customFetcher ?? globalThis.fetch.bind(globalThis);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function flowReferenceResource(
  input: string,
  expectedMediaId?: string,
): FlowReferenceResource {
  if (typeof input !== "string" || input.length > 4096)
    throw new Error("reference_source_invalid");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("reference_source_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("reference_origin_unsupported");
  if (
    url.hostname !== FLOW_REFERENCE_MEDIA_HOST &&
    url.hostname !== FLOW_CONTENT_MEDIA_HOST
  )
    throw new Error("reference_origin_unsupported");
  let mediaId: string | undefined;
  if (url.hostname === FLOW_CONTENT_MEDIA_HOST) {
    const match =
      /^\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
        url.pathname,
      );
    if (!match || !UUID_PATTERN.test(expectedMediaId ?? ""))
      throw new Error("reference_media_id_missing_or_path_invalid");
    mediaId = match[1]!.toLowerCase();
    if (mediaId !== expectedMediaId!.toLowerCase())
      throw new Error("reference_media_id_mismatch");
  }
  url.hash = "";
  const stable = new URL(url.href);
  stable.search = "";
  return {
    fetchUrl: url.href,
    resourceKey: stable.href,
    permission: `https://${url.hostname}/*`,
    ...(mediaId ? { mediaId } : {}),
  };
}

export function sameFlowReferenceResource(
  left: string,
  right: string,
  expectedMediaId?: string,
): boolean {
  try {
    return (
      flowReferenceResource(left, expectedMediaId).resourceKey ===
      flowReferenceResource(right, expectedMediaId).resourceKey
    );
  } catch {
    return false;
  }
}

export async function decodeFlowReferenceImage(
  bytes: Uint8Array,
  mimeType: string,
  signal: AbortSignal,
): Promise<ImageBitmap> {
  if (signal.aborted) throw new Error("reference_capture_cancelled");
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const decoded = createImageBitmap(
    new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType }),
  ).then((bitmap) => {
    if (signal.aborted || timedOut) bitmap.close();
    return bitmap;
  });
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () =>
      reject(
        new Error(
          timedOut
            ? "reference_resource_timeout"
            : "reference_capture_cancelled",
        ),
      );
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("reference_resource_timeout"));
    }, 20_000);
  });
  try {
    return await Promise.race([decoded, aborted]);
  } catch (error) {
    void decoded.catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchFlowReferenceBytes(input: {
  url: string;
  mediaId?: string;
  signal: AbortSignal;
  hasPermission: (permission: string) => Promise<boolean>;
  fetcher: typeof fetch;
  maxBytes?: number;
}): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const resource = flowReferenceResource(input.url, input.mediaId);
  let permitted: boolean;
  try {
    permitted = await input.hasPermission(resource.permission);
  } catch {
    throw new Error("reference_permission_inspection_failed");
  }
  if (!permitted) throw new Error("reference_media_permission_needed");
  if (input.signal.aborted) throw new Error("reference_capture_cancelled");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20_000);
  const onCallerAbort = () => controller.abort();
  input.signal.addEventListener("abort", onCallerAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await input.fetcher(resource.fetchUrl, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
    } catch {
      if (timedOut) throw new Error("reference_resource_timeout");
      if (input.signal.aborted) throw new Error("reference_capture_cancelled");
      throw new Error("reference_resource_transport_failed");
    }
    let finalResource: FlowReferenceResource;
    try {
      finalResource = flowReferenceResource(response.url, resource.mediaId);
    } catch {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("reference_redirect_unsupported");
    }
    if (finalResource.permission !== resource.permission) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("reference_redirect_unsupported");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        [401, 403, 404, 410].includes(response.status)
          ? "reference_resource_expired"
          : "reference_resource_http_failed",
      );
    }
    const mimeType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (
      !mimeType ||
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/avif",
        "image/gif",
      ].includes(mimeType)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("reference_format_unsupported");
    }
    const limit = input.maxBytes ?? FLOW_REFERENCE_MEDIA_MAX_BYTES;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("reference_resource_oversized");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("reference_resource_empty");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            ),
          ),
        ]);
      } catch {
        await reader.cancel().catch(() => undefined);
        if (timedOut) throw new Error("reference_resource_timeout");
        if (input.signal.aborted)
          throw new Error("reference_capture_cancelled");
        throw new Error("reference_resource_transport_failed");
      }
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("reference_resource_oversized");
      }
      chunks.push(part.value);
    }
    if (!length) throw new Error("reference_resource_empty");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, mimeType };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", onCallerAbort);
  }
}
