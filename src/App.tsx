import { useState } from "react";
import { Button } from "./app/components/Button";
import { Field } from "./app/components/Field";
import { JsonEditor } from "./app/components/JsonEditor";
import { Notice } from "./app/components/Notice";
import { Select } from "./app/components/Select";
import { SettingsConfirmation } from "./app/components/SettingsConfirmation";
import { Toast } from "./app/components/Toast";
import { ToastHost, useToast } from "./app/components/ToastHost";
import type { NoticeKind } from "./app/components/Notice";
import type { ToastNotification } from "./app/components/toastManager";
import previewStyles from "./app/Preview.module.css";
import controlStyles from "./app/components/controls.module.css";

const previewJson = `{
  "source": "synthetic component preview",
  "rows": [
${Array.from(
  { length: 24 },
  (_, index) => `    {"previewIndex": ${index + 1}, "value": "example only"}`,
).join(",\n")}
  ]
}`;

const toastExamples: readonly ToastNotification[] = [
  {
    id: "preview-success",
    kind: "success",
    message: "Success message preview. No provider request was sent.",
    urgent: false,
    actionable: false,
    exiting: false,
  },
  {
    id: "preview-info",
    kind: "info",
    message: "Information message preview.",
    urgent: false,
    actionable: false,
    exiting: false,
  },
  {
    id: "preview-warning",
    kind: "warning",
    message: "Warning message preview.",
    urgent: false,
    actionable: false,
    exiting: false,
  },
  {
    id: "preview-error",
    kind: "error",
    message: "Persistent error message preview. See the inline Notice too.",
    urgent: true,
    actionable: true,
    exiting: false,
  },
];

const toastCopy: Record<NoticeKind, string> = {
  success: "Success preview. No provider request was sent.",
  error: "Persistent error preview. This is not a real workflow error.",
  warning: "Warning preview. No action is needed.",
  info: "Information preview. No activity is running.",
};

