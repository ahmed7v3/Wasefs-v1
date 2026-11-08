import { parseAdCounterKey, type AdChannel } from "@wasfa/shared/ads";
import { sql } from "drizzle-orm";

import type { JobContext } from "../queues.js";
import type { Database } from "@wasfa/db";
import type { JobPayload } from "@wasfa/shared/queues";
import type { Redis } from "ioredis";

type RollupContext = Pick<JobContext, "db" | "redis" | "logger">;

const SCAN_COUNT = 500;
/** Rows per upsert statement; a few thousand counters a day is the realistic ceiling. */
const BATCH = 200;

interface Folded {
  creativeId: string;
  placement: string;
  day: string;
  channel: AdChannel;
  impressions: number;
  clicks: number;
}

/**
 * Takes every counter out of Redis with GETDEL (atomic read-and-remove, so two overlapping runs can
 * never count a value twice) and returns them folded per creative, placement, day and channel. Keys
 * that do not parse are left alone. `restore` puts a batch back if the database write fails, so a
 * failed run loses nothing and a successful one leaves nothing to count again.
 */
export async function drainAdCounters(redis: Redis): Promise<{
  rows: Folded[];
  restore: () => Promise<void>;
}> {
  const taken: { key: string; value: number }[] = [];
  const folded = new Map<string, Folded>();
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "ads:c:*", "COUNT", SCAN_COUNT);
    cursor = next;
    for (const key of keys) {
      const parsed = parseAdCounterKey(key);
      if (!parsed) continue;
      const raw = await redis.getdel(key);
      const value = raw === null ? 0 : Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value <= 0) continue;
      taken.push({ key, value });
      const id = [parsed.creativeId, parsed.placement, parsed.day, parsed.channel].join("|");
      const row = folded.get(id) ?? {
        creativeId: parsed.creativeId,
        placement: parsed.placement,
        day: parsed.day,
        channel: parsed.channel,
        impressions: 0,
        clicks: 0,
      };
      if (parsed.kind === "i") row.impressions += value;
      else row.clicks += value;
      folded.set(id, row);
    }
  } while (cursor !== "0");

  return {
    rows: [...folded.values()],
    restore: async () => {
      const pipeline = redis.pipeline();
      for (const { key, value } of taken) pipeline.incrby(key, value);
      await pipeline.exec();
    },
  };
}

/**
 * Adds the folded counters to `ad_stats_daily` (an ADD, not a SET: the counters were removed from
 * Redis, so each value is counted exactly once). Rows whose creative or placement no longer exists
 * are skipped by the join instead of failing the batch. Returns the number of rows written.
 */
export async function upsertAdStats(
  db: Pick<Database, "execute">,
  rows: readonly Folded[],
): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += BATCH) {
    const chunk = rows.slice(start, start + BATCH);
    const values = sql.join(
      chunk.map(
        (row) =>
          sql`(${row.creativeId}::uuid, ${row.placement}::text, ${row.day}::date, ${row.channel}::text, ${row.impressions}::int, ${row.clicks}::int)`,
      ),
      sql`, `,
    );
    const result = await db.execute<{ creative_id: string }>(sql`
      insert into ad_stats_daily (creative_id, placement_key, day, channel, impressions, clicks)
      select v.creative_id, v.placement_key, v.day, v.channel, v.impressions, v.clicks
      from (values ${values}) as v (creative_id, placement_key, day, channel, impressions, clicks)
      join ad_creatives c on c.id = v.creative_id
      join ad_placements p on p.key = v.placement_key
      on conflict (creative_id, placement_key, day, channel) do update set
        impressions = ad_stats_daily.impressions + excluded.impressions,
        clicks = ad_stats_daily.clicks + excluded.clicks
      returning creative_id
    `);
    written += result.length;
  }
  return written;
}

/** `ads.rollup`, every 5 minutes. Logs counts only: no creative ids of any visitor, there are none. */
export async function adsRollupJob(
  _payload: JobPayload<"system", "ads.rollup">,
  { db, redis, logger }: RollupContext,
): Promise<void> {
  const { rows, restore } = await drainAdCounters(redis);
  if (rows.length === 0) return;
  try {
    // One transaction: a failure after the first batch must not leave half counted and then restored.
    const written = await db.transaction((tx) => upsertAdStats(tx, rows));
    logger.info({ counters: rows.length, written }, "Ad statistics rolled up");
  } catch (error) {
    await restore();
    throw error;
  }
}
