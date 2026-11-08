import { adCreatives, adPlacements, siteSettings } from "@wasfa/db";
import { adCounterKey, adSlotResponseSchema } from "@wasfa/shared/ads";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signAdToken, utcDay } from "../src/ads/ads-token.js";
import { SettingsService } from "../src/settings/settings.service.js";

import { AdminTestContext } from "./support/admin-context.js";

/*
 * Public ad delivery against real Postgres and Redis: slot selection with the floor, the signed
 * token, the batched impression beacon, the click redirect lookup and the Redis counters the worker
 * folds. Placements come from the migration seed (all disabled).
 */

const ctx = new AdminTestContext();
const db = () => ctx.owner.db;
const TARGET = "https://partner.example/offer";
let creativeId: string;

async function setAds(value: Record<string, unknown>): Promise<void> {
  await db()
    .insert(siteSettings)
    .values({ key: "ads", value })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value } });
  await ctx.app.get(SettingsService).invalidate("ads");
}

const slot = (query: string) => ctx.harness.call("GET", `/public/ads/slot?${query}`);

beforeAll(async () => {
  await ctx.start();
  const [created] = await db()
    .insert(adCreatives)
    .values({
      title: "Credit packs",
      alt: "Credit packs",
      targetUrl: TARGET,
      category: "house",
      status: "approved",
    })
    .returning({ id: adCreatives.id });
  if (!created) throw new Error("creative was not stored");
  creativeId = created.id;
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

describe("public ad delivery", () => {
  it("ships every seeded placement disabled and serves nothing by default", async () => {
    const rows = await db().select().from(adPlacements);
    expect(rows.length).toBeGreaterThan(15);
    expect(rows.every((row) => !row.enabled)).toBe(true);
    const res = await slot("placement=home.mid&pageClass=marketing");
    expect(res.statusCode).toBe(200);
    expect(adSlotResponseSchema.parse(res.json()).slot).toBeNull();
  });

  it("serves a labelled-ready slot with a signed token once switched on", async () => {
    await setAds({ enabled: true });
    await db().update(adPlacements).set({ enabled: true }).where(eq(adPlacements.key, "home.mid"));
    // The global switch was off until now, so the snapshot (15 s cache) is first loaded here, fresh.
    const res = await slot("placement=home.mid&pageClass=marketing&device=desktop&locale=ar");
    const body = adSlotResponseSchema.parse(res.json());
    expect(body.slot?.creative.title).toBe("Credit packs");
    expect(body.slot?.placement).toBe("home.mid");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("never serves on a floor class, even for an enabled placement", async () => {
    await db()
      .update(adPlacements)
      .set({ pageClasses: ["marketing", "conversion", "app_sensitive"] })
      .where(eq(adPlacements.key, "home.mid"));
    for (const pageClass of ["conversion", "app_sensitive"]) {
      const res = await slot(`placement=home.mid&pageClass=${pageClass}`);
      expect(adSlotResponseSchema.parse(res.json()).slot).toBeNull();
    }
  });

  it("refuses to store an approved medicine creative", async () => {
    await expect(
      db().insert(adCreatives).values({
        title: "Pills",
        alt: "Pills",
        targetUrl: TARGET,
        category: "medicine",
        status: "approved",
      }),
    ).rejects.toThrow();
  });

  it("counts a batch of impressions and a click, and redirects only to the stored URL", async () => {
    const now = new Date();
    const token = signAdToken(
      ctx.env.BETTER_AUTH_SECRET,
      { creativeId, placement: "home.mid", day: utcDay(now), channel: "web" },
      now,
    );
    const key = (kind: "i" | "c") =>
      adCounterKey({
        creativeId,
        placement: "home.mid",
        day: utcDay(now),
        channel: "web",
        kind,
      });
    await ctx.redis.del(key("i"), key("c"));

    const beacon = await ctx.harness.call("POST", "/public/ads/impressions", {
      body: { tokens: [token, token, "garbage"] },
    });
    expect(beacon.statusCode).toBe(204);
    expect(await ctx.redis.get(key("i"))).toBe("1");

    const click = await ctx.harness.call("POST", "/public/ads/click", { body: { token } });
    expect(click.statusCode).toBe(200);
    expect(click.json()).toEqual({ url: TARGET });
    expect(await ctx.redis.get(key("c"))).toBe("1");

    const bad = await ctx.harness.call("POST", "/public/ads/click", { body: { token: "nope" } });
    expect(bad.statusCode).toBe(404);
  });
});
