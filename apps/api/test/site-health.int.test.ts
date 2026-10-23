import { siteHealthSchema } from "@wasfa/shared/schemas/public-site";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { utcDay } from "../src/site-health/site-health.math.js";

import { AdminTestContext, type Admin } from "./support/admin-context.js";

/*
 * Web-vitals beacon and crawler hit counters (Phase 4 WP1 §2.6, §5.8): public writes land in daily
 * Redis hashes, the admin read model sums them and reads p75 from the buckets.
 */

const ctx = new AdminTestContext();
let boss: Admin;

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
}, 180_000);

afterAll(async () => ctx.stop());

function beacon(payload: string) {
  // What `navigator.sendBeacon` sends: a text/plain body holding JSON, no cookies.
  return ctx.app.inject({
    method: "POST",
    url: "/public/vitals",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    payload,
  });
}

describe("site health", () => {
  it("counts beacons and reports p75 per route and metric", async () => {
    for (const value of [800, 900, 950, 3500]) {
      const response = await beacon(
        JSON.stringify({ metrics: [{ name: "LCP", value, route: "/pricing" }] }),
      );
      expect(response.statusCode, response.body).toBe(204);
    }
    await beacon(JSON.stringify({ metrics: [{ name: "CLS", value: 0.05, route: "/pricing" }] }));

    const response = await ctx.harness.call("GET", "/admin/site-health?days=7", { jar: boss.jar });
    expect(response.statusCode, response.body).toBe(200);
    const health = siteHealthSchema.parse(response.json());
    expect(health.days).toBe(7);
    expect(health.vitals).toContainEqual({ route: "/pricing", name: "LCP", samples: 4, p75: 1000 });
    expect(health.vitals).toContainEqual({ route: "/pricing", name: "CLS", samples: 1, p75: 50 });
    const ttl = await ctx.redis.ttl(`site:vitals:${utcDay(new Date())}`);
    expect(ttl).toBeGreaterThan(89 * 86_400);
  });

  it("rejects malformed beacons without storing anything", async () => {
    const before = await ctx.redis.hlen(`site:vitals:${utcDay(new Date())}`);
    expect((await beacon("not json")).statusCode).toBe(400);
    expect(
      (await beacon(JSON.stringify({ metrics: [{ name: "LCP", value: 1, route: "/a?x=1" }] })))
        .statusCode,
    ).toBe(400);
    expect(await ctx.redis.hlen(`site:vitals:${utcDay(new Date())}`)).toBe(before);
  });

  it("counts bot hits per bot and route", async () => {
    const hits = [
      { bot: "gptbot", route: "/blog/[rest]" },
      { bot: "gptbot", route: "/blog/[rest]" },
      { bot: "claudebot", route: "/" },
    ];
    const response = await ctx.app.inject({
      method: "POST",
      url: "/internal/bot-hits",
      payload: { hits },
    });
    expect(response.statusCode, response.body).toBe(204);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/internal/bot-hits",
          payload: { hits: [{ bot: "not-a-bot", route: "/" }] },
        })
      ).statusCode,
    ).toBe(400);

    const read = await ctx.harness.call("GET", "/admin/site-health?days=1", { jar: boss.jar });
    const health = siteHealthSchema.parse(read.json());
    expect(health.bots[0]).toEqual({ bot: "gptbot", route: "/blog/[rest]", hits: 2 });
    expect(health.bots).toContainEqual({ bot: "claudebot", route: "/", hits: 1 });
  });

  it("keeps the read model behind settings.read", async () => {
    expect((await ctx.harness.call("GET", "/admin/site-health")).statusCode).toBe(401);
    const person = await ctx.adminWithoutTwoFactor("support");
    const denied = await ctx.harness.call("GET", "/admin/site-health", { jar: person.jar });
    expect([401, 403]).toContain(denied.statusCode);
  });
});
