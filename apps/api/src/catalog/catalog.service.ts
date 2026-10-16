import { Injectable } from "@nestjs/common";
import { billingPublicView } from "@wasfa/shared/billing";
import { quote } from "@wasfa/shared/price-engine";
import {
  catalogResponseSchema,
  type CatalogPlan,
  type CatalogResponse,
  type RecommendationResponse,
} from "@wasfa/shared/schemas/billing";

import { engineSettings } from "../billing/engine-settings.js";
import {
  QuoteInputsRepo,
  audienceFits,
  type PromotionEntry,
} from "../billing/quote-inputs.repo.js";
import { InvalidationBus } from "../common/invalidation-bus.js";
import { LocalCache } from "../common/local-cache.js";
import { CreditsRepo } from "../credits/credits.repo.js";
import { PlansService } from "../plans/plans.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { CatalogRepo, type OfferedPlanRow } from "./catalog.repo.js";

import type { Market } from "./market.js";

/** Admin billing writes publish here (WP5) to drop the cached catalog on every instance. */
export const CATALOG_INVALIDATION_TOPIC = "catalog";
/** The catalog is also served with `max-age=60`, so a minute is as stale as it can already be. */
export const CATALOG_LOCAL_TTL_MS = 60_000;

const DAY_MS = 86_400_000;
const USAGE_WINDOW_DAYS = 30;

function localized(ar: string | null, en: string | null): { ar: string; en: string } | null {
  return ar !== null && en !== null ? { ar, en } : null;
}

function toPromotion({ promotion }: PromotionEntry) {
  return {
    id: promotion.id,
    title: { ar: promotion.titleAr, en: promotion.titleEn },
    badge: localized(promotion.badgeAr, promotion.badgeEn),
    // A countdown is shown only for a real end date the promotion opted to display.
    endsAt: promotion.showCountdown && promotion.endsAt ? promotion.endsAt.toISOString() : null,
  };
}

/** The pricing page data (public) and the plan advice built on the same offered plans. */
@Injectable()
export class CatalogService {
  private readonly cache = new LocalCache<CatalogResponse>(CATALOG_LOCAL_TTL_MS);

  constructor(
    private readonly repo: CatalogRepo,
    private readonly inputs: QuoteInputsRepo,
    private readonly settings: SettingsService,
    private readonly credits: CreditsRepo,
    private readonly plans: PlansService,
    bus: InvalidationBus,
  ) {
    bus.on(CATALOG_INVALIDATION_TOPIC, () => {
      this.cache.clear();
    });
  }

