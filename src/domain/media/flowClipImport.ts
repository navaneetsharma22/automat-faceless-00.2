import { z } from "zod";

export const FlowClipThumbnailMetadataSchema = z
  .object({
    available: z.boolean(),
    width: z.number().int().nonnegative().max(100_000).optional(),
    height: z.number().int().nonnegative().max(100_000).optional(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();

export type FlowClipImportRecord = {
  id: string;
  projectId: string;
  clipId: string;
  title: string;
  detailUrl: string;
  thumbnail: FlowClipThumbnailMetadata;
  importedAt: number;
  updatedAt: number;
};

export const FlowClipImportRecordSchema: z.ZodType<FlowClipImportRecord> = z
  .object({
    id: z.string().min(1).max(300),
    projectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    clipId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    title: z.string().max(200),
    detailUrl: z.string().url().max(2048),
    thumbnail: FlowClipThumbnailMetadataSchema,
    importedAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (record) => record.id === flowClipImportId(record.projectId, record.clipId),
    { message: "clip_import_key_must_match_identity" },
  )
  .refine((record) => flowClipImportRouteMatches(record), {
    message: "clip_import_route_must_match_identity",
  });

export type FlowClipThumbnailMetadata = z.infer<
  typeof FlowClipThumbnailMetadataSchema
>;
export function flowClipImportId(projectId: string, clipId: string) {
  return `flow:${projectId}:${clipId.toLowerCase()}`;
}

export function flowClipDetailIdentityFromUrl(rawUrl: string):
  | { projectId: string; clipId: string; detailUrl: string }
  | undefined {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "flow.google.com" ||
      url.username ||
      url.password
    )
      return;
    const match =
      /^\/(?:u\/[0-9]+\/)?project\/([A-Za-z0-9_-]+)\/edit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
        url.pathname,
      );
    if (!match) return;
    return {
      projectId: match[1]!,
      clipId: match[2]!.toLowerCase(),
      detailUrl: `${url.origin}${url.pathname}`,
    };
  } catch {
    return;
  }
}

export function flowClipImportRouteMatches(
  record: Pick<FlowClipImportRecord, "projectId" | "clipId" | "detailUrl">,
) {
  try {
    const identity = flowClipDetailIdentityFromUrl(record.detailUrl);
    if (!identity || new URL(record.detailUrl).search || new URL(record.detailUrl).hash)
      return false;
    return Boolean(
      identity.projectId === record.projectId &&
        identity.clipId === record.clipId.toLowerCase(),
    );
  } catch {
    return false;
  }
}
