import { createHash } from "node:crypto";

import { auditLogs, siteAssets } from "@wasfa/db";
import { adminSettingsResponseSchema } from "@wasfa/shared/schemas/admin";
import { brandingAssetSchema } from "@wasfa/shared/schemas/branding";
import { brandingSettingsSchema } from "@wasfa/shared/settings";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SettingsService } from "../src/settings/settings.service.js";

import { AdminTestContext, type Admin, type Person } from "./support/admin-context.js";
import {
  MALFORMED_SVGS,
  MALICIOUS_SVGS,
  SVG,
  dataUrl,
  ico,
  png,
  pngOfSize,
  webp,
} from "./support/branding-fixtures.js";
import { expectRateLimited } from "./support/identity-fixtures.js";

import type { LightMyRequestResponse } from "fastify";

const ctx = new AdminTestContext();
let admin: Admin;

beforeAll(async () => {
  await ctx.start();
  admin = await ctx.admin("admin");
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

// One row per key and one branding setting for the whole file: every test starts from none, and
// from no earlier branding audit rows (the owner role may delete them; the api's may not).
beforeEach(async () => {
  await ctx.owner.db.delete(siteAssets);
  await ctx.owner.db
    .delete(auditLogs)
    .where(inArray(auditLogs.action, ["branding.asset_upload", "branding.asset_delete"]));
  await ctx.app.get(SettingsService).set("branding", {}, { actorId: null });
});

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

const put = (key: string, url: string, who: { jar: Admin["jar"] } = admin) =>
  ctx.harness.call("PUT", `/admin/branding/assets/${key}`, {
    jar: who.jar,
    body: { dataUrl: url },
  });

const remove = (key: string, who: { jar: Admin["jar"] } = admin) =>
  ctx.harness.call("DELETE", `/admin/branding/assets/${key}`, { jar: who.jar });

const fetchAsset = (path: string, headers: Record<string, string> = {}) =>
  ctx.harness.call("GET", path, { headers });

async function branding() {
  const list = adminSettingsResponseSchema.parse(
    (await ctx.harness.call("GET", "/admin/settings", { jar: admin.jar })).json(),
  );
  return brandingSettingsSchema.parse(list.items.find((item) => item.key === "branding")?.value);
}

function expectRejected(res: LightMyRequestResponse, reason?: string) {
  expect(res.statusCode, res.body).toBe(400);
  expect(res.json()).toMatchObject({
    code: "VALIDATION_FAILED",
    ...(reason ? { details: { fields: ["dataUrl"], reason } } : {}),
  });
}

// ---------------------------------------------------------------------------------------------
describe("who may change the brand images", () => {
  const routes = [
    { name: "upload", method: "PUT", url: "/admin/branding/assets/logo" },
    { name: "delete", method: "DELETE", url: "/admin/branding/assets/logo" },
  ] as const;
  const body = { dataUrl: dataUrl("image/png", png()) };
  const request = (route: (typeof routes)[number], who?: { jar: Admin["jar"] }) =>
    ctx.harness.call(route.method, route.url, {
      ...(who ? { jar: who.jar } : {}),
      ...(route.method === "PUT" ? { body } : {}),
    });

  let reader: Admin;
  let noSecondFactor: Person;
  let plain: Person;

  beforeAll(async () => {
    reader = await ctx.admin("marketing"); // settings.read, not settings.write
    noSecondFactor = await ctx.adminWithoutTwoFactor("super_admin");
    plain = await ctx.harness.signedInUser();
  }, 120_000);

  for (const route of routes) {
    describe(route.name, () => {
      it("answers 401 without a session", async () => {
        const res = await request(route);
        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({ code: "AUTH_REQUIRED" });
      });

      it("answers 403 to a user without a role and to a reader", async () => {
        for (const who of [plain, reader]) {
          const res = await request(route, who);
          expect(res.statusCode).toBe(403);
          expect(res.json()).toMatchObject({ code: "FORBIDDEN" });
        }
      });

      it("answers 403 two_factor_required to a permitted account without two-factor", async () => {
        const res = await request(route, noSecondFactor);
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ details: { reason: "two_factor_required" } });
      });

      it("asks for a fresh login", async () => {
        const stale = await ctx.admin("admin");
        await ctx.makeSessionStale(stale.userId);
        const res = await request(route, stale);
        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({
          code: "AUTH_REQUIRED",
          details: { reason: "reauth", maxAgeMinutes: 10 },
        });
      });

      it("limits to 10 a minute per IP", async () => {
        await expectRateLimited(ctx.harness, {
          method: route.method,
          url: route.url,
          max: 10,
          ...(route.method === "PUT" ? { body } : {}),
        });
      });
    });
  }

  it("rejects an unknown key before anything else", async () => {
    const res = await put("banner", dataUrl("image/png", png()));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["key"] } });
  });
});

