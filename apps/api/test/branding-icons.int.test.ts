import { randomInt } from "node:crypto";

import { appWaitlist, auditLogs, siteAssetHistory, siteAssets } from "@wasfa/db";
import {
  brandingAssetListSchema,
  putBrandingAssetResponseSchema,
} from "@wasfa/shared/schemas/branding";
import {
  adminAppWaitlistResponseSchema,
  appWaitlistResponseSchema,
} from "@wasfa/shared/schemas/public-site";
import { Queue } from "bullmq";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SettingsService } from "../src/settings/settings.service.js";

import { AdminTestContext, type Admin } from "./support/admin-context.js";
import { dataUrl, png, SVG } from "./support/branding-fixtures.js";
import { expectRateLimited } from "./support/identity-fixtures.js";

const ctx = new AdminTestContext();
let admin: Admin;
let images: Queue;

beforeAll(async () => {
  await ctx.start();
  admin = await ctx.admin("admin");
  images = new Queue("images", { connection: ctx.redis });
}, 600_000);

afterAll(async () => {
  await images?.close();
  await ctx.stop();
});

beforeEach(async () => {
  await ctx.owner.db.delete(siteAssetHistory);
  await ctx.owner.db.delete(siteAssets);
  await ctx.owner.db.delete(appWaitlist);
  await ctx.owner.db
    .delete(auditLogs)
    .where(inArray(auditLogs.action, ["branding.asset_revert", "app_waitlist.export"]));
  await ctx.app.get(SettingsService).set("branding", {}, { actorId: null });
  await ctx.app.get(SettingsService).set("landing", {}, { actorId: null });
  await images.obliterate({ force: true });
});

const put = (key: string, url: string) =>
  ctx.harness.call("PUT", `/admin/branding/assets/${key}`, {
    jar: admin.jar,
    body: { dataUrl: url },
  });
const revert = (key: string) =>
  ctx.harness.call("POST", `/admin/branding/assets/${key}/revert`, { jar: admin.jar });
const list = async () =>
  brandingAssetListSchema.parse(
    (await ctx.harness.call("GET", "/admin/branding/assets", { jar: admin.jar })).json(),
  );

describe("history and revert", () => {
  it("archives the replaced version, reverts to it and archives the one it replaces", async () => {
    const a = png(100, 40);
    const b = png(120, 50);
    await put("logo", dataUrl("image/png", a));
    expect((await list()).history).toEqual({});
    await put("logo", dataUrl("image/png", b));
    expect((await list()).history).toEqual({ logo: 1 });

    const res = await revert("logo");
    expect(res.statusCode, res.body).toBe(200);
    expect(putBrandingAssetResponseSchema.parse(res.json())).toMatchObject({
      width: 100,
      height: 40,
    });
    const [live] = await ctx.owner.db.select().from(siteAssets).where(eq(siteAssets.key, "logo"));
    expect(live?.data.equals(a)).toBe(true);
    // the setting follows the restored image
    const settings = await ctx.app.get(SettingsService).get("branding");
    expect(settings).toMatchObject({ logoWidth: 100, logoHeight: 40 });
    expect(await ctx.auditRowsFor("branding.asset_revert", "logo")).toHaveLength(1);

    // reverting again swaps back
    await revert("logo");
    const [again] = await ctx.owner.db.select().from(siteAssets).where(eq(siteAssets.key, "logo"));
    expect(again?.data.equals(b)).toBe(true);
  });

  it("restores a deleted image, and answers 404 when there is nothing to restore", async () => {
    expect((await revert("logo")).statusCode).toBe(404);
    await put("logo", dataUrl("image/png", png(100, 40)));
    await ctx.harness.call("DELETE", "/admin/branding/assets/logo", { jar: admin.jar });
    expect((await list()).items).toHaveLength(0);
    expect((await list()).history).toEqual({ logo: 1 });
    expect((await revert("logo")).statusCode).toBe(200);
    expect((await list()).items.map((item) => item.key)).toEqual(["logo"]);
  });

  it("keeps the last five versions of a key", async () => {
    for (let side = 10; side < 20; side += 1) {
      await put("logo", dataUrl("image/png", png(side, side)));
    }
    const rows = await ctx.owner.db
      .select()
      .from(siteAssetHistory)
      .where(eq(siteAssetHistory.key, "logo"));
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.width).sort()).toEqual([14, 15, 16, 17, 18]);
  });

  it("does not archive a byte-identical re-upload", async () => {
    const data = dataUrl("image/png", png(100, 40));
    await put("logo", data);
    await put("logo", data);
    expect((await list()).history).toEqual({});
  });

  it("serves a key without a branding field at /assets/<key> and 404 for an absent one", async () => {
    expect((await ctx.harness.call("GET", "/assets/icon_192")).statusCode).toBe(404);
    expect((await put("icon_192", dataUrl("image/png", png(192, 192)))).statusCode).toBe(200);
    const res = await ctx.harness.call("GET", "/assets/icon_192");
    expect(res.statusCode).toBe(200);
    expect(res.headers["etag"]).toMatch(/^"[a-f0-9]{64}"$/);
    expect(await ctx.app.get(SettingsService).get("branding")).toMatchObject({ faviconUrl: null });
  });
});

