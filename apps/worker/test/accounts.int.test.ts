import {
  accounts,
  auditLogs,
  createDb,
  onboardingProgress,
  organizationInvites,
  organizationMembers,
  organizations,
  roles,
  sessions,
  twoFactors,
  userProfiles,
  userRoles,
  users,
  verifications,
} from "@wasfa/db";
import { ANONYMIZED_EMAIL_DOMAIN, ANONYMIZED_USER_NAME } from "@wasfa/shared/identity";
import { and, eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anonymizeDueJob, purgeExpiredJob } from "../src/jobs/accounts.job.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

/*
 * Seeds as the table owner, runs the jobs as the restricted `wasfa_api` role the worker uses in
 * production (it must never need UPDATE/DELETE on audit_logs).
 */

const lines: string[] = [];
const logger = pino(
  { level: "info" },
  {
    write: (line: string) => {
      lines.push(line);
    },
  },
);

let postgres: TestPostgres;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 2 });
  await owner.db.insert(roles).values({ key: "support", nameAr: "دعم", nameEn: "Support" });
});

afterAll(async () => {
  await Promise.all([owner?.close(), worker?.close()]);
  await postgres?.stop();
});

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const daysAhead = (days: number) => new Date(Date.now() + days * DAY);

let counter = 0;
const unique = () => String(++counter).padStart(4, "0");
const phoneNumber = () => `+20100${unique().padStart(7, "0")}`;

interface SeedUser {
  email?: string;
  phone?: string;
  phoneVerified?: boolean;
  emailVerified?: boolean;
  status?: "active" | "suspended" | "deleted";
  deletedAt?: Date;
  createdAt?: Date;
}

async function createUser(options: SeedUser = {}): Promise<{ id: string; email: string }> {
  const email = options.email ?? `user${unique()}@example.com`;
  const [row] = await owner.db
    .insert(users)
    .values({
      name: "Real Name",
      email,
      emailVerified: options.emailVerified ?? false,
      image: "https://example.com/me.png",
      phone: options.phone ?? null,
      phoneVerified: options.phoneVerified ?? false,
      phoneVerifiedAt: options.phoneVerified ? new Date() : null,
      status: options.status ?? "active",
      deletedAt: options.deletedAt ?? null,
      suspendedReason: "spam",
      twoFactorEnabled: true,
      createdAt: options.createdAt ?? new Date(),
    })
    .returning({ id: users.id });
  if (row === undefined) throw new Error("seed failed");
  return { id: row.id, email };
}

/** A deletion request whose 14 days are over. */
const dueDeleted = (extra: SeedUser = {}) =>
  createUser({ status: "deleted", deletedAt: daysAgo(15), createdAt: daysAgo(40), ...extra });

const run = () => anonymizeDueJob({ source: "manual" }, { db: worker.db, logger });

const userRow = async (id: string) => {
  const [row] = await owner.db.select().from(users).where(eq(users.id, id));
  if (row === undefined) throw new Error("user disappeared");
  return row;
};

const auditFor = (id: string) =>
  owner.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.targetType, "user"), eq(auditLogs.targetId, id)));

