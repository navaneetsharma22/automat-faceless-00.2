import { describe, expect, it, vi } from "vitest";
import {
  FOCUS_DASHBOARD_MESSAGE,
  registerDashboardAction,
} from "../../src/background/openDashboard";
import { registerDashboardFocusResponder } from "../../src/app/dashboardFocus";

function dashboardActionHarness(
  sendMessage: (message: unknown) => Promise<unknown>,
) {
  let onClicked!: () => void;
  const create = vi.fn(async () => ({ id: 8 }));
  const update = vi.fn(async () => undefined);
  const remove = vi.fn();
  const reload = vi.fn();
  registerDashboardAction({
    action: {
      onClicked: { addListener: (listener) => (onClicked = listener) },
    },
    tabs: { create, update, remove, reload } as never,
    runtime: {
      getURL: (path) => `chrome-extension://extension-id/${path}`,
      sendMessage,
    },
  });
  return { onClicked, create, update, remove, reload };
}

describe("toolbar dashboard action", () => {
  it("opens only an extension dashboard tab when no dashboard is available", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("no receiver"));
    const { onClicked, create, update, remove, reload } =
      dashboardActionHarness(sendMessage);
    onClicked();
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());

    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      type: FOCUS_DASHBOARD_MESSAGE,
    });
    expect(create).toHaveBeenCalledExactlyOnceWith({
      url: "chrome-extension://extension-id/index.html",
    });
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("focuses an existing dashboard and creates no extra tab", async () => {
    const sendMessage = vi.fn(async () => ({ focused: true }));
    const { onClicked, create } = dashboardActionHarness(sendMessage);
    onClicked();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(create).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));
    onClicked();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(create).not.toHaveBeenCalled();
  });

  it("coalesces overlapping toolbar activations while resolving focus", async () => {
    let respond!: (result: unknown) => void;
    const sendMessage = vi.fn(
      () => new Promise<unknown>((resolve) => (respond = resolve)),
    );
    const { onClicked, create } = dashboardActionHarness(sendMessage);
    onClicked();
    onClicked();
    expect(sendMessage).toHaveBeenCalledOnce();
    respond({ focused: true });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(create).not.toHaveBeenCalled();
  });
});

describe("dashboard focus responder", () => {
  it("focuses only the tab containing the dashboard document", async () => {
    let listener!: (
      message: unknown,
      sender: unknown,
      respond: (value: unknown) => void,
    ) => boolean;
    const addListener = vi.fn((callback) => (listener = callback));
    const removeListener = vi.fn();
    const tabs = {
      getCurrent: vi.fn(async () => ({ id: 12, windowId: 4 })),
      update: vi.fn(async () => undefined),
    };
    const windows = { update: vi.fn(async () => undefined) };
    const dispose = registerDashboardFocusResponder({
      runtime: {
        onMessage: { addListener, removeListener },
      },
      tabs,
      windows,
    });
    const respond = vi.fn();

    expect(listener({ type: FOCUS_DASHBOARD_MESSAGE }, {}, respond)).toBe(true);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({ focused: true }),
    );
    expect(tabs.update).toHaveBeenCalledExactlyOnceWith(12, { active: true });
    expect(windows.update).toHaveBeenCalledExactlyOnceWith(4, {
      focused: true,
    });
    expect(removeListener).not.toHaveBeenCalled();
    dispose();
    expect(removeListener).toHaveBeenCalledExactlyOnceWith(listener);
  });

  it("ignores unrelated messages and reports when the current tab is unavailable", async () => {
    let listener!: (
      message: unknown,
      sender: unknown,
      respond: (value: unknown) => void,
    ) => boolean;
    const addListener = vi.fn(
      (callback: typeof listener) => (listener = callback),
    );
    const tabs = {
      getCurrent: vi.fn(async () => undefined),
      update: vi.fn(),
    };
    const windows = { update: vi.fn() };
    registerDashboardFocusResponder({
      runtime: {
        onMessage: { addListener, removeListener: vi.fn() },
      },
      tabs,
      windows,
    });

    expect(listener({ type: "other" }, {}, vi.fn())).toBe(false);
    const respond = vi.fn();
    expect(listener({ type: FOCUS_DASHBOARD_MESSAGE }, {}, respond)).toBe(true);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({ focused: false }),
    );
    expect(tabs.update).not.toHaveBeenCalled();
    expect(windows.update).not.toHaveBeenCalled();
  });
});
