import { fromMinor, toMinor } from "@wasfa/shared/money";
import { adminPaymentMethodPatchSchema } from "@wasfa/shared/schemas/admin-billing-console";

import type { MethodView } from "./admin-billing-schemas";

/*
 * The payment method editor's form and its `PATCH` body. Percentages are typed as "2.75" and stored
 * as basis points through the money parser (two decimals, no floats); amounts are typed in the
 * method's first currency. The API validates again and refuses a gateway method that is not verified.
 */

export const PLACEHOLDERS = ["{amount}", "{reference}", "{account}"] as const;

export interface MethodForm {
  nameAr: string;
  nameEn: string;
  instructionsAr: string;
  instructionsEn: string;
  feePercent: string;
  feeFixed: string;
  minAmount: string;
  maxAmount: string;
  currencies: string;
  countries: string;
  requiresProof: boolean;
  reviewSlaMinutes: string;
  enabled: boolean;
  sort: string;
}

const money = (minor: number | null, currency: string) =>
  minor === null ? "" : fromMinor(minor, currency);

export function formFromMethod(method: MethodView): MethodForm {
  const currency = method.currencies[0] ?? "EGP";
  return {
    nameAr: method.nameAr,
    nameEn: method.nameEn,
    instructionsAr: method.instructionsAr ?? "",
    instructionsEn: method.instructionsEn ?? "",
    feePercent: fromMinor(method.feeBps, "EGP"),
    feeFixed: money(method.feeFixedMinor, currency),
    minAmount: money(method.minAmountMinor, currency),
    maxAmount: money(method.maxAmountMinor, currency),
    currencies: method.currencies.join(", "),
    countries: (method.countries ?? []).join(", "),
    requiresProof: method.requiresProof,
    reviewSlaMinutes: method.reviewSlaMinutes === null ? "" : String(method.reviewSlaMinutes),
    enabled: method.enabled,
    sort: String(method.sort),
  };
}

const list = (text: string) =>
  text
    .split(/[\s,،]+/)
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry !== "");

export type MethodPatchResult =
  { ok: true; body: Record<string, unknown>; changed: string[] } | { ok: false; errors: string[] };

/** The changed fields as a `PATCH` body (without the reason), or the names of the invalid ones. */
export function methodPatch(method: MethodView, form: MethodForm): MethodPatchResult {
  const currencies = list(form.currencies);
  const currency = currencies[0] ?? method.currencies[0] ?? "EGP";
  const errors: string[] = [];
  const amount = (text: string, name: string): number | null | undefined => {
    if (text.trim() === "") return null;
    try {
      return toMinor(text.trim(), currency);
    } catch {
      errors.push(name);
      return undefined;
    }
  };
  let feeBps: number | undefined;
  try {
    feeBps = toMinor(form.feePercent.trim() === "" ? "0" : form.feePercent.trim(), "EGP");
  } catch {
    errors.push("feeBps");
  }
  const feeFixed = amount(form.feeFixed, "feeFixedMinor");
  const min = amount(form.minAmount, "minAmountMinor");
  const max = amount(form.maxAmount, "maxAmountMinor");
  const sla = form.reviewSlaMinutes.trim() === "" ? null : Number(form.reviewSlaMinutes);
  const sort = Number(form.sort);
  if (sla !== null && !Number.isInteger(sla)) errors.push("reviewSlaMinutes");
  if (!Number.isInteger(sort)) errors.push("sort");
  if (errors.length > 0) return { ok: false, errors };

  const countries = list(form.countries);
  const candidate: Record<string, unknown> = {
    nameAr: form.nameAr.trim(),
    nameEn: form.nameEn.trim(),
    instructionsAr: form.instructionsAr.trim() === "" ? null : form.instructionsAr,
    instructionsEn: form.instructionsEn.trim() === "" ? null : form.instructionsEn,
    feeBps,
    feeFixedMinor: feeFixed ?? 0,
    minAmountMinor: min ?? null,
    maxAmountMinor: max ?? null,
    currencies,
    countries: countries.length === 0 ? null : countries,
    requiresProof: form.requiresProof,
    reviewSlaMinutes: sla,
    enabled: form.enabled,
    sort,
  };
  const stored: Record<string, unknown> = {
    nameAr: method.nameAr,
    nameEn: method.nameEn,
    instructionsAr: method.instructionsAr,
    instructionsEn: method.instructionsEn,
    feeBps: method.feeBps,
    feeFixedMinor: method.feeFixedMinor,
    minAmountMinor: method.minAmountMinor,
    maxAmountMinor: method.maxAmountMinor,
    currencies: method.currencies,
    countries: method.countries,
    requiresProof: method.requiresProof,
    reviewSlaMinutes: method.reviewSlaMinutes,
    enabled: method.enabled,
    sort: method.sort,
  };
  const body: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const [key, value] of Object.entries(candidate)) {
    if (JSON.stringify(value) !== JSON.stringify(stored[key])) {
      body[key] = value;
      changed.push(key);
    }
  }
  const parsed = adminPaymentMethodPatchSchema.safeParse({ ...body, reason: "validation" });
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.path.join(".")) };
  }
  return { ok: true, body, changed };
}

/** The instructions as the customer reads them, with sample values in place of the chips. */
export function previewInstructions(
  text: string,
  values: { amount: string; reference: string; account: string },
): string {
  return text
    .replaceAll("{amount}", values.amount)
    .replaceAll("{reference}", values.reference)
    .replaceAll("{account}", values.account);
}

/** True when the text uses a `{...}` token the API does not know (it refuses those). */
export function hasUnknownPlaceholder(text: string): boolean {
  return /\{(?!amount\}|reference\}|account\})/.test(text);
}
