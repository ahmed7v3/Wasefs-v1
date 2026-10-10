import { randomUUID } from "node:crypto";

import {
  createDb,
  onboardingProgress,
  seedDefaults,
  sessions,
  userProfiles,
  users,
} from "@wasfa/db";
import {
  deleteMeResponseSchema,
  meResponseSchema,
  revokeSessionsResponseSchema,
  sessionListResponseSchema,
  ACCOUNT_DELETION_GRACE_DAYS,
} from "@wasfa/shared/schemas/user";
import { eq, sql } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TURNSTILE_VERIFY_URL } from "../src/auth/turnstile.js";
import { createApp } from "../src/bootstrap.js";

import {
  AuthHarness,
  PASSWORD,
  pwnedHandlers,
  testApiEnv,
  type Jar,
} from "./support/auth-harness.js";
import { auditRows, expectRateLimited, insertOrg } from "./support/identity-fixtures.js";
import { startInfra, type TestInfra } from "./support/infra.js";
import { wrongOwnerIsHidden } from "./support/wrong-owner.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

const network = setupServer(
  ...pwnedHandlers(),
  http.post(TURNSTILE_VERIFY_URL, () => HttpResponse.json({ success: true })),
);

let infra: TestInfra;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;
const harness = new AuthHarness(
  () => app,
  () => owner.db,
);

beforeAll(async () => {
  infra = await startInfra();
  network.listen({ onUnhandledRequest: "error" });
  owner = createDb({ url: infra.databaseUrl, max: 2 });
  await seedDefaults(owner.db);
  app = await createApp(testApiEnv(infra, { TURNSTILE_SECRET_KEY: "test-secret" }), {
    extraImports: [harness.mailerModule()],
    authMailer: false,
  });
}, 180_000);

afterAll(async () => {
  network.close();
  await app?.close();
  await owner?.close();
  await infra?.stop();
});

const get = (url: string, jar: Jar) => harness.call("GET", url, { jar });

