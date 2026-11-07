/* global document, localStorage, matchMedia, MutationObserver */

const themeKey = "automat-faceless-vids-helper-theme";
const themeOptions = [
  ...document.querySelectorAll('input[name="theme-choice"]'),
];
const panels = [...document.querySelectorAll("[data-panel-content]")];
const navButtons = [...document.querySelectorAll("[data-panel]")];

function applyTheme(preference) {
  const resolved =
    preference === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#0b0d10" : "#f7f1e8");
}

let themePreference = "system";
try {
  const saved = localStorage.getItem(themeKey);
  if (["light", "dark", "system"].includes(saved)) themePreference = saved;
} catch {
  // Use System when browser storage is unavailable.
}
applyTheme(themePreference);
for (const option of themeOptions) {
  option.checked = option.value === themePreference;
  option.addEventListener("change", () => {
    if (!option.checked) return;
    themePreference = option.value;
    try {
      localStorage.setItem(themeKey, themePreference);
    } catch {
      // The current page still uses the selected theme if storage is unavailable.
    }
    applyTheme(themePreference);
  });
}
const colorPreference = matchMedia("(prefers-color-scheme: dark)");
colorPreference.addEventListener?.("change", () => {
  if (themePreference === "system") applyTheme("system");
});

function showPanel(name, moveFocus = false) {
  for (const panel of panels)
    panel.hidden = panel.dataset.panelContent !== name;
  for (const button of navButtons) {
    if (button.dataset.panel === name)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (moveFocus)
    document.querySelector(`[data-panel-content="${name}"] h1`)?.focus();
}

for (const button of navButtons) {
  button.addEventListener("click", () => showPanel(button.dataset.panel, true));
}

const summary = document.querySelector("#workflow-summary");
const selectionStatus = document.querySelector("#selection-status");
const expectedMatch = document.querySelector("#expected-match");
const preparationStatus = document.querySelector("#mp4-operation-status");
const handoffStatus = document.querySelector("#extension-handoff-status");
const handoffButton = document.querySelector("#send-prepared-mp4-to-extension");

function updateWorkflowSummary() {
  const selection = selectionStatus?.textContent?.trim() || "";
  const match = expectedMatch?.textContent?.trim() || "";
  const preparation = preparationStatus?.textContent?.trim() || "";
  const handoff = handoffStatus?.textContent?.trim() || "";
  if (handoff && handoff !== "No extension handoff requested") {
    summary.textContent = handoff;
  } else if (preparation && preparation !== "Not prepared") {
    const ready = /^MP4 ready$/i.test(preparation);
    summary.textContent =
      ready && handoffButton && !handoffButton.hidden
        ? "MP4 ready. Next: send it to the extension."
        : preparation;
  } else if (
    selection &&
    selection !== "Not started" &&
    !/^Verified Google Vids metadata$/i.test(selection)
  ) {
    summary.textContent = selection;
  } else if (
    /^Verified Google Vids metadata$/i.test(selection) &&
    match === "Match"
  ) {
    summary.textContent =
      "Document verified. Confirm the reviewed timeline to enable MP4 preparation.";
  } else {
    summary.textContent =
      "Next: enter your Picker key and expected document, then connect your account.";
  }
  const current = summary?.textContent || "";
  document
    .querySelector("#workflow-next-action")
    ?.setAttribute(
      "data-state",
      /error|failed|denied|unavailable|mismatch|not authorized|unresolved|uncertain|could not|rejected|expired/i.test(
        current,
      )
        ? "error"
        : "neutral",
    );
}

for (const element of [
  selectionStatus,
  expectedMatch,
  preparationStatus,
  handoffStatus,
  handoffButton,
]) {
  if (element)
    new MutationObserver(updateWorkflowSummary).observe(element, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
}
updateWorkflowSummary();
showPanel("download");

const extensionStatus = document.querySelector("#extension-config-status");
if (extensionStatus) {
  const updateConnectionStyle = () => {
    extensionStatus.dataset.state = /connected\.?$/i.test(
      extensionStatus.textContent.trim(),
    )
      ? "connected"
      : /checking/i.test(extensionStatus.textContent)
        ? "checking"
        : "error";
  };
  new MutationObserver(updateConnectionStyle).observe(extensionStatus, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  updateConnectionStyle();
}
