import { clickThroughRate, type AdChannel, type AdminAdStats } from "@wasfa/shared/ads";

/** One `ad_stats_daily` row with the creative's title (for the per-creative table). */
export interface AdStatsRow {
  creativeId: string;
  title: string;
  placementKey: string;
  day: string;
  channel: AdChannel;
  impressions: number;
  clicks: number;
}

interface Counts {
  impressions: number;
  clicks: number;
}

function add(map: Map<string, Counts>, key: string, row: AdStatsRow): void {
  const counts = map.get(key) ?? { impressions: 0, clicks: 0 };
  counts.impressions += row.impressions;
  counts.clicks += row.clicks;
  map.set(key, counts);
}

const withCtr = (counts: Counts) => ({
  ...counts,
  ctr: clickThroughRate(counts.impressions, counts.clicks),
});

/**
 * Totals and the four breakdowns of the console from the daily rows. Pure, so the CTR and the
 * grouping are unit-tested without a database. Days and placements sort by key, creatives and
 * channels by impressions (the biggest first).
 */
export function aggregateAdStats(
  rows: readonly AdStatsRow[],
  range: { from: string; to: string; channel: AdChannel | null },
): AdminAdStats {
  const byDay = new Map<string, Counts>();
  const byPlacement = new Map<string, Counts>();
  const byCreative = new Map<string, Counts>();
  const byChannel = new Map<string, Counts>();
  const titles = new Map<string, string>();
  const total: Counts = { impressions: 0, clicks: 0 };

  for (const row of rows) {
    total.impressions += row.impressions;
    total.clicks += row.clicks;
    titles.set(row.creativeId, row.title);
    add(byDay, row.day, row);
    add(byPlacement, row.placementKey, row);
    add(byCreative, row.creativeId, row);
    add(byChannel, row.channel, row);
  }

  const byImpressions = <T extends Counts>(a: T, b: T) => b.impressions - a.impressions;
  return {
    from: range.from,
    to: range.to,
    channel: range.channel,
    totals: withCtr(total),
    byDay: [...byDay]
      .map(([day, counts]) => ({ day, ...withCtr(counts) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    byPlacement: [...byPlacement]
      .map(([placement, counts]) => ({ placement, ...withCtr(counts) }))
      .sort((a, b) => a.placement.localeCompare(b.placement)),
    byCreative: [...byCreative]
      .map(([creativeId, counts]) => ({
        creativeId,
        title: titles.get(creativeId) ?? "",
        ...withCtr(counts),
      }))
      .sort(byImpressions),
    byChannel: [...byChannel]
      .map(([channel, counts]) => ({ channel: channel as AdChannel, ...withCtr(counts) }))
      .sort(byImpressions),
  };
}