async function signInAgain(email: string): Promise<Jar> {
  const jar: Jar = new Map();
  const res = await harness.call("POST", "/auth/sign-in/email", {
    body: { email, password: PASSWORD },
    jar,
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.body}`);
  return jar;
}

async function currentSessionId(jar: Jar): Promise<string> {
  const list = sessionListResponseSchema.parse((await get("/me/sessions", jar)).json());
  const current = list.items.find((item) => item.current);
  if (!current) throw new Error("no current session");
  return current.id;
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await owner.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  return rows.length;
}

async function finishOnboarding(userId: string): Promise<void> {
  await owner.db
    .insert(onboardingProgress)
    .values({ userId, currentStep: "done", completedAt: new Date() })
    .onConflictDoNothing();
}

describe("GET /me", () => {
  it("returns the account, parsed by the shared schema", async () => {
    const user = await harness.signedInUser();
    const res = await get("/me", user.jar);
    expect(res.statusCode).toBe(200);
    const me = meResponseSchema.parse(res.json());
    expect(me).toMatchObject({
      id: user.userId,
      name: "Test User",
      email: user.email,
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      accountType: "individual",
      twoFactorEnabled: false,
      roles: [],
      permissions: [],
      profile: { displayName: null, profession: null, usageIntent: [], country: null, city: null },
      onboarding: { currentStep: "account_type", done: false },
      organizations: [],
      canUseTools: false,
    });
    // No secret or internal column leaks into the body.
    expect(Object.keys(res.json<object>()).sort()).toEqual(
      Object.keys(meResponseSchema.shape).sort(),
    );
  });

  it("is unauthenticated -> 401", async () => {
    const res = await get("/me", new Map());
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("hides the placeholder email of a phone-only account", async () => {
    const user = await harness.signedInUser();
    await owner.db
      .update(users)
      .set({ email: `${randomUUID()}@phone.wasfa.invalid` })
      .where(eq(users.id, user.userId));
    expect(meResponseSchema.parse((await get("/me", user.jar)).json()).email).toBeNull();
  });

  it("shows the profile and the caller's organizations, never someone else's", async () => {
    const user = await harness.signedInUser();
    const other = await harness.signedInUser();
    await owner.db.insert(userProfiles).values({
      userId: user.userId,
      displayName: "Dr. Test",
      profession: "pharmacist",
      usageIntent: ["study", "drug_information"],
      country: "EG",
      city: "Cairo",
    });
    const orgId = await insertOrg(owner.db, {
      createdBy: user.userId,
      members: [{ userId: user.userId, role: "org_admin" }],
      name: "My Pharmacy",
    });
    await insertOrg(owner.db, {
      createdBy: other.userId,
      members: [{ userId: other.userId, role: "org_admin" }],
    });

    const me = meResponseSchema.parse((await get("/me", user.jar)).json());
    expect(me.profile).toEqual({
      displayName: "Dr. Test",
      profession: "pharmacist",
      usageIntent: ["study", "drug_information"],
      country: "EG",
      city: "Cairo",
    });
    expect(me.organizations).toEqual([
      { id: orgId, name: "My Pharmacy", type: "pharmacy", role: "org_admin" },
    ]);
  });

  it("canUseTools needs a verified email or phone AND finished onboarding", async () => {
    const user = await harness.signedInUser();
    const canUse = async () => meResponseSchema.parse((await get("/me", user.jar)).json());

    expect((await canUse()).canUseTools).toBe(false); // verified, onboarding not done

    await finishOnboarding(user.userId);
    const done = await canUse();
    expect(done).toMatchObject({
      canUseTools: true,
      onboarding: { currentStep: "done", done: true },
    });

    // Onboarding done but nothing verified.
    await owner.db.update(users).set({ emailVerified: false }).where(eq(users.id, user.userId));
    expect((await canUse()).canUseTools).toBe(false);

    // A verified phone is enough on its own.
    await owner.db
      .update(users)
      .set({
        phone: `+2010${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
      })
      .where(eq(users.id, user.userId));
    expect((await canUse()).canUseTools).toBe(true);
  });

  it("is rate limited to 120 a minute", async () => {
    const user = await harness.signedInUser();
    await expectRateLimited(harness, { method: "GET", url: "/me", max: 120, jar: user.jar });
  });
});

