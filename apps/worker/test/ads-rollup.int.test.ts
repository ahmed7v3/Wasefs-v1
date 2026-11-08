import { adCreatives, adStatsDaily, createDb } from "@wasfa/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { upsertAdStats } from "../src/jobs/ads.rollup.job.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

/* Run as the restricted `wasfa_api` role the worker uses in production. */

let postgres: TestPostgres;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let creativeId: string;

const row = (overrides: Partial<Parameters<typeof upsertAdStats>[1][number]> = {}) => ({
  creativeId,
  placement: "home.mid",
  day: "2026-11-08",
  channel: "web" as const,
  impressions: 10,
  clicks: 1,
  ...overrides,
});

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 4 });
  const [creative] = await owner.db
    .insert(adCreatives)
    .values({ title: "t", alt: "t", targetUrl: "https://example.com", category: "house" })
    .returning({ id: adCreatives.id });
  if (!creative) throw new Error("creative insert failed");
  creativeId = creative.id;
}, 180_000);

afterAll(async () => {
  await Promise.all([owner?.close(), worker?.close()]);
  await postgres?.stop();
});

async function stats(channel: "web" | "whatsapp" = "web") {
  const [found] = await owner.db
    .select()
    .from(adStatsDaily)
    .where(
      and(
        eq(adStatsDaily.creativeId, creativeId),
        eq(adStatsDaily.placementKey, "home.mid"),
        eq(adStatsDaily.channel, channel),
      ),
    );
  return found;
}

describe("ads rollup upsert", () => {
  it("adds to the day's row instead of replacing it", async () => {
    await upsertAdStats(worker.db, [row()]);
    await upsertAdStats(worker.db, [row({ impressions: 5, clicks: 2 })]);
    expect(await stats()).toMatchObject({ impressions: 15, clicks: 3, day: "2026-11-08" });
  });

  it("keeps channels apart", async () => {
    await upsertAdStats(worker.db, [row({ channel: "whatsapp", impressions: 4, clicks: 0 })]);
    expect(await stats("whatsapp")).toMatchObject({ impressions: 4, clicks: 0 });
    expect(await stats("web")).toMatchObject({ impressions: 15 });
  });

  it("skips counters of a creative or placement that no longer exists instead of failing", async () => {
    const written = await upsertAdStats(worker.db, [
      row({ creativeId: "00000000-0000-4000-8000-000000000000" }),
      row({ placement: "gone.placement" }),
      row({ day: "2026-11-09" }),
    ]);
    expect(written).toBe(1);
  });
});
