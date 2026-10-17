import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, type TestDb } from "./db-fixture.js";

let fixture: TestDb;
beforeAll(async () => {
  fixture = await startTestDb();
}, 180_000);
afterAll(async () => {
  await fixture?.stop();
});

describe("manual payment and alert migration", () => {
  it("applies 0014 and installs the named checks, indexes, and sealed phone column", async () => {
    const checks = await fixture.handle.db.execute(
      sql`select conname from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace`,
    );
    const names = new Set(checks.map((row) => String(row.conname)));
    for (const name of [
      "payment_method_account_changes_status_check",
      "payment_method_account_changes_reason_check",
      "admin_alerts_kind_check",
      "files_purpose_check",
    ]) {
      expect(names.has(name), name).toBe(true);
    }
    const indexes = await fixture.handle.db.execute(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    );
    const indexNames = new Set(indexes.map((row) => String(row.indexname)));
    expect(indexNames.has("payment_method_account_changes_one_pending_key")).toBe(true);
    const column = await fixture.handle.db.execute(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'sender_phone_enc'`,
    );
    expect(column).toHaveLength(1);
  });
});
