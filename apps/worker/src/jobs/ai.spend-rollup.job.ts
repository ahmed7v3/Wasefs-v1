import { sql } from "drizzle-orm";

import type { JobContext } from "../queues.js";
import type { Database } from "@wasfa/db";
import type { JobPayload } from "@wasfa/shared/queues";

type RollupContext = Pick<JobContext, "db" | "logger">;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 00:00 UTC of the day before `now`'s day: the rollup always recomputes yesterday and today. */
export function rollupStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS - DAY_MS);
}

/**
 * Recomputes `ai_spend_daily` for yesterday and today from `ai_usage` (a SET, not an increment, so
 * running it twice, late, or overlapping a call in flight leaves the same numbers). Yesterday is
 * included to catch calls that finished just after midnight. Returns the number of rows written.
 * Usage rows whose model or provider was removed (nulls) cannot be keyed, so they are skipped.
 */
export async function rollupAiSpend(db: Database, now: Date): Promise<number> {
  const from = rollupStart(now).toISOString();
  const written = await db.execute<{ day: string }>(sql`
    insert into ai_spend_daily (
      day, provider_id, model_id, calls,
      input_tokens, cached_input_tokens, output_tokens, thinking_tokens, cost_usd_micros
    )
    select
      (created_at at time zone 'utc')::date as day,
      provider_id,
      model_id,
      count(*)::int,
      sum(input_tokens),
      sum(cached_input_tokens),
      sum(output_tokens),
      sum(thinking_tokens),
      sum(cost_usd_micros)
    from ai_usage
    where created_at >= ${from}::timestamptz
      and provider_id is not null
      and model_id is not null
    group by 1, provider_id, model_id
    on conflict (day, provider_id, model_id) do update set
      calls = excluded.calls,
      input_tokens = excluded.input_tokens,
      cached_input_tokens = excluded.cached_input_tokens,
      output_tokens = excluded.output_tokens,
      thinking_tokens = excluded.thinking_tokens,
      cost_usd_micros = excluded.cost_usd_micros,
      updated_at = now()
    returning day
  `);
  return written.length;
}

/** `ai.spend_rollup`, hourly. Logs the row count only. */
export async function spendRollupJob(
  _payload: JobPayload<"credits", "ai.spend_rollup">,
  { db, logger }: RollupContext,
  now = new Date(),
): Promise<void> {
  const rows = await rollupAiSpend(db, now);
  logger.info({ rows }, "AI spend rolled up");
}
