import type { WebVitalName } from "@wasfa/shared/schemas/public-site";

/*
 * Core Web Vitals thresholds (good / poor boundaries) in the units the API stores: milliseconds,
 * and thousandths for CLS (0.1 / 0.25). The API gives p75 as a bucket upper bound, so a value
 * equal to the boundary still counts as the better rating.
 */
const THRESHOLDS: Record<WebVitalName, readonly [good: number, poor: number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [100, 250],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export type VitalRating = "good" | "needsImprovement" | "poor";

/** `null` p75 (overflow bucket) is beyond every threshold, so it rates as poor. */
export function rateVital(name: WebVitalName, p75: number | null): VitalRating {
  if (p75 === null) return "poor";
  const [good, poor] = THRESHOLDS[name];
  if (p75 <= good) return "good";
  return p75 <= poor ? "needsImprovement" : "poor";
}

/** Display value: CLS is a unitless score, the rest are milliseconds. */
export function vitalValue(name: WebVitalName, p75: number): string {
  return name === "CLS" ? String(p75 / 1000) : `${p75} ms`;
}
