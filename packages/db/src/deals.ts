import { isPlaceholderEmail } from "@wasfa/shared/identity";
import {
  dealTermsSchema,
  type DealPricingTerm,
  type DealTerms,
} from "@wasfa/shared/schemas/deals";
import { addMonthsClamped } from "@wasfa/shared/subscriptions";
import { and, asc, eq, gt, inArray, isNull, lte, or, type SQL } from "drizzle-orm";

import { grantPeriod, moveCreditsInTransaction } from "./credits-ledger.js";
import {
  dealTargets,
  deals,
  organizationJoinLinks,
  organizationMembers,
  organizations,
  referralCodes,
  referrals,
  users,
  type Deal,
  type Referral,
} from "./schema/index.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";
import type { RewardDealOverrides, RewardRuleLike } from "./rewards.js";
import type {
  DealBillingMode,
  DealTargetKind,
  RewardBeneficiary,
  RewardEvent,
} from "@wasfa/shared/rewards";

/*
 * Deals (Phase 3, Task 3.10; REFERRALS-REWARDS §7): the one resolver the API (prices, seats) and the
 * worker (rewards, credits) share, so every part of the product agrees on which deal a person is under.
 *
 * Which deal wins. Only `active` deals inside `starts_at <= now < ends_at` (nulls are open) count.
 * Precedence is exact: `user` target > `organization` (the organization itself for its own
 * purchases; for a person, an organization where they are an active member, or the join link they
 * came through) > `referral_code` (the code on the person's referral) > `email_domain` (the
 * person's own domain, only with a verified, non-placeholder email). Within a kind the newest
 * `starts_at` wins (then `created_at`; an open start counts as `created_at`). One deal reached in
 * several ways counts once, by its best way.
 *
 * Pricing falls through: the winner must have a pricing term for the plan, the period (absent =
 * all) and, for `fixed`, the currency; otherwise the next candidate is tried. The engine, not this
 * module, keeps a deal from going below min(list, minCharge) and enforces the stacking flags.
 *
 * Membership. A deal reached through membership obeys `terms.membership`: it applies only while
 * `now < joined_at + durationMonths`, and with `newMembersOnly` only to people who joined at or
 * after the deal's start. A target's `member_only` means members, not the organization's own purchases.
 *
 * Billing mode (`terms.billing.mode`). `self_pay` is normal. With `org_pays` or `manual_invoice`
 * the deal's pricing does NOT apply to members' personal quotes (members use the organization's
 * context and wallet); it applies to the organization's own quotes. `manual_invoice` also stops the
 * organization from paying at checkout: its admin records the payment offline (`orgBillingMode`).
 *
 * Effects beyond price live here too: welcome and monthly bonus credits (credit ledger kind
 * `reward_bonus`, idempotent), the seat limit, and the reward overrides of REFERRALS §7.
 */

type Handle = Database | Transaction;

export type DealVia =
  | "user"
  | "org_owner"
  | "org_member"
  | "join_link"
  | "referral_code"
  | "email_domain";

/** Who the deal is for: a person, an organization, or a person who would join an organization now. */
export interface DealSubject {
  ownerUserId?: string | undefined;
  ownerOrgId?: string | undefined;
  /** The simulator's "new member": nobody yet, but someone who joins this organization right now. */
  newMemberOfOrgId?: string | undefined;
}

export interface DealExplanation {
  key: string;
  params: Record<string, string | number>;
}

export type DealSkip = "invalid_terms" | "membership_expired" | "not_new_member";

export interface DealCandidate {
  deal: Deal;
  /** Null only when `skip` is `invalid_terms`. */
  terms: DealTerms | null;
  kind: DealTargetKind;
  via: DealVia;
  orgId: string | null;
  referralCodeId: string | null;
  emailDomain: string | null;
  skip: DealSkip | null;
}

const RANK: Record<DealVia, number> = {
  user: 0,
  org_owner: 1,
  org_member: 1,
  join_link: 1,
  referral_code: 2,
  email_domain: 3,
};

const KIND: Record<DealVia, DealTargetKind> = {
  user: "user",
  org_owner: "organization",
  org_member: "organization",
  join_link: "organization",
  referral_code: "referral_code",
  email_domain: "email_domain",
};

const isMembership = (via: DealVia) => via === "org_member" || via === "join_link";
const effectiveStart = (deal: Deal) => (deal.startsAt ?? deal.createdAt).getTime();

