import { createHmac, timingSafeEqual } from "node:crypto";

import { TELEGRAM_AD_TRIGGERS, type TelegramAdTrigger } from "@wasfa/shared/telegram-ads";

/*
 * The tracked link of a Telegram ad button: base64url(creativeId.chatId.trigger.button.expiryUnix.hmac).
 * It holds no name, phone or message; the chat id is what lets the click be attributed to the chat
 * that saw the ad. The HMAC key is derived with its own purpose label, so a token cannot be replayed
 * as the web/WhatsApp ad token (`ads-token.ts`) or any other token made from the same secret.
 */

/** A link in a chat is tapped days later. */
export const TELEGRAM_AD_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_TOKEN_LENGTH = 400;
const PURPOSE = "telegram_ad";

export interface TelegramAdTokenClaims {
  creativeId: string;
  chatId: number;
  trigger: TelegramAdTrigger;
  /** Index of the button in the creative. */
  button: number;
}

function key(secret: string): Buffer {
  return createHmac("sha256", secret).update(PURPOSE).digest();
}

function mac(secret: string, payload: string): string {
  return createHmac("sha256", key(secret)).update(payload).digest("base64url");
}

export function signTelegramAdToken(
  secret: string,
  claims: TelegramAdTokenClaims,
  now: Date,
  ttlSeconds: number = TELEGRAM_AD_TOKEN_TTL_SECONDS,
): string {
  const expiry = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload = [claims.creativeId, claims.chatId, claims.trigger, claims.button, expiry].join(".");
  return Buffer.from(`${payload}.${mac(secret, payload)}`).toString("base64url");
}

/** The claims of a genuine, unexpired token, or `null` (never throws on hostile input). */
export function verifyTelegramAdToken(
  secret: string,
  token: string | undefined,
  now: Date,
): TelegramAdTokenClaims | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = Buffer.from(token, "base64url").toString("utf8").split(".");
  if (parts.length !== 6) return null;
  const [creativeId, chatId, trigger, button, expiry, signature] = parts;
  if (!creativeId || !chatId || !trigger || !button || !expiry || !signature) return null;
  if (!/^-?\d{1,18}$/.test(chatId) || !/^\d{1,2}$/.test(button) || !/^\d{1,12}$/.test(expiry)) {
    return null;
  }
  if (!(TELEGRAM_AD_TRIGGERS as readonly string[]).includes(trigger)) return null;
  const payload = [creativeId, chatId, trigger, button, expiry].join(".");
  const expected = Buffer.from(mac(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expiry) * 1000 <= now.getTime()) return null;
  return {
    creativeId,
    chatId: Number(chatId),
    trigger: trigger as TelegramAdTrigger,
    button: Number(button),
  };
}
