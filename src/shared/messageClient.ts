import { BUILD_ID } from "./buildInfo";
import { AppResponseSchema, type FailureCategory } from "./schemas";
import {
  DEFAULT_TIMEOUT_MS,
  makeRequest,
  type FoundationClientOptions,
  type MessageTransport,
  type RequestPayloads,
  type RequestTypes,
} from "./messages";

export class FoundationClientError extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FoundationClientError";
  }
}

function makeId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `req-${crypto.randomUUID()}`;
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isMissingReceiver(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /receiving end does not exist|could not establish connection|no receiver/i.test(
    error.message,
  );
}

export function createFoundationClient(
  transport: MessageTransport,
  options: FoundationClientOptions = {},
) {
  const buildId = options.buildId ?? BUILD_ID;
  const timeouts = { ...DEFAULT_TIMEOUT_MS, ...options.timeoutMs };
  const makeRequestId = options.makeRequestId ?? makeId;

  return {
    async request<T extends RequestTypes>(
      type: T,
      payload: RequestPayloads[T],
    ): Promise<unknown> {
      const requestId = makeRequestId();
      const request = makeRequest(type, payload, requestId, buildId);
      options.onPending?.(requestId, type);

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        const rawResponse = await Promise.race([
          transport.sendMessage(request),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () =>
                reject(
                  new FoundationClientError(
                    "timeout",
                    "response_timeout",
                    `The ${type} request timed out. A late response will be ignored.`,
                  ),
                ),
              Math.min(30_000, Math.max(1, timeouts[type])),
            );
          }),
        ]);
        const parsed = AppResponseSchema.safeParse(rawResponse);
        if (!parsed.success) {
          throw new FoundationClientError(
            "malformed_response",
            "malformed_response",
            "The extension worker returned an invalid response.",
          );
        }
        const response = parsed.data;
        if (response.requestId !== requestId) {
          throw new FoundationClientError(
            "malformed_response",
            "response_id_mismatch",
            "The extension worker response did not match this request.",
          );
        }
        if (response.protocolVersion !== request.protocolVersion) {
          throw new FoundationClientError(
            "protocol_mismatch",
            "response_protocol_mismatch",
            "The dashboard and extension worker use different message protocols.",
          );
        }
        if (response.buildId !== request.buildId) {
          throw new FoundationClientError(
            "build_mismatch",
            "response_build_mismatch",
            "The dashboard and extension worker builds do not match.",
          );
        }
        if (!response.ok) {
          throw new FoundationClientError(
            response.error.category,
            response.error.code,
            response.error.message,
          );
        }
        return response.data;
      } catch (error) {
        if (error instanceof FoundationClientError) throw error;
        if (isMissingReceiver(error)) {
          throw new FoundationClientError(
            "missing_receiver",
            "worker_unavailable",
            "The extension worker is unavailable. Reopen the dashboard and retry.",
          );
        }
        throw new FoundationClientError(
          "worker_error",
          "worker_request_failed",
          "The extension worker could not complete the request.",
        );
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }
    },
  };
}

export function createChromeFoundationClient(
  options: FoundationClientOptions = {},
) {
  return createFoundationClient(
    {
      sendMessage: (message) => {
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
          return Promise.reject(new Error("Extension runtime is unavailable."));
        }
        return chrome.runtime.sendMessage(message);
      },
    },
    options,
  );
}