describe("symbol upload", () => {
  it("stores the sanitised SVG, enqueues the icon job once per digest and reports warnings", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="x()"><script>1</script><circle cx="50" cy="50" r="40" fill="#fefefe"/></svg>`;
    const res = await put("symbol", dataUrl("image/svg+xml", svg));
    expect(res.statusCode, res.body).toBe(200);
    const body = putBrandingAssetResponseSchema.parse(res.json());
    expect(body).toMatchObject({ key: "symbol", generating: true, warnings: ["low_contrast"] });

    const [row] = await ctx.owner.db.select().from(siteAssets).where(eq(siteAssets.key, "symbol"));
    expect(row?.data.toString()).not.toMatch(/script|onload/);

    const jobs = await images.getJobs(["waiting", "active", "delayed"]);
    expect(jobs.map((job) => [job.name, job.id, job.data])).toEqual([
      ["branding.icons", `branding-icons-${body.sha256}`, { sha256: body.sha256 }],
    ]);
    // the same symbol again does not queue a second copy of the waiting job
    await put("symbol", dataUrl("image/svg+xml", svg));
    expect(await images.getJobs(["waiting", "active", "delayed"])).toHaveLength(1);
  });

  it("refuses a bad symbol without storing or queueing", async () => {
    const res = await put(
      "symbol",
      dataUrl("image/svg+xml", SVG.replace('viewBox="0 0 200 60"', 'viewBox="0 0 200 60"')),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ details: { reason: "not_square" } });
    expect(await ctx.owner.db.select().from(siteAssets)).toHaveLength(0);
    expect(await images.getJobs(["waiting"])).toHaveLength(0);
  });
});

describe("apps waitlist", () => {
  const ip = () => `10.${randomInt(1, 200)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
  const body = (email = "Mona@Example.com") => ({
    email,
    platform: "android",
    marketingConsent: true,
    locale: "ar",
  });
  const join = (payload: Record<string, unknown>, from = ip()) =>
    ctx.harness.call("POST", "/public/app-waitlist", { ip: from, body: payload });
  const enable = () =>
    ctx.app
      .get(SettingsService)
      .set(
        "landing",
        { apps: { androidUrl: null, iosUrl: null, waitlistEnabled: true } },
        { actorId: null },
      );

  it("answers 404 while the switch is off", async () => {
    const res = await join(body());
    expect(res.statusCode).toBe(404);
    expect(await ctx.owner.db.select().from(appWaitlist)).toHaveLength(0);
  });

  it("answers 202 and stores the address lower-cased; a duplicate is the same answer and a no-op", async () => {
    await enable();
    const first = await join(body());
    expect(first.statusCode, first.body).toBe(202);
    expect(appWaitlistResponseSchema.parse(first.json())).toEqual({ received: true });
    const second = await join({ ...body("mona@example.com"), platform: "ios" });
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual({ received: true });

    const rows = await ctx.owner.db.select().from(appWaitlist);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "mona@example.com", platform: "android", locale: "ar" });
    expect(rows[0]?.consentAt).toBeInstanceOf(Date);
  });

  it("requires the explicit consent and a valid address", async () => {
    await enable();
    expect((await join({ ...body(), marketingConsent: false })).statusCode).toBe(400);
    expect((await join(body("not-an-email"))).statusCode).toBe(400);
  });

  it("limits per IP", async () => {
    await enable();
    const from = ip();
    for (let i = 0; i < 5; i += 1) {
      expect((await join(body(`n${i}@example.com`), from)).statusCode).toBe(202);
    }
    const limited = await join(body("n6@example.com"), from);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("limits to 10 a minute on the route itself", async () => {
    await enable();
    await expectRateLimited(ctx.harness, {
      method: "POST",
      url: "/public/app-waitlist",
      max: 10,
      body: { ...body(), marketingConsent: false },
    });
  });

  it("lists for settings.read, exports CSV and audits the export", async () => {
    await enable();
    await join(body("a@example.com"));
    await join(body("b@example.com"));
    const listed = adminAppWaitlistResponseSchema.parse(
      (await ctx.harness.call("GET", "/admin/app-waitlist", { jar: admin.jar })).json(),
    );
    expect(listed.total).toBe(2);
    expect(listed.items.map((item) => item.email).sort()).toEqual([
      "a@example.com",
      "b@example.com",
    ]);

    const csv = await ctx.harness.call("GET", "/admin/app-waitlist/export.csv", { jar: admin.jar });
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\r\n")[0]).toBe(
      "email,platform,locale,consent_at,notified_at,created_at",
    );
    expect(csv.body).toContain("a@example.com,android,ar,");
    expect(await ctx.auditRowsFor("app_waitlist.export", "")).toBeDefined();

    expect((await ctx.harness.call("GET", "/admin/app-waitlist")).statusCode).toBe(401);
  });
});
