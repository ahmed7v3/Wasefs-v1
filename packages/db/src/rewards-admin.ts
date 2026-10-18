import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";

import { moveCreditsInTransaction } from "./credits-ledger.js";
import { reversePendingReward } from "./rewards.js";
import {
  orders,
  pointsLedger,
  referralCodes,
  referrals,
  rewardDecisions,
  rewardRules,
  type Referral,
} from "./schema/index.js";

import type { Transaction } from "./credits-ledger.js";
import type { ReferralStatus } from "@wasfa/shared/rewards";

/*
 * Admin actions on the fraud queue (REFERRALS-REWARDS §6; ADMIN-CONSOLE-SPEC §6.2): release a held
 * referral, void one, or block everything a referrer has brought. Plain functions over a transaction,
 * like `rewards.ts`; the API (single actions, user 360 and the bulk queue) calls these and writes
 * the audit row with the admin's free-text reason. Lock order is the engine's: referral, then wallet
 * (taken inside `reversePendingReward`).
 *
 * Only rewards still in `pending` are reversed. Points that already moved to `cash` or `credit_only`
 * stay with their owner; clawing those back is the refund path's job (`reward_debts`).
 */

export type ReferralActionResult =
  | {
      kind: "ok";
      /** Referrals whose status changed, or whose held decisions were settled. */
      referralIds: string[];
      reversedRows: number;
      reversedPoints: number;
      /** Held decisions turned into a grant (release) or a denial (void, block). */
      settledDecisions: number;
    }
  | { kind: "not_found" }
  /** The referral is not in a state the action applies to. */
  | { kind: "conflict"; status: ReferralStatus }
  /** Block needs a person behind the code; an institution or campaign code has none. */
  | { kind: "no_referrer" };

const PAYMENT_EVENTS = ["first_payment", "renewal", "credit_pack"] as const;

function requireReason(reason: string): void {
  if (reason.trim().length === 0) throw new Error("A reason is required");
}

async function lockReferral(tx: Transaction, referralId: string): Promise<Referral | undefined> {
  const [row] = await tx.select().from(referrals).where(eq(referrals.id, referralId)).for("update");
  return row;
}

/** Where a released referral goes back to: what its decisions say it had reached. */
async function statusBeforeHold(tx: Transaction, referralId: string): Promise<ReferralStatus> {
  const decisions = await tx
    .select({ event: rewardDecisions.event, points: rewardDecisions.points })
    .from(rewardDecisions)
    .where(and(eq(rewardDecisions.referralId, referralId), ne(rewardDecisions.outcome, "denied")));
  const paid = decisions.some(
    (row) => (PAYMENT_EVENTS as readonly string[]).includes(row.event) && row.points > 0,
  );
  if (paid) return "rewarded";
  return decisions.some((row) => row.event === "referee_verified") ? "qualified" : "pending";
}

/** `reward_pending` rows of this referral (its own, and its referee's orders) not yet released or reversed. */
async function openPendingRows(tx: Transaction, referral: Referral) {
  const orderIds = tx
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.ownerUserId, referral.refereeUserId));
  return tx
    .select()
    .from(pointsLedger)
    .where(
      and(
        eq(pointsLedger.kind, "reward_pending"),
        or(
          and(
            eq(pointsLedger.referenceType, "referral"),
            eq(pointsLedger.referenceId, referral.id),
          ),
          and(eq(pointsLedger.referenceType, "order"), inArray(pointsLedger.referenceId, orderIds)),
        ),
        sql`not exists (
          select 1 from points_ledger x
          where x.idempotency_key in (
            'release:' || ${pointsLedger.id}::text || ':in',
            'reverse:' || ${pointsLedger.id}::text || ':pending',
            'reverse:' || ${pointsLedger.id}::text || ':cash',
            'reverse:' || ${pointsLedger.id}::text || ':credit_only'
          )
        )`,
      ),
    )
    .orderBy(asc(pointsLedger.createdAt), asc(pointsLedger.id));
}

async function reversePending(
  tx: Transaction,
  referral: Referral,
  actorId: string,
): Promise<{ rows: number; points: number }> {
  let rows = 0;
  let points = 0;
  for (const row of await openPendingRows(tx, referral)) {
    if (await reversePendingReward(tx, row, "void", actorId)) {
      rows++;
      points += row.amount;
    }
  }
  return { rows, points };
}

/** Held decisions of the referral that never paid become denials: the queue must not keep them. */
async function denyHeldDecisions(tx: Transaction, referralIds: readonly string[]): Promise<number> {
  if (referralIds.length === 0) return 0;
  const settled = await tx
    .update(rewardDecisions)
    .set({ outcome: "denied", reason: "referral_blocked", points: 0 })
    .where(
      and(
        inArray(rewardDecisions.referralId, [...referralIds]),
        eq(rewardDecisions.outcome, "held_for_review"),
      ),
    )
    .returning({ id: rewardDecisions.id });
  return settled.length;
}

/**
 * Settles the held decisions of a released referral. A points decision already has its `pending`
 * ledger row (the hourly job releases it now that the referral is no longer held), so it becomes a
 * grant. A held credits decision paid nothing yet: the credits are granted now under the key the
 * engine would have used. A decision whose credits cannot be reconstructed (a deal override) stays.
 */
