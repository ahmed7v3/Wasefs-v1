import { randomBytes } from "node:crypto";

import { t } from "@wasfa/shared/i18n";
import { PHONE_PLACEHOLDER_EMAIL_DOMAIN } from "@wasfa/shared/identity";
import { cleanPushName } from "@wasfa/shared/schemas/wa-login";

import type { WhatsAppAccount, WhatsAppLoginRepo } from "./whatsapp-login.repo.js";

/** New accounts are paused (`access.signupOpen` off, or maintenance): nothing is created. */
export class WhatsAppSignupClosedError extends Error {
  constructor() {
    super("Sign-up is closed");
    this.name = "WhatsAppSignupClosedError";
  }
}

export interface CreateWhatsAppUserDeps {
  repo: Pick<WhatsAppLoginRepo, "findByVerifiedPhone" | "insertUser" | "ensureReferralCode">;
  /** `access.signupOpen && !access.maintenanceMode`, read fresh from settings. */
  signupOpen: () => Promise<boolean>;
  /** Called when the invite code could not be prepared; never fails the sign-up. */
  onSetupFailed?: (userId: string) => void;
}

export interface CreateWhatsAppUserInput {
  /** E.164, resolved by the bridge from the sender (never from message text). */
  phone: string;
  /** The WhatsApp profile name, if any; falls back to the default display name. */
  name?: string | undefined;
}

export interface CreatedWhatsAppUser {
  userId: string;
  /** False when the number already belonged to a verified account (including losing a race to one). */
  isNew: boolean;
  /** Present when `isNew` is false: what decides whether the account may sign in through WhatsApp. */
  existing?: WhatsAppAccount;
}

/**
 * The one way an account is born from a WhatsApp chat (web sign-in now, the agent's `create_account`
 * tool later): email is a placeholder (`w<hex>@phone.wasfa.invalid`), no password, the phone is
 * verified because WhatsApp itself proved it. An existing verified owner of the number is returned
 * as-is; so is the winner of a concurrent creation (unique-phone race).
 *
 * The free plan needs no activation step (a missing subscription is the free plan, and the onboarding
 * `plan_picker` only records an intent). The terms are stated on the page before the button; the
 * schema has no terms column, so acceptance is not stored (the register form is the same).
 */
export async function createWhatsAppUser(
  deps: CreateWhatsAppUserDeps,
  input: CreateWhatsAppUserInput,
): Promise<CreatedWhatsAppUser> {
  const existing = await deps.repo.findByVerifiedPhone(input.phone);
  if (existing) return { userId: existing.id, isNew: false, existing };

  if (!(await deps.signupOpen())) throw new WhatsAppSignupClosedError();

  const created = await deps.repo.insertUser({
    name: cleanPushName(input.name) ?? t("auth.whatsapp.defaultName"),
    email: `w${randomBytes(12).toString("hex")}@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`,
    phone: input.phone,
  });
  if (created === "taken") {
    const winner = await deps.repo.findByVerifiedPhone(input.phone);
    if (!winner) throw new Error("Phone is taken but its owner could not be found");
    return { userId: winner.id, isNew: false, existing: winner };
  }

  try {
    await deps.repo.ensureReferralCode(created.id);
  } catch {
    deps.onSetupFailed?.(created.id);
  }
  return { userId: created.id, isNew: true };
}
