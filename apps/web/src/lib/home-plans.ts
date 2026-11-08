import { periodLabel } from "@wasfa/ui";

import { getCatalog } from "./billing-server";

import type { Locale } from "./locale";
import type { ProductOffer } from "./structured-data";

/** Plan prices for the home page's structured data; empty when the catalog is unavailable. */
export async function homePlanOffers(locale: Locale): Promise<ProductOffer[]> {
  const catalog = await getCatalog(undefined);
  if (!catalog) return [];
  return catalog.plans.flatMap((plan) =>
    plan.prices.map((price) => ({
      name: `${plan.names[locale]} - ${periodLabel(price.months, locale)}`,
      amountMinor: price.display.headlineMinor,
      currency: catalog.currency,
    })),
  );
}
