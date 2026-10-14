import { Inject, Injectable } from "@nestjs/common";
import { aiProviders, aiUsage } from "@wasfa/db";
import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, stamp, type Cursor } from "../common/keyset.js";

import type { AiOutcome, AiTask } from "@wasfa/shared/ai";

/** The filters after parsing: `from` inclusive and `to` exclusive, both instants. */
export interface UsageFilters {
  userId?: string | undefined;
  orgId?: string | undefined;
  task?: AiTask | undefined;
  model?: string | undefined;
  outcome?: AiOutcome | undefined;
  from?: Date | undefined;
  toExclusive?: Date | undefined;
}

export interface UsageRowData {
  id: string;
  createdAt: Date;
  task: AiTask;
  modelKey: string;
  providerKey: string | null;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  userId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  searchCount: number;
  costUsdMicros: number;
  creditsCharged: number;
  latencyMs: number | null;
  outcome: AiOutcome;
  cacheHit: boolean;
  requestId: string | null;
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
}

export interface UsageTotalsData {
  calls: number;
  costUsdMicros: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  creditsCharged: number;
  errors: number;
  cacheHits: number;
  avgLatencyMs: number | null;
}

/*
 * Read side of `ai_usage` for the explorer and the CSV export. The table holds ids, counts and
 * costs only (no prompt, no answer), so no column is ever withheld here: there is no content.
 */
const columns = {
  id: aiUsage.id,
  createdAt: aiUsage.createdAt,
  task: aiUsage.task,
  modelKey: aiUsage.modelKey,
  providerKey: aiProviders.key,
  ownerUserId: aiUsage.ownerUserId,
  ownerOrgId: aiUsage.ownerOrgId,
  userId: aiUsage.userId,
  inputTokens: aiUsage.inputTokens,
  cachedInputTokens: aiUsage.cachedInputTokens,
  outputTokens: aiUsage.outputTokens,
  thinkingTokens: aiUsage.thinkingTokens,
  searchCount: aiUsage.searchCount,
  costUsdMicros: aiUsage.costUsdMicros,
  creditsCharged: aiUsage.creditsCharged,
  latencyMs: aiUsage.latencyMs,
  outcome: aiUsage.outcome,
  cacheHit: aiUsage.cacheHit,
  requestId: aiUsage.requestId,
  cursorAt: stamp(aiUsage.createdAt),
};

function conditions(filters: UsageFilters, cursor?: Cursor): (SQL | undefined)[] {
  return [
    // A person is the owner of the usage or the one who acted on behalf of an organization.
    filters.userId === undefined
      ? undefined
      : or(eq(aiUsage.ownerUserId, filters.userId), eq(aiUsage.userId, filters.userId)),
    filters.orgId === undefined ? undefined : eq(aiUsage.ownerOrgId, filters.orgId),
    filters.task === undefined ? undefined : eq(aiUsage.task, filters.task),
    filters.model === undefined ? undefined : eq(aiUsage.modelKey, filters.model),
    filters.outcome === undefined ? undefined : eq(aiUsage.outcome, filters.outcome),
    filters.from === undefined ? undefined : gte(aiUsage.createdAt, filters.from),
    filters.toExclusive === undefined ? undefined : lt(aiUsage.createdAt, filters.toExclusive),
    cursor === undefined ? undefined : afterCursor(aiUsage.createdAt, aiUsage.id, cursor, "uuid"),
  ];
}

@Injectable()
export class AdminAiUsageRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** `limit + 1` rows, newest first, so the caller can tell whether another page exists. */
  list(
    filters: UsageFilters,
    cursor: Cursor | undefined,
    limit: number,
  ): Promise<UsageRowData[]> {
    return this.handle.db
      .select(columns)
      .from(aiUsage)
      .leftJoin(aiProviders, eq(aiProviders.id, aiUsage.providerId))
      .where(and(...conditions(filters, cursor)))
      .orderBy(desc(aiUsage.createdAt), desc(aiUsage.id))
      .limit(limit + 1);
  }

  async totals(filters: UsageFilters): Promise<UsageTotalsData> {
    const [row] = await this.handle.db
      .select({
        calls: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(${aiUsage.costUsdMicros}), 0)::float8`,
        input: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::float8`,
        output: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::float8`,
        thinking: sql<number>`coalesce(sum(${aiUsage.thinkingTokens}), 0)::float8`,
        credits: sql<number>`coalesce(sum(${aiUsage.creditsCharged}), 0)::float8`,
        errors: sql<number>`(count(*) filter (where ${aiUsage.outcome} in ('error', 'timeout')))::int`,
        cacheHits: sql<number>`(count(*) filter (where ${aiUsage.outcome} = 'cache_hit' or ${aiUsage.cacheHit}))::int`,
        latency: sql<number | null>`avg(${aiUsage.latencyMs})::float8`,
      })
      .from(aiUsage)
      .where(and(...conditions(filters)));
    return {
      calls: row?.calls ?? 0,
      costUsdMicros: Math.round(row?.cost ?? 0),
      inputTokens: Math.round(row?.input ?? 0),
      outputTokens: Math.round(row?.output ?? 0),
      thinkingTokens: Math.round(row?.thinking ?? 0),
      creditsCharged: Math.round(row?.credits ?? 0),
      errors: row?.errors ?? 0,
      cacheHits: row?.cacheHits ?? 0,
      avgLatencyMs: row?.latency == null ? null : Math.round(row.latency),
    };
  }
}
