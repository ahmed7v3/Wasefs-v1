import { AppError, ErrorCode, type SafeDetails } from "@wasfa/shared/errors";

/**
 * Codes we raise ourselves from hooks and plugin endpoints. They travel through Better Auth as the
 * `code` of an `APIError` and are translated here, so Better Auth's own messages never reach a client.
 */
export const AuthCode = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  SIGNUP_CLOSED: "SIGNUP_CLOSED",
  EMAIL_DOMAIN_BLOCKED: "EMAIL_DOMAIN_BLOCKED",
  TWO_FACTOR_USE_PASSWORD: "TWO_FACTOR_USE_PASSWORD",
} as const;

export interface MapContext {
  /** Which request field holds the password, so a password error points at the right input. */
  passwordField: string;
}

const reason = (value: string, extra: SafeDetails = {}): SafeDetails => ({
  reason: value,
  ...extra,
});

/**
 * Translates a Better Auth error response into our `AppError`. Returns `undefined` for server
 * errors (5xx), which the caller reports through `ErrorReporter` and answers with a `WSF-` ref.
 * Only the error *code* is read: the message is never forwarded.
 */
export function mapAuthError(
  status: number,
  body: unknown,
  context: MapContext,
): AppError | undefined {
  if (status >= 500) return undefined;
  const raw = (body as { code?: unknown } | null)?.code;
  const code = typeof raw === "string" ? raw.toUpperCase() : "";

  if (
    /^(INVALID_EMAIL_OR_PASSWORD|INVALID_PASSWORD|INVALID_CREDENTIALS|INVALID_PHONE_NUMBER_OR_PASSWORD)$/.test(
      code,
    )
  ) {
    return new AppError(ErrorCode.AUTH_REQUIRED, { details: reason("invalid_credentials") });
  }
  if (code === "EMAIL_NOT_VERIFIED") {
    return new AppError(ErrorCode.AUTH_REQUIRED, { details: reason("email_not_verified") });
  }
  if (code === "PASSWORD_COMPROMISED") {
    return new AppError(ErrorCode.VALIDATION_FAILED, {
      details: reason("password_compromised", { fields: [context.passwordField] }),
    });
  }
  if (/^PASSWORD_TOO_(SHORT|LONG)$/.test(code)) {
    return new AppError(ErrorCode.VALIDATION_FAILED, {
      details: reason("password_length", { fields: [context.passwordField] }),
    });
  }
  if (
    code === "INVALID_EMAIL" ||
    code === AuthCode.EMAIL_DOMAIN_BLOCKED ||
    code.startsWith("USER_ALREADY_EXISTS")
  ) {
    return new AppError(ErrorCode.VALIDATION_FAILED, {
      details: reason(
        code === AuthCode.EMAIL_DOMAIN_BLOCKED ? "email_domain_blocked" : "email_invalid",
        {
          fields: ["email"],
        },
      ),
    });
  }
  if (/TOKEN/.test(code) && !code.includes("TWO_FACTOR")) {
    return new AppError(ErrorCode.VALIDATION_FAILED, { details: reason("invalid_token") });
  }
  if (code === AuthCode.ACCOUNT_SUSPENDED) {
    return new AppError(ErrorCode.FORBIDDEN, { details: reason("account_suspended") });
  }
  if (code === AuthCode.SIGNUP_CLOSED) {
    return new AppError(ErrorCode.FORBIDDEN, { details: reason("signup_closed") });
  }
  if (code === AuthCode.TWO_FACTOR_USE_PASSWORD) {
    return new AppError(ErrorCode.FORBIDDEN, { details: reason("two_factor_use_password") });
  }
  if (/^TOO_MANY_ATTEMPTS/.test(code)) {
    return new AppError(ErrorCode.RATE_LIMITED);
  }
  if (/^(INVALID_CODE|INVALID_BACKUP_CODE|INVALID_TWO_FACTOR_COOKIE|INVALID_OTP)$/.test(code)) {
    return new AppError(ErrorCode.AUTH_REQUIRED, { details: reason("invalid_code") });
  }

  // Anything we did not name: decide by status alone.
  if (status === 401) return new AppError(ErrorCode.AUTH_REQUIRED);
  if (status === 403) return new AppError(ErrorCode.FORBIDDEN);
  if (status === 404) return new AppError(ErrorCode.NOT_FOUND);
  if (status === 429) return new AppError(ErrorCode.RATE_LIMITED);
  return new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: [] } });
}
