import { Inject, Injectable } from "@nestjs/common";
import {
  couponRedemptions,
  coupons,
  creditPackPrices,
  creditPacks,
  orders,
  paymentMethods,
  personalOffers,
  planPrices,
  plans,
  promotions,
  subscriptions,
  taxRules,
  type Coupon,
  type Plan,
  type PlanPrice,
  type Promotion,
  type TaxRule,
} from "@wasfa/db";
import {
  and,
  arrayContains,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
} from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type { PaymentMethodKind } from "@wasfa/shared/billing";
import type { PlanAudience } from "@wasfa/shared/plans";
import type { DiscountDef, DiscountScope, DiscountSource } from "@wasfa/shared/price-engine";

/**
 * The part of a payment method the public may see. `account_display`, instructions and holder are
 * never selected here: the catalog and quote paths cannot leak them because they never read them.
 */
export interface MethodSummary {
  key: string;
  kind: PaymentMethodKind;
  nameAr: string;
  nameEn: string;
  feeBps: number;
  feeFixedMinor: number;
  minAmountMinor: number | null;
  maxAmountMinor: number | null;
  currencies: string[];
}

export interface PromotionEntry {
  promotion: Promotion;
  def: DiscountDef;
}

export interface CreditPackEntry {
  key: string;
  nameAr: string;
  nameEn: string;
  credits: number;
  bonusCredits: number;
  validMonths: number;
  amountMinor: number;
}

export interface LiveSubscriptionBasis {
  planMonthlyCredits: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

export interface LastPaidOrder {
  currency: string;
  subtotalMinor: number;
}

/**
 * Converts a promotion or coupon row to what the engine understands. One mapper, so the catalog
 * and the quote can never read a discount differently. `trial_extension` has no price effect: `null`.
 */
export function toDiscountDef(
  row: Promotion | Coupon,
  source: DiscountSource,
  planKeysById: ReadonlyMap<string, string>,
): DiscountDef | null {
  const scope: DiscountScope = {};
  if (row.planIds.length > 0) {
    // A deleted plan drops out; a scope left empty then matches nothing, which is the safe side.
    scope.planKeys = row.planIds.flatMap((id) => {
      const key = planKeysById.get(id);
      return key === undefined ? [] : [key];
    });
  }
  if (row.months.length > 0) scope.months = row.months;
  if (row.countries.length > 0) scope.countries = row.countries;
  if (row.newCustomersOnly) scope.newCustomersOnly = true;
  if (row.minAmountMinor !== null) scope.minAmountMinor = row.minAmountMinor;

  const base = {
    id: row.id,
    source,
    scope,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    stacking: row.stacking,
    priority: row.priority,
  } as const;
  switch (row.kind) {
    case "percent":
      return { ...base, kind: "percent", valueBps: row.value };
    case "fixed":
      return row.currency === null
        ? null
        : { ...base, kind: "fixed", amountsMinor: { [row.currency]: row.value } };
    case "bonus_credits":
      return { ...base, kind: "bonus_credits", credits: row.value };
    case "extra_months":
      return { ...base, kind: "extra_months", months: row.value };
    case "trial_extension":
      return null;
  }
}

/** Whether a discount meant for `audience` may be used when buying a plan for `purchase`. */
export function audienceFits(audience: PlanAudience, purchase: "individual" | "organization") {
  return audience === "any" || audience === purchase;
}

/**
 * Everything the quote and the catalog read to feed the price engine. Catalog data is platform-wide;
 * the history reads are scoped to one user by construction (the user id is a required argument).
 */
@Injectable()
export class QuoteInputsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async planKeyMap(): Promise<Map<string, string>> {
    const rows = await this.handle.db.select({ id: plans.id, key: plans.key }).from(plans);
    return new Map(rows.map((row) => [row.id, row.key]));
  }

