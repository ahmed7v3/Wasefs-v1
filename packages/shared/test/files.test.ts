import { describe, expect, it } from "vitest";
import { z } from "zod";

import { UPLOAD_MAX_BYTES, createUploadSchema, isHeicMime } from "../src/schemas/files.js";
import {
  isPdfObjectKey,
  originalObjectKey,
  processedObjectKey,
  refineUploadsEnv,
  uploadsEnvShape,
  uploadsStorageConfig,
} from "../src/storage.js";

const ok = {
  purpose: "rx_page",
  mime: "image/jpeg",
  bytes: 1000,
  sha256: "a".repeat(64),
};

describe("createUploadSchema", () => {
  it("accepts the allowed types, normalising case and hash case", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "application/pdf"]) {
      expect(createUploadSchema.safeParse({ ...ok, mime }).success, mime).toBe(true);
    }
    const parsed = createUploadSchema.parse({
      ...ok,
      mime: " Image/JPEG ",
      sha256: "A".repeat(64),
    });
    expect(parsed).toMatchObject({ mime: "image/jpeg", sha256: "a".repeat(64) });
  });

  it("lets HEIC through the schema so the api can answer it with its own reason", () => {
    expect(createUploadSchema.safeParse({ ...ok, mime: "image/heic" }).success).toBe(true);
    expect(isHeicMime("image/heif")).toBe(true);
    expect(isHeicMime("image/jpeg")).toBe(false);
  });

  it("refuses other types, sizes outside 1 B to 10 MB, and malformed hashes", () => {
    for (const bad of [
      { mime: "image/gif" },
      { mime: "image/svg+xml" },
      { mime: "text/html" },
      { bytes: 0 },
      { bytes: UPLOAD_MAX_BYTES + 1 },
      { bytes: 10.5 },
      { sha256: "a".repeat(63) },
      { sha256: "z".repeat(64) },
      { purpose: "avatar" },
      { width: 0 },
    ]) {
      expect(createUploadSchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
    expect(createUploadSchema.safeParse({ ...ok, bytes: UPLOAD_MAX_BYTES }).success).toBe(true);
  });
});

describe("object keys", () => {
  it("are built as u/<owner>/<file>/<name>, and a PDF keeps its type in the key", () => {
    expect(originalObjectKey("o1", "f1", false)).toBe("u/o1/f1/original");
    expect(originalObjectKey("o1", "f1", true)).toBe("u/o1/f1/original.pdf");
    expect(processedObjectKey("o1", "f1")).toBe("u/o1/f1/processed");
    expect(isPdfObjectKey(originalObjectKey("o1", "f1", true))).toBe(true);
    expect(isPdfObjectKey(originalObjectKey("o1", "f1", false))).toBe(false);
    expect(isPdfObjectKey(processedObjectKey("o1", "f1"))).toBe(false);
  });
});

describe("uploads env", () => {
  const schema = z.object(uploadsEnvShape).superRefine(refineUploadsEnv);
  const full = {
    R2_UPLOADS_ENDPOINT: "https://abc.r2.cloudflarestorage.com",
    R2_UPLOADS_BUCKET: "wasfa-uploads",
    R2_UPLOADS_ACCESS_KEY_ID: "id",
    R2_UPLOADS_SECRET_ACCESS_KEY: "secret",
  };

  it("is optional as a whole, defaults the region to auto, and treats blanks as unset", () => {
    const empty = schema.parse({ R2_UPLOADS_ENDPOINT: "", R2_UPLOADS_BUCKET: "" });
    expect(empty.R2_UPLOADS_REGION).toBe("auto");
    expect(uploadsStorageConfig(empty)).toBeUndefined();
  });

  it("needs all four keys together", () => {
    const config = uploadsStorageConfig(schema.parse(full));
    expect(config).toEqual({
      endpoint: full.R2_UPLOADS_ENDPOINT,
      bucket: full.R2_UPLOADS_BUCKET,
      accessKeyId: "id",
      secretAccessKey: "secret",
      region: "auto",
    });
    for (const key of Object.keys(full)) {
      const rest = Object.fromEntries(Object.entries(full).filter(([name]) => name !== key));
      expect(schema.safeParse(rest).success, key).toBe(false);
    }
  });

  it("only takes an http(s) endpoint", () => {
    expect(schema.safeParse({ ...full, R2_UPLOADS_ENDPOINT: "ftp://host" }).success).toBe(false);
    expect(
      schema.safeParse({ ...full, R2_UPLOADS_ENDPOINT: "http://127.0.0.1:9000" }).success,
    ).toBe(true);
  });
});
