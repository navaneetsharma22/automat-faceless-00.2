import { describe, expect, it } from "vitest";
import {
  comparePromptReadbackSafely,
  PromptReadbackDiagnosticSchema,
} from "../../src/domain/jobs/queue";
import {
  ExtensionRepositories,
  sha256Hex,
} from "../../src/storage/repositories";
import { createMemoryRepositoryDatabase } from "./repositoryTestSupport";
import { inspectFlowEditorAgainstQueueItem } from "../../src/background/generationQueue";

describe("readback diagnostics and read-only inspection", () => {
  describe("comparePromptReadbackSafely", () => {
    it("returns equal for identical strings with matching hashes and code units", async () => {
      const text = JSON.stringify({ shot_id: "10", prompt: "Hello world" });
      const result = await comparePromptReadbackSafely({
        expectedText: text,
        actualText: text,
      });

      expect(result.equal).toBe(true);
      expect(result.expectedCodeUnits).toBe(text.length);
      expect(result.actualCodeUnits).toBe(text.length);
      expect(result.expectedUtf8Bytes).toBe(text.length);
      expect(result.actualUtf8Bytes).toBe(text.length);
      expect(result.expectedSha256).toBe(await sha256Hex(text));
      expect(result.actualSha256).toBe(result.expectedSha256);
      expect(result.firstDifferenceOffset).toBeUndefined();
      expect(result.mismatchCategory).toBeUndefined();
      expect(result.expectedContext).toBeUndefined();
      expect(result.actualContext).toBeUndefined();
    });

    it("identifies code-unit mismatch with bounded escaped context", async () => {
      const expected = JSON.stringify({ shot_id: "11", prompt: "Alpha Bravo" });
      const actual = JSON.stringify({ shot_id: "11", prompt: "Alpha Cravo" });

      const result = await comparePromptReadbackSafely({
        expectedText: expected,
        actualText: actual,
      });

      expect(result.equal).toBe(false);
      expect(result.mismatchCategory).toBe("code-unit");
      expect(result.firstDifferenceOffset).toBe(expected.indexOf("Bravo"));
      expect(result.expectedCodeUnits).toBe(expected.length);
      expect(result.actualCodeUnits).toBe(actual.length);
      expect(result.expectedSha256).toBe(await sha256Hex(expected));
      expect(result.actualSha256).toBe(await sha256Hex(actual));
      expect(result.expectedContext).toContain("Bravo");
      expect(result.actualContext).toContain("Cravo");
    });

    it("identifies length mismatch when trailing character is appended", async () => {
      const expected = JSON.stringify({ shot_id: "11", prompt: "Base text" });
      const actual = `${expected} `;

      const result = await comparePromptReadbackSafely({
        expectedText: expected,
        actualText: actual,
      });

      expect(result.equal).toBe(false);
      expect(result.mismatchCategory).toBe("length");
      expect(result.firstDifferenceOffset).toBe(expected.length);
      expect(result.expectedCodeUnits).toBe(expected.length);
      expect(result.actualCodeUnits).toBe(expected.length + 1);
      expect(result.actualContext?.endsWith(' "')).toBe(true);
    });

    it("safely bounds context snippets to at most 32 characters plus escaping quotes", async () => {
      const prefix = "A".repeat(100);
      const suffix = "Z".repeat(100);
      const expected = `${prefix}X${suffix}`;
      const actual = `${prefix}Y${suffix}`;

      const result = await comparePromptReadbackSafely({
        expectedText: expected,
        actualText: actual,
      });

      expect(result.equal).toBe(false);
      expect(result.firstDifferenceOffset).toBe(100);
      // Unescaped slice is 32 chars: 16 before + 1 differing + 15 after
      const rawContext = JSON.parse(result.expectedContext!) as string;
      expect(rawContext).toHaveLength(32);
      expect(rawContext).toBe(`${"A".repeat(16)}X${"Z".repeat(15)}`);
    });

    it("evaluates a synthetic 3,874-character prompt cleanly without storing full text", async () => {
      // Synthetic fixture mirroring the user-reported preview length of 3,874 chars for Shot 11
      const basePrompt = "Synthetic prompt detail segment for shot 11. ".repeat(
        90,
      );
      const expected = JSON.stringify({
        shot_id: "11",
        scene_title: "Synthetic 3874-character test scene",
        prompt: basePrompt.slice(0, 3794),
      });
      expect(expected.length).toBe(3874);

      // Controlled synthetic mismatch: single mutation at offset 3800
      const actual = `${expected.slice(0, 3800)}!${expected.slice(3801)}`;
      expect(actual.length).toBe(3874);

      const result = await comparePromptReadbackSafely({
        expectedText: expected,
        actualText: actual,
      });

      expect(result.equal).toBe(false);
      expect(result.mismatchCategory).toBe("code-unit");
      expect(result.firstDifferenceOffset).toBe(3800);
      expect(result.expectedCodeUnits).toBe(3874);
      expect(result.actualCodeUnits).toBe(3874);
      expect(result.expectedSha256).toBe(await sha256Hex(expected));
      expect(result.actualSha256).toBe(await sha256Hex(actual));
      // Full prompt is not in context
      expect(result.expectedContext?.length).toBeLessThan(100);
      expect(result.actualContext?.length).toBeLessThan(100);
    });
  });

  describe("PromptReadbackDiagnosticSchema", () => {
    it("validates a complete bounded diagnostic record", () => {
      const valid = {
        queueId: "11111111-1111-4111-8111-111111111111",
        queueItemId: "item-11",
        order: 1,
        shotId: "11",
        stage: "pre_activation_inspection",
        recordedAt: 1234567,
        expectedCodeUnits: 3874,
        actualCodeUnits: 3875,
        expectedUtf8Bytes: 3874,
        actualUtf8Bytes: 3875,
        expectedSha256: "a".repeat(64),
        actualSha256: "b".repeat(64),
        firstDifferenceOffset: 3874,
        mismatchCategory: "length" as const,
        expectedContext: '"context-a"',
        actualContext: '"context-b"',
      };

      expect(PromptReadbackDiagnosticSchema.safeParse(valid).success).toBe(
        true,
      );
    });

    it("rejects non-hex or malformed hash in diagnostic record", () => {
      const invalid = {
        queueId: "11111111-1111-4111-8111-111111111111",
        queueItemId: "item-11",
        order: 1,
        stage: "pre_activation_inspection",
        recordedAt: 1234567,
        expectedCodeUnits: 100,
        expectedUtf8Bytes: 100,
        expectedSha256: "not-a-valid-sha256",
      };

      expect(PromptReadbackDiagnosticSchema.safeParse(invalid).success).toBe(
        false,
      );
    });
  });

  describe("durable repository binding and readback inspection", () => {
    it("binds readback diagnostic to the immutable queue item on block", async () => {
      const database = createMemoryRepositoryDatabase();
      const repositories = new ExtensionRepositories(database, () => 1000);
      const sourceText =
        '10: {"shot_id":"10","prompt":"first"}\n11: {"shot_id":"11","prompt":"second"}';
      await repositories.savePromptBatch({
        workspaceId: "test-workspace",
        kind: "image",
        sourceText,
      });
      await repositories.recordSelectedTarget({
        provider: "Flow",
        tabId: 101,
        canonicalTarget: "https://flow.google.com/project/test",
      });
      const selected = await repositories.getSelectedTarget("Flow");
      await database.selectedTargets.put({
        ...selected!,
        verification: "verified",
        connectionState: "verified",
        verificationBinding: {
          provider: "Flow",
          tabId: 101,
          canonicalTarget: "https://flow.google.com/project/test",
          projectId: "test",
          frameId: 0,
          documentId: "doc-1",
          documentToken: "tok-1",
          extensionBuildId: "fixture",
          extensionProtocolVersion: 4,
          connectorBuildId: "fixture",
          connectorProtocolVersion: 1,
          capability: "read-only-connection-v1",
          verifiedAt: 1000,
        },
      });

      const queueId = "22222222-2222-4222-8222-222222222222";
      const queue = await repositories.createTimedImageSubmissionQueue({
        workspaceId: "test-workspace",
        queueId,
        settingsConfirmation: {
          confirmationId: "conf-1",
          confirmedAt: 1000,
          tabId: 101,
          projectId: "test",
          canonicalTarget: "https://flow.google.com/project/test",
          declaredVariantCount: 1,
        },
      });

      // Claim item 1 (Shot 11) for dispatch
      const claimed = await repositories.claimTimedImageQueueItem({
        queueId,
        expectedRevision: queue.revision,
        order: 1,
        attemptId: "attempt-shot-11",
        at: 1000,
      });

      const diagnostic = {
        queueId,
        queueItemId: claimed.items[1]!.queueItemId,
        order: 1,
        shotId: "11",
        stage: "pre_activation_inspection",
        recordedAt: 1100,
        expectedCodeUnits: 32,
        actualCodeUnits: 33,
        expectedUtf8Bytes: 32,
        actualUtf8Bytes: 33,
        expectedSha256: "c".repeat(64),
        actualSha256: "d".repeat(64),
        firstDifferenceOffset: 32,
        mismatchCategory: "length" as const,
        expectedContext: '"expected"',
        actualContext: '"actual "',
      };

      const blocked = await repositories.blockTimedImageQueue({
        queueId,
        expectedRevision: claimed.revision,
        order: 1,
        at: 1100,
        uncertain: false,
        reason: "editor_exact_readback_mismatch",
        diagnostic,
      });

      expect(blocked?.state).toBe("blocked");
      const blockedItem = blocked?.items[1];
      expect(blockedItem?.itemState).toBe("blocked");
      expect(blockedItem?.blockReason).toBe("editor_exact_readback_mismatch");
      expect(blockedItem?.readbackDiagnostic).toEqual(diagnostic);
      // Unrelated item 0 is preserved
      expect(blocked?.items[0]?.itemState).toBe("pending");
      expect(blocked?.items[0]?.readbackDiagnostic).toBeUndefined();
    });

    it("inspectFlowEditorAgainstQueueItem compares editor without mutating queue or activating Generate", async () => {
      const database = createMemoryRepositoryDatabase();
      const repositories = new ExtensionRepositories(database, () => 2000);
      const promptBody = JSON.stringify({
        shot_id: "11",
        prompt: "Hello inspection",
      });
      const sourceText = `11: ${promptBody}`;
      await repositories.savePromptBatch({
        workspaceId: "test-workspace-inspect",
        kind: "image",
        sourceText,
      });
      await repositories.recordSelectedTarget({
        provider: "Flow",
        tabId: 202,
        canonicalTarget: "https://flow.google.com/project/test-inspect",
      });
      const selected = await repositories.getSelectedTarget("Flow");
      await database.selectedTargets.put({
        ...selected!,
        verification: "verified",
        connectionState: "verified",
        verificationBinding: {
          provider: "Flow",
          tabId: 202,
          canonicalTarget: "https://flow.google.com/project/test-inspect",
          projectId: "test-inspect",
          frameId: 0,
          documentId: "doc-2",
          documentToken: "tok-2",
          extensionBuildId: "fixture",
          extensionProtocolVersion: 4,
          connectorBuildId: "fixture",
          connectorProtocolVersion: 1,
          capability: "read-only-connection-v1",
          verifiedAt: 2000,
        },
      });

      const queueId = "33333333-3333-4333-8333-333333333333";
      const queue = await repositories.createTimedImageSubmissionQueue({
        workspaceId: "test-workspace-inspect",
        queueId,
        settingsConfirmation: {
          confirmationId: "conf-2",
          confirmedAt: 2000,
          tabId: 202,
          projectId: "test-inspect",
          canonicalTarget: "https://flow.google.com/project/test-inspect",
          declaredVariantCount: 1,
        },
      });

      const claimed = await repositories.claimTimedImageQueueItem({
        queueId,
        expectedRevision: queue.revision,
        order: 0,
        attemptId: "attempt-shot-inspect",
        at: 2000,
      });

      const blocked = await repositories.blockTimedImageQueue({
        queueId,
        expectedRevision: claimed.revision,
        order: 0,
        at: 2100,
        uncertain: false,
        reason: "editor_exact_readback_mismatch",
      });

      expect(blocked?.state).toBe("blocked");
      const revisionBeforeInspection = blocked!.revision;

      // Mock synthetic page port returning actual editor text with an injected trailing space
      const mockActualText = `${promptBody} `;
      const mockPagePort = {
        sendCommand: async (_tabId: number, method: string) => {
          if (method === "Runtime.evaluate") {
            return {
              result: {
                value: {
                  found: true,
                  text: mockActualText,
                },
              },
            };
          }
          return {};
        },
      };

      const inspectionResult = await inspectFlowEditorAgainstQueueItem({
        repositories,
        queueId,
        order: 0,
        now: () => 2200,
        environment: {
          pagePort: mockPagePort as never,
        },
      });

      expect(inspectionResult.equal).toBe(false);
      expect(inspectionResult.stage).toBe("read_only_editor_inspection");
      expect(inspectionResult.shotId).toBe("11");
      expect(inspectionResult.expectedCodeUnits).toBe(promptBody.length);
      expect(inspectionResult.actualCodeUnits).toBe(mockActualText.length);
      expect(inspectionResult.firstDifferenceOffset).toBe(promptBody.length);
      expect(inspectionResult.mismatchCategory).toBe("length");
      expect(inspectionResult.expectedSha256).toBe(await sha256Hex(promptBody));
      expect(inspectionResult.actualSha256).toBe(
        await sha256Hex(mockActualText),
      );

      // Durable queue state must remain strictly untouched
      const queueAfterInspection =
        await repositories.getTimedImageSubmissionQueue(queueId);
      expect(queueAfterInspection?.revision).toBe(revisionBeforeInspection);
      expect(queueAfterInspection?.state).toBe("blocked");
      expect(queueAfterInspection?.items[0]?.itemState).toBe("blocked");
      expect(queueAfterInspection?.items[0]?.dispatchReceipt).toBeUndefined();
    });
  });
});
