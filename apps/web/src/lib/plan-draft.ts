import { toMinor } from "@wasfa/shared/money";
import {
  planFeaturesSchema,
  type CatalogPlan,
  type PlanFeature,
} from "@wasfa/shared/schemas/billing";
import { updatePlanSchema } from "@wasfa/shared/schemas/plans";

import { cellKey, type MatrixDraft } from "./price-matrix";

import type { AdminPlan } from "./admin-billing-schemas";

/*
 * A plan as the editor holds it before anything is saved: the overview fields, the feature list and
 * the price matrix are client drafts. Saving the overview goes through `PATCH /admin/plans/:id`;
 * prices only change on Publish (the API diffs, prices and checks the margin).
 */

export interface PlanDraft {
  nameAr: string;
  nameEn: string;
  taglineAr: string;
  taglineEn: string;
  badgeAr: string;
  badgeEn: string;
  audience: AdminPlan["audience"];
  visibility: AdminPlan["visibility"];
  /** Sale window bounds as `datetime-local` values in the admin's own time zone; "" = no bound. */
  availableFrom: string;
  availableUntil: string;
  trialDays: string;
  monthlyCredits: string;
  pinRecommended: boolean;
  features: PlanFeature[];
}

export function draftFromPlan(plan: AdminPlan): PlanDraft {
  return {
    nameAr: plan.nameAr,
    nameEn: plan.nameEn,
    taglineAr: plan.taglineAr ?? "",
    taglineEn: plan.taglineEn ?? "",
    badgeAr: plan.badgeAr ?? "",
    badgeEn: plan.badgeEn ?? "",
    audience: plan.audience,
    visibility: plan.visibility,
    availableFrom: toLocalInput(plan.availableFrom),
    availableUntil: toLocalInput(plan.availableUntil),
    trialDays: String(plan.trialDays),
    monthlyCredits: String(plan.monthlyCredits),
    pinRecommended: plan.pinRecommended,
    features: plan.features.map((feature) => ({ ...feature })),
  };
}

const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

const pad = (value: number) => String(value).padStart(2, "0");

/** An ISO instant as a `datetime-local` value (the browser's time zone), "" for none. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value as an ISO instant, null for "". An unreadable value stays as typed so the schema rejects it. */
export function fromLocalInput(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export type PlanSaleState = "hidden" | "scheduled" | "ended" | "on_sale";

/** Where a plan stands for customers at `now`: the same rule the API applies (`planOnSale`). */
export function planSaleState(
  plan: Pick<AdminPlan, "visibility" | "availableFrom" | "availableUntil">,
  now: Date,
): PlanSaleState {
  if (plan.visibility !== "public") return "hidden";
  if (plan.availableFrom && new Date(plan.availableFrom) > now) return "scheduled";
  if (plan.availableUntil && new Date(plan.availableUntil) <= now) return "ended";
  return "on_sale";
}

export type DraftPatch = { body: Record<string, unknown> } | { errors: string[] };

/** The `PATCH` body of what changed against the stored plan, validated with the shared schema. */
export function patchFromDraft(plan: AdminPlan, draft: PlanDraft): DraftPatch {
  const candidate: Record<string, unknown> = {};
  const set = (key: string, value: unknown, stored: unknown) => {
    if (JSON.stringify(value) !== JSON.stringify(stored)) candidate[key] = value;
  };
  set("nameAr", draft.nameAr.trim(), plan.nameAr);
  set("nameEn", draft.nameEn.trim(), plan.nameEn);
  set("taglineAr", orNull(draft.taglineAr), plan.taglineAr);
  set("taglineEn", orNull(draft.taglineEn), plan.taglineEn);
  set("badgeAr", orNull(draft.badgeAr), plan.badgeAr);
  set("badgeEn", orNull(draft.badgeEn), plan.badgeEn);
  set("audience", draft.audience, plan.audience);
  set("visibility", draft.visibility, plan.visibility);
  set("availableFrom", fromLocalInput(draft.availableFrom), plan.availableFrom);
  set("availableUntil", fromLocalInput(draft.availableUntil), plan.availableUntil);
  set("trialDays", Number(draft.trialDays), plan.trialDays);
  set("monthlyCredits", Number(draft.monthlyCredits), plan.monthlyCredits);
  set("pinRecommended", draft.pinRecommended, plan.pinRecommended);
  set("features", draft.features, plan.features);
  if (Object.keys(candidate).length === 0) return { errors: ["nothing"] };
  const parsed = updatePlanSchema.safeParse(candidate);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.path.join(".")) };
  }
  const from = fromLocalInput(draft.availableFrom);
  const until = fromLocalInput(draft.availableUntil);
  if (from && until && from >= until) return { errors: ["availableUntil"] };
  return { body: candidate };
}