  /** A public plan by key (hidden and archived plans are not for sale). */
  async publicPlan(key: string): Promise<Plan | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(plans)
      .where(and(eq(plans.key, key), eq(plans.visibility, "public")));
    return row;
  }

  /** Admin previews may price hidden plans, while all other quote checks stay unchanged. */
  async planForSimulation(key: string): Promise<Plan | undefined> {
    const [row] = await this.handle.db.select().from(plans).where(eq(plans.key, key));
    return row;
  }

  async activePrice(
    planId: string,
    months: number,
    currency: string,
  ): Promise<PlanPrice | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(planPrices)
      .where(
        and(
          eq(planPrices.planId, planId),
          eq(planPrices.months, months),
          eq(planPrices.currency, currency),
          eq(planPrices.active, true),
        ),
      );
    return row;
  }

  /** Promotions in force at `now`: active (or scheduled and started), not used up. Dates are re-checked by the engine. */
  async activePromotions(now: Date): Promise<PromotionEntry[]> {
    const rows = await this.handle.db
      .select()
      .from(promotions)
      .where(
        and(
          or(
            eq(promotions.status, "active"),
            and(
              eq(promotions.status, "scheduled"),
              isNotNull(promotions.startsAt),
              lte(promotions.startsAt, now),
            ),
          ),
          or(isNull(promotions.startsAt), lte(promotions.startsAt, now)),
          or(isNull(promotions.endsAt), gt(promotions.endsAt, now)),
          or(
            isNull(promotions.maxRedemptions),
            lt(promotions.redeemedCount, promotions.maxRedemptions),
          ),
        ),
      );
    if (rows.length === 0) return [];
    const keys = await this.planKeyMap();
    return rows.flatMap((promotion) => {
      const def = toDiscountDef(promotion, "promotion", keys);
      return def ? [{ promotion, def }] : [];
    });
  }

  /** The tax rule for a country: its own, else the default (`country` null). Only rules that apply to subscriptions. */
  async taxRuleFor(country: string | null): Promise<TaxRule | undefined> {
    const rows = await this.handle.db
      .select()
      .from(taxRules)
      .where(
        and(
          eq(taxRules.active, true),
          inArray(taxRules.appliesTo, ["all", "subscription"]),
          country === null
            ? isNull(taxRules.country)
            : or(isNull(taxRules.country), eq(taxRules.country, country)),
        ),
      )
      .orderBy(desc(taxRules.createdAt), desc(taxRules.id));
    return rows.find((rule) => rule.country !== null) ?? rows[0];
  }

  /** Enabled methods that accept `currency` and are offered in `country` (no country = only the everywhere ones). */
  async enabledMethods(currency: string, country: string | null): Promise<MethodSummary[]> {
    const rows = await this.handle.db
      .select({
        key: paymentMethods.key,
        kind: paymentMethods.kind,
        nameAr: paymentMethods.nameAr,
        nameEn: paymentMethods.nameEn,
        feeBps: paymentMethods.feeBps,
        feeFixedMinor: paymentMethods.feeFixedMinor,
        minAmountMinor: paymentMethods.minAmountMinor,
        maxAmountMinor: paymentMethods.maxAmountMinor,
        currencies: paymentMethods.currencies,
        countries: paymentMethods.countries,
      })
      .from(paymentMethods)
      .where(
        and(eq(paymentMethods.enabled, true), arrayContains(paymentMethods.currencies, [currency])),
      )
      .orderBy(paymentMethods.sort, paymentMethods.key);
    return rows
      .filter(
        (row) => row.countries === null || (country !== null && row.countries.includes(country)),
      )
      .map((row) => ({
        key: row.key,
        kind: row.kind,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        feeBps: row.feeBps,
        feeFixedMinor: row.feeFixedMinor,
        minAmountMinor: row.minAmountMinor,
        maxAmountMinor: row.maxAmountMinor,
        currencies: row.currencies,
      }));
  }

  async creditPacks(currency: string): Promise<CreditPackEntry[]> {
    return this.handle.db
      .select({
        key: creditPacks.key,
        nameAr: creditPacks.nameAr,
        nameEn: creditPacks.nameEn,
        credits: creditPacks.credits,
        bonusCredits: creditPacks.bonusCredits,
        validMonths: creditPacks.validMonths,
        amountMinor: creditPackPrices.amountMinor,
      })
      .from(creditPacks)
      .innerJoin(creditPackPrices, eq(creditPackPrices.packId, creditPacks.id))
      .where(
        and(
          eq(creditPacks.active, true),
          eq(creditPackPrices.active, true),
          eq(creditPackPrices.currency, currency),
        ),
      )
      .orderBy(creditPacks.sort, creditPacks.key);
  }

  /** An active pack with its active price in `currency`, for a pack quote. */
  async packForQuote(
    key: string,
    currency: string,
  ): Promise<{ id: string; key: string; amountMinor: number } | undefined> {
    const [row] = await this.handle.db
      .select({
        id: creditPacks.id,
        key: creditPacks.key,
        amountMinor: creditPackPrices.amountMinor,
      })
      .from(creditPacks)
      .innerJoin(creditPackPrices, eq(creditPackPrices.packId, creditPacks.id))
      .where(
        and(
          eq(creditPacks.key, key),
          eq(creditPacks.active, true),
          eq(creditPackPrices.active, true),
          eq(creditPackPrices.currency, currency),
        ),
      );
    return row;
  }

  // --- History of one user ----------------------------------------------------------------------

  async hasPaidOrder(userId: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.ownerUserId, userId), eq(orders.status, "paid")))
      .limit(1);
    return row !== undefined;
  }

  /** The user's active, paid-for subscription (a trial, grant or deal period is not prorated). */
  async liveSubscription(userId: string): Promise<LiveSubscriptionBasis | undefined> {
    const [row] = await this.handle.db
      .select({
        planMonthlyCredits: plans.monthlyCredits,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.ownerUserId, userId),
          eq(subscriptions.status, "active"),
          eq(subscriptions.source, "paid"),
        ),
      )
      .limit(1);
    return row;
  }

  /** The newest paid plan order of the user: what the proration credit is worth. */
  async lastPaidPlanOrder(userId: string): Promise<LastPaidOrder | undefined> {
    const [row] = await this.handle.db
      .select({ currency: orders.currency, subtotalMinor: orders.subtotalMinor })
      .from(orders)
      .where(
        and(
          eq(orders.ownerUserId, userId),
          eq(orders.status, "paid"),
          ne(orders.kind, "credit_pack"),
        ),
      )
      .orderBy(desc(orders.paidAt), desc(orders.id))
      .limit(1);
    return row;
  }

  /**
   * The user's unconsumed, unexpired personal offers as engine discounts. The offer id is the
   * discount id (so an order can consume it) and the offer deadline caps the template's own end.
   */
  async personalOfferDiscounts(userId: string, now: Date): Promise<DiscountDef[]> {
    const offers = await this.handle.db
      .select()
      .from(personalOffers)
      .where(
        and(
          eq(personalOffers.ownerUserId, userId),
          isNull(personalOffers.consumedAt),
          gt(personalOffers.expiresAt, now),
        ),
      );
    if (offers.length === 0) return [];
    const promotionIds = offers.flatMap((o) => (o.promotionId ? [o.promotionId] : []));
    const couponIds = offers.flatMap((o) => (o.couponId ? [o.couponId] : []));
    const [promotionRows, couponRows, keys] = await Promise.all([
      promotionIds.length > 0
        ? this.handle.db.select().from(promotions).where(inArray(promotions.id, promotionIds))
        : Promise.resolve([]),
      couponIds.length > 0
        ? this.handle.db.select().from(coupons).where(inArray(coupons.id, couponIds))
        : Promise.resolve([]),
      this.planKeyMap(),
    ]);
    const templates = new Map<string, Promotion | Coupon>([
      ...promotionRows.map((row) => [row.id, row] as const),
      ...couponRows.map((row) => [row.id, row] as const),
    ]);
    return offers.flatMap((offer) => {
      const template = templates.get(offer.promotionId ?? offer.couponId ?? "");
      // A paused or ended template is withdrawn; the offer then no longer applies.
      if (!template || template.status === "paused" || template.status === "ended") return [];
      const def = toDiscountDef(template, "personal_offer", keys);
      if (!def) return [];
      const templateEnd = template.endsAt;
      const endsAt =
        templateEnd !== null && templateEnd < offer.expiresAt ? templateEnd : offer.expiresAt;
      return [{ ...def, id: offer.id, endsAt }];
    });
  }

  // --- Coupons ----------------------------------------------------------------------------------

  async findCoupon(code: string): Promise<Coupon | undefined> {
    const [row] = await this.handle.db.select().from(coupons).where(eq(coupons.code, code));
    return row;
  }

  /** How often this user has used (or has reserved) the coupon. */
  async couponUsesByUser(couponId: string, userId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: count() })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, couponId),
          eq(couponRedemptions.ownerUserId, userId),
          ne(couponRedemptions.status, "released"),
        ),
      );
    return row?.total ?? 0;
  }

  /** The `DiscountDef` of a coupon row. */
  async couponDef(coupon: Coupon): Promise<DiscountDef | null> {
    return toDiscountDef(coupon, "coupon", await this.planKeyMap());
  }
}
