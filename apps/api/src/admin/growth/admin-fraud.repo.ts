import { Inject, Injectable } from "@nestjs/common";
import {
  blockReferrer,
  releaseReferralHold,
  referrals,
  rewardDecisions,
  users,
  voidReferral,
  type ReferralActionResult,
} from "@wasfa/db";
import { and, asc, desc, eq, exists, inArray, or, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, stamp, type Cursor } from "../common/keyset.js";

import type { FraudAction, FraudListQuery } from "@wasfa/shared/schemas/admin-growth";

/** Statuses a referral can hold a still-unsettled `held_for_review` decision in. */
const LIVE_STATUSES = ["pending", "qualified", "rewarded"] as const;

const ACTIONS = {
  release: releaseReferralHold,
  void: voidReferral,
  block_referrer: blockReferrer,
} as const satisfies Record<FraudAction, unknown>;

/** The fraud queue: held referrals and held reward decisions, with the evidence around them. */
@Injectable()
export class AdminFraudRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  page(query: FraudListQuery, cursor?: Cursor) {
    const db = this.handle.db;
    const heldDecision = exists(
      db
        .select({ one: sql`1` })
        .from(rewardDecisions)
        .where(
          and(
            eq(rewardDecisions.referralId, referrals.id),
            eq(rewardDecisions.outcome, "held_for_review"),
          ),
        ),
    );
    return db
      .select({ referral: referrals, cursorAt: stamp(referrals.createdAt) })
      .from(referrals)
      .where(
        and(
          or(
            eq(referrals.status, "held"),
            and(inArray(referrals.status, [...LIVE_STATUSES]), heldDecision),
          ),
          query.flag ? sql`${query.flag} = any(${referrals.flags})` : undefined,
          cursor ? afterCursor(referrals.createdAt, referrals.id, cursor, "uuid") : undefined,
        ),
      )
      .orderBy(desc(referrals.createdAt), desc(referrals.id))
      .limit(query.limit + 1);
  }

  async names(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.handle.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** Who invited each of these users (the referrer one step up the chain). */
  async invitersOf(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.handle.db
      .select({ invitee: referrals.refereeUserId, inviter: referrals.referrerUserId })
      .from(referrals)
      .where(inArray(referrals.refereeUserId, userIds));
    return new Map(
      rows.flatMap((row) => (row.inviter ? [[row.invitee, row.inviter] as const] : [])),
    );
  }

  heldDecisions(referralIds: string[]) {
    if (referralIds.length === 0) return Promise.resolve([]);
    return this.handle.db
      .select()
      .from(rewardDecisions)
      .where(
        and(
          inArray(rewardDecisions.referralId, referralIds),
          eq(rewardDecisions.outcome, "held_for_review"),
        ),
      )
      .orderBy(asc(rewardDecisions.createdAt), asc(rewardDecisions.id));
  }

  /** Pending points per referral (its own rows and its referee's orders) not yet released or reversed. */
  async pendingPoints(referralIds: string[]): Promise<Map<string, number>> {
    if (referralIds.length === 0) return new Map();
    const ids = sql.join(
      referralIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await this.handle.db.execute<{ referral_id: string; points: number }>(sql`
      select r.id as referral_id, coalesce(sum(l.amount), 0)::int as points
      from referrals r
      join points_ledger l on l.kind = 'reward_pending' and (
        (l.reference_type = 'referral' and l.reference_id = r.id)
        or (l.reference_type = 'order' and l.reference_id in (
          select o.id from orders o where o.owner_user_id = r.referee_user_id
        ))
      )
      where r.id in (${ids})
        and not exists (
          select 1 from points_ledger x
          where x.idempotency_key in (
            'release:' || l.id::text || ':in',
            'reverse:' || l.id::text || ':pending',
            'reverse:' || l.id::text || ':cash',
            'reverse:' || l.id::text || ':credit_only'
          )
        )
      group by r.id
    `);
    return new Map(Array.from(rows, (row) => [row.referral_id, Number(row.points)] as const));
  }

  /** One referral's action in its own transaction: a failing one never undoes the others. */
  act(
    action: FraudAction,
    referralId: string,
    actorId: string,
    reason: string,
    now: Date,
  ): Promise<ReferralActionResult> {
    const run = ACTIONS[action];
    return this.handle.db.transaction((tx) => run(tx, referralId, actorId, reason, now));
  }
}
