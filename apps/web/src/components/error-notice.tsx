import { isErrorCode } from "@wasfa/shared/errors";
import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Button, buttonStyles, cn } from "@wasfa/ui";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { errorReason, extractErrorRef } from "../lib/api-error";

/** Machine reasons from the API (`details.reason`) that deserve a sentence of their own. */
const REASON_MESSAGES: Record<string, MessageKey> = {
  turnstile_required: "auth.turnstileRequired",
  turnstile_failed: "auth.turnstileFailed",
  invalid_credentials: "auth.error.invalidCredentials",
  email_not_verified: "auth.error.emailNotVerified",
  account_suspended: "auth.error.accountSuspended",
  signup_closed: "auth.error.signupClosed",
  two_factor_use_password: "auth.error.twoFactorUsePassword",
  invalid_code: "auth.error.invalidCode",
  invalid_token: "auth.error.invalidToken",
  provider_unavailable: "auth.error.providerUnavailable",
  social_failed: "auth.error.socialFailed",
  password_compromised: "form.passwordCompromised",
  email_domain_blocked: "form.emailDomainBlocked",
  phone_verification_disabled: "phone.unavailable.disabled",
  phone_verification_not_configured: "phone.unavailable.notConfigured",
  phone_verification_bridge_down: "phone.unavailable.bridgeDown",
  // Admin panel (Task 1.10).
  self_action: "admin.reason.self_action",
  super_admin_only: "admin.reason.super_admin_only",
  not_enough_permissions: "admin.reason.not_enough_permissions",
  last_super_admin: "admin.reason.last_super_admin",
  role_in_use: "admin.reason.role_in_use",
  role_read_only: "admin.reason.role_read_only",
  system_role: "admin.reason.system_role",
  invalid_status: "admin.reason.invalid_status",
  role_exists: "admin.reason.role_exists",
  two_factor_required: "admin.access.twoFactorRequired.body",
  two_factor_session: "admin.access.twoFactorSession.body",
};

/** The friendly sentence for an error: a specific reason first, else the message of its code. */
export function errorMessage(error: unknown): string {
  const reason = errorReason(error);
  const reasonKey = reason ? REASON_MESSAGES[reason] : undefined;
  if (reasonKey) return t(reasonKey);
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return t(isErrorCode(code) ? `error.${code}` : "error.INTERNAL");
}

export interface ErrorNoticeProps {
  error: unknown;
  onRetry?: (() => void) | undefined;
  /** Where "contact support" leads: the contact page by default. `null` hides the link (the contact form itself). */
  supportHref?: string | null | undefined;
  className?: string | undefined;
}

/**
 * Recoverable error state (DESIGN-SYSTEM §7): friendly message, the `WSF-` reference when the API
 * supplied one, a retry button and a support link. Never shows provider, SQL or stack details.
 */
export function ErrorNotice({
  error,
  onRetry,
  supportHref = "/contact",
  className,
}: ErrorNoticeProps) {
  const ref = extractErrorRef(error);
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-md border border-danger/30 bg-danger-soft p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
        <p className="text-base text-text">{errorMessage(error)}</p>
      </div>
      {ref ? (
        <p className="w-fit rounded-md bg-surface px-3 py-1 text-sm font-semibold text-danger">
          {t("common.errorRef", { ref })}
        </p>
      ) : null}
      {onRetry || supportHref ? (
        <div className="flex flex-wrap items-center gap-3">
          {onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              <RotateCcw aria-hidden className="size-4 rtl:-scale-x-100" />
              {t("common.retry")}
            </Button>
          ) : null}
          {supportHref ? (
            <a href={supportHref} className={buttonStyles({ variant: "ghost" })}>
              {t("common.contactSupport")}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
