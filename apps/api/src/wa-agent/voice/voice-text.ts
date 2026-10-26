/*
 * What may be spoken, and how it is read out. Pure functions. Anything a customer must read or copy
 * exactly (a link, a coupon code, a bank number) stays a text message.
 */

const URL_PATTERN = /https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|online|io|app|co|me|eg)\b/i;
/** Coupon codes the agent issues: `WA` + 6 characters (docs/WA-AGENT.md section 6). */
const COUPON_PATTERN = /\bWA[A-Z0-9]{6}\b/;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/;
/** Eight digits or more, even when spaced or dashed (card, account and phone numbers). */
const LONG_DIGITS_PATTERN = /(?:\p{Nd}[ \t-]?){8,}/u;

export type TextOnlyReason = "url" | "coupon" | "iban" | "digits";

/** Why this text must not be sent as a voice note, or null when it may. */
export function textOnlyReason(text: string): TextOnlyReason | null {
  if (URL_PATTERN.test(text)) return "url";
  if (COUPON_PATTERN.test(text)) return "coupon";
  if (IBAN_PATTERN.test(text.replaceAll(/\s+/g, ""))) return "iban";
  if (LONG_DIGITS_PATTERN.test(text)) return "digits";
  return null;
}

/** The reply as it should be read aloud: no WhatsApp markup, bullets or emojis. */
export function speechText(text: string): string {
  return text
    .replaceAll(/[*_~`]+/g, "")
    .replaceAll(/^\s*[-•]\s+/gm, "")
    .replaceAll(/[\p{Extended_Pictographic}\p{Emoji_Modifier}]|‍|️|⃣/gu, "")
    .replaceAll(/\s*\n+\s*/g, ". ")
    .replaceAll(/\s{2,}/g, " ")
    .replaceAll(/([.!?؟،])\s*\.\s/g, "$1 ")
    .trim();
}
