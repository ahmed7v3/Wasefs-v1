import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  MEDIA_KEY_PREFIX,
  MEDIA_VARIANT_WIDTHS,
  MEDIA_FORMATS,
  createMediaUploadSchema,
  mediaStagingKey,
  mediaVariantKey,
} from "../src/schemas/media.js";
import {
  mediaEnvShape,
  mediaStorageConfig,
  refineMediaEnv,
  refineUploadsEnv,
  uploadsEnvShape,
  uploadsStorageConfig,
} from "../src/storage.js";

const uploads = {
  R2_UPLOADS_ENDPOINT: "http://127.0.0.1:9000",
  R2_UPLOADS_BUCKET: "wasfa-uploads",
  R2_UPLOADS_ACCESS_KEY_ID: "key",
  R2_UPLOADS_SECRET_ACCESS_KEY: "secret",
  R2_UPLOADS_REGION: "auto",
};

const schema = z.object({ ...uploadsEnvShape, ...mediaEnvShape }).superRefine((env, ctx) => {
  refineUploadsEnv(env, ctx);
  refineMediaEnv(env, ctx);
});

describe("public media bucket", () => {
  it("is never the private uploads bucket", () => {
    const env = { ...uploads, R2_MEDIA_BUCKET: "wasfa-media" };
    const media = mediaStorageConfig(env);
    expect(media?.bucket).toBe("wasfa-media");
    expect(media?.bucket).not.toBe(uploadsStorageConfig(env)?.bucket);

    // Same name: the env is invalid and no client config is produced.
    const same = { ...uploads, R2_MEDIA_BUCKET: "wasfa-uploads" };
    expect(mediaStorageConfig(same)).toBeUndefined();
    expect(schema.safeParse(same).success).toBe(false);
    expect(schema.safeParse(env).success).toBe(true);
  });

  it("reuses the uploads endpoint and credentials unless the media ones are both set", () => {
    const base = { ...uploads, R2_MEDIA_BUCKET: "wasfa-media" };
    expect(mediaStorageConfig(base)).toMatchObject({
      accessKeyId: "key",
      secretAccessKey: "secret",
    });
    const own = { ...base, R2_MEDIA_ACCESS_KEY_ID: "m", R2_MEDIA_SECRET_ACCESS_KEY: "ms" };
    expect(mediaStorageConfig(own)).toMatchObject({ accessKeyId: "m", secretAccessKey: "ms" });
    expect(schema.safeParse({ ...base, R2_MEDIA_ACCESS_KEY_ID: "m" }).success).toBe(false);
  });

  it("is unconfigured without a bucket or without the uploads account", () => {
    expect(mediaStorageConfig(uploads)).toBeUndefined();
    expect(
      mediaStorageConfig({ R2_UPLOADS_REGION: "auto", R2_MEDIA_BUCKET: "wasfa-media" }),
    ).toBeUndefined();
  });

  it("keys every published variant under media/<sha256>/, and staging outside it", () => {
    const sha = "a".repeat(64);
    for (const width of MEDIA_VARIANT_WIDTHS) {
      for (const format of MEDIA_FORMATS) {
        const key = mediaVariantKey(sha, width, format);
        expect(key.startsWith(MEDIA_KEY_PREFIX)).toBe(true);
        expect(key).toMatch(new RegExp(`^media/${sha}/${String(width)}\\.(avif|webp|jpg)$`));
      }
    }
    expect(mediaStagingKey("abc")).toBe("staging/abc");
    expect(mediaStagingKey("abc").startsWith(MEDIA_KEY_PREFIX)).toBe(false);
  });
});

describe("createMediaUploadSchema", () => {
  const ok = { mime: "image/avif", bytes: 1000, sha256: "b".repeat(64) };

  it("accepts the four raster types up to 15 MB", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "image/avif"]) {
      expect(createMediaUploadSchema.safeParse({ ...ok, mime }).success, mime).toBe(true);
    }
    expect(createMediaUploadSchema.safeParse({ ...ok, bytes: 15 * 1024 * 1024 }).success).toBe(
      true,
    );
  });

  it("refuses svg, heic, gif, oversize and malformed digests", () => {
    for (const bad of [
      { mime: "image/svg+xml" },
      { mime: "image/heic" },
      { mime: "image/gif" },
      { bytes: 15 * 1024 * 1024 + 1 },
      { bytes: 0 },
      { sha256: "B".repeat(64) },
    ]) {
      expect(
        createMediaUploadSchema.safeParse({ ...ok, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});
