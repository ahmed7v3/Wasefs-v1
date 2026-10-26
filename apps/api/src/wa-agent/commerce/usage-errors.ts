import { ErrorCode, isAppError } from "@wasfa/shared/errors";

/**
 * A refusal of a paid service (rx, chat) as a reason code the model can relay. The services answer
 * with `AppError`s meant for the web app; here each becomes one short code. Anything that is not a
 * known refusal returns null so the caller rethrows it (the registry turns it into `tool_failed`).
 */
export function usageReason(error: unknown): string | null {
  if (!isAppError(error)) return null;
  const reason = error.details?.["reason"];
  switch (error.code) {
    case ErrorCode.QUOTA_EXCEEDED:
      return reason === "daily_cap" || reason === "monthly_cap"
        ? "quota_reached"
        : "insufficient_credits";
    case ErrorCode.CONFLICT:
      return reason === "busy" ? "busy" : null;
    case ErrorCode.RATE_LIMITED:
      return "busy";
    case ErrorCode.PAYMENT_REQUIRED:
      return "plan_feature";
    case ErrorCode.UPSTREAM_UNAVAILABLE:
      return "unavailable";
    case ErrorCode.VALIDATION_FAILED:
      return reason === "too_many_pages" ? "too_many_pages" : null;
    default:
      return null;
  }
}
