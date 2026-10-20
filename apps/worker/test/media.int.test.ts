import { createHash, randomUUID } from "node:crypto";

import { CreateBucketCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createDb, mediaAssets, seedDefaults, type MediaAssetRecord } from "@wasfa/db";
import { mediaStorageConfig } from "@wasfa/shared/storage";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MEDIA_CACHE_CONTROL, mediaProcessJob } from "../src/media/media.job.js";
import { ObjectStore } from "../src/storage/object-store.js";

import { pngBomb, twoToneJpeg } from "./support/image-fixtures.js";
import { startPostgres, type TestPostgres } from "./support/postgres.js";
import { startStorage, type TestStorage } from "./support/storage.js";

/*
 * `media.process` end to end: real Postgres (as the restricted role the worker uses) and MinIO
 * with a media bucket that is not the uploads bucket.
 */

const logger = pino({ level: "silent" });

let postgres: TestPostgres;
let storage: TestStorage;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let media: ObjectStore;
let mediaBucket: string;

beforeAll(async () => {
  [postgres, storage] = await Promise.all([startPostgres(), startStorage()]);
  mediaBucket = `${storage.bucket}-media`;
  await storage.s3.send(new CreateBucketCommand({ Bucket: mediaBucket }));
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 4 });
  await seedDefaults(owner.db);
  const config = mediaStorageConfig({
    ...storage.env,
    R2_UPLOADS_REGION: "auto",
    R2_MEDIA_BUCKET: mediaBucket,
  });
  if (config === undefined) throw new Error("test storage is not configured");
  media = new ObjectStore(config);
}, 240_000);

afterAll(async () => {
  media?.close();
  await Promise.all([owner?.close(), worker?.close()]);
  await Promise.all([postgres?.stop(), storage?.stop()]);
});

const run = (assetId: string) => mediaProcessJob({ assetId }, { db: worker.db, logger, media });

async function row(id: string): Promise<MediaAssetRecord> {
  const [found] = await owner.db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
  if (!found) throw new Error("no such media row");
  return found;
}

async function head(key: string) {
  try {
    return await storage.s3.send(new HeadObjectCommand({ Bucket: mediaBucket, Key: key }));
  } catch {
    return null;
  }
}

/** A `processing` asset whose staging object holds `bytes`, as `POST /admin/media/:id/commit` leaves it. */
async function committed(bytes: Buffer, mime = "image/jpeg") {
  const id = randomUUID();
  const key = `staging/${randomUUID()}`;
  await media.put(key, bytes, mime);
  await owner.db.insert(mediaAssets).values({
    id,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    status: "processing",
    originalKey: key,
    mime: mime as "image/jpeg",
    bytes: bytes.byteLength,
  });
  return { id, key };
}

describe("media.process", () => {
  it("publishes immutable variants under media/<sha256>/, strips EXIF and deletes the staging object", async () => {
    const photo = await twoToneJpeg(1400, 700, {
      exif: { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "30/1 2/1 40/1" } },
    });
    const { id, key } = await committed(photo);
    await run(id);

    const done = await row(id);
    expect(done).toMatchObject({ status: "ready", width: 1400, height: 700, originalKey: null });
    expect(done.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(done.variants).toHaveLength(4 * 3);
    for (const variant of done.variants) {
      expect(variant.key).toMatch(new RegExp(`^media/${done.sha256}/${String(variant.width)}\\.`));
      const stored = await head(variant.key);
      expect(stored?.CacheControl).toBe(MEDIA_CACHE_CONTROL);
      expect(stored?.ContentLength).toBe(variant.bytes);
    }
    const jpeg = done.variants.find(
      (variant) => variant.format === "jpeg" && variant.width === 640,
    );
    const object = await storage.s3.send(
      new GetObjectCommand({ Bucket: mediaBucket, Key: jpeg?.key ?? "" }),
    );
    const bytes = Buffer.from(await (object.Body?.transformToByteArray() ?? Promise.resolve([])));
    expect((await sharp(bytes).metadata()).exif).toBeUndefined();

    expect(await head(key)).toBeNull();
    // Nothing of this went into the private uploads bucket.
    await expect(
      storage.s3.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: jpeg?.key ?? "" })),
    ).rejects.toThrow();
  });

  it("rejects SVG with a reason and still deletes the staging object", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    const { id, key } = await committed(svg, "image/png");
    await run(id);
    expect(await row(id)).toMatchObject({
      status: "rejected",
      rejectReason: "unsupported_type",
      variants: [],
    });
    expect(await head(key)).toBeNull();
  });

  it("rejects a megapixel bomb", async () => {
    const { id, key } = await committed(pngBomb(), "image/png");
    await run(id);
    expect(await row(id)).toMatchObject({ status: "rejected", rejectReason: "too_many_pixels" });
    expect(await head(key)).toBeNull();
  });

  it("rejects a missing staging object and a digest that does not match", async () => {
    const missing = await committed(await twoToneJpeg(402, 200));
    await media.remove(missing.key);
    await run(missing.id);
    expect((await row(missing.id)).rejectReason).toBe("upload_missing");

    const other = await committed(await twoToneJpeg(404, 200));
    await owner.db
      .update(mediaAssets)
      .set({ sha256: "f".repeat(64) })
      .where(eq(mediaAssets.id, other.id));
    await run(other.id);
    expect((await row(other.id)).rejectReason).toBe("hash_mismatch");
  });

  it("skips an asset that is not processing, so a duplicate job changes nothing", async () => {
    const { id } = await committed(await twoToneJpeg(406, 200));
    await run(id);
    const first = await row(id);
    expect(first.status).toBe("ready");
    await run(id);
    expect((await row(id)).updatedAt).toEqual(first.updatedAt);
  });
});