describe("PATCH /me", () => {
  const patch = (jar: Jar, body: Record<string, unknown>) =>
    harness.call("PATCH", "/me", { jar, body });

  it("updates name and locale and returns the same body as GET /me", async () => {
    const user = await harness.signedInUser();
    const res = await patch(user.jar, { name: "  Amal Hassan  ", locale: "en" });
    expect(res.statusCode).toBe(200);
    const me = meResponseSchema.parse(res.json());
    expect(me).toMatchObject({ name: "Amal Hassan", locale: "en" });
    expect((await get("/me", user.jar)).json()).toEqual(res.json());
    const [row] = await owner.db.select().from(users).where(eq(users.id, user.userId));
    expect(row).toMatchObject({ name: "Amal Hassan", locale: "en" });
  });

  it("updates one field without touching the other", async () => {
    const user = await harness.signedInUser();
    await patch(user.jar, { locale: "en" });
    const res = await patch(user.jar, { name: "Only Name" });
    expect(meResponseSchema.parse(res.json())).toMatchObject({ name: "Only Name", locale: "en" });
  });

  it("is unauthenticated -> 401", async () => {
    expect((await patch(new Map(), { name: "x" })).statusCode).toBe(401);
  });

  it("rejects invalid input with VALIDATION_FAILED", async () => {
    const user = await harness.signedInUser();
    for (const body of [
      {},
      { name: "" },
      { name: "   " },
      { name: "x".repeat(101) },
      { locale: "xx" },
    ]) {
      const res = await patch(user.jar, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("cannot change email, phone, status or account type through it", async () => {
    const user = await harness.signedInUser();
    const res = await patch(user.jar, {
      name: "Still Me",
      email: "evil@example.com",
      status: "suspended",
      accountType: "organization",
      phoneVerified: true,
      emailVerified: false,
    });
    expect(res.statusCode).toBe(200);
    const [row] = await owner.db.select().from(users).where(eq(users.id, user.userId));
    expect(row).toMatchObject({
      email: user.email,
      status: "active",
      accountType: "individual",
      phoneVerified: false,
      emailVerified: true,
    });
  });

  it("is rate limited to 20 a minute", async () => {
    const user = await harness.signedInUser();
    await expectRateLimited(harness, {
      method: "PATCH",
      url: "/me",
      max: 20,
      jar: user.jar,
      body: { name: "Rate Limit" },
    });
  });
});

describe("GET /me/sessions", () => {
  it("lists the caller's live sessions, newest first, and marks the current one", async () => {
    const user = await harness.signedInUser();
    const second = await signInAgain(user.email);
    // Make the order unambiguous: the first session was used longest ago.
    const firstId = await currentSessionId(user.jar);
    await owner.db
      .update(sessions)
      .set({ updatedAt: new Date(Date.now() - 3_600_000) })
      .where(eq(sessions.id, firstId));

    const res = await get("/me/sessions", second);
    expect(res.statusCode).toBe(200);
    const list = sessionListResponseSchema.parse(res.json());
    expect(list.items).toHaveLength(2);
    expect(list.items.map((item) => item.current)).toEqual([true, false]);
    expect(list.items[1]?.id).toBe(firstId);
    const times = list.items.map((item) => Date.parse(item.lastSeenAt));
    expect(times[0]).toBeGreaterThan(times[1] ?? Infinity);
    // The cookie token is never part of the list.
    for (const item of res.json<{ items: object[] }>().items) {
      expect(Object.keys(item).sort()).toEqual(
        ["createdAt", "current", "expiresAt", "id", "ipAddress", "lastSeenAt", "userAgent"].sort(),
      );
    }
  });

  it("leaves out expired sessions and other people's sessions", async () => {
    const user = await harness.signedInUser();
    const stranger = await harness.signedInUser();
    const expired = await signInAgain(user.email);
    const expiredId = await currentSessionId(expired);
    await owner.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.id, expiredId));

    const list = sessionListResponseSchema.parse((await get("/me/sessions", user.jar)).json());
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.id).not.toBe(expiredId);
    expect(list.items[0]?.id).not.toBe(await currentSessionId(stranger.jar));
  });

  it("is unauthenticated -> 401", async () => {
    expect((await get("/me/sessions", new Map())).statusCode).toBe(401);
  });

  it("is rate limited to 30 a minute", async () => {
    const user = await harness.signedInUser();
    await expectRateLimited(harness, {
      method: "GET",
      url: "/me/sessions",
      max: 30,
      jar: user.jar,
    });
  });
});

describe("DELETE /me/sessions/:id", () => {
  it("revokes another session of the caller and hides it from other users", async () => {
    const user = await harness.signedInUser();
    const intruder = await harness.signedInUser();
    const other = await signInAgain(user.email);
    const otherId = await currentSessionId(other);

    await wrongOwnerIsHidden({
      owner: () => harness.call("DELETE", `/me/sessions/${otherId}`, { jar: user.jar }),
      intruder: () => harness.call("DELETE", `/me/sessions/${otherId}`, { jar: intruder.jar }),
      stillThere: async () => {
        const rows = await owner.db
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, otherId));
        return rows.length === 1;
      },
    });

    expect((await get("/me", other)).statusCode).toBe(401);
    expect((await get("/me", user.jar)).statusCode).toBe(200);

    const [audit] = await auditRows(owner.db, "session.revoke", user.userId);
    expect(audit).toMatchObject({ targetType: "session", targetId: otherId });
  });

  it("answers 204 with no body", async () => {
    const user = await harness.signedInUser();
    const other = await signInAgain(user.email);
    const res = await harness.call("DELETE", `/me/sessions/${await currentSessionId(other)}`, {
      jar: user.jar,
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("refuses to revoke the current session (that is sign-out)", async () => {
    const user = await harness.signedInUser();
    const id = await currentSessionId(user.jar);
    const res = await harness.call("DELETE", `/me/sessions/${id}`, { jar: user.jar });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "CONFLICT", details: { reason: "current_session" } });
    expect((await get("/me", user.jar)).statusCode).toBe(200);
    expect(await auditRows(owner.db, "session.revoke", user.userId)).toHaveLength(0);
  });

  it("answers 404 for a session that does not exist", async () => {
    const user = await harness.signedInUser();
    const res = await harness.call("DELETE", `/me/sessions/${randomUUID()}`, { jar: user.jar });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an id that is not a uuid", async () => {
    const user = await harness.signedInUser();
    const res = await harness.call("DELETE", "/me/sessions/not-a-uuid", { jar: user.jar });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("is unauthenticated -> 401", async () => {
    const res = await harness.call("DELETE", `/me/sessions/${randomUUID()}`);
    expect(res.statusCode).toBe(401);
  });

  it("is rate limited to 20 a minute", async () => {
    const user = await harness.signedInUser();
    await expectRateLimited(harness, {
      method: "DELETE",
      url: `/me/sessions/${randomUUID()}`,
      max: 20,
      jar: user.jar,
    });
  });
});

describe("DELETE /me/sessions", () => {
  it("keeps the current session, ends the others and nobody else's, and is audited", async () => {
    const user = await harness.signedInUser();
    const second = await signInAgain(user.email);
    const third = await signInAgain(user.email);
    const stranger = await harness.signedInUser();

    const res = await harness.call("DELETE", "/me/sessions", { jar: user.jar });
    expect(res.statusCode).toBe(200);
    expect(revokeSessionsResponseSchema.parse(res.json())).toEqual({ revoked: 2 });

    expect((await get("/me", user.jar)).statusCode).toBe(200);
    expect((await get("/me", second)).statusCode).toBe(401);
    expect((await get("/me", third)).statusCode).toBe(401);
    expect((await get("/me", stranger.jar)).statusCode).toBe(200);
    expect(await sessionCount(user.userId)).toBe(1);

    const [audit] = await auditRows(owner.db, "session.revoke_all", user.userId);
    expect(audit).toMatchObject({
      targetType: "user",
      targetId: user.userId,
      after: { revoked: 2 },
    });
  });

  it("revokes nothing when this is the only session", async () => {
    const user = await harness.signedInUser();
    const res = await harness.call("DELETE", "/me/sessions", { jar: user.jar });
    expect(revokeSessionsResponseSchema.parse(res.json())).toEqual({ revoked: 0 });
  });

  it("is unauthenticated -> 401", async () => {
    expect((await harness.call("DELETE", "/me/sessions")).statusCode).toBe(401);
  });

  it("is rate limited to 10 a minute", async () => {
    const user = await harness.signedInUser();
    await expectRateLimited(harness, {
      method: "DELETE",
      url: "/me/sessions",
      max: 10,
      jar: user.jar,
    });
  });
});

describe("DELETE /me", () => {
  const staleSession = (userId: string) =>
    owner.db
      .update(sessions)
      .set({ reauthAt: sql`now() - interval '10 minutes'` })
      .where(eq(sessions.userId, userId));

  it("is unauthenticated -> 401", async () => {
    const res = await harness.call("DELETE", "/me");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("asks a stale session to re-authenticate and changes nothing", async () => {
    const user = await harness.signedInUser();
    await staleSession(user.userId);
    const res = await harness.call("DELETE", "/me", { jar: user.jar });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "AUTH_REQUIRED", details: { reason: "reauth" } });
    const [row] = await owner.db.select().from(users).where(eq(users.id, user.userId));
    expect(row).toMatchObject({ status: "active", deletedAt: null });
    expect(await auditRows(owner.db, "user.delete_request", user.userId)).toHaveLength(0);
  });

  it("works after re-authentication: marks the account, ends every session, audits", async () => {
    const user = await harness.signedInUser();
    const second = await signInAgain(user.email);
    await staleSession(user.userId);
    const reauth = await harness.call("POST", "/auth/reauth", {
      jar: user.jar,
      body: { password: PASSWORD },
    });
    expect(reauth.statusCode).toBe(200);

    const res = await harness.call("DELETE", "/me", { jar: user.jar });
    expect(res.statusCode).toBe(200);
    const { anonymizeAfter } = deleteMeResponseSchema.parse(res.json());

    const [row] = await owner.db.select().from(users).where(eq(users.id, user.userId));
    expect(row).toMatchObject({ status: "deleted", anonymizedAt: null });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    const expected = (row?.deletedAt?.getTime() ?? 0) + ACCOUNT_DELETION_GRACE_DAYS * 86_400_000;
    expect(Date.parse(anonymizeAfter)).toBe(expected);

    expect(await sessionCount(user.userId)).toBe(0);
    expect((await get("/me", user.jar)).statusCode).toBe(401);
    expect((await get("/me", second)).statusCode).toBe(401);

    const [audit] = await auditRows(owner.db, "user.delete_request", user.userId);
    expect(audit).toMatchObject({ targetType: "user", targetId: user.userId });
  });

  it("works right after sign-in (the session is fresh)", async () => {
    const user = await harness.signedInUser();
    expect((await harness.call("DELETE", "/me", { jar: user.jar })).statusCode).toBe(200);
  });

  it("refuses while the caller is the only org_admin of an organization with other members", async () => {
    const user = await harness.signedInUser();
    const member = await harness.signedInUser();
    const orgId = await insertOrg(owner.db, {
      createdBy: user.userId,
      members: [
        { userId: user.userId, role: "org_admin" },
        { userId: member.userId, role: "org_member" },
      ],
    });

    const refused = await harness.call("DELETE", "/me", { jar: user.jar });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: "CONFLICT",
      details: { reason: "last_org_admin" },
    });
    const [row] = await owner.db.select().from(users).where(eq(users.id, user.userId));
    expect(row).toMatchObject({ status: "active", deletedAt: null });
    expect((await get("/me", user.jar)).statusCode).toBe(200);
    expect(await auditRows(owner.db, "user.delete_request", user.userId)).toHaveLength(0);

    // Once another member can administer the organization, the request goes through.
    await owner.db.execute(
      sql`update organization_members set role = 'org_admin' where org_id = ${orgId} and user_id = ${member.userId}`,
    );
    expect((await harness.call("DELETE", "/me", { jar: user.jar })).statusCode).toBe(200);
  });

  it("allows an org_admin whose organization has no other members", async () => {
    const user = await harness.signedInUser();
    await insertOrg(owner.db, {
      createdBy: user.userId,
      members: [{ userId: user.userId, role: "org_admin" }],
    });
    expect((await harness.call("DELETE", "/me", { jar: user.jar })).statusCode).toBe(200);
  });

  it("allows a plain member of someone else's organization", async () => {
    const admin = await harness.signedInUser();
    const user = await harness.signedInUser();
    await insertOrg(owner.db, {
      createdBy: admin.userId,
      members: [
        { userId: admin.userId, role: "org_admin" },
        { userId: user.userId, role: "org_member" },
      ],
    });
    expect((await harness.call("DELETE", "/me", { jar: user.jar })).statusCode).toBe(200);
  });

  it("is rate limited to 3 an hour", async () => {
    const user = await harness.signedInUser();
    await expectRateLimited(harness, { method: "DELETE", url: "/me", max: 3, jar: user.jar });
  });
});
