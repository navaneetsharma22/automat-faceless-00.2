// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneManifest } from "../../src/app/features/downloads/SceneManifest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined; host?.remove(); host = undefined; vi.restoreAllMocks();
});

describe("fixed-duration Step 4 settings", () => {
  it("exports duration and expected count without exposing frame or timestamp fields", async () => {
    const source = {
      provider: "Vids" as const, documentId: "vids-doc", attemptId: "attempt-7", downloadId: 51,
      state: "chrome_complete" as const, sourcePath: "C:\\Downloads\\combined.mp4",
    };
    let exported: Blob | undefined;
    let fileName = "";
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => { exported = value as Blob; return "blob:settings"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { fileName = this.download; });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(SceneManifest, { source })); });

    const durationMode = [...host.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((input) => input.parentElement?.textContent?.includes("Split by duration"));
    expect(durationMode).toBeTruthy();
    await act(async () => { durationMode!.click(); });
    expect(host.textContent).toContain("does not detect scene changes");
    expect(host.querySelector('input[placeholder="7"]')).toBeTruthy();
    expect(host.querySelector('input[type="number"][step="1"]')).toBeTruthy();
    expect(host.textContent).not.toContain("Start frame index");
    expect(host.textContent).not.toContain("Start timestamp");

    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    await act(async () => {
      for (const [input, value] of [[inputs[0]!, "7"], [inputs[1]!, "7"]] as const) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const exportButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "Export split settings");
    expect(exportButton?.disabled).toBe(false);
    await act(async () => { exportButton!.click(); });
    expect(fileName).toContain("vids-fixed-duration-vids-doc-attempt-7.json");
    expect(JSON.parse(await exported!.text())).toMatchObject({
      mode: "fixed_duration", secondsPerClip: 7, expectedClipCount: 7,
      sourceDownload: { documentId: "vids-doc", downloadAttemptId: "attempt-7", chromeDownloadId: 51 },
    });
  });
});