const liveDeal = (now: Date): SQL | undefined =>
  and(
    eq(deals.status, "active"),
    or(isNull(deals.startsAt), lte(deals.startsAt, now)),
    or(isNull(deals.endsAt), gt(deals.endsAt, now)),
  );

/** `and` of conditions that are all present (the type of `and` allows none). */
function allOf(...parts: SQL[]): SQL {
  const combined = and(...parts);
  if (!combined) throw new Error("allOf needs at least one condition");
  return combined;
}

function compareCandidates(a: DealCandidate, b: DealCandidate): number {
  return (
    RANK[a.via] - RANK[b.via] ||
    effectiveStart(b.deal) - effectiveStart(a.deal) ||
    b.deal.createdAt.getTime() - a.deal.createdAt.getTime() ||
    (a.deal.id < b.deal.id ? 1 : a.deal.id > b.deal.id ? -1 : 0)
  );
}

interface Membership {
  orgId: string;
  joinedAt: Date;
  linkId: string | null;
}

interface PersonFacts {
  codeId: string | null;
  domain: string | null;
  memberships: Membership[];
}

async function personFacts(db: Handle, userId: string): Promise<PersonFacts | null> {
  const [user] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;
  const [referral] = await db
    .select({ codeId: referrals.codeId })
    .from(referrals)
    .where(eq(referrals.refereeUserId, userId));
  const memberships = await db
    .select({
      orgId: organizationMembers.orgId,
      joinedAt: organizationMembers.joinedAt,
      linkId: organizationMembers.joinedViaLinkId,
    })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")));
  const verified = user.emailVerified && !isPlaceholderEmail(user.email);
  const domain = verified ? (user.email.split("@").at(-1)?.toLowerCase() ?? null) : null;
  return { codeId: referral?.codeId ?? null, domain, memberships };
}

interface RawCandidate {
  deal: Deal;
  via: DealVia;
  orgId: string | null;
  referralCodeId: string | null;
  emailDomain: string | null;
  joinedAt: Date | null;
}

/** Applies the terms' own conditions (valid shape, membership duration, new members only). */
function judge(raw: RawCandidate, now: Date): DealCandidate {
  const base = {
    deal: raw.deal,
    kind: KIND[raw.via],
    via: raw.via,
    orgId: raw.orgId,
    referralCodeId: raw.referralCodeId,
    emailDomain: raw.emailDomain,
  };
  const parsed = dealTermsSchema.safeParse(raw.deal.terms);
  if (!parsed.success) return { ...base, terms: null, skip: "invalid_terms" };
  const terms = parsed.data;
  if (isMembership(raw.via) && raw.joinedAt !== null && terms.membership) {
    if (now >= addMonthsClamped(raw.joinedAt, terms.membership.durationMonths)) {
      return { ...base, terms, skip: "membership_expired" };
    }
    if (terms.membership.newMembersOnly && raw.joinedAt < (raw.deal.startsAt ?? raw.deal.createdAt)) {
      return { ...base, terms, skip: "not_new_member" };
    }
  }
  return { ...base, terms, skip: null };
}

/**
 * Every live deal that reaches the subject, one entry per deal (its best way), best first. Entries
 * the terms themselves rule out (`skip`) stay in the list so the simulator can say why.
 */
