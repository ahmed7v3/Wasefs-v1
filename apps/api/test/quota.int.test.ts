import { randomUUID } from "node:crypto";

import { AppError } from "@wasfa/shared/errors";
import { meCreditsResponseSchema, meUsagePageSchema } from "@wasfa/shared/schemas/credits";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CreditsService } from "../src/credits/credits.service.js";
import { QuotaService } from "../src/quota/quota.service.js";

import { AdminTestContext } from "./support/admin-context.js";

import type { QuotaCheckInput } from "../src/quota/quota.service.js";

/*
 * Plan entitlements, the daily cap and the one-at-a-time lock against real Postgres and Redis, plus
 * the user-facing reads that sit next to them (`/me/credits` today-vs-caps, `/me/usage`).
 * The seeded `free` plan: rx_extract fast+balanced capped at 3 a day, chat fast+balanced uncapped,
 * no web_search.
 */

const ctx = new AdminTestContext();
let quota: QuotaService;
let credits: CreditsService;

beforeAll(async () => {
  await ctx.start();
  quota = ctx.app.get(QuotaService);
  credits = ctx.app.get(CreditsService);
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function newUser(): Promise<string> {
  return ctx.insertUser({
    name: "Quota Person",
    email: `q${randomUUID().slice(0, 8)}@example.com`,
  });
}

const rx = (userId: string): QuotaCheckInput => ({
  ownerUserId: userId,
  userId,
  task: "rx_extract",
  mode: "fast",
});

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected the check to be refused");
}

const today = () => new Date().toISOString().slice(0, 10);
const counter = (ownerId: string, task: string, type = "user") =>
  ctx.redis.get(`quota:${type}:${ownerId}:${task}:${today()}`);

describe("QuotaService.check: plan entitlement", () => {
  it("refuses a mode the plan does not include with PAYMENT_REQUIRED plan_feature", async () => {
    const userId = await newUser();
    const error = await refusal(quota.check({ ...rx(userId), mode: "deep" }));
    expect(error).toMatchObject({ code: "PAYMENT_REQUIRED", details: { reason: "plan_feature" } });
  });

  it("refuses a task the plan does not configure", async () => {
    const userId = await newUser();
    const error = await refusal(quota.check({ ...rx(userId), task: "web_search" }));
    expect(error).toMatchObject({ code: "PAYMENT_REQUIRED", details: { reason: "plan_feature" } });
  });

  it("takes no lock and spends no allowance when the plan refuses", async () => {
    const userId = await newUser();
    await refusal(quota.check({ ...rx(userId), mode: "deep" }));
    expect(await ctx.redis.get(`busy:${userId}:rx`)).toBeNull();
    expect(await counter(userId, "rx_extract")).toBeNull();
  });
});

describe("QuotaService.check: daily cap", () => {
  it("allows the cap, refuses the next with QUOTA_EXCEEDED daily_cap and rolls the count back", async () => {
    const userId = await newUser();
    for (let i = 0; i < 3; i++) {
      const ticket = await quota.check(rx(userId));
      await ticket.release();
    }
    const error = await refusal(quota.check(rx(userId)));
    expect(error).toMatchObject({ code: "QUOTA_EXCEEDED", details: { reason: "daily_cap" } });
    expect(await counter(userId, "rx_extract")).toBe("3");
    // The refused attempt released its lock: nothing is stuck busy.
    expect(await ctx.redis.get(`busy:${userId}:rx`)).toBeNull();
  });

  it("keeps the counter for two days", async () => {
    const userId = await newUser();
    const ticket = await quota.check(rx(userId));
    await ticket.release();
    const ttl = await ctx.redis.ttl(`quota:user:${userId}:rx_extract:${today()}`);
    expect(ttl).toBeGreaterThan(2 * 24 * 60 * 60 - 30);
    expect(ttl).toBeLessThanOrEqual(2 * 24 * 60 * 60);
  });

  it("lets exactly the cap through when many members of one organization race", async () => {
    const orgId = randomUUID();
    const members = await Promise.all(Array.from({ length: 10 }, () => newUser()));
    const results = await Promise.allSettled(
      members.map((userId) =>
        quota.check({ ownerOrgId: orgId, userId, task: "rx_extract", mode: "fast" }),
      ),
    );
    const accepted = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(accepted).toHaveLength(3);
    expect(refused).toHaveLength(7);
    for (const { reason } of refused) {
      expect(reason).toMatchObject({ code: "QUOTA_EXCEEDED", details: { reason: "daily_cap" } });
    }
    expect(await counter(orgId, "rx_extract", "org")).toBe("3");
  });

  it("does not cap a task the plan leaves uncapped", async () => {
    const userId = await newUser();
    for (let i = 0; i < 5; i++) {
      const ticket = await quota.check({ ...rx(userId), task: "title_gen" });
      expect(ticket.lock).toBeNull();
    }
    expect(await counter(userId, "title_gen")).toBeNull();
  });
});

describe("QuotaService.check: one long task at a time", () => {
  it("refuses a second rx for the same user with CONFLICT busy, until the first is released", async () => {
    const userId = await newUser();
    const first = await quota.check(rx(userId));
    expect(first.lock).toBe("rx");
    const error = await refusal(quota.check(rx(userId)));
    expect(error).toMatchObject({ code: "CONFLICT", details: { reason: "busy" } });
    // A busy refusal must not eat the day's allowance.
    expect(await counter(userId, "rx_extract")).toBe("1");

    await first.release();
    await first.release(); // twice is harmless
    const second = await quota.check(rx(userId));
    expect(await counter(userId, "rx_extract")).toBe("2");
    await second.release();
  });

  it("lets one rx and one chat run together, and other users run in parallel", async () => {
    const userId = await newUser();
    const other = await newUser();
    const analysis = await quota.check(rx(userId));
    const chat = await quota.check({ ...rx(userId), task: "chat" });
    const theirs = await quota.check(rx(other));
    expect([analysis.lock, chat.lock, theirs.lock]).toEqual(["rx", "chat", "rx"]);
    expect(await ctx.redis.ttl(`busy:${userId}:rx`)).toBeGreaterThan(0);

    const error = await refusal(quota.check({ ...rx(userId), task: "chat" }));
    expect(error).toMatchObject({ details: { reason: "busy" } });
    await Promise.all([analysis.release(), chat.release(), theirs.release()]);
  });

  it("can be released without a ticket (the worker ends an rx job)", async () => {
    const userId = await newUser();
    await quota.check(rx(userId));
    await quota.release(userId, "rx");
    await expect(quota.check(rx(userId))).resolves.toMatchObject({ lock: "rx" });
  });
});

describe("GET /me/credits today vs caps", () => {
  it("lists the allowed tasks with today's count and the plan's cap", async () => {
    const person = await ctx.harness.signedInUser();
    const ticket = await quota.check(rx(person.userId));
    await ticket.release();

    const res = await ctx.harness.call("GET", "/me/credits", { jar: person.jar });
    expect(res.statusCode, res.body).toBe(200);
    const body = meCreditsResponseSchema.parse(res.json());
    expect(body.today).toContainEqual({ task: "rx_extract", used: 1, dailyCap: 3 });
    expect(body.today).toContainEqual({ task: "chat", used: 0, dailyCap: null });
    expect(body.today.map((item) => item.task)).not.toContain("web_search");
  });
});

describe("GET /me/usage", () => {
  it("answers 401 without a session", async () => {
    const res = await ctx.harness.call("GET", "/me/usage");
    expect(res.statusCode).toBe(401);
  });

  it("is an empty page for someone who never used credits, and reading creates no wallet", async () => {
    const person = await ctx.harness.signedInUser();
    const res = await ctx.harness.call("GET", "/me/usage", { jar: person.jar });
    expect(res.statusCode, res.body).toBe(200);
    expect(meUsagePageSchema.parse(res.json())).toEqual({ items: [], nextCursor: null });
  });

  it("pages the caller's ledger newest first with a keyset cursor, and shows no private text", async () => {
    const person = await ctx.harness.signedInUser();
    const stranger = await ctx.harness.signedInUser();
    const owner = { type: "user" as const, id: person.userId };
    await credits.grant(owner, 30, "2026-10");
    const held = await credits.reserve(owner, 5, { idempotencyKey: randomUUID(), purpose: "rx" });
    await credits.settle(held.reservation.id, 3);
    await credits.adjust(owner, 4, {
      reason: "private admin note about this customer",
      actorId: stranger.userId,
      idempotencyKey: randomUUID(),
    });
    await credits.grant({ type: "user", id: stranger.userId }, 99, "2026-10");

    const seen = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/me/usage?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await ctx.harness.call("GET", url, { jar: person.jar });
      expect(res.statusCode, res.body).toBe(200);
      const page = meUsagePageSchema.parse(res.json());
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items);
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null && pages < 10);

    // grant, reserve, release, settle, adjust: five rows, newest first, no repeats or gaps.
    expect(seen.map((item) => item.kind)).toEqual([
      "admin_adjust",
      "usage_settle",
      "release",
      "usage_reserve",
      "grant",
    ]);
    expect(new Set(seen.map((item) => item.id)).size).toBe(5);
    expect(seen.map((item) => item.amount)).toEqual([4, -3, 5, -5, 30]);
    expect(seen.at(0)?.balanceAfter).toBe(31);

    const text = JSON.stringify(seen);
    expect(text).not.toContain("private admin note");
    expect(seen.find((item) => item.kind === "admin_adjust")?.reason).toBeNull();
    expect(seen.find((item) => item.kind === "grant")?.reason).toBe("monthly:2026-10");
    // Only the documented fields leave the API.
    for (const item of seen) {
      expect(Object.keys(item).sort()).toEqual(
        ["amount", "balanceAfter", "createdAt", "id", "kind", "reason"].sort(),
      );
    }
    // The other user's rows are theirs alone.
    expect(seen.map((item) => item.amount)).not.toContain(99);
  });

  it("rejects a malformed cursor with VALIDATION_FAILED", async () => {
    const person = await ctx.harness.signedInUser();
    const res = await ctx.harness.call("GET", "/me/usage?cursor=not-a-cursor", {
      jar: person.jar,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