describe("account.anonymize_due: deletion requests", () => {
  it("anonymizes a due account and removes everything personal that belongs to it", async () => {
    const phone = phoneNumber();
    const user = await dueDeleted({ phone, phoneVerified: true });
    const other = await createUser({ emailVerified: true });
    await owner.db.insert(accounts).values({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: "hash",
    });
    await owner.db.insert(sessions).values({
      userId: user.id,
      token: `tok-${unique()}`,
      expiresAt: daysAhead(1),
      ipAddress: "203.0.113.9",
      userAgent: "agent",
    });
    await owner.db
      .insert(twoFactors)
      .values({ userId: user.id, secret: "secret", backupCodes: "codes" });
    await owner.db.insert(userProfiles).values({ userId: user.id, displayName: "Real Name" });
    await owner.db.insert(onboardingProgress).values({ userId: user.id });
    await owner.db.insert(userRoles).values({ userId: user.id, roleKey: "support" });
    // Better Auth's own shapes: reset token (value = user id), phone OTP, and a keyed-by-email row.
    const sibling = await owner.db
      .insert(verifications)
      .values({
        identifier: `reset-password:${unique()}`,
        value: other.id,
        expiresAt: daysAhead(1),
      })
      .returning({ id: verifications.id });
    await owner.db.insert(verifications).values([
      { identifier: `reset-password:${unique()}`, value: user.id, expiresAt: daysAhead(1) },
      { identifier: `delete-account-${unique()}`, value: user.id, expiresAt: daysAhead(1) },
      { identifier: phone, value: "123456:0", expiresAt: daysAhead(1) },
      {
        identifier: `${phone}-request-password-reset`,
        value: "123456:0",
        expiresAt: daysAhead(1),
      },
      { identifier: user.email, value: "x", expiresAt: daysAhead(1) },
    ]);

    await run();

    const row = await userRow(user.id);
    expect(row).toMatchObject({
      status: "deleted",
      email: `deleted-${user.id}@${ANONYMIZED_EMAIL_DOMAIN}`,
      name: ANONYMIZED_USER_NAME,
      image: null,
      phone: null,
      phoneVerified: false,
      phoneVerifiedAt: null,
      suspendedReason: null,
      emailVerified: false,
      twoFactorEnabled: false,
    });
    expect(row.anonymizedAt).toBeInstanceOf(Date);
    expect(row.deletedAt).toBeInstanceOf(Date);

    for (const table of [accounts, sessions, twoFactors]) {
      expect(await owner.db.select().from(table).where(eq(table.userId, user.id))).toEqual([]);
    }
    expect(
      await owner.db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)),
    ).toEqual([]);
    expect(
      await owner.db
        .select()
        .from(onboardingProgress)
        .where(eq(onboardingProgress.userId, user.id)),
    ).toEqual([]);
    expect(await owner.db.select().from(userRoles).where(eq(userRoles.userId, user.id))).toEqual(
      [],
    );
    // Every verification tied to the account is gone; someone else's is not.
    const remaining = await owner.db.select({ id: verifications.id }).from(verifications);
    expect(remaining.map((v) => v.id)).toContain(sibling[0]?.id);
    expect(
      (await owner.db.select().from(verifications)).filter(
        (v) =>
          v.value === user.id ||
          v.identifier === user.email ||
          v.identifier === phone ||
          v.identifier === `${phone}-request-password-reset`,
      ),
    ).toEqual([]);
  });

  it("leaves a deletion request alone until its grace period is over", async () => {
    const user = await createUser({
      status: "deleted",
      deletedAt: daysAgo(13),
      createdAt: daysAgo(40),
      phone: phoneNumber(),
    });
    await run();
    const row = await userRow(user.id);
    expect(row.anonymizedAt).toBeNull();
    expect(row.email).toBe(user.email);
    expect(row.name).toBe("Real Name");
    expect(await auditFor(user.id)).toEqual([]);
  });

  it("is idempotent: a second run changes nothing and writes no second audit row", async () => {
    const user = await dueDeleted();
    await run();
    const first = await userRow(user.id);
    await run();
    const second = await userRow(user.id);
    expect(second.anonymizedAt?.getTime()).toBe(first.anonymizedAt?.getTime());
    expect(second.updatedAt.getTime()).toBe(first.updatedAt.getTime());
    expect(await auditFor(user.id)).toHaveLength(1);
  });

  it("writes an audit row with the reason and no personal data", async () => {
    const phone = phoneNumber();
    const user = await dueDeleted({ phone, phoneVerified: true });
    await run();
    const [audit, ...rest] = await auditFor(user.id);
    expect(rest).toEqual([]);
    expect(audit).toMatchObject({
      actorId: null,
      action: "user.anonymize",
      targetType: "user",
      targetId: user.id,
      before: null,
      after: { reason: "deletion_request" },
      ip: null,
      userAgent: null,
    });
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(user.email);
    expect(serialized).not.toContain(phone);
    expect(serialized).not.toContain("Real Name");
  });

  it("frees the phone number for another account", async () => {
    const phone = phoneNumber();
    const user = await dueDeleted({ phone, phoneVerified: true });
    await run();
    // The partial unique index on verified phones would reject this if the number were still held.
    const newcomer = await createUser({ phone, phoneVerified: true });
    expect((await userRow(newcomer.id)).phone).toBe(phone);
    expect((await userRow(user.id)).phone).toBeNull();
  });

  it("removes pending invitations to the old email or phone, keeps others", async () => {
    const phone = phoneNumber();
    const user = await dueDeleted({ phone });
    const founder = await createUser({ emailVerified: true });
    const [org] = await owner.db
      .insert(organizations)
      .values({ name: "Pharmacy", type: "pharmacy", country: "EG", createdBy: founder.id })
      .returning({ id: organizations.id });
    if (org === undefined) throw new Error("seed failed");
    await owner.db
      .insert(organizationMembers)
      .values({ orgId: org.id, userId: founder.id, role: "org_admin" });
    const invite = (target: { email?: string; phone?: string }, suffix: string) => ({
      orgId: org.id,
      ...target,
      tokenHash: `hash-${unique()}-${suffix}`,
      expiresAt: daysAhead(5),
    });
    await owner.db
      .insert(organizationInvites)
      .values([
        invite({ email: user.email }, "email"),
        invite({ phone }, "phone"),
        invite({ email: "someone.else@example.com" }, "other"),
      ]);

    await run();

    const left = await owner.db
      .select()
      .from(organizationInvites)
      .where(eq(organizationInvites.orgId, org.id));
    expect(left.map((invite) => invite.email)).toEqual(["someone.else@example.com"]);
  });

  it("deletes organizations left without members and keeps the ones others still belong to", async () => {
    const user = await dueDeleted();
    const colleague = await createUser({ emailVerified: true });
    const insertOrg = async (name: string) => {
      const [org] = await owner.db
        .insert(organizations)
        .values({ name, type: "clinic", country: "EG", createdBy: user.id })
        .returning({ id: organizations.id });
      if (org === undefined) throw new Error("seed failed");
      return org.id;
    };
    const orphan = await insertOrg("Orphan");
    const shared = await insertOrg("Shared");
    await owner.db.insert(organizationMembers).values([
      { orgId: orphan, userId: user.id, role: "org_admin" },
      { orgId: shared, userId: user.id, role: "org_admin" },
      { orgId: shared, userId: colleague.id },
    ]);
    // An invite of the orphan organization goes with it.
    await owner.db.insert(organizationInvites).values({
      orgId: orphan,
      email: "invitee@example.com",
      tokenHash: `hash-${unique()}`,
      expiresAt: daysAhead(5),
    });

    await run();

    const orgs = await owner.db.select({ id: organizations.id }).from(organizations);
    const ids = orgs.map((org) => org.id);
    expect(ids).not.toContain(orphan);
    expect(ids).toContain(shared);
    expect(
      await owner.db
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.orgId, shared)),
    ).toMatchObject([{ userId: colleague.id }]);
    expect(
      await owner.db
        .select()
        .from(organizationInvites)
        .where(eq(organizationInvites.orgId, orphan)),
    ).toEqual([]);
  });
});

