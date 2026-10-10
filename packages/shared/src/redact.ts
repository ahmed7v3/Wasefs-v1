/** Paths pino redacts from every log line (request logs and our own objects). */
export const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.phone",
  "*.email",
  "*.apiKey",
  "*.secret",
];

const PATTERNS: [RegExp, string][] = [
  [/\b(bearer|basic)\s+[\w.~+/=-]+/gi, "$1 [REDACTED]"],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[EMAIL]"],
  // Connection strings carry passwords: postgres://user:pass@host
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[REDACTED]@"],
  // Phone-like digit runs (8+ digits, optional +, spaces or dashes).
  [/\+?\d[\d\s-]{6,}\d/g, "[PHONE]"],
];

/** Scrubs secrets and personal data from free text (error messages, stacks) before storing it. */
export function redactText(text: string): string {
  return PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}
