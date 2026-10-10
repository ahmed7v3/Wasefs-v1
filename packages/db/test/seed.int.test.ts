import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../src/client.js";
import { runMigrations } from "../src/migrations.js";
import { siteSettings } from "../src/schema/index.js";
import { DEFAULT_SITE_SETTINGS, seedDefaults } from "../src/seed-data.js";

// Testcontainers by default; set TEST_DATABASE_URL to use a running (throwaway) database instead.
let container: StartedPostgreSqlContainer | undefined;
let handle: ReturnType<typeof createDb>;

beforeAll(async () => {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
    url = container.getConnectionUri();
  }
  handle = createDb({ url, max: 1 });
  await runMigrations(handle.db);
}, 180_000);

afterAll(async () => {
  await handle?.close();
  await container?.stop();
});

describe("seedDefaults", () => {
  it("is idempotent: a second run inserts nothing and changes nothing", async () => {
    await seedDefaults(handle.db);
    const before = await handle.db.select().from(siteSettings).orderBy(asc(siteSettings.key));
    expect(before.map((row) => row.key)).toEqual(
      expect.arrayContaining(DEFAULT_SITE_SETTINGS.map((row) => row.key)),
    );

    expect(await seedDefaults(handle.db)).toBe(0);
    const after = await handle.db.select().from(siteSettings).orderBy(asc(siteSettings.key));
    expect(after).toEqual(before);
  });
});