export function isDirty(plan: AdminPlan, draft: PlanDraft): boolean {
  const result = patchFromDraft(plan, draft);
  return "body" in result || !result.errors.includes("nothing");
}

export function featuresValid(features: readonly PlanFeature[]): boolean {
  return planFeaturesSchema.safeParse(features).success;
}

/** Stored price of a plan at a period and currency, if offered. */
export function storedPrice(plan: AdminPlan, months: number, currency: string): number | null {
  return (
    plan.prices.find((p) => p.months === months && p.currency === currency)?.amountMinor ?? null
  );
}

/**
 * The plan as the customer catalog describes it, for the live preview: the draft's texts and the
 * matrix as typed (cells that are not an amount are left out). `display` fields are the plain
 * per-month division; the real catalog adds promotions, which this preview does not simulate.
 */
export function toCatalogPlan(
  plan: AdminPlan,
  draft: PlanDraft,
  matrix: MatrixDraft,
  currency: string,
): CatalogPlan {
  const prices: CatalogPlan["prices"] = [];
  for (const months of [1, 3, 6, 12, 24]) {
    const text = (matrix[cellKey(months, currency)] ?? "").trim();
    if (text === "") continue;
    try {
      const amountMinor = toMinor(text, currency);
      if (amountMinor < 0) continue;
      prices.push({
        months,
        amountMinor,
        promotionId: null,
        display: {
          headlineMinor: amountMinor,
          struckMinor: null,
          savingsMinor: 0,
          perMonthMinor: Math.floor(amountMinor / months),
        },
      });
    } catch {
      // A half-typed cell is simply not offered in the preview yet.
    }
  }
  return storedToCatalog(plan, draft, prices);
}

function storedToCatalog(
  plan: AdminPlan,
  draft: PlanDraft,
  prices: CatalogPlan["prices"],
): CatalogPlan {
  const credits = Number(draft.monthlyCredits);
  const trial = Number(draft.trialDays);
  return {
    key: plan.key,
    audience: draft.audience,
    names: { ar: draft.nameAr, en: draft.nameEn },
    tagline:
      draft.taglineAr.trim() === "" && draft.taglineEn.trim() === ""
        ? null
        : { ar: draft.taglineAr, en: draft.taglineEn },
    features: draft.features,
    badge:
      draft.badgeAr.trim() === "" && draft.badgeEn.trim() === ""
        ? null
        : { ar: draft.badgeAr, en: draft.badgeEn },
    pinRecommended: draft.pinRecommended,
    trialDays: Number.isFinite(trial) && trial >= 0 ? trial : 0,
    monthlyCredits: Number.isFinite(credits) && credits >= 0 ? credits : 0,
    maxMembers: plan.maxMembers,
    fairUseNote: null,
    prices,
  };
}

/** A stored plan (not being edited) in the catalog shape, priced in `currency`. */
export function storedPlanToCatalog(plan: AdminPlan, currency: string): CatalogPlan {
  // Stored amounts are minor units already: build the prices directly, no text round trip.
  const prices: CatalogPlan["prices"] = plan.prices
    .filter((price) => price.currency === currency && price.amountMinor !== null)
    .map((price) => {
      const amountMinor = price.amountMinor ?? 0;
      return {
        months: price.months,
        amountMinor,
        promotionId: null,
        display: {
          headlineMinor: amountMinor,
          struckMinor: null,
          savingsMinor: 0,
          perMonthMinor: Math.floor(amountMinor / price.months),
        },
      };
    })
    .sort((left, right) => left.months - right.months);
  return storedToCatalog(plan, draftFromPlan(plan), prices);
}
