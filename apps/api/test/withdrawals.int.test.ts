import { randomUUID } from "node:crypto";

import {
  auditLogs,
  outbox,
  payoutDestinations,
  payoutMethods,
  pointsMove,
  pointsWallets,
  siteSettings,
  userNotifications,
  users,
  withdrawalRequests,
} from "@wasfa/db";
import {
  adminWithdrawalDetailSchema,
  adminWithdrawalListSchema,
  payoutDestinationsSchema,
  payoutDestinationViewSchema,
  revealedDestinationSchema,
  withdrawalCreatedSchema,
  withdrawalEligibilitySchema,
  withdrawalListSchema,
} from "@wasfa/shared/schemas/withdrawals";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Admin } from "./support/admin-context.js";

/*
 * Withdrawals through the real app (REFERRALS §8.2, Task 3.12): destinations that never leak their
 * plain value, eligibility, the request with fresh auth and a daily limit, ownership, the admin
 * review with four eyes, the audited reveal, idempotent payment and the weekly export.
 */

const ctx = new AdminTestContext();
const db = () => ctx.owner.db;
const DAY = 86_400_000;
const NUMBER = "01012345678";
let seq = 0;
let admin: Admin;
let secondAdmin: Admin;

async function setRewards(patch: Record<string, unknown> = {}): Promise<void> {
  const value = {
    enabled: true,
    cashOutEnabled: true,
    destinationCooldownHours: 0,
    fourEyesThresholdPoints: 1_000_000,
    ...patch,
  };
  await db()
    .insert(siteSettings)
    .values({ key: "rewards", value })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value } });
}

