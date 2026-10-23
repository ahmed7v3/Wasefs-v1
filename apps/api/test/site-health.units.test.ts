import { describe, expect, it } from "vitest";

import { bucketIndex, lastDays, p75, utcDay } from "../src/site-health/site-health.math.js";

describe("bucketIndex", () => {
  it("puts a value into the first bucket whose bound is >= the value", () => {
    expect(bucketIndex("LCP", 0)).toBe(0);
    expect(bucketIndex("LCP", 500)).toBe(0);
    expect(bucketIndex("LCP", 501)).toBe(1);
    expect(bucketIndex("LCP", 2500)).toBe(4);
    expect(bucketIndex("TTFB", 1800)).toBe(6);
  });

  it("sends values above the last bound to the overflow bucket", () => {
    expect(bucketIndex("LCP", 10_001)).toBe(9);
    expect(bucketIndex("INP", 99_999)).toBe(7);
  });

  it("scales CLS by 1000 before bucketing", () => {
    expect(bucketIndex("CLS", 0)).toBe(0);
    expect(bucketIndex("CLS", 0.01)).toBe(0);
    expect(bucketIndex("CLS", 0.1)).toBe(3);
    expect(bucketIndex("CLS", 0.1001)).toBe(4);
    expect(bucketIndex("CLS", 2)).toBe(7);
  });
});

describe("p75", () => {
  it("is null without samples", () => {
    expect(p75("LCP", new Array<number>(10).fill(0))).toBeNull();
  });

  it("returns the upper bound of the bucket where the cumulative count reaches 75 %", () => {
    // 4 samples: 3 in bucket 1 (<=1000), 1 in bucket 4 (<=2500): 3/4 reaches 75 % at bucket 1.
    expect(p75("LCP", [0, 3, 0, 0, 1, 0, 0, 0, 0, 0])).toBe(1000);
    // 3 in bucket 1, 2 in bucket 4: cumulative 3/5 = 60 % at bucket 1, so bucket 4.
    expect(p75("LCP", [0, 3, 0, 0, 2, 0, 0, 0, 0, 0])).toBe(2500);
  });

  it("is null when the percentile falls into the overflow bucket", () => {
    expect(p75("LCP", [0, 0, 0, 0, 0, 0, 0, 0, 0, 5])).toBeNull();
  });
});

describe("utc days", () => {
  it("formats and walks back in UTC", () => {
    const now = new Date("2026-03-01T01:30:00.000Z");
    expect(utcDay(now)).toBe("2026-03-01");
    expect(lastDays(now, 3)).toEqual(["2026-03-01", "2026-02-28", "2026-02-27"]);
  });
});
