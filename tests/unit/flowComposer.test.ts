// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  classifyFlowEditorText,
  flowComposerRuntime,
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

  describe("flowComposerRuntime reference image acceptance", () => {
    const token = "token_composer_test_123";
    const mediaId = "66c14f25-59b9-42ea-a6f7-8eeb627dcf87";

    function installComposer(chipImgUrl: string) {
      document.body.innerHTML = `
        <flow-base-prompt-box>
          <flow-rich-text-editor>
            <div contenteditable="true" role="textbox" aria-multiline="true" aria-label="What do you want to create?"><p><br></p></div>
          </flow-rich-text-editor>
          <button aria-label="Ingredient" aria-busy="false">
            <img alt="Ingredient image" src="${chipImgUrl}">
          </button>
        </flow-base-prompt-box>
      `;
      for (const element of document.querySelectorAll<HTMLElement>("*")) {
        element.getClientRects = () => [
          { x: 0, y: 0, width: 20, height: 20, top: 0, right: 20, bottom: 20, left: 0, toJSON: () => ({}) } as DOMRect,
        ] as unknown as DOMRectList;
      }
    }

    it("accepts a sole ready /asb chip with the allowed token", () => {
      installComposer(`https://flow.google.com/asb/${token}=s1600-rw`);
      const result = flowComposerRuntime("", false, undefined, mediaId, token) as {
        state: string;
        methodCompatible: boolean;
      };
      expect(result.state).toBe("empty");
      expect(result.methodCompatible).toBe(true);
    });

    it("rejects a /asb chip with a different token", () => {
      installComposer(`https://flow.google.com/asb/${token}=s1600-rw`);
      const differentToken = "token_different_456";
      const result = flowComposerRuntime("", false, undefined, mediaId, differentToken) as {
        state: string;
        diagnostic: string;
        methodCompatible: boolean;
      };
      expect(result.state).toBe("unsupported");
      expect(result.diagnostic).toBe("composer_media_present");
      expect(result.methodCompatible).toBe(false);
    });
  });
});
