import { Inject, Injectable } from "@nestjs/common";
import {
  adminOverviewResponseSchema,
  type OverviewQuery,
} from "@wasfa/shared/schemas/admin-billing-console";
import { Redis } from "ioredis";

import { REDIS } from "../../common/redis.js";
import { SettingsService } from "../../settings/settings.service.js";

import { maskName } from "./admin-billing-console.mask.js";
import { AdminBillingOverviewRepo, type OverviewWindow } from "./admin-billing-overview.repo.js";

const DAY_MS = 86_400_000;
const CACHE_SECONDS = 60;

/** The window a preset range covers; `custom` is exactly what the caller sent. */
export function overviewWindow(query: OverviewQuery, now: Date): OverviewWindow {
  if (query.range === "custom" && query.from && query.to) {
    return { from: query.from, to: query.to };
  }
  if (query.range === "today") {
    // Days are UTC days; the admin console shows dates in the viewer's zone around them.
    return {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      to: now,
    };
  }
  const days = query.range === "7d" ? 7 : 30;
  return { from: new Date(now.getTime() - days * DAY_MS), to: now };
}

@Injectable()
export class AdminBillingOverviewService {
  constructor(
    private readonly repo: AdminBillingOverviewRepo,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  counts() {
    return this.repo.counts();
  }

  /**
   * One cached document per range for a minute: the page polls, the aggregates scan whole tables.
   * A preset range is keyed by its name (its bounds move every second); `custom` by its bounds.
   */
  async overview(query: OverviewQuery) {
    const key = `admin:billing:overview:${query.range}:${
      query.range === "custom" ? (query.from?.toISOString() ?? "") : ""
    }:${query.range === "custom" ? (query.to?.toISOString() ?? "") : ""}`;
    const cached = await this.redis.get(key);
    if (cached) return adminOverviewResponseSchema.parse(JSON.parse(cached));

    const now = new Date();
    const current = overviewWindow(query, now);
    const length = current.to.getTime() - current.from.getTime();
    const previous = { from: new Date(current.from.getTime() - length), to: current.from };
    const { reviewSlaMinutes } = await this.settings.get("billing");

    const [kpis, previousKpis, planMix, topDiscounts, funnel, attention] = await Promise.all([
      this.repo.kpis(current),
      this.repo.kpis(previous),
      this.repo.planMix(current),
      this.repo.topDiscounts(current),
      this.repo.funnel(current),
      this.repo.attention(reviewSlaMinutes, now),
    ]);
    const response = adminOverviewResponseSchema.parse({
      generatedAt: now.toISOString(),
      range: { from: current.from.toISOString(), to: current.to.toISOString() },
      attention: {
        manualPaymentsWaiting: attention.manual,
        withdrawalsWaiting: attention.withdrawal,
        fraudHolds: attention.fraudHolds,
        failedOrMismatchPayments24h: attention.failedOrMismatch24h,
        subscriptionsEnding: attention.endingSubscriptions.map((row) => ({
          id: row.id,
          ownerLabel: maskName(row.ownerUserName ?? row.ownerOrgName),
          planKey: row.planKey,
          periodEnd: row.periodEnd.toISOString(),
          subtotalMinor: row.subtotalMinor,
        })),
        promotionsEnding: attention.endingPromotions.flatMap((row) =>
          row.endsAt ? [{ id: row.id, name: row.name, endsAt: row.endsAt.toISOString() }] : [],
        ),
        couponsNearLimit: attention.nearLimitCoupons.flatMap((row) =>
          row.max === null
            ? []
            : [{ id: row.id, code: row.code, redeemed: row.redeemed, max: row.max }],
        ),
      },
      kpis,
      previous: previousKpis,
      funnel,
      planMix,
      topDiscounts,
    });
    await this.redis.set(key, JSON.stringify(response), "EX", CACHE_SECONDS);
    return response;
  }
}
