const EGYPTIAN_MOBILE = /(?<!\d)(?:(?:\+?20|0020)[ -]?)?0?1[0125](?:[ -]?\d){8}(?!\d)/g;
const INTERNATIONAL_PHONE = /(?<![\w])(?:\+|00)[1-9](?:[ -]?\d){7,14}(?!\w)/g;
const PRIVATE_R2_URL =
  /https?:\/\/[^\s]*(?:r2\.cloudflarestorage\.com|\.r2\.dev|cloudflare[^\s]*r2)[^\s]*/gi;

function maskedPhone(value: string): string {
  const compact = value.replace(/[ -]/g, "");
  const digits = compact.replace(/\D/g, "");
  const egyptian = /^(?:(?:\+?20|0020))?(?:0)?1[0125]\d{8}$/.test(compact);
  if (egyptian) {
    const local = digits.startsWith("0020")
      ? `0${digits.slice(4)}`
      : digits.startsWith("20") && digits.length === 12
        ? `0${digits.slice(2)}`
        : digits;
    return `${local.slice(0, 3)}*****${local.slice(-3)}`;
  }
  const international = compact.startsWith("+")
    ? `+${digits}`
    : compact.startsWith("00")
      ? `+${digits.slice(2)}`
      : digits;
  return `${international.slice(0, 3)}*****${digits.slice(-3)}`;
}

/** Sanitizes alert copy so sensitive values never enter an alert or notification body. */
export function redactAlertSummary(summary: string): string {
  return summary
    .replace(PRIVATE_R2_URL, "[file]")
    .replace(EGYPTIAN_MOBILE, maskedPhone)
    .replace(INTERNATIONAL_PHONE, maskedPhone);
}

/** Retained for call-site compatibility; alert text is sanitized instead of rejected. */
export function assertSafeAlertSummary(summary: string): string {
  return redactAlertSummary(summary);
}

export function isSafeAlertSummary(summary: string): boolean {
  return redactAlertSummary(summary) === summary;
}
