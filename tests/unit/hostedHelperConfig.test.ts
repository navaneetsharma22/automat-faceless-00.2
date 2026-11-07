import { describe, expect, it, vi } from "vitest";
import { createHostedHelperConfigListener } from "../../src/background/handlers/hostedHelper";
import {
  createHostedPickerUrl,
  HOSTED_HELPER_CONFIG_PING,
  HOSTED_PICKER_ORIGIN,
  HOSTED_PICKER_PATH,
  isAuthorizedHostedHelperSender,
} from "../../src/shared/utils/hostedMp4Handoff";
import { parseExtensionLaunchConfig } from "../../external/vids-helper/logic.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const helperUrl = `${HOSTED_PICKER_ORIGIN}${HOSTED_PICKER_PATH}?extensionId=${extensionId}`;

describe("hosted Vids helper configuration binding", () => {
  it("builds the existing helper URL with only the current extension identity", () => {
    expect(createHostedPickerUrl(extensionId)).toBe(helperUrl);
    expect(parseExtensionLaunchConfig(new URL(helperUrl).search)).toBe(extensionId);
    for (const [search, hash] of [
      [`?extensionId=${extensionId}&extensionId=${extensionId}`, ""],
      [`?extensionId=${extensionId}&unexpected=1`, ""],
      [`?extensionId=${extensionId}`, "#unexpected"],
      ["?extensionId=previous-fixed-id", ""],
    ]) {
      expect(parseExtensionLaunchConfig(search, hash)).toBeUndefined();
    }
    expect(createHostedPickerUrl("legacy-helper-extension-id")).toBeUndefined();
    expect(createHostedPickerUrl(undefined as never)).toBeUndefined();
  });

  it("accepts only the exact helper origin, path, target identity, and top-level tab", () => {
    const validSender = { url: helperUrl, origin: HOSTED_PICKER_ORIGIN, frameId: 0, tab: { id: 12 }, documentId: "helper-doc-1" };
    expect(isAuthorizedHostedHelperSender(validSender, extensionId)).toBe(true);
    for (const sender of [
      { ...validSender, url: `${HOSTED_PICKER_ORIGIN}/other/?extensionId=${extensionId}` },
      { ...validSender, url: `https://attacker.example${HOSTED_PICKER_PATH}?extensionId=${extensionId}` },
      { ...validSender, origin: "https://attacker.example" },
      { ...validSender, origin: undefined },
      { ...validSender, url: `${HOSTED_PICKER_ORIGIN}${HOSTED_PICKER_PATH}nested?extensionId=${extensionId}` },
      { ...validSender, url: `${HOSTED_PICKER_ORIGIN}${HOSTED_PICKER_PATH}?extensionId=ponmlkjihgfedcbaponmlkjihgfedcba` },
      { ...validSender, url: `${helperUrl}&extensionId=${extensionId}` },
      { ...validSender, url: `${helperUrl}&unexpected=1` },
      { ...validSender, url: `${helperUrl}#fragment` },
      { ...validSender, frameId: 3 },
      { ...validSender, tab: undefined },
      { ...validSender, documentId: undefined },
      { ...validSender, documentId: "" },
    ])
      expect(isAuthorizedHostedHelperSender(sender, extensionId)).toBe(false);
  });

  it("answers only a strict configuration ping from the bound hosted helper sender", () => {
    const listener = createHostedHelperConfigListener(extensionId);
    const validSender = { url: helperUrl, origin: HOSTED_PICKER_ORIGIN, frameId: 0, tab: { id: 12 }, documentId: "helper-doc-1" };
    const sendResponse = vi.fn();

    expect(listener({ type: HOSTED_HELPER_CONFIG_PING }, validSender, sendResponse)).toBe(false);
    expect(sendResponse).toHaveBeenLastCalledWith({ success: true, status: "configured" });

    listener({ type: HOSTED_HELPER_CONFIG_PING, token: "must-not-be-accepted" }, validSender, sendResponse);
    expect(sendResponse).toHaveBeenLastCalledWith({ success: false, status: "rejected" });

    listener({ type: HOSTED_HELPER_CONFIG_PING }, { ...validSender, frameId: 1 }, sendResponse);
    expect(sendResponse).toHaveBeenLastCalledWith({ success: false, status: "rejected" });
  });

  it("returns a validated document binding only from the bound helper and omits unavailable documents", async () => {
    const validSender = { url: helperUrl, origin: HOSTED_PICKER_ORIGIN, frameId: 0, tab: { id: 12 }, documentId: "helper-doc-1" };
    const sendResponse = vi.fn();
    const listener = createHostedHelperConfigListener(extensionId, async () => "verified-vids-document-01");
    expect(listener({ type: HOSTED_HELPER_CONFIG_PING }, validSender, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      status: "configured",
      expectedDocumentId: "verified-vids-document-01",
    }));

    const resolveDocument = vi.fn(async () => "verified-vids-document-02");
    const guarded = createHostedHelperConfigListener(extensionId, resolveDocument);
    guarded({ type: HOSTED_HELPER_CONFIG_PING }, { ...validSender, frameId: 1 }, sendResponse);
    expect(resolveDocument).not.toHaveBeenCalled();

    const absent = createHostedHelperConfigListener(extensionId, async () => undefined);
    absent({ type: HOSTED_HELPER_CONFIG_PING }, validSender, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenLastCalledWith({ success: true, status: "configured" }));

    const malformed = createHostedHelperConfigListener(extensionId, async () => "https://attacker.example/id");
    malformed({ type: HOSTED_HELPER_CONFIG_PING }, validSender, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenLastCalledWith({ success: true, status: "configured" }));
  });
});
