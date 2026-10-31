import type { VoiceErrorCode } from "./elevenlabs.client.js";

/*
 * The low-level pieces of the ElevenLabs client: reading and classifying an error response and the
 * retry wait. Plain functions; the client (`ElevenLabsClient`) owns the calls, the logging and the retry.
 */

const RETRY_BACKOFF_MS = 600;
const MAX_RETRY_AFTER_MS = 3_000;
const MAX_ERROR_BODY_BYTES = 4_096;
const DETAIL_TOKEN = /^[a-z_]{1,64}$/;

export interface ErrorBody {
  /** `detail.code` (current) or `detail.status` (legacy) when it is a short lowercase token. */
  token: string | undefined;
  /** Free text: only ever matched against, never logged or returned. */
  message: string;
}

/** The error body (at most 4 KB) parsed defensively: anything unexpected reads as empty. */
export async function readErrorBody(response: Response): Promise<ErrorBody> {
  const empty: ErrorBody = { token: undefined, message: "" };
  try {
    const reader = response.body?.getReader();
    if (!reader) return empty;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(bytes.subarray(0, MAX_ERROR_BODY_BYTES)),
    );
    const detail = (parsed as { detail?: unknown } | null)?.detail;
    if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return empty;
    const { code, status, message } = detail as Record<string, unknown>;
    const token = [code, status].find(
      (value): value is string => typeof value === "string" && DETAIL_TOKEN.test(value),
    );
    return { token, message: typeof message === "string" ? message : "" };
  } catch {
    return empty;
  }
}

const BY_TOKEN: Record<string, VoiceErrorCode> = {
  invalid_api_key: "unauthorized",
  missing_api_key: "unauthorized",
  authentication_error: "unauthorized",
  quota_exceeded: "quota_exceeded",
  insufficient_credits: "quota_exceeded",
  voice_not_found: "voice_not_found",
  invalid_voice_id: "voice_not_found",
  voice_access_denied: "voice_not_found",
  model_not_found: "model_not_found",
  unsupported_model: "model_not_found",
  model_access_denied: "model_not_found",
  paid_plan_required: "plan_required",
  payment_required: "plan_required",
  subscription_required: "plan_required",
  feature_not_available: "plan_required",
  free_users_not_allowed: "plan_required",
  detected_unusual_activity: "plan_required",
  output_format_not_allowed: "format_not_allowed",
  invalid_output_format: "format_not_allowed",
  rate_limit_exceeded: "rate_limited",
  concurrent_limit_exceeded: "rate_limited",
  too_many_concurrent_requests: "rate_limited",
  system_busy: "rate_limited",
  max_character_limit_exceeded: "bad_request",
  text_too_long: "bad_request",
  empty_text: "bad_request",
  invalid_text: "bad_request",
  invalid_parameters: "bad_request",
  invalid_voice_settings: "bad_request",
};

/**
 * The error token decides first (ElevenLabs answers some quota and plan errors with a 401), then the
 * HTTP status; the message is only a last hint for an unknown 400 / 403 / 422.
 */
export function classify(op: "stt" | "tts", status: number, body: ErrorBody): VoiceErrorCode {
  const byToken = body.token ? BY_TOKEN[body.token] : undefined;
  if (byToken) return byToken;
  if (status === 429) return "rate_limited";
  if (status >= 500) return "failed";
  if (status === 402) return "plan_required";
  if (status === 404) return op === "tts" ? "voice_not_found" : "failed";
  if (status === 401) return "unauthorized";
  if (/output.?format/i.test(body.message)) return "format_not_allowed";
  if (status === 403) {
    return /plan|subscription|upgrade|tier|free/i.test(body.message)
      ? "plan_required"
      : "unauthorized";
  }
  if (status === 400 || status === 422) return "bad_request";
  return "failed";
}

export function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(MAX_RETRY_AFTER_MS, seconds * 1_000)
    : RETRY_BACKOFF_MS;
}
