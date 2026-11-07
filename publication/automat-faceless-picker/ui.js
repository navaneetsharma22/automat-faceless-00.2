/* global clearTimeout, document, Element, HTMLButtonElement, localStorage, matchMedia, MutationObserver, setTimeout */

const themeKey = "automat-faceless-vids-helper-theme";
const themeOptions = [
  ...document.querySelectorAll('input[name="theme-choice"]'),
];
const panels = [...document.querySelectorAll("[data-panel-content]")];
const navButtons = [...document.querySelectorAll("[data-panel]")];
const buttonFeedbackTimers = new WeakMap();

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  if (
    !(button instanceof HTMLButtonElement) ||
    button.disabled ||
    button.hidden
  ) {
    return;
  }
  clearTimeout(buttonFeedbackTimers.get(button));
  button.classList.remove("button-click-feedback");
  void button.offsetWidth;
  button.classList.add("button-click-feedback");
  buttonFeedbackTimers.set(
    button,
    setTimeout(() => {
      button.classList.remove("button-click-feedback");
      buttonFeedbackTimers.delete(button);
    }, 190),
  );
});

function stateForMessage(message) {
  if (/\bnot (?:accepted|connected|verified|ready)\b/i.test(message)) {
    return "error";
  }
  if (
    /error|failed|denied|unavailable|mismatch|unresolved|uncertain|could not|rejected|expired/i.test(
      message,
    )
  ) {
    return "error";
  }
  if (
    /needs review|waiting|preparing|requested once|browser save initiated|not verifiable/i.test(
      message,
    )
  ) {
    return "warning";
  }
  if (
    /verified|\bmatch\b|\bready\b|\baccepted\b|connected|bytes received/i.test(
      message,
    )
  ) {
    return "success";
  }
  return "info";
}

function observeStatus(element) {
  if (!element) return;
  const update = () => {
    element.dataset.state = stateForMessage(element.textContent?.trim() || "");
  };
  new MutationObserver(update).observe(element, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  update();
}

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
    ?.setAttribute("data-state", stateForMessage(current));
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

for (const selector of [
  "#mp4-operation-status",
  "#extension-handoff-status",
  "#linked-preparation-status",
  "#prepared-navigation-status",
  "#two-clip-proof-status",
]) {
  observeStatus(document.querySelector(selector));
}

const extensionStatus = document.querySelector("#extension-config-status");
if (extensionStatus) {
  const updateConnectionStyle = () => {
    extensionStatus.dataset.state = stateForMessage(
      extensionStatus.textContent.trim(),
    );
  };
  new MutationObserver(updateConnectionStyle).observe(extensionStatus, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  updateConnectionStyle();
}
