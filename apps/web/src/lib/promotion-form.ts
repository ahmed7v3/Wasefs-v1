import { toMinor } from "@wasfa/shared/money";
import {
  bulkCouponSchema,
  createCouponSchema,
  createPromotionSchema,
  type BulkCouponInput,
  type CreateCouponInput,
  type CreatePromotionInput,
} from "@wasfa/shared/schemas/billing";

import type { DiscountRuleInput } from "./admin-revenue";

/*
 * The promotion wizard's form state and its conversion to the API body. Everything the admin types
 * is text; numbers become integers here (percent as basis points through the money parser: "30"
 * is 3000 bps, "12.5" is 1250). The API re-validates and is the authority on every rule.
 */

export type PromotionKindChoice =
  "percent" | "fixed" | "bonus_credits" | "extra_months" | "trial_extension";

export interface PromotionForm {
  name: string;
  titleAr: string;
  titleEn: string;
  badgeAr: string;
  badgeEn: string;
  kind: PromotionKindChoice;
  value: string;
  currency: string;
  planIds: string[];
  months: number[];
  audience: "any" | "individual" | "organization";
  countries: string;
  newCustomersOnly: boolean;
  minAmount: string;
  startsAt: string;
  endsAt: string;
  maxRedemptions: string;
  perOwnerLimit: string;
  showOnPricing: boolean;
  showCountdown: boolean;
  stacking: "exclusive" | "stack_with_other";
  priority: string;
}

export const emptyPromotionForm = (): PromotionForm => ({
  name: "",
  titleAr: "",
  titleEn: "",
  badgeAr: "",
  badgeEn: "",
  kind: "percent",
  value: "",
  currency: "EGP",
  planIds: [],
  months: [],
  audience: "any",
  countries: "",
  newCustomersOnly: false,
  minAmount: "",
  startsAt: "",
  endsAt: "",
  maxRedemptions: "",
  perOwnerLimit: "",
  showOnPricing: false,
  showCountdown: false,
  stacking: "exclusive",
  priority: "0",
});

const optionalInt = (text: string): number | null | "invalid" => {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : "invalid";
};

/** The stored value of the typed one: percent to bps, fixed to minor units, counts as integers. */
export function parseValue(form: PromotionForm): number | null {
  const text = form.value.trim();
  if (text === "") return null;
  try {
    if (form.kind === "percent") return toMinor(text, "EGP");
    if (form.kind === "fixed") return toMinor(text, form.currency);
  } catch {
    return null;
  }
  return /^\d+$/.test(text) ? Number(text) : null;
}

const isoOrNull = (local: string): string | null | "invalid" => {
  if (local.trim() === "") return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? "invalid" : date.toISOString();
};

type Common = Omit<CreatePromotionInput, "kind" | "showOnPricing" | "showCountdown"> & {
  kind: PromotionKindChoice;
};

/** The fields promotions, coupons and bulk coupons share, parsed from the typed text. */
function commonFields(
  form: PromotionForm,
): { ok: true; common: Common } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const value = parseValue(form);
  if (value === null) errors.push("value");
  let minAmount: number | null = null;
  if (form.minAmount.trim() !== "") {
    try {
      minAmount = toMinor(form.minAmount.trim(), form.currency);
    } catch {
      errors.push("minAmount");
    }
  }
  const startsAt = isoOrNull(form.startsAt);
  const endsAt = isoOrNull(form.endsAt);
  if (startsAt === "invalid") errors.push("startsAt");
  if (endsAt === "invalid") errors.push("endsAt");
  const max = optionalInt(form.maxRedemptions);
  const perOwner = optionalInt(form.perOwnerLimit);
  if (max === "invalid") errors.push("maxRedemptions");
  if (perOwner === "invalid") errors.push("perOwnerLimit");
  const priority = Number(form.priority);
  if (!Number.isInteger(priority)) errors.push("priority");
  if (
    errors.length > 0 ||
    value === null ||
    startsAt === "invalid" ||
    endsAt === "invalid" ||
    max === "invalid" ||
    perOwner === "invalid"
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    common: {
      name: form.name.trim(),
      titleAr: form.titleAr.trim(),
      titleEn: form.titleEn.trim(),
      badgeAr: form.badgeAr.trim() === "" ? null : form.badgeAr.trim(),
      badgeEn: form.badgeEn.trim() === "" ? null : form.badgeEn.trim(),
      kind: form.kind,
      value,
      currency: form.kind === "fixed" ? form.currency : null,
      planIds: form.planIds,
      months: form.months as Common["months"],
      audience: form.audience,
      countries: form.countries
        .split(/[s,،]+/)
        .map((code) => code.trim().toUpperCase())
        .filter((code) => code !== ""),
      newCustomersOnly: form.newCustomersOnly,
      minAmountMinor: minAmount,
      startsAt,
      endsAt,
      maxRedemptions: max,
      perOwnerLimit: perOwner,
      stacking: form.stacking,
      priority,
    },
  };
}

