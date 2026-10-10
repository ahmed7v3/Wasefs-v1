import {
  accounts,
  auditLogs,
  onboardingProgress,
  organizationInvites,
  organizationMembers,
  organizations,
  sessions,
  twoFactors,
  userProfiles,
  userRoles,
  users,
  verifications,
  type Database,
} from "@wasfa/db";
import { ANONYMIZED_EMAIL_DOMAIN, ANONYMIZED_USER_NAME } from "@wasfa/shared/identity";
import {
  ACCOUNT_DELETION_GRACE_DAYS,
  UNVERIFIED_ACCOUNT_TTL_DAYS,
} from "@wasfa/shared/schemas/user";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import type { SQL } from "drizzle-orm";

/*
 * All SQL of the account maintenance jobs (DATABASE.md §5, SECURITY.md §11). The worker connects
 * as the restricted role: audit_logs is only ever INSERTed into here.
 */

export type AnonymizeReason = "deletion_request" | "never_verified";

const DAY_MS = 86_400_000;

/** Who is due, right now, for the given reason. Also re-checked under the row lock before anonymizing. */
function dueCondition(reason: AnonymizeReason, now: Date): SQL {
  if (reason === "deletion_request") {
    const cutoff = new Date(now.getTime() - ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
    return and(
      eq(users.status, "deleted"),
      isNull(users.anonymizedAt),
      isNotNull(users.deletedAt),
      lte(users.deletedAt, cutoff),
    ) as SQL;
  }
  const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_DAYS * DAY_MS);
  return and(
    eq(users.status, "active"),
    eq(users.emailVerified, false),
    isNull(users.phoneVerifiedAt),
    lte(users.createdAt, cutoff),
  ) as SQL;
}

/** Oldest first. `exclude` keeps one failing account from being picked again within the same run. */
export async function findDueUserIds(
  db: Database,
  reason: AnonymizeReason,
  now: Date,
  limit: number,
  exclude: readonly string[] = [],
): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      exclude.length > 0
        ? and(dueCondition(reason, now), notInArray(users.id, [...exclude]))
        : dueCondition(reason, now),
    )
    .orderBy(users.createdAt)
    .limit(limit);
  return rows.map((row) => row.id);
}

/**
 * Anonymizes one account in its own transaction. Returns false when there was nothing to do: the
 * account is already anonymized, or stopped being due since it was listed (support restored it,
 * the person verified), which the row lock makes safe to decide.
 */
export async function anonymizeUser(
  db: Database,
  userId: string,
  reason: AnonymizeReason,
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ email: users.email, phone: users.phone, deletedAt: users.deletedAt })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.anonymizedAt), dueCondition(reason, now)))
      .for("update");
    if (user === undefined) return false;

    await tx
      .update(users)
      .set({
        status: "deleted",
        deletedAt: user.deletedAt ?? now,
        email: `deleted-${userId}@${ANONYMIZED_EMAIL_DOMAIN}`,
        name: ANONYMIZED_USER_NAME,
        image: null,
        phone: null,
        phoneVerified: false,
        phoneVerifiedAt: null,
        suspendedReason: null,
        emailVerified: false,
        twoFactorEnabled: false,
        anonymizedAt: now,
        updatedAt: now,
      })
      .where(and(eq(users.id, userId), isNull(users.anonymizedAt)));

    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(twoFactors).where(eq(twoFactors.userId, userId));
    await tx.delete(userProfiles).where(eq(userProfiles.userId, userId));
    await tx.delete(onboardingProgress).where(eq(onboardingProgress.userId, userId));
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));

    // Better Auth keys its short-lived rows three ways: the user id as `value` (password-reset and
    // delete-account tokens), the phone number as `identifier` (WhatsApp/OTP codes, with a
    // "-request-password-reset" variant) and, for other flows, the email. Email verification itself
    // is a stateless signed link and leaves no row.
    const identifiers = [user.email];
    if (user.phone !== null) identifiers.push(user.phone, `${user.phone}-request-password-reset`);
    await tx
      .delete(verifications)
      .where(or(eq(verifications.value, userId), inArray(verifications.identifier, identifiers)));

    // Invitations addressed to this person, pending or accepted, hold their email or phone: none may
    // outlive the anonymization (membership history is in audit_logs, by id).
    await tx
      .delete(organizationInvites)
      .where(
        or(
          eq(organizationInvites.email, user.email),
          user.phone === null ? undefined : eq(organizationInvites.phone, user.phone),
        ),
      );

    const left = await tx
      .delete(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .returning({ orgId: organizationMembers.orgId });
    if (left.length > 0) {
      // An organization nobody belongs to any more has no owner of its data: remove it (its
      // invites go with it by cascade).
      await tx.delete(organizations).where(
        and(
          inArray(
            organizations.id,
            left.map((row) => row.orgId),
          ),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(organizationMembers)
              .where(eq(organizationMembers.orgId, organizations.id)),
          ),
        ),
      );
    }

    // Ids and the reason only: the audit trail must stay free of personal data.
    await tx.insert(auditLogs).values({
      actorId: null,
      action: "user.anonymize",
      targetType: "user",
      targetId: userId,
      after: { reason },
    });
    return true;
  });
}

export interface PurgeCounts {
  sessions: number;
  verifications: number;
}

/** Deletes expired sessions (they hold IPs) and expired verification rows (they hold token identifiers). */
export async function purgeExpired(db: Database, now: Date): Promise<PurgeCounts> {
  // Count inside Postgres: a long backlog must not be pulled into memory just to be counted.
  const [expiredSessions] = await db.execute<{ n: number }>(
    sql`with deleted as (delete from sessions where expires_at < ${now.toISOString()}::timestamptz returning 1)
        select count(*)::int as n from deleted`,
  );
  const [expiredVerifications] = await db.execute<{ n: number }>(
    sql`with deleted as (delete from verifications where expires_at < ${now.toISOString()}::timestamptz returning 1)
        select count(*)::int as n from deleted`,
  );
  return { sessions: expiredSessions?.n ?? 0, verifications: expiredVerifications?.n ?? 0 };
}