beforeAll(async () => {
  await ctx.start();
  await setRewards();
  await db()
    .insert(payoutMethods)
    .values({
      key: "test_wallet",
      nameAr: "محفظة",
      nameEn: "Wallet",
      enabled: true,
      fieldSchema: {
        fields: [{ key: "number", labelKey: "rewards.payout.field.number", kind: "egypt_mobile", required: true }],
      },
    });
  admin = await ctx.admin("super_admin");
  secondAdmin = await ctx.admin("super_admin");
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function makeEligible(userId: string, points: number): Promise<void> {
  seq += 1;
  await db()
    .update(users)
    .set({
      phone: `+2011${String(seq).padStart(8, "0")}`,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      createdAt: new Date(Date.now() - 30 * DAY),
    })
    .where(eq(users.id, userId));
  if (points > 0) {
    await db().transaction((tx) =>
      pointsMove(tx, {
        userId,
        kind: "admin_adjust",
        rows: [{ bucket: "cash", amount: points, idempotencyKey: `test:${randomUUID()}` }],
        referenceType: "admin",
        referenceId: randomUUID(),
        lifetimeDelta: points,
      }),
    );
  }
}

/** A signed-in, eligible user with `points` cash and one saved destination (made through the API). */
async function withdrawer(points = 3_000, number = NUMBER) {
  const user = await ctx.harness.signedInUser();
  await makeEligible(user.userId, points);
  const res = await ctx.harness.call("POST", "/me/payout-destinations", {
    jar: user.jar,
    body: { methodKey: "test_wallet", values: { number } },
  });
  expect(res.statusCode, res.body).toBe(201);
  const destination = payoutDestinationViewSchema.parse(res.json());
  return { ...user, destinationId: destination.id };
}

type Withdrawer = Awaited<ReturnType<typeof withdrawer>>;

const request = (who: Withdrawer, points = 1_000, requestId: string = randomUUID()) =>
  ctx.harness.call("POST", "/me/withdrawals", {
    jar: who.jar,
    body: { points, destinationId: who.destinationId, requestId },
  });

async function requested(who: Withdrawer, points = 1_000): Promise<string> {
  const res = await request(who, points);
  expect(res.statusCode, res.body).toBe(200);
  return withdrawalCreatedSchema.parse(res.json()).id;
}

const cashOf = async (userId: string) =>
  (await db().select().from(pointsWallets).where(eq(pointsWallets.userId, userId)))[0]?.cash ?? 0;

const asAdmin = (who: Admin, method: "GET" | "POST", url: string, body?: Record<string, unknown>) =>
  ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

describe("authentication and permissions", () => {
  it("every route needs a session", async () => {
    const id = randomUUID();
    for (const [method, url] of [
      ["GET", "/me/payout-destinations"],
      ["POST", "/me/payout-destinations"],
      ["DELETE", `/me/payout-destinations/${id}`],
      ["GET", "/me/withdrawals"],
      ["GET", "/me/withdrawals/eligibility"],
      ["POST", "/me/withdrawals"],
      ["POST", `/me/withdrawals/${id}/cancel`],
      ["GET", "/admin/growth/withdrawals"],
    ] as const) {
      const res = await ctx.harness.call(method, url, { body: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("the admin routes need their own permissions", async () => {
    const who = await withdrawer();
    const id = await requested(who);
    const noReview = await ctx.admin(await ctx.roleLacking("withdrawals.review"));
    const noPay = await ctx.admin(await ctx.roleLacking("withdrawals.pay"));
    const noExport = await ctx.admin(await ctx.roleLacking("finance.export"));
    expect((await asAdmin(noReview, "GET", "/admin/growth/withdrawals")).statusCode).toBe(403);
    expect((await asAdmin(noReview, "POST", `/admin/growth/withdrawals/${id}/approve`, {})).statusCode).toBe(403);
    expect((await asAdmin(noPay, "POST", `/admin/growth/withdrawals/${id}/reveal`, {})).statusCode).toBe(403);
    expect(
      (await asAdmin(noPay, "POST", `/admin/growth/withdrawals/${id}/mark-paid`, { transferReference: "ABC123" })).statusCode,
    ).toBe(403);
    expect((await asAdmin(noExport, "GET", "/admin/growth/withdrawals/export.csv?week=2026-W42")).statusCode).toBe(403);
    expect((await asAdmin(noPay, "GET", "/admin/growth/withdrawals")).statusCode).toBe(200);
  });
});

describe("payout destinations", () => {
  it("seals the value, answers with the masked form only and starts a notice", async () => {
    const number = "01155550001";
    const who = await withdrawer(0, number);
    const [saved] = await db().select().from(payoutDestinations).where(eq(payoutDestinations.id, who.destinationId));
    expect(saved?.masked).toBe("011••••0001");
    expect(saved?.valueEnc).not.toContain(number);
    expect(saved?.destinationHash).toMatch(/^[a-f0-9]{64}$/);

    const list = await ctx.harness.call("GET", "/me/payout-destinations", { jar: who.jar });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(number);
    const parsed = payoutDestinationsSchema.parse(list.json());
    expect(parsed.destinations).toMatchObject([{ id: who.destinationId, masked: "011••••0001", usable: true }]);
    expect(parsed.methods.map((method) => method.key)).toContain("test_wallet");

    const [notice] = await db()
      .select()
      .from(userNotifications)
      .where(and(eq(userNotifications.userId, who.userId), eq(userNotifications.kind, "rewards.payout_destination_added")));
    expect(notice).toBeDefined();
    const queued = await db().select().from(outbox).where(eq(outbox.topic, "withdrawals.notify"));
    expect(queued.some((row) => (row.payload as { destinationId?: string }).destinationId === who.destinationId)).toBe(true);
  });

  it("rejects an invalid value, a disabled method and the same value on another account", async () => {
    const who = await withdrawer(0, "01155550002");
    const bad = await ctx.harness.call("POST", "/me/payout-destinations", {
      jar: who.jar,
      body: { methodKey: "test_wallet", values: { number: "12345" } },
    });
    expect(bad.statusCode).toBe(400);
    const unknown = await ctx.harness.call("POST", "/me/payout-destinations", {
      jar: who.jar,
      body: { methodKey: "nope", values: { number: NUMBER } },
    });
    expect(unknown.statusCode).toBe(409);

    const other = await ctx.harness.signedInUser();
    await makeEligible(other.userId, 0);
    const clash = await ctx.harness.call("POST", "/me/payout-destinations", {
      jar: other.jar,
      // The same wallet, typed differently: normalisation makes the hash equal.
      body: { methodKey: "test_wallet", values: { number: "+20 115 555 0002" } },
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json<{ details: { reason: string } }>().details.reason).toBe("destination_in_use");
    expect(clash.body).not.toContain(who.userId);
  });

  it("removes a destination of the caller and treats another's as missing", async () => {
    const mine = await withdrawer(0, "01155550003");
    const theirs = await withdrawer(0, "01155550004");
    expect((await ctx.harness.call("DELETE", `/me/payout-destinations/${theirs.destinationId}`, { jar: mine.jar })).statusCode).toBe(404);
    expect((await ctx.harness.call("DELETE", `/me/payout-destinations/${mine.destinationId}`, { jar: mine.jar })).statusCode).toBe(204);
    const list = await ctx.harness.call("GET", "/me/payout-destinations", { jar: mine.jar });
    expect(payoutDestinationsSchema.parse(list.json()).destinations).toHaveLength(0);
  });
});

describe("GET /me/withdrawals/eligibility", () => {
  it("shows progress to the minimum in points and EGP", async () => {
    const who = await withdrawer(400, "01155550005");
    const res = await ctx.harness.call("GET", "/me/withdrawals/eligibility", { jar: who.jar });
    expect(res.statusCode, res.body).toBe(200);
    const body = withdrawalEligibilitySchema.parse(res.json());
    expect(body).toMatchObject({
      available: true,
      eligible: false,
      cash: 400,
      cashValueMinor: 4_000,
      minWithdrawalPoints: 1_000,
      minWithdrawalMinor: 10_000,
      pointsToMinimum: 600,
      currency: "EGP",
      usableDestinations: 1,
    });
    expect(body.reasons).toEqual(["not_enough_points"]);
  });
});

describe("POST /me/withdrawals", () => {
  it("holds the points, snapshots the amount and is idempotent per request id", async () => {
    const who = await withdrawer(3_000, "01155550006");
    const requestId = randomUUID();
    const first = await request(who, 1_200, requestId);
    expect(first.statusCode, first.body).toBe(200);
    const body = withdrawalCreatedSchema.parse(first.json());
    expect(body).toMatchObject({ status: "requested", points: 1_200, amountMinor: 12_000, replayed: false });
    expect(body.destination.masked).toBe("011••••0006");
    expect(first.body).not.toContain("01155550006");
    expect(await cashOf(who.userId)).toBe(1_800);

    const again = withdrawalCreatedSchema.parse((await request(who, 1_200, requestId)).json());
    expect(again).toMatchObject({ id: body.id, replayed: true });
    expect(await cashOf(who.userId)).toBe(1_800);

    const list = withdrawalListSchema.parse((await ctx.harness.call("GET", "/me/withdrawals", { jar: who.jar })).json());
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.timeline.map((entry) => entry.status)).toEqual(["requested"]);
    expect(list.items[0]).not.toHaveProperty("flags");
  });

  it("refuses with a reason: below the minimum, open request, cash-out off", async () => {
    const who = await withdrawer(5_000, "01155550007");
    const small = await request(who, 500);
    expect(small.statusCode).toBe(409);
    expect(small.json<{ details: { reason: string } }>().details.reason).toBe("below_minimum");

    await requested(who);
    const open = await request(who);
    expect(open.json<{ details: { reason: string } }>().details.reason).toBe("open_request");

    const other = await withdrawer(5_000, "01155550030");
    await setRewards({ cashOutEnabled: false });
    const off = await request(other);
    await setRewards();
    expect(off.json<{ details: { reason: string } }>().details.reason).toBe("cash_out_off");
  });

  it("needs fresh authentication", async () => {
    const who = await withdrawer(3_000, "01155550008");
    await ctx.makeSessionStale(who.userId);
    const res = await request(who);
    expect(res.statusCode).toBe(401);
    expect(res.json<{ details: { reason: string } }>().details.reason).toBe("reauth");
    expect(await cashOf(who.userId)).toBe(3_000);
  });

  it("is limited to 3 a day per user", async () => {
    const who = await withdrawer(5_000, "01155550009");
    await requested(who);
    for (let i = 0; i < 2; i++) expect((await request(who)).statusCode).toBe(409);
    const blocked = await request(who);
    expect(blocked.statusCode).toBe(429);
  });

  it("another user's destination or request looks missing", async () => {
    const owner = await withdrawer(3_000, "01155550010");
    const intruder = await withdrawer(3_000, "01155550011");
    const stolen = await ctx.harness.call("POST", "/me/withdrawals", {
      jar: intruder.jar,
      body: { points: 1_000, destinationId: owner.destinationId, requestId: randomUUID() },
    });
    expect(stolen.statusCode).toBe(404);
    const id = await requested(owner);
    expect((await ctx.harness.call("POST", `/me/withdrawals/${id}/cancel`, { jar: intruder.jar })).statusCode).toBe(404);
  });

  it("cancel returns the points while requested and only then", async () => {
    const who = await withdrawer(3_000, "01155550012");
    const id = await requested(who);
    expect(await cashOf(who.userId)).toBe(2_000);
    const res = await ctx.harness.call("POST", `/me/withdrawals/${id}/cancel`, { jar: who.jar });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("canceled");
    expect(await cashOf(who.userId)).toBe(3_000);

    const second = await requested(who);
    await asAdmin(admin, "POST", `/admin/growth/withdrawals/${second}/approve`, {});
    const late = await ctx.harness.call("POST", `/me/withdrawals/${second}/cancel`, { jar: who.jar });
    expect(late.statusCode).toBe(409);
  });
});

describe("the admin review", () => {
  it("lists with totals and opens a masked, audited detail", async () => {
    const who = await withdrawer(3_000, "01155550013");
    const id = await requested(who);
    const list = adminWithdrawalListSchema.parse((await asAdmin(admin, "GET", "/admin/growth/withdrawals?status=requested")).json());
    const item = list.items.find((row) => row.id === id);
    expect(item).toMatchObject({ points: 1_000, flags: ["first_withdrawal"], awaitingSecondApproval: false });
    expect(item?.maskedUser).toMatch(/#[a-f0-9]{8}$/);
    expect(list.totals.waiting[0]?.count).toBeGreaterThanOrEqual(1);

    const res = await asAdmin(admin, "GET", `/admin/growth/withdrawals/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain("01155550013");
    const detail = adminWithdrawalDetailSchema.parse(res.json());
    expect(detail.destination.masked).toBe("011••••0013");
    expect(detail.user).toMatchObject({ lifetimeEarned: 3_000, phoneVerified: true });
    expect((await ctx.auditRowsFor("withdrawal.opened", id)).length).toBe(1);

    const filtered = adminWithdrawalListSchema.parse(
      (await asAdmin(admin, "GET", "/admin/growth/withdrawals?flag=first_withdrawal")).json(),
    );
    expect(filtered.items.some((row) => row.id === id)).toBe(true);
  });

  it("approve then reveal then pay, each audited; the plain value appears only in reveal", async () => {
    const who = await withdrawer(3_000, "01155550014");
    const id = await requested(who);
    const early = await asAdmin(admin, "POST", `/admin/growth/withdrawals/${id}/reveal`, {});
    expect(early.statusCode).toBe(409);

    const approved = await asAdmin(admin, "POST", `/admin/growth/withdrawals/${id}/approve`, {});
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json()).toMatchObject({ status: "approved", stage: "approved" });

    const reveal = await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${id}/reveal`, {});
    expect(reveal.statusCode, reveal.body).toBe(201);
    expect(revealedDestinationSchema.parse(reveal.json())).toEqual({
      methodKey: "test_wallet",
      values: { number: "01155550014" },
    });
    const revealAudit = await ctx.auditRowsFor("withdrawal.destination_revealed", id);
    expect(revealAudit).toHaveLength(1);
    expect(JSON.stringify(revealAudit[0])).not.toContain("01155550014");

    const noRef = await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${id}/mark-paid`, {});
    expect(noRef.statusCode).toBe(400);
    const reference = `TRX-${randomUUID().slice(0, 8)}`;
    const paid = await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${id}/mark-paid`, { transferReference: reference });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(paid.json()).toMatchObject({ status: "paid", replayed: false });
    const replay = await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${id}/mark-paid`, { transferReference: reference });
    expect(replay.json()).toMatchObject({ status: "paid", replayed: true });
    const other = await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${id}/mark-paid`, { transferReference: "OTHER-REF" });
    expect(other.statusCode).toBe(409);
    expect(await ctx.auditRowsFor("withdrawal.paid", id)).toHaveLength(2);

    const mine = withdrawalListSchema.parse((await ctx.harness.call("GET", "/me/withdrawals", { jar: who.jar })).json());
    expect(mine.items[0]).toMatchObject({ status: "paid", transferReference: reference });
    expect(mine.items[0]?.timeline.map((entry) => entry.status)).toEqual(["requested", "approved", "paid"]);
    // A paid request's destination can no longer be revealed.
    expect((await asAdmin(admin, "POST", `/admin/growth/withdrawals/${id}/reveal`, {})).statusCode).toBe(409);
  });

  it("a transfer reference is unique across requests", async () => {
    const a = await withdrawer(3_000, "01155550015");
    const b = await withdrawer(3_000, "01155550016");
    const idA = await requested(a);
    const idB = await requested(b);
    for (const id of [idA, idB]) await asAdmin(admin, "POST", `/admin/growth/withdrawals/${id}/approve`, {});
    expect((await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${idA}/mark-paid`, { transferReference: "SAME-REF-1" })).statusCode).toBe(201);
    expect((await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${idB}/mark-paid`, { transferReference: "SAME-REF-1" })).statusCode).toBe(409);
  });

  it("pay and approve need fresh authentication", async () => {
    const who = await withdrawer(3_000, "01155550017");
    const id = await requested(who);
    const tired = await ctx.admin("super_admin");
    await ctx.makeSessionStale(tired.userId);
    expect((await asAdmin(tired, "POST", `/admin/growth/withdrawals/${id}/approve`, {})).statusCode).toBe(401);
    expect((await asAdmin(tired, "POST", `/admin/growth/withdrawals/${id}/reveal`, {})).statusCode).toBe(401);
    expect((await asAdmin(tired, "POST", `/admin/growth/withdrawals/${id}/mark-paid`, { transferReference: "FRESH-1" })).statusCode).toBe(401);
    expect((await asAdmin(tired, "POST", `/admin/growth/withdrawals/${id}/reject`, { reasonKey: "other" })).statusCode).toBe(401);
  });

  it("an admin cannot approve, reject, pay or reveal their own request", async () => {
    const boss = await ctx.admin("super_admin");
    await makeEligible(boss.userId, 3_000);
    const saved = await ctx.harness.call("POST", "/me/payout-destinations", {
      jar: boss.jar,
      body: { methodKey: "test_wallet", values: { number: "01155550018" } },
    });
    const destinationId = payoutDestinationViewSchema.parse(saved.json()).id;
    const created = await ctx.harness.call("POST", "/me/withdrawals", {
      jar: boss.jar,
      body: { points: 1_000, destinationId, requestId: randomUUID() },
    });
    expect(created.statusCode, created.body).toBe(200);
    const id = withdrawalCreatedSchema.parse(created.json()).id;
    for (const [action, body] of [
      ["approve", {}],
      ["reject", { reasonKey: "other" }],
    ] as const) {
      const res = await asAdmin(boss, "POST", `/admin/growth/withdrawals/${id}/${action}`, body);
      expect(res.statusCode, action).toBe(403);
      expect(res.json<{ details: { reason: string } }>().details.reason).toBe("own_request");
    }
    await asAdmin(admin, "POST", `/admin/growth/withdrawals/${id}/approve`, {});
    for (const [action, body] of [
      ["mark-paid", { transferReference: "OWN-REF-1" }],
      ["reveal", {}],
    ] as const) {
      const res = await asAdmin(boss, "POST", `/admin/growth/withdrawals/${id}/${action}`, body);
      expect(res.statusCode, action).toBe(403);
    }
  });

  it("four eyes: the first approval waits for a different admin", async () => {
    await setRewards({ fourEyesThresholdPoints: 1_000 });
    const who = await withdrawer(3_000, "01155550019");
    const id = await requested(who);
    const first = await asAdmin(admin, "POST", `/admin/growth/withdrawals/${id}/approve`, {});
    expect(first.json()).toMatchObject({ status: "requested", stage: "first" });
    const sameAgain = await asAdmin(admin, "POST", `/admin/growth/withdrawals/${id}/approve`, {});
    expect(sameAgain.json()).toMatchObject({ status: "requested", stage: "first", replayed: true });
    const detail = adminWithdrawalDetailSchema.parse((await asAdmin(secondAdmin, "GET", `/admin/growth/withdrawals/${id}`)).json());
    expect(detail).toMatchObject({ requiresSecondApproval: true, awaitingSecondApproval: true, approvedBy: admin.userId });
    // Not approved yet: nothing to pay or reveal.
    expect((await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${id}/mark-paid`, { transferReference: "EARLY-1" })).statusCode).toBe(409);
    const second = await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${id}/approve`, {});
    expect(second.json()).toMatchObject({ status: "approved", stage: "approved" });
    await setRewards();
  });

  it("reject returns the points with the reason, and the review lock is advisory", async () => {
    const who = await withdrawer(3_000, "01155550020");
    const id = await requested(who);
    expect(await cashOf(who.userId)).toBe(2_000);
    const claim = await asAdmin(admin, "POST", `/admin/growth/withdrawals/${id}/claim`);
    expect(claim.statusCode).toBe(201);
    const locked = await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${id}/reject`, { reasonKey: "other" });
    expect(locked.statusCode).toBe(409);
    expect(locked.json<{ details: { reason: string } }>().details.reason).toBe("review_locked");
    const bad = await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${id}/reject`, { reasonKey: "made_up", override: true });
    expect(bad.statusCode).toBe(400);
    const done = await asAdmin(secondAdmin, "POST", `/admin/growth/withdrawals/${id}/reject`, {
      reasonKey: "account_review",
      note: "call support",
      override: true,
    });
    expect(done.statusCode, done.body).toBe(201);
    expect(done.json()).toMatchObject({ status: "rejected" });
    expect(await cashOf(who.userId)).toBe(3_000);
    const [row] = await db().select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id));
    expect(row?.rejectReason).toBe("account_review");
    const [notice] = await db()
      .select()
      .from(userNotifications)
      .where(and(eq(userNotifications.userId, who.userId), eq(userNotifications.kind, "rewards.withdrawal_rejected")));
    expect(notice?.params).toMatchObject({ points: 1_000, reasonKey: "account_review" });
    const [audit] = await ctx.auditRowsFor("withdrawal.rejected", id);
    expect(audit).toBeDefined();
  });

  it("exports the week as CSV for finance.export, formula-safe, without destinations", async () => {
    const who = await withdrawer(3_000, "01155550021");
    const id = await requested(who);
    const week = isoWeekOf(new Date());
    const res = await asAdmin(admin, "GET", `/admin/growth/withdrawals/export.csv?week=${week}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body.split("\r\n")[0]).toContain("transfer_reference");
    expect(res.body).toContain(id);
    expect(res.body).not.toContain("01155550021");
    const badWeek = await asAdmin(admin, "GET", "/admin/growth/withdrawals/export.csv?week=2026-W99");
    expect(badWeek.statusCode, badWeek.body).toBe(400);
    const exported = await db().select().from(auditLogs).where(eq(auditLogs.action, "withdrawal.export"));
    expect(exported.length).toBeGreaterThan(0);
  });
});

/** ISO week `YYYY-Www` of a date (UTC). */
function isoWeekOf(date: Date): string {
  const day = (date.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 3));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / (7 * DAY)) + 1;
  return `${String(thursday.getUTCFullYear())}-W${String(week).padStart(2, "0")}`;
}
