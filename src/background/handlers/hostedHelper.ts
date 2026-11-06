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

export function createHostedHelperConfigListener(extensionId: string) {
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
    sendResponse(
      HostedHelperConfigPingResponseSchema.parse(
        accepted
          ? { success: true, status: "configured" }
          : { success: false, status: "rejected" },
      ),
    );
    return false;
  };
}
