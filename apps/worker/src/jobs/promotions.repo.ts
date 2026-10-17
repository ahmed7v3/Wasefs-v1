import { coupons, promotions } from "@wasfa/db";
import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import type { Database } from "@wasfa/db";

export async function refreshDiscountStatuses(db: Database, now: Date) {
  const result = await db.transaction(async (tx) => {
    const promotionActive = await tx
      .update(promotions)
      .set({ status: "active", updatedAt: now })
      .where(
        and(
          eq(promotions.status, "scheduled"),
          or(isNull(promotions.startsAt), lte(promotions.startsAt, now)),
          or(isNull(promotions.endsAt), gt(promotions.endsAt, now)),
        ),
      )
      .returning({ id: promotions.id });
    const promotionEnded = await tx
      .update(promotions)
      .set({ status: "ended", updatedAt: now })
      .where(
        and(
          inArray(promotions.status, ["scheduled", "active", "paused"]),
          lte(promotions.endsAt, now),
        ),
      )
      .returning({ id: promotions.id });
    const couponActive = await tx
      .update(coupons)
      .set({ status: "active", updatedAt: now })
      .where(
        and(
          eq(coupons.status, "scheduled"),
          or(isNull(coupons.startsAt), lte(coupons.startsAt, now)),
          or(isNull(coupons.endsAt), gt(coupons.endsAt, now)),
        ),
      )
      .returning({ id: coupons.id });
    const couponEnded = await tx
      .update(coupons)
      .set({ status: "ended", updatedAt: now })
      .where(
        and(inArray(coupons.status, ["scheduled", "active", "paused"]), lte(coupons.endsAt, now)),
      )
      .returning({ id: coupons.id });
    return {
      promotionsActive: promotionActive.length,
      promotionsEnded: promotionEnded.length,
      couponsActive: couponActive.length,
      couponsEnded: couponEnded.length,
    };
  });
  return result;
}
