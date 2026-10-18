import { randomUUID } from "node:crypto";

import {
  attributeReferral,
  creditWallets,
  drainOutbox,
  ensureReferralCode,
  handleOrderPaid,
  handleSignupCheck,
  orders,
  outbox,
  plans,
  pointsLedger,
  pointsMove,
  pointsWallets,
  releaseDuePoints,
  requestSignupCheck,
  rxAnalyses,
  siteSettings,
  users,
  type OutboxHandler,
} from "@wasfa/db";
import {
  convertPreviewSchema,
  convertResultSchema,
  meRewardsSchema,
  rewardActivityPageSchema,
} from "@wasfa/shared/schemas/rewards";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PhoneRepo } from "../src/phone/phone.repo.js";

import { AdminTestContext } from "./support/admin-context.js";
import { PASSWORD } from "./support/auth-harness.js";

/*
 * The caller's rewards through the real app (REFERRALS §8.1, §10; Task 3.11): auth, the page, the
 * activity feed (initials only), the conversion preview and the conversion itself, and the whole
 * chain from an invite link to credits, with the worker's rules run by the db package directly.
 */

const ctx = new AdminTestContext();
const db = () => ctx.owner.db;
const DAY = 86_400_000;

const handlers: Record<string, OutboxHandler> = {
  "rewards.signup_check": async (tx, entry) => {
    await handleSignupCheck(tx, (entry.payload as { userId: string }).userId, new Date());
  },
  "rewards.order_paid": async (tx, entry) => {
    await handleOrderPaid(tx, (entry.payload as { orderId: string }).orderId, new Date());
  },
};

