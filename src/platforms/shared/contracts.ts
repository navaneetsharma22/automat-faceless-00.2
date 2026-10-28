export type ProviderName = "Flow" | "Vids";

export type ProviderTab = {
  id: number;
  title: string;
  url: string;
  provider: ProviderName;
  projectId: string;
  canonicalTarget: string;
};

export const CONNECTION_PROBE_MESSAGE =
  "AUTOMAT_FACELESS_CONNECTION_PROBE" as const;
export const CONNECTION_DISCONNECT_MESSAGE =
  "AUTOMAT_FACELESS_CONNECTION_DISCONNECT" as const;
export const CONNECTOR_PROTOCOL_VERSION = 1 as const;
export const CONNECTION_CAPABILITY = "read-only-connection-v1" as const;

export type ConnectionProbeRequest = {
  type: typeof CONNECTION_PROBE_MESSAGE;
  provider: ProviderName;
  canonicalTarget: string;
  projectId: string;
  protocolVersion: number;
  buildId: string;
  attemptId: string;
};

export type ConnectionProbeResponse = {
  ok: boolean;
  provider?: ProviderName;
  canonicalTarget?: string;
  projectId?: string;
  protocolVersion?: number;
  buildId?: string;
  attemptId?: string;
  documentToken?: string;
  capabilities?: readonly string[];
  error?: string;
};

export type DocumentIdentity = {
  documentId: string;
  frameId: number;
  url: string;
};

export type ConnectionPort = {
  requestAccess: (provider: ProviderName) => Promise<boolean>;
  getTab: (tabId: number) => Promise<ProviderTab | undefined>;
  pingTopFrame: (
    tabId: number,
    request: ConnectionProbeRequest,
  ) => Promise<ConnectionProbeResponse | undefined>;
  identifyDocument: (tabId: number) => Promise<DocumentIdentity | undefined>;
  injectConnector: (tabId: number) => Promise<DocumentIdentity | undefined>;
  probeTopFrame: (
    tabId: number,
    documentId: string,
    request: ConnectionProbeRequest,
  ) => Promise<ConnectionProbeResponse | undefined>;
  releaseConnector: (tabId: number, documentId: string) => Promise<void>;
  makeAttemptId: () => string;
};

export type ConnectionStateName =
  | "pending"
  | "connected"
  | "disconnected"
  | "permission-needed"
  | "wrong-target"
  | "stale-build"
  | "failed";

export type ConnectionResult =
  | {
      ok: true;
      tab: ProviderTab;
      documentId: string;
      documentToken: string;
      state: "connected";
      capabilities: readonly [typeof CONNECTION_CAPABILITY];
    }
  | {
      ok: false;
      state: Exclude<
        ConnectionStateName,
        "connected" | "disconnected" | "pending"
      >;
      error: string;
    };
