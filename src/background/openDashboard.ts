export type DashboardActionApi = {
  action: {
    onClicked: {
      addListener: (listener: () => void) => void;
    };
  };
  tabs: {
    create: (properties: { url: string }) => Promise<unknown>;
  };
  runtime: {
    getURL: (path: string) => string;
  };
};

export function registerDashboardAction(api: DashboardActionApi): void {
  api.action.onClicked.addListener(() => {
    void api.tabs.create({ url: api.runtime.getURL("index.html") });
  });
}
