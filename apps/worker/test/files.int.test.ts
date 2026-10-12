import { randomUUID } from "node:crypto";

import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createDb, files, seedDefaults, users, type FileRecord } from "@wasfa/db";
import { processedObjectKey, uploadsStorageConfig } from "@wasfa/shared/storage";
import { eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { pino } from "pino";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { filesRetentionJob } from "../src/jobs/files.retention.job.js";
import { imageProcessJob } from "../src/jobs/image.job.js";
import { ObjectStore } from "../src/storage/object-store.js";

import { pdfWithPages, pngBomb, solidPng, twoToneJpeg } from "./support/image-fixtures.js";
import { startPostgres, type TestPostgres } from "./support/postgres.js";
import { startStorage, type TestStorage } from "./support/storage.js";

/*
 * `image.process` and `files.retention` end to end: real Postgres (as the restricted `wasfa_api`
 * role the worker uses in production) and a real S3 API (MinIO).
 */

const lines: string[] = [];
const logger = pino(
  { level: "info" },
  {
    write: (line: string) => {
      lines.push(line);
    },
  },
);

let postgres: TestPostgres;
let storage: TestStorage;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let store: ObjectStore;
let userId: string;

beforeAll(async () => {
  [postgres, storage] = await Promise.all([startPostgres(), startStorage()]);
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 4 });
  await seedDefaults(owner.db);
  const config = uploadsStorageConfig({ ...storage.env, R2_UPLOADS_REGION: "auto" });
  if (config === undefined) throw new Error("test storage is not configured");
  store = new ObjectStore(config);
  const [row] = await owner.db
    .insert(users)
    .values({ name: "Image Person", email: "images@example.com", emailVerified: true })
    .returning({ id: users.id });
  if (row === undefined) throw new Error("seed failed");
  userId = row.id;
}, 240_000);

afterAll(async () => {
  store?.close();
  await Promise.all([owner?.close(), worker?.close()]);
  await Promise.all([postgres?.stop(), storage?.stop()]);
});

const context = () => ({ db: worker.db, logger, storage: store });
const run = (fileId: string) => imageProcessJob({ fileId }, context());

async function row(fileId: string): Promise<FileRecord> {
  const [found] = await owner.db.select().from(files).where(eq(files.id, fileId));
  if (!found) throw new Error("no such file row");
  return found;
}

