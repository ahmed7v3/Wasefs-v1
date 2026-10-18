import { randomUUID } from "node:crypto";

import {
  attributeReferral,
  creditWallets,
  handleMemberJoined,
  handleOrderPaid,
  orders,
  organizationMembers,
  outbox,
  paymentMethods,
  plans,
  pointsWallets,
  referralCodes,
  referralPrograms,
  siteSettings,
  users,
  coupons,
} from "@wasfa/db";
import {
  createOrderResponseSchema,
  quoteResponseSchema,
  simulateBillingResponseSchema,
} from "@wasfa/shared/schemas/billing";
import { dealDetailSchema, simulateDealResponseSchema } from "@wasfa/shared/schemas/deals";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SEAT_LIMIT_SOURCE, type SeatLimitSource } from "../src/orgs/seats/seat-limit.js";

import { AdminTestContext, type Admin, type Person } from "./support/admin-context.js";
import { insertOrg } from "./support/identity-fixtures.js";

/*
 * Deals (Task 3.10) through the real app: the admin CRUD with its audit trail and permissions, the
 * price engine honouring the winning deal (floor, stacking, billing modes), seats, welcome credits,
 * reward overrides for an institution as referrer, and the simulator's explanation.
 */

const ctx = new AdminTestContext();
let boss: Admin;
let counter = 0;
const db = () => ctx.owner.db;

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  await db()
    .update(plans)
    .set({ visibility: "public" })
    .where(inArray(plans.key, ["plus", "pro", "clinic"]));
  await db().insert(paymentMethods).values({
    key: "fake_card",
    kind: "gateway",
    provider: "fake",
    nameAr: "بطاقة تجريبية",
    nameEn: "Test card",
    currencies: ["EGP"],
    feeBps: 0,
    feeFixedMinor: 0,
    enabled: true,
  });
  await db()
    .insert(siteSettings)
    .values({ key: "rewards", value: { enabled: true } })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: { enabled: true } } });
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

const call = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: Record<string, unknown>,
  who: Pick<Admin, "jar"> = boss,
) => ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

const fixedPlus = (amountMinor: number) => ({
  planKey: "plus",
  mode: "fixed",
  amountMinor,
  currency: "EGP",
});

interface DealOptions {
  terms?: Record<string, unknown>;
  targets?: Record<string, unknown>[];
  startsAt?: string;
  endsAt?: string;
}

/** Creates a draft through the API and activates it (fresh session). */
async function liveDeal(name: string, options: DealOptions = {}): Promise<string> {
  const created = await call("POST", "/admin/growth/deals", {
    name: `${name} ${String(++counter)}`,
    terms: { pricing: [fixedPlus(7_900)], ...options.terms },
    targets: options.targets ?? [],
    ...(options.startsAt ? { startsAt: options.startsAt } : {}),
    ...(options.endsAt ? { endsAt: options.endsAt } : {}),
  });
  expect(created.statusCode, created.body).toBe(201);
  const { id } = created.json<{ id: string }>();
  const activated = await call("POST", `/admin/growth/deals/${id}/activate`);
  expect(activated.statusCode, activated.body).toBe(200);
  return id;
}

async function org(name = "صيدلية النور") {
  const admin = await ctx.harness.signedInUser();
  const member = await ctx.harness.signedInUser();
  const orgId = await insertOrg(db(), {
    createdBy: admin.userId,
    name,
    members: [
      { userId: admin.userId, role: "org_admin" },
      { userId: member.userId, role: "org_member" },
    ],
  });
  return { orgId, admin, member };
}