function ThemePanel({ theme }: { theme: "light" | "dark" }) {
  const toastManager = useToast();
  const [confirmed, setConfirmed] = useState(false);
  const [editorValue, setEditorValue] = useState(previewJson);
  const [showValidation, setShowValidation] = useState(false);
  const [visibleToastExamples, setVisibleToastExamples] =
    useState(toastExamples);
  const [selectedOption, setSelectedOption] = useState("first");
  const [fieldValue, setFieldValue] = useState("");

  const showToast = (kind: NoticeKind) => {
    toastManager.add({
      kind,
      message: toastCopy[kind],
      urgent: kind === "error",
      actionable: kind === "error",
    });
  };

  return (
    <section
      className={`${previewStyles.themePanel} motion-card`}
      data-theme={theme}
      aria-labelledby={`${theme}-preview-title`}
    >
      <header className={previewStyles.themeHeader}>
        <h2 className={previewStyles.themeTitle} id={`${theme}-preview-title`}>
          {theme === "light" ? "Light" : "Dark"} theme preview
        </h2>
        <p className={previewStyles.themeDescription}>Component preview only</p>
      </header>

      <section
        className={previewStyles.section}
        aria-labelledby={`${theme}-buttons-title`}
      >
        <h3
          className={previewStyles.sectionTitle}
          id={`${theme}-buttons-title`}
        >
          Buttons and states
        </h3>
        <div className={previewStyles.buttonRow}>
          <Button onClick={() => showToast("success")}>Primary preview</Button>
          <Button variant="secondary" onClick={() => showToast("info")}>
            Secondary preview
          </Button>
          <Button
            variant="quiet"
            size="compact"
            onClick={() => showToast("warning")}
          >
            Compact preview
          </Button>
          <Button loading loadingLabel="Loading preview">
            Submit preview
          </Button>
          <Button disabled variant="secondary">
            Disabled preview
          </Button>
        </div>
      </section>

      <section
        className={previewStyles.section}
        aria-labelledby={`${theme}-fields-title`}
      >
        <h3 className={previewStyles.sectionTitle} id={`${theme}-fields-title`}>
          Field and select previews
        </h3>
        <Field
          id={`${theme}-sample-field`}
          label="Example field"
          hint="Helper text preview. This field has no provider connection."
          error={
            showValidation
              ? "Illustrative validation error; no data was submitted."
              : undefined
          }
        >
          <input
            className={controlStyles.control}
            value={fieldValue}
            onChange={(event) => setFieldValue(event.currentTarget.value)}
            autoComplete="off"
          />
        </Field>
        <Select
          id={`${theme}-sample-select`}
          label="Example select"
          value={selectedOption}
          options={[
            { value: "first", label: "First example option" },
            { value: "second", label: "Second example option" },
            {
              value: "unavailable",
              label: "Disabled example option",
              disabled: true,
            },
          ]}
          onChange={(event) => setSelectedOption(event.currentTarget.value)}
          error={
            showValidation
              ? "Illustrative select error; choose an example option."
              : undefined
          }
        />
        <Button
          variant="secondary"
          size="compact"
          aria-pressed={showValidation}
          onClick={() => setShowValidation((visible) => !visible)}
        >
          {showValidation ? "Hide" : "Show"} validation preview
        </Button>
      </section>

      <section
        className={previewStyles.section}
        aria-labelledby={`${theme}-json-title`}
      >
        <h3 className={previewStyles.sectionTitle} id={`${theme}-json-title`}>
          Large JSON editor preview
        </h3>
        <JsonEditor
          id={`${theme}-synthetic-json`}
          label="Synthetic example text"
          value={editorValue}
          onChange={setEditorValue}
          hint="Synthetic content only. The editor does not parse or submit this text."
          error={
            showValidation
              ? "Illustrative external JSON validation error."
              : undefined
          }
          rows={10}
        />
      </section>

      <section
        className={previewStyles.section}
        aria-labelledby={`${theme}-confirmation-title`}
      >
        <h3
          className={previewStyles.sectionTitle}
          id={`${theme}-confirmation-title`}
        >
          Manual settings confirmation preview
        </h3>
        <SettingsConfirmation
          id={`${theme}-manual-settings-confirmation`}
          provider="Flow"
          contextLabel="example project"
          checked={confirmed}
          onChange={setConfirmed}
          hint="Toggle to inspect the checked and unchecked states."
        />
      </section>

      <section
        className={previewStyles.section}
        aria-labelledby={`${theme}-notice-title`}
      >
        <h3 className={previewStyles.sectionTitle} id={`${theme}-notice-title`}>
          Inline notice preview
        </h3>
        <Notice kind="info" announce={false}>
          Information notice preview. Important workflow errors stay inline.
        </Notice>
        <Notice kind="error" announce={false}>
          Persistent inline error preview with recovery context.
        </Notice>
      </section>

      <section
        className={previewStyles.section}
        aria-labelledby={`${theme}-toast-title`}
      >
        <h3 className={previewStyles.sectionTitle} id={`${theme}-toast-title`}>
          Toast component previews
        </h3>
        <p className={previewStyles.sampleCaption}>
          These labeled examples do not announce or represent real activity.
        </p>
        <div className={previewStyles.toastPreviews}>
          {visibleToastExamples.map((notification) => (
            <Toast
              key={notification.id}
              notification={notification}
              announce={false}
              onDismiss={() =>
                setVisibleToastExamples((current) =>
                  current.filter((item) => item.id !== notification.id),
                )
              }
            />
          ))}
        </div>
        <div className={previewStyles.toastTriggerRow}>
          {(["success", "info", "warning", "error"] as const).map((kind) => (
            <Button
              key={kind}
              size="compact"
              variant="secondary"
              onClick={() => showToast(kind)}
            >
              Trigger {kind} preview toast
            </Button>
          ))}
        </div>
      </section>
    </section>
  );
}

function ComponentPreview() {
  return (
    <main className={previewStyles.page}>
      <header className={previewStyles.header}>
        <p className={previewStyles.eyebrow}>
          P01.2 · Shared component preview
        </p>
        <h1 className={previewStyles.title}>Automat Faceless controls</h1>
        <p className={previewStyles.disclaimer}>
          Preview only. No provider connections, settings changes, generation,
          downloads, or real workflow activity are active here.
        </p>
      </header>
      <div className={previewStyles.themeGrid}>
        <ThemePanel theme="light" />
        <ThemePanel theme="dark" />
      </div>
    </main>
  );
}

export default function App() {
  return (
    <ToastHost maxVisible={4}>
      <ComponentPreview />
    </ToastHost>
  );
}
