import { randomUUID } from "node:crypto";

import { planAssignments, planEntitlements, plans } from "@wasfa/db";
import { AppError } from "@wasfa/shared/errors";
import { meCreditsResponseSchema } from "@wasfa/shared/schemas/credits";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CreditsService } from "../src/credits/credits.service.js";
import { QuotaService } from "../src/quota/quota.service.js";

import { AdminTestContext } from "./support/admin-context.js";

import type { QuotaCheckInput } from "../src/quota/quota.service.js";

/*
 * `plan_entitlements.monthly_cap` (Task 3.5): enforced like the daily cap, per owner, task and UTC
 * month, on top of it. A plan here allows 3 rx a day and 5 a month.
 */

const ctx = new AdminTestContext();
let quota: QuotaService;
let credits: CreditsService;
let planId: string;

beforeAll(async () => {
  await ctx.start();
  quota = ctx.app.get(QuotaService);
  credits = ctx.app.get(CreditsService);
  const [plan] = await ctx.owner.db
    .insert(plans)
    .values({ key: `capped_${randomUUID().slice(0, 6)}`, nameAr: "محدودة", nameEn: "Capped" })
    .returning();
  if (!plan) throw new Error("plan insert failed");
  planId = plan.id;
  await ctx.owner.db.insert(planEntitlements).values({
    planId,
    task: "rx_extract",
    allowed: true,
    modes: ["fast"],
    dailyCap: 3,
    monthlyCap: 5,
  });
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function cappedUser(): Promise<string> {
  const userId = await ctx.insertUser({
    name: "Monthly Person",
    email: `m${randomUUID().slice(0, 8)}@example.com`,
  });
  await ctx.owner.db.insert(planAssignments).values({
    ownerUserId: userId,
    planId,
    startsAt: new Date(Date.now() - 3_600_000),
  });
  return userId;
}

const rx = (userId: string): QuotaCheckInput => ({
  ownerUserId: userId,
  userId,
  task: "rx_extract",
  mode: "fast",
});

async function run(userId: string, at: Date): Promise<AppError | null> {
  try {
    const ticket = await quota.check(rx(userId), at);
    await ticket.release();
    return null;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
}

describe("QuotaService.check: monthly cap", () => {
  it("allows the month's cap across days, refuses the next with monthly_cap, and resets next month", async () => {
    const userId = await cappedUser();
    const day1 = new Date("2026-11-03T10:00:00.000Z");
    const day2 = new Date("2026-11-04T10:00:00.000Z");
    for (let i = 0; i < 3; i++) expect(await run(userId, day1)).toBeNull();
    // The daily cap still answers first.
    expect(await run(userId, day1)).toMatchObject({ details: { reason: "daily_cap" } });

    expect(await run(userId, day2)).toBeNull();
    expect(await run(userId, day2)).toBeNull();
    const refused = await run(userId, day2);
    expect(refused).toMatchObject({ code: "QUOTA_EXCEEDED", details: { reason: "monthly_cap" } });
    // The refused attempt spent neither today's nor this month's allowance.
    const owner = { type: "user", id: userId } as const;
    expect((await quota.usedToday(owner, ["rx_extract"], day2)).get("rx_extract")).toBe(2);
    expect((await quota.usedThisMonth(owner, ["rx_extract"], day2)).get("rx_extract")).toBe(5);
    expect(await ctx.redis.get(`busy:${userId}:rx`)).toBeNull();

    expect(await run(userId, new Date("2026-12-01T00:05:00.000Z"))).toBeNull();
  });

  it("keeps the month counter for about a month", async () => {
    const userId = await cappedUser();
    expect(await run(userId, new Date("2026-11-10T10:00:00.000Z"))).toBeNull();
    const keys = await ctx.redis.keys(`quota:*${userId}*:rx_extract:2026-11`);
    expect(keys).toHaveLength(1);
    const ttl = await ctx.redis.ttl(keys[0] ?? "");
    expect(ttl).toBeGreaterThan(30 * 86_400);
    expect(ttl).toBeLessThanOrEqual(35 * 86_400);
  });

  it("shows this month's use against the cap in GET /me/credits", async () => {
    const userId = await cappedUser();
    const now = new Date();
    expect(await run(userId, now)).toBeNull();
    const body = meCreditsResponseSchema.parse(await credits.forUser(userId, now));
    expect(body.thisMonth).toContainEqual({ task: "rx_extract", used: 1, monthlyCap: 5 });
    expect(body.today).toContainEqual({ task: "rx_extract", used: 1, dailyCap: 3 });
  });
});
