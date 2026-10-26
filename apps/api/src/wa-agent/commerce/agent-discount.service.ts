import { Injectable } from "@nestjs/common";
import { isAppError } from "@wasfa/shared/errors";
import { t } from "@wasfa/shared/i18n";
import { formatMoney } from "@wasfa/shared/money";
import { PinoLogger } from "nestjs-pino";

import { AuditService } from "../../audit/audit.service.js";
import { QuoteInputsRepo } from "../../billing/quote-inputs.repo.js";
import { QuoteService } from "../../billing/quote.service.js";

import { WaAgentCommerceRepo } from "./agent-commerce.repo.js";

import type { AgentCall, AgentToolResult } from "../agent/tools/tool.js";
import type { PlanQuoteRequest, QuoteResponse } from "@wasfa/shared/schemas/billing";

const BPS_PER_PERCENT = 100;

/** `2026-10-27 18:30` in Cairo, the way the customer's clock reads (the ISO value is returned too). */
export function cairoStamp(at: Date): string {
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Africa/Cairo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(at);
}

const refused = (reason: string): AgentToolResult => ({ offered: false, reason });

/**
 * `offer_discount` (docs/WA-AGENT.md section 6). The model asks; this decides. Every rule of the
 * admin policy is checked in code, the numbers come from the quote engine (what the customer would
 * really pay, including tax and the bank method's fee), and a refusal is a reason code the model can
 * relay, never a text it composes about money.
 */
@Injectable()
export class AgentDiscountService {
  constructor(
    private readonly commerce: WaAgentCommerceRepo,
    private readonly quoteRepo: QuoteInputsRepo,
    private readonly quotes: QuoteService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentDiscount");
  }

  async offer(call: AgentCall, planKey: string, months: number): Promise<AgentToolResult> {
    const policy = call.config.discounts;
    if (!policy.enabled) return refused("disabled");

    const plan = await this.quoteRepo.publicPlan(planKey, call.now);
    if (!plan || plan.audience === "organization") return refused("plan_not_found");
    if (policy.plans.length > 0 && !policy.plans.includes(plan.key)) {
      return refused("plan_not_allowed");
    }
    if (
      policy.newCustomersOnly &&
      (await this.quoteRepo.hasPaidOrder({ type: "user", id: call.userId }))
    ) {
      return refused("not_new_customer");
    }
    if ((await this.commerce.customerMessageCount(call.conversationId)) < policy.minUserMessages) {
      return refused("too_early");
    }

    // The list price first: a plan or period without a price cannot be discounted either.
    const method = await this.commerce.bankMethod(call.market.currency, call.market.country);
    const base = { planKey: plan.key, months, ...(method ? { methodKey: method.key } : {}) };
    if ((await this.tryQuote(call, base)) === null) return refused("price_unavailable");

    const minted = await this.commerce.mintCoupon({
      userId: call.userId,
      planId: plan.id,
      months,
      percentBps: policy.percentOff * BPS_PER_PERCENT,
      validHours: policy.validHours,
      perUserLifetime: policy.perUserLifetime,
      dailyCap: policy.dailyCap,
      titleAr: t("whatsapp.agent.coupon.title", {}, "ar"),
      titleEn: t("whatsapp.agent.coupon.title", {}, "en"),
      now: call.now,
    });
    if (minted.outcome === "refused") return refused(minted.reason);

    const { coupon } = minted;
    if (minted.outcome === "minted") {
      await this.audit
        .record(
          {
            actorId: null,
            action: "coupon.create",
            targetType: "coupon",
            targetId: coupon.id,
            after: {
              campaign: coupon.campaign,
              kind: coupon.kind,
              percentOff: policy.percentOff,
              planKey: plan.key,
              months,
              userId: call.userId,
            },
          },
          { verbatim: true },
        )
        .catch((error: unknown) => {
          // The coupon exists and is visible in the admin list; a missing audit row is only logged.
          this.logger.warn(
            { couponId: coupon.id, reason: error instanceof Error ? error.name : "unknown" },
            "Agent coupon audit failed",
          );
        });
    }

    // A coupon the customer already held may cover another plan or period than the one asked about.
    const couponPlanId = coupon.planIds[0];
    const couponMonths = coupon.months[0];
    const target =
      minted.outcome === "reused" && couponPlanId !== undefined && couponMonths !== undefined
        ? { plan: await this.commerce.plan(couponPlanId), months: couponMonths }
        : { plan: { id: plan.id, key: plan.key, nameAr: plan.nameAr }, months };
    if (!target.plan) return this.withdrawn(coupon.id, "price_unavailable");

    const priced = { planKey: target.plan.key, months: target.months };
    const withMethod = method ? { methodKey: method.key } : {};
    const [listed, discounted] = await Promise.all([
      this.tryQuote(call, { ...priced, ...withMethod }),
      this.tryQuote(call, { ...priced, ...withMethod, couponCode: coupon.code }),
    ]);
    if (listed === null || discounted === null) {
      return this.withdrawn(coupon.id, "price_unavailable");
    }
    // Another promotion may already beat the coupon: then there is nothing extra to offer.
    if (discounted.coupon?.status !== "applied") {
      return this.withdrawn(coupon.id, "no_better_price");
    }

    const expiresAt = coupon.endsAt ?? call.now;
    const currency = discounted.quote.currency;
    this.logger.info(
      {
        conversationId: call.conversationId,
        couponId: coupon.id,
        reused: minted.outcome === "reused",
      },
      "Agent discount offered",
    );
    return {
      offered: true,
      reused: minted.outcome === "reused",
      code: coupon.code,
      percentOff: coupon.value / BPS_PER_PERCENT,
      expiresAt: expiresAt.toISOString(),
      expiresAtCairo: cairoStamp(expiresAt),
      planKey: target.plan.key,
      planName: target.plan.nameAr,
      months: target.months,
      priceBeforeMinor: listed.quote.totalMinor,
      priceAfterMinor: discounted.quote.totalMinor,
      currency,
      formatted: {
        before: formatMoney(listed.quote.totalMinor, currency, "ar"),
        after: formatMoney(discounted.quote.totalMinor, currency, "ar"),
      },
    };
  }

  /**
   * The coupon gives no discount: withdraw it so it neither uses up the customer's lifetime limit
   * or the day's cap nor gets offered again, then refuse with the reason.
   */
  private async withdrawn(couponId: string, reason: string): Promise<AgentToolResult> {
    await this.commerce.voidCoupon(couponId);
    return refused(reason);
  }

  /** A quote for the customer, or null when the engine refuses it (no such price, plan or period). */
  private async tryQuote(
    call: AgentCall,
    request: PlanQuoteRequest,
  ): Promise<QuoteResponse | null> {
    try {
      return await this.quotes.quote(
        call.userId,
        request,
        call.market,
        `wa-agent:${call.userId}`,
        call.now,
      );
    } catch (error) {
      if (isAppError(error)) return null;
      throw error;
    }
  }
}
