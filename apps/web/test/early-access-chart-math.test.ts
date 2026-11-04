import { describe, expect, it } from "vitest";

import {
  demandCurve,
  formatPercent,
  funnelSteps,
  niceMax,
  percent,
  scaleLinear,
} from "../src/components/admin/early-access/chart-math";

describe("early-access chart math", () => {
  it("percent guards an empty whole", () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent(3, 0)).toBe(0);
  });

  it("formats percentages with at most one decimal", () => {
    expect(formatPercent(50)).toBe("50%");
    expect(formatPercent(33.333)).toBe("33.3%");
  });

  it("scales linearly and survives a flat domain", () => {
    const scale = scaleLinear([0, 10], [100, 200]);
    expect(scale(5)).toBe(150);
    expect(scaleLinear([3, 3], [0, 10])(3)).toBe(5);
  });

  it("rounds the axis maximum up to 1, 2 or 5 x 10^n", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(130)).toBe(200);
    expect(niceMax(2)).toBe(2);
  });

  it("computes funnel drops between steps", () => {
    const steps = funnelSteps([100, 40, 10]);
    expect(steps[1]?.drop).toBe(60);
    expect(steps[2]?.ofPrevious).toBe(25);
    expect(steps[2]?.ofFirst).toBe(10);
    expect(steps[0]?.drop).toBe(0);
  });

  it("builds a demand curve sorted by price", () => {
    const curve = demandCurve([
      { priceMinor: 9900, answered: 10, yes: 2, maybe: 3 },
      { priceMinor: 4900, answered: 10, yes: 5, maybe: 1 },
    ]);
    expect(curve.map((p) => p.priceMinor)).toEqual([4900, 9900]);
    expect(curve[0]?.yesPct).toBe(50);
    expect(curve[1]?.yesMaybePct).toBe(50);
  });
});