export async function dealCandidates(
  db: Handle,
  subject: DealSubject,
  now: Date,
): Promise<DealCandidate[]> {
  const raws: RawCandidate[] = [];
  const add = (
    deal: Deal,
    via: DealVia,
    extra: Partial<Omit<RawCandidate, "deal" | "via">> = {},
  ) =>
    raws.push({
      deal,
      via,
      orgId: null,
      referralCodeId: null,
      emailDomain: null,
      joinedAt: null,
      ...extra,
    });

  if (subject.ownerOrgId) {
    const rows = await db
      .select({ deal: deals })
      .from(dealTargets)
      .innerJoin(deals, eq(deals.id, dealTargets.dealId))
      .where(
        and(
          liveDeal(now),
          eq(dealTargets.targetKind, "organization"),
          eq(dealTargets.targetOrgId, subject.ownerOrgId),
          eq(dealTargets.memberOnly, false),
        ),
      );
    for (const { deal } of rows) add(deal, "org_owner", { orgId: subject.ownerOrgId });
  } else {
    let facts: PersonFacts | null = { codeId: null, domain: null, memberships: [] };
    if (subject.ownerUserId) facts = await personFacts(db, subject.ownerUserId);
    if (subject.newMemberOfOrgId) {
      facts?.memberships.push({ orgId: subject.newMemberOfOrgId, joinedAt: now, linkId: null });
    }
    if (facts) {
      const memberOrgIds = facts.memberships.map((membership) => membership.orgId);
      const clauses: SQL[] = [];
      if (subject.ownerUserId) {
        clauses.push(
          allOf(eq(dealTargets.targetKind, "user"), eq(dealTargets.targetUserId, subject.ownerUserId)),
        );
      }
      if (memberOrgIds.length > 0) {
        clauses.push(
          allOf(
            eq(dealTargets.targetKind, "organization"),
            inArray(dealTargets.targetOrgId, memberOrgIds),
          ),
        );
      }
      if (facts.codeId) {
        clauses.push(
          allOf(
            eq(dealTargets.targetKind, "referral_code"),
            eq(dealTargets.referralCodeId, facts.codeId),
          ),
        );
      }
      if (facts.domain) {
        clauses.push(
          allOf(
            eq(dealTargets.targetKind, "email_domain"),
            eq(dealTargets.emailDomain, facts.domain),
          ),
        );
      }
      if (clauses.length > 0) {
        const rows = await db
          .select({ deal: deals, target: dealTargets })
          .from(dealTargets)
          .innerJoin(deals, eq(deals.id, dealTargets.dealId))
          .where(and(liveDeal(now), or(...clauses)));
        for (const { deal, target } of rows) {
          if (target.targetKind === "user") add(deal, "user");
          else if (target.targetKind === "referral_code") {
            add(deal, "referral_code", { referralCodeId: target.referralCodeId });
          } else if (target.targetKind === "email_domain") {
            add(deal, "email_domain", { emailDomain: target.emailDomain });
          } else {
            const membership = facts.memberships.find((m) => m.orgId === target.targetOrgId);
            add(deal, "org_member", {
              orgId: target.targetOrgId,
              joinedAt: membership?.joinedAt ?? null,
            });
          }
        }
        const linkIds = facts.memberships.flatMap((m) => (m.linkId ? [m.linkId] : []));
        if (linkIds.length > 0) {
          const viaLinks = await db
            .select({ deal: deals, orgId: organizationJoinLinks.orgId, linkId: organizationJoinLinks.id })
            .from(organizationJoinLinks)
            .innerJoin(deals, eq(deals.id, organizationJoinLinks.dealId))
            .where(and(liveDeal(now), inArray(organizationJoinLinks.id, linkIds)));
          for (const { deal, orgId, linkId } of viaLinks) {
            const membership = facts.memberships.find((m) => m.linkId === linkId);
            add(deal, "join_link", { orgId, joinedAt: membership?.joinedAt ?? null });
          }
        }
      }
    }
  }

  // One entry per deal: an eligible way beats a skipped one, then the better precedence.
  const best = new Map<string, DealCandidate>();
  for (const candidate of raws.map((raw) => judge(raw, now))) {
    const current = best.get(candidate.deal.id);
    if (
      !current ||
      (current.skip !== null && candidate.skip === null) ||
      ((current.skip === null) === (candidate.skip === null) && compareCandidates(candidate, current) < 0)
    ) {
      best.set(candidate.deal.id, candidate);
    }
  }
  return [...best.values()].sort(compareCandidates);
}

// --- Pricing ---------------------------------------------------------------------------------------

export interface ResolveDealInput extends DealSubject {
  planKey: string;
  months: number;
  currency: string;
  now: Date;
}

export interface DealCandidateInfo {
  dealId: string;
  name: string;
  kind: DealTargetKind;
  chosen: boolean;
  reason: DealExplanation;
}

export interface DealResolution {
  deal: Deal | null;
  term: DealPricingTerm | null;
  terms: DealTerms | null;
  kind: DealTargetKind | null;
  chosenBecause: DealExplanation | null;
  candidates: DealCandidateInfo[];
}

/** The pricing term for this purchase; a term that names its months beats one for every period. */
function matchTerm(
  pricing: readonly DealPricingTerm[],
  planKey: string,
  months: number,
  currency: string,
): DealPricingTerm | null {
  const matching = pricing.filter(
    (term) =>
      term.planKey === planKey &&
      (term.months === undefined || term.months.includes(months)) &&
      (term.mode !== "fixed" || term.currency === currency),
  );
  return matching.find((term) => term.months !== undefined) ?? matching[0] ?? null;
}

