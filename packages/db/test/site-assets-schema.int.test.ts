import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { siteAssets, users } from "../src/schema/index.js";

import { startTestDb, violatedConstraint, type TestDb } from "./db-fixture.js";

let fixture: TestDb;

beforeAll(async () => {
  fixture = await startTestDb();
}, 180_000);

afterAll(async () => {
  await fixture?.stop();
});

// Three possible keys only, so every test starts from an empty table.
beforeEach(async () => {
  await fixture.handle.db.delete(siteAssets);
});

const bytes = Buffer.from("not really a png, the database does not look inside");
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

const valid = {
  key: "logo",
  contentType: "image/png",
  data: bytes,
  sha256: sha(bytes),
} satisfies typeof siteAssets.$inferInsert;

async function insert(overrides: Partial<typeof siteAssets.$inferInsert> = {}) {
  const [row] = await fixture.handle.db
    .insert(siteAssets)
    .values({ ...valid, ...overrides })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** Runs a statement that must be rejected and returns the name of the constraint that rejected it. */
async function rejection(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return violatedConstraint(error);
  }
  throw new Error("expected the database to reject the statement");
}

describe("site_assets", () => {
  it("stores the bytes back unchanged, with null dimensions and timestamps by default", async () => {
    const row = await insert();
    expect(row.data.equals(bytes)).toBe(true);
    expect(row).toMatchObject({ key: "logo", width: null, height: null, updatedBy: null });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("holds one row per key", async () => {
    await insert({ key: "logo_dark" });
    expect(await rejection(() => insert({ key: "logo_dark" }))).toBe("site_assets_pkey");
  });

  it("accepts every allowed type", async () => {
    for (const contentType of [
      "image/png",
      "image/webp",
      "image/svg+xml",
      "image/x-icon",
    ] as const) {
      await fixture.handle.db.delete(siteAssets);
      expect((await insert({ contentType })).contentType).toBe(contentType);
    }
  });

  it("rejects an unknown key and an unknown content type", async () => {
    expect(await rejection(() => insert({ key: "banner" as never }))).toBe("site_assets_key_check");
    expect(
      await rejection(() => insert({ key: "favicon", contentType: "text/html" as never })),
    ).toBe("site_assets_content_type_check");
  });

  it("rejects an empty or oversized file and keeps the limit itself", async () => {
    expect(
      await rejection(() =>
        insert({ key: "favicon", data: Buffer.alloc(0), sha256: sha(Buffer.alloc(0)) }),
      ),
    ).toBe("site_assets_size_check");
    const tooBig = Buffer.alloc(524_289, 1);
    expect(
      await rejection(() => insert({ key: "favicon", data: tooBig, sha256: sha(tooBig) })),
    ).toBe("site_assets_size_check");
    const limit = Buffer.alloc(524_288, 1);
    expect((await insert({ key: "favicon", data: limit, sha256: sha(limit) })).data.length).toBe(
      524_288,
    );
  });

  it("rejects a digest that is not 64 lower-case hex characters", async () => {
    expect(await rejection(() => insert({ key: "favicon", sha256: "ABC" }))).toBe(
      "site_assets_sha256_check",
    );
  });

  it("keeps the image when the admin who uploaded it is removed", async () => {
    await insert();
    const [user] = await fixture.handle.db
      .insert(users)
      .values({ name: "Uploader", email: "uploader@example.com" })
      .returning();
    if (!user) throw new Error("insert returned no row");
    await fixture.handle.db
      .update(siteAssets)
      .set({ updatedBy: user.id })
      .where(eq(siteAssets.key, "logo"));

    await fixture.handle.db.delete(users).where(eq(users.id, user.id));
    const [kept] = await fixture.handle.db
      .select()
      .from(siteAssets)
      .where(eq(siteAssets.key, "logo"));
    expect(kept).toMatchObject({ key: "logo", updatedBy: null });
  });
});
