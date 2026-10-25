import { createHash } from "node:crypto";

import { CreateBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { auditLogs, mediaAssets } from "@wasfa/db";
import { mediaAssetSchema, mediaUploadResponseSchema } from "@wasfa/shared/schemas/media";
import { Queue } from "bullmq";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminTestContext, MISSING_ID, type Admin } from "./support/admin-context.js";
import { startStorage, type TestStorage } from "./support/storage.js";

/*
 * The media library admin API against Postgres, Redis and a real MinIO: presigned staging upload,
 * commit, dedupe, alt text and focal point, permissions and audit. The media bucket is a second
 * bucket on the same MinIO, never the uploads bucket.
 */

const ctx = new AdminTestContext();
let storage: TestStorage;
let mediaBucket: string;
let images: Queue;
let admin: Admin;

beforeAll(async () => {
  storage = await startStorage();
  mediaBucket = `${storage.bucket}-media`;
  await storage.s3.send(new CreateBucketCommand({ Bucket: mediaBucket }));
  await ctx.start([], { ...storage.env, R2_MEDIA_BUCKET: mediaBucket });
  images = new Queue("images", { connection: ctx.redis });
  admin = await ctx.admin("admin");
}, 240_000);

afterAll(async () => {
  await images?.close();
  await ctx.stop();
  await storage?.stop();
});

beforeEach(async () => {
  await images.obliterate({ force: true });
  await ctx.owner.db.delete(mediaAssets);
  await ctx.owner.db
    .delete(auditLogs)
    .where(inArray(auditLogs.action, ["media.create", "media.commit", "media.update"]));
});

const bytesOf = (seed: string) => Buffer.from(`not really an image: ${seed}`.repeat(20));
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

const declare = (data: Buffer, overrides: Record<string, unknown> = {}) => ({
  mime: "image/jpeg",
  bytes: data.byteLength,
  sha256: sha256(data),
  ...overrides,
});

const create = (body: Record<string, unknown>, who: { jar: Admin["jar"] } = admin) =>
  ctx.harness.call("POST", "/admin/media/uploads", { jar: who.jar, body });

async function stage(data: Buffer) {
  const res = await create(declare(data));
  expect(res.statusCode, res.body).toBe(200);
  const parsed = mediaUploadResponseSchema.parse(res.json());
  if (parsed.upload === undefined) throw new Error("expected an upload URL");
  return { asset: parsed.asset, upload: parsed.upload };
}

const put = (upload: { url: string; headers: Record<string, string> }, data: Buffer) =>
  fetch(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(data) });

describe("who may use the media library", () => {
  it("asks for sign-in, a second factor and the content permissions", async () => {
    const data = bytesOf("perm");
    expect(
      (await ctx.harness.call("POST", "/admin/media/uploads", { body: declare(data) })).statusCode,
    ).toBe(401);
    expect((await ctx.harness.call("GET", "/admin/media")).statusCode).toBe(401);

    const reader = await ctx.admin(await ctx.roleLacking("content.write"));
    expect((await create(declare(data), reader)).statusCode).toBe(403);
    expect((await ctx.harness.call("GET", "/admin/media", { jar: reader.jar })).statusCode).toBe(
      200,
    );

    const blind = await ctx.admin(await ctx.roleLacking("content.read"));
    expect((await ctx.harness.call("GET", "/admin/media", { jar: blind.jar })).statusCode).toBe(
      403,
    );

    const noSecondFactor = await ctx.adminWithoutTwoFactor("admin");
    expect((await create(declare(data), noSecondFactor)).statusCode).toBe(403);
  });
});

describe("POST /admin/media/uploads", () => {
  it("presigns a PUT into staging/ of the media bucket and the PUT works", async () => {
    const data = bytesOf("a");
    const { asset, upload } = await stage(data);
    expect(asset.status).toBe("staged");
    expect(upload.expiresInSeconds).toBe(600);
    const url = new URL(upload.url);
    expect(url.pathname).toMatch(new RegExp(`^/${mediaBucket}/staging/[0-9a-f-]{36}$`));
    expect(url.pathname).not.toContain(storage.bucket + "/");
    expect((await put(upload, data)).status).toBe(200);
  });

  it("binds the body: another size or another content is refused by the storage", async () => {
    const data = bytesOf("bound");
    const { upload } = await stage(data);
    expect(
      (await put(upload, Buffer.concat([data, Buffer.from("x")]))).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await put(upload, bytesOf("bounD"))).status).toBeGreaterThanOrEqual(400);
  });

  it.each([
    ["svg", { mime: "image/svg+xml" }],
    ["heic", { mime: "image/heic" }],
    ["gif", { mime: "image/gif" }],
    ["too big", { bytes: 15 * 1024 * 1024 + 1 }],
    ["empty", { bytes: 0 }],
    ["bad digest", { sha256: "xyz" }],
  ])("refuses %s", async (_name, overrides) => {
    const res = await create(declare(bytesOf("bad"), overrides));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("returns the existing asset, without an upload, when it is already ready", async () => {
    const data = bytesOf("dupe");
    const { asset } = await stage(data);
    await ctx.owner.db
      .update(mediaAssets)
      .set({ status: "ready", originalKey: null })
      .where(eq(mediaAssets.id, asset.id));
    const again = mediaUploadResponseSchema.parse((await create(declare(data))).json());
    expect(again.asset.id).toBe(asset.id);
    expect(again.upload).toBeUndefined();
  });

  it("lets a staged or rejected asset be uploaded again", async () => {
    const data = bytesOf("retry");
    const first = await stage(data);
    const second = await stage(data);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.upload.url).not.toBe(first.upload.url);
    await ctx.owner.db
      .update(mediaAssets)
      .set({ status: "rejected", rejectReason: "type_mismatch" })
      .where(eq(mediaAssets.id, first.asset.id));
    const third = await stage(data);
    expect(third.asset.status).toBe("staged");
    expect(third.asset.rejectReason).toBeNull();
  });

  it("audits the creation", async () => {
    const { asset } = await stage(bytesOf("audit"));
    const rows = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "media.create"));
    expect(rows.map((row) => row.targetId)).toEqual([asset.id]);
    expect(rows[0]?.actorId).toBe(admin.userId);
  });
});

