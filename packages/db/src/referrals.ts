import { generateCouponCode } from "@wasfa/shared/coupon-codes";
import {
  REFERRAL_CODE_LENGTH,
  REFERRAL_CODE_PATTERN,
  isReservedReferralCode,
  type ReferralSource,
} from "@wasfa/shared/rewards";
import { and, eq, sql } from "drizzle-orm";

import { recordGrowthEvent, serverSessionId } from "./growth.js";
import { enqueueOutbox } from "./outbox.js";
import { isUniqueViolation } from "./pg-errors.js";
import {
  referralCodes,
  referralPrograms,
  referrals,
  type Referral,
  type ReferralCode,
} from "./schema/index.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";

/*
 * Referral codes and attribution (REFERRALS-REWARDS §2). Plain functions over a database handle so
 * the Better Auth user-creation hook, the API and the worker share them. First touch wins: the
 * referred user is fixed at registration (`referrals.referee_user_id` is unique).
 */

type Handle = Database | Transaction;

export type ReferralErrorReason =
  | "program_missing"
  | "vanity_used"
  | "reserved_code"
  | "code_taken"
  | "invalid_code";

export class ReferralError extends Error {
  constructor(readonly reason: ReferralErrorReason) {
    super(`Referral refused: ${reason}`);
    this.name = "ReferralError";
  }
}

const CODE_ATTEMPTS = 8;
const USER_CODE_CONSTRAINT = "referral_codes_code_key";

/** Upper-cases and validates a code typed or read from a cookie; null when it cannot be a code. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

async function standardProgramId(db: Handle): Promise<string | null> {
  const [row] = await db
    .select({ id: referralPrograms.id })
    .from(referralPrograms)
    .where(eq(referralPrograms.key, "standard"));
  return row?.id ?? null;
}

async function userCode(db: Handle, userId: string): Promise<ReferralCode | undefined> {
  const [row] = await db
    .select()
    .from(referralCodes)
    .where(and(eq(referralCodes.ownerUserId, userId), eq(referralCodes.kind, "user")));
  return row;
}

/**
 * The user's personal code, created on first call (at sign-up, and lazily by `GET /me/referral`).
 * Safe under races: the insert does nothing when the user already has one, and a code collision
 * is retried with a fresh random code.
 */
export async function ensureReferralCode(db: Handle, userId: string): Promise<ReferralCode> {
  const existing = await userCode(db, userId);
  if (existing) return existing;
  const programId = await standardProgramId(db);
  if (programId === null) throw new ReferralError("program_missing");
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const [created] = await db
      .insert(referralCodes)
      .values({
        code: generateCouponCode(REFERRAL_CODE_LENGTH),
        kind: "user",
        programId,
        ownerUserId: userId,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    // Either the user's code appeared meanwhile, or the random code was taken.
    const raced = await userCode(db, userId);
    if (raced) return raced;
  }
  throw new Error("Referral code could not be generated");
}

/**
 * The one-time vanity edit. `vanity_used` on a second edit, `reserved_code` for brand or abusive
 * words, `code_taken` when another code already uses it. Editing to the current code changes nothing.
 */
export async function renameReferralCode(
  db: Database,
  userId: string,
  rawCode: string,
): Promise<ReferralCode> {
  const code = normalizeReferralCode(rawCode);
  if (code === null) throw new ReferralError("invalid_code");
  if (isReservedReferralCode(code)) throw new ReferralError("reserved_code");
  await ensureReferralCode(db, userId);
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(referralCodes)
        .where(and(eq(referralCodes.ownerUserId, userId), eq(referralCodes.kind, "user")))
        .for("update");
      if (!current) throw new Error("Referral code disappeared");
      if (current.vanityEdited) throw new ReferralError("vanity_used");
      if (current.code === code) return current;
      const [updated] = await tx
        .update(referralCodes)
        .set({ code, vanityEdited: true, updatedAt: sql`now()` })
        .where(eq(referralCodes.id, current.id))
        .returning();
      if (!updated) throw new Error("Referral code was not updated");
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error, USER_CODE_CONSTRAINT)) throw new ReferralError("code_taken");
    throw error;
  }
}

/** An active code of an active program, or undefined. */
export async function findActiveCode(
  db: Handle,
  rawCode: string | null | undefined,
): Promise<ReferralCode | undefined> {
  const code = normalizeReferralCode(rawCode);
  if (code === null) return undefined;
  const [row] = await db
    .select({ code: referralCodes })
    .from(referralCodes)
    .innerJoin(referralPrograms, eq(referralPrograms.id, referralCodes.programId))
    .where(
      and(
        eq(referralCodes.code, code),
        eq(referralCodes.active, true),
        eq(referralPrograms.active, true),
      ),
    );
  return row?.code;
}

export interface AttributionInput {
  refereeUserId: string;
  /** Raw code from the form or the cookie. */
  code: string | null | undefined;
  source: Extract<ReferralSource, "code" | "link">;
}

/**
 * Records who invited a new user. First touch wins (a second attempt changes nothing), an unknown
 * or inactive code is ignored, and a code owner cannot refer themselves. Returns the referral, or
 * null when nothing was recorded.
 */
export async function attributeReferral(
  db: Handle,
  input: AttributionInput,
): Promise<Referral | null> {
  const code = await findActiveCode(db, input.code);
  if (!code) return null;
  if (code.ownerUserId === input.refereeUserId) return null;
  const [created] = await db
    .insert(referrals)
    .values({
      refereeUserId: input.refereeUserId,
      referrerUserId: code.ownerUserId,
      referrerOrgId: code.ownerOrgId,
      codeId: code.id,
      programId: code.programId,
      source: input.source,
    })
    .onConflictDoNothing({ target: referrals.refereeUserId })
    .returning();
  if (created) {
    await recordGrowthEvent(db, {
      name: "referral_signup",
      sessionId: serverSessionId(input.refereeUserId, created.id),
      userId: input.refereeUserId,
      props: { source: input.source },
    });
  }
  return created ?? null;
}

export type SignupCheckTrigger = "email" | "phone" | "usage";

/**
 * Asks the worker to look at a referred user again (email or phone verified, first analysis done).
 * Only users that have a referral get an outbox row, and one per trigger, ever.
 */
export async function requestSignupCheck(
  db: Handle,
  userId: string,
  trigger: SignupCheckTrigger,
): Promise<boolean> {
  const [referral] = await db
    .select({ id: referrals.id })
    .from(referrals)
    .where(eq(referrals.refereeUserId, userId));
  if (!referral) return false;
  await enqueueOutbox(
    db,
    "rewards.signup_check",
    { userId },
    `signup_check:${userId}:${trigger}`,
  );
  return true;
}
