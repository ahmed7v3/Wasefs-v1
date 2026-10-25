import { Inject, Injectable } from "@nestjs/common";
import { resolveDeal } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { isPlaceholderEmail } from "@wasfa/shared/identity";
import { maskEmail, maskPhone } from "@wasfa/shared/subscriptions";

import { DB, type DbHandle } from "../../common/database.js";
import { CreditsRepo } from "../../credits/credits.repo.js";
import { PlansService } from "../../plans/plans.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { decodeCursor, toPage, withoutCursor } from "../common/keyset.js";

import { AdminUsersRepo } from "./admin-users.repo.js";
import { safeAvatarUrl } from "./admin-users.service.js";
import { AdminUser360Repo, decodeTimelineCursor, encodeTimelineCursor } from "./user-360.repo.js";

import type { AdminUserPageQuery } from "@wasfa/shared/schemas/admin-user-360";

const DAY_MS = 86_400_000;
const USAGE_DAYS = 30;
const DEAL_PLANS_CHECKED = 10;

/** `A. S.` for "Ahmed Samir": enough to recognise a referrer, never the name. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => `${(Array.from(word)[0] ?? "").toUpperCase()}.`).join(" ");
}

/** The user 360 reads that need no health permission (ADMIN-CONSOLE-SPEC §8.1). */
@Injectable()
export class AdminUser360Service {
  constructor(
    private readonly users: AdminUsersRepo,
    private readonly repo: AdminUser360Repo,
    private readonly plans: PlansService,
    private readonly settings: SettingsService,
    private readonly credits: CreditsRepo,
    @Inject(DB) private readonly handle: DbHandle,
  ) {}

  private async require(userId: string) {
    const user = await this.users.find(userId);
    if (!user) throw new AppError(ErrorCode.NOT_FOUND);
    return user;
  }

  async summary(userId: string) {
    const user = await this.require(userId);
    const owner = { type: "user", id: userId } as const;
    const [subscription, plan, wallets, lastSeen, revenue, aiCost, source, memberships, providers] =
      await Promise.all([
        this.repo.liveSubscription(userId),
        this.plans.effectivePlan(owner),
        this.repo.wallets(userId),
        this.repo.lastSeen(userId),
        this.repo.lifetimeRevenue(userId),
        this.repo.lifetimeAiCostUsdMicros(userId),
        this.repo.referralSource(userId),
        this.users.memberships(userId),
        this.users.providersOf([userId]),
      ]);
    return {
      profile: {
        id: user.id,
        name: user.name,
        accountType: user.accountType,
        locale: user.locale,
        status: user.status,
        image: safeAvatarUrl(user.image),
        providers: providers.get(userId) ?? [],
      },
      // Contact data stays masked here; `reveal-contact` is the audited way to the plain value.
      contact: {
        email: isPlaceholderEmail(user.email) ? null : maskEmail(user.email),
        phone: user.phone ? maskPhone(user.phone) : null,
      },
      chips: {
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        suspended: user.status === "suspended",
      },
      plan: {
        key: plan.key,
        nameAr: plan.nameAr,
        nameEn: plan.nameEn,
        subscriptionId: subscription?.id ?? null,
        status: subscription?.status ?? null,
        source: subscription?.source ?? null,
        expiresAt: subscription?.currentPeriodEnd.toISOString() ?? null,
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      },
      wallets: {
        personal: {
          walletId: wallets.personal?.id ?? null,
          balance: wallets.personal?.balance ?? 0,
        },
        orgs: wallets.orgs.map((org) => ({
          orgId: org.orgId,
          name: org.name,
          walletId: org.walletId,
          balance: org.balance ?? 0,
        })),
      },
      memberships: memberships.map((m) => ({ id: m.id, name: m.name, type: m.type, role: m.role })),
      memberSince: user.createdAt.toISOString(),
      lastSeenAt: (lastSeen ?? user.lastLoginAt)?.toISOString() ?? null,
      lifetimeRevenue: revenue,
      lifetimeAiCostUsdMicros: aiCost,
      referralSource: source
        ? {
            referralId: source.referralId,
            code: source.code,
            codeKind: source.codeKind,
            source: source.source,
            status: source.status,
            referrerInitials: source.referrerName ? initialsOf(source.referrerName) : null,
          }
        : null,
    };
  }

  /** The plain e-mail or phone; the caller audits the reveal. */
  async contactValue(userId: string, field: "email" | "phone"): Promise<string | null> {
    const user = await this.require(userId);
    if (field === "phone") return user.phone;
    return isPlaceholderEmail(user.email) ? null : user.email;
  }

