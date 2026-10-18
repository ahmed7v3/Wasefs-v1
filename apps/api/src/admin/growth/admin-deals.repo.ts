import { Inject, Injectable } from "@nestjs/common";
import {
  dealTargets,
  deals,
  grantUserTargetWelcome,
  orders,
  organizationMembers,
  organizations,
  referralCodes,
  referrals,
  users,
  type Deal,
  type DealTarget,
  type NewDealTarget,
} from "@wasfa/db";
import { and, asc, desc, eq, exists, ilike, inArray, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, escapeLike, stamp, type Cursor } from "../common/keyset.js";

import type { DealStatus } from "@wasfa/shared/rewards";
import type {
  CreateDealInput,
  DealListQuery,
  DealTargetInput,
  UpdateDealInput,
} from "@wasfa/shared/schemas/deals";

const dateValue = (value: string | null | undefined) =>
  value === undefined || value === null ? value : new Date(value);

function targetRow(dealId: string, input: DealTargetInput): NewDealTarget {
  const base = { dealId, targetKind: input.kind, memberOnly: input.memberOnly };
  switch (input.kind) {
    case "user":
      return { ...base, targetUserId: input.userId };
    case "organization":
      return { ...base, targetOrgId: input.orgId };
    case "referral_code":
      return { ...base, referralCodeId: input.referralCodeId };
    case "email_domain":
      return { ...base, emailDomain: input.emailDomain };
  }
}

export type TransitionResult =
  { kind: "ok"; before: Deal; after: Deal } | { kind: "not_found" } | { kind: "conflict" };