export const dealBillingMode = (terms: DealTerms): DealBillingMode => terms.billing?.mode ?? "self_pay";

async function whyChosen(db: Handle, chosen: DealCandidate): Promise<DealExplanation> {
  const name = chosen.deal.name;
  const orgName = async (): Promise<string> => {
    if (!chosen.orgId) return "";
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, chosen.orgId));
    return org?.name ?? "";
  };
  switch (chosen.via) {
    case "user":
      return { key: "deals.why.user", params: { name } };
    case "org_owner":
      return { key: "deals.why.org_owner", params: { name, org: await orgName() } };
    case "org_member":
      return { key: "deals.why.org_member", params: { name, org: await orgName() } };
    case "join_link":
      return { key: "deals.why.join_link", params: { name, org: await orgName() } };
    case "referral_code": {
      const [code] = chosen.referralCodeId
        ? await db
            .select({ code: referralCodes.code })
            .from(referralCodes)
            .where(eq(referralCodes.id, chosen.referralCodeId))
        : [];
      return { key: "deals.why.referral_code", params: { name, code: code?.code ?? "" } };
    }
    case "email_domain":
      return { key: "deals.why.email_domain", params: { name, domain: chosen.emailDomain ?? "" } };
  }
}

/**
 * The deal that prices this purchase, with the reasons every candidate won or lost (pure reads).
 * `deal` is null when nothing applies.
 */
export async function resolveDeal(db: Handle, input: ResolveDealInput): Promise<DealResolution> {
  const ordered = await dealCandidates(db, input, input.now);
  const verdicts = ordered.map((candidate) => {
    if (candidate.skip !== null || candidate.terms === null) {
      return { candidate, term: null, lost: candidate.skip ?? "invalid_terms" };
    }
    const term = matchTerm(candidate.terms.pricing, input.planKey, input.months, input.currency);
    if (term === null) return { candidate, term: null, lost: "no_matching_term" as const };
    if (isMembership(candidate.via) && dealBillingMode(candidate.terms) !== "self_pay") {
      return { candidate, term: null, lost: "billing_mode" as const };
    }
    return { candidate, term, lost: null };
  });
  const winner = verdicts.find((verdict) => verdict.lost === null);
  const chosenBecause = winner ? await whyChosen(db, winner.candidate) : null;
  const candidates = verdicts.map<DealCandidateInfo>((verdict) => {
    const { deal } = verdict.candidate;
    const chosen = verdict === winner;
    const reason: DealExplanation =
      chosen && chosenBecause
        ? chosenBecause
        : verdict.lost !== null
          ? { key: `deals.lost.${verdict.lost}`, params: { name: deal.name } }
          : { key: "deals.lost.outranked", params: { name: deal.name, winner: winner?.candidate.deal.name ?? "" } };
    return { dealId: deal.id, name: deal.name, kind: verdict.candidate.kind, chosen, reason };
  });
  return {
    deal: winner?.candidate.deal ?? null,
    term: winner?.term ?? null,
    terms: winner?.candidate.terms ?? null,
    kind: winner?.candidate.kind ?? null,
    chosenBecause,
    candidates,
  };
}

/** The engine's `deal` input for a resolution (the engine's own floors and stacking rules apply). */
export function engineDealOf(resolution: DealResolution) {
  const { deal, term, terms } = resolution;
  if (!deal || !term || !terms) return null;
  return {
    id: deal.id,
    name: deal.name,
    pricing:
      term.mode === "fixed"
        ? ({ mode: "fixed", amountMinor: term.amountMinor, currency: term.currency } as const)
        : ({ mode: "percent_off", bps: term.bps } as const),
    stackWithPromotions: terms.stackWithPromotions,
    stackWithCoupons: terms.stackWithCoupons,
  };
}

// --- Effects other than price ----------------------------------------------------------------------

/** The first deal (by precedence) that reaches the subject and whose terms satisfy `wanted`. */
export async function firstDealWith(
  db: Handle,
  subject: DealSubject,
  now: Date,
  wanted: (terms: DealTerms) => boolean,
): Promise<DealCandidate | null> {
  const ordered = await dealCandidates(db, subject, now);
  return ordered.find((c) => c.skip === null && c.terms !== null && wanted(c.terms)) ?? null;
}

