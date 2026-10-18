import { z } from "zod";

/*
 * Withdrawals of cash points (Phase 3, Task 3.12; REFERRALS-REWARDS §8.2): the closed value sets, the
 * field schema of a payout method and the validation, normalisation and masking of a destination.
 * Pure functions, no node imports, so the web can reuse them for its form.
 */

export const MAX_PAYOUT_DESTINATIONS = 5;
/** `POST /me/withdrawals` per user per day. */
export const MAX_WITHDRAWAL_REQUESTS_PER_DAY = 3;

/** Why a request or a new destination was refused: `CONFLICT` with `details.reason` set to one of these. */
export const WITHDRAWAL_REFUSAL_REASONS = [
  "not_enough_points",
  "below_minimum",
  "phone_unverified",
  "account_too_new",
  "open_request",
  "monthly_cap",
  "cash_out_off",
  "reward_debt",
  "destination_cooldown",
  "method_disabled",
  "amount_out_of_range",
  // The same request id was reused for a different amount or destination.
  "request_id_reused",
] as const;
export type WithdrawalRefusalReason = (typeof WITHDRAWAL_REFUSAL_REASONS)[number];

/** Review flags stored on `withdrawal_requests.flags`. */
export const WITHDRAWAL_FLAGS = ["first_withdrawal"] as const;
export type WithdrawalFlag = (typeof WITHDRAWAL_FLAGS)[number];

/** i18n key suffixes (`rewards.withdrawal.reject.<key>`) an admin picks when rejecting. */
export const WITHDRAWAL_REJECT_REASONS = [
  "suspected_fraud",
  "destination_invalid",
  "account_review",
  "limit_exceeded",
  "other",
] as const;
export type WithdrawalRejectReason = (typeof WITHDRAWAL_REJECT_REASONS)[number];

// --- Payout method field schema -----------------------------------------------------------------

export const PAYOUT_FIELD_KINDS = ["egypt_mobile", "instapay_address", "iban", "text"] as const;
export type PayoutFieldKind = (typeof PAYOUT_FIELD_KINDS)[number];

/** One field of a payout destination (`payout_methods.field_schema`, admin data). */
export const payoutFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  labelKey: z.string().min(1).max(120),
  kind: z.enum(PAYOUT_FIELD_KINDS),
  required: z.boolean().default(true),
});
export type PayoutField = z.output<typeof payoutFieldSchema>;

export const payoutFieldsSchema = z.object({ fields: z.array(payoutFieldSchema).min(1).max(4) });

const LEGACY_KINDS: Readonly<Record<string, PayoutFieldKind>> = {
  egyptian_mobile: "egypt_mobile",
  instapay_address: "instapay_address",
  iban: "iban",
  text: "text",
};

/**
 * The fields of a method, or null when the stored shape is unusable (the method then cannot take a
 * destination). Rows seeded before Task 3.12 used `type` and `labelAr/labelEn`; they read as the
 * same fields so an owner who already configured a method is not locked out.
 */
export function parsePayoutFields(raw: unknown): PayoutField[] | null {
  const loose = z.object({ fields: z.array(z.record(z.string(), z.unknown())) }).safeParse(raw);
  if (!loose.success) return null;
  const parsed = payoutFieldsSchema.safeParse({
    fields: loose.data.fields.map((field) => {
      const key = typeof field.key === "string" ? field.key : "";
      const legacyType = typeof field.type === "string" ? LEGACY_KINDS[field.type] : undefined;
      return {
        key,
        labelKey: field.labelKey ?? `rewards.payout.field.${key}`,
        kind: field.kind ?? legacyType,
        required: field.required ?? true,
      };
    }),
  });
  return parsed.success ? parsed.data.fields : null;
}

// --- Destination values -------------------------------------------------------------------------

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

function latinDigits(text: string): string {
  return Array.from(text, (char) => {
    const arabic = ARABIC_INDIC.indexOf(char);
    if (arabic >= 0) return String(arabic);
    const extended = EXTENDED_ARABIC_INDIC.indexOf(char);
    return extended >= 0 ? String(extended) : char;
  }).join("");
}

