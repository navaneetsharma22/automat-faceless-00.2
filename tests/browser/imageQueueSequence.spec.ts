import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { rolldown } from "rolldown";
import { resolve } from "node:path";

for (const injectFinalMismatch of [false, true]) {
  test(
    injectFinalMismatch
      ? "a final Shot 11 readback mismatch persists blocked before activation"
      : "production timed dispatcher refills a cleared rich composer with a long second prompt",
    async ({ page }) => {
      activeExpectedText = undefined;
      expectedAtMutation = undefined;
      mutatedActualText = undefined;
      secondPromptReadbackCount = 0;
      promptEntryReadbacks.length = 0;
      await page.route("https://flow.google.com/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html><html><head><style>body{margin:24px}flow-base-prompt-box{display:block;width:560px}flow-rich-text-editor{display:block}[contenteditable="true"]{box-sizing:border-box;height:360px;overflow:auto;white-space:pre-wrap;border:1px solid #777}button{display:block;min-height:44px;margin-top:8px}</style></head><body><flow-base-prompt-box aria-label="Image prompt composer"><flow-rich-text-editor><div contenteditable="true" role="textbox" aria-label="Prompt editor"><p><br></p></div></flow-rich-text-editor><button type="button" aria-label="Generate image">Generate</button></flow-base-prompt-box><script>globalThis.__timedClickLog=[];globalThis.__timedComposerResetCount=0;document.querySelector('button').addEventListener('click',()=>{const editor=document.querySelector('[contenteditable="true"]');globalThis.__timedClickLog.push(editor.textContent||'');const emptyLine=document.createElement('p');emptyLine.append(document.createElement('br'));editor.replaceChildren(emptyLine);globalThis.__timedComposerResetCount+=1;});</script></body></html>`,
        }),
      );
      await page.goto("https://flow.google.com/project/timed-sequence");
      await page.addScriptTag({
        content: "globalThis.__AUTOMAT_BUILD_ID__='fixture-build';",
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await page.exposeFunction(
        "__timedCdpSend",
        async (method: string, params?: object) => {
          if (method === "Input.insertText") {
            activeExpectedText = (params as { text: string }).text;
          }
          if (
            injectFinalMismatch &&
            method === "Runtime.evaluate" &&
            secondPromptReadbackCount >= 4 &&
            mutatedActualText === undefined
          ) {
            expectedAtMutation = activeExpectedText;
            const mutation = (await cdp.send("Runtime.evaluate", {
              expression: `(()=>{const editor=document.querySelector('[contenteditable="true"]');const line=editor?.querySelector('p');if(!editor||!line)return undefined;line.textContent=(editor.textContent||'')+' ';return editor.textContent;})()`,
              returnByValue: true,
              awaitPromise: false,
            })) as { result?: { value?: string } };
            mutatedActualText = mutation.result?.value;
          }
          const response = await cdp.send(method as never, params as never);
          const value = (
            response as {
              result?: {
                value?: { connected?: boolean; text?: string };
              };
            }
          ).result?.value;
          if (
            method === "Runtime.callFunctionOn" &&
            activeExpectedText !== undefined &&
            value?.connected === true &&
            typeof value.text === "string" &&
            value.text.length > 0
          ) {
            promptEntryReadbacks.push({
              expected: activeExpectedText,
              actual: value.text,
            });
            if (
              activeExpectedText === expectedAtMutation ||
              (injectFinalMismatch &&
                activeExpectedText &&
                JSON.parse(activeExpectedText).shot_id === "11")
            ) {
              secondPromptReadbackCount += 1;
            }
          }
          return response;
        },
      );
      const bundle = await rolldown({
        input: resolve(
          process.cwd(),
          "tests/browser/imageQueueSequenceHarness.ts",
        ),
      });
      try {
        const built = await bundle.generate({
          format: "iife",
          name: "TimedQueueSequenceFixture",
        });
        const chunk = built.output.find(
          (output) => output.type === "chunk" && output.isEntry,
        );
        if (!chunk) throw new Error("Timed queue fixture bundle missing");
        await page.addScriptTag({ content: chunk.code });
        const report = await page.evaluate(() =>
          window.__TimedQueueSequenceFixture.runDexieTimedQueueSequence(),
        );
        const readbackEvidence = promptEntryReadbacks.map(
          ({ expected, actual }) => compareSafely(expected, actual),
        );
        expect(readbackEvidence).toHaveLength(8);
        expect(readbackEvidence.every((entry) => entry.equal)).toBe(true);
        if (injectFinalMismatch) {
          const finalMismatch = compareSafely(
            expectedAtMutation!,
            mutatedActualText!,
          );
          expect(finalMismatch.equal).toBe(false);
          expect(finalMismatch.mismatchCategory).toBe("length");
          expect(finalMismatch.firstDifferenceOffset).toBe(
            expectedAtMutation!.length,
          );
          expect(finalMismatch.expectedCodeUnits).toBe(16_332);
          expect(finalMismatch.actualCodeUnits).toBe(16_333);
          expect(finalMismatch.expectedSha256).toBe(
            "4486ec043e231cd054abc5ca0a0fa1c40c8e8861691304a1cd5657fc9e167e23",
          );
          expect(finalMismatch.actualContext?.endsWith(' "')).toBe(true);
          expect(report.finalState).toBe("blocked");
          expect(report.blockedReason).toBe("editor_exact_readback_mismatch");
          expect(report.finalItems).toEqual([
            expect.objectContaining({
              shotId: "10",
              itemState: "sent",
              providerOutcome: "unknown",
              receiptStored: true,
              activationStarted: true,
            }),
            expect.objectContaining({
              shotId: "11",
              itemState: "blocked",
              providerOutcome: "not_started",
              receiptStored: false,
              intentStored: true,
              activationStarted: false,
              blockReason: "editor_exact_readback_mismatch",
              readbackDiagnostic: expect.objectContaining({
                stage: "pre_activation_inspection",
                expectedCodeUnits: 16_332,
                actualCodeUnits: 16_333,
                firstDifferenceOffset: 16_332,
                mismatchCategory: "length",
                expectedSha256:
                  "4486ec043e231cd054abc5ca0a0fa1c40c8e8861691304a1cd5657fc9e167e23",
                actualSha256:
                  "ae15d5090b4f3924d95bfeee8b3d1fd730824fa60d338b8255b805c5f5eb4032",
              }),
            }),
          ]);
          expect(report.readOnlyInspectionResult).toEqual(
            expect.objectContaining({
              order: 1,
              shotId: "11",
              stage: "read_only_editor_inspection",
              equal: false,
              expectedCodeUnits: 16_332,
              actualCodeUnits: 16_333,
              firstDifferenceOffset: 16_332,
              mismatchCategory: "length",
              expectedSha256:
                "4486ec043e231cd054abc5ca0a0fa1c40c8e8861691304a1cd5657fc9e167e23",
              actualSha256:
                "ae15d5090b4f3924d95bfeee8b3d1fd730824fa60d338b8255b805c5f5eb4032",
            }),
          );
          expect(report.dispatchCount).toBe(1);
          expect(report.composerResetCount).toBe(1);
          console.log(
            "Synthetic final pre-activation mismatch evidence",
            JSON.stringify({
              shotId: "11",
              mismatch: finalMismatch,
              durableItem: report.finalItems?.[1],
              firstShotReceiptAt: report.receiptTimes?.[0],
            }),
          );
        } else {
          expect(
            report.orderedInputsMatch,
            JSON.stringify({
              comparisonEvidence: report.comparisonEvidence,
              inputEvidence: report.inputEvidence,
              expectedEvidence: report.expectedEvidence,
              blockedReason: report.blockedReason,
              finalState: report.finalState,
              richComposerResetObserved: report.richComposerResetObserved,
            }),
          ).toBe(true);
          expect(report.inputEvidence).toEqual(report.expectedEvidence);
          expect(report.persistedItems).toEqual(report.expectedItems);
          expect(report.earlyCount).toBe(1);
          expect(report.dispatchCount).toBe(2);
          expect(report.activationCounts).toEqual([1, 1]);
          expect(report.receiptDurableBeforeSecond).toBe(true);
          expect(report.receiptTimes).toEqual([1_000, 41_000]);
          expect(report.outcomes).toEqual(["unknown", "unknown"]);
          expect(report.finalState).toBe("sent");
          expect(report.deadlines).toBeNull();
          expect(report.alarmCount).toBe(0);
          expect(report.richComposerResetObserved).toBe(true);
          console.log(
            "Synthetic production prompt-entry readback evidence",
            JSON.stringify({
              snapshot: report.persistedItems,
              input: report.inputEvidence,
              immediateAndSettledReads: readbackEvidence.map(
                ({
                  equal,
                  expectedCodeUnits,
                  actualCodeUnits,
                  expectedSha256,
                  actualSha256,
                }) => ({
                  equal,
                  expectedCodeUnits,
                  actualCodeUnits,
                  expectedSha256,
                  actualSha256,
                }),
              ),
              receiptTimes: report.receiptTimes,
            }),
          );
        }
      } finally {
        await bundle.close();
        await cdp.detach();
      }
    },
  );
}

