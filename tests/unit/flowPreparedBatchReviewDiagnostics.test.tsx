/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowPreparedBatchReview } from "../../src/app/features/video-batch/FlowPreparedBatchReview";
import type { PreparedVideoBatchRecord } from "../../src/domain/batches/types";
import type { ReferenceByteComparisonDiagnostic } from "../../src/domain/media/references";
import type { FoundationClient } from "../../src/shared/messageClient";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

const preparedBatch: PreparedVideoBatchRecord = {
  id: "prepared-batch-1",
  requestId: "req-1",
  workspaceId: "ws-1",
  preparedAt: 1000,
  videoBatchId: "v-batch-1",
  videoSourceHash: "v-hash-1",
  videoSourceText: "{}",
  imageSourceBatchId: "img-batch-1",
  imageSourceBatchHash: "img-hash-1",
  destination: "Flow",
  target: {
    provider: "Flow",
    tabId: 1,
    canonicalTarget: "https://flow.google.com/project/p1",
    projectId: "p1",
    documentId: "doc-1",
    verification: "verified",
    verifiedAt: 1000,
  },
  manualSettingsDeclaration: {
    confirmationId: "conf-1",
    confirmedAt: 1000,
    destination: "Flow",
    declaredDurationSeconds: 5,
    tabId: 1,
    canonicalTarget: "https://flow.google.com/project/p1",
    projectId: "p1",
    documentId: "doc-1",
    userAttested: true,
  },
  status: "prepared",
  itemCount: 1,
  items: [
    {
      itemId: "item-1",
      order: 0,
      shotId: "1",
      canonicalShotId: "1",
      rawJsonBody: "{}",
      contentHash: "hash-shot-1",
      sourceSpan: { start: 0, end: 2 },
      reference: {
        referenceId: "a22f6884-eb16-46ec-a49d-3b99aa713782",
        assignmentVersion: 1,
        sha256: "cf9948f46b596329f7f7829829fca4096af23a257b3d36011af6876795118b2b",
        mimeType: "image/webp",
        byteSize: 271916,
        width: 1376,
        height: 768,
        capturedAt: 1000,
      },
    },
  ],
  createdAt: 1000,
  updatedAt: 1000,
};

