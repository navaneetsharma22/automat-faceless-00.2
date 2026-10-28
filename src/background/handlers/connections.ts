import { BUILD_ID, PROTOCOL_VERSION } from "../../shared/buildInfo";
import { AppRequestSchema } from "../../shared/schemas";
import type {
  AppRequest,
  AppResponse,
  FailureCategory,
} from "../../shared/schemas";
import type {
  ExtensionRepositories,
  ChromePreferenceRepository,
} from "../../storage/repositories";

export type ExtensionMessageSender = {
  id?: string;
  url?: string;
};

export type FoundationDependencies = {
  repositories: ExtensionRepositories;
  preferences: ChromePreferenceRepository;
  ready?: Promise<void>;
};

export type SendResponse = (response: AppResponse) => void;

function failure(
  requestId: string,
  category: FailureCategory,
  code: string,
  message: string,
): AppResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    buildId: BUILD_ID,
    requestId,
    ok: false,
    error: { category, code, message },
  };
}

function allowedDashboardSender(
  sender: ExtensionMessageSender,
  extensionId: string,
): boolean {
  return (
    sender.id === extensionId &&
    sender.url === `chrome-extension://${extensionId}/index.html`
  );
}

async function dispatch(
  request: AppRequest,
  dependencies: FoundationDependencies,
): Promise<unknown> {
  switch (request.type) {
    case "foundation.ping":
      return { state: "ready" };
    case "promptDraft.put": {
      const record = await dependencies.repositories.savePromptDraft(
        request.payload,
      );
      return {
        id: record.id,
        characterCount: record.rawText.length,
        updatedAt: record.updatedAt,
      };
    }
    case "promptDraft.get": {
      const record = await dependencies.repositories.getPromptDraft(
        request.payload.id,
      );
      if (!record) {
        throw new FoundationOperationError(
          "not_found",
          "draft_not_found",
          "The requested local prompt draft was not found.",
        );
      }
      return record;
    }
    case "connections.recordSelection": {
      const record = await dependencies.repositories.recordSelectedTarget(
        request.payload,
      );
      return {
        provider: record.provider,
        tabId: record.tabId,
        verification: record.verification,
      };
    }
    case "connections.getSelection":
      return (
        (await dependencies.repositories.getSelectedTarget(
          request.payload.provider,
        )) ?? null
      );
    case "preferences.getTheme":
      return { theme: await dependencies.preferences.getTheme() };
    case "preferences.setTheme":
      await dependencies.preferences.setTheme(request.payload.theme);
      return { theme: request.payload.theme };
  }
}

export class FoundationOperationError extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createConnectionMessageListener(
  extensionId: string,
  dependencies: FoundationDependencies,
) {
  const seenRequestIds = new Set<string>();
  const recentRequestIds: string[] = [];

  return (
    rawRequest: unknown,
    sender: ExtensionMessageSender,
    sendResponse: SendResponse,
  ): true => {
    const parsed = parseRequest(rawRequest);
    if (!parsed.ok) {
      sendResponse(
        failure(
          "invalid-request",
          "invalid_request",
          "invalid_request",
          "The request did not match the supported message schema.",
        ),
      );
      return true;
    }
    const request = parsed.request;
    if (!allowedDashboardSender(sender, extensionId)) {
      sendResponse(
        failure(
          request.requestId,
          "unauthorized_sender",
          "unauthorized_sender",
          "Only the extension dashboard may issue this request.",
        ),
      );
      return true;
    }
    if (request.protocolVersion !== PROTOCOL_VERSION) {
      sendResponse(
        failure(
          request.requestId,
          "protocol_mismatch",
          "protocol_mismatch",
          "The dashboard and worker message protocols do not match.",
        ),
      );
      return true;
    }
    if (request.buildId !== BUILD_ID) {
      sendResponse(
        failure(
          request.requestId,
          "build_mismatch",
          "build_mismatch",
          "The dashboard and worker builds do not match.",
        ),
      );
      return true;
    }
    if (seenRequestIds.has(request.requestId)) {
      sendResponse(
        failure(
          request.requestId,
          "duplicate_request",
          "duplicate_request",
          "A request with this ID is already being handled.",
        ),
      );
      return true;
    }

    seenRequestIds.add(request.requestId);
    recentRequestIds.push(request.requestId);
    if (recentRequestIds.length > 256) {
      seenRequestIds.delete(recentRequestIds.shift()!);
    }
    void Promise.resolve(dependencies.ready)
      .then(() => dispatch(request, dependencies))
      .then((data) => {
        sendResponse({
          protocolVersion: PROTOCOL_VERSION,
          buildId: BUILD_ID,
          requestId: request.requestId,
          ok: true,
          data,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof FoundationOperationError) {
          sendResponse(
            failure(
              request.requestId,
              error.category,
              error.code,
              error.message,
            ),
          );
          return;
        }
        sendResponse(
          failure(
            request.requestId,
            "storage_failure",
            "operation_failed",
            "The extension could not complete this local operation.",
          ),
        );
      });
    return true;
  };
}

function parseRequest(
  rawRequest: unknown,
): { ok: true; request: AppRequest } | { ok: false } {
  // Kept local so invalid payloads never leak Zod's value-bearing diagnostics.
  const result = AppRequestSchema.safeParse(rawRequest);
  return result.success ? { ok: true, request: result.data } : { ok: false };
}