async function exists(key: string): Promise<boolean> {
  try {
    await storage.s3.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** An `uploaded` file whose original object holds `bytes`, as `POST /uploads/:id/complete` leaves it. */
async function uploaded(
  bytes: Buffer,
  options: { mime?: "image/jpeg" | "image/png" | "image/webp"; pdf?: boolean } = {},
) {
  const fileId = randomUUID();
  const key = `u/${userId}/${fileId}/original${options.pdf ? ".pdf" : ""}`;
  await store.put(key, bytes, options.pdf ? "application/pdf" : (options.mime ?? "image/jpeg"));
  await owner.db.insert(files).values({
    id: fileId,
    ownerUserId: userId,
    createdBy: userId,
    purpose: "rx_page",
    r2Key: key,
    mime: options.mime ?? "image/jpeg",
    bytes: bytes.byteLength,
    status: "uploaded",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { fileId, key };
}

describe("image.process", () => {
  it("re-encodes a phone photo: upright, no metadata, stored under the processed key, original deleted", async () => {
    const photo = await twoToneJpeg(4000, 2000, {
      orientation: 6,
      exif: { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "30/1 2/1 40/1" } },
    });
    const { fileId, key } = await uploaded(photo);

    await run(fileId);

    const done = await row(fileId);
    const processedKey = processedObjectKey(userId, fileId);
    expect(done).toMatchObject({
      status: "processed",
      r2Key: processedKey,
      mime: "image/jpeg",
      rejectReason: null,
      // 4000x2000 rotated to portrait, long edge 2048.
      width: 1024,
      height: 2048,
    });
    expect(done.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(done.dhash).toMatch(/^[a-f0-9]{16}$/);

    const processed = await store.get(processedKey, 20_000_000);
    expect(processed).not.toBeNull();
    expect(processed?.byteLength).toBe(done.bytes);
    const meta = await sharp(processed ?? Buffer.alloc(0)).metadata();
    expect({ width: meta.width, height: meta.height, exif: meta.exif }).toEqual({
      width: 1024,
      height: 2048,
      exif: undefined,
    });
    expect(await exists(key)).toBe(false);
  });

  it("strips a polyglot's payload", async () => {
    const jpeg = await twoToneJpeg(500, 400);
    const trailer = Buffer.from("PK\u0003\u0004<script>evil()</script>", "latin1");
    const { fileId } = await uploaded(Buffer.concat([jpeg, trailer]));
    await run(fileId);
    const done = await row(fileId);
    expect(done.status).toBe("processed");
    const processed = (await store.get(done.r2Key, 20_000_000)) ?? Buffer.alloc(0);
    expect((await fileTypeFromBuffer(processed))?.mime).toBe("image/jpeg");
    expect(processed.includes("evil")).toBe(false);
  });

  it.each([
    ["a PNG declared as JPEG", () => solidPng(30, 30), "image/jpeg", "type_mismatch"],
    [
      "a web page",
      () => Promise.resolve(Buffer.from("<html>hi</html>")),
      "image/jpeg",
      "unsupported_type",
    ],
    [
      "a 20,000 x 20,000 PNG bomb",
      () => Promise.resolve(pngBomb()),
      "image/png",
      "too_many_pixels",
    ],
    [
      "a truncated JPEG",
      async () => (await twoToneJpeg(300, 300)).subarray(0, 200),
      "image/jpeg",
      "corrupt_image",
    ],
  ] as const)("rejects %s and deletes its bytes", async (_name, make, mime, reason) => {
    const { fileId, key } = await uploaded(await make(), { mime });
    await run(fileId);
    expect(await row(fileId)).toMatchObject({ status: "rejected", rejectReason: reason });
    expect(await exists(key)).toBe(false);
    expect(await exists(processedObjectKey(userId, fileId))).toBe(false);
  });

  it("processes a one-page PDF and rejects a two-page one", async () => {
    const single = await uploaded(pdfWithPages(1), { pdf: true });
    await run(single.fileId);
    expect(await row(single.fileId)).toMatchObject({
      status: "processed",
      mime: "image/jpeg",
      height: 2048,
    });
    expect(await exists(single.key)).toBe(false);

    const double = await uploaded(pdfWithPages(2), { pdf: true });
    await run(double.fileId);
    expect(await row(double.fileId)).toMatchObject({
      status: "rejected",
      rejectReason: "pdf_multi_page_unsupported",
    });
    expect(await exists(double.key)).toBe(false);
  });

  it("rejects an upload whose object is missing", async () => {
    const { fileId, key } = await uploaded(await twoToneJpeg(100, 100));
    await store.remove(key);
    await run(fileId);
    expect(await row(fileId)).toMatchObject({ status: "rejected", rejectReason: "upload_missing" });
  });

  it("is idempotent: a processed or pending file is left alone", async () => {
    const { fileId } = await uploaded(await twoToneJpeg(300, 200));
    await run(fileId);
    const first = await row(fileId);
    await run(fileId);
    expect(await row(fileId)).toEqual(first);

    await owner.db.update(files).set({ status: "pending" }).where(eq(files.id, first.id));
    await run(fileId);
    expect((await row(fileId)).status).toBe("pending");
  });

  it("repairs a crash between writing the processed image and updating the row", async () => {
    const { fileId, key } = await uploaded(await twoToneJpeg(300, 200));
    // The previous attempt got as far as storing a (stale) processed object.
    await store.put(processedObjectKey(userId, fileId), Buffer.from("stale"), "image/jpeg");
    await run(fileId);
    const done = await row(fileId);
    expect(done.status).toBe("processed");
    const processed = (await store.get(done.r2Key, 20_000_000)) ?? Buffer.alloc(0);
    expect(processed.byteLength).toBeGreaterThan(100);
    expect(await exists(key)).toBe(false);
  });

  it("lets infrastructure errors through for a retry, leaving the file uploaded", async () => {
    const { fileId } = await uploaded(await twoToneJpeg(300, 200));
    const broken = {
      get: () => Promise.reject(new Error("storage is down")),
    } as unknown as ObjectStore;
    await expect(imageProcessJob({ fileId }, { ...context(), storage: broken })).rejects.toThrow(
      "storage is down",
    );
    expect((await row(fileId)).status).toBe("uploaded");
  });

  it("fails loudly without storage configuration", async () => {
    await expect(
      imageProcessJob({ fileId: randomUUID() }, { db: worker.db, logger, storage: undefined }),
    ).rejects.toThrow(/not configured/);
  });
});

describe("files.retention", () => {
  async function aged(status: FileRecord["status"], expiresAt: Date | null) {
    const { fileId, key } = await uploaded(Buffer.from("object"));
    await owner.db.update(files).set({ status, expiresAt }).where(eq(files.id, fileId));
    return { fileId, key };
  }

  it("deletes the objects of expired files and marks them deleted, keeping the rows", async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 86_400_000);
    const expiredProcessed = await aged("processed", past);
    const expiredPending = await aged("pending", past);
    const expiredRejected = await aged("rejected", past);
    const stillValid = await aged("processed", future);
    const neverExpires = await aged("processed", null);
    // An earlier failed delete of the original left a sibling object behind.
    const leftover = `u/${userId}/${expiredProcessed.fileId}/original`;
    await store.put(leftover, Buffer.from("leftover"), "image/jpeg");
    const alreadyDeleted = await aged("deleted", past);

    await filesRetentionJob({}, context());

    for (const gone of [expiredProcessed, expiredPending, expiredRejected]) {
      expect((await row(gone.fileId)).status).toBe("deleted");
      expect(await exists(gone.key)).toBe(false);
    }
    expect(await exists(leftover)).toBe(false);
    for (const kept of [stillValid, neverExpires]) {
      expect((await row(kept.fileId)).status).toBe("processed");
      expect(await exists(kept.key)).toBe(true);
    }
    // Rows survive (the analysis still says the image was deleted) and the metadata is kept.
    expect((await row(expiredProcessed.fileId)).bytes).toBeGreaterThan(0);
    expect((await row(alreadyDeleted.fileId)).status).toBe("deleted");
  });

  it("does nothing, and says so, without storage configuration", async () => {
    await filesRetentionJob({}, { db: worker.db, logger, storage: undefined });
    expect(lines.join("")).toContain("Retention skipped");
  });

  it("leaves nothing under the prefix of a deleted file", async () => {
    const { fileId } = await aged("processed", new Date(Date.now() - 1000));
    await filesRetentionJob({}, context());
    const listed = await storage.s3.send(
      new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: `u/${userId}/${fileId}/` }),
    );
    expect(listed.KeyCount ?? 0).toBe(0);
  });
});
