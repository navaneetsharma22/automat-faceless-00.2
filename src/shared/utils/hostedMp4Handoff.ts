export const HOSTED_PICKER_ORIGIN = "https://navaneetsharma22.github.io";
export const HOSTED_PICKER_PATH = "/automat-faceless-picker/";
export const HOSTED_HELPER_CONFIG_PING = "VIDS_HELPER_CONFIG_PING";

export interface HostedHelperSender {
  url?: string;
  origin?: string;
  frameId?: number;
  tab?: { id?: number };
  documentId?: string;
}

const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export function isChromeExtensionId(value: unknown): value is string {
  return typeof value === "string" && CHROME_EXTENSION_ID_PATTERN.test(value);
}

export function createHostedPickerUrl(extensionId: string): string | undefined {
  if (!isChromeExtensionId(extensionId)) return undefined;
  const url = new URL(HOSTED_PICKER_PATH, HOSTED_PICKER_ORIGIN);
  url.searchParams.set("extensionId", extensionId);
  return url.href;
}

export function isAuthorizedHostedHelperSender(
  sender: HostedHelperSender,
  expectedExtensionId: string,
): boolean {
  if (
    sender.frameId !== 0 ||
    sender.origin !== HOSTED_PICKER_ORIGIN ||
    !Number.isInteger(sender.tab?.id) ||
    sender.tab!.id! < 0 ||
    typeof sender.documentId !== "string" ||
    sender.documentId.length < 1 ||
    sender.documentId.length > 256 ||
    !sender.url ||
    !isChromeExtensionId(expectedExtensionId)
  )
    return false;
  try {
    const url = new URL(sender.url);
    return (
      url.origin === HOSTED_PICKER_ORIGIN &&
      url.pathname === HOSTED_PICKER_PATH &&
      !url.username &&
      !url.password &&
      [...url.searchParams.keys()].length === 1 &&
      url.searchParams.getAll("extensionId").length === 1 &&
      url.searchParams.get("extensionId") === expectedExtensionId &&
      !url.hash
    );
  } catch {
    return false;
  }
}

