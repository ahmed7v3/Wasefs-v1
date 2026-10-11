import { AiProviderError } from "../types.js";

import type { AiErrorCode, ConnectionResult } from "../types.js";

/** HTTP status -> our code. Shared by every adapter so the classes cannot drift. */
export function codeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  // 402 is OpenRouter "insufficient credits": another route may still work, so treat it as provider-down.
  if (status === 402 || status >= 500) return "unavailable";
  if (status >= 400) return "bad_request";
  return "unknown";
}

export function errorForStatus(status: number): AiProviderError {
  return new AiProviderError(codeForStatus(status), status);
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/** Network-level failures (DNS, reset, TLS) surface as TypeError from fetch. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

/** Fallback classification once an adapter's own mapping found nothing. */
export function classifyUnknown(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (isAbortError(error)) return new AiProviderError("timeout");
  if (isNetworkError(error)) return new AiProviderError("unavailable");
  return new AiProviderError("unknown");
}

/** Wraps a probe so `testConnection` never throws and reports only our error codes. */
export async function timedProbe(
  probe: () => Promise<void>,
  mapError: (error: unknown) => AiProviderError,
): Promise<ConnectionResult> {
  const startedAt = performance.now();
  try {
    await probe();
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      errorCode: mapError(error).code,
    };
  }
}