  async timeline(userId: string, query: AdminUserPageQuery) {
    await this.require(userId);
    const rows = await this.repo.timeline(userId, decodeTimelineCursor(query.cursor), query.limit);
    const shown = rows.slice(0, query.limit);
    const last = shown.at(-1);
    return {
      items: shown.map((row) => ({
        id: row.id,
        source: row.source,
        kind: row.kind,
        occurredAt: new Date(row.at).toISOString(),
        summaryKey: row.summaryKey,
        params: row.params,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeTimelineCursor({ at: last.at, key: last.key, id: last.id })
          : null,
    };
  }

  async billing(userId: string, query: AdminUserPageQuery) {
    await this.require(userId);
    const now = new Date();
    const currency = (await this.settings.get("currency")).default;
    const [subscriptions, history, orderRows, couponRows, priced] = await Promise.all([
      this.repo.subscriptionList(userId),
      this.repo.subscriptionHistory(userId),
      this.repo.ordersPage(userId, decodeCursor(query.cursor, "uuid"), query.limit),
      this.repo.couponsRedeemed(userId),
      this.repo.pricedPlans(currency),
    ]);
    const page = toPage(orderRows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    const payments = await this.repo.paymentsOfOrders(page.items.map((order) => order.id));

    let deal: {
      dealId: string;
      name: string;
      kind: string | null;
      planKey: string;
      reason: { key: string; params: Record<string, string | number> } | null;
    } | null = null;
    for (const plan of priced.slice(0, DEAL_PLANS_CHECKED)) {
      const resolution = await resolveDeal(this.handle.db, {
        ownerUserId: userId,
        planKey: plan.key,
        months: plan.months,
        currency,
        now,
      });
      if (resolution.deal) {
        deal = {
          dealId: resolution.deal.id,
          name: resolution.deal.name,
          kind: resolution.kind,
          planKey: plan.key,
          reason: resolution.chosenBecause,
        };
        break;
      }
    }

    return {
      current:
        subscriptions.find((row) => ["trialing", "active", "grace"].includes(row.status)) ?? null,
      subscriptions: subscriptions.map((row) => ({
        ...row,
        currentPeriodStart: row.currentPeriodStart.toISOString(),
        currentPeriodEnd: row.currentPeriodEnd.toISOString(),
      })),
      history: history.map((event) => ({
        id: event.id,
        type: event.type,
        data: event.data,
        actorId: event.actorId,
        createdAt: event.createdAt.toISOString(),
      })),
      orders: {
        items: page.items.map((order) => ({
          ...withoutCursor(order),
          createdAt: order.createdAt.toISOString(),
          paidAt: order.paidAt?.toISOString() ?? null,
          payments: payments
            .filter((payment) => payment.orderId === order.id)
            .map((payment) => ({ ...payment, createdAt: payment.createdAt.toISOString() })),
        })),
        nextCursor: page.nextCursor,
      },
      coupons: couponRows.map((row) => ({
        ...row,
        reservedAt: row.reservedAt.toISOString(),
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
      })),
      deal,
    };
  }

  async creditsView(userId: string, query: AdminUserPageQuery) {
    await this.require(userId);
    const wallets = await this.repo.wallets(userId);
    const since = new Date(Date.now() - USAGE_DAYS * DAY_MS);
    const [usage, ledgerRows] = await Promise.all([
      this.repo.usageByTaskDay(userId, since),
      wallets.personal
        ? this.credits.ledgerPage(
            wallets.personal.id,
            decodeCursor(query.cursor, "uuid"),
            query.limit,
          )
        : Promise.resolve([]),
    ]);
    const page = toPage(ledgerRows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return {
      wallets: {
        personal: {
          walletId: wallets.personal?.id ?? null,
          balance: wallets.personal?.balance ?? 0,
        },
        orgs: wallets.orgs.map((org) => ({
          orgId: org.orgId,
          name: org.name,
          walletId: org.walletId,
          balance: org.balance ?? 0,
        })),
      },
      ledger: {
        items: page.items.map((row) => ({
          id: row.id,
          kind: row.kind,
          amount: row.amount,
          balanceAfter: row.balanceAfter,
          reason: row.reason,
          actorId: row.actorId,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: page.nextCursor,
      },
      usage: { days: USAGE_DAYS, items: usage },
    };
  }

  async referralsView(userId: string, query: AdminUserPageQuery) {
    await this.require(userId);
    const [code, invitedBy, invitees, wallet, withdrawals] = await Promise.all([
      this.repo.ownCode(userId),
      this.repo.referralSource(userId),
      this.repo.invitees(userId),
      this.repo.pointsWallet(userId),
      this.repo.withdrawalsSummary(userId),
    ]);
    const ledgerRows = wallet
      ? await this.repo.pointsLedgerPage(wallet.id, decodeCursor(query.cursor, "uuid"), query.limit)
      : [];
    const page = toPage(ledgerRows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return {
      code: code ?? null,
      invitedBy: invitedBy
        ? {
            referralId: invitedBy.referralId,
            code: invitedBy.code,
            status: invitedBy.status,
            source: invitedBy.source,
            referrerInitials: invitedBy.referrerName ? initialsOf(invitedBy.referrerName) : null,
          }
        : null,
      invitees: invitees.map((row) => ({
        referralId: row.referralId,
        initials: initialsOf(row.refereeName),
        status: row.status,
        fraudScore: row.fraudScore,
        flags: row.flags,
        pendingPoints: row.pendingPoints,
        settledPoints: row.settledPoints,
        createdAt: row.createdAt.toISOString(),
      })),
      wallet: wallet
        ? {
            pending: wallet.pending,
            cash: wallet.cash,
            creditOnly: wallet.creditOnly,
            lifetimeEarned: wallet.lifetimeEarned,
          }
        : { pending: 0, cash: 0, creditOnly: 0, lifetimeEarned: 0 },
      ledger: {
        items: page.items.map((row) => ({
          ...withoutCursor(row),
          releaseAt: row.releaseAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: page.nextCursor,
      },
      withdrawals,
      flags: {
        asReferee: invitedBy ? { status: invitedBy.status } : null,
        flaggedInvitees: invitees.filter((row) => row.flags.length > 0 || row.fraudScore > 0)
          .length,
      },
    };
  }
}
