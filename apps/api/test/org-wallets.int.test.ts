import { randomUUID } from "node:crypto";

import {
  creditLedger,
  creditReservations,
  creditWallets,
  onboardingProgress,
  organizationMemberLimits,
  organizationMembers,
  organizations,
  orders,
  plans,
  users,
  type WalletOwner,
} from "@wasfa/db";
import { AppError } from "@wasfa/shared/errors";
import { createOrderResponseSchema, quoteResponseSchema } from "@wasfa/shared/schemas/billing";
import { meCreditsResponseSchema, type MeCreditsResponse } from "@wasfa/shared/schemas/credits";
import { maskInviteTarget, orgDashboardSchema } from "@wasfa/shared/schemas/org";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CreditsService } from "../src/credits/credits.service.js";
import { SEAT_LIMIT_SOURCE, type SeatLimitSource } from "../src/orgs/seats/seat-limit.js";
import { PayerService, type PayerContext } from "../src/orgs/wallet/payer.service.js";

import { AdminTestContext, type Person } from "./support/admin-context.js";
import { insertOrg } from "./support/identity-fixtures.js";
import { wrongOwnerIsHidden } from "./support/wrong-owner.js";

/*
 * Organization wallets, member caps, the org dashboard and org-owned billing (Task 3.9) against a
 * real Postgres 18 and Redis: wallet selection, the fallback switch, caps under parallel load,
 * and the wrong-organization answers.
 */

const ctx = new AdminTestContext();
let payer: PayerService;
let credits: CreditsService;
const PERIOD = "2026-10";

