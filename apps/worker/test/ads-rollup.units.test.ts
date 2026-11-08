import { describe, expect, it, vi } from "vitest";

import { adsRollupJob, drainAdCounters } from "../src/jobs/ads.rollup.job.js";

import type { JobContext } from "../src/queues.js";
import type { Redis } from "ioredis";

const CREATIVE = "01939c3a-6e6b-7d2e-8a41-0d2f5c3b9a10";
const key = (kind: "i" | "c", placement = "home.mid") =>
  `ads:c:${CREATIVE}:${placement}:2026-11-08:web:${kind}`;

/** The slice of ioredis the job uses, over a Map. */
function fakeRedis(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial));
  const redis = {
    scan: vi.fn(() => Promise.resolve(["0", [...store.keys()]] as [string, string[]])),
    getdel: vi.fn((k: string) => {
      const value = store.get(k) ?? null;
      store.delete(k);
      return Promise.resolve(value);
    }),
    pipeline: () => {
      const ops: (() => void)[] = [];
      const pipe = {
        incrby: (k: string, n: number) => {
          ops.push(() => store.set(k, String(Number(store.get(k) ?? 0) + n)));
          return pipe;
        },
        exec: () => {
          ops.forEach((op) => {
            op();
          });
          return Promise.resolve([]);
        },
      };
      return pipe;
    },
  };
  return { redis: redis as unknown as Redis, store };
}

describe("ads rollup", () => {
  it("folds impressions and clicks per creative, placement, day and channel and empties Redis", async () => {
    const { redis, store } = fakeRedis({
      [key("i")]: "40",
      [key("c")]: "3",
      [key("i", "home.after_hero")]: "7",
      "ads:c:not-a-counter": "9",
      "other:key": "1",
    });
    const { rows } = await drainAdCounters(redis);
    expect(rows).toEqual([
      {
        creativeId: CREATIVE,
        placement: "home.mid",
        day: "2026-11-08",
        channel: "web",
        impressions: 40,
        clicks: 3,
      },
      {
        creativeId: CREATIVE,
        placement: "home.after_hero",
        day: "2026-11-08",
        channel: "web",
        impressions: 7,
        clicks: 0,
      },
    ]);
    expect([...store.keys()].sort()).toEqual(["ads:c:not-a-counter", "other:key"]);
  });

  it("is idempotent: a second run finds nothing to count", async () => {
    const { redis } = fakeRedis({ [key("i")]: "5" });
    expect((await drainAdCounters(redis)).rows).toHaveLength(1);
    expect((await drainAdCounters(redis)).rows).toHaveLength(0);
  });

  it("puts the counters back when the database write fails, and adds them to ones that arrived meanwhile", async () => {
    const { redis, store } = fakeRedis({ [key("i")]: "5", [key("c")]: "2" });
    const transaction = vi.fn().mockRejectedValue(new Error("db down"));
    const logger = { info: vi.fn() };
    const context = { db: { transaction }, redis, logger } as unknown as JobContext;
    // A click lands between the drain and the failure.
    transaction.mockImplementationOnce(() => {
      store.set(key("c"), "1");
      return Promise.reject(new Error("db down"));
    });
    await expect(adsRollupJob({ source: "scheduler" }, context)).rejects.toThrow("db down");
    expect(store.get(key("i"))).toBe("5");
    expect(store.get(key("c"))).toBe("3");
  });

  it("does nothing when there are no counters", async () => {
    const { redis } = fakeRedis({});
    const transaction = vi.fn();
    const context = {
      db: { transaction },
      redis,
      logger: { info: vi.fn() },
    } as unknown as JobContext;
    await adsRollupJob({ source: "scheduler" }, context);
    expect(transaction).not.toHaveBeenCalled();
  });
});
