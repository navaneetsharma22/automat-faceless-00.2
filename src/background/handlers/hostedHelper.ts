import {
  HostedHelperConfigPingResponseSchema,
  HostedHelperConfigPingSchema,
} from "../../shared/schemas";
import { isAuthorizedHostedHelperSender } from "../../shared/utils/hostedMp4Handoff";

export type HostedHelperMessageSender = {
  url?: string;
  origin?: string;
  frameId?: number;
  tab?: { id?: number };
};

export function createHostedHelperConfigListener(
  extensionId: string,
  getVerifiedVidsDocumentId?: () => Promise<string | undefined>,
) {
  return (
    message: unknown,
    sender: HostedHelperMessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    const isConfigMessage = message !== null && typeof message === "object" &&
      "type" in message && message.type === "VIDS_HELPER_CONFIG_PING";
    if (!isConfigMessage) return false;
    const accepted = HostedHelperConfigPingSchema.safeParse(message).success &&
      isAuthorizedHostedHelperSender(sender, extensionId);
    if (!accepted) {
      sendResponse({ success: false, status: "rejected" });
      return false;
    }
    if (!getVerifiedVidsDocumentId) {
      sendResponse({ success: true, status: "configured" });
      return false;
    }
    void getVerifiedVidsDocumentId().then((documentId) => {
      sendResponse(HostedHelperConfigPingResponseSchema.parse({
        success: true,
        status: "configured",
        ...(typeof documentId === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(documentId)
          ? { expectedDocumentId: documentId }
          : {}),
      }));
    }).catch(() => {
      sendResponse({ success: true, status: "configured" });
    });
    return true;
  };
}
