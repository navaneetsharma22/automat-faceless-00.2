import { FOCUS_DASHBOARD_MESSAGE } from "../background/openDashboard";

type RuntimeMessage = (
  message: unknown,
  sender: unknown,
  respond: (value: unknown) => void,
) => boolean;

export type DashboardFocusApi = {
  runtime: {
    onMessage: {
      addListener: (listener: RuntimeMessage) => void;
      removeListener: (listener: RuntimeMessage) => void;
    };
  };
  tabs: {
    getCurrent: () => Promise<{ id?: number; windowId?: number } | undefined>;
    update: (tabId: number, properties: { active: true }) => Promise<unknown>;
  };
  windows: {
    update: (
      windowId: number,
      properties: { focused: true },
    ) => Promise<unknown>;
  };
};

export function registerDashboardFocusResponder(
  api: DashboardFocusApi,
): () => void {
  const listener: RuntimeMessage = (message, _sender, respond) => {
    if (
      !message ||
      typeof message !== "object" ||
      !("type" in message) ||
      message.type !== FOCUS_DASHBOARD_MESSAGE
    ) {
      return false;
    }

    void api.tabs
      .getCurrent()
      .then(async (tab) => {
        if (tab?.id === undefined || tab.windowId === undefined) {
          respond({ focused: false });
          return;
        }
        await api.tabs.update(tab.id, { active: true });
        await api.windows.update(tab.windowId, { focused: true });
        respond({ focused: true });
      })
      .catch(() => respond({ focused: false }));
    return true;
  };

  api.runtime.onMessage.addListener(listener);
  return () => api.runtime.onMessage.removeListener(listener);
}
