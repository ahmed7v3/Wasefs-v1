import { Inject, Injectable } from "@nestjs/common";
import { planOnSale, planPrices, plans, type Plan, type PlanPrice } from "@wasfa/db";
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
  offeredPlans(currency: string, now = new Date()): Promise<OfferedPlanRow[]> {
    return this.handle.db
      .select({ plan: plans, price: planPrices })
      .from(plans)
      .innerJoin(planPrices, eq(planPrices.planId, plans.id))
      .where(
        and(
          planOnSale(now),
          // The default plan is the free one: it is shown on its own (`freePlan`), never sold.
          eq(plans.isDefault, false),
          eq(planPrices.active, true),
          eq(planPrices.currency, currency),
        ),
      )
      .orderBy(plans.sort, plans.key, planPrices.months);
  }

  /** The default (free) plan while it is on sale, else nothing. */
  async freePlan(now = new Date()): Promise<Plan | null> {
    const [row] = await this.handle.db
      .select()
      .from(plans)
      .where(and(planOnSale(now), eq(plans.isDefault, true)))
      .limit(1);
    return row ?? null;
  }
}
