import { Inject, Injectable } from "@nestjs/common";
import { aiSpendDaily, aiUsage } from "@wasfa/db";
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { AiTask } from "@wasfa/shared/ai";

/*
 * SQL aggregates over `ai_usage` for the overview. Counts, sums and percentiles only: the table has
 * no content columns, and nothing here selects a row. Sums come back as float8 (exact far beyond
 * any realistic spend: 2^53 micros is about 9 billion USD) because postgres.js returns bigint as text.
 */

/** Rows that belong to real people: the per-analysis and fallback figures leave out evals and the playground. */
const byAnAccount = or(isNotNull(aiUsage.ownerUserId), isNotNull(aiUsage.ownerOrgId));

export interface OverviewTotals {
  calls: number;
  costUsdMicros: number;
  errors: number;
  cacheHits: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}

export interface OverviewRequests {
  answered: number;
  fallbacks: number;
}

export interface OverviewPerAnalysis {
  analyses: number;
  avgUsdMicros: number | null;
  p95UsdMicros: number | null;
}

@Injectable()
export class AdminAiOverviewRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async totals(from: Date): Promise<OverviewTotals> {
    const [row] = await this.handle.db
      .select({
        calls: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(${aiUsage.costUsdMicros}), 0)::float8`,
        errors: sql<number>`(count(*) filter (where ${aiUsage.outcome} in ('error', 'timeout')))::int`,
        cacheHits: sql<number>`(count(*) filter (where ${aiUsage.outcome} = 'cache_hit' or ${aiUsage.cacheHit}))::int`,
        p50: sql<number | null>`(percentile_cont(0.5) within group (order by ${aiUsage.latencyMs}) filter (where ${aiUsage.outcome} = 'ok'))::float8`,
        p95: sql<number | null>`(percentile_cont(0.95) within group (order by ${aiUsage.latencyMs}) filter (where ${aiUsage.outcome} = 'ok'))::float8`,
      })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, from));
    return {
      calls: row?.calls ?? 0,
      costUsdMicros: Math.round(row?.cost ?? 0),
      errors: row?.errors ?? 0,
      cacheHits: row?.cacheHits ?? 0,
      latencyP50Ms: row?.p50 == null ? null : Math.round(row.p50),
      latencyP95Ms: row?.p95 == null ? null : Math.round(row.p95),
    };
  }

  /**
   * One request (an analysis, a chat answer) is one `request_id` and task. It fell back when an
   * attempt failed and a later one of the same request and task answered: the router records every
   * attempt but keeps no explicit "fallback" flag, so this is the best the data allows.
   */
  async requests(from: Date): Promise<OverviewRequests> {
    const groups = this.handle.db
      .select({
        failed: sql<boolean>`bool_or(${aiUsage.outcome} in ('error', 'timeout'))`.as("failed"),
        answered: sql<boolean>`bool_or(${aiUsage.outcome} = 'ok')`.as("answered"),
      })
      .from(aiUsage)
      .where(and(gte(aiUsage.createdAt, from), isNotNull(aiUsage.requestId), byAnAccount))
      .groupBy(aiUsage.requestId, aiUsage.task)
      .as("groups");
    const [row] = await this.handle.db
      .select({
        answered: sql<number>`(count(*) filter (where ${groups.answered}))::int`,
        fallbacks: sql<number>`(count(*) filter (where ${groups.answered} and ${groups.failed}))::int`,
      })
      .from(groups);
    return { answered: row?.answered ?? 0, fallbacks: row?.fallbacks ?? 0 };
  }

  /**
   * Provider cost of one analysis: `rx_extract` and `rx_verify` rows share the analysis id as
   * `request_id` (the worker sets it). Analyses that cost nothing (cache hits) are left out so the
   * average describes analyses that really called a provider.
   */
  async perAnalysis(from: Date): Promise<OverviewPerAnalysis> {
    const total = sql<number>`sum(${aiUsage.costUsdMicros})::float8`;
    const analyses = this.handle.db
      .select({ total: total.as("total") })
      .from(aiUsage)
      .where(
        and(
          gte(aiUsage.createdAt, from),
          inArray(aiUsage.task, ["rx_extract", "rx_verify"] satisfies AiTask[]),
          isNotNull(aiUsage.requestId),
          byAnAccount,
        ),
      )
      .groupBy(aiUsage.requestId)
      .having(sql`sum(${aiUsage.costUsdMicros}) > 0`)
      .as("analyses");
    const [row] = await this.handle.db
      .select({
        count: sql<number>`count(*)::int`,
        avg: sql<number | null>`avg(${analyses.total})::float8`,
        p95: sql<number | null>`(percentile_cont(0.95) within group (order by ${analyses.total}))::float8`,
      })
      .from(analyses);
    return {
      analyses: row?.count ?? 0,
      avgUsdMicros: row?.avg == null ? null : Math.round(row.avg),
      p95UsdMicros: row?.p95 == null ? null : Math.round(row.p95),
    };
  }

  async byDay(from: Date): Promise<{ day: string; calls: number; costUsdMicros: number }[]> {
    const day = sql<string>`to_char(${aiUsage.createdAt} at time zone 'utc', 'YYYY-MM-DD')`;
    const rows = await this.handle.db
      .select({
        day,
        calls: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(${aiUsage.costUsdMicros}), 0)::float8`,
      })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, from))
      .groupBy(day)
      .orderBy(day);
    return rows.map((row) => ({
      day: row.day,
      calls: row.calls,
      costUsdMicros: Math.round(row.cost),
    }));
  }

  async byTask(from: Date): Promise<{ task: AiTask; calls: number; costUsdMicros: number }[]> {
    const cost = sql<number>`coalesce(sum(${aiUsage.costUsdMicros}), 0)::float8`;
    const rows = await this.handle.db
      .select({ task: aiUsage.task, calls: sql<number>`count(*)::int`, cost })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, from))
      .groupBy(aiUsage.task)
      .orderBy(desc(cost));
    return rows.map((row) => ({
      task: row.task,
      calls: row.calls,
      costUsdMicros: Math.round(row.cost),
    }));
  }

  async byModel(
    from: Date,
    limit: number,
  ): Promise<{ modelKey: string; calls: number; costUsdMicros: number }[]> {
    const cost = sql<number>`coalesce(sum(${aiUsage.costUsdMicros}), 0)::float8`;
    const rows = await this.handle.db
      .select({ modelKey: aiUsage.modelKey, calls: sql<number>`count(*)::int`, cost })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, from))
      .groupBy(aiUsage.modelKey)
      .orderBy(desc(cost))
      .limit(limit);
    return rows.map((row) => ({
      modelKey: row.modelKey,
      calls: row.calls,
      costUsdMicros: Math.round(row.cost),
    }));
  }

  /** The worker daily rollup: the fallback figure for "today" when Redis cannot be read. */
  async rolledUpSpend(day: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ cost: sql<number>`coalesce(sum(${aiSpendDaily.costUsdMicros}), 0)::float8` })
      .from(aiSpendDaily)
      .where(eq(aiSpendDaily.day, day));
    return Math.round(row?.cost ?? 0);
  }
}
