import { Inject, Injectable } from "@nestjs/common";
import {
  creditLedger,
  creditReservations,
  creditWallets,
  organizationMemberLimits,
  organizationMembers,
  users,
} from "@wasfa/db";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

/** Start of the UTC month containing `at`, and of the next one: the window every monthly cap and report uses. */
export function monthWindow(at: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
    end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)),
  };
}

export interface MemberUsageRow {
  userId: string;
  name: string;
  email: string;
  role: "org_admin" | "org_member";
  creditsUsed: number;
  calls: number;
}

/**
 * Reads behind organization wallets: balance, member caps and per-member usage. Usage is what the
 * member's settled calls took from the ORGANIZATION wallet (`credit_ledger.actor_id` = the member);
 * the reserve/settle transactions themselves live in `@wasfa/db`.
 */
@Injectable()
export class OrgWalletRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The organization wallet's balance; an organization that never used credits has 0. */
  async balance(orgId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ balance: creditWallets.balance })
      .from(creditWallets)
      .where(eq(creditWallets.ownerOrgId, orgId));
    return row?.balance ?? 0;
  }

  /** Org wallet balances of several organizations, by organization id. */
  async balances(orgIds: readonly string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const orgId of orgIds) result.set(orgId, await this.balance(orgId));
    return result;
  }

  async memberCap(orgId: string, userId: string): Promise<number | null> {
    const [row] = await this.handle.db
      .select({ cap: organizationMemberLimits.monthlyCreditCap })
      .from(organizationMemberLimits)
      .where(
        and(eq(organizationMemberLimits.orgId, orgId), eq(organizationMemberLimits.userId, userId)),
      );
    return row?.cap ?? null;
  }

  /** The cap check's definition of "used": settled debits this month plus the member's open holds. */
  async memberUsed(orgId: string, userId: string, since: Date): Promise<number> {
    const [wallet] = await this.handle.db
      .select({ id: creditWallets.id })
      .from(creditWallets)
      .where(eq(creditWallets.ownerOrgId, orgId));
    if (!wallet) return 0;
    const [settled] = await this.handle.db
      .select({ total: sql<number>`coalesce(sum(-${creditLedger.amount}), 0)::int` })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.walletId, wallet.id),
          eq(creditLedger.kind, "usage_settle"),
          eq(creditLedger.actorId, userId),
          gte(creditLedger.createdAt, since),
        ),
      );
    const [held] = await this.handle.db
      .select({ total: sql<number>`coalesce(sum(${creditReservations.amount}), 0)::int` })
      .from(creditReservations)
      .where(
        and(
          eq(creditReservations.walletId, wallet.id),
          eq(creditReservations.memberUserId, userId),
          eq(creditReservations.status, "open"),
        ),
      );
    return (settled?.total ?? 0) + (held?.total ?? 0);
  }

  /** Active members with their cap and what they used in `[start, end)`. Members who used nothing are included. */
  async membersWithUsage(
    orgId: string,
    window: { start: Date; end: Date },
  ): Promise<(MemberUsageRow & { monthlyCap: number | null })[]> {
    const members = await this.handle.db
      .select({
        userId: organizationMembers.userId,
        name: users.name,
        email: users.email,
        role: organizationMembers.role,
        monthlyCap: organizationMemberLimits.monthlyCreditCap,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .leftJoin(
        organizationMemberLimits,
        and(
          eq(organizationMemberLimits.orgId, organizationMembers.orgId),
          eq(organizationMemberLimits.userId, organizationMembers.userId),
        ),
      )
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.status, "active")))
      .orderBy(asc(organizationMembers.joinedAt), asc(organizationMembers.userId));

    const usage = await this.handle.db
      .select({
        userId: creditLedger.actorId,
        used: sql<number>`coalesce(sum(-${creditLedger.amount}), 0)::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(creditLedger)
      .innerJoin(creditWallets, eq(creditWallets.id, creditLedger.walletId))
      .where(
        and(
          eq(creditWallets.ownerOrgId, orgId),
          eq(creditLedger.kind, "usage_settle"),
          gte(creditLedger.createdAt, window.start),
          lt(creditLedger.createdAt, window.end),
        ),
      )
      .groupBy(creditLedger.actorId);
    const byUser = new Map(usage.map((row) => [row.userId, row]));
    return members.map((member) => ({
      ...member,
      creditsUsed: byUser.get(member.userId)?.used ?? 0,
      calls: byUser.get(member.userId)?.calls ?? 0,
    }));
  }
}
