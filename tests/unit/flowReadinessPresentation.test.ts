import { describe, expect, it } from "vitest";
import { flowReadinessReasonLabel } from "../../src/app/features/shared/flowReadinessPresentation";

describe("Flow readiness reason presentation", () => {
  it("does not show the missing-result fallback for a successful null reason", () => {
    expect(flowReadinessReasonLabel("ready", null)).toBe("none");
  });

  it("keeps the diagnostic fallback for a blocked result without a reason", () => {
    expect(flowReadinessReasonLabel("blocked", null)).toBe(
      "readiness_result_unavailable",
    );
  });

  it("preserves a concrete blocked reason", () => {
    expect(
      flowReadinessReasonLabel("blocked", "connection_stale_document"),
    ).toBe("connection_stale_document");
  });
});
