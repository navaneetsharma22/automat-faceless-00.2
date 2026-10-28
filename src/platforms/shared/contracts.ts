export type ProviderName = "Flow" | "Vids";

export type ProviderTab = {
  id: number;
  title: string;
  url: string;
  provider: ProviderName;
  canonicalTarget: string;
};

export const CONNECTION_PROBE_MESSAGE =
  "AUTOMAT_FACELESS_CONNECTION_PROBE" as const;

export type ConnectionProbeResponse = {
  ok: boolean;
  provider?: ProviderName;
  canonicalTarget?: string;
  adapterCapability?: "read-only-connection-v1";
  error?: string;
};

export type ConnectionPort = {
  requestAccess: (provider: ProviderName) => Promise<boolean>;
  getTab: (tabId: number) => Promise<ProviderTab | undefined>;
  injectTopFrameProbe: (tabId: number) => Promise<void>;
  probeTopFrame: (
    tabId: number,
    provider: ProviderName,
  ) => Promise<ConnectionProbeResponse | undefined>;
};

export type ConnectionResult =
  { ok: true; tab: ProviderTab } | { ok: false; error: string };