/** `terms.seats.maxMembers` of the organization's own deal, or null when no deal sets one. */
export async function dealSeatLimit(
  db: Handle,
  orgId: string,
  now: Date,
): Promise<number | null> {
  const found = await firstDealWith(db, { ownerOrgId: orgId }, now, (t) => t.seats !== undefined);
  return found?.terms?.seats?.maxMembers ?? null;
}

/** The billing mode an organization's own deal sets, or null when none does. */
export async function orgBillingMode(
  db: Handle,
  orgId: string,
  now: Date,
): Promise<DealBillingMode | null> {
  const found = await firstDealWith(db, { ownerOrgId: orgId }, now, (t) => t.billing !== undefined);
  return found?.terms?.billing?.mode ?? null;
}

const dealWelcomeKey = (dealId: string, userId: string) => `deal_welcome:${dealId}:${userId}`;

/** Grants a deal's welcome credits to one person, once per (deal, person). */
async function grantWelcome(tx: Transaction, dealId: string, userId: string, credits: number) {
  await moveCreditsInTransaction(
    tx,
    { type: "user", id: userId },
    {
      kind: "reward_bonus",
      amount: credits,
      idempotencyKey: dealWelcomeKey(dealId, userId),
      reason: "deal:welcome",
    },
  );
}

/**
 * A person joined `orgId`: the deal that reaches them through that organization (membership or the
 * join link) pays its welcome credits, once per (deal, person). Returns the credits granted.
 */
export async function grantMemberJoinWelcome(
  tx: Transaction,
  input: { orgId: string; userId: string },
  now: Date,
): Promise<number> {
  const ordered = await dealCandidates(tx, { ownerUserId: input.userId }, now);
  const found = ordered.find(
    (c) =>
      c.skip === null &&
      isMembership(c.via) &&
      c.orgId === input.orgId &&
      (c.terms?.credits?.welcomeCredits ?? 0) > 0,
  );
  const credits = found?.terms?.credits?.welcomeCredits ?? 0;
  if (!found || credits <= 0) return 0;
  await grantWelcome(tx, found.deal.id, input.userId, credits);
  return credits;
}

/**
 * A deal became live: every `user` target gets its welcome credits (once per deal and person).
 * Returns how many people were considered; people who already had them are unchanged.
 */
export async function grantUserTargetWelcome(
  tx: Transaction,
  dealId: string,
  now: Date,
): Promise<number> {
  const [deal] = await tx
    .select()
    .from(deals)
    .where(and(eq(deals.id, dealId), liveDeal(now)));
  if (!deal) return 0;
  const parsed = dealTermsSchema.safeParse(deal.terms);
  const credits = parsed.success ? (parsed.data.credits?.welcomeCredits ?? 0) : 0;
  if (credits <= 0) return 0;
  const targets = await tx
    .select({ userId: dealTargets.targetUserId })
    .from(dealTargets)
    .where(and(eq(dealTargets.dealId, dealId), eq(dealTargets.targetKind, "user")))
    .orderBy(asc(dealTargets.createdAt), asc(dealTargets.id));
  let considered = 0;
  for (const { userId } of targets) {
    if (userId === null) continue;
    await grantWelcome(tx, dealId, userId, credits);
    considered++;
  }
  return considered;
}

export interface DealBonusResult {
  granted: number;
  failed: number;
}

/**
 * The daily job: every active deal with `credits.monthlyBonusCredits` pays each of its organization
 * targets (not `member_only`) into the organization wallet, once per month
 * (`deal_monthly:<deal>:<org>:<YYYY-MM>`). Each grant is its own transaction.
 */
export async function grantDealMonthlyBonuses(db: Database, now: Date): Promise<DealBonusResult> {
  const rows = await db
    .select({ deal: deals, orgId: dealTargets.targetOrgId })
    .from(dealTargets)
    .innerJoin(deals, eq(deals.id, dealTargets.dealId))
    .where(
      and(
        liveDeal(now),
        eq(dealTargets.targetKind, "organization"),
        eq(dealTargets.memberOnly, false),
      ),
    )
    .orderBy(asc(deals.createdAt), asc(deals.id), asc(dealTargets.id));
  const period = grantPeriod(now);
  const result: DealBonusResult = { granted: 0, failed: 0 };
  for (const { deal, orgId } of rows) {
    const parsed = dealTermsSchema.safeParse(deal.terms);
    const credits = parsed.success ? (parsed.data.credits?.monthlyBonusCredits ?? 0) : 0;
    if (orgId === null || credits <= 0) continue;
    try {
      const moved = await db.transaction((tx) =>
        moveCreditsInTransaction(
          tx,
          { type: "org", id: orgId },
          {
            kind: "reward_bonus",
            amount: credits,
            idempotencyKey: `deal_monthly:${deal.id}:${orgId}:${period}`,
            reason: `deal:monthly:${period}`,
          },
        ),
      );
      if (moved && !moved.replayed) result.granted++;
    } catch {
      // Driver messages can quote row values; the caller only needs to know that one failed.
      result.failed++;
    }
  }
  return result;
}

