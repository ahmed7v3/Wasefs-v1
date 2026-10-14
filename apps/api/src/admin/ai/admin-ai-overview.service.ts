import { Inject, Injectable } from "@nestjs/common";
import { spendKey, utcDay } from "@wasfa/ai";
import { Redis } from "ioredis";

import { REDIS } from "../../common/redis.js";
import { SettingsService } from "../../settings/settings.service.js";

import { AdminAiOverviewRepo } from "./admin-ai-overview.repo.js";

import type { AiOverview, AiOverviewDays } from "@wasfa/shared/schemas/admin-ai";

const DAY_MS = 24 * 60 * 60 * 1000;
const MODELS_SHOWN = 8;

const ratio = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 10_000;

/** Today's spend against the cap, the last 7 or 30 days by task and model, and the quality rates. */
@Injectable()
export class AdminAiOverviewService {
  constructor(
    private readonly repo: AdminAiOverviewRepo,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async overview(days: AiOverviewDays, now = new Date()): Promise<AiOverview> {
    const today = utcDay(now);
    // The window is whole UTC days, today included, so the 7-day chart has 7 bars.
    const from = new Date(Date.parse(`${today}T00:00:00.000Z`) - (days - 1) * DAY_MS);

    const [ai, spend, totals, requests, perAnalysis, byDay, byTask, byModel] = await Promise.all([
      this.settings.get("ai"),
      this.todaySpend(today),
      this.repo.totals(from),
      this.repo.requests(from),
      this.repo.perAnalysis(from),
      this.repo.byDay(from),
      this.repo.byTask(from),
      this.repo.byModel(from, MODELS_SHOWN),
    ]);

    const known = new Map(byDay.map((row) => [row.day, row]));
    const series = Array.from({ length: days }, (_, index) => {
      const day = utcDay(new Date(from.getTime() + index * DAY_MS));
      return known.get(day) ?? { day, calls: 0, costUsdMicros: 0 };
    });

    return {
      days,
      generatedAt: now.toISOString(),
      today: {
        day: today,
        spendUsdMicros: spend.value,
        capUsdMicros: ai.dailyCapUsdMicros,
        alertPercent: ai.alertPercent,
        source: spend.source,
      },
      totals: {
        calls: totals.calls,
        costUsdMicros: totals.costUsdMicros,
        errorRate: ratio(totals.errors, totals.calls),
        fallbackRate: ratio(requests.fallbacks, requests.answered),
        cacheHitRate: ratio(totals.cacheHits, totals.calls),
        latencyP50Ms: totals.latencyP50Ms,
        latencyP95Ms: totals.latencyP95Ms,
      },
      perAnalysis,
      byDay: series,
      byTask,
      byModel,
    };
  }

  /** The spend guard figure (what the cap is checked against); the worker rollup when Redis is down. */
  private async todaySpend(day: string): Promise<{ value: number; source: "redis" | "database" }> {
    try {
      const raw = await this.redis.get(spendKey(day));
      const value = Number(raw ?? 0);
      if (Number.isFinite(value)) return { value: Math.max(0, Math.round(value)), source: "redis" };
    } catch {
      // Fall through to the database figure.
    }
    return { value: await this.repo.rolledUpSpend(day), source: "database" };
  }
}
