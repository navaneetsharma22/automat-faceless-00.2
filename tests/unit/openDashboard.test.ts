import { describe, expect, it, vi } from "vitest";
import { registerDashboardAction } from "../../src/background/openDashboard";

describe("toolbar dashboard action", () => {
  it("opens only an extension dashboard tab and never mutates a provider tab", () => {
    let onClicked!: () => void;
    const create = vi.fn(async () => ({ id: 8 }));
    const update = vi.fn();
    const remove = vi.fn();
    const reload = vi.fn();
    registerDashboardAction({
      action: {
        onClicked: { addListener: (listener) => (onClicked = listener) },
      },
      tabs: { create, update, remove, reload } as never,
      runtime: { getURL: (path) => `chrome-extension://extension-id/${path}` },
    });
    onClicked();

    expect(create).toHaveBeenCalledExactlyOnceWith({
      url: "chrome-extension://extension-id/index.html",
    });
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