describe("FlowPreparedBatchReview diagnostics presentation", () => {
  it("renders attempted representation, representation failure reason, and fallback diagnostics in fresh reference inspection", async () => {
    const queueData = {
      queueId: "flow-video:prepared-batch-1",
      preparedBatchId: "prepared-batch-1",
      state: "paused",
      pauseReason: "candidate_bytes_mismatch",
      nextActionAt: null,
      revision: 1,
      items: [
        {
          itemId: "item-1",
          order: 0,
          shotId: "1",
          referenceId: "a22f6884-eb16-46ec-a49d-3b99aa713782",
          promptHash: "hash-shot-1",
          state: "failed",
          reason: "candidate_bytes_mismatch",
        },
      ],
    };

    const freshDiagnostic: ReferenceByteComparisonDiagnostic = {
      stage: "read_only_reference_inspection",
      acquisitionRoute: "verified_document_same_origin",
      preparedSha256: "cf9948f46b596329f7f7829829fca4096af23a257b3d36011af6876795118b2b",
      metadataSha256: "cf9948f46b596329f7f7829829fca4096af23a257b3d36011af6876795118b2b",
      savedBytesSha256: "cf9948f46b596329f7f7829829fca4096af23a257b3d36011af6876795118b2b",
      candidateBytesSha256: "e7d89cf28c51990f698f98456c4c0f4285a6627ac843ba7b444386ad3e6f9769",
      candidateMediaId: "a22f6884-eb16-46ec-a49d-3b99aa713782",
      mimeType: "image/jpeg",
      preparedByteSize: 271916,
      savedByteSize: 271916,
      candidateByteSize: 337691,
      preparedWidth: 1376,
      preparedHeight: 768,
      candidateWidth: 1376,
      candidateHeight: 768,
      attemptedRepresentation: "detail_original",
      representationFailureReason: "capture_http_403",
      fallbackDiagnostic: {
        attemptedRepresentation: "asb_webp_s1600_rw",
        sourceProvenance: "synthesized",
        fetchSucceeded: false,
        failureReason: "capture_http_403",
        httpStatus: 403,
        redirectOriginValid: true,
        observedRepresentations: [
          {
            sourceKind: "observed_detail_image",
            suffixCategory: "s0",
            representationKind: "full_resolution",
            identityVerified: true,
            hasAccountPrefix: false,
            matchingAsbToken: true,
            matchingMediaUuid: true,
            fetchSucceeded: true,
            httpStatus: 200,
            mimeType: "image/jpeg",
            byteLength: 337691,
            width: 1376,
            height: 768,
            sha256Matches: false,
          },
          {
            sourceKind: "synthesized_fallback",
            suffixCategory: "s1600_rw",
            representationKind: "synthesized",
            identityVerified: true,
            hasAccountPrefix: false,
            matchingAsbToken: true,
            matchingMediaUuid: true,
            fetchSucceeded: false,
            httpStatus: 403,
            failureReason: "capture_http_403",
            sha256Matches: false,
          },
        ],
      },
    };

    const mockClient = {
      request: vi.fn(async (method: string) => {
        if (method === "flow.videoQueue.get") return queueData;
        if (method === "flow.video.inspectReferenceBytes") {
          return {
            status: "inspected",
            matches: false,
            diagnostic: freshDiagnostic,
          };
        }
        return null;
      }),
    } as unknown as FoundationClient;

    await act(async () => {
      root!.render(
        createElement(FlowPreparedBatchReview, {
          preparedBatch,
          persistenceClient: mockClient,
        }),
      );
    });

    const inspectButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Inspect reference bytes"),
    );
    expect(inspectButton).toBeTruthy();

    await act(async () => {
      inspectButton!.click();
    });

    const text = container!.textContent ?? "";
    expect(text).toContain("Fetched bytes differ from the prepared reference");
    expect(text).toContain("Attempted representation");
    expect(text).toContain("detail_original");
    expect(text).toContain("Representation failure reason");
    expect(text).toContain("capture_http_403");
    expect(text).toContain("Fallback representation");
    expect(text).toContain("asb_webp_s1600_rw");
    expect(text).toContain("Fallback source provenance");
    expect(text).toContain("synthesized");
    expect(text).toContain("Fallback fetch succeeded");
    expect(text).toContain("false");
    expect(text).toContain("Fallback HTTP status");
    expect(text).toContain("403");
    expect(text).toContain("Fallback failure reason");
    expect(text).toContain("capture_http_403");
    expect(text).toContain("Fallback redirect origin valid");
    expect(text).toContain("true");
    expect(text).toContain("Observed representations");
    expect(text).toContain("observed_detail_image (s0): fetch true (HTTP 200), image/jpeg, 337691 B, 1376×768, hash matches: false");
    expect(text).toContain("synthesized_fallback (s1600_rw): fetch false (HTTP 403), hash matches: false");
    expect(text).toContain("Recovery guidance:");
    expect(text).toContain("Google Flow rejected the synthesized WebP representation (HTTP 403 Forbidden).");
  });

  it("renders persisted byteMismatchDiagnostic with attemptedRepresentation, representationFailureReason, and fallbackDiagnostic", async () => {
    const persistedDiagnostic: ReferenceByteComparisonDiagnostic = {
      stage: "candidate_byte_verification",
      acquisitionRoute: "verified_document_same_origin",
      preparedSha256: "cf9948f46b596329f7f7829829fca4096af23a257b3d36011af6876795118b2b",
      metadataSha256: "cf9948f46b596329f7f7829829fca4096af23a257b3d36011af6876795118b2b",
      savedBytesSha256: "cf9948f46b596329f7f7829829fca4096af23a257b3d36011af6876795118b2b",
      candidateBytesSha256: "e7d89cf28c51990f698f98456c4c0f4285a6627ac843ba7b444386ad3e6f9769",
      candidateMediaId: "a22f6884-eb16-46ec-a49d-3b99aa713782",
      mimeType: "image/jpeg",
      preparedByteSize: 271916,
      savedByteSize: 271916,
      candidateByteSize: 337691,
      preparedWidth: 1376,
      preparedHeight: 768,
      candidateWidth: 1376,
      candidateHeight: 768,
      attemptedRepresentation: "detail_original",
      representationFailureReason: "webp_sha256_mismatch",
      fallbackDiagnostic: {
        attemptedRepresentation: "asb_webp_s1600_rw",
        fetchSucceeded: true,
        mimeType: "image/webp",
        byteLength: 280000,
        sha256: "9999999999999999999999999999999999999999999999999999999999999999",
        sha256Matches: false,
        width: 1376,
        height: 768,
        redirectOriginValid: true,
      },
    };

    const queueData = {
      queueId: "flow-video:prepared-batch-1",
      preparedBatchId: "prepared-batch-1",
      state: "paused",
      pauseReason: "candidate_bytes_mismatch",
      nextActionAt: null,
      revision: 1,
      items: [
        {
          itemId: "item-1",
          order: 0,
          shotId: "1",
          referenceId: "a22f6884-eb16-46ec-a49d-3b99aa713782",
          promptHash: "hash-shot-1",
          state: "failed",
          reason: "candidate_bytes_mismatch",
          byteMismatchDiagnostic: persistedDiagnostic,
        },
      ],
    };

    const mockClient = {
      request: vi.fn(async (method: string) => {
        if (method === "flow.videoQueue.get") return queueData;
        return null;
      }),
    } as unknown as FoundationClient;

    await act(async () => {
      root!.render(
        createElement(FlowPreparedBatchReview, {
          preparedBatch,
          persistenceClient: mockClient,
        }),
      );
    });

    const text = container!.textContent ?? "";
    expect(text).toContain("Bounded candidate byte comparison");
    expect(text).toContain("Attempted representation");
    expect(text).toContain("detail_original");
    expect(text).toContain("Representation failure reason");
    expect(text).toContain("webp_sha256_mismatch");
    expect(text).toContain("Fallback representation");
    expect(text).toContain("asb_webp_s1600_rw");
    expect(text).toContain("Fallback fetch succeeded");
    expect(text).toContain("true");
    expect(text).toContain("Fallback byte length");
    expect(text).toContain("280000");
    expect(text).toContain("Fallback SHA-256 matches");
    expect(text).toContain("false");
    expect(text).toContain("Fallback dimensions");
    expect(text).toContain("1376×768");
  });
});
