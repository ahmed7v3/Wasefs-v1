import { randomUUID } from "node:crypto";

import {
  attributeReferral,
  ensureReferralCode,
  outbox,
  referralCodes,
  referrals,
  users,
} from "@wasfa/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PhoneRepo } from "../src/phone/phone.repo.js";

import { AdminTestContext } from "./support/admin-context.js";
import { PASSWORD, WEB } from "./support/auth-harness.js";
import { expectRateLimited } from "./support/identity-fixtures.js";

/*
 * Invite codes, the `/r/<code>` landing and attribution at sign-up (REFERRALS §2, Task 3.11),
 * through the real app and the real auth endpoints.
 */

const ctx = new AdminTestContext();
const db = () => ctx.owner.db;

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

/** Registers through the real endpoint and follows the verification mail; returns the user id. */
async function register(options: {
  referralCode?: string;
  cookie?: string;
  headers?: Record<string, string>;
}): Promise<{ userId: string; email: string }> {
  const email = ctx.harness.nextEmail();
  const res = await ctx.harness.call("POST", "/auth/sign-up/email", {
    body: {
      name: "Omar Friend",
      email,
      password: PASSWORD,
      callbackURL: "/login?verified=1",
      ...(options.referralCode === undefined ? {} : { referralCode: options.referralCode }),
    },
    headers: {
      "x-turnstile-token": "pass",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  const [row] = await db().select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error("user row missing");
  return { userId: row.id, email };
}

const referralOf = async (userId: string) =>
  (await db().select().from(referrals).where(eq(referrals.refereeUserId, userId)))[0];

describe("GET /me/referral", () => {
  it("requires a session", async () => {
    expect((await ctx.harness.call("GET", "/me/referral")).statusCode).toBe(401);
    expect(
      (await ctx.harness.call("PATCH", "/me/referral", { body: { code: "ABCDEFG" } })).statusCode,
    ).toBe(401);
  });

  it("creates the code lazily and returns the same one afterwards, with the share link", async () => {
    const user = await ctx.harness.signedInUser();
    const first = await ctx.harness.call("GET", "/me/referral", { jar: user.jar });
    expect(first.statusCode).toBe(200);
    const body = first.json<{ code: string; link: string; vanityEdited: boolean }>();
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
    expect(body.link).toBe(`${WEB}/r/${body.code}`);
    expect(body.vanityEdited).toBe(false);
    const again = await ctx.harness.call("GET", "/me/referral", { jar: user.jar });
    expect(again.json()).toEqual(body);
  });

  it("already has a code from sign-up, before anyone asks", async () => {
    const { userId } = await register({});
    const rows = await db().select().from(referralCodes).where(eq(referralCodes.ownerUserId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("user");
  });

  it("allows one vanity edit; the second is CONFLICT vanity_used; brand words are refused", async () => {
    const user = await ctx.harness.signedInUser();
    await ctx.harness.call("GET", "/me/referral", { jar: user.jar });
    const reserved = await ctx.harness.call("PATCH", "/me/referral", {
      jar: user.jar,
      body: { code: "wasfa2026" },
    });
    expect(reserved.statusCode).toBe(400);
    const support = await ctx.harness.call("PATCH", "/me/referral", {
      jar: user.jar,
      body: { code: "SUPPORT" },
    });
    expect(support.statusCode).toBe(400);

    const vanity = `DR${randomUUID().slice(0, 6).toUpperCase().replaceAll("-", "A")}`;
    const ok = await ctx.harness.call("PATCH", "/me/referral", {
      jar: user.jar,
      body: { code: vanity.toLowerCase() },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ code: vanity, vanityEdited: true });

    const second = await ctx.harness.call("PATCH", "/me/referral", {
      jar: user.jar,
      body: { code: "OTHERCODE" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "CONFLICT", details: { reason: "vanity_used" } });

    // Someone else cannot take a code that exists.
    const other = await ctx.harness.signedInUser();
    const taken = await ctx.harness.call("PATCH", "/me/referral", {
      jar: other.jar,
      body: { code: vanity },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ details: { reason: "code_taken" } });
  });
});

describe("GET /r/:code", () => {
  it("sets the 30 day wasfa_ref cookie and redirects to the register page", async () => {
    const owner = await ctx.harness.signedInUser();
    const code = await ensureReferralCode(db(), owner.userId);
    const res = await ctx.harness.call("GET", `/r/${code.code.toLowerCase()}`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${WEB}/register?ref=${code.code}`);
    const cookie = String([res.headers["set-cookie"]].flat()[0]);
    expect(cookie).toContain(`wasfa_ref=${code.code}`);
    expect(cookie).toContain("Max-Age=2592000");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
  });

  it("an unknown code redirects to a plain register page without a cookie", async () => {
    for (const code of ["ZZZZZZZ", "no", "a".repeat(40), "bad-code!"]) {
      const res = await ctx.harness.call("GET", `/r/${encodeURIComponent(code)}`);
      expect(res.statusCode, code).toBe(302);
      expect(res.headers.location).toBe(`${WEB}/register`);
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("is limited to 60 a minute per IP", async () => {
    await expectRateLimited(ctx.harness, { method: "GET", url: "/r/ZZZZZZZ", max: 60 });
  });
});

describe("attribution at sign-up", () => {
  it("records the referral from the register form's code (first touch)", async () => {
    const inviter = await ctx.harness.signedInUser();
    const code = await ensureReferralCode(db(), inviter.userId);
    const { userId } = await register({ referralCode: code.code.toLowerCase() });
    const referral = await referralOf(userId);
    expect(referral).toMatchObject({
      referrerUserId: inviter.userId,
      codeId: code.id,
      source: "code",
      status: "pending",
    });
  });

  it("reads the wasfa_ref cookie when the form has no code", async () => {
    const inviter = await ctx.harness.signedInUser();
    const code = await ensureReferralCode(db(), inviter.userId);
    const { userId } = await register({ cookie: `wasfa_ref=${code.code}` });
    expect(await referralOf(userId)).toMatchObject({ referrerUserId: inviter.userId, source: "link" });
  });

  it("the typed code wins over a cookie from an older link", async () => {
    const typed = await ensureReferralCode(db(), (await ctx.harness.signedInUser()).userId);
    const older = await ensureReferralCode(db(), (await ctx.harness.signedInUser()).userId);
    const { userId } = await register({
      referralCode: typed.code,
      cookie: `wasfa_ref=${older.code}`,
    });
    expect((await referralOf(userId))?.codeId).toBe(typed.id);
  });

  it("an unknown or malformed code never fails the sign-up and records nothing", async () => {
    for (const referralCode of ["NOSUCHCODE", "!!", "x".repeat(32)]) {
      const { userId } = await register({ referralCode });
      expect(await referralOf(userId)).toBeUndefined();
    }
  });

  it("ignores a client-supplied x-wasfa-referral header", async () => {
    const inviter = await ctx.harness.signedInUser();
    const code = await ensureReferralCode(db(), inviter.userId);
    const { userId } = await register({ headers: { "x-wasfa-referral": code.code } });
    expect(await referralOf(userId)).toBeUndefined();
  });

  it("the referrer cannot be their own referee, and a second attribution changes nothing", async () => {
    const inviter = await ctx.harness.signedInUser();
    const code = await ensureReferralCode(db(), inviter.userId);
    expect(
      await attributeReferral(db(), { refereeUserId: inviter.userId, code: code.code, source: "code" }),
    ).toBeNull();
    const { userId } = await register({ referralCode: code.code });
    const other = await ensureReferralCode(db(), (await ctx.harness.signedInUser()).userId);
    expect(
      await attributeReferral(db(), { refereeUserId: userId, code: other.code, source: "code" }),
    ).toBeNull();
    expect((await referralOf(userId))?.referrerUserId).toBe(inviter.userId);
  });
});

describe("sign-up checks reach the outbox", () => {
  const checksFor = async (userId: string) =>
    (await db().select().from(outbox).where(eq(outbox.topic, "rewards.signup_check"))).filter(
      (row) => (row.payload as { userId?: string }).userId === userId,
    );

  it("verifying the email queues one check for a referred user, none for others", async () => {
    const inviter = await ctx.harness.signedInUser();
    const code = await ensureReferralCode(db(), inviter.userId);
    const referred = await register({ referralCode: code.code });
    const plain = await register({});
    for (const person of [referred, plain]) {
      const mail = ctx.harness.mails.find((m) => m.kind === "verify" && m.to === person.email);
      if (!mail) throw new Error("no verification mail");
      const link = new URL(mail.url);
      await ctx.harness.call("GET", `${link.pathname}${link.search}`);
    }
    expect((await checksFor(referred.userId)).map((row) => row.idempotencyKey)).toEqual([
      `signup_check:${referred.userId}:email`,
    ]);
    expect(await checksFor(plain.userId)).toHaveLength(0);
  });

  it("verifying the phone queues a check in the same transaction", async () => {
    const inviter = await ctx.harness.signedInUser();
    const code = await ensureReferralCode(db(), inviter.userId);
    const { userId } = await register({ referralCode: code.code });
    const phone = `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    expect(await ctx.app.get(PhoneRepo).markVerified(userId, phone)).toBe("verified");
    expect((await checksFor(userId)).map((row) => row.idempotencyKey)).toContain(
      `signup_check:${userId}:phone`,
    );
  });
});
