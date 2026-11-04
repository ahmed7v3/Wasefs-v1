/*
 * Pure math of the early-access charts (scales, percentages, funnel drops, demand-curve points).
 * Kept free of React so it is unit tested.
 */

/** Part of a whole as a percentage, 0 when the whole is empty. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** "12.5%" with one decimal at most, Western digits. */
export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}%`;
}

/** Linear scale from a numeric domain to a pixel range; a flat domain maps to the range middle. */
export function scaleLinear(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return () => (r0 + r1) / 2;
  return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}

/** Smallest "nice" axis maximum (1, 2, 5 x 10^n) that is at least `max`; 1 for an empty chart. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exponent = Math.floor(Math.log10(max));
  const base = 10 ** exponent;
  for (const step of [1, 2, 5, 10]) {
    if (step * base >= max) return step * base;
  }
  return 10 * base;
}

export interface FunnelStep {
  sessions: number;
  /** Share of the first step. */
  ofFirst: number;
  /** Share of the previous step (100 for the first). */
  ofPrevious: number;
  /** Percentage lost since the previous step (0 for the first). */
  drop: number;
}

export function funnelSteps(sessions: readonly number[]): FunnelStep[] {
  const first = sessions[0] ?? 0;
  return sessions.map((count, index) => {
    const previous = index === 0 ? count : (sessions[index - 1] ?? 0);
    const ofPrevious = index === 0 ? 100 : percent(count, previous);
    return {
      sessions: count,
      ofFirst: percent(count, first),
      ofPrevious,
      drop: index === 0 || previous === 0 ? 0 : 100 - ofPrevious,
    };
  });
}

export interface CurvePoint {
  priceMinor: number;
  answered: number;
  yesPct: number;
  yesMaybePct: number;
}

/** Demand-curve points of one currency, ascending by price. */
export function demandCurve(
  rows: readonly { priceMinor: number; answered: number; yes: number; maybe: number }[],
): CurvePoint[] {
  return [...rows]
    .sort((a, b) => a.priceMinor - b.priceMinor)
    .map((row) => ({
      priceMinor: row.priceMinor,
      answered: row.answered,
      yesPct: percent(row.yes, row.answered),
      yesMaybePct: percent(row.yes + row.maybe, row.answered),
    }));
}

/** SVG polyline `points` attribute. */
export function polyline(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`).join(" ");
}
