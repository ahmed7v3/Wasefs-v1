import { Injectable } from "@nestjs/common";
import { formatMoney } from "@wasfa/shared/money";

import { CreditsService } from "../../credits/credits.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { SubscriptionsService } from "../../subscriptions/subscriptions.service.js";

import type { AccountStatusFacts } from "./tools/index.js";

/** Orders listed to the model: the newest few are enough to answer "where is my payment". */
const ORDERS_FETCHED = 10;

/**
 * The account facts behind `account_status`, assembled from the services the web app already uses
 * (credits, subscriptions, orders). It reads only for the user id the server passes in.
 */
@Injectable()
export class AgentAccountService {
  constructor(
    private readonly credits: CreditsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly settings: SettingsService,
  ) {}

  async status(userId: string, now: Date): Promise<AccountStatusFacts> {
    const [wallet, mine, orders, rx] = await Promise.all([
      this.credits.forUser(userId, now),
      this.subscriptions.mine(userId, now),
      this.subscriptions.orders(userId, ORDERS_FETCHED),
      this.settings.get("rx"),
    ]);
    const subscription = mine.subscription;
    return {
      plan: { key: wallet.plan.key, name: wallet.plan.nameAr },
      subscription: subscription
        ? {
            status: subscription.status,
            endsAt: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
      credits: {
        balance: wallet.wallet.balance,
        monthlyCredits: wallet.monthlyCredits,
        nextGrantAt: wallet.nextGrantAt,
      },
      usage: {
        rxCreditsPerPage: rx.creditsPerPage,
        rxMaxPages: rx.maxPages,
        chatCharging: "by_use",
      },
      pendingOrders: orders.items
        .filter((order) => order.status === "pending_payment")
        .map((order) => ({
          number: order.number,
          item: order.planKey ?? order.packKey ?? order.kind,
          amountMinor: order.totalMinor,
          currency: order.currency,
          amountFormatted: formatMoney(order.totalMinor, order.currency, "ar"),
          status: order.status,
        })),
    };
  }
}
