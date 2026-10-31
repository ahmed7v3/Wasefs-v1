import { formatMoney } from "@wasfa/shared/money";
import { z } from "zod";

import { defineTool } from "./tool.js";

const money = (minor: number, currency: string) => ({
  amountMinor: minor,
  formatted: formatMoney(minor, currency, "ar"),
});

/**
 * Plans, prices, promotions and credit packs for the sender's market, from the same `CatalogService`
 * the pricing page reads. The model quotes prices from this and nowhere else (docs/WA-AGENT.md section 3).
 */
export const getCatalogTool = defineTool({
  definition: {
    name: "get_catalog",
    description:
      "Current plans, prices, active promotions and credit packs for this customer's market. Call it before quoting any price or plan.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  schema: z.object({}),
  linkedOnly: false,
  effect: "read",
  handler: async (ctx) => {
    const catalog = await ctx.deps.catalog.catalog(ctx.market);
    const { currency } = catalog;
    const promotionEnds = new Map(catalog.promotions.map((promo) => [promo.id, promo.endsAt]));
    return {
      currency,
      plans: catalog.plans.map((plan) => ({
        key: plan.key,
        name: plan.names.ar,
        audience: plan.audience,
        monthlyCredits: plan.monthlyCredits,
        prices: plan.prices.map((price) => ({
          months: price.months,
          currency,
          ...money(price.display.headlineMinor, currency),
          perMonth: money(price.display.perMonthMinor, currency),
          ...(price.display.struckMinor === null
            ? {}
            : { listPrice: money(price.display.struckMinor, currency) }),
          // Only a real end date the promotion chose to show.
          ...(price.promotionId !== null && promotionEnds.get(price.promotionId)
            ? { promotionEndsAt: promotionEnds.get(price.promotionId) }
            : {}),
        })),
      })),
      freePlan: catalog.freePlan
        ? {
            key: catalog.freePlan.key,
            name: catalog.freePlan.names.ar,
            monthlyCredits: catalog.freePlan.monthlyCredits,
          }
        : null,
      promotions: catalog.promotions.map((promo) => ({
        title: promo.title.ar,
        endsAt: promo.endsAt,
      })),
      creditPacks: catalog.creditPacks.map((pack) => ({
        key: pack.key,
        name: pack.names.ar,
        credits: pack.credits,
        bonusCredits: pack.bonusCredits,
        validMonths: pack.validMonths,
        currency,
        ...money(pack.amountMinor, currency),
      })),
    };
  },
});
