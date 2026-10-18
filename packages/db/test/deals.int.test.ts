import { dealTermsSchema, type DealTerms } from "@wasfa/shared/schemas/deals";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { moveCreditsInTransaction } from "../src/credits-ledger.js";
import {
  dealSeatLimit,
  designatedOrgOwner,
  engineDealOf,
  grantDealMonthlyBonuses,
  grantMemberJoinWelcome,
  grantUserTargetWelcome,
  orgBillingMode,
  resolveDeal,
  type DealSubject,
} from "../src/deals.js";
import { attributeReferral, ensureReferralCode } from "../src/referrals.js";
import {
  creditLedger,
  creditWallets,
  dealTargets,
  deals,
  organizationJoinLinks,
  organizationMembers,
  organizations,
  referrals,
  users,
} from "../src/schema/index.js";
import { seedDefaults } from "../src/seed-data.js";

import { startTestDb, type TestDb } from "./db-fixture.js";
import { unique } from "./schema-kit.js";

/*
 * The deal resolver against a real PostgreSQL 18 (Task 3.10): the precedence matrix, newest wins,
 * expiry and status, membership duration, verified domains, terms that do not match, billing modes
 * and the effects (welcome and monthly credits, seats).
 */

vi.setConfig({ testTimeout: 60_000 });

let testDb: TestDb;
const db = () => testDb.handle.db;
const DAY = 86_400_000;
const NOW = new Date("2026-10-15T12:00:00Z");

beforeAll(async () => {
  testDb = await startTestDb();
  await seedDefaults(db());
}, 180_000);

afterAll(async () => {
  await testDb?.stop();
});