// ---------------------------------------------------------------------------------------------
describe("PUT /admin/branding/assets/:key", () => {
  it("stores a PNG logo, points the setting at its versioned URL and audits without the bytes", async () => {
    const data = png(240, 80);
    const res = await put("logo", dataUrl("image/png", data));
    expect(res.statusCode, res.body).toBe(200);
    const asset = brandingAssetSchema.parse(res.json());
    expect(asset).toMatchObject({
      key: "logo",
      contentType: "image/png",
      size: data.length,
      sha256: sha(data),
      width: 240,
      height: 80,
      url: `https://api.wasfa.online/assets/logo?v=${sha(data).slice(0, 12)}`,
    });

    const [row] = await ctx.owner.db.select().from(siteAssets).where(eq(siteAssets.key, "logo"));
    expect(row?.data.equals(data)).toBe(true);
    expect(row?.updatedBy).toBe(admin.userId);

    expect(await branding()).toMatchObject({
      logoUrl: asset.url,
      logoWidth: 240,
      logoHeight: 80,
      faviconUrl: null,
    });
    const publicSettings = await ctx.harness.call("GET", "/settings/public");
    expect(publicSettings.json()).toMatchObject({
      branding: { logoUrl: asset.url, logoWidth: 240, logoHeight: 80 },
    });

    const upload = await ctx.auditRowsFor("branding.asset_upload", "logo");
    expect(upload).toHaveLength(1);
    expect(upload[0]).toMatchObject({
      actorId: admin.userId,
      targetType: "branding_asset",
      before: null,
      after: { contentType: "image/png", size: data.length },
    });
    expect(JSON.stringify(upload[0])).not.toContain(data.toString("base64"));
    expect((await ctx.auditRowsFor("setting.update", "branding")).length).toBeGreaterThan(0);
  });

  it("stores WebP and SVG logos and an ICO favicon, each with its own URL field", async () => {
    expect((await put("logo", dataUrl("image/webp", webp(300, 100)))).statusCode).toBe(200);
    expect(await branding()).toMatchObject({ logoWidth: 300, logoHeight: 100 });

    const svg = await put("logo", dataUrl("image/svg+xml", SVG));
    expect(brandingAssetSchema.parse(svg.json())).toMatchObject({
      contentType: "image/svg+xml",
      width: 200,
      height: 60,
    });

    const favicon = await put("favicon", dataUrl("image/x-icon", ico()));
    expect(favicon.statusCode, favicon.body).toBe(200);
    expect(await branding()).toMatchObject({
      logoWidth: 200,
      logoHeight: 60,
      faviconUrl: brandingAssetSchema.parse(favicon.json()).url,
      logoDarkUrl: null,
    });
  });

  it("replaces the image in place: one row, a new version in the URL", async () => {
    const first = brandingAssetSchema.parse(
      (await put("logo", dataUrl("image/png", png(100, 40)))).json(),
    );
    const second = brandingAssetSchema.parse(
      (await put("logo", dataUrl("image/png", png(110, 44)))).json(),
    );
    expect(second.url).not.toBe(first.url);
    expect(await ctx.owner.db.select().from(siteAssets)).toHaveLength(1);
    expect((await branding()).logoUrl).toBe(second.url);

    const audit = await ctx.auditRowsFor("branding.asset_upload", "logo");
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ before: { contentType: "image/png" } });
  });

  it("leaves names and the other fields of the branding setting alone", async () => {
    await ctx.app
      .get(SettingsService)
      .set(
        "branding",
        { nameAr: "وصفة", nameEn: "Wasfa", showNameWithLogo: true },
        { actorId: null },
      );
    expect((await put("favicon", dataUrl("image/x-icon", ico()))).statusCode).toBe(200);
    expect(await branding()).toMatchObject({
      nameAr: "وصفة",
      nameEn: "Wasfa",
      showNameWithLogo: true,
    });
  });

  it("refuses an ICO as a logo", async () => {
    expectRejected(await put("logo", dataUrl("image/x-icon", ico())), "unsupported_type");
  });

  it("refuses bytes that do not match the declared type", async () => {
    expectRejected(await put("logo", dataUrl("image/webp", png())), "type_mismatch");
    expectRejected(await put("logo", dataUrl("image/png", SVG)), "type_mismatch");
    expectRejected(await put("logo", dataUrl("image/svg+xml", png())), "type_mismatch");
    expectRejected(await put("favicon", dataUrl("image/x-icon", webp())), "type_mismatch");
  });

  it("refuses a file over 512 KB and takes one of exactly 512 KB", async () => {
    expectRejected(await put("logo", dataUrl("image/png", pngOfSize(524_289))), "too_large");
    expect((await put("logo", dataUrl("image/png", pngOfSize(524_288)))).statusCode).toBe(200);
  });

  it("refuses a body that is not a base64 data URL, or is far too big", async () => {
    for (const value of [
      "",
      "not a data url",
      "data:image/png;base64,",
      "data:image/png,rawbytes",
      `data:image/png;base64,${"A".repeat(800_000)}`,
    ]) {
      const res = await put("logo", value);
      expect(res.statusCode, value.slice(0, 40)).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("refuses an unsupported type", async () => {
    expectRejected(await put("logo", dataUrl("image/gif", png())), "unsupported_type");
    expectRejected(await put("logo", dataUrl("text/html", "<svg/>")), "unsupported_type");
  });

  it.each(Object.entries(MALICIOUS_SVGS))("refuses an SVG with %s", async (_name, svg) => {
    const res = await put("logo", dataUrl("image/svg+xml", svg));
    expectRejected(res);
    expect(["unsafe_svg", "invalid_svg"]).toContain(
      res.json<{ details: { reason: string } }>().details.reason,
    );
  });

  it.each(Object.entries(MALFORMED_SVGS))("refuses an SVG that is %s", async (_name, svg) => {
    expectRejected(await put("logo", dataUrl("image/svg+xml", svg)), "invalid_svg");
  });

  it("stores nothing and changes no setting when an upload is refused", async () => {
    expect((await put("logo", dataUrl("image/png", png()))).statusCode).toBe(200);
    const before = await branding();
    const audits = (await ctx.auditRowsFor("branding.asset_upload", "logo")).length;

    expectRejected(
      await put("logo", dataUrl("image/svg+xml", MALICIOUS_SVGS["script element"] ?? "")),
    );
    const [row] = await ctx.owner.db.select().from(siteAssets).where(eq(siteAssets.key, "logo"));
    expect(row?.contentType).toBe("image/png");
    expect(await branding()).toEqual(before);
    expect(await ctx.auditRowsFor("branding.asset_upload", "logo")).toHaveLength(audits);
  });
});

// ---------------------------------------------------------------------------------------------
describe("GET /assets/:key", () => {
  it("serves the bytes to anyone, with the stored type and long-lived cache headers for the versioned URL", async () => {
    const data = png();
    const uploaded = brandingAssetSchema.parse(
      (await put("logo", dataUrl("image/png", data))).json(),
    );
    const res = await fetchAsset(new URL(uploaded.url).pathname + new URL(uploaded.url).search);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(data)).toBe(true);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["etag"]).toBe(`"${sha(data)}"`);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    // not an SVG: no per-response policy beyond the API default
    expect(res.headers["content-disposition"]).toBeUndefined();
  });

  it("revalidates after five minutes when the version is missing or wrong", async () => {
    await put("logo", dataUrl("image/png", png()));
    for (const path of ["/assets/logo", "/assets/logo?v=000000000000", "/assets/logo?v="]) {
      const res = await fetchAsset(path);
      expect(res.statusCode, path).toBe(200);
      expect(res.headers["cache-control"], path).toBe("public, max-age=300");
    }
  });

  it("answers 304 to a matching If-None-Match (also weak, in a list, or *) and the bytes to a stale one", async () => {
    const data = png();
    await put("logo", dataUrl("image/png", data));
    const etag = `"${sha(data)}"`;
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const res = await fetchAsset("/assets/logo", { "if-none-match": header });
      expect(res.statusCode, header).toBe(304);
      expect(res.body).toBe("");
      expect(res.headers["etag"]).toBe(etag);
    }
    expect((await fetchAsset("/assets/logo", { "if-none-match": '"stale"' })).statusCode).toBe(200);
  });

  it("serves an SVG as an inert image: nosniff, no scripts, no sub-resources, sandboxed", async () => {
    await put("logo", dataUrl("image/svg+xml", SVG));
    const res = await fetchAsset("/assets/logo");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(res.headers["content-disposition"]).toBe("inline");
    expect(res.body).toBe(SVG);
  });

  it("serves the favicon with its own type", async () => {
    await put("favicon", dataUrl("image/x-icon", ico()));
    const res = await fetchAsset("/assets/favicon");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/x-icon");
  });

  it("answers 404 for an image that was never uploaded and 400 for a key that cannot exist", async () => {
    const missing = await fetchAsset("/assets/favicon");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "NOT_FOUND" });
    expect((await fetchAsset("/assets/banner")).statusCode).toBe(400);
    expect((await fetchAsset("/assets/..%2Fsecret")).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("stays reachable during maintenance, so the maintenance page can show the logo", async () => {
    await put("logo", dataUrl("image/png", png()));
    const settings = ctx.app.get(SettingsService);
    const access = await settings.get("access");
    await settings.set("access", { ...access, maintenanceMode: true }, { actorId: null });
    try {
      expect((await fetchAsset("/assets/logo")).statusCode).toBe(200);
    } finally {
      await settings.set("access", { ...access, maintenanceMode: false }, { actorId: null });
    }
  });

  it("limits to 240 a minute per IP", async () => {
    await expectRateLimited(ctx.harness, { method: "GET", url: "/assets/favicon", max: 240 });
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
describe("DELETE /admin/branding/assets/:key", () => {
  it("removes the image, clears its URL (and the logo's size) and audits", async () => {
    await put("logo", dataUrl("image/png", png()));
    await put("favicon", dataUrl("image/x-icon", ico()));

    const res = await remove("logo");
    expect(res.statusCode, res.body).toBe(204);
    expect((await fetchAsset("/assets/logo")).statusCode).toBe(404);
    const after = await branding();
    expect(after).toMatchObject({ logoUrl: null, logoWidth: null, logoHeight: null });
    // the favicon is untouched
    expect(after.faviconUrl).not.toBeNull();
    expect((await fetchAsset("/assets/favicon")).statusCode).toBe(200);

    const audit = await ctx.auditRowsFor("branding.asset_delete", "logo");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: admin.userId,
      targetType: "branding_asset",
      before: { contentType: "image/png" },
    });
  });

  it("answers 404 when there is nothing to remove, and changes nothing", async () => {
    const res = await remove("logo");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(await ctx.auditRowsFor("branding.asset_delete", "logo")).toEqual([]);
  });
});
