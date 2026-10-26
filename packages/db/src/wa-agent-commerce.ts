import { generateCouponCode } from "@wasfa/shared/coupon-codes";
import { and, count, eq, gt, gte, lt, ne, sql } from "drizzle-orm";

import { couponRedemptions, coupons, type Coupon } from "./schema/promotions.js";

import type { Database } from "./client.js";

/*
 * The WhatsApp agent's personal coupons (docs/WA-AGENT.md section 6). The policy numbers come from
 * the admin setting; the counting and the minting happen here, in one transaction under one
 * advisory lock, so the per-user and the daily limits cannot be beaten by two requests at once.
 * The pattern is the referral coupon of `rewards.ts`: active, single-use, targeted at one user.
 */

/** The `campaign` every agent coupon carries; the admin coupon list can filter on it. */
export const WA_AGENT_COUPON_CAMPAIGN = "wa_agent";

/** Serializes minting. Agent coupons are a handful per day, so one global lock costs nothing. */
const MINT_LOCK = "wa_agent_coupon";

const CODE_ATTEMPTS = 8;

export interface AgentCouponInput {
  userId: string;
  planId: string;
  months: number;
  /** Basis points: 1000 = 10 percent. */
  percentBps: number;
  validHours: number;
  perUserLifetime: number;
  dailyCap: number;
  titleAr: string;
  titleEn: string;
  now: Date;
}

export type AgentCouponResult =
  | { outcome: "minted" | "reused"; coupon: Coupon }
  | { outcome: "refused"; reason: "lifetime_limit" | "daily_cap" };

const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** `WA` and six characters of the unambiguous coupon alphabet. */
export const generateAgentCouponCode = () => `WA${generateCouponCode(6)}`;

/**
 * Hands the user an agent coupon: the one they already hold when it is still unexpired and unused,
 * otherwise a new one if the lifetime and daily limits allow.
 */
export async function mintAgentCoupon(
  db: Database,
  input: AgentCouponInput,
  makeCode: () => string = generateAgentCouponCode,
): Promise<AgentCouponResult> {
  const { now } = input;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${MINT_LOCK}))`);
    // A voided (`ended`) coupon never reached the customer as a working discount: it counts for
    // nothing and is never handed out again.
    const mine = and(
      eq(coupons.campaign, WA_AGENT_COUPON_CAMPAIGN),
      eq(coupons.targetUserId, input.userId),
      ne(coupons.status, "ended"),
    );

    const [held] = await tx
      .select()
      .from(coupons)
      .where(
        and(
          mine,
          eq(coupons.status, "active"),
          gt(coupons.endsAt, now),
          lt(coupons.redeemedCount, 1),
        ),
      )
      .limit(1);
    if (held) return { outcome: "reused" as const, coupon: held };

    const [own] = await tx.select({ total: count() }).from(coupons).where(mine);
    if ((own?.total ?? 0) >= input.perUserLifetime) {
      return { outcome: "refused" as const, reason: "lifetime_limit" as const };
    }
    const [today] = await tx
      .select({ total: count() })
      .from(coupons)
      .where(
        and(
          eq(coupons.campaign, WA_AGENT_COUPON_CAMPAIGN),
          ne(coupons.status, "ended"),
          gte(coupons.createdAt, startOfUtcDay(now)),
        ),
      );
    if ((today?.total ?? 0) >= input.dailyCap) {
      return { outcome: "refused" as const, reason: "daily_cap" as const };
    }

    const endsAt = new Date(now.getTime() + input.validHours * 3_600_000);
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const [created] = await tx
        .insert(coupons)
        .values({
          code: makeCode(),
          kind: "percent",
          name: `${WA_AGENT_COUPON_CAMPAIGN}:${input.userId.slice(0, 8)}`,
          titleAr: input.titleAr,
          titleEn: input.titleEn,
          value: input.percentBps,
          planIds: [input.planId],
          months: [input.months],
          startsAt: now,
          endsAt,
          maxRedemptions: 1,
          perOwnerLimit: 1,
          stacking: "exclusive",
          status: "active",
          targetUserId: input.userId,
          campaign: WA_AGENT_COUPON_CAMPAIGN,
        })
        .onConflictDoNothing({ target: coupons.code })
        .returning();
      if (created) return { outcome: "minted" as const, coupon: created };
    }
    throw new Error("Agent coupon code could not be generated");
  });
}

/**
 * Withdraws an agent coupon that turned out to give no discount, using the existing `ended` status.
 * Only a coupon nobody redeemed or reserved is touched; anything else is left as it is.
 */
export async function voidAgentCoupon(db: Database, couponId: string): Promise<boolean> {
  const rows = await db
    .update(coupons)
    .set({ status: "ended", updatedAt: new Date() })
    .where(
      and(
        eq(coupons.id, couponId),
        eq(coupons.campaign, WA_AGENT_COUPON_CAMPAIGN),
        eq(coupons.redeemedCount, 0),
        sql`not exists (select 1 from ${couponRedemptions} where ${couponRedemptions.couponId} = ${coupons.id})`,
      ),
    )
    .returning({ id: coupons.id });
  return rows.length > 0;
}
