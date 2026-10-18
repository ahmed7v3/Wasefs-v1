import { randomUUID } from "node:crypto";

import {
  aiUsage,
  auditLogs,
  coupons,
  creditWallets,
  personalOffers,
  pointsLedger,
  pointsWallets,
  promotions,
  referralCodes,
  referralPrograms,
  referrals,
  refunds,
  userNotes,
  users,
} from "@wasfa/db";
import { PERMISSION_KEYS, type Permission } from "@wasfa/shared/permissions";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, MISSING_ID, type Admin, type Person } from "./support/admin-context.js";
import { insertOrder, insertPayment } from "./support/billing-console-fixtures.js";

/*
 * User 360 (Task 3.15): summary, masked contact and its audited reveal, the merged timeline and its
 * paging, billing / credits / referrals tabs, notes, the quick actions and the permission of every
 * route (the table is the register; a route that is not listed is not covered).
 */

/** One keyset page, as every list route answers. */
interface Page {
  items: Array<{ id: string }>;
  nextCursor: string | null;
}

const ctx = new AdminTestContext();
let boss: Admin;
let support: Admin;
let customer: Person;
let referrer: Person;
let referralId: string;

const PHONE = "+201234567890";
const call = (who: Admin, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: Record<string, unknown>) =>
  ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  support = await ctx.admin("support");
  customer = await ctx.harness.signedInUser();
  referrer = await ctx.harness.signedInUser();
  await ctx.owner.db
    .update(users)
    .set({ name: "Samir Ahmed", phone: PHONE })
    .where(eq(users.id, customer.userId));
  await ctx.owner.db.update(users).set({ name: "Nadia Hassan" }).where(eq(users.id, referrer.userId));

  // Money: one paid order, partly refunded; AI cost; a wallet; a referral to the customer.
  const order = await insertOrder(ctx, { ownerUserId: customer.userId, subtotalMinor: 9_900 });
  const payment = await insertPayment(ctx, { order });
  await ctx.owner.db.insert(refunds).values({
    paymentId: payment.id,
    amountMinor: 1_000,
    currency: "EGP",
    reason: "test",
    status: "succeeded",
  });
  await ctx.owner.db.insert(aiUsage).values({
    task: "chat",
    modelKey: "test-model",
    ownerUserId: customer.userId,
    userId: customer.userId,
    costUsdMicros: 2_500_000,
    creditsCharged: 3,
    outcome: "ok",
  });
  await ctx.owner.db.insert(creditWallets).values({ ownerUserId: customer.userId, balance: 40 });

  const [program] = await ctx.owner.db
    .insert(referralPrograms)
    .values({ key: "u360_prog", kind: "standard", nameAr: "ب", nameEn: "P" })
    .returning({ id: referralPrograms.id });
  // Sign-up already gave the referrer a code; make it the one this file reads back.
  const [code] = await ctx.owner.db
    .update(referralCodes)
    .set({ code: "NADIA360", programId: program?.id ?? "" })
    .where(and(eq(referralCodes.ownerUserId, referrer.userId), eq(referralCodes.kind, "user")))
    .returning({ id: referralCodes.id });
  const [referral] = await ctx.owner.db
    .insert(referrals)
    .values({
      refereeUserId: customer.userId,
      referrerUserId: referrer.userId,
      codeId: code?.id ?? "",
      programId: program?.id ?? "",
      status: "held",
    })
    .returning({ id: referrals.id });
  referralId = referral?.id ?? "";
}, 180_000);

afterAll(async () => ctx.stop());

describe("GET /admin/users/:id/summary", () => {
  it("shows chips, plan, wallets, revenue net of refunds, AI cost and the referrer's initials", async () => {
    const response = await call(support, "GET", `/admin/users/${customer.userId}/summary`);
    expect(response.statusCode, response.body).toBe(200);
    const summary = response.json();
    expect(summary.profile).toMatchObject({ id: customer.userId, name: "Samir Ahmed" });
    expect(summary.chips).toMatchObject({ suspended: false, phoneVerified: false });
    expect(summary.plan).toMatchObject({ key: expect.any(String), expiresAt: null });
    expect(summary.wallets.personal.balance).toBe(40);
    expect(summary.lifetimeRevenue).toEqual({ EGP: 8_900 });
    expect(summary.lifetimeAiCostUsdMicros).toBe(2_500_000);
    expect(summary.referralSource).toMatchObject({ code: "NADIA360", referrerInitials: "N. H." });
    expect(summary.lastSeenAt).not.toBeNull();
    expect(summary.memberSince).toEqual(expect.any(String));
  });

  it("masks the contact data: the plain phone and e-mail are nowhere in the body", async () => {
    const response = await call(support, "GET", `/admin/users/${customer.userId}/summary`);
    expect(response.body).not.toContain(PHONE);
    expect(response.body).not.toContain(customer.email);
    expect(response.json().contact.phone).toMatch(/^\+20\*+890$/);
  });

  it("answers 404 for a user that does not exist", async () => {
    expect((await call(support, "GET", `/admin/users/${MISSING_ID}/summary`)).statusCode).toBe(404);
  });
});

