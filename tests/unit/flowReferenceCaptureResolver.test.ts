// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { flowReferenceCaptureResolver } from "../../src/platforms/flow/references";

function setupDom(cardsHtml: string) {
  document.body.innerHTML = `
    <flow-project-page>
      <div class="gallery-container">
        ${cardsHtml}
      </div>
    </flow-project-page>
  `;
  for (const el of document.querySelectorAll("*")) {
    (el as HTMLElement).getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      top: 0,
      left: 0,
      bottom: 100,
      right: 100,
      toJSON: () => ({}),
    });
  }
}

describe("flowReferenceCaptureResolver in verified Flow document", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("accepts same Flow asset across different ASB size suffixes (=s1600-rw in DOM, plain in expected)", () => {
    setupDom(`
      <flow-image-tile>
        <img
          src="https://flow.google.com/asb/token-dunes-123=s1600-rw"
          data-media-id="5a836a9f-197d-4400-aa12-2d4c7492a444"
        />
      </flow-image-tile>
    `);
    const img = document.querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { value: 1376 });
    Object.defineProperty(img, "naturalHeight", { value: 768 });

    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow.google.com/asb/token-dunes-123",
      providerAssetId: "5a836a9f-197d-4400-aa12-2d4c7492a444",
      cardTag: "flow-image-tile",
      naturalWidth: 1376,
      naturalHeight: 768,
    });

    expect(result.ok).toBe(true);
    expect(result.candidate).toMatchObject({
      sourceUrl: "https://flow.google.com/asb/token-dunes-123=s1600-rw",
      providerAssetId: "5a836a9f-197d-4400-aa12-2d4c7492a444",
      cardTag: "flow-image-tile",
      naturalWidth: 1376,
      naturalHeight: 768,
    });
    expect(result.diagnostic).toMatchObject({
      expectedIdentityKind: "asb",
      observedIdentityKind: "asb",
      sameCanonicalAsbToken: true,
      sameMediaUuid: false,
      cardCount: 1,
      visibleCandidateCount: 1,
      sameCardTag: true,
      dimensionsKnown: true,
      dimensionsMatch: true,
      sourceNormalizedEquivalent: true,
      candidateVisible: true,
    });
  });

  it("accepts same Flow asset when expected has =s0 and DOM has =s1600-rw", () => {
    setupDom(`
      <flow-image-tile>
        <img
          src="https://flow.google.com/asb/token-dunes-123=s1600-rw"
          data-media-id="5a836a9f-197d-4400-aa12-2d4c7492a444"
        />
      </flow-image-tile>
    `);
    const img = document.querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { value: 1376 });
    Object.defineProperty(img, "naturalHeight", { value: 768 });

    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow.google.com/asb/token-dunes-123=s0",
      providerAssetId: "5a836a9f-197d-4400-aa12-2d4c7492a444",
      cardTag: "flow-image-tile",
      naturalWidth: 1376,
      naturalHeight: 768,
    });

    expect(result.ok).toBe(true);
    expect(result.candidate).toBeDefined();
  });

  it("accepts same ASB token with /u/2 account prefix in DOM and without prefix in expected", () => {
    setupDom(`
      <flow-image-tile>
        <img
          src="https://flow.google.com/u/2/asb/token-dunes-123=s1600-rw"
          data-media-id="5a836a9f-197d-4400-aa12-2d4c7492a444"
        />
      </flow-image-tile>
    `);
    const img = document.querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { value: 1376 });
    Object.defineProperty(img, "naturalHeight", { value: 768 });

    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow.google.com/asb/token-dunes-123",
      providerAssetId: "5a836a9f-197d-4400-aa12-2d4c7492a444",
      cardTag: "flow-image-tile",
      naturalWidth: 1376,
      naturalHeight: 768,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a card with a different ASB token (capture_candidate_missing_or_changed)", () => {
    setupDom(`
      <flow-image-tile>
        <img
          src="https://flow.google.com/asb/token-different-456=s1600-rw"
          data-media-id="5a836a9f-197d-4400-aa12-2d4c7492a444"
        />
      </flow-image-tile>
    `);

    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow.google.com/asb/token-dunes-123",
      providerAssetId: "5a836a9f-197d-4400-aa12-2d4c7492a444",
      cardTag: "flow-image-tile",
      naturalWidth: 1376,
      naturalHeight: 768,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("capture_candidate_missing_or_changed");
    expect((result.diagnostic as Record<string, unknown>).sameCanonicalAsbToken).toBe(false);
  });

  it("rejects when expected flow-content UUID differs from DOM flow-content UUID", () => {
    setupDom(`
      <flow-image-tile>
        <img
          src="https://flow-content.google/image/00000000-0000-4000-8000-000000000002"
          data-media-id="00000000-0000-4000-8000-000000000002"
        />
      </flow-image-tile>
    `);

    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow-content.google/image/00000000-0000-4000-8000-000000000001",
      providerAssetId: "00000000-0000-4000-8000-000000000001",
      cardTag: "flow-image-tile",
      naturalWidth: 1024,
      naturalHeight: 1024,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("capture_candidate_missing_or_changed");
    expect((result.diagnostic as Record<string, unknown>).sameMediaUuid).toBe(false);
  });

  it("rejects when expected gallery asset is missing from DOM", () => {
    setupDom(`
      <flow-image-tile>
        <img
          src="https://flow.google.com/asb/token-unrelated=s400"
          data-media-id="asset-unrelated"
        />
      </flow-image-tile>
    `);

    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow.google.com/asb/token-target",
      providerAssetId: "asset-target",
      cardTag: "flow-image-tile",
      naturalWidth: 512,
      naturalHeight: 512,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("capture_candidate_missing_or_changed");
  });

  it("rejects when multiple cards contain the same expected ASB token (capture_candidate_ambiguous)", () => {
    setupDom(`
      <flow-image-tile>
        <img
          src="https://flow.google.com/asb/token-duplicate=s400"
          data-media-id="asset-dup"
        />
      </flow-image-tile>
      <flow-image-tile>
        <img
          src="https://flow.google.com/asb/token-duplicate=s800"
          data-media-id="asset-dup"
        />
      </flow-image-tile>
    `);

    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow.google.com/asb/token-duplicate",
      providerAssetId: "asset-dup",
      cardTag: "flow-image-tile",
      naturalWidth: 0,
      naturalHeight: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("capture_candidate_ambiguous");
  });

  it("accepts matching asset when natural dimensions were 0 at discovery but decoded in DOM", () => {
    setupDom(`
      <flow-image-tile>
        <img
          src="https://flow.google.com/asb/token-dunes-123=s1600-rw"
          data-media-id="5a836a9f-197d-4400-aa12-2d4c7492a444"
        />
      </flow-image-tile>
    `);
    const img = document.querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { value: 1376 });
    Object.defineProperty(img, "naturalHeight", { value: 768 });

    // Discovery had 0 dimensions (not yet loaded at list time)
    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow.google.com/asb/token-dunes-123",
      providerAssetId: "5a836a9f-197d-4400-aa12-2d4c7492a444",
      cardTag: "flow-image-tile",
      naturalWidth: 0,
      naturalHeight: 0,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects when providerAssetId differs", () => {
    setupDom(`
      <flow-image-tile>
        <img
          src="https://flow.google.com/asb/token-dunes-123=s1600-rw"
          data-media-id="00000000-0000-4000-8000-000000000099"
        />
      </flow-image-tile>
    `);

    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow.google.com/asb/token-dunes-123",
      providerAssetId: "5a836a9f-197d-4400-aa12-2d4c7492a444",
      cardTag: "flow-image-tile",
      naturalWidth: 1376,
      naturalHeight: 768,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("capture_candidate_missing_or_changed");
  });

  it("accepts providerAssetId case-insensitively for UUIDs", () => {
    setupDom(`
      <flow-image-tile>
        <img
          src="https://flow.google.com/asb/token-dunes-123=s1600-rw"
          data-media-id="5a836a9f-197d-4400-aa12-2d4c7492a444"
        />
      </flow-image-tile>
    `);

    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow.google.com/asb/token-dunes-123",
      providerAssetId: "5A836A9F-197D-4400-AA12-2D4C7492A444",
      cardTag: "flow-image-tile",
      naturalWidth: 0,
      naturalHeight: 0,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects when cardTag differs", () => {
    setupDom(`
      <div role="listitem">
        <img
          src="https://flow.google.com/asb/token-dunes-123=s1600-rw"
          data-media-id="5a836a9f-197d-4400-aa12-2d4c7492a444"
        />
      </div>
    `);

    const result = flowReferenceCaptureResolver({
      sourceUrl: "https://flow.google.com/asb/token-dunes-123",
      providerAssetId: "5a836a9f-197d-4400-aa12-2d4c7492a444",
      cardTag: "flow-image-tile",
      naturalWidth: 0,
      naturalHeight: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("capture_candidate_missing_or_changed");
  });
});