async function newUser(values: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db()
    .insert(users)
    .values({ name: "Dina Member", email: `${unique("dl")}@example.com`, ...values })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

async function newOrg(name = "Al-Nour Pharmacy"): Promise<string> {
  const creator = await newUser();
  const [org] = await db()
    .insert(organizations)
    .values({ name, type: "pharmacy", country: "EG", createdBy: creator })
    .returning({ id: organizations.id });
  if (!org) throw new Error("org insert failed");
  return org.id;
}

async function join(orgId: string, userId: string, joinedAt = new Date(NOW.getTime() - DAY), role: "org_member" | "org_admin" = "org_member") {
  await db().insert(organizationMembers).values({ orgId, userId, joinedAt, role });
}

type TermsInput = Partial<Omit<DealTerms, "pricing">> & { pricing?: unknown[] };
const fixedPlus = (amountMinor = 7_900) => ({
  planKey: "plus",
  mode: "fixed",
  amountMinor,
  currency: "EGP",
});

async function makeDeal(
  name: string,
  target:
    | { kind: "user"; userId: string; memberOnly?: boolean }
    | { kind: "organization"; orgId: string; memberOnly?: boolean }
    | { kind: "referral_code"; referralCodeId: string }
    | { kind: "email_domain"; emailDomain: string },
  options: {
    terms?: TermsInput;
    status?: "draft" | "active" | "paused" | "ended";
    startsAt?: Date | null;
    endsAt?: Date | null;
  } = {},
): Promise<string> {
  const terms = dealTermsSchema.parse({ pricing: [fixedPlus()], ...options.terms });
  const [deal] = await db()
    .insert(deals)
    .values({
      name,
      status: options.status ?? "active",
      startsAt: options.startsAt === undefined ? new Date(NOW.getTime() - 30 * DAY) : options.startsAt,
      endsAt: options.endsAt ?? null,
      terms,
    })
    .returning({ id: deals.id });
  if (!deal) throw new Error("deal insert failed");
  await db()
    .insert(dealTargets)
    .values({
      dealId: deal.id,
      targetKind: target.kind,
      targetUserId: target.kind === "user" ? target.userId : null,
      targetOrgId: target.kind === "organization" ? target.orgId : null,
      referralCodeId: target.kind === "referral_code" ? target.referralCodeId : null,
      emailDomain: target.kind === "email_domain" ? target.emailDomain : null,
      memberOnly: "memberOnly" in target ? (target.memberOnly ?? false) : false,
    });
  return deal.id;
}

const price = (subject: DealSubject, extra: { months?: number; planKey?: string; currency?: string } = {}) =>
  resolveDeal(db(), {
    ...subject,
    planKey: extra.planKey ?? "plus",
    months: extra.months ?? 1,
    currency: extra.currency ?? "EGP",
    now: NOW,
  });

const setStatus = (dealId: string, status: "draft" | "active" | "paused" | "ended") =>
  db().update(deals).set({ status }).where(eq(deals.id, dealId));

describe("precedence", () => {
  it("user > organization membership > referral code > email domain, one step at a time", async () => {
    const domain = `${unique("dom")}.example.com`;
    const referrerId = await newUser();
    const userId = await newUser({ email: `me@${domain}`, emailVerified: true });
    const orgId = await newOrg("صيدلية النور");
    await join(orgId, userId);
    const code = await ensureReferralCode(db(), referrerId);
    await attributeReferral(db(), { refereeUserId: userId, code: code.code, source: "code" });

    const byDomain = await makeDeal("by domain", { kind: "email_domain", emailDomain: domain });
    const byCode = await makeDeal("by code", { kind: "referral_code", referralCodeId: code.id });
    const byOrg = await makeDeal("by org", { kind: "organization", orgId });
    const byUser = await makeDeal("by user", { kind: "user", userId });

    const first = await price({ ownerUserId: userId });
    expect(first.deal?.id).toBe(byUser);
    expect(first.chosenBecause).toEqual({ key: "deals.why.user", params: { name: "by user" } });
    expect(first.candidates.map((c) => c.dealId)).toEqual([byUser, byOrg, byCode, byDomain]);
    expect(first.candidates.filter((c) => c.chosen)).toHaveLength(1);
    expect(first.candidates[1]?.reason).toEqual({
      key: "deals.lost.outranked",
      params: { name: "by org", winner: "by user" },
    });

    await setStatus(byUser, "ended");
    const second = await price({ ownerUserId: userId });
    expect(second.deal?.id).toBe(byOrg);
    expect(second.chosenBecause).toEqual({
      key: "deals.why.org_member",
      params: { name: "by org", org: "صيدلية النور" },
    });

    await setStatus(byOrg, "paused");
    const third = await price({ ownerUserId: userId });
    expect(third.deal?.id).toBe(byCode);
    expect(third.chosenBecause).toEqual({
      key: "deals.why.referral_code",
      params: { name: "by code", code: code.code },
    });

    await setStatus(byCode, "draft");
    const fourth = await price({ ownerUserId: userId });
    expect(fourth.deal?.id).toBe(byDomain);
    expect(fourth.chosenBecause?.key).toBe("deals.why.email_domain");

    await setStatus(byDomain, "ended");
    const none = await price({ ownerUserId: userId });
    expect(none.deal).toBeNull();
    expect(none.candidates).toEqual([]);
  });

  it("within one kind the newest start wins, then the newest creation", async () => {
    const userId = await newUser();
    const older = await makeDeal("older", { kind: "user", userId }, { startsAt: new Date(NOW.getTime() - 20 * DAY) });
    const newer = await makeDeal("newer", { kind: "user", userId }, { startsAt: new Date(NOW.getTime() - 5 * DAY) });
    const result = await price({ ownerUserId: userId });
    expect(result.deal?.id).toBe(newer);
    expect(result.candidates.map((c) => c.dealId)).toEqual([newer, older]);
    const tieA = await makeDeal("tie a", { kind: "user", userId }, { startsAt: new Date(NOW.getTime() - 5 * DAY) });
    await db().update(deals).set({ createdAt: new Date(Date.now() + 60_000) }).where(eq(deals.id, tieA));
    expect((await price({ ownerUserId: userId })).deal?.id).toBe(tieA);
  });

  it("ignores expired, not-yet-started, paused, draft and ended deals", async () => {
    const userId = await newUser();
    await makeDeal("expired", { kind: "user", userId }, { endsAt: new Date(NOW.getTime() - 1_000) });
    await makeDeal("future", { kind: "user", userId }, { startsAt: new Date(NOW.getTime() + DAY) });
    await makeDeal("paused", { kind: "user", userId }, { status: "paused" });
    await makeDeal("draft", { kind: "user", userId }, { status: "draft" });
    await makeDeal("ended", { kind: "user", userId }, { status: "ended" });
    expect((await price({ ownerUserId: userId })).deal).toBeNull();
    // The end is exclusive, the start inclusive.
    const edge = await makeDeal("edge", { kind: "user", userId }, { startsAt: NOW, endsAt: new Date(NOW.getTime() + DAY) });
    expect((await price({ ownerUserId: userId })).deal?.id).toBe(edge);
  });

  it("an email-domain deal needs a verified, non-placeholder email", async () => {
    const domain = `${unique("verify")}.example.com`;
    const unverified = await newUser({ email: `a@${domain}`, emailVerified: false });
    const verified = await newUser({ email: `b@${domain}`, emailVerified: true });
    const dealId = await makeDeal("domain", { kind: "email_domain", emailDomain: domain });
    expect((await price({ ownerUserId: unverified })).deal).toBeNull();
    expect((await price({ ownerUserId: verified })).deal?.id).toBe(dealId);
    const other = await newUser({ email: `c@other-${domain}`, emailVerified: true });
    expect((await price({ ownerUserId: other })).deal).toBeNull();
  });

  it("a deal whose terms have no matching pricing falls through to the next candidate", async () => {
    const userId = await newUser();
    const orgId = await newOrg();
    await join(orgId, userId);
    const fallback = await makeDeal("org any", { kind: "organization", orgId });
    const wrongPlan = await makeDeal("user pro only", { kind: "user", userId }, {
      terms: { pricing: [{ planKey: "pro", mode: "percent_off", bps: 2_000 }] },
    });
    const wrongMonths = await makeDeal("user year only", { kind: "user", userId }, {
      terms: { pricing: [{ ...fixedPlus(), months: [12] }] },
    });
    const wrongCurrency = await makeDeal("user usd", { kind: "user", userId }, {
      terms: { pricing: [{ planKey: "plus", mode: "fixed", amountMinor: 500, currency: "USD" }] },
    });
    const result = await price({ ownerUserId: userId });
    expect(result.deal?.id).toBe(fallback);
    const reasons = Object.fromEntries(result.candidates.map((c) => [c.dealId, c.reason.key]));
    expect(reasons[wrongPlan]).toBe("deals.lost.no_matching_term");
    expect(reasons[wrongMonths]).toBe("deals.lost.no_matching_term");
    expect(reasons[wrongCurrency]).toBe("deals.lost.no_matching_term");
    // The year term matches a 12-month purchase, so that deal now wins over the organization.
    expect((await price({ ownerUserId: userId }, { months: 12 })).candidates.find((c) => c.chosen)?.dealId).toBe(wrongMonths);
  });

  it("maps the winner to the engine input with its name and stacking flags", async () => {
    const userId = await newUser();
    const id = await makeDeal("Engine deal", { kind: "user", userId }, {
      terms: { pricing: [{ planKey: "plus", mode: "percent_off", bps: 2_500 }], stackWithCoupons: true },
    });
    expect(engineDealOf(await price({ ownerUserId: userId }))).toEqual({
      id,
      name: "Engine deal",
      pricing: { mode: "percent_off", bps: 2_500 },
      stackWithPromotions: false,
      stackWithCoupons: true,
    });
    expect(engineDealOf(await price({ ownerUserId: await newUser() }))).toBeNull();
  });
});

describe("membership", () => {
  it("the member price follows the member for durationMonths only", async () => {
    const orgId = await newOrg();
    const dealId = await makeDeal("12 months", { kind: "organization", orgId }, {
      terms: { membership: { durationMonths: 12, newMembersOnly: false } },
    });
    const recent = await newUser();
    await join(orgId, recent, new Date("2026-03-01T00:00:00Z"));
    const old = await newUser();
    await join(orgId, old, new Date("2025-10-14T00:00:00Z"));
    expect((await price({ ownerUserId: recent })).deal?.id).toBe(dealId);
    const expired = await price({ ownerUserId: old });
    expect(expired.deal).toBeNull();
    expect(expired.candidates[0]?.reason.key).toBe("deals.lost.membership_expired");
    // One day inside the window.
    const edge = await newUser();
    await join(orgId, edge, new Date("2025-10-16T00:00:00Z"));
    expect((await price({ ownerUserId: edge })).deal?.id).toBe(dealId);
  });

  it("newMembersOnly excludes people who joined before the deal started", async () => {
    const orgId = await newOrg();
    const dealId = await makeDeal("new only", { kind: "organization", orgId }, {
      startsAt: new Date("2026-10-01T00:00:00Z"),
      terms: { membership: { durationMonths: 12, newMembersOnly: true } },
    });
    const early = await newUser();
    await join(orgId, early, new Date("2026-09-20T00:00:00Z"));
    const late = await newUser();
    await join(orgId, late, new Date("2026-10-05T00:00:00Z"));
    const excluded = await price({ ownerUserId: early });
    expect(excluded.deal).toBeNull();
    expect(excluded.candidates[0]?.reason.key).toBe("deals.lost.not_new_member");
    expect((await price({ ownerUserId: late })).deal?.id).toBe(dealId);
  });

  it("only active members count, and a join link carries its deal to the member", async () => {
    const orgId = await newOrg("Link Clinic");
    const dealId = await makeDeal("link deal", { kind: "user", userId: await newUser() });
    const creator = await newUser();
    const [link] = await db()
      .insert(organizationJoinLinks)
      .values({ orgId, slug: unique("lnk").replaceAll("_", "-"), dealId, createdBy: creator })
      .returning({ id: organizationJoinLinks.id });
    if (!link) throw new Error("link insert failed");
    const pending = await newUser();
    await db().insert(organizationMembers).values({ orgId, userId: pending, status: "pending", joinedViaLinkId: link.id });
    expect((await price({ ownerUserId: pending })).deal).toBeNull();
    const member = await newUser();
    await db().insert(organizationMembers).values({ orgId, userId: member, joinedViaLinkId: link.id });
    const result = await price({ ownerUserId: member });
    expect(result.deal?.id).toBe(dealId);
    expect(result.chosenBecause).toEqual({
      key: "deals.why.join_link",
      params: { name: "link deal", org: "Link Clinic" },
    });
  });

  it("a hypothetical new member of an organization gets that organization's member deal", async () => {
    const orgId = await newOrg();
    const dealId = await makeDeal("welcome", { kind: "organization", orgId }, {
      terms: { membership: { durationMonths: 6, newMembersOnly: true } },
    });
    expect((await price({ newMemberOfOrgId: orgId })).deal?.id).toBe(dealId);
  });
});

describe("organization subject and billing modes", () => {
  it("member_only deals skip the organization's own purchases; the organization's deal skips nobody else", async () => {
    const orgId = await newOrg();
    const memberOnly = await makeDeal("members", { kind: "organization", orgId, memberOnly: true });
    expect((await price({ ownerOrgId: orgId })).deal).toBeNull();
    const member = await newUser();
    await join(orgId, member);
    expect((await price({ ownerUserId: member })).deal?.id).toBe(memberOnly);
    const own = await makeDeal("own", { kind: "organization", orgId });
    expect((await price({ ownerOrgId: orgId })).deal?.id).toBe(own);
  });

  it("org_pays and manual_invoice apply to the organization, not to members' personal quotes", async () => {
    const orgId = await newOrg();
    const member = await newUser();
    await join(orgId, member);
    for (const mode of ["org_pays", "manual_invoice"] as const) {
      const dealId = await makeDeal(`mode ${mode}`, { kind: "organization", orgId }, { terms: { billing: { mode } } });
      const personal = await price({ ownerUserId: member });
      expect(personal.deal).toBeNull();
      expect(personal.candidates[0]?.reason.key).toBe("deals.lost.billing_mode");
      expect((await price({ ownerOrgId: orgId })).deal?.id).toBe(dealId);
      await setStatus(dealId, "ended");
    }
  });

  it("reads the organization's billing mode and seat limit from its deals", async () => {
    const orgId = await newOrg();
    expect(await dealSeatLimit(db(), orgId, NOW)).toBeNull();
    expect(await orgBillingMode(db(), orgId, NOW)).toBeNull();
    await makeDeal("seats", { kind: "organization", orgId }, {
      terms: { seats: { maxMembers: 7 }, billing: { mode: "manual_invoice" } },
    });
    await makeDeal("member seats", { kind: "organization", orgId, memberOnly: true }, {
      terms: { seats: { maxMembers: 99 } },
    });
    expect(await dealSeatLimit(db(), orgId, NOW)).toBe(7);
    expect(await orgBillingMode(db(), orgId, NOW)).toBe("manual_invoice");
  });
});

describe("credit effects", () => {
  const balance = async (owner: { userId?: string; orgId?: string }) => {
    const [wallet] = await db()
      .select()
      .from(creditWallets)
      .where(owner.userId ? eq(creditWallets.ownerUserId, owner.userId) : eq(creditWallets.ownerOrgId, owner.orgId ?? ""));
    return wallet?.balance ?? 0;
  };

  it("pays welcome credits to a joining member once per deal and person", async () => {
    const orgId = await newOrg();
    await makeDeal("welcome", { kind: "organization", orgId }, { terms: { credits: { welcomeCredits: 50, monthlyBonusCredits: 0 } } });
    const member = await newUser();
    await join(orgId, member);
    const granted = await db().transaction((tx) => grantMemberJoinWelcome(tx, { orgId, userId: member }, NOW));
    expect(granted).toBe(50);
    await db().transaction((tx) => grantMemberJoinWelcome(tx, { orgId, userId: member }, NOW));
    expect(await balance({ userId: member })).toBe(50);
    const rows = await db().select().from(creditLedger).where(eq(creditLedger.kind, "reward_bonus"));
    expect(rows.filter((row) => row.idempotencyKey.startsWith("deal_welcome:")).length).toBeGreaterThanOrEqual(1);
  });

  it("pays user targets when the deal goes live, once", async () => {
    const userId = await newUser();
    const dealId = await makeDeal("vip", { kind: "user", userId }, { terms: { credits: { welcomeCredits: 30, monthlyBonusCredits: 0 } } });
    await db().transaction((tx) => grantUserTargetWelcome(tx, dealId, NOW));
    await db().transaction((tx) => grantUserTargetWelcome(tx, dealId, NOW));
    expect(await balance({ userId })).toBe(30);
    const paused = await makeDeal("paused vip", { kind: "user", userId }, { status: "paused", terms: { credits: { welcomeCredits: 10, monthlyBonusCredits: 0 } } });
    await db().transaction((tx) => grantUserTargetWelcome(tx, paused, NOW));
    expect(await balance({ userId })).toBe(30);
  });

  it("pays the monthly bonus into the organization wallet once a month, while active", async () => {
    const orgId = await newOrg();
    const dealId = await makeDeal("monthly", { kind: "organization", orgId }, { terms: { credits: { welcomeCredits: 0, monthlyBonusCredits: 200 } } });
    await grantDealMonthlyBonuses(db(), NOW);
    await grantDealMonthlyBonuses(db(), new Date(NOW.getTime() + DAY));
    expect(await balance({ orgId })).toBe(200);
    await grantDealMonthlyBonuses(db(), new Date("2026-11-02T04:20:00Z"));
    expect(await balance({ orgId })).toBe(400);
    await setStatus(dealId, "paused");
    await grantDealMonthlyBonuses(db(), new Date("2026-12-02T04:20:00Z"));
    expect(await balance({ orgId })).toBe(400);
  });
});

describe("an institution as referrer", () => {
  it("the designated owner is the earliest active org_admin of an organization code", async () => {
    const orgId = await newOrg();
    const late = await newUser();
    const early = await newUser();
    await join(orgId, late, new Date("2026-02-01T00:00:00Z"), "org_admin");
    await join(orgId, early, new Date("2026-01-01T00:00:00Z"), "org_admin");
    const { referralCodes, referralPrograms } = await import("../src/schema/index.js");
    const [program] = await db().select().from(referralPrograms).limit(1);
    if (!program) throw new Error("no program");
    const [code] = await db()
      .insert(referralCodes)
      .values({ code: `ORG${String(Date.now()).slice(-9)}`, kind: "organization", programId: program.id, ownerOrgId: orgId })
      .returning();
    if (!code) throw new Error("code insert failed");
    const friend = await newUser();
    const referral = await attributeReferral(db(), { refereeUserId: friend, code: code.code, source: "code" });
    if (!referral) throw new Error("no referral");
    expect(referral.referrerUserId).toBeNull();
    expect(await designatedOrgOwner(db(), referral)).toBe(early);
    const [row] = await db().select().from(referrals).where(eq(referrals.id, referral.id));
    expect(row?.referrerOrgId).toBe(orgId);
  });
});

describe("sanity", () => {
  it("moveCreditsInTransaction stays idempotent for the deal keys", async () => {
    const userId = await newUser();
    const key = `deal_welcome:${userId}:${userId}`;
    for (let i = 0; i < 2; i++) {
      await db().transaction((tx) =>
        moveCreditsInTransaction(tx, { type: "user", id: userId }, { kind: "reward_bonus", amount: 5, idempotencyKey: key }),
      );
    }
    const [wallet] = await db().select().from(creditWallets).where(eq(creditWallets.ownerUserId, userId));
    expect(wallet?.balance).toBe(5);
  });
});