// --- Reward overrides ------------------------------------------------------------------------------

/** Referrer sign-up points wait this long, like the default rule. */
const SIGNUP_HOLD_DAYS = 3;

/**
 * REFERRALS §7: the deal that reaches the referee overrides the program rules for the events it
 * names. The key part `ref` differs from a program rule's id, so the idempotency keys never clash.
 * A deal without `rewards` (or an event it does not cover) returns null: the program rules apply.
 */
/**
 * The rule a deal's `terms.rewards` stands for, for one event and beneficiary (null when the deal
 * says nothing about it). Pure: the engine's overrides and the admin what-if both use it, so the
 * preview is what is paid.
 */
export function dealRuleFor(
  dealId: string,
  rewards: NonNullable<DealTerms["rewards"]>,
  event: RewardEvent,
  beneficiary: RewardBeneficiary,
  holdDaysDefault: number,
): RewardRuleLike | null {
  if (event !== "referee_verified" && event !== "first_payment" && event !== "renewal") {
    return null;
  }
  const common = {
    id: null,
    ref: `deal:${dealId}:${event}:${beneficiary}`,
    maxPerReferrerPerDay: null,
    maxPerReferrerTotal: null,
    minOrderMinor: null,
    maxRenewals: rewards.maxRenewals,
    source: "deal" as const,
  };
  if (event === "referee_verified") {
    return beneficiary === "referrer"
      ? {
          ...common,
          rewardKind: "fixed_points",
          value: rewards.referrerSignupPoints,
          redeemableAs: "credits_only",
          holdDays: SIGNUP_HOLD_DAYS,
        }
      : {
          ...common,
          rewardKind: "fixed_credits",
          value: rewards.refereeSignupCredits,
          redeemableAs: "credits_only",
          holdDays: 0,
        };
  }
  if (beneficiary !== "referrer") return null;
  return {
    ...common,
    rewardKind: "percent_of_net_bps",
    value: rewards.referrerPaymentBps,
    redeemableAs: "cash_or_credits",
    holdDays: holdDaysDefault,
  };
}

export const dealRewardOverrides: RewardDealOverrides = {
  async resolve(tx, { referral, event, beneficiary, now, settings }): Promise<RewardRuleLike | null> {
    if (event !== "referee_verified" && event !== "first_payment" && event !== "renewal") {
      return null;
    }
    const found = await firstDealWith(
      tx,
      { ownerUserId: referral.refereeUserId },
      now,
      (terms) => terms.rewards !== undefined,
    );
    const rewards = found?.terms?.rewards;
    if (!found || !rewards) return null;
    return dealRuleFor(found.deal.id, rewards, event, beneficiary, settings.holdDaysDefault);
  },
};

/**
 * REFERRALS §7.4 point 5: an institution's own code has no referrer person, so the reward goes to
 * the organization's designated owner account, the earliest active `org_admin`. Null when the
 * referral has a referrer person, is not an organization code, or the organization has no admin.
 */
export async function designatedOrgOwner(tx: Handle, referral: Referral): Promise<string | null> {
  if (referral.referrerUserId !== null) return null;
  const [code] = await tx
    .select({ kind: referralCodes.kind, ownerOrgId: referralCodes.ownerOrgId })
    .from(referralCodes)
    .where(eq(referralCodes.id, referral.codeId));
  if (code?.kind !== "organization") return null;
  const orgId = referral.referrerOrgId ?? code.ownerOrgId;
  if (orgId === null) return null;
  const [owner] = await tx
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.orgId, orgId),
        eq(organizationMembers.role, "org_admin"),
        eq(organizationMembers.status, "active"),
        eq(users.status, "active"),
      ),
    )
    .orderBy(asc(organizationMembers.joinedAt), asc(organizationMembers.userId))
    .limit(1);
  return owner?.userId ?? null;
}