beforeAll(async () => {
  await ctx.start();
  await db()
    .insert(siteSettings)
    .values({ key: "rewards", value: { enabled: true } })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: { enabled: true } } });
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function paidOrder(userId: string, subtotalMinor = 29_900) {
  const [plus] = await db().select().from(plans).where(eq(plans.key, "plus"));
  if (!plus) throw new Error("plan missing");
  const [order] = await db()
    .insert(orders)
    .values({
      ownerUserId: userId,
      kind: "subscription",
      planId: plus.id,
      months: 1,
      currency: "EGP",
      quote: {},
      quoteHash: "a".repeat(64),
      subtotalMinor,
      totalMinor: subtotalMinor,
      status: "paid",
      paymentKind: "gateway",
      expiresAt: new Date(Date.now() + DAY),
      paidAt: new Date(),
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  return order;
}

/** Registers through the real endpoint, verifies the mailbox, returns the new user. */
async function registerReferred(code: string): Promise<{ userId: string; email: string }> {
  const email = ctx.harness.nextEmail();
  const res = await ctx.harness.call("POST", "/auth/sign-up/email", {
    body: { name: "Omar Friend", email, password: PASSWORD, referralCode: code },
    headers: { "x-turnstile-token": "pass" },
  });
  expect(res.statusCode, res.body).toBe(200);
  const mail = ctx.harness.mails.find((m) => m.kind === "verify" && m.to === email);
  if (!mail) throw new Error("no verification mail");
  const link = new URL(mail.url);
  await ctx.harness.call("GET", `${link.pathname}${link.search}`);
  const [row] = await db().select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error("user row missing");
  return { userId: row.id, email };
}

/** Gives a user spendable points through the same ledger the rules use. */
async function fundCash(userId: string, points: number): Promise<void> {
  await db().transaction(async (tx) => {
    await pointsMove(tx, {
      userId,
      kind: "admin_adjust",
      rows: [{ bucket: "cash", amount: points, idempotencyKey: `test:${randomUUID()}` }],
      referenceType: "admin",
      referenceId: randomUUID(),
      lifetimeDelta: points,
    });
  });
}

const walletOf = async (userId: string) =>
  (await db().select().from(pointsWallets).where(eq(pointsWallets.userId, userId)))[0];
const creditsOf = async (userId: string) =>
  (await db().select().from(creditWallets).where(eq(creditWallets.ownerUserId, userId)))[0]?.balance ?? 0;

describe("authentication", () => {
  it("every route needs a session", async () => {
    for (const [method, url] of [
      ["GET", "/me/rewards"],
      ["GET", "/me/rewards/activity"],
      ["GET", "/me/rewards/convert/preview?points=10"],
      ["POST", "/me/rewards/convert"],
    ] as const) {
      const res = await ctx.harness.call(method, url, { body: { points: 5, requestId: randomUUID() } });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe("GET /me/rewards", () => {
  it("shows the code, the link, what each side gets and empty balances", async () => {
    const user = await ctx.harness.signedInUser();
    const res = await ctx.harness.call("GET", "/me/rewards", { jar: user.jar });
    expect(res.statusCode, res.body).toBe(200);
    const body = meRewardsSchema.parse(res.json());
    expect(body.enabled).toBe(true);
    expect(body.link).toBe(`https://wasfa.online/r/${body.code}`);
    expect(body.balances).toMatchObject({ pending: 0, cash: 0, creditOnly: 0, pendingReleaseAt: null });
    expect(body.balances.currency).toBe("EGP");
    expect(body.counts).toEqual({ invited: 0, verified: 0, paid: 0 });
    expect(body.offers.refereeDiscountBps).toBe(1000);
    expect(body.offers.referrer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "referee_verified",
          rewardKind: "fixed_points",
          value: 50,
          redeemableAs: "credits_only",
          holdDays: 3,
        }),
        expect.objectContaining({
          event: "first_payment",
          rewardKind: "percent_of_net_bps",
          value: 2000,
          holdDays: 14,
        }),
        expect.objectContaining({ event: "renewal", maxRenewals: 3 }),
      ]),
    );
    expect(body.offers.referee).toEqual([
      expect.objectContaining({ event: "referee_verified", rewardKind: "fixed_credits", value: 20 }),
    ]);
    expect(body.tier).toBeNull();
    expect(body.debt).toBe(0);
  });

  it("invite link to credits: sign-up, verification, first use, first payment, hold, conversion", async () => {
    const referrer = await ctx.harness.signedInUser();
    const { code } = (
      await ctx.harness.call("GET", "/me/referral", { jar: referrer.jar })
    ).json<{ code: string }>();
    const friend = await registerReferred(code);

    const overview = async () =>
      meRewardsSchema.parse(
        (await ctx.harness.call("GET", "/me/rewards", { jar: referrer.jar })).json(),
      );
    expect(await overview()).toMatchObject({ counts: { invited: 1, verified: 0, paid: 0 } });

    // The mailbox alone is not enough: phone and a first analysis are needed too.
    await drainOutbox(db(), handlers);
    expect((await overview()).balances.pending).toBe(0);
    expect(await ctx.app.get(PhoneRepo).markVerified(friend.userId, "+201012345678")).toBe("verified");
    await drainOutbox(db(), handlers);
    expect((await overview()).balances.pending).toBe(0);
    await db().insert(rxAnalyses).values({
      ownerUserId: friend.userId,
      createdBy: friend.userId,
      status: "done",
      mode: "fast",
      skillVersion: "t@1",
    });
    await requestSignupCheck(db(), friend.userId, "usage");
    await drainOutbox(db(), handlers);

    const afterSignup = await overview();
    expect(afterSignup.balances.pending).toBe(50);
    expect(afterSignup.balances.pendingReleaseAt).not.toBeNull();
    expect(afterSignup.counts).toMatchObject({ invited: 1, verified: 1 });
    expect(await creditsOf(friend.userId)).toBe(20);

    // The invited person pays; the referrer gets 20 percent as pending cash points.
    const order = await paidOrder(friend.userId, 29_900);
    await db().insert(outbox).values({
      topic: "rewards.order_paid",
      payload: { orderId: order.id },
      idempotencyKey: `rewards_order_paid:${order.id}`,
    });
    await drainOutbox(db(), handlers);
    const afterPayment = await overview();
    expect(afterPayment.balances.pending).toBe(50 + 598);
    expect(afterPayment.counts.paid).toBe(1);

    // The hold passes (simulated clock): sign-up points become credit-only, the payment cash.
    await releaseDuePoints(db(), new Date(Date.now() + 15 * DAY));
    const released = await overview();
    expect(released.balances).toMatchObject({
      pending: 0,
      cash: 598,
      creditOnly: 50,
      cashValueMinor: 5_980,
    });

    // Activity: movements with i18n keys and initials; never the email, phone or full name.
    const activityRes = await ctx.harness.call("GET", "/me/rewards/activity", { jar: referrer.jar });
    const activity = rewardActivityPageSchema.parse(activityRes.json());
    expect(activity.items.length).toBeGreaterThanOrEqual(4);
    expect(activity.items.every((item) => item.labelKey.startsWith("rewards.activity."))).toBe(true);
    expect(activity.items.some((item) => item.refereeInitials === "O. F.")).toBe(true);
    expect(activity.items.some((item) => item.event === "first_payment")).toBe(true);
    expect(activity.items.some((item) => item.kind === "reward_release" && item.bucket === "pending")).toBe(false);
    const raw = JSON.stringify(activityRes.json());
    expect(raw).not.toContain(friend.email);
    expect(raw).not.toContain("1012345678");
    expect(raw).not.toContain("Omar Friend");
    expect(raw).not.toContain("Omar");

    // Convert: the preview is exactly what happens.
    const previewRes = await ctx.harness.call("GET", "/me/rewards/convert/preview?points=500", {
      jar: referrer.jar,
    });
    expect(previewRes.statusCode, previewRes.body).toBe(200);
    const preview = convertPreviewSchema.parse(previewRes.json());
    expect(preview).toMatchObject({ points: 500, fromCreditOnly: 50, fromCash: 450, possible: true });
    // 500 points / 5 per credit, +20 percent = 120 credits.
    expect(preview.credits).toBe(120);

    const before = await creditsOf(referrer.userId);
    const requestId = randomUUID();
    const converted = await ctx.harness.call("POST", "/me/rewards/convert", {
      jar: referrer.jar,
      body: { points: 500, requestId },
    });
    expect(converted.statusCode, converted.body).toBe(200);
    expect(convertResultSchema.parse(converted.json())).toEqual({
      points: 500,
      credits: preview.credits,
      replayed: false,
    });
    expect(await creditsOf(referrer.userId)).toBe(before + preview.credits);
    expect(await walletOf(referrer.userId)).toMatchObject({ creditOnly: 0, cash: 148 });

    const replay = await ctx.harness.call("POST", "/me/rewards/convert", {
      jar: referrer.jar,
      body: { points: 500, requestId },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ replayed: true, credits: preview.credits });
    expect(await creditsOf(referrer.userId)).toBe(before + preview.credits);
  });
});

describe("conversion", () => {
  it("refuses more points than the caller has, and amounts too small to give a credit", async () => {
    const user = await ctx.harness.signedInUser();
    await fundCash(user.userId, 20);
    const preview = await ctx.harness.call("GET", "/me/rewards/convert/preview?points=21", {
      jar: user.jar,
    });
    expect(preview.json()).toMatchObject({ possible: false, reason: "insufficient_points" });

    const tooMany = await ctx.harness.call("POST", "/me/rewards/convert", {
      jar: user.jar,
      body: { points: 21, requestId: randomUUID() },
    });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json()).toMatchObject({ code: "CONFLICT", details: { reason: "insufficient_points" } });

    const tooSmall = await ctx.harness.call("POST", "/me/rewards/convert", {
      jar: user.jar,
      body: { points: 3, requestId: randomUUID() },
    });
    expect(tooSmall.statusCode).toBe(409);
    expect(tooSmall.json()).toMatchObject({ details: { reason: "below_minimum" } });
    expect((await walletOf(user.userId))?.cash).toBe(20);
  });

  it("validates the body and the query", async () => {
    const user = await ctx.harness.signedInUser();
    for (const body of [{ points: 0, requestId: randomUUID() }, { points: 5 }, { points: 5.5, requestId: randomUUID() }, { points: 5, requestId: "x" }]) {
      const res = await ctx.harness.call("POST", "/me/rewards/convert", { jar: user.jar, body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await ctx.harness.call("GET", "/me/rewards/convert/preview?points=0", { jar: user.jar })).statusCode).toBe(400);
    expect((await ctx.harness.call("GET", "/me/rewards/convert/preview", { jar: user.jar })).statusCode).toBe(400);
  });

  it("allows 10 conversions an hour per user", async () => {
    const user = await ctx.harness.signedInUser();
    await fundCash(user.userId, 200);
    for (let index = 0; index < 10; index++) {
      const res = await ctx.harness.call("POST", "/me/rewards/convert", {
        jar: user.jar,
        body: { points: 5, requestId: randomUUID() },
      });
      expect(res.statusCode, `conversion ${String(index + 1)}`).toBe(200);
    }
    const limited = await ctx.harness.call("POST", "/me/rewards/convert", {
      jar: user.jar,
      body: { points: 5, requestId: randomUUID() },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect((await walletOf(user.userId))?.cash).toBe(150);
  });

  it("nobody can convert someone else's points", async () => {
    const owner = await ctx.harness.signedInUser();
    const intruder = await ctx.harness.signedInUser();
    await fundCash(owner.userId, 100);
    const res = await ctx.harness.call("POST", "/me/rewards/convert", {
      jar: intruder.jar,
      body: { points: 50, requestId: randomUUID() },
    });
    expect(res.statusCode).toBe(409);
    expect((await walletOf(owner.userId))?.cash).toBe(100);
  });
});

describe("GET /me/rewards/activity", () => {
  it("pages newest first with a cursor and refuses a malformed one", async () => {
    const referrer = await ctx.harness.signedInUser();
    const code = await ensureReferralCode(db(), referrer.userId);
    for (let index = 0; index < 3; index++) {
      const friend = await ctx.insertUser({ name: "Mona Ahmed", email: ctx.harness.nextEmail() });
      await attributeReferral(db(), { refereeUserId: friend, code: code.code, source: "link" });
      await handleCheck(friend);
    }
    const first = rewardActivityPageSchema.parse(
      (await ctx.harness.call("GET", "/me/rewards/activity?limit=2", { jar: referrer.jar })).json(),
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = rewardActivityPageSchema.parse(
      (
        await ctx.harness.call(
          "GET",
          `/me/rewards/activity?limit=2&cursor=${first.nextCursor ?? ""}`,
          { jar: referrer.jar },
        )
      ).json(),
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(3);
    expect(first.items.every((item) => item.refereeInitials === "M. A.")).toBe(true);

    const bad = await ctx.harness.call("GET", "/me/rewards/activity?cursor=garbage", {
      jar: referrer.jar,
    });
    expect(bad.statusCode).toBe(400);
  });

  it("shows only the caller's own movements", async () => {
    const other = await ctx.harness.signedInUser();
    await fundCash(other.userId, 40);
    const user = await ctx.harness.signedInUser();
    const page = rewardActivityPageSchema.parse(
      (await ctx.harness.call("GET", "/me/rewards/activity", { jar: user.jar })).json(),
    );
    expect(page.items).toEqual([]);
    const count = await db().select().from(pointsLedger);
    expect(count.length).toBeGreaterThan(0);
  });
});

/** Verifies a directly inserted friend and runs the sign-up rules for them. */
async function handleCheck(userId: string): Promise<void> {
  await db()
    .update(users)
    .set({
      emailVerified: true,
      phone: `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
    })
    .where(eq(users.id, userId));
  await db().insert(rxAnalyses).values({
    ownerUserId: userId,
    createdBy: userId,
    status: "done",
    mode: "fast",
    skillVersion: "t@1",
  });
  await db().transaction((tx) => handleSignupCheck(tx, userId, new Date()));
}
