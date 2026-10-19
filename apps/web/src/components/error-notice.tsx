import { isErrorCode } from "@wasfa/shared/errors";
import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Button, buttonStyles, cn } from "@wasfa/ui";
import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { ApiRequestError, errorReason, extractErrorRef } from "../lib/api-error";

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
  // AI limits (Task 2.2).
  ai_paused: "ai.reason.ai_paused",
  plan_feature: "ai.reason.plan_feature",
  daily_cap: "ai.reason.daily_cap",
  busy: "ai.reason.busy",
  insufficient_credits: "ai.reason.insufficient_credits",
  storage_not_configured: "ai.reason.storage_not_configured",
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
  whatsapp_already_linked: "admin.reason.whatsapp_already_linked",
  bridge_down: "admin.reason.bridge_down",
  queue_unavailable: "admin.reason.queue_unavailable",
  two_factor_required: "admin.access.twoFactorRequired.body",
  two_factor_session: "admin.access.twoFactorSession.body",
  // AI routes, plans and credits (Task 2.5).
  stale_version: "admin.routes.reason.stale_version",
  default_route: "admin.routes.reason.default_route",
  plan_key_exists: "admin.plans.reason.plan_key_exists",
  plan_in_use: "admin.plans.reason.plan_in_use",
  default_plan_required: "admin.plans.reason.default_plan_required",
  invalid_window: "admin.reason.invalid_window",
  assignment_ended: "admin.plans.reason.assignment_ended",
  insufficient_balance: "admin.credits.reason.insufficient_balance",
  // Logo and favicon uploads.
  unsupported_type: "admin.branding.reason.unsupported_type",
  type_mismatch: "admin.branding.reason.type_mismatch",
  too_large: "admin.branding.reason.too_large",
  invalid_data: "admin.branding.reason.invalid_data",
  invalid_svg: "admin.branding.reason.invalid_svg",
  unsafe_svg: "admin.branding.reason.unsafe_svg",
  // AI providers, models and price sync (Phase 2).
  missing_key: "admin.ai.reason.missing_key",
  key_taken: "admin.ai.reason.key_taken",
  provider_in_use: "admin.ai.reason.provider_in_use",
  fake_in_production: "admin.ai.reason.fake_in_production",
  insecure_base_url: "admin.ai.reason.insecure_base_url",
  missing_base_url: "admin.ai.reason.missing_base_url",
  model_exists: "admin.ai.reason.model_exists",
  model_in_use: "admin.ai.reason.model_in_use",
  model_is_primary: "admin.ai.reason.model_is_primary",
  no_price_source: "admin.ai.reason.no_price_source",
  sync_expired: "admin.ai.reason.sync_expired",
  killswitch_permission: "admin.ai.reason.killswitch_permission",
  // Drug database and import (Task 2.7).
  alias_exists: "admin.drugs.reason.alias_exists",
  name_empty: "admin.drugs.reason.name_empty",
  dry_run_required: "admin.drugs.reason.dry_run_required",
  file_expired: "admin.drugs.reason.file_expired",
  not_committed: "admin.drugs.reason.not_committed",
  already_committed: "admin.drugs.reason.already_committed",
  already_rolled_back: "admin.drugs.reason.already_rolled_back",
  file_required: "admin.drugs.reason.file_required",
  file_too_large: "admin.drugs.reason.file_too_large",
  unsupported_file: "admin.drugs.reason.unsupported_file",
  bad_upload: "admin.drugs.reason.bad_upload",
  not_multipart: "admin.drugs.reason.not_multipart",
  one_file_only: "admin.drugs.reason.one_file_only",
  // The /ai assistant (Task 2.11).
  content_blocked: "ai.reason.content_blocked",
  provider_error: "ai.reason.provider_error",
  no_model: "ai.reason.no_model",
  no_route: "ai.reason.no_route",
  file_not_ready: "ai.reason.file_not_ready",
  not_last_message: "ai.reason.not_last_message",
  // Organizations, join links and rewards (Phase 3).
  seat_limit: "org.reason.seat_limit",
  slug_taken: "org.reason.slug_taken",
  verification_required: "join.pending.both",
  member_cap_reached: "org.reason.member_cap_reached",
  org_credits_exhausted: "org.reason.org_credits_exhausted",
  vanity_used: "rewardsPage.reason.vanity_used",
  code_taken: "rewardsPage.reason.code_taken",
  reserved_code: "rewardsPage.reason.reserved_code",
  insufficient_points: "rewardsPage.reason.insufficient_points",
  below_minimum: "rewardsPage.reason.below_minimum",
  open_reward_debt: "rewardsPage.reason.open_reward_debt",
  idempotency_key_reused: "rewardsPage.reason.idempotency_key_reused",
};

const PRICING_PATH = /^\/pricing(\?[A-Za-z0-9=&_-]*)?$/;

/** An in-app path the API suggests for getting past a limit (`details.upgradePath`), if it is a pricing link. */
export function upgradePath(error: unknown): string | undefined {
  if (!(error instanceof ApiRequestError)) return undefined;
  const path = error.details?.["upgradePath"];
  return typeof path === "string" && PRICING_PATH.test(path) ? path : undefined;
}

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
  const upgrade = upgradePath(error);
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
      {upgrade ? (
        <Link href={upgrade} className={buttonStyles({ className: "self-start" })}>
          {t("org.reason.upgrade")}
        </Link>
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
