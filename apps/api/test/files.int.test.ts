import { createHash, randomUUID } from "node:crypto";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createDb, files, onboardingProgress, seedDefaults } from "@wasfa/db";
import { UPLOAD_MAX_BYTES } from "@wasfa/shared/schemas/files";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/bootstrap.js";
import { ObjectStorage } from "../src/files/object-storage.js";
import { SettingsService } from "../src/settings/settings.service.js";

import { AuthHarness, pwnedHandlers, testApiEnv, type Jar } from "./support/auth-harness.js";
import { insertOrg } from "./support/identity-fixtures.js";
import { startInfra, type TestInfra } from "./support/infra.js";
import { startStorage, type TestStorage } from "./support/storage.js";
import { wrongOwnerIsHidden } from "./support/wrong-owner.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/*
 * Uploads against a real MinIO (the same S3 code path as R2), Postgres and Redis. The point is the
 * storage behaviour: what a presigned PUT really refuses, and what `complete` does about the rest.
 */

const network = setupServer(...pwnedHandlers());

let infra: TestInfra;
let storage: TestStorage;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;
let redis: Redis;
let images: Queue;
const harness = new AuthHarness(
  () => app,
  () => owner.db,
);

beforeAll(async () => {
  [infra, storage] = await Promise.all([startInfra(), startStorage()]);
  network.listen({ onUnhandledRequest: "bypass" });
  owner = createDb({ url: infra.databaseUrl, max: 4 });
  await seedDefaults(owner.db);
  app = await createApp(testApiEnv(infra, storage.env), {
    extraImports: [harness.mailerModule()],
    authMailer: false,
  });
  redis = new Redis(infra.redisUrl, { maxRetriesPerRequest: null });
  images = new Queue("images", { connection: redis });
}, 240_000);

afterAll(async () => {
  network.close();
  await images?.close();
  await redis?.quit();
  await app?.close();
  await owner?.close();
  await storage?.stop();
  await infra?.stop();
});

interface Person {
  jar: Jar;
  userId: string;
}

/** A verified account with finished onboarding (what `@RequireVerified` asks for). */
async function user(): Promise<Person> {
  const person = await harness.signedInUser();
  await owner.db
    .insert(onboardingProgress)
    .values({ userId: person.userId, currentStep: "done", completedAt: new Date() });
  return person;
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const jpegLike = (size = 2048, fill = 7) => Buffer.alloc(size, fill);

function declare(bytes: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    purpose: "rx_page",
    mime: "image/jpeg",
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    width: 1200,
    height: 1600,
    ...overrides,
  };
}

const create = (person: Person, body: Record<string, unknown>) =>
  harness.call("POST", "/uploads", { jar: person.jar, body });
const complete = (person: Person, fileId: string) =>
  harness.call("POST", `/uploads/${fileId}/complete`, { jar: person.jar });
const viewUrl = (person: Person, fileId: string) =>
  harness.call("GET", `/files/${fileId}/url`, { jar: person.jar });

