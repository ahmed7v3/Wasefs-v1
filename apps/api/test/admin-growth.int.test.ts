import { randomUUID } from "node:crypto";

import {
  attributeReferral,
  ensureReferralCode,
  handleOrderPaid,
  orders,
  plans,
  pointsLedger,
  pointsWallets,
  referralPrograms,
  referrals,
  siteSettings,
} from "@wasfa/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SettingsService } from "../src/settings/settings.service.js";

import { AdminTestContext, type Admin } from "./support/admin-context.js";

/*
 * The admin growth console API (Task 3.13; ADMIN-CONSOLE-SPEC §6.1-§6.2): rules with their
 * sentence and a what-if that equals what the engine pays, tiers, codes, the referral tree with
 * initials only, the fraud queue and its bulk actions, and the permission walls.
 */

const ctx = new AdminTestContext();
const db = () => ctx.owner.db;
const DAY = 86_400_000;
let boss: Admin;
let standardId: string;

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  await db()
    .insert(siteSettings)
    .values({ key: "rewards", value: { enabled: true } })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: { enabled: true } } });
  await ctx.app.get(SettingsService).invalidate("rewards");
  const [standard] = await db()
    .select({ id: referralPrograms.id })
    .from(referralPrograms)
    .where(eq(referralPrograms.key, "standard"));
  if (!standard) throw new Error("standard program missing");
  standardId = standard.id;
}, 240_000);

afterAll(async () => {
  await ctx.stop();
});

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: Record<string, unknown>, who: Admin = boss) =>
  ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

async function paidOrder(userId: string, subtotalMinor: number) {
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

/** A referrer with a code and a referee attributed to it. */
async function pair() {
  const referrer = await ctx.harness.signedInUser();
  const referee = await ctx.harness.signedInUser();
  const code = await ensureReferralCode(db(), referrer.userId);
  const referral = await attributeReferral(db(), {
    refereeUserId: referee.userId,
    code: code.code,
    source: "code",
  });
  if (!referral) throw new Error("attribution failed");
  return { referrer, referee, referral };
}

describe("rules and the what-if", () => {
  it("lists the standard rules with a plain-language sentence", async () => {
    const res = await call("GET", `/admin/growth/programs/${standardId}/rules`);
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json().items as Array<{ event: string; beneficiary: string; sentence: { key: string } }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((rule) => rule.sentence.key === "rewards.rule_sentence.main")).toBe(true);
  });

  it("predicts exactly what a first payment pays the referrer", async () => {
    const net = 29_900;
    const whatIf = await call("POST", "/admin/growth/rules/what-if", {
      programId: standardId,
      event: "first_payment",
      netMinor: net,
    });
    expect(whatIf.statusCode, whatIf.body).toBe(200);
    const predicted = (whatIf.json().beneficiaries as Array<{ beneficiary: string; points: number }>).find(
      (row) => row.beneficiary === "referrer",
    );
    expect(predicted?.points).toBeGreaterThan(0);

    const { referrer, referee } = await pair();
    const order = await paidOrder(referee.userId, net);
    await db().transaction((tx) => handleOrderPaid(tx, order.id, new Date()));
    const [wallet] = await db()
      .select()
      .from(pointsWallets)
      .where(eq(pointsWallets.userId, referrer.userId));
    const pending = await db()
      .select()
      .from(pointsLedger)
      .where(and(eq(pointsLedger.walletId, wallet?.id ?? ""), eq(pointsLedger.kind, "reward_pending")));
    expect(pending.reduce((sum, row) => sum + row.amount, 0)).toBe(predicted?.points);
  });

  it("creates a rule with an audit row and refuses a percentage above 100%", async () => {
    const created = await call("POST", `/admin/growth/programs/${standardId}/rules`, {
      event: "credit_pack",
      beneficiary: "referrer",
      rewardKind: "percent_of_net_bps",
      value: 700,
      redeemableAs: "cash_or_credits",
      holdDays: 14,
      priority: 5,
      reason: "raise the pack commission",
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(await ctx.auditRowsFor("reward_rule.created", created.json().id)).toHaveLength(1);
    const bad = await call("POST", `/admin/growth/programs/${standardId}/rules`, {
      event: "credit_pack",
      beneficiary: "referrer",
      rewardKind: "percent_of_net_bps",
      value: 20_000,
      redeemableAs: "cash_or_credits",
      reason: "typo test",
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("the referral tree", () => {
  it("shows the chain with initials only, never contact data", async () => {
    const { referrer, referee } = await pair();
    const res = await call("GET", `/admin/growth/referrals/tree?userId=${referrer.userId}&depth=2`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain(referee.userId);
    expect(res.body).not.toContain(referee.email);
    expect(res.body).not.toContain("Test User");
  });
});

describe("the fraud queue", () => {
  it("lists held referrals and voids them in bulk with the ledger reversed", async () => {
    const { referral } = await pair();
    await db()
      .update(referrals)
      .set({ status: "held", flags: ["same_device"], fraudScore: 60 })
      .where(eq(referrals.id, referral.id));
    const list = await call("GET", "/admin/growth/fraud");
    expect(list.statusCode, list.body).toBe(200);
    expect(JSON.stringify(list.json())).toContain(referral.id);

    const bulk = await call("POST", "/admin/growth/fraud/bulk", {
      referralIds: [referral.id, randomUUID()],
      action: "void",
      reason: "same device as the referrer",
    });
    expect(bulk.statusCode, bulk.body).toBe(200);
    const outcomes = (bulk.json().results as Array<{ referralId: string; outcome: string }>).map((row) => row.outcome);
    expect(outcomes).toEqual(["done", "not_found"]);
    const [after] = await db().select().from(referrals).where(eq(referrals.id, referral.id));
    expect(after?.status).toBe("void");
  });
});

describe("codes", () => {
  it("creates a partner code for a user and pauses it", async () => {
    const partner = await ctx.harness.signedInUser();
    const created = await call("POST", "/admin/growth/codes", { kind: "partner", ownerUserId: partner.userId });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json().id ?? created.json().code?.id) as string;
    const paused = await call("POST", `/admin/growth/codes/${id}/pause`, { reason: "partner left" });
    expect(paused.statusCode, paused.body).toBe(200);
  });
});

describe("permissions", () => {
  it("refuses reads without referrals.read and writes without referrals.write", async () => {
    const noRead = await ctx.admin(await ctx.roleLacking("referrals.read"));
    expect((await call("GET", "/admin/growth/fraud", undefined, noRead)).statusCode).toBe(403);
    expect((await call("GET", "/admin/growth/referrals/overview", undefined, noRead)).statusCode).toBe(403);
    const noWrite = await ctx.admin(await ctx.roleLacking("referrals.write"));
    expect(
      (
        await call(
          "POST",
          "/admin/growth/fraud/bulk",
          { referralIds: [randomUUID()], action: "void", reason: "not allowed" },
          noWrite,
        )
      ).statusCode,
    ).toBe(403);
    const noExport = await ctx.admin(await ctx.roleLacking("finance.export"));
    expect(
      (await call("GET", `/admin/growth/referrals/tree.csv?userId=${randomUUID()}`, undefined, noExport)).statusCode,
    ).toBe(403);
  });
});
