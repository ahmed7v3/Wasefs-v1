import { Inject, Injectable } from "@nestjs/common";
import {
  PaymentsError,
  SubscriptionsError,
  adminExtend,
  adminGrant,
  moveCreditsInTransaction,
  outbox,
  userNotifications,
  type PaymentHooks,
  type Plan,
  type Transaction,
  type WalletOwner,
} from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { redactText } from "@wasfa/shared/redact";
import { addDays, addMonthsClamped } from "@wasfa/shared/subscriptions";

import { AuditService } from "../../audit/audit.service.js";
import { DB, type DbHandle } from "../../common/database.js";
import { CreditsRepo } from "../../credits/credits.repo.js";
import { PAYMENT_HOOKS } from "../../payments/payments.service.js";
import { SettingsService } from "../../settings/settings.service.js";

import { AdminPlanChangeRepo, type LiveSubscriptionRow } from "./user-plan-change.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type {
  AdminPlanChangeInput,
  AdminPlanChangePreviewInput,
  PlanChangeEffect,
} from "@wasfa/shared/schemas/admin-user-360";
import type { FastifyRequest } from "fastify";

const DAY_MS = 86_400_000;
const MAX_DAYS = 3_650;
/** How recently the admin must have proved their identity for a large or offline change (minutes). */
const FRESH_AUTH_MINUTES = 10;

type Length = { months: number } | { days: number };

interface Evaluation {
  plan: Plan;
  live: LiveSubscriptionRow | undefined;
  length: Length;
  effect: PlanChangeEffect;
  blocked: "paid_subscription_live" | null;
  newExpiry: Date;
  effectiveAt: Date;
  planCredits: number;
  freshAuthRequired: boolean;
}

const extendDate = (from: Date, length: Length): Date =>
  "months" in length ? addMonthsClamped(from, length.months) : addDays(from, length.days);

function mapError(error: unknown): never {
  if (error instanceof SubscriptionsError) {
    if (error.reason === "not_found") throw new AppError(ErrorCode.NOT_FOUND, { cause: error });
    if (error.reason === "invalid_period") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { cause: error });
    }
    throw new AppError(ErrorCode.CONFLICT, { cause: error, details: { reason: error.reason } });
  }
  if (error instanceof PaymentsError) {
    if (error.reason === "method_unavailable") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        cause: error,
        details: { fields: ["paidOffline.methodKey"] },
      });
    }
    if (error.reason === "duplicate_txn") {
      throw new AppError(ErrorCode.CONFLICT, {
        cause: error,
        details: { reason: "duplicate_reference" },
      });
    }
  }
  throw error;
}

/**
 * The upgrade / change-plan dialog (ADMIN-CONSOLE-SPEC §8.3) for a user or an organization.
 * `preview` and `apply` share one evaluation, so what the dialog showed is what happens.
 */
@Injectable()
export class AdminPlanChangeService {
  constructor(
    private readonly repo: AdminPlanChangeRepo,
    private readonly credits: CreditsRepo,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(PAYMENT_HOOKS) private readonly hooks: PaymentHooks,
  ) {}

  private async requireOwner(owner: WalletOwner): Promise<void> {
    const exists =
      owner.type === "user" ? await this.credits.ownerExists(owner) : await this.repo.orgExists(owner.id);
    if (!exists) throw new AppError(ErrorCode.NOT_FOUND);
  }

