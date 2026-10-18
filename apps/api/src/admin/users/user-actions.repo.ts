import { Inject, Injectable } from "@nestjs/common";
import {
  blockReferrer,
  coupons,
  personalOffers,
  pointsMove,
  promotions,
  releaseReferralHold,
  voidReferral,
  type PointsMoveInput,
  type PointsMoveResult,
  type ReferralActionResult,
} from "@wasfa/db";
import { and, eq, isNull } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

/** Queries of the user 360 quick actions; the money moves are the `@wasfa/db` functions. */
@Injectable()
export class AdminUserActionsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async coupon(couponId: string) {
    const [row] = await this.handle.db.select().from(coupons).where(eq(coupons.id, couponId));
    return row;
  }

  /** Aims an untargeted coupon at the user; guarded in the statement so two admins cannot both claim it. */
  async claimCoupon(couponId: string, userId: string): Promise<boolean> {
    const claimed = await this.handle.db
      .update(coupons)
      .set({ targetUserId: userId })
      .where(and(eq(coupons.id, couponId), isNull(coupons.targetUserId), isNull(coupons.targetOrgId)))
      .returning({ id: coupons.id });
    return claimed.length > 0;
  }

  async promotion(promotionId: string) {
    const [row] = await this.handle.db
      .select({ id: promotions.id, status: promotions.status })
      .from(promotions)
      .where(eq(promotions.id, promotionId));
    return row;
  }

  async insertOffer(input: { userId: string; promotionId: string; expiresAt: Date }) {
    const [offer] = await this.handle.db
      .insert(personalOffers)
      .values({
        ownerUserId: input.userId,
        // The closed list has no "admin" kind; a staff-made offer is a win-back (no schema change).
        kind: "winback",
        promotionId: input.promotionId,
        ruleKey: "admin_grant",
        expiresAt: input.expiresAt,
      })
      .returning({ id: personalOffers.id });
    return offer;
  }

  movePoints(input: PointsMoveInput): Promise<PointsMoveResult> {
    return this.handle.db.transaction((tx) => pointsMove(tx, input));
  }

  referralAction(
    action: "release" | "void" | "block_referrer",
    referralId: string,
    actorId: string,
    reason: string,
    now: Date,
  ): Promise<ReferralActionResult> {
    return this.handle.db.transaction((tx) => {
      if (action === "release") return releaseReferralHold(tx, referralId, actorId, reason, now);
      if (action === "void") return voidReferral(tx, referralId, actorId, reason, now);
      return blockReferrer(tx, referralId, actorId, reason, now);
    });
  }
}
