import { ERROR_CODES, ERROR_INFO } from "../errors/codes.js";

import type { MessageKey } from "./ar.js";

// English is planned later: stub with the keys we already have. Missing keys fall back to Arabic.
const errorMessages = Object.fromEntries(
  ERROR_CODES.map((code) => [`error.${code}`, ERROR_INFO[code].message.en]),
) as Partial<Record<MessageKey, string>>;

export const en: Partial<Record<MessageKey, string>> = {
  "brand.name": "Wasfa AI",
  "common.errorRef": "Error reference: {ref}",
  "common.contactSupport": "Contact support",
  "common.retry": "Try again",
  "common.backHome": "Back to home",
  "common.skipToContent": "Skip to main content",
  "email.greeting": "Hello {name},",
  "email.greetingAnonymous": "Hello,",
  "email.linkFallback": "If the button does not work, copy this link into your browser:",
  "email.ignoreIfNotYou": "If you did not ask for this, ignore this message; nothing changes in your account.",
  "email.footer": "Automated message from Wasfa AI. Please do not reply.",
  "email.disclaimer": "Wasfa AI is an assistive tool and does not replace a doctor or pharmacist.",
  "email.verify.subject": "Verify your email for Wasfa AI",
  "email.verify.intro": "Thanks for signing up for Wasfa AI. Press the button below to confirm your email and activate your account.",
  "email.verify.button": "Verify email",
  "email.verify.expires": "This link expires in one hour.",
  "email.reset.subject": "Reset your Wasfa AI password",
  "email.reset.intro": "We received a request to reset your account password. Press the button below to choose a new one.",
  "email.reset.button": "Choose a new password",
  "email.reset.expires": "This link expires in one hour and works once.",
  "email.invite.subject": "You are invited to join {org} on Wasfa AI",
  "email.invite.introWithInviter": "{inviter} invites you to join “{org}” on Wasfa AI.",
  "email.invite.intro": "You have been invited to join “{org}” on Wasfa AI.",
  "email.invite.button": "Accept invitation",
  "email.invite.expires": "This invitation expires in 7 days and works once.",
  "email.suspended.subject": "Your Wasfa AI account has been suspended",
  "email.suspended.intro": "Your Wasfa AI account has been suspended and you cannot sign in until it is reviewed.",
  "email.suspended.contact": "If you think this is a mistake, contact support and we will review your account.",
  ...errorMessages,
};
