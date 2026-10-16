import { Inject, Injectable } from "@nestjs/common";
import { planPrices, plans, type Plan, type PlanPrice } from "@wasfa/db";
import { and, eq } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

export interface OfferedPlanRow {
  plan: Plan;
  price: PlanPrice;
}

/** Catalog reads that only the public pricing page needs; the shared inputs live in `QuoteInputsRepo`. */
@Injectable()
export class CatalogRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** One row per active price of a public plan in `currency`, plans in display order, prices by period. */
  offeredPlans(currency: string): Promise<OfferedPlanRow[]> {
    return this.handle.db
      .select({ plan: plans, price: planPrices })
      .from(plans)
      .innerJoin(planPrices, eq(planPrices.planId, plans.id))
      .where(
        and(
          eq(plans.visibility, "public"),
          eq(planPrices.active, true),
          eq(planPrices.currency, currency),
        ),
      )
      .orderBy(plans.sort, plans.key, planPrices.months);
  }
}
