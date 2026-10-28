import React, { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Field } from "./Field";
import { JsonEditor } from "./JsonEditor";
import { Notice } from "./Notice";
import { SettingsConfirmation } from "./SettingsConfirmation";
import type { ToastNotification } from "./toastManager";
import { Toast } from "./Toast";

function findElement(
  node: React.ReactNode,
  targetType: string,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, targetType);
      if (found) return found;
    }
    return undefined;
  }

  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (node.type === targetType) return node;

  if (typeof node.type === "function") {
    const component = node.type as (
      props: Record<string, unknown>,
    ) => React.ReactNode;
    return findElement(component(node.props), targetType);
  }

  return findElement(node.props.children as React.ReactNode, targetType);
}

function findElements(
  node: React.ReactNode,
  targetType: string,
): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findElements(child, targetType));
  }

  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (typeof node.type === "function") {
    const component = node.type as (
      props: Record<string, unknown>,
    ) => React.ReactNode;
    return findElements(component(node.props), targetType);
  }

  const matches = node.type === targetType ? [node] : [];
  return [
    ...matches,
    ...findElements(node.props.children as React.ReactNode, targetType),
  ];
}

describe("shared controls", () => {
  it("preserves JSON editor values and edits exactly the supplied string", () => {
    const onChange = vi.fn<(value: string) => void>();
    const original = ' {\r\n  "prompt": "keep this",\r\n}\n  ';
    const edited = '\n  {"text":"unchanged spacing"}  \n';
    const tree = JsonEditor({
      id: "json-input",
      label: "JSON preview",
      value: original,
      onChange,
    });
    const textarea = findElement(tree, "textarea");

    expect(textarea?.props.value).toBe(original);
    (textarea?.props.onChange as (event: unknown) => void)({
      currentTarget: { value: edited },
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(edited);
  });

  it("toggles JSON presentation controls without changing the raw value", () => {
    const raw = ' {\r\n  "prompt": "keep every character",\r\n}\n  ';
    const onChange = vi.fn<(value: string) => void>();
    const onWrapLinesChange = vi.fn<(wrap: boolean) => void>();
    const onExpandedChange = vi.fn<(expanded: boolean) => void>();
    const tree = JsonEditor({
      id: "json-display-controls",
      label: "JSON sample",
      value: raw,
      onChange,
      wrapLines: false,
      onWrapLinesChange,
      expanded: false,
      onExpandedChange,
    });
    const [wrapButton, expandButton] = findElements(tree, "button");
    const textarea = findElement(tree, "textarea");

    expect(wrapButton?.props["aria-pressed"]).toBe(false);
    expect(expandButton?.props["aria-expanded"]).toBe(false);
    expect(textarea?.props.value).toBe(raw);
    expect(textarea?.props.wrap).toBe("off");

    (
      wrapButton?.props.onClick as (event: {
        preventDefault: () => void;
      }) => void
    )({
      preventDefault: vi.fn(),
    });
    (
      expandButton?.props.onClick as (event: {
        preventDefault: () => void;
      }) => void
    )({
      preventDefault: vi.fn(),
    });
    expect(onWrapLinesChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(onExpandedChange).toHaveBeenCalledExactlyOnceWith(true);

    const wrappedTree = JsonEditor({
      id: "json-display-controls",
      label: "JSON sample",
      value: raw,
      onChange,
      wrapLines: true,
      onWrapLinesChange,
      expanded: false,
      onExpandedChange,
    });
    const wrappedTextarea = findElement(wrappedTree, "textarea");
    expect(wrappedTextarea?.props.value).toBe(raw);
    expect(wrappedTextarea?.props.wrap).toBe("soft");
  });

  it("provides a dialog close control for the expanded editor", () => {
    const tree = JsonEditor({
      id: "expanded-json",
      label: "JSON sample",
      value: '{"prompt":"unchanged"}',
      onChange: vi.fn(),
      expanded: true,
      onExpandedChange: vi.fn(),
    });
    const dialog = findElement(tree, "dialog");
    const form = findElement(tree, "form");
    const buttons = findElements(tree, "button");

    expect(dialog?.props.id).toBe("expanded-json-expanded-dialog");
    expect(dialog?.props["aria-labelledby"]).toBe(
      "expanded-json-expanded-title",
    );
    expect(form?.props.method).toBe("dialog");
    expect(buttons[3]?.props.children).toBe("Close editor");
  });

  it("wires field labels, hints, and external errors to the control", () => {
    const tree = Field({
      id: "display-name",
      label: "Display name",
      hint: "Help text",
      error: "External validation message",
      children: React.createElement("input", null),
    });
    const input = findElement(tree, "input");

    expect(input?.props.id).toBe("display-name");
    expect(input?.props["aria-describedby"]).toBe(
      "display-name-hint display-name-error",
    );
    expect(input?.props["aria-invalid"]).toBe(true);
  });

  it("prevents activation while a button is loading", () => {
    const onClick = vi.fn();
    const tree = Button({
      children: "Start preview",
      loading: true,
      onClick,
    });
    const click = vi.fn();
    const button = tree as ReactElement<Record<string, unknown>>;

    expect(button.props.disabled).toBe(true);
    expect(button.props["aria-busy"]).toBe(true);
    (button.props.onClick as (event: { preventDefault: () => void }) => void)({
      preventDefault: click,
    });
    expect(click).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("reflects checked and externally reset confirmation states", () => {
    const onChange = vi.fn<(checked: boolean) => void>();
    const unchecked = SettingsConfirmation({
      id: "flow-settings",
      provider: "Flow",
      contextLabel: "preview project",
      checked: false,
      onChange,
    });
    const input = findElement(unchecked, "input");

    expect(input?.props.checked).toBe(false);
    (input?.props.onChange as (event: unknown) => void)({
      currentTarget: { checked: true },
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);

    const reset = SettingsConfirmation({
      id: "flow-settings",
      provider: "Flow",
      checked: false,
      onChange,
    });
    expect(findElement(reset, "input")?.props.checked).toBe(false);
  });

  it("announces routine notices politely and only urgent errors assertively", () => {
    const routine = Notice({ kind: "error", children: "Inline error" });
    const urgent = Notice({
      kind: "error",
      urgent: true,
      children: "Urgent inline error",
    });

    expect(
      isValidElement<{ "aria-live": string }>(routine) &&
        routine.props["aria-live"],
    ).toBe("polite");
    expect(
      isValidElement<{ "aria-live": string }>(urgent) &&
        urgent.props["aria-live"],
    ).toBe("assertive");
  });

  it("keeps toast previews non-announcing unless explicitly configured", () => {
    const notification: ToastNotification = {
      id: "preview-toast",
      kind: "info",
      message: "Information preview only",
      urgent: false,
      actionable: false,
      exiting: false,
    };
    const tree = Toast({ notification, announce: false });

    expect(isValidElement<{ role: string }>(tree) && tree.props.role).toBe(
      "group",
    );
    expect(
      isValidElement<{ "aria-live": string }>(tree) && tree.props["aria-live"],
    ).toBe("off");
  });

  it("announces only urgent error toasts assertively and wires dismissal", () => {
    const onDismiss = vi.fn();
    const notification: ToastNotification = {
      id: "urgent-toast",
      kind: "error",
      message: "Action needed",
      urgent: true,
      actionable: true,
      exiting: false,
    };
    const tree = Toast({ notification, onDismiss });
    const button = findElement(tree, "button");

    expect(isValidElement<{ role: string }>(tree) && tree.props.role).toBe(
      "alert",
    );
    expect(
      isValidElement<{ "aria-live": string }>(tree) && tree.props["aria-live"],
    ).toBe("assertive");
    (button?.props.onClick as () => void)();
    expect(onDismiss).toHaveBeenCalledOnce();

    const routineTree = Toast({
      notification: { ...notification, urgent: false },
    });
    expect(
      isValidElement<{ "aria-live": string }>(routineTree) &&
        routineTree.props["aria-live"],
    ).toBe("polite");
  });
});