let activeExpectedText: string | undefined;
let expectedAtMutation: string | undefined;
let mutatedActualText: string | undefined;
let secondPromptReadbackCount = 0;
const promptEntryReadbacks: { expected: string; actual: string }[] = [];

function compareSafely(expected: string, actual: string) {
  const limit = Math.min(expected.length, actual.length);
  let firstDifferenceOffset = 0;
  while (
    firstDifferenceOffset < limit &&
    expected[firstDifferenceOffset] === actual[firstDifferenceOffset]
  )
    firstDifferenceOffset += 1;
  const contextStart = Math.max(0, firstDifferenceOffset - 16);
  const contextEnd = firstDifferenceOffset + 16;
  return {
    equal: expected === actual,
    expectedCodeUnits: expected.length,
    actualCodeUnits: actual.length,
    expectedUtf8Bytes: new TextEncoder().encode(expected).byteLength,
    actualUtf8Bytes: new TextEncoder().encode(actual).byteLength,
    expectedSha256: createHash("sha256").update(expected, "utf8").digest("hex"),
    actualSha256: createHash("sha256").update(actual, "utf8").digest("hex"),
    firstDifferenceOffset:
      expected === actual ? undefined : firstDifferenceOffset,
    mismatchCategory:
      expected === actual
        ? undefined
        : expected.length === actual.length
          ? "code-unit"
          : firstDifferenceOffset === limit
            ? "length"
            : "representation",
    ...(expected === actual
      ? {}
      : {
          expectedContext: JSON.stringify(
            expected.slice(contextStart, contextEnd),
          ),
          actualContext: JSON.stringify(actual.slice(contextStart, contextEnd)),
        }),
  };
}
