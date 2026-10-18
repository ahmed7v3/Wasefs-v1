import { Inject, Injectable } from "@nestjs/common";
import {
  SubscriptionsError,
  adminEnd,
  adminExtend,
  cancelAtPeriodEnd,
  subscriptionOwner,
} from "@wasfa/db";
import { LIVE_SUBSCRIPTION_STATUSES } from "@wasfa/shared/billing";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { pendingChangeSchema } from "@wasfa/shared/subscriptions";

import { DB, type DbHandle } from "../../common/database.js";
import { decodeCursor, toPage } from "../common/keyset.js";

import { maskName } from "./admin-billing-console.mask.js";
import { AdminBillingSubscriptionsRepo } from "./admin-billing-subscriptions.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../../common/current-user.js";
import type {
  SubscriptionExtend,
  SubscriptionListQuery,
} from "@wasfa/shared/schemas/admin-billing-console";

const DAY_MS = 86_400_000;
/** The longest reminder lead (BILLING §7.5): inside it, the next step is worth showing. */
const RENEWAL_LOOKAHEAD_DAYS = 7;

export type SubscriptionNextAction =
  "renewal_due" | "grace" | "downgrade_scheduled" | "ends" | "none";

const isLive = (status: string) =>
  (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);

/** What the lifecycle will do next with this subscription, for the list action column. */
export function subscriptionNextAction(
  subscription: {
    status: string;
    source: string;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    pendingChange: unknown;
  },
  now: Date,
): SubscriptionNextAction {
  if (!isLive(subscription.status)) return "none";
  if (subscription.status === "grace") return "grace";
  if (subscription.pendingChange) return "downgrade_scheduled";
  if (subscription.cancelAtPeriodEnd) return "ends";
  const soon =
    subscription.currentPeriodEnd.getTime() - now.getTime() <= RENEWAL_LOOKAHEAD_DAYS * DAY_MS;
  if (!soon) return "none";
  // A free period (trial, grant, deal) just ends; a paid one waits for the customer to renew.
  return subscription.source === "paid" ? "renewal_due" : "ends";
}

function mapError(error: unknown): never {
  if (error instanceof SubscriptionsError) {
    if (error.reason === "not_found") throw new AppError(ErrorCode.NOT_FOUND, { cause: error });
    if (error.reason === "invalid_period") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { cause: error });
    }
    throw new AppError(ErrorCode.CONFLICT, { cause: error, details: { reason: error.reason } });
  }
  throw error;
}

@Injectable()
export class AdminBillingSubscriptionsService {
  constructor(
    private readonly repo: AdminBillingSubscriptionsRepo,
    @Inject(DB) private readonly handle: DbHandle,
  ) {}

  async list(query: SubscriptionListQuery) {
    const now = new Date();
    const rows = await this.repo.list(query, decodeCursor(query.cursor, "uuid"), now);
    const page = toPage(rows, query.limit, (row) => ({ at: row.at, key: row.subscription.id }));
    return {
      items: page.items.map(({ subscription, planKey, userName, orgName }) => ({
        id: subscription.id,
        owner: {
          type: subscription.ownerUserId ? ("user" as const) : ("org" as const),
          id: subscription.ownerUserId ?? subscription.ownerOrgId ?? subscription.id,
          label: maskName(userName ?? orgName),
        },
        planKey,
        status: subscription.status,
        source: subscription.source,
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        pendingChange: subscription.pendingChange,
        nextAction: subscriptionNextAction(subscription, now),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async detail(id: string) {
    const row = await this.repo.detail(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const { subscription, plan } = row;
    const pending = subscription.pendingChange
      ? pendingChangeSchema.safeParse(subscription.pendingChange)
      : null;
    return {
      subscription: {
        id: subscription.id,
        planKey: plan.key,
        status: subscription.status,
        source: subscription.source,
        currentPeriodStart: subscription.currentPeriodStart.toISOString(),
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        graceUntil: subscription.graceUntil?.toISOString() ?? null,
        monthsPaid: subscription.monthsPaid,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        canceledAt: subscription.canceledAt?.toISOString() ?? null,
        pendingChange: pending?.success ? pending.data : null,
        priceSnapshot: subscription.priceSnapshot,
        nextAction: subscriptionNextAction(subscription, new Date()),
      },
      owner: {
        type: subscription.ownerUserId ? ("user" as const) : ("org" as const),
        id: subscription.ownerUserId ?? subscription.ownerOrgId ?? subscription.id,
        label: maskName(row.userName ?? row.orgName),
      },
      plan: {
        key: plan.key,
        nameAr: plan.nameAr,
        nameEn: plan.nameEn,
        monthlyCredits: plan.monthlyCredits,
      },
      entitlements: row.entitlements.map((entitlement) => ({
        task: entitlement.task,
        allowed: entitlement.allowed,
        modes: entitlement.modes,
        dailyCap: entitlement.dailyCap,
        monthlyCap: entitlement.monthlyCap,
        maxPagesPerRx: entitlement.maxPagesPerRx,
        webSearch: entitlement.webSearch,
      })),
      creditBalance: row.creditBalance,
      events: row.events.map((event) => ({
        id: event.id,
        type: event.type,
        data: event.data,
        actorId: event.actorId,
        createdAt: event.createdAt.toISOString(),
      })),
      orders: row.recentOrders.map((order) => ({
        ...order,
        createdAt: order.createdAt.toISOString(),
        paidAt: order.paidAt?.toISOString() ?? null,
      })),
    };
  }

  async extend(id: string, actor: AuthenticatedUser, input: SubscriptionExtend, audit: AuditScope) {
    const row = await this.repo.detail(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const now = new Date();
    let length: { months: number } | { days: number };
    if (input.months !== undefined) {
      length = { months: input.months };
    } else if (input.until !== undefined) {
      // `adminExtend` counts from the old end, or from now when the subscription is in grace.
      const from = row.subscription.status === "grace" ? now : row.subscription.currentPeriodEnd;
      const days = Math.ceil((input.until.getTime() - from.getTime()) / DAY_MS);
      if (days < 1) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["until"] } });
      }
      length = { days };
    } else {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["months"] } });
    }
    // Dates are not audited as text: the audit redactor reads a date as a digit run and scrubs it.
    audit.targetId = id;
    audit.after = { ...length, reason: input.reason };
    try {
      const result = await adminExtend(this.handle.db, {
        subscriptionId: id,
        length,
        reason: input.reason,
        actorId: actor.id,
        now,
      });
      return {
        id: result.id,
        status: result.status,
        currentPeriodEnd: result.currentPeriodEnd.toISOString(),
      };
    } catch (error) {
      return mapError(error);
    }
  }

  async end(id: string, actor: AuthenticatedUser, reason: string) {
    try {
      const result = await adminEnd(this.handle.db, {
        subscriptionId: id,
        reason,
        actorId: actor.id,
        now: new Date(),
      });
      return {
        id: result.id,
        status: result.status,
        currentPeriodEnd: result.currentPeriodEnd.toISOString(),
      };
    } catch (error) {
      return mapError(error);
    }
  }

  async cancelAtPeriodEnd(id: string) {
    const row = await this.repo.detail(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    // `cancelAtPeriodEnd` acts on the live subscription of the owner, so this one must be it.
    if (!isLive(row.subscription.status)) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "no_live_subscription" } });
    }
    try {
      const result = await cancelAtPeriodEnd(
        this.handle.db,
        subscriptionOwner(row.subscription),
        new Date(),
      );
      return { id: result.id, cancelAtPeriodEnd: result.cancelAtPeriodEnd };
    } catch (error) {
      return mapError(error);
    }
  }
}
