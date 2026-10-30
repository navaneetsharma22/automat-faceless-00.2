import { describe, expect, it } from "vitest";
import { flowReadinessModeFromInput } from "../../src/app/features/shared/flowReadinessPresentation";

const sessionId = "3b7a1cd4-eeb5-441d-b9eb-142b3e8a0084";

describe("Flow readiness count input", () => {
  it("preserves an explicitly entered and confirmed count of four", () => {
    expect(
      flowReadinessModeFromInput({
        mode: "existing_project",
        countSessionId: sessionId,
        startingImageCountText: "4",
        userConfirmed: true,
      }),
    ).toEqual({
      mode: "existing_project",
      countSessionId: sessionId,
      startingImageCount: 4,
      userConfirmed: true,
    });
  });

  it("preserves a confirmed zero as zero instead of treating it as unavailable", () => {
    expect(
      flowReadinessModeFromInput({
        mode: "existing_project",
        countSessionId: sessionId,
        startingImageCountText: "0",
        userConfirmed: true,
      }),
    ).toEqual({
      mode: "existing_project",
      countSessionId: sessionId,
      startingImageCount: 0,
      userConfirmed: true,
    });
  });

  it.each(["", "   ", "1.5", "-1", "100001"])(
    "does not silently substitute zero for invalid input %j",
    (startingImageCountText) => {
      expect(
        flowReadinessModeFromInput({
          mode: "existing_project",
          countSessionId: sessionId,
          startingImageCountText,
          userConfirmed: false,
        }),
      ).toBeUndefined();
    },
  );
});
