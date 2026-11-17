import { describe, expect, it } from "vitest";
import {
  flowAsbTokenFromImageUrl,
  flowExpectedMediaIdentityKeys,
  flowMediaIdFromImageUrl,
  flowMediaIdentitiesMatchExpected,
  flowMediaIdentityFromImageUrl,
  flowMediaIdentityKeysFromUrls,
} from "../../src/platforms/flow/mediaIdentity";

describe("Flow media identity parser (Section 9.A)", () => {
  it("treats same /asb token with =s0, =s1600-rw, and no suffix as equal", () => {
    const rawNoSuffix = "https://flow.google.com/asb/token_Alpha_123-abc";
    const rawS0 = "https://flow.google.com/asb/token_Alpha_123-abc=s0";
    const rawS1600rw = "https://flow.google.com/asb/token_Alpha_123-abc=s1600-rw";

    const t1 = flowAsbTokenFromImageUrl(rawNoSuffix);
    const t2 = flowAsbTokenFromImageUrl(rawS0);
    const t3 = flowAsbTokenFromImageUrl(rawS1600rw);

    expect(t1).toBe("token_Alpha_123-abc");
    expect(t2).toBe("token_Alpha_123-abc");
    expect(t3).toBe("token_Alpha_123-abc");
    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
  });

  it("distinguishes different /asb tokens as not equal", () => {
    const t1 = flowAsbTokenFromImageUrl("https://flow.google.com/asb/token_A=s0");
    const t2 = flowAsbTokenFromImageUrl("https://flow.google.com/asb/token_B=s0");

    expect(t1).toBe("token_A");
    expect(t2).toBe("token_B");
    expect(t1).not.toBe(t2);
  });

  it("still parses legacy flow-content /image/<uuid>", () => {
    const uuid = "2f205c4a-8c9f-4a58-abc2-2d4c7492a444";
    const raw = `https://flow-content.google/image/${uuid}?sig=ephemeral`;

    expect(flowMediaIdFromImageUrl(raw)).toBe(uuid);
    expect(flowMediaIdentityFromImageUrl(raw)).toEqual({
      kind: "media",
      mediaId: uuid,
      key: `media:${uuid}`,
    });
  });

  it("rejects wrong host, credentials, non-443 port, extra path segment, malformed suffix, and blob:/data: URLs", () => {
    // wrong host
    expect(flowAsbTokenFromImageUrl("https://not-flow.google.com/asb/validtoken")).toBeUndefined();
    expect(flowMediaIdFromImageUrl("https://not-flow-content.google/image/2f205c4a-8c9f-4a58-abc2-2d4c7492a444")).toBeUndefined();

    // credentials
    expect(flowAsbTokenFromImageUrl("https://user:pass@flow.google.com/asb/validtoken")).toBeUndefined();
    expect(flowMediaIdFromImageUrl("https://user:pass@flow-content.google/image/2f205c4a-8c9f-4a58-abc2-2d4c7492a444")).toBeUndefined();

    // non-443 port
    expect(flowAsbTokenFromImageUrl("https://flow.google.com:8443/asb/validtoken")).toBeUndefined();
    expect(flowMediaIdFromImageUrl("https://flow-content.google:8443/image/2f205c4a-8c9f-4a58-abc2-2d4c7492a444")).toBeUndefined();

    // extra path segment
    expect(flowAsbTokenFromImageUrl("https://flow.google.com/asb/validtoken/extra")).toBeUndefined();
    expect(flowMediaIdFromImageUrl("https://flow-content.google/image/2f205c4a-8c9f-4a58-abc2-2d4c7492a444/extra")).toBeUndefined();

    // malformed suffix
    expect(flowAsbTokenFromImageUrl("https://flow.google.com/asb/validtoken=other")).toBeUndefined();
    expect(flowAsbTokenFromImageUrl("https://flow.google.com/asb/validtoken=w800")).toBeUndefined();
    expect(flowAsbTokenFromImageUrl("https://flow.google.com/asb/validtoken=s")).toBeUndefined();
    expect(flowAsbTokenFromImageUrl("https://flow.google.com/asb/validtoken.webp")).toBeUndefined();

    // blob: and data: URLs
    expect(flowAsbTokenFromImageUrl("blob:https://flow.google.com/12345")).toBeUndefined();
    expect(flowAsbTokenFromImageUrl("data:image/png;base64,AAAA")).toBeUndefined();
    expect(flowMediaIdFromImageUrl("blob:https://flow.google.com/12345")).toBeUndefined();
    expect(flowMediaIdFromImageUrl("data:image/png;base64,AAAA")).toBeUndefined();
  });

  it("matches a chip with one expected /asb image plus a gstatic badge image", () => {
    const token = "pinned_token_999";
    const expected = flowExpectedMediaIdentityKeys({ asbToken: token });
    const urls = [
      "https://www.gstatic.com/flow/ingredient-badge.png",
      `https://flow.google.com/asb/${token}=s1600-rw`,
    ];

    const result = flowMediaIdentitiesMatchExpected(urls, expected);
    expect(result.ok).toBe(true);
    expect(result.keys).toEqual(new Set([`asb:${token}`]));
  });

  it("fails a chip with expected and different recognized identities", () => {
    const tokenA = "pinned_token_A";
    const tokenB = "different_token_B";
    const expected = flowExpectedMediaIdentityKeys({ asbToken: tokenA });
    const urls = [
      `https://flow.google.com/asb/${tokenA}=s1600-rw`,
      `https://flow.google.com/asb/${tokenB}=s1600-rw`,
    ];

    const result = flowMediaIdentitiesMatchExpected(urls, expected);
    expect(result.ok).toBe(false);
    expect(result.keys.has(`asb:${tokenB}`)).toBe(true);
  });

  it("reports no recognized identity for a chip with only unknown URLs", () => {
    const urls = [
      "https://www.gstatic.com/flow/badge.png",
      "https://example.com/other.jpg",
    ];

    const keys = flowMediaIdentityKeysFromUrls(urls);
    expect(keys.size).toBe(0);

    const expected = flowExpectedMediaIdentityKeys({ asbToken: "any_token" });
    const match = flowMediaIdentitiesMatchExpected(urls, expected);
    expect(match.ok).toBe(false);
    expect(match.keys.size).toBe(0);
  });
});
