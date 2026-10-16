import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  canonicalJson,
  quote as priceQuote,
  type DiscountDef,
  type PaymentMethodInput,
  type PriceQuote,
  type QuoteInput,
} from "@wasfa/shared/price-engine";
import {
  priceQuoteSchema,
  type CouponOutcome,
  type QuoteRequest,
  type QuoteResponse,
} from "@wasfa/shared/schemas/billing";
import { Redis } from "ioredis";
import { z } from "zod";

import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../config/env.js";
import { SettingsService } from "../settings/settings.service.js";

import { DEAL_RESOLVER, type DealResolver } from "./deal-resolver.js";
import { engineSettings } from "./engine-settings.js";
import { QuoteInputsRepo, audienceFits, type MethodSummary } from "./quote-inputs.repo.js";

import type { Market } from "../catalog/market.js";
import type { Coupon, Plan } from "@wasfa/db";

const COUPON_USER_LIMIT = { max: 10, windowSeconds: 60 };
const COUPON_IP_LIMIT = { max: 30, windowSeconds: 60 };

const quoteKey = (quoteId: string) => `billing:quote:${quoteId}`;

const storedQuoteSchema = z.object({
  v: z.literal(1),
  userId: z.string(),
  hash: z.string(),
  quote: priceQuoteSchema,
});

const INVALID_COUPON: CouponOutcome = { status: "invalid" };

/** Either a final outcome (the code cannot be used) or a usable coupon for the engine to weigh. */
interface CouponRefusal {
  outcome: CouponOutcome;
  coupon?: undefined;
  def?: undefined;
}
interface CouponCandidate {
  outcome?: undefined;
  coupon: Coupon;
  def: DiscountDef;
}
type CouponCheck = CouponRefusal | CouponCandidate;

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
    // Hash the quote as stored, not as parsed: an unknown extra key must break the signature too.
    const rawQuote = (data as { quote: unknown }).quote;
    const expected = Buffer.from(this.hmac(rawQuote), "hex");
    const actual = Buffer.from(stored.data.hash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    // Shape checked above by `priceQuoteSchema`, signature by the HMAC.
    return rawQuote as PriceQuote;
  }

  async quote(
    userId: string,
    request: QuoteRequest,
    market: Market,
    ip: string,
    now = new Date(),
  ): Promise<QuoteResponse> {
    if (request.couponCode !== undefined) {
      await this.limiter.hit(
        `coupon:user:${userId}`,
        COUPON_USER_LIMIT.max,
        COUPON_USER_LIMIT.windowSeconds,
      );
      await this.limiter.hit(`coupon:ip:${ip}`, COUPON_IP_LIMIT.max, COUPON_IP_LIMIT.windowSeconds);
    }

    const plan = await this.repo.publicPlan(request.planKey);
    // Organization plans are bought by the organization (WP6); a hidden plan does not exist here.
    if (!plan || plan.audience === "organization") throw new AppError(ErrorCode.NOT_FOUND);

    const { currency, country } = market;
    const [billing, priceRow, promotions, offers, taxRule, methods, packs] = await Promise.all([
      this.settings.get("billing"),
      this.repo.activePrice(plan.id, request.months, currency),
      this.repo.activePromotions(now),
      this.repo.personalOfferDiscounts(userId, now),
      this.repo.taxRuleFor(country),
      this.repo.enabledMethods(currency, country),
      this.repo.creditPacks(currency),
    ]);
    const [isFirstPurchase, upgradeFrom, deal, couponCheck] = await Promise.all([
      this.repo.hasPaidOrder(userId).then((paid) => !paid),
      this.upgradeBasis(userId, plan, currency),
      this.deals.resolve(userId, plan.key, request.months, currency, now),
      request.couponCode === undefined
        ? Promise.resolve(null)
        : this.checkCoupon(request.couponCode, userId, now),
    ]);

    const automatic = [
      ...promotions
        .filter((entry) => audienceFits(entry.promotion.audience, "individual"))
        .map((entry) => entry.def),
      ...offers,
    ];
    const discounts = couponCheck?.def ? [...automatic, couponCheck.def] : automatic;
    const input: QuoteInput = {
      price: priceRow
        ? {
            planKey: plan.key,
            months: request.months,
            currency,
            amountMinor: priceRow.amountMinor,
          }
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
    if (!result.ok) throw new AppError(ErrorCode[result.code]);

    const coupon = couponCheck ? this.couponOutcome(couponCheck, result.quote, input) : null;

    const quoteId = randomUUID();
    const stored = {
      v: 1,
      userId,
      request,
      quote: result.quote,
      hash: this.hashQuote(result.quote),
    };
    try {
      await this.redis.set(
        quoteKey(quoteId),
        JSON.stringify(stored),
        "EX",
        billing.quoteTtlMinutes * 60,
      );
    } catch (cause) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause });
    }
    return { quoteId, quote: result.quote, coupon };
  }

  private hmac(value: unknown): string {
    return createHmac("sha256", this.hashKey).update(canonicalJson(value)).digest("hex");
  }

  /** Proration applies only when moving from an active paid plan to one with more monthly credits. */
  private async upgradeBasis(
    userId: string,
    target: Plan,
    currency: string,
  ): Promise<QuoteInput["history"]["upgradeFrom"]> {
    const subscription = await this.repo.liveSubscription(userId);
    if (!subscription || target.monthlyCredits <= subscription.planMonthlyCredits) return null;
    const lastOrder = await this.repo.lastPaidPlanOrder(userId);
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
  private async checkCoupon(code: string, userId: string, now: Date): Promise<CouponCheck> {
    const coupon = await this.repo.findCoupon(code);
    if (!coupon) return { outcome: INVALID_COUPON };
    if (
      (coupon.targetUserId !== null && coupon.targetUserId !== userId) ||
      coupon.targetOrgId !== null ||
      (coupon.status !== "active" && coupon.status !== "scheduled") ||
      (coupon.endsAt !== null && coupon.endsAt <= now) ||
      (coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions) ||
      !audienceFits(coupon.audience, "individual")
    ) {
      return { outcome: INVALID_COUPON };
    }
    if (
      coupon.perOwnerLimit !== null &&
      (await this.repo.couponUsesByUser(coupon.id, userId)) >= coupon.perOwnerLimit
    ) {
      return { outcome: INVALID_COUPON };
    }
    // The caller is eligible: a code that starts later may say when ("starts on ...").
    if (coupon.startsAt !== null && coupon.startsAt > now) {
      return { outcome: { status: "invalid", startsAt: coupon.startsAt.toISOString() } };
    }
    const def = await this.repo.couponDef(coupon);
    return def ? { coupon, def } : { outcome: INVALID_COUPON };
  }

  /** `applied`, `not_applied` (valid, but another discount was better) or `invalid` (no effect here at all). */
  private couponOutcome(check: CouponCheck, final: PriceQuote, input: QuoteInput): CouponOutcome {
    if (check.outcome) return check.outcome;
    if (final.applied.couponId === check.coupon.id) return { status: "applied" };
    // Alone, would the code have done anything? If not, it is ineligible here (plan, period, country...).
    const alone = priceQuote({ ...input, discounts: [check.def] });
    return alone.ok && alone.quote.applied.couponId === check.coupon.id
      ? { status: "not_applied" }
      : INVALID_COUPON;
  }
}