beforeAll(async () => {
  await ctx.start();
  payer = ctx.app.get(PayerService);
  credits = ctx.app.get(CreditsService);
  await ctx.owner.db.update(plans).set({ visibility: "public" }).where(eq(plans.key, "clinic"));
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

const userOwner = (person: Person): WalletOwner => ({ type: "user", id: person.userId });
const orgOwner = (orgId: string): WalletOwner => ({ type: "org", id: orgId });

interface Fixture {
  orgId: string;
  admin: Person;
  member: Person;
}

/** An organization with an admin and a member; `fallback` is the organization's switch. */
async function makeOrg(
  options: { fallback?: boolean; orgCredits?: number } = {},
): Promise<Fixture> {
  const admin = await ctx.harness.signedInUser();
  const member = await ctx.harness.signedInUser();
  const orgId = await insertOrg(ctx.owner.db, {
    createdBy: admin.userId,
    members: [
      { userId: admin.userId, role: "org_admin" },
      { userId: member.userId, role: "org_member" },
    ],
  });
  await ctx.owner.db
    .update(organizations)
    .set({ allowPersonalFallback: options.fallback ?? false })
    .where(eq(organizations.id, orgId));
  if (options.orgCredits) await credits.grant(orgOwner(orgId), options.orgCredits, PERIOD);
  return { orgId, admin, member };
}

async function balanceOf(owner: WalletOwner): Promise<number> {
  const wallet = await credits.ensureWallet(owner);
  return wallet.balance;
}

let keyCounter = 0;
const options = () => ({
  idempotencyKey: `org-wallet-${String(++keyCounter)}-${randomUUID()}`,
  purpose: "test",
});

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected the call to be refused");
}

async function contextFor(person: Person, orgId: string): Promise<PayerContext> {
  return payer.resolve(person.userId, orgId);
}

describe("wallet selection", () => {
  it("a member spends the organization's credits first and the charge is theirs", async () => {
    const { orgId, member } = await makeOrg({ orgCredits: 100 });
    await credits.grant(userOwner(member), 50, PERIOD);

    const ctxOrg = await contextFor(member, orgId);
    expect(ctxOrg).toMatchObject({ payer: "org", planOwner: orgOwner(orgId) });
    const paid = await payer.reserve(ctxOrg, 10, options());
    expect(paid).toMatchObject({ walletOwner: orgOwner(orgId), usedFallback: false });
    expect(await balanceOf(orgOwner(orgId))).toBe(90);

    await credits.settle(paid.reservation.id, 7);
    expect(await balanceOf(orgOwner(orgId))).toBe(93);
    expect(await balanceOf(userOwner(member))).toBe(50);

    const [wallet] = await ctx.owner.db
      .select({ id: creditWallets.id })
      .from(creditWallets)
      .where(eq(creditWallets.ownerOrgId, orgId));
    const [settle] = await ctx.owner.db
      .select()
      .from(creditLedger)
      .where(
        and(eq(creditLedger.walletId, wallet?.id ?? ""), eq(creditLedger.kind, "usage_settle")),
      );
    expect(settle).toMatchObject({ amount: -7, actorId: member.userId });
  });

  it("without an organization the personal wallet pays, exactly as before", async () => {
    const { member } = await makeOrg({ orgCredits: 100 });
    await credits.grant(userOwner(member), 20, PERIOD);
    const personal = await payer.resolve(member.userId);
    expect(personal).toMatchObject({ payer: "personal", orgId: null });
    const paid = await payer.reserve(personal, 5, options());
    expect(paid.walletOwner).toEqual(userOwner(member));
    expect(await balanceOf(userOwner(member))).toBe(15);
  });

  it("falls back to the personal wallet when the organization's is short and the switch is on", async () => {
    const { orgId, member } = await makeOrg({ fallback: true, orgCredits: 5 });
    await credits.grant(userOwner(member), 50, PERIOD);
    const paid = await payer.reserve(await contextFor(member, orgId), 10, options());
    expect(paid).toMatchObject({ walletOwner: userOwner(member), usedFallback: true });
    // One reservation, one wallet: the organization's balance was not touched.
    expect(await balanceOf(orgOwner(orgId))).toBe(5);
    expect(await balanceOf(userOwner(member))).toBe(40);
  });

  it("refuses with org_credits_exhausted when the organization's wallet is short and the switch is off", async () => {
    const { orgId, member } = await makeOrg({ fallback: false, orgCredits: 5 });
    await credits.grant(userOwner(member), 50, PERIOD);
    const error = await refusal(payer.reserve(await contextFor(member, orgId), 10, options()));
    expect(error).toMatchObject({
      code: "QUOTA_EXCEEDED",
      details: { reason: "org_credits_exhausted" },
    });
    expect(await balanceOf(userOwner(member))).toBe(50);
    expect(await balanceOf(orgOwner(orgId))).toBe(5);
  });

  it("an organization context needs an active membership: strangers and pending requests get NOT_FOUND", async () => {
    const { orgId } = await makeOrg();
    const stranger = await ctx.harness.signedInUser();
    expect(await refusal(payer.resolve(stranger.userId, orgId))).toMatchObject({
      code: "NOT_FOUND",
    });

    await ctx.owner.db
      .insert(organizationMembers)
      .values({ orgId, userId: stranger.userId, status: "pending" });
    expect(await refusal(payer.resolve(stranger.userId, orgId))).toMatchObject({
      code: "NOT_FOUND",
    });

    // The rx route is for onboarded people; the organization check must still come first.
    await ctx.owner.db
      .insert(onboardingProgress)
      .values({ userId: stranger.userId, currentStep: "done", completedAt: new Date() })
      .onConflictDoNothing();
    const asStranger = await ctx.harness.call("GET", `/me/credits?orgId=${orgId}`, {
      jar: stranger.jar,
    });
    expect(asStranger.statusCode).toBe(404);
    const rx = await ctx.harness.call("POST", "/rx", {
      jar: stranger.jar,
      body: { fileIds: [randomUUID()], orgId },
    });
    expect(rx.statusCode).toBe(404);
    expect(rx.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("GET /me/credits wallets and payer", () => {
  it("lists every wallet and names the payer of the requested context", async () => {
    const { orgId, member } = await makeOrg({ fallback: true, orgCredits: 80 });
    await ctx.owner.db
      .insert(organizationMemberLimits)
      .values({ orgId, userId: member.userId, monthlyCreditCap: 30 });
    await credits.grant(userOwner(member), 12, PERIOD);

    const inOrg = await ctx.harness.call("GET", `/me/credits?orgId=${orgId}`, { jar: member.jar });
    expect(inOrg.statusCode, inOrg.body).toBe(200);
    const body: MeCreditsResponse = meCreditsResponseSchema.parse(inOrg.json());
    expect(body.payer).toEqual({ kind: "org", orgId, fallback: true });
    expect(body.wallet.balance).toBe(12);
    expect(body.wallets).toEqual([
      { kind: "personal", balance: 12 },
      {
        kind: "org",
        orgId,
        orgName: "Fixture Pharmacy",
        balance: 80,
        memberCap: { cap: 30, used: 0 },
      },
    ]);

    const personal = meCreditsResponseSchema.parse(
      (await ctx.harness.call("GET", "/me/credits", { jar: member.jar })).json(),
    );
    expect(personal.payer).toEqual({ kind: "personal", fallback: false });
  });
});

describe("member caps", () => {
  it("lets exactly 3 of 10 parallel reservations through a cap of 3", async () => {
    const { orgId, member } = await makeOrg({ orgCredits: 100 });
    await ctx.owner.db
      .insert(organizationMemberLimits)
      .values({ orgId, userId: member.userId, monthlyCreditCap: 3 });
    const base = await contextFor(member, orgId);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => payer.reserve(base, 1, options())),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    const refused = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(refused).toHaveLength(7);
    for (const { reason } of refused) {
      expect(reason).toMatchObject({
        code: "QUOTA_EXCEEDED",
        details: { reason: "member_cap_reached" },
      });
    }
    expect(await balanceOf(orgOwner(orgId))).toBe(97);
  });

  it("counts settled usage and open holds, per member and per month", async () => {
    const { orgId, member, admin } = await makeOrg({ orgCredits: 100 });
    await ctx.owner.db
      .insert(organizationMemberLimits)
      .values({ orgId, userId: member.userId, monthlyCreditCap: 5 });
    const base = await contextFor(member, orgId);

    const first = await payer.reserve(base, 3, options());
    await credits.settle(first.reservation.id, 3);
    expect(await refusal(payer.reserve(base, 3, options()))).toMatchObject({
      details: { reason: "member_cap_reached" },
    });
    const second = await payer.reserve(base, 2, options());
    expect(second.walletOwner).toEqual(orgOwner(orgId));
    // The cap is the member's own: the admin spends freely.
    await payer.reserve(await contextFor(admin, orgId), 20, options());
  });

  it("falls back to personal credits when the cap is reached and the switch is on", async () => {
    const { orgId, member } = await makeOrg({ fallback: true, orgCredits: 100 });
    await credits.grant(userOwner(member), 10, PERIOD);
    await ctx.owner.db
      .insert(organizationMemberLimits)
      .values({ orgId, userId: member.userId, monthlyCreditCap: 0 });
    const paid = await payer.reserve(await contextFor(member, orgId), 4, options());
    expect(paid).toMatchObject({ walletOwner: userOwner(member), usedFallback: true });
  });

  it("an org admin sets and removes a cap; others cannot", async () => {
    const { orgId, admin, member } = await makeOrg();
    const url = `/orgs/${orgId}/members/${member.userId}/limit`;

    const asMember = await ctx.harness.call("PUT", url, {
      jar: member.jar,
      body: { monthlyCreditCap: 10 },
    });
    expect(asMember.statusCode).toBe(403);

    const stranger = await ctx.harness.signedInUser();
    await wrongOwnerIsHidden({
      intruder: () =>
        ctx.harness.call("PUT", url, { jar: stranger.jar, body: { monthlyCreditCap: 10 } }),
      owner: () => ctx.harness.call("PUT", url, { jar: admin.jar, body: { monthlyCreditCap: 10 } }),
      stillThere: async () => {
        const rows = await ctx.owner.db
          .select()
          .from(organizationMemberLimits)
          .where(eq(organizationMemberLimits.orgId, orgId));
        return rows.length === 0 || rows[0]?.monthlyCreditCap === 10;
      },
    });
    const [row] = await ctx.owner.db
      .select()
      .from(organizationMemberLimits)
      .where(eq(organizationMemberLimits.orgId, orgId));
    expect(row).toMatchObject({ monthlyCreditCap: 10, setBy: admin.userId });

    const cleared = await ctx.harness.call("PUT", url, {
      jar: admin.jar,
      body: { monthlyCreditCap: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(
      await ctx.owner.db
        .select()
        .from(organizationMemberLimits)
        .where(eq(organizationMemberLimits.orgId, orgId)),
    ).toHaveLength(0);

    const notMember = await ctx.harness.call(
      "PUT",
      `/orgs/${orgId}/members/${stranger.userId}/limit`,
      { jar: admin.jar, body: { monthlyCreditCap: 1 } },
    );
    expect(notMember.statusCode).toBe(404);
  });

  it("releasing an open hold gives the member's cap back", async () => {
    const { orgId, member } = await makeOrg({ orgCredits: 100 });
    await ctx.owner.db
      .insert(organizationMemberLimits)
      .values({ orgId, userId: member.userId, monthlyCreditCap: 4 });
    const base = await contextFor(member, orgId);
    const hold = await payer.reserve(base, 4, options());
    expect(await refusal(payer.reserve(base, 1, options()))).toMatchObject({
      details: { reason: "member_cap_reached" },
    });
    await credits.release(hold.reservation.id);
    await payer.reserve(base, 4, options());
    const open = await ctx.owner.db
      .select()
      .from(creditReservations)
      .where(
        and(
          eq(creditReservations.memberUserId, member.userId),
          eq(creditReservations.status, "open"),
        ),
      );
    expect(open.length).toBeGreaterThanOrEqual(1);
  });
});

describe("seats", () => {
  it("refuses an invitation beyond the seat limit and points to the upgrade", async () => {
    const { orgId, admin } = await makeOrg();
    const source = ctx.app.get<SeatLimitSource>(SEAT_LIMIT_SOURCE);
    const spy = vi.spyOn(source, "limitFor").mockResolvedValue(3);
    try {
      const first = await ctx.harness.call("POST", `/orgs/${orgId}/invites`, {
        jar: admin.jar,
        body: { email: `seat-${randomUUID().slice(0, 8)}@example.com` },
      });
      expect(first.statusCode, first.body).toBe(201);
      // Two members plus one open invitation fill the three seats.
      const second = await ctx.harness.call("POST", `/orgs/${orgId}/invites`, {
        jar: admin.jar,
        body: { email: `seat-${randomUUID().slice(0, 8)}@example.com` },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({
        code: "CONFLICT",
        details: { reason: "seat_limit", upgradePath: `/pricing?org=${orgId}` },
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the organization dashboard", () => {
  it("shows wallet, plan, seats, members with usage and caps, and links", async () => {
    const { orgId, admin, member } = await makeOrg({ orgCredits: 100 });
    await ctx.owner.db
      .insert(organizationMemberLimits)
      .values({ orgId, userId: member.userId, monthlyCreditCap: 50 });
    const paid = await payer.reserve(await contextFor(member, orgId), 9, options());
    await credits.settle(paid.reservation.id, 9);

    const res = await ctx.harness.call("GET", `/orgs/${orgId}/dashboard`, { jar: admin.jar });
    expect(res.statusCode, res.body).toBe(200);
    const body = orgDashboardSchema.parse(res.json());
    expect(body.wallet).toEqual({ balance: 91, allowPersonalFallback: false });
    expect(body.seats).toMatchObject({ used: 2, pendingInvites: 0 });
    expect(body.members.find((m) => m.userId === member.userId)).toMatchObject({
      creditsUsed: 9,
      monthlyCap: 50,
    });
    expect(body.joinLinks).toEqual({ total: 0, active: 0, uses: 0 });
    expect(body.recentOrders).toEqual([]);
  });

  it("answers NOT_FOUND to outsiders and FORBIDDEN to plain members, on every organization route", async () => {
    const { orgId, admin, member } = await makeOrg();
    const stranger = await ctx.harness.signedInUser();
    const paths = [
      `/orgs/${orgId}/dashboard`,
      `/orgs/${orgId}/usage.csv`,
      `/orgs/${orgId}/subscription`,
      `/orgs/${orgId}/orders`,
      `/orgs/${orgId}/orders/${randomUUID()}/receipt`,
      `/orgs/${orgId}/join-links`,
    ];
    for (const path of paths) {
      const outsider = await ctx.harness.call("GET", path, { jar: stranger.jar });
      expect(outsider.statusCode, path).toBe(404);
      expect(outsider.json()).toMatchObject({ code: "NOT_FOUND" });
      expect((await ctx.harness.call("GET", path, { jar: member.jar })).statusCode, path).toBe(403);
    }
    await wrongOwnerIsHidden({
      intruder: () => ctx.harness.call("GET", `/orgs/${orgId}/dashboard`, { jar: stranger.jar }),
      owner: () => ctx.harness.call("GET", `/orgs/${orgId}/dashboard`, { jar: admin.jar }),
      stillThere: async () => true,
    });
  });
});

describe("usage export", () => {
  it("writes one row per member with a masked email and defuses formulas", async () => {
    const { orgId, admin, member } = await makeOrg({ orgCredits: 100 });
    await ctx.owner.db
      .update(users)
      .set({ name: '=HYPERLINK("http://evil")' })
      .where(eq(users.id, member.userId));
    const paid = await payer.reserve(await contextFor(member, orgId), 6, options());
    await credits.settle(paid.reservation.id, 6);

    const month = new Date().toISOString().slice(0, 7);
    const res = await ctx.harness.call("GET", `/orgs/${orgId}/usage.csv?month=${month}`, {
      jar: admin.jar,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.body.trimEnd().split("\r\n");
    expect(lines[0]).toBe("member,email,credits_used,analyses");
    const row = lines.find((line) => line.includes("evil"));
    // Quoted because of the comma and quotes inside, and defused by the leading apostrophe.
    expect(row).toBe(`"'=HYPERLINK(""http://evil"")",${maskInviteTarget(member.email)},6,1`);
    expect(res.body).not.toContain(member.email);

    const bad = await ctx.harness.call("GET", `/orgs/${orgId}/usage.csv?month=2026-13`, {
      jar: admin.jar,
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("organization-owned orders", () => {
  async function quoteFor(person: Person, body: Record<string, unknown>) {
    return ctx.harness.call("POST", "/billing/quote", { jar: person.jar, body });
  }

  it("quotes and orders for the organization only as its org_admin, and signs the owner", async () => {
    const { orgId, admin, member } = await makeOrg();
    const stranger = await ctx.harness.signedInUser();
    const request = { planKey: "clinic", months: 1, methodKey: "instapay", orgId };

    expect((await quoteFor(member, request)).statusCode).toBe(403);
    expect((await quoteFor(stranger, request)).statusCode).toBe(404);
    // An organization plan is not for sale to a person.
    expect((await quoteFor(admin, { ...request, orgId: undefined })).statusCode).toBe(404);

    const quoted = await quoteFor(admin, request);
    expect(quoted.statusCode, quoted.body).toBe(200);
    const quote = quoteResponseSchema.parse(quoted.json());

    // The quote belongs to the organization: ordering it as a personal purchase is refused.
    const personal = await ctx.harness.call("POST", "/billing/orders", {
      jar: admin.jar,
      body: { quoteId: quote.quoteId, methodKey: "instapay" },
    });
    expect(personal.statusCode).toBe(409);
    expect(personal.json()).toMatchObject({ code: "QUOTE_EXPIRED" });

    // A second quote: the owner inside the stored quote cannot be edited.
    const again = quoteResponseSchema.parse((await quoteFor(admin, request)).json());
    const key = `billing:quote:${again.quoteId}`;
    const stored = JSON.parse((await ctx.redis.get(key)) ?? "{}") as { orgId: string | null };
    stored.orgId = null;
    await ctx.redis.set(key, JSON.stringify(stored), "KEEPTTL");
    const swapped = await ctx.harness.call("POST", "/billing/orders", {
      jar: admin.jar,
      body: { quoteId: again.quoteId, methodKey: "instapay" },
    });
    expect(swapped.statusCode).toBe(409);

    const third = quoteResponseSchema.parse((await quoteFor(admin, request)).json());
    const asMember = await ctx.harness.call("POST", "/billing/orders", {
      jar: member.jar,
      body: { quoteId: third.quoteId, methodKey: "instapay", orgId },
    });
    expect(asMember.statusCode).toBe(409);

    const created = await ctx.harness.call("POST", "/billing/orders", {
      jar: admin.jar,
      body: { quoteId: third.quoteId, methodKey: "instapay", orgId },
    });
    expect(created.statusCode, created.body).toBe(201);
    const order = createOrderResponseSchema.parse(created.json());
    const [row] = await ctx.owner.db.select().from(orders).where(eq(orders.id, order.orderId));
    expect(row).toMatchObject({ ownerOrgId: orgId, ownerUserId: null });

    // The org admin reads it through both doors; a plain member and a stranger cannot.
    expect(
      (await ctx.harness.call("GET", `/billing/orders/${order.orderId}`, { jar: admin.jar }))
        .statusCode,
    ).toBe(200);
    for (const outsider of [member, stranger]) {
      const hidden = await ctx.harness.call("GET", `/billing/orders/${order.orderId}`, {
        jar: outsider.jar,
      });
      expect(hidden.statusCode).toBe(404);
    }
    const list = await ctx.harness.call("GET", `/orgs/${orgId}/orders`, { jar: admin.jar });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ items: [{ id: order.orderId, receiptAvailable: false }] });
    const subscription = await ctx.harness.call("GET", `/orgs/${orgId}/subscription`, {
      jar: admin.jar,
    });
    expect(subscription.json()).toEqual({ subscription: null, trialAvailable: false });
    // The personal order list does not include the organization's.
    const mine = await ctx.harness.call("GET", "/me/orders", { jar: admin.jar });
    expect(mine.json()).toMatchObject({ items: [] });
  });
});