describe("POST /admin/media/:id/commit", () => {
  const commit = (id: string) =>
    ctx.harness.call("POST", `/admin/media/${id}/commit`, { jar: admin.jar });

  it("refuses to commit before the object is there", async () => {
    const { asset } = await stage(bytesOf("early"));
    const res = await commit(asset.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: { reason: "upload_missing" } });
  });

  it("moves to processing and queues exactly one media.process job", async () => {
    const data = bytesOf("commit");
    const { asset, upload } = await stage(data);
    expect((await put(upload, data)).status).toBe(200);

    const res = await commit(asset.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(mediaAssetSchema.parse(res.json()).status).toBe("processing");
    // A second commit is a no-op.
    expect(mediaAssetSchema.parse((await commit(asset.id)).json()).status).toBe("processing");

    const jobs = await images.getJobs(["waiting", "active", "delayed"]);
    const mine = jobs.filter((job) => job.name === "media.process");
    expect(mine).toHaveLength(1);
    expect(mine[0]?.data).toEqual({ assetId: asset.id });
    const audits = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "media.commit"));
    expect(audits).toHaveLength(1);
  });

  it("answers 404 for an unknown asset", async () => {
    expect((await commit(MISSING_ID)).statusCode).toBe(404);
  });

  it("refuses an object whose size differs from the declared one", async () => {
    const data = bytesOf("size");
    const { asset } = await stage(data);
    const [row] = await ctx.owner.db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id));
    await storage.s3.send(
      new PutObjectCommand({
        Bucket: mediaBucket,
        Key: row?.originalKey ?? "",
        Body: Buffer.from("short"),
      }),
    );
    expect((await commit(asset.id)).statusCode).toBe(409);
  });
});

describe("list, read and patch", () => {
  it("lists newest first with paging and a status filter", async () => {
    for (const seed of ["l1", "l2", "l3"]) await stage(bytesOf(seed));
    const [one] = await ctx.owner.db.select().from(mediaAssets).limit(1);
    await ctx.owner.db
      .update(mediaAssets)
      .set({ status: "ready" })
      .where(eq(mediaAssets.id, one?.id ?? ""));

    const page = (
      await ctx.harness.call("GET", "/admin/media?pageSize=2&page=1", { jar: admin.jar })
    ).json();
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(page.items).toHaveLength(2);
    const ready = (
      await ctx.harness.call("GET", "/admin/media?status=ready", { jar: admin.jar })
    ).json();
    expect(ready.total).toBe(1);
    const bad = await ctx.harness.call("GET", "/admin/media?pageSize=1000", { jar: admin.jar });
    expect(bad.statusCode).toBe(400);
  });

  it("reads one asset, 404 when unknown", async () => {
    const { asset } = await stage(bytesOf("read"));
    const res = await ctx.harness.call("GET", `/admin/media/${asset.id}`, { jar: admin.jar });
    expect(mediaAssetSchema.parse(res.json()).id).toBe(asset.id);
    expect(
      (await ctx.harness.call("GET", `/admin/media/${MISSING_ID}`, { jar: admin.jar })).statusCode,
    ).toBe(404);
  });

  it("patches alt text and focal point, audited; rejects out-of-range focal values", async () => {
    const { asset } = await stage(bytesOf("patch"));
    const patch = (body: Record<string, unknown>) =>
      ctx.harness.call("PATCH", `/admin/media/${asset.id}`, { jar: admin.jar, body });

    const res = await patch({
      altAr: "طبق شوربة",
      altEn: "A bowl of soup",
      focalX: 20,
      focalY: 80,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(mediaAssetSchema.parse(res.json())).toMatchObject({
      altAr: "طبق شوربة",
      altEn: "A bowl of soup",
      focalX: 20,
      focalY: 80,
    });
    expect((await patch({ focalX: 101 })).statusCode).toBe(400);
    expect((await patch({})).statusCode).toBe(400);
    expect((await patch({ sha256: "a".repeat(64) })).statusCode).toBe(400);
    const audits = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "media.update"));
    expect(audits).toHaveLength(1);
  });
});
