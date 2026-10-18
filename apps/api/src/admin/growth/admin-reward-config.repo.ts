import { Inject, Injectable } from "@nestjs/common";
import {
  effectiveRules,
  ensureReferralCode,
  isUniqueViolation,
  orders,
  referralCodes,
  referralPrograms,
  referralTiers,
  referrals,
  rewardRules,
  rewardsSettingsOf,
  users,
  type EffectiveRule,
  type ReferralProgram,
  type ReferralTier,
  type RewardRule,
  type RewardsSettings,
  deals,
} from "@wasfa/db";
import { REFERRAL_TIER_WINDOW_MONTHS } from "@wasfa/shared/rewards";
import { ruleShapeIssues } from "@wasfa/shared/schemas/admin-growth";
import { dealTermsSchema } from "@wasfa/shared/schemas/deals";
import { addMonthsClamped } from "@wasfa/shared/subscriptions";
import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";


import { DB, type DbHandle } from "../../common/database.js";

import type {
  CreateProgramInput,
  CreateRuleInput,
  CreateTierInput,
  UpdateProgramInput,
  UpdateRuleInput,
  UpdateTierInput,
} from "@wasfa/shared/schemas/admin-growth";

const PROGRAM_KEY_CONSTRAINT = "referral_programs_key_key";
const TIER_UNIQUE = ["referral_tiers_program_key_key", "referral_tiers_program_min_key"];

const dateValue = (value: string | null | undefined) =>
  value === undefined || value === null ? value : new Date(value);

/** A write body without its `reason`, which the service keeps for the audit row. */
export type RuleValues<T extends { reason: string }> = Omit<T, "reason">;

export interface ProgramCounts {
  activeRules: number;
  tiers: number;
  codes: number;
  referrals: number;
}

export type MoveMemberResult =
  | { kind: "ok"; codesMoved: number; referralsMoved: number; before: string[] }
  | { kind: "program_missing" }
  | { kind: "user_missing" };

export type TierWrite =
  | { kind: "ok"; before: ReferralTier | null; after: ReferralTier | null }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid" };

export interface TierShape {
  minPaidReferrals: number;
  bonusBps: number;
  active: boolean;
}
export type TierCheck = (tiers: readonly TierShape[]) => boolean;
type Tx = Parameters<Parameters<DbHandle["db"]["transaction"]>[0]>[0];

