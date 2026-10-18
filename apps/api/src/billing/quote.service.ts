import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { normalizeCouponCode } from "@wasfa/shared/coupon-codes";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  canonicalJson,
  quote as priceQuote,
  type DiscountDef,
  type PaymentMethodInput,
  type PriceQuote,
  type QuoteInput,
  type QuoteResult,
} from "@wasfa/shared/price-engine";
import {
  priceQuoteSchema,
  quoteTargetSchema,
  simulateBillingResponseSchema,
  type CouponOutcome,
  type PackQuoteRequest,
  type PlanQuoteRequest,
  type QuoteRequest,
  type QuoteResponse,
  type QuoteTarget,
  type SimulateBillingInput,
} from "@wasfa/shared/schemas/billing";
import { simulateDealResponseSchema, type SimulateDealInput } from "@wasfa/shared/schemas/deals";
import { Redis } from "ioredis";
import { z } from "zod";

import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../config/env.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { DEAL_RESOLVER, type DealResolver } from "./deal-resolver.js";
import { engineSettings } from "./engine-settings.js";
import { QuoteInputsRepo, audienceFits, type MethodSummary } from "./quote-inputs.repo.js";

import type { Market } from "../catalog/market.js";
import type { Coupon, Plan, WalletOwner } from "@wasfa/db";

const COUPON_USER_LIMIT = { max: 10, windowSeconds: 60 };
const COUPON_IP_LIMIT = { max: 30, windowSeconds: 60 };

const quoteKey = (quoteId: string) => `billing:quote:${quoteId}`;

const storedQuoteSchema = z.object({
  v: z.literal(3),
  userId: z.string(),
  /** The organization the quote is for (it will own the order); null = the user's own purchase. */
  orgId: z.uuid().nullable(),
  target: quoteTargetSchema,
  quote: priceQuoteSchema,
  /** HMAC over `{ userId, orgId, target, quote }`: nobody may edit, re-own or re-target the quote. */
  signature: z.string(),
});

/** A stored quote that passed every check, ready for `POST /billing/orders`. */
export interface CheckoutQuote {
  quote: PriceQuote;
  /** Who will own the order: the organization it was quoted for, else the user. */
  orgId: string | null;
  target: QuoteTarget;
  /** `quote_hash` of the order: HMAC over the quote alone. */
  hash: string;
}

const INVALID_COUPON: CouponOutcome = { status: "invalid" };

/** Either a final outcome (the code cannot be used) or a usable coupon for the engine to weigh. */
interface CouponRefusal {
  outcome: CouponOutcome;
  coupon?: undefined;
  def?: undefined;
}
interface CouponCandidate {
  outcome?: CouponOutcome;
  coupon: Coupon;
  def: DiscountDef;
}
type CouponCheck = CouponRefusal | CouponCandidate;

interface PlanInputs {
  plan: Plan;
  input: QuoteInput;
  result: QuoteResult;
  couponCheck: CouponCheck | null;
  target: QuoteTarget;
  names: ReadonlyMap<string, string>;
  orgId: string | null;
}

function toMethodInput(method: MethodSummary): PaymentMethodInput {
  return {
    key: method.key,
    feeBps: method.feeBps,
    feeFixedMinor: method.feeFixedMinor,
    currencies: method.currencies,
    ...(method.minAmountMinor !== null ? { minAmountMinor: method.minAmountMinor } : {}),
    ...(method.maxAmountMinor !== null ? { maxAmountMinor: method.maxAmountMinor } : {}),
  };
}

/**
 * Prices a purchase for the signed-in user and keeps the answer for checkout. The API is the only
 * authority on money: the request names a plan, a period, a coupon and a method, never a price.
 * A stored quote carries an HMAC over its canonical JSON, so an order created from it (Task 3.3)
 * can prove nobody edited it while it waited in Redis.
 */
