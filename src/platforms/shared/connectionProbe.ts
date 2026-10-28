import { providerTabFromUrl } from "./connection";
import type { ConnectionProbeResponse, ProviderName } from "./contracts";
import { CONNECTION_PROBE_MESSAGE } from "./contracts";

type ProbeMessage = {
  type: typeof CONNECTION_PROBE_MESSAGE;
  provider: ProviderName;
};

const runtime = globalThis.chrome?.runtime;
const probeScope = globalThis as typeof globalThis & {
  __automatFacelessConnectionProbeInstalled?: boolean;
};

if (
  runtime?.onMessage &&
  typeof document !== "undefined" &&
  !probeScope.__automatFacelessConnectionProbeInstalled
) {
  probeScope.__automatFacelessConnectionProbeInstalled = true;
  runtime.onMessage.addListener(
    (message: ProbeMessage, sender, sendResponse) => {
      if (message?.type !== CONNECTION_PROBE_MESSAGE) return false;
      if (sender.frameId !== 0) {
        sendResponse({
          ok: false,
          error: "Only the provider tab's top frame is supported.",
        });
        return false;
      }

      const target = providerTabFromUrl(
        sender.tab?.id ?? -1,
        document.title,
        location.href,
      );
      const response: ConnectionProbeResponse =
        target?.provider === message.provider
          ? {
              ok: true,
              provider: target.provider,
              canonicalTarget: target.canonicalTarget,
              adapterCapability: "read-only-connection-v1",
            }
          : {
              ok: false,
              error: `The selected page does not expose the expected read-only ${message.provider} adapter.`,
            };
      sendResponse(response);
      return false;
    },
  );
}
