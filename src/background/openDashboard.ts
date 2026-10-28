export const FOCUS_DASHBOARD_MESSAGE = "AUTOMAT_FOCUS_DASHBOARD" as const;

export type DashboardActionApi = {
  action: {
    onClicked: {
      addListener: (listener: () => void) => void;
    };
  };
  tabs: {
    create: (properties: { url: string }) => Promise<{ id?: number } | unknown>;
  };
  runtime: {
    getURL: (path: string) => string;
    sendMessage: (message: unknown) => Promise<unknown>;
  };
};

export function registerDashboardAction(api: DashboardActionApi): void {
  let activation: Promise<void> | undefined;
  api.action.onClicked.addListener(() => {
    if (activation) return;
    activation = focusExistingOrOpen(api).finally(() => {
      activation = undefined;
    });
  });
}

async function focusExistingOrOpen(api: DashboardActionApi): Promise<void> {
  try {
    const result = await api.runtime.sendMessage({
      type: FOCUS_DASHBOARD_MESSAGE,
    });
    if (
      result &&
      typeof result === "object" &&
      "focused" in result &&
      result.focused === true
    ) {
      return;
    }
  } catch {
    // No dashboard view is open; create the extension tab below.
  }
  await api.tabs.create({ url: api.runtime.getURL("index.html") });
}
