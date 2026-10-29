import { describe, expect, it } from "vitest";
import {
  classifyFlowEditorText,
  kindOf,
} from "../../src/platforms/flow/composer";

function fakeEditor(values: Record<string, unknown> = {}): HTMLElement {
  return {
    textContent: "",
    children: [],
    getAttribute: () => null,
    ...values,
  } as unknown as HTMLElement;
}

describe("Flow composer editor classification", () => {
  it("recognizes supported editor types only", () => {
    expect(kindOf(fakeEditor({ tagName: "TEXTAREA" }))).toBe("textarea");
    expect(kindOf(fakeEditor({ tagName: "INPUT", type: "text" }))).toBe(
      "text-input",
    );
    expect(
      kindOf(
        fakeEditor({
          tagName: "DIV",
          getAttribute: (name: string) =>
            name === "contenteditable"
              ? "true"
              : name === "role"
                ? "textbox"
                : null,
        }),
      ),
    ).toBe("contenteditable");
    expect(kindOf(fakeEditor({ tagName: "DIV" }))).toBeUndefined();
    expect(kindOf(fakeEditor({ tagName: "INPUT", type: "search" }))).toBe(
      "text-input",
    );
  });

  it("allows only empty, exact-match, or conflict outcomes", () => {
    const textarea = fakeEditor({ tagName: "TEXTAREA" });
    expect(classifyFlowEditorText(textarea, "textarea", "", "{}")).toBe(
      "empty",
    );
    expect(classifyFlowEditorText(textarea, "textarea", "{}", "{}")).toBe(
      "already-matching",
    );
    expect(classifyFlowEditorText(textarea, "textarea", "existing", "{}")).toBe(
      "conflict",
    );
    expect(classifyFlowEditorText(textarea, "textarea", "", "")).toBe(
      "conflict",
    );
  });

  it("recognizes only blank contenteditable placeholder artifacts", () => {
    const empty = fakeEditor({ textContent: "", children: [] });
    expect(classifyFlowEditorText(empty, "contenteditable", "", "{}")).toBe(
      "empty",
    );
    const br = { tagName: "BR", textContent: "", children: [] };
    const emptyLine = fakeEditor({ textContent: "", children: [br] });
    expect(classifyFlowEditorText(emptyLine, "contenteditable", "", "{}")).toBe(
      "empty",
    );
    const content = fakeEditor({ textContent: "keep", children: [] });
    expect(
      classifyFlowEditorText(content, "contenteditable", "keep", "{}"),
    ).toBe("conflict");
    expect(classifyFlowEditorText(empty, "contenteditable", " ", "{}")).toBe(
      "conflict",
    );
    expect(classifyFlowEditorText(empty, "contenteditable", "\n", "{}")).toBe(
      "conflict",
    );
  });
});
