import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  accounts,
  onboardingProgress,
  organizationInvites,
  organizationMembers,
  organizations,
  roles,
  sessions,
  userProfiles,
  userRoles,
  users,
} from "../src/schema/index.js";

import { startTestDb, violatedConstraint, type TestDb } from "./db-fixture.js";

let fixture: TestDb;

beforeAll(async () => {
  fixture = await startTestDb();
}, 180_000);

afterAll(async () => {
  await fixture?.stop();
});

let counter = 0;
const nextEmail = () => `person${++counter}@example.com`;

async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await fixture.handle.db
    .insert(users)
    .values({ name: "Test", email: nextEmail(), ...overrides })
    .returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
}

/** Runs a statement that must be rejected and returns the name of the constraint that rejected it. */
async function rejection(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return violatedConstraint(error);
  }
  throw new Error("expected the database to reject the statement");
}

describe("users", () => {
  it("gets a UUIDv7 id, safe defaults and timestamps from the database", async () => {
    const user = await makeUser();
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(user).toMatchObject({
      emailVerified: false,
      phoneVerified: false,
      twoFactorEnabled: false,
      accountType: "individual",
      locale: "ar",
      status: "active",
      phone: null,
    });
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it("treats emails as case-insensitive", async () => {
    await makeUser({ email: "Mixed.Case@Example.com" });
    expect(await rejection(() => makeUser({ email: "mixed.case@example.COM" }))).toBe(
      "users_email_unique",
    );
  });

  it("allows one verified account per phone, but any number of unverified claims", async () => {
    const phone = "+201001234567";
    const verifiedAt = new Date();
    await makeUser({ phone });
    await makeUser({ phone });
    await makeUser({ phone, phoneVerified: true, phoneVerifiedAt: verifiedAt });
    expect(
      await rejection(() => makeUser({ phone, phoneVerified: true, phoneVerifiedAt: verifiedAt })),
    ).toBe("users_phone_verified_key");
  });

  it("rejects malformed phones, and a phone_verified flag that disagrees with phone_verified_at", async () => {
    expect(await rejection(() => makeUser({ phone: "01001234567" }))).toBe(
      "users_phone_format_check",
    );
    expect(await rejection(() => makeUser({ phone: "+0123456789" }))).toBe(
      "users_phone_format_check",
    );
    expect(await rejection(() => makeUser({ phone: "+201001234568", phoneVerified: true }))).toBe(
      "users_phone_verified_sync_check",
    );
    expect(
      await rejection(() => makeUser({ phoneVerified: true, phoneVerifiedAt: new Date() })),
    ).toBe("users_phone_verified_needs_phone_check");
  });

  it("rejects unknown enum values", async () => {
    expect(await rejection(() => makeUser({ status: "banned" as never }))).toBe(
      "users_status_check",
    );
    expect(await rejection(() => makeUser({ accountType: "company" as never }))).toBe(
      "users_account_type_check",
    );
    expect(await rejection(() => makeUser({ locale: "fr" as never }))).toBe("users_locale_check");
  });

  it("keeps status and deleted_at in step, and only deleted users can be anonymized", async () => {
    expect(await rejection(() => makeUser({ status: "deleted" }))).toBe("users_deleted_sync_check");
    expect(await rejection(() => makeUser({ deletedAt: new Date() }))).toBe(
      "users_deleted_sync_check",
    );
    expect(await rejection(() => makeUser({ anonymizedAt: new Date() }))).toBe(
      "users_anonymized_needs_deleted_check",
    );
    const gone = await makeUser({
      status: "deleted",
      deletedAt: new Date(),
      anonymizedAt: new Date(),
    });
    expect(gone.status).toBe("deleted");
  });
});

describe("auth tables", () => {
  it("cascades sessions, accounts, profile and onboarding when a user row is removed", async () => {
    const { db } = fixture.handle;
    const user = await makeUser();
    await db
      .insert(sessions)
      .values({ userId: user.id, token: `tok-${user.id}`, expiresAt: new Date(Date.now() + 1000) });
    await db
      .insert(accounts)
      .values({ userId: user.id, accountId: user.id, providerId: "credential" });
    await db
      .insert(userProfiles)
      .values({ userId: user.id, profession: "pharmacist", country: "EG" });
    await db.insert(onboardingProgress).values({ userId: user.id });

    await db.delete(users).where(eq(users.id, user.id));

    for (const table of [sessions, accounts, userProfiles, onboardingProgress]) {
      expect(await db.select().from(table).where(eq(table.userId, user.id))).toHaveLength(0);
    }
  });

  it("links one provider identity to one user only", async () => {
    const { db } = fixture.handle;
    const a = await makeUser();
    const b = await makeUser();
    await db
      .insert(accounts)
      .values({ userId: a.id, accountId: "google-sub-1", providerId: "google" });
    expect(
      await rejection(() =>
        db
          .insert(accounts)
          .values({ userId: b.id, accountId: "google-sub-1", providerId: "google" }),
      ),
    ).toBe("accounts_provider_account_key");
  });

  it("rejects a duplicate session token", async () => {
    const { db } = fixture.handle;
    const user = await makeUser();
    const expiresAt = new Date(Date.now() + 1000);
    await db.insert(sessions).values({ userId: user.id, token: "dup-token", expiresAt });
    expect(
      await rejection(() =>
        db.insert(sessions).values({ userId: user.id, token: "dup-token", expiresAt }),
      ),
    ).toBe("sessions_token_unique");
  });
});

describe("profiles and onboarding", () => {
  it("validates profession and country codes", async () => {
    const { db } = fixture.handle;
    const user = await makeUser();
    expect(
      await rejection(() =>
        db.insert(userProfiles).values({ userId: user.id, profession: "wizard" as never }),
      ),
    ).toBe("user_profiles_profession_check");
    expect(
      await rejection(() => db.insert(userProfiles).values({ userId: user.id, country: "egypt" })),
    ).toBe("user_profiles_country_check");
  });

  it("starts at account_type and only accepts known steps, with completion tied to the done step", async () => {
    const { db } = fixture.handle;
    const user = await makeUser();
    const [row] = await db.insert(onboardingProgress).values({ userId: user.id }).returning();
    expect(row).toMatchObject({
      currentStep: "account_type",
      completedSteps: [],
      data: {},
      completedAt: null,
    });

    expect(
      await rejection(() =>
        db
          .update(onboardingProgress)
          .set({ completedSteps: ["account_type", "nope"] })
          .where(eq(onboardingProgress.userId, user.id)),
      ),
    ).toBe("onboarding_progress_completed_steps_check");
    expect(
      await rejection(() =>
        db
          .update(onboardingProgress)
          .set({ completedAt: new Date() })
          .where(eq(onboardingProgress.userId, user.id)),
      ),
    ).toBe("onboarding_progress_done_sync_check");
    await db
      .update(onboardingProgress)
      .set({ currentStep: "done", completedAt: new Date() })
      .where(eq(onboardingProgress.userId, user.id));
  });
});

describe("organizations", () => {
  async function makeOrg(createdBy: string) {
    const [org] = await fixture.handle.db
      .insert(organizations)
      .values({
        name: "Al Noor Pharmacy",
        type: "pharmacy",
        country: "EG",
        city: "Cairo",
        createdBy,
      })
      .returning();
    if (!org) {
      throw new Error("insert returned no row");
    }
    return org;
  }

  it("validates type, country and name", async () => {
    const owner = await makeUser();
    const { db } = fixture.handle;
    expect(
      await rejection(() =>
        db
          .insert(organizations)
          .values({ name: "X", type: "bank" as never, country: "EG", createdBy: owner.id }),
      ),
    ).toBe("organizations_type_check");
    expect(
      await rejection(() =>
        db
          .insert(organizations)
          .values({ name: "X", type: "clinic", country: "eg", createdBy: owner.id }),
      ),
    ).toBe("organizations_country_check");
    expect(
      await rejection(() =>
        db
          .insert(organizations)
          .values({ name: "   ", type: "clinic", country: "EG", createdBy: owner.id }),
      ),
    ).toBe("organizations_name_check");
  });

  it("keeps one membership per (org, user) and lets the org cascade to members and invites", async () => {
    const { db } = fixture.handle;
    const owner = await makeUser();
    const member = await makeUser();
    const org = await makeOrg(owner.id);

    await db
      .insert(organizationMembers)
      .values({ orgId: org.id, userId: owner.id, role: "org_admin" });
    await db
      .insert(organizationMembers)
      .values({ orgId: org.id, userId: member.id, invitedBy: owner.id });
    expect(
      await rejection(() =>
        db.insert(organizationMembers).values({ orgId: org.id, userId: member.id }),
      ),
    ).toBe("organization_members_pkey");
    await db.insert(organizationInvites).values({
      orgId: org.id,
      email: "new@example.com",
      tokenHash: "hash-1",
      expiresAt: new Date(Date.now() + 1000),
    });

    await db.delete(organizations).where(eq(organizations.id, org.id));
    expect(
      await db.select().from(organizationMembers).where(eq(organizationMembers.orgId, org.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(organizationInvites).where(eq(organizationInvites.orgId, org.id)),
    ).toHaveLength(0);
  });

  it("will not delete a user who founded an organization", async () => {
    const owner = await makeUser();
    await makeOrg(owner.id);
    expect(
      await rejection(() => fixture.handle.db.delete(users).where(eq(users.id, owner.id))),
    ).toBe("organizations_created_by_users_id_fk");
  });

  it("requires exactly one invitee identifier, a well-formed phone and a unique token hash", async () => {
    const { db } = fixture.handle;
    const owner = await makeUser();
    const org = await makeOrg(owner.id);
    const base = { orgId: org.id, expiresAt: new Date(Date.now() + 1000) };

    expect(
      await rejection(() =>
        db.insert(organizationInvites).values({ ...base, tokenHash: "h-none" }),
      ),
    ).toBe("organization_invites_one_target_check");
    expect(
      await rejection(() =>
        db
          .insert(organizationInvites)
          .values({ ...base, tokenHash: "h-both", email: "a@example.com", phone: "+201001234567" }),
      ),
    ).toBe("organization_invites_one_target_check");
    expect(
      await rejection(() =>
        db.insert(organizationInvites).values({ ...base, tokenHash: "h-bad-phone", phone: "0100" }),
      ),
    ).toBe("organization_invites_phone_format_check");

    await db
      .insert(organizationInvites)
      .values({ ...base, tokenHash: "h-ok", phone: "+201001234567" });
    expect(
      await rejection(() =>
        db
          .insert(organizationInvites)
          .values({ ...base, tokenHash: "h-ok", email: "b@example.com" }),
      ),
    ).toBe("organization_invites_token_hash_key");
  });
});

describe("roles", () => {
  it("refuses to delete a role that is still granted, and cascades a user's grants away with the user", async () => {
    const { db } = fixture.handle;
    await db
      .insert(roles)
      .values({ key: "temp_role", nameAr: "مؤقت", nameEn: "Temp", isSystem: false });
    const user = await makeUser();
    await db.insert(userRoles).values({ userId: user.id, roleKey: "temp_role" });

    expect(await rejection(() => db.delete(roles).where(eq(roles.key, "temp_role")))).toBe(
      "user_roles_role_key_roles_key_fk",
    );
    expect(
      await rejection(() => db.insert(userRoles).values({ userId: user.id, roleKey: "temp_role" })),
    ).toBe("user_roles_pkey");

    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(userRoles).where(eq(userRoles.userId, user.id))).toHaveLength(0);
    await db.delete(roles).where(eq(roles.key, "temp_role"));
  });

  it("rejects malformed role keys", async () => {
    const { db } = fixture.handle;
    expect(
      await rejection(() => db.insert(roles).values({ key: "Bad Key", nameAr: "x", nameEn: "x" })),
    ).toBe("roles_key_check");
  });
});
