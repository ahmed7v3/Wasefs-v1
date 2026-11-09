import { E164_PATTERN } from "@wasfa/shared/identity";

import type { TelegramMessage } from "./telegram-types.js";

export type LinkAttempt =
  | { ok: true; phone: string }
  | { ok: false; reason: "not_private" | "not_own_contact" | "invalid_phone" };

/**
 * The phone to look up from a shared contact, or why it is refused. A contact only proves a number
 * when Telegram's own "share my number" button sent it: then `contact.user_id` is the sender. A
 * forwarded or typed contact card of someone else has another (or no) `user_id` and is refused, so
 * nobody can claim a number that is not theirs.
 */
export function phoneFromContact(message: TelegramMessage): LinkAttempt {
  const contact = message.contact;
  if (message.chat.type !== "private") return { ok: false, reason: "not_private" };
  if (!contact || message.from === undefined || contact.user_id !== message.from.id) {
    return { ok: false, reason: "not_own_contact" };
  }
  // Telegram sends digits with or without a leading plus; accounts store E.164 with it.
  const digits = contact.phone_number.replace(/[^0-9]/g, "");
  const phone = `+${digits}`;
  return E164_PATTERN.test(phone) ? { ok: true, phone } : { ok: false, reason: "invalid_phone" };
}