  private async evaluate(
    owner: WalletOwner,
    input: AdminPlanChangePreviewInput,
    now: Date,
  ): Promise<Evaluation> {
    const plan = await this.repo.planByKey(input.planKey);
    const invalid = (field: string, reason: string) =>
      new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: [field], reason } });
    if (!plan) throw invalid("planKey", "unknown_plan");
    const audienceOk =
      plan.audience === "any" || plan.audience === (owner.type === "user" ? "individual" : "organization");
    if (!audienceOk) throw invalid("planKey", "plan_audience");

    let length: Length;
    if ("months" in input.duration) {
      length = { months: input.duration.months };
    } else {
      const days = Math.ceil((input.duration.until.getTime() - now.getTime()) / DAY_MS);
      if (days < 1 || days > MAX_DAYS) throw invalid("duration", "invalid_period");
      length = { days };
    }

    const live = await this.repo.liveSubscription(owner);
    const paidLive = live?.source === "paid";
    const sameLive = live !== undefined && live.planId === plan.id;
    const ended = live === undefined || live.status === "grace" || live.currentPeriodEnd <= now;

    let effect: PlanChangeEffect = "replace";
    let blocked: Evaluation["blocked"] = null;
    if (input.kind === "paid_offline") {
      // The same decision as a paid order's activation (BILLING §7.2).
      if (paidLive && sameLive) effect = "extend";
      else if (paidLive && live.planMonthlyCredits >= plan.monthlyCredits) effect = "schedule";
    } else if (paidLive) {
      // A gift never silently replaces something the customer paid for.
      blocked = "paid_subscription_live";
    } else if (sameLive) {
      effect = "extend";
    }

    const base = effect === "extend" && live && !ended ? live.currentPeriodEnd : now;
    let newExpiry: Date;
    let effectiveAt = now;
    if (effect === "schedule" && live) {
      effectiveAt = live.currentPeriodEnd;
      newExpiry = extendDate(live.currentPeriodEnd, length);
    } else {
      newExpiry = extendDate(base, length);
    }

    const monthsForPrice =
      "months" in length ? length.months : Math.min(24, Math.max(1, Math.ceil(length.days / 30)));
    const [billing, currency] = await Promise.all([
      this.settings.get("billing"),
      this.settings.get("currency"),
    ]);
    const listPrice = await this.listPrice(plan.id, currency.default, monthsForPrice);
    const freshAuthRequired =
      input.kind === "paid_offline" || listPrice >= billing.adminPlanChangeFreshAuthMinor;

    return {
      plan,
      live,
      length,
      effect,
      blocked,
      newExpiry,
      effectiveAt,
      planCredits: effect === "replace" ? plan.monthlyCredits : 0,
      freshAuthRequired,
    };
  }

  /** The list price of (plan, months): the exact row, else the per-month price of the shortest row. */
  private async listPrice(planId: string, currency: string, months: number): Promise<number> {
    const prices = await this.repo.prices(planId, currency);
    const exact = prices.find((price) => price.months === months);
    if (exact) return exact.amountMinor;
    const shortest = prices[0];
    return shortest ? Math.round((shortest.amountMinor / shortest.months) * months) : 0;
  }

  async preview(owner: WalletOwner, input: AdminPlanChangePreviewInput) {
    await this.requireOwner(owner);
    const now = new Date();
    const result = await this.evaluate(owner, input, now);
    const entitlements = await this.repo.entitlements(result.plan.id);
    return {
      plan: {
        key: result.plan.key,
        nameAr: result.plan.nameAr,
        nameEn: result.plan.nameEn,
        monthlyCredits: result.plan.monthlyCredits,
      },
      entitlements: entitlements.map((entitlement) => ({
        task: entitlement.task,
        allowed: entitlement.allowed,
        modes: entitlement.modes,
        dailyCap: entitlement.dailyCap,
        monthlyCap: entitlement.monthlyCap,
        maxPagesPerRx: entitlement.maxPagesPerRx,
        webSearch: entitlement.webSearch,
      })),
      effect: result.effect,
      blocked: result.blocked,
      current: result.live
        ? {
            planKey: result.live.planKey,
            status: result.live.status,
            source: result.live.source,
            currentPeriodEnd: result.live.currentPeriodEnd.toISOString(),
          }
        : null,
      effectiveAt: result.effectiveAt.toISOString(),
      newExpiry: result.newExpiry.toISOString(),
      credits: {
        plan: result.planCredits,
        extra: input.extraCredits,
        total: result.planCredits + input.extraCredits,
      },
      notify: input.notify,
      freshAuthRequired: result.freshAuthRequired,
    };
  }

  async apply(
    actor: AuthenticatedUser,
    owner: WalletOwner,
    input: AdminPlanChangeInput,
    request: FastifyRequest,
  ) {
    await this.requireOwner(owner);
    const now = new Date();
    const result = await this.evaluate(owner, input, now);
    if (result.blocked) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: result.blocked } });
    }
    if (await this.repo.alreadyApplied(owner, input.requestId)) {
      return { replayed: true as const, ...(await this.outcome(owner, result)) };
    }
    if (
      result.freshAuthRequired &&
      now.getTime() - actor.session.reauthAt.getTime() > FRESH_AUTH_MINUTES * 60_000
    ) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, {
        details: { reason: "reauth", maxAgeMinutes: FRESH_AUTH_MINUTES },
      });
    }
    if (input.kind === "sponsored") {
      if (!input.dealId || !(await this.repo.dealIsActive(input.dealId))) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { fields: ["dealId"], reason: "deal_unavailable" },
        });
      }
    }

    const extraCredits = (tx: Transaction) =>
      input.extraCredits > 0
        ? moveCreditsInTransaction(tx, owner, {
            kind: "admin_adjust",
            amount: input.extraCredits,
            idempotencyKey: `adjust:plan_change:${input.requestId}`,
            reason: `plan_change:${input.kind}`,
            actorId: actor.id,
          })
        : Promise.resolve(null);

    try {
      if (input.kind === "paid_offline") {
        const offline = input.paidOffline;
        const months = "months" in result.length ? result.length.months : null;
        if (!offline || months === null) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, {
            details: { fields: ["paidOffline"] },
          });
        }
        await this.repo.recordPaidOffline(
          {
            owner,
            planId: result.plan.id,
            months,
            currency: offline.currency,
            amountMinor: offline.amountMinor,
            methodKey: offline.methodKey,
            reference: offline.reference,
            adminId: actor.id,
            reason: input.reason,
            requestId: input.requestId,
          },
          this.hooks,
          now,
          { quiet: !input.notify, alsoInTransaction: extraCredits },
        );
      } else {
        const onApplied = async (tx: Transaction, subscription: { id: string }) => {
          await extraCredits(tx);
          if (!input.notify) return;
          if (owner.type === "user") {
            await tx.insert(userNotifications).values({
              userId: owner.id,
              kind: "subscription.admin_changed",
              params: { planKey: result.plan.key, changeKind: input.kind },
              link: "/billing",
            });
          }
          await tx
            .insert(outbox)
            .values({
              topic: "subscriptions.admin_notice",
              payload: { subscriptionId: subscription.id, kind: input.kind },
              idempotencyKey: `admin_notice:${input.requestId}`,
            })
            .onConflictDoNothing();
        };
        if (result.effect === "extend" && result.live) {
          await adminExtend(this.handle.db, {
            subscriptionId: result.live.id,
            length: result.length,
            reason: input.reason,
            actorId: actor.id,
            now,
            kind: input.kind,
            requestId: input.requestId,
            onApplied,
          });
        } else {
          await adminGrant(this.handle.db, {
            owner,
            planId: result.plan.id,
            length: result.length,
            reason: input.reason,
            actorId: actor.id,
            now,
            kind: input.kind,
            source: input.kind === "sponsored" ? "deal" : "admin_grant",
            ...(input.dealId ? { dealId: input.dealId } : {}),
            requestId: input.requestId,
            onApplied,
          });
        }
      }
    } catch (error) {
      return mapError(error);
    }

    await this.audit.recordFor(request, {
      action: owner.type === "user" ? "user.plan_change" : "org.plan_change",
      targetType: owner.type === "user" ? "user" : "organization",
      targetId: owner.id,
      after: {
        planKey: result.plan.key,
        kind: input.kind,
        effect: result.effect,
        ...result.length,
        extraCredits: input.extraCredits,
        notify: input.notify,
        reason: redactText(input.reason),
      },
    });
    return { replayed: false as const, ...(await this.outcome(owner, result)) };
  }

  private async outcome(owner: WalletOwner, result: Evaluation) {
    const live = await this.repo.liveSubscription(owner);
    return {
      effect: result.effect,
      subscriptionId: live?.id ?? null,
      planKey: live?.planKey ?? null,
      status: live?.status ?? null,
      currentPeriodEnd: live?.currentPeriodEnd.toISOString() ?? null,
    };
  }
}