export type PromotionBodyResult =
  { ok: true; body: CreatePromotionInput } | { ok: false; errors: string[] };

export function promotionBody(form: PromotionForm): PromotionBodyResult {
  const common = commonFields(form);
  if (!common.ok) return common;
  const parsed = createPromotionSchema.safeParse({
    ...common.common,
    showOnPricing: form.showOnPricing,
    showCountdown: form.showCountdown,
  });
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.path.join(".")) };
  }
  return { ok: true, body: parsed.data };
}

export interface CouponExtra {
  code: string;
  campaign: string;
  targetUserId: string | null;
  targetOrgId: string;
  count: string;
  prefix: string;
  length: string;
}

export const emptyCouponExtra = (): CouponExtra => ({
  code: "",
  campaign: "",
  targetUserId: null,
  targetOrgId: "",
  count: "50",
  prefix: "",
  length: "8",
});

export type CouponBodyResult =
  { ok: true; body: CreateCouponInput } | { ok: false; errors: string[] };

/** A single coupon: the shared rules plus its code and optional assignment to one user or organization. */
export function couponBody(form: PromotionForm, extra: CouponExtra): CouponBodyResult {
  const common = commonFields(form);
  if (!common.ok) return common;
  const parsed = createCouponSchema.safeParse({
    ...common.common,
    code: extra.code.trim().toUpperCase(),
    targetUserId: extra.targetUserId,
    targetOrgId: extra.targetOrgId.trim() === "" ? null : extra.targetOrgId.trim(),
    campaign: extra.campaign.trim() === "" ? null : extra.campaign.trim(),
  });
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.path.join(".")) };
  }
  return { ok: true, body: parsed.data };
}

export type BulkBodyResult = { ok: true; body: BulkCouponInput } | { ok: false; errors: string[] };

/** A batch: the shared rules plus how many, the prefix and the code length. */
export function bulkBody(form: PromotionForm, extra: CouponExtra): BulkBodyResult {
  const common = commonFields(form);
  if (!common.ok) return common;
  const prefix = extra.prefix.trim().toUpperCase();
  const parsed = bulkCouponSchema.safeParse({
    ...common.common,
    count: Number(extra.count),
    length: Number(extra.length),
    ...(prefix === "" ? {} : { prefix }),
    campaign: extra.campaign.trim() === "" ? null : extra.campaign.trim(),
  });
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.path.join(".")) };
  }
  return { ok: true, body: parsed.data };
}

/** The form as the sentence input (works with half-filled forms: unknown parts read as defaults). */
export function ruleFromForm(form: PromotionForm, planNames: readonly string[]): DiscountRuleInput {
  const value = parseValue(form) ?? 0;
  let minAmountMinor: number | null = null;
  if (form.minAmount.trim() !== "") {
    try {
      minAmountMinor = toMinor(form.minAmount.trim(), form.currency);
    } catch {
      minAmountMinor = null;
    }
  }
  const max = optionalInt(form.maxRedemptions);
  const perOwner = optionalInt(form.perOwnerLimit);
  const startsAt = isoOrNull(form.startsAt);
  const endsAt = isoOrNull(form.endsAt);
  return {
    kind: form.kind,
    value,
    currency: form.kind === "fixed" ? form.currency : null,
    planNames,
    months: form.months,
    audience: form.audience,
    countries: form.countries
      .split(/[\s,،]+/)
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code !== ""),
    newCustomersOnly: form.newCustomersOnly,
    minAmountMinor,
    maxRedemptions: max === "invalid" ? null : max,
    perOwnerLimit: perOwner === "invalid" ? null : perOwner,
    startsAt: startsAt === "invalid" ? null : startsAt,
    endsAt: endsAt === "invalid" ? null : endsAt,
    stacking: form.stacking,
  };
}

/**
 * A display estimate of the price after a percent or fixed promotion, for the wizard's side preview.
 * Bonus credits and extra months leave the price alone. The engine decides the real price.
 */
export function estimateAfterMinor(
  rule: Pick<DiscountRuleInput, "kind" | "value" | "currency">,
  listMinor: number,
  currency: string,
): number {
  if (rule.kind === "percent") {
    return Math.max(0, listMinor - Math.floor((listMinor * rule.value) / 10_000));
  }
  if (rule.kind === "fixed" && rule.currency === currency) {
    return Math.max(0, listMinor - rule.value);
  }
  return listMinor;
}
