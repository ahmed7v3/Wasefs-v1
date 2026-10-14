import { describe, expect, it, vi } from "vitest";

import { createSpendGuard, type SpendAlert } from "../src/index.js";

import { FakeRedis } from "./fake-redis.js";

const DAY = "2026-10-12";
const CAP = 1_000_000;

function setup(alertPercent = 80) {
  const redis = new FakeRedis();
  const alerts: SpendAlert[] = [];
  const onAlert = vi.fn((alert: SpendAlert) => {
    alerts.push(alert);
  });
  const guard = createSpendGuard(redis, {
    limits: () => Promise.resolve({ dailyCapUsdMicros: CAP, alertPercent }),
    onAlert,
    now: () => new Date(`${DAY}T10:00:00Z`),
  });
  return { redis, guard, alerts, onAlert };
}

describe("spend guard", () => {
  it("books the estimate on the UTC day key with a 3 day expiry and corrects it", async () => {
    const { redis, guard } = setup();
    expect(await guard.add(300_000)).toBe(DAY);
    expect(await redis.get(`ai:spend:${DAY}`)).toBe("300000");
    expect(redis.ttlSeconds(`ai:spend:${DAY}`)).toBe(3 * 24 * 60 * 60);

    await guard.correct(-100_000, DAY);
    expect(await redis.get(`ai:spend:${DAY}`)).toBe("200000");
  });

  it("refuses with ai_paused once spend reaches the cap, not before", async () => {
    const { guard } = setup();
    await guard.add(CAP - 1);
    await expect(guard.check(CAP)).resolves.toBeUndefined();
    await guard.correct(1);
    await expect(guard.check(CAP)).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      details: { reason: "ai_paused" },
    });
  });

  it("alerts once when crossing the threshold, however many calls follow", async () => {
    const { redis, guard, alerts, onAlert } = setup(80);
    await guard.add(700_000);
    expect(onAlert).not.toHaveBeenCalled();

    await guard.add(100_000);
    await guard.add(50_000);
    await guard.correct(20_000);
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(alerts[0]).toEqual({
      day: DAY,
      spendUsdMicros: 800_000,
      capUsdMicros: CAP,
      alertPercent: 80,
    });
    expect(redis.ttlSeconds(`ai:spend:alerted:${DAY}`)).toBe(2 * 24 * 60 * 60);
  });

  it("alerts once even when many calls cross at the same time", async () => {
    const { guard, onAlert } = setup(80);
    await Promise.all(Array.from({ length: 20 }, () => guard.add(100_000)));
    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  it("does not let a failing alert channel fail the call", async () => {
    const redis = new FakeRedis();
    const guard = createSpendGuard(redis, {
      limits: () => Promise.resolve({ dailyCapUsdMicros: CAP, alertPercent: 50 }),
      onAlert: () => Promise.reject(new Error("channel down")),
      now: () => new Date(`${DAY}T10:00:00Z`),
    });
    await expect(guard.add(900_000)).resolves.toBe(DAY);
  });
});