@Injectable()
export class QuoteService {
  private readonly hashKey: Buffer;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) env: ApiEnv,
    @Inject(DEAL_RESOLVER) private readonly deals: DealResolver,
    private readonly repo: QuoteInputsRepo,
    private readonly settings: SettingsService,
    private readonly limiter: AuthRateLimiter,
    private readonly orgs: OrgsService,
  ) {
    // A purpose-bound subkey: the master key never signs anything directly.
    this.hashKey = Buffer.from(
      hkdfSync("sha256", encryptionKey(env), Buffer.alloc(0), "wasfa/quote-hash/v1", 32),
    );
  }

  /** `HMAC-SHA256(canonicalJson(quote))` as hex: what an order stores as `quote_hash`. */
  hashQuote(quote: PriceQuote): string {
    return this.hmac(quote);
  }

  /**
   * The stored quote, only if it exists, belongs to `userId` and still matches its signature.
   * Anything else is `null`, with no hint which of the three failed.
   */
  async load(quoteId: string, userId: string): Promise<PriceQuote | null> {
    return (await this.loadForCheckout(quoteId, userId))?.quote ?? null;
  }

  /** `load` plus what the quote buys and the order's `quote_hash`. */
  async loadForCheckout(quoteId: string, userId: string): Promise<CheckoutQuote | null> {
    if (!z.uuid().safeParse(quoteId).success) return null;
    let raw: string | null;
    try {
      raw = await this.redis.get(quoteKey(quoteId));
    } catch (cause) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause });
    }
    if (raw === null) return null;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    const stored = storedQuoteSchema.safeParse(data);
    if (!stored.success || stored.data.userId !== userId) return null;
    // Sign what was stored, not what was parsed: an unknown extra key must break the signature too.
    const envelope = data as { quote: unknown; target: unknown; orgId: unknown };
    const expected = Buffer.from(
      this.hmac({ userId, orgId: envelope.orgId, target: envelope.target, quote: envelope.quote }),
      "hex",
    );
    const actual = Buffer.from(stored.data.signature, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    // Shape checked above by the schemas, integrity by the HMAC.
    const quote = envelope.quote as PriceQuote;
    return {
      quote,
      orgId: stored.data.orgId,
      target: stored.data.target,
      hash: this.hashQuote(quote),
    };
  }

  /**
   * A quote is used once. Removing it is the claim: of two concurrent orders from the same quote,
   * exactly one sees `true` (Redis `DEL` answers 1 to one caller only).
   */
  async claim(quoteId: string): Promise<boolean> {
    try {
      return (await this.redis.del(quoteKey(quoteId))) === 1;
    } catch (cause) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause });
    }
  }

  async quote(
    userId: string,
    request: QuoteRequest,
    market: Market,
    ip: string,
    now = new Date(),
  ): Promise<QuoteResponse> {
    // Buying for an organization is an org_admin act, checked against the database on every quote.
    if (request.orgId !== undefined) {
      await this.orgs.authorize(userId, request.orgId, "org_admin");
      // A manual-invoice deal means the organization pays offline (recorded by an admin), not here.
      if (await this.deals.isManualInvoice(request.orgId, now)) {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: "manual_invoice" } });
      }
    }
    return "packKey" in request
      ? this.quotePack(userId, request, market, now)
      : this.quotePlan(userId, request, market, ip, now);
  }

  async checkCouponCode(
    userId: string,
    request: Pick<PlanQuoteRequest, "planKey" | "months"> & { code: string },
    market: Market,
    ip: string,
    now = new Date(),
  ): Promise<CouponOutcome> {
    await this.hitCouponLimits(userId, ip);
    const inputs = await this.planInputs(
      userId,
      { ...request, couponCode: request.code },
      market,
      now,
    );
    if (!inputs.result.ok) throw new AppError(ErrorCode[inputs.result.code]);
    const outcome = inputs.couponCheck
      ? this.checkedCouponOutcome(inputs.couponCheck, inputs.result.quote, inputs.input)
      : INVALID_COUPON;
    // The funnel learns that a code was tried and whether it took, never which code.
    await this.repo.recordEvent({
      name: outcome.status === "applied" ? "coupon_applied" : "coupon_failed",
      sessionId: `srv:${userId}`,
      userId,
      props: { plan: request.planKey, months: request.months },
    });
    return outcome;
  }

  async simulate(request: SimulateBillingInput, market: Market, now = new Date()) {
    const resolvedMarket = {
      currency: request.currency ?? market.currency,
      country: request.country ?? market.country,
    };
    const inputs = await this.planInputs(
      request.userId,
      {
        planKey: request.planKey,
        months: request.months,
        couponCode: request.couponCode,
        methodKey: request.methodKey,
        ...(request.orgId ? { orgId: request.orgId } : {}),
      },
      resolvedMarket,
      now,
      { includeHidden: true },
    );
    const deal = await this.dealSimulation(inputs, request.userId, now);
    const quote = inputs.result.ok ? inputs.result.quote : null;
    const noDiscount = priceQuote({ ...inputs.input, discounts: [] });
    const coupon = inputs.couponCheck
      ? quote
        ? this.couponOutcome(inputs.couponCheck, quote, inputs.input)
        : (inputs.couponCheck.outcome ?? INVALID_COUPON)
      : null;
    const candidates = inputs.input.discounts.map((discount) => {
      const alone = priceQuote({ ...inputs.input, discounts: [discount] });
      const eligible = alone.ok && Object.values(alone.quote.applied).includes(discount.id);
      const bonus = discount.kind === "bonus_credits" || discount.kind === "extra_months";
      return {
        id: discount.id,
        source: discount.source,
        name: inputs.names.get(discount.id) ?? null,
        kind: discount.kind,
        aloneSavingMinor:
          !bonus && noDiscount.ok && alone.ok
            ? noDiscount.quote.subtotalMinor - alone.quote.subtotalMinor
            : 0,
        eligible,
        chosen: quote !== null && Object.values(quote.applied).includes(discount.id),
      };
    });
    return simulateBillingResponseSchema.parse({
      quote,
      error: inputs.result.ok ? null : inputs.result.code,
      coupon,
      deal,
      candidates,
    });
  }

  /**
   * Task 3.10 simulator: the quote without any deal and with the deal engine, plus which deal won
   * and why. For a person, an organization or a hypothetical new member of an organization.
   */
  async simulateDeal(request: SimulateDealInput, market: Market, now = new Date()) {
    const resolvedMarket = {
      currency: request.currency ?? market.currency,
      country: market.country,
    };
    const orgId = request.orgId ?? null;
    const inputs = await this.planInputs(
      request.userId,
      {
        planKey: request.planKey,
        months: request.months,
        couponCode: request.couponCode,
        ...(orgId ? { orgId } : {}),
      },
      resolvedMarket,
      now,
      { includeHidden: true, newMemberOfOrgId: request.newMember?.orgId },
    );
    const before = priceQuote({ ...inputs.input, deal: null });
    const coupon = inputs.couponCheck
      ? inputs.result.ok
        ? this.couponOutcome(inputs.couponCheck, inputs.result.quote, inputs.input)
        : (inputs.couponCheck.outcome ?? INVALID_COUPON)
      : null;
    const deal = await this.dealSimulation(inputs, request.userId, now, request.newMember?.orgId);
    return simulateDealResponseSchema.parse({
      before: before.ok ? before.quote : null,
      after: inputs.result.ok ? inputs.result.quote : null,
      error: inputs.result.ok ? null : inputs.result.code,
      coupon,
      deal,
    });
  }

  private async dealSimulation(
    inputs: PlanInputs,
    userId: string | undefined,
    now: Date,
    newMemberOfOrgId?: string,
  ) {
    const { price } = inputs.input;
    const orgId = inputs.orgId;
    if (!price) return { chosen: null, chosenBecause: null, candidates: [] };
    const resolution = await this.deals.explain(
      orgId ? { ownerOrgId: orgId } : { ownerUserId: userId, newMemberOfOrgId },
      price.planKey,
      price.months,
      price.currency,
      now,
    );
    return {
      chosen: resolution.deal
        ? { id: resolution.deal.id, name: resolution.deal.name, kind: resolution.kind }
        : null,
      chosenBecause: resolution.chosenBecause,
      candidates: resolution.candidates,
    };
  }

  /** Credit packs: list price, tax and the method fee. Discounts and proration belong to plans. */
  private async quotePack(
    userId: string,
    request: PackQuoteRequest,
    market: Market,
    now: Date,
  ): Promise<QuoteResponse> {
    const { currency, country } = market;
    const orgId = request.orgId ?? null;
    const owner: WalletOwner = orgId ? { type: "org", id: orgId } : { type: "user", id: userId };
    const [billing, pack, taxRule, methods, packs, paid] = await Promise.all([
      this.settings.get("billing"),
      this.repo.packForQuote(request.packKey, currency),
      this.repo.taxRuleFor(country),
      this.repo.enabledMethods(currency, country),
      this.repo.creditPacks(currency),
      this.repo.hasPaidOrder(owner),
    ]);
    if (!pack) throw new AppError(ErrorCode.NOT_FOUND);
    const result = priceQuote({
      price: { planKey: pack.key, months: 1, currency, amountMinor: pack.amountMinor },
      discounts: [],
      deal: null,
      taxRule: taxRule ? { id: taxRule.id, rateBps: taxRule.rateBps, mode: taxRule.mode } : null,
      methods: methods.map(toMethodInput),
      methodKey: request.methodKey ?? null,
      history: { isFirstPurchase: !paid, upgradeFrom: null },
      settings: engineSettings(billing, packs),
      now,
      country,
    });
    if (!result.ok) throw new AppError(ErrorCode[result.code]);
    const target: QuoteTarget = {
      kind: "credit_pack",
      key: pack.key,
      planId: null,
      packId: pack.id,
      months: null,
    };
    const quoteId = await this.store(userId, orgId, target, result.quote, billing.quoteTtlMinutes);
    return { quoteId, quote: result.quote, target, coupon: null };
  }

  private async quotePlan(
    userId: string,
    request: PlanQuoteRequest,
    market: Market,
    ip: string,
    now: Date,
  ): Promise<QuoteResponse> {
    await this.hitCouponLimits(userId, ip, request.couponCode !== undefined);
    const inputs = await this.planInputs(userId, request, market, now);
    if (!inputs.result.ok) throw new AppError(ErrorCode[inputs.result.code]);
    const coupon = inputs.couponCheck
      ? this.couponOutcome(inputs.couponCheck, inputs.result.quote, inputs.input)
      : null;
    const quoteId = await this.store(
      userId,
      request.orgId ?? null,
      inputs.target,
      inputs.result.quote,
      inputs.input.settings.quoteTtlMinutes,
    );
    return { quoteId, quote: inputs.result.quote, target: inputs.target, coupon };
  }

  private async hitCouponLimits(userId: string, ip: string, enabled = true): Promise<void> {
    if (!enabled) return;
    await this.limiter.hit(
      `coupon:user:${userId}`,
      COUPON_USER_LIMIT.max,
      COUPON_USER_LIMIT.windowSeconds,
    );
    await this.limiter.hit(`coupon:ip:${ip}`, COUPON_IP_LIMIT.max, COUPON_IP_LIMIT.windowSeconds);
  }

  private async planInputs(
    userId: string | undefined,
    request: PlanQuoteRequest,
    market: Market,
    now: Date,
    options: { includeHidden?: boolean; newMemberOfOrgId?: string | undefined } = {},
  ): Promise<PlanInputs> {
    const plan = options.includeHidden
      ? await this.repo.planForSimulation(request.planKey)
      : await this.repo.publicPlan(request.planKey);
    const orgId = request.orgId ?? null;
    // An organization buys organization plans, a person buys individual ones.
    if (!plan || plan.audience === (orgId ? "individual" : "organization")) {
      throw new AppError(ErrorCode.NOT_FOUND);
    }
    const purchase = orgId ? "organization" : "individual";
    const owner: WalletOwner | undefined = orgId
      ? { type: "org", id: orgId }
      : userId
        ? { type: "user", id: userId }
        : undefined;
    const { currency, country } = market;
    const [billing, priceRow, promotions, offers, taxRule, methods, packs] = await Promise.all([
      this.settings.get("billing"),
      this.repo.activePrice(plan.id, request.months, currency),
      this.repo.activePromotions(now),
      userId && !orgId ? this.repo.personalOfferDiscounts(userId, now) : Promise.resolve([]),
      this.repo.taxRuleFor(country),
      this.repo.enabledMethods(currency, country),
      this.repo.creditPacks(currency),
    ]);
    const [isFirstPurchase, upgradeFrom, deal, couponCheck] = await Promise.all([
      owner ? this.repo.hasPaidOrder(owner).then((paid) => !paid) : Promise.resolve(true),
      owner ? this.upgradeBasis(owner, plan, currency) : Promise.resolve(null),
      // The organization's own deal for an organization quote, the person's deal for a personal one.
      orgId || userId || options.newMemberOfOrgId
        ? this.deals.resolve(
            orgId
              ? { ownerOrgId: orgId }
              : { ownerUserId: userId, newMemberOfOrgId: options.newMemberOfOrgId },
            plan.key,
            request.months,
            currency,
            now,
          )
        : Promise.resolve(null),
      request.couponCode === undefined
        ? Promise.resolve(null)
        : this.checkCoupon(request.couponCode, userId, now, orgId),
    ]);
    const promotionEntries = promotions.filter((entry) =>
      audienceFits(entry.promotion.audience, purchase),
    );
    const automatic = [...promotionEntries.map((entry) => entry.def), ...offers];
    const discounts = couponCheck?.def ? [...automatic, couponCheck.def] : automatic;
    const input: QuoteInput = {
      price: priceRow
        ? { planKey: plan.key, months: request.months, currency, amountMinor: priceRow.amountMinor }
        : null,
      discounts,
      deal,
      taxRule: taxRule ? { id: taxRule.id, rateBps: taxRule.rateBps, mode: taxRule.mode } : null,
      methods: methods.map(toMethodInput),
      methodKey: request.methodKey ?? null,
      history: { isFirstPurchase, upgradeFrom },
      settings: engineSettings(billing, packs),
      now,
      country,
    };
    const result = priceQuote(input);
    const target: QuoteTarget = {
      kind: upgradeFrom ? "upgrade" : "subscription",
      key: plan.key,
      planId: plan.id,
      packId: null,
      months: request.months,
    };
    const names = new Map(
      promotionEntries.map((entry) => [entry.promotion.id, entry.promotion.name]),
    );
    if (couponCheck?.coupon) names.set(couponCheck.coupon.id, couponCheck.coupon.name);
    return { plan, input, result, couponCheck, target, names, orgId };
  }

  private async store(
    userId: string,
    orgId: string | null,
    target: QuoteTarget,
    quote: PriceQuote,
    ttlMinutes: number,
  ): Promise<string> {
    const quoteId = randomUUID();
    const stored = {
      v: 3,
      userId,
      orgId,
      target,
      quote,
      signature: this.hmac({ userId, orgId, target, quote }),
    };
    try {
      await this.redis.set(quoteKey(quoteId), JSON.stringify(stored), "EX", ttlMinutes * 60);
    } catch (cause) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause });
    }
    return quoteId;
  }

  private hmac(value: unknown): string {
    return createHmac("sha256", this.hashKey).update(canonicalJson(value)).digest("hex");
  }

  /** Proration applies only when moving from an active paid plan to one with more monthly credits. */
  private async upgradeBasis(
    owner: WalletOwner,
    target: Plan,
    currency: string,
  ): Promise<QuoteInput["history"]["upgradeFrom"]> {
    const subscription = await this.repo.liveSubscription(owner);
    if (!subscription || target.monthlyCredits <= subscription.planMonthlyCredits) return null;
    const lastOrder = await this.repo.lastPaidPlanOrder(owner);
    if (!lastOrder || lastOrder.currency !== currency) return null;
    return {
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      lastPaidNetMinor: lastOrder.subtotalMinor,
      currency: lastOrder.currency,
    };
  }

  /**
   * Whether this user may use the code at all. Unknown, expired, used-up, withdrawn, and meant for
   * someone else all look the same (`invalid`): the answer must not let anyone probe for codes.
   * Eligibility by plan, period and country is the engine's call.
   */
  private async checkCoupon(
    code: string,
    userId: string | undefined,
    now: Date,
    orgId: string | null = null,
  ): Promise<CouponCheck> {
    const coupon = await this.repo.findCoupon(normalizeCouponCode(code));
    if (!coupon) return { outcome: INVALID_COUPON };
    if (
      // A coupon made for a person is not for their organization, and one made for an organization
      // is only for that organization.
      (coupon.targetUserId !== null && (orgId !== null || coupon.targetUserId !== userId)) ||
      (coupon.targetOrgId !== null && coupon.targetOrgId !== orgId) ||
      (coupon.status !== "active" && coupon.status !== "scheduled") ||
      (coupon.endsAt !== null && coupon.endsAt <= now) ||
      (coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions) ||
      !audienceFits(coupon.audience, orgId !== null ? "organization" : "individual")
    ) {
      return { outcome: INVALID_COUPON };
    }
    const redeemer: WalletOwner | undefined =
      orgId !== null
        ? { type: "org", id: orgId }
        : userId
          ? { type: "user", id: userId }
          : undefined;
    if (
      redeemer !== undefined &&
      coupon.perOwnerLimit !== null &&
      (await this.repo.couponUsesByOwner(coupon.id, redeemer)) >= coupon.perOwnerLimit
    ) {
      return { outcome: INVALID_COUPON };
    }
    const def = await this.repo.couponDef(coupon);
    if (!def) return { outcome: INVALID_COUPON };
    // The engine checks plan, period and country before the future start is disclosed.
    if (coupon.startsAt !== null && coupon.startsAt > now) {
      return {
        coupon,
        def,
        outcome: { status: "invalid", startsAt: coupon.startsAt.toISOString() },
      };
    }
    return { coupon, def };
  }

  /** `applied`, `not_applied` (valid, but another discount was better) or `invalid` (no effect here at all). */
  private couponOutcome(check: CouponCheck, final: PriceQuote, input: QuoteInput): CouponOutcome {
    if (check.coupon === undefined || check.outcome) return check.outcome ?? INVALID_COUPON;
    if (final.applied.couponId === check.coupon.id) return { status: "applied" };
    // Alone, would the code have done anything? If not, it is ineligible here (plan, period, country...).
    const alone = priceQuote({ ...input, discounts: [check.def] });
    return alone.ok && alone.quote.applied.couponId === check.coupon.id
      ? { status: "not_applied" }
      : INVALID_COUPON;
  }

  private checkedCouponOutcome(
    check: CouponCheck,
    final: PriceQuote,
    input: QuoteInput,
  ): CouponOutcome {
    if (check.coupon === undefined || check.outcome?.startsAt === undefined) {
      return this.couponOutcome(check, final, input);
    }
    const eligibleFromPlan = priceQuote({
      ...input,
      discounts: [{ ...check.def, startsAt: null }],
    });
    return eligibleFromPlan.ok && eligibleFromPlan.quote.applied.couponId === check.def.id
      ? check.outcome
      : INVALID_COUPON;
  }
}