interface Created {
  fileId: string;
  url: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

async function createOk(person: Person, bytes: Buffer, overrides: Record<string, unknown> = {}) {
  const res = await create(person, declare(bytes, overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Created>();
}

/** The browser's PUT: exactly the URL and headers the api returned. */
function put(created: Created, body: Buffer, headers: Record<string, string> = created.headers) {
  return fetch(created.url, { method: "PUT", headers, body: new Uint8Array(body) });
}

async function row(fileId: string) {
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

describe("POST /uploads", () => {
  it("needs a session, and a verified account with finished onboarding", async () => {
    const anonymous = await harness.call("POST", "/uploads", { body: declare(jpegLike()) });
    expect(anonymous.statusCode).toBe(401);

    const fresh = await harness.signedInUser();
    const res = await create(fresh, declare(jpegLike()));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ details: { reason: "onboarding_required" } });
  });

  it("creates a pending file and a 5-minute PUT URL for exactly its key, size and type", async () => {
    const person = await user();
    const bytes = jpegLike(4096);
    const created = await createOk(person, bytes);

    expect(created.expiresInSeconds).toBe(300);
    expect(created.headers["Content-Type"]).toBe("image/jpeg");
    const url = new URL(created.url);
    expect(url.pathname).toBe(`/${storage.bucket}/u/${person.userId}/${created.fileId}/original`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    // Size, type and checksum are signed headers, not query parameters the client could drop.
    const signed = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(signed).toEqual(
      expect.arrayContaining(["content-length", "content-type", "x-amz-checksum-sha256"]),
    );

    const stored = await row(created.fileId);
    expect(stored).toMatchObject({
      ownerUserId: person.userId,
      ownerOrgId: null,
      createdBy: person.userId,
      purpose: "rx_page",
      mime: "image/jpeg",
      bytes: 4096,
      status: "pending",
      sha256: null,
      dhash: null,
      r2Key: `u/${person.userId}/${created.fileId}/original`,
    });
    // Expires `uploads.retentionDays` (default 30) after creation.
    const days = ((stored.expiresAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("follows the uploads.retentionDays setting", async () => {
    const settings = app.get(SettingsService);
    await settings.set("uploads", { retentionDays: 7 }, { actorId: null });
    try {
      const created = await createOk(await user(), jpegLike());
      const days =
        (((await row(created.fileId)).expiresAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
    } finally {
      await settings.set("uploads", { retentionDays: 30 }, { actorId: null });
    }
  });

  it("keeps a PDF's type in the key and stores the image type the table allows", async () => {
    const person = await user();
    const pdf = Buffer.from("%PDF-1.4 fake");
    const created = await createOk(person, pdf, { mime: "application/pdf" });
    expect(created.headers["Content-Type"]).toBe("application/pdf");
    expect(await row(created.fileId)).toMatchObject({
      r2Key: `u/${person.userId}/${created.fileId}/original.pdf`,
      mime: "image/jpeg",
    });
  });

  it("refuses HEIC with a specific reason, so the browser can convert and retry", async () => {
    const person = await user();
    for (const mime of ["image/heic", "image/heif"]) {
      const res = await create(person, declare(jpegLike(), { mime }));
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { reason: "heic_unsupported" },
      });
    }
  });

  it("validates the body: type, size, hash and purpose", async () => {
    const person = await user();
    const ok = declare(jpegLike());
    const cases: Record<string, unknown>[] = [
      { ...ok, mime: "image/gif" },
      { ...ok, mime: "text/html" },
      { ...ok, bytes: 0 },
      { ...ok, bytes: UPLOAD_MAX_BYTES + 1 },
      { ...ok, bytes: 1.5 },
      { ...ok, sha256: "abc" },
      { ...ok, sha256: "g".repeat(64) },
      { ...ok, purpose: "avatar" },
      { ...ok, width: -1 },
    ];
    for (const body of cases) {
      const res = await create(person, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    // The limit itself is allowed.
    expect(
      (await create(person, declare(jpegLike(), { bytes: UPLOAD_MAX_BYTES }))).statusCode,
    ).toBe(201);
  });

  it("allows 30 requests per user per 10 minutes, then RATE_LIMITED, without touching other users", async () => {
    const busy = await user();
    const other = await user();
    const body = declare(jpegLike());
    for (let n = 0; n < 30; n++) {
      expect((await create(busy, body)).statusCode, `request ${String(n + 1)}`).toBe(201);
    }
    const limited = await create(busy, body);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect((await create(other, body)).statusCode).toBe(201);
  });
});

describe("the presigned PUT", () => {
  it("accepts exactly the declared bytes", async () => {
    const person = await user();
    const bytes = jpegLike(3000, 3);
    const created = await createOk(person, bytes);
    const res = await put(created, bytes);
    expect(res.status).toBe(200);
    expect(await exists(`u/${person.userId}/${created.fileId}/original`)).toBe(true);
  });

  it("refuses a body larger than declared (the length is part of the signature)", async () => {
    const person = await user();
    const declared = jpegLike(2000, 3);
    const created = await createOk(person, declared);
    const oversize = jpegLike(2000 + 5_000_000, 3);

    const res = await put(created, oversize);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await exists(`u/${person.userId}/${created.fileId}/original`)).toBe(false);
  });

  it("refuses a smaller body and another content type", async () => {
    const person = await user();
    const declared = jpegLike(2000, 3);
    const created = await createOk(person, declared);
    expect((await put(created, jpegLike(1999, 3))).status).toBeGreaterThanOrEqual(400);
    const wrongType = { ...created.headers, "Content-Type": "text/html" };
    expect((await put(created, declared, wrongType)).status).toBeGreaterThanOrEqual(400);
    expect(await exists(`u/${person.userId}/${created.fileId}/original`)).toBe(false);
  });

  it("refuses the same size with different content (the declared SHA-256 is signed too)", async () => {
    const person = await user();
    const declared = jpegLike(2000, 3);
    const created = await createOk(person, declared);
    expect((await put(created, jpegLike(2000, 4))).status).toBeGreaterThanOrEqual(400);
    expect(await exists(`u/${person.userId}/${created.fileId}/original`)).toBe(false);
  });

  it("is bound to its key: the same signature does not open another object", async () => {
    const person = await user();
    const bytes = jpegLike();
    const created = await createOk(person, bytes);
    const elsewhere = created.url.replace(created.fileId, randomUUID());
    expect((await put({ ...created, url: elsewhere }, bytes)).status).toBeGreaterThanOrEqual(400);
  });
});

describe("POST /uploads/:id/complete", () => {
  it("checks the stored object, marks the file uploaded and queues one image.process job", async () => {
    const person = await user();
    const bytes = jpegLike(5000, 9);
    const created = await createOk(person, bytes);
    expect((await put(created, bytes)).status).toBe(200);

    const res = await complete(person, created.fileId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ fileId: created.fileId, status: "uploaded" });
    expect((await row(created.fileId)).status).toBe("uploaded");

    const job = await images.getJob(`image-process-${created.fileId}`);
    expect(job?.name).toBe("image.process");
    expect(job?.data).toEqual({ fileId: created.fileId });

    // A retried `complete` changes nothing and queues nothing more.
    const again = await complete(person, created.fileId);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ fileId: created.fileId, status: "uploaded" });
  });

  it("says so when nothing was uploaded, and leaves the file pending", async () => {
    const person = await user();
    const created = await createOk(person, jpegLike());
    const res = await complete(person, created.fileId);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "CONFLICT", details: { reason: "upload_missing" } });
    expect((await row(created.fileId)).status).toBe("pending");
  });

  it("deletes an object of the wrong size that storage let through, and rejects the file", async () => {
    // Simulates a store that does not enforce the signed length (what the R2 spike must rule out).
    const person = await user();
    const declared = jpegLike(2000, 5);
    const created = await createOk(person, declared);
    const key = `u/${person.userId}/${created.fileId}/original`;
    await storage.s3.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: key,
        Body: jpegLike(9_000_000, 5),
        ContentType: "image/jpeg",
      }),
    );

    const res = await complete(person, created.fileId);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ details: { reason: "size_mismatch" } });
    expect(await exists(key)).toBe(false);
    expect(await row(created.fileId)).toMatchObject({
      status: "rejected",
      rejectReason: "size_mismatch",
    });
    expect(await images.getJob(`image-process-${created.fileId}`)).toBeUndefined();
    // And it stays rejected with the same answer.
    expect((await complete(person, created.fileId)).json()).toMatchObject({
      details: { reason: "size_mismatch" },
    });
  });

  it("deletes an object of the wrong type", async () => {
    const person = await user();
    const declared = jpegLike(2000, 5);
    const created = await createOk(person, declared);
    const key = `u/${person.userId}/${created.fileId}/original`;
    await storage.s3.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: key,
        Body: declared,
        ContentType: "text/html",
      }),
    );
    const res = await complete(person, created.fileId);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ details: { reason: "type_mismatch" } });
    expect(await exists(key)).toBe(false);
    expect((await row(created.fileId)).status).toBe("rejected");
  });

  it("hides another user's file: NOT_FOUND, and nothing changes", async () => {
    const mine = await user();
    const intruder = await user();
    const bytes = jpegLike(2500, 2);
    const created = await createOk(mine, bytes);
    expect((await put(created, bytes)).status).toBe(200);

    await wrongOwnerIsHidden({
      owner: () => complete(mine, created.fileId),
      intruder: () => complete(intruder, created.fileId),
      stillThere: async () => (await row(created.fileId)).status === "pending",
    });
    expect((await row(created.fileId)).status).toBe("uploaded");
  });

  it("answers an unknown id the same way as someone else's", async () => {
    const person = await user();
    const res = await complete(person, randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await harness.call("POST", "/uploads/not-a-uuid/complete", { jar: person.jar })).statusCode,
    ).toBe(400);
  });
});

