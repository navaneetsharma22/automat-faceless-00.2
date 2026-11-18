/**
 * Worker-side identity parser and matcher for Flow media assets.
 *
 * Flow represents media assets through two distinct URL families:
 * 1. Legacy direct content host: https://flow-content.google/image/<uuid>
 * 2. Same-origin project/gallery token: https://flow.google.com/asb/<token>[=s<digits>[-rw]]
 *
 * Injected content scripts (e.g. flowResolveOriginalImageUrlInPage,
 * flowVideoAttachmentActionInPage, inspectFlowVideoReferenceInPage) cannot
 * import external functions and must inline equivalent logic.
 */

const FLOW_CONTENT_MEDIA_ID_RE =
  /^\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const ASB_TOKEN_CHARS_RE = /^[A-Za-z0-9_-]+$/;
const ASB_SUFFIX_RE = /^=s\d+(-rw)?$/;
const UUID_EXACT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FlowMediaIdentity =
  | { kind: "media"; mediaId: string; key: `media:${string}` }
  | { kind: "asb"; token: string; key: `asb:${string}` };

/**
 * Extracts the canonical lowercase media UUID from a flow-content.google URL.
 * Rejects userinfo, non-443 ports, non-exact paths, and other hosts.
 */
export function flowMediaIdFromImageUrl(raw: string | undefined): string | undefined {
  if (!raw || raw.length > 4096) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "flow-content.google" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return undefined;
    const match = FLOW_CONTENT_MEDIA_ID_RE.exec(url.pathname);
    return match?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Extracts the exact case-sensitive token from a flow.google.com/asb URL.
 * Only accepts https://flow.google.com/asb/<token> with optional =s<digits> or =s<digits>-rw suffix.
 * Token must contain only [A-Za-z0-9_-]+ and be at most 2048 characters.
 * Rejects userinfo, non-443 ports, other hosts, extra path segments, and other suffix shapes.
 */
export function flowAsbTokenFromImageUrl(raw: string | undefined): string | undefined {
  if (!raw || raw.length > 4096) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "flow.google.com" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return undefined;
    let pathname = url.pathname;
    const acctMatch = /^\/u\/\d+(\/.*)$/.exec(pathname);
    if (acctMatch) pathname = acctMatch[1]!;
    if (!pathname.startsWith("/asb/")) return undefined;
    const rest = pathname.slice("/asb/".length);
    if (!rest || rest.includes("/")) return undefined;
    const eqIndex = rest.indexOf("=");
    const token = eqIndex === -1 ? rest : rest.slice(0, eqIndex);
    const suffix = eqIndex === -1 ? "" : rest.slice(eqIndex);
    if (!token || token.length > 2048 || !ASB_TOKEN_CHARS_RE.test(token))
      return undefined;
    if (suffix && !ASB_SUFFIX_RE.test(suffix)) return undefined;
    return token;
  } catch {
    return undefined;
  }
}

/**
 * Classifies an image URL into a Flow media identity ({ kind: "media" | "asb", key }) or undefined.
 */
export function flowMediaIdentityFromImageUrl(
  raw: string | undefined,
): FlowMediaIdentity | undefined {
  const mediaId = flowMediaIdFromImageUrl(raw);
  if (mediaId) {
    return { kind: "media", mediaId, key: `media:${mediaId}` };
  }
  const token = flowAsbTokenFromImageUrl(raw);
  if (token) {
    return { kind: "asb", token, key: `asb:${token}` };
  }
  return undefined;
}

/**
 * Collects recognized identity keys only (media:... or asb:...) from a list of URLs.
 * Ignores badge/icon/unknown URLs.
 */
export function flowMediaIdentityKeysFromUrls(
  urls: Iterable<string | undefined>,
): Set<string> {
  const keys = new Set<string>();
  for (const url of urls) {
    const identity = flowMediaIdentityFromImageUrl(url);
    if (identity) keys.add(identity.key);
  }
  return keys;
}

/**
 * Constructs the expected identity keys Set for a reference item.
 * Includes "media:<lowercased uuid>" when mediaId is a valid UUID,
 * and "asb:<token>" when asbToken is present and valid.
 */
export function flowExpectedMediaIdentityKeys(input: {
  mediaId?: string;
  asbToken?: string;
}): Set<string> {
  const expected = new Set<string>();
  if (input.mediaId && UUID_EXACT_RE.test(input.mediaId)) {
    expected.add(`media:${input.mediaId.toLowerCase()}`);
  }
  if (input.asbToken && ASB_TOKEN_CHARS_RE.test(input.asbToken) && input.asbToken.length <= 2048) {
    expected.add(`asb:${input.asbToken}`);
  }
  return expected;
}

/**
 * Evaluates whether all recognized identities on an element match the expected identities.
 * Strict rule:
 * - At least one recognized key must be present (keys.size > 0).
 * - Every recognized key must be in the expected set.
 * - An extra or differing recognized key fails the check.
 */
export function flowMediaIdentitiesMatchExpected(
  urls: Iterable<string | undefined>,
  expected: Set<string>,
): { ok: boolean; keys: Set<string> } {
  const keys = flowMediaIdentityKeysFromUrls(urls);
  if (keys.size === 0) return { ok: false, keys };
  for (const key of keys) {
    if (!expected.has(key)) return { ok: false, keys };
  }
  return { ok: true, keys };
}