@Injectable()
export class AdminDealsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  page(query: DealListQuery, cursor?: Cursor) {
    const search = query.q ? `%${escapeLike(query.q)}%` : undefined;
    return this.handle.db
      .select({ deal: deals, cursorAt: stamp(deals.createdAt) })
      .from(deals)
      .where(
        and(
          query.status ? eq(deals.status, query.status) : undefined,
          search ? ilike(deals.name, search) : undefined,
          query.targetKind
            ? exists(
                this.handle.db
                  .select({ one: sql`1` })
                  .from(dealTargets)
                  .where(
                    and(
                      eq(dealTargets.dealId, deals.id),
                      eq(dealTargets.targetKind, query.targetKind),
                    ),
                  ),
              )
            : undefined,
          cursor ? afterCursor(deals.createdAt, deals.id, cursor, "uuid") : undefined,
        ),
      )
      .orderBy(desc(deals.createdAt), desc(deals.id))
      .limit(query.limit + 1);
  }

  find(id: string): Promise<Deal | undefined> {
    return this.handle.db.query.deals.findFirst({ where: eq(deals.id, id) });
  }

  async targetsOf(dealIds: string[]): Promise<DealTarget[]> {
    if (dealIds.length === 0) return [];
    return this.handle.db
      .select()
      .from(dealTargets)
      .where(inArray(dealTargets.dealId, dealIds))
      .orderBy(asc(dealTargets.createdAt), asc(dealTargets.id));
  }

  /** True when every referenced user, organization and referral code exists. */
  async targetsExist(inputs: readonly DealTargetInput[]): Promise<boolean> {
    const db = this.handle.db;
    const ids = (
      kind: DealTargetInput["kind"],
      pick: (t: DealTargetInput) => string | undefined,
    ) => [...new Set(inputs.filter((t) => t.kind === kind).flatMap((t) => pick(t) ?? []))];
    const userIds = ids("user", (t) => (t.kind === "user" ? t.userId : undefined));
    const orgIds = ids("organization", (t) => (t.kind === "organization" ? t.orgId : undefined));
    const codeIds = ids("referral_code", (t) =>
      t.kind === "referral_code" ? t.referralCodeId : undefined,
    );
    if (userIds.length > 0) {
      const rows = await db.select({ id: users.id }).from(users).where(inArray(users.id, userIds));
      if (rows.length !== userIds.length) return false;
    }
    if (orgIds.length > 0) {
      const rows = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(inArray(organizations.id, orgIds));
      if (rows.length !== orgIds.length) return false;
    }
    if (codeIds.length > 0) {
      const rows = await db
        .select({ id: referralCodes.id })
        .from(referralCodes)
        .where(inArray(referralCodes.id, codeIds));
      if (rows.length !== codeIds.length) return false;
    }
    return true;
  }

  async create(input: CreateDealInput, createdBy: string): Promise<Deal> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(deals)
        .values({
          name: input.name,
          status: input.status,
          startsAt: dateValue(input.startsAt),
          endsAt: dateValue(input.endsAt),
          terms: input.terms,
          notes: input.notes,
          createdBy,
        })
        .returning();
      if (!row) throw new Error("Deal was not stored");
      if (input.targets.length > 0) {
        await tx.insert(dealTargets).values(input.targets.map((t) => targetRow(row.id, t)));
      }
      return row;
    });
  }

  async update(
    id: string,
    values: UpdateDealInput,
  ): Promise<
    { kind: "updated"; before: Deal; after: Deal } | { kind: "not_found" } | { kind: "ended" }
  > {
    return this.handle.db.transaction(async (tx) => {
      const [before] = await tx.select().from(deals).where(eq(deals.id, id)).for("update");
      if (!before) return { kind: "not_found" as const };
      if (before.status === "ended") return { kind: "ended" as const };
      const { startsAt, endsAt, terms, ...rest } = values;
      const [after] = await tx
        .update(deals)
        .set({
          ...rest,
          ...(terms !== undefined ? { terms } : {}),
          ...(startsAt !== undefined ? { startsAt: dateValue(startsAt) } : {}),
          ...(endsAt !== undefined ? { endsAt: dateValue(endsAt) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(deals.id, id))
        .returning();
      if (!after) return { kind: "not_found" as const };
      return { kind: "updated" as const, before, after };
    });
  }

  /**
   * Moves the status when the current one is in `from`; activation also pays the welcome credits of
   * `user` targets, in the same transaction.
   */
  async transition(
    id: string,
    from: DealStatus[],
    to: DealStatus,
    now: Date,
  ): Promise<TransitionResult> {
    return this.handle.db.transaction(async (tx) => {
      const [before] = await tx.select().from(deals).where(eq(deals.id, id)).for("update");
      if (!before) return { kind: "not_found" as const };
      if (!from.includes(before.status)) return { kind: "conflict" as const };
      const [after] = await tx
        .update(deals)
        .set({ status: to, updatedAt: now })
        .where(eq(deals.id, id))
        .returning();
      if (!after) return { kind: "not_found" as const };
      if (to === "active") await grantUserTargetWelcome(tx, id, now);
      return { kind: "ok" as const, before, after };
    });
  }

  /** Adds a target; null when an identical one exists. A live deal pays welcome credits to a new user target. */
  async addTarget(dealId: string, input: DealTargetInput, now: Date): Promise<DealTarget | null> {
    return this.handle.db.transaction(async (tx) => {
      const row = targetRow(dealId, input);
      const same = await tx
        .select({ id: dealTargets.id })
        .from(dealTargets)
        .where(
          and(
            eq(dealTargets.dealId, dealId),
            eq(dealTargets.targetKind, input.kind),
            input.kind === "user" ? eq(dealTargets.targetUserId, input.userId) : undefined,
            input.kind === "organization" ? eq(dealTargets.targetOrgId, input.orgId) : undefined,
            input.kind === "referral_code"
              ? eq(dealTargets.referralCodeId, input.referralCodeId)
              : undefined,
            input.kind === "email_domain"
              ? eq(dealTargets.emailDomain, input.emailDomain)
              : undefined,
          ),
        );
      if (same.length > 0) return null;
      const [created] = await tx.insert(dealTargets).values(row).returning();
      if (!created) throw new Error("Deal target was not stored");
      if (input.kind === "user") await grantUserTargetWelcome(tx, dealId, now);
      return created;
    });
  }

  async removeTarget(dealId: string, targetId: string): Promise<DealTarget | undefined> {
    const [row] = await this.handle.db
      .delete(dealTargets)
      .where(and(eq(dealTargets.id, targetId), eq(dealTargets.dealId, dealId)))
      .returning();
    return row;
  }

  async usage(id: string) {
    const db = this.handle.db;
    const [orderTotals] = await db
      .select({ ordersCount: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.dealId, id));
    const revenue = await db
      .select({
        currency: orders.currency,
        total: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint`.mapWith(Number),
      })
      .from(orders)
      .where(and(eq(orders.dealId, id), inArray(orders.status, ["paid", "partially_refunded"])))
      .groupBy(orders.currency);
    const targets = await this.targetsOf([id]);
    const count = async (query: Promise<{ total: number }[]>) => (await query)[0]?.total ?? 0;
    let subject = 0;
    for (const target of targets) {
      if (target.targetKind === "user") subject += 1;
      else if (target.targetKind === "organization" && target.targetOrgId) {
        subject += await count(
          db
            .select({ total: sql<number>`count(*)::int` })
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.orgId, target.targetOrgId),
                eq(organizationMembers.status, "active"),
              ),
            ),
        );
      } else if (target.targetKind === "referral_code" && target.referralCodeId) {
        subject += await count(
          db
            .select({ total: sql<number>`count(*)::int` })
            .from(referrals)
            .where(eq(referrals.codeId, target.referralCodeId)),
        );
      } else if (target.targetKind === "email_domain" && target.emailDomain) {
        subject += await count(
          db
            .select({ total: sql<number>`count(*)::int` })
            .from(users)
            .where(
              and(
                eq(users.emailVerified, true),
                sql`lower(split_part(${users.email}::text, '@', 2)) = ${target.emailDomain}`,
              ),
            ),
        );
      }
    }
    return {
      membersSubject: subject,
      ordersCount: orderTotals?.ordersCount ?? 0,
      revenueMinor: Object.fromEntries(revenue.map((row) => [row.currency, row.total])),
    };
  }
}
