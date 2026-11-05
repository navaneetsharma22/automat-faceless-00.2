import { z } from "zod";
import { FlowClipThumbnailMetadataSchema } from "../../domain/media/flowClipImport";

export const FlowClipPageMetadataSchema = z
  .object({
    projectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    clipId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    title: z.string().max(200),
    thumbnail: FlowClipThumbnailMetadataSchema,
  })
  .strict();

/** Read only metadata already present in the current Flow document; never fetch media. */
export async function inspectCurrentFlowClipInPage(): Promise<unknown> {
  let url: URL;
  try {
    url = new URL(location.href);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "flow.google.com" ||
    url.username ||
    url.password
  )
    return undefined;
  const route =
    /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/edit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
      url.pathname,
    );
  if (!route) return undefined;
  const projectId = route[1]!;
  const clipId = route[2]!.toLowerCase();
  const cleanTitle = (value: string | null | undefined) =>
    (value ?? "")
      .replace(/\s+/g, " ")
      .replace(/\s*[|–—-]\s*Google Flow\s*$/i, "")
      .trim()
      .slice(0, 200);
  const title =
    cleanTitle(document.querySelector("h1")?.textContent) ||
    cleanTitle(
      document.querySelector<HTMLMetaElement>('meta[property="og:title"]')
        ?.content,
    ) ||
    cleanTitle(document.title);

  const candidates = [...document.images]
    .map((image) => {
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      const source = image.currentSrc || image.src;
      if (
        !image.isConnected ||
        !source ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width < 32 ||
        rect.height < 32
      )
        return undefined;
      try {
        const imageUrl = new URL(source);
        if (
          !["https:", "http:"].includes(imageUrl.protocol) ||
          imageUrl.username ||
          imageUrl.password
        )
          return undefined;
        return {
          imageUrl,
          area: rect.width * rect.height,
          width: Math.max(0, Math.round(image.naturalWidth || rect.width)),
          height: Math.max(0, Math.round(image.naturalHeight || rect.height)),
        };
      } catch {
        return undefined;
      }
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    )
    .sort((left, right) => right.area - left.area);
  const thumbnail = candidates[0];
  let thumbnailFingerprint: string | undefined;
  if (thumbnail) {
    try {
      const identity = `${thumbnail.imageUrl.origin}${thumbnail.imageUrl.pathname}`;
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          `flow-clip-thumbnail\n${projectId}\n${clipId}\n${identity}`,
        ),
      );
      thumbnailFingerprint = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    } catch {
      thumbnailFingerprint = undefined;
    }
  }
  return {
    projectId,
    clipId,
    title,
    thumbnail: {
      available: Boolean(thumbnail),
      ...(thumbnail
        ? {
            width: thumbnail.width,
            height: thumbnail.height,
          }
        : {}),
      ...(thumbnailFingerprint ? { fingerprint: thumbnailFingerprint } : {}),
    },
  };
}