describe("GET /files/:id/url", () => {
  /** A processed file the way the worker leaves it. */
  async function processedFile(person: { userId: string }, orgId?: string) {
    const fileId = randomUUID();
    const ownerId = orgId ?? person.userId;
    const key = `u/${ownerId}/${fileId}/processed`;
    const body = Buffer.from("processed-jpeg-bytes");
    await storage.s3.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: key,
        Body: body,
        ContentType: "image/jpeg",
      }),
    );
    await owner.db.insert(files).values({
      id: fileId,
      ...(orgId ? { ownerOrgId: orgId } : { ownerUserId: person.userId }),
      createdBy: person.userId,
      purpose: "rx_page",
      r2Key: key,
      mime: "image/jpeg",
      bytes: body.byteLength,
      status: "processed",
      sha256: sha256(body),
      dhash: "0123456789abcdef",
    });
    return { fileId, body };
  }

  it("gives the owner a 60-second link that downloads the processed image", async () => {
    const person = await user();
    const { fileId, body } = await processedFile(person);
    const res = await viewUrl(person, fileId);
    expect(res.statusCode, res.body).toBe(200);
    const link = res.json<{ url: string; expiresInSeconds: number }>();
    expect(link.expiresInSeconds).toBe(60);
    expect(new URL(link.url).searchParams.get("X-Amz-Expires")).toBe("60");
    const download = await fetch(link.url);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(body);
  });

  it("hides another user's file: NOT_FOUND", async () => {
    const mine = await user();
    const intruder = await user();
    const { fileId } = await processedFile(mine);
    await wrongOwnerIsHidden({
      owner: () => viewUrl(mine, fileId),
      intruder: () => viewUrl(intruder, fileId),
      stillThere: async () => (await row(fileId)).status === "processed",
    });
  });

  it("gives an organization's file to its members and to nobody else", async () => {
    const member = await user();
    const outsider = await user();
    const creator = await user();
    const orgId = await insertOrg(owner.db, {
      createdBy: creator.userId,
      members: [
        { userId: creator.userId, role: "org_admin" },
        { userId: member.userId, role: "org_member" },
      ],
    });
    const { fileId } = await processedFile(creator, orgId);
    expect((await viewUrl(member, fileId)).statusCode).toBe(200);
    expect((await viewUrl(creator, fileId)).statusCode).toBe(200);
    expect((await viewUrl(outsider, fileId)).statusCode).toBe(404);
  });

  it("has no link for a file that is not processed (yet, or any more)", async () => {
    const person = await user();
    const pending = await createOk(person, jpegLike());
    const res = await viewUrl(person, pending.fileId);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: { reason: "pending" } });

    const { fileId } = await processedFile(person);
    await owner.db.update(files).set({ status: "deleted" }).where(eq(files.id, fileId));
    expect((await viewUrl(person, fileId)).json()).toMatchObject({
      details: { reason: "deleted" },
    });
  });
});

