import { createHmac, timingSafeEqual } from "node:crypto";

/** Telegram allows 1-256 characters of `A-Za-z0-9_-` as the webhook secret; hex fits. */
const SECRET_CHARS = 48;

/**
 * The webhook secret is derived from the app encryption key, so nothing extra is stored and every api
 * instance computes the same value: Telegram sends it back in `x-telegram-bot-api-secret-token`.
 */
export function telegramWebhookSecret(encryptionKey: Buffer): string {
  return createHmac("sha256", encryptionKey)
    .update("telegram-webhook")
    .digest("hex")
    .slice(0, SECRET_CHARS);
}

/** Constant-time comparison of the header with the expected secret; a missing header never matches. */
export function webhookSecretMatches(
  header: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof header !== "string") return false;
  const given = Buffer.from(header);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