let phoneCounter = 0;
/** Joining through a link needs a verified phone. */
async function verifyPhone(userId: string) {
  await db()
    .update(users)
    .set({
      phone: `+2011${String(20_000_000 + ++phoneCounter + (Date.now() % 50_000_000))}`,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

async function quote(who: Pick<Person, "jar">, body: Record<string, unknown>) {
  const res = await ctx.harness.call("POST", "/billing/quote", { jar: who.jar, body });
  expect(res.statusCode, res.body).toBe(200);
  return quoteResponseSchema.parse(res.json());
}

describe("admin CRUD, audit and permissions", () => {
  it("creates, reads, edits, manages targets and walks the lifecycle, auditing every write", async () => {
    const user = await ctx.harness.signedInUser();
    const created = await call("POST", "/admin/growth/deals", {
      name: "Dr Ahmed deal",
      terms: { pricing: [fixedPlus(7_900)], seats: { maxMembers: 4 } },
      targets: [{ kind: "user", userId: user.userId }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const deal = created.json<{ id: string; status: string; targets: { id: string }[] }>();
    expect(deal.status).toBe("draft");
    expect(deal.targets).toHaveLength(1);
    const id = deal.id;

    const read = await call("GET", `/admin/growth/deals/${id}`);
    const detail = dealDetailSchema.parse(read.json());
    expect(detail.usage).toEqual({ membersSubject: 1, ordersCount: 0, revenueMinor: {} });

    const patched = await call("PATCH", `/admin/growth/deals/${id}`, { name: "Renamed deal" });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ name: "Renamed deal", status: "draft" });
    expect((await call("PATCH", `/admin/growth/deals/${id}`, {})).statusCode).toBe(400);

    const domain = await call("POST", `/admin/growth/deals/${id}/targets`, {
      kind: "email_domain",
      emailDomain: "Alnour-Pharmacy.com",
    });
    expect(domain.statusCode, domain.body).toBe(201);
    expect(domain.json()).toMatchObject({ kind: "email_domain", emailDomain: "alnour-pharmacy.com" });
    const duplicate = await call("POST", `/admin/growth/deals/${id}/targets`, {
      kind: "email_domain",
      emailDomain: "alnour-pharmacy.com",
    });
    expect(duplicate.statusCode).toBe(409);
    const missingUser = await call("POST", `/admin/growth/deals/${id}/targets`, {
      kind: "user",
      userId: randomUUID(),
    });
    expect(missingUser.statusCode).toBe(400);
    const targetId = domain.json<{ id: string }>().id;
    expect((await call("DELETE", `/admin/growth/deals/${id}/targets/${targetId}`)).statusCode).toBe(
      204,
    );
    expect((await call("DELETE", `/admin/growth/deals/${id}/targets/${targetId}`)).statusCode).toBe(
      404,
    );

    expect((await call("POST", `/admin/growth/deals/${id}/pause`)).statusCode).toBe(409);
    expect((await call("POST", `/admin/growth/deals/${id}/activate`)).json()).toMatchObject({
      status: "active",
    });
    expect((await call("POST", `/admin/growth/deals/${id}/activate`)).statusCode).toBe(409);
    expect((await call("POST", `/admin/growth/deals/${id}/pause`)).json()).toMatchObject({
      status: "paused",
    });
    expect((await call("POST", `/admin/growth/deals/${id}/activate`)).json()).toMatchObject({
      status: "active",
    });
    expect((await call("POST", `/admin/growth/deals/${id}/end`)).json()).toMatchObject({
      status: "ended",
    });
    for (const action of ["activate", "pause", "end"]) {
      expect((await call("POST", `/admin/growth/deals/${id}/${action}`)).statusCode).toBe(409);
    }
    expect((await call("PATCH", `/admin/growth/deals/${id}`, { name: "Late" })).statusCode).toBe(409);

    for (const [action, count] of [
      ["deal.created", 1],
      ["deal.updated", 1],
      ["deal.target_added", 1],
      ["deal.target_removed", 1],
      ["deal.activated", 2],
      ["deal.paused", 1],
      ["deal.ended", 1],
    ] as const) {
      expect(await ctx.auditRowsFor(action, id), action).toHaveLength(count);
    }
    const [update] = await ctx.auditRowsFor("deal.updated", id);
    expect(update?.before).toMatchObject({ name: "Dr Ahmed deal" });
    expect(update?.after).toMatchObject({ name: "Renamed deal" });
  });

  it("lists with keyset pagination and filters", async () => {
    const orgFixture = await org();
    const id = await liveDeal("Listed", {
      targets: [{ kind: "organization", orgId: orgFixture.orgId }],
    });
    const filtered = await call(
      "GET",
      "/admin/growth/deals?status=active&targetKind=organization&limit=1",
    );
    expect(filtered.statusCode, filtered.body).toBe(200);
    const page = filtered.json<{ items: { id: string; status: string }[]; nextCursor: string | null }>();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.status).toBe("active");
    if (page.nextCursor) {
      const next = await call(
        "GET",
        `/admin/growth/deals?status=active&targetKind=organization&limit=1&cursor=${page.nextCursor}`,
      );
      expect(next.json<{ items: { id: string }[] }>().items[0]?.id).not.toBe(page.items[0]?.id);
    }
    const byName = await call("GET", "/admin/growth/deals?q=Listed");
    expect(byName.json<{ items: { id: string }[] }>().items.some((item) => item.id === id)).toBe(true);
  });

  it("rejects unknown terms keys and a non-draft creation, and needs the permissions", async () => {
    const unknownKey = await call("POST", "/admin/growth/deals", {
      name: "Typo",
      terms: { pricing: [], stackWithCoupon: true },
    });
    expect(unknownKey.statusCode).toBe(400);
    expect(unknownKey.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    const unknownNested = await call("POST", "/admin/growth/deals", {
      name: "Typo",
      terms: { pricing: [], credits: { welcomeCredits: 1, monthlyBonusCredits: 0, extra: 1 } },
    });
    expect(unknownNested.statusCode).toBe(400);
    const live = await call("POST", "/admin/growth/deals", {
      name: "Sneaky",
      status: "active",
      terms: { pricing: [] },
    });
    expect(live.statusCode).toBe(400);

    const noWrite = await ctx.admin(await ctx.roleLacking("deals.write"));
    const denied = await call("POST", "/admin/growth/deals", { name: "x", terms: {} }, noWrite);
    expect(denied.statusCode).toBe(403);
    expect((await call("GET", "/admin/growth/deals", undefined, noWrite)).statusCode).toBe(200);
    const noRead = await ctx.admin(await ctx.roleLacking("referrals.read"));
    expect((await call("GET", "/admin/growth/deals", undefined, noRead)).statusCode).toBe(403);
    expect(
      (await call("POST", "/admin/growth/deals/simulate", { userId: randomUUID() }, noRead)).statusCode,
    ).toBe(403);

    const stale = await ctx.admin("super_admin");
    const draft = await call("POST", "/admin/growth/deals", { name: "Needs fresh", terms: {} });
    const { id } = draft.json<{ id: string }>();
    await ctx.makeSessionStale(stale.userId);
    const refused = await call("POST", `/admin/growth/deals/${id}/activate`, undefined, stale);
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

describe("prices", () => {
  it("applies a user deal at checkout, stores the deal on the order and names it on the line", async () => {
    const user = await ctx.harness.signedInUser();
    const id = await liveDeal("Special", { targets: [{ kind: "user", userId: user.userId }] });
    const q = await quote(user, { planKey: "plus", months: 1, methodKey: "fake_card" });
    expect(q.quote.applied.dealId).toBe(id);
    expect(q.quote.subtotalMinor).toBe(7_900);
    const line = q.quote.lines.find((l) => l.labelKey === "billing.line.deal");
    expect(line?.meta).toMatchObject({ dealId: id, name: expect.stringContaining("Special") });
    const res = await ctx.harness.call("POST", "/billing/orders", {
      jar: user.jar,
      body: { quoteId: q.quoteId, methodKey: "fake_card" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { orderId } = createOrderResponseSchema.parse(res.json());
    const [row] = await db().select().from(orders).where(eq(orders.id, orderId));
    expect(row?.dealId).toBe(id);
    const usage = dealDetailSchema.parse((await call("GET", `/admin/growth/deals/${id}`)).json()).usage;
    expect(usage.ordersCount).toBe(1);
  });

  it("never prices below the minimum charge", async () => {
    const user = await ctx.harness.signedInUser();
    await liveDeal("Too cheap", {
      terms: { pricing: [fixedPlus(100)] },
      targets: [{ kind: "user", userId: user.userId }],
    });
    const q = await quote(user, { planKey: "plus", months: 1 });
    expect(q.quote.subtotalMinor).toBe(1_000);
  });

  it("stackWithCoupons=false blocks a coupon; true lets it stack on the deal price", async () => {
    const code = `DL${randomUUID().slice(0, 8).toUpperCase()}`;
    await db().insert(coupons).values({
      code,
      kind: "percent",
      name: "Deal test coupon",
      titleAr: "كوبون",
      titleEn: "Coupon",
      value: 1_000,
      status: "active",
    });
    const blocked = await ctx.harness.signedInUser();
    await liveDeal("No stacking", {
      terms: { pricing: [fixedPlus(7_900)], stackWithCoupons: false },
      targets: [{ kind: "user", userId: blocked.userId }],
    });
    const noStack = await quote(blocked, { planKey: "plus", months: 1, couponCode: code });
    expect(noStack.quote.applied.couponId).toBeUndefined();
    expect(noStack.quote.subtotalMinor).toBe(7_900);

    const stacker = await ctx.harness.signedInUser();
    await liveDeal("Stacking", {
      terms: { pricing: [fixedPlus(7_900)], stackWithCoupons: true },
      targets: [{ kind: "user", userId: stacker.userId }],
    });
    const stacked = await quote(stacker, { planKey: "plus", months: 1, couponCode: code });
    expect(stacked.quote.applied.couponId).toBeDefined();
    expect(stacked.quote.subtotalMinor).toBe(7_110);
  });

  it("gives an organization member the member price and org_pays never reaches personal quotes", async () => {
    const fixture = await org();
    const memberDeal = await liveDeal("Members", {
      terms: { membership: { durationMonths: 12, newMembersOnly: false } },
      targets: [{ kind: "organization", orgId: fixture.orgId, memberOnly: true }],
    });
    const personal = await quote(fixture.member, { planKey: "plus", months: 1 });
    expect(personal.quote.applied.dealId).toBe(memberDeal);

    const paying = await org("Pays");
    await liveDeal("Org pays", {
      terms: { billing: { mode: "org_pays" }, pricing: [fixedPlus(7_900), { planKey: "clinic", mode: "percent_off", bps: 1_000 }] },
      targets: [{ kind: "organization", orgId: paying.orgId }],
    });
    const memberQuote = await quote(paying.member, { planKey: "plus", months: 1 });
    expect(memberQuote.quote.applied.dealId).toBeUndefined();
    expect(memberQuote.quote.subtotalMinor).toBe(9_900);
    const orgQuote = await quote(paying.admin, { planKey: "clinic", months: 1, orgId: paying.orgId });
    expect(orgQuote.quote.applied.dealId).toBeDefined();
    expect(orgQuote.quote.subtotalMinor).toBe(89_910);
  });

  it("a manual_invoice organization cannot be quoted for checkout", async () => {
    const fixture = await org("Invoiced");
    await liveDeal("Invoice", {
      terms: { billing: { mode: "manual_invoice" } },
      targets: [{ kind: "organization", orgId: fixture.orgId }],
    });
    const res = await ctx.harness.call("POST", "/billing/quote", {
      jar: fixture.admin.jar,
      body: { planKey: "clinic", months: 1, orgId: fixture.orgId },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "CONFLICT", details: { reason: "manual_invoice" } });
  });
});

describe("effects", () => {
  it("the organization's deal sets its seat limit and refuses a join beyond it", async () => {
    const fixture = await org("Small");
    const source = ctx.app.get<SeatLimitSource>(SEAT_LIMIT_SOURCE);
    await liveDeal("Two seats", {
      terms: { seats: { maxMembers: 2 } },
      targets: [{ kind: "organization", orgId: fixture.orgId }],
    });
    expect(await source.limitFor(fixture.orgId)).toBe(2);
    const link = await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links`, {
      jar: fixture.admin.jar,
      body: { slug: `seats-${randomUUID().slice(0, 8)}` },
    });
    expect(link.statusCode, link.body).toBe(201);
    const joiner = await ctx.harness.signedInUser();
    await verifyPhone(joiner.userId);
    const res = await ctx.harness.call("POST", `/join/${link.json<{ slug: string }>().slug}/accept`, {
      jar: joiner.jar,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: { reason: "seat_limit" } });
    const other = await org("Plain");
    expect(await source.limitFor(other.orgId)).not.toBe(2);
  });

  it("joining through a link pays the welcome credits once", async () => {
    const fixture = await org("Welcome");
    const dealId = await liveDeal("Welcome", {
      terms: { credits: { welcomeCredits: 50, monthlyBonusCredits: 0 } },
      targets: [{ kind: "organization", orgId: fixture.orgId }],
    });
    const link = await ctx.harness.call("POST", `/orgs/${fixture.orgId}/join-links`, {
      jar: fixture.admin.jar,
      body: { slug: `welcome-${randomUUID().slice(0, 8)}`, dealId },
    });
    expect(link.statusCode, link.body).toBe(201);
    const joiner = await ctx.harness.signedInUser();
    await verifyPhone(joiner.userId);
    const res = await ctx.harness.call("POST", `/join/${link.json<{ slug: string }>().slug}/accept`, {
      jar: joiner.jar,
    });
    expect(res.statusCode, res.body).toBe(200);
    const [event] = await db()
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `orgs.member_joined:${fixture.orgId}:${joiner.userId}`));
    expect(event).toBeDefined();
    for (let run = 0; run < 2; run++) {
      await db().transaction((tx) =>
        handleMemberJoined(tx, { orgId: fixture.orgId, userId: joiner.userId }, new Date()),
      );
    }
    const [wallet] = await db()
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.ownerUserId, joiner.userId));
    expect(wallet?.balance).toBe(50);
    // The member also sees the deal's price.
    const q = await quote(joiner, { planKey: "plus", months: 1 });
    expect(q.quote.applied.dealId).toBe(dealId);
  });

  it("a reward override pays 30 percent to the institution's designated owner on a member's first payment", async () => {
    const fixture = await org("Partner Pharmacy");
    const [program] = await db().select().from(referralPrograms).limit(1);
    if (!program) throw new Error("no referral program");
    const [code] = await db()
      .insert(referralCodes)
      .values({
        code: `ORG${String(Date.now()).slice(-9)}`,
        kind: "organization",
        programId: program.id,
        ownerOrgId: fixture.orgId,
      })
      .returning();
    if (!code) throw new Error("code insert failed");
    await liveDeal("Partner rewards", {
      terms: {
        pricing: [],
        rewards: {
          referrerSignupPoints: 100,
          referrerPaymentBps: 3_000,
          refereeSignupCredits: 30,
          maxRenewals: 6,
        },
      },
      targets: [{ kind: "referral_code", referralCodeId: code.id }],
    });
    const friend = await ctx.harness.signedInUser();
    expect(
      await attributeReferral(db(), { refereeUserId: friend.userId, code: code.code, source: "code" }),
    ).not.toBeNull();
    const [plus] = await db().select().from(plans).where(eq(plans.key, "plus"));
    if (!plus) throw new Error("plan missing");
    const [order] = await db()
      .insert(orders)
      .values({
        ownerUserId: friend.userId,
        kind: "subscription",
        planId: plus.id,
        months: 1,
        currency: "EGP",
        quote: {},
        quoteHash: "a".repeat(64),
        subtotalMinor: 29_900,
        totalMinor: 29_900,
        status: "paid",
        paymentKind: "gateway",
        expiresAt: new Date(Date.now() + 86_400_000),
        paidAt: new Date(),
      })
      .returning();
    if (!order) throw new Error("order insert failed");
    const results = await db().transaction((tx) => handleOrderPaid(tx, order.id, new Date()));
    const referrerResult = results.find((r) => r.beneficiary === "referrer");
    expect(referrerResult).toMatchObject({ outcome: "granted", points: 897 });
    const [ownerWallet] = await db()
      .select()
      .from(pointsWallets)
      .where(eq(pointsWallets.userId, fixture.admin.userId));
    expect(ownerWallet?.pending).toBe(897);
    // Replaying pays nothing more.
    await db().transaction((tx) => handleOrderPaid(tx, order.id, new Date()));
    const [again] = await db()
      .select()
      .from(pointsWallets)
      .where(eq(pointsWallets.userId, fixture.admin.userId));
    expect(again?.pending).toBe(897);
    const members = await db()
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, fixture.orgId), eq(organizationMembers.role, "org_admin")));
    expect(members).toHaveLength(1);
  });
});

describe("the simulators", () => {
  it("explains the chosen deal and the losing candidates, before and after", async () => {
    const fixture = await org("صيدلية النور");
    const user = fixture.member;
    const orgDeal = await liveDeal("Org member price", {
      terms: { pricing: [fixedPlus(8_000)] },
      targets: [{ kind: "organization", orgId: fixture.orgId }],
    });
    const userDeal = await liveDeal("Personal price", {
      terms: { pricing: [{ planKey: "pro", mode: "percent_off", bps: 1_000 }] },
      targets: [{ kind: "user", userId: user.userId }],
    });
    const res = await call("POST", "/admin/growth/deals/simulate", {
      userId: user.userId,
      planKey: "plus",
      months: 1,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = simulateDealResponseSchema.parse(res.json());
    expect(body.before?.subtotalMinor).toBe(9_900);
    expect(body.after?.subtotalMinor).toBe(8_000);
    expect(body.deal.chosen?.id).toBe(orgDeal);
    expect(body.deal.chosenBecause).toEqual({
      key: "deals.why.org_member",
      params: { name: expect.stringContaining("Org member price"), org: "صيدلية النور" },
    });
    const lost = body.deal.candidates.find((c) => c.dealId === userDeal);
    expect(lost).toMatchObject({ chosen: false, reason: { key: "deals.lost.no_matching_term" } });

    const asOrg = await call("POST", "/admin/growth/deals/simulate", {
      orgId: fixture.orgId,
      planKey: "clinic",
      months: 1,
    });
    expect(asOrg.statusCode, asOrg.body).toBe(200);
    const orgBody = simulateDealResponseSchema.parse(asOrg.json());
    expect(orgBody.deal.chosen).toBeNull();

    const newcomer = await call("POST", "/admin/growth/deals/simulate", {
      newMember: { orgId: fixture.orgId },
      planKey: "plus",
      months: 1,
    });
    expect(newcomer.statusCode, newcomer.body).toBe(200);
    expect(simulateDealResponseSchema.parse(newcomer.json()).deal.chosen?.id).toBe(orgDeal);

    const bad = await call("POST", "/admin/growth/deals/simulate", {
      userId: user.userId,
      orgId: fixture.orgId,
      planKey: "plus",
      months: 1,
    });
    expect(bad.statusCode).toBe(400);
  });

  it("the billing simulator carries the same deal block", async () => {
    const user = await ctx.harness.signedInUser();
    const id = await liveDeal("Billing sim", { targets: [{ kind: "user", userId: user.userId }] });
    const res = await call("POST", "/admin/billing/simulate", {
      userId: user.userId,
      planKey: "plus",
      months: 1,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = simulateBillingResponseSchema.parse(res.json());
    expect(body.quote?.applied.dealId).toBe(id);
    expect(body.deal.chosen?.id).toBe(id);
    expect(body.deal.chosenBecause?.key).toBe("deals.why.user");
    const none = simulateBillingResponseSchema.parse(
      (await call("POST", "/admin/billing/simulate", { planKey: "plus", months: 1 })).json(),
    );
    expect(none.deal).toEqual({ chosen: null, chosenBecause: null, candidates: [] });
  });
});