/** `01012345678` from `+20 101 234 5678`, `0020…`, `٠١٠…`; null when it is not an Egyptian mobile. */
export function normalizeEgyptMobile(raw: string): string | null {
  let digits = latinDigits(raw).replace(/[\s-]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.startsWith("20") && digits.length === 12) digits = digits.slice(2);
  if (/^1[0125]\d{8}$/.test(digits)) digits = `0${digits}`;
  return /^01[0125]\d{8}$/.test(digits) ? digits : null;
}

const INSTAPAY_ADDRESS = /^[a-z0-9._-]{3,40}@[a-z]{2,20}$/;

function ibanValid(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** The normalised value of one field, or null when it is not valid for `kind`. */
export function normalizeDestinationValue(kind: PayoutFieldKind, raw: string): string | null {
  switch (kind) {
    case "egypt_mobile":
      return normalizeEgyptMobile(raw);
    case "instapay_address": {
      const mobile = normalizeEgyptMobile(raw);
      if (mobile) return mobile;
      const address = raw.trim().toLowerCase();
      return INSTAPAY_ADDRESS.test(address) ? address : null;
    }
    case "iban": {
      const iban = raw.replace(/\s/g, "").toUpperCase();
      return ibanValid(iban) ? iban : null;
    }
    case "text": {
      const text = raw.trim();
      const hasControl = Array.from(text).some((char) => char.charCodeAt(0) < 32);
      return text.length >= 3 && text.length <= 64 && !hasControl ? text : null;
    }
  }
}

export type DestinationValidation =
  { ok: true; values: Record<string, string> } | { ok: false; fields: string[] };

/** Validates `input` against the method's fields; `fields` of a failure are the offending keys. */
export function validateDestinationValues(
  fields: readonly PayoutField[],
  input: Readonly<Record<string, string>>,
): DestinationValidation {
  const values: Record<string, string> = {};
  const invalid: string[] = [];
  for (const field of fields) {
    const raw = input[field.key];
    if (raw === undefined || raw.trim() === "") {
      if (field.required) invalid.push(field.key);
      continue;
    }
    const normalized = normalizeDestinationValue(field.kind, raw);
    if (normalized === null) invalid.push(field.key);
    else values[field.key] = normalized;
  }
  return invalid.length > 0 ? { ok: false, fields: invalid } : { ok: true, values };
}

/** One text per destination (what is sealed and hashed): the method, then the sorted `key=value` lines. */
export function canonicalDestination(methodKey: string, values: Readonly<Record<string, string>>): string {
  const lines = Object.keys(values)
    .sort()
    .map((key) => `${key}=${values[key] ?? ""}`);
  return [methodKey, ...lines].join("\n");
}

/** Inverse of the values part of `canonicalDestination`. */
export function parseCanonicalDestination(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n").slice(1)) {
    const at = line.indexOf("=");
    if (at > 0) values[line.slice(0, at)] = line.slice(at + 1);
  }
  return values;
}

const DOT = "••••";

function maskValue(kind: PayoutFieldKind, value: string): string {
  if (/^01[0125]\d{8}$/.test(value)) return `${value.slice(0, 3)}${DOT}${value.slice(-4)}`;
  switch (kind) {
    case "instapay_address": {
      const at = value.indexOf("@");
      return `${value.slice(0, Math.min(2, at))}${DOT}${value.slice(at)}`;
    }
    case "iban":
      return `${value.slice(0, 4)}${DOT}${value.slice(-4)}`;
    default:
      return value.length > 6 ? `${value.slice(0, 2)}${DOT}${value.slice(-2)}` : DOT;
  }
}

/** `010••••7026`: what the user and the admin list show. Never enough to use the destination. */
export function maskDestination(
  fields: readonly PayoutField[],
  values: Readonly<Record<string, string>>,
): string {
  return fields
    .filter((field) => values[field.key] !== undefined)
    .map((field) => maskValue(field.kind, values[field.key] ?? ""))
    .join(" · ");
}

/** AAD of a sealed destination: a value copied into another row fails to open. */
export function destinationSealContext(destinationId: string): string {
  return `payout.destination:${destinationId}`;
}
