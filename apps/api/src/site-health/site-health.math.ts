import { WEB_VITAL_BUCKETS, type WebVitalName } from "@wasfa/shared/schemas/public-site";

/** CLS is stored in thousandths so every metric shares integer bucket bounds. */
export function bucketIndex(name: WebVitalName, value: number): number {
  const bounds = WEB_VITAL_BUCKETS[name];
  const scaled = name === "CLS" ? value * 1000 : value;
  const index = bounds.findIndex((bound) => scaled <= bound);
  return index === -1 ? bounds.length : index;
}

/**
 * Upper bound of the bucket where the cumulative count first reaches 75 % of the samples; `null`
 * when that is the overflow bucket (or there are no samples).
 */
export function p75(name: WebVitalName, counts: readonly number[]): number | null {
  const bounds = WEB_VITAL_BUCKETS[name];
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const target = total * 0.75;
  let cumulative = 0;
  for (let index = 0; index <= bounds.length; index += 1) {
    cumulative += counts[index] ?? 0;
    if (cumulative >= target) return bounds[index] ?? null;
  }
  return null;
}

/** `YYYY-MM-DD` in UTC. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The last `days` UTC days, newest first, ending at `now`. */
export function lastDays(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, offset) =>
    utcDay(new Date(now.getTime() - offset * 86_400_000)),
  );
}
