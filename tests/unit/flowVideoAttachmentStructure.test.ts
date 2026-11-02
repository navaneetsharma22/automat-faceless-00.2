// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flowVideoAttachmentStructurePreflightInPage } from "../../src/background/handlers/flowVideoAttachment";

function makeFixture(options: {
  settingsOpen: boolean;
  modes?: [string, string];
  missingAttachmentControl?: boolean;
  duplicateComposer?: boolean;
}) {
  const root = () => `<flow-base-prompt-box>
    <div contenteditable="true"></div>
    <button aria-label="Settings">Settings</button>
    ${options.missingAttachmentControl ? "" : '<button aria-label="Add ingredients to the prompt box">Open picker</button>'}
    <button data-generate>Generate</button>
  </flow-base-prompt-box>`;
  document.body.innerHTML = `${root()}${options.duplicateComposer ? root() : ""}`;
  let settingsOpen = options.settingsOpen;
  let settingsClicks = 0;
  let settingsChanges = 0;
  let pickerClicks = 0;
  let promptInputs = 0;
  let generateClicks = 0;
  const modes = options.modes ?? ["Video", "Ingredients"];
  const renderModes = () => {
    document.querySelector("[data-settings]")?.remove();
    if (!settingsOpen) return;
    const popover = document.createElement("div");
    popover.dataset.settings = "true";
    popover.innerHTML = modes
      .map(
        (mode, index) =>
          `<button role="radio" aria-checked="true"><span aria-hidden="true">${index ? "chrome_extensionIngredients" : "videocamVideo"}</span><span class="toggle-text">${mode}</span></button>`,
      )
      .join("");
    popover
      .querySelectorAll("[role=radio]")
      .forEach((radio) =>
        radio.addEventListener("click", () => settingsChanges++),
      );
    document.body.append(popover);
  };
  document.querySelectorAll("button[aria-label=Settings]").forEach((button) =>
    button.addEventListener("click", () => {
      settingsClicks++;
      settingsOpen = !settingsOpen;
      renderModes();
    }),
  );
  document
    .querySelectorAll("[aria-label='Add ingredients to the prompt box']")
    .forEach((button) =>
      button.addEventListener("click", () => pickerClicks++),
    );
  document
    .querySelectorAll("[contenteditable]")
    .forEach((editor) =>
      editor.addEventListener("input", () => promptInputs++),
    );
  document
    .querySelectorAll("[data-generate]")
    .forEach((button) =>
      button.addEventListener("click", () => generateClicks++),
    );
  renderModes();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      toJSON: () => ({}),
    }),
  );
  return {
    snapshot: () => ({
      settingsOpen,
      settingsClicks,
      settingsChanges,
      pickerClicks,
      promptInputs,
      generateClicks,
      checkedModeLabels: [
        ...document.querySelectorAll(
          "[role=radio][aria-checked=true] .toggle-text",
        ),
      ].map((label) => label.textContent),
    }),
  };
}

describe("production Flow attachment structure preflight", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    "never opens or changes settings when popover initially open=%s",
    (settingsOpen) => {
      const fixture = makeFixture({ settingsOpen, modes: ["Image", "Frames"] });
      const before = fixture.snapshot();
      expect(flowVideoAttachmentStructurePreflightInPage()).toMatchObject({
        ok: true,
      });
      expect(fixture.snapshot()).toEqual(before);
      expect(fixture.snapshot()).toMatchObject({
        settingsClicks: 0,
        settingsChanges: 0,
        pickerClicks: 0,
        promptInputs: 0,
        generateClicks: 0,
      });
    },
  );

  it("requires a unique composer and supported attachment control without touching settings", () => {
    makeFixture({ settingsOpen: false, duplicateComposer: true });
    expect(flowVideoAttachmentStructurePreflightInPage()).toMatchObject({
      ok: false,
      reason: "composer_unavailable",
    });
    makeFixture({ settingsOpen: true, missingAttachmentControl: true });
    expect(flowVideoAttachmentStructurePreflightInPage()).toMatchObject({
      ok: false,
      reason: "attachment_control_unavailable",
    });
    expect(document.querySelectorAll("[data-settings]")).toHaveLength(1);
    expect(
      document.querySelectorAll("[role=radio][aria-checked=true]"),
    ).toHaveLength(2);
  });
});