@Injectable()
export class AdminRewardConfigRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The validated reward terms of a deal, or null (no such deal, or no rewards in it). */
  async dealRewards(dealId: string) {
    const [row] = await this.handle.db.select({ terms: deals.terms }).from(deals).where(eq(deals.id, dealId));
    const parsed = dealTermsSchema.safeParse(row?.terms);
    return parsed.success ? (parsed.data.rewards ?? null) : null;
  }

  rewardsSettings(): Promise<RewardsSettings> {
    return rewardsSettingsOf(this.handle.db);
  }

  /** The rule per (event, beneficiary) the engine would pick for the program right now (no deals). */
  effectiveRulesOf(programId: string, now: Date): Promise<EffectiveRule[]> {
    return effectiveRules(this.handle.db, programId, now);
  }

  // --- Programs ---------------------------------------------------------------------------------

  findProgram(id: string): Promise<ReferralProgram | undefined> {
    return this.handle.db.query.referralPrograms.findFirst({ where: eq(referralPrograms.id, id) });
  }

  programs(): Promise<ReferralProgram[]> {
    return this.handle.db
      .select()
      .from(referralPrograms)
      .orderBy(asc(referralPrograms.createdAt), asc(referralPrograms.id));
  }

  async programCounts(ids: string[]): Promise<Map<string, ProgramCounts>> {
    const out = new Map<string, ProgramCounts>(
      ids.map((id) => [id, { activeRules: 0, tiers: 0, codes: 0, referrals: 0 }]),
    );
    if (ids.length === 0) return out;
    const db = this.handle.db;
    const [rules, tiers, codes, refs] = await Promise.all([
      db
        .select({ id: rewardRules.programId, total: count() })
        .from(rewardRules)
        .where(and(inArray(rewardRules.programId, ids), eq(rewardRules.active, true)))
        .groupBy(rewardRules.programId),
      db
        .select({ id: referralTiers.programId, total: count() })
        .from(referralTiers)
        .where(inArray(referralTiers.programId, ids))
        .groupBy(referralTiers.programId),
      db
        .select({ id: referralCodes.programId, total: count() })
        .from(referralCodes)
        .where(inArray(referralCodes.programId, ids))
        .groupBy(referralCodes.programId),
      db
        .select({ id: referrals.programId, total: count() })
        .from(referrals)
        .where(inArray(referrals.programId, ids))
        .groupBy(referrals.programId),
    ]);
    for (const [rows, field] of [
      [rules, "activeRules"],
      [tiers, "tiers"],
      [codes, "codes"],
      [refs, "referrals"],
    ] as const) {
      for (const row of rows) {
        const entry = out.get(row.id);
        if (entry) entry[field] = row.total;
      }
    }
    return out;
  }

  /** Null when the key is taken. */
  async createProgram(input: CreateProgramInput): Promise<ReferralProgram | null> {
    try {
      const [row] = await this.handle.db.insert(referralPrograms).values(input).returning();
      if (!row) throw new Error("Program was not stored");
      return row;
    } catch (error) {
      if (isUniqueViolation(error, PROGRAM_KEY_CONSTRAINT)) return null;
      throw error;
    }
  }

  async updateProgram(
    id: string,
    values: RuleValues<UpdateProgramInput>,
  ): Promise<{ before: ReferralProgram; after: ReferralProgram } | null> {
    return this.handle.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(referralPrograms)
        .where(eq(referralPrograms.id, id))
        .for("update");
      if (!before) return null;
      const [after] = await tx
        .update(referralPrograms)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(referralPrograms.id, id))
        .returning();
      return after ? { before, after } : null;
    });
  }

  /**
   * A user's program lives on their referral codes (`referral_codes.program_id`: what new sign-ups
   * are attributed to) and is copied onto each referral at attribution (`referrals.program_id`: what
   * the rules are read from). Moving a user changes both for everything still live; blocked and void
   * referrals stay as they were.
   */
  async moveMember(userId: string, programId: string): Promise<MoveMemberResult> {
    return this.handle.db.transaction(async (tx) => {
      const [program] = await tx
        .select({ id: referralPrograms.id })
        .from(referralPrograms)
        .where(eq(referralPrograms.id, programId));
      if (!program) return { kind: "program_missing" as const };
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!user) return { kind: "user_missing" as const };
      await ensureReferralCode(tx, userId);
      const codes = await tx
        .select({ id: referralCodes.id, programId: referralCodes.programId })
        .from(referralCodes)
        .where(
          and(
            eq(referralCodes.ownerUserId, userId),
            inArray(referralCodes.kind, ["user", "partner"]),
          ),
        )
        .for("update");
      const before = [...new Set(codes.map((row) => row.programId))];
      const movedCodes = await tx
        .update(referralCodes)
        .set({ programId, updatedAt: new Date() })
        .where(
          and(
            inArray(
              referralCodes.id,
              codes.map((row) => row.id),
            ),
            ne(referralCodes.programId, programId),
          ),
        )
        .returning({ id: referralCodes.id });
      const movedReferrals = await tx
        .update(referrals)
        .set({ programId, updatedAt: new Date() })
        .where(
          and(
            eq(referrals.referrerUserId, userId),
            ne(referrals.programId, programId),
            inArray(referrals.status, ["pending", "qualified", "rewarded", "held"]),
          ),
        )
        .returning({ id: referrals.id });
      return {
        kind: "ok" as const,
        codesMoved: movedCodes.length,
        referralsMoved: movedReferrals.length,
        before,
      };
    });
  }

  // --- Rules ------------------------------------------------------------------------------------

  rulesOf(programId: string): Promise<RewardRule[]> {
    return this.handle.db
      .select()
      .from(rewardRules)
      .where(eq(rewardRules.programId, programId))
      .orderBy(
        asc(rewardRules.event),
        asc(rewardRules.beneficiary),
        desc(rewardRules.priority),
        desc(rewardRules.createdAt),
        desc(rewardRules.id),
      );
  }

  findRule(id: string): Promise<RewardRule | undefined> {
    return this.handle.db.query.rewardRules.findFirst({ where: eq(rewardRules.id, id) });
  }

  async createRule(programId: string, input: RuleValues<CreateRuleInput>): Promise<RewardRule> {
    const { validFrom, validTo, ...values } = input;
    const [row] = await this.handle.db
      .insert(rewardRules)
      .values({
        ...values,
        programId,
        validFrom: dateValue(validFrom) ?? null,
        validTo: dateValue(validTo) ?? null,
      })
      .returning();
    if (!row) throw new Error("Rule was not stored");
    return row;
  }

  /** The merged rule is validated on the locked row, so two edits cannot validate against a stale copy. */
  async updateRule(
    id: string,
    input: RuleValues<UpdateRuleInput>,
  ): Promise<
    | { kind: "ok"; before: RewardRule; after: RewardRule }
    | { kind: "not_found" }
    | { kind: "invalid" }
  > {
    return this.handle.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(rewardRules)
        .where(eq(rewardRules.id, id))
        .for("update");
      if (!before) return { kind: "not_found" as const };
      const { validFrom, validTo, ...values } = input;
      const patch = {
        ...values,
        ...(validFrom !== undefined ? { validFrom: dateValue(validFrom) ?? null } : {}),
        ...(validTo !== undefined ? { validTo: dateValue(validTo) ?? null } : {}),
      };
      const shape = {
        rewardKind: values.rewardKind ?? before.rewardKind,
        value: values.value ?? before.value,
        validFrom: validFrom !== undefined ? validFrom : (before.validFrom?.toISOString() ?? null),
        validTo: validTo !== undefined ? validTo : (before.validTo?.toISOString() ?? null),
      };
      if (ruleShapeIssues(shape).length > 0) return { kind: "invalid" as const };
      const [after] = await tx
        .update(rewardRules)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(rewardRules.id, id))
        .returning();
      return after ? { kind: "ok" as const, before, after } : { kind: "not_found" as const };
    });
  }

  // --- Tiers ------------------------------------------------------------------------------------

  tiersOf(programId: string): Promise<ReferralTier[]> {
    return this.handle.db
      .select()
      .from(referralTiers)
      .where(eq(referralTiers.programId, programId))
      .orderBy(asc(referralTiers.minPaidReferrals), asc(referralTiers.id));
  }

  findTier(id: string): Promise<ReferralTier | undefined> {
    return this.handle.db.query.referralTiers.findFirst({ where: eq(referralTiers.id, id) });
  }

  /**
   * Tier writes run under a lock on the program row, so the check (thresholds unique, bonus never
   * lower for a higher threshold) and the write see the same set. `valid` gets the active tiers as
   * they would be after the write; false answers `invalid` and nothing is written.
   */
  async createTier(
    programId: string,
    values: RuleValues<CreateTierInput>,
    valid: TierCheck,
  ): Promise<TierWrite> {
    return this.writeTiers(programId, async (tx, tiers) => {
      if (!valid([...tiers, values])) return { kind: "invalid" as const };
      const [row] = await tx
        .insert(referralTiers)
        .values({ ...values, programId })
        .returning();
      return { kind: "ok" as const, before: null, after: row ?? null };
    });
  }

  async updateTier(
    id: string,
    values: RuleValues<UpdateTierInput>,
    valid: TierCheck,
  ): Promise<TierWrite> {
    const found = await this.findTier(id);
    if (!found) return { kind: "not_found" };
    return this.writeTiers(found.programId, async (tx, tiers) => {
      const before = tiers.find((tier) => tier.id === id);
      if (!before) return { kind: "not_found" as const };
      const candidate = {
        minPaidReferrals: values.minPaidReferrals ?? before.minPaidReferrals,
        bonusBps: values.bonusBps ?? before.bonusBps,
        active: values.active ?? before.active,
      };
      if (!valid(tiers.map((tier) => (tier.id === id ? candidate : tier)))) {
        return { kind: "invalid" as const };
      }
      const [after] = await tx
        .update(referralTiers)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(referralTiers.id, id))
        .returning();
      return { kind: "ok" as const, before, after: after ?? null };
    });
  }

  async deleteTier(id: string): Promise<TierWrite> {
    const found = await this.findTier(id);
    if (!found) return { kind: "not_found" };
    return this.writeTiers(found.programId, async (tx) => {
      const [before] = await tx.delete(referralTiers).where(eq(referralTiers.id, id)).returning();
      return before ? { kind: "ok" as const, before, after: null } : { kind: "not_found" as const };
    });
  }

  private async writeTiers(
    programId: string,
    work: (tx: Tx, tiers: ReferralTier[]) => Promise<TierWrite>,
  ): Promise<TierWrite> {
    try {
      return await this.handle.db.transaction(async (tx) => {
        await tx
          .select({ id: referralPrograms.id })
          .from(referralPrograms)
          .where(eq(referralPrograms.id, programId))
          .for("update");
        const tiers = await tx
          .select()
          .from(referralTiers)
          .where(eq(referralTiers.programId, programId))
          .orderBy(asc(referralTiers.minPaidReferrals));
        return work(tx, tiers);
      });
    } catch (error) {
      if (TIER_UNIQUE.some((name) => isUniqueViolation(error, name))) return { kind: "conflict" };
      throw error;
    }
  }

  /**
   * Referrers per tier: for each referrer with a referral in the program, their paid referrals of
   * the last 12 months (the engine's `tierProgress` window) decide the band `[min, next min)`.
   */
  async memberCounts(programId: string, tiers: readonly ReferralTier[], now: Date) {
    const since = addMonthsClamped(now, -REFERRAL_TIER_WINDOW_MONTHS);
    const rows = await this.handle.db
      .select({
        referrer: referrals.referrerUserId,
        paid: sql<number>`count(distinct ${referrals.id}) filter (where exists (
          select 1 from ${orders}
          where ${orders.ownerUserId} = ${referrals.refereeUserId}
            and ${orders.status} in ('paid', 'partially_refunded')
            and ${orders.paidAt} >= ${since.toISOString()}::timestamptz
        ))::int`,
      })
      .from(referrals)
      .where(and(eq(referrals.programId, programId), isNotNull(referrals.referrerUserId)))
      .groupBy(referrals.referrerUserId);
    const active = tiers.filter((tier) => tier.active);
    const counts = new Map<string, number>(tiers.map((tier) => [tier.id, 0]));
    for (const { paid } of rows) {
      const tier = active.filter((candidate) => candidate.minPaidReferrals <= paid).at(-1);
      if (tier) counts.set(tier.id, (counts.get(tier.id) ?? 0) + 1);
    }
    return counts;
  }
}