describe("POST /admin/users/:id/reveal-contact", () => {
  it("returns the plain value, writes user.contact_revealed with the reason and forbids caching", async () => {
    const response = await call(support, "POST", `/admin/users/${customer.userId}/reveal-contact`, {
      field: "phone",
      reason: "customer asked us to call",
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ field: "phone", value: PHONE });
    expect(response.headers["cache-control"]).toBe("no-store");

    const [row] = await ctx.auditRowsFor("user.contact_revealed", customer.userId);
    expect(row?.actorId).toBe(support.userId);
    expect(row?.after).toMatchObject({ field: "phone" });
    // The value itself never reaches the audit trail.
    expect(JSON.stringify(row)).not.toContain("1234567890");
  });

  it("needs a reason", async () => {
    const response = await call(support, "POST", `/admin/users/${customer.userId}/reveal-contact`, {
      field: "email",
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /admin/users/:id/timeline", () => {
  it("merges the sources newest first and pages without gaps or repeats", async () => {
    // Notes, a reveal and an admin action add rows from three more sources.
    for (const body of ["first", "second"]) {
      await call(support, "POST", `/admin/users/${customer.userId}/notes`, { body });
    }
    const whole = await call(support, "GET", `/admin/users/${customer.userId}/timeline?limit=100`);
    expect(whole.statusCode, whole.body).toBe(200);
    const all = whole.json().items as Array<{ id: string; source: string; occurredAt: string }>;
    const sources = new Set(all.map((item) => item.source));
    for (const source of ["session", "order", "admin", "note"]) expect(sources).toContain(source);
    const times = all.map((item) => item.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const url: string = `/admin/users/${customer.userId}/timeline?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const part: Page = (await call(support, "GET", url)).json();
      expect(part.items.length).toBeLessThanOrEqual(2);
      seen.push(...part.items.map((item: { id: string }) => item.id));
      cursor = part.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(all.map((item) => item.id));
  });

  it("rejects a malformed cursor", async () => {
    const response = await call(
      support,
      "GET",
      `/admin/users/${customer.userId}/timeline?cursor=bm9wZQ`,
    );
    expect(response.statusCode).toBe(400);
  });
});

describe("billing, credits and referrals tabs", () => {
  it("billing lists orders with their payments, and no deal when none applies", async () => {
    const response = await call(support, "GET", `/admin/users/${customer.userId}/billing`);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.orders.items).toHaveLength(1);
    expect(body.orders.items[0].payments).toHaveLength(1);
    expect(body.orders.nextCursor).toBeNull();
    expect(body.deal).toBeNull();
    expect(body.current).toBeNull();
  });

  it("credits shows the wallets, the ledger page and 30 days of usage by task", async () => {
    const response = await call(boss, "GET", `/admin/users/${customer.userId}/credits`);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.wallets.personal.balance).toBe(40);
    expect(body.usage.items[0]).toMatchObject({ task: "chat", credits: 3, calls: 1 });
  });

  it("referrals shows who invited the user, and the referrer sees the invitee as initials", async () => {
    const asReferee = (await call(boss, "GET", `/admin/users/${customer.userId}/referrals`)).json();
    expect(asReferee.invitedBy).toMatchObject({ referralId, referrerInitials: "N. H." });
    const asReferrer = (await call(boss, "GET", `/admin/users/${referrer.userId}/referrals`)).json();
    expect(asReferrer.code).toMatchObject({ code: "NADIA360" });
    expect(asReferrer.invitees).toEqual([
      expect.objectContaining({ referralId, initials: "S. A.", status: "held" }),
    ]);
    expect(JSON.stringify(asReferrer)).not.toContain("Samir");
  });
});

describe("notes", () => {
  it("pins first, lets only the author edit the text, and lets the author or a super admin delete", async () => {
    const created = await call(support, "POST", `/admin/users/${referrer.userId}/notes`, {
      body: "asked about withdrawal",
    });
    expect(created.statusCode, created.body).toBe(201);
    const noteId = created.json().id as string;
    await call(support, "POST", `/admin/users/${referrer.userId}/notes`, { body: "later note" });

    // Pinning is open to anyone with users.read; the text is the author's.
    const pinned = await call(boss, "PATCH", `/admin/users/${referrer.userId}/notes/${noteId}`, {
      pinned: true,
    });
    expect(pinned.statusCode, pinned.body).toBe(200);
    const edit = await call(boss, "PATCH", `/admin/users/${referrer.userId}/notes/${noteId}`, {
      body: "rewritten",
    });
    expect(edit.statusCode).toBe(403);

    const list = (await call(support, "GET", `/admin/users/${referrer.userId}/notes`)).json();
    expect(list.items[0]).toMatchObject({ id: noteId, pinned: true });
    expect(list.items).toHaveLength(2);

    const other = await ctx.admin("support");
    const refused = await call(other, "DELETE", `/admin/users/${referrer.userId}/notes/${noteId}`);
    expect(refused.statusCode).toBe(403);
    const byAuthor = await call(support, "DELETE", `/admin/users/${referrer.userId}/notes/${noteId}`);
    expect(byAuthor.statusCode, byAuthor.body).toBe(200);

    const second = (await call(support, "GET", `/admin/users/${referrer.userId}/notes`)).json()
      .items[0].id as string;
    expect((await call(boss, "DELETE", `/admin/users/${referrer.userId}/notes/${second}`)).statusCode).toBe(
      200,
    );
    expect(await ctx.owner.db.select().from(userNotes).where(eq(userNotes.userId, referrer.userId))).toEqual(
      [],
    );
  });

  it("pages pinned-first notes by cursor", async () => {
    const target = customer.userId;
    const rows = await ctx.owner.db.select().from(userNotes).where(eq(userNotes.userId, target));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const part: Page = (
        await call(support, "GET", `/admin/users/${target}/notes?limit=1${cursor ? `&cursor=${cursor}` : ""}`)
      ).json();
      seen.push(...part.items.map((item: { id: string }) => item.id));
      cursor = part.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(rows.length);
  });
});

describe("quick actions", () => {
  it("assigns an untargeted coupon to the user and refuses one aimed at someone else", async () => {
    const [free] = await ctx.owner.db
      .insert(coupons)
      .values({ code: "U360FREE", kind: "percent", name: "f", titleAr: "ك", titleEn: "f", value: 500, status: "active" })
      .returning({ id: coupons.id });
    const [taken] = await ctx.owner.db
      .insert(coupons)
      .values({
        code: "U360TAKEN",
        kind: "percent",
        name: "t",
        titleAr: "ك",
        titleEn: "t",
        value: 500,
        status: "active",
        targetUserId: referrer.userId,
      })
      .returning({ id: coupons.id });
    const marketing = await ctx.admin("marketing");
    const ok = await call(marketing, "POST", `/admin/users/${customer.userId}/coupon-grant`, {
      couponId: free?.id,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const [row] = await ctx.owner.db.select().from(coupons).where(eq(coupons.id, free?.id ?? ""));
    expect(row?.targetUserId).toBe(customer.userId);
    const refused = await call(marketing, "POST", `/admin/users/${customer.userId}/coupon-grant`, {
      couponId: taken?.id,
    });
    expect(refused.statusCode).toBe(409);
    expect((await ctx.auditRowsFor("user.coupon_granted", customer.userId))[0]?.after).toEqual({
      couponId: free?.id,
    });
  });

  it("creates a personal offer with a server deadline", async () => {
    const [promotion] = await ctx.owner.db
      .insert(promotions)
      .values({ kind: "percent", name: "p", titleAr: "ع", titleEn: "p", value: 1_000, status: "active" })
      .returning({ id: promotions.id });
    const marketing = await ctx.admin("marketing");
    const before = Date.now();
    const response = await call(marketing, "POST", `/admin/users/${customer.userId}/personal-offer`, {
      promotionId: promotion?.id,
      validHours: 48,
    });
    expect(response.statusCode, response.body).toBe(200);
    const [offer] = await ctx.owner.db
      .select()
      .from(personalOffers)
      .where(eq(personalOffers.ownerUserId, customer.userId));
    expect(offer?.promotionId).toBe(promotion?.id);
    const expected = before + 48 * 3_600_000;
    expect(Math.abs((offer?.expiresAt.getTime() ?? 0) - expected)).toBeLessThan(60_000);
  });

  it("adjusts points, never below zero, with a fresh sign-in and an idempotency id", async () => {
    const rewardsAdmin = await ctx.admin(await ctx.customRole(["users.read", "rewards.adjust"]));
    const adjust = (amount: number, requestId: string) =>
      call(rewardsAdmin, "POST", `/admin/users/${customer.userId}/points-adjust`, {
        amount,
        bucket: "cash",
        reason: "goodwill",
        requestId,
      });
    const requestA = randomUUID();
    const first = await adjust(500, requestA);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().wallet.cash).toBe(500);
    // The same request id is a replay, not a second credit.
    expect((await adjust(500, requestA)).json()).toMatchObject({ replayed: true, wallet: { cash: 500 } });
    expect((await adjust(-300, randomUUID())).json().wallet.cash).toBe(200);
    const over = await adjust(-300, randomUUID());
    expect(over.statusCode).toBe(409);
    const [wallet] = await ctx.owner.db
      .select()
      .from(pointsWallets)
      .where(eq(pointsWallets.userId, customer.userId));
    expect(wallet?.cash).toBe(200);
    const kinds = await ctx.owner.db
      .select({ kind: pointsLedger.kind })
      .from(pointsLedger)
      .where(eq(pointsLedger.walletId, wallet?.id ?? ""));
    expect(kinds.every((row) => row.kind === "admin_adjust")).toBe(true);

    await ctx.makeSessionStale(rewardsAdmin.userId);
    const stale = await adjust(10, randomUUID());
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toMatchObject({ code: "AUTH_REQUIRED", details: { reason: "reauth" } });
  });

  it("voids a held referral, then refuses to void it again", async () => {
    const marketing = await ctx.admin("marketing");
    const url = `/admin/referrals/${referralId}/void`;
    const first = await call(marketing, "POST", url, { reason: "same device as the referrer" });
    expect(first.statusCode, first.body).toBe(200);
    const [row] = await ctx.owner.db.select().from(referrals).where(eq(referrals.id, referralId));
    expect(row?.status).toBe("void");
    expect((await call(marketing, "POST", url, { reason: "again please" })).statusCode).toBe(409);
    expect((await ctx.auditRowsFor("referral.void", referralId))[0]?.actorId).toBe(marketing.userId);
  });

  it("releases a held referral and blocks a referrer with all their referrals", async () => {
    const marketing = await ctx.admin("marketing");
    const [program] = await ctx.owner.db
      .select({ id: referralPrograms.id })
      .from(referralPrograms)
      .where(eq(referralPrograms.key, "u360_prog"));
    const [code] = await ctx.owner.db
      .select({ id: referralCodes.id })
      .from(referralCodes)
      .where(eq(referralCodes.code, "NADIA360"));
    const makeReferral = async () => {
      const referee = await ctx.insertUser({
        name: "Referee",
        email: `referee-${randomUUID().slice(0, 8)}@example.com`,
      });
      const [row] = await ctx.owner.db
        .insert(referrals)
        .values({
          refereeUserId: referee,
          referrerUserId: referrer.userId,
          codeId: code?.id ?? "",
          programId: program?.id ?? "",
          status: "held",
        })
        .returning({ id: referrals.id });
      return row?.id ?? "";
    };
    const toRelease = await makeReferral();
    const released = await call(marketing, "POST", `/admin/referrals/${toRelease}/release`, {
      reason: "checked by hand",
    });
    expect(released.statusCode, released.body).toBe(200);
    const [after] = await ctx.owner.db.select().from(referrals).where(eq(referrals.id, toRelease));
    expect(after?.status).not.toBe("held");

    const toBlock = await makeReferral();
    const blocked = await call(marketing, "POST", `/admin/referrals/${toBlock}/block-referrer`, {
      reason: "farming accounts",
    });
    expect(blocked.statusCode, blocked.body).toBe(200);
    const [row] = await ctx.owner.db.select().from(referrals).where(eq(referrals.id, toBlock));
    expect(row?.status).toBe("blocked");
    const [paused] = await ctx.owner.db
      .select({ active: referralCodes.active })
      .from(referralCodes)
      .where(eq(referralCodes.code, "NADIA360"));
    expect(paused?.active).toBe(false);
    expect(
      (
        await ctx.owner.db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.action, "referral.block_referrer"), eq(auditLogs.targetId, toBlock)))
      ).length,
    ).toBe(1);
  });
});

describe("search by phone and e-mail fragments", () => {
  it("finds the user by the last four digits and by an e-mail fragment", async () => {
    for (const q of ["7890", "567890", customer.email.slice(2, 9)]) {
      const response = await ctx.harness.call("GET", `/admin/search?q=${encodeURIComponent(q)}`, {
        jar: support.jar,
      });
      expect(response.statusCode, q).toBe(200);
      const ids = (response.json().items as Array<{ id: string }>).map((item) => item.id);
      expect(ids, q).toContain(customer.userId);
    }
  });

  it("keeps the zeros of a typed tail: a phone ending in 0123 is found by 0123", async () => {
    const other = await ctx.harness.signedInUser();
    await ctx.owner.db.update(users).set({ phone: "+201055500123" }).where(eq(users.id, other.userId));
    const response = await ctx.harness.call("GET", `/admin/search?q=0123`, { jar: support.jar });
    expect(response.statusCode).toBe(200);
    expect((response.json().items as Array<{ id: string }>).map((item) => item.id)).toContain(other.userId);
  });
});

/*
 * Permission register. Each row names the permissions a caller needs; a caller holding every other
 * permission but that one must get 403.
 */
type Route = { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; needs: Permission[] };
const routes = (): Route[] => [
  { method: "GET", path: `/admin/users/${MISSING_ID}/summary`, needs: ["users.read"] },
  { method: "POST", path: `/admin/users/${MISSING_ID}/reveal-contact`, needs: ["users.read"] },
  { method: "GET", path: `/admin/users/${MISSING_ID}/timeline`, needs: ["users.read"] },
  { method: "GET", path: `/admin/users/${MISSING_ID}/billing`, needs: ["billing.read"] },
  { method: "GET", path: `/admin/users/${MISSING_ID}/credits`, needs: ["users.read", "usage.read"] },
  { method: "GET", path: `/admin/users/${MISSING_ID}/referrals`, needs: ["referrals.read"] },
  { method: "GET", path: `/admin/users/${MISSING_ID}/notes`, needs: ["users.read"] },
  { method: "POST", path: `/admin/users/${MISSING_ID}/notes`, needs: ["users.read"] },
  { method: "PATCH", path: `/admin/users/${MISSING_ID}/notes/${MISSING_ID}`, needs: ["users.read"] },
  { method: "DELETE", path: `/admin/users/${MISSING_ID}/notes/${MISSING_ID}`, needs: ["users.read"] },
  { method: "POST", path: `/admin/users/${MISSING_ID}/plan-change/preview`, needs: ["users.upgrade"] },
  { method: "POST", path: `/admin/users/${MISSING_ID}/plan-change`, needs: ["users.upgrade"] },
  { method: "POST", path: `/admin/orgs/${MISSING_ID}/plan-change/preview`, needs: ["users.upgrade"] },
  { method: "POST", path: `/admin/orgs/${MISSING_ID}/plan-change`, needs: ["users.upgrade"] },
  { method: "POST", path: `/admin/users/${MISSING_ID}/coupon-grant`, needs: ["coupons.write"] },
  { method: "POST", path: `/admin/users/${MISSING_ID}/personal-offer`, needs: ["promotions.write"] },
  { method: "POST", path: `/admin/users/${MISSING_ID}/points-adjust`, needs: ["rewards.adjust"] },
  { method: "POST", path: `/admin/referrals/${MISSING_ID}/release`, needs: ["referrals.write"] },
  { method: "POST", path: `/admin/referrals/${MISSING_ID}/void`, needs: ["referrals.write"] },
  { method: "POST", path: `/admin/referrals/${MISSING_ID}/block-referrer`, needs: ["referrals.write"] },
];

describe("permissions", () => {
  // One admin per distinct permission set keeps the sign-ins down.
  const byKey = new Map<string, Admin>();
  const adminFor = async (key: string, make: () => Promise<string>) => {
    const known = byKey.get(key);
    if (known) return known;
    const created = await ctx.admin(await make());
    byKey.set(key, created);
    return created;
  };

  it("refuses every route to a caller who lacks one of its permissions", async () => {
    for (const route of routes()) {
      for (const missing of route.needs) {
        const who = await adminFor(`lacking:${missing}`, () => ctx.roleLacking(missing));
        const response = await call(who, route.method, route.path, {});
        expect(response.statusCode, `${route.method} ${route.path} without ${missing}`).toBe(403);
      }
    }
    expect(PERMISSION_KEYS.length).toBeGreaterThan(0);
  });

  it("lets a caller holding exactly the needed permissions past the guard", async () => {
    for (const route of routes()) {
      const who = await adminFor(`only:${route.needs.join("+")}`, () => ctx.customRole(route.needs));
      const response = await call(who, route.method, route.path, {});
      // A missing user or a bad body, never a refusal for lack of permission.
      expect(response.statusCode, `${route.method} ${route.path}`).not.toBe(403);
    }
  });
});