describe("without storage configuration", () => {
  it("boots, and answers upload routes with UPSTREAM_UNAVAILABLE", async () => {
    const bare = new ObjectStorage({
      ...testApiEnv(infra),
    });
    expect(bare.configured).toBe(false);
    await expect(bare.presignGet("k", 60)).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      details: { reason: "storage_not_configured" },
    });
  });
});

describe("GET /files/:id", () => {
  it("tells the owner where the upload is, with the reason once rejected", async () => {
    const person = await user();
    const created = await createOk(person, jpegLike());
    const status = (id: string, who = person) =>
      harness.call("GET", `/files/${id}`, { jar: who.jar });

    expect((await status(created.fileId)).json()).toEqual({
      fileId: created.fileId,
      status: "pending",
      rejectReason: null,
    });
    await owner.db
      .update(files)
      .set({ status: "rejected", rejectReason: "corrupt_image" })
      .where(eq(files.id, created.fileId));
    expect((await status(created.fileId)).json()).toEqual({
      fileId: created.fileId,
      status: "rejected",
      rejectReason: "corrupt_image",
    });
  });

  it("hides another user's file and needs a session", async () => {
    const mine = await user();
    const intruder = await user();
    const created = await createOk(mine, jpegLike());
    await wrongOwnerIsHidden({
      owner: () => harness.call("GET", `/files/${created.fileId}`, { jar: mine.jar }),
      intruder: () => harness.call("GET", `/files/${created.fileId}`, { jar: intruder.jar }),
      stillThere: async () => (await row(created.fileId)).status === "pending",
    });
    expect((await harness.call("GET", `/files/${created.fileId}`)).statusCode).toBe(401);
  });
});