describe("account.anonymize_due: never-verified accounts", () => {
  it("anonymizes an unverified account older than 7 days, with its own audit reason", async () => {
    const user = await createUser({ createdAt: daysAgo(8) });
    await run();
    const row = await userRow(user.id);
    expect(row).toMatchObject({
      status: "deleted",
      email: `deleted-${user.id}@${ANONYMIZED_EMAIL_DOMAIN}`,
      name: ANONYMIZED_USER_NAME,
    });
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row.anonymizedAt).toBeInstanceOf(Date);
    const [audit] = await auditFor(user.id);
    expect(audit?.after).toEqual({ reason: "never_verified" });
  });

  it("leaves recent unverified, email-verified and phone-verified accounts alone", async () => {
    const recent = await createUser({ createdAt: daysAgo(6) });
    const emailVerified = await createUser({ createdAt: daysAgo(60), emailVerified: true });
    const phoneVerified = await createUser({
      createdAt: daysAgo(60),
      phone: phoneNumber(),
      phoneVerified: true,
    });
    const suspended = await createUser({ createdAt: daysAgo(60), status: "suspended" });
    await run();
    for (const user of [recent, emailVerified, phoneVerified, suspended]) {
      const row = await userRow(user.id);
      expect(row.anonymizedAt).toBeNull();
      expect(row.email).toBe(user.email);
      expect(await auditFor(user.id)).toEqual([]);
    }
  });
});

describe("account.anonymize_due: logging", () => {
  it("logs counts only, no ids, emails or phones", async () => {
    const phone = phoneNumber();
    const user = await dueDeleted({ phone, phoneVerified: true });
    lines.length = 0;
    await run();
    const output = lines.join("");
    expect(output).toContain("Account anonymization run finished");
    expect(output).toContain('"deletionRequests":1');
    expect(output).not.toContain(user.id);
    expect(output).not.toContain(user.email);
    expect(output).not.toContain(phone);
  });
});

describe("auth.purge_expired", () => {
  it("deletes only expired sessions and verifications", async () => {
    const user = await createUser({ emailVerified: true });
    const token = unique();
    await owner.db.insert(sessions).values([
      { userId: user.id, token: `old-${token}`, expiresAt: daysAgo(1) },
      { userId: user.id, token: `live-${token}`, expiresAt: daysAhead(1) },
    ]);
    await owner.db.insert(verifications).values([
      { identifier: `old-${token}`, value: "x", expiresAt: daysAgo(1) },
      { identifier: `live-${token}`, value: "x", expiresAt: daysAhead(1) },
    ]);

    lines.length = 0;
    await purgeExpiredJob({ source: "manual" }, { db: worker.db, logger });

    const sessionTokens = (await owner.db.select({ token: sessions.token }).from(sessions)).map(
      (row) => row.token,
    );
    expect(sessionTokens).toContain(`live-${token}`);
    expect(sessionTokens).not.toContain(`old-${token}`);
    const identifiers = (
      await owner.db.select({ identifier: verifications.identifier }).from(verifications)
    ).map((row) => row.identifier);
    expect(identifiers).toContain(`live-${token}`);
    expect(identifiers).not.toContain(`old-${token}`);

    const output = lines.join("");
    expect(output).toContain("Expired sessions and verifications purged");
    expect(output).not.toContain(token);
  });
});