async function settleHeldDecisions(
  tx: Transaction,
  referral: Referral,
  actorId: string,
): Promise<number> {
  const held = await tx
    .select()
    .from(rewardDecisions)
    .where(
      and(
        eq(rewardDecisions.referralId, referral.id),
        eq(rewardDecisions.outcome, "held_for_review"),
      ),
    )
    .orderBy(asc(rewardDecisions.createdAt), asc(rewardDecisions.id));
  let settled = 0;
  for (const decision of held) {
    if (decision.points === 0) {
      const userId =
        decision.beneficiary === "referrer" ? referral.referrerUserId : referral.refereeUserId;
      const [rule] = decision.ruleId
        ? await tx.select().from(rewardRules).where(eq(rewardRules.id, decision.ruleId))
        : [];
      if (!userId || !rule || rule.rewardKind !== "fixed_credits" || rule.value <= 0) continue;
      await moveCreditsInTransaction(
        tx,
        { type: "user", id: userId },
        {
          kind: "reward_bonus",
          amount: rule.value,
          idempotencyKey: decision.idempotencyKey.replace(/^reward:/u, "reward_credit:"),
          reason: `reward:${decision.event}`,
          actorId,
        },
      );
    }
    await tx
      .update(rewardDecisions)
      .set({ outcome: "granted", reason: "paid" })
      .where(eq(rewardDecisions.id, decision.id));
    settled++;
  }
  return settled;
}

/**
 * Frees a held referral: the status goes back to what its decisions say it had reached (`pending`,
 * `qualified` or `rewarded`), its pending rewards keep their `release_at`, and the hourly job
 * releases them when due. The fraud flags and score stay as history. `conflict` when the referral
 * is neither held nor has held decisions left to settle.
 */
export async function releaseReferralHold(
  tx: Transaction,
  referralId: string,
  actorId: string,
  reason: string,
  now: Date,
): Promise<ReferralActionResult> {
  requireReason(reason);
  const referral = await lockReferral(tx, referralId);
  if (!referral) return { kind: "not_found" };
  if (referral.status === "blocked" || referral.status === "void") {
    return { kind: "conflict", status: referral.status };
  }
  const wasHeld = referral.status === "held";
  const settledDecisions = await settleHeldDecisions(tx, referral, actorId);
  if (!wasHeld && settledDecisions === 0) return { kind: "conflict", status: referral.status };
  if (wasHeld) {
    await tx
      .update(referrals)
      .set({ status: await statusBeforeHold(tx, referral.id), updatedAt: now })
      .where(eq(referrals.id, referral.id));
  }
  return {
    kind: "ok",
    referralIds: [referral.id],
    reversedRows: 0,
    reversedPoints: 0,
    settledDecisions,
  };
}

/**
 * Voids a referral: its pending rewards are reversed (`reward_reverse`), the held decisions become
 * denials and the status is `void`, so no later event pays. `conflict` when it is already void.
 */
export async function voidReferral(
  tx: Transaction,
  referralId: string,
  actorId: string,
  reason: string,
  now: Date,
): Promise<ReferralActionResult> {
  requireReason(reason);
  const referral = await lockReferral(tx, referralId);
  if (!referral) return { kind: "not_found" };
  if (referral.status === "void") return { kind: "conflict", status: "void" };
  const reversed = await reversePending(tx, referral, actorId);
  const settledDecisions = await denyHeldDecisions(tx, [referral.id]);
  await tx
    .update(referrals)
    .set({ status: "void", updatedAt: now })
    .where(eq(referrals.id, referral.id));
  return {
    kind: "ok",
    referralIds: [referral.id],
    reversedRows: reversed.rows,
    reversedPoints: reversed.points,
    settledDecisions,
  };
}

/**
 * Blocks the referrer behind a referral: every referral they brought becomes `blocked` (void ones
 * stay void), their pending rewards are reversed, held decisions are denied and their codes are
 * paused so no new sign-up is attributed to them. `no_referrer` for an institution or campaign
 * code; `conflict` when nothing of theirs was left to block.
 */
export async function blockReferrer(
  tx: Transaction,
  referralId: string,
  actorId: string,
  reason: string,
  now: Date,
): Promise<ReferralActionResult> {
  requireReason(reason);
  const [origin] = await tx
    .select({ referrerUserId: referrals.referrerUserId })
    .from(referrals)
    .where(eq(referrals.id, referralId));
  if (!origin) return { kind: "not_found" };
  const referrerId = origin.referrerUserId;
  if (referrerId === null) return { kind: "no_referrer" };

  // Ordered by id so two admins blocking the same referrer cannot deadlock.
  const all = await tx
    .select()
    .from(referrals)
    .where(eq(referrals.referrerUserId, referrerId))
    .orderBy(asc(referrals.id))
    .for("update");
  const targets = all.filter((row) => row.status !== "void");
  let rows = 0;
  let points = 0;
  for (const referral of targets) {
    const reversed = await reversePending(tx, referral, actorId);
    rows += reversed.rows;
    points += reversed.points;
  }
  const ids = targets.map((row) => row.id);
  const settledDecisions = await denyHeldDecisions(tx, ids);
  const changed = targets.filter((row) => row.status !== "blocked").map((row) => row.id);
  if (changed.length > 0) {
    await tx
      .update(referrals)
      .set({ status: "blocked", updatedAt: now })
      .where(inArray(referrals.id, changed));
  }
  const paused = await tx
    .update(referralCodes)
    .set({ active: false, updatedAt: now })
    .where(and(eq(referralCodes.ownerUserId, referrerId), eq(referralCodes.active, true)))
    .returning({ id: referralCodes.id });
  if (changed.length === 0 && rows === 0 && settledDecisions === 0 && paused.length === 0) {
    return { kind: "conflict", status: "blocked" };
  }
  return {
    kind: "ok",
    referralIds: changed,
    reversedRows: rows,
    reversedPoints: points,
    settledDecisions,
  };
}
