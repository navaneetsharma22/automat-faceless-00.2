import { describe, expect, it } from "vitest";
import { parseVidsDownloadStatus, type VidsDownloadAttempt } from "../../src/domain/media/combinedExport";
import { getVidsNeedsReviewHelp } from "../../src/domain/media/vidsAttemptStatus";

const attempt = (overrides: Partial<VidsDownloadAttempt> = {}) => parseVidsDownloadStatus({
  attemptId: "003d9d7e5abd68c5445fa5b0444bc151",
  documentId: "vids-document-987",
  canonicalTarget: "https://vids.google.com/video/vids-document-987/edit",
  tabId: 12,
  state: "needs_review",
  createdAt: 100,
  updatedAt: 200,
  reason: "operation_observation_lost",
  ...overrides,
})!;

describe("Vids Needs review attempt evidence", () => {
  it("does not claim an operation ID when the stored historical record has none", () => {
    const record = attempt();
    expect(record.operationName).toBeUndefined();
    const help = getVidsNeedsReviewHelp(record);
    expect(help).toContain("No Drive operation ID is present in this attempt");
    expect(help).toContain("Historical preparation evidence is missing");
    expect(help).toContain("outcome is unknown");
    expect(help).not.toContain("ID is retained");
    expect(help).toContain("Do not prepare again");
  });

  it("shows and directs continuation of the exact recorded operation after polling transport failure", () => {
    const record = attempt({
      operationName: "operations/existing_operation_123",
      failureStage: "operation_poll",
      failureCode: "transport_unavailable",
    });
    const help = getVidsNeedsReviewHelp(record);
    expect(help).toContain("operations/existing_operation_123");
    expect(help).toContain("Polling transport failed");
    expect(help).toContain("Continue checking operation");
    expect(help).toContain("this same ID");
    expect(help).toContain("do not prepare again");
  });

  it("distinguishes expired authorization while checking a known operation", () => {
    const help = getVidsNeedsReviewHelp(attempt({
      operationName: "operations/auth_check_7",
      failureStage: "operation_poll",
      failureCode: "authorization_expired",
    }));
    expect(help).toContain("Authorization or file access failed");
    expect(help).toContain("operations/auth_check_7");
    expect(help).toContain("manually restoring authorization");
    expect(help).toContain("this ID");
  });

  it("distinguishes a terminal operation rejection from lost polling evidence", () => {
    const help = getVidsNeedsReviewHelp(attempt({
      reason: "operation_failed",
      operationName: "operations/rejected_2",
      failureStage: "operation_result",
      failureCode: "operation_failed",
    }));
    expect(help).toContain("Drive reported that operation operations/rejected_2 failed");
    expect(help).not.toContain("could not be checked");
    expect(help).toContain("will not be replayed");
  });
});
