import { describe, expect, it } from "vitest";
import { downloadUtf8Source } from "../../src/app/features/shared/savedSourceExport";

describe("saved source download URL lifecycle", () => {
  it("downloads the supplied bytes unchanged and revokes its temporary URL", async () => {
    const bytes = new TextEncoder().encode(
      '{\r\n"value":"हिंदी 🦕 \\"quoted\\" \\\\ \\n"}\n',
    );
    const calls: string[] = [];
    let blob: Blob | undefined;
    let scheduled: (() => void) | undefined;
    const port = {
      createObjectURL: (value: Blob) => {
        blob = value;
        calls.push("create");
        return "blob:source-export";
      },
      revokeObjectURL: (url: string) => calls.push(`revoke:${url}`),
      clickDownload: (url: string, fileName: string) => {
        calls.push(`click:${url}:${fileName}`);
      },
      schedule: (callback: () => void, delayMs: number) => {
        expect(delayMs).toBe(1_000);
        scheduled = callback;
      },
    };

    downloadUtf8Source(bytes, "workspace-image-saved-source.json", port);

    expect(blob?.type).toBe("application/json;charset=utf-8");
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(bytes);
    expect(calls).toEqual([
      "create",
      "click:blob:source-export:workspace-image-saved-source.json",
    ]);
    expect(scheduled).toBeTypeOf("function");
    scheduled!();
    expect(calls.at(-1)).toBe("revoke:blob:source-export");
  });

  it("revokes the temporary URL immediately if download activation fails", () => {
    const calls: string[] = [];
    const port = {
      createObjectURL: () => "blob:source-export",
      revokeObjectURL: (url: string) => calls.push(`revoke:${url}`),
      clickDownload: () => {
        throw new Error("click failed");
      },
      schedule: () => calls.push("schedule"),
    };

    expect(() =>
      downloadUtf8Source(new TextEncoder().encode("{}"), "source.json", port),
    ).toThrow("click failed");
    expect(calls).toEqual(["revoke:blob:source-export"]);
  });
});
