import { redactText } from "@wasfa/shared/redact";

/*
 * What goes into `audit_logs.before/after` (SECURITY.md section 7): ids and the fields that changed,
 * never secrets or personal data. Writers pass a field allowlist per entity; this is the safety net
 * behind it, so a careless `after: row` still cannot leak a password hash or a token.
 */

const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 500;
const MAX_BYTES = 16 * 1024;

// Names that mean "secret". Matched against the key, case-insensitively, anywhere in the name.
const SECRET_KEY =
  /pass(word|wd)?|secret|token|api[-_]?key|private|credential|authorization|cookie|signature|otp|backup[-_]?code|totp|hash|salt|session/i;
// Names that mean "a person's contact data": dropped even when the value looks harmless.
const PERSONAL_KEY = /^(e?-?mail|phone(_?number)?|ip(_?address)?|user_?agent|address)$/i;

export interface SanitizeOptions {
  /** Keep only these top-level keys (the per-entity allowlist). */
  fields?: readonly string[];
}

function clean(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    const text = redactText(value);
    return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return TRUNCATED;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => clean(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (typeof inner === "function") continue;
      result[key] =
        SECRET_KEY.test(key) || PERSONAL_KEY.test(key) ? REDACTED : clean(inner, depth + 1);
    }
    return result;
  }
  return String(value);
}

/**
 * A JSON-safe, redacted, size-limited copy of `value` for the audit trail. Never throws: a value
 * that cannot be serialised becomes a marker instead of breaking the request it describes.
 */
export function sanitizeAuditValue(value: unknown, options: SanitizeOptions = {}): unknown {
  try {
    let input = value;
    if (options.fields && typeof input === "object" && input !== null && !Array.isArray(input)) {
      const allowed = new Set(options.fields);
      input = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key)));
    }
    const result = clean(input, 0);
    return JSON.stringify(result).length > MAX_BYTES ? { _truncated: true } : result;
  } catch {
    return { _unserializable: true };
  }
}
