import type { WaLoginRefusalReason } from "@wasfa/shared/schemas/wa-login";

/** What decides whether an account may sign in through WhatsApp alone. */
export interface WhatsAppLoginSubject {
  status: string;
  twoFactorEnabled: boolean;
  anonymizedAt: Date | null;
  /** Holds at least one platform role (support, marketing, finance, admin, ...). */
  hasPlatformRole: boolean;
}

/**
 * Accounts that keep their factors (docs/WA-SIGNUP.md section 1.4): two-factor on, any platform role,
 * or not active (suspended, deleted, anonymized). They get `login_use_password` instead of a session.
 * Reused by the agent's `login_link` tool, which follows the same rules.
 */
export function whatsappLoginRefusal(user: WhatsAppLoginSubject): WaLoginRefusalReason | null {
  if (user.status !== "active" || user.anonymizedAt !== null) return "inactive";
  if (user.twoFactorEnabled) return "two_factor";
  if (user.hasPlatformRole) return "privileged";
  return null;
}
