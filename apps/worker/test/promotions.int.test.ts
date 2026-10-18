import { createDb, coupons, promotions, seedDefaults } from "@wasfa/db";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { promotionsStatusJob } from "../src/jobs/promotions.job.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

const logger = pino({ level: "silent" });
let postgres: TestPostgres;
let db: ReturnType<typeof createDb>;
const now = new Date("2026-10-17T12:00:00.000Z");

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb({ url: postgres.ownerUrl, max: 2 });
  await seedDefaults(db.db);
}, 180_000);

afterAll(async () => {
  await db?.close();
  await postgres?.stop();
});

type Timing = { status: "scheduled" | "active" | "paused" | "draft" | "ended" } & {
  startsAt?: Date;
  endsAt?: Date;
};

const past = new Date(now.getTime() - 60_000);
const future = new Date(now.getTime() + 60_000);
const expired = new Date(now.getTime() - 1);

/** One row per clock case; the name doubles as the expectation key. */
const CASES: Record<string, Timing> = {
  "scheduled started": { status: "scheduled", startsAt: past },
  "scheduled without start": { status: "scheduled" },
  "scheduled still waiting": { status: "scheduled", startsAt: future },
  "scheduled expired": {
    status: "scheduled",
    startsAt: new Date(past.getTime() - 1),
    endsAt: expired,
  },
  "active expired": { status: "active", endsAt: expired },
  "paused expired": { status: "paused", endsAt: expired },
  "paused open": { status: "paused", startsAt: past },
  "draft expired": { status: "draft", endsAt: expired },
  "already ended": { status: "ended", endsAt: expired },
};

const EXPECTED: Record<string, string> = {
  "scheduled started": "active",
  "scheduled without start": "active",
  "scheduled still waiting": "scheduled",
  "scheduled expired": "ended",
  "active expired": "ended",
  "paused expired": "ended",
  "paused open": "paused",
  "draft expired": "draft",
  "already ended": "ended",
};

const statusByName = (rows: { name: string; status: string }[]) =>
  Object.fromEntries(rows.map((row) => [row.name, row.status]));

describe("promotions.status", () => {
  it("moves promotions and coupons by the clock, leaves the rest alone and is idempotent", async () => {
    const names = Object.keys(CASES);
    await db.db.insert(promotions).values(
      names.map((name) => ({
        kind: "percent" as const,
        name,
        titleAr: "عرض",
        titleEn: "Offer",
        value: 500,
        ...CASES[name],
      })),
    );
    await db.db.insert(coupons).values(
      names.map((name, index) => ({
        code: `CLOCK-${String(index + 1)}`,
        kind: "percent" as const,
        name,
        titleAr: "كوبون",
        titleEn: "Coupon",
        value: 500,
        ...CASES[name],
      })),
    );

    await promotionsStatusJob({}, { db: db.db, logger }, now);
    expect(statusByName(await db.db.select().from(promotions))).toEqual(EXPECTED);
    expect(statusByName(await db.db.select().from(coupons))).toEqual(EXPECTED);

    const touched = await db.db.select().from(promotions);
    expect(touched.find((row) => row.name === "scheduled started")?.updatedAt).toEqual(now);
    expect(touched.find((row) => row.name === "paused open")?.updatedAt).not.toEqual(now);

    // A second run finds nothing left to move: the statuses and the timestamps stay as they were.
    await promotionsStatusJob({}, { db: db.db, logger }, new Date(now.getTime() + 1_000));
    expect(statusByName(await db.db.select().from(promotions))).toEqual(EXPECTED);
    expect(statusByName(await db.db.select().from(coupons))).toEqual(EXPECTED);
    const again = await db.db.select().from(promotions);
    expect(again.find((row) => row.name === "scheduled started")?.updatedAt).toEqual(now);
  });
});
