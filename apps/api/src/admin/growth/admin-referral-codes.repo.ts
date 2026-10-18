import { Inject, Injectable } from "@nestjs/common";
import {
  dealTargets,
  isUniqueViolation,
  organizations,
  referralCodes,
  referralPrograms,
  users,
  type ReferralCode,
} from "@wasfa/db";
import { generateCouponCode } from "@wasfa/shared/coupon-codes";
import { REFERRAL_CODE_LENGTH, type ReferralCodeKind } from "@wasfa/shared/rewards";
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, escapeLike, stamp, type Cursor } from "../common/keyset.js";

import type { CodeListQuery } from "@wasfa/shared/schemas/admin-growth";

const CODE_CONSTRAINT = "referral_codes_code_key";
const GENERATE_ATTEMPTS = 8;

export type AdminCodeKind = Exclude<ReferralCodeKind, "user">;

export type CreateCodeRow =
  | { kind: "ok"; row: ReferralCode }
  | { kind: "code_taken" }
  | { kind: "owner_missing" }
  | { kind: "program_missing" };

@Injectable()
export class AdminReferralCodesRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  page(query: CodeListQuery, cursor?: Cursor) {
    const search = query.q ? `${escapeLike(query.q.toUpperCase())}%` : undefined;
    return this.handle.db
      .select({
        code: referralCodes,
        programKey: referralPrograms.key,
        ownerName: users.name,
        orgName: organizations.name,
        referrals: sql<number>`(select count(*)::int from referrals r where r.code_id = referral_codes.id)`,
        cursorAt: stamp(referralCodes.createdAt),
      })
      .from(referralCodes)
      .innerJoin(referralPrograms, eq(referralPrograms.id, referralCodes.programId))
      .leftJoin(users, eq(users.id, referralCodes.ownerUserId))
      .leftJoin(organizations, eq(organizations.id, referralCodes.ownerOrgId))
      .where(
        and(
          query.kind ? eq(referralCodes.kind, query.kind) : undefined,
          search ? ilike(referralCodes.code, search) : undefined,
          cursor
            ? afterCursor(referralCodes.createdAt, referralCodes.id, cursor, "uuid")
            : undefined,
        ),
      )
      .orderBy(desc(referralCodes.createdAt), desc(referralCodes.id))
      .limit(query.limit + 1);
  }

  async find(id: string) {
    const [row] = await this.handle.db
      .select({
        code: referralCodes,
        programKey: referralPrograms.key,
        ownerName: users.name,
        orgName: organizations.name,
        referrals: sql<number>`(select count(*)::int from referrals r where r.code_id = referral_codes.id)`,
      })
      .from(referralCodes)
      .innerJoin(referralPrograms, eq(referralPrograms.id, referralCodes.programId))
      .leftJoin(users, eq(users.id, referralCodes.ownerUserId))
      .leftJoin(organizations, eq(organizations.id, referralCodes.ownerOrgId))
      .where(eq(referralCodes.id, id));
    return row;
  }

  /** Deal ids attached to each code through `referral_code` targets. */
  async dealIdsOf(codeIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (codeIds.length === 0) return out;
    const rows = await this.handle.db
      .select({ codeId: dealTargets.referralCodeId, dealId: dealTargets.dealId })
      .from(dealTargets)
      .where(
        and(
          eq(dealTargets.targetKind, "referral_code"),
          inArray(dealTargets.referralCodeId, codeIds),
        ),
      )
      .orderBy(asc(dealTargets.createdAt), asc(dealTargets.id));
    for (const row of rows) {
      if (!row.codeId) continue;
      out.set(row.codeId, [...(out.get(row.codeId) ?? []), row.dealId]);
    }
    return out;
  }

  /** The program a new code of this kind joins when none is chosen: the first of its kind, else `standard`. */
  async defaultProgramId(kind: AdminCodeKind): Promise<string | null> {
    const wanted = kind === "campaign" ? "standard" : kind;
    const [byKind] = await this.handle.db
      .select({ id: referralPrograms.id })
      .from(referralPrograms)
      .where(and(eq(referralPrograms.kind, wanted), eq(referralPrograms.active, true)))
      .orderBy(asc(referralPrograms.createdAt), asc(referralPrograms.id))
      .limit(1);
    if (byKind) return byKind.id;
    const [standard] = await this.handle.db
      .select({ id: referralPrograms.id })
      .from(referralPrograms)
      .where(eq(referralPrograms.key, "standard"));
    return standard?.id ?? null;
  }

  async create(input: {
    kind: AdminCodeKind;
    code: string | undefined;
    programId: string;
    ownerUserId: string | undefined;
    orgId: string | undefined;
    createdBy: string;
  }): Promise<CreateCodeRow> {
    const db = this.handle.db;
    const [program] = await db
      .select({ id: referralPrograms.id })
      .from(referralPrograms)
      .where(eq(referralPrograms.id, input.programId));
    if (!program) return { kind: "program_missing" };
    if (input.ownerUserId) {
      const [owner] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.ownerUserId));
      if (!owner) return { kind: "owner_missing" };
    }
    if (input.orgId) {
      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, input.orgId));
      if (!org) return { kind: "owner_missing" };
    }
    // A given code is tried once; a generated one is retried with a fresh random code on a collision.
    for (let attempt = 0; attempt < (input.code ? 1 : GENERATE_ATTEMPTS); attempt++) {
      try {
        const [row] = await db
          .insert(referralCodes)
          .values({
            code: input.code ?? generateCouponCode(REFERRAL_CODE_LENGTH),
            kind: input.kind,
            programId: input.programId,
            ownerUserId: input.ownerUserId ?? null,
            ownerOrgId: input.orgId ?? null,
            createdBy: input.createdBy,
          })
          .returning();
        if (!row) throw new Error("Referral code was not stored");
        return { kind: "ok", row };
      } catch (error) {
        if (!isUniqueViolation(error, CODE_CONSTRAINT)) throw error;
      }
    }
    return { kind: "code_taken" };
  }

  /** Sets `active`; returns the row before and after, or null for an unknown id. */
  async setActive(id: string, active: boolean) {
    return this.handle.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(referralCodes)
        .where(eq(referralCodes.id, id))
        .for("update");
      if (!before) return null;
      const [after] = await tx
        .update(referralCodes)
        .set({ active, updatedAt: new Date() })
        .where(eq(referralCodes.id, id))
        .returning();
      return after ? { before, after } : null;
    });
  }
}