  async catalog(market: Market, now = new Date()): Promise<CatalogResponse> {
    const cacheKey = `${market.currency}|${market.country ?? ""}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const { currency, country } = market;
    const [billing, rows, promotions, packs, taxRule, methods] = await Promise.all([
      this.settings.get("billing"),
      this.repo.offeredPlans(currency),
      this.inputs.activePromotions(now),
      this.inputs.creditPacks(currency),
      this.inputs.taxRuleFor(country),
      this.inputs.enabledMethods(currency, country),
    ]);
    const settings = engineSettings(billing, packs);

    const byPlan = new Map<string, OfferedPlanRow[]>();
    for (const row of rows) {
      byPlan.set(row.plan.id, [...(byPlan.get(row.plan.id) ?? []), row]);
    }
    const plans = [...byPlan.values()].map((planRows): CatalogPlan => {
      const [first] = planRows;
      if (!first) throw new Error("A plan group cannot be empty");
      const { plan } = first;
      const purchase = plan.audience === "organization" ? "organization" : "individual";
      const discounts = promotions
        .filter((entry) => audienceFits(entry.promotion.audience, purchase))
        .map((entry) => entry.def);
      const prices = planRows.map(({ price }) => {
        // Promotions only: no coupon, no method, no history. A refusal falls back to the list price.
        const result = quote({
          price: {
            planKey: plan.key,
            months: price.months,
            currency,
            amountMinor: price.amountMinor,
          },
          discounts,
          methods: [],
          history: { isFirstPurchase: false },
          settings,
          now,
          country,
        });
        const display = result.ok
          ? result.quote.display
          : {
              headlineMinor: price.amountMinor,
              struckMinor: null,
              savingsMinor: 0,
              perMonthMinor: Math.floor(price.amountMinor / price.months),
            };
        return {
          months: price.months,
          amountMinor: price.amountMinor,
          promotionId: result.ok ? (result.quote.applied.promotionId ?? null) : null,
          display: {
            headlineMinor: display.headlineMinor,
            struckMinor: display.struckMinor,
            savingsMinor: display.savingsMinor,
            perMonthMinor: display.perMonthMinor,
          },
        };
      });
      const monthly = planRows.find(({ price }) => price.months === 1)?.price.amountMinor;
      const yearly = planRows.find(({ price }) => price.months === 12)?.price.amountMinor;
      const annualSavings =
        monthly !== undefined && yearly !== undefined ? 12 * monthly - yearly : undefined;
      return {
        key: plan.key,
        audience: plan.audience,
        names: { ar: plan.nameAr, en: plan.nameEn },
        tagline: localized(plan.taglineAr, plan.taglineEn),
        features: plan.features,
        badge: localized(plan.badgeAr, plan.badgeEn),
        pinRecommended: plan.pinRecommended,
        trialDays: plan.trialDays,
        monthlyCredits: plan.monthlyCredits,
        maxMembers: plan.maxMembers,
        fairUseNote: localized(plan.fairUseNoteAr, plan.fairUseNoteEn),
        prices,
        ...(annualSavings !== undefined && annualSavings >= 0
          ? { annualSavingsMinor: annualSavings }
          : {}),
      };
    });

    // Parsing strips anything the schema does not name: the last guard against leaking a column.
    const response = catalogResponseSchema.parse({
      currency,
      country,
      plans,
      promotions: promotions.filter(({ promotion }) => promotion.showOnPricing).map(toPromotion),
      creditPacks: packs.map((pack) => ({
        key: pack.key,
        names: { ar: pack.nameAr, en: pack.nameEn },
        credits: pack.credits,
        bonusCredits: pack.bonusCredits,
        validMonths: pack.validMonths,
        amountMinor: pack.amountMinor,
      })),
      tax: { mode: taxRule?.mode ?? "none" },
      methods: methods.map((method) => ({
        key: method.key,
        kind: method.kind,
        names: { ar: method.nameAr, en: method.nameEn },
        feeBps: method.feeBps,
        feeFixedMinor: method.feeFixedMinor,
        feeFree: method.feeBps === 0 && method.feeFixedMinor === 0,
      })),
      billing: billingPublicView(billing),
    });
    this.cache.set(cacheKey, response);
    return response;
  }

  /**
   * GROWTH 7.2: the cheapest offered plan that covers the last 30 days of credit use, next to the
   * per-credit price of the cheapest pack. Numbers only; the web builds the sentence from i18n.
   */
  async recommendation(
    userId: string,
    market: Market,
    now = new Date(),
  ): Promise<RecommendationResponse> {
    const { currency } = market;
    const [usage, current, rows, packs] = await Promise.all([
      this.credits.usedSince(userId, new Date(now.getTime() - USAGE_WINDOW_DAYS * DAY_MS)),
      this.plans.effectivePlan({ type: "user", id: userId }, now),
      this.repo.offeredPlans(currency),
      this.inputs.creditPacks(currency),
    ]);
    const packPerCredit = packs
      .filter((pack) => pack.credits + pack.bonusCredits > 0)
      .map((pack) => Math.floor(pack.amountMinor / (pack.credits + pack.bonusCredits)));
    const base = {
      usage30dCredits: usage,
      currency,
      packPerCreditMinor: packPerCredit.length > 0 ? Math.min(...packPerCredit) : null,
      currentPlanKey: current.key,
    };
    if (usage <= 0 || current.monthlyCredits >= usage) return { ...base, recommended: null };

    const best = rows
      .filter(
        ({ plan, price }) =>
          price.months === 1 && plan.audience !== "organization" && plan.monthlyCredits >= usage,
      )
      .sort(
        (a, b) =>
          a.price.amountMinor - b.price.amountMinor ||
          a.plan.monthlyCredits - b.plan.monthlyCredits ||
          a.plan.key.localeCompare(b.plan.key),
      )[0];
    if (!best) return { ...base, recommended: null };
    return {
      ...base,
      recommended: {
        planKey: best.plan.key,
        months: 1,
        amountMinor: best.price.amountMinor,
        perCreditMinor: Math.floor(best.price.amountMinor / best.plan.monthlyCredits),
      },
    };
  }
}
